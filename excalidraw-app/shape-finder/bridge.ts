import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { DEFAULT_SHAPE_FINDER_AGENT_URL, SHAPE_FINDER_TOOLS } from "./protocol";
import { focusElement, getElementThumbnails } from "./tools";

import type {
  AgentToBrowserMessage,
  BrowserToAgentMessage,
  FindOutcome,
  ReferenceImage,
  RunEvent,
  RunFailurePhase,
} from "./protocol";

export const SHAPE_FINDER_AGENT_URL =
  import.meta.env.VITE_SHAPE_FINDER_AGENT_URL || DEFAULT_SHAPE_FINDER_AGENT_URL;

export type BridgeStatus = "disconnected" | "connecting" | "ready";

export type FindRunHandlers = {
  onEvent: (event: RunEvent) => void;
  onFinished: (outcome: FindOutcome) => void;
  onFailed: (phase: RunFailurePhase, message: string) => void;
};

const CONNECT_TIMEOUT_MS = 5000;

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const createRequestId = () =>
  `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Browser half of the Shape Finder bridge.
 *
 * `@cursor/sdk` is Node-first and holds the API key, so the agent lives in a
 * separate process. This client keeps the socket to it, answers the custom-tool
 * calls it makes against the live scene, and forwards run activity to the UI.
 */
export class ShapeFinderBridge {
  private socket: WebSocket | null = null;

  private connecting: Promise<void> | null = null;

  private activeRun:
    | (FindRunHandlers & { requestId: string; settled: boolean })
    | null = null;

  private statusListeners = new Set<(status: BridgeStatus) => void>();

  private status: BridgeStatus = "disconnected";

  constructor(
    private readonly getApi: () => ExcalidrawImperativeAPI | null,
    private readonly url: string = SHAPE_FINDER_AGENT_URL,
  ) {}

  getStatus() {
    return this.status;
  }

  onStatusChange(listener: (status: BridgeStatus) => void) {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (!this.connecting) {
      this.connecting = this.openSocket().finally(() => {
        this.connecting = null;
      });
    }

    return this.connecting;
  }

  async find(image: ReferenceImage, handlers: FindRunHandlers): Promise<void> {
    try {
      await this.connect();
    } catch (error) {
      handlers.onFailed(
        "startup",
        `Could not reach the Shape Finder agent at ${this.url}. ${describeError(
          error,
        )}`,
      );
      return;
    }

    const requestId = createRequestId();
    this.activeRun = { ...handlers, requestId, settled: false };
    this.send({ type: "find", requestId, image });
  }

  cancel() {
    const run = this.activeRun;
    if (!run || this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.send({ type: "cancel", requestId: run.requestId });
  }

  dispose() {
    this.statusListeners.clear();
    this.activeRun = null;
    this.socket?.close();
    this.socket = null;
    this.status = "disconnected";
  }

  private openSocket() {
    this.setStatus("connecting");

    return new Promise<void>((resolve, reject) => {
      let socket: WebSocket;

      try {
        socket = new WebSocket(this.url);
      } catch (error) {
        this.setStatus("disconnected");
        reject(error);
        return;
      }

      const timeout = window.setTimeout(() => {
        socket.close();
        this.setStatus("disconnected");
        reject(new Error("Timed out while connecting."));
      }, CONNECT_TIMEOUT_MS);

      socket.addEventListener("open", () => {
        window.clearTimeout(timeout);
        this.socket = socket;
        this.setStatus("ready");
        resolve();
      });

      socket.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });

      socket.addEventListener("error", () => {
        window.clearTimeout(timeout);
        this.setStatus("disconnected");
        reject(new Error("The connection failed."));
      });

      socket.addEventListener("close", () => {
        window.clearTimeout(timeout);
        if (this.socket === socket) {
          this.socket = null;
        }
        this.setStatus("disconnected");
        this.failActiveRun(
          "run",
          "The Shape Finder agent closed the connection.",
        );
        reject(new Error("The connection closed."));
      });
    });
  }

  private setStatus(status: BridgeStatus) {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  private send(message: BrowserToAgentMessage) {
    this.socket?.send(JSON.stringify(message));
  }

  private handleMessage(payload: unknown) {
    if (typeof payload !== "string") {
      return;
    }

    let message: AgentToBrowserMessage;
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }

    switch (message.type) {
      case "ready":
        break;
      case "tool-call":
        void this.runTool(message);
        break;
      case "run-event":
        this.activeRun?.onEvent(message.event);
        break;
      case "run-finished": {
        const run = this.takeActiveRun(message.requestId);
        run?.onFinished(message.outcome);
        break;
      }
      case "run-failed": {
        const run = this.takeActiveRun(message.requestId);
        run?.onFailed(message.phase, message.message);
        break;
      }
    }
  }

  private takeActiveRun(requestId: string) {
    const run = this.activeRun;
    if (!run || run.requestId !== requestId || run.settled) {
      return null;
    }
    run.settled = true;
    this.activeRun = null;
    return run;
  }

  private failActiveRun(phase: RunFailurePhase, message: string) {
    const run = this.activeRun;
    if (!run || run.settled) {
      return;
    }
    run.settled = true;
    this.activeRun = null;
    run.onFailed(phase, message);
  }

  private async runTool(
    message: Extract<AgentToBrowserMessage, { type: "tool-call" }>,
  ) {
    const api = this.getApi();

    if (!api) {
      this.send({
        type: "tool-result",
        callId: message.callId,
        ok: false,
        error: "The Excalidraw canvas is not ready.",
      });
      return;
    }

    try {
      if (message.tool === SHAPE_FINDER_TOOLS.getElementThumbnails) {
        this.send({
          type: "tool-result",
          callId: message.callId,
          ok: true,
          value: await getElementThumbnails(api),
        });
        return;
      }

      // `elementId` is accepted as an alias so the tool stays callable with the
      // wording used in the agent prompt and the design mockups.
      const candidateId =
        message.args.candidateId ?? message.args.elementId ?? "";

      if (typeof candidateId !== "string" || !candidateId) {
        throw new Error("`candidateId` is required.");
      }

      this.send({
        type: "tool-result",
        callId: message.callId,
        ok: true,
        value: focusElement(api, candidateId),
      });
    } catch (error) {
      this.send({
        type: "tool-result",
        callId: message.callId,
        ok: false,
        error: describeError(error),
      });
    }
  }
}
