# 17 — The authoring tier

**Status: proposal.** The release where **authoring what you have played becomes
a first-class activity**. Authored rules are its mechanism; they are not its
product.

**Scheduled for 5.0** ([work plan §0.6](workplan/01-work-plan.md)), ~~6.0~~ until
2026-09-14 — and nothing in this tier moved to earn the smaller number.
[15](15-world.md) took World into 1.0, Campaign came forward behind it to 4.0,
and the line lost a release. What decides where this sits is untouched by that:
**one release behind Campaign**, because Campaign is what produces the corpus
this tier is designed against ([26 C7](26-open-questions.md)). The position is
the claim and the number is bookkeeping.

**So the interesting part of that move is not the number**, and both halves of
this document felt it, each from its own direction: §3's mechanism came forward
with World, because the story bible came with it, and §2.2 has a release less
evidence to unify from. One gate fell away and one body of evidence shrank, in
the same edit and for the same reason.

Like [13](13-write-mode.md) and [15](15-world.md) it is a design note that
arrived after the original run, and it reads after
[06](06-modes-and-turn-pipeline.md) and [02](02-infinite-worlds.md), whose
extensibility tiers it completes.

One of its two parts began life in [25](25-roadmap.md) — lorebook extraction as
§2c.3 — and moved here when the tier acquired a release, because the feature list
holds no release commitments ([25](25-roadmap.md) header). The other, the
authored-rule vocabulary, is designed in
[06 §4.1](06-modes-and-turn-pipeline.md) and [02 §3](02-infinite-worlds.md) and
is not restated here; §2 says only what this release adds to it.

**A third part arrived the same way and left again.** The Character Studio is a
release of its own at 3.0 ([18](18-character-studio.md)); §4 is the stub, and it
stays because *why something left* is worth more than a silent deletion.

> **Play a session, keep the world.**

---

## 1. Why this is a tier rather than a language release

The obvious framing is *5.0 ships authored rules*. That framing is wrong, and
the reason is worth writing down because it will look like scope creep
otherwise.

**A release whose entire content is a language for authors has no forcing
function.** It would be designed by us, for us, against our own idea of what an
author needs. That is [26 C7](26-open-questions.md)'s failure mode arriving
through a different door: the corpus argument protects against designing the
*wrong vocabulary*, and nothing in it protects against designing a vocabulary
**nobody asked for**.

A release that can state its purpose in a sentence a user would recognise has
something to design against. *You can now author what you have been playing* is
that sentence, and it makes rules the part that makes the rest work rather than
the point of the exercise.

**Both parts share a shape**, which is the test for whether something belongs
here:

| Part | Turns this played thing… | …into this authored thing |
|---|---|---|
| **Authored rules** (§2) | channel state you watched change | a rule that changes it |
| **Lorebook extraction** (§3) | a session's established facts | a lorebook |

Anything that does not fit that column pair belongs on the feature list instead,
and §6 names the two nearest misses.

**The Character Studio fits the column pair and is still not here** (§4), which
is the sharpest thing this test has been shown to get wrong. Fitting the shape
earned it attention; it did not earn it a place in the queue, because a shape is
not a dependency. **The test says what belongs together, not what has to wait
together**, and reading it as a schedule is the mistake to avoid the next time
something fits.

## 2. Authored rules — what this release adds

The tier itself is designed elsewhere and is not repeated:
[06 §4.1](06-modes-and-turn-pipeline.md) states the shape and what 1.0 owes it,
[02 §2](02-infinite-worlds.md) makes the case for it, [02 §3](02-infinite-worlds.md)
proposes the starting vocabulary, and [26 C7](26-open-questions.md) carries the
deferral. What this release adds is the vocabulary itself, an evaluator, and an
authoring surface.

### 2.1 Campaign does not need this, and the distinction matters

The two look coupled and are not. [02 §2](02-infinite-worlds.md) introduces the
tier with RPG-shaped examples — quest state machines, loot generators, class
trees — but those are things Infinite Worlds' *authors* built with no engine
involvement.

**Campaign is not an author.** It is a first-party mode package consuming the
published SDK ([20 §10](20-tech-stack.md)), and its determinism is
`update: "engine-computed"` ([06 §4](06-modes-and-turn-pipeline.md)): the mode
declares a channel and computes the update in code. Combat round maths, HP
pools, inventory arithmetic, quest counters — Campaign's own TypeScript, needing
no predicate language to express.

Three seams touch, and all three are additive:

