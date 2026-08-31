# 19 — P8 implementation plan

**Status: skeleton.** Drafted 2026-08-29 alongside
[P7](18-p7-implementation.md), [P9](20-p9-implementation.md),
[P10](21-p10-implementation.md) and [P11](22-p11-implementation.md); to be
revisited before the phase starts. [18 §0](18-p7-implementation.md) says what a
skeleton this far out is for, and it applies unchanged here. Format follows
[03](03-p1-implementation.md); citation convention as
[P4](06-p4-implementation.md)'s.

**P8 delivers**, from [01 P8](01-work-plan.md), two features that share the word
*memory* and share one mechanism:

- **Cross-session memory as an auto-maintained lorebook**
  ([11](../11-cross-session-memory.md)) — designed, buildable, and smaller than
  it looks because a memory is a lorebook entry and every retrieval mechanism it
  needs shipped at P5.
- **Within-session summarisation as a rolling summary**
  ([06 E1](../06-open-questions.md)) — schedulable rather than needing its own
  design pass, with one constraint that must hold on the first commit.

**The demo that defines done:** *start a second session with the same actor and
persona; she refers to something that happened in the first, and the workbench
names the memory entry, its origin session and why it was retrieved. And the
same session, four hundred turns long, still assembles inside budget — because
the history above the window is a chain of summaries, each link keyed by the
hash of its inputs.*

**The constraint that is a review item rather than a detail.** The rolling
summary is an **immutable chain**, `summary(n) = f(summary(n-1), turns[a..b])`,
each link content-addressed ([09 §5.1](../09-branching.md)). The
mutate-one-record implementation is the obvious one, is indistinguishable from
the UI, and quietly breaks cheap branching — a fork would have to copy or
recompute what it should share. Nothing in the product surface will ever reveal
which was built, which is exactly why it belongs in the plan.

**What makes the phase safe:** summaries are derived and disposable, so a bad
summariser is a regeneration rather than lost history. That is the argument for
shipping a simple version here rather than designing a good one first.

**CI this phase establishes:** the [testing §1](10-testing.md) invariant that has
been waiting for a producer — *summaries shared across a fork are byte-identical
to the parent's* — which is the chain constraint above expressed as a property
rather than a paragraph. Plus the second real consumer of *no advisory block ever
appears in an effect-producing call* (§1.6).

---

## 1. Decisions this plan has to make

### 1.1 Where memory books live — the phase's one storage decision

**And it is invisible from [11](../11-cross-session-memory.md), which is why it
is first.** The user layout ([02 §5](../02-data-model.md)) puts `memories/`
**beside** `library/`, not inside it, and `Layout.memoriesRoot()` has existed
since P1 with no caller and no directory ever created — recorded as P8's in
[P2C §5](15-p2c-first-real-run.md) and again in
[P2C brief §3.3](17-p2c-brief.md). The index's rebuild walks
`kindRoot(owner, schemaId)` under `library/` and nothing else, so a book under
`memories/` is **unindexed, unsearchable and unaddressable** — while
[11 §7](../11-cross-session-memory.md) asks for *a link to the memory book
itself, opening the ordinary lorebook editor*, which needs a library address.

Three ways out, and the phase must pick one before anything is extracted:

- **Memory books are library lorebooks**, in `library/lorebooks/`, marked as
  auto-maintained. Everything works for free — index, search, editor, the
  Lorebooks panel P5 built, history on write. The cost is that a derived,
  personal, often-embarrassing book sits in the shelf beside authored ones, and
  [11 §2](../11-cross-session-memory.md)'s *must not be treated as authored
  content* becomes a marking rather than a location. **Lean.**
- **`memories/` becomes a second indexed root**, with its own ingest branch. The
  separation is honest and the cost is real: the ingest path grows a second
  shape, and [P5 §1.7](07-p5-implementation.md)'s warning about delete sites
  applies again.
- **Books in `memories/`, unindexed**, with a bespoke reader. Rejected on sight —
  it is a second representation of a lorebook, which is
  [00 §2.8](../00-stance.md).

