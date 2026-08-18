# P2 — what the machine cannot check

The [P2 exit gate](04-p2-implementation.md#4-verification--the-p2-exit-gate) is
twenty steps. Most of them are now automated and mutation-proven; this file is
the remainder, and it is deliberately three lists rather than one, because
"manual test" is doing three different jobs in most projects and they need
different responses.

**§1 needs a person**, and will still need one after every reasonable automation
effort — a real provider, a real browser, a real network.

**§2 will fail**, because the behaviour the gate describes is not built. Running
these by hand is how the phase finds that out on purpose rather than a user
finding it out by accident. Each one names the production change it needs.

**§3 should be a test and is not yet.** It is here so §1 does not quietly absorb
work that belongs in the suite — the failure mode where a manual checklist grows
every year because nobody wants to say which items were never automated.

Automated coverage as of this pass: steps 8–20 hold, with the exceptions §2
names. Steps 2–6 are §3. Step 7 is §2 and §3 both — its server half is a test
nobody has written, its client half is a feature nobody has built.

---

## 1. Needs a person

### 1.1 A real provider, end to end

**Every automated test in this repo runs against `FakeProvider`.** That is the
right default — [10 §4](10-testing.md) argues it at length, and an E2E suite that
called a real model would be slow, flaky, expensive and would test the model
rather than the app. But it means the shipped adapter's wire format is asserted
only against a stub this repo wrote, and a stub agrees with whatever it was
written to agree with.

Configure a real connection (`users/<you>/connections/*.json`) against a live
OpenAI-compatible endpoint and take a turn.

Watch for: the request is accepted at all; streaming chunks arrive incrementally
rather than in one lump at the end; `usage` comes back populated, since [13
§1.4](../13-internal-contracts.md) calls it *provider-reported, not estimated*
and a provider that reports nothing makes every budget figure in the UI a guess;
`ModelCall.resolved` names the model that actually ran; and the turn record's
cost is not zero.

Then break it on purpose — a wrong API key, a model id that does not exist, a
deliberately tiny completion ceiling — and check each surfaces as a *classified*
failure ([06 E7](../06-open-questions.md)) rather than a provider string
appearing raw in the UI.

**Do this on every provider you intend to support before P3.** It is the one
category of defect where the fake is structurally unable to help.

### 1.2 First-run setup in a browser

P2.0 explicitly left the first-run browser landing to the Playwright tier
([10 §3.5](10-testing.md)), which is not built. Until it is: delete the data
directory, start the server, open the browser, and go through setup to a
signed-in admin.

Watch for: the setup token path works from a cold start; the account is created;
the session cookie survives a reload; and signing out and back in works.

### 1.3 The play surface under a real model's cadence

The component tests drive the reducer with synthetic frames at machine speed. A
real model streams at a human-visible rate, which is the only condition under
which the *reading* experience exists at all.

Take a long turn and watch the text land. Then:

- **Close the tab mid-generation and reopen it.** The finished turn should be
  there. Automated at the socket level; what is untested is a browser's actual
  unload behaviour and the reconnect that follows.
- **Sleep the laptop mid-turn**, wake it, and watch the stream reconnect. This
  is materially different from the automated abort: a sleeping machine's socket
  dies without a close, and the resume goes through `Last-Event-ID` on a
  connection the browser reopened by itself.
- **Two browser tabs on one session.** The server-side fan-out is now asserted;
  what no test covers is two real clients rendering the same deltas.
- **Kill the server mid-turn** (Ctrl-C), restart it, and reload the page. The
  partial turn should be recorded failed and the session should be usable.

### 1.4 The turn record, read by a human

Open the raw record behind *Turn record* on the play surface and read it.

The automated tests assert the record's *fields*. What they cannot assert is
whether it answers the question it exists to answer — [P2 §2](04-p2-implementation.md)
makes the record load-bearing precisely because everything after P2 reads it. So
read one and ask: could you tell from this alone why the turn came out the way it
did? Note what you had to guess. That list is P3's brief.

### 1.5 Both platforms, by hand

CI runs the suite on ubuntu and windows, and the `ci-shape` test now stops that
matrix being deleted quietly. What CI does not do is *run the application*. Start
the server and play a turn on both Windows and Linux at least once per phase —
path handling, file watching and SQLite locking are the three places this
codebase has already been bitten, and all three are platform-shaped.

---

## 2. Will fail — the gate describes behaviour that is not built

These are findings, not test debt. Each names the change it needs.

### 2.1 Gate step 7 — there is no error card

> *"Hand-edit an actor into an invalid shape, open it → an error card naming the
> path and problem, app alive, list still works."*

The server does its half: it records the file error, keeps serving the last good
object, and refuses a save that would overwrite the invalid bytes. The route is
`GET /api/library/errors`.

**No client code calls it.** There is no error card, and no other surface
mentions a broken file. Hand-break an actor today and the app is silent: the user
sees stale content presented as current, edits it, and is refused by a conflict
dialog that blames a concurrent editor and offers a reload that reloads the same
stale bytes.

*Needs:* a client surface for `/api/library/errors`, and F20's invalid-file state
in the index. The server half also has no test — see §3.

### 2.2 A killed turn names no model call

`performCall` attaches a `ModelCall` to a turn only when the call returns, or
through `CallFailed`. An aborted signal is checked first and throws `Cancelled`,
which carries no record — so a turn killed mid-generation comes back with
`request.calls: []`.

Blocks and the budget verdict *do* survive the kill, and that is asserted. But
gate step 10's "blocks intact… and can be re-run" reads oddly when the record
cannot say which model was in flight. Left as
`it.todo('names the model call that was in flight when the process died')` in
`routes/recovery.test.ts`.

### 2.3 The record cannot say a block is advisory

Gate step 17 says guidance *"appears as an advisory block in the record"*.
`AssembledBlock` has no `advisory` field: `assemble()` reads
`Candidate.advisory` inside `admit()` and then drops it. The strongest thing the
record can say is that the block came from the guidance *source*, which is
weaker and different — a preset can mark any block advisory, and that fact is
lost on the way to disk.

Relatedly, `ModelCall` records no call *purpose*, so *"no advisory block ever
reaches an effect-producing call"* is not expressible over a committed record at
all. The tests assert it over `FakeProvider.requests`, which works in a test and
is unavailable to anyone reading a real session.

*Needs:* an advisory flag on `AssembledBlock`, carried through `assemble()`; and
the derived call purpose on `ModelCall`, written where `performCall` already
computes it. Both are small, and both are what make P3's workbench able to
render *why* a block was firewalled.

### 2.4 Two constructors of the clock effect disagree

`acceptEffect` stamps `before` from the running channel map, and `createSession`
writes no channels — so the first effect of every session records `before: null`
while its `after` is `08:05`. Meanwhile `readClock()` defaults a missing channel
to `CLOCK_START`, and `channels.ts`'s `clockEffect`, which would have written
`CLOCK_START` there, **has no production caller at all**.

Benign today, because reversal maps the missing value back. Not benign once
anything inverts an effect without consulting the channel's init policy, which
[13 §1.3](../13-internal-contracts.md) defers. Two tests now record the
divergence rather than assert either reading; one of them has to win.

### 2.5 Log bindings do not match the contract

[13 §4.1](../13-internal-contracts.md) lists the bindings a turn job carries and
says `jobId` is bound *when the job is created*. In fact:

- nothing is logged at reservation — the first line carrying a `jobId` is
  `job.running`, after the runner has taken it. A process that dies between the
  202 and the first checkpoint leaves a reserved job and no log line at all;
- `job.committed` carries no `sessionId`;
- `job.unstartable` and `job.lost` carry neither `sessionId` nor `turnId` — and
  those are the two lines an operator chasing a lost turn greps for.

The tests assert what the code does and record the divergence. Gate step 19's
claim of a *full* lifecycle from the log alone is true from `job.running`
onward, not from reservation.

### 2.6 A turn carries no money total

`TurnCost` holds tokens, wall time and a model name. `ModelCall.cost` is the only
place a price lives, and `costOf()` never aggregates it. Whether a turn should
total its own cost is a design question, not a bug — but *"cost captured"* in
gate step 11 reads as though it were already answered.

---

## 3. Should be a test, and is not yet

Listed separately so §1 does not absorb them. All are automatable today with the
existing harness; none needs a browser or a person.

| | What | Why it is not done |
|---|---|---|
| **Step 2** | The 412 loser's body carries the current *object*, not just its hash; and the refused write leaves no history entry | Two assertions on a race test that already races correctly |
| **Step 3** | A hand edit and an API write contending **with the watcher running** | The existing test runs `watch: false`, so the window F3 is about is never opened |
| **Step 4** | Pin/rename racing a snapshotting save, repeated enough times to mean something | One pass detects at roughly 1 in 4; the existing test is a coin flip |
| **Step 5** | `authoredAt` bounded by a real clock window rather than compared to itself | Today a stamp regressing to a constant passes |
| **Step 6** | History *content* survives a DELETE, not just the pointer file | The payloads behind `history/index.jsonl` are never read back |
| **Step 7** | The recorded file error names the offending JSON path | The server half of §2.1 — the assertion nothing makes |
| **Step 20** | A golden block table through the **shipped preset**, including one case under budget pressure | See below |

**Step 20 is the largest remaining gap and worth its own paragraph.** There is
exactly one snapshot assertion in this repository, and it runs over a
hand-written candidate array that no production code path ever produces. Nothing
snapshots what `SCENE_PRESET` actually renders to — so a reworded narrator
instruction, a lost `omitWhenEmpty`, a change in in-history placement, or a
collector that stops emitting the input slot passes every test that exists. And
budget behaviour under pressure has no golden at all: the one budget assertion
has every row included, so it cannot catch a wrong drop victim or a wrong
`droppedBy`. [10 §3.1](10-testing.md) draws the table this should be, down to the
columns.
