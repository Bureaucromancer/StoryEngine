# 05 — Manual testing, running

**Status: standing. This file does not complete.** Opened as a ledger
2026-09-07 at `bded9f7`, merged with the pre-P6 walk sheet 2026-09-08. It holds
what a person still owes the project, what they did about it, and what to do
next — and it keeps holding them, because manual testing runs behind
implementation by construction and every phase that closes adds to it.

**Why one file and not two.** The ledger and the walk sheet each argued that
*"they go stale differently: a ledger is true until a phase closes, a walk sheet
is true for an afternoon."* That argument dies the moment the sheet stops
completing — a never-completing sheet is a second ledger at finer grain, in a
second place, which is the duplication the ledger opens by naming. **The
perishable unit is the sitting, not the document.** A walked sitting is struck
through where it stands and keeps its results; the file that holds sittings is
true forever.

It also ends a live duplication: three of the ledger's five outstanding passes
were already items on the sheet, each citing the other, and the two documents
kept two gate tables that are two update sites for one fact.

## The two-tier gate

**This is the file's central claim and the project's testing modality from
2026-09-09.** It replaces a rule that was good and did not survive contact with a
solo project.

**The old model was one gate per phase, walked in full by a person, blocking the
close.** Its record is in §6: **five phase gates accumulated unwalked, and no
gate in this project's history has ever been closed by a person.** P3's fifteen
steps, P4's fifteen, P5's eighteen, P6's fourteen, P6A's thirteen — each phase
document honestly recording that its own gate was outstanding, and none of them
saying it about the sequence.

**A gate nobody walks is not a gate. It is a wish** — [work plan §0.5](01-work-plan.md)'s
*"a bar nobody owns is a wish"*, one level up. The failure was not laziness; the
unit of work was wrong. A fifteen-step walk wanting a real library, a second
machine and an afternoon does not fit between finishing a phase and starting the
next, so it never happened, and the next phase started anyway. And the
arithmetic was worsening: **P7 through P11 will land fifty-five more
person-walked steps** on a pile that has never once been drained.

> **When a phase closes, its exit gate splits.**
>
> **The critical list is the gate.** A small set of checks — walkable in a
> sitting or two, with what is to hand — derived from the full gate by the
> criterion below. **These are walked before the phase closes.** They are the
> gate in the operative sense: the phase does not close until they have results.
>
> **The remainder extends the standing list.** Everything else arrives here as
> sittings, each with a result in §2's vocabulary — `BLOCKED`, `DEFERRED`, or
> blank-and-sequenced in §1. It is drained continuously, by whoever has an
> afternoon, against whatever build is current.
>
> Automated steps go to §5 with the test named. Deferrals go to §10 with a name
> beside them.

**This is not a relaxation, and the arithmetic is the argument.** The old
model's fifteen steps had a completion rate of zero. A four-step list walked at
every close is strictly more evidence, and it arrives when it is cheapest —
which is [work plan §7](01-work-plan.md)'s whole reason for putting a checkpoint
at a particular moment rather than eventually.

**The precedent is already in the corpus, twice.** [P6A](19-p6a-alpha-1.md)'s
status line reads *"the phase closes on its merge into `main`, and the exit gate
… waits on a person with Docker"*, and [P4 §3](16-p4-implementation.md) says
outright *"P4 can close without it; PLAYABLE is where its absence will be
felt."* What is new is that this becomes the rule rather than two exceptions —
and that the part which *is* held is chosen deliberately rather than being
whatever nobody got to.

### The criterion

> **A check belongs on the critical list if and only if all three hold.**
>
> **(i) It can falsify a claim the phase makes about itself** — not a claim its
> gate merely *transports* from another phase. This clause is what keeps the
> list small: [P6B §3](20-p6b-playable.md) step 8 is *"P5's eighteen steps,
> walked by a person"*, which is P5's claim living in P6B's gate, and it belongs
> in sitting F rather than in P6B's close.
>
> **(ii) The claim compounds.** A wrong answer found two phases later costs more
> than one found now. This is the only warrant for walking it *at this moment*
> rather than eventually, and it is [work plan §7](01-work-plan.md)'s argument:
> the assembler, the record and the budgeter are built on by every phase after
> them, so an error in any of them compounds per phase.
>
> **(iii) It is walkable with what is to hand.** A check blocked on a resource
> with lead time is a deferral, not a check. **Holding a gate open on `BLOCKED`
> is precisely how a phase stops closing** — which is how §3's R1 came to block
> four obligations across three phases.

**Breadth, duration, platform and corpus are not criticality** — not less
valuable, differently urgent. A coverage sweep asks *does everything work*, a
question with no phase attached and the same price next month. A leak at turn
forty is as findable in November as today.

**And a caveat that is inherited rather than assumed:** clause (ii) privileges
compounding, and compounding is a *prediction about the plan* rather than a
fact. Re-read it when each phase opens. If P7 reshapes the mode contract far
enough, some of what is excluded today as *equally cheap later* becomes more
expensive instead.

### The three things that keep it honest

1. **The gate document is never edited to match what was walked.**
   [P6B §1.3](20-p6b-playable.md) names the failure: *"a walk that edits the gate
   until it passes."* The steps keep asking what they asked; a second table in
   the phase document records what was answered and by what. **That separation
   is the whole mechanism**, and without it the two-tier model is a rubber stamp
   with extra steps.
2. **The criterion is written down and applied, not argued per phase.**
   Otherwise *critical* means *what I felt like doing*.
3. **The standing list must visibly drain.** §5 and §9 are the two valves.
   [manual gate §4](11-p2-manual-gate.md) names what they exist against: *"a
   manual checklist grows every year because nobody wants to say which items
   were never automated."* **If this file only grows, the model has failed**, and
   the honest response is to say so here rather than to keep adding sittings.

**The intake is mechanical, not a matter of remembering.** Every exit gate in
this project ships at least one step marked *"Only a person can walk"* — P3, P5,
P7, P10 and P11 all carry the phrase, and it is always on the step that carries
the phase's actual claim. That is what to grep for when a phase closes.

**The two valves, named once more because they are the model's only defence
against itself.** §5 records what a test now covers, so nobody walks it again;
§9 holds what *should* be a test and is not. Without both, "manual testing,
running" becomes "manual testing, accumulating."

---

## 0. Where this stands, 2026-09-08

**Thirty-six items walked, forty-five with a result, forty-three still blank**,
across ten sittings of which three are complete and one is half done. **No gate
in this project's history has ever been closed by a person.** P1's is closed by
CI and is the only row in §6 with nothing owed.

The walk so far has produced six findings in [playable log](21-playable-log.md) and eleven
graded refinements in [refinements](22-walkthrough-refinements.md), and its sharpest
result is one nobody asked for: sitting C ran eleven deliberate breakages,
passed eleven, and produced **no refinement note at all**, while the sittings
where nothing went wrong produced five. The app is well built for failure and
thin for progress.

---

## 1. What to walk next

*Rewritten whenever something is walked or a prerequisite lands. Everything else
is below; this is the afternoon.*