Whichever wins, `memoriesRoot()` is either the answer or is deleted. A path
helper that survives the phase without a caller is the same defect twice.

### 1.2 Book granularity, decided knowing a fourth key is coming

[11 §8](../11-cross-session-memory.md) leaves open whether memory is *per
(actor × persona) as separate books* or *one book per actor with per-entry
persona tags and filtered retrieval* — fewer objects against more query
complexity. The section also names the thing that should decide it: **a fourth
scope key already has a name.** Narrator-level memory is a World
([19](../19-world.md)), and the bearing on 1.0 is narrow but real —
**nothing may hard-code the three-tuple into how books are keyed and named on
disk.**

That constraint is cheap under either answer and is the part to hold; the
granularity itself can be decided on volume once PLAYABLE and P5 have produced
real sessions.

### 1.3 Extraction cadence, and whether it is one pass or two

[11 §8](../11-cross-session-memory.md)'s first open question, and it is a cost
question: session end is obvious, periodic extraction during long sessions is
better, and both cost calls. **The sharper form of the question is whether
extraction reuses the summarisation pass** — which is in this phase, reads the
same turns, and is already paying for a `fast`-role call.

**Lean: one pass, two outputs**, with the summariser's step emitting memory
candidates alongside the summary link. Two passes over the same window is the
implementation nobody would choose deliberately. Confirm on revisit — the risk
is that one prompt doing two jobs does both worse, and that is measurable rather
than arguable.

### 1.4 Extract facts, not summaries — and it is not a style note

[11 §2.1](../11-cross-session-memory.md): five memories are five things that can
be retrieved independently, attributed separately, and deleted individually when
one turns out to be wrong. A single blob has one relevance score and one delete
button. The distinction survives into the schema — each entry carries a ref to
its origin session and a timestamp — and it is what makes the budgeter's
existing trim order do useful work at volume.

### 1.5 Spoiler bleed is the sharp failure, and its defence is a P7 dependency

[11 §6](../11-cross-session-memory.md) names it as the failure most likely to
make someone switch the whole feature off, and the mitigation is *refuse at the
source*: **never extract from hidden content** — a hook's premise, an unfired
hook's entrances ([10 §6.1a](../10-schemas.md)), a hidden channel, GM-only state.
Filtering later is not equivalent, because the extraction has already written the
sentence down.

**All four of those things arrive in [P7](18-p7-implementation.md).** So this
defence cannot be built before P7 and must not be deferred past this phase — an
extractor that ships without it is an extractor that has to be re-run over its
own output later. The cheaper mitigation, warning at session creation when a new
session's treatment or package matches an existing one, is independent and lands
here too.

*And the reason entrances are worse than premises, worth keeping in view while
implementing:* an entrance is not a summary of an arrival, it is the finished
prose of one — a bleed reproduces the exact words a second playthrough was
supposed to reach freshly.

### 1.6 Memories are advisory, and the invariant already exists

[11 §5](../11-cross-session-memory.md), same boundary as the guidance box. A
memory saying Vera trusted you must not *set* a trust channel, or a new session
silently inherits state from one the player may not remember. Memory blocks are
`advisory: true` and inadmissible to evaluation steps, rule conditions and
engine-computed updates.

The good news is that this needs no new machinery: [testing §1](10-testing.md)
already carries *no advisory block ever appears in an effect-producing call* as
a property, with guidance as its first consumer. This phase gives it a second,
and a second consumer is what turns a property test into a general rule.

### 1.7 What happens when an origin session is deleted

[11 §8](../11-cross-session-memory.md)'s second open question. Keeping the
memories orphans the attribution; deleting them loses history the user may
value. The document's own lean — ask, defaulting to keep with the origin marked
as deleted — is probably right and interacts with P11's trash retention, since a
deleted session is a moved folder rather than an erasure
([02 §10.2](../02-data-model.md)) until the window closes.

### 1.8 What import left here, and the one thing it deliberately did not take

