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

```bash
pnpm dev
```

Starts both halves and watches both. **Open `http://127.0.0.1:5173`** — that is
Vite, and on a fresh install it will ask you to create the first admin.

They remain **two processes on two ports**, and `pnpm dev` is a convenience over
that rather than a thing of its own:

| | Port | What it is | On a source change |
|---|---|---|---|
| Server | 8080 | The API, and nothing else | Restarts (`tsx watch`) |
| Client | 5173 | Vite, proxying `/api` to 8080 | Hot module replacement |

The proxy is what keeps the two same-origin, so the session cookie is sent
normally and there is no CORS anywhere. Port 8080 serves no files — pointing a
browser at it is not useful, but pointing `curl` at it is a first-class way to
work ([`docs/api.md`](docs/api.md)) and is still the only way to *create*
anything.

Either half runs on its own, which is the point of keeping them separate:

```bash
pnpm dev:server    # just the API, for curl-driven work
pnpm dev:client    # just Vite, against a server you started some other way
```

`pnpm dev` starts them in parallel and does not order them, so on a cold start
Vite is usually ready first and logs a proxy error or two until the server
binds. That is noise rather than failure. Started alone, the client comes up
fine and reports that it cannot reach the server until one is there.

**Both need a build first.** The server imports `@storyengine/shared` through
its built entry point, so `pnpm build` has to have run at least once. Watch mode
covers each package's *own* sources — editing `shared` or `sdk` needs a
`pnpm build` before the server sees it.

**Loopback is the default deliberately.** Until an admin account exists, anyone
who can reach the port can claim the install, so LAN exposure is an explicit act
([04 §5.1](docs/design/04-server-multiuser-deployment.md)). Copy
[`config.example.json`](config.example.json) to `data/config.json` to change it.

### How the dev setup is wired

Worth writing down, because three of the four pieces are choices rather than
defaults.

- **`pnpm dev` is `pnpm --parallel`** over the server and client `dev` scripts —
  pnpm's own runner rather than a `concurrently`-style dependency. Output is
  prefixed per package. One consequence of two processes under one terminal: a
  signal that does not reach the whole process group can leave a child holding a
  port, and `Port 5173 is in use` on the next start is what that looks like.
- **The server watches with `tsx`**, per [07 §11](docs/design/07-tech-stack.md),
  which names it. Node 26 can strip types unaided, but this codebase imports
  with `.js` specifiers under `NodeNext` and Node will not resolve those onto
  the `.ts` files that actually exist; `tsx` does. It also means dev runs from
  `src/` while production runs the built `dist/` — `pnpm --filter
  @storyengine/server start` is unchanged and still the production entry point.
- **Dev writes to the repository's `data/`.** The scripts run with their own
  package as the working directory, so the server's dev script passes
  `--data ../../data` explicitly. Without it the data directory would appear
  under `packages/server/`, which is not where `config.example.json` or
  anything else expects it.
- **esbuild's install script is declined**, in `pnpm-workspace.yaml`. It arrives
  under `tsx` and is the only dependency here that asks to run one; it only
  re-checks a binary pnpm has already linked, so `pnpm install` still runs no
  third-party code.

### Why two commands and not one process

The split is temporary rather than principled, and it exists because the server
does not serve the client's files yet ([`docs/api.md`](docs/api.md), *Not here
yet*). The shipped product is meant to be one container, one volume and one
port ([04 §5.3](docs/design/04-server-multiuser-deployment.md)) — so the server
will eventually serve the built client, and the two ports become one.

Keeping them apart until then keeps the API honest: nothing in the server knows
the client exists, which is the same boundary the lint graph enforces in code.

## Scripts

| Script | What it does |
|---|---|
| `pnpm typecheck` | `tsc -b` across the project references, then the tooling |
| `pnpm lint` | ESLint (including the boundary graph) and Stylelint |
| `pnpm build` | Typecheck, emit the JSON Schemas, then the client bundle |
| `pnpm test` | Vitest |
| `pnpm dev` | Both of the below, in parallel |
| `pnpm dev:server` | The API on 8080, restarting on a change (`tsx watch`) |
| `pnpm dev:client` | Vite on 5173, proxying `/api` to 8080 |
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
