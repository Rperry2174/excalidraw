export const SHAPE_FINDER_PORT = 3020;
export const SHAPE_FINDER_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ShapeFinderTimelineStep =
  | "received"
  | "rendered"
  | "compared"
  | "focused";

export type ShapeFinderTimelineStatus =
  | "pending"
  | "running"
  | "completed"
  | "error";

export type ShapeFinderOutcome = "found" | "no_match" | "ambiguous";

export type ShapeFinderThumbnail = {
  elementId: string;
  data: string;
  mimeType: "image/png";
  width: number;
  height: number;
};

export type ShapeFinderRpcMethod =
  | "get_element_thumbnails"
  | "focus_element";

export type ShapeFinderClientMessage =
  | {
      type: "find";
      requestId: string;
      image: {
        data: string;
        mimeType: "image/png";
      };
    }
  | {
      type: "rpc_result";
      id: string;
      result?: unknown;
      error?: string;
    };

export type ShapeFinderServerMessage =
  | {
      type: "ready";
    }
  | {
      type: "rpc_request";
      id: string;
      method: ShapeFinderRpcMethod;
      params: Record<string, unknown>;
    }
  | {
      type: "run_started";
      requestId: string;
      runId: string;
    }
  | {
      type: "timeline";
      step: ShapeFinderTimelineStep;
      status: ShapeFinderTimelineStatus;
      detail?: string;
    }
  | {
      type: "assistant_text";
      text: string;
    }
  | {
      type: "tool_activity";
      name: string;
      status: "running" | "completed" | "error";
    }
  | {
      type: "run_result";
      requestId: string;
      outcome: ShapeFinderOutcome;
      elementId?: string;
      message: string;
    }
  | {
      type: "run_error";
      requestId: string;
      phase: "startup" | "run";
      message: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasString = (value: Record<string, unknown>, key: string) =>
  typeof value[key] === "string" && value[key] !== "";

export const parseShapeFinderClientMessage = (
  value: unknown,
): ShapeFinderClientMessage => {
  if (!isRecord(value) || !hasString(value, "type")) {
    throw new Error("Invalid Shape Finder message.");
  }

  if (value.type === "rpc_result") {
    if (!hasString(value, "id")) {
      throw new Error("RPC responses require an id.");
    }
    if (value.error !== undefined && typeof value.error !== "string") {
      throw new Error("RPC response errors must be strings.");
    }
    return value as ShapeFinderClientMessage;
  }

  if (value.type === "find") {
    if (!hasString(value, "requestId") || !isRecord(value.image)) {
      throw new Error("Find requests require a request id and image.");
    }
    if (
      value.image.mimeType !== "image/png" ||
      typeof value.image.data !== "string" ||
      value.image.data === ""
    ) {
      throw new Error("Shape Finder accepts non-empty PNG images only.");
    }
    if (
      Math.ceil((value.image.data.length * 3) / 4) >
      SHAPE_FINDER_MAX_IMAGE_BYTES
    ) {
      throw new Error("Reference PNG must be 5 MB or smaller.");
    }
    return value as ShapeFinderClientMessage;
  }

  throw new Error("Unsupported Shape Finder message type.");
};

export const parseShapeFinderServerMessage = (
  value: unknown,
): ShapeFinderServerMessage => {
  if (!isRecord(value) || !hasString(value, "type")) {
    throw new Error("Invalid Shape Finder server message.");
  }

  switch (value.type) {
    case "ready":
    case "run_started":
    case "timeline":
    case "assistant_text":
    case "tool_activity":
    case "run_result":
    case "run_error":
      return value as ShapeFinderServerMessage;
    case "rpc_request":
      if (
        !hasString(value, "id") ||
        (value.method !== "get_element_thumbnails" &&
          value.method !== "focus_element") ||
        !isRecord(value.params)
      ) {
        throw new Error("Invalid Shape Finder RPC request.");
      }
      return value as ShapeFinderServerMessage;
    default:
      throw new Error("Unsupported Shape Finder server message type.");
  }
};
