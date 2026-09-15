# 17 — The Character Studio

**Status: proposal.** The surface that turns an actor you played into a
**reusable visual identity**. The card carries the format from 1.0
([03 §5.2.2](03-data-model.md)); this is the tooling that makes the format worth
having.

**Scheduled for 3.0** ([work plan §0](workplan/01-work-plan.md)). Like [13](13-write-mode.md), [15](15-world.md) and
[16](16-authoring.md) it is a design note that arrived after the original run
rather than a new tier of document, and it reads after [03](03-data-model.md)
and [10](10-ui-surfaces.md), whose media model and editor surfaces it turns into
a release.

**It has moved twice, and the second move is what this note exists to record.**
It began as [24 §2](24-roadmap.md), a High-tier feature-list entry with no
release attached. It moved into the authoring tier ([16 §4](16-authoring.md))
when that tier acquired a release, on the strength of a shape it shares with
lorebook extraction — each turns something you played into something you can
author with. It moved out again when the shape turned out not to be a
dependency: **nothing in the authoring tier gates the Studio, and nothing the
Studio needs waits for the corpus that holds the tier back** (§1.2). A family
resemblance is a reason to notice two features together; it is not a reason to
make one of them wait three releases for the other's evidence.

> **Extend the card from a description of a character into a usable visual
> identity.**

---

## 1. Why it is a release of its own

### 1.1 What must have happened first

The committed versions are sequenced by what must have *happened* rather than by
what must have been built ([work plan §0](workplan/01-work-plan.md)). The
Studio's answer is **1.0's actors played**, and it decomposes into three claims
that are all checkable now.

- **Every format prerequisite lands at 1.0** (§5). Typed media roles, structured
  descriptors, per-media generation provenance and non-destructive crop are all
  Actor-card work inside the 1.0 series, so no later release owns anything the
  Studio consumes. This is the claim that puts it early: it is the first tier
  after Write whose dependencies are entirely behind it.
- **What it needs instead is a stock of actors worth making reusable.** A
  reusable visual identity is worth nothing until there is a character you want
  *back* — the same argument [15 §2](15-world.md) makes about continuities,
  applied to people rather than to histories. Curating a reference set for
  somebody nobody has played is authoring a stranger, and the reference set
  would be a guess about which likeness matters.
- **The rendition pipeline has to have run.** P9 builds generation, per-media
  provenance and the eviction hooks
  ([P9](workplan/26-p9-implementation.md)); the test bench (§3) is a *consumer*
  of that machinery rather than a second copy of it, and 1.0 is where it gets
  exercised against real sessions rather than against fixtures.

**Write stays ahead of it at 2.0**, and the reason is not that Write is more
wanted. Write is gated on the substrate being *built* rather than used
([work plan §0](workplan/01-work-plan.md)), so it has no accumulation to wait
for, and it carries a design debt that has to be paid early regardless: session
export at 1.0 cannot freeze the turn record until [13 §4](13-write-mode.md) is
settled ([work plan §0.5](workplan/01-work-plan.md)). A release that must be
designed early is a release worth building early.

### 1.2 Why it does not wait for the authoring tier

The tier and the Studio share a sentence — *turn what you played into something
you can author with* — and share nothing else that matters to a schedule.

| | The authoring tier ([16](16-authoring.md)) | The Character Studio |
|---|---|---|
| **What gates it** | A corpus of real authored worlds to design a vocabulary against ([25 C7](25-open-questions.md)), which a release of Campaign is what produces | Actors people have played, which 1.0 produces |
| **What it must build** | A predicate and effect language, an evaluator, and a sandbox | A curation UI, a generation pipeline and a consistency loop |
| **What 1.0 owes it** | Two seams, both already stated in [06 §4.1](06-modes-and-turn-pipeline.md) | Four card fields, all format work (§5) |
| **Who its user is** | Somebody authoring for other people | Somebody who played a character and wants them again |

