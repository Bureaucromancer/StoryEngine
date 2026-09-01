# 07 — P5 implementation plan

**Status: plan, audited 2026-08-30 at `09ea758`, re-audited 2026-08-31 after
P4's own audit closed, and re-audited again at `12a28d9` on the day the phase
opened — see §0.4, which is the current one and which corrects §1.3, §1.7 and
§1.8.** ~~Skeleton,
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

> **All three are merged, and this section is now history — §0.4.** It is kept
> whole rather than struck because its value was always the instruction it
> closes with, and an instruction that was followed reads differently from one
> nobody wrote. One detail of it was wrong: only the import-interface branch
> touches the three files named below.

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

### 0.4 The re-audit §0.2 asked for, run on the day the phase opened — 2026-08-31, at `12a28d9`

§0.2 closes with an instruction rather than a finding: *re-read §0 and §0.1
against whatever is merged on the day P5 starts, rather than trusting either.*
This is that read, on branch `p5` cut from `12a28d9`, and it gets its own section
because it did not come back with a checkmark. **Nothing in §0 has closed. Four
things this plan asserts are now wrong, two dependencies are named nowhere in it,
and two documents already promise behaviour the code does not have.**

**Nothing has closed**, and each of these was checked against code rather than
against §0.1, which is the whole point of running it again:

- `polish §1` has still not landed. The detail page is the header, a seven-row
  metadata list and `AsStored`; the only by-field rendering in the repository is
  the actor editor's eleven hand-written `<Field label="…">` elements, and no
  client file imports a TypeBox schema object at all. **P5.−1 is build, not
  *verify and move on*** — §1.9's re-audit condition resolves against landing.
- The regex timeout has still not landed, and `useRegex` still has no reader.
- `gatherAssemblyInputs` still carries no Treatment and no Lorebooks.
- There is still no client lorebook surface of any kind.
- The five `object_fts` delete sites are still five — **at `ingest.ts` 349, 410,
  415, 436 and 506**. The count is right; §0.1's addresses are one commit stale,
  which is what citing line numbers in a document that outlives a commit costs.
- The fixture-pair gate still asserts `lore` reads `no-producer`, and
  `fixture-pair.test.ts:150` is still exact.
- The corpus still does not exist, and it is still the one item here a person
  rather than a session has to clear.

#### §1.7's proof does not prove anything, and this is the correction that matters most

§1.7 names the five delete sites as the risk, the one-helper extraction as the
mitigation, and closes: **"The rebuild property test is what proves it."** It
does not. `snapshot()` ([query.ts:290](../../../packages/server/src/index-db/query.ts))
selects from `object` alone, so `object_fts` contributes nothing to the string
the property compares, and a stale FTS row is invisible to it.

**Verified by mutation rather than by reading**, because a claim about what a
test catches is exactly the claim this project does not accept on inspection:
with the delete at `ingest.ts:436` removed, `pnpm test:gate` passes, and so does
the entire suite — 1821 tests, no failures. So the hazard §1.7 describes is real,
is guarded by nothing at all today, and **would have shipped behind a green gate
somebody would reasonably have cited as evidence that it had not.**

The asymmetry is the tell, and it is also where the fix comes from: the *session*
half of the pair this one is told to mirror does not have the hole.
`sessionSnapshot()` ([sessions.ts:263](../../../packages/server/src/index-db/sessions.ts))
left-joins `turn_fts` and selects its text, so a stale turn row does show up.
**P5.2's proof obligation is therefore two pieces of work rather than one —
extract the helper, and widen `snapshot()` to join the FTS tables so the property
can see a stale row at all** — and the second is currently invisible in this
plan. It comes first, or the helper ships carrying the same unfalsifiable
guarantee it was built to remove.

One more thing P5.2 is not, while this section is open: a copy. `searchTurns`
returns locations and no snippet, and the string `snippet` occurs nowhere in
`packages/`, so *"a query returning snippets"* is net-new SQL rather than a
mirror of the turn pair. `rebuild.ts:52` and `migrations.ts:190` are two further
hand-maintained lists a new table pair has to be added to by hand — which is
§1.7's own argument arriving twice more.

#### §0.2 is history now, and §1.8's discharged consequence is discharged only for some books

**§0.2.** All three branches are merged; `main` and this branch carry them.
Its one detail worth correcting is that only **one** of them — the import
interface work — touches `routes/import.ts`, `detect.ts` and `local-source.ts`;
the library-file-creation branch changed no server file at all. The section is
left standing rather than deleted, because an instruction that was followed reads
differently from one that was never written.

**§1.8.** Its 2026-08-31 amendment says the first consequence is discharged —
the notes are stored *"keyed by the object they produced"*, so the book page
reads them. That is true for a standalone book and false for the common one. A
card-carried `character_book` is stored inside `#card`
([sweep.ts:223](../../../packages/server/src/import/sweep.ts)) and the single
report row that method returns carries `objectId: actor.id`; the book gets no
row of its own, and `card.ts:265` merges its notes into the *card's* array.
`ImportPanel.tsx:88` says that case *"fires on **every** card that carries a
lorebook, which is most of them"*. So `importNotesFor(bookId)` answers nothing
for most books, and P5 either splits `#card` into two item rows — the honest fix,
and the cheaper one — or the book page walks its actor's row.

Two further gaps in the same place. `/import/file` and `/import/directory` never
record: `recordImport` has exactly one call site, inside the sweep
(`routes/import.ts:223`), so a book brought in by upload leaves no notes at all
and the page owes an honest empty state. And `importNotesFor` has **zero
production callers** — there is no per-object route — while the sentences that
would render a note are module-private in `ImportPanel.tsx` (`NOTE_LABELS`,
`sentence()`), with `note-labels.test.ts`'s grep invariant pointed at them.

