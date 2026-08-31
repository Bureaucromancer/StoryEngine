# 07 — P5 implementation plan

**Status: plan, audited 2026-08-30 at `09ea758` and re-audited 2026-08-31 after
P4's own audit closed — see §0.1, which is the current one.** ~~Skeleton,
restructured into two halves 2026-08-28.~~

**And it is deliberately half a revisit, which is the first thing to know about
it.** This document has always said it *must* be revisited after PLAYABLE,
because retrieval and budgeting against a real imported library is exactly what
that checkpoint tests. **PLAYABLE has not run.** So what follows is the half that
does not depend on it — a readiness audit against the code as built (§0), the
deferrals P4 sent here, and the decisions the audit forces — and every decision
that genuinely needs PLAYABLE's findings is marked **[AWAITS PLAYABLE]** and left
open rather than guessed at. There are four. Closing them early would be
inventing evidence, and the whole reason P5 sits behind that checkpoint is that
the evidence is obtainable.

*And it is about to be obtained.* UI work and manual testing come before this
phase — the run-up to exactly the checkpoint those four questions wait on. §0.3
is written for that window: four things to notice while doing something else,
each of which closes one of them. A plan that holds questions open and then lets
the answering session pass unremarked has held them open for nothing.

The split into a document half and a retriever half is §1.6; §1.1–§1.5 stand as
written, with §0 saying which of their leans the ground has since confirmed.
Format follows [03](03-p1-implementation.md); the readiness audit, honest-size
and still-to-settle sections follow [06](06-p4-implementation.md)'s, which is the
document this one was expanded alongside.

**Citation convention**, adopted from [P4](06-p4-implementation.md) because two
documents are "10": `10 §N` means [10-schemas](../10-schemas.md); **`testing §N`**
means [10-testing](10-testing.md); **`survey §N`** means
[01-source-survey](../01-source-survey.md); **`polish §N`** means
[09-polish](09-polish.md).

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

## 0. Readiness — audited 2026-08-30, at `09ea758`

*Superseded in part by §0.1, which re-checked every item below on 2026-08-31 and
corrects one. Read both: this section carries the reasoning, that one carries
what is currently true.*

The skeleton predates P3.6 and the whole of P4. The ground is more ready than it
knew in five places, less ready in five, and moved outright in four.

**More ready than the skeleton knew:**

- **Channels are real, so §1.1's lean is buildable rather than speculative.**
  `sessions/channels.ts` ships `ChannelState`, `ChannelEffect` and a worked
  example — `readClock` — of an engine-owned channel updated through ordinary
  effects. §1.1 said *confirm on revisit, with P6's reconstruction machinery in
  view*; the machinery is not there yet, but the channel half is, and the lean
  can be implemented without waiting for it.
- **The RNG service exists** (`rng/`, with `rng.ts`, `dice.ts` and `source.ts`),
  so §1.2 is wiring rather than construction.
- **P4 filled the library, and it filled it with the exact objects this phase
  reads.** Imported books arrive with their `entryLimit` clamped, their
  no-equivalent positions collapsed and their chat scoping dropped — each
  already named by a review note. The document half inherits a vocabulary for
  the very questions a reader will ask, rather than having to invent one.
- **Entry ids for imported books are content-derived** (`stableId`, P4.4), not
  minted. So an entry's address survives a re-import, which is what makes
  P5.0's *entry address as a validated search param* and P5.3's Mentions worth
  building — the skeleton could not have assumed either.
- **The `notFilled` reason-class machinery exists and already names this
  phase.** `collect.ts` reports `lore` as `no-producer` today, so *why is there
  no lore in this prompt* is already answerable; P5 changes the answer rather
  than inventing the question.

**Less ready — the gaps this plan turns into scope:**

- **`polish §1` has not landed, and §1.7 said to check.** Verified: the library
  detail page is still a metadata block plus pretty-printed JSON, and the only
  by-field rendering in the repo is inside the actor editor. So §1.7's *land it
  first, or make it the document half's first stage* stops being advice and
  becomes a decision — §1.8 makes it.
