import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";

import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { ImageIcon } from "@excalidraw/excalidraw/components/icons";

import { SHAPE_FINDER_MAX_IMAGE_BYTES } from "../../shape-finder-agent/protocol";
import {
  loadShapeFinderDemoScene,
  loadShapeFinderReferenceFile,
} from "./demoScene";
import { useShapeFinderBridge } from "./useShapeFinderBridge";

import "./ShapeFinderTab.scss";

const getStatusLabel = (status: string) => {
  switch (status) {
    case "completed":
      return "Complete";
    case "running":
      return "In progress";
    case "error":
      return "Failed";
    default:
      return "Pending";
  }
};

export const ShapeFinderTab = () => {
  const excalidrawAPI = useExcalidrawAPI();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const {
    connectionStatus,
    timeline,
    isRunning,
    result,
    runError,
    assistantText,
    startSearch,
    resetRun,
  } = useShapeFinderBridge(excalidrawAPI);

  useEffect(() => {
    if (!referenceFile) {
      setPreviewUrl(null);
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(referenceFile);
    setPreviewUrl(nextPreviewUrl);
    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [referenceFile]);

  const useReferenceFile = useCallback(
    (file: File) => {
      if (file.type !== "image/png") {
        setFileError("Choose a PNG image.");
        return;
      }
      if (file.size > SHAPE_FINDER_MAX_IMAGE_BYTES) {
        setFileError("Choose a PNG no larger than 5 MB.");
        return;
      }

      setReferenceFile(file);
      setFileError(null);
      resetRun();
    },
    [resetRun],
  );

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const png = Array.from(event.clipboardData?.files || []).find(
        (file) => file.type === "image/png",
      );
      if (png) {
        event.preventDefault();
        useReferenceFile(png);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [useReferenceFile]);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      useReferenceFile(file);
    }
  };

  const loadDemo = async () => {
    if (!excalidrawAPI || isRunning) {
      return;
    }
    loadShapeFinderDemoScene(excalidrawAPI);
    useReferenceFile(await loadShapeFinderReferenceFile());
  };

  const removeReference = () => {
    if (isRunning) {
      return;
    }
    setReferenceFile(null);
    setFileError(null);
    resetRun();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const terminalMessage = runError?.message || result?.message;
  const terminalTone = runError
    ? "error"
    : result?.outcome === "found"
    ? "success"
    : result
    ? "warning"
    : null;

  return (
    <section className="shape-finder" aria-label="Shape Finder">
      <div className="shape-finder__intro">
        <div>
          <h2>Shape Finder</h2>
          <p>Drop a PNG to select its visual match on the canvas.</p>
        </div>
        <span
          className={clsx(
            "shape-finder__connection",
            `shape-finder__connection--${connectionStatus}`,
          )}
          title={`Agent ${connectionStatus}`}
        >
          <span aria-hidden="true" />
          {connectionStatus === "connected" ? "Agent ready" : connectionStatus}
        </span>
      </div>

      <input
        ref={fileInputRef}
        className="shape-finder__file-input"
        type="file"
        accept="image/png"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            useReferenceFile(file);
          }
        }}
      />

      {referenceFile && previewUrl ? (
        <div className="shape-finder__preview">
          <img src={previewUrl} alt="Shape Finder reference" />
          <div className="shape-finder__file-details">
            <strong>{referenceFile.name}</strong>
            <span>
              {Math.max(1, Math.round(referenceFile.size / 1024))} KB PNG
            </span>
          </div>
          <div className="shape-finder__file-actions">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isRunning}
            >
              Replace
            </button>
            <button
              type="button"
              onClick={removeReference}
              disabled={isRunning}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div
          className={clsx("shape-finder__dropzone", {
            "shape-finder__dropzone--dragging": isDragging,
          })}
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <span className="shape-finder__dropzone-icon" aria-hidden="true">
            {ImageIcon}
          </span>
          <strong>Drop or paste a PNG</strong>
          <span>Up to 5 MB</span>
        </div>
      )}

      {fileError && (
        <p className="shape-finder__file-error" role="alert">
          {fileError}
        </p>
      )}

      <FilledButton
        fullWidth
        size="large"
        status={isRunning ? "loading" : null}
        disabled={!referenceFile}
        onClick={() => referenceFile && startSearch(referenceFile)}
      >
        Find on canvas
      </FilledButton>

      <FilledButton
        fullWidth
        variant="outlined"
        color="muted"
        disabled={!excalidrawAPI || isRunning}
        onClick={loadDemo}
      >
        Load demo scene
      </FilledButton>

      <div className="shape-finder__run">
        <div className="shape-finder__run-heading">
          <span>Live run</span>
          {isRunning && (
            <span className="shape-finder__streaming">Streaming</span>
          )}
        </div>
        <ol>
          {timeline.map((item) => (
            <li
              key={item.step}
              className={`shape-finder__step shape-finder__step--${item.status}`}
            >
              <span
                className="shape-finder__step-indicator"
                aria-label={getStatusLabel(item.status)}
              />
              <span>
                <strong>{item.label}</strong>
                {item.detail && <small>{item.detail}</small>}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {assistantText && !terminalMessage && (
        <p className="shape-finder__assistant" aria-live="polite">
          {assistantText}
        </p>
      )}

      {terminalMessage && terminalTone && (
        <div
          className={`shape-finder__result shape-finder__result--${terminalTone}`}
          role={terminalTone === "error" ? "alert" : "status"}
        >
          <strong>
            {runError
              ? runError.phase === "startup"
                ? "Could not start"
                : "Run failed"
              : result?.outcome === "found"
              ? "Found 1 match"
              : result?.outcome === "ambiguous"
              ? "Ambiguous match"
              : "No matches"}
          </strong>
          <span>{terminalMessage}</span>
        </div>
      )}
    </section>
  );
};
