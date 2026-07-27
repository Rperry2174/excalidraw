# AGENTS.md

## Cursor Cloud specific instructions

Excalidraw is a Yarn (classic, v1) workspaces monorepo. The primary product is the `excalidraw-app` web app (excalidraw.com), which consumes the `packages/*` libraries. Standard commands live in `package.json` and `CLAUDE.md`; only non-obvious caveats are noted here.

### Services

- **`excalidraw-app` (dev server)** — run with `yarn start` from the repo root.
  - It listens on **port 3001** (set via `VITE_APP_PORT` in `.env.development`), not Vite's default 5173.
  - `yarn start` first runs `yarn` (a workspace install) before launching Vite, so it is safe to run even if deps drift.
  - The Vite dev server runs ESLint and TypeScript checkers concurrently (via `vite-plugin-checker`); check the server output for `[ESLint]`/`[TypeScript]` results.
- **`shape-finder-agent` (Cursor SDK bridge)** — run with `yarn shape-finder` from the repo root.
  - Backs the **Shape Finder** sidebar tab; listens on `ws://127.0.0.1:3010`.
  - Requires `CURSOR_API_KEY` in the repository-root `.env` (see `.env.example`). The key is server-side only and must never be exposed through a `VITE_`-prefixed variable.
  - Only needed when exercising Shape Finder; the rest of the app runs without it.
- The app is **local-first**: drawing, export, and local persistence work fully offline. Real-time collaboration, the AI backend, and Firebase are external/optional and are NOT required to run or test core functionality. Tests log `Error JSON parsing firebase config` — this is expected and harmless without a Firebase config.

### Lint / test / build

- Commands are defined in `package.json`: `yarn test:typecheck` (tsc), `yarn test:typecheck:shape-finder` (tsc for the Node agent, which has its own tsconfig), `yarn test:code` (eslint), `yarn test:app --run` (vitest), `yarn build` (production build of the app).
- The pre-commit hook (`.husky/pre-commit`) is currently a no-op (its `lint-staged` line is commented out), so commits do not auto-lint.