**So §5's re-audit line — *the document half is slightly smaller than this says*
— is walked back.** The storage landed; the surface did not, and the surface now
includes a route, a shared note-label module, and a decision about the embedded
case. The entry-matching work §1.8 calls "P5's work" does get cheaper, and it is
cheaper at the converter than at the renderer: the four entry-level notes carry
the entry's *display name* (`sillytavern/lorebook.ts:152`, `:158`;
`marinara/lorebook.ts:123`, `:129`) while the entry's id is
`stableId('entry', name, content)` and is unreconstructible from the note.
Putting the `stableId` in those params is a few lines each and makes the match
exact rather than by ambiguous name.

#### §1.3 overstates what is on disk

*"`extensionActivations` on the entry ([02 §3.1]) is stored (P4 already preserves
it)"* — nothing writes it. Unknown import fields are routed to `metadata`, and
the field survives only as a key Ajv declines to strip. Harmless, and corrected
because the sentence reads as a P4 deliverable that a later phase can rely on.

#### Two dependencies this plan does not name anywhere

- **P5.0 needs a panel to be a panel, and `polish §4` has not landed.**
  [05 §5.3](../05-ui-surfaces.md) specifies the Lorebooks panel as one of the six
  per-kind panels [polish §4](09-polish.md) creates; `LibraryPage.tsx` is still
  one merged table with a kind filter, and §1.7's dependency reasoning covered
  `polish §1` alone. The escape is the shape `polish §4` already describes —
  *shared machinery, per-kind surfaces*, with Lorebooks as the first of the six
  and the other five left to that item — so this is a decision P5.0 makes rather
  than a blocker. It is recorded rather than settled here because it belongs to
  the stage, and it is recorded at all because it is the same class of omission
  §1.7 was written to catch and missed by one item.
- **The retriever half needs a schema change, and §1.10 prices it as a gather.**
  `gatherAssemblyInputs` growing Treatment and Lorebooks is not a read of
  something that exists: `SessionFile` ([sessions/types.ts](../../../packages/server/src/sessions/types.ts))
  has **no lore links and no treatment reference at all**. So P5.6 adds a field
  to the session file — copy or live link, and `gather.ts`'s docstring constrains
  it to something readable from `(account, sessionId, parentTurnId)` alone — and
  P5.7's *`LoreScope` enforced by shape* enforces against links that do not exist
  yet. That is more than "moved from P5.9 to P5.6", and §5's *the retriever half
  is smaller* should be read with it.

#### Two promises the documents have already made for the code

Both are the good kind of finding — the design is written and the code is what is
missing — and both change what landing a stage *means*.

- **The regex timeout is asserted as fact in two places.**
  `schema/lorebook.ts:105` says of `useRegex` that *"Patterns run under a hard
  execution timeout"*, and [02 §3](../02-data-model.md) says the same in
  parentheses. There is none, and there is no `RegExp` constructed anywhere in
  the server — the danger §1.10 describes is created by P5.4's own matcher, which
  is the strongest available argument for the timeout being that stage's first
  commit. Until it lands, those two lines are false; the commit that lands it
  closes a docs/code disagreement rather than merely adding a guard.
- **`LoreScope`'s banner describes a field that does not exist.** It explains
  session scoping's absence by saying *"this lorebook applies to this session" is
  a fact about the session, so it lives on the session's own lore links.* There
  are no session lore links. P5.6 and P5.7 are what make that sentence true.

#### Four smaller findings, each with an owner

- **`pnpm test:fixture-pair` is not a step in `ci.yml`.** §0 calls the `lore`
  assertion *"in a **named CI step**"*; the vitest project and the package script
  exist, and CI runs it only inside `pnpm test` — which is exactly the anonymity
  the P1 gate's own step exists to prevent, in the words of the comment above it
  (`ci.yml:105`). P5.6 either adds the step or drops the word.
- **The `lore` assertion goes quiet rather than red.** It sits inside
  `if (reason !== undefined)` (`fixture-pair.test.ts:148`), so the moment lore
  fills, the row leaves `notFilled` and the check skips. §1.10's *a gate that
  changes meaning is changed on purpose* holds unchanged, but its stated reason
  does not: nobody will meet this as a red build. Said plainly, because "it will
  go red" is the half people remember and it is the half that is wrong.
- **§1.1's channel lean has two mechanical blockers**, and neither is in §6.1's
  framing of the question. `applyEffects` (`sessions/store.ts:422`) ignores
  `scopeKey` and rekeys by `channelId`, so two entries' timing states would
  overwrite each other; `acceptEffect` (`turns/effects.ts:50`) throws on anything
  but a whole-value set at `/`. An entry-scoped channel needs both widened first,
  which is a change to the effect log and P6-adjacent rather than a retriever
  change. §6.1 asks whether timing state *should* be a channel; this is what it
  would cost if the answer is yes.
- **P5.9 inherits a doc/code disagreement.** `schema/preset.ts:120` documents an
  absent `from` as meaning every carrier, in the order treatment → lore → actor;
  `collect.ts:371` reads actors only. Invisible while two carriers are dead, and
  observable in the stage that turns them on.

#### And §0.3's instruction has no receptacle

§0.3 asks that the window immediately ahead be written down, on
[16-p2c-log](16-p2c-log.md)'s precedent, because four decisions wait on it. **No
such log exists**, and `16-p2c-log.md` records nothing about what gets cut, how
often, or how long it takes to find out why — so nothing anywhere answers the
four [AWAITS PLAYABLE] questions today, and §1.11's re-audit line stands
unchanged. If that window has already passed, they are no closer than §1.11 left
them and the file would now be written from recollection, which is the thing §0.3
says is worth less. If it has not, the file is worth making before it does.

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
([02 §3.1](../02-data-model.md)) is stored ~~(P4 already preserves it)~~ but
nothing consumes it until P7's extension host exists. *Corrected at §0.4:*
nothing **writes** it. Unknown import fields go to `metadata`, and the field
survives only as a key Ajv declines to strip — which is enough for the seam and
is not a P4 deliverable a later phase can lean on.

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
delete sites become one.**

