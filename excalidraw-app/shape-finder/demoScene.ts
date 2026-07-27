import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";
import type { LocalPoint } from "@excalidraw/math";

/**
 * Candidate id of the element the bundled reference PNG is a crop of. The
 * Shape Finder demo is only meaningful when exactly one candidate matches, so
 * every other shape in the scene differs in both silhouette and color.
 */
export const DEMO_TARGET_CANDIDATE_ID = "shape-06";

const COLUMN_X = [0, 300, 600];
const ROW_Y = [0, 300];

const SHAPE_WIDTH = 200;
const SHAPE_HEIGHT = 140;

const skeletons: ExcalidrawElementSkeleton[] = [
  {
    type: "rectangle",
    id: "shape-01",
    x: COLUMN_X[0],
    y: ROW_Y[0],
    width: SHAPE_WIDTH,
    height: SHAPE_HEIGHT,
    strokeColor: "#1971c2",
    backgroundColor: "#a5d8ff",
    fillStyle: "solid",
    strokeWidth: 2,
    roundness: null,
  },
  {
    type: "ellipse",
    id: "shape-02",
    x: COLUMN_X[1],
    y: ROW_Y[0],
    width: SHAPE_WIDTH,
    height: SHAPE_HEIGHT,
    strokeColor: "#2f9e44",
    backgroundColor: "#b2f2bb",
    fillStyle: "solid",
    strokeWidth: 2,
  },
  {
    type: "diamond",
    id: "shape-03",
    x: COLUMN_X[2],
    y: ROW_Y[0],
    width: SHAPE_WIDTH,
    height: SHAPE_HEIGHT,
    strokeColor: "#f08c00",
    backgroundColor: "#ffec99",
    fillStyle: "solid",
    strokeWidth: 2,
  },
  // `polygon` is absent from the line variant of `ExcalidrawElementSkeleton`
  // even though `convertToExcalidrawElements` forwards it to
  // `newLinearElement`, so the closed triangle has to be cast in.
  {
    type: "line",
    id: "shape-04",
    x: COLUMN_X[0],
    y: ROW_Y[1],
    width: SHAPE_WIDTH,
    height: SHAPE_HEIGHT,
    points: [
      pointFrom<LocalPoint>(0, SHAPE_HEIGHT),
      pointFrom<LocalPoint>(SHAPE_WIDTH / 2, 0),
      pointFrom<LocalPoint>(SHAPE_WIDTH, SHAPE_HEIGHT),
      pointFrom<LocalPoint>(0, SHAPE_HEIGHT),
    ],
    polygon: true,
    strokeColor: "#e03131",
    backgroundColor: "#ffc9c9",
    fillStyle: "solid",
    strokeWidth: 2,
  } as ExcalidrawElementSkeleton,
  {
    type: "rectangle",
    id: "shape-05",
    x: COLUMN_X[1],
    y: ROW_Y[1],
    width: SHAPE_WIDTH,
    height: SHAPE_HEIGHT,
    strokeColor: "#6741d9",
    backgroundColor: "#d0bfff",
    fillStyle: "solid",
    strokeWidth: 2,
    roundness: { type: 3 },
  },
  // The target is a grouped composite (circle enclosing a diamond) so the demo
  // exercises group-aware candidate rendering, not just single elements.
  {
    type: "ellipse",
    id: "shape-06-circle",
    x: COLUMN_X[2] + 20,
    y: ROW_Y[1] - 30,
    width: 200,
    height: 200,
    strokeColor: "#0c8599",
    backgroundColor: "#99e9f2",
    fillStyle: "solid",
    strokeWidth: 2,
    groupIds: [DEMO_TARGET_CANDIDATE_ID],
  },
  {
    type: "diamond",
    id: "shape-06-diamond",
    x: COLUMN_X[2] + 70,
    y: ROW_Y[1] + 20,
    width: 100,
    height: 100,
    strokeColor: "#0c8599",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    groupIds: [DEMO_TARGET_CANDIDATE_ID],
  },
];

export const createShapeFinderDemoElements = () =>
  convertToExcalidrawElements(skeletons, { regenerateIds: false });