- **The regex timeout has not landed**, and this one is sharper than a missing
  dependency. `useRegex` is stored on every entry and **read by nothing**;
  [triage §5.1](02-triage.md) marks Marinara's `regex-timeout.ts` an ADOPT and
  calls it *"the strongest single lift candidate in all three repos"*. P5.4 runs
  author-supplied patterns over turn text, and P4 has just filled the library
  with patterns nobody here wrote. Without the timeout, an imported book is a
  denial-of-service on your own server. §1.9 makes it P5.4's first task rather
  than an assumed input.
- **`gatherAssemblyInputs` carries no Treatment and no Lorebooks.** Verified:
  it gathers channels, cast, persona and actors. The skeleton files this under
  P5.9 as one of three small things for writing samples; it is in fact the
  **precondition for the entire retriever half**, because a retriever with no
  books to scan is a retriever with nothing to do. §1.10 moves it.
- **There is no client lorebook surface of any kind.** `library/` holds the
  list, the detail page, the as-stored fold and the revision list. The document
  half starts from nothing, which is the honest reading of its size.
- **The corpus still does not exist.** [P4 §1.2](06-p4-implementation.md)
  established there is no used SillyTavern or Marinara install on hand, and
  §1.6 now carries the prerequisite that follows: **acquiring one is
  person-blocked work this phase depends on**, not a convenience.

**Ground that moved:**

- **The fixture-pair gate asserts that `lore` reads `no-producer`.** That
  assertion is in a **named CI step** (`pnpm test:fixture-pair`), written at
  P4.0 and green since P4.2 — and P5.6 turning lore into a producer changes what
  it means. It must be edited in the stage that turns lore on, deliberately,
  which §1.10 records so it is not met as a red build.
- **05 §5's review posture was amended at P4.4**: import commits and reports
  loudly rather than staging. That lands on the document half, because the book
  page is now where a person meets consequences a review named and then closed
  — and P4.4 cut the addressable report, so the book itself is the only durable
  place those facts live. §1.8 decides what the page does about it.
- **`samples` has two dead arms and the test that pins them is named.** The
  treatment and lore carriers report `no-producer` in `collect.ts`; P5.9 flips
  them, and `collect.test.ts` is where the split is asserted.
- **Aventuras is a third source of real books.** [P4 §1.5] found that it exports
  lorebooks *as SillyTavern files*, so the corpus the document half needs can
  come from three applications rather than two — which matters for a phase whose
  central claim is about how real authors write.

### 0.1 Re-audit — 2026-08-31, after P4's own audit closed

Run because P4 spent a session auditing itself and closing what it found, and a
readiness section written the day before that is a readiness section written
against a different repository.

**Every gap in §0 was re-checked and every one of them is still open.** That is
the short answer, and it is worth stating plainly because the intervening work
was large:

- `polish §1` has still not landed. *Corrected:* §0 said the detail page is
  "metadata plus pretty-printed JSON"; it is metadata plus the **`AsStored`**
  fold, which is polish **§2** and did land. The by-field view is the missing
  one. P5.−1 stands.
- The regex timeout has still not landed. `useRegex` is written by both
  importers (`sillytavern/lorebook.ts`, `marinara/lorebook.ts`) and read by
  nothing. P5.4's first commit stands, and P4 has since taught the sweep to
  import from archives and loose folders, so the library fills faster than it
  did when this was written.
- `gatherAssemblyInputs` still carries no Treatment and no Lorebooks — session,
  turns, history, window, channels, connections, bindings, mode, preset, cast.
  P5.6 stands as the precondition for the retriever half.
- There is still no client lorebook surface: `library/` holds the list, the
  detail page, the as-stored fold and the revision list.
- The five `object_fts` delete sites are still five (`ingest.ts` 325, 386, 391,
  412, 482). §1.7's one-helper mitigation is unbuilt.
- The fixture-pair gate still asserts `lore` reads `no-producer`
  (`fixture-pair.test.ts:150`). P5.6 changes what that named CI step means.
- **The corpus still does not exist**, and it is still the one item on this list
  a person rather than a session has to clear.

**What did move, and it moved in this phase's favour:**

- **§1.8 lost a third of its scope**, because P4's audit built the addressable
  report and the object-keyed query. See that section — the judgement it makes
  is unchanged and the work under it is smaller.
- **A bounded zip reader exists** (`storage/zip.ts`), and an archive is a
  `FileSource`. Nothing in P5 needs it today; it is here because *a lorebook
  arrives in an archive* is now a solved transport rather than a thing to plan.
