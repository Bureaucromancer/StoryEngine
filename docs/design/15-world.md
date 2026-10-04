# 15 — World: the continuity container

**Status: proposal.** A World is a grouping of sessions that share a continuity —
history available as context across them, a shared starting set of lorebooks and
a shared treatment baseline, with the stylistic particulars still varying per
session. *"The Rain City campaign"*, holding six sessions that know about each
other.

***Decided 2026-10-03, and not yet written here — read [25 B17](25-open-questions.md)
first.*** The owner took the `worlds` branch's argument in part: a World
becomes **the durable named set, and replaces Package** — membership, transport,
and contribution to a session's lore through a `world` arm on `LoreScope`.
**Accrual and §4's story bible wait for real play**, which is §2's reason for
4.0 applied to the half it still fits. This note still describes the design that
decision overrides until a design step rewrites it, so its 4.0 schedule and
§3's *not a portable kind* and *out of the export surface* are marked below as
superseded pending that step; the rest of the note has not been reread against
it. The branch's rewrite of this note and its new *16 — Publish* are in
`162b4a61` (whose subject says *renames only*), and its P8A plan in `d8656c68`;
both are reachable through the second parent of `main`'s merge of `worlds`, and
neither is adopted as written.

~~**Scheduled for 4.0** ([work plan §0](workplan/01-work-plan.md)).~~ *Superseded
2026-10-03, pending the design step: when World lands is that step's to say, and
[25 B16](25-open-questions.md) gives the rename a deadline ([25 B17](25-open-questions.md)).*
Like [12](12-account-gallery.md) and
[13](13-write-mode.md) it is a design note that arrived after the original run
rather than a new tier of document, and it reads after
[03](03-data-model.md) and [08](08-cross-session-memory.md), whose session model
and memory keying it widens.

This note began as §2c.1 of [24](24-roadmap.md), where it was a roadmap entry with
an obligations table framed as insurance against a feature that might never
happen. It moved here when World became a committed release, and the framing
moved with it: **§5's obligations are requirements now, not hedges.**

> **A Setup is a starting configuration; a World is an accumulating history.**

---

## 1. What it is, and why it is real rather than invented

**Two existing open questions are what this answers**, which is the argument for
it being a real object rather than a nice idea:

- [08 §8](08-cross-session-memory.md) carries *"cross-session memory for the
  narrator rather than a character — 'the GM remembers your last campaign'.
  Coherent, and **a different scope key**."* Memory today is keyed
  `(user, actor, persona)` — character-centric. A World is the world-centric key
  that question noticed was missing and did not name.
- §4's story bible is defined as *"what a **session** has established."* A World
  is that widened across sessions, and the bible's discipline carries over
  unchanged: **derived, never authoritative.**

**The word was reserved at 1.0 and is spent here.**
[10 §2.1](10-ui-surfaces.md) declines to use "World" as a library label
precisely so that this can have it. That was a cheap decision when this was a
roadmap entry and it is a vindicated one now.

## 2. What separates it from Setup

They will otherwise be confused, and the distinction is the whole design:

**A Setup looks forward at one game and is complete the moment play begins. A
World looks backward across many and is worth nothing until the third session.**

That is also why it cannot be modelled as "a Setup with several sessions" — its
entire value is in what *accrues*. A Setup that has been used twice is unchanged;
a World that has been played twice is a different object from the one that was
created.

It is also why 4.0 is the right release rather than an earlier one
([work plan §0](workplan/01-work-plan.md)): a continuity container designed
before any continuities exist is designed against a guess, and the shape of the
guess would be the shape of the feature.

## 3. It is a play-side object, not a portable kind

*(Superseded in part 2026-10-03, pending the design step —
[25 B17](25-open-questions.md). A World that replaces Package is a portable kind:
Package's place, so the sixth rather than a seventh, and the thing that travels.
The first bullet's count survives that; the second bullet does not, and is
struck; the third, that World is not a surface, the decision does not touch. The
heading and the argument are kept as what was decided against.)*

Per [10 §2.1](10-ui-surfaces.md), the library represents objects as they are and
Play carries the conveniences. Grouping your own sessions is a convenience over
sessions, not a seventh portable kind.

Three things follow, and each is a constraint worth holding:

- **No new library panel, and no seventh kind in [04](04-schemas.md).** The
  release check in [work plan §0.2](workplan/01-work-plan.md) states this as a
  commitment: *World at 4.0 must add no portable kind at all.*
- ~~**It stays out of the export surface**, which is right — a continuity is about
  *your* play, and the material underneath it already travels as a Package
  ([04 §9.1](04-schemas.md)). Someone who wants to share "the Rain City setting"
  is asking for the Package; someone who wants to share "my six Rain City
  sessions" is asking for session export ([25 B12](25-open-questions.md)), which
  is a different feature that already exists by then.~~ *Superseded 2026-10-03
  ([25 B17](25-open-questions.md)): the World is what a set travels as, because
  there is no Package left for it to travel beside.*