~~The rebuild property test is what proves it.~~ **It does not, and §0.4
mutation-proved that it does not**: `snapshot()` reads the `object` table alone,
so removing an `object_fts` delete leaves `pnpm test:gate` — and the whole suite
— green. The proof has to be built before the thing it proves: **widen
`snapshot()` to join the FTS tables, the way `sessionSnapshot()` already joins
`turn_fts`, and only then extract the helper.** Both are P5.2's, and the order
is not optional — a helper landed under a property that cannot see it inherits
exactly the false confidence this paragraph was written to prevent.

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
- **The first consequence is discharged, and only for some books.**
  *The converters must leave enough on the object to reconstruct the note* was P5
  scope because the notes lived only in a report that was thrown away. They are
  now stored, with an index on the object column, and the book page **reads them**
  rather than reconstructing them — so the `metadata`-on-the-entry mechanism below
  is no longer needed for this; keep it for what [P4 §1.11] routes there.
  *Corrected at §0.4:* “keyed by the object they produced” holds for a standalone
  book and not for a card-carried one, which is the common case — that row is
  keyed to the **actor**, and two of the three import routes record no row at
  all. Splitting `#card` into two item rows is the honest fix and is P5’s.
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

*Checked, at the opening — §0.4:* **it has not landed, and this stage is build.**
The detail page is the header, a seven-row metadata list and `AsStored`; the only
by-field rendering in the repository is the actor editor’s hand-written `<Field>`
elements, and no client file imports a schema object at all. The concurrent
branch paid the ownership half of the companion clause and nothing else, so the
`actors` half of the Edit gate is still this stage’s too.

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

#### ~~P5.−1 — The by-field view, which is not a lorebook~~ Landed

**What shipped:** a field description derived at runtime from the schema
(`library/fields.ts`) and a read-only rendering of it (`library/ByField.tsx`) on
the detail route, for every kind rather than for actors. The fields sit above
the storage block, which kept its own heading; *As stored* stays and keeps the
job §2 gave it, which is the keys the schema does not declare. `polish §1` and
§2 are struck in [09](09-polish.md), §1 by this stage and §2 by the clause it
could not honestly claim until §1 existed.

**Three things it settled that the item left open**, each argued where it landed
rather than only here: the single description is *the schema read at runtime*,
since any written-out field list is the second description the item exists to
prevent; empty fields are **shown**, in three words rather than one, because
absent, blank and none-of are three different facts the schemas mean
differently; and the closing clause about the Edit gate is paid in full — the
condition and the editor's *address* moved together, because the branch named
`actors` twice and widening one without the other would have opened a lorebook
in the actor editor.

**Not in it, deliberately:** the disclosure groups. [05 §11.2d] builds them from
the schema's comment banners and decides which start open, ~~and both of those
are P5.1's — the stage that owes an editor.~~ The description is shaped so that
adding them is additive rather than a rewrite, and `polish §1` asks for a
labelled field list rather than a grouped one, so nothing here is deferred that
this stage owed.

*Corrected at P5.0, and the correction is worth reading because the sentence was
wrong about a stage rather than about a fact.* Only **which groups start open**
is P5.1's. The groups themselves are P5.0's, because
[05 §5.3](../05-ui-surfaces.md) asks the book page's *as configured* fold for
"every remaining field **in the schema's own groups**" and calls it "the same
component §11.2d specifies for the editor, in its read-only mode" — so the read
surface needs them a stage before the write surface does, and P5.1 inherits them
rather than building them.

`polish §1`, built first and for every kind, because §1.9 decided it is a stage
rather than a dependency. The book page's *as configured* fold and the entry
editor's disclosures both render through it, and building it inside either would
bury shared machinery under a specific feature — which is how this repository
acquired two disagreeing JSON viewers already.

Numbered `−1` on the precedent [P3](05-p3-implementation.md) set for the same
situation: work that has to happen first and is not what the phase is about.

*Ends at:* ~~an actor's greeting readable on its detail page without opening the
editor.~~ **Met, and asserted** — `ObjectDetailPage.test.tsx` renders a greeting
with paragraphs in it and finds them on the page. Thirteen mutations of the
mechanisms under it were run and every one went red, including the two that
would read as taste rather than behaviour: the fields below the storage block,
and the three kinds of empty collapsed into one word.

#### P5.0 — The Lorebooks panel, and the book as a document

**In progress. The field groups landed first**, because both the *as configured*
fold and the entry editor render through them and neither could be built without
them: `LoreEntry`'s comment banners are annotations on the field each one opens
(`schema/banners.ts`), the field description groups by them, and every other kind
— none of which is written in banners — renders exactly as it did. The banners
reach the emitted artefact too, so the grouping a stranger reads in
`storyengine.lorebook.1.json` is the one the app renders.

Two things that came out of building it, both recorded because neither is
visible from the design. **The file carried seven banners where §11.2d names
six**, and the seventh read *the one addition* — a remark about the schema's
history standing where a reader needed the name of a group; it is now *The entry
itself*, and the remark moved onto the field it was actually about. And
**grouping has to happen before the fold's omissions, not after**: a banner
hangs on the field that opens its group, §5.3's fold omits `keys`, and `keys` is
the field `Matching` hangs on — so filtering first silently dropped a heading
and spilled its fields into the group above.

**Then the panel**, as the first of [polish §4](09-polish.md)'s six and on that
item's own rule — one list component, and what a panel supplies is its columns,
its sort and its empty state (`library/panels.tsx`). §5.3's table, verbatim:
name with badges, entry count, tags, source, updated; sorts by name, recency and
entry count; an empty shelf that points at import rather than at the API. `tags`
has its documented consumer at last. The other five kinds share the columns the
merged list already had, and adding one is a table entry rather than a branch.

*The name cell stayed with the table rather than moving into the panel*, and
that is the load-bearing half of the split: the name carries the link and the
link carries the shadowed-copy discriminator, so a panel supplying its own name
cell is a panel building its own links from `{kind, id}` — which is the F19
regression this stage was told about in advance.

*Two decisions worth their sentence.* **Off is badged and on is not**: §5.3
wants the state that costs somebody an afternoon visible, and a badge on every
enabled book would bury it. Scope is badged only when it is `linked`, for the
same reason — global is the default and nearly every imported book is one.
**And the sort copies the array.** Nothing was checking that; mutation found it,
because the page renders the same order either way and what an in-place sort
breaks is every *other* reader of the query cache.

