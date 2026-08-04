import { describe, expect, it } from "vitest";

import {
  SHAPE_FINDER_MAX_DESCRIPTION_LENGTH,
  SHAPE_FINDER_MAX_IMAGE_BYTES,
  classifyShapeFinderOutcome,
  parseShapeFinderClientMessage,
  parseShapeFinderServerMessage,
} from "./protocol";

describe("Shape Finder bridge protocol", () => {
  it("accepts image, description, and RPC responses", () => {
    expect(
      parseShapeFinderClientMessage({
        type: "find",
        requestId: "request-1",
        input: {
          type: "image",
          data: "cG5n",
          mimeType: "image/png",
        },
      }),
    ).toMatchObject({ type: "find", requestId: "request-1" });

    expect(
      parseShapeFinderClientMessage({
        type: "find",
        requestId: "request-2",
        input: {
          type: "description",
          text: "the orange oval near the top",
        },
      }),
    ).toMatchObject({
      type: "find",
      input: { type: "description" },
    });

    expect(
      parseShapeFinderClientMessage({
        type: "rpc_result",
        id: "rpc-1",
        result: { elementId: "shape-06" },
      }),
    ).toMatchObject({ type: "rpc_result", id: "rpc-1" });
  });

  it("rejects non-PNG and oversized references", () => {
    expect(() =>
      parseShapeFinderClientMessage({
        type: "find",
        requestId: "request-1",
        input: { type: "image", data: "data", mimeType: "image/jpeg" },
      }),
    ).toThrow("PNG images only");

    expect(() =>
      parseShapeFinderClientMessage({
        type: "find",
        requestId: "request-1",
        input: {
          type: "image",
          data: "a".repeat(
            Math.ceil((SHAPE_FINDER_MAX_IMAGE_BYTES * 4) / 3) + 1,
          ),
          mimeType: "image/png",
        },
      }),
    ).toThrow("5 MB or smaller");
  });

  it("rejects empty and oversized descriptions", () => {
    expect(() =>
      parseShapeFinderClientMessage({
        type: "find",
        requestId: "request-1",
        input: { type: "description", text: "   " },
      }),
    ).toThrow("between 1 and 500 characters");

    expect(() =>
      parseShapeFinderClientMessage({
        type: "find",
        requestId: "request-1",
        input: {
          type: "description",
          text: "a".repeat(SHAPE_FINDER_MAX_DESCRIPTION_LENGTH + 1),
        },
      }),
    ).toThrow("between 1 and 500 characters");
  });

  it("validates browser RPC requests before execution", () => {
    expect(
      parseShapeFinderServerMessage({
        type: "rpc_request",
        id: "rpc-1",
        method: "focus_element",
        params: { elementId: "shape-06" },
      }),
    ).toMatchObject({ method: "focus_element" });

    expect(() =>
      parseShapeFinderServerMessage({
        type: "rpc_request",
        id: "rpc-1",
        method: "delete_scene",
        params: {},
      }),
    ).toThrow("Invalid Shape Finder RPC request");
  });

  it("classifies found, no-match, and ambiguous terminal states", () => {
    expect(classifyShapeFinderOutcome("shape-06", "Finished")).toBe("found");
    expect(classifyShapeFinderOutcome(undefined, "NO_MATCH: none")).toBe(
      "no_match",
    );
    expect(
      classifyShapeFinderOutcome(
        undefined,
        "AMBIGUOUS: multiple candidates match",
      ),
    ).toBe("ambiguous");
  });
});
