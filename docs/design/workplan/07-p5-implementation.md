# 07 — P5 implementation plan

**Status: skeleton, restructured into two halves 2026-08-28.** Drafted during P1;
to be revisited before the phase starts — and this one *must* be revisited after
PLAYABLE, because retrieval and budgeting against the real imported library is
exactly what that checkpoint tests, and its findings belong in this plan before
the phase begins. The split into a document half and a retriever half is §1.6 and
is the only structural change; every decision in §1.1–§1.5 stands as written.
Format follows [03](03-p1-implementation.md).

**P5 delivers two things that share a subject and share almost nothing else.**

- **The document half** — the lorebook as something to read, browse, search and
  edit: the Lorebooks panel, the book's own page, folder gates rendered with
  their reasons, within-book and cross-library search, and the entry editor's
  minimum. Needs no model, no assembler and no schema change; verifiable entirely
  offline. Specified at [05 §5.3](../05-ui-surfaces.md),
  [05 §11.2d](../05-ui-surfaces.md) and [05 §14.5](../05-ui-surfaces.md), with the
  position at [16](../16-lorebooks-as-a-format.md).
- **The retriever half**, from [01 P5](01-work-plan.md): full lorebook activation
  semantics, book scoping, the two-tier budget, the deterministic trim order, and
  skip reporting — testable against P4's real library rather than fixtures.

**The demo that defines done, for the retriever half:** *the workbench showing
exactly which entries fired, why, what they cost, and what the budget dropped.*