- **Gate step 9 ran**, which matters to P5 obliquely: the rebuild-equals-
  incremental property is now exercised against a bulk-imported library, so the
  index invariant P5's Mentions and entry addresses lean on has been stressed by
  the thing that stresses it hardest.

### 0.2 Three unmerged branches, and why this section names them

At the time of writing, three concurrent sessions hold import work that is in
neither `main` nor `p4`. This is normally not a plan's business; it is here
because two of them change what P5 starts from, and a plan that assumed today's
`main` would be wrong within a day.

- **`claude/import-interface-improvements`** — near-miss root detection, import
  moved into the workbench, and the browser directory upload **un-cut**
  ([P4 §7.11–7.13], written against a §7 that does not have §7.14). Its
  `near-miss.ts` was written because P5's neighbour repair had a consequence:
  once the loose walker asks every file what it is, pointing at a SillyTavern
  *install* root converts the shipped sample content and still misses the
  personas. Worth reading before the document half decides what a book page says
  about where a book came from.
- **`claude/library-file-creation`** — object creation in the library, as a
  **P4.5**. It has already amended §2's editor clause in this document: create
  and delete at the *object* level are done, and creating an **entry** is
  writing below the object, which [05 §5] puts on the editor's side of the line.
  So the document half inherits a precedent for the shape rather than inventing
  one.
- **`claude/kind-driscoll`** and two docs branches — small, and not load-bearing
  here.

**The instruction that follows:** re-read §0 and §0.1 against whatever is merged
on the day P5 starts, rather than trusting either. Two of these branches touch
`routes/import.ts`, `detect.ts` and `local-source.ts`, which are three of the
files this plan's §1.8 and §1.10 reason about.

### 0.3 What to notice during the manual testing that comes first

**Written for the run-up rather than the phase**, because the four questions
§1.11 marks [AWAITS PLAYABLE] are about to become answerable and nothing will
capture the answers unless somebody is watching for them.

None of these needs a lorebook to exist. They are all things a person notices
while doing something else, and each one closes a question this plan currently
holds open:

- **When a prompt comes out wrong, is the first question *what got in* or *what
  got cut*?** That is trim-order's real test. If nothing is ever cut in ordinary
  use, the trim order is a decision about a case that does not arise, and the
  per-book budget tier below it is furniture.
- **Does anything get dropped for space at all?** Watch `notFilled` and the
  workbench block list. §1.11 asks whether the per-book tier earns its keep;
  the answer is *no* unless the global cut fires often enough to want steering.
- **When something is missing from a prompt, how long does it take to find out
  why?** If the answer is already fast — because `notFilled` names a reason
  class — then P5.8's highlighting is a nicety, and the keyword tester may be
  answering a question nobody asks. If it is slow, both move up.
- **Does the same wrong thing happen twice?** A diagnostic earns its place by
  the second occurrence, not the first.

Write what happens down somewhere, even roughly. [16](16-p2c-log.md) is the
precedent and the reason it exists: a findings log appended to as things happen
is worth more than a recollection assembled afterwards, and this plan has four
decisions waiting on exactly that.

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

> **The dependency stopped being free on 2026-08-29, and this is the correction
> rather than a note.** [P4 §1.2](06-p4-implementation.md) established that
> **no real corpus exists** — no used SillyTavern or Marinara install is on
> hand — and that P4 therefore runs on fixtures it synthesised. So "P5 already
> follows P4" no longer buys the dependency: P4 produces a library, not a
> *corpus*, and the difference is the whole of what this paragraph was relying
> on. A reading view sized against fixtures we wrote is sized against our own
> assumptions, and [16 §6](../16-lorebooks-as-a-format.md)'s counts run over
> those fixtures would confirm whatever the fixtures were built to contain.
>
> **Acquiring a real library is therefore a prerequisite of this half**, not a
> convenience: person-blocked, with lead time, in the same class as the P2C
> sessions ([P4 §0](06-p4-implementation.md)) — someone has to find a
> SillyTavern or Marinara install with years of books in it and put it
> somewhere the importer can reach. It is named here because this is the
> document whose argument depends on it, and a prerequisite recorded only in
> the phase that cannot supply it is a prerequisite nobody owns.
>
> **What it does not do is block the phase.** The half is written against
> fixtures and the corpus sharpens it; only [16 §6]'s falsification counts
> genuinely require real books, and P5.3's gate is restated below so that a
> task with unknown lead time cannot hold a phase closed. If the corpus is
> still absent when this phase is planned, §1.6's own escape applies: the
> halves are separable, "reversing them changes nothing else in this plan", and
> the reversal becomes the obvious call rather than a discovery.

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

