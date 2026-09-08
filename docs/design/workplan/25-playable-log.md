# 25 — PLAYABLE findings log

**Appended to as things happen; emptied by [P6B.3](24-p6b-playable.md)'s
triage; kept afterwards rather than deleted.** What a person saw the first time
is not reconstructible later, and it is the one artifact a second pass cannot
produce — a second pass is by definition made by somebody who already knows.

**This file is not a queue.** Nothing is fixed *because* it is written here.
[P6B §1.7](24-p6b-playable.md) decides where each entry goes, and the decision
is made at triage rather than at the moment of annoyance, because afterwards
every finding argues for its own importance.

**Why this file exists at all.**
[P5 §0.3](07-p5-implementation.md) wrote observation prompts for the run-up to
this checkpoint — four things to notice while doing something else, each of
which closes one of P5's held-open questions — and
[P5 §0.4](07-p5-implementation.md) then recorded the gap in one line:
*"§0.3's instruction has no receptacle."* This is the receptacle, in
[16](16-p2c-log.md)'s shape, which is the shape that worked.

---

## How to write one

Five lines, in this order, so a finding arrives as a record rather than as
prose. The first three are what make it reproducible; the last two are what make
it a finding rather than a feeling.

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
somebody expected and what happened is most of what this checkpoint is for — it
is the part that stops being visible the moment you understand the cause.

**`snapshot` is a real path or the word `none`.** Stop the server, copy the
whole data directory including `-wal` and `-shm`. A finding whose state is gone
is one somebody will re-derive from scratch.

**A judgement is a finding.** Unlike [16](16-p2c-log.md), which was mostly about
a boundary either working or not, this checkpoint asks four questions whose
answers are opinions: *was that legible, was that comprehensible, did that
explain anything.* Those are recorded the same way, with `expected` carrying
what the design claims and `observed` carrying what you actually thought. **An
answer of "I could not tell" is a finding**, and [P3 §3](05-p3-implementation.md)
step 12 already asks for at least one of them honestly.

---

## What this is watching for

Six questions arrive at this checkpoint already written, and a session that
watches for nothing produces a memory rather than a finding.
[P6B.2](24-p6b-playable.md) has the full statement; this is the card to keep
beside the keyboard.

**The four hypotheses** ([01 §4.1](01-work-plan.md)):

1. The turn record is *legible*, not merely complete — use the workbench to
   answer a real *why did it say that*.
2. Files on disk beat a database here — hand-edit a card mid-session and watch
   it take.
3. One budgeter over everything is comprehensible — watch it under pressure
   against an imported library, not fixtures.
4. Inclusion reasons are a product feature — read them and see whether they
   explain anything. **01 calls this the one most likely to be wrong and the
   cheapest to fix here.**

**P5's four** ([P5 §1.11](07-p5-implementation.md), prompts at
[§0.3](07-p5-implementation.md)): whether the trim order is right; whether the
two-tier budget's per-book tier earns its keep; whether recursion depth needs a
surface; whether the keyword tester is the diagnostic or a consolation.

**P6's two** ([P6 §5](08-p6-implementation.md)): which reply an edit should
change; and whether a count and two arrows are enough to find a line abandoned
twenty turns ago.

---

## Sessions

*Each session gets a heading with its date and which stage it belongs to.
Findings go under it in the order they happened, not in order of importance —
the order they happened is data, and reordering by importance discards it.*

<!-- The first session's heading goes here. Nothing has been played yet. -->

---

## Triage

*Filled at [P6B.3](24-p6b-playable.md), and the phase does not end until every
finding above has a home here.
[P2C §2.5](15-p2c-first-real-run.md)'s five destinations:*

- **Stops the phase** — the observations already made were of a broken system.
- **Fixed inside the phase.**
- **A gate correction** — a step asked the wrong question.
- **Polish** ([09](09-polish.md)).
- **[P7](18-p7-implementation.md) or the feature list** ([14](../14-roadmap.md)).

**Nothing is allowed to have no home.**

*And one piece of inherited bookkeeping:* [16](16-p2c-log.md) holds fourteen
findings from P2C.0's smoke run under a *Triage* heading that is still empty.
They get homes at the same sitting, or a recorded reason why not.