*Audit correction.* This paragraph continued: *"P5 has no surface of its own —
its output is blocks with reasons, and P3 already built the viewer. That is the
design working as intended: retrieval is a producer feeding an existing pipeline,
not a subsystem with its own UI."* Splitting the phase falsifies that sentence as
written, and it is corrected rather than deleted because its argument is still
right about the half it was written about. **The retriever half has no surface of
its own, and that remains the design working as intended.** The document half is
not a surface *for retrieval* — it renders what is on disk and predicts nothing
([05 §5.3](../05-ui-surfaces.md)'s closing fence) — so the original claim survives
with its scope named. Keeping the two halves' surfaces distinct is the standing
consequence, and §1.6 is where it is argued.

**The posture, settled in [02 §3](../02-data-model.md):** this is a PORT, not a
design. Entry activation is the one part of the ecosystem that has genuinely
converged, and the vocabulary is taken essentially as-is — matching, always-on,
timing, recursion, placement, grouping, gating, outlets. The design work was
done in 02/13; the retriever half is implementation plus the two divergences
(state out of entries, scoping collapsed). **The document half has the same
posture for the same reason**: it adds no field, and every affordance is a
rendering of something the schema already carries
([16 §4](../16-lorebooks-as-a-format.md)).

**CI this phase establishes:** unit tests over the pure activation logic
([10 §3.2](10-testing.md)) — matching, timing interactions, recursion flags,
trim order — plus golden-file coverage of budget behaviour under pressure
against the imported library (the `context-fit` regression pattern,
[10 §3.1](10-testing.md)). The document half's own contribution is smaller and
different in kind: the index gains a second table pair, so the rebuild property
test ([10 §3.1](10-testing.md)) has to cover it, and that is the check that keeps
§1.7's stale-row hazard from shipping.

---

## 1. Decisions this plan has to make

### 1.1 Where timing state lives — the one real design question in the phase

`sticky`, `cooldown`, `delay` and `ephemeral` need per-session counters
(Marinara's `LorebookEntryTimingState`). Those counters change as a result of
turns — which is the definition of a channel
([03 §4](../03-modes-and-turn-pipeline.md)) — and if they live anywhere else they
do not reconstruct at a node, and a branch inherits the wrong stickiness. The
same argument that moved party membership into channels
([03 §8](../03-modes-and-turn-pipeline.md)) applies unchanged.

**Lean: an engine-owned channel** (`se.lore.timing` or similar,
`scope: "entry"`), updated by the retrieval step through ordinary
`ChannelEffect`s. That makes timing visible in the turn record and correct
under P6's branching for free. The cost — every turn with sticky entries writes
effects — is bounded and legible. Confirm on revisit, with P6's reconstruction
machinery in view.

### 1.2 Stochastic activation draws through the tape

Per-entry `probability` goes through the RNG service and is recorded keyed by
site ([07 §14.6](../07-tech-stack.md) names stochastic lore activation
explicitly). A rewrite replays the same activations — *same setup, same result,
different words* — and the workbench shows `lore:<entry> chance 30% → fired`
rather than an anonymous draw.

### 1.3 What the retrieval step is, structurally

An ordinary step at the collect stage contributing blocks
([03 §5](../03-modes-and-turn-pipeline.md) step 1), with
`LorebookActivationSource` feeding block reasons
([02 §3.1](../02-data-model.md)). Recursion runs inside the step (activated text
re-scanned up to book limits); the two-tier budget is **not** inside it —
per-book `tokenBudget`/`entryLimit` verdicts feed the one arbiter, and the
chat-wide cut is the budgeter's ([02 §3.2](../02-data-model.md)), so every skip
lands in the `BudgetVerdict` with the rule that made it.

**Replaceability seam, not machinery:** the built-in retriever is the default
an extension may substitute; `extensionActivations` on the entry
([02 §3.1](../02-data-model.md)) is stored (P4 already preserves it) but nothing
consumes it until P7's extension host exists.

### 1.4 Channel predicates for `activationConditions` — how much at P5

02 §3.3 unifies `activationConditions` and `schedule` into typed predicates
over declared channels. At P5 nearly no channels exist (P7's problem), so the
lean is: implement the predicate check against whatever channels the session
has, and an entry conditioned on an undeclared channel is a **visible warning
and never fires** — the dangling posture, already specified. The predicate
*vocabulary* stays the minimal comparison set; anything richer waits for the
5.0 rule vocabulary and must not leak in here early
([03 §6](../03-modes-and-turn-pipeline.md)'s warning about `StepCondition`
applies).

### 1.5 Scan sources and mention resolution

`additionalMatchingSources` (scan the persona, actor descriptions, etc.) ships
with the vocabulary. The *shared keyword pass* with mention resolution
([03 §8.2](../03-modes-and-turn-pipeline.md)) is a P7 concern — but the scanner
should be built as the reusable pass now (one scan, N consumers) so P7 attaches
rather than rewrites. Cheap to shape correctly, expensive to unshare later.

### 1.6 The phase splits, and the document half goes first

**Added 2026-08-28.** **Two halves, in that order, and the reason is not
scheduling convenience — it is that half of *why doesn't this entry fire* is a
reading problem before it is a matching problem.**

The retriever half's gate already asks the question, at §3's step 13: *the keyword
tester answers "why does this entry never fire" without playing a turn.* Against
a real imported library the commonest true answers are **the book is disabled**,
**the entry's folder gate is off**, and **the entry is not where you think it
is** — none of which is a matching fact, and all three of which are invisible at
every surface that exists today ([16 §4](../16-lorebooks-as-a-format.md)'s
count). Building the tester first means building a matcher to answer questions
that were never about matching.

**Why the document half sits here rather than in a phase of its own.** It needs a
corpus. A three-hundred-entry reading view designed against a three-entry fixture
is designed without the load it exists for, and every falsification test the
position offers ([16 §6](../16-lorebooks-as-a-format.md)) runs against imported
books rather than seeds. P5 already follows P4, so this placement buys the
dependency for nothing — where a lettered phase would have been the same
sequence with more numbering.

*The objection, and why it loses.* This delays activation, which is the feature,
and a reader over books that nothing retrieves from is a document viewer for
documents nothing uses. That is real, and it is answered by the size: the
document half needs no model, no assembler and no schema change, so it does not
compete with the retriever half for the hard thinking — only for calendar. If the
calendar is what binds, the halves are separable in either order and **reversing
them changes nothing else in this plan**, because the document half consumes
nothing the retriever half produces. Recorded so that the reversal is a decision
rather than a discovery.

*The cost, stated.* Two halves in one phase is two exit gates (§3), and a phase
with two gates is one somebody will try to exit halfway. The gate says which
items belong to which half for exactly that reason.

**The line that keeps the halves from merging**, and it is the correction in the
header restated as a rule:

> The document half renders **configuration**. Only the retriever half renders
> **behaviour**. Nothing in the panel, the book page or the editor may say *will
> fire*.

### 1.7 The dependency on [polish §1](09-polish.md), and the hazard in the index

**Added 2026-08-28.** Two things this plan would otherwise discover late.

**[polish §1](09-polish.md) is shared machinery, and it is upstream of both the
read view and the editor.** The by-field view derived from the schema is what the
book page's *as configured* fold and the editor's disclosures
([05 §11.2d](../05-ui-surfaces.md)) both render through. If it has not landed,
the document half either builds it or duplicates it — and this repo has already
been burned in exactly this way: [P3 §5](05-p3-implementation.md) records the
audit finding that two JSON viewers already ship and already disagree. **So:
land polish §1 first, or make it the document half's first stage.** Named here
because it is invisible from either item on its own.

**The index hazard is not the SQL.** Per-entry rows (§P5.2) mean a second table
pair alongside `object_fts`, and `object_fts` is deleted by path in **five**
separate places in the ingest path. Every one needs a sibling, and missing one
leaves stale entry rows in a store whose entire claim is that it is derived and
trustworthy — a failure that is silent, survives a restart, and is precisely what
[13 §5](../13-internal-contracts.md)'s index invariants exist to forbid.
**Mitigation, and it is worth doing regardless of this phase: extract one helper
that owns dropping and reinserting an object across both table pairs, so five
delete sites become one.** The rebuild property test is what proves it.

---

## 2. Stages

### The document half

#### P5.0 — The Lorebooks panel, and the book as a document

[05 §5.3](../05-ui-surfaces.md) built on the existing detail route: the panel's
columns, badges, filters and sorts; the book page with its header, folder tree,
entry list as readable units, and the *as configured* fold; the entry address as
a validated search param; within-book filter and search, including the key chips
that make an index out of `keys`. Folder gates rendered **with their three
distinct reasons for an entry being off** — the item most likely to be
half-built, and the one §1.6 turns on.

No server work, no schema change. Reuses `/library/$kind/$id` and its existing
shadowed-copy discriminator; a panel that builds its own links from `{kind, id}`
reintroduces F19 and [polish §4](09-polish.md) says so.

*Ends at:* opening a three-hundred-entry imported book and finding one entry by
reading rather than by scrolling — and an entry that is off saying *which* of the
three reasons made it so.

#### P5.1 — The entry editor's minimum

[05 §11.2d](../05-ui-surfaces.md)'s disclosures, derived from the schema's own
comment banners, with Matching and Firing open. Create, rename, delete an entry;
edit the durable core and the folder gates; everything else visible and
read-only. **To scope on revisit** against [05 §11](../05-ui-surfaces.md) — the
full editors-are-not-dumb-forms treatment is P11's, and the P1.7 precedent (real
write path, no assist) is the model. This absorbs the editor clause of what was
previously P5.3.

The closed-section invariant is the part not to cut: a collapsed group **names
what inside it is not at its default**, or it is a hidden field.

*Ends at:* an imported entry edited and saved through the real write path,
through the same concurrency and history machinery every other object uses.

#### P5.2 — Per-entry index rows, and the search they exist for

[05 §14.5](../05-ui-surfaces.md): a locator table and an FTS table for lore
entries, mirroring the existing turn pair; an ingest branch that writes one row
per entry; the rebuild path clearing both; a query returning **snippets**, which
is what makes a hit worth returning; and one additive array on the search
response. The only server work in the half, and the only place a schema id
appears in the ingest path — justified by the rule at
[05 §14.5](../05-ui-surfaces.md), *a fragment is indexable when it has an
address*, and bounded by it.

§1.7's five delete sites are the risk. The helper is the mitigation and the
rebuild property test is the proof.

*Ends at:* searching for a phrase that occurs in one entry of one book, and
landing on **that entry**, with the matched text shown.

#### P5.3 — Mentions

The derived *Mentions* and *Mentioned by* sections
([05 §5.3](../05-ui-surfaces.md)), each row naming what matched. Computed at
render, memoised per book, never indexed. Deliberately last in the half: it is
the most interesting item and the most cuttable, and it is also the one whose
premise [16 §6](../16-lorebooks-as-a-format.md) offers to falsify — so building
it late means building it after the corpus can answer whether it was worth
building.

**Inline highlighting is not in this stage and is not refused** — it belongs to
the retriever half's tester, where it stops being a guess about linking and
becomes *this is what the scanner sees*.

*Ends at:* the count from [16 §6](../16-lorebooks-as-a-format.md) run over the
imported corpus, and recorded — whichever way it comes out.

### The retriever half

#### P5.4 — The matching engine, pure

Keys, secondary keys with selective logic, whole-word/case/regex with the
documented regex timeout ([triage §5.1](02-triage.md)), scan depth, scan sources.
Pure functions, exhaustively unit-tested — the cheapest place in the phase to
be thorough, same argument as P1.1.

#### P5.5 — Timing and recursion

The four timing behaviours over §1.1's state home; the three recursion flags
and book-level recursion limits. Unit tests on the interactions, which are the
part people actually get wrong.

#### P5.6 — The retrieval step and the budget

§1.3 wired into the assembler: activation → candidate blocks with reasons →
per-book verdicts → the arbiter, with the documented trim order (constants,
latest-message matches, injection order; scan continues past a skipped entry)
and skip reasons surfaced. Grouping (`group`/`groupWeight`), gating filters,
placement including outlets — an outlet is an activated block a preset slot
positions, which is block addressing arriving from the other direction
([02 §3.1](../02-data-model.md)).

#### P5.7 — Scoping, and the folder gate enforced

The `LoreScope` union enforced by shape ([02 §3.4](../02-data-model.md)); the
folder gate honoured in activation, so that the reason P5.0 *renders* is the
reason the engine *acts on*. That correspondence is the whole value of having
built the rendering first, and it is worth a test that fails if the two diverge.

#### P5.8 — The keyword test, generalised

The workbench feature deferred from P3 ([05 §3](../05-ui-surfaces.md)): paste
sample text, see what would fire, against a real session's channel state,
covering every activation source. Doubles as the authoring loop for imported
books — which, per PLAYABLE, is where "my lorebook never fires" gets diagnosed.
**And this is where inline highlighting of entry content becomes honest**, since
an entry's content is sample text and the matcher is now real. Off by default.

*Ends at:* the demo — fired/why/cost/dropped, in the workbench, against the
imported library.

#### P5.9 — Writing samples, the other two carriers

[18 §7](../18-writing-samples.md) shipped the `samples` slot with only its
**actor** arm live. The treatment and lore arms return nothing and report
`no-producer`, because a session references neither object — the same posture
`se.lore` held through P2 to P4, and it resolves here for the same reason: this
phase is where a session first reaches a Treatment and its linked books.

Three things, none of them large once the retriever exists:

- `gatherAssemblyInputs` carries the session's Treatment and its linked
  Lorebooks, so `previewAssembly` and the runner cannot disagree about them —
  the drift that module's docstring exists to prevent.
- The `samples` arm fills from both, in the declared order **treatment → lore →
  actor**, each sample its own candidate with its own priority.
- The empty reason stops discriminating on the carrier once every carrier has a
  producer: `no-producer` becomes `empty-source` throughout, and the test that
  currently pins the split is the one that has to change deliberately.

**Book-scoped, so it does not touch activation.** A sample is not an entry and
never matches a keyword; it rides with the book the way `media` does. That is
what keeps this a stage of P5 rather than a feature of the retriever.

*Ends at:* a treatment's sample and a character's sample in one prompt, each
addressable in the block table, each with its own cost and its own drop rule.

---

## 3. Verification — the P5 exit gate

Sketch; expand on revisit. Split by half, per §1.6's cost — a phase with two
gates is one somebody will try to exit halfway, so it says which is which.

### The document half

1. A three-hundred-entry imported book opens as something readable, and a named
   entry is reachable by its own address — the link survives a reload and lands
   on that entry.
2. An entry that will not fire says **why**, distinguishing *off*, *its folder is
   off*, and *the book is off* — and the folder case leaves the entry's own
   `enabled` visibly unchanged.
3. Filtering within a book by a key chip, a tag and a folder each narrows the
   list, and the panel's own filters narrow the shelf.
4. A search phrase occurring in exactly one entry returns **that entry** with a
   snippet, across books, and the rebuild property test still passes with the new
   tables in place.
5. An entry is created, edited and deleted through the real write path, and a
   collapsed section in the editor names its non-default values.
6. **Only a person can walk:** open a book you did not author and judge whether
   the page reads as a document or as a form. This is the claim the phase is
   making and no assertion covers it.

### The retriever half

7. An imported ST lorebook fires on its keywords in a real session — entries
   appear as blocks with "keyword match: '…'" reasons.
8. A sticky entry persists N messages and the workbench shows "sticky, 2
   remaining"; cooldown, delay and ephemeral each observable in the record.
9. Recursion: an activated entry's text activates another; `preventRecursion`
   et al. honoured; no runaway at the book's depth limit.
10. Budget pressure: a book over its `tokenBudget` drops entries in the
    documented order, each skip named with the blocking budget; a small entry
    still fits after a large one dropped.
11. A rewrite (P3's edit-and-re-run) reproduces identical activations,
    including stochastic ones (§1.2).
12. An entry conditioned on a channel that does not exist → visible warning,
    never fires, nothing blocks (§1.4).
13. The keyword tester answers "why does this entry never fire" without playing
    a turn — **and where the answer is a gate or a disabled book rather than a
    match, it agrees with what the document half already showed.** Disagreement
    here is the failure §1.6 predicts and P5.7 is meant to prevent.
14. Timing counters reconstruct correctly at an old node (with P6 landed, this
    becomes the branch test; before P6, replay-from-zero covers it).

**And the standing line from [01 §2.3](01-work-plan.md): no phase exits
with configuration that has no surface.** If this phase built something that
needs a value set, name where someone sets it before calling the phase done.
**The document half is the first phase to discharge that line in the other
direction** — it builds surfaces for configuration that has shipped without one
since P1, which is the same rule read from the other end.

---

## 4. Out of scope, deliberately

Semantic/embedding retrieval ([05 §14.3](../05-ui-surfaces.md) — keyword is the
1.0 position; embeddings moved to the derived index and nothing populates
them); entry state values beyond timing — quests, dispositions, relationship
levels live in channels that arrive with modes (P7) and 5.0; the rule
vocabulary (§1.4's line); the full lorebook editor with galleries, assist and
entry-level import and export ([05 §11.2c](../05-ui-surfaces.md)) (P11; media
schema shipped in P1.1 and stays schema-only); cross-session memory
as an auto-maintained lorebook (P8 — it *consumes* this phase's machinery,
which is the dependency, not a reason to build any of it now).

**And what the document half newly invites, refused by name:**

- **A schema field.** Eleven ship unread ([16 §4](../16-lorebooks-as-a-format.md));
  adding a twelfth to serve a rendering would be buying machinery to avoid
  building a surface. The two most tempting — a saved variant/toggle set, and a
  `compatibleWith` list — are refused with reasons at
  [16 §4.2](../16-lorebooks-as-a-format.md).
- **A cross-kind search box.** [05 §5](../05-ui-surfaces.md) names *a search box
  per kind* as the failure; the input this half builds is scoped to the panel and
  is the component the eventual one surface uses.
- **Inline cross-links drawn into entry prose.** Refused with its reasons at
  [05 §5.3](../05-ui-surfaces.md), and rescheduled to P5.8 where it can tell the
  truth.
- **A cached or derived rendering of a book.** The read view renders
  `lorebook.json` and nothing else. A second representation is a second thing to
  invalidate, which is [00 §2.8](../00-stance.md).
- **List virtualisation.** There is none in the client and a clamped list of a
  few hundred entries does not need one. If real imported books run to thousands
  of entries, revisit with a measurement rather than with a dependency.
- **Elevating lorebooks above the library.** No third surface, no mode, no
  promotion in the navigation — [16 §5](../16-lorebooks-as-a-format.md).
