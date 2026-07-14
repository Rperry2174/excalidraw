# AGENTS.md

## Cursor Cloud specific instructions

Excalidraw is a Yarn (classic, v1) workspaces monorepo. The primary product is the
`excalidraw-app` web app (excalidraw.com), which consumes the `packages/*` libraries.
Standard commands live in `package.json` and `CLAUDE.md`; only non-obvious caveats are noted here.

### Services
- **`excalidraw-app` (dev server)** — run with `yarn start` from the repo root.
  - It listens on **port 3001** (set via `VITE_APP_PORT` in `.env.development`), not Vite's default 5173.
  - `yarn start` first runs `yarn` (a workspace install) before launching Vite, so it is safe to run even if deps drift.
  - The Vite dev server runs ESLint and TypeScript checkers concurrently (via `vite-plugin-checker`); check the server output for `[ESLint]`/`[TypeScript]` results.
- The app is **local-first**: drawing, export, and local persistence work fully offline. Real-time collaboration, the AI backend, and Firebase are external/optional and are NOT required to run or test core functionality. Tests log `Error JSON parsing firebase config` — this is expected and harmless without a Firebase config.

### Lint / test / build
- Commands are defined in `package.json`: `yarn test:typecheck` (tsc), `yarn test:code` (eslint), `yarn test:app --run` (vitest), `yarn build` (production build of the app).
- The pre-commit hook (`.husky/pre-commit`) is currently a no-op (its `lint-staged` line is commented out), so commits do not auto-lint.
