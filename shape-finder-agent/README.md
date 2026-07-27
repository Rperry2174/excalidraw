# shape-finder-agent

Local Cursor SDK agent behind the Excalidraw **Shape Finder** sidebar.

`@cursor/sdk` is Node-first and needs `CURSOR_API_KEY`, while `ExcalidrawImperativeAPI` only exists in the browser. This package bridges the two: it owns the agent and the API key, and proxies the agent's custom-tool calls over a localhost WebSocket to the sidebar, which answers them against the live canvas.

## Run it

```bash
# once: put your key in the repository-root .env (see .env.example)
echo 'CURSOR_API_KEY=...' >> ../.env

yarn shape-finder          # from the repo root
yarn start                 # or from this directory
```

The bridge listens on `ws://127.0.0.1:3010`. Point the app at a different address with `VITE_SHAPE_FINDER_AGENT_URL`.

| Variable             | Default        | Purpose                              |
| -------------------- | -------------- | ------------------------------------ |
| `CURSOR_API_KEY`     | —              | Required. Never sent to the browser. |
| `SHAPE_FINDER_PORT`  | `3010`         | Bridge port.                         |
| `SHAPE_FINDER_HOST`  | `127.0.0.1`    | Bridge host.                         |
| `SHAPE_FINDER_MODEL` | `composer-2.5` | Model id passed to `Agent.create`.   |

## How a run works

1. The sidebar sends the reference PNG; the agent forwards it as a multimodal message (`agent.send({ text, images })`).
2. The agent calls `get_element_thumbnails`, which the browser answers by rendering every canvas candidate with `exportToCanvas()`.
3. The model compares the reference against the returned image blocks.
4. On a single match it calls `focus_element`, which the browser answers by selecting the candidate and animating the viewport with `setViewport()`.
5. `run.wait()` always runs, and the final line (`MATCH <id>` / `NO_MATCH` / `AMBIGUOUS …`) is parsed into the outcome the sidebar renders.

The agent runs against an empty scratch directory (`.agent-cwd`) so it cannot wander into repository files; everything it can do to the canvas goes through the two custom tools.
