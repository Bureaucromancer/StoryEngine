# 15 — World: the canon, and the thing that travels

**Status: proposal.** A World is a named set of objects that share a canon —
actors, lorebooks, treatments, setups, presets and sessions — together with what
accrues from playing in it. *"Rain City"*, holding the books, the cast, the
readings and the six sessions that know about each other.

**Scheduled for 1.0** ([work plan §0](workplan/01-work-plan.md)), which is a
change from 4.0 and is not the largest change this document has taken. Like
[12](12-account-gallery.md) and [13](13-write-mode.md) it arrived after the
original run rather than as a new tier of document, and it reads after
[03](03-data-model.md) and [08](08-cross-session-memory.md), whose session model
and memory keying it widens.

> **A Setup is what a game is. A World is the canon that game is in.
> [16](16-publish.md) is how either one leaves.**

---

## 0. What this document used to say, and why it stopped

**This note is a rewrite rather than a revision, so the old positions are
recorded here rather than struck line by line through a document that no longer
has the same shape.** It said:

> A World is a grouping of sessions that share a continuity […] Grouping your
> own sessions is a convenience over sessions, not a seventh portable kind.

and built four refusals on it — no portable kind, no library panel, out of the
export surface, not an authoring surface. Every one of those reverses below, and
the reversal is not a change of mind about what a continuity is. It is the
discovery that **the object this document was describing and the object
[04 §9](04-schemas.md) was describing were the same object**, approached from
opposite ends and each refusing the half the other had.

**The defect that proves it.** [06 §4.1](06-modes-and-turn-pipeline.md) widens
`ChannelDefinition.owner` to accept a package id, and has packages carry a
`rules` collection — so a package can own live session state and state rules
about it. But [04 §9](04-schemas.md) makes a package's contents *embedded copies
resolved on import*: the container dissolves the moment it arrives. **A channel
owned by a package points at something that no longer exists.** What that field
needs is a durable, in-install, authored object the engine can read at turn
time, and that is what this document described and declined to build.

**And the same shape, arriving from here.** §5.3 of the old note observed that
`LoreScope` is stored, exported, round-tripped and read by nothing, and that
*"Worlds is the shape that could change that, and it is the only one on the
table"* — something above the session contributing books. That is a durable
object the engine reads at turn time, described again, by a document whose §3
had just refused to build one.

Two documents were each holding half of one thing. **So Package is renamed
rather than joined**: `storyengine.package/1` became `storyengine.world/1` at
`448c53e`, the six portable kinds are still six, and this note now owns the kind
that [04 §9](04-schemas.md) defines.

**What did not change** is the continuity argument, which is why §6 reads
almost as it did. A World still accumulates, memory still gains a fourth key,
hooks still stop firing twice. What changed is that accumulating is no longer
the *only* thing a World does, and therefore no longer the only thing it can be
worth.

## 1. What it is, and why it is one object rather than two

**A World answers one question — *what is in this canon* — and three things
follow from the answer rather than being bolted to it.**

| | What it is |
|---|---|
| **Membership** | Which objects belong. Refs, not copies: the objects live in the library and the World names them. §4 |
| **Contribution** | What a session created in this World starts from — books, a treatment baseline, hooks. Prefill, never binding. §5 |
| **Accrual** | What playing in it leaves behind: world-scoped memory, hooks that will not fire twice, a bible. §6 |
| **Transport** | The `storyengine.world/1` envelope, its `requires` and its provenance. [16](16-publish.md) fills it. §7 |

**None of those four is a feature added to a bundle.** Each is what a set of
objects sharing a canon obviously does once the set is a thing the software
knows about. The reason Package could not do them is that it was specified to
stop existing on arrival, and the reason the old World could not is that it was
specified to hold only sessions.

**Two prior open questions are answered by the same move**, which remains the
argument for this being a real object rather than a nice idea:

- [08 §8](08-cross-session-memory.md) carries *"cross-session memory for the
  narrator rather than a character — 'the GM remembers your last campaign'.
  Coherent, and **a different scope key**."* Memory is keyed
  `(user, actor, persona)` — character-centric. A World is the world-centric key
  that question noticed was missing and did not name.
- §7's story bible was defined as *"what a **session** has established"*. A
  World is that widened across a canon, and the bible's discipline carries over
  unchanged: **derived, never authoritative.**

## 2. What separates it from Setup

