import { Agent } from "@cursor/sdk";

const apiKey = process.env.CURSOR_API_KEY;

if (!apiKey) {
  throw new Error("CURSOR_API_KEY is required");
}

let toolCalled = false;

const agent = await Agent.create({
  apiKey,
  model: { id: "composer-2.5" },
  local: {
    cwd: process.cwd(),
    sandboxOptions: { enabled: true },
    customTools: {
      sdk_smoke_echo: {
        description:
          "Return the supplied value. Use this tool exactly once for the SDK smoke test.",
        inputSchema: {
          type: "object",
          properties: {
            value: { type: "string" },
          },
          required: ["value"],
          additionalProperties: false,
        },
        execute({ value }) {
          toolCalled = true;
          return `SDK_SMOKE_OK:${String(value)}`;
        },
      },
    },
  },
});

try {
  const run = await agent.send(
    "Call sdk_smoke_echo exactly once with the value 'shape-finder'. Do not use any other tool. Then reply with the tool result verbatim.",
  );
  let eventCount = 0;

  for await (const _event of run.stream()) {
    void _event;
    eventCount += 1;
  }

  const result = await run.wait();

  if (result.status !== "finished") {
    throw new Error(
      `SDK smoke run ended with ${result.status}: ${
        result.error?.message ?? "unknown error"
      }`,
    );
  }

  if (!toolCalled || !result.result?.includes("SDK_SMOKE_OK:shape-finder")) {
    throw new Error("SDK smoke tool did not complete as expected");
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      status: result.status,
      customToolCalled: toolCalled,
      streamedEvents: eventCount,
      disposedAfterRun: true,
    }),
  );
} finally {
  await agent[Symbol.asyncDispose]();
}
