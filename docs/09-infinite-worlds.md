# 09 — Infinite Worlds as a fourth reference

**Status: proposal.** Infinite Worlds (infiniteworlds.app, Friendly Fox Games) is
a closed-source commercial browser service in the same genre as Aventuras'
Adventure mode — which already leans in its direction. This document records what
is worth taking from it and, more importantly, one structural gap it exposes in
[03](03-modes-and-turn-pipeline.md).

**Sources and their reliability.** The app itself would not render for
inspection (client-side error), so everything here comes from the community wiki
at `infiniteworlds.mywikis.wiki`. That wiki is user-maintained and lightly
moderated — its page index contains a large volume of unrelated SEO spam
alongside the real content — so treat specifics as indicative rather than
authoritative, and re-check anything a decision rests on.

**Boundaries.** IW is closed and commercial; there is no code to take and none
is proposed. Game mechanics, system architecture and UX patterns are fair to
learn from. Their specific default prompt text, their naming ("PawScript"), and
their branding are not ours to reuse. Much of the wiki's most valuable content is
authored by named community members and credited to them; the *approach* is the
lesson, not the text.

---

## 1. The observation that matters most

Set aside the feature list for a moment and look at the wiki's page index. Among
roughly 120 real pages, these are all community-authored **systems**:

> Morwen's Class Tree System · Morwen's Encounter Generator · Morwen's Loot
> Generator · Morwen's Weather Engine · Obscure Idiolect's Dating-Sim System ·
> Shakshuka Man's Plot Engine · Secondary's Memory System · Secondary's
> Agency-Based Evaluation · Secondary's Personality-Based Evaluation ·
> Secondary's Sycophancy Prevention · Secondary's Lightweight Anti-Omniscience ·
> Secondary's Scheduled Events · Sheena-Tiger's Events (v1, v2) · TWNT's
> Storymaster · Spork Witch time-based progression · Self's location tracker /
> delay timer / aging tracker / preference tracker · Thyr's Tracked Item
> Templates · Uncanary's Toolkit · Finite State Machine Quest Tracking ·
> Levelling Up Skills · Creating an Inventory · Storytelling Style Shifting

That is forty-odd pages of game systems built by *players*, with no engine
changes, using only tracked variables, trigger rules, conditional instruction
blocks and a small expression language.

**Marinara hardcodes weather, quests, maps, combat, HUD widgets and reputation.
Infinite Worlds' users wrote their own weather engine, loot generator, encounter
generator, class tree and quest state machine.** Same feature surface, arrived at
from opposite directions.

This is the strongest available evidence for the position in
[03 §4](03-modes-and-turn-pipeline.md) — that RPG systems should be authored
content rather than engine features — and it also shows that position is
currently under-specified. See §2.

A second-order observation from the same list: several of the most-referenced
community systems are not game mechanics at all but **fixes for model behaviour**
— sycophancy prevention, anti-omniscience (stopping NPCs from knowing things the
player never told them), agency-based evaluation. Authors are not just building
worlds, they are patching the narrator. That is a category of need none of the
three main sources treats as first-class, and it is worth taking seriously: see
§5.

---

## 2. The missing tier

StoryEngine's design currently has two extensibility tiers:

1. **Engine features** — written by us, in the core.
2. **Code extensions** — modes, steps and channels shipped as installable
   packages ([03 §9](03-modes-and-turn-pipeline.md)).

Infinite Worlds demonstrates a third that sits between them:

3. **Authored rules** — declarative logic written *by world authors*, carried as
   data inside the world itself, requiring no code and no installation.

Tier 3 is where IW's entire long tail comes from, and StoryEngine has no
equivalent. The closest thing is Aventuras' pack `RuntimeVariable`, which lets an
author *declare a variable* but not *state a rule about it*. Declaring
"Corruption: 0–100, purple, pinned" is a fraction of the way to "when corruption
reaches 50, change the objective and swap in a different instruction block".

### 2.1 Why this is safe, and how it resolves an open question

[06 A2](06-open-questions.md) asks whether a package may ship code, and leans no,
because importing a package would become a code-execution decision.

Authored rules dissolve that tension, because **rules are data, not code**. A
rule is a term in a closed vocabulary that *our* evaluator interprets. Importing
one grants no capability the importer doesn't already have. So A2's answer
sharpens to:

> **Packages may ship rules. Packages may never ship code.**

The security boundary is the closed vocabulary, which is exactly the property
that makes a declarative rules engine worth having over "let authors write
JavaScript". It also means shared content gets dramatically more expressive
without touching the extension-execution question in [06 A1](06-open-questions.md).

### 2.2 What this changes in the data model