**Then the book page**, which is what the detail route renders when the kind is
`lorebooks` — not a new page, so the header, the storage block and *As stored*
stay the page's. The book's own fields and the counts §5.3 asks for (*214
entries, 31 off*, invisible at every surface before this); the activation
settings as one quiet strip, which is where [02 §3.1]'s *each flag is a direct
UI control* gets read as **reachable** rather than as prominent; the folders
panel with its **Gate** column and a real *Ungrouped* row; and each entry as a
readable unit — keys as an index row, description set apart, content clamped
with an expand, and *as configured* folded beneath in the schema's own groups.

**The gate's three reasons are one function in `shared`, not client logic.**
§3's step 13 asks that the tester agree with what the document half showed and
P5.7 is told to honour the same gate in activation; a test can compare two
implementations, but only one implementation cannot disagree with itself. So
`shared/lore.ts` answers *what is shut in this entry's way*, the page renders it,
and P5.7 will act on it. Three things that a check written from §5.3's summary
gets wrong, all of them now tested: **folders nest** through `parentFolderId`, so
a one-hop lookup is not the check; **the chain need not be acyclic**, because
these files are hand-edited; and a `folderId` naming a folder the book does not
contain has to degrade to *Ungrouped* rather than vanish, for the same reason
§5.3 insists `folderId: null` gets a real node. More than one gate can be shut at
once, so the answer is an ordered list rather than a winner — outermost first,
because that is the order they have to be cleared in.

*A structural bug the tests found:* the fold's group headings were `h3`, the same
level as the entry name they sit **inside** — one three-hundred-entry book put
two thousand four hundred of them on a page, every one claiming to be a sibling
of its own parent. Heading level is document structure and belongs to the host,
which [ui/Text.tsx] already said; it is a prop now.

*And a detour worth naming:* the suite's named CI gate turned out to be failing
about one run in eight, on a fixed example, for a reason that had nothing to do
with this phase — the harness's slug bookkeeping leaked between tests and
silently skipped the copy the assertion was about. Fixed and measured
(`5b7fbc6`); it was blocking any honest claim that this stage's own gate was
green.

**Then the narrowing, both halves of it.** The panel's four — tags, scope,
enabled, source — as a fourth thing a panel supplies, alongside its columns, its
sort and its empty state. And within a book: a search across the five fields
§5.3 lists, key chips that filter to the entries carrying them, the entry `tag`,
and the folder rows, all composing.

*Free, exactly as §5.3 says.* The detail route already holds the whole object,
so nothing here asks the server anything — and the search is substring and
case-insensitive with **no regular expression anywhere**, which is not a
simplification: a pattern compiled from something a person is still typing is
the hazard §1.10 puts a hard timeout in front of at P5.4, and this would be it
in a keystroke handler with nothing to time out.

*Four decisions worth the ink.* **A search opens the entries whose prose
answered it** — a clamp that hides the words somebody just searched for is a
search that found something and put it out of sight. **Each filter offers the
whole shelf's values**, not what the others have left, or picking a tag quietly
empties the scope list and unpicking becomes the only way back. **A shelf
narrowed to nothing says the filters are the reason** rather than repeating the
empty-library sentence, because what a person does next differs: widen, or go
and import. And **a marked hit needed a token**, so the palette gained
`highlight` — amber is spoken for twice over by `warn` and `provenance`, and a
highlight is neither; the contrast test covers the new pair in both themes.

*One thing deliberately not addressable.* The kind filter is a search param
because it selects *which panel*, and a panel is a place. A within-panel filter
and a within-book search are views of one place, and §5.3 makes the book's
search local by construction — so these are component state. The one narrowing
that stays a link is the entry address, which is what §5.3 asks for by name and
is still to come.

**And then somebody opened it.** A 247-entry book was written straight onto disk
— through the factories, no API, the watcher indexing what appeared, which is
the storage thesis working — and walked in a browser. **Three defects, none of
which any test had a reason to catch**, and the fact that all three are
judgement rather than logic is the argument for gate step 6 being a step at all.

- **The folder count was direct-only, and a gate is transitive.** `Places`
  reported the sixty entries filed in it while governing sixty-one, in a column
  headed *Entries* sitting beside one headed *Gate*. §5.3 says "the number of
  entries it governs", and shutting a folder shuts everything beneath it, so the
  number that changes when somebody flips that switch is the one to print.
  `entriesGoverned` is transitive, cycle-safe, and does not require the file to
  list a parent before its child.
- **The expand control appeared on entries with nothing to expand.** Most
  entries in a real book are two lines; a *Show all* on one of those is a button
  that visibly does nothing when pressed, which is `Field`'s complaint about a
  greyed control arriving from the other direction. It is offered only where the
  clamp could bite — an estimate, erring toward offering it, because being wrong
  high costs a dead button and being wrong low would hide text.
- **The off-reason was rendered in danger red**, which contradicted this same
  stage's own argument for the shelf badge being neutral. Switching an entry off
  is deliberate, and a shut folder gate is not a fault at all — it is the
  mechanism a book carries a timeline with. Colouring either as an error is the
  surface arguing with the author. Muted now; the words carry it, and they are
  §5.3's words.

**And the entry address**, which §5.3 asks for by name and which gate step 1's
second half is about: a named entry reachable by its own address, the link
surviving a reload and landing on that entry. `?entry=` on the existing detail
route — not a fragment, which cannot hand the view a focused state, and not a
child route, which would put the shadowed-copy discriminator in two places.

*Dropped rather than rejected*, like every other param on this router: an id
this build has never seen degrades to the whole book, because [10 §5.2] says an
entry id "is unique within one book and carries no meaning beyond it" and an
importer may renumber freely — so a saved link outliving its entry is the
expected end of one, and a whole book is a real page where an error card is not.
The validator is a named export now, tested as the contract it is: it was
reachable only by driving the router before, and `router.test.tsx` had never
asserted a search param at all.

