import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { ShapeFinderPanel } from "./ShapeFinderPanel";

const shapeFinderHook = vi.hoisted(() => vi.fn());

vi.mock("./useShapeFinder", () => ({
  useShapeFinder: shapeFinderHook,
}));

const chooseImage = vi.fn();
const removeImage = vi.fn();
const findOnCanvas = vi.fn();

const api = {
  getSceneElements: () =>
    Array.from({ length: 6 }, (_, index) => ({
      id: `shape-0${index + 1}`,
      isDeleted: false,
    })),
  onChange: () => () => undefined,
} as unknown as ExcalidrawImperativeAPI;

describe("ShapeFinderPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shapeFinderHook.mockReturnValue({
      connection: "connected",
      image: {
        data: "png-data",
        mimeType: "image/png",
        filename: "reference-shape.png",
        previewUrl: "data:image/png;base64,png-data",
        width: 128,
        height: 128,
      },
      events: [
        { kind: "received", filename: "reference-shape.png" },
        { kind: "tool_started", tool: "get_element_thumbnails" },
        {
          kind: "tool_completed",
          tool: "get_element_thumbnails",
          elementCount: 6,
        },
        { kind: "comparison_started" },
        { kind: "tool_started", tool: "focus_element" },
        {
          kind: "tool_completed",
          tool: "focus_element",
          elementId: "shape-06",
        },
      ],
      status: {
        type: "found",
        message: "Found 1 match · selected and centered",
        elementId: "shape-06",
      },
      chooseImage,
      removeImage,
      findOnCanvas,
    });
  });

  it("renders the completed visual match timeline", () => {
    render(<ShapeFinderPanel excalidrawAPI={api} apiBaseUrl="/api/test" />);

    expect(screen.getByText("Live canvas · 6 elements")).toBeInTheDocument();
    expect(screen.getByText("Rendered 6 thumbnails")).toBeInTheDocument();
    expect(screen.getByText("Focused shape-06")).toBeInTheDocument();
    expect(
      screen.getByText("Found 1 match · selected and centered"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    expect(removeImage).toHaveBeenCalledTimes(1);
  });

  it("passes a selected PNG to the upload action", () => {
    shapeFinderHook.mockReturnValue({
      ...shapeFinderHook(),
      image: null,
      events: [],
      status: { type: "idle" },
    });
    const { container } = render(
      <ShapeFinderPanel excalidrawAPI={api} apiBaseUrl="/api/test" />,
    );
    const file = new File(["png"], "new-reference.png", {
      type: "image/png",
    });
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, { target: { files: [file] } });
    expect(chooseImage).toHaveBeenCalledWith(file);
  });

  it("shows a non-mutating ambiguous outcome", () => {
    shapeFinderHook.mockReturnValue({
      ...shapeFinderHook(),
      events: [
        { kind: "received", filename: "reference-shape.png" },
        {
          kind: "tool_completed",
          tool: "get_element_thumbnails",
          elementCount: 6,
        },
        { kind: "comparison_started" },
      ],
      status: {
        type: "ambiguous",
        message: "Multiple possible matches found",
      },
    });
    render(<ShapeFinderPanel excalidrawAPI={api} apiBaseUrl="/api/test" />);

    expect(screen.getByText("No canvas mutation")).toBeInTheDocument();
    expect(
      screen.getByText("Multiple possible matches found"),
    ).toBeInTheDocument();
  });
});
