# 06 — Modes and the turn pipeline

**Status: proposal.** This document is the core of the design. If any single
piece is worth arguing about at length before writing code, it is §2 and §4.

---

## 1. Naming

**Settled.**

| Requirement's name | Name | Why |
|---|---|---|
| Marinara "Convo" | **Messages** | Says what it is. Nobody needs it explained. |
| SillyTavern/Marinara RP | **Scene** | Names the unit of play, and generalises to VN-style staging. |
| "Game Mode" | **Freeform** and **Campaign** | Two modes, named for the axis that actually separates them. |

**Freeform** is the Aventuras shape — do/say/think/story input, chapters,
world-state classification, branching, light or no mechanics. **Campaign** is
the Marinara RPG shape — party, sheets, combat, dice, map, clock. Freeform ships
at 1.0 and Campaign at 5.0 ([work plan §0](workplan/01-work-plan.md)).

**Modes belong to surfaces, and the grouping that used to sit above these two is
gone.** An earlier draft named a single mode **Adventure** carrying two presets,
*Adventure · Freeform* and *Adventure · Campaign*. Play now holds Scene,
Freeform and Campaign as three peer modes, and Write holds its own two
([10 §2](10-ui-surfaces.md)).

**What the preset framing was protecting is not lost.** Its load-bearing claim
was that Freeform and Campaign share a mode contract, so a Freeform game can
switch on the dice channel without becoming a different kind of thing. That is
still true, and it is true of *every* mode — sharing the contract is what the
contract is for, and it was never Adventure's to provide. What the grouping
added on top was a name for a pair, and a name for a pair earns its keep only
while the pair is the unit people choose between. With Campaign three releases
behind Freeform ([work plan §0](workplan/01-work-plan.md)), nobody is choosing
between them.

