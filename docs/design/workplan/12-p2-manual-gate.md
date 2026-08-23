# 12 — what the machine cannot check

The exit gates for [P2](04-p2-implementation.md#4-verification--the-p2-exit-gate),
[P2A](13-p2a-configuration-surface.md#4-verification--the-p2a-exit-gate) and
[P2B](14-p2b-provider-configuration.md#4-verification--the-p2b-exit-gate) are
forty-eight steps between them. This file is what is left after the automatable
part of each was written, and it stays three lists rather than one, because
"manual test" does three different jobs and they need different answers.

**§2 needs a person**, and will after every reasonable automation effort — a real
provider, a real browser, a real network, a human reading a sentence.

**§3 will fail or is unreachable**, because the behaviour a step describes is not
built. Running these by hand is how the phase finds that out deliberately rather
than through a bug report. Each names what it needs — and each that has since
been built is kept as a closed record rather than deleted, because *how it was
found* is the transferable part.

**§4 should be a test and is not yet.** Kept apart so §2 does not quietly absorb
work that belongs in the suite — the failure mode where a manual checklist grows
every year because nobody wants to say which items were never automated.

---

## 1. Where the gates stand

Walked step by step, with every *passes* claim re-read by somebody trying to
refute it. Anchor, 2026-08-21: **1049 tests, 78 files, green — 1 todo; `pnpm
lint`, `pnpm typecheck` and `pnpm build` clean.** Windows only — see §2.5.

| Gate | Steps | Automated and falsifiable | Partial | Needs a person | Not built |
|---|---|---|---|---|---|
| **P2** | 20 | 8 | 12 | §2 | §3 |
| **P2A** | 17 + 2 | 13 | 5 | steps 1, 7, 11, 13 | — |
| **P2B** | 11 | 9 | 2 | steps 1, 9 | — |

**P2A's gate found a real failure and it is fixed** — step 15. One hand edit
wedged the config form until the process restarted, because the 412 never
refreshed what the process had read and that field moves only at boot and after a
*successful* write. Both recoveries the step names were unreachable. A stage of
mutation-proven tests missed it because the test named *allows a second save*
exercised a save after a **successful** save; nothing exercised one after a
refusal.

**P2B's gate was walked twice**, and the first walk is the one worth recording:
stages .3, .4 and .5 were unbuilt, and walking it anyway found **three steps
describing things the code could not do** — step 6's arithmetic, step 10's
missing flag and lying delete, and P2B.4's ending clause, which could not
witness itself. All three are now built and corrected. The second walk closes
the gate but for the halves only a person can walk.

**And a twenty-agent adversarial pass over the P2B server work found six more**,
five of them introduced by that work and all of them reachable only through a
hand-written file — which is the designed path here, not an exotic input. The
sharpest: `{"prose": null}` in one account's `bindings.json` answered **500**
on the admin account list for everybody, because the new dead-end count opens
that file per account and `resolveRole` skipped only `undefined`. Nothing went
red; there was nothing to go red. All six are fixed and mutation-proven.

**What that pattern is worth naming.** Every finding in this file so far came
from walking a gate as a checklist. These six came from asking a different
question — *what can a person put in a file that this code will not survive* —
and it is a question no gate step asks. §4 is where it goes.

---

## 2. Needs a person

### 2.1 One session, end to end — do this first

The single most valuable manual run, because it is the only one that crosses
every phase, and because three gate steps are the same sentence: *install fresh,
create the first admin, add one key, take a turn — without opening a text editor
once.*

```bash
rm -rf ./data      # or use --data on a scratch directory
pnpm build && pnpm dev
```

1. **Setup.** Open the browser at the printed address. Create the first admin.
   *Watch for:* the setup form, not a login form; the session surviving a reload;
   sign out and back in.
2. **The dead end, reported.** Go to Treatments → Administration. The account list
   should say *1 person has no usable connection and cannot send a message. No
   system connection is configured, so adding one fixes this for everybody.*
   **This is [04 §4.5]'s commissioned sentence, and P2A exists partly to make it
   appear.** Read it as a stranger would — it is the one piece of copy in the app
   whose whole job is to be understood by somebody who is stuck.
3. **A connection.** Add one, with a real key. *Blocked today: there is no form —
   see §3.1.* Until P2B.3 ships, do this with `curl` against
   `POST /api/admin/connections` and note that the phase is not done.
4. **A binding.** Same: `PUT /api/admin/bindings` with `prose` pointing at the
   connection.
5. **The warning clears.** Return to the account list. *It will say zero dead
   ends after step 3 alone, before step 4 — see §3.2. That is a bug in the
   witness, not in the count.*
6. **A turn.** Start a session, send a message, watch the reply stream.
7. **Reload mid-turn.** Send another, and reload the page while it is streaming.
   The finished turn should be there.
8. **The record.** Open *Turn record* and read it. See §2.4.

### 2.2 A real provider

**Every automated test in this repository runs against `FakeProvider`.** That is
the right default — [10 §4](10-testing.md) argues it, and an E2E suite calling a
real model would be slow, flaky, expensive and would test the model rather than
the app. It means the shipped adapter's wire format is asserted only against a
stub this repo wrote, and a stub agrees with whatever it was written to agree
with.

Run §2.1 against **at least one hosted endpoint and one local runtime**, because
they fail differently.

Watch for: the request is accepted at all; chunks arrive incrementally rather
than in one lump; `usage` comes back populated, since [13 §1.4] calls it
*provider-reported, not estimated* and a provider that reports nothing makes
every budget figure a guess; `ModelCall.resolved` names the model that actually
ran; and the turn's cost is not zero.

Then break it deliberately — wrong key, model id that does not exist, a
deliberately tiny completion ceiling — and check each surfaces as a *classified*
failure ([06 E7]) rather than a provider string in the UI.

**And the model fetch.** *Fetch models* against both, and against something that
does not implement `/models` at all. [P2B §2.6]'s caveat — that several local
runtimes answer with one entry called `gpt-3.5-turbo` regardless of what is
loaded — is the kind of thing only a real llama.cpp tells you.

### 2.3 The browser, under real conditions

The component tests drive reducers with synthetic frames at machine speed.

- **Close the tab mid-generation and reopen.** The finished turn should be there.
  Automated at the socket level; a browser's actual unload is not.
- **Sleep the laptop mid-turn**, wake it, watch the stream reconnect. Materially
  different from an aborted socket: a sleeping machine's socket dies without a
  close, and the resume goes through `Last-Event-ID` on a connection the browser
  reopened itself.
- **Two tabs on one session.** Server fan-out is asserted; two real clients
  rendering the same deltas is not.
- **Kill the server mid-turn** (Ctrl-C), restart, reload. The partial turn should
  be recorded failed and the session usable.
- **Two admins on the settings page.** Save in one, then save in the other.
  Both offers of the 412 should now work — *load what is on disk* and *overwrite
  with mine* — and a plain Save in between should still be refused.

### 2.4 What only a person can judge

- **The turn record.** Open it and ask: could you tell from this alone why the
  turn came out the way it did? Note what you had to guess; that list is P3's
  brief.
- **The removal sentence.** Start removing an account and *read the dialog before
  clicking*. It is the one piece of copy somebody would want to have read
  beforehand, and the only test of it is whether it reads that way.
- **The capability groups.** *In force now* against *recorded for later*: does
  the second read as honest, or as an excuse?
- **The restart banner.** Does *StoryEngine does not restart itself* answer the
  question it raises, or invite it?

### 2.5 Both platforms

CI runs the suite on ubuntu and windows, and `ci-shape.test.ts` stops that matrix
being deleted quietly. What CI does not do is *run the application*. Start the
server and play a turn on both at least once per phase — path handling, file
watching and SQLite locking are the three places this codebase has already been
bitten, and all three are platform-shaped.

**Everything above was verified on Windows only.** The ubuntu leg of the suite is
asserted as configuration, not as a green run anybody here has seen.

---

## 3. Will fail, or is not built

Findings, not test debt. Each names the change it needs.

### 3.1–3.4 The four P2B findings, closed

*Kept as a record rather than deleted, because what they have in common is worth
more than any one of them: **not one was found by a failing test.** Each was
found by reading a gate step against the code that was supposed to satisfy it.*

- **P2B was half-built**, so steps 1, 6 and 9 could not be walked through the UI
  at all. Two things the stage had not scoped had to land first: a route
  returning per-role resolution — `via` was a local in `resolveRole` and
  returned by nothing, so a role table would have reimplemented
  [07 §5.1](../07-tech-stack.md) in the browser — and a masked input, since
  `PasswordInput` was file-private and an API-key field built from `Field`
  would have rendered the key in plain text. **Built:** `GET /api/admin/roles`
  and `editor/SecretField.tsx`.
- **The dead-end count could not witness P2B.4's ending.** It counted connection
  *files*, so a system connection with nothing bound to it reported zero dead
  ends while every turn failed `unbound`. **Fixed:** it asks whether `prose`
  resolves, through the turn's own resolver.
- **Step 6's arithmetic was impossible.** Eight roles, five bound by
  `defaultBindings`; `image`, `video` and `speech` are unset by design. Four
  via `default` and three `unbound`, not seven — and the role table needed a
  third state nobody had scoped. **Fixed:** the step, and *unset by design* in
  the table.
- **A duplicated id had no flag, and deleting one lied.** Nothing computed
  `shadowed`, and `deleteConnection` unlinked the first file claiming an id, so
  a delete answered 204 while the connection went on resolving. §2.8 names the
  case: *an admin revoking a leaked key*. **Fixed:** both, plus a third the
  adversarial pass found on top — an edit that renames the winner hands the win
  to the other file, and the 200 used to report `shadowed: false` about the
  connection it had just killed.

### 3.5 Gate step 7 — there is still no error card

Unchanged since this file was first written. The server records the file error,
keeps serving the last good object, refuses a save over invalid bytes, and
exposes `GET /api/library/errors`. **No client code calls it.** Break an actor
by hand and the app is silent: stale content presented as current, edited, then
refused by a conflict dialog blaming a concurrent editor.

### 3.6 Smaller ones, all still open

- **A killed turn names no model call.** `performCall` attaches a `ModelCall`
  only when the call returns; an aborted signal throws `Cancelled`, which carries
  no record. Left as `it.todo` in `recovery.test.ts` — the suite's one todo.
- **The record cannot say a block is advisory.** `assemble()` reads
  `Candidate.advisory` in `admit()` and drops it, and `ModelCall` records no call
  *purpose* — so *no advisory block reaches an effect-producing call* is not
  expressible over a committed record.
- **Two constructors of the clock effect disagree** about `before` on a
  session's first effect, and `channels.ts`'s `clockEffect` has no production
  caller.
- **Log bindings** — `job.committed` carries no `sessionId`; `job.unstartable`
  and `job.lost` carry neither; nothing logs at reservation, though [13 §4.1]
  says `jobId` is bound when the job is created.
- **A turn carries no money total.** `ModelCall.cost` is the only place a price
  lives and `costOf()` never aggregates it.

---

## 4. Should be a test, and is not yet

Kept apart from §2 deliberately. Everything here *could* be automated; nothing
here has been. Left in §2 it would silently become permanent manual work.

### 4.1 A recorded transcript tier for the provider adapters

The largest single gap, and the reason §2.2 exists at the length it does.
`openai-compatible.ts` is tested against hand-written `fetch` stubs, and a stub
agrees with whatever understanding wrote it — the same understanding that wrote
the adapter. If the chunk shape is misread, both are misread identically and both
are green.

*Wanted:* capture one real SSE response per endpoint family once, byte for byte,
commit the bytes as a fixture, replay them through `SseParser` and the adapter.
That converts *does it parse a real stream* from a manual step into a test, and
leaves §2.2 the parts that genuinely need a live endpoint — auth, rate limits,
`usage`, and whether the model that answered is the model that was asked for.

**Not a substitute for §2.2, and it should not be sold as one.** A recording goes
stale the day the provider changes, and nothing tells you.

### 4.2 Nobody fuzzes a hand-written file, and every one of them is hand-written

**The single highest-yield gap in the suite, on the evidence.** Six of the
findings in §1 are the same shape: well-formed JSON that means nothing, in a
file [05 §4](../05-ui-surfaces.md) says a person edits by hand. `{"prose":
null}`, a directory named `notes.json`, an id containing `../`. None of them
had a test; five of them answered **500** on an admin page.

The suite tests these files as *readers* — absent, present, unparseable — and
never as a hostile parse that succeeded. `resolveRole` skipping only
`undefined` was that gap in one line.

*Wanted:* a small table-driven case per hand-written file — `bindings.json`,
`connections/*.json`, `config.json`, and the library objects — walking a fixed
list of *parses-but-is-wrong* values (`null`, a string, a number, an array, an
object missing each required field, a path-shaped id) and asserting the route
that reads it answers a status rather than throwing. It is one loop per file and
it would have caught all six of these before they were written.

**Not a fuzzer.** A generative fuzzer over these files would be more thorough
and would also be a second thing to maintain that fails intermittently. The list
above is short because the failure mode is narrow: the parse succeeded, so what
is left is *shapes*.

### 4.3 Two clients on one session, at the DOM tier

Server fan-out is asserted at the socket. What is not asserted is two mounted
components consuming one session's frames — the case where a reducer keyed on
something shared would let one tab's state leak into the other's render. Two
`PlayPage`s in one jsdom document would reach it.

### 4.4 The suite is load-sensitive, and that is a defect in the suite

Four concurrent `pnpm test` runs produced two file failures — `history.test.ts`
hitting vitest's 5000ms default. Alone, the same suite is 1009 green. So a test
here can fail for reasons that have nothing to do with the code, which is the
property that teaches people to re-run rather than read a failure.

*Wanted:* find whether the slow path is a real fixed cost or a poll that should
be event-driven, and fix the cause rather than raising the timeout. Raising it
hides the next one.

### 4.5 The ubuntu leg has never been watched

`ci-shape.test.ts` asserts the matrix exists, which stops it being deleted
quietly and asserts nothing about whether it passes. Every number in §1 is from
Windows. Read one ubuntu run's output before treating the cross-platform claim as
evidence.
