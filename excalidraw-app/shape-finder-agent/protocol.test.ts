import { describe, expect, it } from "vitest";

import {
  SHAPE_FINDER_MAX_IMAGE_BYTES,
  classifyShapeFinderOutcome,
  parseShapeFinderClientMessage,
  parseShapeFinderServerMessage,
} from "./protocol";

describe("Shape Finder bridge protocol", () => {
  it("accepts PNG find requests and RPC responses", () => {
    expect(
      parseShapeFinderClientMessage({
        type: "find",
        requestId: "request-1",
        image: { data: "cG5n", mimeType: "image/png" },
      }),
    ).toMatchObject({ type: "find", requestId: "request-1" });

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
        image: { data: "data", mimeType: "image/jpeg" },
      }),
    ).toThrow("PNG images only");

    expect(() =>
      parseShapeFinderClientMessage({
        type: "find",
        requestId: "request-1",
        image: {
          data: "a".repeat(
            Math.ceil((SHAPE_FINDER_MAX_IMAGE_BYTES * 4) / 3) + 1,
          ),
          mimeType: "image/png",
        },
      }),
    ).toThrow("5 MB or smaller");
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