### 1.8 The book page is where an import's consequences go to live

**Added at the 2026-08-30 audit, and it is the one decision P4 created rather
than deferred.**

P4.4 shipped the review as a panel where the sweep was run and **cut the report
at its own address** — named as the phase's genuinely unfinished piece. So the
facts an import establishes about a book — *this entry sat at a position with no
equivalent here*, *the entry limit was reduced from 5000 to 1000*, *this book was
scoped to one chat and is global now* — currently exist in a report that is gone
as soon as the page is closed.

Those are exactly the facts somebody asks about when an entry does not fire, and
this phase's whole premise is that half of *why doesn't this entry fire* is a
reading problem. **Decided: the book page shows them, read from the object rather
than from the import job.** Two consequences:

- The converters must leave enough on the object to reconstruct the note. Most
  already do — a clamped `entryLimit` is visible by comparing it to the source
  value in `compat`, and a collapsed position is not. **The gap is real and it is
  P5's to close**, not P4's to have foreseen: the converters record what they
  did in a *report*, and the object keeps only the outcome.
- The mechanism is `metadata` on the entry, which [P4 §1.11] already routes
  unknown fields into. An import note becomes a metadata key rather than a new
  field, so no schema moves.

~~**Alternative rejected:** finishing P4.4's addressable report instead. It is
the better long-term answer and it belongs to a later phase — but it makes the
fact reachable from the *import*, and the question is asked from the *book*.
Somebody debugging an entry six months after the import will not think to look
for the sweep that created it.~~

***Overtaken 2026-08-31: the alternative was built, and it changes half of this
section.*** [P4 §7.14](06-p4-implementation.md) closed the addressable report —
`import_job` and a new `import_item` are written, `GET /api/import/jobs/:id`
returns the same `ImportReport` the sweep answered with, and **`importNotesFor(db,
objectId)` exists and is tested**, written against this section by name.

What survives, and what does not:

- **The decision stands.** The question is still asked from the book, and the
  reasoning above is untouched by the report existing: somebody debugging an
  entry six months later still will not go looking for the sweep.
- **The first consequence is discharged.** *The converters must leave enough on
  the object to reconstruct the note* was P5 scope because the notes lived only
  in a report that was thrown away. They are now stored, keyed by the object they
  produced, with an index on that column. So the book page **reads them** rather
  than reconstructing them, and the `metadata`-on-the-entry mechanism below is no
  longer needed for this — keep it for what [P4 §1.11] routes there, not for
  import notes.
- **What is left is the surface**, which was always the interesting half: which
  of a book's notes belong on the page, where, and how an entry-level note finds
  its entry. `importNotesFor` answers per *object*; an entry-level fact is inside
  a note's `params`, and matching it back to a row is P5's work.

That is a real reduction in this section's size and it is worth naming as one:
the query, the storage and the index came from somewhere else. What did not
change is the judgement — which is the part a plan is for.

### 1.9 `polish §1` is the document half's first stage, not its dependency

§1.7 said *land it first, or make it the document half's first stage*, and the
audit says it has not landed. **Decided: it is P5.0, and the phase does not open
with a lorebook surface at all.**

The alternative — building the book page's *as configured* fold and the entry
editor's disclosures on their own — is how this repository got two JSON viewers
that disagree ([P3 §5](05-p3-implementation.md) records the finding). A third
would be the same mistake with better documentation. And the by-field view is
useful to every kind, so building it inside a lorebook stage would bury shared
machinery under a specific feature, which is the shape that makes it hard to
reuse later.

*Cost, stated:* the phase's first visible output is not a lorebook. That is worth
saying out loud because it reads like drift and is not.