| Seam | State |
|---|---|
| `PlotHook.requires` / `onFire` | **Already severed.** Removed from the schema rather than stubbed ([04 §6.1](04-schemas.md)); hooks keep `involves`, `notBefore` and `blockedBy`, the mechanical filters that carry most authored ones. Returns as optional fields. |
| `Goal.completion: { kind: "mechanical" }` | A third variant beside `narrative` and `manual`. **The one that genuinely wants the vocabulary** — and the reason is instructive: a `Goal` lives on **Setup**, which is portable *authored* content, so a quest's completion condition belongs to whoever wrote the game rather than to the mode running it. Campaign's code cannot supply what is not Campaign's to say. |
| Author-declarable channels | **`owner`'s fourth arm is a World**, and the widening that admits it lands at 1.0 ([06 §4.1](06-modes-and-turn-pipeline.md)). Only the surface that lets an author *define* a channel waits — and one rule beneath it: the registry reads *an owner no mode answers to* as available everywhere, which is right for a first-party namespace and wrong for a World, whose channels belong to sessions in it and to nothing else. Additive, and this tier's to change when it has the first consumer. |

***That row said "a package id" until 2026-09-14, and the word was doing two
jobs.*** [06 §4.1](06-modes-and-turn-pipeline.md) is where they were separated:
the arm this tier is about is **authored content**, which [15](15-world.md) made
durable and renamed World; the first-party namespaces P7 actually shipped —
`storyengine.lore`, `storyengine.cast` — keep the old word, are code in this
repository, and are not anything an author declares.

**The separation matters more to this document than to the one that made it**,
because the arm this tier is built on was the unbuildable one. A channel owned by
a *package* pointed at a container [04 §9](04-schemas.md) specified to dissolve
on import ([15 §0](15-world.md)): the widening reserved a field for an owner that
could not survive arriving. A World survives, and lands at 1.0. So the seam this
tier needs is no longer a promise about a field — it is a durable object with a
stable id, sitting in the library four releases before anything here ships.

**So Campaign at 4.0 is what produces the corpus this release is designed
against, not what consumes the result.** What a rules-less Campaign cannot do is
let somebody else author one: every authored quest completes narratively or
manually, and a shipped World can declare a Corruption channel without stating
a rule about it. That is a real hole and it is a hole in the *authoring* story,
which is why it is patched here rather than at 4.0.

### 2.2 The vocabulary is a unification, not a greenfield design

By the time this lands, **three minimal predicate dialects will have been running
separately for four releases** ([work plan §0.3](workplan/01-work-plan.md)):
lorebook activation conditions (P5), `StepCondition` (P7), and the plot-hook
filters (P7). Each is deliberately small and each carries a written guard against
growing.

Designing the vocabulary is therefore substantially the job of *unifying* them,
and the first task of this release is to read all three and ask what they
actually needed rather than what we imagined they would. **Where a dialect grew
an operator, that operator is evidence.** Where one held its guard for three
releases without strain, that is evidence too.

***Four releases rather than five, and three rather than four, and this is the
one thing the shorter line costs this tier*** (2026-09-14). The dialects still
all ship in 1.0 and this tier still opens a release behind Campaign; what
changed is that there is one release fewer between the two, which is one release
less evidence than these two paragraphs were written expecting. It is evidence
rather than time they are spending, so the loss is real and small — and §7's
second test is where it would show, since that test already knows how to say
*nothing pushed on them*.

### 2.3 One decision inherited half-made

[02 §6](02-infinite-worlds.md) argues that one expression language should serve
both template rendering and rule conditions — one thing for authors to learn,
one evaluator to sandbox. **Liquid is already chosen for block templating** and
P4 proceeds on it, deliberately leaving the other half of
[26 C6](26-open-questions.md) open ([P4 §6.1](workplan/16-p4-implementation.md)).

Deferring rules to 5.0 did not defer that choice; it extended how long the
project runs on a half-made one. So the question this release opens with is
whether Liquid still looks right for *conditions* after four releases of using
it for templates — and **"no" is an answer worth having**, not an inconvenience.
The single-language constraint is the thing to preserve; Liquid is the current
candidate for satisfying it, not the constraint itself.

## 3. Lorebook extraction — closing the play-to-authoring loop

Two thirds of this loop already exist. A running session can emit a **Setup**
([04 §7](04-schemas.md)), and a session-local actor can be promoted to the
library ([03 §2.3](03-data-model.md)). The missing third is **extracting a
lorebook from what a session established** — the places visited, the people met,
the things decided.

It is the natural output of the story bible ([15 §7](15-world.md)): once the
bible exists, *"make this a lorebook"* is a selection and a write rather than a
new mechanism. ~~That dependency is also why it cannot land before 4.0.~~

**The dependency holds; the gate it carried is gone** (2026-09-14). The bible
ships with World and World ships at 1.0 ([15 §7](15-world.md)), so what
extraction reads sits in the first release rather than the fourth, and the
sentence above was describing a schedule rather than a mechanism all along.
What is left holding extraction is §4's gate — the tier's own, the corpus — and
that was always the softer of the two: a corpus is a reason to design *later*,
where a missing bible was a reason you *could* not build. Losing the hard one
puts more weight on §7's first test than it was carrying, because the thing that
would prove this late is now the only thing in the way of it.

