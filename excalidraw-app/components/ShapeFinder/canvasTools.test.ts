import { describe, expect, it, vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { focusElement, getShapeFinderCandidates } from "./canvasTools";
import { createDemoSceneElements } from "./demoScene";

describe("Shape Finder canvas tools", () => {
  it("groups the demo target into one of six visual candidates", () => {
    const candidates = getShapeFinderCandidates(createDemoSceneElements());

    expect(candidates).toHaveLength(6);
    expect(candidates.at(-1)).toMatchObject({
      elementId: "shape-06",
      elements: [{ id: "shape-06" }, { id: "shape-06-detail" }],
    });
  });

  it("selects and centers the complete matched group", () => {
    const elements = createDemoSceneElements();
    const updateScene = vi.fn();
    const setViewport = vi.fn();
    const api = {
      getSceneElements: () => elements,
      updateScene,
      setViewport,
    } as unknown as ExcalidrawImperativeAPI;

    const result = focusElement(api, "shape-06");

    expect(result.elementId).toBe("shape-06");
    expect(updateScene).toHaveBeenCalledWith({
      appState: {
        selectedElementIds: {
          "shape-06": true,
          "shape-06-detail": true,
        },
      },
    });
    expect(setViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [elements[5], elements[6]],
        fit: "scale-down",
      }),
    );
  });

  it("does not mutate the canvas when the requested element is missing", () => {
    const updateScene = vi.fn();
    const setViewport = vi.fn();
    const api = {
      getSceneElements: () => createDemoSceneElements(),
      updateScene,
      setViewport,
    } as unknown as ExcalidrawImperativeAPI;

    expect(() => focusElement(api, "missing")).toThrow(
      'Canvas element "missing" no longer exists.',
    );
    expect(updateScene).not.toHaveBeenCalled();
    expect(setViewport).not.toHaveBeenCalled();
  });
});
