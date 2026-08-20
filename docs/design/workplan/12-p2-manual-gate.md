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
than through a bug report. Each names what it needs.

**§4 should be a test and is not yet.** Kept apart so §2 does not quietly absorb
work that belongs in the suite — the failure mode where a manual checklist grows
every year because nobody wants to say which items were never automated.

---

## 1. Where the gates stand

Walked step by step, with every *passes* claim re-read by somebody trying to
refute it. Anchor, 2026-08-20: **1009 tests, 77 files, green — 1 todo; `pnpm
lint`, `pnpm typecheck` and `pnpm build` clean; `pnpm test:gate` 2 passed.**
Windows only — see §2.5.

| Gate | Steps | Automated and falsifiable | Partial | Needs a person | Not built |
|---|---|---|---|---|---|
| **P2** | 20 | 8 | 12 | §2 | §3 |
| **P2A** | 17 + 2 | 13 | 5 | steps 1, 7, 11, 13 | — |
| **P2B** | 11 | 2 | 5 | steps 1, 9 | 3 blocked, 1 uncovered |

**P2A's gate found a real failure and it is fixed** — step 15. One hand edit
wedged the config form until the process restarted, because the 412 never
refreshed what the process had read and that field moves only at boot and after a
*successful* write. Both recoveries the step names were unreachable. A stage of
mutation-proven tests missed it because the test named *allows a second save*
exercised a save after a **successful** save; nothing exercised one after a
refusal.

**P2B's gate cannot be closed**, and that is expected rather than a finding:
stages P2B.3 (the admin surface), P2B.4 (first run) and P2B.5 (docs) are not
built, and they own steps 1, 6 and 9 outright plus a clause each of 4, 5 and 10.
P2B.0, P2B.1 and P2B.2 are built and tested.

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
2. **The dead end, reported.** Go to Settings → Administration. The account list
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

### 3.1 P2B is half-built, and three gate steps are blocked on it

P2B.3 (the admin surface), P2B.4 (first run) and P2B.5 (docs) are unwritten.
There is **no connections form, no role table, and no first-run flow** — so gate
steps 1, 6 and 9 cannot be walked through the UI at all, and §2.1's steps 3 and 4
need `curl`.

Two things a survey found that P2B.3 has to settle before it starts, both plan
gaps rather than code gaps:

- **The role table has nothing to read.** `via` — which layer won — is computed
  inside `resolveRole`, is deliberately *not* on the turn record ([13 §1.4]
  specifies no such field), and no route returns a per-role resolution. As
  scoped, P2B.3 would have to reimplement [07 §5.1]'s layering client-side, which
  is a second copy of the resolution order. It needs a route.
- **There is no masked input.** `PasswordInput` is file-private in
  `UserSettings.tsx` and deliberately *not* a `Field`, because a password must
  never acquire an assist slot. An API-key field built from `Field` renders the
  key in plain text. And `hasKey` needs a *leave blank to keep it* affordance
  that no primitive has.

### 3.2 The dead-end count cannot witness what P2B.4 claims

`deadEnds` counts connection **files** and never reads a bindings file. So a
system connection with no bindings gives every account `hasUsableConnection:
true` while every turn fails `unbound` — and P2B.4's stated ending, *P2A's
account list reports zero dead ends*, would go green over an install nobody can
play on.

*Needs:* either the count asks whether a role actually resolves — which is
`resolveRole('prose', …)` per account, one more file read each — or P2B.4's
ending clause is reworded and the gate's step 1 becomes the only witness.

### 3.3 P2B gate step 6's arithmetic is impossible

The step says *the other seven use the install default*. There are eight roles;
`defaultBindings` binds five, because `image`, `video` and `speech` are `unset`
by design — there is no sensible text fallback for an image, and a binding that
resolved to one would fail at the call rather than at the setup.

So overriding one role leaves **four** resolving via the install default and
**three** reporting `unbound`. The step is corrected in
[14 §4](14-p2b-provider-configuration.md), and the role table needs a third state
— *unset by design* — which P2B.3's own prose already implies and its scope does
not mention.

### 3.4 A duplicated connection id has no flag, and deleting one lies

Gate step 10 wants both copies listed and the shadowed one flagged. Both are
listed — `readConnectionsIn` never dedupes — but **nothing computes a flag**:
`AdminConnection` has no such field and the list route maps presenters straight
over the array. P2B.3 cannot render what the server does not send.

Worse, and this one is a bug rather than a gap: `findConnectionFile` returns the
**first** file claiming an id and `deleteConnection` unlinks only that one. So
deleting a duplicated id answers `204` while the connection still resolves from
the second file — and the case [P2B §2.8] names for this is *an admin revoking a
leaked key*. Being told *gone* while it still works is the wrong answer there.

*Needs:* a `shadowed` field on the admin presenter, and an explicit decision —
delete every file claiming the id, or refuse and name the count.

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

### 4.2 The three §3 findings, once their code lands

Each of §3.2, §3.3 and §3.4 names a change; each needs the test that would have
caught it. Specifically:

- an account with a system connection but **no bindings** reports a dead end;
- overriding one role leaves four via `default` and three `unset`, asserted as
  the arithmetic rather than as a total;
- deleting a duplicated id either removes every file claiming it, or refuses —
  and the id does not resolve afterwards either way.

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