They will otherwise be confused, and the distinction is still the whole design —
but it is no longer the one this document used to make.

**The old distinction, and why it fell.** It read:

> A Setup looks forward at one game and is complete the moment play begins. A
> World looks backward across many and is worth nothing until the third session.

That is true of a World that can *only* accrue, and false of one that can also
be authored. Five objects and a name is a World on day one, with no sessions in
it at all — and refusing that was refusing the thing people most obviously want
to do, which is write a setting down and hand it to somebody.

**The distinction that replaces it, and it is sharper:**

> **A Setup is one configuration. A World is the set a configuration draws
> from.**

One World, many Setups — the same one-to-many that already runs between
Lorebook, Treatment and Setup ([04 §7](04-schemas.md)), one level up. *Rain
City* the World holds the books, the cast and three readings of them; *The
Fixer's Debt*, Freeform, playing Marlow is a Setup inside it. That ladder is
learned by making a second Setup in a World you already have, which is the
teaching [10 §5.1](10-ui-surfaces.md) moved to Play and which now has one more
rung.

**It still cannot be modelled as "a Setup with several sessions"**, and the old
note's reason survives intact: a Setup that has been used twice is unchanged,
and a World that has been played in twice is a different object from the one
that was created. What is new is that a World that has *never* been played in is
also a real object, because membership is worth something before accrual starts.

## 3. It is a portable kind, which reverses this document's central refusal

The old §3 said *"no new library panel, and no seventh kind"*, and cited
[work plan §0.2](workplan/01-work-plan.md)'s release check: **World must add no
portable kind at all.**

**That check passes, and not on a technicality.** No portable kind was added.
The kind that exists was renamed, and the count is what it was — six. The check
was written to stop a play-side convenience from growing into a format
commitment nobody had designed; what happened instead is that a format
commitment that already existed turned out to be this. [work plan §0.2](workplan/01-work-plan.md)
carries the replacement check, which is the one still worth running: **World
must change no other portable schema** — not Actor, Lorebook, Treatment, Setup
or Preset.

The old §3's three consequences reverse together, and the paragraph that
predicted the reversal is worth quoting because it was right about the pressure
and wrong about the answer:

> **The pressure to break the first two will be real**, and it will arrive the
> first time somebody wants to share a World. The answer is that the shareable
> part is already shareable, twice over, and what remains — which sessions of
> mine belong together — is not information anyone else can use.

The pressure arrived as predicted. The answer did not hold, because *the
shareable part is already shareable* was describing a Package, and the Package
is this. Sharing "the Rain City setting" and sharing "my six Rain City sessions"
were sent to two different features by that paragraph; §7 makes them one action
with a checkbox.

**So: a library panel, an export surface, and a kind.** What survives untouched
is the third clause — **World is not a surface.** It adds no top-level place to
the application ([10 §2](10-ui-surfaces.md)). It is a library kind with a panel,
like the other five, and [16](16-publish.md) is a flow rather than a fourth
surface.

## 4. Membership, and the one distinction everything rests on

**A stored World names its members. A published World carries them.**

| | Holds | Why |
|---|---|---|
| **Stored** (`library/worlds/<slug>/world.json`) | refs | The objects live in the library and are edited there. A World holding copies would be a second representation of every object in it — [00 §2.8](00-stance.md), at scale |
| **Wire** (`.seworld`) | the objects | *"The only reliable way to ship something working to someone whose library you know nothing about"* ([03 §7.2](03-data-model.md)), unchanged |

**Embedding is a fact about the file; linking is a fact about the store.** Get
it backwards in either direction and one of two failures follows: a stored World
full of copies drifts from the library the moment anyone edits anything, and a
wire form full of refs strands every recipient.

**Import is where the two meet.** The objects arrive as real library objects,
resolved through the ordinary review step ([10 §5](10-ui-surfaces.md)), and the
World that arrives with them names what landed. Links inside the file resolve
within it first, then locally, then dangle visibly
([00 §3.3](00-stance.md)) — which is [04 §9](04-schemas.md)'s rule unchanged,
now with somewhere for the result to be kept.

**[OPEN] Which of two wire shapes.** `04 §9`'s `contents: PortableObject[]`
array, kept beside a stored `members` list; or member object folders inside the
`.seworld` zip with `contents` retired, per
[03 §5.2.3](03-data-model.md)'s folder-as-file. The second is one field rather
than two, and unknown-kind preservation becomes *an unrecognised folder is
carried through* — the same property by a cheaper mechanism. **Lean: the
second.** The first is what is specified and emitted today, and it costs two
fields describing one relationship.

