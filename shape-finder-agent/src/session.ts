import { Agent, CursorAgentError } from "@cursor/sdk";

import {
  SHAPE_FINDER_PROTOCOL_VERSION,
  SHAPE_FINDER_TOOLS,
  parseFindOutcome,
} from "../../excalidraw-app/shape-finder/protocol.js";

import { config } from "./config.js";
import { FIND_PROMPT } from "./prompt.js";

import type {
  AgentToBrowserMessage,
  BrowserToAgentMessage,
  FindOutcome,
  FocusElementResult,
  GetElementThumbnailsResult,
  ReferenceImage,
  RunStepId,
  RunStepStatus,
  ShapeFinderToolName,
} from "../../excalidraw-app/shape-finder/protocol.js";
import type {
  Run,
  SDKAgent,
  SDKCustomTool,
  SDKCustomToolContent,
  SDKCustomToolResult,
} from "@cursor/sdk";
import type { WebSocket } from "ws";

/** The browser has to render every candidate before it can answer, so the
 * budget is generous compared with a normal RPC. */
const TOOL_CALL_TIMEOUT_MS = 30_000;

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

type PendingToolCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/**
 * One connected Shape Finder sidebar.
 *
 * Owns a durable local Cursor agent whose custom tools are proxied straight
 * back over the socket, because only the browser can see the live scene.
 */
export class ShapeFinderSession {
  private agent: SDKAgent | null = null;

  private agentPromise: Promise<SDKAgent> | null = null;

  private readonly pendingToolCalls = new Map<string, PendingToolCall>();

  private activeRequestId: string | null = null;

  private activeRun: Run | null = null;

  private focusedCandidateId: string | null = null;

  private callCounter = 0;

  constructor(private readonly socket: WebSocket) {
    socket.on("message", (raw) => this.handleMessage(raw.toString()));
    socket.on("close", () => void this.dispose());

    this.send({
      type: "ready",
      protocolVersion: SHAPE_FINDER_PROTOCOL_VERSION,
      model: config.model,
    });
  }

  async dispose() {
    this.rejectPendingToolCalls("The Shape Finder sidebar disconnected.");

    try {
      await this.activeRun?.cancel();
    } catch {
      // a run that already finished cannot be cancelled; nothing to do
    }

    this.agent?.close();
    this.agent = null;
    this.agentPromise = null;
  }

  private send(message: AgentToBrowserMessage) {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private emitStep(step: RunStepId, status: RunStepStatus, detail?: string) {
    if (!this.activeRequestId) {
      return;
    }
    this.send({
      type: "run-event",
      requestId: this.activeRequestId,
      event: { kind: "step", step, status, detail },
    });
  }

  private handleMessage(raw: string) {
    let message: BrowserToAgentMessage;

    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    switch (message.type) {
      case "find":
        void this.runFind(message.requestId, message.image);
        break;
      case "cancel":
        void this.activeRun?.cancel();
        break;
      case "tool-result": {
        const pending = this.pendingToolCalls.get(message.callId);
        if (!pending) {
          return;
        }
        this.pendingToolCalls.delete(message.callId);
        if (message.ok) {
          pending.resolve(message.value);
        } else {
          pending.reject(new Error(message.error));
        }
        break;
      }
    }
  }

  private callBrowser<T>(
    tool: ShapeFinderToolName,
    args: Record<string, unknown>,
  ): Promise<T> {
    const callId = `call-${++this.callCounter}`;

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingToolCalls.delete(callId);
        reject(new Error(`The canvas did not answer \`${tool}\` in time.`));
      }, TOOL_CALL_TIMEOUT_MS);

