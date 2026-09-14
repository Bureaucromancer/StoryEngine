# 29 — P8A implementation plan: World

**Status: skeleton, written 2026-09-14 at `b65c0b5` — the phase after P8, and
filed out of order on purpose.** Its place is after [P8](25-p8-implementation.md)
and before [P9](26-p9-implementation.md), which is 26. Taking that number today
renumbers P9 through P11 and repoints every citation to them, so it sits at the
first free number instead; `PLAN_ORDER` in
[`tools/renumber-docs.mjs`](../../../tools/renumber-docs.mjs) already holds its
real position, and one scripted run moves it later for nothing.
[P7B](24-p7b-presets-and-prompts.md) is the worked precedent and was itself
moved this way on 2026-09-14, which is the second time that arrangement has paid
for itself ([README](README.md)). Format follows [P1](07-p1-implementation.md);
citations follow the corpus convention.

**P8A delivers World as a working kind**, from
[work plan §P8A](01-work-plan.md) and [15](../15-world.md): a durable library
object holding a named set of members, the two behaviours that become possible
once a container stops dissolving on import, and the view that makes a canon
legible.

**The demo that defines done**, taken from the work plan unchanged because a
phase and its plan disagreeing about what *done* means is the failure this
format exists to prevent:

> *Make a World, put a lorebook and three actors in it, start two sessions in it
> — and watch the second start with the books already selected, the hook that
> fired in the first not offered again, and the bible naming who exists without
> anyone having written that down.*

**What makes the phase smaller than it looks:** three of its five stages consume
machinery that already shipped. The kind's schema landed at `448c53e`; the two
hook obligations landed at P7.5 and one is pinned by a test; the bible is a
reader over a record that was designed to be complete
([03 §8](../03-data-model.md)). What is genuinely new is membership, the
contribution path, and one union variant.

**What makes it riskier than it looks:** two of those five stages ship against a
guess, and §1.5 says so rather than leaving it to be discovered.

**CI this phase establishes:** that a World's reach into the other five portable
kinds is exactly one union variant — [work plan §0.2](01-work-plan.md)'s
replacement check, expressed as a test rather than a promise, and due at this
phase's exit rather than at a release three out.

---

## 0. What this document is, one phase out

[P7 §0](23-p7-implementation.md) states the shared answer and it is not restated
here: collect the deferrals, name the decisions, hold the gate shape. Two things
are specific to this one.

**It is the first phase whose subject arrived by discovery rather than by plan.**
Every phase before it built something the work plan had always intended to
build. This one exists because [04 §9](../04-schemas.md)'s portable container and
[15](../15-world.md)'s continuity turned out to be one object approached from
opposite ends ([15 §0](../15-world.md)), which means **there is no prior phase
whose deferrals accumulate here.** The usual first move — read what P5 through P8
pushed forward — returns almost nothing, and the deferrals this phase inherits
are instead scattered through documents that were arguing about a different
object. §1 collects them.

**And its schema work is already partly done, which is unusual and worth
stating.** The rename shipped before the phase was planned, because it was free
in the hour it was noticed and a migration the moment anything wrote a
`.seworld`. So §2.1 opens on a stage that is half-complete, and the honest
framing is that this phase inherits a kind rather than creating one.

## 1. Decisions this plan has to make

### 1.1 Membership lives in two places, and that is not two copies of one fact

**Library members live on the World; a session's World lives on the session.**
[15 §6](../15-world.md) argues it and this section is where the build consequence
lands, because it looks like a violation of
[00 §2.8](../00-stance.md) until the two halves are named precisely:

- **A World holds refs to library objects.** Curating a set is something you do
  to the set, so the set is where it is stored. A World never blocks a delete —
  membership is not ownership, an object may belong to several Worlds and to
  none, and a deleted member leaves a ref that dangles visibly
  ([00 §3.3](../00-stance.md)).
- **A session holds its own World.** Decided at creation and part of what the
  session is, because it is the memory key — and a key that had to be found by
  reverse lookup over every World's member list on every turn would be a key in
  name only.

They are membership of different things, not one fact written twice. The test
that keeps it honest: **there is no query that has to agree with another query.**
A World's member list does not include its sessions by derivation, and a
session's World is not checked against any list.

**The ordering constraint this creates is real and belongs to another phase.**
[P11 §1.8](28-p11-implementation.md) records that Session and Turn need a
provenance field and that P11 is the last stage that can add one cheaply, because
the turn record freezes there. The session's world ref is the same window and the
same argument. **This phase puts the field there; P11 carries it into the
format.** Getting the order wrong is a migration over the record this project has
the most of.

### 1.2 `LoreScope` gets its consumer, and P5.7 is the thing to re-read first

The variant is settled — `{ kind: 'world', worldIds: string[] }`
([15 §5](../15-world.md)) — and it is the single exception
[work plan §0.2](01-work-plan.md) names to the check that World must change no
other portable schema. What is not settled is the discipline around building it,
and [P5 §1.7](17-p5-implementation.md)'s reversal is the reason to be careful.