- **World is not a surface.** The name reads like one and it is not: it adds no
  top-level place to the application ([10 §2](10-ui-surfaces.md)). It is a
  grouping *within* Play, in the same sense that a folder is not a new
  application.

**The pressure to break the first two will be real**, and it will arrive the
first time somebody wants to share a World. The answer is that the shareable
part is already shareable, twice over, and what remains — which sessions of mine
belong together — is not information anyone else can use.

## 4. The story bible

**A derived view of what a continuity has established**, separate from its prose.
Who exists and what is known about them, what state the channels hold, which lore
entries have fired and when, which goals were completed and where.

It ships with World at 4.0 rather than separately, because **a continuity
container with no way to see what the continuity contains is half a feature.**
§1 defines a World partly *as* the bible widened across sessions; building the
container without the view would be shipping the definition's subject without
its predicate.

Nothing in it is new data. Actors and their presence come from
[06 §8.1](06-modes-and-turn-pipeline.md); established facts come from extraction
steps whose output already lands as channel effects; lore activation history is
in every turn record ([03 §8](03-data-model.md)); the goal chain is in its own
channel ([06 §7.3.4](06-modes-and-turn-pipeline.md)). **The bible is a reader**,
in the same sense that the workbench is a reader — which is why it is cheap, and
why it was worth designing the record to be complete.

Two reasons it earns a place rather than being a nicety:

- **People already do this by hand.** The spreadsheet-beside-the-session is a
  well-known habit in long-form RP, and it exists because the information is
  genuinely scattered and genuinely needed. Software that has all of it and shows
  none of it is leaving the obvious on the table.
- **It is the appendix to the reading view** ([10 §12](10-ui-surfaces.md)). One
  answers *what happened*, the other *what is true*, and a long story wants both.

**Where it must not go:** the bible is derived, never authoritative. Editing it
means editing the thing underneath — a channel, an actor, a lore entry — not
writing to a parallel store. A bible that could drift from the sessions it
describes would be [00 §2.8](00-stance.md)'s derived-data-persisted-as-truth
failure in a new costume.

**It has a second consumer at 2.0.** Write's outline is what a manuscript
*intends*, where the bible is what play *established*
([13 §10](13-write-mode.md)); the two want the same derived-never-authoritative
discipline, and the second one built should reuse the first one's shape rather
than inventing a parallel view.

**Continuity checking is not part of this.** Reading established state back
against recent turns to flag contradictions is a separate, more expensive
feature with a false-positive problem the bible does not have, and it stays on
the feature list ([24](24-roadmap.md)). The bible is what makes it *possible*
later; it is not a down payment on it.

## 5. What this obliges 1.0 to do

**These are requirements, not insurance.** As a roadmap entry this table was a
list of cheap options worth keeping open. As a committed release it is a list of
things that must be true when P7 and P8 close, and two of them are
unrecoverable if missed.

| Element | Obligation | Lands |
|---|---|---|
| Sessions belong to a World | **None.** Sessions are the *free to move* tier ([04 §1](04-schemas.md)) — internal, migrate at will. | — |
| Shared lorebooks, shared treatment baseline | **None, by construction.** Prefill-not-binding ([00 §3.1](00-stance.md)) means session creation *copies*; a World is one more prefill source. Per-session divergence is already the default rather than a feature to add. **But see §5.3** — a question was left open here at [P5.7] that this element is the natural owner of. | — |
| World-scoped memory | **Small, and now decided rather than noted.** Memory books must not hard-code the `(user, actor, persona)` three-tuple into how they are keyed and named on disk. [08 §8](08-cross-session-memory.md)'s open question about book granularity is to be settled knowing a fourth key is coming. | P8 |
| Hook identity survives the copy | **Real, and unrecoverable if missed.** §5.1 | P7 |
| Introduction hooks key on the subject | **Real, and cheap.** §5.2 | P7 |

### 5.1 Hook identity must survive the copy

[03 §4.1](03-data-model.md) has session creation *copy* hooks from all sources.
Within a World, a hook fired in session one must not fire again in session two —
the same *"firing a hook about someone who died four sessions ago"* failure that
document calls severe, reached by a different route.

Cross-session de-duplication is only possible if a session's copied hook keeps
the **source hook's `id`** rather than getting a fresh one. `PlotHook.id` exists
and `blockedBy` / `notBefore.afterHook` already reference ids, so the field is
there; what needs pinning at P7 is that copying preserves it. **One line now,
unrecoverable later** — a corpus of sessions whose hooks have unrelated ids
cannot be retro-fitted into a continuity, because the information that would
link them was never written.

Where the firing record itself lives is orthogonal: that state is a channel as
of [03 §4.1](03-data-model.md), and the obligation was always about the *id*
surviving the copy.

### 5.2 An introduction hook needs a second key, and id is not it

