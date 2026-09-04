# 23 — P6A implementation plan: Alpha 1

**Status: ~~plan~~ in progress.** Opened 2026-09-04 on branch `p6a` at
`a54afcc`, main's tip after this document's own merge. The audit below stands as
written and needed no repeat: `git diff a6f78c3..a54afcc -- packages/server
packages/shared config.example.json` is empty, so every line number and every
claim about the code in §0 still resolves. P6A.0 first, per §2 — the stages are
prerequisites of each other rather than parallel work.

Written at its phase and audited 2026-09-03 at `a6f78c3`.
Unusually for these documents there is no half-revisit, no skeleton and no
**[AWAITS]** marker. P6 merged the morning this was written, the phase starts
now, and every precondition it depends on is checkable today rather than on the
day. That is the whole reason it reads differently from
[08](08-p6-implementation.md) and [18](18-p7-implementation.md) through
[22](22-p11-implementation.md): those are plans for phases at a distance, and
this is a plan for the phase in front of us.

**P6A delivers one thing, and the rest is what that thing needs:** a build you
can go back to. Today the only record of a working state is the commit graph,
which means *"the version where lorebooks worked before I touched the budgeter"*
is an act of archaeology rather than a thing you can run. Alpha 1 is that state,
frozen, named, tagged, and runnable in one command.

**The demo that defines done:** *pull a tagged image, map a port, take the setup
token out of `docker logs`, create an admin, and play a session — with the
working tree in any state at all, and the running build able to say exactly which
commit it came from.*

**Citation convention**, following [P5](07-p5-implementation.md) and
[P4](06-p4-implementation.md): **`releases §N`** means
[11-repo-and-releases](11-repo-and-releases.md); **`testing §N`** means
[10-testing](10-testing.md); bare numbers are design documents one level up. Code
paths are relative to `packages/<pkg>/src`.

---

## 0. What this phase is, and the correction it opens with

**It is not a distribution.** [releases §0](11-repo-and-releases.md) defers
release engineering to beta on the argument that *"building them now would be
maintaining a distribution for software that has no users"*, and that argument is
right and survives this phase untouched. What it does not distinguish — and what
this phase turns on — is the difference between:

- **A release artifact**: tagged, changelogged, published to a channel, tracked
  by other people's auto-updaters, carrying an implied support promise.
- **A build the project produces for itself**: tagged, changelogged,
  reproducible, identified, and handed to nobody.

P6A is the second. The repository is private, the registry package is private,
and the unraid template is written and committed rather than submitted. Nothing
about `latest`, `nightly`, the tarball or the other four packaging artifacts
moves, and [releases §8](11-repo-and-releases.md)'s gate on those stands exactly
where it was.

**Which is also the line this phase must not blur.** AGPL §13 attaches on
distribution ([04 §7](../04-server-multiuser-deployment.md)), so it does not
attach here — and the moment the image goes public, the repository must go with
it and the §13 surface comes too. That is a sentence in §4, not work in this
phase, and it is written down so that the decision to publish is taken
deliberately rather than by someone flipping a registry toggle.

### 0.1 The scope correction, said first

The phase was scoped in conversation as *"really only the release flow with the
image"*. That is roughly half of it. Three things stand between the current
repository and a `docker run` that does anything at all, and none of them is
release engineering:

1. **The server cannot be told where to bind** (§0.2). An image built today is
   unreachable no matter how its port is mapped.
2. **The server serves no UI** (§0.3). An image built today is an API and a 404.
3. **Two deferrals expire the instant an image exists** (§0.4) — the setup token
   and the cookie hardening — because both were deferred on a premise the
   container removes.

A phase whose scope statement is wrong by a factor of two is a phase that gets
called done before it is safe, so the list above is the phase rather than a
preamble to it. The release flow proper is the last stage, not the first.

### 0.2 Readiness — the bind, which is the real blocker

**The server reads exactly one environment variable in the entire codebase**, and
it is dev-only: `SE_CLIENT_PORT` at `main.ts:267`, used to print the Vite
address. Its command line is `--data`, `--config`, `--capture` and
`--reset-password`. **There is no `--host`, no `--port`, and no `SE_HOST`.**

