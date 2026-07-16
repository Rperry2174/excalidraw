import { vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  focusElement,
  getElementThumbnails,
  getShapeFinderCandidates,
} from "./canvasTools";

const mocks = vi.hoisted(() => ({
  exportToCanvas: vi.fn(),
  getElementBounds: vi.fn(() => [10, 20, 110, 120]),
}));

vi.mock("@excalidraw/common", () => ({
  arrayToMap: (elements: Array<{ id: string }>) =>
    new Map(elements.map((element) => [element.id, element])),
}));

vi.mock("@excalidraw/element", () => ({
  getVisibleElements: (elements: Array<{ isDeleted?: boolean }>) =>
    elements.filter((element) => !element.isDeleted),
  getRootElements: (elements: unknown[]) => elements,
  isBoundToContainer: (element: { containerId?: string | null }) =>
    Boolean(element.containerId),
  getBoundTextElement: (
    element: { boundTextId?: string },
    elements: Map<string, unknown>,
  ) => (element.boundTextId ? elements.get(element.boundTextId) : null),
  getElementBounds: mocks.getElementBounds,
}));

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "NEVER" },
  exportToCanvas: mocks.exportToCanvas,
}));

const createApi = () => {
  const elements = [
    {
      id: "shape-01",
      width: 100,
      height: 100,
      isDeleted: false,
      boundTextId: "label-01",
    },
    {
      id: "label-01",
      width: 20,
      height: 10,
      isDeleted: false,
      containerId: "shape-01",
    },
  ];
  return {
    elements,
    api: {
      getSceneElements: vi.fn(() => elements),
      getAppState: vi.fn(() => ({ exportScale: 1 })),
      getFiles: vi.fn(() => ({})),
      updateScene: vi.fn(),
      setViewport: vi.fn(),
    } as unknown as ExcalidrawImperativeAPI,
  };
};

describe("Shape Finder canvas tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders one PNG thumbnail per root candidate with its bound label", async () => {
    const { api } = createApi();
    const canvas = {
      width: 128,
      height: 96,
      toDataURL: () => "data:image/png;base64,thumbnail-data",
    };
    mocks.exportToCanvas.mockResolvedValue(canvas);

    expect(getShapeFinderCandidates(api).map((element) => element.id)).toEqual([
      "shape-01",
    ]);
    await expect(getElementThumbnails(api)).resolves.toEqual({
      tool: "get_element_thumbnails",
      elements: [
        {
          elementId: "shape-01",
          data: "thumbnail-data",
          mimeType: "image/png",
          width: 128,
          height: 96,
        },
      ],
    });
    expect(mocks.exportToCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        elements: expect.arrayContaining([
          expect.objectContaining({ id: "shape-01" }),
          expect.objectContaining({ id: "label-01" }),
        ]),
        maxWidthOrHeight: 192,
      }),
    );
  });

  it("selects and centers a current element without capturing history", () => {
    const { api } = createApi();

    expect(focusElement(api, "shape-01")).toEqual({
      tool: "focus_element",
      elementId: "shape-01",
      bounds: [10, 20, 110, 120],
    });
    expect(api.updateScene).toHaveBeenCalledWith({
      appState: {
        selectedElementIds: { "shape-01": true },
        selectedGroupIds: {},
      },
      captureUpdate: "NEVER",
    });
    expect(api.setViewport).toHaveBeenCalledWith({
      target: "shape-01",
      fit: "scale-down",
      animation: { duration: 300 },
      offsets: { ui: true },
    });
  });

  it("does not mutate the canvas for a stale element ID", () => {
    const { api } = createApi();

    expect(() => focusElement(api, "missing")).toThrow(
      "Element missing no longer exists",
    );
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(api.setViewport).not.toHaveBeenCalled();
  });
});
