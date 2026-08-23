# 05 — P3 implementation plan

**Status: revised.** Drafted during P1 as a skeleton, whose own instruction was
*to be revisited before the phase starts, chiefly against what the P2 turn record
actually looks like on screen*. P2, P2A and P2B are built, so §2 below has been
checked field by field against the record as it exists rather than as it was
designed. Format follows [03](03-p1-implementation.md).

**The headline of that revisit: the record holds almost everything, which is the
claim this phase rests on and it survives inspection.** `AssembledBlock` carries
source, plain-language reason, role, tokens, `included` and the rule that dropped
it. `BudgetVerdict` carries the window *and where the number came from*, the
reservation, the spend, every decision in the order considered — included ones
too — and `nextToDrop`. `ModelCall` carries the resolved connection and model,
the rendered messages, the params, usage, wall time, outcome, a classified error
and a retry count. `StepOutcome` carries skip reasons and failure reasons. **Five
things are missing and §1.5 is the list**; two of them are one field each in P2's
record, which is what the skeleton's own constraint says to do about them.

**P3 delivers**, from [01 P3](01-work-plan.md): the workbench — block list with
sources and reasons, budget verdict, calls, effects, per-turn cost, edit a block
and re-run, diff between two turns.

**The demo that defines done:** *use the workbench to answer a real "why did it
say that" without reading a log.* That is also one of the four PLAYABLE
hypotheses ([01 §4.1](01-work-plan.md)) — whether inclusion reasons are a
product feature or a debug string is answered by a person using this surface,
and P3 is what makes the question askable.

**The design constraint that shapes everything:** the workbench is a **reader,
not a second assembler** ([05 §3](../05-ui-surfaces.md)). Every view below renders
a field the record already holds. If a view needs data the record lacks, the fix
is in P2's record, not in workbench-side recomputation — recomputation is how
the viewer and the truth drift apart.

**Why the phase is early and small.** Everything after P3 is debugged through
it, and it is nearly free at this point because the record already holds
everything ([01 P3](01-work-plan.md)). If a stage here grows large, something is
being computed that should have been recorded.

**CI this phase establishes:** little that is new — the record is already
golden-file tested. The workbench's own logic (diffing, the rendered block
table) is unit-tested; the E2E journey "take a turn, open the workbench" joins
the thin Playwright set ([10 §3.5](10-testing.md)).

---

## 1. Decisions this plan has to make

### 1.1 How much workbench lives in the play surface

[05 §3](../05-ui-surfaces.md)'s open question. Lean, per that section: a minimal
persistent affordance — a context-fill meter on the input bar, clickable through
to the full record — and the workbench proper as a panel/route beside the
session, not a drawer on every message. **Decided at §1.6**, now that the P2 play
surface is in hand: P3 replaces the existing disclosure rather than adding a
second surface beside it.

### 1.2 Edit-and-re-run defaults to rewrite

Re-running with an edited block follows the rewrite/reroll distinction and
defaults to **rewrite** ([05 §3](../05-ui-surfaces.md),
[07 §14.5](../07-tech-stack.md)) — editing a block is changing the input, not
asking for different luck. This consumes the RNG tape P2.1 recorded and is the
first user of replay mode; if the tape turns out incomplete here, that is a P2
bug found early, which is part of why P3 is early.

*Checked at the revisit: the tape exists and a turn carries it — `draft.tape =
rng.tape` on the commit path — but **nothing has ever replayed one**, because
nothing rerolls until P6 and P3 is the first caller. So "incomplete" remains an
open risk rather than a closed one, and this stage is where it is found.*

Marinara's separation holds: editing affects only the regeneration, never the
reply already on screen.

**To resolve on revisit:** where the re-run lands before P6's sibling
navigation exists. Lean: it is a sibling turn under the same parent — the tree
storage exists from P2.2 — and the UI simply shows the newest, with real
sibling navigation arriving at P6.

### 1.3 What "diff two turns" compares at P3

