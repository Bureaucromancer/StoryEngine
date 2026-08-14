# 23 — P5 implementation plan

**Status: skeleton.** Drafted during P1; to be revisited before the phase
starts — and this one *must* be revisited after PLAYABLE, because retrieval and
budgeting against the real imported library is exactly what that checkpoint
tests, and its findings belong in this plan before the phase begins. Format
follows [19](19-p1-implementation.md).

**P5 delivers**, from [15 P5](15-work-plan.md): full lorebook activation
semantics, book scoping, the two-tier budget, the deterministic trim order, and
skip reporting — testable against P4's real library rather than fixtures.

**The demo that defines done:** *the workbench showing exactly which entries
fired, why, what they cost, and what the budget dropped.* P5 has no surface of
its own — its output is blocks with reasons, and P3 already built the viewer.
That is the design working as intended: retrieval is a producer feeding an
existing pipeline, not a subsystem with its own UI.

**The posture, settled in [02 §3](02-data-model.md):** this is a PORT, not a
design. Entry activation is the one part of the ecosystem that has genuinely
converged, and the vocabulary is taken essentially as-is — matching, always-on,
timing, recursion, placement, grouping, gating, outlets. The design work was
done in 02/13; P5 is implementation plus the two divergences (state out of
entries, scoping collapsed).

**CI this phase establishes:** unit tests over the pure activation logic
([16 §3.2](16-testing.md)) — matching, timing interactions, recursion flags,
trim order — plus golden-file coverage of budget behaviour under pressure
against the imported library (the `context-fit` regression pattern,
[16 §3.1](16-testing.md)).

---

## 1. Decisions this plan has to make

### 1.1 Where timing state lives — the one real design question in the phase

