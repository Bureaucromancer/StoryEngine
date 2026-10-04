# 25 — P8 implementation plan

**Status: ~~skeleton~~ ~~a plan~~ ~~*ready to start*, 2026-09-15 at `3287d67`~~
~~built on §5's fallback cut~~ merged into `main` 2026-09-16 at `4a6e377`, and
open.** Six stages are committed and each carries a *Done* block in §2 naming its
commit; **§3.2** is the gate's results table. **The merge is not the close** —
[manual testing §7](05-manual-testing.md) says a phase closes when its critical
list is walked, and P8's is [sitting N](05-manual-testing.md), which has one row
and no result.

*`main` as it stood immediately before the merge is* ~~*the `pre-p8` branch*~~
*`af23e8d`, the merge commit's first parent* (***corrected 2026-10-01***: merged
branches are closed rather than kept, so the hash is the marker), so the tree
without any of this is one checkout away.

***The cut was taken deliberately rather than under pressure***, which is the
whole reason §5 named one: **the chain, the pipeline, the books, manual capture
and the toggles**, with the **automatic extractor deferred**. That version ships
the load-bearing part, the reuse and the configuration, and defers *"the one
component whose value nobody can currently evidence and whose failure mode §1.5
calls unforgivable."*

***And the cut removes two of the three criticals' subjects, which §3.2 says
first because it is the uncomfortable half.*** C2 (*a correction survives the next
extraction*) and C3 (*no spoiler bleed*) are both about the extractor. They travel
with it. **The phase therefore closes on C1 alone — and C1 is not walked**, so
this merges and stays open, which is [P7](23-p7-implementation.md)'s precedent and
[P7B](24-p7b-presets-and-prompts.md)'s: *a merge is not the close.*

The plan is the 2026-09-13 revisit below; what made it *ready* is §0.3, which
re-ran §0.1's audit against the tree after [P7B](24-p7b-presets-and-prompts.md)
landed twelve commits on it. **All ten of §0.1's findings still held**, so every
stage was sized against the code it met; four things P7B moved are recorded, one
of them a live defect the audit found in the editor P8.1 leans on. **P8.0 was
blocked by nothing and is where it opened.**

Revisited 2026-09-13 at `4700aef` — the revisit §0 was written to expect. Drafted
2026-08-29 alongside
[P7](23-p7-implementation.md), [P9](26-p9-implementation.md),
[P10](27-p10-implementation.md) and [P11](28-p11-implementation.md); to be
revisited before the phase starts. [P7 §0](23-p7-implementation.md) says what a
skeleton this far out is for, and it applies unchanged here. **§0 said
*everything else here waits on three phases rather than on time* — P5, P6 and
P7 — and warned that a revisit running before those landed would re-derive them
rather than plan. All three have landed**, so this is the revisit, and §0.1 is
the audit that turns the skeleton into a plan: §1.1 is settled, §1.3 is narrowed
to a procedure and its lean reversed, §1.7 turns out to have been decided
elsewhere, §2's stages carry end conditions and named proof obligations, and §3
is split under [manual testing §0](05-manual-testing.md)'s two-tier gate.

***The audit's headline, because it changes what the phase is.*** **This
document's claims audit clean and its mechanisms audit badly.** The storage fork
it worries about most is the cheap half; three things it assumes are free are
not — §1.5's *refuse at the source* is **not buildable through `reads` as the
step contract stands**, §1.6's *this needs no new machinery* is false on the lore
path, and the demo's *the workbench names the entry and its origin* is not
answerable from the record. Each is small and none is where the document was
looking. Format follows [P1](07-p1-implementation.md); citations follow the
corpus convention.

**P8 delivers**, from [work plan P8](01-work-plan.md), two features that share the word
*memory* and share one mechanism:

- **Cross-session memory as an auto-maintained lorebook**
  ([08](../08-cross-session-memory.md)) — designed, buildable, and smaller than
  it looks because a memory is a lorebook entry and every retrieval mechanism it
  needs shipped at P5.
- **Within-session summarisation as a rolling summary**
  ([26 E1](../26-open-questions.md)) — schedulable rather than needing its own
  design pass, with one constraint that must hold on the first commit.

**The demo that defines done:** *start a second session with the same actor and
persona; she refers to something that happened in the first, and the workbench
names the memory entry, its origin session and why it was retrieved. And the
same session, four hundred turns long, still assembles inside budget — because
the history above the window is a chain of summaries, each link keyed by the
hash of its inputs.*

**The constraint that is a review item rather than a detail.** The rolling
summary is an **immutable chain**, `summary(n) = f(summary(n-1), turns[a..b])`,
each link content-addressed ([07 §5.1](../07-branching.md)). The
mutate-one-record implementation is the obvious one, is indistinguishable from
the UI, and quietly breaks cheap branching — a fork would have to copy or
recompute what it should share. Nothing in the product surface will ever reveal
which was built, which is exactly why it belongs in the plan.

**What makes the phase safe:** summaries are derived and disposable, so a bad
summariser is a regeneration rather than lost history. That is the argument for
shipping a simple version here rather than designing a good one first.

*Corrected 2026-09-27.* ~~a bad summariser is a regeneration~~ only for somebody
who knows to ask for one. A link is served from its key from then on and handed
to the next link as `previous`, so a summary that ran into its length limit
mid-sentence was the story above the window for the rest of the session, and a
long session reaches that limit by design, since each link covers everything
before it. A filtered reply came back empty and removed the summary. Nothing
regenerated either until the binding changed or somebody deleted `summaries/`.
The step could not tell, because a call's result carried no word of how it
ended. It does now (`StepCallResult.outcome`), and a cut-off, refused or empty
reply is not kept, so the next turn asks again.

*Corrected again, the same day.* ~~since each link covers everything before
it~~ — it did, and it was not meant to. The collector puts every link in the
prompt as its own block, one stretch each (`SummaryLink.from` and `to`, and
the budgeter giving up the distant past first), and the prompt asked each link
for the whole story so far, so the prompt carried the story once per link and a
model that grew its links met the reply's limit a couple of hundred turns in,
after which none was ever written again. A link now summarises its own turns,
with the one before it handed over as context only; a link that cannot be
written leaves the held ones in the prompt instead of taking the chain with it;
the chain and the history window count the same story turns, so a channel write
takes a place in neither; and the preview reads the held chain. The prompt is in
the summariser's key, so every chain is derived once more in the new shape.

**CI this phase establishes:** the [testing §1](03-testing.md) invariant that has
been waiting for a producer — *summaries shared across a fork are byte-identical
to the parent's* — which is the chain constraint above expressed as a property
rather than a paragraph. Plus the second real consumer of *no advisory block ever
appears in an effect-producing call* (§1.6).

---

## 0. What this document is, five phases out

[P7 §0](23-p7-implementation.md) states the shared answer and it is not
restated here: collect the deferrals, name the decisions, hold the gate shape.
Two things are specific to this one.

**One claim in it is auditable today, and it audits clean.**
`Layout.memoriesRoot(handle)` exists (`storage/layout.ts:321`) and **nothing
calls it** — the directory is never created, which is what
[P2C §5](12-p2c-first-real-run.md) and [P2C brief](13-p2c-brief.md) both record so a
tester does not report it as a bug. §1.1 is written knowing that: the path
helper is a lean, not a commitment, and §1.1 ends with *whichever wins,
`memoriesRoot()` is either the answer or is deleted.* That is the right shape
for a five-phases-out document — a resolvable fork rather than a decision made
early and defended late.

**Everything else here waits on three phases rather than on time.** The rolling
summary must arrive as [07 §5.1](../07-branching.md)'s content-addressed chain,
which is P6's handoff and [P6 §4](18-p6-implementation.md) names as the thing
to re-read; memory books are lorebooks, so P5 owns the machinery this phase
*consumes* rather than builds; and §1.5's spoiler defence is explicitly a P7
dependency. A revisit that runs before those three have landed will re-derive
them rather than plan.

***All three have landed, and the warning worked*** (2026-09-13). P5 closed
2026-09-09, P6 merged 2026-09-02, and P7's buildable work finished 2026-09-13
with fifteen stages. §0.1 below is the audit this paragraph was asking for, run
against the tree rather than against the documents — which is the distinction
that made it worth waiting for, since three of its five sharpest findings are
about code that does not do what a document says it does.

---

### 0.1 Readiness — audited 2026-09-13 at `4700aef`

*[P7 §0.1](23-p7-implementation.md)'s shape, and it found the same class of thing
P7's did: **items routed here that are already done**, and assumptions that cost
more than the document prices. Checked against files rather than against prose,
with a line number on each so the next reader can see whether it has moved.*

#### What still holds

1. **`memoriesRoot` still dangles**, which is §1.1's whole premise and is intact.
   `packages/server/src/storage/layout.ts:360` — §0 above says `:321`, which is
   39 lines stale and is struck rather than silently corrected. Its only caller
   in the repository is `layout.test.ts:189`; no directory is ever created;
   [03 §5.1](../03-data-model.md) is the one line in the corpus that puts
   `memories/` beside `library/`.
2. **Nothing summarises anything.** No production symbol under `packages/`
   contains `summar` except `se.summary` — an *actor profile section* id — and
   `chat_summary`, the import marker §1.8 is about. There is no store, no chain,
   no key derivation. **P8.0 starts from nothing, which is the best state for a
   stage with a structural constraint to honour.**
3. **§1.5's four prerequisites all landed in P7, as forecast.** A hook's
   `premise` and its `entrances` are fields on the shipped schema, `introduces`
   is the third, and a channel's `visibility: 'player' | 'hidden'` is on
   `ChannelDefinition`. *"All four of those things arrive in P7"* is now a fact
   rather than a prediction, and §1.5's *must not be deferred past this phase*
   binds without an excuse.
4. **The `pN-gate` convention is intact**, and P7 added an idiom beside it.
   `routes/p2-gate.test.ts`, `p2-gate-storage.test.ts`, `p2-gate-guidance.test.ts`
   and `p6-gate.test.ts` are the precedent; P7 wrote **no** `p7-gate.test.ts` and
   used `tools/repo-shape.test.ts` plus per-claim named tests instead. Both are
   live. §2 below uses the gate file for claims that need a running server and
   named unit tests for the rest, and each stage says which.
5. ***The advisory invariant is already asserted over a committed record, and
   this document is wrong to imply otherwise.*** §1.6 says the property *"already
   carries"* the rule with guidance as its first consumer — true — and
   [P7 §0.1a](23-p7-implementation.md) recorded a residue that *"nothing asserts
   the invariant over a committed record"*. **That residue is discharged and
   predates P7**: `routes/p2-gate-guidance.test.ts` has *records the block as
   advisory and the committed call as prose — the invariant, on the record*, and
   `assembly/assemble.ts`'s `admit()` **throws** rather than filtering. So §1.6 is
   right that the invariant exists. It is wrong about what a second consumer
   costs — see finding 9.

#### What audits badly — five findings, by how much each moves the plan

6. ***The history window is a hard cut, and a summary has nowhere to go.***
   `turns/gather.ts:263` is `history.slice(-mode.definition.assembly.historyWindow)`,
   and both shipped modes declare `historyWindow: 20`. In a four-hundred-turn
   session **turns 1–380 reach nothing at all** — not a summary, not a
   `NotFilledSlot`, not a line in the record; the remainder is not carried
   anywhere. And **`SlotSource` has no summary arm** (fourteen arms, none of
   them) and **`BlockSource` has none either**. So P8.1's *"summaries as blocks
   with reasons, costed like anything else in the block table"* is **two union
   members on two published types**, one of them the stable-tier portable preset
   schema, before it is a feature. *This is also exactly where §1.8's
   `chat_summary` marker lands, which is the first time the two halves of that
   section have had the same subject.*
