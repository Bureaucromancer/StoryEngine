# 14 — P2C findings log

**Status: historical, closed to new entries.** [playable log](21-playable-log.md) is its
successor and takes anything found from 2026-09-07 onward.

**One obligation is still open and is carried elsewhere:** the Triage table at
the foot of this file has a heading and no rows, and its fourteen findings still
need homes. That obligation lives at [manual testing §10](05-manual-testing.md), not here —
this file's own rule is that it is not a queue.

**Appended to as things happen; emptied by [P2C.4](12-p2c-first-real-run.md)'s
triage; kept afterwards rather than deleted.** What a person saw the first time is
not reconstructible later, and it is the one artifact a second pass cannot
produce — a second pass is by definition made by somebody who already knows.

**This file is not a queue.** Nothing is fixed *because* it is written here.
[P2C §2.5](12-p2c-first-real-run.md) decides where each entry goes, and the
decision is made at triage rather than at the moment of annoyance, because
afterwards every finding argues for its own importance.

---

## How to write one

Five lines, in this order, so a finding arrives as a record rather than as prose.
The first three are what make it reproducible; the last two are what make it a
finding rather than a feeling.

```
build     git describe --tags --always --dirty
endpoint  the provider and the model, or `fake`
session   session id, and turn id if there is one
expected  what you thought would happen, written *before* looking further
observed  what did, including the log line if there is one
snapshot  path to a copied data directory, or `none`
```

**`expected` before `observed`**, and written before investigating. A finding
recorded after the diagnosis is a finding shaped by it, and the gap between what
somebody expected and what happened is most of what this phase is for — it is the
part that stops being visible the moment you understand the cause.

**`snapshot` is a real path or the word `none`.** [P2C §1.4](12-p2c-first-real-run.md)
buys the procedure: stop the server, copy the whole directory including `-wal` and
`-shm`. A finding whose state is gone is one somebody will re-derive from scratch.

---

## Sessions

*Each session gets a heading with its date and which stage it belongs to.
Findings go under it in the order they happened, not in order of importance —
the order they happened is data, and reordering by importance discards it.*

## 2026-08-23 — P2C.0, the smoke run

**Not a person's session, and the log's own ordering rule cannot be honoured
here.** [P2C.0](12-p2c-first-real-run.md) asked for two hours of hand-driving
whose output was a *reordering*. What was run instead was automated: fifty-seven
turns across the whole stack on a scratch install, against a local endpoint
speaking the streaming chat-completions API — setup, first admin, a connection,
a binding, a session, turns, SSE reattach, a force-killed server, a second
account, five deliberate breakages, a cancel, hand-edited library files and a
live teardown.

So there is no order-they-happened to preserve: the run was a matrix, not a
narrative. Entries are grouped by **when a person would hit them**, which is the
question the reordering was for. Where an entry was reasoned from source rather
than reproduced, it says so.

**`expected` is written from what the plan or the design says should happen**,
which is the closest thing available to a prior belief when the driver was not a
person.

---

### 1 — A turn's own token counts read `0`, not null

```
build     p1-106-g5881765
endpoint  local stub, streaming
session   every turn in the run
expected  [22 §1.4] calls usage provider-reported, not estimated — so with no
          usage the record should say it has none
observed  Turn.cost.promptTokens: 0, completionTokens: 0. ModelCall.cost is
          correctly null one level below.
snapshot  none
```

`costOf` filters to calls that reported usage and reduces to `0` over the empty
list, and `TurnCost` types both fields non-nullable. **Gate §4 step 2 looks at
the wrong level** — it eyeballs `ModelCall.cost`, which is honest, while the
fabricated zero is on the turn. A zero that means *nobody counted* is exactly
the fabrication that step exists to catch.

### 2 — A cancelled turn records no model call at all

```
build     p1-106-g5881765
endpoint  local stub, streaming
session   cancel mid-stream
expected  a record of the call that was interrupted, per the killed-turn todo
observed  request.calls: [], cost {0, 0, 0, model: ''} — no connection id, no
          model, no wall time. The prose and the step outcome are kept.
snapshot  none
```

`Cancelled` is thrown before the `CallFailed` that carries the call record.
**Stop is the most-pressed button in a manual phase against real latency**, so
the failure a tester produces most often is the one the record says least about.
Already known as the suite's one `todo`; now with the record printed.

### 3 — History attributes the player's own prose to the assistant

```
build     p1-106-g5881765
endpoint  local stub
session   any session past turn one
expected  history turns carry real user and assistant roles — [P2C §5] said so
observed  every completed turn is one merged block labelled `assistant`, and it
          contains the player's own words
snapshot  none
```

