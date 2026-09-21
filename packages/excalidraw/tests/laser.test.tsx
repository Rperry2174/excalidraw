import { vi } from "vitest";

import { CURSOR_TYPE } from "@excalidraw/common";
import { getElementAbsoluteCoords } from "@excalidraw/element";

import { Excalidraw } from "../index";
import { getNormalizedZoom } from "../scene";
import { getLinkHandleFromCoords } from "../components/hyperlink/helpers";

import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import { act, GlobalTestState, render, waitFor } from "./test-utils";

import type { Collaborator, ExcalidrawProps, SocketId } from "../types";

describe("laser tool interactions", () => {
  const h = window.h;
  const mouse = new Pointer("mouse");

  it("opens links while using the laser tool", async () => {
    const onLinkOpenSpy = vi.fn();
    const onLinkOpen: NonNullable<ExcalidrawProps["onLinkOpen"]> = (
      ...args
    ) => {
      onLinkOpenSpy(...args);
      args[1].preventDefault();
    };
    await render(<Excalidraw onLinkOpen={onLinkOpen} />);

    const linkedRect = API.createElement({
      type: "rectangle",
      x: 20,
      y: 20,
      width: 120,
      height: 90,
    });
    API.setElements([linkedRect]);
    API.updateElement(linkedRect, {
      link: "https://example.com",
    });

    act(() => {
      h.app.setActiveTool({ type: "laser" });
    });

    const elementsMap = h.app.scene.getNonDeletedElementsMap();
    const currentRect = API.getElement(linkedRect);
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(currentRect, elementsMap);
    const [linkX, linkY, linkWidth, linkHeight] = getLinkHandleFromCoords(
      [x1, y1, x2, y2],
      currentRect.angle,
      h.state,
    );
    const iconCenterX = linkX + linkWidth / 2;
    const iconCenterY = linkY + linkHeight / 2;

    mouse.moveTo(iconCenterX, iconCenterY);
    expect(GlobalTestState.interactiveCanvas.style.cursor).toBe(
      CURSOR_TYPE.POINTER,
    );

    mouse.clickAt(iconCenterX, iconCenterY);
    expect(onLinkOpenSpy).toHaveBeenCalledTimes(1);
  });

  it("activates embeddables on center click while using the laser tool", async () => {
    await render(<Excalidraw />);

    const embeddable = API.createElement({
      type: "embeddable",
      x: 40,
      y: 40,
      width: 300,
      height: 180,
    });
    API.setElements([embeddable]);
    API.updateElement(embeddable, {
      link: "https://www.youtube.com/watch?v=gkGMXY0wekg",
    });

    act(() => {
      h.app.setActiveTool({ type: "laser" });
    });

    const handleIframeLikeCenterClickSpy = vi.spyOn(
      h.app as unknown as {
        handleIframeLikeCenterClick: () => void;
      },
      "handleIframeLikeCenterClick",
    );

    const centerX = embeddable.x + embeddable.width / 2;
    const centerY = embeddable.y + embeddable.height / 2;

    mouse.moveTo(centerX, centerY);
    expect(GlobalTestState.interactiveCanvas.style.cursor).toBe(
      CURSOR_TYPE.POINTER,
    );
    mouse.clickAt(centerX, centerY);

    expect(handleIframeLikeCenterClickSpy).toHaveBeenCalled();

    await waitFor(() => {
      expect(h.state.activeEmbeddable?.element.id).toBe(embeddable.id);
      expect(h.state.activeEmbeddable?.state).toBe("active");
    });

    handleIframeLikeCenterClickSpy.mockRestore();
  });

  it("doesn't pan in view mode when laser tool is active", async () => {
    await render(<Excalidraw />);

    API.setAppState({ viewModeEnabled: true });
    act(() => {
      h.app.setActiveTool({ type: "laser" });
    });

    expect(GlobalTestState.interactiveCanvas.style.cursor).toContain("");

    const initialScrollX = h.state.scrollX;
    const initialScrollY = h.state.scrollY;

    mouse.downAt(100, 100);
    mouse.moveTo(180, 160);
    mouse.upAt(180, 160);

    expect(h.state.scrollX).toBe(initialScrollX);
    expect(h.state.scrollY).toBe(initialScrollY);
    expect(GlobalTestState.interactiveCanvas.style.cursor).toContain("");
  });

  it("cleans up remote laser trails when the last collaborator leaves", async () => {
    await render(<Excalidraw />);

    const socketId = "socket-id" as SocketId;
    const collaborators = new Map<SocketId, Collaborator>([
      [
        socketId,
        {
          pointer: {
            x: 10,
            y: 10,
            tool: "laser",
          },
          button: "down",
        },
      ],
    ]);
    const svgLayer = document.querySelector(".SVGLayer svg")!;

    act(() => {
      h.app.updateScene({ collaborators });
    });

    expect(svgLayer.querySelectorAll("path")).toHaveLength(1);

    act(() => {
      h.app.updateScene({ collaborators: new Map() });
    });

    expect(svgLayer.querySelectorAll("path")).toHaveLength(0);
  });
});

