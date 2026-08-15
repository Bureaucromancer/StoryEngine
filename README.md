# StoryEngine

A self-hosted, multi-user engine for character-driven interactive fiction.

**Status: alpha.** The design is written down in
[`docs/design/`](docs/design/); the code is through
[P1.6](docs/design/19-p1-implementation.md) — the storage spine, the derived
index and its watcher, auth, the library API, and a web client that reads it.

**There is a UI, and it is read-only.** Sign in, browse all six kinds of
library object on one surface, open one and see it. Creating and editing still
happen through the API — the actor editor is P1.7 — so
[`docs/api.md`](docs/api.md) remains how you put anything *into* a library.

The storage thesis this phase exists to prove does work end to end: create an
actor through the API, watch the folder appear, hand-edit a lorebook on disk in
a text editor, and see the change in the browser without a restart
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

## Running it

**Two processes on two ports, started separately.** The server is the API and
nothing else; Vite serves the client and proxies `/api` back to the server.
Neither waits for the other, and there is no combined command yet — see
[below](#why-two-commands).

Terminal one, the server:

```bash
pnpm dev
```

It binds `127.0.0.1:8080` and creates `./data` on first run. Driving that port
with `curl` is a first-class way to work ([`docs/api.md`](docs/api.md)) and is
still the only way to *create* anything. Opening it in a browser is not useful:
there are no files there to serve.

Terminal two, the client:

```bash
pnpm dev:client
```

Vite serves `http://127.0.0.1:5173` and proxies `/api` through to 8080, which
keeps the two same-origin — so the session cookie is sent normally and there is
no CORS anywhere. **5173 is the address to open**, and on a fresh install it
will ask you to create the first admin.

Start the server first if you care about the order. The client comes up either
way, but its requests fail until something is listening on 8080, and the UI
reports that it cannot reach the server.

**Loopback is the default deliberately.** Until an admin account exists, anyone
who can reach the port can claim the install, so LAN exposure is an explicit act
([04 §5.1](docs/design/04-server-multiuser-deployment.md)). Copy
[`config.example.json`](config.example.json) to `data/config.json` to change it.

### Why two commands

The split is temporary rather than principled, and it exists because the server
does not serve the client's files yet ([`docs/api.md`](docs/api.md), *Not here
yet*). The shipped product is meant to be one container, one volume and one
port ([04 §5.3](docs/design/04-server-multiuser-deployment.md)) — so the server
will eventually serve the built client, at which point this collapses back into
a single command and a single address.

Keeping them separate until then costs one extra terminal and keeps the API
honest: nothing in the server knows the client exists, which is the same
boundary the lint graph enforces in code.

## Scripts

| Script | What it does |
|---|---|
| `pnpm typecheck` | `tsc -b` across the project references, then the tooling |
| `pnpm lint` | ESLint (including the boundary graph) and Stylelint |
| `pnpm build` | Typecheck, emit the JSON Schemas, then the client bundle |
| `pnpm test` | Vitest |
| `pnpm dev` | Start the server (API only, port 8080) |
| `pnpm dev:client` | Start Vite for the client (port 5173, proxies `/api`) |
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
packages/client/     React + Vite. The library list, a detail view, and login.
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
  exist until P2, nowhere at all bar two one-file exemptions, id generation and
  cryptographic secrets, each argued where it is granted in `eslint.config.js`
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
