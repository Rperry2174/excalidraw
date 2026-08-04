# Shape Finder agent

The Shape Finder demo uses a local Node service so `CURSOR_API_KEY` never enters the browser bundle.

Requirements:

- Node 22.13 or newer
- `CURSOR_API_KEY` exported in the shell or set in the repository-root `.env`

Run the app and agent in separate terminals:

```bash
yarn start
yarn start:shape-finder-agent
```

The app runs on `http://localhost:3001`. The agent binds to `ws://127.0.0.1:3020` and accepts browser connections only from localhost by default. Set `SHAPE_FINDER_AGENT_PORT` to change the port and `SHAPE_FINDER_ALLOWED_ORIGIN` when a non-localhost development origin is required.