**The last row is the substantive one.** The tier's whole deferral argument is
that we must not design an author-facing language against imagination. The
Studio is not author-facing in that sense: its user is the person who just
finished a session, and the thing it produces is for their own next session
first and shareable second. It never needed the corpus, so it never needed to
be behind Campaign.

**And it was always the tier's least settled member**, on the tier's own account
([16 §4](16-authoring.md) as it stood): the only piece whose *surface* question
was open. That reads differently now. Inside a tier, an unsettled surface
question is a member that might have to be dropped late; as a release of its
own, it is the first question the release has to answer, and §6 is where it gets
answered rather than discovered.

### 1.3 What this costs

Inserting a release ahead of three others is not free, and two of the costs are
real.

- **The three predicate dialects now run apart for five releases rather than
  four** ([work plan §0.3](workplan/01-work-plan.md)). Lorebook activation
  conditions, `StepCondition` and the plot-hook filters each ship inside 1.0
  with a written guard against growing, and every release they run separately is
  a release in which each can acquire a convenience somebody then depends on.
  This change adds one to that count, and the count was already the sharpest
  cost of putting the tier behind Campaign.
- **The surface question closes two releases earlier** (§6). That is better for
  the design and worse for the calendar: [10 §2](10-ui-surfaces.md) has to
  settle what kind of place the Studio is before 3.0 rather than before 5.0.
- **World, Campaign and the tier each move back one release.** None of their
  gates is a calendar gate — World waits for accumulated play, Campaign for
  World, the tier for Campaign's corpus — so the ordering between them is
  untouched and each simply arrives one release later than it would have. The
  tier's corpus gets one more release to grow, which is the one place this
  change pays something back.

## 2. The problem it addresses

A Tavern-style card describes a character in prose and carries one picture. That
is enough for text roleplay and nowhere near enough to hand a character to an
image or video pipeline and get *the same person* back twice. Visual consistency
is the unsolved problem in this space, and everything the field has converged on
— reference images, multi-view sheets, structured descriptor tags, style
anchors, seed pinning, per-character adapters — needs somewhere to live.

The Studio's premise: **extend the card from a description of a character into a
usable visual identity**, so a card can drive a generation pipeline and produce a
stable likeness. That is a meaningful extension of what a character card *is*,
and it is the reason the format work is 1.0 while the tooling is not (§4).

## 3. What it is

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

The style/likeness separation in the fourth bullet is cited from outside this
document — [04 §3](04-schemas.md) and [14](14-writing-samples.md) both take it as
the precedent for separating a *writing* sample from a description of voice — so
it is a load-bearing distinction rather than a detail of the media model.

## 4. Why the format is 1.0 and the tooling is not

Two reasons. It is genuinely large — a curation UI, a generation pipeline, and a
consistency evaluation loop are three features. And it is the area where the
underlying technology moves fastest, so specifying the tooling early against
2026 techniques would be designing for the wrong thing.

The format is different: typed media roles and structured descriptors are cheap,
stable, and unpleasant to retrofit. Hence the split, and §5 is the half that
lands early.

**This argument sets a floor, not a date.** It says the tooling must not be
specified at 1.0; it says nothing about how long after 1.0 it should wait, and
it was never the reason the Studio sat at 5.0 — the tier's corpus was, and §1.2
is why that reason did not apply to it. Read forward, the same argument mildly
favours building sooner: a technique-sensitive surface designed five releases
out is designed against whatever we imagine 2029 looks like.

## 5. What this obliges 1.0 to do

The standing test ([24](24-roadmap.md) header: *what does this oblige 1.0 to
do?*). Four obligations, all small, none of them a feature at 1.0, and the first
is the one that is not recoverable.

- **Typed media roles**, not a flat image list ([03 §5.2.2](03-data-model.md)).
  The single most important one, because guessing which image is the canonical
  likeness is not recoverable later.
