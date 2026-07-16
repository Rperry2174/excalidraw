import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  ShapeFinderRunEvent,
  ShapeFinderToolName,
} from "@excalidraw/shape-finder-protocol";

import { useShapeFinder } from "./useShapeFinder";

import "./ShapeFinderPanel.scss";

const hasToolEvent = (
  events: ShapeFinderRunEvent[],
  kind: "tool_started" | "tool_completed",
  tool: ShapeFinderToolName,
) =>
  events.some(
    (event) => event.kind === kind && "tool" in event && event.tool === tool,
  );

export const ShapeFinderPanel = ({
  excalidrawAPI,
  apiBaseUrl,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  apiBaseUrl: string;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [elementCount, setElementCount] = useState(
    excalidrawAPI.getSceneElements().length,
  );
  const {
    connection,
    image,
    events,
    status,
    chooseImage,
    removeImage,
    findOnCanvas,
  } = useShapeFinder(excalidrawAPI, apiBaseUrl);

  useEffect(
    () =>
      excalidrawAPI.onChange((elements) => {
        setElementCount(
          elements.filter((element) => !element.isDeleted).length,
        );
      }),
    [excalidrawAPI],
  );

  const latestAssistantText = useMemo(
    () =>
      [...events].reverse().find((event) => event.kind === "assistant_text")
        ?.text,
    [events],
  );
  const thumbnailEvent = events.find(
    (event) =>
      event.kind === "tool_completed" &&
      event.tool === "get_element_thumbnails",
  );
  const received = events.some((event) => event.kind === "received");
  const thumbnailsStarted = hasToolEvent(
    events,
    "tool_started",
    "get_element_thumbnails",
  );
  const thumbnailsComplete = Boolean(thumbnailEvent);
  const comparisonStarted = events.some(
    (event) => event.kind === "comparison_started",
  );
  const focusStarted = hasToolEvent(events, "tool_started", "focus_element");
  const focusComplete = hasToolEvent(events, "tool_completed", "focus_element");
  const terminal =
    status.type === "found" ||
    status.type === "not_found" ||
    status.type === "ambiguous";

  const pickFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      void chooseImage(file);
    }
  };

  return (
    <div className="shape-finder">
      <div className="shape-finder__heading">
        <h2>Shape Finder</h2>
        <div
          className={`shape-finder__connection shape-finder__connection--${connection}`}
        >
          <span aria-hidden="true" />
          {connection === "connected"
            ? `Live canvas · ${elementCount} elements`
            : connection === "connecting"
            ? "Connecting to local agent"
            : "Local agent unavailable"}
        </div>
      </div>

      <div
        className={`shape-finder__dropzone ${
          image ? "shape-finder__dropzone--selected" : ""
        }`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          pickFiles(event.dataTransfer.files);
        }}
        onPaste={(event) => pickFiles(event.clipboardData.files)}
        tabIndex={0}
        role="button"
        aria-label={image ? "Replace reference PNG" : "Choose reference PNG"}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png"
          hidden
          onChange={(event) => {
            pickFiles(event.target.files);
            event.target.value = "";
          }}
        />
        {image ? (
          <>
            <img src={image.previewUrl} alt="Reference shape" />
            <div className="shape-finder__file">
              <strong>{image.filename}</strong>
              <span>
                {image.width} × {image.height} PNG
              </span>
              <button type="button">Replace image</button>
            </div>
          </>
        ) : (
          <div className="shape-finder__empty">
            <span aria-hidden="true">PNG</span>
            <strong>Drop or paste a reference PNG</strong>
            <small>The image stays in this local session.</small>
          </div>
        )}
      </div>

      {image && (
        <button
          type="button"
          className="shape-finder__remove"
          onClick={(event) => {
            event.stopPropagation();
            removeImage();
          }}
          disabled={status.type === "running"}
        >
          Remove image
        </button>
      )}
      <div className="shape-finder__demo-assets">
        Demo assets:
        <a
          href="/shape-finder/shape-finder-demo.excalidraw"
          download="shape-finder-demo.excalidraw"
        >
          scene
        </a>
        <span>·</span>
        <button
          type="button"
          onClick={async () => {
            const response = await fetch("/shape-finder/reference-shape.png");
            if (response.ok) {
              const blob = await response.blob();
              await chooseImage(
                new File([blob], "reference-shape.png", {
                  type: "image/png",
                }),
              );
            }
          }}
        >
          use reference PNG
        </button>
      </div>

      <Button
        className="shape-finder__find"
        onSelect={findOnCanvas}
        disabled={
          !image ||
          connection !== "connected" ||
          status.type === "running" ||
          elementCount === 0
        }
      >
        {status.type === "running" ? "Finding match…" : "Find on canvas"}
      </Button>

      <section className="shape-finder__run" aria-live="polite">
        <h3>Live run</h3>
        <ol>
          <TimelineStep
            number={1}
            label="Received reference PNG"
            detail="agent.send({ images })"
            state={
              received
                ? "complete"
                : status.type === "running"
                ? "active"
                : "idle"
            }
          />
          <TimelineStep
            number={2}
            label={
              thumbnailEvent?.kind === "tool_completed" &&
              thumbnailEvent.elementCount
                ? `Rendered ${thumbnailEvent.elementCount} thumbnails`
                : "Render element thumbnails"
            }
            detail="get_element_thumbnails()"
            state={
              thumbnailsComplete
                ? "complete"
                : thumbnailsStarted
                ? "active"
                : "idle"
            }
          />
          <TimelineStep
            number={3}
            label="Compared visual candidates"
            detail="Model vision"
            state={
              focusStarted || (terminal && comparisonStarted)
                ? "complete"
                : comparisonStarted
                ? "active"
                : "idle"
            }
          />
          <TimelineStep
            number={4}
            label={
              focusComplete
                ? `Focused ${
                    status.type === "found" ? status.elementId : "match"
                  }`
                : terminal && status.type !== "found"
                ? "No canvas mutation"
                : "Focus unique match"
            }
            detail="focus_element({ elementId })"
            state={
              focusComplete
                ? "complete"
                : focusStarted
                ? "active"
                : terminal
                ? "skipped"
                : "idle"
            }
          />
        </ol>
      </section>

      {latestAssistantText && status.type === "running" && (
        <div className="shape-finder__assistant">{latestAssistantText}</div>
      )}

      {status.type !== "idle" && status.type !== "running" && (
        <div
          className={`shape-finder__result shape-finder__result--${status.type}`}
        >
          {status.type === "error" && (
            <strong>
              {status.phase === "startup" ? "Could not start" : "Run failed"}
            </strong>
          )}
          <span>{status.message}</span>
        </div>
      )}
    </div>
  );
};

const TimelineStep = ({
  number,
  label,
  detail,
  state,
}: {
  number: number;
  label: string;
  detail: string;
  state: "idle" | "active" | "complete" | "skipped";
}) => (
  <li className={`shape-finder__step shape-finder__step--${state}`}>
    <span className="shape-finder__step-number">{number}</span>
    <div>
      <strong>{label}</strong>
      <small>{detail}</small>
    </div>
  </li>
);