Full generality (any two turns, any two sessions) is not needed to answer "it
got worse and I don't know what I changed". Lean: same-session turn pairs, diffing
the block table (presence, order, tokens, verdicts) and the call parameters —
not prose diffing of block contents beyond a changed/unchanged marker. Expand
later if PLAYABLE demands it.

### 1.4 Dry run needs one new server affordance

**Promote a dry run** — assemble without sending, inspect, adjust, send
([05 §3](../05-ui-surfaces.md)) — is the one workbench feature that is not purely a
reader: it needs an "assemble only" variant of the turn job. Cheap, because it
is the same pipeline stopped before dispatch, and it must produce a real (unsent)
record rather than a lookalike. The keyword-test panel, generalised
([05 §3](../05-ui-surfaces.md)), is this same machinery pointed at pasted text —
but its interesting sources are lore, so it lands with P5 rather than here.


### 1.5 What the record does not hold, found by checking rather than assuming

The skeleton's constraint — *if a view needs data the record lacks, the fix is in
P2's record, not in workbench-side recomputation* — turns out to have five
callers. Listed with where each belongs, because three of them are not this
phase's work.

- **Per-turn cost is tokens and time, not money.** `TurnCost` is
  `{promptTokens, completionTokens, wallMs, model}` and `ModelCall.cost` is
  hard-coded `null`, with a docstring saying why: no price table ships, and a
  fabricated number is worse than none. So **P3 renders spend in tokens**, which
  is the honest unit and the one a person can act on anyway — a block costs
  tokens, not cents. *A price table is a prerequisite for the money view and is
  scheduled nowhere; [05 §3](../05-ui-surfaces.md)'s aggregate spend is already
  post-1.0, and per-turn money should join it rather than pretend to be near.*
- **`advisory` is dropped between the candidate and the record.** `admit()` reads
  `Candidate.advisory` to enforce [03 §5.2](../03-modes-and-turn-pipeline.md)'s
  firewall, and `AssembledBlock` has no such field — so the block table cannot
  mark an advisory block, and [testing §1](10-testing.md)'s invariant *no
  advisory block ever appears in an effect-producing call* **is not expressible
  over a committed record at all.** *One field on `AssembledBlock`. P2's record,
  not P3's viewer, and the invariant is the stronger reason.*
- **A call has no purpose, so the same invariant's other half is missing.**
  `ModelCall` records the role and not what the call was *for*, and
  effect-producing is a property of the step rather than of the role. *One field,
  same argument.*
- **A cancelled turn records no model call.** `performCall` attaches a
  `ModelCall` only when the call returns; `Cancelled` carries none. The suite's
  one `todo` names it. P3 renders turns, and a cancelled one has a hole in it
  exactly where the question *what did I stop* is asked. *Named in
  [15 §1.3](15-p2c-first-real-run.md) as pre-work for P2C, so it should be closed
  before this phase rather than by it.*
- **`resolved.modelId` echoes the request, and `finishReason` is not recorded.**
  Both are [P2C §1.2](15-p2c-first-real-run.md) items. They matter here because
  §3's gate step 1 turns on the resolved model being *true* rather than
  self-reported, and because *why did it stop there* — ceiling, filter, stall —
  is a workbench question that the record currently cannot answer.

**And one thing the record has that no surface shows, which is a P3 feature
rather than a gap.** `estimateTokens` is `Math.ceil(text.length / 4)` and decides
what fits; `usage` is what the provider counted afterwards. **The workbench is
the only place a person can see the two disagree**, and per-block estimate beside
per-call reported is a small addition to §2's viewer with an outsized payoff:
[P5](07-p5-implementation.md) budgets lore against that estimator, and P2C's gate
calibrates it once by hand. P3 is where it stops being a one-off measurement.

### 1.6 §1.1 can now be decided, because the surface exists

The skeleton deferred *how much workbench lives in the play surface* to a revisit
*with the P2 play surface actually in hand*. It is in hand: `TurnRecord.tsx` is
45 lines, a `<details>` disclosure under a finished turn that renders the record
as JSON.

