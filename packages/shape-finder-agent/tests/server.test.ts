import {
  SHAPE_FINDER_HEALTH_PATH,
  SHAPE_FINDER_RUNS_PATH,
  SHAPE_FINDER_WS_PATH,
} from "@excalidraw/shape-finder-protocol";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { createShapeFinderServer } from "../src/server.js";

import type { SDKCustomTool, SDKMessage, RunResult } from "@cursor/sdk";

import type {
  ShapeFinderAgentFactory,
  ShapeFinderSdkAgent,
} from "../src/agent.js";

const pngRequest = (sessionId: string) => ({
  sessionId,
  image: {
    data: "iVBORw0KGgo=",
    mimeType: "image/png" as const,
    filename: "reference.png",
    width: 128,
    height: 128,
  },
});

const connectBrowser = async (baseUrl: string) => {
  const messages: Array<Record<string, any>> = [];
  const socket = new WebSocket(
    baseUrl.replace("http:", "ws:") + SHAPE_FINDER_WS_PATH,
  );
  const sessionIdPromise = new Promise<string>((resolve) => {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      messages.push(message);
      if (message.type === "session") {
        resolve(message.sessionId);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  const sessionId = await sessionIdPromise;
  return { socket, sessionId, messages };
};

const createFakeAgentFactory =
  ({
    outcome = "found",
    onWait,
    onDispose,
  }: {
    outcome?: "found" | "not_found";
    onWait?: () => void;
    onDispose?: () => void;
  } = {}): ShapeFinderAgentFactory =>
  async (tools: Record<string, SDKCustomTool>) =>
    ({
      async send() {
        return {
          async *stream() {
            await tools.get_element_thumbnails.execute({}, {});
            if (outcome === "found") {
              await tools.focus_element.execute({ elementId: "shape-06" }, {});
            }
            yield {
              type: "assistant",
              agent_id: "agent-test",
              run_id: "run-test",
              message: {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text:
                      outcome === "found"
                        ? '{"status":"found","elementId":"shape-06","message":"Found 1 match"}'
                        : '{"status":"not_found","message":"No matching element found"}',
                  },
                ],
              },
            } as SDKMessage;
          },
          async wait() {
            onWait?.();
            return {
              status: "finished",
              result:
                outcome === "found"
                  ? '{"status":"found","elementId":"shape-06","message":"Found 1 match"}'
                  : '{"status":"not_found","message":"No matching element found"}',
            } as RunResult;
          },
        };
      },
      async [Symbol.asyncDispose]() {
        onDispose?.();
      },
    } as ShapeFinderSdkAgent);

describe("Shape Finder agent server", () => {
  it("reports SDK readiness and rejects invalid runs", async () => {
    const server = createShapeFinderServer({
      createAgent: createFakeAgentFactory(),
    });
    const address = await server.listen(0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const health = await fetch(baseUrl + SHAPE_FINDER_HEALTH_PATH);
    expect(await health.json()).toMatchObject({
      status: "ok",
      sdkReady: true,
      activeSessions: 0,
    });

    const invalid = await fetch(baseUrl + SHAPE_FINDER_RUNS_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(invalid.status).toBe(400);

    await server.close();
  });

  it("correlates browser tools and completes a found run", async () => {
    let waitCalls = 0;
    let disposeCalls = 0;
    const server = createShapeFinderServer({
      createAgent: createFakeAgentFactory({
        onWait: () => waitCalls++,
        onDispose: () => disposeCalls++,
      }),
    });
    const address = await server.listen(0);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const browser = await connectBrowser(baseUrl);

    const resultPromise = new Promise<Record<string, any>>((resolve) => {
      browser.socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "tool_call") {
          browser.socket.send(
            JSON.stringify({
              type: "tool_result",
              callId: message.callId,
              result:
                message.tool === "get_element_thumbnails"
                  ? {
                      tool: "get_element_thumbnails",
                      elements: [
                        {
                          elementId: "shape-06",
                          data: "iVBORw0KGgo=",
                          mimeType: "image/png",
                          width: 128,
                          height: 128,
                        },
                      ],
                    }
                  : {
                      tool: "focus_element",
                      elementId: "shape-06",
                      bounds: [0, 0, 128, 128],
                    },
            }),
          );
        }
        if (message.type === "run_result") {
          resolve(message);
        }
      });
    });

    const response = await fetch(baseUrl + SHAPE_FINDER_RUNS_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pngRequest(browser.sessionId)),
    });
    expect(response.status).toBe(202);

    await expect(resultPromise).resolves.toMatchObject({
      type: "run_result",
      outcome: "found",
      elementId: "shape-06",
    });
    expect(
      browser.messages
        .filter((message) => message.type === "run_event")
        .map((message) => message.event.kind),
    ).toEqual(
      expect.arrayContaining([
        "received",
        "tool_started",
        "tool_completed",
        "comparison_started",
      ]),
    );
    expect(waitCalls).toBe(1);

    browser.socket.close();
    await new Promise((resolve) => browser.socket.once("close", resolve));
    await server.close();
    expect(disposeCalls).toBe(1);
  });

  it("does not request focus for a no-match result", async () => {
    const server = createShapeFinderServer({
      createAgent: createFakeAgentFactory({ outcome: "not_found" }),
    });
    const address = await server.listen(0);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const browser = await connectBrowser(baseUrl);
    let focusCalls = 0;

    const resultPromise = new Promise<Record<string, any>>((resolve) => {
      browser.socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "tool_call") {
          if (message.tool === "focus_element") {
            focusCalls += 1;
          }
          browser.socket.send(
            JSON.stringify({
              type: "tool_result",
              callId: message.callId,
              result: {
                tool: "get_element_thumbnails",
                elements: [
                  {
                    elementId: "shape-01",
                    data: "iVBORw0KGgo=",
                    mimeType: "image/png",
                    width: 64,
                    height: 64,
                  },
                ],
              },
            }),
          );
        }
        if (message.type === "run_result") {
          resolve(message);
        }
      });
    });

    await fetch(baseUrl + SHAPE_FINDER_RUNS_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pngRequest(browser.sessionId)),
    });
    await expect(resultPromise).resolves.toMatchObject({
      outcome: "not_found",
    });
    expect(focusCalls).toBe(0);

    browser.socket.close();
    await new Promise((resolve) => browser.socket.once("close", resolve));
    await server.close();
  });
});