The config file lives *inside* the data directory — `new Layout(dataDir).configFile`
in `main.ts` — so a container started against an empty `/data` volume finds no
config file, falls back to `DEFAULT_CONFIG`, and binds `127.0.0.1`. Inside a
container that is the container's own loopback, which is precisely the failure
[04 §5.3](../04-server-multiuser-deployment.md) describes: the image *"would
appear completely dead on first run"*.

**And three files already say it does the right thing.** `config.example.json:34`
tells operators, in the present tense, *"The container image binds 0.0.0.0
instead… There, the `-p` flag is your explicit act instead."* `main.ts:141` and
`config.ts:50` carry the same claim in their comments. All three are false, and
the first of them is in the first file a new operator opens. This phase is what
makes them true.

**Corrected at P6A.0, 2026-09-04:** two of the three, not all three. The
`config.example.json` and `config.ts` comments are the bind claim and are now
true. `main.ts:141` says *"in a packaged build they are the same origin"*, which
is the **serving** claim rather than the bind one — equally false today, and made
true by §0.3's stage rather than this one. Recorded rather than quietly widened,
because the stage that owns a false sentence is the stage that makes it true.

**The mechanism is constrained, not free.** [P10 §1.2](21-p10-implementation.md)
already ruled out the obvious shortcut — the image shipping a different baked
default — as *"a hidden difference between artifacts"*, and requires **one
documented environment variable** that a bare-metal operator can set to get the
same behaviour and a container operator can set to tighten it. So the deliverable
is an environment layer in the config resolver, not a Dockerfile line. It is the
largest genuinely-new construction in the phase, and it must not fight
`validateConfigDocument` (`config.ts:566`), which the settings-write path reuses.

### 0.3 Readiness — serving the client, which is the easy half

Better than expected in every direction:

- **The root namespace is empty.** Every route is registered inside one
  encapsulated plugin at `{ prefix: '/api' }` (`app.ts:691`), with `/api/admin`
  nested inside it. There is no route, hook or handler outside that prefix, so a
  static handler and an SPA fallback shadow nothing.
- **There is no `setNotFoundHandler` anywhere in the repository** — only
  `setErrorHandler`. The fallback is an unoccupied seam.
- **The client needs no change at all.** `client/vite.config.ts` sets no `base`,
  so `dist/index.html` references `/assets/…` absolutely, and every call in
  `client/src/api.ts` is already a relative `/api/…`. The client was written for
  a single origin from the start; only the server was not.

**The one trap.** `isApi` (`app.ts:709`) already exists and already distinguishes
the two namespaces. The SPA fallback must use it, so that an unrouted `/api/…`
path still answers the JSON `{error, message}` 404 rather than `index.html`.
[docs/api.md](../../api.md) reasons explicitly about what a client must be able
to tell apart there, and serving HTML where JSON is parsed is strictly worse than
the 404 that passage already rejects.

**Adding the config key is a five-place edit and a test enforces it.** A
`server.clientRoot` key touches the schema, `CONFIG_TIERS` and `DEFAULT_CONFIG`
in `config.ts`, then `config.example.json` — and then **the markdown tier table
in [13 §4](../13-internal-contracts.md)**, because `config.test.ts` reads that
document, regex-parses the table, and asserts key-for-key equality with
`configKeys()`. This is [01 §2.3](01-work-plan.md)'s mechanically-checked core
doing its job, and it is worth naming here so nobody discovers it as a red test.

### 0.4 Readiness — the two deferrals the image expires

**They are one finding wearing two numbers, and they rest on the same premise.**

- **The setup token.** `main.ts` today prints a warning on a non-loopback bind
  with no admin — *"anyone who can reach this port can claim this install"* — and
  enforces nothing. The comment beside it (F10) says the token *"lands with the
  container image that needs it, at P10"*, and
  [04 §5.1](../04-server-multiuser-deployment.md) states the condition plainly:
  *until an image ships, nothing binds non-loopback without someone typing the
  bind address.* **This phase ships that image**, so the deferral's own trigger
  fires here rather than at P10. The scheduling was always against the artifact,
  not against the phase number.
