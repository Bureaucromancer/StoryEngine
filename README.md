# StoryEngine

A self-hosted, multi-user engine for character-driven interactive fiction.

**Status: a work in progress, public but not released.** This repository has
been public since 2026-10-03, for reasons of licensing and CI rather than
readiness ([releases §0.1a](docs/design/workplan/04-repo-and-releases.md)).
Nothing here is a release. There are no published builds — the container image
is a private package, and the `v1.0.0-alpha.*` tags are builds the project made
for itself — nothing is supported, data formats may change without a migration,
and issues and pull requests may go unanswered. **It is not accepting
contributions for now**, so a pull request will not be merged; forks are
welcome, under the AGPL ([Licence](#licence)). A security problem goes
privately, as [`SECURITY.md`](SECURITY.md) says, and not into a public issue.
Both are policy, recorded in
[releases §0.1a](docs/design/workplan/04-repo-and-releases.md) with the date
they were set. Running it means building it from source ([Running it](#running-it)).

The design is written down in [`docs/design/`](docs/design/); the code is
through [P15](docs/design/workplan/33-p15-setup-from-a-turn.md) of the
[work plan](docs/design/workplan/01-work-plan.md) — P13's whole-install
Aventuras import and P14's Scene and session import merged on 2026-09-29 and
2026-09-30, and P15's Setup made from a turn on 2026-10-03 — with **several
phases' exit gates still awaiting a person**, P15's among them;
[the work plan's index](docs/design/workplan/README.md) records each phase's
state rather than glossing it. *(This paragraph said "through P7" until
2026-10-03, seven phases after it stopped being true, and "through P14" until
2026-10-04, a day after P15 merged.)* What exists: the storage spine and a derived
index that can be thrown away and rebuilt from it; accounts and sign-in; the
library, with import from SillyTavern, Marinara and Aventuras and export back
out again; **the turn, end
to end**, as a resumable server-side job with a streamed reply; the workbench
that reads the record of it; lorebooks as documents to read and as retrieval
that says why each entry fired or did not; the session as a tree you can
branch, rewrite, reroll and walk; the settings surface for an install, its
accounts and its model connections; and, since P6A, what a container needs — a
server that can be told where to bind, serves its own client, guards its first
admin with a token, and can say which commit it is.

**Alpha 1 was tagged 2026-09-06, at P6A.** Its version is `1.0.0-alpha.1`,
named *1.0-alpha 1* — the first prerelease of 1.0, under the scheme
[releases §7.1](docs/design/workplan/04-repo-and-releases.md) records — in the
root `package.json`, in [`CHANGELOG.md`](CHANGELOG.md) and on the tag
`v1.0.0-alpha.1`, from which the on-tag workflow built the image on its second
run: the first stopped at the Dockerfile, because the base image no longer
ships corepack and nothing had run that file before a daemon did, and the tag
moved to the fix. The image is private, so nothing pulls it without a login
([`docs/deploy.md`](docs/deploy.md)). What has not happened is the walk —
[P6A §3](docs/design/workplan/19-p6a-alpha-1.md) steps 3 through 12, which
need a machine with Docker and an unraid host. It is a build the
project makes for itself, not a distribution: the registry package is private
— the repository was too, until 2026-10-03 — and
[releases §0.1](docs/design/workplan/04-repo-and-releases.md) says why that is
the point for the build rather than a stage on the way to something. Alphas 2
to 4 followed on 2026-09-07, -08 and -09, under the same terms.

**The UI browses, plays, reads and configures.** Sign in and browse all six
kinds of library object, or fill the library from a SillyTavern, Marinara or
Aventuras directory — or one Aventuras scenario, character or lorebook file —
and read the review of what resolved, what went to `compat` and what dangled.
Take any object back out as its own JSON, or written as a character card or one
of Aventuras' own formats, with what each conversion could not carry named
beside it. Start a session, take a turn, watch the reply stream. Branch
from any earlier turn, rewrite or reroll a reply and move among the siblings it
leaves, undo the newest turn, and search the lines you abandoned — every one of
them is still there. From any turn, a wizard turns the story so far into a
Setup that new sessions start from, and that Setup's own opening wins turn 1
over the cast's greetings. Open the workbench beside Play to see what the turn was
built from: every block with its source and reason, the budget's verdicts, the
calls, the effects, which lore entries fired and which were skipped and why, and
a diff between two turns. Read a lorebook as a document — browse it, search it,
edit its entries and drag them into order. Open Settings to change your own
preferences or, as an admin, the install's configuration, its accounts and its
model connections.

**Since P6B and P7**: a mode is a package rather than a shape the engine happens
to fit. Scene and Freeform are two of them, each consuming the published SDK and
permitted to import nothing else — channels with their own schemas, their own
setup wizards, their own steps, their own participant policies and their own
contributed UI. Around that: plot hooks with a selector that says why it held or
fired, goals as a chain with a cursor and a judge whose completion you confirm,
party and presence as channels so a character can be dead on one branch and alive
on another, mentions highlighted against what the lore scanner matched, two
difficulty dials, suggested actions, and a staged scene with backdrops and
per-actor expressions imported from the card that carried them.

Actors and lorebooks have editors, with automatic version history behind a
History control: every change snapshots the state it replaced, hand edits
included, and any version can be restored, diffed, pinned or renamed. Name one
on the library page to make it, and delete anything you own from its detail
page — the folder moves to your trash rather than being erased. The other four
kinds are read-only for now, so one of those arrives by import or through the
API ([`docs/api.md`](docs/api.md)) rather than from a blank page; creation
follows each kind's editor. ~~One gap worth knowing before you go looking:
**choosing which lorebooks a session uses has no UI yet.**~~ **Repaired at
[P6B.0](docs/design/workplan/20-p6b-playable.md)** — the create form and a
mid-session panel both set a session's books, and `pnpm seed` names the treatment
it builds. A book is in play only if the session names it or the treatment the
session names links it, and now both are reachable from a browser
([P5 §0.5](docs/design/workplan/17-p5-implementation.md)).

The storage thesis does work end to end: create an actor through the API, watch
the folder appear, hand-edit a lorebook on disk in a text editor, and see the
change in the browser without a restart
([10 §4.1](docs/design/10-ui-surfaces.md)). And it survives a second writer:
saving over an object that changed on disk is refused, and the editor offers to
reload-and-reapply or save as a copy rather than guess.

**What has not happened is PLAYABLE**
([work plan §4.1](docs/design/workplan/01-work-plan.md)) — the checkpoint where
one person sits down with an imported library and plays, and the design gets
tested by use rather than completed on paper. Alpha 1 is being cut before it,
under the rule [P6A §5](docs/design/workplan/19-p6a-alpha-1.md) sets: *it may
be cut before PLAYABLE; it does not go public before it.* The repository went
public before it anyway, on 2026-10-03, knowingly and for the reasons
[releases §0.1a](docs/design/workplan/04-repo-and-releases.md) gives; the build
did not, and PLAYABLE is still the checkpoint ahead.

Start with [`docs/guide/`](docs/guide/README.md) if you want to use it as it is
built today, [`docs/design/README.md`](docs/design/README.md) if you want to know
what this is going to be, and [`docs/design/00-stance.md`](docs/design/00-stance.md)
if you want to know why.

## Building it

Alpha distribution is build-it-yourself ([releases §0](docs/design/workplan/04-repo-and-releases.md)).
There is one channel, `testing`, which every tagged alpha moves and the unraid
template follows; no `latest`, and no packages anyone else installs. The one
artifact, the image, is private and for the project's own use; running one is
[`docs/deploy.md`](docs/deploy.md)'s subject, and cutting one is at the end of
that page.

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
| Server | 8080 | The API, and in development nothing else | Restarts (`tsx watch`) |
| Client | 5173 | Vite, proxying `/api` to 8080 | Hot module replacement |

The proxy is what keeps the two same-origin, so the session cookie is sent
normally and there is no CORS anywhere. In development port 8080 serves no
files — pointing a browser at it is not useful, but pointing `curl` at it is a
first-class way to work ([`docs/api.md`](docs/api.md)) — and, alongside import,
the way the four kinds that have no editor yet get made.

Either half runs on its own, which is the point of keeping them separate:

```bash
pnpm dev:server    # just the API, for curl-driven work
pnpm dev:client    # just Vite, against a server you started some other way
```

If the server is not on 8080, point the client at it —
`SE_API=http://127.0.0.1:9090 pnpm dev:client`. `SE_CLIENT_PORT` moves Vite's own
port the same way.

`pnpm dev` starts them in parallel and does not order them, so on a cold start
Vite is usually ready first and logs a proxy error or two until the server
binds. That is noise rather than failure. Started alone, the client comes up
fine and reports that it cannot reach the server until one is there.

### One process, one port

```bash
pnpm build
SE_CLIENT_ROOT=packages/client/dist node packages/server/dist/main.js --data ./data
```

That is the shape the container runs ([`docs/deploy.md`](docs/deploy.md)), and
since [P6A.1](docs/design/workplan/19-p6a-alpha-1.md) it runs here too: the
server serves the built client from `server.clientRoot` and the API under
`/api`, on one port, with no proxy between them. The key is unset by default,
which means *serve nothing* — and set to a directory with no `index.html` in
it, the server refuses to start rather than answering the API behind a blank
page. Nothing under `/api` is ever the fallback: an unrouted address there
answers JSON, whatever the client directory happens to contain.

**Set the four bootstrap keys in the environment when there is no config file
to set them in.** `SE_DATA_DIR`, `SE_HOST`, `SE_PORT` and `SE_CLIENT_ROOT` are
the keys needed before `config.json` can be read — it lives inside the data
directory — and they are the only ones that take a variable
([22 §4](docs/design/22-internal-contracts.md)). The file wins over the
environment, because the file is what the settings page writes.

### Starting from a known install, and keeping the log

```bash
pnpm reset-data    # stop the server first — this removes the data directory
pnpm seed          # a library and a playable session, through the HTTP API
pnpm dev:logged    # the server alone, its log copied to ./logs/server-<date>.log
```

`pnpm seed` creates the first admin if there is not one, and is idempotent —
run it twice and you get the same install rather than a second copy of it. It
does not create a connection or a binding: those carry a real key and belong to
the person rather than to a script, so a seeded install still needs one visit to
Settings before a turn will run.

**`pnpm dev:logged` exists because `pnpm dev` makes the log unreadable.** The
log is JSON on stdout by design ([22 §4.1](docs/design/22-internal-contracts.md)),
and pnpm's recursive reporter prefixes every line with `packages/server dev: ` —
so each record becomes a string that starts with a package name and then happens
to contain JSON, which `jq` and everything else refuses. `dev:logged` runs the
server as its own process and copies stdout to a dated file *as well as* to the
terminal. Use it when the log is evidence; `pnpm dev` is fine for everything
else. Logs are not committed.

**Both need a build first.** The server imports `@storyengine/shared` through
its built entry point, so `pnpm build` has to have run at least once. Watch mode
covers each package's *own* sources — editing `shared` or `sdk` needs a
`pnpm build` before the server sees it.

**Loopback is the default deliberately.** Until an admin account exists, anyone
who can reach the port can claim the install, so LAN exposure is an explicit act
([09 §5.1](docs/design/09-server-multiuser-deployment.md)). Change it in
**Settings → Install**, which is the surface every config key has, or with
`SE_HOST` before there is a file to change. **Bound beyond loopback with no
admin yet, the server asks for a setup token** and prints it to its own console
on every start until an admin exists — `docker logs`, for a container — and
keeps it at `state/setup.token` in the data directory. Only somebody who can
read the console or the directory can claim the install, which is exactly who
should be able to; once an admin exists the field is gone. And if there is TLS in front of it,
`server.trustProxy` and `server.cookieSecure` are the two keys that say so —
neither is derived from the bind, because a `Secure` cookie is not sent back
over the plain HTTP a trusted LAN is allowed to use.

[`config.example.json`](config.example.json) documents every key and is the other
way in — but **it is not loadable as it stands.** It carries `//` comments, JSON
does not, and a server pointed at a copy of it refuses to start with *not valid
JSON*. Strip the comment lines first. (The comments are the reason the file is
worth reading; the settings form is the reason it is not the main path.)

### If a password is lost

There is no email here and never will be
([09 §4](docs/design/09-server-multiuser-deployment.md)), so recovery is always
*someone with authority vouches for you*. The eventual norm is an admin
resetting the account in the UI; until that arrives — and forever after, for
the case where no usable admin account exists — the authority is access to the
host:

```bash
node packages/server/dist/main.js --reset-password ned --data ./data
```

It asks for the new password on stdin (masked, twice) and exits without
starting the server. Piped input works too, for scripts and container execs:
`echo "the new password" | node dist/main.js --reset-password ned`. The
password is never a command-line argument, which would leak it into shell
history.

Three behaviours worth knowing: the account is **re-enabled** as part of the
reset, since a disabled account is the same lockout in a different hat; a
server already running picks the change up on the next login, no restart; and
existing sessions for the account stay valid until they expire — sessions are
stateless, and the reset changes the password, not the signing key.

**This path enforces no minimum length**, including the install's own
`auth.minPasswordLength`. A one-character password is accepted here, and so is
an empty one — access to the host is already the highest authority the software
recognises, and a recovery tool that argued with the person holding the machine
would only send them to edit `accounts.json` by hand. The one thing it refuses is
*no answer at all*: a pipe that closes without delivering a line — a redirect
from `/dev/null`, an unset variable in a script — aborts and changes nothing,
because that is silence rather than a choice. `echo "" | …` still sets an empty
password, deliberately.

**Do not delete `accounts.json`** to get unlocked. That destroys every account
on the install and reopens the first-boot claim window on whatever the server
is bound to.

### How the dev setup is wired

Worth writing down, because three of the four pieces are choices rather than
defaults.

- **`pnpm dev` is `pnpm --parallel`** over the server and client `dev` scripts —
  pnpm's own runner rather than a `concurrently`-style dependency. Output is
  prefixed per package. One consequence of two processes under one terminal: a
  signal that does not reach the whole process group can leave a child holding a
  port, and `Port 5173 is in use` on the next start is what that looks like.
- **The server watches with `tsx`**, per [20 §11](docs/design/20-tech-stack.md),
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

### Why two commands in development, when the product is one process

The split used to exist because the server could not serve the client's files.
It can now, and the shipped product is one container, one volume and one port
([09 §5.3](docs/design/09-server-multiuser-deployment.md)) — so the split is a
development convenience rather than a gap: Vite's dev server is what gives hot
module replacement, and `pnpm dev` not changing was one of
[P6A](docs/design/workplan/19-p6a-alpha-1.md)'s exit-gate steps rather than an
assumption.

Keeping them apart in development also keeps the API honest: nothing in the
server knows the client exists beyond a directory to serve, which is the same
boundary the lint graph enforces in code.

## Scripts

| Script | What it does |
|---|---|
| `pnpm typecheck` | `tsc -b` across the project references, then the tooling |
| `pnpm lint` | ESLint (including the boundary graph) and Stylelint |
| `pnpm build` | Typecheck, emit the JSON Schemas, then the client bundle |
| `pnpm build:identify` | Write `packages/server/build-info.json` — the version and commit a release build reports. `pnpm build` does not run it, on purpose: a build nobody released has no identity. Delete the file after a local experiment |
| `pnpm test` | Vitest, every project |
| `pnpm test:gate` | The P1 gate alone — rebuild-from-disk equals incremental — as the named CI step |
| `pnpm test:fixture-pair` | The import fixture-pair project alone (`import/fixture-pair.test.ts`) |
| `pnpm test:live` | The live provider tests, against the endpoint `.env` names; skipped without one |
| `pnpm dev` | Both of the below, in parallel |
| `pnpm dev:server` | The API on 8080, restarting on a change (`tsx watch`) |
| `pnpm dev:client` | Vite on 5173, proxying `/api` to 8080 |
| `pnpm dev:logged` | The API alone, stdout copied to a dated file in `./logs`, provider exchanges recorded to `./captures` |
| `pnpm seed` | A known library and a playable session, over HTTP. Idempotent |
| `pnpm reset-data` | Removes the data directory, or removes nothing — and refuses a directory that is not one (`--force` overrides that check) or that holds the checkout. Stop the server first |
| `pnpm format` | Prettier over the code; Markdown is hand-wrapped and left alone |
| `pnpm format:check` | The same, checking rather than writing — what CI runs |

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
  src/auth/          accounts, scrypt, sessions, the setup token
  src/routes/        the HTTP surface, and the client when clientRoot is set
  src/turns/         the turn as a job: assembly, the provider call, the record
  src/sessions/      the tree — reconstruction, snapshots, undo
  src/retrieval/     lore activation, budgets, and the report that says why
  src/import/        the three sources, and the sweep over a directory
  src/rng/           the RNG service, and the tape a rewrite replays
packages/modes/      the built-in modes, one package each — Scene and Freeform.
  scene/             each consumes the SDK exactly as a third party would, and
  freeform/          may import nothing else
packages/client/     React + Vite. Play, the library, the workbench, settings,
                     and the actor and lorebook editors.
deploy/unraid/       the unraid template — committed, submitted to nobody
Dockerfile           Alpha 1's image; with compose.yaml beside it, Tier 1
tools/               dev scripts, the build-identity writer, and release.test.ts
tools/lint-fixtures/ files that violate the day-one rules, so the rules can be
                     tested rather than trusted
```

~~`packages/modes/` does not exist yet — but the lint rules governing it do, which
is the point~~ — **it exists, since P7.0, and the rules were there first, which
is still the point** ([20 §10](docs/design/20-tech-stack.md)). A mode package
depends on `@storyengine/sdk` and on nothing else; a reference to `../../server`
would resolve, compile and quietly reverse the decision the split exists to
enforce, so the boundary graph makes it a lint failure and the single project
reference makes it a build error.

## The rules that are build errors

Several claims in the design documents are only true if breaking them fails the
build ([testing §2](docs/design/workplan/03-testing.md)). Each is enforced, and each has a
fixture test asserting the enforcement actually fires:

- **The dependency graph.** `modes → sdk, shared`; `client → shared`;
  `sdk → shared`; `server → shared, sdk`. Never the other way.
- **No direct `fs`** outside `packages/server/src/storage`, which keeps one
  audited path resolver the only door ([20 §9](docs/design/20-tech-stack.md)).
- **No randomness** outside the RNG service (`packages/server/src/rng/`, since
  P2.2) — every draw goes through it and lands on the turn's tape, which is
  what makes a rewrite replay the same dice. Two one-file exemptions, id
  generation and cryptographic secrets, each argued where it is granted in
  `eslint.config.js` ([20 §14.4](docs/design/20-tech-stack.md)).
- **Logical CSS properties only**, in stylesheets *and* in Tailwind utility
  classes ([20 §12.6](docs/design/20-tech-stack.md)).
- **The engine names no mode.** No `switch` on one, no comparison against a mode
  id, no table keyed by one, anywhere under `packages/server/src` — because an
  engine that knows which modes exist is an engine a third party cannot add one
  to ([06 §2](docs/design/06-modes-and-turn-pipeline.md)). Two layers, as with
  the boundary: selectors that fire in the editor, and a survey that enumerates
  every mode id in engine source against an allowlist with a reason on each
  entry. A selector cannot recognise the id of a mode nobody has written yet,
  which is why both exist.
- **An SPDX header** on every source file.

## Licence

AGPL-3.0-or-later, except three files that hold code from SillyTavern and Marinara Engine —
both licensed under version 3 alone — and are `AGPL-3.0-only`; so the program as a whole is
AGPL-3.0. [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) lists them and everything else
taken from elsewhere. See [`LICENSE`](LICENSE), and
[triage §1](docs/design/workplan/02-triage.md) for why — including why the SDK is AGPL too,
deliberately rather than incidentally.

Your characters, lorebooks and stories are yours. The licence covers this
software, not the content authored with it
([triage §1.2](docs/design/workplan/02-triage.md)).
