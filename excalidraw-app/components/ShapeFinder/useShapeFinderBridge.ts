import { useCallback, useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  SHAPE_FINDER_MAX_IMAGE_BYTES,
  SHAPE_FINDER_PORT,
  parseShapeFinderServerMessage,
  type ShapeFinderClientMessage,
  type ShapeFinderOutcome,
  type ShapeFinderTimelineStatus,
  type ShapeFinderTimelineStep,
} from "../../shape-finder-agent/protocol";

import { focusElement, getElementThumbnails } from "./canvasTools";

export type ShapeFinderConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected";

export type ShapeFinderTimelineItem = {
  step: ShapeFinderTimelineStep;
  label: string;
  status: ShapeFinderTimelineStatus;
  detail?: string;
};

export type ShapeFinderResult = {
  outcome: ShapeFinderOutcome;
  elementId?: string;
  message: string;
};

export type ShapeFinderRunError = {
  phase: "startup" | "run";
  message: string;
};

const createTimeline = (): ShapeFinderTimelineItem[] => [
  {
    step: "received",
    label: "Received reference PNG",
    status: "pending",
  },
  {
    step: "rendered",
    label: "Rendered element thumbnails",
    status: "pending",
  },
  {
    step: "compared",
    label: "Compared visual candidates",
    status: "pending",
  },
  {
    step: "focused",
    label: "Focused matching element",
    status: "pending",
  },
];

const getBridgeUrl = () => {
  const configuredUrl =
    import.meta.env.VITE_APP_SHAPE_FINDER_URL ||
    `http://${window.location.hostname}:${SHAPE_FINDER_PORT}`;
  const url = new URL(configuredUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Could not read the reference PNG."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read the reference PNG."));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });

export const useShapeFinderBridge = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
) => {
  const [connectionStatus, setConnectionStatus] =
    useState<ShapeFinderConnectionStatus>("connecting");
  const [timeline, setTimeline] = useState(createTimeline);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<ShapeFinderResult | null>(null);
  const [runError, setRunError] = useState<ShapeFinderRunError | null>(null);
  const [assistantText, setAssistantText] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const apiRef = useRef(excalidrawAPI);
  const activeRequestIdRef = useRef<string | null>(null);

  apiRef.current = excalidrawAPI;

  const send = useCallback((message: ShapeFinderClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Shape Finder agent is not connected.");
    }
    socket.send(JSON.stringify(message));
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      setConnectionStatus("connecting");
      const socket = new WebSocket(getBridgeUrl());
      socketRef.current = socket;

      socket.addEventListener("message", async (event) => {
        let message;
        try {
          message = parseShapeFinderServerMessage(JSON.parse(event.data));
        } catch {
          setRunError({
            phase: "run",
            message: "Shape Finder received an invalid agent response.",
          });
          setIsRunning(false);
          return;
        }

        if (message.type === "ready") {
          setConnectionStatus("connected");
          return;
        }

        if (message.type === "rpc_request") {
          try {
            const api = apiRef.current;
            if (!api) {
              throw new Error("Excalidraw is not ready.");
            }

            const rpcResult =
              message.method === "get_element_thumbnails"
                ? await getElementThumbnails(api)
                : focusElement(api, String(message.params.elementId || ""));
            send({
              type: "rpc_result",
              id: message.id,
              result: rpcResult,
            });
          } catch (error) {
            send({
              type: "rpc_result",
              id: message.id,
              error:
                error instanceof Error
                  ? error.message
                  : "Canvas tool failed unexpectedly.",
            });
          }
          return;
        }

        if (message.type === "timeline") {
          setTimeline((items) =>
            items.map((item) =>
              item.step === message.step
                ? {
                    ...item,
                    status: message.status,
                    detail: message.detail,
                  }
                : item,
            ),
          );
          return;
        }

        if (message.type === "assistant_text") {
          setAssistantText(message.text);
          return;
        }

        if (message.type === "run_result") {
          if (message.requestId !== activeRequestIdRef.current) {
            return;
          }
          setResult({
            outcome: message.outcome,
            elementId: message.elementId,
            message: message.message,
          });
          setIsRunning(false);
          activeRequestIdRef.current = null;
          return;
        }

        if (message.type === "run_error") {
          if (
            message.requestId !== "unknown" &&
            message.requestId !== activeRequestIdRef.current
          ) {
            return;
          }
          setRunError({
            phase: message.phase,
            message: message.message,
          });
          setIsRunning(false);
          activeRequestIdRef.current = null;
        }
      });

      socket.addEventListener("close", () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        if (disposed) {
          return;
        }
        setConnectionStatus("disconnected");
        if (activeRequestIdRef.current) {
          setRunError({
            phase: "run",
            message: "Shape Finder agent disconnected during the run.",
          });
          setIsRunning(false);
          activeRequestIdRef.current = null;
        }
        reconnectTimeout = setTimeout(connect, 1_500);
      });

      socket.addEventListener("error", () => {
        setConnectionStatus("disconnected");
      });
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [send]);

  const startSearch = useCallback(
    async (file: File) => {
      setResult(null);
      setRunError(null);
      setAssistantText("");
      setTimeline(createTimeline());

      if (file.type !== "image/png") {
        setRunError({
          phase: "startup",
          message: "Shape Finder accepts PNG files only.",
        });
        return;
      }
      if (file.size > SHAPE_FINDER_MAX_IMAGE_BYTES) {
        setRunError({
          phase: "startup",
          message: "Reference PNG must be 5 MB or smaller.",
        });
        return;
      }
      if (connectionStatus !== "connected") {
        setRunError({
          phase: "startup",
          message:
            "Start `yarn start:shape-finder-agent` and wait for the agent to connect.",
        });
        return;
      }

      const requestId = crypto.randomUUID();
      activeRequestIdRef.current = requestId;
      setIsRunning(true);

      try {
        send({
          type: "find",
          requestId,
          image: {
            data: await fileToBase64(file),
            mimeType: "image/png",
          },
        });
      } catch (error) {
        activeRequestIdRef.current = null;
        setIsRunning(false);
        setRunError({
          phase: "startup",
          message:
            error instanceof Error
              ? error.message
              : "Could not start Shape Finder.",
        });
      }
    },
    [connectionStatus, send],
  );

  const resetRun = useCallback(() => {
    if (isRunning) {
      return;
    }
    setTimeline(createTimeline());
    setResult(null);
    setRunError(null);
    setAssistantText("");
  }, [isRunning]);

  return {
    connectionStatus,
    timeline,
    isRunning,
    result,
    runError,
    assistantText,
    startSearch,
    resetRun,
  };
};