`sticky`, `cooldown`, `delay` and `ephemeral` need per-session counters
(Marinara's `LorebookEntryTimingState`). Those counters change as a result of
turns — which is the definition of a channel
([03 §4](03-modes-and-turn-pipeline.md)) — and if they live anywhere else they
do not reconstruct at a node, and a branch inherits the wrong stickiness. The
same argument that moved party membership into channels
([03 §8](03-modes-and-turn-pipeline.md)) applies unchanged.

**Lean: an engine-owned channel** (`se.lore.timing` or similar,
`scope: "entry"`), updated by the retrieval step through ordinary
`ChannelEffect`s. That makes timing visible in the turn record and correct
under P6's branching for free. The cost — every turn with sticky entries writes
effects — is bounded and legible. Confirm on revisit, with P6's reconstruction
machinery in view.

### 1.2 Stochastic activation draws through the tape

Per-entry `probability` goes through the RNG service and is recorded keyed by
site ([07 §14.6](07-tech-stack.md) names stochastic lore activation
explicitly). A rewrite replays the same activations — *same setup, same result,
different words* — and the workbench shows `lore:<entry> chance 30% → fired`
rather than an anonymous draw.

### 1.3 What the retrieval step is, structurally

An ordinary step at the collect stage contributing blocks
([03 §5](03-modes-and-turn-pipeline.md) step 1), with
`LorebookActivationSource` feeding block reasons
([02 §3.1](02-data-model.md)). Recursion runs inside the step (activated text
re-scanned up to book limits); the two-tier budget is **not** inside it —
per-book `tokenBudget`/`entryLimit` verdicts feed the one arbiter, and the
chat-wide cut is the budgeter's ([02 §3.2](02-data-model.md)), so every skip
lands in the `BudgetVerdict` with the rule that made it.

**Replaceability seam, not machinery:** the built-in retriever is the default
an extension may substitute; `extensionActivations` on the entry
([02 §3.1](02-data-model.md)) is stored (P4 already preserves it) but nothing
consumes it until P7's extension host exists.

### 1.4 Channel predicates for `activationConditions` — how much at P5

02 §3.3 unifies `activationConditions` and `schedule` into typed predicates
over declared channels. At P5 nearly no channels exist (P7's problem), so the
lean is: implement the predicate check against whatever channels the session
has, and an entry conditioned on an undeclared channel is a **visible warning
and never fires** — the dangling posture, already specified. The predicate
*vocabulary* stays the minimal comparison set; anything richer waits for the
2.0 rule vocabulary and must not leak in here early
([03 §6](03-modes-and-turn-pipeline.md)'s warning about `StepCondition`
applies).

### 1.5 Scan sources and mention resolution

`additionalMatchingSources` (scan the persona, actor descriptions, etc.) ships
with the vocabulary. The *shared keyword pass* with mention resolution
([03 §8.2](03-modes-and-turn-pipeline.md)) is a P7 concern — but the scanner
should be built as the reusable pass now (one scan, N consumers) so P7 attaches
rather than rewrites. Cheap to shape correctly, expensive to unshare later.

---

## 2. Stages

### P5.0 — The matching engine, pure

Keys, secondary keys with selective logic, whole-word/case/regex with the
documented regex timeout ([08 §5.1](08-triage.md)), scan depth, scan sources.
Pure functions, exhaustively unit-tested — the cheapest place in the phase to
be thorough, same argument as P1.1.

### P5.1 — Timing and recursion

The four timing behaviours over §1.1's state home; the three recursion flags
and book-level recursion limits. Unit tests on the interactions, which are the
part people actually get wrong.

### P5.2 — The retrieval step and the budget

§1.3 wired into the assembler: activation → candidate blocks with reasons →
per-book verdicts → the arbiter, with the documented trim order (constants,
latest-message matches, injection order; scan continues past a skipped entry)
and skip reasons surfaced. Grouping (`group`/`groupWeight`), gating filters,
placement including outlets — an outlet is an activated block a preset slot
positions, which is block addressing arriving from the other direction
([02 §3.1](02-data-model.md)).

### P5.3 — Scoping, folders, and the editor's minimum

The `LoreScope` union enforced by shape ([02 §3.4](02-data-model.md)); lorebook
folders; whatever minimal lorebook editing the phase needs to be exercised —
**to scope on revisit** against [05 §11](05-ui-surfaces.md), since the full
editors-are-not-dumb-forms treatment is P11's and the P1.7 precedent (real
write path, no assist) is the model.

### P5.4 — The keyword test, generalised

The workbench feature deferred from P3 ([05 §3](05-ui-surfaces.md)): paste
sample text, see what would fire, against a real session's channel state,
covering every activation source. Doubles as the authoring loop for imported
books — which, per PLAYABLE, is where "my lorebook never fires" gets diagnosed.

*Ends at:* the demo — fired/why/cost/dropped, in the workbench, against the
imported library.

---

## 3. Verification — the P5 exit gate

Sketch; expand on revisit.

1. An imported ST lorebook fires on its keywords in a real session — entries
   appear as blocks with "keyword match: '…'" reasons.
2. A sticky entry persists N messages and the workbench shows "sticky, 2
   remaining"; cooldown, delay and ephemeral each observable in the record.
3. Recursion: an activated entry's text activates another; `preventRecursion`
   et al. honoured; no runaway at the book's depth limit.
4. Budget pressure: a book over its `tokenBudget` drops entries in the
   documented order, each skip named with the blocking budget; a small entry
   still fits after a large one dropped.
5. A rewrite (P3's edit-and-re-run) reproduces identical activations,
   including stochastic ones (§1.2).
6. An entry conditioned on a channel that does not exist → visible warning,
   never fires, nothing blocks (§1.4).
7. The keyword tester answers "why does this entry never fire" without playing
   a turn.
8. Timing counters reconstruct correctly at an old node (with P6 landed, this
   becomes the branch test; before P6, replay-from-zero covers it).

---

## 4. Out of scope, deliberately

Semantic/embedding retrieval ([05 §14.3](05-ui-surfaces.md) — keyword is the
1.0 position; embeddings moved to the derived index and nothing populates
them); entry state values beyond timing — quests, dispositions, relationship
levels live in channels that arrive with modes (P7) and 2.0; the rule
vocabulary (§1.4's line); the full lorebook editor with galleries and assist
(P11; media schema shipped in P1.1 and stays schema-only); cross-session memory
as an auto-maintained lorebook (P8 — it *consumes* this phase's machinery,
which is the dependency, not a reason to build any of it now).
