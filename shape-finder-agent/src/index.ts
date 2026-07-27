import { WebSocketServer } from "ws";

import { config } from "./config.js";
import { ShapeFinderSession } from "./session.js";

if (!config.apiKey) {
  console.error(
    "CURSOR_API_KEY is not set. Add it to the repository-root .env file (see .env.example).",
  );
  process.exit(1);
}

const server = new WebSocketServer({ host: config.host, port: config.port });

server.on("listening", () => {
  console.log(
    `Shape Finder agent listening on ws://${config.host}:${config.port} (model: ${config.model})`,
  );
});

server.on("connection", (socket) => {
  console.log("Shape Finder sidebar connected.");
  const session = new ShapeFinderSession(socket);
  socket.on("close", () => console.log("Shape Finder sidebar disconnected."));
  socket.on("error", (error) => {
    console.error("Socket error:", error.message);
    void session.dispose();
  });
});

server.on("error", (error) => {
  console.error("Shape Finder agent failed:", error.message);
  process.exit(1);
});
