import { MIME_TYPES } from "@excalidraw/common";
import {
  getCommonBounds,
  makeNextSelectedElementIds,
  selectGroup,
} from "@excalidraw/element";
import { CaptureUpdateAction, exportToCanvas } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { findSceneCandidate, resolveSceneCandidates } from "./candidates";

import type {
  FocusElementResult,
  GetElementThumbnailsResult,
} from "@shape-finder/protocol";

/** Large enough for the model to tell the shapes apart, small enough to keep
 * the tool payload well under the message size the agent will accept. */
const THUMBNAIL_MAX_DIMENSION = 256;

const THUMBNAIL_PADDING = 12;

const FOCUS_ANIMATION_DURATION = 300;

const DATA_URL_PREFIX_PATTERN = /^data:[^;]+;base64,/;

const toBase64 = (dataUrl: string) =>
  dataUrl.replace(DATA_URL_PREFIX_PATTERN, "");

/**
 * Renders every candidate on the canvas as its own PNG. The tool deliberately
 * does no matching itself — it only hands the model reliable images paired with
 * the ids it needs to call {@link focusElement}.
 */
export const getElementThumbnails = async (
  api: ExcalidrawImperativeAPI,
): Promise<GetElementThumbnailsResult> => {
  const appState = api.getAppState();
  const files = api.getFiles();
  const candidates = resolveSceneCandidates(api.getSceneElements());

  const thumbnails = await Promise.all(
    candidates.map(async (candidate) => {
      const canvas = await exportToCanvas({
        elements: candidate.elements,
        appState: {
          ...appState,
          exportBackground: true,
          exportScale: 1,
          viewBackgroundColor: appState.viewBackgroundColor,
        },
        files,
        exportPadding: THUMBNAIL_PADDING,
        maxWidthOrHeight: THUMBNAIL_MAX_DIMENSION,
      });

      return {
        candidateId: candidate.candidateId,
        data: toBase64(canvas.toDataURL(MIME_TYPES.png)),
        mimeType: MIME_TYPES.png,
        width: canvas.width,
        height: canvas.height,
        elementIds: candidate.elements.map((element) => element.id),
      };
    }),
  );

  return { candidates: thumbnails };
};

/**
 * Selects and centers a candidate. Only `appState` is touched, so the focused
 * shape keeps its geometry and style exactly as the user drew it.
 */
export const focusElement = (
  api: ExcalidrawImperativeAPI,
  candidateId: string,
): FocusElementResult => {
  const elements = api.getSceneElements();
  const candidate = findSceneCandidate(elements, candidateId);

  if (!candidate) {
    throw new Error(
      `No candidate with id "${candidateId}" exists on the canvas.`,
    );
  }

  const appState = api.getAppState();
  // Candidate ids are outermost group ids when the element is grouped, even if
  // the group currently has a single member — so selection must use element ids
  // whenever there is only one member (selectGroup also refuses <2 members).
  const isGroup = candidate.elements.length > 1;

  const selection = isGroup
    ? selectGroup(
        candidateId,
        { ...appState, selectedGroupIds: {}, selectedElementIds: {} },
        elements,
      )
    : {
        selectedElementIds: makeNextSelectedElementIds(
          { [candidate.elements[0].id]: true },
          appState,
        ),
        selectedGroupIds: {},
        editingGroupId: null,
      };

  api.updateScene({
    appState: selection,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  api.setViewport({
    target: candidate.elements,
    fit: "scale-down",
    animation: { duration: FOCUS_ANIMATION_DURATION },
    // selecting the candidate is what opens the styles panel, so its space has
    // to be reserved here — it is still hidden while these offsets are measured
    offsets: { ui: { reserve: { stylesPanel: true } } },
  });

  const [minX, minY, maxX, maxY] = getCommonBounds(candidate.elements);

  return {
    candidateId,
    elementIds: candidate.elements.map((element) => element.id),
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
};
