# 08 — Cross-session memory

**Status: proposal.**

Characters should remember you between sessions. This document covers memory
*across* sessions. Memory *within* a long session is settled elsewhere: a
**rolling summary, built as an immutable chain** ([07 §5.1](07-branching.md),
[26 E1](26-open-questions.md)), with manual chapterisation a roadmap item
([25 §3](25-roadmap.md)).

Worth noting which way the dependency runs. Semantic retrieval is weak medicine
for lorebooks and strong medicine here — cross-session memories are numerous,
keyword-poor, and exactly the case where "what is relevant now?" has no lexical
answer ([26 E2](26-open-questions.md)). If embeddings are ever built, this
document is their first customer.

---

## 1. The requirement

- A character defaults to having prior sessions available, unless turned off.
- Each session has **two toggles**: whether it *shares* its memories, and
  whether it *intakes* memories from relevant actors.
- Beyond those, **manual association**: a list of the account's sessions, each
  individually forceable on or off regardless of the toggles.

---

## 2. Memories are a lorebook

The mechanism, and the reason this feature is smaller than it looks.

A memory is a discrete, keyed, retrievable piece of text with an origin and a
date. That is a lorebook entry. So:

> **Each (actor × persona) pair, per user, has an auto-maintained memory
> lorebook.** Entries are extracted from sessions; each carries a ref to its
> origin session and a timestamp.

Everything then already exists ([03 §3](03-data-model.md)): keyword and
similarity retrieval, the two-tier token budget, the trim order, skip reporting,
sticky and cooldown timing, the workbench showing exactly which memories were
injected and why. No new retrieval path, no new budgeter, no new UI for
inspecting what happened.

Three consequences worth having deliberately:

- **Memories are hand-editable**, because lorebook entries are. Users will want
  to correct a mis-extracted memory, and giving them the normal editor is free.
- **Memories are prunable and disableable individually**, per entry, with the
  affordances that already exist.
- **They must not be treated as authored content.** An auto-maintained memory
  book is *derived*, personal, and often full of things you would not hand
  someone. Mark it non-shareable by default and warn on any export path — this
  is the one place the reuse could bite.

### 2.1 What gets extracted

A step at session end, and periodically during long sessions, writes memory
entries. Manual capture — a "remember this" action on a message — should exist
too and is nearly free.

**Extract discrete facts and events, not summaries.** A summary is one blob with
one relevance; five memories are five things that can be retrieved
independently, attributed separately, and deleted individually when one turns
out to be wrong.

---

## 3. Scope: whose memory is it?

The part the naive version gets wrong.

**Memories are scoped `(user, actor, persona)`.**

- **Per user, absolutely.** Sessions are private ([09 §4.3](09-server-multiuser-deployment.md)),
  so Alice's history with Vera can never inform Bob's, even though it is the
  same card. Not a toggle. Not overridable.
- **Per actor**, which is the obvious axis and what the requirement means by
  "relevant actors".
- **Per persona, by default** — and this is the non-obvious one. If you play two
  personas, Vera remembering what she did with persona A while talking to
  persona B is both a coherence failure and a spoiler. She is talking to a
  different person, and she should know a different history.

Persona scope is a **default, not a law**: a setting widens it to "this actor
remembers across all my personas", which some people will want and which is
right for a single-persona install where the distinction is invisible anyway.

**[OPEN]** Whether an actor should remember *other actors* it shared sessions
with — Vera recalling that she and Tomas both know you. Appealing, and it
multiplies the scope matrix. Not at 1.0.

---

## 4. The toggles

Two per session, both defaulting **on**, and their asymmetry is the useful part:

```ts
interface SessionMemoryConfig {
  /** This session contributes memories to its actors' memory books. */
  share: boolean          // default true
  /** This session draws on memories from its actors. */
  intake: boolean         // default true
  /** Per-session overrides. Absent = governed by `intake`. */
  associations: Record<string, "always" | "never">
}
```

**This pattern is not unique to memory.** Marinara's Noodle carryover uses the
same shape — a toggle pushing activity *into* chats, a separate per-chat toggle
letting activity flow *back* ([25 §4.6](25-roadmap.md)) — and Messages mode's
autonomous messages are the same idea with the toggles implicit. Three features
converging on **two opt-in switches governing context flow between separate
activity streams** suggests the mechanism is worth naming and sharing rather
than implementing three times.

All four combinations are meaningful, which is why these are two controls
rather than one:

| share | intake | Use |
|---|---|---|
| on | on | The default. A continuing relationship. |
| **off** | **on** | An experiment. Learns from history without polluting it. |
| on | off | A fresh start that still becomes canon going forward. |
| off | off | A sealed alternate universe. |

**`associations` is a tri-state, not a boolean.** "Auto, always, never" —
because a plain boolean cannot express *exclude this one specific session
despite intake being on*, which is precisely the control the requirement asks
for. Absent from the map means auto.

**Manual association overrides the toggles in both directions**, per the
requirement: `"always"` pulls a session in even when `intake` is off, and
`"never"` excludes one that would otherwise qualify.