- **Cookie `secure` and `trustProxy`.** [P2 §2.11](04-p2-implementation.md)
  deferred these citing *the loopback default* as what made deferring safe, and
  `routes/auth.ts:56` hardcodes `const secure = false`. A container binding
  `0.0.0.0` — typically behind the reverse proxy an unraid user already runs —
  voids that justification at the same instant.

**Ship both halves or neither.** Splitting them leaves the surviving half resting
on a premise that no longer holds, which is worse than either shipping both or
shipping neither, because it looks decided.

**The good news is the cost.** `survivesSetupGate` (`app.ts:720`) already proves
the pre-setup attack surface is exactly two URLs — `/api/auth/setup` and
`/api/auth/state` — so the check attaches in two places rather than being swept
across a route table. `auth/session.ts`'s `loadOrCreate` is the storage pattern
to mirror. And every existing test drives the app through `fastify.inject` rather
than a socket, so a bind-conditional gate leaves the suite untouched. Hours, not
days.

### 0.5 Readiness — what is already there

Worth stating, because it is the half of [releases §8](11-repo-and-releases.md)'s
gate that is already met:

- **CI runs the per-PR tier on ubuntu and Windows** — format, typecheck, lint,
  build, the emitted-schema drift check, the suite, and the named P1 gate step.
  [testing §6](10-testing.md)'s *"must be fast enough that it is never skipped"*
  tier exists and is green. What is absent, and this phase adds one of them, is
  the nightly and on-tag tiers.
- **`pnpm build` already builds the client.** The root script runs `tsc -b`, the
  schema emit, and `vite build`. Nothing new is needed to produce the bundle;
  only somewhere to put it.
- **`--data` already covers the container's data directory**, with a comment
  saying so. The volume half of the image was solved at P2.

### 0.6 Readiness — what does not exist and has to be invented

- **No `.dockerignore`.** Without one, `data/`, `captures/`, every `node_modules`
  and the whole git history go to the daemon on every build.
- **No version anywhere.** All five `package.json` files are `0.0.0`, no route
  reports a build identifier, and there is no build-time define. The only git tag
  in the repository is `p1`, a bare phase marker — which means the on-tag CI
  trigger must filter `tags: ['v*']` or it fires on phase tags.
- **No CHANGELOG.** [releases §7](11-repo-and-releases.md) requires an entry per
  release tag.
- **No data-directory stamp.** Nothing records which build wrote a data
  directory, and nothing refuses to open one it does not understand.
- **The image's own shape is an open question the corpus already flagged.**
  [P10 §5](21-p10-implementation.md) records *"what the container image actually
  is"* as unsettled and sends it to [07](../07-tech-stack.md), which does not
  answer it. This document is where it gets answered.

---

## 1. Decisions this plan has to make

### 1.1 A private release, and why it is still a release

The four properties that make a release useful to its own project are a **tag**,
a **changelog entry**, a **reproducible build from that tag**, and an **identity
the running process can state**. All four are available without distributing
anything, and all four are what the working tree cannot give.

The property that is *not* available is the one that carries every obligation:
someone else running it. So Alpha 1 is cut, tagged, built, changelogged and
pushed to a private registry, and the phase acquires no support promise, no §13
surface, and no auto-update audience.

**This is a stronger position than a public alpha, not a weaker one.** A public
alpha of software whose storage tier is still licensed to change without
migration ([13](../13-internal-contracts.md)'s preamble grants that freedom
explicitly *because nothing leaves the install*) would convert open design
questions into compatibility questions against strangers' data. Staying private
keeps that licence intact, and three unbuilt phases still depend on it.

### 1.2 The environment layer, per P10 §1.2's rule

Environment overrides for the bootstrap keys, resolved between the defaults and
the config file: `host` at minimum, and realistically `port` and the data
directory beside it so the container's whole bootstrap is one mechanism rather
than a flag, a variable and a file.

