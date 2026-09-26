# 16 — The authoring tier

**Status: proposal.** The release where **authoring what you have played becomes
a first-class activity**. Authored rules are its mechanism; they are not its
product.

**Scheduled for 6.0** ([work plan §0.6](workplan/01-work-plan.md)). Like [13](13-write-mode.md) and
[15](15-world.md) it is a design note that arrived after the original run, and
it reads after [06](06-modes-and-turn-pipeline.md) and
[02](02-infinite-worlds.md), whose extensibility tiers it completes.

One of its two parts began life in [24](24-roadmap.md) — lorebook extraction as
§2c.3 — and moved here when the tier acquired a release, because the feature list
holds no release commitments ([24](24-roadmap.md) header). The other, the
authored-rule vocabulary, is designed in
[06 §4.1](06-modes-and-turn-pipeline.md) and [02 §3](02-infinite-worlds.md) and
is not restated here; §2 says only what this release adds to it.

**A third part arrived the same way and left again.** The Character Studio is a
release of its own at 3.0 ([17](17-character-studio.md)); §4 is the stub, and it
stays because *why something left* is worth more than a silent deletion.

> **Play a session, keep the world.**

---

## 1. Why this is a tier rather than a language release

The obvious framing is *6.0 ships authored rules*. That framing is wrong, and
the reason is worth writing down because it will look like scope creep
otherwise.

**A release whose entire content is a language for authors has no forcing
function.** It would be designed by us, for us, against our own idea of what an
author needs. That is [25 C7](25-open-questions.md)'s failure mode arriving
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
proposes the starting vocabulary, and [25 C7](25-open-questions.md) carries the
deferral. What this release adds is the vocabulary itself, an evaluator, and an
authoring surface.

### 2.1 Campaign does not need this, and the distinction matters

The two look coupled and are not. [02 §2](02-infinite-worlds.md) introduces the
tier with RPG-shaped examples — quest state machines, loot generators, class
trees — but those are things Infinite Worlds' *authors* built with no engine
involvement.

**Campaign is not an author.** It is a first-party mode package consuming the
published SDK ([19 §10](19-tech-stack.md)), and its determinism is
`update: "engine-computed"` ([06 §4](06-modes-and-turn-pipeline.md)): the mode
declares a channel and computes the update in code. Combat round maths, HP
pools, inventory arithmetic, quest counters — Campaign's own TypeScript, needing
no predicate language to express.

Three seams touch, and all three are additive:

| Seam | State |
|---|---|
| `PlotHook.requires` / `onFire` | **Already severed.** Removed from the schema rather than stubbed ([04 §6.1](04-schemas.md)); hooks keep `involves`, `notBefore` and `blockedBy`, the mechanical filters that carry most authored ones. Returns as optional fields. |
| `Goal.completion: { kind: "mechanical" }` | A third variant beside `narrative` and `manual`. **The one that genuinely wants the vocabulary** — and the reason is instructive: a `Goal` lives on **Setup**, which is portable *authored* content, so a quest's completion condition belongs to whoever wrote the game rather than to the mode running it. Campaign's code cannot supply what is not Campaign's to say. |
| Author-declarable channels | The `owner`-accepts-a-package-id widening lands at 1.0 ([06 §4.1](06-modes-and-turn-pipeline.md)). Only the surface that lets an author *define* a channel waits. |

**So Campaign at 5.0 is what produces the corpus this release is designed
against, not what consumes the result.** What a rules-less Campaign cannot do is
let somebody else author one: every authored quest completes narratively or
manually, and a shipped Package can declare a Corruption channel without stating
a rule about it. That is a real hole and it is a hole in the *authoring* story,
which is why it is patched here rather than at 5.0.

### 2.2 The vocabulary is a unification, not a greenfield design

By the time this lands, **three minimal predicate dialects will have been running
separately for five releases** ([work plan §0.3](workplan/01-work-plan.md)):
lorebook activation conditions (P5), `StepCondition` (P7), and the plot-hook
filters (P7). Each is deliberately small and each carries a written guard against
growing.

Designing the vocabulary is therefore substantially the job of *unifying* them,
and the first task of this release is to read all three and ask what they
actually needed rather than what we imagined they would. **Where a dialect grew
an operator, that operator is evidence.** Where one held its guard for four
releases without strain, that is evidence too.

### 2.3 One decision inherited half-made

[02 §6](02-infinite-worlds.md) argues that one expression language should serve
both template rendering and rule conditions — one thing for authors to learn,
one evaluator to sandbox. **Liquid is already chosen for block templating** and
P4 proceeds on it, deliberately leaving the other half of
[25 C6](25-open-questions.md) open ([P4 §6.1](workplan/16-p4-implementation.md)).

