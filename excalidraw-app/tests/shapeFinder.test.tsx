import { resolvablePromise } from "@excalidraw/common";
import { Excalidraw } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { act, render } from "@excalidraw/excalidraw/tests/test-utils";

import { parseFindOutcome } from "@shape-finder/protocol";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import {
  resolveSceneCandidates,
  findSceneCandidate,
} from "../shape-finder/candidates";
import { createShapeFinderDemoElements } from "../shape-finder/demoScene";
import { focusElement, getElementThumbnails } from "../shape-finder/tools";

describe("resolveSceneCandidates", () => {
  it("treats an ungrouped element as its own candidate", () => {
    const elements = [
      API.createElement({ type: "rectangle", id: "rect" }),
      API.createElement({ type: "ellipse", id: "ellipse" }),
    ] as NonDeletedExcalidrawElement[];

    expect(
      resolveSceneCandidates(elements).map(
        (candidate) => candidate.candidateId,
      ),
    ).toEqual(["rect", "ellipse"]);
  });

  it("collapses a group into a single candidate keyed by the group id", () => {
    const elements = [
      API.createElement({ type: "ellipse", id: "circle", groupIds: ["combo"] }),
      API.createElement({
        type: "diamond",
        id: "diamond",
        groupIds: ["combo"],
      }),
      API.createElement({ type: "rectangle", id: "loner" }),
    ] as NonDeletedExcalidrawElement[];

    const candidates = resolveSceneCandidates(elements);

    expect(candidates).toHaveLength(2);
    expect(candidates[0].candidateId).toBe("combo");
    expect(candidates[0].elements.map((element) => element.id)).toEqual([
      "circle",
      "diamond",
    ]);
    expect(candidates[1].candidateId).toBe("loner");
  });

  it("keys nested groups by the outermost group", () => {
    const elements = [
      API.createElement({
        type: "rectangle",
        id: "nested",
        groupIds: ["inner", "outer"],
      }),
    ] as NonDeletedExcalidrawElement[];

    expect(resolveSceneCandidates(elements)[0].candidateId).toBe("outer");
  });

  it("ignores deleted elements", () => {
    const elements = [
      API.createElement({ type: "rectangle", id: "kept" }),
      API.createElement({ type: "rectangle", id: "gone", isDeleted: true }),
    ] as NonDeletedExcalidrawElement[];

    expect(resolveSceneCandidates(elements)).toHaveLength(1);
    expect(findSceneCandidate(elements, "gone")).toBeNull();
  });
});

describe("the demo scene", () => {
  it("offers six candidates with a grouped composite as the target", () => {
    const candidates = resolveSceneCandidates(
      createShapeFinderDemoElements() as NonDeletedExcalidrawElement[],
    );

    expect(candidates.map((candidate) => candidate.candidateId)).toEqual([
      "shape-01",
      "shape-02",
      "shape-03",
      "shape-04",
      "shape-05",
      "shape-06",
    ]);
    expect(candidates[5].elements).toHaveLength(2);
  });
});

describe("parseFindOutcome", () => {
  it("reads a match verdict", () => {
    expect(parseFindOutcome("MATCH shape-06")).toEqual({
      kind: "match",
      candidateId: "shape-06",
    });
  });

  it("reads a no-match verdict", () => {
    expect(parseFindOutcome("NO_MATCH")).toEqual({ kind: "no-match" });
  });

  it("reads an ambiguous verdict", () => {
    expect(parseFindOutcome("AMBIGUOUS shape-01, shape-02")).toEqual({
      kind: "ambiguous",
      candidateIds: ["shape-01", "shape-02"],
    });
  });

  it("uses the last verdict line when the model adds prose", () => {
    expect(
      parseFindOutcome("Let me look at the thumbnails.\n\nMATCH shape-03"),
    ).toEqual({ kind: "match", candidateId: "shape-03" });
  });

  it("returns null when there is no verdict to read", () => {
    expect(parseFindOutcome("I could not tell.")).toBeNull();
  });
});

describe("Shape Finder canvas tools", () => {
  let excalidrawAPI: ExcalidrawImperativeAPI;

  beforeEach(async () => {
    const apiPromise = resolvablePromise<ExcalidrawImperativeAPI>();

    await render(
      <Excalidraw onExcalidrawAPI={(api) => apiPromise.resolve(api as any)} />,
    );

    excalidrawAPI = await apiPromise;

    act(() => {
      excalidrawAPI.updateScene({ elements: createShapeFinderDemoElements() });
    });
  });

  it("renders one thumbnail per candidate", async () => {
    const { candidates } = await getElementThumbnails(excalidrawAPI);

    expect(candidates.map((candidate) => candidate.candidateId)).toEqual([
      "shape-01",
      "shape-02",
      "shape-03",
      "shape-04",
      "shape-05",
      "shape-06",
    ]);

    for (const candidate of candidates) {
      expect(candidate.mimeType).toBe("image/png");
      expect(candidate.data).not.toContain("data:");
      expect(candidate.data.length).toBeGreaterThan(0);
    }

    expect(candidates[5].elementIds).toEqual([
      "shape-06-circle",
      "shape-06-diamond",
    ]);
  });

  it("selects and centers a single element without changing it", () => {
    const before = excalidrawAPI
      .getSceneElements()
      .find((element) => element.id === "shape-03")!;

    let result!: ReturnType<typeof focusElement>;
    act(() => {
      result = focusElement(excalidrawAPI, "shape-03");
    });

    expect(result.elementIds).toEqual(["shape-03"]);
    expect(excalidrawAPI.getAppState().selectedElementIds).toEqual({
      "shape-03": true,
    });

    const after = excalidrawAPI
      .getSceneElements()
      .find((element) => element.id === "shape-03")!;

    expect(after.versionNonce).toBe(before.versionNonce);
    expect([after.x, after.y, after.width, after.height]).toEqual([
      before.x,
      before.y,
      before.width,
      before.height,
    ]);
    expect(after.strokeColor).toBe(before.strokeColor);
  });

  it("selects every member of a grouped candidate", () => {
    let result!: ReturnType<typeof focusElement>;
    act(() => {
      result = focusElement(excalidrawAPI, "shape-06");
    });

    expect(result.elementIds).toEqual(["shape-06-circle", "shape-06-diamond"]);
    expect(excalidrawAPI.getAppState().selectedElementIds).toEqual({
      "shape-06-circle": true,
      "shape-06-diamond": true,
    });
    expect(excalidrawAPI.getAppState().selectedGroupIds).toEqual({
      "shape-06": true,
    });
  });

  it("refuses to focus an id that is not on the canvas", () => {
    expect(() => focusElement(excalidrawAPI, "shape-99")).toThrow(
      /No candidate with id "shape-99"/,
    );
    expect(excalidrawAPI.getAppState().selectedElementIds).toEqual({});
  });
});