**A member that is deleted or edited afterwards.** Edited: the World sees the
edit, because it holds a ref and that is the point. Deleted: the ref dangles
visibly and non-blockingly, like every other dangling reference in this system
([00 §3.3](00-stance.md)). **A World never blocks a delete**, which is the
[26 B2](26-open-questions.md) answer applied one level up — a container that
could refuse to let go of an object would make membership an ownership claim,
and it is not one. An object may belong to several Worlds.

**Sessions are members like anything else**, and that is what collapses the old
§3's two features into one. A session's membership is the session's own — see
§6 — but it appears in the member list beside the books, and whether it reaches
the wire is [16](16-publish.md)'s review step rather than a property of the
kind. A World published without its sessions is *the Rain City setting*; with
them, it is *my six Rain City sessions*. Prologue packages
([26 B10](26-open-questions.md)) are the same mechanism with one session ticked,
and need no feature of their own.

## 5. Contribution, and `LoreScope` finally has a consumer

**A World is a prefill source, exactly like a Treatment.**
[00 §3.1](00-stance.md)'s prefill-not-binding holds without amendment: creating
a session in a World **copies** what it needs — books into `session.lore`, the
treatment baseline, the hook pool — and there is no live pointer back.
Per-session divergence is the default rather than a feature to add.

**This is the answer the old §5.3 left open**, and it is the first of its three
sub-questions, taken as it was written: *a World contributing lorebooks copies
into `session.lore` at creation and stays selected — not a live query that
re-decides every turn.* The rule that **a lorebook reaches a session by being
selected, and by nothing else** ([03 §3.4](03-data-model.md)) is intact; what
changes is that a World is now one of the things that can do the selecting, at
creation, visibly, with the result editable afterwards like any other selection.

**`LoreScope` acquires a consumer, which is what [P5.7] reversed for want of
one.** That reversal is worth restating because this is the shape it was waiting
for: P5.7 briefly let a book's own scope *admit* it to a session — `global`
everywhere — and since `global` is the factory default *and* the SillyTavern
importer's fallback, a person's entire library appeared in every prompt. The
lesson was recorded as **a library is not a world**. It still is not. A World
is a *subset* of a library that somebody named, which is precisely the thing
`global` was reaching for and had no legitimate way to express.

So the union gains one variant:

- `{ kind: 'world', worldIds: string[] }` — contributes at session creation to
  sessions started in one of those Worlds.

**And the test that makes this variant legitimate is one the schema already
applies to a rejected sibling.** `lorebook.ts` refuses session scoping in as
many words: *"Session ids are install-local, so a shared lorebook carrying them
exports identifiers that are meaningless everywhere else."* A world id is not
install-local. A World is portable and carries a stable id, so a book scoped to
one means the same thing on the install it arrives at — it travels *with* the
World that gives it meaning. That is the difference between the two variants and
it is the whole reason one is refused and this one is not.

**[26 B15](26-open-questions.md) is answered by consequence.** A new book's
scope defaulted to `global` because nothing read the field; now something does,
and *"a field nobody sets should not default to the widest value in its own
union"* becomes actionable. The default is **`linked` with an empty actor
list** — the narrowest honest statement, meaning *this book has not said where
it applies*, with the same effect as today for a book nobody scopes. `global`
stays in the union because the format carries it and imports must preserve it.

**[26 B14](26-open-questions.md) keeps its answer, which is no.** Scope
contributes; it does not narrow a book the session has already chosen. A person
who selected a book and sees nothing from it would have to learn that a field on
the *book* overruled their choice, and that is the same class of silent surprise
the reversal removed, pointing the other way.

## 6. Accrual, and what a continuity is for

**This is the half of the old document that survives**, and it is why a World
that has been played in is a different object from the one that was created.

**A session carries its World, and the direction is deliberate.** Membership of
library objects lives on the World, because curating a set is something you do
to the set. A session's World lives on the *session*, because it is decided at
creation and is part of what the session is — it is the memory key, and a key
that had to be found by reverse lookup on every turn would be a key in name
only. The two directions are not two copies of one fact: they are membership of
different things.

**Three behaviours key on it**, and two of them already have their machinery:

- **World-scoped memory.** The fourth key [08 §8](08-cross-session-memory.md)
  named and could not supply. Not a second memory store — the existing mechanism
  with one more scope, which is why [P8 §1.2](workplan/25-p8-implementation.md)
  was told to decide book granularity *knowing a fourth key is coming* and can
  now decide it knowing what the key is.
- **A hook fired once does not fire again.** Session creation copies hooks from
  every source ([03 §4.1](03-data-model.md)), and within a World a hook fired in
  session one must not fire in session two — the *"firing a hook about someone
  who died four sessions ago"* failure reached by another route. This works only
  because a copied hook keeps the **source hook's id**, which shipped at P7.5
  and is pinned by a test. That was the obligation this document graded *real,
  and unrecoverable if missed*; it was not missed.
- **An introduction has one first time.** [04 §6.1a](04-schemas.md)'s
  `introduces` fires on a character rather than an event, so the failure to
  avoid is *this person arriving for the first time, twice*. The suppression key
  is the **subject**, not the hook — id-matching catches only the case where the
  same hook fired before, and misses the commoner one where a different hook, or
  the narrator unprompted, introduced them already. That key is right in the
  code as of P7.5; only its scope widens from session to World.

## 7. The story bible

**A derived view of what a canon has established**, separate from its prose. Who
exists and what is known about them, what state the channels hold, which lore
entries have fired and when, which goals were completed and where.

It ships with World rather than separately, because **a canon with no way to see
what is in it is half a feature.** §1 defines a World partly *as* the bible
widened; building the container without the view would be shipping the
definition's subject without its predicate.

Nothing in it is new data. Actors and their presence come from
[06 §8.1](06-modes-and-turn-pipeline.md); established facts come from extraction
steps whose output already lands as channel effects; lore activation history is
in every turn record ([03 §8](03-data-model.md)); the goal chain is in its own
channel ([06 §7.3.4](06-modes-and-turn-pipeline.md)). **The bible is a reader**,
in the same sense the workbench is — which is why it is cheap, and why it was
worth designing the record to be complete.

Two reasons it earns a place rather than being a nicety:

- **People already do this by hand.** The spreadsheet-beside-the-session is a
  well-known habit in long-form RP, and it exists because the information is
  genuinely scattered and genuinely needed. Software that has all of it and
  shows none of it is leaving the obvious on the table.
- **It is the appendix to the reading view** ([10 §12](10-ui-surfaces.md)). One
  answers *what happened*, the other *what is true*, and a long story wants both.

**Where it must not go:** the bible is derived, never authoritative. Editing it
means editing the thing underneath — a channel, an actor, a lore entry — not
writing to a parallel store. A bible that could drift from what it describes
would be [00 §2.8](00-stance.md)'s derived-data-persisted-as-truth failure in a
new costume.

**It has a second consumer at 2.0.** Write's outline is what a manuscript
*intends*, where the bible is what play *established*
([13 §10](13-write-mode.md)); the two want the same
derived-never-authoritative discipline, and the second one built should reuse
the first one's shape rather than inventing a parallel view.

**Continuity checking is not part of this.** Reading established state back
against recent turns to flag contradictions is a separate, more expensive
feature with a false-positive problem the bible does not have, and it stays on
the feature list ([25 §2c.2](25-roadmap.md)). The bible is what makes it
*possible* later; it is not a down payment on it.

## 8. Transport, and what a World is not allowed to carry

The envelope is [04 §9](04-schemas.md) and is not restated here. Two properties
are this document's to hold rather than that one's, because both are about what
a World *means* rather than what it validates:

- **The container validates the envelope, never the payload kind.** A reader
  checks that each entry has a `schema` and an `id`, resolves what it recognises
  through the registry, and carries the rest through untouched. That is what
  keeps the kind stable when a new kind appears, and it survives the rename
  unchanged.
- **There is nowhere to put a connection.** [00 §3.2](00-stance.md) is enforced
  by the type system rather than by discipline: portable kinds have no field
  that could hold an endpoint, a key or a per-install toggle, so **importing a
  stranger's World cannot repoint your provider or flip your content rating.**
  The rename does not widen this and must never be allowed to — a World is
  authored content, and the content/production seam is what makes it safe to
  accept one.

**Rules travel; code does not.** [26 A2](26-open-questions.md)'s answer is
unchanged in substance and moves with the name: **a World may ship rules, never
code.** The security boundary is the closed vocabulary, which is why the
authoring tier ([17 §2](17-authoring.md)) can hand authors real power without
making an import a code-execution decision.