**What went wrong at P5.7**, because it went wrong in one day and the shape is
easy to reproduce from the other direction: a book's own `scope` was briefly
allowed to *admit* it to a session. `global` is the factory default *and* the
SillyTavern importer's fallback, so a person's entire library appeared in every
session's prompt with no way out but hand-editing JSON. The lesson was recorded
as **a library is not a world**.

**Why this is not that.** A World is a *subset* of a library that somebody named
and put things in, and contribution happens **at session creation, by copying**,
not as a live query that re-decides every turn. The rule that a lorebook reaches
a session by being selected and by nothing else ([03 §3.4](../03-data-model.md))
is intact: a World is one more thing that can do the selecting, visibly, with the
result editable afterwards.

**The check that proves the distinction held:** after creating a session in a
World, `session.lore` names the books — as data, on disk, editable. If the books
reach the prompt without appearing there, this stage rebuilt P5.7.

**And [26 B15](../26-open-questions.md)'s default changes with it**: a new book's
scope becomes `linked` with an empty actor list rather than `global`. That is a
change to a factory default rather than to the schema, and the importer's
fallback wants the same treatment — but note that **an imported book that says
`global` keeps saying it**, because the format carries it and imports preserve
what they are given.

### 1.3 The bible is a reader, and the risk is that it quietly stops being one

[15 §7](../15-world.md) is emphatic: derived, never authoritative, and editing it
means editing the thing underneath. The build risk is not that somebody
disagrees — it is that a derived view over four sources is slow enough that
caching it looks obviously correct, and a cache that survives a restart is a
store.

**The rule to hold:** whatever this stage caches must be reconstructible by
deleting it. That is the same posture [P6](18-p6-implementation.md) took for the
snapshot cache, and the same test applies — drop the cache, rebuild, compare.

### 1.4 What this phase does *not* decide

- **The wire shape.** `contents` beside `members`, or member folders inside the
  zip, with [15 §4](../15-world.md) leaning to the second. This phase owes it no
  answer, and the stored form works either way.
- **Memory book granularity.** [P8 §1.2](25-p8-implementation.md) holds that,
  deliberately, until real volume data exists. What this phase supplies is the
  key, not the filing.
- **`Provenance.source`'s `'package'` literal.** It has no writer, and removing a
  union member from a stable shared substructure would be a breaking change
  across five published schemas. It waits for a decision of its own and must not
  be quietly fixed here.

### 1.5 Two stages ship against a guess, and this is the honest accounting

**Pulling World into 1.0 spends an argument the release ordering was built on.**
[work plan §0](01-work-plan.md)'s criterion is *what must have happened first*,
and five of the six tiers were gated on something having been **used**. World's
gate was 4.0 because *a World is worth nothing until the third session* — a
continuity container designed before any continuities exist is designed against a
guess, and the shape of the guess would be the shape of the feature.

**Half of that argument died correctly and half of it did not.** Membership and
transport never needed accumulated play: a set of objects with a name is
authorable on day one, and [15 §2](../15-world.md) records why the old claim
fell. But **the continuity behaviours are exactly what the gate protected** —
world-scoped memory, lore contribution, hook suppression across sessions, and the
bible. §2.4 and §2.5 are therefore built against imagination, which is the thing
the ordering criterion exists to prevent.

**This is accepted rather than argued away**, and what makes it survivable is
that [15 §11](../15-world.md) rewrote its falsification tests for exactly this
case. Three of them become runnable the moment this phase ships, and the phase
should be read as *the first evidence*, not as the answer:

| Watch | What a bad result means |
|---|---|
| Worlds created but never published | The durable object was scaffolding for an export, and the old note was right |
| `LoreScope` never set by anyone | Contribution is not what worlds are for, and §1.2's variant is ceremony |
| Members per World, by kind | All-lorebooks means this is a lorebook collection with extra steps |

**The revisit before this phase opens should ask one question**: has PLAYABLE
produced any session worth putting in a World? If the answer is no, §2.4 and
§2.5 are the stages to cut to a later phase, and §2.1 through §2.3 still stand on
their own.

## 2. Stages

Membership first, because everything below rests on it. Each stage names its end
condition, because *a green suite closes a stage, not a phase*.

### P8A.0 — The kind, finished

**Half-done before the phase was planned.** `448c53e` landed
`storyengine.world/1`, `world.json`, `library/worlds/`, the registry entry, the
factory and the emitted JSON Schema. What remains:

- The `LoreScope` `world` variant (§1.2), additive, with the importer and
  `newLorebook` default moved to `linked` with an empty actor list.
- Whatever [15 §4](../15-world.md)'s stored shape needs beyond the envelope —
  `members` as refs, and the contribution fields.

**Ends when** the round-trip fixture covers a World with members,
`registry.test.ts` and `layout.test.ts` are green on the new names, and a
repo-shape assertion holds the reach: **one union variant, and no second
exception** ([work plan §0.2](01-work-plan.md)).

### P8A.1 — Membership, the panel and the editor

The World as something a person can make and fill. The library panel — the sixth,
renamed rather than added — the editor that
[P11.2](28-p11-implementation.md) used to owe the old kind, backlinks
([10 §5.2](../10-ui-surfaces.md)), and the detail page.

