import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process, { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { Agent } from "@cursor/sdk";
import { WebSocket, WebSocketServer } from "ws";

import {
  SHAPE_FINDER_PORT,
  parseShapeFinderClientMessage,
  type ShapeFinderOutcome,
  type ShapeFinderServerMessage,
  type ShapeFinderThumbnail,
} from "./protocol";

import type { Run, SDKAgent, SDKCustomTool, SDKMessage } from "@cursor/sdk";

const AGENT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(AGENT_DIRECTORY, "../..");
const ENV_PATH = resolve(REPOSITORY_ROOT, ".env");
const RPC_TIMEOUT_MS = 30_000;

if (!process.env.CURSOR_API_KEY && existsSync(ENV_PATH)) {
  loadEnvFile(ENV_PATH);
}

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  throw new Error(
    "CURSOR_API_KEY is required. Add it to the repository-root .env file or export it before starting Shape Finder.",
  );
}

const port = Number(process.env.SHAPE_FINDER_AGENT_PORT || SHAPE_FINDER_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("SHAPE_FINDER_AGENT_PORT must be a valid port number.");
}

type PendingRpc = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type BrowserThumbnailResult = {
  thumbnails: ShapeFinderThumbnail[];
};

type BrowserFocusResult = {
  elementId: string;
  bounds: [number, number, number, number];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(apiKey, "[REDACTED]");
};

const isAllowedOrigin = (origin: string | undefined) => {
  if (!origin) {
    return true;
  }

  const configuredOrigin = process.env.SHAPE_FINDER_ALLOWED_ORIGIN;
  if (configuredOrigin && origin === configuredOrigin) {
    return true;
  }

  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
};

const validateThumbnailResult = (value: unknown): BrowserThumbnailResult => {
  if (!isRecord(value) || !Array.isArray(value.thumbnails)) {
    throw new Error("The browser returned an invalid thumbnail response.");
  }

  const thumbnails = value.thumbnails.map((thumbnail) => {
    if (
      !isRecord(thumbnail) ||
      typeof thumbnail.elementId !== "string" ||
      typeof thumbnail.data !== "string" ||
      thumbnail.mimeType !== "image/png" ||
      typeof thumbnail.width !== "number" ||
      typeof thumbnail.height !== "number"
    ) {
      throw new Error("The browser returned an invalid element thumbnail.");
    }
    return thumbnail as ShapeFinderThumbnail;
  });

  if (thumbnails.length === 0) {
    throw new Error("There are no visible canvas elements to compare.");
  }

  return { thumbnails };
};

const validateFocusResult = (value: unknown): BrowserFocusResult => {
  if (
    !isRecord(value) ||
    typeof value.elementId !== "string" ||
    !Array.isArray(value.bounds) ||
    value.bounds.length !== 4 ||
    !value.bounds.every((coordinate) => typeof coordinate === "number")
  ) {
    throw new Error("The browser returned an invalid focus response.");
  }

  return value as BrowserFocusResult;
};

const classifyOutcome = (
  focusedElementId: string | undefined,
  result: string,
): ShapeFinderOutcome => {
  if (focusedElementId) {
    return "found";
  }

  return /\bambiguous\b|\bmultiple (?:matches|candidates)\b/i.test(result)
    ? "ambiguous"
    : "no_match";
};

const buildPrompt =
  () => `Find the canvas element that visually matches the reference PNG.

Follow these rules exactly:
1. Call get_element_thumbnails once to inspect every visual candidate.
2. Compare the reference PNG with the returned candidate images.
3. If exactly one candidate is a confident visual match, call focus_element once with its exact elementId.
4. If no candidate matches, do not call focus_element and start the final response with "NO_MATCH:".
5. If multiple candidates could match, do not call focus_element and start the final response with "AMBIGUOUS:".
6. Do not inspect repository files or use unrelated tools.

Keep the final response to one short sentence.`;