**Why Freeform rather than something loftier.** An earlier draft called it
*Chronicle*, which read as Campaign's sibling by being another grand noun and
suggested *recording* something that had already happened rather than playing
it. Campaign works because it is borrowed from the domain and everyone knows
what it means; the other preset needed the same treatment, naming the axis that
actually separates them — **how much structure the game imposes**. "Freeform RP"
is established vocabulary for roleplay without dice or stats, legible from both
tabletop and RP culture. *Solo* was the other contender and overclaims, since
companions are allowed ([§8](#8-party)).

`freeform` is the identifier and this change does not touch it. What moved is
where it sits: it was a preset id inside `mode.config`, and it is now the
`mode.id` itself ([04 §7](04-schemas.md)). **That move is free today and would
not have been later** — P7 has not built either mode, so no Setup object carries
the old shape, and `mode.id` is an uninterpreted string either way. Had this
arrived after real Setups existed it would have been a content migration.

---

## 2. The mode contract

A mode is **declarative**. It is not a subclass and it does not own a code path
through the engine; it is a manifest that configures a shared pipeline plus a set
of registered steps, channels and surfaces.

```ts
interface ModeDefinition {
  /** ~~"storyengine.adventure"~~ — §1 dissolved Adventure, and this example
   *  outlived it by every draft since. "storyengine.scene" (2026-09-13). */
  id: ModeId                      // "storyengine.scene"
  version: SemVer
  displayName: string
  presets: ModePreset[]           // "freeform", "campaign"
  /** Shipped and not sketched here: `voice` and `dispatch`, a pair rather than
   *  two fields — a narrator that speaks as one actor is a mode misdescribing
   *  itself. See `@storyengine/sdk`. */

  participants: ParticipantPolicy // §3 — who may speak and how turns are allocated
  assembly: AssemblyPlan          // §5 — which blocks, in what order, under what budgets
  steps: StepDefinition[]         // §6 — the pipeline
  channels: ChannelDefinition[]   // §4 — the state it owns
  inputs: InputKind[]             // free text / do / say / think / story / choice / …
  surfaces: SurfaceContribution[] // ~~§7~~ §9 — UI it contributes (2026-09-13)
  setup: SetupSchema              // the wizard, declared not coded
}
```

Everything an extension can do, a built-in mode does the same way. The built-in
modes must be implemented *only* through this interface — if a built-in mode
needs a back door, the contract is wrong and gets fixed rather than bypassed.
This is the single discipline that determines whether "additional modes as
extensions" is real or aspirational.

### Why declarative

Marinara's `gameExperienceId` + `experienceConfig` already gestures at this: a
package may provide an experience that "draws its own surface over the shared
narration", with config "stored verbatim and never interpreted by the host".
That's the right idea occupying one field of a 70-field struct. Promoting it to
*the* mechanism means the host never has a `switch (mode)` — which is precisely
what let Marinara end up with two combat systems.

---

## 3. Two orthogonal axes, not four modes

The requirements ask for Marinara's narrator/direct-RP distinction *and* for
merged-vs-individual multi-character calls. These are independent, and treating
them as one setting (as both sources partly do) is the mistake.

**Axis 1 — Voice.** What the model is being asked to be.

- `narrator` — one call producing third-person prose that may voice several
  characters, describe the world, and move time. Marinara's GM and Aventuras'
  narrator are both this.
- `embodied` — the model *is* one character. First-person/in-character output,
  no authority over the world. Classic SillyTavern.

**Axis 2 — Dispatch.** How many calls a turn makes.

- `merged` — one call covers all speaking characters. Cheaper, better at
  cross-talk and timing, weaker at distinct voices. The requirement's preferred
  default.
- `per-actor` — one call per speaking character. More expensive, better voice
  separation, and — the reason it must exist — it is what makes **per-character
  model selection** meaningful.

All four combinations are coherent:

| | merged | per-actor |
|---|---|---|
| **narrator** | Freeform and Campaign default; Scene "narrated" | narrator + per-actor dialogue passes |
| **embodied** | group chat, one call ("everyone responds") | classic ST group chat |

So: two settings, exposed per-session and overridable per-turn, rather than a
mode enumeration. `ModelHint` ([03 §2.6](03-data-model.md)) is only consulted
under `per-actor`, which is the honest statement of why it exists.

**Confirmed: `voice` may vary within a turn.** A narrator paragraph followed by
embodied dialogue from two characters, as three calls stitched into one message.
It multiplies latency and failure modes, so it is a **mode-preset capability**
rather than a per-turn toggle — a preset declares that it composes turns this
way, and the pipeline is already able to express it as several `generate` steps
feeding one message.

### 3.1 Who authors a character's words, and impersonation

`control` on a party member ([§8](#8-party)) says who normally authors that
character: `player`, `companion` or `auto`. Two things follow that are worth
stating together, because they are the same axis seen from both ends.

**More than one member may be `control: "player"`.** One human authoring two
characters is allowed — in Freeform and Campaign especially, where playing a pair is a
normal way to run a story. Nothing structural limits it, and this is also the
seam where genuine multiplayer would eventually attach
([09 §8](09-server-multiuser-deployment.md)).

**Impersonation is a per-turn override, not a separate feature.** SillyTavern's
*impersonate* — the model writes your next message *as your persona*, and you
edit or accept it — is simply a `player`-controlled member being model-authored
for one turn. Same mechanism, flipped for a turn.

Worth having because it is genuinely useful when stuck, when you want the
model's read on how your character would answer, or as a drafting aid you then
rewrite. Scene mode is its natural home and it should exist there at 1.0.

Three details that decide whether it feels right:

- **It is a draft, not a commitment.** The output lands in the input box,
  editable, and is not sent until the user sends it. Anything else takes
  authorship away rather than assisting it.
- **It is a `generate` step like any other**, so it is recorded in the turn
  record and rewrite/reroll apply ([19 §14.5](19-tech-stack.md)) — an
  impersonation you dislike is re-rollable without ceremony.
- **The persona's card is the subject, not the audience.** The call is
  `voice: "embodied"` on the persona, which is exactly what the axis above
  already describes.

---

## 4. Channels: the extensibility mechanism that matters

A **channel** is a named, typed, versioned slice of session state with declared
reducers. This is the generalisation of Marinara's HUD widgets / trackers / game
state and Aventuras' `EntryState` + `RuntimeVariable`s, and it is what makes
"cross-pollinate features across modes with a light hand" mechanical rather than
aspirational.

```ts
interface ChannelDefinition {
  id: ChannelId                   // "storyengine.clock", "storyengine.party.hp"
  owner: ModeId | ExtensionId | PackageId   // package: §4.1
  version: number                 // paired with ChannelState.version — [21 §1.3]
  schema: JSONSchema              // the state shape
  /** `hook` at P7.5 and `goal` at P7.6, each with a channel that needed it:
   *  a firing state is per hook and a goal's is per goal, and neither is a
   *  session value or an actor's. Added 2026-09-13. */
  scope: "session" | "actor" | "entry" | "hook" | "goal"
  init: InitPolicy                // literal default, from treatment, or generated at start
  update: "model-proposed" | "engine-computed" | "user-only"
  visibility: "player" | "hidden" // §7.3
  budget: number | null           // token cost when injected; null = never injected
  render?: string                 // how the value reads in a prompt — P7.1
  surface?: WidgetSpec            // how it renders in the HUD, if at all
  /** Terminal values a person confirms before they apply — P7.2, and what
   *  [25 C12](25-open-questions.md)'s answer turns on. */
  confirm?: readonly string[]
}
```

***Reconciled with [21 §1.3](21-internal-contracts.md) on 2026-09-11, at
[P7.0](workplan/23-p7-implementation.md), and the timing is the point.*** This
sketch was missing `version` and `visibility` outright, wrote `owner` without
`PackageId` — which §4.1 immediately below says 1.0 owes from the first channel
definition, *"because widening it afterwards is a migration over every stored
channel"* — and named an `UpdatePolicy` alias that exists nowhere. 21 §1.3 said
it differed by *"one field"* and it differed by four.

**Left to the phase, that reconciliation happens after the type ships.** P7.0
published `ChannelDefinition` through `@storyengine/sdk`, which is the moment a
sketch that disagrees with it becomes a published contract disagreeing with its
own design note — and the first mode author to read this section would be reading
the wrong shape. So this section is corrected against what shipped rather than
the other way round; where the two still differ is a *schedule*, stated next.

~~**Four members are specified here and deliberately absent from the shipped
type**: `schema`, `init: InitPolicy`, `migrate` (21 §1.3's, not shown above) and
`surface?: WidgetSpec`. [21 §6](21-internal-contracts.md) defers `InitPolicy` and
`WidgetSpec` because they *"want the mode contract built first"* — that contract
is the SDK, and P7.1 is the stage that designs them against their first real
consumer. They stay in this sketch because it is the design, and their absence
from the package is recorded in the package.~~

***One member, not four*** (2026-09-13). The sentence above forecast its own
expiry correctly and nobody came back: `schema`, `init` and `surface` all shipped
at [P7.1](workplan/23-p7-implementation.md), the very next stage, and `init`
shipped **required** rather than optional — a channel that cannot say where it
starts has not really been declared. `render` and `confirm` joined them at P7.1
and P7.2 and are in the sketch above now.

**Only `migrate` is still absent**, and its argument stands on its own rather
than on [21 §6](21-internal-contracts.md)'s deferral, which has itself been
struck: a hook that sits inside the replay path should not have its contract
guessed before a channel needs one, and after fifteen stages of channels none
has.

The properties that make this worth doing:

- **A mode enables channels; it doesn't implement them.** Campaign turns on
  `hp`, `inventory`, `quests`, `clock`, `weather`, `map`, `reputation`.
  Freeform turns on `clock`, `chapters`, `relationships` and leaves the rest
  off. A user who wants dice in Freeform turns on one channel. No new mode, no
  fork, no pre-designed combination.
- **Channel state is injectable context**, budgeted like everything else — which
  is the fix for [00 §2.6](00-stance.md).
- **Channel updates are the effects in the turn record**, individually
  reversible, which is the fix for [00 §2.8](00-stance.md) — undo becomes
  "invert the effects of the newest turn" rather than a hand-maintained snapshot
  struct. Reaching further back is branch-and-replay, not inversion — an effect's
  recorded `before` is only a valid inverse while nothing has touched the same
  path since ([21 §1.2.1](21-internal-contracts.md)).
- **`update: "engine-computed"` is where determinism lives.** Marinara is right
  that combat round math is calculated by the engine, not the model, "so results
  stay fair and consistent". Generalised: any channel may declare that the model
  *proposes* and the engine *decides*.
- **Authored channels come free.** Aventuras' pack-defined `RuntimeVariable`
  ("Corruption, 0–100, purple, pinned") is a channel with `scope: "actor"`
  declared by a preset rather than by code. Same mechanism.

Channel values keyed by definition id, never by display name, so renaming is free
— stolen directly from Aventuras' `RuntimeVarsMap`.

### 4.1 Channels should be author-declarable, not only mode-declared

Added after surveying Infinite Worlds ([02](02-infinite-worlds.md)), which is
the strongest evidence for this whole section — and which shows it is currently
under-specified here.

~~As written above, a `ChannelDefinition` has an `owner: ModeId | ExtensionId`, so
new state requires code.~~ **Not as written above, and not since P7.0** — §4's
sketch accepts a `PackageId` because this section asked it to, and the point
below survives the correction unchanged: a package can *carry* state, and nobody
outside code can *declare* it. *The shipped type is already exercised on the
third arm: the retriever's timing channel is owned by `storyengine.lore`, which
is a package and not a mode.* (Corrected 2026-09-13 — §4 was reconciled at P7.0
and this back-reference to it was not.) Infinite Worlds lets *world authors* declare tracked
variables and write declarative rules over them, shipped as data inside the
world, and its community used that to build weather engines, loot generators,
class trees, quest state machines and dating sims with no engine involvement.

**Scope: the tier is committed; the vocabulary is 6.0, the authoring tier**
([work plan §0.4](workplan/01-work-plan.md), [§0.6](workplan/01-work-plan.md)).
Channels and engine-computed effects ship at 1.0 and are where the power actually
is. What waits is the predicate/effect vocabulary, its evaluator and its
authoring surface — a language design project, and one Infinite Worlds only got
right after years of real authored worlds to design against. We have no such
corpus, and designing an expression language against imagination produces one
nobody can use. What follows is therefore the shape to preserve room for, not a
1.0 feature list.

**It is a release behind Campaign rather than beside it, and the reason is the
sentence above this one.** Campaign is a *mode*, not an author: its determinism
is `update: "engine-computed"` in mode code (§4), and nothing in §7.3 needs a
predicate language. What a rules-less Campaign cannot do is let somebody else
author one — which makes this an authoring feature that Campaign *produces the
corpus for*, rather than one Campaign consumes.

So there is a **third extensibility tier** between "engine feature" and "code
extension": authored rules. Concretely:

- `owner` may be a package, not just a mode or extension.
- Packages and treatments carry a `rules` collection — declarative
  condition/effect pairs over channels, evaluated as an end-of-turn step, with
  effects applied through the same path model-proposed updates use and recorded
  in the turn record like everything else.
- Rules are **data, not code**: terms in a closed vocabulary our evaluator
  interprets. That is what makes them safe to import, and it sharpens
  [25 A2](25-open-questions.md) to "packages may ship rules, never code."

The rule vocabulary itself is [25 C7](25-open-questions.md);
[02 §3](02-infinite-worlds.md) proposes a starting point for when it is designed.

**What 1.0 owes the deferral** — the two things that would make the tier
impossible to add later rather than merely absent:

- **`owner` accepts a package id**, not only a mode or extension id, from the
  first channel definition written. Widening that field later is a migration
  over every stored channel.
- **Effects apply through one path** — model-proposed, engine-computed and
  authored-rule effects all land as `ChannelEffect`s in the turn record. If rules
  ever need a private application path, the tier was bolted on rather than
  designed for, and reversibility ([07 §2](07-branching.md)) stops holding
  uniformly.

Both are free now. Neither is a rule engine.

### 4.2 When a channel's schema changes under a live session

Inevitable, and the temptation is to forbid it. Modes will evolve, extensions
will evolve carelessly, and a session that has been open for three months will
meet a channel that has changed shape.

**Rejected: embedding the schema and running the old one.** It looks like
compatibility and is a trap. Every session becomes a schema store; the engine
has to keep every historical version of every reducer, step and widget alive; and
nothing can ever be removed. The cost compounds and it is paid forever.

**Record the version, never the schema.** One integer per channel saying which
schema version its state was written against. That is all that is needed to know
whether anything has to happen.

#### Calibration: this is a low-stakes failure wearing a scary costume

Worth establishing before deciding how much machinery it deserves. Channel state
is **tracked numbers and flags** — HP, a clock, a reputation. It is not the
story. Losing it is annoying; the messages, the branches and the turn records are
untouched. The worst honest outcome is *this session's inventory got reset*, and
designing as though the session itself were at risk would be over-building.

#### The rule already exists: survivable, visible, non-blocking

[00 §3.3](00-stance.md) settles dangling references — resolve what you can, show
what you cannot, never block. A channel whose state no longer fits its schema is
the same situation wearing different clothes, and gets the same treatment.

**A session must always open.** Load never fails on a channel problem.

Per channel, on load:

1. **Validate** against the current schema. Cheap — schemas are JSON Schema and
   the validator is already in the stack.
2. **Coerce** if it fails: drop unknown fields, fill declared defaults, re-validate.
3. **Migrate** if it still fails and the definition ships a `migrate(fromVersion,
   state)`.
4. **Quarantine** if it still fails: preserve the raw value verbatim under a side
   key, initialise the channel to its default, mark it degraded, and carry on.

**Most schema evolution never reaches step 3.** Additive changes validate
already; removals are handled by dropping unknown fields. Migration functions are
for the genuine minority — a type change, or a newly required field with no
sensible default — which is why they are *optional* rather than mandatory. For
built-in modes we write them. For third-party extensions we cannot require them,
and the fallback has to be good enough to live with.

#### The error surface is the point

The part worth building properly, and the part the sources have nothing like:

- **The session carries a health record** — which channels are degraded, which
  version they were written against, and why they failed.
- **A persistent banner on that session**, not a modal and not a log line:
  *"2 channels could not be loaded. Your story is unaffected."* The reassurance
  is load-bearing; without it people assume the worst.
- **Recovery is offered, not automatic** — retry the migration once the author
  ships a fix, edit the quarantined value by hand, or accept the reset. The raw
  value survives until the user chooses, which is what makes "accept the reset"
  a safe button to press.
- **The same path covers an uninstalled extension**, whose channels are
  unreachable rather than mis-shaped. One mechanism, two causes.

#### Two constraints this puts on migrations

- **Migrations must be pure and deterministic.** They sit inside the replay path
  ([07 §4](07-branching.md)): replaying effects written under v1 produces
  v1-shaped state, which is then migrated to v2. A migration with side effects or
  a clock in it would make state reconstruction non-reproducible, which is the
  one invariant branching depends on.
- **Snapshots are invalidated by a migration**, and that is free — they are
  derived and disposable by design ([07 §4](07-branching.md)), so a migration
  discards them and the next reconstruction rebuilds.

---

## 5. Assembly: from objects to a request

The pipeline's context stage produces `AssembledBlock[]`
([03 §8](03-data-model.md)) in four steps:

1. **Collect.** Every source offers candidate blocks: the persona, present
   actors, the treatment's framing, channel snapshots, retrieved lore entries
   (all retrievers in [03 §3](03-data-model.md) run here), history, preset
   blocks, and blocks contributed by pipeline steps.
2. **Annotate.** Each candidate carries its source, its reason for inclusion, its
   role and its token cost. The reason is a string built by the retriever
   ("keyword match: 'cathedral'", "pinned", "party location == Rain City"), and
   it is a product feature, not a debug string.
3. **Budget.** One arbiter, one policy, applied to *everything* including blocks
   we are confident matter. Output is a verdict per block: included, or dropped
   with the rule that dropped it.
4. **Render.** Blocks become provider messages. This is the only place that knows
   what a chat API looks like — and, should the decision in [19 §5.5](19-tech-stack.md)
   ever be revisited, the only place a completion renderer would have to
   touch ([00 §2.2](00-stance.md)). It carries one decision worth naming:
   **adjacent blocks with the same role** — six consecutive `system` blocks are
   one message or six. Providers differ and some reject consecutive same-role
   messages outright, so it is a **provider capability** rather than a global
   choice, and a merged message still records which blocks produced it or the
   workbench loses its mapping. Shape in
   [21 §2](21-internal-contracts.md).

The `AssemblyPlan` in the mode definition declares the ordering constraints and
budget policy; it does not build strings.

**The preset supplies the blocks, in two kinds** ([04 §8.1](04-schemas.md)): a
**slot** positions content the engine produces — persona, actor sections, lore,
history, channel state — optionally wrapped; a **text block** is prose the preset
author wrote. Step 1 above collects candidates for the slots; the text blocks
*are* candidates already. The split is not ours originally: SillyTavern's prompt
manager arrived at it independently, distinguishing the two with a `marker`
boolean inside one array.

**One consequence for the budgeter, and it is the expensive one.** A preset may
place a block *inside* the history run — four messages from the newest, which is
how most modern ST presets carry their strongest instructions
([04 §8.3](04-schemas.md)). So **history is a splittable source, not an atomic
block**: the assembler can emit `history[…-5]`, a block, then `history[-4…]`, and
the budgeter must trim a run with something embedded in it.

This is not the thing [00 §2.1](00-stance.md) rejects. That objection is to
character offsets into an assembled string; "after the Nth-newest message" is a
structural position over a list the engine owns, it survives editing and
branching, and it appears in the turn record as an ordinary ordered block. The
cost is real and worth paying — refusing it would mean importing the existing
corpus of presets into something that runs but behaves differently.

*Amended 2026-09-27.* **Paid for, and until now not delivered.** The
OpenAI-compatible adapter joined every system message into the leading system
prompt, so a system block spliced into the history reached the model at the top
of it. The adapter now sends a later system block where it sits, as user text
(SillyTavern's *semi-strict* shape), which is the position the turn record has
always shown.

Templates (Liquid, following Aventuras) render *within* a block. Aventuras'
`PackTemplate` dual-hash trick — `contentHash` plus `baselineHash`, where the
divergence distinguishes "app shipped a new default" from "user edited this" — is
the correct solution to updating shipped templates and should be adopted
wholesale.

### 5.1 The guidance slot

**Every session's input carries an expandable guidance box**, in the style of
the optional guidance field Infinite Worlds exposes. It is collapsed by default
and empty by default. It is the supported home for the thing people currently do
by typing `(OOC: keep this short)` into their action.

That habit is a workaround with real costs, all of which follow from the meta
instruction being *inside the story text*: it lands in history permanently, gets
summarised into memory as though it were narrative, is scanned by lorebook
keyword matching, can be read back as dialogue, and appears in exports. None of
that is intended by the user typing it. Giving it a field of its own fixes all
six at once, and it means **no mode needs an OOC convention baked into its core
prompt text**.

**It is a block, never message content.** Guidance is assembled as its own
`AssembledBlock` with its own source and role, positioned by the preset. It is
not concatenated into the user's turn.

**It is one-shot.** Guidance applies to the turn it was written for and does not
persist. Standing instructions are a different feature with a different home —
Marinara's Author's Notes, injected every turn. Conflating the two produces
accumulating meta-instruction, which is the failure the box exists to prevent.
It is recorded in the turn record ~~(so a rewrite replays it,
[19 §14.5](19-tech-stack.md))~~ but does not enter the message history that
later turns assemble from. *(Struck 2026-09-06: as built, the record keeps
guidance only as an assembled block with its wrapper applied, and a plain redo
resends the turn's words and not its instruction — so a rewrite does **not**
replay it. Whether it should, and what the record would need, is
[25 C14](25-open-questions.md).)*

**One slot, several producers.** The same block can be filled by the user's box,
by an authored rule's `giveGuidance` effect ([02 §3](02-infinite-worlds.md)), or
by a step such as a Narrative Director push. Treating them as one slot means the
rule below applies to all of them without three separate arguments.

**A second advisory slot: the previous attempt — DECIDED.** A redo may carry
an instruction ([07 §7](07-branching.md)), and "make it rain harder" needs an
*it*: on a guided redo the model is shown the sibling it is redoing, beside the
instruction saying what to change. That is a slot of its own rather than a
fourth producer of this one — the content is prose the model wrote, not an
instruction, and the record has to say *which* attempt was shown — so it has
its own `SlotSource` and `BlockSource` arm, `attempt`, carrying the turn id
([04 §8.2](04-schemas.md), [21 §1.1](21-internal-contracts.md)). Everything
else about it is this section again: positioned by the preset, with a wrapper
that says what it is; advisory, forced by the collector rather than left to the
author, and refused by §5.2's firewall; one-shot; recorded in the turn record
as a block and never entering the history later turns assemble from. What
fills it is the server's own record — the submission names a turn, as it does
for the tape ([19 §14.5](19-tech-stack.md)) — so the model is shown what was
written and not what a client says was. A plain redo sends nothing here, and
its prompt is exactly what it was.

### 5.2 Guidance is advisory, and must not reach systematic outcomes

**Specification: guidance influences prose. It must never be admissible to any
call or computation whose output determines a systematic result.**

Concretely, guidance is excluded from:

- the RNG service and anything consuming it ([19 §14](19-tech-stack.md));
- the pre-narration **evaluation** step that decides what happens
  ([02 §4.3](02-infinite-worlds.md));
- **rule condition evaluation**, including AI-evaluated fuzzy conditions
  ([02 §3](02-infinite-worlds.md));
- any **engine-computed** channel update ([§4](#4-channels-the-extensibility-mechanism-that-matters));
- extraction/classification steps whose output is applied as channel effects.

The previous attempt of a guided redo ([§5.1](#51-the-guidance-slot)) carries
the same marker and sits behind the same refusals, for a sharper reason than
the instruction does: it is the model's own discarded reply, and an extractor
that saw it would record the events of a reply nobody kept as having happened.

The fuzzy-condition case is the sharp one and the reason this needs stating
rather than assuming. Those *are* model calls. If guidance were in their context,
"the player has clearly betrayed her by now" typed into the box would trip a
rule, and the user would have talked their way past a mechanic without touching
it. The same applies to an evaluation step: guidance must not be able to argue a
failed check into a success.

**Enforce it structurally, not by convention.** Guidance blocks carry an
`advisory: true` marker, and the assembler refuses to admit advisory blocks to
any call declared as producing effects or verdicts. Steps declare which they are
([§6](#6-steps-and-the-pipeline)), so this is checkable rather than remembered.
Because every block is recorded with its source ([03 §8](03-data-model.md)), a
golden test can assert that no advisory block ever appears in an evaluation,
rule or extraction context — which makes this one of the cheaper invariants to
keep honest.

**The honest limit.** Guidance shapes narration, and extraction reads narration,
so an indirect path exists: "make Vera furious" produces a furious scene, and the
classifier records her disposition accordingly. That is not a leak, it is the
system working — guidance changed the *story*, and state follows the story. What
the rule guarantees is narrower and worth stating precisely: **no direct path
from guidance to a roll, a rule verdict, or an engine computation.** Claiming a
total firewall would be false, and users will find the indirect path immediately.

---

## 6. Steps and the pipeline

Aventuras' phase list is the starting point:
`pre → retrieval → narrative → classification → translation → image → post`.

Generalised: a turn is an ordered sequence of **steps**; the built-in stages are
just steps that always exist. A step declares what it reads, what it writes and
where it may run:

```ts
interface StepDefinition {
  id: StepId
  stage: "pre" | "assemble" | "generate" | "extract" | "post"
  /** `cast` added at P7.12 — who is in the scene and what pictures travel with
   *  them, the manifest and never the bytes. A mode's expression selection
   *  could not see an actor's expression set at all, and being handed the cast
   *  without declaring it would have been the back door §2 refuses.
   *  `transcript` added at P8.1 — what was said and what came back, and nothing
   *  about how either was produced. `history` hands over whole `Turn`s, and a
   *  `Turn` carries every block's text: a hook's premise, an unfired entrance's
   *  finished prose, a hidden channel's rendered value. [08 §6] asks that memory
   *  never be extracted from those and that the refusal happen *at the source*,
   *  which against a payload of whole turns is not expressible. */
  reads: (ChannelId | "history" | "output" | "cast" | "transcript")[]
  writes: ChannelId[]
  contributes?: "blocks" | "effects" | "messages"
  callKind: string                // what a preset's `appliesTo` filters on — [04 §8.2]
  when: StepCondition             // cadence ("every 8 turns"), stage flags, user-armed
  failure: "abort" | "warn" | "ignore"
  role: ModelRole | null          // the role its call asks for, or null — [19 §5.1]
}
```

**What the three failure modes do**, because the list above names them and P2.5
had to make them genuinely distinguishable — an enum with two identical members
is decoration:

| `failure` | the pipeline | the turn | `step.failed` on the stream | in `Turn.steps` |
|---|---|---|---|---|
| `abort` | stops | `failed`, and still **appended with its blocks** | yes | yes |
| `warn` | continues | unchanged — may still be `complete` | yes | yes |
| `ignore` | continues | unchanged | no | yes |

`abort` is not job abandonment. An abandoned job writes no turn at all, and the
partial record — what was assembled, what was called, how far it got — is the
thing somebody needs in order to re-run it. **A user's cancellation overrides the
declared mode**: a stop is not a warn.

`ignore` still appears in the record. Silence about a step that ran is the
failure [09 §3.3](09-server-multiuser-deployment.md) calls out for `skipped`, and it is no
better here; what `ignore` buys is not showing a *live* alarm for something the
author already decided is unremarkable.

**`StepCondition` is deliberately not an expression language.** At 1.0 it is a
small closed set — a cadence, a stage flag, an explicit arm by the user — and
`StepDefinition` is internal ([04 §10](04-schemas.md)) rather than portable, so it
is free to grow later. Naming it separately from the authored-rule vocabulary
matters, because the tempting move once rules arrive is to let steps take rule
predicates, and that quietly makes an internal shape depend on a portable one.

Two additions from [02](02-infinite-worlds.md), both recorded as open questions
rather than folded in above:

- **Evaluate before narrating.** Infinite Worlds splits its instructions into
  evaluation (what happens), description (how it reads) and summary. Evaluation
  runs *before* narration and constrains it — which is how mechanics get teeth
  instead of the narrator deciding outcomes while writing prose. Structurally
  distinct from Aventuras' post-hoc classification, and both are worth having:
  `assemble → evaluate → narrate → extract`. Expressible today as a `generate`
  step feeding the main call; worth naming as a pattern.
- **Steps cannot suspend for input, and should be able to.** Nothing here can
  pause mid-turn to ask the player a question and resume with the answer. See
  [25 C5](25-open-questions.md).

### 6.1 The plot-hook selector

The worked example of a step that is genuinely an "agent" in the Marinara sense,
and the consumer of [03 §4.1](03-data-model.md)'s hook pool.

**Two stages, and the order is the whole design.**

1. **Mechanical eligibility.** Filter the pool by `involves` (cast alive and
   introduced), `requires`, `blockedBy`, `notBefore`, and already-fired. No model
   call. This is what stops a hook firing about someone who died four sessions
   ago, and it also cuts thirty hooks to a handful before anything expensive
   happens — a package with a large pool must not mean thirty premises in a
   prompt every turn.

   **An introduction hook ([04 §6.1a](04-schemas.md)) reverses one clause of
   this and keeps the rest**: its subject must *not* be introduced, must still
   resolve, must carry no terminal status, and must be neither the persona nor
   already in the party. The reversal is why the subject is declared in
   `introduces.actor` rather than `involves` — one field cannot mean *must be
   here* and *must not be here at once* — and the clauses it keeps are why the
   subject is not simply exempt.

   ***"Introduced" is defined at [§8.1](#81-presence-and-status-who-is-here-and-who-is-still-alive)***,
   which it had to be: this filter and `involves` have both spent the word since
   they were written, and neither said what it meant.
2. **Judgement.** One cheap call over the survivors: *is now a good moment, and
   which of these fits what just happened?* Weighted, and permitted to answer
   "none".

Cheap filter before expensive judgement is the pattern; inverting it is both
costlier and worse, because a model asked to consider ineligible hooks will
argue for them.

**Firing goes through the guidance slot** ([§5.1](#51-the-guidance-slot)). The
selector is simply a fourth producer of that block, so `delivery: "guidance"`
needs no new mechanism — and `delivery: "seed"` is the same block with an
instruction to expand rather than weave. `"immediate"` is the only one that
writes narrative directly, and it should be the rare choice.

Note the asymmetry with [§5.2](#52-guidance-is-advisory-and-must-not-reach-systematic-outcomes):
the *guidance* a hook emits is advisory like any other, but a hook's `onFire`
effects are ordinary channel effects and are not. That is correct — the author
declared those consequences deliberately, whereas the narrator's rendering of
the twist should not be able to reach back into the machinery.

**An introduction hook's firing is provisional, and that is not a special case
so much as an honest reading of the slot it fires through.** Guidance is
advisory; the narrator may decline it. For an event hook a decline is a miss and
the pool is none the worse. For an introduction hook it is a silent permanent
loss — marked fired, character never arrived, and once-only. So the hook is
recorded *provisionally fired* and becomes fired only when the extract stage
confirms the subject present on that turn; unconfirmed, it returns to the pool
with the attempt on the record. Bias toward under-firing, exactly as
[§7.3.3](#733-goals-an-adventure-has-a-win-condition-by-default) chose for goal
completion and [§8.1](#81-presence-and-status-who-is-here-and-who-is-still-alive)
for death.

**And it carries two things into the turn that the assembler cannot supply.** A
subject who is not in the session cast contributes no block and no aliases, so
without help the narrator writes a stranger from the entrance text alone and the
mention pass ([§8.2](#82-mention-resolution-is-an-extract-step)) fails to link
the arrival on the one turn it matters. Firing therefore contributes the
subject's card for that turn and adds their aliases to the shared keyword scan.
Both are existing producers pointed at an actor the cast does not yet contain —
and the scan is the third consumer of the one pass, which is the argument for
having built it as a pass rather than a lorebook feature.

**Pacing is what makes this work or fail.** A selector that fires every third
turn produces incoherence, not drama. It needs a cooldown after firing, a cadence
rather than judging every turn, and an author-facing dial:

```ts
type HookPacing = "sparse" | "normal" | "aggressive" | "manual-only"
```

**The dial is a channel** ([§4](#4-channels-the-extensibility-mechanism-that-matters)):
session scope, `update: "user-only"`, `budget: null` so it never enters a prompt,
and `init` *from treatment*. Every property it needs is already there — it is
changeable mid-session, the change is an effect on the record, and it branches
correctly — so it costs no new concept. A Treatment proposes it, a Setup
overrides, the session owns it thereafter ([04 §6.1b](04-schemas.md)).

**The dial is *not* a `StepCondition`, and the reason is worth recording because
it is invisible from this document.** A committed hook (below) needs the selector
consulted every turn; a `sparse` dial needs it consulted rarely; one step cannot
declare both. And a condition cannot see channel state at all, so it can know
neither how long since the last firing nor that a hook is committed. So **the
selector step runs every turn and the dial is a gate inside it, before the
judgement call.** That costs nothing, because stage 1 is deliberately model-free —
and re-reading the phrase above, it is the *judgement* that has a cadence, not
the step.

Two things follow that are worth having anyway: eligibility can be shown live on
every turn, which is one of the authoring affordances below; and `manual-only` is
a coherent state rather than a dead step, because the filter still runs and still
reports and only the judgement is off.

**Level → cadence, cooldown and patience is engine code; the level's prose is the
prompt pack's.** [§7.3.1](#731-difficulty-is-a-sycophancy-dial-not-a-stat-modifier)
puts difficulty's levels in the pack, and the half of that argument which
transfers is the half about *prose* — how "sparse" should read to a model
genuinely belongs where an author can edit it. The numbers do not: their effect is
that a step does not run, which is invisible in the turn record by construction,
and letting a portable preset set internal scheduling inverts the dependency the
step contract exists to keep one-way.

**`aggressive` must not reach railroading**, which is this section's version of
§7.3.1's *obstruction must not reach unreachability*. The dial changes how often a
hook is **considered**. Guidance stays advisory at every setting and none of them
makes the narrator comply — otherwise the top of the dial is not brisk pacing, it
is the directedness [§7.3.2](#732-resistance-and-directedness-are-separate-axes)
spends a section refusing.

**Nothing about a held hook may be invisible.** A selector that returns early
because of pacing is indistinguishable, from the outside, from one that ran and
judged *none* — and a step's skip reason is derived from its condition, so it
cannot carry this. The selector therefore writes its own line into the turn
record: pacing-held, nothing eligible, judged none, or fired X, with the
per-hook reasons behind it. This is the standard the assembler already meets when
it records why a slot was not filled, and without it *which are blocked and by
what* is answerable in the abstract but never for the turn in front of you.

**Authoring affordances are part of the feature, not polish.** Somebody with
thirty hooks cannot test them by playing to turn 200. They need to see which
fired, which are eligible now, which are blocked *and by what*, and to force-fire
any hook to see how it reads. Without the last one, large hook pools are
unauthorable in practice.

#### Firing a hook by hand: two controls, and they are not two strengths of one

**Commit** is the play affordance and the one this design had been missing. *"I
want this to happen — not necessarily on this turn"* is the sentence the whole
feature is for, and until now the only way to act on it was to add a hook and
hope. Committing a hook marks it must-fire immediately: it skips eligibility (a
person overriding a filter is a decision, not a bug), it is exempt from cooldown
and cadence, and it opens the pacing gate every turn until it lands — which is
what makes *immediately* an honest word under `sparse`. What it does **not** do is
choose the moment. Stage 2 still runs, with the question changed from *whether*
to *where*, and that is the difference between committing a hook and forcing one.

Three rules keep it honest.

- **Skipping the filter must say what it skipped.** The failure this section
  names twice is a hook firing about someone dead four sessions ago; a control
  that permits it silently reintroduces that failure by hand. The confirmation
  names the clause that failed and proceeds.
- **Patience is bounded, and the deadline is a lapse rather than a firing.**
  Three turns. A commitment that waits forever is indistinguishable from no
  commitment, and one that fires anyway at the deadline delivers the twist at the
  exact moment the selector has already rejected three times — the worst
  available moment, and the incoherence this section opened by warning about. So
  it returns to the pool and **says so**, because a silent lapse is worse than
  either outcome. A constant rather than a setting: pacing is untested, and a
  number nobody has played against is a guess, not a tunable.
- **Patience counts turns on the path**, like every other cadence here. Commit at
  ten, fire at twelve, rewind to eleven, and the commitment correctly survives
  with one turn already spent — which only holds if the count is derived from the
  path rather than stored.

  *(2026-09-27)* **The turns every count here reads are turns of the story** — a
  turn somebody took, which has an input, an output, or the steps a job ran. The
  path also holds turns nothing narrated: a channel write (a HUD edit, this
  dial, a commitment), an undo, a divergence, a *Remember this*, a backdrop
  choice, each a change to the record that has to branch like one. Until this
  date every count read the path's length and so counted those too: a hook
  authored `notBefore: { turn: 12 }` came in at the ninth turn of a session with
  a few HUD edits, turning the dial moved the cadence it was turning, and two
  edits after a commitment spent two of its three chances. The counts are still
  derived from the path (`sessions/depth.ts`), which keeps the rewind argument
  above true, and skip what nobody narrated. The same reading now holds for a
  step's `everyNTurns` (§6), `list`'s speaker rotation and a lore entry's
  `delay`. ~~*Not yet for the history window*, which still takes the last N
  turns of the path: it has to move with the summary chain's boundary, or the
  two overlap or leave a gap between them.~~ The window followed, with the
  chain: it takes the last N story turns, and the summary chain covers the rest
  of the same list, so they meet without a gap or an overlap.

**Force-fire** is the authoring affordance above, and it stays what it sounds
like: the hook is delivered on the next turn with no judgement call at all. *The
alternative was considered and declined.* A scratch preview that generates
without joining the tree would spare the author a rewind — but rewind here is a
pointer ([07](07-branching.md)), the rewrite-versus-reroll distinction is already
specified, and the workbench already promotes a dry run. Auditioning a hook is
therefore a short loop, and buying a marginally shorter one with a second
assembly path to keep correct is a bad trade. Recorded so the preview reading is
not rediscovered as an oversight.

The two live in different places for a reason that is not filing: Commit is a
move in the story and belongs where the story is played; force-fire is a test of
the material and belongs in the workbench, beside the keyword test and the dry
run it is a sibling of ([10 §3](10-ui-surfaces.md)).

#### Scope: data structures from the beginning, a simple selector early

**Both ship at 1.0.** The data structures because they are cheap and foreclose
nothing; the selector because plot hooks are one of the clearest things
StoryEngine does that its sources do not, and a data structure nobody can use is
not a differentiator. Expect it to do relatively little in early practice —
pacing judgement takes tuning — and build the simple version anyway.

Replaceability follows retrieval's pattern: a built-in selector that an
extension may substitute, since pacing is an opinion.

#### Hooks must be addable to a running session

The use case is specific and worth naming, because it is most of why the feature
earns its place: *"I have just realised I want this plot point to come up — but
not necessarily on this turn."* That is exactly what a hook is for, and it
arrives mid-session far more often than at authoring time.

So **a hook added while a session is running becomes eligible from the next
selector pass.** No restart, no re-import, no new session.

This brushes against prefill-not-binding ([00 §3.1](00-stance.md)) — a session
copies from its treatment and holds no live link — so the reconciliation matters:

- **Session-local hooks are the primary path.** Add a hook *to the session*. It
  is session state, immediately eligible, and no principle is bent. This serves
  the use case above directly, and is what the "add a hook" button does.
- **Treatment changes are pulled, never pushed.** Edit the treatment and the session
  offers it: *"the treatment has 2 new hooks — add them?"* Nothing changes without
  the user asking, so the session still owns its own pool, and someone who wants
  the hook in future sessions too gets that without a second act of authoring.

The distinction is not pedantry: a *pushed* update would mean editing a treatment
could silently alter a story in progress, which is the failure prefill-not-
binding exists to prevent.

**This unifies "agent" and "pipeline stage".** Marinara's agents — Narrative
Director, Prose Guardian, Echo Chamber, tracker agents, Music DJ — are all steps
under this definition, differing only in stage and cadence. Marinara's own docs
describe the Narrative Director as writing a snippet that is saved, viewable,
editable and re-runnable before regeneration; that is exactly "a step contributes
a block, and the block appears in the turn record". Same for Aventuras'
`ClassificationPhase`, which is a step that reads output and writes channels.

Consequences worth stating:

- Steps run **server-side**, so they survive a client disconnect
  ([09](09-server-multiuser-deployment.md)).
- A failing step must not lose the turn. `failure: "warn"` with a retry
  affordance is the default; Marinara's per-agent failed-list-with-retry is the
  right UX and generalises.
- Step costs are itemised in the turn record. "Agents add cost because they make
  extra calls" should be visible per turn, not a documentation note.

---

## 7. The modes

**Modes belong to surfaces** (§1, [10 §2](10-ui-surfaces.md)). The Play surface
holds three of them across two releases — **Scene and Freeform at 1.0**,
**Campaign at 5.0** ([work plan §0](workplan/01-work-plan.md)) — plus the
assistant (§7.4), which is not a chat mode but is built out of the same parts.

**Messages is specified here and is not scheduled.** It was a 2.0 mode until the
release re-cut moved it off the schedule entirely; it now sits on the feature
list as one candidate mode of a possible Social surface
([24 §3.4](24-roadmap.md)). §7.1 is unchanged and is most of the reason that
cluster is worth defining rather than dropping — the design is done, and what is
missing is the decision about what surface it belongs to.

**Write is a surface rather than a mode**, and its two modes — Outline and Prose
— are specified in [13](13-write-mode.md) rather than here. It gets a pointer
rather than a §7.5 deliberately: everything above configures the pipeline over
the same artefact, while Write changes what the result lands in — a manuscript
rather than a transcript — so listing it as Scene's peer would invite exactly
the reading [13 §6](13-write-mode.md) exists to prevent. That was the argument
when Write was a fifth mode; calling it a surface states the same thing more
directly.

### 7.1 Messages — **not scheduled** ([24 §3.4](24-roadmap.md))

Messenger-shaped. Marinara's Conversation mode is the reference and it is the
most complete of the three sources.

Take: presence status (global, per-user), per-actor weekly schedules, autonomous
first-contact messages, reactions (both directions), per-actor display name and
about-me under `modeData`, group threads with no separate "group mode", and the
gated command-family model where package-owned actions only appear when the
package is installed.

Design notes:

- Default dispatch: `embodied` + `merged` for groups; `per-actor` available.
- Autonomous messages are the first hard requirement for **server-side
  scheduling** — a character messaging you first cannot depend on a browser being
  open. This forces the architecture in [09](09-server-multiuser-deployment.md)
  and is a good early forcing function.
- Presence is per-*user*, and in a multi-user install "Do Not Disturb" is
  per-user-per-actor-relationship, not global to the server. Small thing;
  easy to get wrong.
- Leave out at 1.0: table games, calls, haptics, Spotify. All should be
  *expressible* as extensions; none should ship.

### 7.2 Scene — **1.0**

The SillyTavern/Marinara RP shape: staged scene, optional background and sprites,
optional HUD, one or more actors present.

Design notes:

- Both axes from §3 exposed directly in the session settings. This is the mode
  where the requirement's "narrator vs direct RP" and "merged vs per-call" both
  live, and they should be two visible controls with plain-language labels, not a
  four-way enum.
- ST's activation strategies (`NATURAL`, `LIST`, `POOLED`, `MANUAL`) are a good
  taxonomy for `ParticipantPolicy` and should be taken as such — with the
  implementation being "the policy selects speakers", not card-swapping.
- ~~Sprites, backgrounds and expression selection are steps writing to
  channels.~~ **Three things, three writers** — corrected 2026-09-13, at
  [P7.12](workplan/23-p7-implementation.md), which built the sentence and found
  it not quite true. *Read as written it forces
  [25 C16](25-open-questions.md)*: `se.backdrop` is `engine-computed`, which
  §8.1's refusal denies a step, so *steps writing to channels* looks like a
  contradiction demanding a policy change. It is not, because the three things
  named do not share a writer:
  - **A background's pointer is the engine's.** A model choosing what the scene
    looks like is a model deciding where you are, which is a fact about the
    session rather than about the prose. A person may set it; [P9] writes it
    through the engine, the route a hook firing and a goal achievement already
    take.
  - **An expression is a model's judgement** — *is she angry now* — so
    `model-proposed`, which admits a step. That is what makes the sentence true
    of the half it is actually about.
  - **Text-only is a person's setting**, so `user-only`.

  **C16 stays open and stays unforced**, which is the right outcome for a
  question that should be answered by the first mode that cannot proceed without
  it. This one could.

  Text-only must remain a fully supported first-class configuration, as it is in
  both sources — *and it is by construction rather than by care*: with staging
  off no step runs, no channel moves and every contributed region renders
  nothing.
- **A background channel says which backdrop is showing; §10.1a says where the
  image comes from.** *Declared at [P7.9](workplan/23-p7-implementation.md) as
  `se.backdrop`, with the media union this paragraph demands and the rendition
  arm dead until [P9](workplan/26-p9-implementation.md) — which is the whole
  content of the obligation. `se.expression` and `se.location` joined it at
  P7.12; the latter collects what P9's backdrop selector assumes and P7.9 did not
  declare.* The two halves were separated for years by the fact that
  SillyTavern answers the second one with a folder. The channel's value is a
  media reference that may name either an image somebody uploaded or a
  rendition's asset, and it has to be that from the declaration onward: narrowing
  it to a filename now means changing a channel's schema under live sessions
  later (§4.2) to admit the generated case.
- Scene branching (Marinara's "scenes" as side branches) is not a Scene-mode
  feature; branching is a session-level capability from
  [03 §8](03-data-model.md) available in every mode.

### 7.3 Freeform **1.0**, Campaign **5.0**

Two Play modes over one contract, specified together because their design is one
argument (§1).

**Campaign** — the Marinara RPG shape. Channels: party sheets, HP/pools,
attributes, inventory, quests, map, clock, weather, NPC reputation, session
summaries. Narrator voice, merged dispatch, engine-computed combat resolution.
Sessions-within-a-campaign with structured recaps and a bridging message on
resume — a genuinely good pattern that should be a shared capability, not
Campaign-specific.

**Freeform** — the Aventuras shape, and per the requirements the one most likely
to be used. Typed input (`do` / `say` / `story` / free), chapters with
summarisation, world-state classification after each turn, retrieval over prior
chapters, branching, suggested actions. Light or no mechanics *by default* —
with the dice, HP or inventory channels available as toggles rather than as a
different mode.

Design notes:

- **World generation must be incremental.** See [00 §2.3](00-stance.md). Campaign
  setup produces world overview, map, cast, sheets and widgets as *separate
  validated generations*, each individually retryable, applied as they succeed.
  This is the single biggest reliability difference available versus the source.
- Hidden GM state (Marinara's Show Spoilers / plot arcs; the Narrative Director's
  Secret Plot) is a channel with `visibility: "hidden"` and a reveal affordance.
  Generalising it means Scene and Freeform get it free — which is exactly the
  cross-pollination the requirements ask for.
- The three address modes (in-scene / to the party / to the GM) generalise to an
  **input target** on the input bar, available to any mode with more than one
  addressable audience. Messages mode gets "reply to X" from the same mechanism.

#### 7.3.1 Difficulty is a sycophancy dial, not a stat modifier

Freeform and Campaign setup carries a **difficulty** treatment, in the spirit of
Marinara's.
The thing worth being precise about is what it actually controls, because the
obvious reading — a number added to rolls — is the smaller half.

In Freeform there are frequently no rolls. What varies with difficulty is **how
readily the world grants what you attempt**, which is to say it is a dial on
narrator sycophancy — the failure mode named in [02 §5](02-infinite-worlds.md) as
one of the things the community builds systems to correct. So difficulty
resolves to two distinct outputs, and a mode declares which it consumes:

| Output | Consumed by | Effect |
|---|---|---|
| **Prompt language** | Both modes | Ranked fragments describing how much to concede, how often attempts partially fail, whether the world volunteers help |
| **Mechanical parameters** | Campaign, and Freeform with dice or HP toggled on | Target numbers, resource pressure, enemy competence |

Three things this has to get right.

**The levels live in the prompt pack, not in engine code.** A difficulty level is
a named entry with prompt fragments attached, shipped in the preset layer and
replaceable there. This is the same reasoning as [04 §6.2](04-schemas.md): the
layer that shapes model behaviour should be the layer an author can open and
edit, and its effect should be visible in the turn record rather than buried in a
conditional. "Hard" meaning something different in one prompt pack than another
is a feature.

*Built at [P7.8](workplan/23-p7-implementation.md): `Preset.difficultyLevels`
and `Preset.directednessLevels`, positioned by a `{ of: "difficulty" }` or
`{ of: "directedness" }` slot, one emitted block per ranked fragment.*

**It must be changeable mid-session**, recorded as an effect like anything else.
Difficulty chosen at setup is chosen with the least information anyone will ever
have about the session. The predictable failure is picking Hard, discovering
every scene is a slog by turn 30, and having no recourse but to start over.

**Obstruction must not reach unreachability.** Difficulty modulates the cost and
the route, never whether the goal can be attained at all. Without that floor,
the top treatment is not hard mode, it is a losing game the player cannot detect
they are playing.

#### 7.3.2 Resistance and directedness are separate axes

Worth separating explicitly, because conflating them is a real and observable
failure. Infinite Worlds is notably opinionated about where a story should go —
it will actively fight a player to get back to what it wanted to do. That is
*not* the same quality as a hard game, and it is much less pleasant.

- **Resistance** — how readily the world grants what you attempt. High
  resistance means your plan fails, or costs more than you hoped, or works
  partially. **It is still your plan.**
- **Directedness** — how hard the narration pulls toward its own idea of the
  story. High directedness means the narrator keeps steering back to the thing
  it intended regardless of what you did.

A naive difficulty implementation raises both together, because the prompt
language for "push back" and the prompt language for "assert your own plot" look
similar from the outside. The result is railroading wearing difficulty's
clothes, and players report it as *the AI ignoring me* rather than as *hard*.

*Built at [P7.8](workplan/23-p7-implementation.md): two channels a mode declares
through the SDK's `dialChannel`, `user-only` so the sycophancy dial is not wired
to the sycophant, and two slot arms rather than one with a discriminator — the
conflation this section is about, refused at the point where layout would
otherwise decide it. [04 §7](04-schemas.md)'s standing `[OPEN]` about where a
dial's live value lives is answered there.*

**So: two settings.** Difficulty is the headline one and maps to resistance.
Directedness is a separate control with a low default — some is wanted, since a
narrator with none is a stenographer, but it should never be a hidden passenger
on the difficulty slider. This is also where plot hooks
([03 §4.1](03-data-model.md)) belong on the dial: hooks are the *honest* form of
directedness, authored and selected in the open, which is a better mechanism
than a narrator improvising a pull.

**So there is a third control, and it is specified at [§6.1](#61-the-plot-hook-selector)
rather than here**: hook pacing, sparse through manual-only. It is a channel and
not a mode setting, because hooks are on every treatment and every setup and are
not one mode's feature the way difficulty is ([04 §7](04-schemas.md)). The floor
that keeps it from becoming the hidden passenger this section is about: the dial
changes how often a hook is *considered*, never whether the narrator must use
one.

#### 7.3.3 Goals: an adventure has a win condition by default

Adopted from both sources, and a genuine divergence from the SillyTavern
lineage: **these modes have something you are trying to do, and progress toward
it is tracked.** Not an optional extra bolted on by an author — the default
shape, with "no goal, just play" as the deliberate opt-out.

This promotes the mutable Objective slot from [02 §4.1](02-infinite-worlds.md)
out of *worth trying early* and into a 1.0 feature, and it is what makes §7.3.1
coherent. Difficulty without a goal can only say "introduce friction", which is
weak and quickly reads as arbitrary. With a goal it can say **obstruct progress
toward this specific thing**, which is a far more useful instruction and one the
narrator can act on deliberately. The goal statement is therefore always
injected, and difficulty fragments are written to reference it.

Schema in [04 §7.1](04-schemas.md). The shape in brief: a short always-injected
`statement`, an optional fuller `detail` for steps, a `visibility` that makes
hidden goals the GM's arc through the same mechanism as hidden channels, and a
`completion` that is narrative or manual. Mechanical completion — computed from
channel state — needs the authored-rule vocabulary and arrives with it at 6.0
([work plan §0.6](workplan/01-work-plan.md)). Campaign at 5.0 is where mechanical
completion *earns* its place, but it is not what supplies it: a `Goal` sits on
Setup, which is authored content, so the condition belongs to whoever wrote the
game rather than to the mode running it.

**Progress is a channel** (§4), which settles how it is maintained without a new
mechanism: `update: "model-proposed"` in Freeform, where there is nothing to
compute from and the narrator's judgement is the only signal available;
`update: "engine-computed"` in Campaign, where quest state is real data. Same
declaration, different policy, and the proposal-versus-decision seam is already
specified.

**Completion detection is the part that will need tuning.** `kind: "narrative"`
means an evaluation step at `post` judges whether the goal is met — the
before-narration evaluation pass from [02 §4.3](02-infinite-worlds.md), pointed
at a different question. Both error directions are bad and they are not
symmetric: a missed completion is an annoyance the player can resolve manually,
while a false completion ends the story on a turn that did not earn it.
**Bias toward under-firing, and make manual completion always available.**

~~**[OPEN]** Whether narrative completion should require confirmation before it
fires. Cheap insurance against the worse error, at the cost of a prompt at the
most dramatically loaded moment in the session.~~

***[RESOLVED] — ask*** (2026-09-13, [25 C12](25-open-questions.md),
[P7.6](workplan/23-p7-implementation.md)). `se.goal` declares
`confirm: ['achieved']`, so the judge's completion is recorded on the turn and
**not applied**: the three offers of §7.3.4 do not raise and the goal panel asks.
*The cost priced above was wrong* — it assumed a confirmation meant a second
prompt, and `ChannelDefinition.confirm` (built at P7.2 for terminal statuses)
makes it a refusal a person rules on at their own pace instead. Manual
completion is unaffected, because the gate is checked for `model` and `step`
proposals only.

#### 7.3.4 What happens at the end: both answers

The two sources diverge here and both are right, so the treatment takes both.
Infinite Worlds lets a concluded game continue open-ended; Marinara lets you set
the next goal. On completion, three offers:

- **Continue open** — the goal channel retains it as achieved, nothing new is
  set, play carries on without a driving objective.
- **Advance** — set the next goal, either the authored `next` or one written
  now. This is the campaign-arc shape and the reason goals are a **sequence
  rather than a field**.
- **End** — mark the session concluded. Concluded is a state, not a deletion:
  the session stays readable ([10 §12](10-ui-surfaces.md)) and branchable
  ([07](07-branching.md)), because "what if I had done it differently" is a
  reasonable thing to want at exactly that moment.

**The choice is made at completion, not only at setup.** `thenDefault` seeds the
offer; it does not decide it. A player who did not know at setup whether they
wanted an ending is the normal case, and the moment of completion is when they
finally have the information.

Completed goals are retained with the turn that completed them. That gives the
reading view real structure for free — an adventure's goal chain is a much
better spine for chapters than word count is ([25 E1](25-open-questions.md)) —
and it gives the plot-hook selector (§6.1) a signal it otherwise lacks:
proximity to the current goal is a strong reason to fire a hook or hold it.

### 7.4 The assistant

A baked-in AI helper, in the spirit of Marinara's Professor Mari: summonable
anywhere, knows the app, and can help you build things rather than only explain
them. It complements the in-editor field assists ([10 §11](10-ui-surfaces.md))
rather than replacing them — those are for *this field*, the assistant is for
"help me work out what I'm doing".

**It is a session, in a mode, with an actor card. That is the whole design.**

Everything else follows for free, which is the point:

| Already built | Applies to the assistant unchanged |
|---|---|
| Sessions, turns, event stream | It streams and reconnects like anything else |
| The turn record and workbench | Its own calls are inspectable — you can debug the thing that debugs your setup |
| Rewrite / reroll | "Say that again differently" costs nothing to implement |
| Guidance box | "Be brief" as an out-of-band nudge |
| Branching | Explore two approaches to a problem |
| Notifications | A long analysis finishing tells you |
| Per-user ownership | It acts as you, with your permissions, over your library |

If building the assistant requires a parallel chat implementation, something in
the mode contract is wrong — so this doubles as a test of
[§2](#2-the-mode-contract), alongside [§9](#9-what-an-extension-mode-has-to-be-able-to-do).

#### Capabilities belong to the mode, personality to the card

The split that makes card-swapping work, and the same one as
[00 §2.4](00-stance.md): the card carries voice, the mode carries what it can
*do*. Swapping the assistant's card changes how it talks and nothing else. Point
it at a roleplay character for fun and it still works.

The default assistant card ships as an ordinary actor in the library, editable
and replaceable like any other.

#### Tools: domain, not filesystem

Marinara's assistant has `read`, `grep`, `find`, `ls`, `edit`, `write` and
**`bash`**, backed by a shell sandbox. That is a coding-agent tool surface, and
it is the one part of the design not to copy. On a multi-user LAN server, an
in-app assistant with shell access is a privilege-escalation path wearing a
friendly hat — any user who can talk to it can talk it into running something.

Scope tools to the **domain** instead: search and read the app's own docs;
read and propose changes to library objects the user owns; explain the assembled
context of a turn; diagnose a failing preset or a lorebook that never fires.
Everything expressed as library operations, which are already permission-scoped
per user ([09 §4.3](09-server-multiuser-deployment.md)).

**Docs retrieval needs no new machinery.** Ship the documentation as a built-in
lorebook and attach it to the assistant. Keyword activation plus the budgeter
already do the work ([03 §3](03-data-model.md)).

**Built at P11** ([P11.3](workplan/28-p11-implementation.md)), and *needs no new
machinery* was exactly true: the book ships beside the assistant card under the
same rules as any other shipped object, and the attaching is **one line** — the
book's id in the `lore` links of the session the panel creates. No route, no
retriever, no slot.

*What the entries are is the part that takes the time.* The design corpus is
reasoning about decisions; an entry in the shipped book is an answer to a
question somebody types at three in the morning, and the keys are the words they
would use **including the wrong ones**, because a key that only matches the
correct term only helps somebody who did not need help.

*Three settings on the book are the whole of "the budgeter already does the
work":* a scan depth deep enough that a follow-up naming none of the original
words still retrieves; an entry limit and a token budget, so documentation cannot
eat the conversation it is helping with; and recursion **off**, because these
entries cross-reference each other constantly and one question would otherwise
pull in half the book.

#### Propose, then apply

Every mutation is a reviewable diff, not a silent write. Marinara has this
instinct too — a change-review service sits beside its workspace agent. Libraries
are per-user ([09 §4.3](09-server-multiuser-deployment.md)), so the risk is not
editing somebody else's character; it is that an assistant quietly rewriting
your own work is the fastest way to stop trusting it.

Applied changes carry `GeneratedFieldProvenance` ([10 §11.2](10-ui-surfaces.md))
like any other machine-written content, so "the assistant wrote this bit" stays
answerable later.

#### Ambient context, disclosed

The assistant should know what you are looking at — the actor you have open, the
session you were in — or every request starts with the user re-describing their
own screen. That context is a block the client contributes, and it must be
**visible in the turn record like any other block**. An assistant that silently
knows what is on your screen is unsettling; one that shows you it knows is
useful.

#### Starter prompts

Marinara ships suggestion chips — labelled entry points that expand into a
pre-written prompt ("Create a character", "Create a lorebook"). Cheap, and the
main thing standing between a blank assistant box and people actually using it.
Worth copying directly.

#### On the default card's tone

Stated as a principle because it is a real product decision and the reason the
card is swappable at all:

> **The default assistant carries competence, not character.**

People summon an assistant when they are confused, stuck, or annoyed. Attitude
in that moment is a tax on someone already paying one, and it does not become
less of a tax when it is well-written. This is the opposite of a companion card,
where personality *is* the product.

Warm and plain, not brusque and not a mascot — the register of a colleague who
knows the tool and is not performing. Everything with a personality-forward
default in this space is fun for its author and a tax on everyone else, and the
swappable card is exactly how both camps get served: neutral by default, and one
click to something with more of a voice for those who want it.

**[OPEN]** Whether the assistant is a distinct mode or a configuration of
Messages mode. Messages already does one-to-one chat with an actor; the
differences are the tool surface and the ambient context block. A configuration
is tempting and probably right, but the tool surface is a large enough
difference to be worth checking.

---

## 8. Party

The requirement is specific and slightly counterintuitive, so it is worth
encoding precisely:

```ts
interface PartyMember {
  actorId: ActorId
  control: "player" | "companion" | "auto"
  /** TurnIds, never ordinals. See below. */
  joinedAtTurn: TurnId
  leftAtTurn: TurnId | null       // history is kept; membership is a timeline
}
```

**These were numbers, and numbers are wrong here.** [07 §3](07-branching.md)
states the rule the rest of the design follows — turn ids are stable and opaque,
never `(branch, index)` — and party membership was quietly keeping ordinals. A
turn's *position* is not a fact about the turn; it is a fact about a path through
the tree, and it differs per branch. "Joined at turn 40" resolves to two
different moments on two lines, so the party would silently diverge exactly where
branching is supposed to be free.

**And the deeper version: party membership belongs in channels.** Who is in the
party, who controls whom, and which actor is narrating are *dynamic session
state that changes as a result of turns* — which is the definition of a channel
([§4](#4-channels-the-extensibility-mechanism-that-matters)). Keeping them in
`session.cast` as a separate structure means they do not reconstruct at a node,
do not appear as effects in the turn record, and do not branch correctly — the
same three properties §8.1 just established for presence and status.

So `cast` follows presence: **party membership, `control`, and the narrator
selection are channel state**, keyed by `TurnId` and materialised at head like
everything else ([03 §8.1](03-data-model.md)). The persona is the one part that
can stay a plain session field, because it is chosen at setup and changing it
mid-session is an explicit act rather than an outcome of play.

Design rules:

1. **The party always exists and always contains the persona.** There is no
   "party enabled" flag and no null party. A solo game is a party of one. This is
   the requirement that "no additional party members is not an edge case",
   expressed as an invariant so the code has one shape instead of two.
2. **Default is one member, `control: "player"`.** Single-persona play is the
   default everywhere, including Freeform and Campaign.
3. **`companion` is not player-controlled.** A companion is narrated by the
   narrator, with the player able to address, direct and influence but not
   author. This is the "we are not building a D&D engine" line, and it is the
   difference between a party member and a second player.
4. **`auto` is for temporarily-attached NPCs** — the guide who walks you to the
   next town. Same structure, different lifetime.
5. **Party membership is a timeline, not a set.** "Who was with me in chapter
   two" is a question worth being able to answer, and retrofitting history onto a
   set is unpleasant.
6. **Party is session state available to every mode**, not a Freeform or Campaign feature.
   Scene mode has a party; it's usually the actors present. Messages mode has a
   party of one. Modes differ in what they *do* with it.

**Resolved:** `control: "player"` may apply to more than one member — one human
authoring two characters is allowed, and it is the seam where genuine
multiplayer would eventually attach ([§3.1](#31-who-authors-a-characters-words-and-impersonation),
[09 §8](09-server-multiuser-deployment.md)).

### 8.1 Presence and status: who is here, and who is still alive

The party answers *who is travelling with me*. Two further questions are asked
constantly and answered by neither the party nor the cast list: **who is in this
scene**, and **who is still alive**. Both are channels, and the cast panel
([10 §13.2](10-ui-surfaces.md)) is where they surface.

**Two axes rather than one enum**, which is the correction to Aventuras'
*active / inactive / dead*:

| Channel | Scope | Volatility | Update policy |
|---|---|---|---|
| `se.presence` | actor | High — several times a session | model-proposed |
| `se.status` | actor | Low — rarely, and always significant | model-proposed, **flagged on change** |

A single enum cannot express *dead but present* or *alive, elsewhere,
returning*, and the second of those is the ordinary condition of most of the
cast most of the time. The UI derives one badge from both
([10 §13.2](10-ui-surfaces.md)); the split lives in the data.

Being channels rather than fields is what makes them behave correctly under
branching: the effects are per-node, so a character dead on one line and alive
on another is a natural consequence rather than a special case
([07 §4](07-branching.md)).

**Presence is not party membership and must not be conflated with it.** The
party is a timeline of commitment; presence is a fact about the current scene.
Party members are frequently absent, and present actors are frequently not party
members. Two concepts, two channels, one panel.

**And *introduced* is neither, which is why it needs saying.** [§6.1](#61-the-plot-hook-selector)
and [04 §6.1](04-schemas.md) have both spent the word as a mechanical
predicate — *cast alive and introduced*, *dead, gone, or never introduced* —
since they were written, and no section ever defined it. Neither channel above
means it: `se.presence` is *in this scene right now*, so a character introduced
in chapter one and absent since reads `false` and is emphatically not
*never introduced*.

> **Introduced: this actor has been the subject of a presence or party effect at
> some point on the path to this node.**

Derived rather than stored, and deliberately: it needs no third channel, it is
monotone along a path so it can only be acquired and never lost, and it branches
correctly for nothing — rewind past a character's arrival and they are
un-introduced again, which is what anyone would expect and would otherwise have
had to be built. The introduction hook ([04 §6.1a](04-schemas.md)) is what forced
the definition, but the debt was already there.

**Status changes to `dead` are flagged, not applied quietly.** Models kill
characters in passing, and the two error directions are not symmetric — a missed
death is corrected in a click, a false one removes someone from every subsequent
assembly. Same asymmetry as goal completion ([25 C12](25-open-questions.md)) and
the same posture: under-fire, surface prominently, keep the manual override
available.

### 8.2 Mention resolution is an `extract` step

Linking names in prose to actors ([10 §13.1](10-ui-surfaces.md)) needs no new
pipeline concept. It is an `extract` step (§6) producing **spans on the turn
record** — ~~`{ start, end, ref, method, confidence }`~~
**`TextSpan`, specified at [03 §8](03-data-model.md)** — never a rewrite of the
message text.

*The shape moved out of this sentence on 2026-09-11 rather than being restated
here, because three documents were giving three shapes and one of them is the
record's definition. Two differences are worth naming: the span carries `field`,
which this sentence omitted and which a record storing two texts needs; and its
target is a **tagged** reference rather than a bare `Ref<Actor>`, because
[13 §13](13-write-mode.md) needs mentions, machine-written provenance and beat
positions to be one span shape and `Ref`'s type parameter erases into JSON.*

Two constraints worth fixing now, because both are awkward later:

- **It shares the lorebook keyword pass.** `Actor.aliases` is already the
  default keyword set for lore matching ([04 §4](04-schemas.md)); mention
  resolution wants the same strings in the same text. One scan, two consumers,
  and no possibility of the highlighting and the inclusion reasons disagreeing
  about who *the fixer* is.
- **It proposes, it never writes.** An unresolved name yields an offer to the
  user, not a new actor record. Auto-materialising on first mention is the
  mechanism that produces one character stored three times, which is the failure
  this whole feature exists to make visible.

## 9. What an extension mode has to be able to do

The test for whether the contract is real. An externally-authored mode must be
able to, without engine changes:

- declare its own channels, with its own schemas, widgets and reducers
- declare its own setup wizard and store config the host never interprets
- contribute pipeline steps at any stage
- define its own input kinds and its own participant policy
- contribute UI surfaces (a HUD region, a side panel, a message decoration
  ~~)~~ — **and a stage, behind the transcript**, added at
  [P7.11](workplan/23-p7-implementation.md). *Four regions where this bullet
  names three, and the fourth is not an embellishment: these three were written
  before §10.1a existed, and a backdrop is none of them.*
  [10 §8.1](10-ui-surfaces.md)'s paired commitment — *when an extension cannot
  express something, ask what widget would let it and add that* — governs regions
  as much as widgets, and this is the first time it was exercised)
- ship with a package that declares a dependency on it
- read library objects through a capability API that is *narrow and typed* —
  Marinara's `CapabilityRuntime` is the model, including its instinct to make
  wrong values compile errors rather than runtime rejections

And must **not** be able to: reach the filesystem outside its own directory,
read or use connection credentials directly (it requests a call by capability
role and the host executes it), or write another mode's `modeData`.

**Execution model: settled.** Extensions run behind a worker-thread boundary
from 1.0, and built-in modes go through the same interface — specified in
[22](22-extensions.md).

***Five of the seven are built, and the list stopped being a test the day the
second mode was written*** (2026-09-13). Channels with schemas at
[P7.1](workplan/23-p7-implementation.md), the declared wizard at P7.4, steps at
any stage from P7.0, input kinds and participant policy at P7.3 and P7.9, UI
surfaces at P7.11. **What is still unbuilt is the capability API and the
package-dependency bullet** — the two that cross a boundary, which is not a
coincidence: [22 §4](22-extensions.md) owns both and neither has had a consumer
yet. *The list keeps its future tense for the two, and for the reason the last
paragraph of this section gives: a contract is real when somebody outside the
project builds against it, and nobody has.*

The list above is why it costs little. Five of the seven requirements are
*declarative* and cross no boundary at all; the remaining two are a function over
serialisable data and async host calls. The `reads` field on `StepDefinition`
([§6](#6-steps-and-the-pipeline)) doubles as the payload filter, so a step
receives only what it declared it needs.

~~Two of the "must not" items above stop being conventions and become structural:
an extension in a worker cannot reach a credential, and cannot reach an
unrecorded random source ([19 §14](19-tech-stack.md)).~~

***Retracted 2026-09-11, because [22 §4.0](22-extensions.md) retracts it and this
sentence is the one [P7 §1.3](workplan/23-p7-implementation.md) cites to settle
where the worker hop lands.*** A Node worker thread **is not a sandbox**: it can
`require('node:crypto')` and `require('node:fs')`, and connection credentials are
files under the data directory. So neither item becomes structural in the sense
this sentence claimed — *unreachable* — and the phrasing was wrong in the
direction that matters, which is the direction that invites the wrong deployment
behaviour.

**What is structural is that neither is handed over.** The worker's payload
carries no credential — a step asks for a call by role and the host resolves the
connection ([19 §5.1](19-tech-stack.md)) — and randomness arrives as a host
capability whose draws land on the turn tape
([19 §14](19-tech-stack.md)). An extension that goes around either is
*misbehaving rather than prevented*, exactly the status 22 §4.0 gives `HostApi`
itself.

**So the enforcement is named rather than assumed**: the lint rule that bans
reaching `node:crypto`'s random functions outside the RNG service
([19 §14.4](19-tech-stack.md)), and the extension test kit's replay-determinism
check. Both are real and neither is a boundary. Real isolation is a separate
process with a stripped environment, which is [22 §10](22-extensions.md)'s open
item and carries the word *sandbox*.

---

## 10. Renditions: illustration, and the shape video and speech share

**Per-turn and on-demand illustration is a 1.0 feature.** Ask for an image, or a
short series, for a turn — each turn that has a moment worth one, or on demand
from any message in the history. Video and speech are lower priority and are
*not* 1.0, but the mechanism is designed so they are additional **kinds** rather
than additional subsystems.

### 10.1 One concept, three kinds

A **rendition** is a non-text artefact derived from a turn.

```ts
interface Rendition {
  id: string
  turnId: string
  /** How it is produced: provider, latency, cost. */
  kind: "image" | "video" | "speech"
  /** What it is for: where it renders, and how long it lives. §10.1a */
  purpose: "illustration" | "background"
  /** Which part of the turn this renders: one message under per-actor
   *  dispatch, and the moment inside it this picture is of. §10.4a */
  scope: { messageId?: string; anchor?: string } | null
  state: "pending" | "ready" | "failed"
  /** Ranked prompt fragments as sent, plus what the cap dropped. [19 §5.3] */
  prompt: AssembledPrompt | null
  /** null once evicted — the recipe outlives the pixels. §10.7 */
  asset: AssetRef | null          // under the session's assets/
  /** Model, seed and workflow parameters. Never discarded. §10.7 */
  provenance: GeneratedFieldProvenance
  error: string | null
}
```

The three kinds differ in provider, latency and cost — not in lifecycle. All of
them: derive from turn content, cost money, can fail, are re-runnable, and are
worth showing in the workbench. Building images against this shape rather than
as "the image feature" is most of what makes video and speech cheap later.

#### Three of those fields were typed wrong — corrected 2026-09-16 at [P9.0](workplan/26-p9-implementation.md)

***The shape held; two of the three types it names could not carry what this
section asks of them, and the third was never defined at all.***
[21 §7](21-internal-contracts.md) is the built interface and the argument for
each; what follows is the summary, here because this is where a reader meets the
sketch.

- ~~`provenance: GeneratedFieldProvenance`~~ → **`RenditionProvenance`**. That
  type's `seed` is documented *"the input the generation ran from"* — a prompt
  string — and §10.7 below means the **sampling seed**. One word apart, and an
  implementation that reused it would satisfy the type, pass review, and ship a
  rendition that cannot be reproduced. It also has no field for workflow
  parameters, which §10.7 says are never discarded. *Widening it was the worse
  repair*: it is portable, so a sampling seed added to it would travel inside
  every exported actor card.
- ~~`asset: AssetRef | null`~~ → **`RenditionAsset | null`**. `MediaRole` has
  eight members and none of them is `illustration`, so a picture of a moment
  filed under one carries a role that is a duplicate of `purpose` or a lie;
  `AssetRef` also carries no `mime`, which is the one thing serving the bytes
  requires.
- ~~`prompt: AssembledPrompt | null`~~ → **`AssembledPrompt`, never null.** A
  `pending` rendition with no prompt is a record that cannot be re-run, so
  *the recipe outlives the pixels* would be false during exactly the window in
  which the pixels do not exist yet. And **`AssembledPrompt` was defined
  nowhere** — one occurrence in the corpus, the line above that names it. It is
  `CappedPrompt` plus the fragments the cap ran over plus the separator, because
  §10.3's *written once and replayed* is unsatisfiable without the parts.

**Four fields were added, and none of them is new design.** `schema` and
`sessionId` make the record a file that can be identified; `digest` is §10.1a's
reuse key, given a home rather than recomputed; `ordering` is §10.4's *"if the
engine sorts on a number, that number is on the rendition"*, shipping at `0`.
`anchorResolved?: false` records §10.4a's miss.

**Lifecycle is what the other union is for.** `purpose` is the axis on which
renditions genuinely do differ in lifecycle — an illustration belongs to one
turn, a backdrop is shown across many — and keeping it out of `kind` is what
lets that sentence above stay true. §10.1a.

### 10.1a Backgrounds are a second purpose, not a fourth kind

**The backdrop a scene is staged against is a rendition too**, and saying so is
the difference between one subsystem and two.

§7.2 has always described Scene as *"staged scene, optional background and
sprites"*, and has always said backgrounds are steps writing to channels. What no
document has ever said is **where the image comes from**. The absence was easy to
miss because SillyTavern ships a folder of them and the answer there is *the user
found a JPEG* — which is a fine answer for a program that does not generate
pictures, and no answer at all for one that does.

So `Rendition` carries a second closed union beside `kind`:

```ts
  /** What this rendition is for: where it renders, and how long it lives. */
  purpose: "illustration" | "background"
```

**Two fields because there are two questions, and collapsing them is the natural
mistake.** `kind` is *how a rendition is produced* — provider, latency, cost
(§10.1). `purpose` is *what it is for*. A backdrop is an image, so it is
`kind: "image"`; it renders behind the story rather than inside it, and outlives
the turn that made it, so it is `purpose: "background"`.

Putting `"background"` into `kind` instead would answer both questions with one
union, and the first thing it would cost is an animated backdrop — expressible
here as `{ kind: "video", purpose: "background" }` and inexpressible the other
way, in the one place the design has gone furthest out of its way to keep video
cheap (§10.5).

**Unlike `kind`, both values of `purpose` are built.** This is not a field
reserved against a later feature; it is a distinction 1.0 makes.

#### The artefact hangs off a turn; the *selection* is channel state

One structural difference between the two purposes, and it is the whole design.

An illustration belongs to its turn forever. A backdrop is shown until the place
changes — several turns, sometimes fifty — which sounds exactly like the thing
§10.2 says a rendition must never be: a participant in state reconstruction.

**Both stay true by separating the object from the pointer.** The rendition keeps
its `turnId`, the turn whose state produced it, and a branch inherits it by
inheriting that turn like every other rendition. **Which backdrop is currently
showing is channel state** — a session-scoped channel holding a reference to the
selected rendition, written as an ordinary `ChannelEffect` (§4), reversible and
recorded like any other state change.

What the split buys, all of it for free:

- **Rewind and branching need no new machinery.** State at turn N is already a
  pure function of the effect log ([07 §2](07-branching.md)), so rewinding past a
  location change restores the earlier backdrop exactly the way it restores the
  weather, and a branch taken before you left the tavern is still in the tavern.
  Nothing is special-cased, because nothing new was introduced.
- **§10.2's corollary survives and gets sharper.** *The artefact is not a channel
  effect; the selection is.* A rendition still never participates in
  reconstruction. A pointer to one does — and pointers to state are the entire
  business of §4.
- **The channel belongs to the mode, not to renditions.** §7.2's background
  channel is Scene's declaration, and this gives it a value it can hold and a
  producer that writes it rather than standing a second mechanism up beside it.
  Which is also the constraint it places on that declaration: the channel's value
  is a **media reference able to name either an authored image or a rendition's
  asset**, because a backdrop somebody uploaded and a backdrop the engine made
  are the same thing to everything downstream of the pointer.

#### Where a background's prompt comes from, and the line it does not cross

Assembled the ordinary way (§10.3), from **channel state and the treatment's
tone — and pointedly not from the turn's output text or the present actors'
`VisualDescriptors`.** Which is also why a background is the branch of §10.3 that
makes **no model call at all**: that call writes the moment, and a backdrop does
not have one.

A backdrop is a place, not a moment. Illustrating what just happened is what
§10.6's **Illustrate** is for, and a backdrop that redraws itself around each
turn's action is an illustration wearing the wrong clothes: it will put the fight
in the wallpaper and then stay there for thirty turns.

**Text in, images out.** Conditioning the generation on a location's `reference`
*image* is **lore-conditioned renditions** ([24 §3](24-roadmap.md)), which is
deferred past 1.0 for a reason that is not plumbing: *choosing which images*,
when six active entries and three present actors all carry references, is the
hard part, and attaching all of them produces mud ([03 §3.6](03-data-model.md)).
Backgrounds ship on the text side of that line and do not move it — which is
worth stating plainly, because a backdrop of a place is the most natural-looking
excuse anyone will ever have to move it.

#### It generates when the place changes, and pays once per place

**Not every turn.** The step runs when the fragments that describe the place
actually change. A turn that changes nothing about where you are generates
nothing.

**And not twice for the same place.** Before dispatching, the step looks for a
ready background rendition in this session whose **recipe digest** already
matches — a hash over the assembled ranked fragments as sent, excluding the
sampling seed — and selects that one instead of paying again. Walk out of the
tavern and back into it, and the tavern comes back for nothing.

The digest is not new machinery. It is a hash of the **recipe minus the seed** —
the assembled prompt, which §10.7 already requires be kept forever, and which
re-creating an evicted rendition already has to reproduce byte for byte. The
exclusion is the whole trick: with the seed in, every generation is unique and
nothing ever matches; with it out, *the same place described the same way* is a
comparison the durable half of the record can already answer. **If the recipe is
permanent, the digest is free** — which is the second thing §10.7 turns out to
buy, after eviction.

**A manual regenerate bypasses reuse**, adds a sibling and selects it — additive,
never replacing (§10.7). That is also why reuse resolves to the *currently
selected* rendition for a digest rather than the oldest one: having chosen a
backdrop for the tavern, the tavern is what should come back.

**This is the answer to the cost question backgrounds would otherwise raise.**
They are the rendition most tempting to run every turn and the only one that
caches perfectly. Keyed, a backdrop costs roughly one image per *place* instead
of one per turn, and over a two-hundred-turn session that difference is most of
the bill.

### 10.2 Renditions never block the turn

**The turn completes on text.** Renditions are dispatched as their own jobs and
arrive later over the event stream ([09 §2](09-server-multiuser-deployment.md)),
rendering in place as they resolve.

This is not an optimisation, it is the only workable design: an image is seconds
and a video can be minutes, and a story that stalls on either is unusable. It
also means a failed rendition is a placeholder with a retry button, never a
failed turn.

The corollary for [07 §2](07-branching.md): a rendition is **not** a channel
effect and does not participate in state reconstruction. It is an artefact
hanging off a turn, so a branch inherits the turn's renditions by inheriting the
turn.

**Backgrounds sharpen that rather than qualifying it** (§10.1a). A backdrop is
displayed across many turns, which is a lifetime only channel state can describe
— so *the artefact is not an effect; the selection is.* The rendition still
hangs off its turn and is still absent from reconstruction; the pointer naming
which backdrop is showing is an ordinary `ChannelEffect` and is reconstructed
like everything else. Reading the two halves as one is how this ends up as a
special case in the branching code, which it is not.

### 10.3 Where the prompt comes from

An ordinary pipeline step at the `post` stage, which means it uses the ordinary
mechanisms rather than a private pathway — one call and an assembly, both of a
kind the pipeline already makes. Four fragments:

- **the moment** — one line saying what is in this picture, written by a model
  reading the turn's output text (below);
- present actors' `VisualDescriptors` and their `reference` media
  ([04 §3](04-schemas.md)) — this is what the Character Studio's payload
  ([17](17-character-studio.md)) exists to feed, and the reason typed media roles
  are a 1.0 obligation;
- channel state — location, time of day, weather, whatever a mode tracks;
- the treatment's `tone` and any style profile.

Assembled as **ranked fragments under the provider's declared cap**
([19 §5.3](19-tech-stack.md)), so overrun drops the lowest-ranked fragment
rather than truncating mid-sentence. That work was specified for exactly this
case, and it already named this first fragment: *subject, style, quality tags,
character reference, negative* is [19 §5.3](19-tech-stack.md)'s own list, and the
subject is the moment.

#### The moment is written, not extracted

**A turn is prose and a picture is one instant of it**, so something has to say
which instant. Handing the whole turn text to an image model is not that. It
produces a prompt about a paragraph, which is how an illustration ends up
depicting three things at once and none of them well.

So the first fragment comes from a call — the cheap `fast` role the pipeline's
other judgements use ([19 §5.1](19-tech-stack.md)) — reading the turn's output
text and answering *what is the picture of*. Both sources do this, and it is the
one thing their two otherwise opposite designs agree on.

**What that call must not do is write the whole prompt.** Aventuras' does, and
then concatenates the style suffix afterwards, so the result routinely overruns
the character limit its own system prompt spends four lines insisting on — and
nothing downstream checks. Ranked fragments are what make a cap true, because the
cap applies to the assembled whole and the ranking decides what goes. The model
is *told* its budget and writes within it ([19 §5.3](19-tech-stack.md)); the
assembler is what makes the budget real.

**The moment is a fragment like any other, and that is what keeps it from costing
the recipe.** §10.7 requires a rendition's prompt be preserved forever, and
§10.1a's reuse digest hashes the assembled fragments as sent — a *re-generated*
moment would break both, because a second call is a second answer and two
identical places would stop hashing alike. So the moment is written once, stored
in `prompt` as the fragment it is, and **replayed** on re-creation, never asked
for again: re-creating an evicted rendition makes no text call at all. That is
§10.7's promise about the seed, extended to the one fragment that has an author.

#### Two rules the assembler owns, and neither belongs in a prompt

**A character's name never appears in an image prompt.** The image model does not
know who Elena is; it knows what a woman with cropped grey hair looks like.
Aventuras learned this and states it as a rule *to the model*, which is the wrong
place for it — `VisualDescriptors` exist precisely so the substitution is
mechanical ([04 §3](04-schemas.md)). The descriptors are a fragment; the name is
not one. This is the clearest vindication the structured appearance field has
had.

**How many named characters one picture can hold is a provider capability.** It
belongs beside `maxPromptChars` in [19 §5.3](19-tech-stack.md)'s block rather
than in prose to a model. Aventuras caps at one for consistency's sake; Marinara
derives both a visible-character limit and a reference-image limit that runs from
one to sixteen depending on the backend. A number that varies per endpoint is the
definition of a capability.

#### The background branch, and the sentence not to misread

**A background takes a different subset of the same list**, and the difference is
the point rather than an optimisation: channel state and tone, without the turn's
output text, without the present actors' descriptors, and — the sharpened version
of the same sentence — **without the moment call**, because a backdrop is a place
and a place has no moment (§10.1a). Same step, same fragments, same cap; one
branch makes a call the other does not, and the ranking differs, because what
belongs in a backdrop and what belongs in an illustration are different
questions asked of one turn.

**"Text in, images out" (§10.1a) is untouched by any of this**, and it is worth
saying because it is the sentence most likely to be quoted against the moment
call. That rule is about what the *image* generation is conditioned on — text,
not a reference image — and a model writing a line of text does not move it.
Lore-conditioned renditions ([24 §3](24-roadmap.md)) are still deferred, for the
reason they were always deferred.

### 10.4 How many, and which moments

A turn may produce more than one image, and three different things have gone by
the name "a series" here. Separating them is most of the work, because only the
first is 1.0 and only the second is a judgement:

- **Variations** — N renditions from one prompt. A re-roll count, not a decision
  about the turn. Trivial, useful, and what most people mean. 1.0.
- **Moments** — which parts of a turn deserve a picture, and how many. This is
  the judgement, it is specified in full below, and **P9 does not build it**:
  that phase builds the one-image-per-turn case, and the count judgement lands in
  a later one against the shape recorded here. §10.1 already allows many
  renditions per turn, which is what makes the deferral cheap.
- **Storyboarding** — a strip *presented* as a storyboard, with its own surface
  and its own pacing. Downstream of moments rather than a third mechanism, and
  the thing that stays deferred as a product ([24 §3](24-roadmap.md)). Worth
  stating plainly, because [triage §6.3](workplan/02-triage.md) discards Marinara's
  storyboard and anime-episode directors from core and that verdict stands: a
  judgement about one turn is not a director, and the line between them is the
  surface, not the call.

**The shape.** One cheap call at `post`, over the turn's output text, returning a
list rather than a number — because *how many* and *which* are one question, and
asking for a count without asking what the pictures are of gets an opinion about
length:

```ts
interface ProposedMoment {
  /** What is in the picture. Becomes §10.3's moment fragment. */
  subject: string
  /** Verbatim from the turn's output text: where this picture goes. §10.4a */
  anchor: string
  /** How much this moment wants a picture. The engine sorts on it. */
  salience: number
}
```

**The empty list is a real answer.** *Nothing here is worth a picture* is what a
turn of pure dialogue should return, and it is the permission
[§6.1](#61-the-plot-hook-selector)'s selector already has to judge *none*. A
setting that promises an image every turn is what makes zero look like a bug,
which is why §10.6 stopped offering one.

Three rules follow, and each is something one of the sources paid for.

**The model proposes; the engine disposes.** Sort by salience, take the top *k*,
and *k* is enforced in code. Aventuras is the counter-example in full: its
per-message maximum is interpolated into the system prompt as a string and
appears nowhere else in the program, so every scene the model returns is queued.
It sorts by the priority it asked for and never slices on it, and never stores
it. A cap that lives only in prompt text is a request — ask for three, get eight,
pay for eight — and a sortable field spent on queue order is a judgement thrown
away.

**The cap is a ceiling and never a floor.** Marinara has this right in the
planner, which is told to return fewer when the turn does not support the target
— *"return fewer shots rather than duplicating moments, padding the plan, or
inventing events"* — and enforced by a slice that can only reduce. Its *fallback*
is the trap: when the planner call fails, it chunks the narration into exactly N
frames with a hardcoded prompt string, so a quiet turn gets padded with moments
it did not contain, by the code path that runs precisely when no judgement was
available. **A failed judgement generates nothing.** Under-firing is the bias
[§6.1](#61-the-plot-hook-selector) chose for hooks and
[§8.1](#81-presence-and-status-who-is-here-and-who-is-still-alive) for death, and
here it is also the only one that declines to spend money on a picture of
nothing.

**Salience is recorded, not merely used.** If the engine sorts on a number, that
number is on the rendition. And the judgement writes its own line into the turn
record the way the hook selector does: *held by pacing*, *nothing worth
illustrating*, *proposed five and paid for two, with the two reasons*. Without
that line the first two are indistinguishable from outside — which is
[§6.1](#61-the-plot-hook-selector)'s argument arriving unchanged at a second
consumer — and *why this picture and not that one* stays answerable in the
abstract and never for the turn in front of you. It is the standard the assembler
meets when it records why a slot went unfilled, and the retriever when it says
why an entry fired.

#### Why the narrator does not do this itself

Aventuras' other mode has the narrative model emit `<pic prompt="…">` tags inside
the prose, capped at three per response. It is much the cheaper design — no
second call, and placement is free because the tag is already where it belongs —
and, the honest part, it is the only one of that project's two modes where the
cap is genuinely enforced, because counting tags in a string is something a
program can do to a model's output without trusting it.

It is still the wrong trade, and the reason is not stylistic. **The tags are in
the text the turn record stores.** Everything downstream inherits them: assembly
of the history for the next turn, export, mention resolution, the reading view
([10 §12.1](10-ui-surfaces.md)) — each has to know about them or strip them, and
each is a place where the story's own bytes have stopped being the story.
[10 §13.1](10-ui-surfaces.md) states the rule and already claims renditions obey
it: *"the message text stays canonical plain prose with no markup injected into
it … the artefact is annotated, the authored bytes are not touched."*
[00 §2.2](00-stance.md)'s preference for structured output over markup fished out
of prose points the same way without needing to be stretched to cover this.

§10.4a buys the placement back without the markup, which is the only thing worth
having from that design.

### 10.4a Where a picture goes

`scope` grows a second optional field, and it is the one part of this section
that ships at P9 whether or not the judgement above does:

```ts
  scope: { messageId?: string; anchor?: string } | null
```

**The anchor is a verbatim quote from the message's own text** — the sentence the
picture is of. A three-image turn then shows its images at three moments rather
than three in a row underneath, which is the difference between an illustrated
page and a contact sheet. Both sources do this: Aventuras asks for three to
fifteen words copied exactly, Marinara for a quote plus the indices of the
section it came from.

**Annotate, never rewrite** ([10 §13.1](10-ui-surfaces.md)). Same rule mentions
obey, same rule that rejects inline tags above — and it is why the anchor is a
quote rather than the `{ start, end }` span mentions use. A span is exact, and an
offset does not survive an edit to the text it indexes; §13.1 concedes as much
when it says editing a message recomputes the spans, which it can do because it
can re-run the scan that produced them. A rendition has no scan to re-run: the
call that wrote the anchor is deliberately not made twice (§10.3). So it holds a
quote and resolves at render time against whatever the text now says.

**Which makes the miss ordinary, and it must not be an error.** A model
paraphrases. A message is edited afterwards, which the turn tree makes routine. A
sentence occurs twice. So: **an anchor that does not resolve does not fail the
rendition** — the image renders at the end of its message and the unresolved
anchor is recorded. A picture in slightly the wrong place is a worse outcome than
a picture and a far better one than an error, and first match wins on a repeat.
Neither source specifies this; both need it.

Recorded now for §10.5's reason, which this field turns out to share: a field on
a stored type is cheap before there are records and expensive afterwards. It is
not speculative machinery either, because with one image per turn it already does
visible work — the picture lands *in* the prose rather than under it from the
first phase, and the miss path gets exercised long before a multi-moment turn
depends on it.

### 10.5 What speech still needs that images do not

Recorded now because it is cheap to accommodate and awkward to retrofit:

- **`scope.messageId`.** Speech is per utterance, not per turn — under
  `per-actor` dispatch a turn holds several. Images rarely need *this* half of
  `scope`; they need the other half (§10.4a). So the field is no longer one
  reserved against a feature nobody builds at 1.0 — it is simply in use, by two
  callers wanting different halves of it, which is a better argument for its
  shape than the one it was introduced with.
- **A voice binding per actor.** Belongs in `modeData` or a `speech` block on
  the actor, and — like `ModelHint` — it is a *preference resolved locally*
  ([04 §3](04-schemas.md)), never a provider binding travelling in a shared card.
- **Streaming.** Speech wants to start before the text finishes; images do not.
  That is a step-level concern and does not change the record.

### 10.6 Controls

Per session: off, on-demand only, or **each turn that has a moment worth one**.
The third setting is conditional rather than absolute because §10.4's judgement
is permitted to answer none, and a control that promises an image every turn is
what makes zero read as a failure. Per mode defaults — Scene wants illustration
far more than Messages does. And a manual **Illustrate** action on any message in
the history, which is the same step invoked by hand — **additive, never
replacing** (§10.7).

**Two dials on different axes, once the judgement exists.** *How many at most* is
the cap §10.4 slices on. *How often the judgement is asked at all* is pacing, and
it is the dial [§6.1](#61-the-plot-hook-selector) already built, down to the
argument: the step runs every turn, the dial is a gate inside it before the call,
and it is the *judgement* that has a cadence rather than the step. A channel —
session scope, `update: "user-only"`, `budget: null`, `init` from treatment — so
it costs no new concept, changes mid-session, and branches correctly
([04 §6.1b](04-schemas.md)).

What the dial protects is different here, and worth the sentence. For hooks,
pacing is about drama: a hook every third turn is incoherence. For renditions it
is also about money — the judgement call is cheap and the pictures it authorises
are not — so a cadence is the first thing in this section that puts a rate on the
bill. It is not a budget, and §10 still does not have one.

**Backgrounds get their own control, because they are not on the same axis.**
Off, or on — and *on* means when the place changes, not every turn (§10.1a).
There is no per-turn setting to offer, because a backdrop that regenerates each
turn is the failure mode rather than the thorough setting. The manual
counterpart is **Set the scene**, which regenerates the backdrop for where you
are now.

The two axes sit closer together now that illustration is conditional too, so the
distinction is worth restating rather than assuming: an illustration is withheld
when the turn holds no moment worth one, a backdrop when the place has not
changed. A judgement in the first case and a fragment diff in the second — and
only the first costs a call.

**And one dial that is not a control at all, which is the point.** A treatment
may ask for turns that stage well — `stagingNotes`, authored prose beside `tone`
in the same advisory register as `hookPacing` ([04 §6.1b](04-schemas.md)): *this
material wants scenes you can see*. It passes that section's test for what a
Treatment may carry, clause by clause. It is authorial intent about the material rather than a
property of one playthrough; it holds no endpoint and no key; and it is precisely
what would be lost the moment somebody built a Setup over the treatment.

**It does not read the image settings, and that inversion is the whole safety of
it.** A treatment that wants cinematic staging wants it with illustration
switched off, because it is a statement about prose. Marinara's version runs the
other way — its keyframe count is substituted straight into the narrator's system
prompt, *"aim to include N strong visual anchor moments"* — so moving the image
budget from three to one silently rewrites the story.
[01 §1](01-source-survey.md) already names that field as a **production**
setting while criticising `GameSetupConfig` for mixing production settings with
narrative content; feeding it to the narrator is the same confusion one level
further down. Production must not reach the prose. A treatment may, because a
treatment *is* prose.

**Off is a first-class configuration and not a degraded one.** §7.2 already
requires text-only Scene to be fully supported, as it is in both sources, and a
backdrop is precisely the feature that tempts an implementation to treat its
absence as an empty state to fill. An unset `image` role says so plainly rather
than failing a turn ([19 §5.1](19-tech-stack.md)); an unwanted backdrop leaves
the surface exactly as it was.

~~**[OPEN]** Whether an on-demand rendition of an *old* turn assembles from that
turn's recorded state or from the present. Recorded state is more correct and
more surprising; the turn record makes either possible.~~

***Decided 2026-09-16 at [P9.4](workplan/26-p9-implementation.md): recorded
state.*** Three things decide it, and the paragraph below is the second of them.

- *It is decidable now in a way it was not when the question was written.* P3
  shipped the record reader and P6 shipped reconstruction at a node, so **that
  turn's state** is one argument to `gatherAssemblyInputs` rather than a research
  project.
- **Backgrounds make it one-sided rather than finely balanced**, which is the
  paragraph this one was written above.
- *The surprise is mitigated by disclosure rather than by a setting*: the
  assembled fragments are on the rendition's own record and the workbench shows
  them beside the turn they were assembled at, so *why does this picture show the
  tavern* is answerable rather than mysterious. A second setting for it would be
  configuration nobody could form an opinion about.

**Backgrounds are evidence on that question rather than a second instance of
it.** A backdrop's entire subject is where you were standing, so present state is
visibly wrong for one and merely arguable for the other — and both purposes read
the same field. Whatever is decided, it is decided once.

### 10.7 Renditions accumulate; recipes are permanent

Two policies, both settled in [25 E3](25-open-questions.md), both cheap now and
awkward to retrofit.

**Illustrating an old turn adds; it does not overwrite.** A turn holds a list of
renditions and the user picks which is shown. Structurally this is the turn tree
again — siblings under a node, one of them current — and for the same reason:
regeneration must never be a destructive act on something the user liked.
§10.1's shape already permits many renditions per turn, so this is a UI
commitment more than a schema one.

**The recipe is preserved forever; the pixels need not be.**

> A rendition's **prompt, seed, model and workflow parameters are never
> discarded** unless the user deletes the rendition. The generated `asset` may
> be evicted, leaving the record intact with `asset: null`.

`Rendition.prompt` and `provenance` are therefore not diagnostics — they are the
durable part of the object. What this buys:

- **Any rendition can be re-created**, including one whose image is long gone.
  The recipe is bytes; the asset is megabytes.
- **Eviction becomes safe.** "Generated media will fill the disk" gets an answer
  that loses nothing irreplaceable: evict pixels, keep recipes, regenerate on
  demand. Which in turn means an eviction *policy* is a later decision — it can
  never cost history, so it need not be settled now.
- **Regenerations are comparable.** Two renditions of one turn carry their
  seeds, so *why did this one come out different?* has an answer.

The seed is the load-bearing field here, and it is the one an implementation is
most likely to drop as uninteresting. It is not: without it, "preserved" means
"approximately re-creatable", which is not the same promise.