7. ***A step is handed the whole `Turn`, and §1.5 cannot be built through `reads`
   as the contract stands.*** This is the finding that most changes the phase.
   `StepInput.history` is `readonly Turn[]`, passed through unfiltered, and the
   runner hands a step the **full path** where the collector gets the windowed
   slice. A `Turn` carries `request.calls[].blocks[].text` — so **a hook's
   premise, a chosen entrance's finished prose and a hidden channel's rendered
   value are all inside the record the extractor is handed, verbatim.**
   [08 §6](../08-cross-session-memory.md)'s *refuse at the source rather than
   filtering later* is therefore **unbuildable today**, and filtering inside the
   extractor is the thing that section explicitly rejects. *A contract decision,
   not a prompt discipline*, and new to §1.5.
8. ***A book reaches a session only by being selected, and that is a rule rather
   than a state of the code.*** `turns/lore.ts` says so in as many words —
   *"Selection is the only route, and that is the rule rather than the current
   state of the code"* — and `LoreRoute` has exactly two members, `treatment` and
   `session`. `gather.ts` deliberately does not pass the cast to `resolveLore`:
   *"nothing about who is in the scene decides which books are in play."*
   **Cross-session memory is precisely a book that arrives on the strength of the
   cast.** [P5.7](17-p5-implementation.md) built scope-based volunteering and
   [P6B.1](20-p6b-playable.md) reversed it, so `LoreScope.linked` now decides
   nothing. **P8 needs a third `LoreRoute` with its own argument, not a field
   that volunteers** — reviving the field would re-introduce P5.7's failure with
   the same mechanism and a smaller blast radius.
9. ***Nothing on the lore path can be advisory, and a block cannot say which book
   it came from.*** `assembly/collect.ts` forces `advisory` for exactly two slot
   sources — `guidance` and `attempt` — and otherwise takes it from the preset
   block, so a lore candidate inherits the *positioning slot's* flag. Authored
   lore and a memory entry arriving through the same `{ of: 'lore' }` slot are
   indistinguishable to the firewall. Worse for the demo: `retrieval/blocks.ts`
   builds the candidate with `source: { kind: 'lore', entryId, phase }` — **no
   book id** — though `Activation` carries `bookId` and the whole book. The
   candidate's *id* is namespaced `lore.<bookId>.<entryId>`, which is a string
   convention and not a type. **So the header's demo — *the workbench names the
   memory entry, its origin session and why it was retrieved* — is not answerable
   from the record today**, and §1.6's *needs no new machinery* is false: the
   firewall exists and the route into it does not.
10. ***`acceptEffect` hard-codes `'session'`, and the abandonment banner has no
    client reader either.*** `turns/effects.ts:117`, and `sessions/store.ts` says
    so in its own docstring while naming this phase as the first producer: *"the
    alternative is P8 shipping a producer with nowhere for it to surface."* The
    count reaches the wire on the branching route — and `client/src/api.ts`
    **types the field away**, declaring `moveHead`'s return as
    `{ session: SessionSummary }`. No component reads it. [P6 §1.5] scoped the
    remainder as *"a writer plus the abandonment banner"*; **P8 inherits both
    halves rather than one.**

#### Three affordances already leaning this way, none with a reader

*Worth naming because each is a `memoriesRoot` in miniature — a field written in
anticipation of this phase — and the phase should either use it or say why not.*

- **`Provenance.source` includes `'session'`** and nothing writes it. It is the
  natural book-level marking, and §1.1's answer makes it the right one (§1.9).
- **`LoreEntry.locked`** — *"locked against automatic modification by agents"* —
  has no reader anywhere. It is exactly the field a hand-corrected memory needs
  against the next extraction pass, and it makes gate step 6's second clause
  answerable.
- **`LoreEntry.metadata`** is an open record and is the only place a per-entry
  origin ref and timestamp can go **without opening a schema field** — which
  matters, because [11 §4](../11-lorebooks-as-a-format.md) refuses new lorebook
  fields by name.

#### Two costs this document does not price

- **Every extraction is a whole-book rewrite plus a history version.**
  `Lorebook.entries` is one array in one file, and `VersionSource` has six kinds,
  none of them an extraction — so an automatic write records as
  `{ kind: 'manual' }`. A book written ten times in a session accrues ten
  versions indistinguishable from ten hand edits. §1.1 lists *history on write*
  as a benefit of its first option; it is a **cost** under that option and under
  the second.
- **[11 §4.1](../11-lorebooks-as-a-format.md) routed a fourth obligation here
  that this document does not contain** — the non-shareable marking as a
  *schema* question with a standing refusal in front of it. §1.9 collects it.

---

### 0.2 What must be true before the phase opens — and what need not be

*[P7 §0.2](23-p7-implementation.md)'s shape. The point is to separate what the
phase is genuinely blocked on from what merely has not happened, because a plan
that lists both as blockers is a plan that never starts.*

**Nothing blocks P8.0, and that is the argument for it being first.** The chain
is pure engine, depends on no unlanded phase, and its property test synthesises
its own four-hundred-turn tree. *It is the only stage in this phase of which that
is true*, which is a second reason to open on it beyond §2's.

**PLAYABLE blocks P8.3 and nothing earlier.** §5 says cadence *"needs PLAYABLE's
turn volumes plus P5's retriever budget"*, and
[manual testing](05-manual-testing.md) names this phase's cadence sizing among
the things **sitting G**, the long pass, unblocks. Neither sitting G nor
[sitting K](05-manual-testing.md) has been walked — K is also what P7's three
criticals wait on ~~.~~ **and, since 2026-09-15, what
[sitting M](05-manual-testing.md)'s five rows want too** (§0.3): P7B merged with
its critical list unwalked, so **three phases now hold open on one sitting**.
*That sharpens this paragraph rather than changing it.* **So the phase can open,
build the chain, put it in the pipeline and create the books before anything is
measured**, and §1.3 is written as a procedure for that reason rather than as a
decision made without evidence.

**What does *not* block, stated so it is not treated as if it did.** The
extraction *quality* question, which is a tuning matter
[work plan P11](01-work-plan.md) owns for every other feature and owns for this
one. The granularity question (§1.2), whose constraint is the part to hold and
whose answer wants volume. And [26 E2](../26-open-questions.md)'s embeddings,
which this document is the first real customer for and which are not scheduled by
saying so.

**One thing that would block and does not exist yet: a four-hundred-turn session
anybody has played.** `tools/seed.mjs` writes a treatment, a lorebook and a
session and **no turns at all**. A synthesised tree built through `appendTurn` is
available today and is what §3's AUTO rows use — and it tests **the chain, not
the summary**. That distinction is load-bearing and §3.1 carries it: scripted
output can prove that keys are shared and bytes identical; it cannot prove a
summary of four hundred real turns is worth reading.

---

### 0.3 Ready to start — re-audited 2026-09-15 at `3287d67`

*§0.1 ran at `4700aef`, **before [P7B](24-p7b-presets-and-prompts.md) existed**.
Twelve commits, a merge and a renumber have landed since, so the audit is run
again rather than assumed — which is the same discipline §0 applied to waiting
for P5, P6 and P7, at a smaller scale.*

#### What still holds — all ten of §0.1's findings, and saying so is the result

**Re-checked line by line, and not one of them has moved.** `memoriesRoot` still
dangles at `storage/layout.ts:360` with `layout.test.ts` as its only caller; the
history window is still the hard cut at `turns/gather.ts:263`; `acceptEffect`
still hard-codes `scope: 'session'` at `turns/effects.ts:117`; `StepInput.history`
is still `readonly Turn[]` (`sdk/src/steps.ts:268`); `SlotSource` and
`BlockSource` still have **no summary arm**; `assembly/collect.ts` still forces
advisory for exactly `guidance` and `attempt`; `retrieval/blocks.ts` still builds
a lore candidate with **no book id**; `provenance.source` still has no writer but
`import/identity.ts`'s; `LoreEntry.locked` still has **no reader anywhere**; and
`client/src/api.ts` still declares `moveHead`'s return as
`{ session: SessionSummary }`, typing the abandoned-effect count away.

***An audit re-run that confirms is a result rather than a formality.*** It means
none of the five things §0.1 called *audits badly* was quietly repaired by a
phase that was not looking at them — so **every one of them is still P8's**, and
the stages that own them in §2 are sized correctly rather than optimistically.

#### What P7B moved — four items, and one of them is a defect this audit found

1. ***The preset editor exists, and P8.1's deferral becomes a no-op.*** That
   stage's *Deliberately not built* says *"there is no preset editor in the
   client at all, which [P7.14](23-p7-implementation.md) flagged for P11"*.
   [P7B.1](24-p7b-presets-and-prompts.md) built one, and it renders **the
   schema's shape**: `SchemaFields` reads a preset's non-block fields out of the
   emitted artefact, and a slot block is rendered from `source.of` read openly
   rather than matched against a list. **So `{ of: 'summary' }` arrives editable
   with no client edit at all**, which is a better outcome than the clause
   assumed and costs P8.1 nothing.

   ***And this audit is what found that it did not work.*** The editor asked
   `typeof source['kind'] === 'string'`, and `source.kind` is a field **no preset
   has ever carried** — [04 §8.1](../04-schemas.md) puts the discriminator on the
   block and the arm on `source.of`. Every slot in every shipped pack rendered as
   a *text* block with an empty template box and no **Outlet** control, which
   makes P7B.1's claim to have retired
   [P5 §3](17-p5-implementation.md)'s defect false against every file on disk.
   Fixed at `3287d67`, with the fixture that hid it replaced by one the shipped
   validator accepts. *Named here rather than only in the commit, because the
   readiness audit finding a live defect in the thing the next stage builds on is
   exactly what the audit is for.*
2. ***P8.4's settings surface exists, and the stage inherits its debt.***
   [08 §7](../08-cross-session-memory.md) asks for *per session, in settings* —
   two switches, the tri-state list, a link to the book — and
   `play/SessionPanel.tsx` ([P7B.2](24-p7b-presets-and-prompts.md)) is that
   place. **P8.4 therefore adds sections to a panel rather than building one.**
   What travels with it is the debt that panel records in its own docstring: the
   play column carried six panels before P7B.2 added a seventh, and
   [P7B §1.4](24-p7b-presets-and-prompts.md)'s *one Session panel, not three* is
   further from done than when it was written. **P8.4 makes it eight**, and a
   stage that adds one without saying so is how a column becomes a list.
3. ***Every stage that adds a route now has a build-time obligation.***
   `packages/server/src/routes/route-callers.test.ts`
   ([P7B.5](24-p7b-presets-and-prompts.md)) walks Fastify's route table against
   the client's source and **fails on a route with neither a caller nor a written
   exemption**. P8.4's `SessionMemoryConfig` is a route and P8.2's book creation
   may be one, so [work plan §2.3](01-work-plan.md)'s standing line — *no phase
   exits with configuration that has no surface* — stops being a checklist item
   read at the gate and becomes a test that fails on the commit. §3.1's
   standing-line row carries it.
4. ***The blocking picture gains a third phase and the conclusion does not
   change.*** §0.2 says *"neither sitting G nor sitting K has been walked — K is
   also what P7's three criticals wait on."* **Sitting M**
   ([manual testing §4](05-manual-testing.md)) is now there too: P7B merged
   2026-09-15 with four criticals and a judgement sitting unwalked, and every one
   of its rows wants the live endpoint K1 stands up. So **three phases hold open
   on one sitting**, which sharpens §0.2's argument rather than altering it —
   **P8.0 is blocked by none of it**, and is still the only stage in this phase of
   which that is true.

#### What this section deliberately does not do

**It does not re-decide anything.** §1's decisions were made at the revisit
against a tree that, on every point they turn on, is the tree that exists today —
finding 1 above is the only place where the code moved under a stage, and it
moved in the stage's favour. **§5's fallback cut stands unchanged**: chain,
pipeline, books, manual capture and the toggles, with the automatic extractor
deferred, remains the right thing to cut under pressure and nothing since
2026-09-13 bears on it.