**Added 2026-08-30**, discharging §0's collecting job for the one document that
had sent something here without this one knowing: this skeleton and
[P4](06-p4-implementation.md)'s amendment were written the same day on
different branches.

**Deferred here, and it is small:** Marinara's prompt sections carry a
`chat_summary` marker among their ten marker types
([P4 §1.5](06-p4-implementation.md)). Nine of the ten map onto our slot sources
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

---

## 2. Stages

Summarisation first, and not for scheduling reasons: it is the half with a
structural constraint (§1.1's sibling, the chain) and the half memory extraction
probably rides on (§1.3). Building memory first means building the extractor
twice.

### P8.0 — The rolling summary as an immutable chain

The window policy, the chain, content addressing by the hash of inputs, and the
fork-identity property test green before any UI exists. Pure engine, and the
stage where the review item in the header is either honoured or lost.

*Ends at:* forking a four-hundred-turn session and observing that the parent's
summary links are **shared, not copied** — asserted, not eyeballed.

### P8.1 — The summary in the pipeline and in the record

Summaries as blocks with reasons, costed like anything else in the block table;
regeneration as a first-class action, which is safe precisely because summaries
are derived; the workbench showing which links covered which turns. No new
viewer — P3 built the reader and [00 §2.8](../00-stance.md) forbids the second
one.

### P8.2 — Memory books, and §1.1's decision built

The storage answer implemented, `memoriesRoot()` resolved either way, the book
created lazily on first extraction rather than provisioned per pair, and the
ordinary lorebook editor reaching it. The non-shareable marking and the export
warning [11 §2](../11-cross-session-memory.md) asks for land with the book, not
after it.

### P8.3 — Extraction

§1.3's pass, §1.4's discrete facts with origin refs and timestamps, and the
manual **remember this** action on a message — which
[11 §2.1](../11-cross-session-memory.md) calls nearly free and which is the
affordance that makes a mediocre extractor tolerable.

### P8.4 — Scope, toggles and the association list

`SessionMemoryConfig` — `share`, `intake`, and `associations` as a **tri-state**,
because a boolean cannot express *exclude this one session despite intake being
on*, which is the control the requirement actually asks for. The settings UI from
[11 §7](../11-cross-session-memory.md): two switches, the list of the account's
other sessions with the same actors showing auto-on rather than hiding them, and
the link to the book.

Scope is `(user, actor, persona)` with the per-user axis **not a toggle and not
overridable**, and persona scope a default a setting may widen.

### P8.5 — The spoiler defences

§1.5's extraction refusal over hidden content, and the session-creation warning
with its *start isolated* offer. Deliberately last so it is built against real
extracted books rather than against the idea of one.

*Ends at:* the demo.

---

## 3. Verification — the P8 exit gate

Sketch; expand on revisit.

1. A long session assembles inside budget with the chain in place, and the
   workbench shows which summary links covered which turns.
2. Fork at turn 300: the shared links are byte-identical to the parent's — the
   [testing §1](10-testing.md) property, green.
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

**And the standing line from [01 §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** Two toggles, a tri-state list and a
persona-widening setting all arrive here, and [11 §7](../11-cross-session-memory.md)
is where they live.

---

## 4. Out of scope, deliberately

Chapterisation ([14 §3](../14-roadmap.md) — and note that P7's completed goal
chain is a better spine for chapters than word count is, which is an argument
for the roadmap item rather than for pulling it in); embeddings and semantic
retrieval ([06 E2](../06-open-questions.md) — this document is their first real
customer if they are ever built, and saying so is not scheduling them);
cross-actor memory, *Vera recalling that she and Tomas both know you*
([11 §3](../11-cross-session-memory.md), which multiplies the scope matrix and is
explicitly not 1.0); narrator- or World-scoped memory
([19](../19-world.md) — but §1.2's constraint is in scope); memories writing
state (§1.6, and it is a rule rather than a deferral); session export
([06 B12](../06-open-questions.md)), which is where the non-shareable marking will
eventually have to be enforced rather than merely warned about.
