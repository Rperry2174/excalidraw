import { MIME_TYPES } from "@excalidraw/common";
import { CaptureUpdateAction, useExcalidrawAPI } from "@excalidraw/excalidraw";
import { Button } from "@excalidraw/excalidraw/components/Button";
import { CloseIcon } from "@excalidraw/excalidraw/components/icons";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ShapeFinderBridge,
  SHAPE_FINDER_AGENT_URL,
} from "../shape-finder/bridge";
import { resolveSceneCandidates } from "../shape-finder/candidates";
import { createShapeFinderDemoElements } from "../shape-finder/demoScene";

import "./ShapeFinderTab.scss";

import type {
  FindOutcome,
  RunEvent,
  RunStepId,
  RunStepStatus,
} from "@shape-finder/protocol";

const SAMPLE_REFERENCE_URL = "/shape-finder-reference.png";

type TimelineStep = {
  id: RunStepId;
  label: string;
  hint: string;
};

const TIMELINE_STEPS: TimelineStep[] = [
  {
    id: "reference",
    label: "Received reference PNG",
    hint: "agent.send({ images })",
  },
  {
    id: "thumbnails",
    label: "Rendered element thumbnails",
    hint: "get_element_thumbnails()",
  },
  {
    id: "compare",
    label: "Compared visual candidates",
    hint: "Model vision",
  },
  {
    id: "focus",
    label: "Focused the matching element",
    hint: "focus_element({ candidateId })",
  },
];

type StepState = { status: RunStepStatus; detail?: string };

type Reference = {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  base64: string;
  width: number;
  height: number;
};

type RunPhase = "idle" | "running" | "settled";

type Verdict =
  | { kind: "outcome"; outcome: FindOutcome }
  | { kind: "failure"; phase: "startup" | "run"; message: string };

const readImageSize = (dataUrl: string) =>
  new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = dataUrl;
  });

const toReference = async (file: File): Promise<Reference> => {
  const dataUrl = await getDataURL(file);
  const { width, height } = await readImageSize(dataUrl);

  return {
    fileName: file.name || "reference.png",
    mimeType: file.type || MIME_TYPES.png,
    dataUrl,
    base64: dataUrl.replace(/^data:[^;]+;base64,/, ""),
    width,
    height,
  };
};

const pickImageFile = (items: FileList | DataTransferItemList | null) => {
  if (!items) {
    return null;
  }

  for (let index = 0; index < items.length; index++) {
    const entry = items[index];
    const file = entry instanceof File ? entry : entry.getAsFile();
    if (file?.type.startsWith("image/")) {
      return file;
    }
  }

  return null;
};

/** A step that was still in flight when the run died is the one that broke, so
 * it should read as failed rather than sit spinning forever. */
const markRunningStepsAsFailed = (
  steps: Partial<Record<RunStepId, StepState>>,
) =>
  Object.fromEntries(
    Object.entries(steps).map(([id, state]) => [
      id,
      state.status === "running"
        ? { ...state, status: "error" as const }
        : state,
    ]),
  );

const describeOutcome = (outcome: FindOutcome) => {
  switch (outcome.kind) {
    case "match":
      return `Found 1 match · ${outcome.candidateId} selected and centered`;
    case "no-match":
      return "No matching element on the canvas · nothing was selected";
    case "ambiguous":
      return `Ambiguous match · ${outcome.candidateIds.join(
        ", ",
      )} · nothing was selected`;
  }
};