**So the answer is: P3 replaces that disclosure rather than adding a second
surface beside it.** The affordance [05 §3](../05-ui-surfaces.md) leans towards —
a context-fill meter on the input bar, clickable through — attaches where the
disclosure is, and the full viewer is the route it opens. That is one surface
with two depths rather than two surfaces, which is what the section was worried
about.

*Two things to inherit rather than rediscover:* the disclosure is currently
unreadable — dark-on-dark, measured at 1.01 to 1 — and [P2C §1.1](15-p2c-first-real-run.md)
repaints it; and the live progress view and the record viewer are the same
component fed from two sources, which
[04 §3.3](../04-server-multiuser-deployment.md) requires and `StepOutcome` was
added to P2's record to make true.

---

## 2. Stages

### P3.0 — The record viewer

The read-only core: block list in order with source (clickable, per
[13 §1.1](../13-internal-contracts.md)'s identifiers), plain-language reason,
tokens, included/dropped with the responsible rule; the budget verdict with
`nextToDrop` ("what falls out next" answered *before* it happens); the calls
with resolved model, params, rendered messages mapped back through
`fromBlocks`; effects including rejected ones with reasons; and **spend
itemised per call in tokens and wall time** — not money, for §1.5's reason, and
tokens are the unit a person can act on anyway. Renders for any turn, current or historical — same component the live
progress view feeds, since the live view is the record being built
([04 §3.3](../04-server-multiuser-deployment.md)).

### P3.1 — Edit a block and re-run

§1.2. The block editor, the rewrite-default re-run, and the reroll as the
explicit second action where draws exist ([07 §14.6](../07-tech-stack.md) — no
draws, no second affordance).

### P3.2 — Diff

§1.3. Two turns side by side; the block-table diff as the primary view.

### P3.3 — Dry run, and the play-surface affordance

§1.4's assemble-without-sending, plus §1.1's context-fill meter linking into
the full viewer.

*Ends at:* the demo — a real question answered through the surface.

---

## 3. Verification — the P3 exit gate

Sketch; expand on revisit.

1. Open any historical turn → every block's source is clickable through to the
   object it came from; no "unknown" sources on an ordinary turn; and the
   resolved model is the one that **answered** rather than the one that was
   asked for ([P2C §1.2](15-p2c-first-real-run.md) is what makes that true).
2. Ask "what is about to fall out of context" → answered from the verdict
   without generating anything.
3. Edit a block, re-run → a new turn exists with the edit recorded, the
   original untouched, and identical draws (rewrite). Reroll differs only in
   fresh draws, and the record marks which. **This is the first replay of an RNG
   tape in the project's history**; a tape that turns out not to reproduce is a
   P2 defect this step exists to find.
4. Break a preset deliberately (drop a block's priority) → the diff view shows
   exactly what changed between the before/after turns.
5. Dry-run a turn → inspect → send: one record, marked accordingly; abandon:
   nothing sent, nothing charged.
6. A rejected effect ("the model tried to give itself 40 gold" —
   [13 §1.2.2](../13-internal-contracts.md)) is visible with its reason.

**And the standing line from [01 §2.3](01-work-plan.md): no phase exits
with configuration that has no surface.** If this phase built something that
needs a value set, name where someone sets it before calling the phase done.

---

## 4. Out of scope, deliberately

Aggregate spend tracking (post-1.0, [05 §3](../05-ui-surfaces.md) — per-turn cost
display only); the keyword-test panel's lore half (P5, §1.4); sibling
navigation and the branch-aware history view (P6); the workbench over
renditions (P9); any assembly logic in the client. And **no editing of the
record itself** — the record is what happened; edit-and-re-run makes a new one.

**Editor completeness is not here either**, and this line exists because
[04 §2.11](04-p2-implementation.md) once deferred it to "P3/P11" while this doc
said nothing about it. It is not P3: section add/remove,
`visual`/`roles`/`openings`/`lore`/`modelHint` and the undo affordance are
**P11**'s, where editors-are-not-dumb-forms lives ([01 P11](01-work-plan.md)),
with the by-field and *As stored* halves claimed as polish at
[09 §1–§2](09-polish.md). P3 edits *blocks*, which is a different surface with a
different reason to exist.
