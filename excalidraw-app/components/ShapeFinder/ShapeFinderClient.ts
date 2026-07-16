import type {
  ShapeFinderClientMessage,
  ShapeFinderRunEvent,
  ShapeFinderServerMessage,
  ShapeFinderToolResult,
  StartShapeFinderRunRequest,
  StartShapeFinderRunResponse,
} from "@excalidraw/shape-finder-protocol";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { focusElement, getElementThumbnails } from "./canvasTools";

type ShapeFinderClientCallbacks = {
  onConnectionChange: (
    status: "connecting" | "connected" | "disconnected",
  ) => void;
  onRunEvent: (runId: string, event: ShapeFinderRunEvent) => void;
  onRunResult: (
    runId: string,
    result: Extract<ShapeFinderServerMessage, { type: "run_result" }>,
  ) => void;
  onRunError: (
    runId: string,
    error: Extract<ShapeFinderServerMessage, { type: "run_error" }>,
  ) => void;
};

export class ShapeFinderClient {
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly excalidrawAPI: ExcalidrawImperativeAPI,
    private readonly callbacks: ShapeFinderClientCallbacks,
  ) {}

  public connect() {
    if (this.disposed || this.socket) {
      return;
    }

    this.callbacks.onConnectionChange("connecting");
    const url = new URL(
      `${this.apiBaseUrl.replace(/\/$/, "")}/ws`,
      window.location.href,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ShapeFinderServerMessage;
        void this.handleServerMessage(message);
      } catch {
        // Ignore malformed messages and keep the live session available.
      }
    };
    socket.onclose = () => {
      this.socket = null;
      this.sessionId = null;
      this.callbacks.onConnectionChange("disconnected");
      if (!this.disposed) {
        this.reconnectTimer = setTimeout(() => this.connect(), 1500);
      }
    };
    socket.onerror = () => socket.close();
  }

  public async startRun(image: StartShapeFinderRunRequest["image"]) {
    if (!this.sessionId || this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("Shape Finder agent is not connected");
    }

    const response = await fetch(`${this.apiBaseUrl.replace(/\/$/, "")}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: this.sessionId, image }),
    });
    const body = (await response.json()) as
      | StartShapeFinderRunResponse
      | { error?: string };
    if (!response.ok || !("runId" in body)) {
      throw new Error(
        "error" in body && body.error
          ? body.error
          : "Unable to start Shape Finder",
      );
    }
    return body.runId;
  }

  public dispose() {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close(1000, "Shape Finder panel unmounted");
    this.socket = null;
    this.sessionId = null;
  }

  private async handleServerMessage(message: ShapeFinderServerMessage) {
    switch (message.type) {
      case "session":
        this.sessionId = message.sessionId;
        this.callbacks.onConnectionChange("connected");
        return;
      case "run_event":
        this.callbacks.onRunEvent(message.runId, message.event);
        return;
      case "run_result":
        this.callbacks.onRunResult(message.runId, message);
        return;
      case "run_error":
        this.callbacks.onRunError(message.runId, message);
        return;
      case "tool_call":
        await this.executeToolCall(message);
        break;
      case "pong":
        break;
    }
  }

  private async executeToolCall(
    message: Extract<ShapeFinderServerMessage, { type: "tool_call" }>,
  ) {
    try {
      let result: ShapeFinderToolResult;
      if (message.tool === "get_element_thumbnails") {
        result = await getElementThumbnails(this.excalidrawAPI);
      } else {
        const elementId = message.args.elementId;
        if (typeof elementId !== "string") {
          throw new Error("focus_element requires an elementId");
        }
        result = focusElement(this.excalidrawAPI, elementId);
      }
      this.send({ type: "tool_result", callId: message.callId, result });
    } catch (error) {
      this.send({
        type: "tool_error",
        callId: message.callId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private send(message: ShapeFinderClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}