      this.pendingToolCalls.set(callId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.send({ type: "tool-call", callId, tool, args });
    });
  }

  private rejectPendingToolCalls(reason: string) {
    for (const pending of this.pendingToolCalls.values()) {
      pending.reject(new Error(reason));
    }
    this.pendingToolCalls.clear();
  }

  private toolFailure(message: string): SDKCustomToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
  }

  private createCustomTools(): Record<string, SDKCustomTool> {
    return {
      [SHAPE_FINDER_TOOLS.getElementThumbnails]: {
        description:
          "Render every candidate currently on the Excalidraw canvas as its own PNG thumbnail. Each thumbnail is preceded by a line naming its candidateId. Takes no arguments.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async () => {
          this.emitStep("thumbnails", "running");

          try {
            const { candidates } =
              await this.callBrowser<GetElementThumbnailsResult>(
                SHAPE_FINDER_TOOLS.getElementThumbnails,
                {},
              );

            this.emitStep(
              "thumbnails",
              "completed",
              `Rendered ${candidates.length} element thumbnail${
                candidates.length === 1 ? "" : "s"
              }`,
            );
            this.emitStep("compare", "running");

            const content = candidates.flatMap<SDKCustomToolContent>(
              (candidate) => [
                { type: "text", text: `candidateId: ${candidate.candidateId}` },
                {
                  type: "image",
                  data: candidate.data,
                  mimeType: candidate.mimeType,
                },
              ],
            );

            return {
              content,
              structuredContent: {
                candidates: candidates.map((candidate) => ({
                  candidateId: candidate.candidateId,
                  width: candidate.width,
                  height: candidate.height,
                  elementIds: candidate.elementIds,
                })),
              },
            };
          } catch (error) {
            const message = describeError(error);
            this.emitStep("thumbnails", "error", message);
            return this.toolFailure(message);
          }
        },
      },

      [SHAPE_FINDER_TOOLS.focusElement]: {
        description:
          "Select the candidate with the given candidateId and animate the viewport to centre it. Only call this when exactly one candidate matches the reference image.",
        inputSchema: {
          type: "object",
          properties: {
            candidateId: {
              type: "string",
              description: "A candidateId returned by get_element_thumbnails.",
            },
          },
          required: ["candidateId"],
          additionalProperties: false,
        },
        execute: async (args) => {
          const candidateId = String(args.candidateId ?? "");
          this.emitStep("compare", "completed", "Compared visual candidates");
          this.emitStep("focus", "running", `Focusing ${candidateId}`);

          try {
            const result = await this.callBrowser<FocusElementResult>(
              SHAPE_FINDER_TOOLS.focusElement,
              { candidateId },
            );

            this.focusedCandidateId = result.candidateId;
            this.emitStep(
              "focus",
              "completed",
              `Focused ${result.candidateId}`,
            );

            return {
              content: [
                {
                  type: "text",
                  text: `Focused ${result.candidateId}.`,
                },
              ],
              structuredContent: {
                candidateId: result.candidateId,
                elementIds: result.elementIds,
                bounds: result.bounds,
              },
            };
          } catch (error) {
            const message = describeError(error);
            this.emitStep("focus", "error", message);
            return this.toolFailure(message);
          }
        },
      },
    };
  }

  private ensureAgent(): Promise<SDKAgent> {
    if (!this.agentPromise) {
      this.agentPromise = Agent.create({
        apiKey: config.apiKey,
        model: { id: config.model },
        name: "Excalidraw Shape Finder",
        local: {
          cwd: config.agentCwd,
          customTools: this.createCustomTools(),
        },
      })
        .then((agent) => {
          this.agent = agent;
          return agent;
        })
        .catch((error) => {
          this.agentPromise = null;
          throw error;
        });
    }

    return this.agentPromise;
  }

  private async runFind(requestId: string, image: ReferenceImage) {
    if (this.activeRequestId) {
      this.send({
        type: "run-failed",
        requestId,
        phase: "startup",
        message: "A Shape Finder run is already in flight.",
      });
      return;
    }

    this.activeRequestId = requestId;
    this.focusedCandidateId = null;

    let run: Run;

    try {
      const agent = await this.ensureAgent();

      this.emitStep(
        "reference",
        "completed",
        `Received ${image.fileName ?? "reference PNG"}`,
      );

      run = await agent.send({
        text: FIND_PROMPT,
        images: [{ data: image.data, mimeType: image.mimeType }],
      });
    } catch (error) {
      // A throw here means the run never executed — auth, config or network —
      // which is a different problem from a run that started and then failed.
      this.send({
        type: "run-failed",
        requestId,
        phase: "startup",
        message:
          error instanceof CursorAgentError
            ? `${error.message} (retryable: ${error.isRetryable})`
            : describeError(error),
      });
      this.activeRequestId = null;
      return;
    }

    this.activeRun = run;

    try {
      await this.consumeStream(requestId, run);
      const result = await run.wait();

      if (result.status !== "finished") {
        this.send({
          type: "run-failed",
          requestId,
          phase: "run",
          message:
            result.error?.message ?? `The run ended as "${result.status}".`,
        });
        return;
      }

      this.finishRun(requestId, result.result ?? "");
    } catch (error) {
      this.send({
        type: "run-failed",
        requestId,
        phase: "run",
        message: describeError(error),
      });
    } finally {
      this.activeRun = null;
      this.activeRequestId = null;
    }
  }

  private async consumeStream(requestId: string, run: Run) {
    for await (const event of run.stream()) {
      if (event.type !== "assistant") {
        continue;
      }

      const text = event.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      if (text) {
        this.send({
          type: "run-event",
          requestId,
          event: { kind: "assistant-text", text },
        });
      }
    }
  }

  private finishRun(requestId: string, finalText: string) {
    const parsed = parseFindOutcome(finalText);

    // The tool call is the ground truth for what the canvas actually shows, so
    // a focused candidate wins over an unparseable or contradictory reply. A
    // text-only MATCH without focus_element never updated the canvas, so it
    // cannot be reported as a match.
    const outcome: FindOutcome | null = this.focusedCandidateId
      ? { kind: "match", candidateId: this.focusedCandidateId }
      : parsed?.kind === "match"
      ? null
      : parsed;

    if (!outcome) {
      this.send({
        type: "run-failed",
        requestId,
        phase: "run",
        message:
          parsed?.kind === "match"
            ? "The agent reported a match without focusing a candidate on the canvas."
            : `The agent finished without a verdict: ${
                finalText || "(empty reply)"
              }`,
      });
      return;
    }

    if (outcome.kind === "match") {
      this.emitStep("compare", "completed", "Compared visual candidates");
    } else {
      this.emitStep(
        "compare",
        "completed",
        outcome.kind === "no-match"
          ? "No candidate resembled the reference"
          : "Several candidates were equally close",
      );
    }

    this.send({ type: "run-finished", requestId, outcome });
  }
}