1. **K, entire** — and it is not an afternoon. **This is the only item on this
   list holding a phase open:** under [§0](#the-two-tier-gate)'s model K *is*
   [P6B](20-p6b-playable.md)'s gate, so P6B does not close until K1–K9 have
   results. K0 cuts alpha 4 before anything is recorded. Two sittings and 45
   minutes of desk work.
2. **D11–D20** — needs only the running app and a text editor (R7). D18, D19 and
   D20 are the three storage scenarios no other document has a home for, and
   D17 needs a re-check first: it was flagged unperformable, and P5.6 may have
   made it performable.
3. **E3–E5, E7–E13** — the fixture arm of import, walkable without the corpus.
   Only E1, E2 and part of E6 want R1.
4. **F0–F5, F7–F10, F13, F15, F16** — lore against a seeded install. F0 is the
   entry point and the walk nobody could do before [P6B.0](20-p6b-playable.md).
   **Walk K first regardless:** K1 and K2 build the install F wants, so F is
   cheaper after K and duplicated work before it — and K1 discharges F0 outright.
5. **B2 and B8** when a local runtime (R3) is confirmed; **B6** when a second
   machine (R5) is; **H1 and H2** when there is an ubuntu box (R6).

**Not next, and deliberately:** G, which wants hours and is PLAYABLE's second
sitting — K5–K8 are the short form of it, and what they cannot reach is exactly
what G is for; and I and J, which want a container and a two-hundred-turn
session respectively.

---

## 2. How to write a result

Seven words, and only seven, so that a filled sheet can be read at a glance:

| Result | Means |
|---|---|
| **PASS** | Walked, and it did what the step says. |
| **FAIL** | Walked, and it did not. Gets a finding in [playable log](21-playable-log.md), and the id goes in the cell. |
| **PART** | Walked, and it half did. The cell says which half; a finding carries the rest. |
| **BLOCKED** | Cannot be walked here. The cell says what it needs and who arranges it. |
| **DEFERRED** | Not this phase's. The cell names the phase that has it. |
| **AUTO** | A test does it. The cell names the test. No walk. |
| **CORRECTION** | The step describes behaviour the code does not have. **The step is wrong, not the code** — correct it in the phase document that owns it, and record that here. |

**`CORRECTION` is the one worth going looking for.** [P2C §3](12-p2c-first-real-run.md)'s
own account of the first P2B walk is that the three corrections it produced were
worth more than the ticks, and this sheet's citations were written from documents,
some of which are two phases old.

**Write the result the day you walk it, not afterwards.** A remembered outcome is
an opinion.

**A blank is not a result.** `BLOCKED` and `DEFERRED` are results — they say what
the thing needs and who arranges it. An empty cell says only that nobody has
looked, which is the state this whole file exists to make visible.

---

## 3. Standing prerequisites

*Not "arranged before the day" — these outlive any one walk, and what each
unblocks reaches across phases rather than across one sheet.* Ordered by lead
time, longest first, because that ordering is a property of the prerequisite and
not of the steps.

**Nothing here is walkable on the day it is thought of.**

| # | What | Unblocks | State |
|---|---|---|---|
| **R1** | **A real library somebody else made** — a used SillyTavern data directory, a used Marinara install, and a handful of explicitly-permissive lorebooks. None of it is in the repository and none of it can be synthesised. | E1, E2, E6, F1, F6 — and [P4 §3](16-p4-implementation.md) step 1, [P5 §3](17-p5-implementation.md) step 6, PLAYABLE's third hypothesis, and [testing §5](03-testing.md)'s corpus policy, which is a plan rather than a record that it ran | **Not to hand. The longest lead item in the file and the only one that cannot be started by deciding to.** Begin acquiring before G, not after: four obligations read the same shelf. |
| **R3** | **A local runtime** (Ollama, LM Studio, llama.cpp) with one model. | B2, B8, and G's whole endpoint | Unconfirmed |
| **R5** | **A second machine on the network**, to sign in from. | B6, and I's step 7 | Unconfirmed |
| **R6** | **An ubuntu box or VM.** Everything this project has ever verified was verified on Windows. | H1, H2 — and [manual gate §2.5](11-p2-manual-gate.md), [manual gate §4.5](11-p2-manual-gate.md), *the platform nobody has watched* | Unconfirmed |
| **R4** | **A non-author for forty-five minutes**, with the README and a URL and nothing else. | A9 — and [P10 §3](26-p10-implementation.md) step 10, which asks for the same person and says *the phase's whole claim is about that person* | **Partly expired** for A9 and cannot be recovered by trying harder; still live for P10 |
| **R2** | **A hosted endpoint with a real key.** | B1, C1 | **To hand** — used at A3, 2026-09-08 |
| **R7** | **A full text editor and a file manager** on the machine running the server — not `fs`, not the IDE. | D18 | To hand. Trivial, and it is the point of the step. |
| **R8** | **A Docker daemon, an unraid host with a registry credential.** | I | Partly to hand — the first install ran 2026-09-07 |
| **R9** | **A session two hundred turns deep**, against a book of a few hundred entries. | J | **Only G has ever produced one.** Walk J in the same sitting as G, while one exists — recreating one on purpose is an afternoon, noticing you still have one is free. |

---

## 4. The sittings

**A struck-through heading is a record, not a deletion.** That is how this file
stays standing: a sitting is walked once, keeps its results in place, and the
next phase's gate arrives as new sittings below rather than as a new sheet.

Run everything under `pnpm dev:logged` from B onward, so the sittings leave a
cassette corpus behind rather than a memory — §9's first item, and the
machinery has existed since P4 with **no cassette ever promoted**. The runbook
for that, and the six measured traps that go with it, is
[P2C brief §2.2–§2.4](13-p2c-brief.md); it is not restated here, and if that
document is ever retired the runbook has to move first.

*A–H came from the pre-P6 walk and cover every gate before P6. I and J are the
ledger's outstanding passes, folded in here rather than kept as a second list.*

### ~~A — Fresh install, first contact~~ Walked 2026-09-08 — *nine of nine PASS*

**A clean sweep, and the first thing this project has ever walked end to end.**
It clears [manual gate §2.1](11-p2-manual-gate.md) entirely — the eight-item sequence
that three separate gates each ask for in their own words — and
[P2C.1](12-p2c-first-real-run.md), the first-contact stage that had never run.

**A8 passed with nothing written in the *what did you have to guess* column**,
which is the answer [work plan §4.1](01-work-plan.md)'s fourth hypothesis wanted and
the one it calls likeliest to be wrong. Worth saying plainly rather than
ticking — with one correction under it that is the reason this file keeps a
result and a date rather than a tick.

**CORRECTION, 2026-09-09.** This paragraph read *"the hypothesis survived its
first contact with a real turn."* **It did not have one.** A8's session
**resolved zero books** — the defect [P6B.0](20-p6b-playable.md) found and
fixed — so the turn behind that record carried no retrieved blocks at all, and
the page A8 read therefore showed none of the retriever's vocabulary: no
`keyword match`, no refusal row, no activated-but-unplaced entry. What A8 does
evidence is the **static** record — the prompt, the call, the usage, the reasons
that do not come from retrieval — which is hypothesis 1's territory and a real
result worth keeping. **Hypothesis 4 has never been in contact with anything.**

**Why the error is worth writing down rather than quietly fixing:** it made a
question look half-answered for three weeks, and a half-answered question is
not scheduled. That is [§7](#7-closing-a-gate-and-closing-a-phase)'s third step
— the one it says gets skipped — arriving as its own example.

Its first real contact is **K8**, on a turn built to carry retrieved lore, a
budget refusal and an unplaced entry at once. Even a pass there is narrow,
because the walker arranged the turn; the wide one is [G](#g--the-long-pass--hours-unscripted-playables-second-sitting),
where P3 step 12 expects it to get harder.

*Walked against a `pnpm dev` install on Windows.* The same nine run again on
Docker as the first half of [B](#b--the-scripted-session-against-both-endpoints-walked-2026-09-08--six-of-nine-three-unconfirmed),
because a container is a different install and A1's *open the address the
server prints* is exactly the line that was wrong on the first unraid install
([P6A §3](19-p6a-alpha-1.md)).

*The sitting as it was written:*

```bash
pnpm reset-data && pnpm build && pnpm dev
```

**Do A9 first, before anything else in this sheet.** It is the only item here
that is destroyed by having already looked.

| # | Do | Clears | Result |
|---|---|---|---|
| **A9** | **Write down, before opening the browser, what you expect each screen to do.** Then walk A1–A8 and treat every divergence as a finding. Where you looked first, what you expected a control to do before clicking, and every point at which you consulted the source instead of the screen — that last one is the signal. | [P2C.1](12-p2c-first-real-run.md) | PASS |
| **A1** | Open the address the server prints — the **client's**, not the API's. Create the first admin. Reload; sign out and back in. | [manual gate §2.1.1](11-p2-manual-gate.md), P2B 1 | PASS |
| **A2** | **Settings → Administration.** The account list should say *1 person has no usable connection and cannot send a message…*. Read it as a stranger would; it is the one piece of copy whose whole job is to be understood by somebody stuck. | [manual gate §2.1.2](11-p2-manual-gate.md), [manual gate §2.4](11-p2-manual-gate.md), P2A 1 & 7 | PASS |
| **A3** | Add a connection with a real key. The model list fetches as an assist and saves without it; a **refused key** says so in its own sentence rather than reading as an unreachable endpoint. | [manual gate §2.1.3](11-p2-manual-gate.md) | PASS |
| **A4** | The two-picker default-binding form appears on its own after the first connection saves. Answer it. | [manual gate §2.1.4](11-p2-manual-gate.md) | PASS |
| **A5** | Back to the account list: the dead-end count goes to zero **after the binding, not after the connection** — the count asks whether `prose` resolves, through the turn's own resolver. | [manual gate §2.1.5](11-p2-manual-gate.md) | PASS |
| **A6** | Start a session, send a message, watch the reply stream. | [manual gate §2.1.6](11-p2-manual-gate.md), P2 9 | PASS |
| **A7** | Send another and **reload the page while it is streaming.** The finished turn should be there. | [manual gate §2.1.7](11-p2-manual-gate.md), P2 9 | PASS |
| **A8** | Open *Turn record* and read it. **Could you tell from this alone why the turn came out the way it did?** Write down what you had to guess. | [manual gate §2.1.8](11-p2-manual-gate.md), [manual gate §2.4](11-p2-manual-gate.md) | PASS |

> **A9 has partly expired, and the sheet should say so rather than pretend.**
> [P2C.1](12-p2c-first-real-run.md) calls the stranger's view *perishable* and
> names the problem it cannot solve: the tester is the person who built this.
> The mitigation in order of preference is a borrowed non-author (R4), then a
> screen recording watched a week later, then written-in-advance predictions —
> which is what the row above asks for, and which is the closest an author gets
> to not knowing. **Whatever is done, record which of the three it was**, because
> a prediction-based A9 and a stranger-based A9 are not the same evidence.

---

### ~~B — The scripted session, against both endpoints~~ Walked 2026-09-08 — *six of nine; three unconfirmed*

**B1, B3, B4, B5, B7 and B9 pass.** The wire format holds against a real
endpoint: chunks arrive incrementally, `usage` comes back populated, the
resolved model is the one that answered, and cost is `null` rather than the
fabricated zero. Two admins on the settings page get both halves of the 412.

**B2, B6 and B8 are not marked**, because each needs a resource §2 records as
unconfirmed — a local runtime (R3) for B2 and B8, a second machine (R5) for B6 —
and a walk that may not have happened is the one thing this sheet must never
assert. They are blanks on purpose.

**B9 passed its stated check and produced a refinement anyway** — the 412
behaves, and the connection surface around it is thin. That is [F-01] and it is
not a half-failure of B9; the sheet keeps the two apart on purpose.

*The sitting as it was written:*

**Every automated test in this repository runs against `FakeProvider`.** The
shipped adapter's wire format is asserted only against a stub this repo wrote,
and a stub agrees with whatever it was written to agree with.

| # | Do | Clears | Result |
|---|---|---|---|
| **B1** | Run A1–A8 against a **hosted** endpoint. | [manual gate §2.2](11-p2-manual-gate.md) |PASS |
| **B2** | Run A1–A8 against a **local runtime**. They fail differently, which is the reason for both. | [manual gate §2.2](11-p2-manual-gate.md) | |
| **B3** | Chunks arrive **incrementally**, not in one lump. | [manual gate §2.2](11-p2-manual-gate.md) |PASS |
| **B4** | `usage` comes back populated; `ModelCall.resolved` names the model that **answered**; the turn's cost is **`null`, never `0`** — no price table ships, so a zero is a fabrication. | [manual gate §2.2](11-p2-manual-gate.md), P3 4 |PASS |
| **B5** | *Fetch models* against both, and against something that does not implement `/models` at all. Several local runtimes answer with one entry called `gpt-3.5-turbo` regardless of what is loaded. | [manual gate §2.2](11-p2-manual-gate.md), P2B 2.6 |PASS |
| **B6** | **Be a second user.** Create a non-admin, sign in from a second browser profile (R5), take a turn on the system connection, then revoke `privateConnections` and watch what the turn does. That capability is enforced in the resolver and its enforcement has never been seen from outside. | [P2C.2](12-p2c-first-real-run.md) | |
| **B7** | **Two tabs on one session.** Server fan-out is asserted; two real clients rendering the same deltas is not. | [manual gate §2.3](11-p2-manual-gate.md) |PASS |
| **B8** | **Two sessions at once** against the local runtime — one model slot, no queue, no concurrency cap. Whatever happens is the finding. | [P2C.2](12-p2c-first-real-run.md) | |
| **B9** | **Two admins on the settings page.** Save in one, then the other. Both offers of the 412 should work — *load what is on disk* and *overwrite with mine* — and a plain Save in between should still be refused. | [manual gate §2.3](11-p2-manual-gate.md) |PASS |

---

### ~~C — Break it on purpose~~ Walked 2026-09-08 — *eleven of eleven PASS*

**The half most likely to be skipped, and it held.** Every deliberate breakage
surfaced as a *classified* failure rather than a provider string: a wrong key, a
model id that does not exist, an endpoint answering HTML, the network cut
mid-stream. The ten-token ceiling came back as `outcome: 'truncated'` and not as
an error class, which is the distinction the field exists to draw and the one
thing here a test could not have told us.

**The three copy judgements passed too** — the removal dialog, the capability
groups, the restart banner. Those are opinions by construction
([playable log](21-playable-log.md): *a judgement is a finding*), and recording them as
passes is recording an opinion, which is what the step asks for.

*The sitting as it was written:*

**The valuable half, and the easy half to skip because nothing is going wrong
yet.** Each of C1–C5 should surface as a *classified* failure rather than a
provider string in the UI — except C3, which is not a failure at all, and telling
those apart is the point of the field.

| # | Do | Clears | Result |
|---|---|---|---|
| **C1** | Wrong key. | [manual gate §2.2](11-p2-manual-gate.md), P2 |PASS |
| **C2** | A model id that does not exist. | [manual gate §2.2](11-p2-manual-gate.md) |PASS |
| **C3** | **A completion ceiling of ten tokens.** No UI for this: hand-edit `preset.params.maxTokens` in the session's own `session.json`, a one-line edit, since a created session carries a full inline preset. Expect **`outcome: 'truncated'`** on the call, not an error class. | [manual gate §2.2](11-p2-manual-gate.md), [P2C.2](12-p2c-first-real-run.md) |PASS |
| **C4** | An endpoint that returns HTML. | [P2C.2](12-p2c-first-real-run.md) |PASS |
| **C5** | The machine's network off mid-stream. | [P2C.2](12-p2c-first-real-run.md) |PASS |
| **C6** | **Kill the server mid-turn** (Ctrl-C), restart, reload. The partial turn is recorded failed and the session is usable. | [manual gate §2.3](11-p2-manual-gate.md) |PASS |
| **C7** | **Sleep the laptop mid-turn**, wake it, watch the stream reconnect. Materially different from an aborted socket: a sleeping machine's socket dies without a close, and the resume goes through `Last-Event-ID` on a connection the browser reopened itself. | [manual gate §2.3](11-p2-manual-gate.md) |PASS |
| **C8** | **Close the tab mid-generation and reopen.** Automated at the socket level; a browser's actual unload is not. | [manual gate §2.3](11-p2-manual-gate.md) |PASS |
| **C9** | Start removing an account and **read the dialog before clicking.** It is the one piece of copy somebody would want to have read beforehand, and the only test of it is whether it reads that way. | [manual gate §2.4](11-p2-manual-gate.md) |PASS |
| **C10** | **The capability groups.** *In force now* against *recorded for later*: does the second read as honest, or as an excuse? | [manual gate §2.4](11-p2-manual-gate.md) |PASS |
| **C11** | **The restart banner.** Does *StoryEngine does not restart itself* answer the question it raises, or invite it? | [manual gate §2.4](11-p2-manual-gate.md) |PASS |

---

### D — The workbench, the record, and the disk — *walked to D10, 2026-09-08*

**D1–D10 pass. D11–D20 are outstanding.** The panel toggles from the keyboard
over both views, survives navigation and reload at the same size, is reachable
from nowhere else, and answers *what is about to fall out of context* without
generating anything. The live half — the running step named, a skip explained, a
failure attached to its step — works, and swaps to the record on commit.

**And the sitting produced the most valuable finding of the walk so far, which
no D item asked for.** P3 built a drag handle for the panel and
[P3 §4](15-p3-implementation.md) names it as the surface for the stored size.
It has been **zero pixels tall since P3** — `inset-block-0` is not a Tailwind
utility, Tailwind emits nothing for a name it does not know, and an
absolutely-positioned element with no block inset has no height. Only the
keyboard half of that control has ever worked. See [F-04].

*That is a gate correction as much as a finding:* D2 asks that the panel come
back **the same size**, and it does — because the size is stored and the only
thing broken is the mouse affordance for changing it. The step passes over a
control that is not there, which is exactly the shape of check this sheet's
`CORRECTION` vocabulary exists for.

*The sitting as it was written:*

P3's whole gate, plus the three storage scenarios [P2C.2](12-p2c-first-real-run.md)
added that nothing else has a home for.

| # | Do | Clears | Result |
|---|---|---|---|
| **D1** | Toggle the panel from the keyboard over **both** Play and Library. Typing in the action input or the guidance box does not fire it. It **insets** rather than replaces; Tab passes through; it is not `aria-modal`. | P3 1 |PASS |
| **D2** | Open the panel, then **Play → Library → Play**: still open, same size, subject changed with the view. Then reload: still open, same size. | P3 2 |PASS |
| **D3** | **Nothing switches it on.** No debug mode, no advanced toggle, no nav entry, nothing in Settings. | P3 3 |PASS |
| **D4** | Over a turn: every block's source is clickable through to the object; **no `unknown` sources**; the resolved model is the one that *answered* — and a cancelled or failed call truthfully records the one that was *asked*. | P3 4 |PASS |
| **D5** | *What is about to fall out of context* is answered from the verdict **without generating anything** — and on a turn with headroom it does not claim the system instruction is about to fall out. | P3 5 |PASS |
| **D6** | Per-block estimate beside per-call reported, on a turn where they differ. | P3 6 |PASS |
| **D7** | **The meter reflects the pending input.** Type into the action box: the fill changes with nothing sent. Clear it: it falls back to the head. With nothing bound to `prose` the meter is still there, saying it cannot measure and why. | P3 6a |PASS |
| **D8** | Over a library object: the as-stored view matches the bytes on disk — **hand-edit the file and watch the panel follow**; the folder path is one you can paste into a file manager; the revision list is there **with no restore button**. | P3 7 |PASS |
| **D9** | Over a **shadowed** object, the index rows name the winning path. | P3 8 |PASS |
| **D10** | **The panel says what is happening while it happens.** Take a turn with it open: the running step is named, a skipped step says why, a failure attaches to the step rather than the turn — and on commit the panel shows the record instead, with neither view lingering beside the other. | P3 8a |PASS |
| **D11** | **Compare.** Hand-edit the session's own copied preset on disk, drop a block's priority, take the same turn again: the compare view shows exactly what changed, and its address can be pasted into a bug report. | P3 9 | |
| **D12** | **The replay path is wired** — a committed tape can be handed to a runner and replays. *Not* identical draws; that moved to P5 and then to P6. | P3 10 | |
| **D13** | **Dry run**, if P3.7 shipped: inspect then send → one record; abandon → nothing sent, nothing charged, and a restart does not commit it. The pending state is visible and the session says it is busy. | P3 11 | |
| **D14** | **The legibility claim itself.** Somebody who did not build the turn opens the panel on a real turn they did not script and says why it came out that way — without the log, the source, or a JSON pretty-printer. **And its honest counterpart:** at least one turn where the answer is *I could not tell*, written down with what was missing. | P3 12, §6, PLAYABLE hyp. 4 | |
| **D15** | **Density.** A turn with thirty blocks reads as a table rather than thirty disclosures; nothing that belongs on screen is behind a click for calm's sake; the panel open over Play does not squeeze the transcript into a column nobody can read. | P3 13 | |
| **D16** | **The phone.** At 375px the same toggle produces a full-height sheet with the same content, the view under it does not scroll horizontally, and the sheet is dismissable one-handed. | P3 14 | |
| **D17** | **A rejected effect, visible with its reason.** *The step was flagged unperformable* — Scene shipped one step that writes nothing. **Re-check before walking:** P5.6 ships `se.lore.timing` effects and [P6B.1](20-p6b-playable.md) made two of them on one channel distinguishable, so the *rendering* half may now be walkable even if nothing yet proposes a **rejected** one. If it is still unperformable, that is a `DEFERRED` with the phase that ships an effect-producing step. | P3 15 | |
| **D18** | **Use a real editor, not `fs`.** Every write the watcher has ever seen came from node. Save once from a full editor, once from Notepad, and once as an Explorer copy-over, watching an open detail page. `awaitWriteFinish` has a 150 ms stability threshold and real editors write in ways `fs` does not. | [P2C.2](12-p2c-first-real-run.md) | |
| **D19** | **Hand-edit a committed turn** on disk. No route edits, deletes or re-runs one; the file is there, and what happens when somebody changes it is a storage question no test asks. | [P2C.2](12-p2c-first-real-run.md) | |
| **D20** | **The version history panel** — the app's only editing surface beyond the actor form, and on nobody's list. Edit five times, restore an old one, confirm **the restore is itself recorded**. | [P2C.2](12-p2c-first-real-run.md) | |

---

### E — Import, for real — *about an hour and a half, and it wants R1*

| # | Do | Clears | Result |
|---|---|---|---|
| **E1** | **Sweep a real SillyTavern data directory.** Populated library, review report at an address, nothing crashed, and **every file the sweep saw accounted for** — converted, recorded, skipped-by-position, or counted as unrecognised. | P4 1, P4 7 | **BLOCKED** — R1. Named outstanding by the step itself, which is why P4 could close without it. |
| **E2** | **The same for a Marinara data root.** | P4 1 | **BLOCKED** — R1. |
| **E3** | **The credential drop.** A preset with `proxy_password` → imported, credential gone from the object *and* from `compat`, review names the removed fields, and **no "import as-is" affordance exists anywhere.** | P4 3 | |
| **E4** | **Depth.** A depth-4 block sits four **messages** from the end in the block list — not at the top, not eight back. | P4 4 | |
| **E5** | **Macros, both halves.** An unrecognised macro imports verbatim and flagged; a recognised one renders through Liquid; **no literal `{{`** from the closed table's set reaches a rendered message. | P4 5 | |
| **E6** | **Re-import the same directory, of each kind.** Unchanged objects skip and are reported unchanged; a changed one offers replace or keep-both; nothing doubles silently. The Marinara arm is the sharper test — `originalFilename` for a row in a table is not a filename anyone typed. | P4 6 | Partly **BLOCKED** — the fixture arm is walkable now; the real arm wants R1. |
| **E7** | **One poisoned file never aborts a sweep.** A deliberately corrupt card is a `warn`-class row and the sweep completes around it. | P4 8 | |
| **E8** | **Rebuild equals incremental, after a bulk import** — run against the post-import library rather than a synthesised one. | P4 9 | |
| **E9** | **The config surface is honest.** `limits.maxUploadMb` reads `applied`; the `fileAccess` grant surface is somewhere an admin can reach **and says what it grants**, naming the sweep and not only the browser. | P4 10 | |
| **E10** | **The report is data.** Fetch the review over the API: reason classes, counts and parameters, **no stored English prose** — the sentences are composed client-side from the reason class. | P4 11 | |
| **E11** | **Undo is real in-app.** Delete a badly-imported object from the client; the tombstone behaviour is visible and the library reflects it. | P4 12 | |
| **E12** | **The three refusals**, each refusing **before anything is written**, each with a message a person can act on: a held `.writer-lease`, a `.migrating` marker, and a manifest declaring a format we do not know. A half-import is worse than no import. | P4 14 | |
| **E13** | **`.bak` does not double the library.** A root with a `.bak` beside every table imports the same object count, and the review reports them skipped. | P4 15 | |

---

### F — Lore under pressure — *about two hours, and F1/F6 want R1*

**Start here, because until [P6B.0](20-p6b-playable.md) nobody could:**

```bash
pnpm reset-data && pnpm seed && pnpm dev
```

then start a session **naming a treatment and a book**, take a turn, and open the
workbench. The lore report should show entries firing with their reasons. That
single walk is [P6B](20-p6b-playable.md)'s own verification and the entry point
to everything below.

| # | Do | Clears | Result |
|---|---|---|---|
| **F0** | The seeded end-to-end above: a session that resolves books, a turn, and a lore report with reasons. | [P6B §3](20-p6b-playable.md) | |
| **F1** | **A three-hundred-entry imported book opens as something readable**, and a named entry is reachable by its own address — the link survives a reload and lands on that entry. | P5 1 | |
| **F2** | **An entry that will not fire says why**, distinguishing *off*, *its folder is off*, and *the book is off* — and the folder case leaves the entry's own `enabled` **visibly unchanged**. | P5 2 | |
| **F3** | Filtering within a book by a key chip, a tag and a folder each narrows the list; the panel's own filters narrow the shelf. | P5 3 | |
| **F4** | A search phrase occurring in exactly one entry returns **that entry** with a snippet, across books. | P5 4 | |
| **F5** | An entry is created, edited and deleted through the real write path, and a collapsed section in the editor names its non-default values. | P5 5 | |
| **F6** | **Open a book you did not author** and judge whether the page reads as a document or as a form. | P5 6 | **BLOCKED** — R1, with lead time. Settled as person-blocked at [P6B.1](20-p6b-playable.md); this is its outcome, not a blank. §3, R1. |
| **F7** | **An imported ST lorebook fires on its keywords in a real session** — entries appear as blocks with `keyword match: "…"` reasons. | P5 7 | |
| **F8** | **Timing, three cases and they are not the same case.** A sticky entry **counts down in the block list** and says when its window closes; cooldown and ephemeral are legible in the record through their effects, now that two on one channel can be told apart. **`delay` is not** — record that rather than hunting for it; its only trace is a skip reason, and skip reasons reach the preview and never the record. | P5 8 | |
| **F9** | **Recursion.** An activated entry's text activates another; `preventRecursion` et al. honoured; no runaway at the book's depth limit. **Use a chain of width more than one** — every automated recursion test is width one, which is how [P6B.1](20-p6b-playable.md)'s haystack defect survived. | P5 9 | |
| **F10** | **Budget pressure.** A book over its `tokenBudget` drops entries in the documented order, each skip named with the blocking budget, and a small entry still fits after a large one dropped. **Spot-check `tokenBudget: 0`** — it now means unlimited, which is the first contradiction settled. | P5 10 | |
| **F11** | A rewrite reproduces identical activations. | P5 11 | **PART / DEFERRED.** P5's half — the keying — is met. The reproduction half is [P6 §3](18-p6-implementation.md) step 3's; there is no production replay entry point to look for. Settled at [P6B.1](20-p6b-playable.md). |
| **F12** | An entry conditioned on a channel that does not exist → visible warning, never fires, nothing blocks. | P5 12 | **DEFERRED — P7.** No entry can be conditioned on a channel; the schema lists `activationConditions` as deliberately absent. [work plan §195](01-work-plan.md)'s row moved and [P7 §0.1](23-p7-implementation.md) carries it. *Do not credit `unknownSources` here* — such an entry keeps scanning and can still fire. |
| **F13** | **The keyword tester answers *why does this entry never fire*** without playing a turn — and where the answer is a gate or a disabled book rather than a match, **it agrees with what the book page already showed.** Disagreement here is the failure P5.7 exists to prevent. | P5 13 | |
| **F14** | Timing counters reconstruct correctly at an old node. | P5 14 | **AUTO** — `sessions/reconstruct-property.test.ts`, discharged at P6.0a: four turns with a sticky, a cooldown and an ephemeral entry, replayed at every node of a forked session. |
| **F15** | **A hostile pattern from an imported book does not hang the server.** A catastrophically backtracking regex is abandoned at the timeout, the entry reports why, and the turn completes. The one gate step about somebody else's file being able to hurt you. | P5 15 | |
| **F16** | **The book page says what the import did to it** — a book whose entries lost something on the way in says so on the page, not only in the review. | P5 16 | |
| **F17** | The five delete sites are one, and the property can see them. | P5 17 | **AUTO** — `index-db/rebuild-property.test.ts` (`pnpm test:gate`), with the `orphan-fts` assertion added at [P6B.1](20-p6b-playable.md); before that, deleting one of the five left the suite green. |
| **F18** | The fixture-pair gate is green with lore as a producer. | P5 18 | **AUTO** — `import/fixture-pair.test.ts` (`pnpm test:fixture-pair`). |

---

### G — The long pass — *hours, unscripted; PLAYABLE's second sitting*

**Not a second scripted pass with a different list.** The point is duration and
accumulation: forty turns, a library with things in it that were made rather than
seeded, an index written to all afternoon, a watcher that has seen a hundred
events. None of the automated tests run long enough to be interesting, and none
of A–F leaves anything behind.

**Play it rather than test it.** The scripted pass answers whether a turn works;
this answers whether forty do.

| # | Watch for | Clears | Result |
|---|---|---|---|
| **G1** | Memory and handle growth; a session that gets slower as it gets longer; index and watcher disagreement after a lot of writes; SQLite lock contention; a keepalive that stops keeping alive. Look at the server's memory and the log **afterwards**, rather than not. | [P2C.3](12-p2c-first-real-run.md) | |
| **G2** | **The turn record getting harder to read as the thing it records gets longer.** This is the one that only shows up here. | [P2C.3](12-p2c-first-real-run.md), P3 12 | |
| **G3** | **The four PLAYABLE hypotheses** ([work plan §4.1](01-work-plan.md)) — is the record legible; does hand-editing a card mid-session take; is one budgeter comprehensible under pressure; do inclusion reasons explain anything. The fourth is the one 01 calls likeliest to be wrong. | PLAYABLE | |
| **G4** | **P5's four held-open questions** — the trim order, whether the per-book budget tier earns its keep, whether recursion depth needs a surface, whether the keyword tester is the diagnostic or a consolation. Observation prompts are already written at [P5 §0.3](17-p5-implementation.md). | P5 `[AWAITS PLAYABLE]` | |
| **G5** | **P6's two** ([P6 §5](18-p6-implementation.md)) — which reply an edit changes, and whether the sibling affordance is enough to find a line abandoned twenty turns ago. | P6 §5 | |

---

### H — The other platform — *about half an hour*

**Everything this project has ever verified was verified on Windows.** CI runs
the suite on ubuntu and `ci-shape.test.ts` stops that matrix being deleted
quietly — but CI does not *run the application*, and path handling, file watching
and SQLite locking are the three places this codebase has already been bitten,
all three platform-shaped.

| # | Do | Clears | Result |
|---|---|---|---|
| **H1** | Start the server on ubuntu (R6) and play a turn. | [manual gate §2.5](11-p2-manual-gate.md) | |
| **H2** | Hand-edit a library file from a Linux editor and watch the panel follow — the watcher half, which is the one with a platform-shaped history. | [manual gate §2.5](11-p2-manual-gate.md), P3 7 | |

---
### I — The container walk — *[P6A §3](19-p6a-alpha-1.md) steps 3–12, and it wants R8*

**Partly walked already, 2026-09-07**, by the first install: the template
pulled, the container started, and three findings came out of it — a root-owned
appdata directory, an icon that cannot exist while the repository is private,
and a setup token nobody could find. All three are fixed.

**What that walk did not cover:** step 7 (a turn from another machine), step 9
(restart with the volume), step 10 (the stamp refusing an older build), and step
12 (an unauthenticated pull failing).

**Answers:** whether the artifact this project cuts is installable by somebody
who is not its author. **Unblocks:** [P10.0](26-p10-implementation.md), which
re-verifies this path against an artifact it inherits rather than one it built.

### J — The tree walk — *[P6 §3](18-p6-implementation.md) step 1 and 14's clock, and it wants R9*

Step 1 is *branch from a message two hundred turns back, in one action, with
state at the fork correct.* Step 14's wall-clock half is *reconstruct at that
depth in a time a person would accept* — deliberately not a CI assertion,
because a threshold on a busy runner is a flake waiting to happen.

**Do this in the same sitting as G**, while a deep session exists.

**Answers:** whether the snapshot cache earns its complexity under real depth.
**Unblocks:** [P6 §5](18-p6-implementation.md)'s snapshot-interval question and
[P8](24-p8-implementation.md)'s cadence sizing, which wants real turn volumes.

### K — P6B's critical list — *two sittings and an hour of desk work; the one that closes a phase*

**The first critical list under [§0](#the-two-tier-gate)'s model, and the
reason the model exists.** P6B is the hardest case it will meet: P6B.2 *is*
PLAYABLE, the checkpoint [work plan §7](01-work-plan.md) calls skipping *"the
single most expensive economy available in this plan"*. So P6B does not close
on its buildable work — it closes on this, and everything else in its gate
extends the sittings above.

**Derived, not chosen.** Gate steps 6 and 7 are suite-covered and go to §5.
Step 8 is *"P5's eighteen steps, walked by a person"* — P5's claim living in
P6B's gate, which fails criterion (i) and goes to **F**. What is left is five
steps that each name a code path P6B itself built or repaired, none of them
covered by a test, plus the two the checkpoint owes.

| # | Do | Clears | Result |
|---|---|---|---|
| **K0** | **Cut and build 1.0-alpha 4 first.** Not a check — a precondition. [playable log](21-playable-log.md)'s record format opens with `git describe --tags --always --dirty`, and a finding recorded against a dirty tree is not attributable. 389 files of code have landed since alpha 3, including the fix for **F-04**; walking without cutting means re-finding a defect already fixed. | — | |
| **K1** | `pnpm reset-data && pnpm build && pnpm dev:logged`, then `pnpm seed`. Add a connection with the real key, answer the binding form, open the seeded session, take **one turn**, open the workbench lore report. **Expect** the treatment's entries as blocks with `keyword match` reasons, sourced *linked by the treatment*. | P6B 3; **F0** entire | |
| **K2** | **Hand-author a twelve-entry SillyTavern world** across the `position` map in `import/sillytavern/lorebook.ts:51-60` — three `before_char`, three `after_char`, two flagged-collapse, one `at_depth: 4`, one outlet naming nothing, a width-2 recursion chain, one `constant`, one `disable`. Import it through the single-file pick and read the review. **The shipped fixture will not do:** `RAIN_CITY_BOOK` has only positions 0 and 4, so it never exercises the `after_char` defect P6B.1 fixed. **Record it as a format probe, not R1** — you wrote it, so it cannot answer what limits real authors set. | sets up P6B 5, **F7** | |
| **K3** | Create a session **in the browser** naming the treatment *and* the imported book; confirm the report distinguishes *linked by the treatment* from *linked by this session*. Take several turns, then attach a third book mid-session through the panel and take the next turn. | P6B 1, 2 | |
| **K4** | **The single most critical item.** Play turns hitting keys at each position group. Reconcile **every** activation in the lore report against either a block in the right phase or a refusal row naming its rule. **Nothing may activate, be charged, and disappear.** Confirm the `at_depth` entry sits four *messages* from the end and the width-2 chain fires both children. | P6B 5; **F7**, **F9**'s person half | |
| **K5** | Set the imported book's `tokenBudget` to a value that cuts; read the drop order and the skip rows. Set it to `0` and confirm it means unlimited. Then make the **global** arbiter cut and read the verdict. | **F10**; hypothesis 3's answerable half | |
| **K6** | Two tabs on one session, force a `412 stale-head`; then unbind the `prose` role and send. Both must say something on screen. **This is the play page's rendering**, not the settings 412 that B9 already passed. | P6B 4 | |
| **K7** | Hand-edit an actor's `description` on disk mid-session. Take the next turn; the block table shows the new text. | **hypothesis 2**, in full | |
| **K8** | With the workbench open on a turn carrying retrieved lore, a budget refusal and an unplaced entry, **write answers to the four hypotheses** in [playable log](21-playable-log.md)'s record format — `expected` before `observed`. **Include one honest *I could not tell*** if it is true. Record which of A9's three mitigations you used. | P6B 9; **D14** | |
| **K9** | **Desk work, 45 minutes, no install.** Route every finding — the six in the playable log, whatever K1–K8 produced, and [P2C log](14-p2c-log.md)'s fourteen — to one of [P2C §2.5](12-p2c-first-real-run.md)'s five destinations. Then update §6, add the date beside R1 in §3, and write the status lines. | P6B 10 | |

**What this list cannot reach, stated so nobody mistakes a pass for a finish.**
Every item here is one turn long and none leaves anything behind, so a defect of
*accumulation* survives it intact — G1's index-and-watcher disagreement after an
afternoon of writes, G2's record becoming unreadable as it grows, J's snapshot
cache at depth. **And the sharpest one is a property of this design rather than
of the code: the budgeter may look comprehensible precisely because the walker
chose the book, the budget and the turn.** A controlled experiment answering a
question about uncontrolled use is what a full walk exists to avoid, and this
list is a controlled experiment by construction.

**A second way it could pass and be worthless: it cannot fail the way C did.**
Sitting C ran eleven deliberate breakages, passed eleven, and produced **no
refinement note at all**, while the quiet sittings produced five. K1–K7 are all
built around something going wrong or being made to go wrong — the shape that
has so far produced nothing. **Keep [refinements](22-walkthrough-refinements.md)
open beside the log, and treat a sitting that adds no row to it as a signal
rather than a clean sweep.**

---


## 5. Already discharged, and by what

Listed so the count is honest. **Nobody walks these.**

| Step | Result | By |
|---|---|---|
| **P1's gate** | **AUTO** | The named gate test, run in CI on every push. §6's only row with nothing owed. |
| **P4 2** | **AUTO** | `import/fixture-pair.test.ts`, a named CI step: no `empty-source` rows for persona, actor, history or input, no `unknown-slot` rows at all. |
| **P4 13** | **AUTO** | `import/registries/registries.test.ts` over the two vendored snapshots — every ST directory key and Marinara table maps to a disposition, and a name in neither imports as unrecognised-and-counted. |
| **P5 14** | **AUTO** | See F14. |
| **P5 17** | **AUTO** | See F17. |
| **P5 18** | **AUTO** | See F18. |
| **P6B 6** | **AUTO in part** | `retrieval/activate.test.ts` — *"feeds every entry that activated into the next pass, not the first `scanDepth` of them"*, the width-three chain [P6B.1](20-p6b-playable.md) added at the default depth. **Its carrier is the third entry in scan order**, so the step's second clause — raising an `order` does not remove text from the haystack — is covered in substance and by nothing that says so: no test raises an `order` and re-checks. K4's width-2 chain is the person-side residue; **do not open a sitting for it.** |
| **P6B 7** | **AUTO** | `state/migrations.test.ts` — *"carries every import item across the step that rebuilds its table"*, written at the version the step leaves *from* and asserting every column rather than a count. The step asks for a **mutation** rather than a pass, and it was run at [P6B.1](20-p6b-playable.md) (`a6d3eb4`, `0e228ec`, `39f9ee1`): deleting the `insert into import_item_new … select` reddens it, where before P6B.1 it left the whole suite green. Re-running it is a minute at a terminal. |
| **P2 / P2A / P2B** | **AUTO in part** | 8 of 20, 13 of 17+2, and 9 of 11 respectively. The residue is [manual gate §2](11-p2-manual-gate.md), which is sittings A–D above. |
| **P3 1–11** | *Assertable, coverage unaudited* | Marked "assertable" by [P3 §4](15-p3-implementation.md), but **which of them a test actually asserts has never been checked.** They are in sitting D as browser checks because confirming one takes a minute and auditing eleven takes an afternoon — and a step believed covered is exactly what [P6B.1](20-p6b-playable.md) found four of. |

---

---

## 6. Where every gate stands

*Anchored 2026-09-08 at `fb646c5`: 2,889 tests across 194 files, green, plus
`test:gate`, `test:fixture-pair` and `test:docs`. [manual gate §1](11-p2-manual-gate.md)'s own
anchor reads 1,186 and is four phases stale — noted rather than edited, because
that document's anchor is a record of when it was walked and moving it would be
a claim nobody made.*

| Gate | Steps | Automated | Walked | What is left, and by whom |
|---|---|---|---|---|
| **P1** | — | the named gate test | — | Its exit is the CI step, which runs. **Nothing outstanding.** |
| **P2 / P2A / P2B** | 20 / 17+2 / 11 | 8 / 13 / 9 | **A, B (less B2/B6/B8), C** | [manual gate §2.3](11-p2-manual-gate.md) the browser under real conditions, and §2.5 both platforms — H |
| **P2C** | 4 stages | P2C.0 only | **P2C.1**, 2026-09-08 | .2 is A–D, .3 is G, .4 is the triage. The boundary has since been crossed by ordinary use; what was never done is *capture* |
| **P3** | 15 | most | **steps 1–10**, 2026-09-08, plus one gate correction | D11–D20. Step 12 is PLAYABLE's fourth hypothesis wearing a step number |
| **P4** | 15 | most | — | E. Step 1 wants R1 |
| **P5** | 18 | partly | — | F. Step 6 is person-blocked on R1; step 12 is deferred to P7 |
| **P6** | 14 | steps 2–14 | **unwalked** | J — step 1 and the wall-clock half of 14 |
| **P6A** | 13 | 1, 2, 13 partly | **steps 3–12 unwalked** | I. Partly walked 2026-09-07 by the first install |
| **P6B** | 10 | **6, 7** — §5 | **K, pending** | **The first gate to split under [§0](#the-two-tier-gate).** Steps 1–5, 9 and 10 are sitting **K**, the critical list, and the phase does not close until they have results. Step 8 is P5's eighteen wearing P6B's number — criterion (i) — and is **F** |
| **PLAYABLE** | the four hypotheses | none, by definition | **never run** | K5–K8 answer what a walker's own turn can; G is the uncontrolled one. **CORRECTION, 2026-09-09:** this row read *"the fourth survived its first contact at A8"*. It did not. A8's session **resolved zero books** — [P6B.0](20-p6b-playable.md)'s defect — so that turn carried no retrieved blocks and none of the retriever's reason vocabulary. A8 evidenced hypothesis 1 and the static reasons; **hypothesis 4 has never been in contact with anything** |
| **P7 … P11** | 10 / 10 / 15 / 10 / 10 | — | not yet opened | **55 person-walked steps still to arrive.** P7, P10 and P11 each carry a step marked *only a person can walk*, and in each it is the phase's whole claim |

**Two things this table makes plain and no single document did.** Every gate
from P3 onward is unwalked, and each phase document says so about itself while
none says it about the sequence. And **the walks are not independent**: P3 step
12, P4 step 1, P5 step 6, P6 step 1 and PLAYABLE's four hypotheses all want a
real imported library and a long session played by a person. One arrangement
answers five obligations.

---


## 7. Closing a gate, and closing a phase

**These are two events now, and the file that confuses them loses the model.**

**A phase closes** when its buildable work is done and **its critical list is
walked** — the small tier, derived by §0's criterion, whose results are recorded
in the phase document's own table. The remainder arrives here as sittings the
same day.

**A gate closes** later, when **every one of its steps has a result** — not when
every step passes. `BLOCKED` and `DEFERRED` are results; a blank is not. A
gate may stay open for months after its phase closed, and that is the ordinary
case rather than a failure: P5's eighteen sit in sitting F while P5 itself is
closed.

**What the phase document must say on the day it closes**, and the third is the
one that gets skipped:

1. Its status line says so, with the date, **which steps were the critical list**
   and where the rest went.
2. §6's row changes to the split — walked, deferred, and to which sitting.
3. **Every `CORRECTION` is written back into the document that owns the step.**
   The corrections are worth more than the ticks — that is
   [P2C.4](12-p2c-first-real-run.md)'s claim, made from the one walk this project
   has actually completed.

---

## 8. Where a finding goes

**Evidence to [playable log](21-playable-log.md)**, in that file's record format — build,
endpoint, session, **expected before observed**, snapshot. One log, not two:
the sittings here and [P6B.2](20-p6b-playable.md)'s play are the same evidence
gathered on different days, and splitting them would make the triage read two
files and reconcile them. [P2C log](14-p2c-log.md) is P2C's and is closed to new
entries; **its fourteen findings still need triage rows**, which is an
obligation this file carries at §10 rather than leaving inside a log whose own
rule says it is not a queue.

**Requests to [refinements](22-walkthrough-refinements.md)**, graded rather than
scheduled. What a person saw is a finding; what they asked for is a proposal;
the two go stale at different rates.

**Nothing is fixed because it is written there.** That is the log's own standing
rule and the reason it stays honest: a finding that has to justify a fix before
it can be recorded is a finding that does not get recorded.

**Triage by [P2C §2.5](12-p2c-first-real-run.md)'s five destinations**, decided
in advance because afterwards every finding argues for its own importance:
**stops the phase / fixed inside it / a gate correction / polish / a later phase
or the roadmap.** Nothing is allowed to have no home.

**A pass that produces no written finding produced no finding.** Not a slogan:
[P2C](12-p2c-first-real-run.md) is the phase that proved it, and the reason its
log exists is that the first pass's observations were not reconstructible
afterwards.

---


## 9. Should be a test, and is not yet

**Absorbed from [manual gate §4](11-p2-manual-gate.md), which carried five.** A
should-be-a-test list stranded in a document marked historical is a list nobody
reads, and this is the section that keeps this file from becoming a checklist
that only grows. Their state today:

- **4.1 a recorded transcript tier for the provider adapters** — the machinery
  landed (`*.live.test.ts`, cassettes into `captures/`, promotion by hand), and
  **no cassette has ever been promoted**: there is no
  `packages/server/src/providers/fixtures/`. [P6B §1.6](20-p6b-playable.md)
  captures during play; promoting is what closes this.
- **4.2 nobody fuzzes a hand-written file, and every one of them is
  hand-written** — still open, and it is the one that found six real defects in
  one pass. The sharpest class in the file.
- **4.3 two clients on one session, at the DOM tier** — still open. P6's
  stale-head work made the server half testable and the DOM half is untested.
- **4.4 the suite is load-sensitive** — still open.
- **4.5 the ubuntu leg has never been watched** — still open, and now also
  sitting H.

**What this sweep adds to that list:**

- **The seed script had no test until [P6B.0](20-p6b-playable.md)**, and the
  reason it shipped broken through two phases is that nothing looked at it. Any
  other dev script in `tools/` is in the same position.
- **A request body can be built wrong under a green suite.**
  [P6B.0](20-p6b-playable.md) found `createSession` could send `{name}` alone
  with both page tests passing, because they mock the function. Every other
  client call whose body is assembled from optional fields has the same shape
  and no equivalent test.


---


## 10. Deferred, with an owner

*The point of this section is that everything in it has a name beside it.
Anything that loses its owner comes back to §0's rule.*

| Item | Where it was made | Owner | Why deferred |
|---|---|---|---|
| The permissive corpus | [P4 §0](16-p4-implementation.md), [P5 §1.6](17-p5-implementation.md) | whoever acquires it; blocks P4 step 1 and P5 step 6 | Person-blocked with lead time. Cannot be synthesised. §3, R1 |
| **F22's leftover** — the rebuild/watcher divergence over a refused path | [P2 §782](08-p2-implementation.md) | ~~P2.7~~ ~~nobody~~ **closed at P6B.1**, `0e228ec` | See §10.1 — and it was a live divergence, not the bookkeeping the sentence made it sound. |
| P2 gate step 8 / F12 — an editor-page mount rather than a component mount | [P2 §958](08-p2-implementation.md) | unassigned; "unblocked rather than done" | The harness exists now, so it is a test somebody has to write |
| A killed *process* names no model call | [manual gate §3.6](11-p2-manual-gate.md) | the suite's one `it.todo`, `recovery.test.ts` | Needs a provisional call in the checkpoint |
| The record cannot say a block is advisory | [manual gate §3.6](11-p2-manual-gate.md) | unassigned | `assemble()` drops `Candidate.advisory`; `ModelCall` records no purpose. **[P7](23-p7-implementation.md) makes this expressible or it stays unexpressible** |
| Two clock-effect constructors disagree; `clockEffect` has no production caller | [manual gate §3.6](11-p2-manual-gate.md) | unassigned | Dead code with a disagreement in it |
| A turn carries no money total | [manual gate §3.6](11-p2-manual-gate.md) | [work plan §2](01-work-plan.md)'s day-one list says record cost now, display later | `costOf()` never aggregates. The recording is done; the aggregate is not |
| `requestId` unbound on job log lines | [manual gate §3.6](11-p2-manual-gate.md) | deferred **with a written reason** — the model | A turn outlives its request; carrying one means a column, a migration and a meaning |
| Nightly tier, dependency-licence scan, forward-port check | [testing §6](03-testing.md), [releases §8](04-repo-and-releases.md) | [P11](27-p11-implementation.md) | Beta-gate work; `testing` landed early at alpha.2 and nightly did not |
| Restore test, upgrade test | [work plan §8](01-work-plan.md), [25 E6](../25-open-questions.md) | [P11](27-p11-implementation.md) | "An untested restore is not a backup" — and it is 1.0 scope |
| Release-line support window; release-branch cut point | [releases §8](04-repo-and-releases.md) | [P11](27-p11-implementation.md) | Cheap to declare now, awkward later; no release line exists yet |
| The ten polish items | [polish](06-polish.md) | unscheduled by design | The file's own house rule: user-facing, bounded, not roadmap |
| **What sitting K cannot reach** — hypothesis 3 under a real library's pressure, hypothesis 4 under a long session, and any defect of *accumulation* | [K](#k--p6bs-critical-list--two-sittings-and-an-hour-of-desk-work-the-one-that-closes-a-phase), on the day it was derived | **[G](#g--the-long-pass--hours-unscripted-playables-second-sitting) and J**, which is a named sitting rather than a person — and R1 and R9 are what they wait on | **This row exists because the two-tier gate owes it.** A critical list closes a phase on the part that compounds; the part it drops has to land somewhere with a name, or the model is just a smaller gate with the same silence. Every K item is one turn long and leaves nothing behind, so nothing in it can see a leak at turn forty |

### 10.1 The dangling owner, which is the finding this sweep exists to have produced

**F22's leftover is owned by `P2.7`, and P2 has stages P2.0 through P2.6.**

The sentence that assigned it says exactly why it was assigned:

> *"**Still open, and now owned by P2.7** — P2.6 opened the same code and did not
> take it, so leaving it pointed at a closed stage is how it becomes nobody's."*

It was moved off a closed stage and onto a stage that was never created, so it
became nobody's by the other route. That is [work plan §0.5](01-work-plan.md)'s *a bar
nobody owns is a wish* in miniature, and it is the exact failure
[P7 §0](23-p7-implementation.md) says a skeleton exists to prevent — **a
deferral nobody collects is a deferral that gets lost.**

**It needs an owner before this file is worth anything**, and the honest
candidates are two: fold it into [P6B.1](20-p6b-playable.md), which is already
opening the index and storage code for the `orphan-fts` assertion and the
migration test; or write it into [P11](27-p11-implementation.md)'s audit as a
known defect with a test to write. **The recommendation is P6B.1**, because the
work is in the same file and the alternative is a fifth year of the same
sentence.

**Taken, and closed 2026-09-07 at `0e228ec` — and it was not the small thing
the sentence made it sound.** Opening the code found a *live divergence* rather
than an unreconciled asymmetry: a rebuild refused a folder whose name this build
will not resolve and counted a silent skip, while the watcher never applied the
rule at all and **indexed a row pointing at a file no read in this build can
open** — every read goes back through the same builder, which throws. Indexing
it was worse than not indexing it.

**Neither the P1 gate nor any unit test could have caught it, and the two
reasons are why it lasted six phases.** The gate compares what got indexed, and
the disagreement was about something that did not: it lived in a table the
comparison never read. And the folder names in question cannot be created on the
machine this repository is developed on, so a test that made one would be a test
that never ran here — the seam is the layout instead, which refuses one ordinary
slug on demand.

Both producers now ask the same function, the refusal is recorded rather than
counted, a rebuild clears that table like every other stale belief it must not
preserve, and the snapshot reads it — **an absence has to be in the comparison
or it is not compared.**

*The general lesson, since this section exists to have produced one:* the
sentence was six phases old and read like bookkeeping. It was a defect. **A
deferral nobody collects is not merely lost; it stops being read, and what it
says stops being checked.**

---

## 11. What this file replaced

**The pre-P6 walk sheet is merged into this file and gone.** It was
`27-pre-p6-walk.md`, and it existed for eight days. Its condensing method survives as §4's shape and is worth restating,
because it is the technique for turning any newly-closed gate into sittings:
**merge the duplicates across gates, give the scattered obligations a sitting of
their own, and pre-fill anything that already has an answer.** The list does not
get shorter than the gates; it gets *sequenced*, and that is the transformation
worth doing.

Three documents are now historical and are marked so in place. [manual gate](11-p2-manual-gate.md)
is the P2-era record: its §2 is walked through sittings A–D and H, its §4 is
absorbed above, and it stays a cited source because thirty of §4's rows cite it
for the reasoning behind a step. [P2C log](14-p2c-log.md) is closed to new entries.
[P2C brief](13-p2c-brief.md) is historical as a brief and **permanently live as the
runbook** — §2.2–§2.4 is the only one in the corpus.
