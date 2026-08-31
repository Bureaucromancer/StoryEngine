# 20 — The authoring tier

**Status: proposal.** The release where **authoring what you have played becomes
a first-class activity**. Authored rules are its mechanism; they are not its
product.

**Scheduled for 5.0** ([work plan §0.6](workplan/01-work-plan.md)). It carries
the number 20 because 00–19 were taken when it was written; like
[17](17-write-mode.md) and [19](19-world.md) it is a design note that arrived
after the original run.

Two of its three parts began life in [14](14-roadmap.md) — the Character Studio
as §2 and lorebook extraction as §2c.3 — and moved here when the tier acquired a
release, because the feature list holds no release commitments
([14](14-roadmap.md) header). The third, the authored-rule vocabulary, is
designed in [03 §4.1](03-modes-and-turn-pipeline.md) and
[08 §3](08-infinite-worlds.md) and is not restated here; §2 says only what this
release adds to it.

> **Play a session, keep the world.**

---

## 1. Why this is a tier rather than a language release

The obvious framing is *5.0 ships authored rules*. That framing is wrong, and
the reason is worth writing down because it will look like scope creep
otherwise.

**A release whose entire content is a language for authors has no forcing
function.** It would be designed by us, for us, against our own idea of what an
author needs. That is [06 C7](06-open-questions.md)'s failure mode arriving
through a different door: the corpus argument protects against designing the
*wrong vocabulary*, and nothing in it protects against designing a vocabulary
**nobody asked for**.

A release that can state its purpose in a sentence a user would recognise has
something to design against. *You can now author what you have been playing* is
that sentence, and it makes rules the part that makes the rest work rather than
the point of the exercise.

**The three parts share a shape**, which is the test for whether something
belongs here:

| Part | Turns this played thing… | …into this authored thing |
|---|---|---|
| **Authored rules** (§2) | channel state you watched change | a rule that changes it |
| **Lorebook extraction** (§3) | a session's established facts | a lorebook |
| **The Character Studio** (§4) | an actor you played | a reusable visual identity |

Anything that does not fit that column pair belongs on the feature list instead,
and §6 names the two nearest misses.

## 2. Authored rules — what this release adds

The tier itself is designed elsewhere and is not repeated:
[03 §4.1](03-modes-and-turn-pipeline.md) states the shape and what 1.0 owes it,
[08 §2](08-infinite-worlds.md) makes the case for it, [08 §3](08-infinite-worlds.md)
proposes the starting vocabulary, and [06 C7](06-open-questions.md) carries the
deferral. What this release adds is the vocabulary itself, an evaluator, and an
authoring surface.

### 2.1 Campaign does not need this, and the distinction matters

The two look coupled and are not. [08 §2](08-infinite-worlds.md) introduces the
tier with RPG-shaped examples — quest state machines, loot generators, class
trees — but those are things Infinite Worlds' *authors* built with no engine
involvement.

**Campaign is not an author.** It is a first-party mode package consuming the
published SDK ([07 §10](07-tech-stack.md)), and its determinism is
`update: "engine-computed"` ([03 §4](03-modes-and-turn-pipeline.md)): the mode
declares a channel and computes the update in code. Combat round maths, HP
pools, inventory arithmetic, quest counters — Campaign's own TypeScript, needing
no predicate language to express.

Three seams touch, and all three are additive:

| Seam | State |
|---|---|
| `PlotHook.requires` / `onFire` | **Already severed.** Removed from the schema rather than stubbed ([10 §6.1](10-schemas.md)); hooks keep `involves`, `notBefore` and `blockedBy`, the mechanical filters that carry most authored ones. Returns as optional fields. |
| `Goal.completion: { kind: "mechanical" }` | A third variant beside `narrative` and `manual`. **The one that genuinely wants the vocabulary** — and the reason is instructive: a `Goal` lives on **Setup**, which is portable *authored* content, so a quest's completion condition belongs to whoever wrote the game rather than to the mode running it. Campaign's code cannot supply what is not Campaign's to say. |
| Author-declarable channels | The `owner`-accepts-a-package-id widening lands at 1.0 ([03 §4.1](03-modes-and-turn-pipeline.md)). Only the surface that lets an author *define* a channel waits. |

**So Campaign at 4.0 is what produces the corpus this release is designed
against, not what consumes the result.** What a rules-less Campaign cannot do is
let somebody else author one: every authored quest completes narratively or
manually, and a shipped Package can declare a Corruption channel without stating
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
an operator, that operator is evidence.** Where one held its guard for four
releases without strain, that is evidence too.

### 2.3 One decision inherited half-made

[08 §6](08-infinite-worlds.md) argues that one expression language should serve
both template rendering and rule conditions — one thing for authors to learn,
one evaluator to sandbox. **Liquid is already chosen for block templating** and
P4 proceeds on it, deliberately leaving the other half of
[06 C6](06-open-questions.md) open ([P4 §6.1](workplan/06-p4-implementation.md)).

Deferring rules to 5.0 did not defer that choice; it extended how long the
project runs on a half-made one. So the question this release opens with is
whether Liquid still looks right for *conditions* after four releases of using
it for templates — and **"no" is an answer worth having**, not an inconvenience.
The single-language constraint is the thing to preserve; Liquid is the current
candidate for satisfying it, not the constraint itself.

## 3. Lorebook extraction — closing the play-to-authoring loop

Two thirds of this loop already exist. A running session can emit a **Setup**
([10 §7](10-schemas.md)), and a session-local actor can be promoted to the
library ([02 §2.3](02-data-model.md)). The missing third is **extracting a
lorebook from what a session established** — the places visited, the people met,
the things decided.

