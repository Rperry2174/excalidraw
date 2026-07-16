import { Agent } from "@cursor/sdk";

import type {
  SDKAgent,
  SDKCustomTool,
  SDKMessage,
  RunResult,
} from "@cursor/sdk";

export type ShapeFinderSdkRun = {
  stream(): AsyncGenerator<SDKMessage, void>;
  wait(): Promise<RunResult>;
};

export type ShapeFinderSdkAgent = {
  send(input: {
    text: string;
    images: Array<{ data: string; mimeType: "image/png" }>;
  }): Promise<ShapeFinderSdkRun>;
  [Symbol.asyncDispose](): Promise<void>;
};

export type ShapeFinderAgentFactory = (
  customTools: Record<string, SDKCustomTool>,
) => Promise<ShapeFinderSdkAgent>;

export const createShapeFinderAgentFactory =
  ({ apiKey, cwd }: { apiKey: string; cwd: string }): ShapeFinderAgentFactory =>
  async (customTools) =>
    Agent.create({
      apiKey,
      model: { id: "composer-2.5" },
      local: {
        cwd,
        sandboxOptions: { enabled: true },
        customTools,
      },
    }) as Promise<SDKAgent>;