- **Channels become author-declarable**, not only mode-declared
  ([03 §4](03-modes-and-turn-pipeline.md)). An author defines a channel in a
  package the same way a mode does; the mode-owned ones are just the built-in
  set.
- **Packages and settings carry a `rules` collection**
  ([02 §7](02-data-model.md)) — evaluated by us, versioned with the rule
  vocabulary, and inert if a referenced channel is missing.
- **Rules are a pipeline step**, not a new subsystem. Evaluate at end of turn,
  collect effects, apply through the same channel-effect path that
  model-proposed updates use, and record them in the turn record like everything
  else ([02 §8](02-data-model.md)).

---

## 3. The rules vocabulary worth stealing

IW's trigger events are a well-developed declarative rules engine, evaluated at
end of turn ("all triggers are evaluated, then the results of all relevant
triggers are applied"). The vocabulary is worth taking close to wholesale as a
starting point.

**Conditions** (all must hold):

| IW | Note |
|---|---|
| tracked item comparison | `at_least` / `is_exactly` / `at_most`; `contains` / `does not contain` |
| turn number | with a repeating option — gives "every N turns" |
| start of game | fires *before* play, enabling setup-only effects |
| random chance | percentage |
| specific character | by id, not name — correct, and the docs say so explicitly |
| **AI-evaluated event** | natural-language condition judged by a model |
| prerequisites / blockers | requires or forbids other rules having fired |
| fire-once vs repeatable | |

Two of these deserve comment.

**Prerequisites and blockers give you quest chains without a quest system.** A
DAG over rules expresses "this can only happen after that, and never once this
other thing has happened" — which is most of what a quest engine does. Cheap,
general, and it composes with everything else.

**AI-evaluated conditions are a genuinely interesting hybrid.** A rule can fire
on "the player has betrayed an ally" rather than on a number. IW caps these at
ten per world and its own documentation warns they "may produce false
positives" — an honest limitation that tells you the shape of the feature:
a bounded number of fuzzy conditions evaluated in one batched call, treated as
advisory rather than authoritative. Worth having, worth bounding, worth showing
in the turn record so an author can see when it misfired.

**Effects** worth taking:

| IW effect | StoryEngine equivalent |
|---|---|
| set / add / subtract tracked item, with dice (`<<1d20>>`) | channel effects |
| replace / append / remove on text items | channel effects |
| `giveGuidance` — instruction for the next turn(s) | a step-contributed block |
| `addSecretInfo` — hidden context, especially for the summariser | hidden channel |
| `changeInstructionBlock` — swap a named block's content | block override |
| `changeObjective` / victory / defeat conditions | see §4.1 |
| `changeAuthorStyle`, `changeDescriptionInstructions` | preset overrides |
| `randomTriggers` — fire one of a set at random | rule vocabulary |
| `effectPresentChoice` / `effectRequestInput` | **see §4.2 — we can't do this yet** |
| `endsGame` / `canContinueEndedGame` | session terminal state |

IW's docs single out `giveGuidance` as "the most reliable way to control what
the AI does next", which is consistent with Marinara's Narrative Director
arriving at the same mechanism independently. Two systems converging on
"a one-shot instruction block for the next turn" is a strong signal.

---

## 4. Three specific gaps this exposes

### 4.1 A mutable Objective slot

IW has a first-class **Objective** field, and its documentation notes the AI
"heavily considers the objective when writing its outputs" — which is why
`changeObjective` is one of the most powerful trigger effects available.

Neither Marinara nor Aventuras has quite this. Marinara has `playerGoals` fixed
at setup; Aventuras has story beats. Neither is a single, always-present,
*mutable* statement of what the story is driving toward.

This looks cheap and high-leverage: one short always-injected block, writable by
rules, by steps, and by the user. Worth trying early precisely because it is
small enough to evaluate honestly.

Victory and defeat conditions are the same idea taken further, and IW's own
documentation admits they are "finicky" — so take the Objective, treat
victory/defeat as an optional channel, and don't build a game-outcome system
into the core.

### 4.2 The pipeline cannot suspend for player input

`effectPresentChoice` presents options (single or multi-select, with limits) and
stores the answer in a tracked item. `effectRequestInput` collects free text,
optionally required.

**Our `StepDefinition` cannot express this.** As specified in
[03 §6](03-modes-and-turn-pipeline.md), a step contributes blocks, effects or
messages, and a turn runs to completion. Nothing can pause mid-turn and wait for
the player.

This is a real gap, not a nicety — it is how authored content asks a question
("which door?", "name your ship") without hoping the narrator remembers to. It
also interacts with the server-authoritative model
([04 §2](04-server-multiuser-deployment.md)) in a useful way: a suspended turn is
a job in a waiting state, which is already the right shape, and the client
reattaching to a prompt-for-input is the same mechanism as reattaching to a
streaming reply.

Proposed: steps may return a **suspend** outcome carrying an input request; the
turn job parks, the event stream publishes the request, the answer arrives as an
intent, and the turn resumes. Recorded in [06](06-open-questions.md) as C5.

### 4.3 An evaluation pass before narration

IW splits its specialist instructions three ways: **Evaluation** (how the AI
interprets the player's action and determines the outcome), **Description** (how
it writes the result), and **Summary** (the separate summariser).

The ordering is the interesting part. Evaluation runs *before* narration and
constrains it. That is how "your attempt fails because your skill is low" happens
without the narrator simply deciding to be nice — and it is structurally
different from Aventuras' `ClassificationPhase`, which runs *after* narration to
extract world state from what was written.

Both are worth having and they are not substitutes:

```
… assemble → [evaluate: what happens] → [narrate: how it reads] → [extract: what changed] → …
```

Our stage vocabulary already accommodates this — evaluation is a `generate` step
whose output feeds the main call — but it should be named as a pattern, because
it is the mechanism by which mechanics get teeth, and because "the model decides
outcomes while writing prose" is the default failure mode otherwise.

Related, and worth noting as a warning rather than a model: IW's summariser
reportedly first runs at turn 8 and cannot see the original background or
anything beyond six turns back. Fixed windows like that are what
[06 §E](06-open-questions.md)'s memory design should avoid.

---

## 5. Model-behaviour patching as a first-class need

Several of the most-cited community systems exist to correct the narrator rather
than to build the world: **sycophancy prevention** (the AI agreeing with and
rewarding the player regardless of merit), **anti-omniscience** (NPCs acting on
information the player never told them), and **agency-based evaluation**
(outcomes that respect what the character could plausibly do).

Anti-omniscience is the one with real structural depth, and none of the four
references solves it. Our data model has `hidden` on lore entries
([02 §3](02-data-model.md)), which handles "the player doesn't know this yet" but
not "*this NPC* doesn't know this yet". A per-actor knowledge scope is a genuinely
interesting channel — `knows(actorId, factId)`, updated when information is
exchanged in scene — and it would be a strong demonstration that the channel
model earns its keep. It is also the sort of thing that is nearly impossible to
retrofit into a prompt assembler that concatenates all lore into one block.

Not proposed for 1.0. Proposed as a **test case**: if a community member could
build lightweight anti-omniscience out of channels and rules without engine
changes, the extensibility design is working. Recorded as an acceptance test
alongside [08 §6.3](08-triage.md).

---

## 6. Expect to need an expression language

IW added PawScript — an expression and scripting language — in **July 2026**,
years into the product's life. It provides conditionals inside instruction text
(`if`, `choose`), random selection with list joining, and queries over structured
data (filtering an inventory by slot, for example).

Two lessons:

1. **Purely declarative rules run out.** IW operated on triggers and tracked
   items for a long time and eventually needed expressions. We should assume the
   same and pick the expression layer deliberately rather than bolting one on.
   Aventuras already uses Liquid; [03 §5](03-modes-and-turn-pipeline.md) proposes
   Liquid for block rendering. **The same expression language should serve
   template rendering and rule conditions** — one thing for authors to learn, one
   evaluator to sandbox.
2. **Structured tracked data wants a query surface.** IW's tracked items are
   text, number or XML, and the compelling example is filtering a structured
   inventory by location. Our `ChannelDefinition` carries a JSON Schema and a
   scope, which covers *storing* collections but says nothing about how an author
   *queries* one. Worth designing before the first collection-valued channel
   ships.

Their warts are informative too: a documented one-turn delay on variable
substitution, and a 10,000-character cap per tracked item. Both are the kind of
thing that comes from retrofitting.

---

## 7. Summary of proposed changes

| Change | Where | Size |
|---|---|---|
| Add authored rules as a third extensibility tier | [03](03-modes-and-turn-pipeline.md), [02 §7](02-data-model.md) | Large — the main finding |
| "Packages may ship rules, never code" resolves A2 | [06 A2](06-open-questions.md) | Clarification |
| Channels declarable by authors, not only modes | [03 §4](03-modes-and-turn-pipeline.md) | Moderate |
| Steps may suspend for player input | [03 §6](03-modes-and-turn-pipeline.md) | Moderate — new C5 |
| Name the evaluate-before-narrate pattern | [03 §6](03-modes-and-turn-pipeline.md) | Small |
| Add a mutable Objective block | [02](02-data-model.md), [03](03-modes-and-turn-pipeline.md) | Small |
| One expression language for templates and rules | [03 §5](03-modes-and-turn-pipeline.md), [07](07-tech-stack.md) | Decision |
| Per-actor knowledge scope as an acceptance test | [08 §6.3](08-triage.md) | Test, not feature |
