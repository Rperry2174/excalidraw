import { arrayToMap } from "@excalidraw/common";
import {
  getBoundTextElement,
  getElementBounds,
  getRootElements,
  getVisibleElements,
  isBoundToContainer,
} from "@excalidraw/element";
import { CaptureUpdateAction, exportToCanvas } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  ShapeFinderThumbnail,
  ShapeFinderToolResult,
} from "@excalidraw/shape-finder-protocol";

const MAX_CANDIDATES = 48;
const THUMBNAIL_SIZE = 192;

export const getShapeFinderCandidates = (
  excalidrawAPI: ExcalidrawImperativeAPI,
) =>
  getRootElements(getVisibleElements(excalidrawAPI.getSceneElements()))
    .filter((element) => !isBoundToContainer(element))
    .slice(0, MAX_CANDIDATES);

export const getElementThumbnails = async (
  excalidrawAPI: ExcalidrawImperativeAPI,
): Promise<ShapeFinderToolResult> => {
  const sceneElements = excalidrawAPI.getSceneElements();
  const elementsMap = arrayToMap(sceneElements);
  const appState = excalidrawAPI.getAppState();
  const elements: ShapeFinderThumbnail[] = [];

  for (const element of getShapeFinderCandidates(excalidrawAPI)) {
    const boundText = getBoundTextElement(element, elementsMap);
    const canvas = await exportToCanvas({
      elements: boundText ? [element, boundText] : [element],
      appState: {
        ...appState,
        exportBackground: false,
        exportScale: 1,
      },
      files: excalidrawAPI.getFiles(),
      exportPadding: 12,
      maxWidthOrHeight: THUMBNAIL_SIZE,
    });
    const dataUrl = canvas.toDataURL("image/png");

    elements.push({
      elementId: element.id,
      data: dataUrl.slice(dataUrl.indexOf(",") + 1),
      mimeType: "image/png",
      width: canvas.width,
      height: canvas.height,
    });
  }

  return { tool: "get_element_thumbnails", elements };
};

export const focusElement = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  elementId: string,
): ShapeFinderToolResult => {
  const elements = excalidrawAPI.getSceneElements();
  const element = elements.find((candidate) => candidate.id === elementId);
  if (!element || element.isDeleted) {
    throw new Error(`Element ${elementId} no longer exists`);
  }

  excalidrawAPI.updateScene({
    appState: {
      selectedElementIds: { [elementId]: true },
      selectedGroupIds: {},
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  excalidrawAPI.setViewport({
    target: elementId,
    fit: "scale-down",
    animation: { duration: 300 },
    offsets: { ui: true },
  });

  return {
    tool: "focus_element",
    elementId,
    bounds: getElementBounds(element, arrayToMap(elements)),
  };
};
