import { vi } from "vitest";

import { CURSOR_TYPE, LASER_TRAIL_SIZE } from "@excalidraw/common";
import { getElementAbsoluteCoords } from "@excalidraw/element";
import { LaserPointer } from "@excalidraw/laser-pointer";

import { Excalidraw } from "../index";
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

describe("laser trail thickness", () => {
  const h = window.h;

  // trail outline is offset from the stroke centerline by the trail size, so a
  // horizontal stroke spans twice the size across
  const measureTrailWidth = (trail: LaserPointer, size: number) => {
    const ys = trail.getStrokeOutline(size).map(([, y]) => y);

    return Math.max(...ys) - Math.min(...ys);
  };

  const drawTrail = (pointer: Pointer) => {
    act(() => {
      h.app.setActiveTool({ type: "laser" });
    });

    pointer.downAt(100, 100);
    pointer.moveTo(140, 100);
    pointer.moveTo(180, 100);
    pointer.moveTo(220, 100);

    const trail = h.app.laserTrails.localTrail.getCurrentTrail();
    expect(trail).toBeDefined();

    return trail!;
  };

  it("draws the local laser trail at twice the laser-pointer default size", async () => {
    await render(<Excalidraw />);

    const trail = drawTrail(new Pointer("mouse"));

    expect(LASER_TRAIL_SIZE).toBe(LaserPointer.defaults.size * 2);
    expect(trail.options.size).toBe(LASER_TRAIL_SIZE);

    const width = measureTrailWidth(trail, trail.options.size);
    const previousWidth = measureTrailWidth(trail, LaserPointer.defaults.size);

    expect(width / previousWidth).toBeCloseTo(2, 1);
  });

  it.each([
    // trackpads report themselves as "mouse" pointers
    ["mouse"],
    ["touch"],
    ["pen"],
  ] as const)(
    "draws the laser trail at the same size for %s",
    async (pointerType) => {
      await render(<Excalidraw />);

      const trail = drawTrail(new Pointer(pointerType));

      expect(trail.options.size).toBe(LASER_TRAIL_SIZE);
    },
  );

  it("draws remote laser trails at the same size", async () => {
    await render(<Excalidraw />);

    act(() => {
      h.app.updateScene({
        collaborators: new Map<SocketId, Collaborator>([
          [
            "socket-id" as SocketId,
            {
              pointer: { x: 10, y: 10, tool: "laser" },
              button: "down",
            },
          ],
        ]),
      });
    });

    const remoteTrail = document.querySelector(".SVGLayer svg path")!;
    // a single remote point renders as a dot the width of the whole trail
    const ys = [
      ...remoteTrail.getAttribute("d")!.matchAll(/-?[\d.]+,(-?[\d.]+)/g),
    ].map(([, y]) => Number(y));

    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(
      LASER_TRAIL_SIZE * 2,
      0,
    );
  });
});
