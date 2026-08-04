import {
  exportToCanvas,
  getCommonBounds,
} from "@excalidraw/excalidraw";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ShapeFinderThumbnail } from "../../shape-finder-agent/protocol";

const MAX_CANDIDATES = 24;
const THUMBNAIL_SIZE = 256;

type ShapeFinderCandidate = {
  elementId: string;
  elements: NonDeletedExcalidrawElement[];
};

const getCandidateGroupKey = (element: NonDeletedExcalidrawElement) =>
  element.groupIds[0] ? `group:${element.groupIds[0]}` : element.id;

export const getShapeFinderCandidates = (
  elements: readonly NonDeletedExcalidrawElement[],
) => {
  const groupedElements = new Map<string, NonDeletedExcalidrawElement[]>();

  for (const element of elements) {
    const key = getCandidateGroupKey(element);
    const group = groupedElements.get(key);
    if (group) {
      group.push(element);
    } else {
      groupedElements.set(key, [element]);
    }
  }

  return Array.from(groupedElements.values())
    .slice(0, MAX_CANDIDATES)
    .map(
      (candidateElements): ShapeFinderCandidate => ({
        elementId:
          candidateElements.find((element) => /^shape-\d+$/.test(element.id))
            ?.id || candidateElements[0].id,
        elements: candidateElements,
      }),
    );
};

export const getElementThumbnails = async (
  excalidrawAPI: ExcalidrawImperativeAPI,
) => {
  const candidates = getShapeFinderCandidates(
    excalidrawAPI.getSceneElements(),
  );
  const files = excalidrawAPI.getFiles();

  const thumbnails: ShapeFinderThumbnail[] = [];
  for (const candidate of candidates) {
    const canvas = await exportToCanvas({
      elements: candidate.elements,
      files,
      exportPadding: 16,
      maxWidthOrHeight: THUMBNAIL_SIZE,
      appState: {
        exportBackground: true,
        viewBackgroundColor: "#ffffff",
      },
    });
    thumbnails.push({
      elementId: candidate.elementId,
      data: canvas.toDataURL("image/png").split(",")[1],
      mimeType: "image/png",
      width: canvas.width,
      height: canvas.height,
    });
  }

  return { thumbnails };
};

export const focusElement = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  elementId: string,
) => {
  const elements = excalidrawAPI.getSceneElements();
  const target = elements.find((element) => element.id === elementId);
  if (!target) {
    throw new Error(`Canvas element "${elementId}" no longer exists.`);
  }

  const targetGroupIds = new Set(target.groupIds);
  const focusedElements = targetGroupIds.size
    ? elements.filter((element) =>
        element.groupIds.some((groupId) => targetGroupIds.has(groupId)),
      )
    : [target];
  const selectedElementIds = Object.fromEntries(
    focusedElements.map((element) => [element.id, true]),
  );

  excalidrawAPI.updateScene({
    appState: { selectedElementIds },
  });
  excalidrawAPI.setViewport({
    target: focusedElements,
    fit: "scale-down",
    animation: { duration: 300 },
    offsets: { ui: true },
  });

  return {
    elementId,
    bounds: getCommonBounds(focusedElements),
  };
};