Deferring rules to 6.0 did not defer that choice; it extended how long the
project runs on a half-made one. So the question this release opens with is
whether Liquid still looks right for *conditions* after five releases of using
it for templates — and **"no" is an answer worth having**, not an inconvenience.
The single-language constraint is the thing to preserve; Liquid is the current
candidate for satisfying it, not the constraint itself.

## 3. Lorebook extraction — closing the play-to-authoring loop

Two thirds of this loop already exist. A running session can emit a **Setup**
([04 §7](04-schemas.md)), and a session-local actor can be promoted to the
library ([03 §2.3](03-data-model.md)). The missing third is **extracting a
lorebook from what a session established** — the places visited, the people met,
the things decided.

***Corrected 2026-09-26.*** *The first of those two thirds did not exist when
this was written*: [P7.4](workplan/23-p7-implementation.md)'s *Save as a setup*
named the session **form's** configuration and never read a running session.
[P13](workplan/30-p13-implementation.md) built it — a Setup made from any turn,
its story so far condensed by a model and reviewed by a person
([04 §7.2](04-schemas.md)) — and in doing so built a **precursor** of the third:
the wizard offers the facts a session established as a companion lorebook,
drafted with the memory extractor's prompt over the summary chain and kept or
dropped entry by entry. *Offered, never automatic, reviewed before it lands*,
exactly as below. It is not this section's extraction, which reads the story
bible and lands with it; when the bible exists, it is the reader under that
wizard that changes.

It is the natural output of the story bible ([15 §4](15-world.md)): once the
bible exists, *"make this a lorebook"* is a selection and a write rather than a
new mechanism. That dependency is also why it cannot land before 4.0.

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
([17](17-character-studio.md)).

It was a member of this tier, and it is the member that did not share the tier's
gate. What holds §2 and §3 back is a corpus of real authored worlds that only a
release of Campaign produces ([25 C7](25-open-questions.md)); every one of the
Studio's preconditions lands at 1.0, so nothing here held it and nothing it
needed waited for the corpus.

It was also always the least settled member — the only piece whose *surface*
question was open, and a release is a bad place to discover a navigation
argument. That reads differently now: inside a tier an unsettled surface question
is a member that might have to be dropped late, and as a release of its own it is
the first question the release has to answer
([17 §6](17-character-studio.md), [10 §2](10-ui-surfaces.md)).

**The stub stays because *why something left* is the most useful thing a document
can record about it** — the same reason [24](24-roadmap.md) keeps its own — and
because the tier's argument is easier to read with the piece that left still
visible in it. §1's shared shape is real; the Studio is the proof that a shared
shape is not a shared dependency.

## 5. What this obliges 1.0 to do

The standing test. Everything here is small, none of it is a feature at 1.0, and
all of it is a precondition.

**For the Character Studio** — four, and they went with it to
[17 §5](17-character-studio.md): typed media roles, structured
`VisualDescriptors`, per-media generation provenance, and crop as a stored
rectangle. All four are unchanged by the move; they are 1.0's obligations to 3.0
now rather than to this release, and the first is still the one that is not
recoverable.

**For authored rules** — two, both already stated in
[06 §4.1](06-modes-and-turn-pipeline.md) and repeated here because this is the
document that consumes them: `owner` accepts a package id from the first channel
definition written, and every effect applies through one path into the turn
record.

**For extraction** — none. It reads the bible, which reads the record, which is
complete for other reasons ([03 §8](03-data-model.md)).

## 6. What is deliberately not here

Two near misses, both of which would make this a release about *everything left*
— which is how a scope stops being checkable
([releases §0](workplan/04-repo-and-releases.md)).

- **Continuity checking** ([24 §2c.2](24-roadmap.md)). A reader that flags
  contradictions, not an authoring surface. It shares extraction's dependency on
  the bible and none of its purpose.
- **The branch tree visualiser** ([24 §1](24-roadmap.md)). A reader over
  topology. Same argument.

Both stay on the feature list at High, which is the right place for something
wanted soon and gated on nothing.

## 7. How we would know this was wrong

- **Watch whether anyone hand-writes what extraction would produce.** If people
  finish a session and immediately author a lorebook by hand, the loop is real
  and this release is late. If nobody does, *play a session, keep the world* was
  a pitch nobody wanted, and extraction is the member to cut.
- **Count the operators the three dialects grew** (§2.2). Near zero across five
  releases means the guards held and the unification is small — but it also
  means nothing pushed on them, and a vocabulary designed against dialects
  nobody strained is a vocabulary designed against imagination after all. That
  would be the signal to wait again rather than to ship.
- **Watch whether Campaign authors ask for rules.** The premise of putting this
  a release behind Campaign is that 5.0 produces authors who then want to say
  something they cannot. If the requests never arrive, the tier is ours rather
  than theirs, and [24 §4](24-roadmap.md)'s posture — hope somebody else builds
  it — was the right one all along.