**[OPEN]** `share: true` by default means every throwaway session contributes.
The requirement states the default for intake; sharing defaults on by symmetry.
The mitigation is that isolating a session must be one obvious action rather
than two toggles found in a drawer — plausibly a "scratch session" preset that
sets both off at creation.

---

## 5. Memories are advisory, and must not write state

The same boundary as the guidance box ([06 §5.2](06-modes-and-turn-pipeline.md)),
and for the same reason.

An imported memory says Vera trusted you. It must not *set* a trust channel in
this session. Otherwise starting a new session silently populates its state from
another one, and a mechanic that looks like it was earned here was inherited
from somewhere the player may not even remember.

So memory blocks are marked `advisory: true` and are inadmissible to evaluation
steps, rule conditions and engine-computed channel updates. They inform the
narrator; the narrator's output can then legitimately move state, exactly as
with guidance — and that indirect path is the system working, not a leak.

---

## 6. Failure modes worth designing against

**Spoiler bleed is the sharp one.** Replay a ~~package~~ **World** or start a
second story in the same treatment, and intake will happily import what happened
last time — including twists, plot hooks that fired
([03 §4.1](03-data-model.md)), and things a fresh protagonist has no business
knowing. This is the failure most likely to make someone turn the whole feature
off.

Mitigations, in order of how much they cost:

- **Warn at session creation** when a new session's treatment or ~~package~~
  **World** matches an existing one, and offer to start isolated. Cheap and
  catches the common case.
- **Never import memories derived from hidden content** — a hook's premise, an
  unfired hook's entrances ([04 §6.1a](04-schemas.md)), a hidden channel, GM-only
  state. Extraction should refuse those at the source rather than filtering them
  later. *Entrances are on the list for the same reason as premises and are worse
  if leaked: an entrance is not a summary of an arrival, it is the finished prose
  of one, so a bleed reproduces the exact words a second playthrough was supposed
  to reach freshly.* Which also raises what the first mitigation is worth — a
  replayed treatment does not merely repeat a beat, it repeats the sentence.
- ~~**[OPEN]** Whether sessions seeded from the same package should default to
  not sharing with each other. Tempting, and probably too clever — a continuing
  campaign in the same package is a normal thing to want.~~ **Answered below,
  and the answer is both halves rather than one of them.**

*Amended 2026-09-14, when ~~Package~~ World stopped being a bundle that
dissolves on arrival and became a durable object a session belongs to
([15 §0](15-world.md)). By strike rather than quietly, because the third bullet
was load-bearing where it stood: [P8](workplan/25-p8-implementation.md) cites it
to leave the behaviour deliberately unbuilt, and a reader arriving at that
sentence should see what moved under it rather than a decision that appears to
have always been there.*

**The bullet was unanswerable because *the same package* was a fact about where
sessions came from rather than about what they are.** Two sessions seeded from
one file may be one story or two unrelated experiments, and nothing in the
software knew which — a default keyed on a coincidence of origin is exactly what
*too clever* meant. Membership of a World is not a coincidence. A World is
something a person makes and puts things into, and sessions do not join one by
resembling each other ([15 §10](15-world.md)), so membership is a statement
about continuity, and a statement is a thing a default may honour.

**So the question splits where the old word could not, and each half has an
answer.**

- **Inside a World: share — the old lean, now with a reason under it.** A
  continuing campaign in one canon is the normal thing to want, and refusing to
  carry memories between sessions somebody has just declared to be one
  continuity would be the software overruling the only explicit statement it
  has. It would also put this document at odds with [15 §6](15-world.md), which
  keys three behaviours on precisely this boundary — most sharply, a hook that
  fired in session one does not fire again in session two of the same World. A
  World where the engine has recorded that a beat happened and the character it
  happened to remembers nothing is not a conservative default; it is an
  incoherent one.
- **Across Worlds: auto-off, which is the thing the bullet was reaching for.**
  The case that hurts was never the continuing campaign. It is the replay — the
  same material played again by a fresh protagonist — and a replay is a second
  World over the same objects. There the two mechanisms pull apart unless intake
  draws its line where hooks draw theirs: the hook pool is copied fresh because
  the canon is new, while the actor's book still holds how it went last time, so
  the engine offers the twist and the actor pre-empts it. **An origin session in a
  different World is therefore auto-off.** Nothing is hidden by that: §7's list
  shows such a session as auto-off rather than omitting it, and `"always"` pulls
  it in for the person who meant it.
- **The filter acts on a statement, never on its absence.** A session in no
  World intakes as it does today, and a session in a World still admits a
  Worldless origin session, because *unfiled* is not *elsewhere* — somebody who
  plays for six months and then names the canon they were in must not lose the
  history that produced it. Two Worlds that differ are the only case that
  excludes. Which is also why none of this costs anything before the key exists,
  since every session is Worldless until somebody makes one — and why an unfiled
  replay is still a replay, with the two mitigations above it and nothing else in
  front of it.

