import { randomUUID } from "node:crypto";

import { WebSocket } from "ws";

import type {
  ShapeFinderClientMessage,
  ShapeFinderServerMessage,
  ShapeFinderThumbnail,
  ShapeFinderToolName,
  ShapeFinderToolResult,
  StartShapeFinderRunRequest,
} from "@excalidraw/shape-finder-protocol";

import type { SDKCustomTool, SDKMessage } from "@cursor/sdk";

import type { ShapeFinderAgentFactory, ShapeFinderSdkAgent } from "./agent.js";

const TOOL_TIMEOUT_MS = 30_000;

const SHAPE_FINDER_PROMPT = `Find the canvas element that visually matches the reference PNG.

You must:
1. Call get_element_thumbnails exactly once.
2. Compare the reference image with every returned candidate image.
3. Call focus_element only when exactly one candidate is a high-confidence visual match.
4. Do not use shell, file, web, or any other tools.
5. Finish with only one JSON object:
   {"status":"found","elementId":"the-id","message":"Found 1 match"}
   {"status":"not_found","message":"No matching element found"}
   {"status":"ambiguous","message":"Multiple possible matches found"}

Never call focus_element for not_found or ambiguous outcomes.`;

type PendingToolCall = {
  resolve: (result: ShapeFinderToolResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const parseOutcome = (
  resultText: string | undefined,
):
  | { outcome: "not_found" | "ambiguous"; message: string }
  | { outcome: "found"; message: string; elementId?: string }
  | null => {
  if (!resultText) {
    return null;
  }

  const json = resultText.match(/\{[\s\S]*\}/)?.[0];
  if (!json) {
    return null;
  }

  try {
    const parsed = JSON.parse(json) as {
      status?: unknown;
      message?: unknown;
      elementId?: unknown;
    };
    if (
      (parsed.status === "not_found" || parsed.status === "ambiguous") &&
      typeof parsed.message === "string"
    ) {
      return { outcome: parsed.status, message: parsed.message };
    }
    if (parsed.status === "found" && typeof parsed.message === "string") {
      return {
        outcome: "found",
        message: parsed.message,
        elementId:
          typeof parsed.elementId === "string" ? parsed.elementId : undefined,
      };
    }
  } catch {
    return null;
  }

  return null;
};

const getAssistantText = (event: SDKMessage) => {
  if (event.type !== "assistant") {
    return null;
  }

  const text = event.message.content
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )
    .map((block) => block.text)
    .join("");
  return text || null;
};

export class ShapeFinderSession {
  public readonly id = randomUUID();

  private activeRunId: string | null = null;
  private agent: ShapeFinderSdkAgent | null = null;
  private disposed = false;
  private focusedElementId: string | null = null;
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();

  constructor(
    private readonly socket: WebSocket,
    private readonly createAgent: ShapeFinderAgentFactory,
  ) {}

  public isAvailable() {
    return (
      !this.disposed &&
      !this.activeRunId &&
      this.socket.readyState === WebSocket.OPEN
    );
  }

  public sendSessionReady() {
    this.send({ type: "session", sessionId: this.id });
  }

  public handleClientMessage(message: ShapeFinderClientMessage) {
    if (message.type === "ping") {
      this.send({ type: "pong" });
      return;
    }

    const pending = this.pendingToolCalls.get(message.callId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingToolCalls.delete(message.callId);

    if (message.type === "tool_error") {
      pending.reject(new Error(message.message));
    } else {
      pending.resolve(message.result);
    }
  }

  public startRun(image: StartShapeFinderRunRequest["image"]) {
    if (!this.isAvailable()) {
      throw new Error("Shape Finder session is busy or disconnected");
    }

    const runId = randomUUID();
    this.activeRunId = runId;
    this.focusedElementId = null;
    void this.executeRun(runId, image);
    return runId;
  }

  public async dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.activeRunId = null;

    for (const pending of this.pendingToolCalls.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Browser session disconnected"));
    }
    this.pendingToolCalls.clear();

    if (this.agent) {
      await this.agent[Symbol.asyncDispose]();
      this.agent = null;
    }
  }

  private async executeRun(
    runId: string,
    image: StartShapeFinderRunRequest["image"],
  ) {
    this.send({
      type: "run_event",
      runId,
      event: { kind: "received", filename: image.filename },
    });

    let run;
    try {
      this.agent ??= await this.createAgent(this.createCustomTools());
      run = await this.agent.send({
        text: SHAPE_FINDER_PROMPT,
        images: [{ data: image.data, mimeType: image.mimeType }],
      });
    } catch (error) {
      this.send({
        type: "run_error",
        runId,
        phase: "startup",
        message: errorMessage(error),
      });
      this.activeRunId = null;
      return;
    }

    let streamError: unknown = null;
    try {
      for await (const event of run.stream()) {
        const text = getAssistantText(event);
        if (text) {
          this.send({
            type: "run_event",
            runId,
            event: { kind: "assistant_text", text },
          });
        }
      }
    } catch (error) {
      streamError = error;
    }

    try {
      const result = await run.wait();
      if (streamError || result.status !== "finished") {
        throw (
          streamError ??
          new Error(
            result.error?.message ??
              `Cursor SDK run ended with ${result.status}`,
          )
        );
      }

      const parsed = parseOutcome(result.result);
      if (this.focusedElementId) {
        this.send({
          type: "run_result",
          runId,
          outcome: "found",
          message: "Found 1 match · selected and centered",
          elementId: this.focusedElementId,
        });
      } else if (parsed && parsed.outcome !== "found") {
        this.send({
          type: "run_result",
          runId,
          outcome: parsed.outcome,
          message: parsed.message,
        });
      } else {
        throw new Error("Cursor SDK returned an invalid Shape Finder result");
      }
    } catch (error) {
      this.send({
        type: "run_error",
        runId,
        phase: "mid_run",
        message: errorMessage(error),
      });
    } finally {
      this.activeRunId = null;
    }
  }

  private createCustomTools(): Record<string, SDKCustomTool> {
    return {
      get_element_thumbnails: {
        description:
          "Render each visible canvas candidate as a PNG paired with its element ID.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async () => {
          const runId = this.requireActiveRun();
          this.sendToolEvent(runId, "tool_started", "get_element_thumbnails");
          const result = await this.requestTool(
            runId,
            "get_element_thumbnails",
            {},
          );
          if (
            result.tool !== "get_element_thumbnails" ||
            !Array.isArray(result.elements)
          ) {
            throw new Error("Invalid thumbnail result from browser");
          }

          const elements = result.elements.filter(
            (element): element is ShapeFinderThumbnail =>
              typeof element.elementId === "string" &&
              typeof element.data === "string" &&
              element.mimeType === "image/png",
          );
          if (!elements.length) {
            throw new Error("The canvas has no visual elements to compare");
          }

          this.send({
            type: "run_event",
            runId,
            event: {
              kind: "tool_completed",
              tool: "get_element_thumbnails",
              elementCount: elements.length,
            },
          });
          this.send({
            type: "run_event",
            runId,
            event: { kind: "comparison_started" },
          });

          return {
            content: elements.flatMap((element) => [
              {
                type: "text" as const,
                text: `Element ID: ${element.elementId}`,
              },
              {
                type: "image" as const,
                data: element.data,
                mimeType: element.mimeType,
              },
            ]),
            structuredContent: {
              elements: elements.map(({ elementId, width, height }) => ({
                elementId,
                width,
                height,
              })),
            },
          };
        },
      },
      focus_element: {
        description:
          "Select and center exactly one visually matching canvas element.",
        inputSchema: {
          type: "object",
          properties: {
            elementId: { type: "string" },
          },
          required: ["elementId"],
          additionalProperties: false,
        },
        execute: async ({ elementId }) => {
          if (typeof elementId !== "string" || !elementId) {
            throw new Error("elementId is required");
          }

          const runId = this.requireActiveRun();
          this.sendToolEvent(runId, "tool_started", "focus_element");
          const result = await this.requestTool(runId, "focus_element", {
            elementId,
          });
          if (
            result.tool !== "focus_element" ||
            result.elementId !== elementId
          ) {
            throw new Error("Invalid focus result from browser");
          }

          this.focusedElementId = elementId;
          this.send({
            type: "run_event",
            runId,
            event: {
              kind: "tool_completed",
              tool: "focus_element",
              elementId,
            },
          });

          return {
            content: [
              {
                type: "text",
                text: `Focused element ${elementId}.`,
              },
            ],
            structuredContent: {
              elementId,
              bounds: [...result.bounds],
            },
          };
        },
      },
    };
  }

  private requireActiveRun() {
    if (!this.activeRunId) {
      throw new Error("No active Shape Finder run");
    }
    return this.activeRunId;
  }

  private sendToolEvent(
    runId: string,
    kind: "tool_started",
    tool: ShapeFinderToolName,
  ) {
    this.send({ type: "run_event", runId, event: { kind, tool } });
  }

  private requestTool(
    runId: string,
    tool: ShapeFinderToolName,
    args: Record<string, unknown>,
  ) {
    const callId = randomUUID();
    return new Promise<ShapeFinderToolResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingToolCalls.delete(callId);
        reject(new Error(`${tool} timed out waiting for the browser`));
      }, TOOL_TIMEOUT_MS);

      this.pendingToolCalls.set(callId, { resolve, reject, timeout });
      this.send({ type: "tool_call", runId, callId, tool, args });
    });
  }

  private send(message: ShapeFinderServerMessage) {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}