export const ShapeFinderTab = () => {
  const excalidrawAPI = useExcalidrawAPI();

  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [reference, setReference] = useState<Reference | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [candidateCount, setCandidateCount] = useState(0);
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [steps, setSteps] = useState<Partial<Record<RunStepId, StepState>>>({});
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const excalidrawAPIRef = useRef(excalidrawAPI);
  excalidrawAPIRef.current = excalidrawAPI;

  const bridge = useMemo(
    () => new ShapeFinderBridge(() => excalidrawAPIRef.current),
    [],
  );

  useEffect(() => () => bridge.dispose(), [bridge]);

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    const sync = () =>
      setCandidateCount(
        resolveSceneCandidates(excalidrawAPI.getSceneElements()).length,
      );

    sync();
    return excalidrawAPI.onChange(sync);
  }, [excalidrawAPI]);

  const acceptFile = useCallback(async (file: File | null) => {
    if (!file) {
      return;
    }
    setReference(await toReference(file));
    setSteps({});
    setVerdict(null);
    setPhase("idle");
  }, []);

  // Paste only reaches this listener when focus is inside the panel, so the
  // canvas keeps its own paste behaviour when the user is drawing.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const onPaste = (event: ClipboardEvent) => {
      const file = pickImageFile(event.clipboardData?.items ?? null);
      if (!file) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void acceptFile(file);
    };

    panel.addEventListener("paste", onPaste);
    return () => panel.removeEventListener("paste", onPaste);
  }, [acceptFile]);

  const applyEvent = useCallback((event: RunEvent) => {
    if (event.kind !== "step") {
      return;
    }
    setSteps((current) => ({
      ...current,
      [event.step]: { status: event.status, detail: event.detail },
    }));
  }, []);

  const onFind = useCallback(async () => {
    if (!reference || phase === "running") {
      return;
    }

    setPhase("running");
    setVerdict(null);
    setSteps({ reference: { status: "running" } });

    await bridge.find(
      {
        data: reference.base64,
        mimeType: reference.mimeType,
        fileName: reference.fileName,
      },
      {
        onEvent: applyEvent,
        onFinished: (outcome) => {
          setVerdict({ kind: "outcome", outcome });
          setPhase("settled");
        },
        onFailed: (failurePhase, message) => {
          setSteps(markRunningStepsAsFailed);
          setVerdict({ kind: "failure", phase: failurePhase, message });
          setPhase("settled");
        },
      },
    );
  }, [applyEvent, bridge, phase, reference]);

  const onLoadDemoScene = useCallback(() => {
    if (!excalidrawAPI) {
      return;
    }

    const elements = createShapeFinderDemoElements();

    excalidrawAPI.updateScene({
      elements,
      appState: { selectedElementIds: {}, selectedGroupIds: {} },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    excalidrawAPI.setViewport({
      target: elements,
      fit: "scale-down",
      offsets: { ui: true },
    });
  }, [excalidrawAPI]);

  const onUseSample = useCallback(async () => {
    const response = await fetch(SAMPLE_REFERENCE_URL);
    if (!response.ok) {
      setVerdict({
        kind: "failure",
        phase: "startup",
        message: `Could not load the sample PNG (${response.status}).`,
      });
      setPhase("settled");
      return;
    }
    const blob = await response.blob();
    await acceptFile(
      new File([blob], "reference-shape.png", { type: MIME_TYPES.png }),
    );
  }, [acceptFile]);

  return (
    <div className="shape-finder" ref={panelRef}>
      <div className="shape-finder__intro">
        <h2 className="shape-finder__title">Shape Finder</h2>
        <p className="shape-finder__subtitle">
          <span className="shape-finder__dot" />
          Live canvas · {candidateCount}{" "}
          {candidateCount === 1 ? "element" : "elements"}
        </p>
        <p className="shape-finder__blurb">
          Drop a PNG of a shape and a Cursor SDK agent finds it on the canvas.
        </p>
      </div>

      <div className="shape-finder__setup">
        <button
          type="button"
          className="shape-finder__link"
          onClick={onLoadDemoScene}
        >
          Load demo scene
        </button>
        <button
          type="button"
          className="shape-finder__link"
          onClick={onUseSample}
        >
          Use sample PNG
        </button>
      </div>

      {reference ? (
        <div className="shape-finder__preview">
          <img
            className="shape-finder__thumb"
            src={reference.dataUrl}
            alt="Reference shape"
          />
          <div className="shape-finder__meta">
            <div className="shape-finder__filename">{reference.fileName}</div>
            <div className="shape-finder__dimensions">
              {reference.width} × {reference.height} PNG
            </div>
            <button
              type="button"
              className="shape-finder__link"
              onClick={() => fileInputRef.current?.click()}
            >
              Replace image
            </button>
          </div>
          <button
            type="button"
            className="shape-finder__remove"
            aria-label="Remove reference image"
            onClick={() => {
              setReference(null);
              setSteps({});
              setVerdict(null);
              setPhase("idle");
            }}
          >
            {CloseIcon}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`shape-finder__dropzone${
            isDraggingOver ? " shape-finder__dropzone--active" : ""
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsDraggingOver(false);
            void acceptFile(pickImageFile(event.dataTransfer.items));
          }}
        >
          <span className="shape-finder__dropzone-title">
            Drop or paste a PNG
          </span>
          <span className="shape-finder__dropzone-hint">
            A screenshot snippet of one shape works best
          </span>
        </button>
      )}

      <input
        ref={fileInputRef}
        className="shape-finder__file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          void acceptFile(pickImageFile(event.target.files));
          event.target.value = "";
        }}
      />

      <Button
        className="shape-finder__find"
        onSelect={onFind}
        disabled={!reference || phase === "running"}
      >
        {phase === "running" ? "Finding…" : "Find on canvas"}
      </Button>

      {phase !== "idle" && (
        <div className="shape-finder__run">
          <div className="shape-finder__run-title">Live run</div>
          <ol className="shape-finder__timeline">
            {TIMELINE_STEPS.map((step, index) => {
              const state = steps[step.id];
              return (
                <li
                  key={step.id}
                  className={`shape-finder__step shape-finder__step--${
                    state?.status ?? "pending"
                  }`}
                >
                  <span className="shape-finder__step-badge">{index + 1}</span>
                  <span className="shape-finder__step-body">
                    <span className="shape-finder__step-label">
                      {state?.detail ?? step.label}
                    </span>
                    <span className="shape-finder__step-hint">{step.hint}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {verdict?.kind === "outcome" && (
        <div
          className={`shape-finder__verdict shape-finder__verdict--${verdict.outcome.kind}`}
        >
          {describeOutcome(verdict.outcome)}
        </div>
      )}

      {verdict?.kind === "failure" && (
        <div className="shape-finder__verdict shape-finder__verdict--failure">
          <strong>
            {verdict.phase === "startup"
              ? "The run never started"
              : "The run failed"}
          </strong>
          <span>{verdict.message}</span>
          {verdict.phase === "startup" && (
            <span className="shape-finder__verdict-hint">
              Start the agent with <code>yarn shape-finder</code> and make sure
              it is listening on {SHAPE_FINDER_AGENT_URL}.
            </span>
          )}
        </div>
      )}
    </div>
  );
};