**The container sets the documented variable; it does not get a different
build.** That is [P10 §1.2](21-p10-implementation.md)'s requirement and the
reason it exists — a bare-metal operator can set the same variable to get the
same behaviour, and a container operator can set it the other way to tighten. The
image's `0.0.0.0` is then a line in the Dockerfile that anybody can read and
override, not a property of how it was compiled.

**Precedence, stated because it will be asked:** defaults, then environment, then
the config file, then `--data`. The file wins over the environment because the
file is the thing the settings UI writes, and an operator who changed a value in
the UI and saw it ignored because a variable outranked it would be right to call
that a bug.

### 1.3 The server serves the client

`@fastify/static` rooted at a new `server.clientRoot`, registered after the
`/api` plugin, plus a `setNotFoundHandler` that returns `index.html` for non-API
paths and defers to the existing JSON 404 for API ones via `isApi` (§0.3). The
key defaults to unset, meaning *serve nothing* — development is two processes and
must stay that way, and `pnpm dev` not changing is an exit-gate step rather than
an assumption.

**What this buys beyond the image** is the class
[P2C](15-p2c-first-real-run.md) listed as structurally out of reach: cookie scope
on a single origin, asset caching, and the reverse-proxy case
[04 §5](../04-server-multiuser-deployment.md) describes. That phase could not
test any of it because everything ran behind Vite's dev proxy.

### 1.4 Both halves of F10

**The token:** generated once and stored, mirroring `auth/session.ts`'s
`loadOrCreate`; required by `POST /api/auth/setup` when the bind is non-loopback
and no admin exists; advertised as a boolean on `GET /api/auth/state` so the
client can render the field rather than guess; printed to the log on first boot
in that condition. Compared in constant time.
[P10 §1.1](21-p10-implementation.md)'s framing is the one to keep — **the check,
not the print** — because P1 already printed a token that nothing verified, and
an operator who reads "setup token" in a console reasonably concludes something
is enforcing it.

**The cookies:** `secure` and `trustProxy` driven by config rather than the
hardcoded `false` at `routes/auth.ts:56`, defaulting to today's behaviour so
loopback development is unchanged.

**Both are gated on the bind being non-loopback**, which is what keeps the
existing suite — `fastify.inject`, never a socket — entirely untouched.

### 1.5 Version and commit embedded; the §13 surface deliberately not built

**Embedded**, because a frozen build that cannot say what it is defeats its own
purpose, and because the on-tag workflow has the values in hand for free. The
running server reports them on an existing route.

**Not built:** the version-aware Source link and the About surface
([04 §6.5](../04-server-multiuser-deployment.md),
[04 §7](../04-server-multiuser-deployment.md), P10.5, P11.6). §13 does not attach
to an undistributed build, and there is a second reason to be glad of that: **no
document actually specifies an About surface.**
[05 §15.3](../05-ui-surfaces.md) enumerates the admin panels and About is not
among them, so a public Alpha 1 would have had to invent that specification under
deadline. It stays where it is planned, and P6A hands it a version string that
already exists.

**The condition that changes this** is publication, and it is written into §4.

### 1.6 The tag scheme, and why `latest` does not move

**`v0.1.0-alpha.1`.** Prefixed `v` because the on-tag trigger has to filter
`tags: ['v*']` to avoid firing on `p1`; `0.1.0` because
[releases §7](11-repo-and-releases.md) already concedes that pre-1.0 semver
*"means little"* and the data formats carry the real compatibility story;
`-alpha.1` because it sorts correctly and increments without argument.

**No release branch.** [releases §2](11-repo-and-releases.md) makes release
branches per minor line, and cutting one here would switch on
[releases §3](11-repo-and-releases.md)'s forward-port obligation for a line
nobody is maintaining. Pre-1.0 prereleases are tags on `main` and nothing else.

**And no `latest` alias is moved.** `updates.channel` already ships as a closed
union of `latest | testing | nightly`, defaulting to `latest`, at `config.ts:189`
— with no consumer anywhere, because the update check is P11's. Alpha 1 would be
the first thing `latest` could name, and unraid's auto-update and watchtower both
track exactly that alias. Publishing under the immutable tag only means the
channel still names nothing, which is what
[releases §0](11-repo-and-releases.md) says alpha should be.

