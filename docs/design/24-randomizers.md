# 23 — Randomizers: outcomes and appearances, drawn rather than decided

**Status: outline.** Two agentic addons, wanted early, sketched far enough to
say where each sits in the existing design and what each asks of it. It defines
no schema and schedules nothing; [§5](#5-what-this-asks-of-the-design) is the
part addressed to the design rather than to the feature, and it is the reason
the note exists now rather than when either addon is built.

It reads
after [06](06-modes-and-turn-pipeline.md), whose guidance slot, step contract,
plot-hook selector and difficulty dial it leans on; after
[19 §14](19-tech-stack.md), whose RNG service is the mechanism; and after
[10 §11](10-ui-surfaces.md), whose field-assist path is where the second addon
lives. [02 §4.3](02-infinite-worlds.md) and [02 §5](02-infinite-worlds.md) are
the problem statement.

---

## 1. The failure both address

**A model asked the same question twice gives the same answer, and the answer
is the one that pleases.** Two forms of that, and they look unrelated until the
mechanism is named:

- **Plot collapse.** Given a context and an action, a narrator converges on the
  modal continuation — and the modal continuation is the one in which the
  action works. Sampling temperature does not help, because it varies *words*,
  not *plot*: [19 §14.6](19-tech-stack.md) already records that the model's own
  sampling is the source of new prose and nothing else. Ten rewrites of a turn
  produce ten phrasings of the same success.
- **Appearance collapse.** Asked to describe a character, a model reaches for
  the same handful of descriptors — and an image model, given those
  descriptors, renders the same face. A library grown by generation is a
  library of one person in different coats, and the collapse is invisible in
  text because prose hides it: *piercing green eyes* reads as a choice until
  the sixth card that has them.

The second is sycophancy's cousin rather than sycophancy itself — nobody is
being flattered — but the fix is the same shape, because the cause is: **the
model is being asked to choose, and a model's choice is its mode.** Both
addons take the choice away from the model and hand it to the one thing in this
design that is genuinely non-deterministic, recorded and replayable: the RNG
service.

**The shape, stated once so both sections can lean on it:**

> The model **proposes and labels**. The engine **weighs and draws**. The model
> **writes to what was drawn**.

That is [24 §4.2](24-roadmap.md)'s principle — *let a deterministic system do
the hard work, let the model do the voice* — and [24 §4.3](24-roadmap.md)'s dice
trap from the other side: a model asked to roll cannot produce a defensible
distribution, and a model asked to *rate its own candidates* cannot either,
because the rating is where the sycophancy went. The weights are never the
model's. They are the engine's, from a dial or a palette an author can open,
and every draw is on the tape.

---

## 2. Two addons, one mechanism, opposite order

The two are alike enough to share the principle and different enough that the
naive port of one onto the other would fail — which is worth saying before
either is built, because the second was proposed as *"a similar thing"* and it
is, but not in the order the first runs.

| | Plot randomizer | Appearance randomizer |
|---|---|---|
| **Where it runs** | The turn pipeline: a `generate`-stage step before narration ([06 §6](06-modes-and-turn-pipeline.md)) | The second call path: a field assist in the library ([10 §11.4](10-ui-surfaces.md)) |
| **What is enumerable** | Nothing. Outcomes are open-ended and turn-specific | Nearly everything. `VisualDescriptors` has seven fields with finite sensible values ([04 §3](04-schemas.md)) |
| **Order** | Model proposes several, engine draws one, model writes it | Engine draws the descriptors, model writes around them |
| **Why that order** | The model's candidates are genuinely different when forced to differ by kind (§3.2) | The model's candidates are samples of the collapsed mode; drawing among them re-samples the collapse (§4.2) |
| **Record** | The turn record: a step line, a call, a draw on the tape | Generated-field provenance ([10 §11.2](10-ui-surfaces.md)) — which has no tape today (§5.2) |
| **Rewrite / reroll** | Rewrite replays the draw; reroll redraws over the recorded set with no second call (§3.5) | Rewrite keeps the draw and rewrites the prose; redraw is a fresh palette pass (§4.6) |

---

## 3. The plot randomizer

### 3.1 Where it sits, and what it is not

**An evaluate-before-narrate step.** [02 §4.3](02-infinite-worlds.md) named the
pattern — *assemble → evaluate: what happens → narrate: how it reads → extract:
what changed* — and [06 §6](06-modes-and-turn-pipeline.md) said it was
expressible as a `generate` step feeding the main call and worth naming rather
than building. This is the first concrete instance that is not dice. The step
reads the player's input and the assembled context, makes one cheap call, draws
once, and contributes one block to the narration call. Nothing here is a new
mechanism; the whole of §3 is existing pieces in a particular arrangement.

**It is the plot-hook selector's sibling, with one substitution.**
[06 §6.1](06-modes-and-turn-pipeline.md)'s selector filters a pool
mechanically, asks a cheap model *which of these fits*, weights, and is
permitted to answer *none*. The randomizer has the same stages with the pool
replaced: the candidates are **written by the model for this turn** rather than
authored in advance. That substitution is the whole difference, and it is what
[03 §4.1](03-data-model.md)'s table was drawing when it separated the hook pool
from the Narrative Director's *model-generated hidden arc*. The randomizer is a
third thing beside those two: model-proposed, engine-chosen, and gone by the
next turn. It carries no arc and remembers nothing, which is what keeps it from
becoming the directedness [06 §7.3.2](06-modes-and-turn-pipeline.md) refuses.

**And it is a resistance mechanism, not a directedness one.** The outcomes it
draws among are outcomes *of the player's action* — it worked, it half-worked,
it failed, it worked and something else happened. Every one of them is still
the player's plan. That places it squarely on the axis
[06 §7.3.2](06-modes-and-turn-pipeline.md) calls resistance, and it is why the
difficulty dial is the right thing to weight it with (§3.3) and hook pacing is
not.

### 3.2 The call: propose by kind, and permit none

One call at the `fast` role — [19 §5.1](19-tech-stack.md)'s policy is that the
expensive model writes and everything that judges uses the cheap one, and this
judges. Structured output, since `StepCallRequest` already carries a `schema`.
The model returns a **small set of outcomes**, three to five, each with:

- **a one-line summary** of what happens — a premise in the plot-hook sense,
  not prose;
- **a kind**, from a closed vocabulary the step owns:
  `success · partial · failure · complication · twist`, or thereabouts. The
  exact set is a first-build question; that it is closed and small is not.

**The kind is the trick, and it does two jobs.** First, a model asked for four
outcomes produces four shades of success — that is plot collapse operating on
the candidate list instead of the prose. Asking for *one of each kind* forces
the spread structurally, so the model's sycophancy has nothing to collapse
onto. Second, the kind is what the engine weighs (§3.3). The model labels; it
does not rank. It is never asked *how likely is this*, because its answer to
that question is the thing being corrected.

**The call may answer *none*,** and must be told so. *"I look around the room"*
has no meaningful failure, and a randomizer that invents one produces the
incoherence [06 §6.1](06-modes-and-turn-pipeline.md) warns a too-eager hook
selector produces. A *none* contributes nothing and writes its reason to the
record like a pacing hold does.

**What the call sees, and what it does not.** It reads the input and whatever
context the step declares in `reads`. It **never sees guidance**, and that is
not a rule to remember but a property of the contract as built:
`callPurposeFor` in `turns/steps.ts` admits advisory blocks only to a step that
contributes to the visible message and writes nothing, and this step
contributes blocks. [06 §5.2](06-modes-and-turn-pipeline.md)'s exclusion of
guidance from *the pre-narration evaluation step that decides what happens* is
therefore already enforced for it — and the concrete case is the one that
matters: *"let me win this"* typed into the box reaches the narrator's prose
and never reaches the draw. A golden test should say so, since
[06 §5.2](06-modes-and-turn-pipeline.md) already promises one for exactly this
class of invariant.

### 3.3 The draw: the engine's weights, from the difficulty dial

The candidates carry ids; the engine assigns each a weight **by kind**; one
`weightedPick` at a stable site — `plot-randomizer:outcome` — and the winner's
id goes on the tape. Everything about that is [19 §14](19-tech-stack.md) as
built: `weightedPick` already records the winner's id rather than its position
([P6.2](workplan/18-p6-implementation.md)), so a replay against a list whose
membership changed refuses rather than mis-selects, which is the exact hazard
a model-written candidate list would otherwise pose.

**Where the weights come from is the design decision, and the answer is
difficulty.** [06 §7.3.1](06-modes-and-turn-pipeline.md) resolves difficulty to
two outputs — prompt language, and mechanical parameters consumed by Campaign
and by Freeform with dice on. The randomizer is a **third consumer of the
mechanical half**: a level supplies a weight profile over the kind vocabulary.
*Easy* leans on success and partial; *hard* leans on failure and complication.
That is what makes this a sycophancy dial with teeth in a mode with no dice,
which is the thing [06 §7.3.1](06-modes-and-turn-pipeline.md) said difficulty
*is* in Freeform and had no mechanism for beyond prose.

Three constraints on the profile, all inherited:

- **Success never weighs zero.** *Obstruction must not reach unreachability*
  ([06 §7.3.1](06-modes-and-turn-pipeline.md)) — a profile that cannot draw
  success at any level is a losing game the player cannot detect.
- **The profile is pack content, not engine code**, on
  [06 §7.3.1](06-modes-and-turn-pipeline.md)'s own argument: the layer that
  shapes model behaviour is the one an author can open. The vocabulary of kinds
  is engine-owned because the step's schema depends on it; the numbers are
  not. §5.7 is what that costs.
- **A kind the model did not propose is not drawn.** The engine weighs what was
  offered; it does not conjure a failure the model found no plausible shape
  for. This is the plot-hook selector's *cheap filter before expensive
  judgement* inverted — the judgement runs first because the pool does not
  exist until it does — but the filter still exists, as a post-hoc one: dedupe
  by kind, drop kinds the profile zeroes, weigh the rest.

### 3.4 Delivery: a verdict, not guidance

**The drawn outcome is not advisory, so it does not go through the guidance
slot.** [06 §5.1](06-modes-and-turn-pipeline.md) makes the guidance slot the
home for a *Narrative Director push* and [06 §6.1](06-modes-and-turn-pipeline.md)
fires hooks through it, and the natural move is to do the same here. It would
be wrong, for the reason [06 §5.2](06-modes-and-turn-pipeline.md) gives from the
other direction: guidance *influences prose and must never reach systematic
outcomes*, and the drawn outcome **is** the systematic outcome. It has the same
standing as a dice result handed down to the narrator — the thing
[24 §4.3](24-roadmap.md) describes as *the engine rolls before narration and
hands the outcome down; the model writes the consequence it was given*.

So it is an ordinary step block — `{ kind: 'step', stepId }` in the source
vocabulary [21 §1.1](21-internal-contracts.md) already has — carrying the
outcome's summary and kind, phrased as a constraint. Where that block lands in
the prompt is §5.3's problem, and it is a real one.

**The honest limit, stated the way [06 §5.2](06-modes-and-turn-pipeline.md)
states its own.** A narrator told *the lock holds and the guard hears you* can
still write a near-miss in which the guard is conveniently deaf. Nothing about
the draw compels the prose. What the mechanism guarantees is narrower: *the
choice of outcome was not the narrator's*, which is the half of the failure
that a prompt cannot fix and the half this addon exists for. Whether the
narration honoured the verdict is checkable — an `extract`-stage confirmation,
the same shape as the introduction hook's *provisionally fired, confirmed at
extract* in [06 §6.1](06-modes-and-turn-pipeline.md) — and worth building only
if real sessions show softening to be common. Recorded so it is a known second
step rather than a discovered gap.

### 3.5 Rewrite and reroll fall out, and they mean the right things

[19 §14.5](19-tech-stack.md) decided rewrite replays the tape and reroll draws
fresh. Applied here, without a line of new design:

| | The draw | The candidate set | The narration call |
|---|---|---|---|
| **Rewrite** | Replayed — same outcome | Replayed — same set | Re-run — different prose |
| **Reroll** | Fresh — a new outcome | **Replayed** — the same set, redrawn | Re-run |

The middle column is the one to notice. **Reroll does not call the model
again.** The set of outcomes was written once; rerolling is a second draw over
it, which costs nothing and makes *"not that one"* an instant action. And the
set being replayed on rewrite is what makes rewrite honest — *same setup, same
result, different words* ([19 §14.6](19-tech-stack.md)) is only true if the
setup includes the candidate list the draw was made over. A rewrite that
re-asked the model for outcomes would get a different list, the tape's recorded
winner would no longer be a candidate, `weightedPick` would correctly refuse the
replay and draw fresh, and rewrite would silently have become reroll.

That requires the step's call result to be **written once and replayed**, which
the pipeline does not do for step calls today. [06 §10.3](06-modes-and-turn-pipeline.md)
already does exactly this for one fragment — the rendition's *moment*, written
by a call, stored, and never asked for again on re-creation — and §5.1 is the
generalisation.

### 3.6 Pacing, and when not to fire

**Two dials, and they are the two axes [06 §7.3.2](06-modes-and-turn-pipeline.md)
keeps apart.** Difficulty sets how *harsh* the draw is (§3.3). A separate dial
sets how *often* the step judges at all — not every turn, in most sessions,
because a story in which every action has a drawn consequence is a slot
machine. The frequency dial is a channel in the shape hook pacing already
established ([06 §6.1](06-modes-and-turn-pipeline.md), [04 §6.1b](04-schemas.md)):
session scope, `update: "user-only"`, `budget: null`, `init` from treatment,
changeable mid-session as an effect. Its gate is a `chance(p)` draw inside the
step — on the tape like everything else, so a rewrite that was held stays held.

**A mechanical pre-filter runs before the call.** Input kinds exist
([06 §9](06-modes-and-turn-pipeline.md)); the step should judge *actions* and
stand down for speech, questions to the narrator and anything out-of-character.
Cheap filter before expensive judgement is the pattern, and here it also
removes the case where the model's *none* is most likely, which is most of the
call's wasted cost.

**A user-armed flag covers the other direction.** `StepCondition` already has an
`armed` arm, and *"randomize this one"* on a turn the dial would have skipped
is the play-side control — a cousin of the hook panel's *Commit*, minus the
patience, because there is nothing to wait for.

**Cost is one `fast` call per judged turn, itemised.** The turn record already
carries per-call cost; the dial is what keeps the multiplier honest, and the
record is what makes it visible when it is not.

### 3.7 With dice: the engine already has a verdict

In a mode where a dice step has resolved the action, the randomizer must not
resolve it again. Two steps deciding one outcome is worse than either alone.

**Composition goes through a channel, and that path exists.** The runner applies
a step's accepted effects before the next step runs, so a dice step that writes
its result to a channel can be read by a later step that declares that channel
in `reads`. The randomizer therefore has a real option beyond *off*: given a
roll, it narrows its vocabulary to the kinds that do not contradict it —
complications and twists on a success, a partial on a failure — and draws
among those. Whether that is worth building is a question for a mode that has
both; that it is expressible without a new mechanism is the point of recording
it.

### 3.8 The record

[06 §6.1](06-modes-and-turn-pipeline.md) holds the selector to a standard the
randomizer inherits unchanged: **nothing about a held or declined judgement may
be invisible.** The step writes its own line — filtered by input kind, held by
the dial, judged *none*, or drew *X* of *N* — and the *N* are shown, with their
kinds and weights, because the roads not taken are the most informative thing
in the record and the workbench already has a block list to show them in.

---

## 4. The character appearance randomizer

### 4.1 Where it sits

**A field assist, not a step.** *Generate an appearance* is already a named
assist ([10 §11.1](10-ui-surfaces.md)) with a context builder that sees the
actor's name, summary, tags and treatment; it targets `se.appearance` and, by
[04 §3](04-schemas.md), ought to fill `visual` alongside. The randomizer is
that assist with the choosing taken away from the model. It runs on the second
call path ([10 §11.4](10-ui-surfaces.md)): outside any session, at the `fast`
role, producing no turn record, recorded by generated-field provenance.

That placement has one consequence the plot randomizer does not have, and it is
§5.2: **the assist path has nowhere to put a draw.**

### 4.2 Why the order inverts

The plot randomizer works because a model forced to propose one outcome *per
kind* produces genuinely different outcomes. The equivalent here — ask for five
appearances, draw one — does not, because the five are five samples from the
same collapsed distribution. Drawing among them re-samples the collapse with
extra steps and a call's worth of cost. The instinct that the two are
*similar* is right about the principle and wrong about the order, and the
reason is [§2](#2-two-addons-one-mechanism-opposite-order)'s middle row: the
appearance space is **enumerable** and the plot space is not.

So: **the engine draws the descriptors; the model writes around them.** A
`weightedPick` per `VisualDescriptors` field — hair, eyes, build, face, an age
band, a skin tone, the things an image model actually keys on — from a
**palette** the engine owns, and then one call that is given the drawn
descriptors as fixed and asked for the prose appearance and the free-text
fields. The model's job becomes making *cropped auburn curls, deep-set grey
eyes, a heavy jaw* into a person, which is voice work, and voice work is what
it is good at.

**Hybrid for the fields that resist a palette.** `distinguishing`, `clothing`
and `accessories` are open-ended; for those the plot randomizer's order is
right — ask for several, draw one — because forcing the model off its mode
with a structured frame already in place (*this person has a heavy jaw and is
fifty*) is enough to make its candidates differ. The two orders are not in
tension; they are matched to whether a field is enumerable.

### 4.3 Palettes

**Weighted lists per field, with ids, so a draw is replayable and legible** —
*hair: `cropped-auburn-curls`* on a tape means something; index seven does not.
Where they live follows [06 §7.3.1](06-modes-and-turn-pipeline.md)'s argument
for difficulty levels: the layer that shapes what the model produces is the one
an author can open, so palettes are **pack content** with a shipped default,
overridable per treatment. A Regency drama and a cyberpunk setting want
different hair.

**Conditioned by what is already there.** The assist's context builder reads the
object; a field the author already filled is fixed, not drawn, and the drawn
fields must not contradict it. *A grizzled dwarf smith* in the summary is a
constraint on build and age, and a palette draw that ignores it produces the
one thing worse than a generic character: an incoherent one. The cheap version
is per-field pinning (§4.6); the honest version is a pre-pass that asks the
model which fields the existing text already determines, which is one more
cheap call and worth it only if pinning proves insufficient.

**Written at image-prompt granularity.** The palette exists to move an image
model, and *red hair* does not — *auburn, cropped, tight curls* does. This is
the same lesson as [06 §10.3](06-modes-and-turn-pipeline.md)'s rule that a
name never appears in an image prompt: descriptors are what the image model
sees, so they have to be the kind of thing an image model can see.

### 4.4 Diversity is a property of the population

**The stronger version does not draw uniformly; it draws away from what the
library already has.** *All near identical* is a fact about a collection, and
a randomizer that draws each character independently will still, over forty
cards, produce the palette's mode forty times. The fix is to down-weight
values already common among the user's actors — a library read, which the
assist path has, over `visual` fields, which are structured precisely so this
is a count and not a text comparison. Second tier, because it needs the first
tier's palettes and structured output to exist; recorded because it is the
version that actually answers the complaint.

### 4.5 `visual` is the source and the prose is derived

[17 §3](17-character-studio.md) leaves open which of `visual` and `se.appearance` is
authoritative and says only that they must not drift silently. **For a
generated actor this addon settles it: the descriptors are drawn first and the
prose is written from them.** That is a position on the open question, offered
rather than imposed — a hand-authored card may still run the other way — and
it makes the Studio's *derivable from it* reading the default for anything the
randomizer touched.

### 4.6 The surface

The field-assist contract ([10 §11.1](10-ui-surfaces.md)) gains one operation
and one affordance:

- **Redraw** beside **Rewrite**. Rewrite keeps the draw and re-runs the prose —
  [19 §14.5](19-tech-stack.md)'s pair, in the library. Redraw is a fresh
  palette pass. The distinction should be as visible here as it is in play,
  because *I like her but not that sentence* and *not her* are different
  requests.
- **Per-field pinning.** Lock the hair, redraw the rest. Structured descriptors
  make this a checkbox per field; prose would have made it impossible.

Revert and Accept-as-is apply unchanged. *Never auto-generate* and *never
block on the model* ([10 §11.5](10-ui-surfaces.md)) apply unchanged. And the
Studio's test bench ([17 §3](17-character-studio.md)) is where a draw is checked —
generate against the drawn identity and see whether the image model held it —
which is the first concrete consumer the test bench has been given.

### 4.7 What it does not fix

Image models collapse too. Two characters with different descriptors can still
render as the same face because the model has one face for *woman, thirties,
serious*. The randomizer moves the distribution of *inputs*; reference images
and the rest of [17](17-character-studio.md) are what move the distribution of
outputs, and this addon is a complement to that work rather than a substitute.
It is the cheap part, which is why it can come first.

---

## 5. What this asks of the design

The reason the note is written now. None of these is large; two of them touch
things that get expensive to change after P7.

### 5.1 Stable judgements: a step's call result must survive a rewrite

**The gap.** [19 §14.5](19-tech-stack.md) says rewrite replays the tape and
re-runs generation. It does not say what happens to a *judgement* call — a
`fast` call whose output seeded a draw. If it re-runs, the candidate set changes
under the tape, the recorded winner is no longer a candidate, and rewrite
degrades to reroll (§3.5). The plot-hook selector has the same exposure in
principle and has not felt it because its pool is authored and stable; the
randomizer's pool is model-written and is not.

**The precedent.** [06 §10.3](06-modes-and-turn-pipeline.md) solved this for the
rendition moment: written once, stored as the fragment it is, replayed on
re-creation, never asked for again. That is the right answer and it should be
a step-level contract rather than a rendition-specific one — a step marks a
call result as *stable*, the runner replays it on rewrite the way it replays
draws, and the record says which calls were replayed, as the tape already says
for draws.

**Touches:** [19 §14.5–14.6](19-tech-stack.md), the turn record in
[21](21-internal-contracts.md), the runner's replay path
([P6.2](workplan/18-p6-implementation.md)). Cheapest before any step depends on
the current behaviour.

### 5.2 Draws outside a turn have nowhere to be recorded

**The gap.** [19 §14.1](19-tech-stack.md) makes singular-and-recorded a
correctness property, and *recorded* means *in the turn's effects*. The assist
path has no turn ([10 §11.4](10-ui-surfaces.md)); its record is
`GeneratedFieldProvenance`, which carries `original`, `at`, `model` and `seed`
and no draws. An appearance randomizer built today would either draw
unrecorded — the exact thing [19 §14](19-tech-stack.md) forbids — or invent a
side channel.

**The fix is small and belongs in provenance**, because provenance *is* the
assist path's record and [10 §11.4](10-ui-surfaces.md) already argues that
what it does not capture cannot be recovered later: a `tape: Tape | null`
field, reusing the shared type. It buys Redraw-versus-Rewrite (§4.6) for free,
since a rewrite in the library is a replay against that tape.

**Touches:** [10 §11.2](10-ui-surfaces.md), and [04](04-schemas.md) if
provenance travels with the card — which it does, so this is a portable-schema
addition and wants doing once.

### 5.3 A step's verdict block cannot be positioned by a preset

**The gap.** `BlockSource` names `step` as one of the two sources *no slot
names, because no preset positions them*. The randomizer's verdict is a step
block. [04 §8.3](04-schemas.md) records that the strongest instructions in
modern presets sit a few messages from the newest, and an outcome verdict that
lands wherever unpositioned step blocks land — at the top, with the persona —
is the block most likely to be weakly honoured, which is §3.4's honest limit
made worse by placement.

**What is wanted** is a preset slot for evaluation verdicts — a source the
preset can position and wrap, filled by whichever `generate` steps produced
one this turn. Dice needs it too, and did not surface the need only because
the dice reference extension is unbuilt. This is the kind of widening
[22 §8](22-extensions.md) says the API must be prepared to do; it is also a
change to a portable schema, so it wants deciding rather than accreting.

### 5.4 Difficulty gains a third consumer, and the two dials stay apart

[06 §7.3.1](06-modes-and-turn-pipeline.md)'s table should gain a row: the
mechanical output is consumed by the randomizer's weight profile, in every mode
the randomizer runs in, dice or not. That makes difficulty *do something* in
Freeform without dice, which the section wanted and could not supply beyond
prose. The frequency dial (§3.6) is a separate channel and must stay one —
folding *how often* into *how hard* rebuilds the conflation
[06 §7.3.2](06-modes-and-turn-pipeline.md) exists to prevent.

### 5.5 The first production step that draws

[P7 §1.2](workplan/23-p7-implementation.md) records that `StepHost.rng` is
synchronous, cannot cross a worker hop, and that nothing at P2 draws inside a
step — so the async conversion is free now and expensive later. **The plot
randomizer is the step that makes *later* arrive.** Whichever lands first
should be written against the async `random` in [22 §4](22-extensions.md), not
the live `Rng`, and the conversion should precede it, exactly as P7's lean
already says. `rng.ts` itself notes that `pick` and `shuffle` still record
position rather than identity and that *the first production caller is where
it gets paid for*; the randomizer avoids the hazard by carrying ids and using
`weightedPick`, and should not be the caller that quietly relies on `pick`.

### 5.6 A principle worth writing into 14 §4.2

[24 §4.2](24-roadmap.md) says the deterministic system does the hard work and
the model does the voice. The randomizers sharpen it into something a step
author can apply without judgement: **a model may propose candidates and label
them; it may never weight them, rank them or choose among them.** The dice trap
is the special case where the candidates are numbers. Worth adding as a
sentence, because it is the rule every future *agentic* step will be tempted
to break at exactly the point where breaking it is invisible.

### 5.7 Weighted lists as pack content

Both weight profiles (§3.3) and palettes (§4.3) are *authored weighted lists* —
a kind of content the preset layer does not currently carry. Difficulty levels
are prose fragments; these are `{ id, label, weight }[]` per key. One schema
addition serves both, and it is the same shape the RNG service already
consumes, so the author's list is the draw's input with nothing in between.
Belongs in [04](04-schemas.md) beside the difficulty levels once those are
specified, which they are not yet in schema form either.

### 5.8 Where it lives before P7

[P2 §2.4](workplan/08-p2-implementation.md) put Scene mode in `server` on the
promise it relocates behind the SDK at P7 without changing shape, enforced by
`modes/contract.ts` enumerating what a mode may see. The plot randomizer should
take the same route: a built-in step on the P2 contract, reaching for nothing
that file does not export, so it is a move and not a rewrite when P7 arrives.
That also makes it a candidate third reference beside dice and poker
([24 §4.4](24-roadmap.md)) — cheaper than either, and the only one that
exercises structured output, a step that draws, and evaluate-before-narrate at
once. Whether it is *the* proof poker was chosen to be is a different question;
nothing here proposes it displace poker, only that it will find the same seams
earlier.

---

## 6. Open

- **The kind vocabulary** (§3.2). Five is a guess; the right set is whatever
  makes a model's candidates reliably differ, which only real prompts show.
- **Whether the narrator softens drawn failures often enough to need the
  extract-stage confirmation** (§3.4). Build without it, measure, add it if
  sessions say so.
- **The pre-pass for authored constraints** (§4.3) versus pinning alone.
- **Population-aware weighting's scope** (§4.4) — the user's whole library, or
  the actors of one world ([15](15-world.md))? A world is probably the honest
  population, since the complaint is *these characters look alike*, not *all my
  characters do*.
- **Whether the dice-aware narrowing (§3.7) is worth a mode declaring.** Cheap
  to express, unknown whether wanted.