*The entry is marked as well as scrolled to*, with `aria-current` and not only
an outline — a focus mark that exists only as a colour is one half the readers
of a page cannot perceive. And **every entry link carries the copy
discriminator**, which is F19 one level down: an entry link that dropped
`?source=` and `?slug=` would send a reader of the shadowed copy to the winner.
The page test's `Link` stub had to grow a `search` prop before that could be
asserted at all — without it, dropping the discriminator left every test green.

**And §1.8's import-notes row, which closes the stage.** Gate step 16: a book
whose `entryLimit` was clamped, or whose entry sat at a position with no
equivalent here, says so on its own page — not only in a review that is gone
once the page is closed. The sentences are the review's own, moved out of
`ImportPanel` into `note-labels.ts` so that two renderers read one catalogue;
`note-labels.test.ts`'s grep is repointed, which is the coupling that keeps that
honest.

**Three things had to be true before the surface could exist, and none of them
was.** `importNotesFor` had no account scoping — an object id is a uuid and hard
to guess, but that is not an access rule, and its first caller would have
inherited the hole. There was no route. And the query answered nothing for the
commonest kind of book there is: a card-carried `character_book` makes a second
object from one file, the review is a row per *file*, so the book had no row to
be found by. `recordImport` now writes a row per object produced, sharing the
item's `seq`; `readImport` collapses them back. That needed a migration, because
`primary key (job_id, seq)` was the old assumption written down.

*Two things that fell out of it.* The review's counts were counting **rows**, so
a sweep of a hundred cards carrying books would have reported two hundred
conversions — found by mutation, since the fixture card carried no book. And
adding a book to that fixture broke an unrelated assertion, which is its own
finding: **re-importing a card that carries a book re-converts it** rather than
reporting it unchanged, because the embedded book's identity is not stable
across imports. That is [P4 §7.14]'s re-import-identity question from a fourth
direction, and it is left as one.

*A trade worth naming rather than settling:* an entry-level note appears both in
the book's list and on the entry it names. Complete and scannable at the top,
met where you are reading at the bottom — but a book with two hundred collapsed
positions would have a long list at the top, and if that turns out to read badly
the top list is the half to trim.

**Written up after walking it**: a SillyTavern world file with `entryLimit: 5000`
and two entries at author's-note positions, imported through the real sweep,
produces exactly those three notes on the book's own page, with the clamped 1,000
visible in the strip above them.

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

**And “the panel” presumes a panel** — [polish §4](09-polish.md) has not landed,
so the library is still one merged table with a kind filter (§0.4). This stage
builds the Lorebooks panel as the **first** of that item’s six, on its own
*shared machinery, per-kind surfaces* rule, and leaves the other five and the
all-kinds preference to it. Decided here rather than discovered, because the
alternative — a lorebook-shaped detour inside the merged table — is the shape
that has to be undone when the split lands.

*Ends at:* opening a three-hundred-entry imported book and finding one entry by
reading rather than by scrolling — and an entry that is off saying *which* of the
three reasons made it so.

#### ~~P5.1 — The entry editor's minimum~~ Landed

**What shipped:** `/library/lorebooks/$id/edit`, whose subject is the book and
whose unit of work is an entry — because an entry has no address on disk, so
creating, renaming or deleting one is a write of the whole lorebook through the
same route, hash and history every other object uses. §11.2d's disclosures come
from the schema's banners with Matching and Firing open; the durable core and
the folder gates are writable and everything else renders read-only *in place*;
create, rename and delete are there; and the closed-section invariant is a
tested function rather than a rendering detail.

**The invariant is the piece that changed shape, and the change is a departure
from §11.2d's illustration rather than from its rule.** The section says *name
what is inside it that is not at its default* and glosses the standard at the
value — *a collapse that conceals a non-default value is a hidden field* — and
[05 §2.1] forbids a *lossy summary* by name. The illustration *Matching (3 set)*
is a count, and a count conceals all three: an entry running `useRegex` under a
heading saying only *3 set* has exactly the surprising behaviour the section
exists to surface. So every off-default field is named. *Timing (sticky 4)* is
reproduced character for character; *Matching (3 set)* comes out as the fields
it stood for. Gate step 5's own wording settles it — it asks that a collapsed
section **names its non-default values**, plural.

**And the default is the factory, which turns out to be the only description of
one there is.** `newLoreEntry` is what *create* calls, so the entry this editor
makes and the entry it measures against cannot disagree about what *default*
means. Worth recording: `10 §5`'s `LoreEntry` block declares **no** defaults at
all — the `default` annotations there belong to `Lorebook` — so the factory's
own docstring citing §5 for them is over-claiming, and there is no second table
to drift from because there is no second table at all.

*Two consequences of that worth knowing before somebody calls them bugs.* An
**imported** entry annotates heavily: the SillyTavern converter faithfully
reproduces ST's defaults, and four of them differ from ours (`selective`,
`matchWholeWords`, `depth`, `probability`), so a real book reads *Matching (keys
1, selective, match whole words off)* and *Placement (position after_char, depth
4)* on every entry. That is the format difference showing, not noise, and the
converter must not be "fixed" to hide it. And a **uuid** `folderId` exceeds the
value cap and renders as *folder id set* — the field named without printing
thirty-six characters nobody can read.

**The writable set is [05 §11.2d]'s sentence and nothing more** — `name`,
`content`, `description`, `keys`, `enabled`, plus `folders[].enabled` — and
`folderId` was **considered and cut**. The argument for it was that a created
entry lands Ungrouped forever, and the argument is real; but §11.2d requires the
schema's grouping *verbatim*, which would bury a filing control two clicks
inside a collapsed group named for firing behaviour, and [05 §11.2c] puts
filing-shaped operations on the entry list at P11. **The hole is closed at the
create verb instead**: a new entry lands in the folder the list is standing in.
Re-filing an existing entry stays P11's. `tag` and `secondaryKeys` are the two
other defensible widenings and are cut for the same reason — the sentence says
*everything else visible and read-only*, and this stage is called a minimum.