const handleConnection = (socket: WebSocket) => {
  const pendingRpc = new Map<string, PendingRpc>();
  let rpcSequence = 0;
  let activeRequestId: string | null = null;
  let activeRun: Run | null = null;

  const send = (message: ShapeFinderServerMessage) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  const requestBrowser = (
    method: "get_element_thumbnails" | "focus_element",
    params: Record<string, unknown>,
  ) =>
    new Promise<unknown>((resolveRpc, rejectRpc) => {
      const id = `rpc-${Date.now()}-${++rpcSequence}`;
      const timeout = setTimeout(() => {
        pendingRpc.delete(id);
        rejectRpc(new Error(`Browser RPC "${method}" timed out.`));
      }, RPC_TIMEOUT_MS);

      pendingRpc.set(id, {
        resolve: resolveRpc,
        reject: rejectRpc,
        timeout,
      });
      send({ type: "rpc_request", id, method, params });
    });

  const createCustomTools = (onFocused: (elementId: string) => void) => {
    const getElementThumbnails: SDKCustomTool = {
      description:
        "Render every visible Excalidraw canvas candidate as a PNG. Always call this before choosing a match.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        send({
          type: "timeline",
          step: "rendered",
          status: "running",
          detail: "Rendering element thumbnails",
        });

        try {
          const { thumbnails } = validateThumbnailResult(
            await requestBrowser("get_element_thumbnails", {}),
          );
          send({
            type: "timeline",
            step: "rendered",
            status: "completed",
            detail: `Rendered ${thumbnails.length} thumbnails`,
          });
          send({
            type: "timeline",
            step: "compared",
            status: "running",
            detail: "Comparing visual candidates",
          });

          return {
            content: thumbnails.flatMap((thumbnail) => [
              {
                type: "text" as const,
                text: `Candidate elementId: ${thumbnail.elementId}`,
              },
              {
                type: "image" as const,
                data: thumbnail.data,
                mimeType: thumbnail.mimeType,
              },
            ]),
            structuredContent: {
              thumbnails: thumbnails.map((thumbnail, index) => ({
                elementId: thumbnail.elementId,
                imageContentIndex: index * 2 + 1,
              })),
            },
          };
        } catch (error) {
          send({
            type: "timeline",
            step: "rendered",
            status: "error",
            detail: getErrorMessage(error),
          });
          throw error;
        }
      },
    };

    const focusElement: SDKCustomTool = {
      description:
        "Select and center one confidently matched canvas element. Do not call for no-match or ambiguous results.",
      inputSchema: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
            description:
              "The exact elementId returned beside the matching thumbnail.",
          },
        },
        required: ["elementId"],
        additionalProperties: false,
      },
      async execute(args) {
        const elementId = args.elementId;
        if (typeof elementId !== "string" || !elementId) {
          throw new Error("focus_element requires a non-empty elementId.");
        }

        send({
          type: "timeline",
          step: "compared",
          status: "completed",
          detail: `Matched ${elementId}`,
        });
        send({
          type: "timeline",
          step: "focused",
          status: "running",
          detail: `Focusing ${elementId}`,
        });

        try {
          const focused = validateFocusResult(
            await requestBrowser("focus_element", { elementId }),
          );
          onFocused(focused.elementId);
          send({
            type: "timeline",
            step: "focused",
            status: "completed",
            detail: `Focused ${focused.elementId}`,
          });
          return focused;
        } catch (error) {
          send({
            type: "timeline",
            step: "focused",
            status: "error",
            detail: getErrorMessage(error),
          });
          throw error;
        }
      },
    };

    return {
      get_element_thumbnails: getElementThumbnails,
      focus_element: focusElement,
    };
  };

  const forwardSdkEvent = (event: SDKMessage) => {
    if (event.type === "assistant") {
      for (const block of event.message.content) {
        if (block.type === "text" && block.text.trim()) {
          send({ type: "assistant_text", text: block.text });
        }
      }
    } else if (event.type === "tool_call") {
      send({
        type: "tool_activity",
        name: event.name,
        status: event.status,
      });
    }
  };

  const runShapeFinder = async (
    requestId: string,
    image: { data: string; mimeType: "image/png" },
  ) => {
    let agent: SDKAgent | null = null;
    let runCreated = false;
    let focusedElementId: string | undefined;

    activeRequestId = requestId;
    send({
      type: "timeline",
      step: "received",
      status: "completed",
      detail: "Received reference PNG",
    });

    try {
      agent = await Agent.create({
        apiKey,
        name: "Excalidraw Shape Finder",
        model: {
          id: process.env.CURSOR_SHAPE_FINDER_MODEL || "composer-2.5",
        },
        mode: "agent",
        local: {
          cwd: REPOSITORY_ROOT,
          sandboxOptions: { enabled: true },
          customTools: createCustomTools((elementId) => {
            focusedElementId = elementId;
          }),
        },
      });

      activeRun = await agent.send({
        text: buildPrompt(),
        images: [image],
      });
      runCreated = true;
      send({
        type: "run_started",
        requestId,
        runId: activeRun.id,
      });

      let streamError: unknown;
      try {
        for await (const event of activeRun.stream()) {
          forwardSdkEvent(event);
        }
      } catch (error) {
        streamError = error;
      }

      const result = await activeRun.wait();
      if (streamError) {
        throw streamError;
      }
      if (result.status !== "finished") {
        throw new Error(
          result.error?.message || `Shape Finder run ${result.status}.`,
        );
      }

      if (!focusedElementId) {
        send({
          type: "timeline",
          step: "compared",
          status: "completed",
          detail: "Compared visual candidates",
        });
      }

      const finalText = result.result?.trim() || "No matching element found.";
      const outcome = classifyOutcome(focusedElementId, finalText);
      send({
        type: "run_result",
        requestId,
        outcome,
        elementId: focusedElementId,
        message:
          outcome === "found"
            ? `Found 1 match · ${focusedElementId} selected and centered`
            : outcome === "ambiguous"
            ? "Ambiguous match · canvas unchanged"
            : "No matches · canvas unchanged",
      });
    } catch (error) {
      send({
        type: "run_error",
        requestId,
        phase: runCreated ? "run" : "startup",
        message: getErrorMessage(error),
      });
    } finally {
      activeRun = null;
      activeRequestId = null;
      if (agent) {
        await agent[Symbol.asyncDispose]();
      }
    }
  };

  socket.on("message", (rawMessage) => {
    let message;
    try {
      message = parseShapeFinderClientMessage(
        JSON.parse(rawMessage.toString()),
      );
    } catch (error) {
      send({
        type: "run_error",
        requestId: activeRequestId || "unknown",
        phase: "startup",
        message: getErrorMessage(error),
      });
      return;
    }

    if (message.type === "rpc_result") {
      const pending = pendingRpc.get(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      pendingRpc.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (activeRequestId) {
      send({
        type: "run_error",
        requestId: message.requestId,
        phase: "startup",
        message: "A Shape Finder run is already in progress.",
      });
      return;
    }

    void runShapeFinder(message.requestId, message.image);
  });

  socket.on("close", () => {
    for (const pending of pendingRpc.values()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new Error("Browser disconnected during Shape Finder run."),
      );
    }
    pendingRpc.clear();
    if (activeRun?.supports("cancel")) {
      void activeRun.cancel();
    }
  });

  send({ type: "ready" });
};

const server = new WebSocketServer({
  host: "127.0.0.1",
  port,
  maxPayload: 16 * 1024 * 1024,
  verifyClient: ({ origin }, done) => {
    if (isAllowedOrigin(origin)) {
      done(true);
    } else {
      done(false, 403, "Origin not allowed");
    }
  },
});

server.on("connection", handleConnection);
server.on("listening", () => {
  console.info(`Shape Finder agent listening on ws://127.0.0.1:${port}`);
});
server.on("error", (error) => {
  console.error(`Shape Finder agent failed: ${getErrorMessage(error)}`);
});