## 9. The word, and a collision this document created and then resolved

The old §6 recorded that two stable schemas had spent the word — `PlotHook`
renamed `scope: "world"` to `magnitude`, and `Lorebook.category: "world"` was
removed — and closed with a rule:

> **Any new use of the word in a portable structure between now and 4.0 should
> be refused.**

**That rule is void, and the thing it was protecting has happened
deliberately.** The word is now spent *in* a portable structure, as the name of
a portable kind, which is what the rule existed to keep available. It did its
job: the two collisions were cleared before the name was needed, and neither
schema has to be bumped now.

What replaces it is narrower and still worth holding: **lowercase "world" in
prose means the material — the lorebook content — and capital-W World means this
kind.** *"A lorebook is the world; a treatment is how it is handled here"*
([03 §4](03-data-model.md)) stays true and stays lowercase. A World is the set
that holds the lorebook, the treatment and the rest.

**And one live ambiguity the rename exposes rather than creates.**
[06 §4.1](06-modes-and-turn-pipeline.md)'s `owner: ModeId | ExtensionId |
PackageId` uses "package" in two senses at once: the content bundle that section
argues for, and the first-party namespace P7 actually shipped —
`storyengine.lore`, `storyengine.cast`, `storyengine.goals`,
`storyengine.suggest`. Only the first becomes a World. That section is where the
two get separated; this one records that they were ever one word.

## 10. Non-goals

- **Not a shared or collaborative world.** A World belongs to one user, like
  every other library object. Sending somebody a file is not collaboration, and
  real multiplayer stays where [09 §8](09-server-multiuser-deployment.md) put
  it. Sharing between users *on one install* is still deferred
  ([03 §5](03-data-model.md)) and is not what this is.
- **Not automatic.** Sessions do not join a canon by resembling each other. A
  World is something a person makes and puts things into, for the same reason
  chapterisation is manual ([26 E1](26-open-questions.md)): a human knows where
  a continuity's edges are and a heuristic does not.
- **Not a second memory store.** World-scoped memory is the existing mechanism
  with a fourth key, not a parallel system ([08](08-cross-session-memory.md)).
- **Not an ownership claim.** An object can belong to several Worlds and to
  none. Membership never blocks a delete, never hides an object from its own
  panel, and never makes a World the thing you edit an actor through.
- ~~**Not an authoring surface.**~~ **This one inverts.** The old note said
  *"writing a setting is a Package"* and sent authoring away on that basis. A
  Package is a World, so the sentence now says that writing a setting is exactly
  this. What stays true is the narrower claim underneath it: a World is not a
  *text editor*. You author a world by making and linking its objects, each in
  its own editor, and the World is where the set is named and kept.

## 11. How we would know this was wrong

The old note's four tests were written against a World that could only accrue.
Two of them measured that assumption rather than the feature, and they go.

**What goes, and why.** *Count Worlds with fewer than three sessions* was the
falsifier for *worth nothing until the third session* — §2 no longer claims it,
so a World with zero sessions is a success rather than an abandonment. And
*watch whether anyone plays a second session in the same setting* tested whether
continuity was a habit anyone had; it is still worth watching, but it can no
longer condemn the feature, because a World that is only ever authored and
shared has done its job.

**What replaces them:**

- **Watch whether anybody makes a World that is not published.** The sharpest
  risk in this design is that a World is a folder with a fancy name — that
  membership is only ever a by-product of wanting to send something, and the
  durable object is scaffolding for an export. If every World is created by the
  publish flow and never opened again, the kind should not have been durable and
  the old note was right.
- **Watch whether `LoreScope` gets set.** §5 gives the field its first consumer
  after two years of being stored and read by nothing. If authors still never
  touch it, contribution is not the thing worlds are for and the variant is
  ceremony.
- **Count members per World, by kind.** A corpus of Worlds holding only
  lorebooks means this is a lorebook collection with extra steps, and the honest
  response is to say so. A spread across kinds is the claim that a canon is a
  set of mixed things, tested.
- **Watch whether the bible gets opened.** If the container is used and the view
  is not, §7's claim that they are one feature was wrong, and the bible is a
  reading-view appendix rather than a World surface. *Kept from the old note
  unchanged — it never depended on the assumption that fell.*