describe("laser trail geometry", () => {
  const h = window.h;

  type Sample = [x: number, y: number];

  /** deterministic stand-in for pointing device tremor */
  const makeTremor = (seed: number) => {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return (state / 2147483648) * 2 - 1;
    };
  };

  /**
   * Pointer stream along a gentle curve. `stepPx` stands in for how far the
   * pointer travels between two reported moves (small for a trackpad, larger
   * for a mouse) and `tremorPx` for the device's positional noise.
   */
  const makeStream = ({
    stepPx,
    tremorPx,
    lengthPx,
  }: {
    stepPx: number;
    tremorPx: number;
    lengthPx: number;
  }): Sample[] => {
    const tremor = makeTremor(4242);
    const samples: Sample[] = [];

    for (let d = 0; d <= lengthPx; d += stepPx) {
      samples.push([
        200 + d + tremor() * tremorPx,
        300 + Math.sin(d / 150) * 60 + tremor() * tremorPx,
      ]);
    }

    return samples;
  };

  /** points the trail geometry ends up being built from */
  const replay = (samples: Sample[]): Sample[] => {
    act(() => {
      h.app.laserTrails.startPath(...samples[0]);
      for (const [x, y] of samples.slice(1)) {
        h.app.laserTrails.addPointToPath(x, y);
      }
    });

    return (
      h.app.laserTrails.localTrail
        .getCurrentTrail()
        ?.originalPoints.map(([x, y]): Sample => [x, y]) ?? []
    );
  };

  const gaps = (points: Sample[]) =>
    points
      .slice(1)
      .map(([x, y], i) => Math.hypot(x - points[i][0], y - points[i][1]));

  /** accumulated direction change per pixel travelled */
  const wobble = (points: Sample[]) => {
    let turn = 0;
    let length = 0;

    for (let i = 1; i < points.length - 1; i++) {
      const previous = Math.atan2(
        points[i][1] - points[i - 1][1],
        points[i][0] - points[i - 1][0],
      );
      const next = Math.atan2(
        points[i + 1][1] - points[i][1],
        points[i + 1][0] - points[i][0],
      );

      turn += Math.abs(
        Math.atan2(Math.sin(next - previous), Math.cos(next - previous)),
      );
      length += Math.hypot(
        points[i][0] - points[i - 1][0],
        points[i][1] - points[i - 1][1],
      );
    }

    return turn / length;
  };

  const distanceToPath = ([x, y]: Sample, path: Sample[]) =>
    Math.min(
      ...path.slice(1).map(([bx, by], i) => {
        const [ax, ay] = path[i];
        const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
        const t =
          lengthSquared === 0
            ? 0
            : Math.max(
                0,
                Math.min(
                  1,
                  ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / lengthSquared,
                ),
              );

        return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
      }),
    );

  beforeEach(async () => {
    await render(<Excalidraw />);
    act(() => {
      h.app.setActiveTool({ type: "laser" });
    });
  });

  it("resamples a dense pointer stream onto a minimum spacing", () => {
    const samples = makeStream({ stepPx: 0.8, tremorPx: 0.8, lengthPx: 240 });
    const points = replay(samples);

    expect(samples.length).toBeGreaterThan(250);
    expect(points.length).toBeLessThan(samples.length / 2);
    expect(Math.min(...gaps(points))).toBeGreaterThanOrEqual(2);
  });

  it("keeps every point of a sparse pointer stream", () => {
    const samples = makeStream({ stepPx: 8, tremorPx: 0.2, lengthPx: 240 });
    const points = replay(samples);

    expect(points).toEqual(samples);
  });

  it("holds the trail direction steady when the pointer tremors", () => {
    const dense = makeStream({ stepPx: 0.8, tremorPx: 0.6, lengthPx: 240 });
    const densePoints = replay(dense);

    act(() => {
      h.app.laserTrails.endPath();
    });

    // same path and same tremor, reported at a quarter of the rate
    const sparsePoints = replay(
      makeStream({ stepPx: 3.2, tremorPx: 0.6, lengthPx: 240 }),
    );

    expect(wobble(densePoints)).toBeLessThan(wobble(dense) / 4);
    expect(wobble(densePoints)).toBeLessThan(wobble(sparsePoints) * 2);
  });

  it("scales the minimum spacing with the zoom level", () => {
    const samples = makeStream({ stepPx: 1.2, tremorPx: 0, lengthPx: 60 });

    expect(replay(samples).length).toBeLessThan(samples.length);

    act(() => {
      h.app.laserTrails.endPath();
      API.setAppState({ zoom: { value: getNormalizedZoom(2) } });
    });

    expect(replay(samples)).toEqual(samples);
  });

  it("draws a beam thinner than the laser pointer default", () => {
    const samples: Sample[] = Array.from({ length: 30 }, (_, i) => [
      200 + i * 8,
      300 + i * 4,
    ]);
    const points = replay(samples);
    const trail = h.app.laserTrails.localTrail.getCurrentTrail()!;

    const halfWidth = Math.max(
      ...trail
        .getStrokeOutline(trail.options.size / h.state.zoom.value)
        .map(([x, y]) => distanceToPath([x, y], points)),
    );

    // the laser pointer default would put this at 2
    expect(halfWidth).toBeGreaterThan(1);
    expect(halfWidth).toBeLessThan(1.75);
  });
});