[04 §6.1a](04-schemas.md)'s `introduces` fires on a character rather than an
event, so the failure it must avoid is *this person arriving for the first time,
twice*. Id-matching catches only the case where the **same hook** fired before;
it misses the commoner one, where a different hook — or the narrator, unprompted
— introduced them in session one.

So within a World the suppression key is the **subject**, not the hook: a
character already introduced in this continuity has no first arrival left to
stage. This costs 1.0 nothing, because the *introduced* predicate it needs
already exists per-session ([06 §8.1](06-modes-and-turn-pipeline.md)) and only
its scope widens.

### 5.3 Inheritance is what would give `LoreScope` a consumer again

*Recorded at [P5.7]'s reversal, because this is where somebody will be standing
when the question next matters.*

**A lorebook reaches a session by being selected, and by nothing else**
([03 §3.4](03-data-model.md)): `session.lore`, or the treatment the session
names. P5.7 briefly let a book's own `LoreScope` admit it — `global` everywhere,
`linked` wherever one of its actors was cast — and that was reversed within the
day. `global` is the factory default *and* the SillyTavern importer's fallback,
so the effect was a person's entire library appearing in every session's prompt
with no way out but hand-editing JSON. A library is not a world; that sentence is
this document's own premise, arriving from the other direction.

So `scope` is stored, exported, preserved across import — and read by nothing.
**Worlds is the shape that could change that**, and it is the only one on the
table: something *above* the session contributing books is exactly what a `scope`
of `global` was reaching for and had no legitimate way to express. If that
arrives, three things have to be decided together rather than one at a time:

- **What inherits.** A World contributing lorebooks is a prefill source like any
  other under the row above, which means it *copies into* `session.lore` at
  creation and stays selected — not a live query that re-decides every turn. That
  keeps the rule intact rather than carving an exception into it.
- **Whether `scope` then narrows** a book the session has chosen —
  [25 §B14](25-open-questions.md), left open on purpose, with the argument for
  both answers written down.
- **What a new book's `scope` should default to** — [25 §B15]. `global` is the
  widest value in the union and the current default, which is precisely why P5.7
  went wrong so fast.

The trap to avoid is the one already sprung once: inferring a *behaviour* from
the union's wording because "where it applies" sounds like a rule. It describes a
shape. What consumes it is a separate decision, and this section is where it gets
made.

## 6. A known collision, recorded rather than rediscovered

Two *stable-tier* schemas already spend the word. `PlotHook.magnitude` no longer
does, but `Lorebook.category: "world" | …` still carries it, and
`hook.magnitude` was renamed away from `scope: "world"` for exactly this reason
([04 §5](04-schemas.md), [04 §6.1](04-schemas.md)). `category` is gone as of that
same pass, so what remains is ordinary lowercase prose — "world facts", "the
world as a whole" — which coexists with a capital-W kind without real ambiguity.

Portable schemas cannot be cleaned up later without a version bump
([04 §2](04-schemas.md)), so **any new use of the word in a portable structure
between now and 4.0 should be refused.**

## 7. Non-goals

- **Not a shared or collaborative world.** A World belongs to one user, like
  every other play-side object. Real multiplayer stays where
  [09 §8](09-server-multiuser-deployment.md) put it.
- **Not an authoring surface.** A World accumulates from play; it is not a place
  to write a setting. Writing a setting is a Package
  ([04 §9.1](04-schemas.md)), and the play-to-authoring direction is lorebook
  extraction, which is a separate feature.
- **Not automatic.** Sessions do not join a continuity by resembling each other.
  A World is something a person makes and puts sessions into, for the same
  reason chapterisation is manual ([25 E1](25-open-questions.md)): a human knows
  where a continuity's edges are and a heuristic does not.
- **Not a second memory store.** World-scoped memory is the existing memory
  mechanism with a fourth key, not a parallel system
  ([08](08-cross-session-memory.md)).

## 8. How we would know this was wrong

Two of these run long before anything here is built, which is the point of
writing them down now.

**Runnable at 1.0, against real play:**

- **Watch whether anyone plays a second session in the same setting.** The whole
  premise is that continuity across sessions is a thing people want and
  currently fake. If sessions are overwhelmingly one-offs, a World is a
  container for a habit nobody has, and the feature is the story bible alone —
  at session scope, where §4 says it already earns its place.
- **Watch what people put in session names.** If they are hand-encoding
  continuity — *"Rain City 3"*, *"Rain City 4"* — that is the feature asking to
  exist, and it is also the cheapest possible evidence for it.

**Runnable once World exists:**

- **Count Worlds with fewer than three sessions.** §2 claims a World is worth
  nothing until the third. If most never reach it, the object was created
  eagerly and abandoned, and it wants to be derived from play rather than
  declared up front.
- **Watch whether the bible gets opened.** If the container is used and the view
  is not, §4's claim that they are one feature was wrong, and the bible is a
  reading-view appendix rather than a World surface.