**Invisible on screen and only visible on the wire**, which is why it survived a
survey, four phases and six audits — and why [P2C §5](12-p2c-first-real-run.md)'s
*already checked and found sound* list carried it as a reassurance until this
run. That entry is now removed.

Not a rename: the one-block-per-turn shape is deliberate, because the budgeter's
only move on one large block is to drop all of it. Splitting into two doubles the
candidate count, so this is a decision.

### 4 — The composer looks fully editable while it is disabled

```
build     p1-106-g5881765
endpoint  local stub, streaming
session   the whole of every streaming turn
expected  a disabled control looks disabled
observed  identical to enabled. The shared control class has no `disabled:`
          variant of any kind.
snapshot  none
```

Reintroduces the original blocking item's symptom — *a box that does nothing when
typed into* — on the same control, in the state a tester spends the entire phase
in. A report of it will read as a regression of the palette fix and is not one.

### 5 — A bad key reports as an unreachable endpoint

```
build     p1-106-g5881765
endpoint  local stub, and a dead port
session   POST /api/admin/connections/models
expected  a wrong key and a dead port are different problems and say so
observed  both answer 502. Bad key: "That endpoint did not answer with a model
          list." Dead port: "That endpoint could not be reached."
snapshot  none
```

**The one thing an operator actually gets wrong reads as a network problem** —
and *add a connection* is P2C.1's third step.

### 6 — `capabilities` is the only lever for the context window, and it is invisible

```
build     p1-106-g5881765
endpoint  n/a
session   setting up a connection
expected  a per-connection context window is settable somewhere a person looks
observed  it works end to end — a 4096 override lands — but it is absent from
          docs/api.md's documented body and there is no client field. Found by
          reading routes/connections.ts.
snapshot  none
```

P2C.1's own stated signal is *"every point at which you consulted the source
instead of the screen"*. This is a guaranteed one, and it corrects
[§1.2](12-p2c-first-real-run.md)'s *"no way to say otherwise"*: the mechanism is
there, the surface is not.

### 7 — Transient failures classify as terminal, and the retry never fires

```
build     p1-106-g5881765
endpoint  local stub: refused connection, and a mid-stream termination
expected  a transient failure retries — that is what the retry ladder is for
observed  ECONNREFUSED and "terminated" both miss the classifier's transient
          regex and land `terminal`. **The retry ladder was not observed to fire
          once across six deliberate failures in two independent runs.**
snapshot  none
```

This half-refutes [§1](12-p2c-first-real-run.md)'s downgrade note that
classification *does* work on the non-streaming path. It classifies — into the
wrong bucket, for the one case retry exists for.

### 8 — A broken library file becomes permanently unwritable *and* undeletable

```
build     p1-106-g5881765
endpoint  n/a
session   hand-edit an object into invalid JSON while the server runs
expected  [P2C §1.7] predicted "a conflict dialog blaming an editor who does not
          exist"
observed  worse and differently shaped: three successive writes each returned
          412 stale where `current.contentHash` was byte-identical to the hash
          just presented, so the documented reload-and-reapply recovery cannot
          terminate. DELETE with If-Match gets the same 412. GET /api/library
          keeps serving the stale hash as current. The only exit is a text
          editor.
snapshot  none
```

*Mechanism confirmed reachable — [manual gate §2.1](11-p2-manual-gate.md) step 8 tells the
tester to do exactly this — but the loop was not reproduced end to end in this
run.*

> **Reproduced and fixed at P4.0, 2026-08-30**, before the triage below ran —
> [P4 §2](16-p4-implementation.md) asks for it, because import walks this path in
> bulk and a wild-corpus object that lands broken goes straight into it. The
> mechanism was exactly as written: `update()` compared the on-disk bytes against
> the index row and threw `stale` carrying that same row, so the 412's
> `current.contentHash` was the hash the caller had just presented. `remove()`
> ran the identical check, which is what made the file undeletable as well.
>
> The repair turned on splitting a case that had been one: *the file changed* and
> *the file broke* were both answered `412 stale`. Now bytes that still **decode**
> keep the 412 — and its envelope describes the file rather than the index row,
> so the hash differs from the one presented and reload-and-reapply works
> immediately rather than after the watcher settles, which is better than the
> behaviour the finding was written against. Bytes that do not decode answer
> **`409 diverged`**, because 412 *means* reload-and-reapply and no amount of
> better prose makes a loop terminate. `remove()` takes the same split, so a
> readable hand edit still protects the object from deletion while damage no
> longer traps it.
>
> Five tests, in `routes/diverged.test.ts`, including the invariant behind the
> whole thing: **a 412 never answers with the hash the caller sent.** That one is
> written as a property of the status code rather than of this route, so the loop
> cannot be reintroduced from somewhere else.
>
> *This row still wants its triage line.* The finding is discharged, but P2C.4
> has not run, and the table below is filled by that session rather than by this
> one.