- **Structured `VisualDescriptors`** on the profile ([03 §2.1](03-data-model.md)).
  Fields now, or prose parsing later.
- **Per-media generation provenance**, reusing `GeneratedFieldProvenance`
  ([10 §11.2](10-ui-surfaces.md)) — which model, which prompt, which seed. A
  reference image whose seed was not recorded cannot be regenerated
  consistently, which defeats the purpose.
- **Crop as a stored rectangle** rather than a destructive edit
  ([03 §5.2.1](03-data-model.md)).

All four are Actor-card work, which is what makes the release check strict:

> **The Character Studio at 3.0 must add no portable schema change at all**
> ([work plan §0.2](workplan/01-work-plan.md)).

Not "no breaking change" and not "no new kind" — *no change*. The Studio is a
surface over a format that already exists, and if it turns out to need a field,
one of the four above was specified wrong. That is worth discovering as a failed
check rather than as a schema bump, and it is the strictest of the series'
checks as well as the first to run.

## 6. The surface question is open, and now closes earlier

**Whether the Studio is a panel, a mode of an existing surface, or something the
Write reframing absorbs is undecided**, and [10 §2](10-ui-surfaces.md) is where
it gets settled. It is a navigation argument, and a release is a bad place to
discover one.

What changes with the move to 3.0 is when it has to be answered. As a member of
a 5.0 tier it was a question for the tier's revisit; as a release it is the
**first** question, because the scope of 3.0 is not checkable until the answer
exists — a panel inside the actor editor and a fourth top-level surface are not
the same release.

Three candidate answers, none of them chosen here:

| Shape | What recommends it | What it costs |
|---|---|---|
| **A panel in the actor editor** | The Studio edits one object and the library already owns that object ([10 §2.1](10-ui-surfaces.md)) | A test bench and a generation queue are heavy for a panel, and the panel is then modal in practice |
| **A mode of an existing surface** | Modes belong to surfaces and this is not session-shaped ([06 §1](06-modes-and-turn-pipeline.md)) | There is no surface it belongs to: Play is session-shaped and Write is document-shaped |
| **A surface of its own** | Matches its weight — three features and a queue | A fourth top-level place for something used occasionally, which [10 §1.1](10-ui-surfaces.md) charges per visit |

**If the answer turns out to be the first one, the release should shrink rather
than the answer bend.** A panel is not nothing — the format is already in the
card and a curation panel makes it usable — but it is not a major release, and
discovering that is a better outcome than shipping a surface to justify a number.
§8 makes that a signal rather than an embarrassment.

## 7. Non-goals

- **Not a model training surface.** If per-character adapters become the
  standard answer, the Studio should *reference* one, not train it.
- **Not an image editor.** Crop and label, not paint.
- **Not required.** A text-only actor with no media stays completely valid, and
  nothing in the Studio may become a precondition for using a card.
- **Not a rendition redesign.** It consumes P9's pipeline
  ([06 §10](06-modes-and-turn-pipeline.md)); if it wants a change there, that is
  a change to renditions and should be argued as one.

## 8. How we would know this was wrong

- **Watch whether anybody curates a reference set by hand between 1.0 and 3.0.**
  The card carries the format from 1.0, so the work is *possible* the whole time
  — tediously, through the library editor. If people do it anyway, the Studio is
  a tool somebody wanted; if the typed roles sit unpopulated for two releases,
  the format was the feature and the tooling is our idea rather than a user's.
- **Watch whether the test bench ever fails.** The Studio's premise is that a
  described character does not come back the same twice. If the pipelines of the
  day hold a likeness from a prose description and one image, the consistency
  loop is solving a problem that stopped existing, and what remains is a
  curation panel (§6).
- **Watch what the surface argument answers.** If [10 §2](10-ui-surfaces.md)
  settles on a panel, this was a feature-list entry that briefly wore a release
  number, and the honest response is to put it back — 3.0 becomes World and the
  series shortens by one.