**Three things the stage turned out to owe that its own text does not say.**
[05 §5.3] asks that the read view's edit affordance be *"a link into the editor
**at the entry's address**"*, and the page header's Edit cannot be it — that
link is one component shared by every kind and passes no search params — so the
book page gained a per-entry Edit, withheld on a shadowed copy through the same
`mutable` predicate, since every write resolves an id to the winner. The
**New lorebook** control is this stage's too, by P4.5's own rule that *a lorebook
gets its New control when this editor exists*; the sentence beside it said
"Actors are the only kind that can be made here" and was false the moment the
row landed. And the book's **`name`** is writable — not in §11.2d, but owed by
the create control, which would otherwise name a book once and never again
before P11.

*Four decisions worth their sentence.* **The draft is the book, not a
projection.** `ActorForm` exists because that editor owns nearly every field an
actor has; this one owns six of forty, so a projection would be a forty-field
parallel copy built to carry six, and every field it forgot would be one a save
silently dropped. **Nothing is stamped on the way out**: the server stamps
`updatedAt` itself and decides its no-op rule on the object *as sent, before any
stamping*, so a client stamp reaches disk in no case and only ever disables the
server's byte-equality second opinion. **The 412 merge is per entry and per
field**, resolved against the draft as it read when the base was loaded — five
three-way cases, each tested separately, because a merge that got four right and
resurrected every deletion would pass any single round trip. And **the entry
list marks what is unsaved**, because one save writes the whole book: an entry
edited and then left is a pending change, and a surface that did not say so
would be hiding a field one level above the one the invariant forbids.

*A hazard met rather than assumed:* entry ids are **not** unique in practice.
The importers derive one as `stableId('entry', name, content)`, so two entries
agreeing on both collide — `10 §5.2`'s uniqueness is an intent, not an enforced
invariant. Every edit here patches the **first** match, which degrades to *one
of the two is uneditable* rather than to *both changed and both saved*. The
editor's shape guard is stricter than the book page's for the same reason: a
reader needs entries to be objects, a writer needs every entry's `id` to be a
string, or an id-keyed merge silently folds two entries into one.

**Then somebody opened it**, on the same 247-entry book P5.0 was walked on, and
**four defects came out that no test had a reason to catch** — which is the
third phase running to make that argument.

- **Clicking an entry visibly did nothing.** The list stood seven thousand
  pixels tall and the form it selects into sat underneath all of it. Bounded and
  scrolled now, with the addressed entry brought into view inside it, so arriving
  from the read page's Edit link lands somewhere you can see.
- **The folder rail is not enough narrowing.** A hundred and eighty-two of that
  book's entries are ungrouped, so *pick a folder* still left a wall. One field,
  names only — deliberately not a second copy of the book page's search, because
  finding an entry by what it *says* is the read page's job and the read page
  links back into here.
- **The disclosures crashed the page on the first click.** They were controlled,
  `AsStored`-style, so the annotation could be dropped while a section was open —
  and the toggle handler read `event.currentTarget` inside a state updater, which
  runs later, in React's render phase, by which time it is null. **No test saw
  it in either direction**: the suite renders under `act`, where the updater
  flushes inside the dispatch and the reference is still alive. The fix was to
  delete the state rather than repair the read — React writes a DOM prop only
  when the *prop* changes, so a constant `open` is applied once and a section
  opened by hand, or by a browser showing a find-in-page match, simply stays
  open. The cost is that the annotation shows while a section is open; that is
  the cheaper of the two mistakes.
- **A mutation aimed at the wrong line found a real gap anyway.** Feeding the
  *saved* entry to the gate note instead of the draft changed nothing any test
  could see, so *this entry is off* would not have followed the switch until the
  next save.

*Thirty-eight mutations, and the last three survivors are the interesting ones.*
A summary rule with a count arm hid `useRegex`; a membership set beside
`EntryRow`'s switch meant removing the guard rendered every field as the last
case's control, so *Position* became a checkbox bound to `enabled` — the set is
gone and the switch is the whole answer; and one arm of the merge's created-entry
test was unfalsifiable, because `JSON.stringify(undefined)` is `undefined` and
the comparison beside it was already true.

**Two design notes are stale and are named rather than edited.** The schema
carries **seven** banners since P5.0 reworded the seventh to *The entry itself*;
[05 §11.2d](../05-ui-surfaces.md) still lists six, and
[10 §5](../10-schemas.md)'s pseudo-code still calls it *The one addition*.
Nothing here depends on either — the open-set is keyed on the field a banner
hangs on rather than on its words, precisely so a rewording cannot change which
sections open — but the documents should catch up.

*Ends at:* **met, and witnessed in a browser** — an entry of an imported
SillyTavern book edited and saved, the file on disk changed, `updatedAt` stamped
by the server rather than the client, the other entries byte-identical, one
`manual` history version written, and Save disabled again with *No changes to
save* the moment it returned.

---

*The stage as it was written:*

[05 §11.2d](../05-ui-surfaces.md)'s disclosures, derived from the schema's own
comment banners, with Matching and Firing open. Create, rename, delete an entry;
edit the durable core and the folder gates; everything else visible and
read-only. **To scope on revisit** against [05 §11](../05-ui-surfaces.md) — the
full editors-are-not-dumb-forms treatment is P11's, and the P1.7 precedent (real
write path, no assist) is the model. This absorbs the editor clause of what was
previously P5.3.

*The object-level halves of that clause landed first — delete at P4.4, create
at [P4.5](06-p4-implementation.md), where the actors-only rule means a lorebook
gets its New control when **this** editor exists. Nothing here is discharged by
that: creating and deleting an **entry** is writing below the object, which
[05 §5](../05-ui-surfaces.md) puts on the editor's side of the line and not the
library's. What P4.5 supplies is the precedent for the shape — a name, a real
write path, no assist.*

The closed-section invariant is the part not to cut: a collapsed group **names
what inside it is not at its default**, or it is a hidden field.

*Ends at:* an imported entry edited and saved through the real write path,
through the same concurrency and history machinery every other object uses.

#### ~~P5.2 — Per-entry index rows, and the search they exist for~~ Landed