---
## 1. Decisions this plan has to make

### 1.1 Where memory books live — the phase's one storage decision

**And it is invisible from [08](../08-cross-session-memory.md), which is why it
is first.** The user layout ([03 §5](../03-data-model.md)) puts `memories/`
**beside** `library/`, not inside it, and `Layout.memoriesRoot()` has existed
since P1 with no caller and no directory ever created — recorded as P8's in
[P2C §5](12-p2c-first-real-run.md) and again in
[P2C brief §3.3](13-p2c-brief.md). The index's rebuild walks
`kindRoot(owner, schemaId)` under `library/` and nothing else, so a book under
`memories/` is **unindexed, unsearchable and unaddressable** — while
[08 §7](../08-cross-session-memory.md) asks for *a link to the memory book
itself, opening the ordinary lorebook editor*, which needs a library address.

Three ways out, and the phase must pick one before anything is extracted:

- **Memory books are library lorebooks**, in `library/lorebooks/`, marked as
  auto-maintained. Everything works for free — index, search, editor, the
  Lorebooks panel P5 built, history on write. The cost is that a derived,
  personal, often-embarrassing book sits in the shelf beside authored ones, and
  [08 §2](../08-cross-session-memory.md)'s *must not be treated as authored
  content* becomes a marking rather than a location. **Lean.**
- **`memories/` becomes a second indexed root**, with its own ingest branch. The
  separation is honest and the cost is real: the ingest path grows a second
  shape, and [P5 §1.7](17-p5-implementation.md)'s warning about delete sites
  applies again.
- **Books in `memories/`, unindexed**, with a bespoke reader. Rejected on sight —
  it is a second representation of a lorebook, which is
  [00 §2.8](../00-stance.md).

Whichever wins, `memoriesRoot()` is either the answer or is deleted. A path
helper that survives the phase without a caller is the same defect twice.

#### Decided 2026-09-13: the first option, and `memoriesRoot()` is deleted

**The lean survives and its argument does not**, which is the more useful half.

***The stated cost of the second option is understated.*** §1.1 prices it as
*"the ingest path grows a second shape"*. Against the code it is bigger:
`Layout.parseObjectPath` hard-codes `library` as the third path segment and
returns a three-part address; the index rebuild walks *owners × library
directories* and nothing else; the ingest row carries `owner/schemaId/slug` as
the identity that tombstone-and-match and the duplicate-id rule turn on; and
`rebuild-property.test.ts` holds *rebuild equals incremental* over exactly that
shape. **A second root is a fourth axis on the object address**, threaded through
the parser, the rebuild, the watcher's routing, the object table's keys and the
sixteen id-addressed library routes. That is a change to the index's primary
identity rather than a branch in an ingest path.

***And the decisive argument is neither of the two the section makes.*** §0.1's
finding 8 establishes that a book reaches a session by being **found**, not by
being pointed at — so the memory resolver has to answer *"the memory book for
`(handle, actorId, personaId)`"* as a **query**. The first option makes that a
query against a table that already holds every lorebook. The second makes it a
query against a second table. The third makes it a directory read. **The resolver
wants a query, and only one option already has one.** That reason survives the
discovery that three of the *"everything works for free"* things are not free.

**What it actually costs, priced rather than waved at:**