### 9 — The teardown takes `config.json`, and the next start says nothing

```
build     p1-106-g5881765
endpoint  n/a
session   rm -rf the data directory while the server is running
expected  a half-teardown, with the index surviving — [§1.4] says so
observed  both SQLite stores survive, including `state/`, which [22 §5.1] says
          is not disposable — while its own signing key, a plain file beside it,
          does not. And `config.json` goes, so the next start silently reverts
          to the 8080 default with `fileFound: false` and no warning.
snapshot  none
```

### 10 — Crash recovery works, and the recovered record is shaped differently

```
build     p1-106-g5881765
endpoint  local stub, streaming
session   force-killed mid-stream, restarted
expected  the partial turn is recorded failed and the session is usable
observed  it is: {finalised: 1, abandoned: 0}, partial prose intact. **But the
          recovered record has no `cost` field at all and `steps: []`.**
snapshot  none
```

Consistent rather than broken, and worth knowing **before** somebody files it as
a bug in the middle of a session.

### 11 — An in-flight turn is broadcast as `failed`

```
build     p1-106-g5881765
endpoint  local stub, streaming
session   any turn, while running
expected  a running turn does not describe itself as failed
observed  `turn.status: "failed"` on the wire alongside `job.status: "running"`
snapshot  none
```

Deliberate on disk — the runner argues it as the recovery contract, *the turn as
it would be written if it ended now* — and unqualified on the wire to any client
reading `turn.status`.

### 12 — The brief's first instruction names a route that does not exist

```
build     p1-106-g5881765
endpoint  n/a
session   step 3 of the end-to-end path
expected  GET /api/auth
observed  404. It is /api/auth/state.
snapshot  none
```

Ten seconds, and it is the first thing the brief asks a tester to do.

### 13 — [manual gate §2.1] step 2 sends the tester to a screen that does not exist

Rename artifact: the step reads *Treatments → Administration*. It matters out of
proportion to its size, because step 2 exists to make the tester read
[09 §4.5](../09-server-multiuser-deployment.md)'s commissioned dead-end sentence
— one of the three unstick sentences gate §4 step 10 requires a person to judge.

### 14 — Already answered: the session-read measurement [§1.7] deferred

```
build     p1-106-g5881765
endpoint  local stub
session   one session, 57 turns
expected  the O(n) re-parse might make long sessions unusable
observed  session read 4.8–17.7 ms, turns read 5.3–27.7 ms, **both flat from 13
          to 55 turns**. Server RSS 103.7 MB after 57 turns.
snapshot  none
```

**The re-parse is not a latency problem at this size, and gate §4 step 7 already
passes at 57 turns.** What grows is the payload: `GET /turns` returns the whole
transcript, 63 KB at 13 turns and 590 KB at 55, about 10.8 KB per turn.
Per-record size plateaus around 13 KB because the history window caps at twenty.
`?limit=1` works and is cheap.

*Do not spend session time re-measuring this.* [§1.7](12-p2c-first-real-run.md)
asked for the measurement before the fix, and this is it.

---

---

## Triage

*Filled at [P2C.4](12-p2c-first-real-run.md). Every finding above gets exactly one
row, and the phase does not end while this table is shorter than that list.*

*Run 2026-09-09 at [P6B.3](20-p6b-playable.md), sixteen days late and by
reading the code rather than by re-walking. **Every row below is a claim about
this build**, checked against the file and line named; none is a memory of a
fix. Where a finding turned out to be fixed, the row says where the fix lives
so the claim can be refuted.*