**What shipped, in the order §1.7 insists on and for the reason it gives.**
`snapshot()` was widened first, the helper extracted second, and the table pair
built on top of both — because a helper landed under a property that cannot see
it inherits exactly the false confidence §0.4 found.

**The widening is two queries, not one, and the second is the one that matters.**
A left join from `object` catches a search row that is missing or duplicated for
an object that exists — which is `upsert`'s failure and only `upsert`'s. It
cannot catch a row that *outlived its object*, because there is no object left
to join from, and that is what the other four delete sites are for. So the
second query asks from the other end: which search rows name a path the `object`
table has never heard of. A **tombstoned** object is deliberately not an orphan
— the row survives so a rename can still be recognised as one, and
`matureTombstones` takes both halves away together.

**Measured, before and after.** Before: removing any one of the five
`object_fts` deletes left the named gate and the whole suite green — §0.4's
finding, reproduced. After: **twelve mutations across the helper, the five call
sites, the entry writer and the rebuild's own list, and all twelve go red; eight
of them at the named gate.** That is what gate step 17 asked to be able to say.

*Three of those twelve only went red after something else was fixed, and each
was a real gap rather than a stubborn mutation.*

- **The property generated books with no entries.** `newLorebook` sets
  `entries: []` and every fixture used it unchanged, so widening the snapshot
  over the new pair would have compared two permanently empty tables and agreed
  forever about nothing — §0.4's finding one table deeper. The generator now
  writes two entries per book and a `copy` carries the original's verbatim,
  which is also what makes the shadowed-duplicate case real: two copies of one
  book carry the *same* entry ids, and that is what rows keyed by path rather
  than by entry id exist to survive.
- **`emptyTheLibrary` was a third hand-maintained list of tables**, beside
  `dropAll` and `rebuild`'s. Missing a table in either of those turns a test
  red; missing one *there* leaks rows between the property's own iterations, so
  the gate goes red for a reason that is entirely the harness's — which is the
  shape of both flakes this file has already had to write up.
- **A keyword test passed through the wrong column.** The entry was called *The
  Ferryman* and had `keys: ['ferryman']`, so unindexing `keys` altogether
  changed nothing. A field is only proved searchable by a term that occurs in
  **that field and nowhere else**; the fixture now carries one invented word per
  indexed field.

**The locator's key is `(path, position)` and `entry_id` is deliberately not in
it**, which is the design decision this stage most nearly got wrong. [10 §5.2]
makes entry-id uniqueness a *format* rule and nothing enforces it: `Id` carries
no uniqueness constraint, `validate` does not walk the array, and both importers
derive one as `stableId('entry', name, content)` — so two byte-identical entries
in one hand-maintained world file produce one id twice. Under `(path, entry_id)`
that book raises a constraint violation *inside* `ingestFile`'s transaction,
which rolls the whole upsert back: a file on disk, valid against its schema, and
invisible to the library, with no `file_error` row to explain it. The array
index cannot collide. It is the same argument `object` makes for keying on path
rather than id, one level down.

**Entry rows follow `object_fts` in every other respect**: they stay on a
tombstone and are filtered at query time, and **both copies of a shadowed
duplicate are indexed** — winner-only indexing would need a sixth write site
inside `resolveDuplicates`, and would make the shadowed copy's prose
unfindable while [P5.0] requires every entry link to carry `?source=` and
`?slug=` precisely so it can be read.

**The query is not `search` with a different table under it.** The snippet is
the point — §14.5: *"a result that names the book without showing the matched
text … is close to useless at book scale"* — and two things about it were
measured rather than read. FTS5's column argument is `**-1**`, which means
*whichever column matched*; pinning a real index returns the head of that field
with none of the match in it, which reproduces §14.5's complaint one level down,
and no assertion about the snippet's type or length can see it. And the excerpt
comes back **unmarked**: FTS5's markers are inserted literally and are
indistinguishable from the same characters occurring in the text, while the book
page already marks matches itself — the cost, stated rather than hidden, is that
a prefix or boolean query will not be highlighted by a substring matcher.

**Scoped in SQL, where `search` scopes in the route**, and the asymmetry is
deliberate. That comment's argument holds for `search`, which has no owner in
its query at all; this one already joins `object` for the book's id, name, slug
and the tombstone filter, so the owner is in its `from` clause either way.
*And the route's own scoping has a defect this need not inherit*: SQL applies
`limit` before the route filters, so on a household server one account's matches
can consume the whole budget before another's are considered. Recorded rather
than fixed — it is `search`'s, not this stage's — and it matters more here,
because what an unscoped entry hit would carry is the prose itself.

**No client surface, and that is settled rather than deferred.**
[05 §5.3](../05-ui-surfaces.md) says across-the-library search *"belongs to the
one search surface rather than to this panel"* and names *"building a
lorebook-only global search"* as the failure it exists to prevent. The route
already returns objects and turns that no client calls; this is a third array
beside them, and the surface for all three is §14.5's.

*One defect met in the browser rather than in a test, and it is the one the
migration docstring now describes.* Bumping `INDEX_SCHEMA_VERSION` in one edit
and adding the DDL in a later one let a dev-server restart land in between: the
index migrated 5 → 6 against a schema that had no lore tables yet, stamped
itself 6, and `migrate` returns early forever after. The symptom was every
search answering *"that search query could not be parsed"* — **the server
blaming the reader for a table the server had not built**, because the route
caught every throw and called it the caller's. `no such table` is the one
message a query string cannot produce, so it is re-thrown now and becomes a 500
with the real fault in the log. The remedy for the index itself is the one
[13 §5](../13-internal-contracts.md) already prescribes: delete it, and the next
start rescans.

*Ends at:* **met, and walked** — searching `eat` across a library of four books
returns exactly one entry, in one book, with *"He has worked the crossing for
thirty years and has never once been seen to eat.…"* as the snippet, and the
`objectId`/`entryId` it carries opens the book page on that entry with
`aria-current` on it.

---

*The stage as it was written:*

#### P5.2 — Per-entry index rows, and the search they exist for