| Cost | What it really is |
|---|---|
| Derived books on the Lorebooks shelf | **One filter row and one badge.** The panel already carries three filters and a badge strip, and [11 §4.1](../11-lorebooks-as-a-format.md) predicted this problem and named the tag filter as its mitigation — **which shipped**. The mitigation is in place before the problem arrives |
| *"Must not be treated as authored content"* becomes a marking | **`Provenance.source: 'session'`, which exists and has no writer** (§0.1's affordances). A field with a reader rather than a new field — see §1.9 |
| A history version per extraction | A seventh `VersionSource` kind and a retention posture. Real, unpriced above, an afternoon |
| The ordinary editor reaching it | **Free**, which is what [08 §7](../08-cross-session-memory.md) asks for and what the other two options buy back expensively |

**`memoriesRoot()` is deleted and [03 §5.1](../03-data-model.md)'s line is struck
with a dated note**, which is what the paragraph above commits to. *A repo-shape
assertion goes with it* — otherwise *"either the answer or is deleted"* is
enforced by nobody, and [P7](23-p7-implementation.md)'s gate step 1 is the worked
example of a deliverable nothing noticed.

### 1.2 Book granularity, decided knowing a fourth key is coming

[08 §8](../08-cross-session-memory.md) leaves open whether memory is *per
(actor × persona) as separate books* or *one book per actor with per-entry
persona tags and filtered retrieval* — fewer objects against more query
complexity. The section also names the thing that should decide it: **a fourth
scope key already has a name.** Narrator-level memory is a World
([15](../15-world.md)), and the bearing on 1.0 is narrow but real —
**nothing may hard-code the three-tuple into how books are keyed and named on
disk.**

That constraint is cheap under either answer and is the part to hold; the
granularity itself can be decided on volume once PLAYABLE and P5 have produced
real sessions.

### 1.3 Extraction cadence, and whether it is one pass or two

[08 §8](../08-cross-session-memory.md)'s first open question, and it is a cost
question: session end is obvious, periodic extraction during long sessions is
better, and both cost calls. **The sharper form of the question is whether
extraction reuses the summarisation pass** — which is in this phase, reads the
same turns, and is already paying for a `fast`-role call.

~~**Lean: one pass, two outputs**, with the summariser's step emitting memory
candidates alongside the summary link. Two passes over the same window is the
implementation nobody would choose deliberately. Confirm on revisit — the risk
is that one prompt doing two jobs does both worse, and that is measurable rather
than arguable.~~

#### Revisited 2026-09-13: the lean is reversed, and what is left is a procedure

***One step cannot do both, whatever the cost answer turns out to be*** — which
the lean did not know and which settles the *shape* without waiting for a
measurement.

- **The purpose derivation forbids it.** `callPurposeFor` derives a call's
  purpose from the step's own declaration: `contributes === 'messages' && writes
  is empty` yields `prose`, everything else `effects`. A summariser contributes
  neither messages nor channel writes; an extractor writes — an escaped effect,
  §1.9. They are two purposes, and a step declaring both is a step the derivation
  has no honest answer for.
- **§0.1's finding 7 forbids it more sharply.** The two want **different
  payloads**: the summariser is entitled to the record, and the extractor must
  not be. One step declaring both is a step entitled to the record that then
  writes to the library — *which is §1.5's failure with the defence
  architecturally removed.* **That is the reason, and it is not a cost
  argument.**

**What can be shared is the call, not the step.** A `fast`-role call whose
structured output carries two fields — a summary link and a candidate list — is
one model call two steps read. The engine already speaks structured output and
the block on that path is correctly non-advisory.

**So the procedure, written as one rather than as a lean.** Build two steps
sharing nothing (P8.1 and P8.3) and leave the call unshared. Instrument the
summariser's call count and token spend per hundred turns from the first stage.
***The measurement that decides is not turn volume — it is the ratio of
extraction calls to narration calls at the cadence the summariser already
needs.*** If extraction runs at the summariser's cadence, the second call is a
fixed fraction of a turn's cost and a shared prompt doing two jobs worse is not
worth it. If extraction wants a cadence the summariser does not, the question
answers itself the other way and nothing built has to be undone. **PLAYABLE
supplies one number and it is the denominator, not the question** — which is why
§0.2 does not block the phase on it.

### 1.4 Extract facts, not summaries — and it is not a style note

[08 §2.1](../08-cross-session-memory.md): five memories are five things that can
be retrieved independently, attributed separately, and deleted individually when
one turns out to be wrong. A single blob has one relevance score and one delete
button. The distinction survives into the schema — each entry carries a ref to
its origin session and a timestamp — and it is what makes the budgeter's
existing trim order do useful work at volume.

### 1.5 Spoiler bleed is the sharp failure, and its defence is a P7 dependency

[08 §6](../08-cross-session-memory.md) names it as the failure most likely to
make someone switch the whole feature off, and the mitigation is *refuse at the
source*: **never extract from hidden content** — a hook's premise, an unfired
hook's entrances ([04 §6.1a](../04-schemas.md)), a hidden channel, GM-only state.
Filtering later is not equivalent, because the extraction has already written the
sentence down.

**All four of those things arrive in [P7](23-p7-implementation.md).** So this
defence cannot be built before P7 and must not be deferred past this phase — an
extractor that ships without it is an extractor that has to be re-run over its
own output later. The cheaper mitigation, warning at session creation when a new
session's treatment or package matches an existing one, is independent and lands
here too.

*And the reason entrances are worse than premises, worth keeping in view while
implementing:* an entrance is not a summary of an arrival, it is the finished
prose of one — a bleed reproduces the exact words a second playthrough was
supposed to reach freshly.

#### The defence is not buildable through `reads` today — 2026-09-13

***This is §0.1's finding 7 and it is the most consequential thing the audit
turned up***, because the section above assumes the defence is a matter of what
the extractor is told and it is a matter of what the extractor is **handed**.

`StepInput.history` is `readonly Turn[]`, unfiltered, and the runner gives a step
the **full path** where the collector gets the windowed slice. A `Turn` carries
`request.calls[].blocks[].text`. **So a hook's premise, a chosen entrance's
finished prose and a hidden channel's rendered value all arrive inside the record
the extractor declared `history` to get** — verbatim, before any prompt is
written. *Refusing at the source is not expressible*, and filtering inside the
extractor is exactly what [08 §6](../08-cross-session-memory.md) rejects.

**So the defence is a contract change and it lands at P8.1, not at P8.5.** A
third pseudo-source — `transcript` — handing `{ input, output }` pairs and
nothing else, filtered by `reads` the way `cast` is
([P7.12](23-p7-implementation.md)). ***Built in the stage that creates the
payload rather than the stage that needs it***, for the reason `turns/steps.ts`
gives about its own filter: a payload narrowed *after* a consumer exists is a
payload narrowed by subtraction, and nobody can then say which fields were
load-bearing.

*What is left for P8.5 is the remainder rather than the whole*: an entrance that
fired is reproducible prose sitting in the narrator's own **output**, which
`transcript` legitimately carries. That is the case this section's parenthesis is
about, and it wants a refusal with a reason rather than a filter — extraction
declines a turn whose record shows an entrance block, and says so.

### 1.6 Memories are advisory, and the invariant already exists

[08 §5](../08-cross-session-memory.md), same boundary as the guidance box. A
memory saying Vera trusted you must not *set* a trust channel, or a new session
silently inherits state from one the player may not remember. Memory blocks are
`advisory: true` and inadmissible to evaluation steps, rule conditions and
engine-computed updates.

~~The good news is that this needs no new machinery: [testing §1](03-testing.md)
already carries *no advisory block ever appears in an effect-producing call* as
a property, with guidance as its first consumer. This phase gives it a second,
and a second consumer is what turns a property test into a general rule.~~

***Half right, and the wrong half is the expensive one*** (2026-09-13, §0.1's
finding 9). The **property** needs no new machinery — it exists, `admit()`
throws rather than filtering, and it is already asserted over a *committed
record*, which [P7 §0.1a](23-p7-implementation.md) listed as a residue and which
turns out to predate P7. That much is better than this section claimed.

**What does not exist is the route into it.** `assembly/collect.ts` forces
`advisory` for exactly two slot sources — `guidance` and `attempt` — and
otherwise inherits the *positioning slot's* flag, so a memory entry and an
authored lore entry arriving through the same `{ of: 'lore' }` slot are
indistinguishable to the firewall. **Nothing on the lore path can be advisory at
all.** And `retrieval/blocks.ts` builds the candidate with no **book id**, though
the activation carries one — so even the demo's *the workbench names the entry
and its origin* is unanswerable from the record.

So the second consumer costs three small things, all at P8.4 with the retrieval
path: a `bookId` on the lore block source, the book's `provenance.source` carried
onto the candidate, and a **third arm on the advisory union** — *a candidate from
a derived book is advisory whatever the positioning slot says*, by the identical
argument that forces it for guidance and attempt. *The claim that a second
consumer turns a property test into a general rule is still right; it is simply
not free, and the price is the thing worth having.*

### 1.7 What happens when an origin session is deleted

[08 §8](../08-cross-session-memory.md)'s second open question. Keeping the
memories orphans the attribution; deleting them loses history the user may
value. ~~The document's own lean — ask, defaulting to keep with the origin marked
as deleted — is probably right and interacts with P11's trash retention, since a
deleted session is a moved folder rather than an erasure
([03 §10.2](../03-data-model.md)) until the window closes.~~

#### Not an open question — two documents disagreeing, 2026-09-13

***[03 §10.3](../03-data-model.md) decided this and [08 §8] does not know.***
Under *What deletion does not do*: **"it does not reach into other sessions to
remove what this one wrote. A session that promoted an actor to the library, or
wrote a cross-session memory, leaves those behind — and the delete confirmation
should say so when it applies."** Not *ask* — **tell**. And
`sessions/store.ts`'s `deleteSession` already implements it, naming the case in
its docstring: *"an actor this session promoted to the library, or a
cross-session memory it wrote, stays."*

***And the premise the lean rests on argues against the lean.*** This section
says the answer *interacts with* P11's trash retention because a delete is a
move. That interaction is the reason **not** to ask: nothing is gone. A modal
asking somebody to decide the fate of forty memory entries at the moment they
tidy up a session is a decision demanded about a **reversible** act — and
[03 §10.2](../03-data-model.md)'s purge is where an irreversible answer belongs
if anywhere. **Retention is P11's, and so is the only moment the question is
real.**

So this resolves to three small things and no dialogue:

1. **Memories stay.** Already true; the work is the test that pins it.
2. **The origin reads as deleted rather than dangling.** Deleting a session drops
   its index rows, so the workbench's *origin session* link resolves to nothing.
   A missing origin renders as *from a deleted session*, the posture
   [00 §3.3](../00-stance.md) sets and the one `turns/lore.ts`'s `MissingLink`
   already takes. ***Not a field — a rendering of an absence***, which also
   survives a restore from trash for free, where a written marking would become a
   lie the moment the folder came back.
3. **The delete confirmation gains the sentence [03 §10.3] asks for**, which is
   the only new surface in the item.

### 1.8 What import left here, and the one thing it deliberately did not take

**Added 2026-08-30**, discharging §0's collecting job for the one document that
had sent something here without this one knowing: this skeleton and
[P4](16-p4-implementation.md)'s amendment were written the same day on
different branches.

**Deferred here, and it is small:** Marinara's prompt sections carry a
`chat_summary` marker among their ten marker types
([P4 §1.5](16-p4-implementation.md)). Nine of the ten map onto our slot sources
or are refused outright; this one has no home until the summary chain exists,
so an imported Marinara preset carrying it lands with that block recorded under
*not yet importable* and the review naming this phase. **What the revisit owes
is one line rather than a stage:** when the chain exists, the marker becomes a
slot source and the block converts — or it does not, and the review's answer
stops being "not yet" and becomes "not converted". Either is fine; leaving it
saying "not yet" after this phase ships is not.

**Deliberately not taken, and worth knowing before this phase designs
extraction:** every source's accumulated memory is *skipped* by P4 rather than
deferred — Marinara's `memory_chunks` table and its `long-term-memory/`
directory are embeddings and derived state, refused under
[00 §2.8](../00-stance.md). That is the right call for P4 and it has a
consequence for this phase worth stating plainly: **an imported library arrives
with no memories, ever**, so the memory books this phase builds are always
grown from play here rather than inherited. The alternative — importing another
engine's extracted facts — would mean adopting its extraction judgement
wholesale, which is the one thing §1.4's *extract facts, not summaries*
position is unwilling to do sight-unseen.

### 1.9 Four obligations other documents routed here, collected

*Added 2026-09-13. §0 says a skeleton's job is to **collect** what other phases
send it, and this document collected two (§1.2's keying constraint and §1.8's
import marker) and missed four. Two arrive from the phase immediately before it,
one from the phase after, and one from a design note — and the last three are
each one paragraph rather than a stage.*

#### The chain is two-level, and the summariser's identity is in the key

[P6 §0.2](18-p6-implementation.md) re-read [07 §5.1](../07-branching.md) against
this document and found the handoff is **three-party rather than two**:
[13](../13-write-mode.md)'s node summaries ride the same machinery, and what P6
hands forward is *"content-addressed, two-level, and with the summariser's
identity in the key — not simply a chain"*, **which neither 07 §5.1 nor this
document states.** The header's formula is the flat form:

```
summary(n) = f( summary(n-1), turns[a..b] )     ← one level; prose at every link
unit(t)    = f_unit( content(t) )               ← two: keyed by content, not by id
link(n)    = f_link( key(link(n-1)), [key(unit_a) … key(unit_b)] )
key(x)     = H( SUMMARISER ‖ x's declared inputs )
```

Three consequences, none of them in this document today:

- **A unit is keyed by its content, never by its turn id.** In Play a rewrite
  makes a *sibling node* with a new id, so ids happen to work and the difference
  is invisible — *which is exactly why building it wrong here is cheap and
  discovering it in Write is not*. In Write a node is edited in place and keeps
  its id, so an id-keyed unit is a stale cache that never misses.
- **A link is keyed by the sequence of unit keys, never by prose.** This is the
  whole reason for two levels: in Play a fork invalidates one link, and in Write
  dragging a chapter invalidates every link after it — recomputed from unit keys
  that is a cheap re-summarise over summaries, and recomputed from prose it is
  the full pass again.
- **`SUMMARISER` is the *resolved* binding, not the declared role.**
  [07 §5](../07-branching.md) says *"plus the summariser prompt, model and
  parameters"* and §5.1 drops it when it restates the formula, which is how both
  documents came to miss it. Resolved, because a session's `stepRoles` mean the
  same declared role reaches different models in different sessions.

***And the property test this phase's header promises depends on it.***
*Summaries shared across a fork are byte-identical to the parent's* is trivially
true of a cache keyed on too little. It is a real assertion only with its
converse beside it — **the same turns under a different summariser produce a
different key** — and without the identity in the key that arm cannot be written.
[testing §1](03-testing.md)'s row would be satisfiable by a bug.

#### Memory extraction is the first escaped effect

[P6 §0.2](18-p6-implementation.md) again: *"a memory extracted on a line somebody
then abandons is the case the abandonment banner exists for. **Neither P8 nor 08
contains the word.**"* Correct, and §1.1's answer is what makes it true: under
the option taken there, every extraction is exactly the *"lorebook entry promoted
to the shared library"* [07 §7](../07-branching.md) classifies as escaped. *Under
the second option the question would genuinely have reopened, which is an
argument for the first worth having deliberately — it puts memory writes inside
the one mechanism this project has for admitting that branching cannot un-write
things.*

Four concrete pieces, and §0.1's finding 10 is most of the evidence:

1. **A channel for the write**, because a proposal requires a `channelId`.
   `se.memory.written`, book-scoped, appending the entry ids written this turn.
   **Never replayed** — the four readers that skip escaped effects already exist,
   so this adds nothing to any of them.
2. **Stop hard-coding `'session'`** in `acceptEffect`. The scope comes from the
   declaration, and the change belongs at **P8.2 with the channel** rather than
   at P8.3 with the writer.
3. **Build the banner, both halves.** The count is already on the wire and the
   client types it away; nothing renders it. [07 §7] calls it *"a small honesty
   feature that avoids a confusing class of bug reports"* — and the report it
   avoids is *"I abandoned that line and Vera still remembers it"*, which is this
   phase's rather than P6's.
4. **Say the sentence**, in §1.6 or here, because it is the one place these two
   features touch and neither document noticed.

#### The notification classes P10 will come looking for

[P10 §1.4](27-p10-implementation.md)'s rule is that every class has a producer or
is not shipped, and its §5 names the inverse risk — *"P7, P8 and P9 each
producing something notification-worthy and no class existing for it"* — with the
plan to re-read these three gates before writing the router. So, answered here:

- **Extraction produces nothing notification-worthy**, and that is an answer
  rather than an omission: it runs behind a turn the user is already watching,
  and [09 §3.5](../09-server-multiuser-deployment.md) dropped `agent-note` for
  exactly this case — *"a step produced something notable… is a progress event
  and belongs in the session view."*
- **Summary regeneration over a long session is `artifact.ready`'s shape, and
  this phase is its second producer.** 09 §3.5 argues that class is *"about
  asynchronous work attached to a turn finishing"* and named it generically so a
  second instance would not need a rename. **Claim it; do not invent
  `summary.ready`.**
- **The one new thing is a `system.notice`** — *memory extraction failed
  repeatedly and is now off for this session* — which is admin-facing,
  actionable, and the same shape as 09 §3.5's *an extension disabled after
  repeated crashes*.

#### The non-shareable marking is a schema question with a refusal in front of it

[11 §4.1](../11-lorebooks-as-a-format.md) routed this here in as many words: *"no
field carries that today. **This is the one place a field may genuinely be
needed, and it is not this document's to open — it belongs to the phase that
builds memory.**"* §P8.2 says the marking *"lands with the book, not after it"*
and never says it is a field opening against a standing refusal: [11 §4] refuses
new lorebook fields by name, with a documented override and a test any next field
must pass — *does it have a reader on the day it lands, and is it a fact about
the book rather than about how you like the book?*

**§1.1's answer makes a better move available than a new field, and it should be
argued rather than assumed.** `Provenance.source` already includes `'session'`,
already travels with every portable object, and **has no writer anywhere**. A
memory book is `provenance.source === 'session'`. That has a reader on the day it
lands (the shelf badge, the export warning, the third `LoreRoute`), is a fact
about the book rather than a preference, and **adds nothing to 11 §4's count**.

*The residue is honest and small.* **Non-shareable and derived-from-a-session are
not the same claim**, and reading the second as the first is an inference.
State it as one and defend it: an imported book is `'import'`, a generated one
`'generated'`, and `'session'` is the only member meaning *this account's play
produced it* — which is exactly the population that must not leave without a
warning. **If the inference is refused, the field opens under 11 §4's override
procedure and the override is recorded there**, as `writingSamples`' was. Either
way this phase closes 11 §4.1's fourth bullet rather than leaving it pointing
here.

---

## 2. Stages

Summarisation first, and not for scheduling reasons: it is the half with a
structural constraint (§1.1's sibling, the chain) and the half memory extraction
probably rides on (§1.3). Building memory first means building the extractor
twice.

***The dependencies inside that order, written down 2026-09-13 because the
paragraph above asserts one principle and no dependencies, and five of them are
real.*** ([P7 §2](23-p7-implementation.md) needed the same amendment for the same
reason.)

- **P8.1 must precede P8.3, and not for the obvious reason.** P8.1 is where
  §1.5's payload question is settled, and P8.3's extractor is the step that needs
  the narrowed payload. **A P8.3 that opens first writes an extractor against
  `history: readonly Turn[]` and ships §1.5's failure with the defence
  architecturally unavailable.**
- **P8.2 must precede P8.3** — trivially, a writer needs a book; and
  non-trivially, the escaped-effect **channel declaration** belongs with the book
  rather than with the writer (§1.9).
- **P8.2 depends on P8.4's `intake` for its third `LoreRoute` to be
  answerable**, which is the one inversion in the list. *Resolved by splitting
  rather than reordering*: P8.2 ships the route and its reporting with `intake`
  defaulted on and no association list, and P8.4 fills the predicate. **The
  reporting ships first deliberately**, so [P5.8](17-p5-implementation.md)'s
  keyword tester never has to answer *why is this book being scanned* with a
  blank.
- **P8.5 depends on P8.3**, and on nothing in P7 that has not landed (§0.1's
  finding 3).
- **P8.0 depends on nothing**, which is the second argument for it being first
  and which §0.2 makes the scheduling case from.

### P8.0 — The rolling summary as an immutable chain

The window policy, the chain, content addressing by the hash of inputs, and the
fork-identity property test green before any UI exists. Pure engine, and the
stage where the review item in the header is either honoured or lost.

**What that means concretely, after §1.9** (2026-09-13): the **two-level**
derivation with the summariser's *resolved* identity in the key, and a
content-addressed store at `sessions/<id>/summaries/<key>.json` built to
`sessions/snapshots.ts`'s posture — one file per key, atomic write, best-effort,
and **every read failure is a miss**. *A derived store that can fail a read path
is a session that cannot be opened*, which is why the posture is copied rather
than reinvented.

***And the shared-prefix property is true by construction rather than by
care***, which is worth knowing before building it: a fork is a sibling inside
the **same session directory**, so two lines resolve the same key to the same
file. Nothing has to copy anything, and nothing has to decide not to.

*Deliberately not built.* **No slot source, no block source, no prompt
participation** — the chain is computed and stored and reaches nothing. That is
what makes the property test honest: a chain already in a prompt is one whose
byte-identity can be confused with a prompt that happens to match. No
summaries-of-summaries, because [07 §5](../07-branching.md) says content
addressing handles them *"without special cases"* and that is a claim to inherit
rather than to exercise on the first commit. No eviction — a summary is small,
and [26 C8](../26-open-questions.md)'s *generous during alpha* is the standing
posture for this class of derived file.

*Ends at:* ~~forking a four-hundred-turn session and observing that the parent's
summary links are **shared, not copied** — asserted, not eyeballed.~~ a
**synthesised** four-hundred-turn tree, forked at turn 300, where the two lines
resolve the same key set over the shared prefix and the shared files are
byte-identical — **and its converse, that the same turns under a different
summariser produce a different key.** *Synthesised is the honest word (§0.2):
nothing in this project has ever played four hundred turns, and a scripted tree
proves the chain rather than the summary.*

*Proof obligation:* `packages/server/src/sessions/summary-chain-property.test.ts`
— *the shared prefix is shared, and the summariser is in the key* — modelled on
`sessions/reconstruct-property.test.ts` over randomly-shaped trees. **This is
[testing §1](03-testing.md)'s waiting row getting its first producer, and the
phase's CI claim.** The falsifying mutation is dropping the summariser from the
key: the first arm still passes and the second fails, which is why the pair
exists.


#### Done — 2026-09-16, `fca1d2c`

***A content-addressed file may not carry a timestamp, and finding that out cost
one field.*** `sessions/snapshots.ts`'s posture was copied whole and then minus
one: a snapshot is named by the node it is the state *at*, so two writes of the
same node are two legitimate files and knowing which is newer is worth a
`createdAt`. A summary is named by the hash of its inputs, and a timestamp inside
it would mean **one key can hold two byte sequences** — which is precisely the
equality §3.1's row 3 promises, that regeneration is byte-identical rather than
merely equivalent. The field would have quietly turned that row back into a
judgement. The filesystem's mtime answers *when*.

***The in-progress link freezes for free***, arrived at rather than arranged for.
Nothing marks a link complete inside its key, so when a growing link's unit list
reaches a full span it is already the list the complete link would have had — and
**the key it arrives at is the key it would have been given**. Folding
completeness into the key would have derived every link twice and nothing would
have said so.

***"Shared" is not "below the fork", and the property found it rather than the
plan.*** The window truncates whichever link is last on each line, so a line that
has barely outgrown its window holds a **partial** link over indices a longer
line covers in full: same indices, different unit lists, different keys —
correctly so. **Sharing is a property of the inputs a link declares, not of where
its turns sit.** The first oracle said otherwise and went red on the twelfth
generated case.

**The sharpest form of the claim is a file count.** Nineteen links on one line
plus seventeen on the other is thirty-six; the directory holds **twenty-one**,
because fifteen of them are one file each rather than two. *Shared, not copied*,
asserted by counting — which is the one way to say it that a cache keyed on too
little could not also satisfy.

**The pair does its job**, and the mutation is §1.9's: deleting `summariser` from
`unitKeyOf` and `linkKeyOf` leaves ten of eleven green and reddens exactly the
converse arm. Run before the commit.

*`span` is a default and not an answer*, said in the code: §1.3 narrows cadence to
a procedure whose denominator sitting G supplies, and twenty is chosen to match
the window so a link freezes as its turns leave it.

**`ensureChain`'s only caller was the test until P8.1** — the `memoriesRoot` shape
this phase exists to delete. Named in the commit rather than discovered later.

### P8.1 — The summary in the pipeline and in the record

Summaries as blocks with reasons, costed like anything else in the block table;
regeneration as a first-class action, which is safe precisely because summaries
are derived; the workbench showing which links covered which turns. No new
viewer — P3 built the reader and [00 §2.8](../00-stance.md) forbids the second
one.

**What §0.1's finding 6 adds to that sentence** (2026-09-13): *"summaries as
blocks"* is **two union members on two published types** before it is a feature —
`SlotSource` gains `{ of: 'summary' }` and `BlockSource` gains
`{ kind: 'summary'; linkKey; range }`, and the first of those is on the
stable-tier portable preset schema, so it takes the *`/1` stays `/1`* argument
[P7.5](23-p7-implementation.md) made for `introduces`.

***And the stage carries §1.5's structural half***, which is the one real
argument about where work sits in this phase. A third pseudo-source,
`transcript`, handing `{ input, output }` pairs and nothing else, filtered by
`reads` the way `cast` is. **Built here rather than at P8.5 because a payload
narrowed after its consumer exists is a payload narrowed by subtraction**, and
the filter's own docstring says why that is worse: nobody can then say which
fields were load-bearing.

*Also this stage's, and it is one line:* §1.8's `chat_summary` marker either
becomes a slot source and converts, or its review class flips from *not yet
importable* to *not converted*. **Leaving it reading *not yet* after this phase
ships is the one outcome §1.8 refuses.**

*Deliberately not built.* No new viewer, as above. **No `historyWindow` change** —
the window stays at twenty and the summary is a separate slot, because widening
it to overlap the summary makes two producers of the same turns and lets the
budgeter decide which survives. ~~No preset-editor surface for the new slot:
there is no preset editor in the client at all, which
[P7.14](23-p7-implementation.md) flagged for P11, and the shipped mode presets
position the slot, which is where the standing line is discharged.~~

***That clause is a no-op rather than a deferral*** (§0.3, 2026-09-15):
[P7B.1](24-p7b-presets-and-prompts.md) built the editor and it renders the
schema's shape, so **the new slot arrives editable with no client edit** —
`SchemaFields` reads the non-block fields out of the emitted artefact and a slot
block is drawn from `source.of` read openly, precisely so an arm a build has
never heard of renders as itself. *The shipped mode presets still position the
slot, which is still where the standing line is discharged; what has gone is the
sentence saying nobody could see it afterwards.*

*Ends at:* the four-hundred-turn session assembles inside budget with the summary
in the prompt, and the block table names the links and which turns each covered.

*Proof obligation:* `packages/server/src/routes/p8-gate.test.ts` — *a long
session assembles, and the record says which links covered which turns* (gate
step 1). Plus `turns/steps.test.ts` — ***a step that declared `transcript` is
handed no blocks***, which is §1.5's structural half and the clause that
compounds.


#### Done — 2026-09-16, `843c50b`

***The summariser declines the record it is entitled to***, which is the stage's
result and not its plan. §1.3 grants the summariser the record and makes that the
reason one step cannot also be the extractor; the step declares
`reads: ['transcript']` instead. A turn's `request.calls[].blocks[].text` is *the
prompt that produced the turn*, so summarising the record rather than the story
would carry a hook's premise into every later prompt through the back door — and
the narrower payload costs nothing, because a summary of a session is a summary
of its story. **It also gives the new pseudo-source a reader on the day it
lands**, which is the test [11 §4](../11-lorebooks-as-a-format.md) applies to a
new field, applied to a new source.

***`transcript` is the fifth member of `reads` and the first added to make a
payload smaller.*** Every earlier member widened what a step could ask for. This
one exists because `history` is **too wide to refuse with**. [06 §6] and
[23 §3.1](../23-extensions.md) both carried the old union and both are corrected;
so is `filterReads`' own comment, which said `reads` had *"exactly two
pseudo-sources"* and was wrong when it was written (`cast` made three at P7.12).
*The argument never depended on the count.*

**`resolveStepRole` is extracted from `planCall` rather than restated.** The
summariser has to know its resolved binding **before** the call, to look a link up
by content address and usually not make one — and a second copy of [20 §5.1]'s
layering would be a second answer to *which model is this*, which is how a session
derives its chain under one model and reads it under another.

**Links are emitted at `priority + index`**, which is `history`'s arithmetic and
has to be: the trim order is lowest first and its tie-break is *later-listed
first*, so a shared priority would drop the **newest** link and keep the oldest —
the trade backwards. Both shipped packs position the slot at 8, under history's
floor, so the chain occupies 8..26 against history's 10..29: the oldest
summarised stretch goes first, and the stretch that ends where the window begins
outranks the oldest verbatim turns.

**An empty summary slot says which kind of empty it is** — lore's distinction, and
it matters more here: *no chain computed* is waiting on the engine, and *a chain
computed and empty* is **this session is not yet longer than its window**, which
twenty more turns fixes.

*`SummaryUnit` splits what is hashed from what is shown.* The first draft had one
field doing both and the step had to `JSON.parse` a key input to build a prompt —
**a prompt rewrite must never be able to invalidate a chain.**

***§1.8's one line is paid.*** Marinara's `chat_summary` converts to
`{ of: 'summary' }`; `agent_data` stays deferred, which is what keeps the review
class legible — *not yet* and *never* are only distinguishable while both exist.

**Two tests changed for a reason rather than to pass.** `runner.test.ts` read
`calls[0].blocks` for the history window, and the turn's first call has not been
the narration since the hook selector shipped — a `pre` step that makes one is
what made that visible. `sessions.test.ts`'s absolute block count becomes 17 and
gains an assertion naming the slot, because **an absolute count of a shipped
object is a number that changes whenever anything ships** ([P7B.0]'s lesson).

### P8.2 — Memory books, and §1.1's decision built

The storage answer implemented, `memoriesRoot()` resolved either way, the book
created lazily on first extraction rather than provisioned per pair, and the
ordinary lorebook editor reaching it. The non-shareable marking and the export
warning [08 §2](../08-cross-session-memory.md) asks for land with the book, not
after it.

**§1.1 is answered now, so the sentence above is specific** (2026-09-13). Books
are **library lorebooks**; `memoriesRoot()` is **deleted** and
[03 §5.1](../03-data-model.md)'s line struck; the marking is
`provenance.source = 'session'`, a field that exists and has never had a writer
(§1.9), with the shelf filter row and the badge beside it.

***Two things this stage owns that the sentence above does not name.*** The
**third `LoreRoute`** — `'memory'` — with the argument §0.1's finding 8 requires:
*this is not a field volunteering*, because `turns/lore.ts`'s refusal stands and
[P5.7](17-p5-implementation.md)'s reversal is why; it is an engine rule over the
session's own declared cast plus an explicit toggle, **and it reports itself
through `by`** so P5.8's tester can say *memory intake for Vera* rather than
leaving *why is this book being scanned* blank. And the **escaped-effect
channel** with the removal of `acceptEffect`'s hard-coded `'session'` (§1.9) —
here rather than at P8.3, because a declaration belongs with the thing it
describes.

*Deliberately not built.* **Granularity is not decided here** — §1.2 says the
constraint is the part to hold and the answer wants volume, so: one book per
`(actor, persona)`, because that is the shape that cannot be wrong about
retrieval, with the **naming** carrying the tuple in a form a fourth key extends.
No `LoreScope.linked` revival, for finding 8's reason.

*Ends at:* an empty memory book created by the first write, opening in the
ordinary lorebook editor at its library address, badged as derived on the shelf,
warning on export, and reaching a session through `by: 'memory'` — the whole of
which is visible in P5.8's tester.

*Proof obligation:* `packages/server/src/routes/p8-gate-storage.test.ts` — *a
memory book is an ordinary library object, and says it is not one*, in
`p2-gate-storage.test.ts`'s manner. **One arm must be a repo-shape assertion that
`memoriesRoot` is gone**, in `tools/repo-shape.test.ts`'s manner: §1.1's *either
the answer or is deleted* is enforced by nobody otherwise, and P7's gate step 1
is the worked example of a deliverable nothing noticed.


#### Done — 2026-09-16, `a33f263`

**§1.1's decision built, and its deciding argument is the one the section did not
make.** Its two were about cost; what settles it is that a book reaches a session
by being *found*, so the resolver answers *"the memory book for this user, this
actor and this persona"* as a **query** — and only the library already has a table
to ask. `memoryBooksOf` is that query: one pass over `list(lorebooks)`, filtered
on the marking and the scope. `memoriesRoot` is deleted, [03 §5.1]'s line struck
with a dated note, and a **repo-shape assertion** sits behind the deletion.

**The scope is a record of named keys and not a tuple**, which is §1.2's whole
constraint: adding `world` is adding a key to an open record, and a book written
before it simply has none.

***Two things landed differently from the plan, and both are recorded rather than
quietly done.***

**The export warning has no export path to be on.** [08 §2] asks to *"warn on any
export path — this is the one place the reuse could bite"*, and **nothing in this
build downloads a library object**; session export is [26 B12](../26-open-questions.md)
and out of scope. A warning written against that path would have been
unreachable — the deliverable-nothing-noticed shape this stage deleted a helper
over. So it goes where a person meets the book: the object page, which is also
the page they are on when they decide to copy it out by hand. *What is owed when
an export path is built is that it read this marking.*

**`acceptEffect`'s change has no test until the next stage**, because nothing
writes the channel yet. Named here rather than discovered later.

*`se.memory.written` is the build's first `escapes: true` channel*, and `book` is
`ChannelDefinition.scope`'s sixth arm — the honest one, because a session plays
with more than one character, so *what this turn wrote into which book* is a fact
about a book where `entry` is the scope of the things written rather than of the
place they went. It adds **not one line** to any replay reader, which is the
dividend of the mechanism having been built a phase before its first producer.

### P8.3 — Extraction

§1.3's pass, §1.4's discrete facts with origin refs and timestamps, and the
manual **remember this** action on a message — which
[08 §2.1](../08-cross-session-memory.md) calls nearly free and which is the
affordance that makes a mediocre extractor tolerable.

**Where the facts go, after §0.1's affordances** (2026-09-13): an origin session
ref and a timestamp in `LoreEntry.metadata`, which is an open record and is the
only place they fit **without opening a schema field** — [11 §4](../11-lorebooks-as-a-format.md)
refuses one by name and §1.9 is the argument for not needing to.

**The escaped effect is written for real here**, and the abandonment banner's
**client half** with it (§1.9): the count is already on the wire and
`client/src/api.ts` types it away, so the stage that creates the producer is the
stage that gives it somewhere to surface.

***And `LoreEntry.locked` gets its first reader since it was written***: the
extractor never rewrites a locked entry. That is what makes a hand-corrected
memory worth correcting, and it is gate step 6's second clause — a book that eats
corrections is a book people stop correcting, silently.

*Deliberately not built.* **No deduplication against existing entries and no
contradiction resolution.** [08 §6](../08-cross-session-memory.md) answers both
through §5 — *they are context, not truth, and the current session's channels
always win* — and a deduplicator is the second judgement a mediocre extractor
gets wrong. **No per-entry `advisory`**: that is a property of how the book is
*read* rather than of how the entry was written, so it lands at P8.4 with the
retrieval path.

*Ends at:* a played session writes discrete memories with origins and timestamps;
abandoning the line they were written on says how many are still out in the
world; and a locked entry survives the next pass unchanged.

*Proof obligation:* `packages/server/src/turns/extraction.test.ts` — *an
extraction is an escaped effect, and a locked entry is not rewritten*. The
escaped arm's falsifying mutation is restoring `scope: 'session'`, which returns
`abandonedBy` to counting zero — the exact state `sessions/store.ts` documents
today.


#### Done — 2026-09-16, `79f92c3`, in §5's cut form

***The automatic extractor is deferred and manual capture is what shipped***,
which is §5's named fallback cut taken deliberately rather than under pressure.
What follows is what the writer that does exist produced.

***The channel cannot accumulate, and that is the mechanism being right.***
§1.9's *"appending the entry ids written this turn"* reads like a list that
grows, and a first draft read the current value and appended to it — producing a
list of one, every time. **`applyEffects` skips `scope: 'escaped'`**, which is the
whole point of the scope, so the state such a list would accumulate into is never
replayed and never readable. It should not be: `abandonedBy` counts **effects on
the turns being left**, so a running total would make the newest turn's value the
count for the whole line, and abandoning one turn would report everything the
line ever wrote.

***The write needed a turn, and `writeChannel` already answers how.*** A capture
happens between turns and a past turn cannot acquire one ([03 §5.5]); that
function appends *a turn with no model call and no tape*, because [03 §8.1] wants
a change of state visible in the turn record and a turn is what the workbench
shows. `undoTurn` and `divergenceTurn` write the same shape. The consequence falls
out correctly: **rewinding past a capture counts it as still out in the world**,
which is true.

***`LoreEntry.locked` gets a writer and its reader is still owed.*** The field
means *locked against automatic modification by agents*, and §P8.3 gives it a
reader — *the extractor never rewrites a locked entry* — which the cut defers.
Rather than manufacture one, **the case with the strongest claim to the field is
written now**: a memory somebody typed is not a mis-extraction to be refined, it
is the sentence they chose, so a hand-written memory is locked from the moment it
is written. *The extractor inherits an obligation with subjects already on disk.*

**The abandonment banner's client half closes §3.1's inverse instance** of the
standing line — not configuration with no surface but **a record with no
surface**. Harmless while nothing could write an escaped effect; P8's to close
because P8 is what makes the count non-zero.

**Verified by mutation**, the one §P8.3 names: restoring `scope: 'session'` in
`acceptEffect` reddens exactly the two escaped arms and leaves the other four
green.

### P8.4 — Scope, toggles and the association list

`SessionMemoryConfig` — `share`, `intake`, and `associations` as a **tri-state**,
because a boolean cannot express *exclude this one session despite intake being
on*, which is the control the requirement actually asks for. The settings UI from
[08 §7](../08-cross-session-memory.md): two switches, the list of the account's
other sessions with the same actors showing auto-on rather than hiding them, and
the link to the book.

***And that UI has a place to be, which it did not when this was written***
(§0.3, 2026-09-15). 08 §7 says *per session, in settings*, and
`play/SessionPanel.tsx` ([P7B.2](24-p7b-presets-and-prompts.md)) is it — so this
stage adds sections to a panel rather than building one. **The debt travels with
the surface**: that panel's docstring records the play column at seven and
[P7B §1.4](24-p7b-presets-and-prompts.md)'s *one Session panel, not three* as
further from done than when it was written. **This makes it eight**, and a stage
that adds one without saying so is how a column becomes a list.
*Its route is also the first in this phase to meet the check §0.3's third item
names — `SessionMemoryConfig` must have a client caller or a written exemption
before the suite is green.*

Scope is `(user, actor, persona)` with the per-user axis **not a toggle and not
overridable**, and persona scope a default a setting may widen.

***And §1.6's actual machinery, which this stage owns and no sentence above
names*** (2026-09-13, §0.1's finding 9). A `bookId` on the lore block source; the
book's `provenance.source` carried onto the candidate; and a **third arm on
`collect.ts`'s advisory union** — *a candidate from a derived book is advisory
whatever the positioning slot says* — by the identical argument that already
forces it for guidance and attempt. **Without these three the demo's second half
is unanswerable and the firewall cannot see a memory at all**, which is why they
sit here with the retrieval path rather than with the writer.

*Deliberately not built.* No cross-actor memory
([08 §3](../08-cross-session-memory.md), explicitly not 1.0). No widening beyond
persona. No embeddings ([26 E2](../26-open-questions.md)) — this document is
their first real customer and saying so is not scheduling them.

*Ends at:* the four combinations [08 §4](../08-cross-session-memory.md)'s table
enumerates each do what the table says; a memory block reaching a prompt is
marked advisory on the record; and **the workbench names the entry, its origin
session and why it was retrieved** — the demo's second half, unreachable before
this stage.

*Proof obligation:* `packages/server/src/routes/p8-gate-memory.test.ts` — *four
combinations, four outcomes, and the block says where it came from*. Plus an arm
in `p2-gate-guidance.test.ts`'s manner: *a memory block never reaches an
effect-producing call*, driven through a step with non-empty `writes`, asserting
the advisory-leak refusal and the committed call's purpose. ***That arm is what
makes [testing §1](03-testing.md)'s property a general rule rather than a fact
about guidance***, which is §1.6's claim with the machinery it costs attached.


#### Done — 2026-09-16, `cf93293`

**§1.6's three pieces, which the section calls the expensive half and which are
the reason the second consumer of [testing §1](03-testing.md)'s property is not
free.** `BlockSource`'s lore arm gains `bookId` — the activation has carried it
the whole time and the block dropped it. A candidate from a derived book is
advisory **whatever slot positions it**, set where the book is known and carried
through `collect.ts`'s lore case; before this, a memory entry and an authored one
arriving through the same `{ of: 'lore' }` slot were indistinguishable to the
firewall.

***Row 7 gets the assertion §3.1 says it needs.*** *A memory block never reaches
an effect-producing call* was satisfiable by a block that was never marked, so
the test asserts the block **is** advisory and then that the call refuses it —
with the purpose **derived** from a step that writes rather than named, and a
prose-call control so the throw is about the purpose and not about the assembly.

***The association filter produces a filtered copy of the book rather than
filtering after the scan***, which is [08 §6]'s refuse-at-the-source argument one
level down: the retriever charges its budget against what it scans and reports
what it kept, so a book handed over whole would spend this session's tokens on
another session's memories and then drop them. **That is the defect [P6B.1] found
on the lore path**, and the reason it is worth not repeating.

*A memory book with nothing left in it is still returned*, and a first draft
filtered those out. `retrieval/blocks.ts` puts **every book in play** on the shelf
report *"including one that activated nothing — which is the row somebody most
needs"*.

**The UI is a section of the Session panel rather than an eighth panel**, which is
§0.3's second item and a debt as much as a placement: three became six, then
seven, and **a stage that made it eight without saying so is how a column becomes
a list.** Seven sections in one panel is the direction [P7B §1.4] wanted; *the
consolidation it asked for is still owed.*

*The gate test uses `TEST_PRESET` rather than a shipped pack*, because
`tools/repo-shape.test.ts` holds [P7.0]'s exit condition that the engine imports
no mode from anywhere in its source — and a test under `packages/server/src` is
engine source.

**Verified by mutation:** removing the advisory arm reddens exactly the row-7 test
and leaves the four combinations green.

### P8.5 — The spoiler defences

§1.5's extraction refusal over hidden content, and the session-creation warning
with its *start isolated* offer. Deliberately last so it is built against real
extracted books rather than against the idea of one.

**The refusal is smaller than it was, because P8.1 took its structural half**
(§1.5, 2026-09-13). What remains is the content-level remainder: a hidden
channel's rendered value and an unfired entrance's prose can still reach the
`transcript` **by way of the narrator's own output**, which that payload
legitimately carries. That is the case §1.5's parenthesis is about — *an entrance
is not a summary of an arrival, it is the finished prose of one* — and it wants a
**refusal with a reason rather than a filter**: extraction declines a turn whose
record shows an entrance block, and says so.

*Deliberately not built.* [08 §6](../08-cross-session-memory.md)'s third bullet —
whether sessions from the same package default to not sharing — stays `[OPEN]`,
for that document's own reason (*probably too clever*). **And no retrospective
sweep over already-extracted books**, because §1.5's whole argument is that this
must not be deferred past the phase *precisely so* there is nothing to sweep.

*Ends at:* the demo, and the negative half of it — a hook premise fired in
session one does not appear as a memory in session two, and neither does an
unfired entrance.

*Proof obligation:* `packages/server/src/routes/p8-gate-spoilers.test.ts` — *a
premise and an unfired entrance are absent from the second session's book*, with
**a control arm**: an ordinary narrated fact from the same session **is** present,
or the test passes over an extractor that extracts nothing. *That control is
[P7.13](23-p7-implementation.md)'s lesson, where two of four lint fixtures are
controls for the same reason.*

#### Done — 2026-09-16, `8dcfced`, at its cheap end

***What the cut leaves undone is named where it is deferred.*** This stage's
obligation — *a premise and an unfired entrance are absent from the second
session's book* — is a statement about an **extractor**, and §5's cut defers it.
`memory/capture.test.ts` holds the refusal over the only writer this build has: a
turn a hook fired on is **declined, with a reason**, which is §1.5's *a refusal
with a reason rather than a filter*. Refusing the whole turn rather than the
sentence is coarse on purpose — a filter that guessed which clause came from an
entrance would be the *"filtering later"* [08 §6] rejects at a finer grain.

**What did land whole is the cheap mitigation and §1.7.** Creating a session says
which sessions have played that treatment, and one control turns both switches
off — *which is also the "one obvious action rather than two toggles found in a
drawer"* [08 §4]'s `[OPEN]` names. **After creation rather than before**, and that
is a decision: nothing has been imported yet, because a session is created with no
turns.

***§1.7's rendering is an absence rather than a field***, and the argument is
worth keeping: a written *this session was deleted* marking **would become a lie
the moment the folder came back from trash**, where a rendering of an absence
survives a restore for free.

**`MemoryOrigin` is handed the sessions rather than fetching them**, and the first
draft was not: a `useQuery` inside it took **forty-three** `LorebookView` tests
down at once, because that component and everything under it are pure and their
tests render them directly — which is what makes them cheap to test at all.

*Two open records are read through `unknown` rather than through their declared
type*, which is `readSummary`'s rule: `metadata` is **required** by the schema so
the compiler believes it is always there, and it is absent from plenty of
hand-built objects. Found by a fixture, which is the honest way to find it.

---

## 3. Verification — the P8 exit gate

~~Sketch; expand on revisit.~~ *The ten steps were the sketch and they stand.
§3.1, added 2026-09-13, is the revisit: it splits them under
[manual testing §0](05-manual-testing.md)'s two-tier gate — adopted 2026-09-09,
eleven days after this document was drafted — and gives them cells to write in.
**The ten are never edited**, which is that model's first honesty condition and
what keeps the split from being a walk that edits the gate until it passes.*

1. A long session assembles inside budget with the chain in place, and the
   workbench shows which summary links covered which turns.
2. Fork at turn 300: the shared links are byte-identical to the parent's — the
   [testing §1](03-testing.md) property, green.
3. Delete every summary and regenerate: the session still works and the story is
   unchanged. Derived means disposable, and this is the check that it is true.
4. Session two with the same actor and persona recalls something from session
   one; the workbench names the entry, its origin and its retrieval reason.
5. The same actor with a **different persona** recalls nothing from session one,
   until the widening setting is turned on.
6. A memory is edited by hand in the ordinary lorebook editor, and the edit takes
   — through the same write path, concurrency and history as any other object.
7. A memory block never reaches an effect-producing call (§1.6), asserted.
8. A hook premise fired in session one does **not** appear as a memory in
   session two, and neither does an unfired entrance (§1.5).
9. Creating a session in a treatment that already has one offers *start
   isolated*.
10. Delete an origin session: §1.7's chosen behaviour happens, and it is the
    behaviour the plan chose rather than the one the code happened to do.

**And the standing line from [work plan §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** Two toggles, a tri-state list and a
persona-widening setting all arrive here, and [08 §7](../08-cross-session-memory.md)
is where they live.

### 3.1 The split, and what closes this gate

*Added 2026-09-13. The criterion, applied rather than argued
([manual testing §0](05-manual-testing.md)): a check is critical **iff (i)** it
can falsify a claim **this phase** makes about itself rather than one its gate
transports, **(ii)** the claim compounds, and **(iii)** it is walkable with what
is to hand.*

***Clause (iii) does most of the work here, and it is worth naming before the
table.*** Four of the ten steps want a four-hundred-turn session. **Nothing in
this project has ever produced one** — `tools/seed.mjs` writes a treatment, a
lorebook and a session and no turns at all, and the longest sessions on record
are sitting-length. A synthesised tree built through `appendTurn` is available
today and is what the AUTO rows below use — **and it tests the chain, not the
summary.** Scripted output can prove that keys are shared and bytes identical; it
cannot prove that a summary of four hundred real turns is worth reading. *That
second question is PLAYABLE's, it is as answerable in November, and under clause
(iii) it is a deferral rather than a check.*

| Step | Answered by | State |
|---|---|---|
| **1a** A long session assembles inside budget with the chain in place | **a test**, over a synthesised tree | **AUTO** — `p8-gate.test.ts`, P8.1's obligation. Walkable today: the tree is built through `appendTurn` and the provider is scripted |
| **1b** The workbench shows which links covered which turns | **a person**, in a browser | **Standing** — fails (ii); a mislabelled link is a rendering fix at any time, and [work plan P11](01-work-plan.md) owns the legibility sweep. *The row is not empty, though: `BlockSource` gains a `summary` arm at P8.1, so the table has anything to show at all only because of a schema decision, and covering the arm is cheaper than walking it* |
| **2** Fork at turn 300: the shared links are byte-identical | **a property test** — the [testing §1](03-testing.md) row | **AUTO**, and it should not reach a walk sheet. **The phase's central claim and fully automatable, which is the happiest cell in the table.** [P7](23-p7-implementation.md)'s step 5 is the precedent. *It only closes with its converse arm* (§1.9) |
| **3** Delete every summary and regenerate: the session works and the story is unchanged | **a test** for the first clause; **a person** for the second | **AUTO** for *works*, and the assertion is **stronger than the step asks**: content addressing makes regeneration byte-identical rather than merely equivalent, so it is an equality and not a judgement. **Standing** for *the story is unchanged*, which is a reading of real prose and fails (iii) |
| **4** Session two recalls something from session one; the workbench names the entry, its origin and its reason | **a person** | **critical — C1, and the anchor.** (i) ✓ it is the demo sentence in the header; (ii) ✓ it is what every later phase reading a memory builds on; (iii) ✓ **two short sessions and one actor — no long session needed**, which is what makes the phase's headline claim cheap to walk |
| **5** The same actor with a **different persona** recalls nothing, until the widening setting is on | **tests** | **AUTO** — the resolver either admits the book or does not, which is a unit test over the third `LoreRoute`, and the widening is one predicate. **The compounding half is in the resolver, not in the switch** |
| **6a** A memory is edited by hand in the ordinary editor and the edit takes | **nothing here** | **Standing** — fails (i) outright: it is P1's write path and P5's editor, transported. [P2C](12-p2c-first-real-run.md)'s storage scenarios already carry the claim |
| **6b** *…and survives the next extraction* | **a person** | **critical — C2.** Not in the gate as written, and it is the clause that is *this phase's*. (i) ✓ the extractor is P8.3's; (ii) ✓ **a book that eats corrections is a book people stop correcting**, and the affordance §1.4 rests on dies silently; (iii) ✓ one sitting — correct an entry, play five turns, look. *`LoreEntry.locked` is the field, and it has had no reader since it was written* |
| **7** A memory block never reaches an effect-producing call | **a test** | **AUTO** — `admit()` already throws and `p2-gate-guidance.test.ts` is the shape to copy. **But as written the row cannot fail for the wrong reason**: nothing on the lore path is advisory (§0.1's finding 9), so a test written before P8.4 passes over a block that was never marked. The assertion has to be *the memory block is advisory* **and** *the call refuses it*, or it asserts nothing |
| **8a** The extractor is never handed hidden content | **a test** over the step payload | **AUTO** — P8.1's obligation, and §1.5's *structural* form. **This is the clause that compounds, and it is not the one the gate asks** |
| **8b** A hook premise fired in session one does not appear in session two, and neither does an unfired entrance | **a person** | **critical — C3.** (i) ✓ §5 calls it the phase's riskiest claim; (ii) ✓ *"the one failure in this phase a person will notice immediately and never forgive"*; (iii) ✓ a treatment with one hook and two sessions — and it **became** walkable at [P7.5](23-p7-implementation.md) |
| **9** Creating a session in a treatment that already has one offers *start isolated* | **a test** | **AUTO** — a route and a component test. Fails (ii): a missing offer is a one-line fix at any time, and [08 §6](../08-cross-session-memory.md) calls this the *cheap* mitigation |
| **10** Delete an origin session: §1.7's chosen behaviour happens | **a test** | **AUTO**, and **the step's own clause is the interesting part** — *"the behaviour the plan chose rather than the one the code happened to do."* §1.7 finds those are now the same behaviour, arrived at independently by `sessions/store.ts` and [03 §10.3](../03-data-model.md), so the test pins agreement rather than discovering it. The *new* half is the confirmation's sentence, which is a component test |
| **The standing line** — no configuration without a surface | ~~**a checklist**, and it has six rows~~ **a test and a checklist** | **critical in part.** ***The mechanical half arrived 2026-09-15*** (§0.3): `route-callers.test.ts` fails on a route with neither a client caller nor a written exemption, so every route this phase adds — `SessionMemoryConfig` first — is checked on the commit rather than at the gate. *What it cannot see is a **field** with no surface, which is what the six rows below are.* `share`, `intake`, the tri-state list, the persona widening, and the summariser's cadence. **Plus one inverse instance this phase inherits**: the abandoned-effect count is on the wire and typed away in the client — *a record with no surface*, which is the standing line's mirror and is P8's to close because P8 is what makes the count non-zero |

**The critical list, derived rather than preferred — three items, a sitting or
two.**

- **C1 — cross-session recall, named. Only a person can walk:** play a short
  session with an actor; start a second with the same actor and persona; she
  refers to something from the first, and the workbench names the entry, its
  origin session and why it was retrieved.

  ***The phrase is here rather than on a step, and that is a finding rather than
  a placement.*** [manual testing §0](05-manual-testing.md) says the intake *"is
  mechanical, not a matter of remembering"* and that **every** exit gate ships at
  least one step carrying those words — naming P3, P5, P7, P10 and P11. **P8's
  ten steps carry it nowhere, and neither do P4's, P6's or
  [P9](26-p9-implementation.md)'s.** So the claim is true of five gates and
  false of four, and the grep it describes silently finds nothing in this
  document. The ten steps above must not be edited, so the phrase goes on the
  critical list instead — *and the count belongs back in
  [manual testing](05-manual-testing.md), where a rule that describes five of
  nine cases should say so.*
- **C2 — a correction survives.** Hand-edit a mis-extracted memory in the
  ordinary lorebook editor, play on, and see it still say what you made it say.
- **C3 — no spoiler bleed.** Two sessions in a treatment with a hook; session
  two's memory book contains no premise and no entrance prose.

Everything else is automatable or standing, and each automatable row owes
[manual testing §5](05-manual-testing.md) a named test when it lands.

***What this list cannot reach, written here rather than discovered later.*** All
three criticals are short-session checks, and **the phase's headline demo is two
sentences long and only the first of them is walkable.** *"And the same session,
four hundred turns long, still assembles inside budget"* is on the critical list
nowhere, because clause (iii) refuses it: the only long session this project can
currently produce is synthesised, and a synthesised one proves the chain and not
the summary. **So the phase closes on evidence that memory works and no evidence
that summarisation is any good.** That is tolerable only because the header's own
safety argument holds — summaries are derived and disposable, so a bad summariser
is a regeneration rather than lost history — and it is worth saying in the gate
so that nobody reads a closed P8 as a verdict on summary quality. The long walk
goes to [manual testing](05-manual-testing.md) as a sitting behind PLAYABLE,
where it joins the pile the two-tier model exists to **drain** rather than the
pile it exists to close.

### 3.2 What was answered, and what the cut left unanswerable

*Added 2026-09-16, when the phase's six stages landed under
[§5](#5-the-honest-size-and-what-only-the-revisit-can-settle)'s fallback cut.*
**§3's ten steps are not edited**, which is
[manual testing §0](05-manual-testing.md)'s first honesty condition and what
keeps a split from becoming a walk that edits the gate until it passes. This is
the second table.

***The headline is uncomfortable and belongs at the top: the cut removed two of
the three criticals' subjects.*** C2 and C3 are both about the **extractor**, and
§5 names the extractor as the right thing to cut. So the phase does **not** close
on the list §3.1 derived; it closes on C1 plus a critical list that has been
re-derived against what shipped, and **the two deferred rows travel with the
deferred stage** rather than being marked walked.

| Step | §3.1 said | What happened |
|---|---|---|
| **1a** A long session assembles with the chain in place | AUTO | **Done** — `routes/p8-gate.test.ts`, over a synthesised forty-five-turn path. Two links, their ranges asserted, their keys matched against the files on disk, and the blocks asserted **included** rather than merely recorded |
| **1b** The workbench shows which links covered which turns | Standing | **Covered, not walked**, which is what §3.1 asked for: `BlockSource` has a `summary` arm carrying `linkKey` and `range`, and the gate test reads them off the record through the route the client reads. The *rendering* is still Standing |
| **2** Fork at turn 300: the shared links are byte-identical | AUTO, the phase's central claim | **Done** — `sessions/summary-chain-property.test.ts`, both arms, with §1.9's falsifying mutation run before the commit. *Asserted by counting files*: nineteen links plus seventeen is thirty-six, and the directory holds twenty-one |
| **3** Delete every summary and regenerate | AUTO for *works*, Standing for *the story is unchanged* | **Done** as the equality §3.1 promised, and it cost a field: a content-addressed file may not carry a `createdAt`. *The story-unchanged half is still Standing* |
| **4** Session two recalls something from session one, named in the workbench | **critical — C1** | ***Not walked.*** The machinery is there and tested — `p8-gate-memory.test.ts`'s first four cases, plus the `bookId` that makes the origin reachable — but the sentence is *only a person can walk*, and nobody has. **Sitting N** |
| **5** A different persona recalls nothing until the widening setting is on | AUTO | **Done** — the resolver half and the setting, in `p8-gate-memory.test.ts`. §3.1 said *the compounding half is in the resolver, not in the switch*, and that is where it is asserted |
| **6a** A memory is edited by hand and the edit takes | Standing | Unchanged: P1's write path and P5's editor, transported |
| **6b** …and survives the next extraction | **critical — C2** | ***Vacuous under the cut, and that is the honest word.*** Nothing rewrites an entry, so the field has no adversary. `LoreEntry.locked` gets a **writer** — a hand-written memory is locked from the moment it is written — so the extractor inherits the obligation with subjects on disk. **The row travels with the extractor** |
| **7** A memory block never reaches an effect-producing call | AUTO, *and the row cannot fail for the wrong reason* | **Done, with the repair §3.1 demanded.** The block is asserted advisory **and** the call is asserted to refuse it, with the purpose derived from a step that writes and a prose-call control beside it. Mutation-verified |
| **8a** The extractor is never handed hidden content | AUTO, *the clause that compounds* | **Done, and it is the part of §1.5 that survives the cut** — `transcript` exists, `steps.test.ts` asserts a step that declares it is handed no blocks, over a fixture carrying a premise in exactly the position `history` would have leaked |
| **8b** No spoiler bleed into session two's book | **critical — C3** | ***Narrowed rather than walked.*** With manual capture as the only writer, a person cannot be bled into — they type what they remember. What remains is that they may press the button on a turn carrying entrance prose, and capture **refuses that turn with a reason**. The extraction half travels with the extractor |
| **9** Creating a session in a treatment that already has one offers *start isolated* | AUTO | **Done** — `p8-gate-spoilers.test.ts`, with the control that a first session warns about nothing |
| **10** Delete an origin session: §1.7's chosen behaviour happens | AUTO | **Done** — the memories stay, the later session still reads them, and the origin renders as an absence rather than a written marking |
| **The standing line** | critical in part, six field rows | **Five of six have a surface**: `share`, `intake`, the tri-state list and the persona widening are all in the Session panel's Memories section, and the **inverse instance** — the abandoned-effect count the client typed away — is closed. *The sixth, the summariser's cadence, has no surface and is a constant in `summary-chain.ts` with the reason written beside it*: §1.3 makes it a measurement rather than a setting, and a control offered before the measurement would be a number somebody has to guess |

**So the critical list this phase actually closes on is C1 alone**, and it is not
walked. The phase **merges and stays open**, which is [P7](23-p7-implementation.md)'s
precedent and [P7B](24-p7b-presets-and-prompts.md)'s: a merge is not the close,
and a critical list lives in [manual testing](05-manual-testing.md) until somebody
walks it.

***And one thing the cut makes better rather than worse, said so it is not read
as a consolation.*** §5's argument for cutting the extractor is that its **value
is unevidenced and its failure mode is unforgivable**. What shipped instead is
the affordance 08 §2.1 calls *nearly free* and §5 calls *authored by the only
judge who cannot be wrong about what mattered* — so the books this build grows
are grown by people. **When the extractor arrives it will meet a corpus of locked
entries written by hand**, which is a better first adversary for `locked` than
anything a test could have arranged.

***"When the extractor arrives" names no arrival, and that was found on
2026-09-16*** by [P11 §0.2](28-p11-implementation.md)'s re-audit, which carries it
as **row 20** and [manual testing §10.1](05-manual-testing.md) as its second
worked instance of a dangling owner. P10 and P11 are the only phases after this
one and the word appears in neither. **The cut was right and the sentence above
is still right; what is missing is a destination**, and this document is not the
one that can supply it.

*What that costs, said here because it is this phase's gate:* C2 and C3 travel
with the extractor (§3.2), so **two of three criticals cannot be walked by
anybody** until some phase owns it. [Sitting N](05-manual-testing.md) is one row
for that reason rather than because the criterion was generous.

---

## 4. Out of scope, deliberately

Chapterisation ([25 §3](../25-roadmap.md) — and note that P7's completed goal
chain is a better spine for chapters than word count is, which is an argument
for the roadmap item rather than for pulling it in); embeddings and semantic
retrieval ([26 E2](../26-open-questions.md) — this document is their first real
customer if they are ever built, and saying so is not scheduling them);
cross-actor memory, *Vera recalling that she and Tomas both know you*
([08 §3](../08-cross-session-memory.md), which multiplies the scope matrix and is
explicitly not 1.0); narrator- or World-scoped memory
([15](../15-world.md) — but §1.2's constraint is in scope); memories writing
state (§1.6, and it is a rule rather than a deferral); session export
([26 B12](../26-open-questions.md)), which is where the non-shareable marking will
eventually have to be enforced rather than merely warned about.

---

## 5. The honest size, and what only the revisit can settle

*Added 2026-08-31.*

**This phase builds one new thing and configures two existing ones.** The
immutable summary chain (P8.0) is genuinely new and genuinely load-bearing;
memory books are lorebooks, so P8.2 and P8.4 are a scope key, a toggle and an
association list over machinery P5 shipped; and extraction (P8.3) is a step in a
pipeline P7 will have made extensible. Priced as *six stages of memory*, this
looks like a large phase. Priced as *a chain, plus configuration*, it is a
medium one with one hard part.

**The hard part is not summarisation.** It is that the summary chain has to be
correct under branching — [07 §5.1](../07-branching.md)'s content-addressed
chain is the form, and the reason it is content-addressed is that two lines of
story must be able to share a prefix of summary without one of them being able
to change what the other reads. That is a P6 property arriving one phase late,
which is why [P6 §4](18-p6-implementation.md) names this as its handoff and why
this phase's revisit should read that section before its own §1.

**What is smaller than it looks:** §1.6's advisory rule (*memories never
contradict the record*) is an invariant that already exists rather than one to
build, and §1.4's *extract facts, not summaries* is a prompt decision with a
test rather than an architecture.

**What is riskier than it looks:** §1.5's spoiler bleed. It is the one failure
in this phase a person will notice immediately and never forgive — a memory
from a later session leaking into an earlier one's context — and its defence is
a P7 dependency, so it cannot be built or tested until then. A phase that ships
memory with the defence half-built has shipped the failure.

**Three things only the revisit can settle:** *(re-graded 2026-09-13 at the
revisit itself — all three are answered or narrowed, and the third answers
differently from the way this section expected.)*

- ~~**Storage** (§1.1), which is a real fork with a helper already leaning one
  way. Resolve it or delete `memoriesRoot()`; do not leave it leaning.~~
  **Settled**: library lorebooks, and `memoriesRoot()` is deleted with a
  repo-shape assertion behind it. *The lean survived and its argument did not —
  the deciding reason is that the resolver needs a **query**, which §0.1's
  finding 8 produced and which the section's own two arguments never reached.*
- ~~**Cadence** (§1.3) — one pass or two~~ **Narrowed to a procedure, and the
  lean reversed.** One step cannot do both, for a reason that is not a cost
  argument: the two want different payloads, and a step entitled to the record
  that then writes to the library is §1.5's failure with the defence removed.
  What is left for PLAYABLE is a denominator rather than a question.
- **Whether extraction earns a model call at all.** ~~Not currently framed as a
  question, and it should be~~ — **framed now, and it points the other way from
  the sentence below.** This section expects the risk to be the *summariser*:
  *"if PLAYABLE shows the summary rarely reaching the prompt under budget
  pressure…"*. **§0.1's finding 6 removes that risk entirely.** A summary does not
  compete with history, because everything above turn twenty is already gone —
  it competes with lore and the actor card at a priority the preset author
  chooses, and **a four-hundred-turn session's alternative to a summary is not a
  longer history but nothing at all**. So the summary reaches the prompt or the
  prompt has no past, and whether it earns its call is not in doubt.

  ***It is genuinely in doubt for the extractor, and that is where the question
  belongs.*** [08 §2.1](../08-cross-session-memory.md)'s manual *remember this*
  is nearly free, needs no model call, and produces exactly the discrete facts
  §1.4 wants — authored by the only judge who cannot be wrong about what
  mattered. **So the phase's named fallback cut is P8.0 + P8.1 + P8.2 + manual
  capture + P8.4, with the automatic extractor deferred.** That version ships the
  chain (the load-bearing part), the books (the reuse) and the toggles, and defers
  the one component whose value nobody can currently evidence and whose failure
  mode §1.5 calls unforgivable. **Named here so that cutting under pressure cuts
  the right thing**, which is the whole purpose of a section called *the honest
  size*.
