# 05 — P3 implementation plan

**Status: skeleton.** Drafted during P1; to be revisited before the phase
starts, chiefly against what the P2 turn record actually looks like on screen.
Format follows [03](03-p1-implementation.md).

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
session, not a drawer on every message. Decide on revisit, with the P2 play
surface actually in hand.

### 1.2 Edit-and-re-run defaults to rewrite

Re-running with an edited block follows the rewrite/reroll distinction and
defaults to **rewrite** ([05 §3](../05-ui-surfaces.md),
[07 §14.5](../07-tech-stack.md)) — editing a block is changing the input, not
asking for different luck. This consumes the RNG tape P2.1 recorded and is the
first user of replay mode; if the tape turns out incomplete here, that is a P2
bug found early, which is part of why P3 is early.

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

---

## 2. Stages

### P3.0 — The record viewer

The read-only core: block list in order with source (clickable, per
[13 §1.1](../13-internal-contracts.md)'s identifiers), plain-language reason,
tokens, included/dropped with the responsible rule; the budget verdict with
`nextToDrop` ("what falls out next" answered *before* it happens); the calls
with resolved model, params, rendered messages mapped back through
`fromBlocks`; effects including rejected ones with reasons; cost itemised per
call. Renders for any turn, current or historical — same component the live
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
   object it came from; no "unknown" sources on an ordinary turn.
2. Ask "what is about to fall out of context" → answered from the verdict
   without generating anything.
3. Edit a block, re-run → a new turn exists with the edit recorded, the
   original untouched, and identical draws (rewrite). Reroll differs only in
   fresh draws, and the record marks which.
4. Break a preset deliberately (drop a block's priority) → the diff view shows
   exactly what changed between the before/after turns.
5. Dry-run a turn → inspect → send: one record, marked accordingly; abandon:
   nothing sent, nothing charged.
6. A rejected effect ("the model tried to give itself 40 gold" —
   [13 §1.2.2](../13-internal-contracts.md)) is visible with its reason.

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