**The editor is a picker over the objects you own**, which is what
[manual testing §10](05-manual-testing.md) predicted when it placed the editor
for the old kind. Nothing about that changes except which phase builds it.

**Ends when** a person can create a World, add and remove members of every kind,
see it from a member's backlink panel, and delete a member without the World
blocking it — a dangling ref, visible and non-blocking, is the correct outcome
and should be walked rather than asserted.

### P8A.2 — Contribution

Session creation in a World copies what it needs: books into `session.lore`, the
treatment baseline, the hook pool. Prefill, never binding
([00 §3.1](../00-stance.md)).

**Ends when** §1.2's check passes — the books are named in `session.lore` on
disk, editable, and nothing reaches the prompt that is not selected there.

### P8A.3 — Accrual

The session's world ref (§1.1, with P11's freeze window in mind); world-scoped
memory as the fourth key [08 §8](../08-cross-session-memory.md) named; hook
suppression and `introduces` widened from session scope to World scope.

**The third of those is nearly free and the reason is worth keeping visible**:
a copied hook keeps the source hook's id, which shipped at P7.5 and is pinned by
`hook-pool.test.ts`, and `introduces` suppression keys on the **subject** rather
than the hook, which is right in the code as of P7.5. [15 §5](../15-world.md)
graded the first of those *real, and unrecoverable if missed*. It was not missed.
Only the scope widens.

**Ends when** a hook fired in session one is not offered in session two of the
same World, and a character introduced in session one has no first arrival left
to stage in session two.

### P8A.4 — The story bible

A reader over records that already exist ([15 §7](../15-world.md)): who exists
and what is known about them, what state the channels hold, which lore entries
fired and when, which goals completed and where.

**Ends when** the demo's last clause is true — the bible names who exists without
anyone having written that down — and §1.3's cache rule holds: drop it, rebuild,
compare.

## 3. Verification — the P8A exit gate

Split under [manual testing §0](05-manual-testing.md)'s two-tier rule.

**The critical list, walked by a person before the phase closes.** Derived by
§0's three-clause criterion — unrecoverable if wrong, invisible to the suite, or
first contact with a real person:

1. **Create a World, fill it, start two sessions in it.** The demo, walked end to
   end. This is the phase.
2. **Delete a member that a World holds and a session copied.** Three things must
   be true at once: the delete succeeds, the World's ref dangles visibly, and the
   session that already copied the book is unaffected. This is the one that
   distinguishes membership from ownership, and no test states it as a whole.
3. **Import a World whose books say `global`.** §1.2's reversal, approached from
   the import side. The books must not reach any session they were not selected
   for.
4. **Open the bible on a session with nothing in it.** Empty-state behaviour on a
   derived view is where *this never happened* and *this is empty* get confused
   ([03 §8.1](../03-data-model.md)).

**The remainder extends the standing list** ([manual testing §5](05-manual-testing.md))
and drains continuously: the panel's columns and empty state, the editor's picker
at scale, the backlink panel from each member kind, and the bible over a long
session.

**The gate's own steps are never edited to match what was walked.** A second
table records what was answered.

## 4. Out of scope, deliberately

- **The exchange work.** `.seworld` reading and writing, the closure walker and
  Publish's surface stay at [P11](28-p11-implementation.md). The change this
  phase makes to that stage is that it fills a kind that exists rather than
  inventing the container, the walk and the review together
  ([work plan §0.5](01-work-plan.md)).
- **Session export.** Also P11's, and [16 §4](../16-publish.md) makes it the same
  walk from a different starting point rather than a second serialiser.
- **Memory book granularity** — [P8 §1.2](25-p8-implementation.md)'s, on volume
  data this phase does not produce.
- **Lorebook extraction from a session.** It reads the bible and is therefore
  unblocked by this phase, but it belongs to the authoring tier at 5.0
  ([17 §3](../17-authoring.md)). *Unblocked is not scheduled.*
- **Continuity checking** ([25 §2c.2](../25-roadmap.md)). The bible is what makes
  it possible; it is not a down payment on it.
- **Anything that makes a World collaborative.** [15 §10](../15-world.md) is
  explicit, and sharing between users on one install stays deferred
  ([03 §5](../03-data-model.md)).

## 5. What only the revisit can settle

Written now so the revisit has a list rather than a blank page.

- **Whether §1.5's guess held.** The question at the top of the revisit: has
  PLAYABLE produced sessions worth grouping? A no makes §2.3 and §2.4 the stages
  to defer, and this document should be read as having said so in advance.
- **Whether the panel is the sixth or the seventh.** Six is the shape
  [10 §5.1](../10-ui-surfaces.md) builds against and marks *for now*; a
  manuscript panel arrives at 2.0 ([13 §5.3](../13-write-mode.md)). This phase
  does not add one — it renames one — but it is the phase that finds out whether
  six was ever the right number.
- **What the editor does about a World with three hundred members.** The picker
  is specified at the scale a household has and nothing has tested the other one.
- **Whether the bible wants a cache at all.** §1.3 forbids one that survives a
  restart; whether it needs one in the first place is a measurement this phase
  takes rather than a decision it makes.
