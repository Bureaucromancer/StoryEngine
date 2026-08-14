# StoryEngine

A self-hosted, multi-user engine for character-driven interactive fiction.

**Status: alpha, and pre-first-feature.** The design is written down in
[`docs/design/`](docs/design/); the code is at
[P1.0](docs/design/19-p1-implementation.md#p10--repo-skeleton), which is the
repository skeleton and the discipline mechanisms. **Nothing runs yet.** There
is no server to start and no UI to open — that is P1.5 and P1.6.

Start with [`docs/design/README.md`](docs/design/README.md) if you want to know
what this is going to be, and [`docs/design/00-stance.md`](docs/design/00-stance.md)
if you want to know why.

## Building it

Alpha distribution is build-it-yourself ([12 §0](docs/design/12-repo-and-releases.md)).
There are no release artifacts, channels or packages yet.

Requires **Node 26** and **pnpm 11**.

```bash
pnpm install && pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

| Script | What it does |
|---|---|
| `pnpm typecheck` | `tsc -b` across the project references, then the tooling |
| `pnpm lint` | ESLint (including the boundary graph) and Stylelint |
| `pnpm build` | Typecheck, then the client bundle |
| `pnpm test` | Vitest |
| `pnpm format` | Prettier over the code; Markdown is hand-wrapped and left alone |

Run `typecheck` before `lint` on a clean clone. The boundary rules classify an
import by its *resolved* path, which runs through each package's built entry
point — so linting an unbuilt workspace passes for the wrong reason.

## Layout

```
packages/shared/     portable types and schemas. No runtime dependencies.
packages/sdk/        the published extension and mode contract.
packages/server/
packages/client/     React + Vite.
tools/lint-fixtures/ files that violate the day-one rules, so the rules can be
                     tested rather than trusted.
```

`packages/modes/` does not exist yet — but the lint rules governing it do, which
is the point ([07 §10](docs/design/07-tech-stack.md)).

## The rules that are build errors

Several claims in the design documents are only true if breaking them fails the
build ([16 §2](docs/design/16-testing.md)). Each is enforced, and each has a
fixture test asserting the enforcement actually fires:

- **The dependency graph.** `modes → sdk, shared`; `client → shared`;
  `sdk → shared`; `server → shared, sdk`. Never the other way.
- **No direct `fs`** outside `packages/server/src/storage`, which keeps one
  audited path resolver the only door ([07 §9](docs/design/07-tech-stack.md)).
- **No randomness** outside the RNG service — and since the service does not
  exist until P2, no randomness anywhere
  ([07 §14.4](docs/design/07-tech-stack.md)).
- **Logical CSS properties only**, in stylesheets *and* in Tailwind utility
  classes ([07 §12.6](docs/design/07-tech-stack.md)).
- **An SPDX header** on every source file.

## Licence

AGPL-3.0-or-later. See [`LICENSE`](LICENSE), and
[08 §1](docs/design/08-triage.md) for why — including why the SDK is AGPL too,
deliberately rather than incidentally.

Your characters, lorebooks and stories are yours. The licence covers this
software, not the content authored with it
([08 §1.2](docs/design/08-triage.md)).