### 1.7 A data-directory stamp, and nothing more

Write the build identity into the data directory on first open, and refuse to
open a directory written by a *newer* build than the one running.

**That is the whole of it, and the reason it is so small is §1.1.**
[13](../13-internal-contracts.md) licenses the storage tier to change without
migration on the condition that nothing leaves the install. Nothing does. So the
hazard is not strangers losing data, it is *you* pointing an older build at a
volume a newer one has already migrated in place — which is a foot-gun a stamp
closes for the cost of one file.

The elaborate version — release notes stating no-carry-forward, a documented
backup ritual, migration machinery — is what a *public* alpha would owe, and it
is listed in §4 as the price of publishing rather than built now.

### 1.8 The ownership boundary, stated once

**Packaging ownership is already contested three ways before this phase exists**,
which is the finding that most needs writing down:
[P10.0](21-p10-implementation.md) builds a container image and makes `docker run`
its exit gate; [P10 §4](21-p10-implementation.md) declares packaging out of scope
as P11's; and [04 §5.4](../04-server-multiuser-deployment.md) says all six
artifacts are owned by P11. [01 §0.5](01-work-plan.md)'s own lesson — *"a bar
nobody owns is a wish"* — has a converse, and this is it: two owners for one
artifact is the same defect read from the other end.

So, once, and cited from the other three documents rather than restated in them:

- **P6A builds** the OCI image, the compose file, the unraid template, the on-tag
  workflow, the environment layer, static serving, and both halves of F10.
- **P10 consumes** them: mDNS, the notification router, the gallery, the
  remainder of [05 §15](../05-ui-surfaces.md). Its bind, token and container
  sections cite this document instead of planning the work.
- **P11 keeps** the tarball and the other four artifacts, public distribution,
  the §13 surface, the update check, and the channels.

**And the unraid template is not a seventh artifact.**
[04 §5.4](../04-server-multiuser-deployment.md) calls it *"a thin wrapper over"*
Tier 1, [06 D0b](../06-open-questions.md)'s canonical enumeration names six and
does not include it, and [P11 §1.8](22-p11-implementation.md) currently lists
five names while counting four. Scheduling it with the image resolves the
miscount rather than adding to it.

---

## 2. Stages

Reachable, then visible, then safe, then identified, then released. Each stage
ends at something demonstrable, and the first four are all prerequisites of the
fifth rather than parallel work.

### ~~P6A.0 — Reachable: the environment layer~~ Landed

**Three variables, and the table is the whole surface.** `CONFIG_ENVIRONMENT` in
`config.ts` maps `SE_DATA_DIR`, `SE_HOST` and `SE_PORT` onto `dataDir`,
`server.host` and `server.port`. `environmentDocument(env)` turns whatever is
set into a **sparse document** rather than a `Config`, which is what makes the
layering work at all: the file is then merged on top of it exactly as it is
merged on top of the defaults, and nothing the environment did not mention
becomes an assertion. `loadConfig(path, environment)` does the merge and reports
which variables applied and which the file shadowed; `main.ts` composes the two
and logs both lists.

**Precedence is enforced by argument order in one expression** —
`mergeDefaults(environment, parsed)` — rather than by a rule written down
somewhere and obeyed. The one exception is `SE_DATA_DIR`, which is read *before*
the file because it decides which file there is; that is not a special case so
much as the shape `./data` always had, and the record is that a `dataDir` inside
whatever file it finds still wins downstream.

**Two of the three comments were the same claim; the third was not.** §0.2 says
`config.example.json:34`, `main.ts:141` and `config.ts:50` all assert the
container binds `0.0.0.0`. The first and third do, and both are now true and say
how. `main.ts:141` says something else — *"in a packaged build they are the same
origin"* — which is about the client being served, not about the bind, and is
made true by **P6A.1** rather than by this stage. Left alone deliberately: a
comment edited to describe a mechanism that does not exist yet is the defect this
stage was fixing.

