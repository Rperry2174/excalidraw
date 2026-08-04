import { ROUNDNESS } from "@excalidraw/common";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const TARGET_GROUP_ID = "shape-finder-target";
const TARGET_STROKE_COLOR = "#1e6f9f";

const commonShapeProperties = {
  backgroundColor: "transparent",
  fillStyle: "solid" as const,
  opacity: 100,
  roughness: 0,
  strokeStyle: "solid" as const,
  strokeWidth: 3 as const,
};

const demoSceneSkeleton: ExcalidrawElementSkeleton[] = [
  {
    ...commonShapeProperties,
    type: "rectangle",
    id: "shape-01",
    x: 100,
    y: 100,
    width: 170,
    height: 110,
    strokeColor: "#845ef7",
  },
  {
    ...commonShapeProperties,
    type: "ellipse",
    id: "shape-02",
    x: 380,
    y: 100,
    width: 160,
    height: 110,
    strokeColor: "#f08c00",
  },
  {
    ...commonShapeProperties,
    type: "diamond",
    id: "shape-03",
    x: 650,
    y: 90,
    width: 140,
    height: 140,
    strokeColor: "#2f9e44",
  },
  {
    ...commonShapeProperties,
    type: "arrow",
    id: "shape-04",
    x: 110,
    y: 400,
    width: 180,
    height: 90,
    strokeColor: "#e03131",
  },
  {
    ...commonShapeProperties,
    type: "rectangle",
    id: "shape-05",
    x: 350,
    y: 405,
    width: 170,
    height: 80,
    roundness: {
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: 40,
    },
    strokeColor: "#6741d9",
  },
  {
    ...commonShapeProperties,
    type: "ellipse",
    id: "shape-06",
    x: 620,
    y: 360,
    width: 176,
    height: 176,
    groupIds: [TARGET_GROUP_ID],
    strokeColor: TARGET_STROKE_COLOR,
    strokeWidth: 4,
  },
  {
    ...commonShapeProperties,
    type: "diamond",
    id: "shape-06-detail",
    x: 656,
    y: 396,
    width: 104,
    height: 104,
    groupIds: [TARGET_GROUP_ID],
    strokeColor: TARGET_STROKE_COLOR,
    strokeWidth: 4,
  },
];

export const createDemoSceneElements = () =>
  convertToExcalidrawElements(demoSceneSkeleton, {
    regenerateIds: false,
  });

export const loadShapeFinderDemoScene = (
  excalidrawAPI: ExcalidrawImperativeAPI,
) => {
  const elements = createDemoSceneElements();
  excalidrawAPI.updateScene({
    elements,
    appState: {
      selectedElementIds: {},
    },
  });
  excalidrawAPI.setViewport({
    target: elements,
    fit: "contain",
    animation: { duration: 300 },
    offsets: { ui: true },
  });
};

export const loadShapeFinderReferenceFile = async () => {
  const response = await fetch("/shape-finder/reference-shape.png");
  if (!response.ok) {
    throw new Error("Could not load the bundled Shape Finder reference PNG.");
  }

  return new File([await response.blob()], "reference-shape.png", {
    type: "image/png",
  });
};
