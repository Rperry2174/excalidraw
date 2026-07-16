export const SHAPE_FINDER_API_PATH = "/api/shape-finder";
export const SHAPE_FINDER_HEALTH_PATH = `${SHAPE_FINDER_API_PATH}/health`;
export const SHAPE_FINDER_RUNS_PATH = `${SHAPE_FINDER_API_PATH}/runs`;
export const SHAPE_FINDER_WS_PATH = `${SHAPE_FINDER_API_PATH}/ws`;

export type ShapeFinderToolName = "get_element_thumbnails" | "focus_element";

export type ShapeFinderOutcome = "found" | "not_found" | "ambiguous";

export type ShapeFinderRunEvent =
  | { kind: "received"; filename: string }
  | { kind: "tool_started"; tool: ShapeFinderToolName }
  | {
      kind: "tool_completed";
      tool: ShapeFinderToolName;
      elementCount?: number;
      elementId?: string;
    }
  | { kind: "comparison_started" }
  | { kind: "assistant_text"; text: string };

export type ShapeFinderThumbnail = {
  elementId: string;
  data: string;
  mimeType: "image/png";
  width: number;
  height: number;
};

export type ShapeFinderToolResult =
  | {
      tool: "get_element_thumbnails";
      elements: ShapeFinderThumbnail[];
    }
  | {
      tool: "focus_element";
      elementId: string;
      bounds: readonly [number, number, number, number];
    };

export type ShapeFinderClientMessage =
  | {
      type: "tool_result";
      callId: string;
      result: ShapeFinderToolResult;
    }
  | {
      type: "tool_error";
      callId: string;
      message: string;
    }
  | { type: "ping" };

export type ShapeFinderServerMessage =
  | { type: "session"; sessionId: string }
  | {
      type: "tool_call";
      runId: string;
      callId: string;
      tool: ShapeFinderToolName;
      args: Record<string, unknown>;
    }
  | {
      type: "run_event";
      runId: string;
      event: ShapeFinderRunEvent;
    }
  | {
      type: "run_result";
      runId: string;
      outcome: ShapeFinderOutcome;
      message: string;
      elementId?: string;
    }
  | {
      type: "run_error";
      runId: string;
      phase: "startup" | "mid_run";
      message: string;
    }
  | { type: "pong" };

export type StartShapeFinderRunRequest = {
  sessionId: string;
  image: {
    data: string;
    mimeType: "image/png";
    filename: string;
    width: number;
    height: number;
  };
};

export type StartShapeFinderRunResponse = { runId: string };

export const isShapeFinderClientMessage = (
  value: unknown,
): value is ShapeFinderClientMessage => {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }

  const type = (value as { type?: unknown }).type;
  if (type === "ping") {
    return true;
  }

  return (
    (type === "tool_result" || type === "tool_error") &&
    "callId" in value &&
    typeof (value as { callId?: unknown }).callId === "string"
  );
};