[05 §14.5](../05-ui-surfaces.md): a locator table and an FTS table for lore
entries, mirroring the existing turn pair; an ingest branch that writes one row
per entry; the rebuild path clearing both; a query returning **snippets**, which
is what makes a hit worth returning; and one additive array on the search
response. The only server work in the half, and the only place a schema id
appears in the ingest path — justified by the rule at
[05 §14.5](../05-ui-surfaces.md), *a fragment is indexable when it has an
address*, and bounded by it.

§1.7's five delete sites are the risk. The helper is the mitigation and ~~the
rebuild property test is the proof~~ **the proof has to be built first** — the
property compares `snapshot()`, which reads the `object` table alone, so it
cannot see a stale FTS row at all (§0.4, mutation-proved). **Widen `snapshot()`
to join the FTS tables, the way `sessionSnapshot()` already joins `turn_fts`,
before extracting the helper.** Two further things this stage is not a copy of:
`searchTurns` returns no snippet, so the snippet query is net-new SQL rather
than a mirror; and `rebuild.ts` and `migrations.ts` each carry a hand-maintained
list a new table pair joins by hand.

*Ends at:* searching for a phrase that occurs in one entry of one book, and
landing on **that entry**, with the matched text shown.

#### ~~P5.3 — Mentions~~ Landed

**What shipped:** *Mentions* and *Mentioned by* as derived, labelled sections on
each entry, every row naming what matched; the rule in `shared/mentions.ts`
because [16 §6](../16-lorebooks-as-a-format.md)'s falsification script counts the
same pairs the page draws; and `tools/lore-mentions.ts`, run, with its reading
below.

**The rule is whole-word, case-insensitive, over name, keys and secondaryKeys,
with no stop-list and no length floor** — and the last clause is the decision.
[05 §5.3](../05-ui-surfaces.md) raises four objections to *drawing* links and
three of them are survivable in a list: this does not pretend to be the matcher,
it uses one stated rule rather than approximating thirty per-entry ones, and it
picks no winner where two entries share a key. The fourth needed a choice —
short and common keys force a stop-list, *"which is invented policy and
invisible invented policy at that"*. The word doing the work is **invisible**,
so there is no stop-list: a book whose keys are common words gets a long list,
and that is the file being what it is. Suppressing it would also break the
instrument, since a long list is exactly the signal §6 is watching for.

**Whole-word rather than substring is the one place the matcher could have
manufactured §6's own failure.** Substring matching pairs *art* with *harbour*
and *the docks* with *the dockside*; a count built on it would report absurd
lists produced by the matcher and read as a verdict about the books.

*Ends at, and the reading, which is the stage's actual deliverable.* Run over
this worktree's `data/` — **four books, 252 entries, 9,362 mention pairs, median
39 per entry, max 39**. That is the shape §6 calls absurd, and the script says
why in the same breath: **eight distinct terms matched, and the top eight carry
100% of the pairs**, six of them at 1,560 each — `quay`, `ropewalk`,
`saltmarket`, `old yard`, `lamp row`, `cutwater`. Those are the filler entries
P5.0 generated to load-test the book page, forty to a name, each carrying one
shared key. The *authored* entries in the same book behave as §2 predicts: *The
Ferryman* mentions exactly one thing, *The Rain*, matched on `weather`.

**So the control reading is: the instrument separates the two, and the corpus
cannot answer the question.** Which is §6's amendment restated from the other
side — a corpus we wrote confirms what it was built to contain. Folders in the
same run: 5 across 4 books, one book carrying all of them, 25.8% of entries
filed. The verdict on both waits for books real authors wrote.

*Two things measured rather than asserted.* §5.3 says the computation
*"recomputes in milliseconds over an object already in hand"* — **37ms for 247
entries**, memoised per book, so it is paid once per render of the page rather
than once per entry. And the *rendering* is where the cost actually was:
uncapped, that book put **9,362 rows across 120,202 DOM nodes** on one page.
Capped at five with the remainder stated — *and 34 more* — the same page is
**55,882**. The cap is a visible one and that is the whole difference from the
stop-list §5.3 rejects: a truncated list that states its own remainder is a list
plus the fact that it is long. **The script is not capped**, because the
instrument has to count what the page declines to draw.

*A defect the existing tests caught, and it is one this module could not have
seen alone.* `lorebookShape` checks that `entries` is a list of objects and
deliberately no more — a hand-edited file is the storage thesis working — so
`mentionIndex` is reachable with entries that are not `LoreEntry`s whatever the
type says. Spreading an absent `secondaryKeys` threw inside the component, and
the first thing that met it was the detail page's own minimally-book-shaped
fixture. Shared code reachable from that guard may not assume more than the
guard checks; the reads go through the file now, and three cases cover it.

*And one carve-out widened rather than worked around.* `eslint.config.js`
allowed direct filesystem access in `tools/*.mjs` only. The count is a `.ts`
file because `tsconfig.tools.json` already typechecks `tools/**/*.ts` and a
script whose **output is evidence** is the last one that should be unchecked —
so the carve-out now names both extensions, on the argument it always had, which
was never about the extension.

---

*The stage as it was written:*

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
17. **The five delete sites are one** (§1.7), **and the property can see them.**
    The helper owns dropping and reinserting an object across both table pairs,
    and the rebuild property test passes with the entry rows in place. Adding a
    sixth call site by hand should be impossible rather than merely discouraged.
    *Amended at §0.4:* the second half of that is the load-bearing half and was
    missing — removing any one FTS delete leaves the gate and the whole suite
    green today, so this step is met only when deleting one **fails** it.
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
fixture-pair gate's `lore` assertion (§1.10, with P5.6). ~~And `polish §1`
leaves the polish list when it lands, per that document's own rule.~~ **Done at
P5.−1, and the rule cited was not there.** [09](09-polish.md) has no removal
rule — its house rule is about an item that turns out to need a schema change,
which is a different thing — and its own §6 is the precedent against one: it
landed and stayed, marked *landed rather than proposed*. So §1 and §2 are struck
in place, which is also what keeps their arguments beside the decisions the
build made against them.
