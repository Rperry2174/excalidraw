import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  SHAPE_FINDER_HEALTH_PATH,
  SHAPE_FINDER_RUNS_PATH,
  SHAPE_FINDER_WS_PATH,
  isShapeFinderClientMessage,
} from "@excalidraw/shape-finder-protocol";
import { config } from "dotenv";
import { WebSocketServer } from "ws";

import type {
  StartShapeFinderRunRequest,
  StartShapeFinderRunResponse,
} from "@excalidraw/shape-finder-protocol";

import { createShapeFinderAgentFactory } from "./agent.js";

import { ShapeFinderSession } from "./session.js";

import type { ShapeFinderAgentFactory } from "./agent.js";

import type { AddressInfo } from "node:net";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const repoRoot = resolve(import.meta.dirname, "../../..");
const envPath = resolve(repoRoot, ".env");

if (existsSync(envPath)) {
  config({ path: envPath, quiet: true });
}

const writeJson = (
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
) => {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
};

const readJson = async (request: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body exceeds 8 MB");
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};

const isStartRunRequest = (
  value: unknown,
): value is StartShapeFinderRunRequest => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const request = value as Partial<StartShapeFinderRunRequest>;
  const image = request.image;
  return (
    typeof request.sessionId === "string" &&
    !!image &&
    image.mimeType === "image/png" &&
    typeof image.data === "string" &&
    image.data.length > 0 &&
    image.data.length <= MAX_BODY_BYTES &&
    typeof image.filename === "string" &&
    Number.isFinite(image.width) &&
    image.width > 0 &&
    Number.isFinite(image.height) &&
    image.height > 0
  );
};

export const createShapeFinderServer = ({
  apiKey = process.env.CURSOR_API_KEY,
  cwd = repoRoot,
  createAgent = apiKey ? createShapeFinderAgentFactory({ apiKey, cwd }) : null,
}: {
  apiKey?: string;
  cwd?: string;
  createAgent?: ShapeFinderAgentFactory | null;
} = {}) => {
  const sessions = new Map<string, ShapeFinderSession>();
  const webSocketServer = new WebSocketServer({ noServer: true });

  const httpServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === SHAPE_FINDER_HEALTH_PATH) {
      writeJson(response, 200, {
        status: "ok",
        sdkReady: Boolean(createAgent),
        activeSessions: sessions.size,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === SHAPE_FINDER_RUNS_PATH) {
      if (!createAgent) {
        writeJson(response, 503, {
          error: "CURSOR_API_KEY is not configured for the Shape Finder agent",
        });
        return;
      }

      try {
        const body = await readJson(request);
        if (!isStartRunRequest(body)) {
          writeJson(response, 400, { error: "Invalid PNG run request" });
          return;
        }

        const session = sessions.get(body.sessionId);
        if (!session) {
          writeJson(response, 404, { error: "Browser session not found" });
          return;
        }

        const result: StartShapeFinderRunResponse = {
          runId: session.startRun(body.image),
        };
        writeJson(response, 202, result);
      } catch (error) {
        writeJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    writeJson(response, 404, { error: "Not found" });
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== SHAPE_FINDER_WS_PATH || !createAgent) {
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", (socket) => {
    if (!createAgent) {
      socket.close(1011, "Cursor SDK is not configured");
      return;
    }

    const session = new ShapeFinderSession(socket, createAgent);
    sessions.set(session.id, session);
    session.sendSessionReady();

    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as unknown;
        if (isShapeFinderClientMessage(message)) {
          session.handleClientMessage(message);
        }
      } catch {
        socket.send(
          JSON.stringify({
            type: "run_error",
            runId: session.getActiveRunId() ?? randomUUID(),
            phase: "mid_run",
            message: "Invalid browser message",
          }),
        );
      }
    });

    socket.once("close", () => {
      sessions.delete(session.id);
      void session.dispose();
    });
  });

  return {
    httpServer,
    webSocketServer,
    sessions,
    async listen(port = Number(process.env.SHAPE_FINDER_PORT || 3017)) {
      await new Promise<void>((resolveListen, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, "127.0.0.1", () => {
          httpServer.off("error", reject);
          resolveListen();
        });
      });
      return httpServer.address() as AddressInfo;
    },
    async close() {
      await Promise.all(
        [...sessions.values()].map((session) => session.dispose()),
      );
      sessions.clear();
      for (const client of webSocketServer.clients) {
        client.close(1001, "Server shutting down");
      }
      await new Promise<void>((resolveClose) =>
        webSocketServer.close(() => resolveClose()),
      );
      if (httpServer.listening) {
        await new Promise<void>((resolveClose, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolveClose())),
        );
      }
    },
  };
};

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  const server = createShapeFinderServer();
  const address = await server.listen();
  // eslint-disable-next-line no-console
  console.log(
    `Shape Finder agent listening on http://${address.address}:${address.port}`,
  );

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
