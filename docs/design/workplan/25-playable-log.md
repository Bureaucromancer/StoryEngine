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

### 2026-09-08 — the pre-P6 walk, sittings A–D — [27](27-pre-p6-walk.md)

*Not [P6B.2](24-p6b-playable.md)'s play. These are the observations from a
scripted gate walk, kept here because [27 §5](27-pre-p6-walk.md) puts both in one
log: they are the same evidence gathered on different days, and splitting them
would make the triage read two files and reconcile them.*

**Six findings. The requests they came wrapped in are graded and placed in
[28](28-walkthrough-refinements.md); what follows is only what was seen.**

#### F-01 — the connection list is thin at the point you need a second model

```
build     1.0.0-alpha.3 (c126cba)
endpoint  hosted, real key
session   n/a — settings surface, reached from B9
expected  having configured one connection, configuring a second against the
          same provider would be a short path
observed  every field is retyped, including the key; there is no duplicate, no
          reorder, and nothing relates two connections that share a provider
snapshot  none
```

**B9's own check passed** — both halves of the 412 work. This is what was noticed
while standing on that screen, and it is kept separate from the step's result on
purpose. Graded at [28](28-walkthrough-refinements.md) R2, where the diagnosis
changes: the data model already separates provider from model, and the thing
actually blocking *use a second model* is a role-binding editor.

#### F-02 — nothing happens between Send and the first token

```
build     1.0.0-alpha.3 (c126cba)
endpoint  hosted, real key
session   every turn taken in sittings A–D
expected  pressing Send would visibly do something
observed  the button does not change, no live region fires, and the composer
          clears — so the only feedback is the disappearance of your own text
snapshot  none
```

**This is a recorded, deliberately-accepted condition, not a regression.**
[17 §](17-p2c-brief.md) says it almost word for word: *"There is no progress, no
step display and no spinner."* What is new is that a person walked into it and
called it *painful*, which is the evidence that brief was waiting for.

#### F-03 — a turn in flight is invisible unless the workbench is open

```
build     1.0.0-alpha.3 (c126cba)
endpoint  hosted, real key
session   as F-02
expected  the transcript would say a turn was running
observed  it does not; the only surface that knows is the panel, which is closed
          by default
snapshot  none
```

[05 §9](../05-ui-surfaces.md) specifies this almost verbatim — *a collapsed line
while things go well* — and P3.5 built it only inside the panel.

#### F-04 — the workbench drag handle has never had a height

```
build     1.0.0-alpha.3 (c126cba)
endpoint  n/a
session   n/a — sitting D, alongside D1 and D2
expected  the panel could be resized by dragging its edge, which is what
          [05 §3](../05-ui-surfaces.md) specifies and what P3.1a built
observed  the pointer finds nothing to grab. `Workbench.tsx:221` carries
          `inset-block-0`, which is not a Tailwind utility, so no rule is
          emitted and an absolutely-positioned element with no block inset is
          zero pixels tall. Only the keyboard half has ever worked.
snapshot  none
```

**The most valuable finding of the walk, and it indicts three things rather than
one.** Already fixed at `71ff7f1` on `feat/tagging_and_search`, together with a
test that reads the built stylesheet — the gate this bug class has never had.
[P3 §](05-p3-implementation.md)'s stage record claims a browser walk that cannot
have happened, and [27](27-pre-p6-walk.md)'s D2 tests that a size *persists*,
never that it can be *set*. See [28 §2.1](28-walkthrough-refinements.md).

#### F-05 — the workbench cannot be pointed at a turn the head has passed

```
build     1.0.0-alpha.3 (c126cba)
endpoint  hosted, real key
session   sitting D, over a session with several turns
expected  opening the panel on an earlier turn would show that turn
observed  it shows the head. Reaching an earlier turn means moving the head —
          *continue from here* — which changes the story to inspect it
snapshot  none
```

[05 §444](../05-ui-surfaces.md) says the panel shows any turn *"current or
historical"*. The reader for it exists (`useTurn`) with one caller, and P3.6
landed without the per-turn affordance it was assigned.

#### F-06 — *continue from here* is not predictable, and that is an answer

```
build     1.0.0-alpha.3 (c126cba)
endpoint  hosted, real key
session   sitting D
expected  per [P6 §1.8](08-p6-implementation.md)'s lean, a count and two arrows
          would be enough to work with a branched session
observed  it is not obvious what continuing from an already-answered turn will
          do before you do it, and nothing marks a turn that already has a
          continuation
snapshot  none
```

**A judgement, and the one this checkpoint most wanted.** [P6 §1.8](08-p6-implementation.md)
deferred exactly this question to PLAYABLE and said so twice. It is
[P6B.3](24-p6b-playable.md)'s to route, and it answers rather than asks.

---


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