**Four decisions worth having on the record, each with a test.** An empty value
is an unset variable, because `docker compose` forwards a host variable it has
not got as an empty string and refusing that would turn *the operator did
nothing* into a failure to start. A bad value is refused **by the name that was
typed**: validation is the same `validateConfigDocument` a file goes through —
one answer to *would this start?* — with the JSON pointers translated back, so
`SE_PORT=99999` reports `SE_PORT` rather than sending somebody to a file they
never edited. `ConfigLoadResult.document` stays the **file's** document, because
the settings write round-trips through it and an environment value reaching it
would be written into the file on the next save. And `loadConfig`'s environment
argument defaults to *none* rather than to `process.env`, so a test that loads a
config does not depend on the machine it runs on — the convenience fails open
where the argument fails closed.

**The variable table is in [13 §4](../13-internal-contracts.md) and a test parses
it**, the same way the tier table has been checked since P2A. That is the
requirement rather than a courtesy: [P10 §1.2](21-p10-implementation.md) asks for
*one documented environment variable* precisely so that the image is not a build
that behaves differently, and an undocumented variable would satisfy the code and
fail the rule.

**Thirteen mutations, thirteen red**, including two on `main.ts` and one on the
shipped documentation. The stage's *ends at* is proved in two halves and neither
half is sufficient alone: `config.test.ts` asserts the resolved `server.host` is
`0.0.0.0` with no file anywhere, and `main.test.ts` spawns the real entry point
and asserts the `listening` line reports the address the variables named. That
second one binds `localhost` rather than `0.0.0.0` — a wildcard bind in a unit
suite is a Windows firewall prompt and a CI hazard, and `localhost` is provably
not the `127.0.0.1` default, which is the property the test needs. The literal
`0.0.0.0` in a container is [§3](#3-verification--the-p6a-exit-gate) step 3.

*The stage as it was written:*

> §1.2's overrides and precedence, the documented variable, and the three false
> comments at `config.example.json:34`, `main.ts:141` and `config.ts:50` made
> true in the same commit that makes them true.
>
> *Ends at:* a server bound to `0.0.0.0` by an environment variable alone, with
> no config file present.

### ~~P6A.1 — The client, served~~ Landed

**§0.3 was right about the easy half, and wrong about one thing that mattered.**
The root namespace really was empty, there really was no `setNotFoundHandler`
anywhere, and the client really needed no change — `vite.config.ts` sets no
`base`, so the built `index.html` names `/assets/…` absolutely and every call in
`api.ts` is already a relative `/api/…`. The five-place edit landed as described,
including [13 §4](../13-internal-contracts.md)'s markdown table, and
`config.test.ts` was the thing that would have caught it if it had not.

**Where §0.3 was wrong: `isApi` in the fallback is necessary and not
sufficient.** A not-found handler only sees requests that matched no route — and
a file at `<clientRoot>/api/nonsense` *is* a route once the static plugin is
looking at that directory. Measured before the fix: `GET /api/nonsense` answered
`200` with the file's bytes, past the branch §0.3 asks for. The guard that
actually holds the namespace is `@fastify/static`'s `allowedPath`, refusing
anything `isApi` claims; the fallback's branch is what then produces the JSON.
One predicate, used at both points. `clientRoot` is a path an operator sets, so
what it happens to contain must not be able to decide what `/api` means.

**`wildcard: false` was in the first draft and is not in the last.** It was
there to make unmatched paths reach the fallback, and a mutation that flipped it
to `true` killed no test. Measured: both settings fall through to the fallback,
both serve every asset, and both let the shadowing above happen. It was a
plausible-sounding option justified by a comment nothing could check, so it is
gone and the plugin's default stands.

**A missing build is refused at startup**, because the plugin is not: measured,
`@fastify/static` pointed at a directory that is not there does not throw — it
finds nothing, serves nothing, and the server comes up answering the API behind
a blank page. `buildApp` checks for `index.html` and refuses with the path in the
message. The directory-exists check that suggests itself first is weaker: a build
step that silently produced nothing leaves the directory.

**The API's 404 body changed, deliberately and everywhere.** An unrouted `/api`
address used to get Fastify's `{statusCode, error, message}` — the framework's
default, which nothing had ever chosen, and which is not the `{error, message}`
shape [docs/api.md](../../api.md) documents. It is `404 {"error":"not-found"}`
now, in development and in a packaged build alike, and the API doc says so.

**One dependency, argued in [07 §7](../07-tech-stack.md) rather than noticed in a
lockfile**, per that section's own convention. `@fastify/static` is MIT, pinned,
first-party to Fastify, and the surface depended on is `root`, `allowedPath` and
`reply.sendFile`. Sixteen transitive packages, which is the largest addition so
far and is written down rather than glossed.

**A finding one level out, from a mutation that killed nothing.** Changing the
schema's `default` for a key made no test fail, because `DEFAULT_CONFIG` is a
separate hand-written literal and the literal is the only one ever read. Every
default in this codebase was written twice with nothing checking they agreed —
the fourth table in `config.test.ts`'s family, and the one nobody had noticed was
a table. There is a test now, over all twenty-three keys.

Nine mutations, nine red. Not covered here and named rather than implied: that
`pnpm dev` still runs two processes with Vite's proxy is [§3](#3-verification--the-p6a-exit-gate)
step 13, a person's check — what the suite proves is the server half of it, that
the default is *serve nothing*. And the real built client loading from the real
server is [§3](#3-verification--the-p6a-exit-gate) step 4; it was checked by hand
at this stage, against `pnpm build`'s output on a bound port, and the setup screen
rendered from one origin with no console error.

*The stage as it was written:*

> §1.3: `@fastify/static`, the `server.clientRoot` key with its five-place edit
> including [13 §4](../13-internal-contracts.md)'s table, and the SPA fallback
> branching on `isApi`.
>
> *Ends at:* one process on one port serving both halves — and `pnpm dev`
> unchanged, two processes, Vite proxying as before.

### P6A.2 — Safe: both halves of F10

§1.4's stored-and-checked token with its `state` advertisement and its client
field, and the cookie `secure`/`trustProxy` config. Both gated on a non-loopback
bind.

*Ends at:* a non-loopback server that refuses every route but the two
`survivesSetupGate` allows, and accepts the first admin only with the token from
its own log.

### P6A.3 — Identified: version, commit, stamp, changelog

§1.5's build-time embed reported by the running server, §1.7's data-directory
stamp, and the CHANGELOG with the entry convention
[releases §7](11-repo-and-releases.md) requires.

*Ends at:* a running server that names its own commit, and an older build that
declines a newer volume.

### P6A.4 — Released: image, compose, template, workflow

The `.dockerignore` that does not exist; a multi-stage build on a Node ≥26.4.0
base with corepack pnpm 11.18.0 (`.npmrc` is `engine-strict=true`, so a lower
base fails hard rather than warning); the `workspace:*` prune story; the `/data`
volume and the non-root user; `compose.yaml`, because
[04 §5.4](../04-server-multiuser-deployment.md)'s Tier 1 is *"image plus a
compose file"* and compose is therefore inside the deliverable rather than beside
it; the unraid template; and the on-tag workflow filtered to `v*`, publishing to
a **private** GHCR package.

*Ends at:* the demo.

#### The unraid template, specifically

Committed under `deploy/unraid/` with a short page in `docs/`, declaring the
`/data` volume, the port, the WebUI URL, the bind variable, and the project
links. Written now for two reasons: it is a thin wrapper over work this stage is
doing anyway, and writing it is what proves the image is actually installable
rather than merely built.

**It must say plainly that the package is private**, and therefore that the
unraid host needs a registry credential before the template will pull. An unraid
template whose image cannot be fetched is exactly
[04 §5.3](../04-server-multiuser-deployment.md)'s *"a template that only
half-works is worse than none"* — and the honest way to ship one against a
private registry is to say so at the top rather than to let it fail at install.

**Submitted to nobody.** [04 §5.3](../04-server-multiuser-deployment.md)'s
`[OPEN]` on the Community Applications store closes as a recorded deferral in
this phase, for [04 §5.4](../04-server-multiuser-deployment.md)'s own reason:
every package format is *"a recurring cost, not a one-time build"*, and a store
listing adds a moderated presence and a support thread to a project with one
maintainer and no users yet.

---

## 3. Verification — the P6A exit gate

Manual, numbered, and run against a build from a clean checkout at the tag — not
against the working tree, because a gate that passes on the developer's machine
state is testing the wrong thing.

1. **Tag and build.** `v0.1.0-alpha.1` exists; the on-tag workflow ran; a second
   build from the same tag produces an image that behaves identically.
2. **The trigger is filtered.** Pushing an unrelated non-`v` tag does not fire
   the release workflow.
3. **Fresh container, no volume.** Comes up reachable on the mapped port with no
   config file anywhere, having taken its bind from the documented variable.
4. **The UI is served.** The mapped port serves the client, not a 404, and an
   unrouted `/api/nonsense` still answers JSON rather than `index.html`.
5. **Refusal before setup.** Every route except `/api/auth/setup` and
   `/api/auth/state` refuses, from a non-loopback bind.
6. **The token is required and checked.** Setup with no token fails; setup with a
   wrong token fails; setup with the token from `docker logs` succeeds.
7. **A turn, from another machine.** Sign in from a host that is not the
   container's host and take a turn end to end.
8. **Identity.** The running server reports a version and commit matching the
   tag.
9. **Restart with the volume.** Stop, start again against the same volume;
   accounts, library and sessions are intact.
10. **The stamp refuses.** A build older than the volume's stamp declines to open
    it, with a message that says why.
11. **The template installs.** On unraid, with a registry credential configured,
    the template pulls, maps `/data`, and its WebUI button opens the UI.
12. **The package is private.** An unauthenticated `docker pull` fails. This is a
    gate step rather than an assumption, because the exposure decision is the one
    thing in this phase that is invisible from inside the repository.
13. **Development is unchanged.** `pnpm dev` still runs two processes with Vite's
    proxy, and `pnpm test`, `pnpm typecheck` and `pnpm lint` are clean.

---

## 4. Out of scope, deliberately

**Publication, and everything that rides with it.** The repository going public,
the AGPL §13 Source link, the About surface, the CA store submission, and the
no-carry-forward apparatus §1.7 replaced with a stamp. **These travel together
and must be taken together**: a public image obliges a public repository at the
same instant, because [04 §7](../04-server-multiuser-deployment.md)'s link has to
resolve for the person running it. The decision to publish is therefore a
decision to do all of it, and naming that here is what stops it from happening by
way of a registry visibility toggle.

**`nightly`, and moving `latest`.** [releases §4](11-repo-and-releases.md)'s
channels stay P11's. A nightly for a single-developer project is a build of a
tree already on that developer's disk.

**The other five packaging artifacts** — the tarball and its systemd unit,
`.deb`, AUR, the Windows service, the Homebrew tap. P11's, per §1.8.

**mDNS, the notification router, the gallery, the remainder of
[05 §15](../05-ui-surfaces.md).** P10's, per §1.8.

**Reproducible builds in the strict bit-for-bit sense.**
[01 §8](01-work-plan.md) asks for them at the beta bar. This phase asks only that
two builds of one tag behave identically, which is gate step 1.

**Migration machinery.** §1.7's stamp refuses; it does not convert.

---

## 5. The one thing left open

**Whether Alpha 1 is cut before PLAYABLE has run.**
[P6 §0.3 and §5](08-p6-implementation.md) still list PLAYABLE as outstanding, and
[01 §4.1](01-work-plan.md) calls it the milestone that matters more than beta
does.

Being private defuses the sharp version of this. [01 §4.1](01-work-plan.md)
defines PLAYABLE as explicitly *not something anyone else installs*, so cutting a
private, undistributed build first reorders nothing that document cares about —
and there is a case that a one-command install makes PLAYABLE easier to actually
sit down and do, which is the failure mode that has kept it outstanding through
two phases.

So the rule this document sets is the weaker, true one, rather than a date:

> **Alpha 1 may be cut before PLAYABLE. It does not go public before it.**

Which is the same rule §4 states from the other side, and the reason both are
written down.