Both existing halves set the pattern this must follow: **offered, never
automatic, and reviewed before it lands.** Marinara's own conclusion about
auto-promotion applies unchanged — a session tried once and abandoned must leave
nothing behind ([03 §2.3](03-data-model.md)) — and an extractor that silently
wrote lore entries would be the mention-resolution failure
([10 §13.1](10-ui-surfaces.md)) at a larger scale.

*Play a session, keep the world* is the whole pitch, and it answers something
the sources handle badly: worlds currently have to be authored before they can
be played in, when in practice they are discovered while playing.

## 4. The Character Studio — moved

**The Character Studio is a release of its own at 3.0**
([18](18-character-studio.md)).

It was a member of this tier, and it is the member that did not share the tier's
gate. What holds §2 and §3 back is a corpus of real authored worlds that only a
release of Campaign produces ([26 C7](26-open-questions.md)); every one of the
Studio's preconditions lands at 1.0, so nothing here held it and nothing it
needed waited for the corpus.

It was also always the least settled member — the only piece whose *surface*
question was open, and a release is a bad place to discover a navigation
argument. That reads differently now: inside a tier an unsettled surface question
is a member that might have to be dropped late, and as a release of its own it is
the first question the release has to answer
([18 §6](18-character-studio.md), [10 §2](10-ui-surfaces.md)).

**The stub stays because *why something left* is the most useful thing a document
can record about it** — the same reason [25](25-roadmap.md) keeps its own — and
because the tier's argument is easier to read with the piece that left still
visible in it. §1's shared shape is real; the Studio is the proof that a shared
shape is not a shared dependency.

## 5. What this obliges 1.0 to do

The standing test. Everything here is small, none of it is a feature at 1.0, and
all of it is a precondition.

**For the Character Studio** — four, and they went with it to
[18 §5](18-character-studio.md): typed media roles, structured
`VisualDescriptors`, per-media generation provenance, and crop as a stored
rectangle. All four are unchanged by the move; they are 1.0's obligations to 3.0
now rather than to this release, and the first is still the one that is not
recoverable.

**For authored rules** — two, both already stated in
[06 §4.1](06-modes-and-turn-pipeline.md) and repeated here because this is the
document that consumes them: `owner` accepts a ~~package~~ **world** id from the
first channel definition written, and every effect applies through one path into
the turn record.

**The first is discharged rather than pending**, which is worth recording because
a satisfied obligation that nobody strikes reads as an outstanding one. The
shipped field is `owner: string` ([06 §4.1](06-modes-and-turn-pipeline.md)), so
it takes any of the four arms and the separating of them cost no migration —
exactly the outcome asking for it from the first channel definition was meant to
buy. *What replaced it is not 1.0's*: nothing tells the arms apart at runtime, so
the registry's *an owner no mode answers to is available everywhere* will have to
learn the difference — and it should learn it against a World that actually owns
a channel, which is this tier's to produce and not 1.0's to guess at.

**For extraction** — still none, and the ground moved under the answer rather
than the answer itself. It reads the bible, which reads the record, which is
complete for other reasons ([03 §8](03-data-model.md)) — but the bible is now
something that **ships** at 1.0 ([15 §7](15-world.md)) rather than something 1.0
has to leave room for. A precondition that turns into a feature of an earlier
release is the cheapest kind of good news, and §3 is where it is spent.

## 6. What is deliberately not here

Two near misses, both of which would make this a release about *everything left*
— which is how a scope stops being checkable
([releases §0](workplan/04-repo-and-releases.md)).

- **Continuity checking** ([25 §2c.2](25-roadmap.md)). A reader that flags
  contradictions, not an authoring surface. It shares extraction's dependency on
  the bible — satisfied at 1.0 now, for both of them — and none of its purpose.
  What it is not, and never was, is blocked by anything here.
- **The branch tree visualiser** ([25 §1](25-roadmap.md)). A reader over
  topology. Same argument.

Both stay on the feature list at High, which is the right place for something
wanted soon and gated on nothing.

## 7. How we would know this was wrong

- **Watch whether anyone hand-writes what extraction would produce.** If people
  finish a session and immediately author a lorebook by hand, the loop is real
  and this release is late. If nobody does, *play a session, keep the world* was
  a pitch nobody wanted, and extraction is the member to cut.
- **Count the operators the three dialects grew** (§2.2). Near zero across four
  releases means the guards held and the unification is small — but it also
  means nothing pushed on them, and a vocabulary designed against dialects
  nobody strained is a vocabulary designed against imagination after all. That
  would be the signal to wait again rather than to ship.
- **Watch whether Campaign authors ask for rules.** The premise of putting this
  a release behind Campaign is that 4.0 produces authors who then want to say
  something they cannot. If the requests never arrive, the tier is ours rather
  than theirs, and [25 §4](25-roadmap.md)'s posture — hope somebody else builds
  it — was the right one all along.
