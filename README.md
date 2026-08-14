# StoryEngine

A self-hosted, multi-user engine for character-driven interactive fiction.

**Status: alpha.** The design is written down in
[`docs/design/`](docs/design/); the code is through
[P1.5](docs/design/19-p1-implementation.md) — the storage spine, the derived
index and its watcher, auth, and the library API.

**The server runs; there is no UI yet.** That is P1.6. Until then the API is
the whole product, and [`docs/api.md`](docs/api.md) is how to drive it.

The storage thesis this phase exists to prove does work end to end: create an
actor through the API, watch the folder appear, hand-edit a lorebook on disk in
a text editor, and see the change without a restart
([05 §4.1](docs/design/05-ui-surfaces.md)).

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

Then start it:

```bash
pnpm dev
```

It binds `127.0.0.1:8080` and creates `./data` on first run. Open the address
and it will ask you to create the first admin — or drive it with `curl`, per
[`docs/api.md`](docs/api.md).

**Loopback is the default deliberately.** Until an admin account exists, anyone
who can reach the port can claim the install, so LAN exposure is an explicit act
([04 §5.1](docs/design/04-server-multiuser-deployment.md)). Copy
[`config.example.json`](config.example.json) to `data/config.json` to change it.

| Script | What it does |
|---|---|
| `pnpm typecheck` | `tsc -b` across the project references, then the tooling |
| `pnpm lint` | ESLint (including the boundary graph) and Stylelint |
| `pnpm build` | Typecheck, emit the JSON Schemas, then the client bundle |
| `pnpm test` | Vitest |
| `pnpm dev` | Start the server |
| `pnpm format` | Prettier over the code; Markdown is hand-wrapped and left alone |

Run `typecheck` before `lint` on a clean clone. The boundary rules classify an
import by its *resolved* path, which runs through each package's built entry
point — so linting an unbuilt workspace passes for the wrong reason.

## Layout

```
packages/shared/     portable types and schemas, and the registry over them
packages/sdk/        the published extension and mode contract
packages/server/
  src/storage/       the only place that touches the filesystem
  src/index-db/      the derived index and its watcher — delete it, lose nothing
  src/auth/          accounts, scrypt, sessions
  src/routes/        the HTTP surface
packages/client/     React + Vite. A scaffold until P1.6.
tools/lint-fixtures/ files that violate the day-one rules, so the rules can be
                     tested rather than trusted
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
