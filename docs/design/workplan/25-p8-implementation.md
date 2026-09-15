# 25 — P8 implementation plan

**Status: ~~skeleton~~ a plan, revisited 2026-09-13 at `4700aef` — and the
revisit §0 was written to expect.** Drafted 2026-08-29 alongside
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
  ([25 E1](../25-open-questions.md)) — schedulable rather than needing its own
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
criticals wait on. **So the phase can open, build the chain, put it in the
pipeline and create the books before anything is measured**, and §1.3 is written
as a procedure for that reason rather than as a decision made without evidence.

**What does *not* block, stated so it is not treated as if it did.** The
extraction *quality* question, which is a tuning matter
[work plan P11](01-work-plan.md) owns for every other feature and owns for this
one. The granularity question (§1.2), whose constraint is the part to hold and
whose answer wants volume. And [25 E2](../25-open-questions.md)'s embeddings,
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
and [25 C8](../25-open-questions.md)'s *generous during alpha* is the standing
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
budgeter decide which survives. No preset-editor surface for the new slot: there
is no preset editor in the client at all, which [P7.14](23-p7-implementation.md)
flagged for P11, and the shipped mode presets position the slot, which is where
the standing line is discharged.

*Ends at:* the four-hundred-turn session assembles inside budget with the summary
in the prompt, and the block table names the links and which turns each covered.

*Proof obligation:* `packages/server/src/routes/p8-gate.test.ts` — *a long
session assembles, and the record says which links covered which turns* (gate
step 1). Plus `turns/steps.test.ts` — ***a step that declared `transcript` is
handed no blocks***, which is §1.5's structural half and the clause that
compounds.

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

### P8.4 — Scope, toggles and the association list

`SessionMemoryConfig` — `share`, `intake`, and `associations` as a **tri-state**,
because a boolean cannot express *exclude this one session despite intake being
on*, which is the control the requirement actually asks for. The settings UI from
[08 §7](../08-cross-session-memory.md): two switches, the list of the account's
other sessions with the same actors showing auto-on rather than hiding them, and
the link to the book.

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
persona. No embeddings ([25 E2](../25-open-questions.md)) — this document is
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
| **The standing line** — no configuration without a surface | **a checklist**, and it has six rows | **critical in part.** `share`, `intake`, the tri-state list, the persona widening, and the summariser's cadence. **Plus one inverse instance this phase inherits**: the abandoned-effect count is on the wire and typed away in the client — *a record with no surface*, which is the standing line's mirror and is P8's to close because P8 is what makes the count non-zero |

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

---

## 4. Out of scope, deliberately

Chapterisation ([24 §3](../24-roadmap.md) — and note that P7's completed goal
chain is a better spine for chapters than word count is, which is an argument
for the roadmap item rather than for pulling it in); embeddings and semantic
retrieval ([25 E2](../25-open-questions.md) — this document is their first real
customer if they are ever built, and saying so is not scheduling them);
cross-actor memory, *Vera recalling that she and Tomas both know you*
([08 §3](../08-cross-session-memory.md), which multiplies the scope matrix and is
explicitly not 1.0); narrator- or World-scoped memory
([15](../15-world.md) — but §1.2's constraint is in scope); memories writing
state (§1.6, and it is a rule rather than a deferral); session export
([25 B12](../25-open-questions.md)), which is where the non-shareable marking will
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
