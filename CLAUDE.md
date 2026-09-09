# StoryEngine — working notes for Claude

Self-hosted LLM storytelling server. The design authority is `docs/design/` —
numbered notes plus `docs/design/workplan/` for phase plans; when code and a
design note disagree, say so rather than silently siding with either.

## Layout

pnpm workspace, Node ≥ 26, ESM throughout (imports use `.js` suffixes).

- `packages/shared` — schemas (TypeBox) and types both sides use
- `packages/server` — the server; provider adapters live in `src/providers/`
- `packages/client` — React client
- `tools/` — dev scripts (`dev-server.mjs`, `seed.mjs`, `reset-data.mjs`),
  `write-build-info.mjs` (the identity a release build carries), and
  `release.test.ts` (the `release` vitest project: the version agrees across
  `package.json`, `CHANGELOG.md`, `compose.yaml` and the unraid template)
- `Dockerfile`, `compose.yaml`, `deploy/unraid/` — Alpha 1's image and its two
  wrappers; `docs/deploy.md` is how a built one runs. Private registry; every
  `v*` tag also moves the `testing` channel tag, which the unraid template
  follows, and `latest` never moves; `release.yml` builds the image on a `v*`
  tag (first success
  `v1.0.0-alpha.1`, 2026-09-06), and it has never been built on this machine
  (no Docker). The base ships no corepack: pnpm is installed with npm, pinned
  to `packageManager` by `tools/release.test.ts`
- `data/` — runtime data, canonical and gitignored; never the repository's

## Commands

- `pnpm test` — full suite (vitest projects; deterministic, no network)
- `pnpm test:gate` — the CI-named P1 gate property test
- `pnpm test:fixture-pair` — the import fixture-pair project alone
- `pnpm test:live` — live provider tests against a real endpoint (below)
- `pnpm build:identify` — writes gitignored `packages/server/build-info.json`;
  `pnpm build` deliberately does not. Delete it after a local experiment, or
  the suite runs in a configuration CI never sees
- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` — all expected clean
- `pnpm dev` — server + client; `pnpm dev:logged` captures logs and cassettes

## Live LLM endpoint

Real-call tests are gated on environment, per developer, via a gitignored
`.env` (template: `.env.example`):

- `STORYENGINE_LIVE_BASE_URL` — an OpenAI-compatible endpoint, e.g.
  `http://localhost:11434/v1` (Ollama) or `http://localhost:1234/v1` (LM Studio)
- `STORYENGINE_LIVE_MODEL` — a model id that endpoint serves
- `STORYENGINE_LIVE_API_KEY` — only if the endpoint needs one

`pnpm test:live` loads `.env` and runs the `live` vitest project
(`**/*.live.test.ts`). With the variables unset the suite skips, so `pnpm test`
and CI never depend on an endpoint existing. Live tests assert structure
(finish reason, usage shape, stream termination), never model prose, and every
exchange is recorded as a cassette into `captures/live-tests/` (gitignored);
curated cassettes are promoted by hand into
`packages/server/src/providers/fixtures/`. Before writing new live tests, read
`packages/server/src/providers/openai-compatible.live.test.ts` — it is the
pattern. Never commit `.env`, keys, or raw captures.

## Conventions the tooling enforces

- Every source file opens with the SPDX header pair
  (`AGPL-3.0-or-later` + copyright); eslint fails without it.
- Tests are colocated `*.test.ts(x)`; `*.live.test.ts` is reserved for the
  live project. New test files must match an include in `vitest.config.ts` —
  a file no project claims lints, typechecks, and never runs.
- Comments in this codebase explain *why* at length; match that register
  rather than writing sparse what-comments.
- `eslint.rules.js` and `tools/lint-fixtures/` hold project-specific lint
  rules and their tests.
- Adding a config key is a five-place edit — the schema, `CONFIG_TIERS` and
  `DEFAULT_CONFIG` in `config.ts`, `config.example.json`, and the tier table in
  `docs/design/21-internal-contracts.md` §4 — and `config.test.ts` fails on any
  one of them missed. The same test parses §4's environment-variable table, so
  a new `SE_*` variable needs a row there too.
- Phase branches are bare `pN` (`p5`, `p6`, `p6a`) and merge into `main` with
  `--no-ff` and a colon-subtitled merge commit; the phase documents cite stage
  commits by hash, so never squash them. A green suite closes a stage, not a
  phase: exit gates are walked by a person, and the phase document records
  which steps the suite covers and which still wait.
- `pnpm --filter @storyengine/server --legacy deploy` leaves the workspace's
  install state pointing at a production install; run a plain `pnpm install`
  before the next `pnpm build`.