| Finding | Home | Why |
| --- | --- | --- |
| **1** — token counts read `0`, not null | **Fixed in a later phase** | `turns/runner.ts:855`. `costOf` now counts only when *every* call reported usage and returns `null` otherwise; `TurnCost` takes the nulls. The fabricated zero is gone |
| **2** — a cancelled turn records no model call | **Fixed in a later phase** | `turns/runner.ts:700` finalises the call a `Cancelled` carries, and the comment names this finding. The bare case survives on purpose — a Stop *between attempts* genuinely has no call — and restamps the provisional instead (`:717`) |
| **3** — history attributes the player's prose to the assistant | **Fixed in a later phase, and it was the decision this row said it would be** | `assembly/collect.ts:414-417`. The finding argued the one-block-per-turn shape was deliberate and splitting it *"a decision"*. It was taken: two halves at one priority, so a turn is still one unit to the budgeter, and the tie-break puts the reply before the prompt it answered |
| **4** — the composer looks editable while disabled | **Fixed in a later phase** | `client/src/ui/classes.ts:118` — the shared `control` string carries four `disabled:` variants |
| **5** — a bad key reports as an unreachable endpoint | **Fixed in a later phase** | `routes/connections.ts:320` answers **401 *That endpoint refused the key*** for 401/403, which is a different status and a different sentence from the 502 |
| **6** — `capabilities` is the only lever for the context window, and invisible | ~~**[P7](23-p7-implementation.md)**~~ **Fixed in a later phase. Corrected 2026-09-10** | ~~Still true: `routes/connections.ts:54` takes an open object, and nothing in `packages/client` or `docs/api.md` names `contextWindow`.~~ **This row searched for a name that does not exist.** No identifier `contextWindow` appears anywhere in the repository; the field is `maxContextTokens` (`providers/types.ts:74`), and it has a labelled control at `client/src/settings/AdminConnections.tsx:225-236` with `capabilitiesFrom` merging rather than replacing at `:795-815`, covered at `AdminConnections.test.tsx:523-557`, declared at `client/src/api.ts:1007`, and documented at `docs/api.md:1571` and `:1583-1592` — where the prose says in as many words that *"the settings form now offers the two an operator has a reason to set"*. **[Work plan §2.3](01-work-plan.md)'s line is paid.** What survives is not this finding: `routes/connections.ts:54` still types the bag open while `ProviderCapabilities` is a closed eight-field interface, which is a validation question and an afternoon. See [P7 §0.1a](23-p7-implementation.md) |
| **7** — transient failures classify as terminal | **Fixed in a later phase** | `providers/openai-compatible.ts:287-347`, whose comment quotes this finding. `ECONNREFUSED` and undici's `terminated` both classify `transient` |
| **8** — a broken library file becomes unwritable *and* undeletable | **Fixed inside P4** | P4.0, `routes/diverged.test.ts` — five tests, including the one written as a property of the status code: **a 412 never answers with the hash the caller sent** |
| **9** — the teardown takes `config.json`, and the next start says nothing | **Half fixed; the rest is [sitting D](05-manual-testing.md)** | The silence is gone — `main.ts:126` warns *No config file; running on defaults*. What the finding also saw, that a `rm -rf` leaves both SQLite stores standing while a plain file beside them goes, is a **storage scenario rather than a defect** and is what D18–D20 are for |
| **10** — crash recovery works, and the record is shaped differently | **Not a defect. Recorded and closed** | `turns/runner.ts:825-846` argues it: the draft is *the turn as it would be written if it ended now*, so `status: 'failed'` and the absent `request` are the recovery contract. The finding's own value was pre-empting a bug report, and this row is that |
| **11** — an in-flight turn is broadcast as `failed` | **[P7](23-p7-implementation.md)** | The disk half is finding 10's contract and stays. The **wire** half is not addressed: a client reading `turn.status` on a running turn is told `failed`, with only `job.status` to contradict it. That is a contract question, and P7 is the next phase to touch it |
| **12** — the brief names `GET /api/auth`, which 404s | **A gate correction, applied** | The route is `/api/auth/state`. [P2C brief](13-p2c-brief.md) no longer names the wrong one |
| **13** — gate §2.1 step 2 sends the tester to a screen that does not exist | **A gate correction, applied** | [manual gate §2.1](11-p2-manual-gate.md) step 2 now reads *Settings → Administration* and says in the step that *Treatments* was a rename artifact — which keeps the correction visible instead of erasing the trap |
| **14** — the session-read measurement §1.7 deferred | **Not a defect. It is the measurement** | Flat from 13 to 55 turns. What grows is the payload, ~10.8 KB a turn, and `?limit=1` is the cheap read. **Do not re-measure** |

**The five homes, from [P2C §2.5](12-p2c-first-real-run.md):** stopped the phase ·
fixed inside it · a gate correction · [polish](06-polish.md) ·
[PLAYABLE](01-work-plan.md) or [roadmap](../25-roadmap.md).

**And a correction to that rule, earned by running it.** Five homes assume every
entry is a defect. Two of these fourteen are not — **10 and 14 are an
observation and a measurement**, and forcing either into *polish* or *roadmap*
would have filed a non-problem as work. They are closed as *recorded*, with the
reasoning in the row, which is a sixth outcome §2.5 should have had. It is not a
loophole: a *recorded* row still has to say what makes it not a defect, and both
of these cite the code that argues it.

**Nine of the fourteen were fixed without this table existing** — which is the
real finding of the triage. The log worked as a record and failed as a queue,
exactly as its own header says it is not one; what actually drove the repairs
was later phases opening the same files for other reasons. Two that nobody had
a reason to open (6 and 11) are still open sixteen days later, and both are
about a surface rather than a mechanism.
