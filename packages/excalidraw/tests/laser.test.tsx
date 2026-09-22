import { vi } from "vitest";

import { CURSOR_TYPE, LASER_TRAIL_SIZE } from "@excalidraw/common";
import { getElementAbsoluteCoords } from "@excalidraw/element";

import { Excalidraw } from "../index";
import { getLinkHandleFromCoords } from "../components/hyperlink/helpers";

import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import { act, GlobalTestState, render, waitFor } from "./test-utils";

import type { Collaborator, ExcalidrawProps, SocketId } from "../types";

// the trail is a filled outline, so it renders twice as thick as the
// configured `size` (a radius) — 8px, double the trail this replaces
const EXPECTED_TRAIL_THICKNESS = 8;

const getTrailBounds = () => {
  const d =
    document
      .querySelector<SVGPathElement>(".SVGLayer svg path")
      ?.getAttribute("d") ?? "";
  // `getSvgPathFromStroke` emits the outline as a flat list of x,y pairs
  const coords = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = coords.filter((_, index) => index % 2 === 0);
  const ys = coords.filter((_, index) => index % 2 === 1);

  return {
    width: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
    height: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
  };
};

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

  describe.each(["mouse", "touch", "pen"] as const)(
    "trail thickness (%s)",
    (pointerType) => {
      it(`renders the trail ${EXPECTED_TRAIL_THICKNESS}px thick`, async () => {
        await render(<Excalidraw />);

        act(() => {
          h.app.setActiveTool({ type: "laser" });
        });

        const pointer = new Pointer(pointerType);
        const startX = 100;
        const endX = 300;
        const y = 150;

        pointer.downAt(startX, y);
        for (let x = startX + 10; x <= endX; x += 10) {
          pointer.moveTo(x, y);
        }
        pointer.upAt(endX, y);

        // the trail is painted on animation frames, so wait until the whole
        // stroke (rather than just the initial point) has been rendered
        let bounds = { width: 0, height: 0 };
        await waitFor(() => {
          bounds = getTrailBounds();
          expect(bounds.width).toBeGreaterThan((endX - startX) / 2);
        });

        expect(bounds.height).toBeCloseTo(EXPECTED_TRAIL_THICKNESS, 0);
        expect(LASER_TRAIL_SIZE * 2).toBe(EXPECTED_TRAIL_THICKNESS);
      });
    },
  );

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
