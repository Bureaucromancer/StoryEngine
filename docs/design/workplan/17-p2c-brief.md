# 17 — P2C, the tester's brief

**What a person needs in front of them on the day, and nothing they can work
out for themselves.** [P2C](15-p2c-first-real-run.md) says what the phase is
for and what had to be repaired first; this says what to type, where to look
when something breaks, and — the longest part, and the point — **what not to
report**.

Five obligations in [P2C](15-p2c-first-real-run.md) point here: the model
constraint ([§1.7](15-p2c-first-real-run.md)), the line about what `pnpm test`
covers ([§1.5](15-p2c-first-real-run.md)), the log capture recipe
([§1.3](15-p2c-first-real-run.md)), the half-page of things present but
unreachable, and the list of things already checked and found sound
([§4](15-p2c-first-real-run.md)'s preamble). They are all below.

**Written against the source, not against the plan.** Every claim here was
checked in the code, and the checking found four things the plan had wrong —
including one defect, in a key added the day before. That is the argument for
the method rather than a boast: a brief assembled by reading the phase document
would have carried its errors into the one place they cost the most, because
**the function of this file is to direct and withhold a person's attention.** A
wrong *do not report* sends somebody past a real bug. A wrong *this is broken*
spends a day of a three-day phase.

---

## 1. Before the day

**A key, and a bound.** A pay-as-you-go key created for this and deleted
afterwards, with **a few dollars** on it — [P2C §2.7](15-p2c-first-real-run.md).
There is no per-turn cap, no token cap and no request cap anywhere in the code,
so the bound is the key. The cheap model does most of the work: the scenarios
ask whether a turn completes, is recorded, resumes and reports its cost, not
what it wrote.

**Two endpoints, because they fail differently** — one hosted, one local
runtime ([§2.3](15-p2c-first-real-run.md)). The local one is primary: it is the
case with a single model slot, and two sessions at once against it is a
scenario.

**A stranger, arranged in advance.** [P2C.1](15-p2c-first-real-run.md) is
thirty to sixty minutes that only work once, and the tester is the person who
built this. Borrow a non-author for forty-five minutes with the README and a
URL and nothing else, and watch silently while writing. Failing that, write
down in advance what you expect each screen to do, and treat every divergence
as a finding — a prediction made before looking is the closest an author gets
to not knowing.

**The scenario list, closed.** [12 §2](12-p2-manual-gate.md) is the list and it
is not added to during the phase. [P2C.1](15-p2c-first-real-run.md) and the
long pass are the deliberately unscripted halves; the scripted pass is not the
place to follow a hunch.

**Three days**, and the phase ends when the scripted pass has run end to end
with no fix landing in the middle of it. If a fix lands, the pass is re-run
rather than ticked.

---

## 2. The runbook

Every command here was run. Where something does not work the way the obvious
reading suggests, that is called out rather than smoothed over.

### 2.1 Once, on a clean clone

```bash
pnpm install
pnpm build
```

**`pnpm build` is not optional and is not only a bundler.** The server, the
seed script and the test suite all import `@storyengine/shared` through its
built output, so an unbuilt workspace fails to resolve it. `pnpm typecheck`
also satisfies this — both run `tsc -b`, which emits. The README's
`pnpm install && pnpm typecheck && pnpm lint && pnpm build && pnpm test` is
load-bearing in that order, not stylistic: the boundary lint rules resolve
imports through built entry points, so linting an unbuilt workspace passes for
the wrong reason.

### 2.2 A session, from nothing

Three terminals, in this order. Stop the server before the first command.

```bash
pnpm reset-data
```

```bash
pnpm seed
```

```bash
pnpm dev:logged
```

```bash
pnpm dev:client
```

Then open **the client, at `http://127.0.0.1:5173`** — not the API on 8080.
The server prints its own address under the key `api`; that one serves no
files and pointing a browser at it is not useful.

`pnpm seed` signs you in as **`ned`**, password **`correct horse battery`**, and
leaves a lorebook (*Rain City*), an actor (*Mara Vance*), a treatment (*A wet
week*) and a session named *A wet week* with Mara in its cast. It is idempotent
— run it twice and you get the same install, not a second copy.

**It deliberately does not create a connection or a binding.** Those carry a
real key and belong to the person. So there is an irreducible hand step between
`pnpm seed` and a turn: Settings → Connections → add the endpoint and key →
answer the two-picker binding form that appears on a first connection.

### 2.3 The traps, all measured

- **A relative `--data` means the same directory to both scripts**, and did not
  until this brief was written. `dev:logged` spawns the server with its working
  directory in `packages/server`, so `--data ./scratch` landed at
  `packages/server/scratch` while `pnpm reset-data --data ./scratch` — typed at
  the same prompt a second earlier — meant `./scratch`. A person reset one
  install and ran against another, and nothing said so. Fixed and tested;
  mentioned only because a scratch install is how both endpoints get tested and
  it is worth knowing the two commands agree.
- **`pnpm dev:server` cannot be pointed anywhere.** The package script hardcodes
  `--data ../../data` and the server rightly refuses the flag twice, so it
  answers *`--data` was given more than once* — and because it runs under
  `tsx watch`, the process stays alive and the terminal does not come back.
  `pnpm dev:logged --data <absolute path>` is the only working route to a
  scratch install.
- **`pnpm dev:logged` does not watch, does not build, and does not start the
  client.** Editing server source during a logged session means stopping and
  restarting it by hand — and each restart opens a *new* dated log file, so one
  sitting's evidence can end up split across several.
- **Do not copy `config.example.json` to `data/config.json` unedited.** It
  carries `//` comments, JSON does not, and the server refuses to start on it:
  *not valid JSON*. Use Settings → Install, or copy it and strip every comment
  line. The README told people to copy it verbatim until this brief was written.
- **If you change the port, the client will not follow.** Point it explicitly:
  `SE_API=http://127.0.0.1:9090 pnpm dev:client`, and `SE_CLIENT_PORT` moves
  Vite's own. Both existed and were documented nowhere until this brief was
  written.
- **The suite holds up to about four concurrent runs, measured — do not run
  more.** A test here can fail under machine load for reasons that have
  nothing to do with the code, and a load-flake teaches re-running instead of
  reading. One `pnpm test` at a time during a session is the habit.
- **`pnpm test` is not a build and not a gate.** It is `vitest run` and nothing
  more. It does not typecheck (vitest strips types without checking them), does
  not lint, does not run Prettier, does not emit the JSON Schemas or check that
  the committed ones are current, and does not build the client bundle. A green
  suite is not a green build.

### 2.4 Keeping the evidence

**The log.** `pnpm dev:logged` copies the server's stdout to
`./logs/server-<date>.log` as well as to the terminal, and every line of that
file is a JSON record. Use it and not `pnpm dev`: pnpm's recursive reporter
prefixes each line with `packages/server dev: `, which leaves nothing parseable.

To pull one turn's whole lifecycle:

```bash
jq -c 'select(.sessionId == "<session id>")' logs/server-*.log
```

Request timing needs two lines, not one: Fastify writes an *incoming request*
record carrying `req.url` and a *request completed* record carrying
`responseTime`, and they share only `reqId`. Correlate on that.

**The cassettes.** `pnpm dev:logged` also records every provider exchange to
`./captures/<the same stamp as the log>` — request, response, and the streamed
body byte for byte, with the key and the host redacted. **The rendered prompt
is in there**, which is the user's prose: record against the seeded library,
and know that `captures/` is gitignored for exactly this reason.
`--no-capture` turns it off. To curate one into the committed corpus at
P2C.2: copy it to `packages/server/src/providers/fixtures/`, read it once
yourself for anything the redactor could not know about, add a `meta.expect`
naming what the replay test should assert (finish reason, error class, usage),
and commit. The mid-stream-cut breakage files as a *partial* cassette — that
is its recording, not a recorder failure.

**A snapshot.** There is no script for this — it is three steps and they matter:
stop the server, then copy the **whole** data directory including the `-wal` and
`-shm` files. `index/` is derived and disposable; `state/`, `accounts.json` and
`users/` are authoritative and are not. A finding whose state is gone is one
somebody will re-derive from scratch.

**A finding.** Five lines, template and rules in
[16 — the findings log](16-p2c-log.md). Write `expected` **before**
investigating: the gap between what you thought would happen and what did is
most of what this phase is for, and it stops being visible the moment you
understand the cause.

---

## 3. What not to report

**The longest section, and the one that decides whether the log is findings or
rediscoveries.** Everything here is known. If you hit it, it is not a finding —
unless it is *worse* than described here, which is worth a line saying so.

### 3.1 There is no way to make anything

- **No "New ⟨anything⟩" control exists anywhere in the app.** Not for actors,
  lorebooks, treatments, personas, presets or packages. The library is a list
  and a read-only detail page.
- **One side door does create an object**, and it is worth knowing so it is not
  reported as a bug: provoke a save conflict on an actor and the dialog's *save
  as a copy* posts a brand-new actor with a fresh id and a *(copy)* name.
- **`pnpm seed` and `curl` are the ways to create things.** That is the
  documented position ([`docs/api.md`](../../api.md)), not an omission.
- **A session's cast cannot be set from the browser at all.** `POST /api/sessions`
  accepts `mode` and `cast`, and the client sends `{ name }` only;
  `PUT /api/sessions/:id/cast` has no client caller and its only caller in the
  repository is the seed script. **So every session you start from the UI runs
  with no cast and the default mode.** Use the seeded *A wet week* session, or
  `curl`, if you want an actor in the room. This is the single most consequential
  item on this list.

### 3.2 There is no way to remove or reorganise anything

- **Sessions cannot be deleted from the UI.** The route exists and has no client
  caller at all — no wrapper, no hook, no button.
- **Sessions cannot be archived either**, and this is not in the phase document's
  list. `PATCH /api/sessions/:id` toggles `archived` and
  `GET /api/sessions?archived=true` lists them; neither has a client caller.
- **Sessions cannot be renamed**, and not because a button is missing: no route
  accepts a session name after creation. The `PATCH` body schema is
  `{ archived: boolean }` with `additionalProperties: false`, so a rename is
  refused at the door.
- **Library objects cannot be deleted from the UI.** Route, no caller.
- **Actors *can* be renamed** — the phase document says otherwise and it is
  wrong. The actor editor's Name field saves. What does not happen is the folder
  moving: a slug is fixed at creation and a rename never changes it, so a
  renamed actor keeps its old directory name on disk. **That divergence is
  deliberate** and is the thing to look at, rather than the rename.
- **Nothing else can be renamed**, because nothing else has an editor. The actor
  editor is the only one in the app.

### 3.3 Routes with no way to reach them

Each of these is implemented and tested and has no client caller. None is a
defect; all belong to later phases.

| Surface | Whose it is |
|---|---|
| `GET /api/search` | P3's |
| `GET /api/library/errors` | The error card, deferred at [§1.7](15-p2c-first-real-run.md) |
| `POST /api/admin/accounts/:handle/password` | An admin cannot reset another person's password from the screen |
| `PUT /api/admin/bindings` | Per-role assignment. The **only** binding write reachable from the UI is the one-time first-run defaults form. The `curl` route rewrites the *whole* document — a subset body wipes the rest, intentionally |
| `PUT /api/sessions/:id/cast` | §3.1 |
| `DELETE /api/sessions/:id`, `PATCH …/archived` | §3.2 |
| `layout.memoriesRoot` | P8's. Nothing reads it either — the directory is never created |
| Branching | A `branch_id` column that is present, indexed and permanently null. No route |

`canRestart` on `GET /api/admin/notices` is fetched, typed and never read. That
is deliberate: a restart control under no supervisor is worse than a notice
saying so.

### 3.4 What a failure looks like, and it is not much

**This is the most likely thing to be reported repeatedly, and it is
[§1.7](15-p2c-first-real-run.md)'s deliberate deferral.**

- A failed turn renders exactly **"This turn did not finish."** No class, no
  reason, no remedy. The classification is already on the wire and in the
  reducer; showing it is the second thing fixed after the phase.
- **A cancelled turn and a failed turn are indistinguishable on screen** — same
  sentence, same styling. A suspended one renders no note at all.
- **Why it failed is visible only by opening the *Turn record* disclosure**,
  which is raw JSON in a `<pre>`. That is also deliberate: the workbench that
  renders it properly is P3's, and building a nicer one here would be building
  P3 badly.
- **A refused submission produces no visible change whatsoever.** A 409 *busy*, a
  412 *stale head* or a 5xx leaves the draft text in the box, the button
  unchanged, and nothing announced. Reproduce with two tabs on one session.
- **Stop is fire-and-forget.** It does not disable, does not change label, and a
  409 or 404 from it produces nothing on screen.
- **There is no retry control.** After a failed turn the only recovery is to type
  something else and send it, or reload.
- **There is no progress, no step display and no spinner.** The server emits ten
  progress events — `turn.started`, `step.started`, `step.skipped`,
  `step.finished`, `step.failed`, `call.started`, `call.streaming`,
  `call.finished`, `effect.applied`, `turn.finished` — and the client renders
  none of them. Between Send and the first delta the only feedback is the
  disabled input and the Stop button.
- **A recovered turn is shaped differently, on purpose.** A turn recovered
  after a crash carries `steps: []` and no `cost` — the last checkpoint is all
  there was, and inventing the rest would be fabrication. Do not report the
  shape; report only if the *content* the checkpoint should carry is missing.
- **An in-flight turn is broadcast as `failed` from its first write.** That is
  the recovery contract — a draft that says `failed` until proven otherwise
  cannot be lost as `running` — and the client renders from the live stream,
  so you will only ever see it in raw reads of the store or the wire. Known,
  not a bug.
- **A broken library file is silent in the app.** It is *not* silent in the log
  any more — `library.invalid` is written at `warn` with the file's path — but no
  screen shows it, so the app presents stale content as current, then refuses
  the save with a conflict dialog blaming an editor who does not exist —
  **and the refusal loops**: the 412 hands back the very hash you just
  presented, so *reload and reapply* cannot terminate. The object stays
  unwritable from the app until the file on disk is fixed by hand. Known —
  finding 8, deliberately deferred with the error card — and the first thing
  fixed after the phase. Fix the file in the editor you broke it with.

### 3.5 Already checked, do not spend session time

- **Slug derivation** handles Windows reserved names, CJK-only names and case
  collisions.
- **Session tokens** are fourteen-day signed cookies against a persisted key
  file, so expiry will not bite mid-phase, and a wiped data directory lands a
  stale cookie on the setup form rather than a broken screen.
- **CSRF** is double-submit and the client echoes it on every mutation. Setup,
  login and logout carry no token deliberately — they carry no ambient
  authority, and `SameSite=Lax` covers login.
- **A turn cannot run up a bill.** Three provider calls maximum: one, plus two
  retries at 250 ms and 1 s, and a retry is refused once any text has streamed.
  *One caveat worth knowing:* the runner enforces no counter. The bound comes
  from the one shipped mode having one step that calls once — it is a fact about
  today's mode, not a cap.
- **The session-read cost is already measured** and does not need re-measuring:
  4.8–17.7 ms flat from 13 to 55 turns. What grows is the payload — about
  10.8 KB per turn, 590 KB at 55. `?limit=1` works and is cheap.
- **The watcher's `awaitWriteFinish`** is set: 150 ms stability, 20 ms poll.
  *Caveat:* no test covers the production value — every test overrides it — so
  "a real editor writes differently from `fs`" is still a live scenario.
- **SSE framing is somebody else's tested code.** The adapter never touches
  bytes. `[DONE]`, interleaved keepalive comments, seven-byte chunking that
  splits JSON mid-object, CRLF, and a usage-only final chunk are all covered.
  Spending session time here is spending it on the one part of the boundary that
  is already tested.

---

## 4. The model constraint

**Every request this build sends carries exactly this**, and no configuration
changes it:

```json
{ "model": "…", "max_tokens": 800, "temperature": 0.85, "messages": [ … ] }
```

plus `stream_options: { "include_usage": true }`, because the shipped mode
always streams.

- **It is `max_tokens`, not `max_completion_tokens`.** The mapping is a fixed
  literal in the adapter. There is no per-connection parameter dialect, and the
  connection's *What this endpoint can do* override does not reach it — that
  surface feeds capabilities, never the request body. Changing the wire name
  today means editing the adapter, which is the work
  [§1.7](15-p2c-first-real-run.md) deliberately defers.
- **So: use models that accept `max_tokens` on a chat-completions endpoint.**
  Reasoning-family models on OpenAI's own API reject it in favour of
  `max_completion_tokens` and are out of scope for this phase. Verify against
  your provider's current documentation rather than against this sentence, and
  **write down what you actually used** — the known-good list is an output of
  P2C.1, not an input, and there is no list anywhere in the repository yet.
- **`temperature` is sent too**, and the phase document's constraint names only
  `max_tokens`. A model list vetted for one and not the other is an incomplete
  list.
- **`stream_options` is on every single request.** The adapter argues it is
  harmless where unsupported, which is an assumption about endpoints rather than
  something the code can enforce. Worth one deliberate look.
- **A rejected parameter looks like everything else.** On screen: *This turn did
  not finish.* In the record: the class `terminal` — indistinguishable from a bad
  key, a wrong model id or any other 400. **The provider's own words appear only
  in the log.** A tester who does not know to grep `logs/server-<date>.log` by
  session id cannot tell a parameter rejection from any other terminal failure.
  That is the operating fact this brief exists to hand over.

**Capabilities, for reading the record.** Only the `openai-compatible` provider
can be built, so every real call runs with `supportsTools` false,
`supportsStructuredOutput` false, `supportsStreaming` true, `reportsUsage` true
and no `maxContextTokens` — which means the budget window comes from
`limits.contextTokens` (8192) unless the connection's capability override sets a
real one. On a local runtime with a 4k window that will over-budget, and on one
with 128k it throttles to a sixteenth. Set the override; it is the field the
form calls *Context window*.

---

## 5. The rules

**Triage — every finding gets exactly one home, decided by rule and decided
now** ([§2.5](15-p2c-first-real-run.md)):

| Where | The rule |
|---|---|
| Stops the phase | It means the observations already made were of a broken system |
| Fixed inside the phase | It blocks a later scenario, or it is a defect in something this phase's own stages built |
| A gate correction | An exit-gate step describes behaviour the code does not have |
| [Polish](09-polish.md) | User-facing, bounded, no schema change, no new contract |
| [PLAYABLE](01-work-plan.md) or [roadmap](../14-roadmap.md) | Whether the record is legible or the budgeter comprehensible; or a deferred feature |

**Nothing is allowed to have no home**, and that is the last step of the gate and
the one most likely to be skipped.

**One thing stops the phase, and it is not a defect.** Stop only when a finding
means the observations *already made* were of a broken system — the adapter
mangling every response, the index not reflecting writes, a session losing
turns. Then fix first and re-run the scenarios already run, because their
results are worth nothing. Everything else is recorded and the session
continues: a tester who stops to fix loses the state that produced the next
finding, and the next finding is usually the better one.

---

## 6. What the gate needs you to have written down

[§4](15-p2c-first-real-run.md) is the full list. These are the ones that produce
nothing unless somebody writes a number down while they are there:

- **Two turns from two empty data directories**, one hosted and one local, with
  no file hand-edited.
- **Both turns' `usage` and `cost`.** Open *Turn record* and read
  `request.calls[0].usage.promptTokens` and `.completionTokens` — integers — and
  `request.calls[0].cost`, which must be `null` and never `0`. No price table
  ships and the adapter refuses to fabricate a number; a `0` there is the
  fabrication.
- **`request.calls[0].resolved.modelId`**, against the model the binding asked
  for. *Caveat:* on an endpoint that echoes no model id the adapter falls back
  to what was asked for, silently — so a match is not proof unless you know the
  endpoint reports one.
- **Five deliberate failures, five classifications:** a wrong key, a model id
  that does not exist, an endpoint returning HTML, the network cut mid-stream,
  and **a completion ceiling of ten tokens** — which has no UI and is set by
  hand-editing the session's own `preset.params.maxTokens` in `session.json`.
  A created session carries a full inline preset, so this is a one-line edit.
- **The token estimator's calibration**, ten turns plus one code-heavy or
  non-English session. Both figures are already on the record: `request.budget`
  holds the estimate and `request.calls[0].usage.promptTokens` the reported
  number. Ratio is reported over estimated. **This phase is the only opportunity
  before P5 budgets against that number.**
- **A session long enough to be boring** — forty turns — with the server's
  memory before and after, and a session read still answering as fast as it did
  at turn one.
- **The index rebuilt.** Stop the server, delete `index/`, start it again; the
  library and the session read identically. Delete the directory, not its
  contents. Do not touch `state/`, `accounts.json` or `users/`.
- **The three unstick sentences read as a person**: the dead-end warning and the
  removal dialog on Settings → Accounts, and the restart banner (change a
  `restart`-tier key such as `server.port` in Settings → Install to raise it).
- **`pnpm test` green on ubuntu, watched, and the summary line quoted.**

---

## 7. What is still open, honestly

This brief is P2C.0 work and P2C.0 is not finished. Known to be outstanding as
of writing:

- **The library error card** and **a failed turn saying why on screen** — both
  deferred deliberately at [§1.7](15-p2c-first-real-run.md), both first in line
  after the phase. Listed again here because they are the two things a tester
  will want most.
- **~~The cassette corpus has no capture machinery.~~ The recorder is built**
  and on by default under `pnpm dev:logged` (§2.4). What remains is genuinely
  the phase's output: the curated corpus itself, and the replay block in
  `openai-compatible.test.ts`, written when the first real cassette lands.
- **The bindings surface**: per-role assignment is a one-time first-run form and
  nothing else.
- **~~[12 §2.1](12-p2-manual-gate.md) is stale~~ Rewritten** against the UI
  that exists — the connections form, the first-run binding offer, and the
  resolver-backed dead-end count.
- **~~[P2C §1.2](15-p2c-first-real-run.md) reads as though nothing landed~~
  Struck through**, all five, each with what actually shipped. The gate steps
  it made look unpassable are annotated where they stand.