It is the natural output of the story bible ([19 §4](19-world.md)): once the
bible exists, *"make this a lorebook"* is a selection and a write rather than a
new mechanism. That dependency is also why it cannot land before 3.0.

Both existing halves set the pattern this must follow: **offered, never
automatic, and reviewed before it lands.** Marinara's own conclusion about
auto-promotion applies unchanged — a session tried once and abandoned must leave
nothing behind ([02 §2.3](02-data-model.md)) — and an extractor that silently
wrote lore entries would be the mention-resolution failure
([05 §13.1](05-ui-surfaces.md)) at a larger scale.

*Play a session, keep the world* is the whole pitch, and it answers something
the sources handle badly: worlds currently have to be authored before they can
be played in, when in practice they are discovered while playing.

## 4. The Character Studio

The actor card carries embedded media with typed roles and structured visual
descriptors from 1.0 ([02 §5.2.2](02-data-model.md)). The Studio is the surface
that makes that capability worth having.

### 4.1 The problem it addresses

A Tavern-style card describes a character in prose and carries one picture. That
is enough for text roleplay and nowhere near enough to hand a character to an
image or video pipeline and get *the same person* back twice. Visual consistency
is the unsolved problem in this space, and everything the field has converged on
— reference images, multi-view sheets, structured descriptor tags, style
anchors, seed pinning, per-character adapters — needs somewhere to live.

The Studio's premise: **extend the card from a description of a character into a
usable visual identity**, so a card can drive a generation pipeline and produce a
stable likeness. That is a meaningful extension of what a character card *is*,
and it is the reason the format work is 1.0 while the tooling is not.

### 4.2 What it is

An editing surface for an actor's visual identity, sitting beside the text
editor rather than inside it:

- **Reference set curation.** Choose, generate, crop and label the canonical
  likeness images. Multi-angle where the pipeline can use it.
- **Descriptor authoring**, structured (`VisualDescriptors`) with the prose
  appearance derivable from it or maintained alongside — the two must not drift
  silently, which is a real design question, not a detail.
- **Expression and pose sets**, generated from the references and kept
  consistent with them, feeding sprite display in Scene mode as a side effect.
- **Style anchoring.** Style is a property of the *production*, not the person —
  the same character rendered in ink wash and in photoreal is still that
  character. So style exemplars are a separate media role and separately
  selectable, and Marinara's `image-style-profile` is the nearest prior art.
- **A test bench.** Generate a few images against the current identity and see
  whether it holds. Without this the Studio is a form; with it, it is a tool.

### 4.3 Why the format is 1.0 and the tooling is not

Two reasons. It is genuinely large — a curation UI, a generation pipeline, and a
consistency evaluation loop are three features. And it is the area where the
underlying technology moves fastest, so specifying the tooling early against
2026 techniques would be designing for the wrong thing.

The format is different: typed media roles and structured descriptors are cheap,
stable, and unpleasant to retrofit. Hence the split, and §5 is the half that
lands early.

### 4.4 This is the least settled member of the tier

**Its surface question is open and should be re-argued at the revisit rather
than assumed.** Whether the Studio is a panel, a mode of an existing surface, or
something the Write reframing absorbs is undecided — and a release is a bad
place to discover a navigation argument
([05 §2](05-ui-surfaces.md) is where that gets settled).

What earns it a provisional place is §1's shared shape: extraction turns a
played session into a lorebook, and the Studio turns a played actor into a
reusable one. If the surface argument pulls it elsewhere, the tier loses a
member and keeps its point.

### 4.5 Non-goals

- **Not a model training surface.** If per-character adapters become the
  standard answer, the Studio should *reference* one, not train it.
- **Not an image editor.** Crop and label, not paint.
- **Not required.** A text-only actor with no media stays completely valid, and
  nothing in the Studio may become a precondition for using a card.

## 5. What this obliges 1.0 to do

The standing test. Everything here is small, none of it is a feature at 1.0, and
all of it is a precondition.

**For the Character Studio** — four, and the first is the one that is not
recoverable:

- **Typed media roles**, not a flat image list ([02 §5.2.2](02-data-model.md)).
  The single most important one, because guessing which image is the canonical
  likeness is not recoverable later.
- **Structured `VisualDescriptors`** on the profile ([02 §2.1](02-data-model.md)).
  Fields now, or prose parsing later.
- **Per-media generation provenance**, reusing `GeneratedFieldProvenance`
  ([05 §11.2](05-ui-surfaces.md)) — which model, which prompt, which seed. A
  reference image whose seed was not recorded cannot be regenerated
  consistently, which defeats the purpose.
- **Crop as a stored rectangle** rather than a destructive edit
  ([02 §5.2.1](02-data-model.md)).

**For authored rules** — two, both already stated in
[03 §4.1](03-modes-and-turn-pipeline.md) and repeated here because this is the
document that consumes them: `owner` accepts a package id from the first channel
definition written, and every effect applies through one path into the turn
record.

**For extraction** — none. It reads the bible, which reads the record, which is
complete for other reasons ([02 §8](02-data-model.md)).

## 6. What is deliberately not here

Two near misses, both of which would make this a release about *everything left*
— which is how a scope stops being checkable
([releases §0](workplan/11-repo-and-releases.md)).

- **Continuity checking** ([14 §2c.2](14-roadmap.md)). A reader that flags
  contradictions, not an authoring surface. It shares extraction's dependency on
  the bible and none of its purpose.
- **The branch tree visualiser** ([14 §1](14-roadmap.md)). A reader over
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
  than theirs, and [14 §4](14-roadmap.md)'s posture — hope somebody else builds
  it — was the right one all along.
