import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(packageRoot, "..");

dotenv.config({ path: path.join(repoRoot, ".env") });

/**
 * The agent only ever works through its custom tools, so it is pointed at an
 * empty scratch directory instead of the repo to keep it from wandering into
 * files it has no business reading.
 */
const resolveAgentCwd = () => {
  const cwd = path.join(packageRoot, ".agent-cwd");
  fs.mkdirSync(cwd, { recursive: true });
  return cwd;
};

export const config = {
  host: process.env.SHAPE_FINDER_HOST ?? "127.0.0.1",
  port: Number(process.env.SHAPE_FINDER_PORT ?? 3010),
  apiKey: process.env.CURSOR_API_KEY ?? "",
  model: process.env.SHAPE_FINDER_MODEL ?? "composer-2.5",
  agentCwd: resolveAgentCwd(),
};