**What it costs structurally is one clause, and it is a default rather than a
law.** Books stay scoped `(user, actor, persona)` — §3 is untouched, because
what a World decides is which origin sessions §4's auto state admits, which is
the judgement `associations` already makes per session, reached by a rule
instead of by hand and needing no new control to express. And it widens like
persona scope does, by the same argument one level up: there she is talking to a
different person and should know a different history; here she is remembering a
different canon. A setting that widens intake across Worlds is as legitimate as
the one that widens it across personas, and on a single-World install the
distinction is invisible anyway. *The fourth key §8 names is a different object
from any of this* — a book belonging to a World rather than to an actor — and
the two should not be mistaken for one because they turn on the same word.

**The first mitigation's trigger sharpens rather than retires.** *Same
treatment* was a proxy for *you are about to replay something*, and inside a
World it over-fires: making a second session in a canon you are playing is the
expected act, not a suspicious one. The precise trigger is **same material,
different canon** — a treatment or setup that already has sessions behind it in
another World, or in none. [P8](workplan/25-p8-implementation.md) builds the
proxy and should, because it ships before Worlds do and a warning is worth
having in the meantime; the World clause lands with the key at [P8A].

**Contradiction and staleness.** A memory says she is friendly; she is hostile
now. Memories carry timestamps and retrieval should prefer recent ones, but the
real answer is §5 — they are context, not truth, and the current session's
channels always win.

**Volume.** Fifty sessions of memories is a lot of candidate entries. This is
exactly what the existing budgeter is for, and the reason §2's reuse matters
more than it first appears.

**Genre contamination.** A comedy AU bleeding into a serious campaign. Manual
`"never"` handles it; the warning in the spoiler mitigation catches some of it.

---

## 7. The UI, as the requirement describes it

Per session, in settings:

- **Two switches** — *Share memories from this session* / *Use memories from
  these characters*.
- **A list of the account's other sessions involving the same actors**, each
  tri-state: auto (default), always, never. Sessions the toggles already include
  show as auto-on rather than being hidden, so the effective result is visible
  rather than inferred.
- **A link to the memory book itself**, opening the ordinary lorebook editor.
  That is where individual memories are read, corrected and deleted, and it
  needs no bespoke UI.

The workbench ([10 §3](10-ui-surfaces.md)) already answers "which memories
actually reached this turn, and why" without anything being added, because
memory entries are lorebook entries and lorebook activation is already recorded
per block.

---

## 8. Open

- **[OPEN]** Extraction cadence and cost. Session end is obvious; periodic
  extraction during long sessions is better and costs calls. Should it reuse the
  summarisation pass rather than being a second one?
- **[OPEN]** What happens to memories when their origin session is deleted.
  Keeping them orphans the attribution; deleting them loses history the user may
  value. Probably: ask, defaulting to keep with the origin marked as deleted.
- **[OPEN]** Whether memory books are per (actor × persona) as separate books,
  or one book per actor with per-entry persona tags and filtered retrieval. The
  second is fewer objects and more query complexity.
- **[OPEN]** Cross-session memory for the *narrator* rather than a character —
  "the GM remembers your last campaign". Coherent, and a different scope key.
  **That scope key now has a name**: it is a World
  ([15](15-world.md)), and this question is the one that found it. ~~The
  bearing on 1.0 is narrow but real: decide the book-granularity question
  directly above knowing that a fourth key is coming, so nothing hard-codes the
  three-tuple into how memory books are keyed and named on disk.~~

  *Amended 2026-09-14: the key is no longer coming — it is scheduled.* World
  moved out of 4.0 and into 1.0 ([15](15-world.md),
  [work plan §0](workplan/01-work-plan.md)), so the granularity question
  directly above is decided against a key that exists rather than one to leave
  room for, and *nothing hard-codes the three-tuple into how memory books are
  keyed and named on disk* is a requirement of 1.0 rather than a caution about a
  later release. [P8 §1.2](workplan/25-p8-implementation.md) took the constraint
  while the key was still prospective and can now take it knowing what it is.

  **The key has two consumers at 1.0 and they are not the same shape**, which is
  the part worth having in hand before granularity is called. One is a book of
  the World's own — what the narrator knows about this canon, keyed on the World
  rather than on an `(actor × persona)` pair, and so a sibling of the books above
  rather than a wider version of them. The other is §6's qualifier, where the
  World a session belongs to decides which origin sessions its intake admits
  without changing what any book is keyed on at all. **A scheme that can express
  both is the thing to hold**: one of them is keyed on something that is not an
  actor, and the other has to be able to ask a stored memory which session — and
  therefore which World — it came from, which §2's origin ref already carries.

  **What stays open is the shape of the first.** Whether the World's book is a
  lorebook on §2's terms — probably, since §2's argument is indifferent to what
  a book is keyed on — and what writes it, which is not §2.1's extractor with a
  different subject plugged in. A World's book wants what is now true of the
  canon, where an actor's wants what that actor learned about you, so whether one
  step can write both is the question [P8 §1.3](workplan/25-p8-implementation.md)
  answered *no* to for the summariser and extraction, arriving a second time one
  level along. Its reason there was structural and may not transfer; the question
  does.
