# rsdk-webui — working notes for agents

## Conventions

- **Commits: English, conventional commits, concise.** One-line subject
  (`type(scope): what changed`), body limited to two or three short lines
  (what + why). No verification logs, no long rationale — put that in code
  comments or `docs/`.
- **Code comments and user-facing copy are Chinese.** The UI is Chinese, keep
  it that way; comments explain *why*, not *what*.
- Never push to a repository the user does not own. Build bundles go to the
  user's own repo only.

## Layout

- `shared/` — zod profile schema + all pure renderers (bundle, scripts, hooks).
  Pure functions of `Profile`; no filesystem or network.
- `server/` — Fastify API: catalog, profiles, preflight, package index, jobs,
  two backends (local container, GitHub Actions).
- `web/` — Vite + React wizard. Runs against the server, or standalone on
  GitHub Pages where the build is dispatched through the user's own repo.
- `ops/` — setup, static-asset generation, board/mirror audits, ui screenshots.

## Before you claim something works

- `pnpm -r typecheck` and `pnpm -r test` (shared: node:test, server: vitest).
- UI changes: `node ops/ui-shot.mjs <url> <out.png>` (headless Chrome over CDP)
  or `pnpm dev`. Measure, do not eyeball — see `ops/ui-shot.mjs --help`.
- No container engine? `node ops/ui-fixture.mjs` serves `web/dist` with stubbed
  `/api/*` (8 fake boards, preflight always green) so the whole wizard renders:
  `pnpm build && node ops/ui-fixture.mjs &` then point ui-shot at :8899.
- Never use `git checkout <file>` to undo a temporary edit; it also discards
  uncommitted work. Back the file up first.