*Re-audit 2026-08-31:* **check before building it.** UI work is in flight ahead
of this phase, `polish §1` is squarely the kind of thing it would pick up, and a
concurrent branch has already paid half of the polish note's companion clause
(the Edit gate's ownership half). If the by-field view has landed by the time
P5 opens, this stage is *verify and move on*, and the document half starts where
§1.7 originally wanted it to.

### 1.10 The regex timeout is the retriever's first task, and two other things move with it

Three orderings the audit forces, collected because each is invisible from its
own stage.

**The regex timeout comes before the matcher, not with it.** `useRegex` is stored
and read by nothing, P4 has filled the library with patterns nobody here wrote,
and [triage §5.1](02-triage.md)'s ADOPT is about sixty lines. A matcher that runs
an imported pattern without a timeout is a denial-of-service on your own server,
triggered by a book somebody downloaded. It is **P5.4's first commit** and its
own test.

**`gatherAssemblyInputs` grows Treatment and Lorebooks at P5.6, not P5.9.** The
skeleton files this under writing samples; it is the precondition for retrieval
itself, because a retriever with no books to scan has nothing to do. P5.9 then
gets what it needs for free, which is the right way round.

**Turning lore into a producer breaks a named CI step, and that is a feature.**
The fixture-pair gate asserts `lore` reads `no-producer`. When P5.6 lands,
`lore` becomes a producer that may still be empty, and the assertion has to
change — from *no producer exists* to *the producer ran and matched nothing*.
**The edit belongs in P5.6's own commit**, with the same discipline P4.1 applied
to the `LIVE_APPLIERS` flip: a gate that changes meaning is changed on purpose,
in the change that alters it, rather than repaired later by whoever finds the
build red.

### 1.11 What still needs PLAYABLE, and is deliberately left open

Four, marked so the revisit knows exactly what it owes and nothing else is
mistaken for settled.

- **[AWAITS PLAYABLE] Whether the trim order is right.** §1.3 fixes it as
  constants, latest-message matches, injection order. That is SillyTavern's
  order and it is a reasonable prior, but the question *which entries do you
  regret losing* is answerable only by losing some while playing.
- **[AWAITS PLAYABLE] Whether the two-tier budget's per-book tier earns its
  keep.** [02 §3.2] gives each book a `tokenBudget` and `entryLimit` and the
  arbiter a chat-wide cut. If in practice every book is under its own limit and
  only the global cut ever fires, the per-book tier is ceremony — and imported
  books carry whatever limits their authors set, which is the only realistic
  test of that.
- **[AWAITS PLAYABLE] Whether recursion depth needs a surface.** Book-level
  limits exist in the schema. Whether anybody hits them, and whether hitting one
  is confusing without an explanation in the workbench, is a use question.
- **[AWAITS PLAYABLE] Whether the keyword tester (P5.8) is the diagnostic or a
  consolation.** The claim is that it answers *why does this entry never fire*
  without playing a turn. If the real failures turn out to be budget drops
  rather than match failures, the tester answers a question nobody is asking and
  the workbench's budget view is the surface that matters.

*The corpus counts are not on this list*, and the distinction is worth keeping:
[16 §6](../16-lorebooks-as-a-format.md)'s falsification tests need **a real
library**, which is person-blocked work (§1.6), while these four need **play**,
which needs the P2C sessions first. Two different blockers, and confusing them
would let either excuse the other.

*Re-audit 2026-08-31:* **all four are still open, and the window to close them
is the one immediately ahead.** §0.3 turns each into something to notice during
the manual testing that precedes this phase, because none of them needs a
lorebook to exist — they are questions about what gets cut, how often, and how
long it takes to find out why, and every one of those is visible in an ordinary
turn today. The four stay marked; what changed is that there is now a named
place for the evidence to arrive from.

---

## 2. Stages

### The document half

#### P5.−1 — The by-field view, which is not a lorebook

`polish §1`, built first and for every kind, because §1.9 decided it is a stage
rather than a dependency. The book page's *as configured* fold and the entry
editor's disclosures both render through it, and building it inside either would
bury shared machinery under a specific feature — which is how this repository
acquired two disagreeing JSON viewers already.

Numbered `−1` on the precedent [P3](05-p3-implementation.md) set for the same
situation: work that has to happen first and is not what the phase is about.

*Ends at:* an actor's greeting readable on its detail page without opening the
editor.

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

*Ends at:* ~~the count from [16 §6](../16-lorebooks-as-a-format.md) run over the
imported corpus, and recorded — whichever way it comes out.~~ **the count from
[16 §6](../16-lorebooks-as-a-format.md) written as a script, run over whatever
library is to hand, and recorded with what it ran against stated beside it.**
*Restated 2026-08-30 (§1.6):* the falsification value is in real books and there
may be none when this stage lands, so the stage owes the **instrument and the
reading**, while the *verdict* on the premise waits for a corpus. A phase must
not be held closed by a task with unknown lead time. The count over synthesised
fixtures is still worth recording — it is the control the real reading gets
compared against.

### The retriever half

#### P5.4 — The matching engine, pure

**The regex timeout first, and on its own** (§1.10): `useRegex` is stored and
read by nothing, the library is now full of patterns nobody here wrote, and
[triage §5.1](02-triage.md)'s ADOPT is sixty lines. A matcher that runs an
imported pattern unbounded is a denial-of-service on your own server, triggered
by a book somebody downloaded.

Then keys, secondary keys with selective logic, whole-word/case/regex, scan
depth, scan sources. Pure functions, exhaustively unit-tested — the cheapest
place in the phase to be thorough, same argument as P1.1.

**And the imported corpus is the test input**, not hand-written entries. P4's
converters produce entries with `selectiveLogic` decoded from two different
integer encodings and positions collapsed from two different tables; a matcher
tested only against entries this repository wrote is a matcher tested against
its own assumptions.

#### P5.5 — Timing and recursion

The four timing behaviours over §1.1's state home; the three recursion flags
and book-level recursion limits. Unit tests on the interactions, which are the
part people actually get wrong.

#### P5.6 — The retrieval step and the budget

**Opens with `gatherAssemblyInputs` growing the session's Treatment and its
linked Lorebooks** (§1.10) — the precondition for the whole half, since a
retriever with no books to scan has nothing to do — and **closes by editing the
fixture-pair gate's `lore` assertion in this stage's own commit**, because
turning lore into a producer changes what that named CI step means.

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

~~Sketch; expand on revisit.~~ *Expanded at the 2026-08-30 audit; steps 15–18 are
what §0 and §1.8–§1.10 added, and they are numbered after the existing fourteen
rather than woven in, because the stages cite the old numbers.* Split by half,
per §1.6's cost — a phase with two gates is one somebody will try to exit
halfway, so it says which is which.

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

*Which of these need real books, settled 2026-08-30 (§1.6) so the gate is not
walked into and then argued about.* **Step 1 does not:** three hundred entries
is a load, and a synthesised book of that size exercises the layout, the
virtualisation and the address exactly as an authored one would. **Step 6
does** — "a book you did not author" is false by construction for a fixture we
wrote, and the judgement it asks for is about somebody else's organising
habits. It is met by the **handful of explicitly-permissive real books** the
corpus policy already keeps in the repository
([testing §5](10-testing.md)), which is what that handful is for; it does not
need the private corpus. **Only [16 §6]'s falsification counts need that**, and
P5.3 is written so they do not hold the phase closed.

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

### Added at the audit

15. **A hostile pattern from an imported book does not hang the server.** A
    catastrophically backtracking regex in a `useRegex` entry is abandoned at
    the timeout, the entry reports why, and the turn completes. This is the one
    gate step that is about somebody else's file being able to hurt you, and it
    is why §1.10 puts the timeout before the matcher.
16. **The book page says what the import did to it** (§1.8): a book whose
    `entryLimit` was clamped, whose entry sat at a position with no equivalent
    here, or which was scoped to one chat, says so on its own page — not only in
    a review that is gone once the page is closed.
17. **The five delete sites are one** (§1.7). The helper owns dropping and
    reinserting an object across both table pairs, and the rebuild property test
    passes with the entry rows in place. Adding a sixth call site by hand should
    be impossible rather than merely discouraged.
18. **The fixture-pair gate is green with lore as a producer.** Its `lore`
    assertion changed meaning in P5.6's own commit, from *no producer exists* to
    *the producer ran*, and `pnpm test:fixture-pair` passes on the new reading.
    A named CI step that goes red on a landing is a step somebody repairs
    hastily; one that changes in the commit that changes it is a decision.

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
- **Finishing P4.4's addressable review report.** §1.8 decides that the facts an
  import established belong on the *book*, not on the sweep that created it, and
  that is a different piece of work from the one P4.4 cut. The cut stands and is
  P4's to carry.

---

## 5. The honest size

**The document half is bigger than it reads and the retriever half is smaller**,
and the audit is what makes that sayable rather than a hunch.

The retriever is a **PORT** ([02 §3]): the vocabulary is settled, the divergences
are two and named, the matching logic is pure functions, and the two hardest
inputs — channels for timing state, the RNG for probability — already exist. What
is genuinely new is the arbiter's interaction with per-book verdicts, and the
regex timeout, which is sixty lines somebody else already wrote.

The document half starts from **nothing**. There is no lorebook surface in the
client at all; `polish §1` is a stage rather than a dependency; the index grows a
table pair whose delete sites number five today and must number one before it is
safe (§1.7); and the whole half's value is a judgement — *does this page read as
a document or as a form* — which only a person can settle.

Priced honestly, in the order the phase would cut under pressure:

1. **P5.3, Mentions, goes first.** The skeleton already calls it *the most
   interesting item and the most cuttable*, and its premise is the one [16 §6]
   offers to falsify — with counts that cannot run until a real corpus exists
   (§1.6). Cutting it costs a feature; keeping it while the corpus is absent
   costs the ability to know whether it was worth building.
2. **P5.8's inline highlighting goes second**, keeping the tester itself. The
   tester is the diagnostic; the highlighting is the tester being pleasant.
3. **P5.9's writing-sample carriers go third** — they are three small things
   once the retriever exists, and they are the one part of this phase that is
   not about lore at all.

**What must not be cut, with the reason:** the regex timeout (an imported book
should not be able to hang the server); `gatherAssemblyInputs` growing books (the
half does not exist without it); the folder-gate correspondence test in P5.7
(the whole argument for building the rendering first is that the reason rendered
is the reason acted on, and nothing but a test keeps those two honest); and the
one-helper mitigation for the five `object_fts` delete sites, which is worth
doing whether or not this phase happens.

*Re-audit 2026-08-31, and the price moved once:* **the document half is slightly
smaller than this says.** §1.8's storage, its object-keyed query and its index
came from [P4 §7.14](06-p4-implementation.md), and a concurrent branch has built
object-level create and delete, so the entry editor inherits a precedent instead
of setting one. Everything else here stands — most importantly *starts from
nothing*, which is still true of the surface, and the five `object_fts` delete
sites, which are still five. The cut order is unchanged.

**Expect the document half to be revised by use.** It is the first surface in
this repository whose success condition is a reading experience rather than a
behaviour, and [P3](05-p3-implementation.md)'s workbench — the nearest
comparable — changed shape three times against a browser walk.

---

## 6. What the design still has to settle

Undecided by the *design* rather than merely absent from the code.

**6.1 Whether timing state is a channel.** §1.1 leans yes and §0 confirms the
machinery exists, but the lean was written *with P6's reconstruction machinery in
view* and P6 has not happened. The question that decides it: does a branch
inherit stickiness correctly if timing lives anywhere else? If P6's design work
lands before this phase, the answer is free; if not, the lean ships and P6
inherits whatever it built.

**6.2 What an entry's `metadata` may carry from an import** (§1.8). The
decision is that import notes live there; what has not been decided is whether
that is a documented convention with reserved keys or a free-text bag. [10 §5]'s
`metadata` is the latter today, and a reading surface that renders specific keys
turns it into the former by accident. Worth settling in [10] rather than here.

**6.3 Whether `additionalMatchingSources` is a closed union.** §1.5 ships the
vocabulary; Marinara's is a closed union of named sources and ours is a string
array. An open list is right for the same reason `CallKind` is open — but it
means an unknown source silently matches nothing, and *silently* is the word
this phase spends most of its effort against.

**6.4 Write-backs this plan owes and schedules.** [05 §5.3] — the book page's
import-notes row (§1.8, with P5.0). [16 §6] — its counts run when a corpus
exists, and the document already records that they wait (P4.3 wrote it). The
fixture-pair gate's `lore` assertion (§1.10, with P5.6). And `polish §1` leaves
the polish list when it lands, per that document's own rule.
