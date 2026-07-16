import { useCallback, useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  ShapeFinderOutcome,
  ShapeFinderRunEvent,
  StartShapeFinderRunRequest,
} from "@excalidraw/shape-finder-protocol";

import { ShapeFinderClient } from "./ShapeFinderClient";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ShapeFinderImage = StartShapeFinderRunRequest["image"] & {
  previewUrl: string;
};

export type ShapeFinderStatus =
  | { type: "idle" }
  | { type: "running" }
  | { type: ShapeFinderOutcome; message: string; elementId?: string }
  | {
      type: "error";
      phase: "startup" | "mid_run";
      message: string;
    };

const readPng = async (file: File): Promise<ShapeFinderImage> => {
  if (
    file.type !== "image/png" &&
    !file.name.toLocaleLowerCase().endsWith(".png")
  ) {
    throw new Error("Choose a PNG image");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("PNG images must be smaller than 5 MB");
  }

  const previewUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the PNG"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  const dimensions = await new Promise<{ width: number; height: number }>(
    (resolve, reject) => {
      const image = new Image();
      image.onerror = () => reject(new Error("The PNG could not be decoded"));
      image.onload = () =>
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.src = previewUrl;
    },
  );

  return {
    data: previewUrl.slice(previewUrl.indexOf(",") + 1),
    mimeType: "image/png",
    filename: file.name || "reference.png",
    previewUrl,
    ...dimensions,
  };
};

export const useShapeFinder = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  apiBaseUrl: string,
) => {
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [image, setImage] = useState<ShapeFinderImage | null>(null);
  const [events, setEvents] = useState<ShapeFinderRunEvent[]>([]);
  const [status, setStatus] = useState<ShapeFinderStatus>({ type: "idle" });
  const clientRef = useRef<ShapeFinderClient | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!excalidrawAPI || !apiBaseUrl) {
      setConnection("disconnected");
      return;
    }

    const client = new ShapeFinderClient(apiBaseUrl, excalidrawAPI, {
      onConnectionChange: (nextConnection) => {
        setConnection(nextConnection);
        if (
          nextConnection === "disconnected" &&
          statusRef.current.type === "running"
        ) {
          setStatus({
            type: "error",
            phase: "mid_run",
            message: "The Shape Finder agent disconnected during the run",
          });
        }
      },
      onRunEvent: (_runId, event) => {
        setEvents((current) => [...current, event]);
      },
      onRunResult: (_runId, result) => {
        setStatus({
          type: result.outcome,
          message: result.message,
          elementId: result.elementId,
        });
      },
      onRunError: (_runId, error) => {
        setStatus({
          type: "error",
          phase: error.phase,
          message: error.message,
        });
      },
    });
    clientRef.current = client;
    client.connect();

    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, [apiBaseUrl, excalidrawAPI]);

  const chooseImage = useCallback(async (file: File) => {
    try {
      const nextImage = await readPng(file);
      setImage(nextImage);
      setEvents([]);
      setStatus({ type: "idle" });
    } catch (error) {
      setStatus({
        type: "error",
        phase: "startup",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const removeImage = useCallback(() => {
    setImage(null);
    setEvents([]);
    setStatus({ type: "idle" });
  }, []);

  const findOnCanvas = useCallback(async () => {
    if (!image || !clientRef.current) {
      return;
    }
    setEvents([]);
    setStatus({ type: "running" });
    try {
      await clientRef.current.startRun({
        data: image.data,
        mimeType: image.mimeType,
        filename: image.filename,
        width: image.width,
        height: image.height,
      });
    } catch (error) {
      setStatus({
        type: "error",
        phase: "startup",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [image]);

  return {
    connection,
    image,
    events,
    status,
    chooseImage,
    removeImage,
    findOnCanvas,
  };
};
