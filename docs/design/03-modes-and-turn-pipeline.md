# 03 — Modes and the turn pipeline

**Status: proposal.** This document is the core of the design. If any single
piece is worth arguing about at length before writing code, it is §2 and §4.

---

## 1. Naming

**Settled.**

| Requirement's name | Name | Why |
|---|---|---|
| Marinara "Convo" | **Messages** | Says what it is. Nobody needs it explained. |
| SillyTavern/Marinara RP | **Scene** | Names the unit of play, and generalises to VN-style staging. |
| "Game Mode" | **Adventure** | Covers both presets without promising dice. |

Adventure ships two presets: **Adventure · Freeform** at 1.0 and
**Adventure · Campaign** at 2.0 ([15 §0](15-work-plan.md)). Campaign is the
Marinara RPG shape — party, sheets, combat, dice, map, clock. Freeform is the
Aventuras shape — do/say/think/story input, chapters, world-state
classification, branching, light or no mechanics.

Naming the *presets* rather than making them separate modes is the load-bearing
part: they share a mode contract, so a Freeform game can switch on the dice
channel without becoming a different kind of thing.

**Why Freeform rather than something loftier.** An earlier draft called it
*Chronicle*, which read as Campaign's sibling by being another grand noun and
suggested *recording* something that had already happened rather than playing
it. Campaign works because it is borrowed from the domain and everyone knows
what it means; the other preset needed the same treatment, naming the axis that
actually separates them — **how much structure the game imposes**. "Freeform RP"
is established vocabulary for roleplay without dice or stats, legible from both
tabletop and RP culture. *Solo* was the other contender and overclaims, since
companions are allowed ([§8](#8-party)).

`freeform` is the identifier, which is the part that had to be settled now:
preset ids travel inside Setup objects ([13 §7](13-schemas.md)), so changing one
later is a content migration rather than a rename. **The user-facing label is
free to change until Campaign ships** — until then there is one Adventure preset
and the UI can simply say *Adventure*.

---

## 2. The mode contract

A mode is **declarative**. It is not a subclass and it does not own a code path
through the engine; it is a manifest that configures a shared pipeline plus a set
of registered steps, channels and surfaces.

```ts
interface ModeDefinition {
  id: ModeId                      // "storyengine.adventure"
  version: SemVer
  displayName: string
  presets: ModePreset[]           // "freeform", "campaign"

  participants: ParticipantPolicy // §3 — who may speak and how turns are allocated
  assembly: AssemblyPlan          // §5 — which blocks, in what order, under what budgets
  steps: StepDefinition[]         // §6 — the pipeline
  channels: ChannelDefinition[]   // §4 — the state it owns
  inputs: InputKind[]             // free text / do / say / think / story / choice / …
  surfaces: SurfaceContribution[] // §7 — UI it contributes
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
| **narrator** | Adventure default; Scene "narrated" | narrator + per-actor dialogue passes |
| **embodied** | group chat, one call ("everyone responds") | classic ST group chat |

So: two settings, exposed per-session and overridable per-turn, rather than a
mode enumeration. `ModelHint` ([02 §2.6](02-data-model.md)) is only consulted
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
characters is allowed — in Adventure especially, where playing a pair is a
normal way to run a story. Nothing structural limits it, and this is also the
seam where genuine multiplayer would eventually attach
([04 §8](04-server-multiuser-deployment.md)).

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
  record and rewrite/reroll apply ([07 §14.5](07-tech-stack.md)) — an
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
  owner: ModeId | ExtensionId
  schema: JSONSchema              // the state shape
  scope: "session" | "actor" | "entry"   // one value, or one per actor/lore entry
  init: InitPolicy                // literal default, from setting, or generated at start
  update: UpdatePolicy            // model-proposed / engine-computed / user-only
  budget: number | null           // token cost when injected; null = never injected
  surface?: WidgetSpec            // how it renders in the HUD, if at all
}
```

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
  "invert the effects of turn N" rather than a hand-maintained snapshot struct.
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

Added after surveying Infinite Worlds ([09](09-infinite-worlds.md)), which is
the strongest evidence for this whole section — and which shows it is currently
under-specified here.

As written above, a `ChannelDefinition` has an `owner: ModeId | ExtensionId`, so
new state requires code. Infinite Worlds lets *world authors* declare tracked
variables and write declarative rules over them, shipped as data inside the
world, and its community used that to build weather engines, loot generators,
class trees, quest state machines and dating sims with no engine involvement.

So there is a **third extensibility tier** between "engine feature" and "code
extension": authored rules. Concretely:

- `owner` may be a package, not just a mode or extension.
- Packages and settings carry a `rules` collection — declarative
  condition/effect pairs over channels, evaluated as an end-of-turn step, with
  effects applied through the same path model-proposed updates use and recorded
  in the turn record like everything else.
- Rules are **data, not code**: terms in a closed vocabulary our evaluator
  interprets. That is what makes them safe to import, and it sharpens
  [06 A2](06-open-questions.md) to "packages may ship rules, never code."

The rule vocabulary itself is [06 C7](06-open-questions.md);
[09 §3](09-infinite-worlds.md) proposes a starting point.

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
  ([10 §4](10-branching.md)): replaying effects written under v1 produces
  v1-shaped state, which is then migrated to v2. A migration with side effects or
  a clock in it would make state reconstruction non-reproducible, which is the
  one invariant branching depends on.
- **Snapshots are invalidated by a migration**, and that is free — they are
  derived and disposable by design ([10 §4](10-branching.md)), so a migration
  discards them and the next reconstruction rebuilds.

---

## 5. Assembly: from objects to a request

The pipeline's context stage produces `AssembledBlock[]`
([02 §8](02-data-model.md)) in four steps:

1. **Collect.** Every source offers candidate blocks: the persona, present
   actors, the setting's framing, channel snapshots, retrieved lore entries
   (all retrievers in [02 §3](02-data-model.md) run here), history, preset
   blocks, and blocks contributed by pipeline steps.
2. **Annotate.** Each candidate carries its source, its reason for inclusion, its
   role and its token cost. The reason is a string built by the retriever
   ("keyword match: 'cathedral'", "pinned", "party location == Rain City"), and
   it is a product feature, not a debug string.
3. **Budget.** One arbiter, one policy, applied to *everything* including blocks
   we are confident matter. Output is a verdict per block: included, or dropped
   with the rule that dropped it.
4. **Render.** Blocks become provider messages. This is the only place that knows
   what a chat API looks like — and, should the decision in [07 §5.5](07-tech-stack.md)
   ever be revisited, the only place a completion renderer would have to
   touch ([00 §2.2](00-stance.md)).

The `AssemblyPlan` in the mode definition declares the ordering constraints and
budget policy; it does not build strings.

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
It is recorded in the turn record (so a rewrite replays it,
[07 §14.5](07-tech-stack.md)) but does not enter the message history that later
turns assemble from.

**One slot, several producers.** The same block can be filled by the user's box,
by an authored rule's `giveGuidance` effect ([09 §3](09-infinite-worlds.md)), or
by a step such as a Narrative Director push. Treating them as one slot means the
rule below applies to all of them without three separate arguments.

### 5.2 Guidance is advisory, and must not reach systematic outcomes

**Specification: guidance influences prose. It must never be admissible to any
call or computation whose output determines a systematic result.**

Concretely, guidance is excluded from:

- the RNG service and anything consuming it ([07 §14](07-tech-stack.md));
- the pre-narration **evaluation** step that decides what happens
  ([09 §4.3](09-infinite-worlds.md));
- **rule condition evaluation**, including AI-evaluated fuzzy conditions
  ([09 §3](09-infinite-worlds.md));
- any **engine-computed** channel update ([§4](#4-channels-the-extensibility-mechanism-that-matters));
- extraction/classification steps whose output is applied as channel effects.

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
Because every block is recorded with its source ([02 §8](02-data-model.md)), a
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
  reads: (ChannelId | "history" | "output")[]
  writes: ChannelId[]
  contributes?: "blocks" | "effects" | "messages"
  when: Predicate                 // conditions, cadence ("every 8 turns"), user-armed
  failure: "abort" | "warn" | "ignore"
}
```

Two additions from [09](09-infinite-worlds.md), both recorded as open questions
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
  [06 C5](06-open-questions.md).

### 6.1 The plot-hook selector

The worked example of a step that is genuinely an "agent" in the Marinara sense,
and the consumer of [02 §4.1](02-data-model.md)'s hook pool.

**Two stages, and the order is the whole design.**

1. **Mechanical eligibility.** Filter the pool by `involves` (cast alive and
   introduced), `requires`, `blockedBy`, `notBefore`, and already-fired. No model
   call. This is what stops a hook firing about someone who died four sessions
   ago, and it also cuts thirty hooks to a handful before anything expensive
   happens — a package with a large pool must not mean thirty premises in a
   prompt every turn.
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

**Pacing is what makes this work or fail.** A selector that fires every third
turn produces incoherence, not drama. At minimum it needs a cooldown after
firing, a cadence rather than running every turn, and an author-facing pacing
setting (sparse / normal / aggressive / manual-only). Running only at scene or
chapter boundaries is a plausible default, since those are already the moments a
twist naturally lands.

**Authoring affordances are part of the feature, not polish.** Somebody with
thirty hooks cannot test them by playing to turn 200. They need to see which
fired, which are eligible now, which are blocked *and by what*, and to force-fire
any hook to see how it reads. Without the last one, large hook pools are
unauthorable in practice.

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
copies from its setting and holds no live link — so the reconciliation matters:

- **Session-local hooks are the primary path.** Add a hook *to the session*. It
  is session state, immediately eligible, and no principle is bent. This serves
  the use case above directly, and is what the "add a hook" button does.
- **Setting changes are pulled, never pushed.** Edit the setting and the session
  offers it: *"the setting has 2 new hooks — add them?"* Nothing changes without
  the user asking, so the session still owns its own pool, and someone who wants
  the hook in future sessions too gets that without a second act of authoring.

The distinction is not pedantry: a *pushed* update would mean editing a setting
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
  ([04](04-server-multiuser-deployment.md)).
- A failing step must not lose the turn. `failure: "warn"` with a retry
  affordance is the default; Marinara's per-agent failed-list-with-retry is the
  right UX and generalises.
- Step costs are itemised in the turn record. "Agents add cost because they make
  extra calls" should be visible per turn, not a documentation note.

---

## 7. The modes

Four chat modes across two releases — **Scene and Adventure–Freeform at 1.0**,
**Adventure–Campaign and Messages at 2.0** ([15 §0](15-work-plan.md)) — plus the
assistant (§7.4), which is not a chat mode but is
built out of the same parts.

### 7.1 Messages — **2.0**

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
  open. This forces the architecture in [04](04-server-multiuser-deployment.md)
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
- Sprites, backgrounds and expression selection are steps writing to channels.
  Text-only must remain a fully supported first-class configuration, as it is in
  both sources.
- Scene branching (Marinara's "scenes" as side branches) is not a Scene-mode
  feature; branching is a session-level capability from
  [02 §8](02-data-model.md) available in every mode.

### 7.3 Adventure — Freeform **1.0**, Campaign **2.0**

Two official presets over one contract.

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

Adventure setup carries a **difficulty** setting, in the spirit of Marinara's.
The thing worth being precise about is what it actually controls, because the
obvious reading — a number added to rolls — is the smaller half.

In Freeform there are frequently no rolls. What varies with difficulty is **how
readily the world grants what you attempt**, which is to say it is a dial on
narrator sycophancy — the failure mode named in [09 §5](09-infinite-worlds.md) as
one of the things the community builds systems to correct. So difficulty
resolves to two distinct outputs, and a mode declares which it consumes:

| Output | Consumed by | Effect |
|---|---|---|
| **Prompt language** | Every Adventure preset | Ranked fragments describing how much to concede, how often attempts partially fail, whether the world volunteers help |
| **Mechanical parameters** | Campaign, and Freeform with dice or HP toggled on | Target numbers, resource pressure, enemy competence |

Three things this has to get right.

**The levels live in the prompt pack, not in engine code.** A difficulty level is
a named entry with prompt fragments attached, shipped in the preset layer and
replaceable there. This is the same reasoning as [13 §6.2](13-schemas.md): the
layer that shapes model behaviour should be the layer an author can open and
edit, and its effect should be visible in the turn record rather than buried in a
conditional. "Hard" meaning something different in one prompt pack than another
is a feature.

**It must be changeable mid-session**, recorded as an effect like anything else.
Difficulty chosen at setup is chosen with the least information anyone will ever
have about the session. The predictable failure is picking Hard, discovering
every scene is a slog by turn 30, and having no recourse but to start over.

**Obstruction must not reach unreachability.** Difficulty modulates the cost and
the route, never whether the goal can be attained at all. Without that floor,
the top setting is not hard mode, it is a losing game the player cannot detect
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

**So: two settings.** Difficulty is the headline one and maps to resistance.
Directedness is a separate control with a low default — some is wanted, since a
narrator with none is a stenographer, but it should never be a hidden passenger
on the difficulty slider. This is also where plot hooks
([02 §4.1](02-data-model.md)) belong on the dial: hooks are the *honest* form of
directedness, authored and selected in the open, which is a better mechanism
than a narrator improvising a pull.

#### 7.3.3 Goals: an adventure has a win condition by default

Adopted from both sources, and a genuine divergence from the SillyTavern
lineage: **an Adventure has something you are trying to do, and progress toward
it is tracked.** Not an optional extra bolted on by an author — the default
shape, with "no goal, just play" as the deliberate opt-out.

This promotes the mutable Objective slot from [09 §4.1](09-infinite-worlds.md)
out of *worth trying early* and into a 1.0 feature, and it is what makes §7.3.1
coherent. Difficulty without a goal can only say "introduce friction", which is
weak and quickly reads as arbitrary. With a goal it can say **obstruct progress
toward this specific thing**, which is a far more useful instruction and one the
narrator can act on deliberately. The goal statement is therefore always
injected, and difficulty fragments are written to reference it.

Schema in [13 §7.1](13-schemas.md). The shape in brief: a short always-injected
`statement`, an optional fuller `detail` for steps, a `visibility` that makes
hidden goals the GM's arc through the same mechanism as hidden channels, and a
`completion` that is narrative, mechanical or manual.

**Progress is a channel** (§4), which settles how it is maintained without a new
mechanism: `update: "model-proposed"` in Freeform, where there is nothing to
compute from and the narrator's judgement is the only signal available;
`update: "engine-computed"` in Campaign, where quest state is real data. Same
declaration, different policy, and the proposal-versus-decision seam is already
specified.

**Completion detection is the part that will need tuning.** `kind: "narrative"`
means an evaluation step at `post` judges whether the goal is met — the
before-narration evaluation pass from [09 §4.3](09-infinite-worlds.md), pointed
at a different question. Both error directions are bad and they are not
symmetric: a missed completion is an annoyance the player can resolve manually,
while a false completion ends the story on a turn that did not earn it.
**Bias toward under-firing, and make manual completion always available.**

**[OPEN]** Whether narrative completion should require confirmation before it
fires. Cheap insurance against the worse error, at the cost of a prompt at the
most dramatically loaded moment in the session.

#### 7.3.4 What happens at the end: both answers

The two sources diverge here and both are right, so the setting takes both.
Infinite Worlds lets a concluded game continue open-ended; Marinara lets you set
the next goal. On completion, three offers:

- **Continue open** — the goal channel retains it as achieved, nothing new is
  set, play carries on without a driving objective.
- **Advance** — set the next goal, either the authored `next` or one written
  now. This is the campaign-arc shape and the reason goals are a **sequence
  rather than a field**.
- **End** — mark the session concluded. Concluded is a state, not a deletion:
  the session stays readable ([05 §12](05-ui-surfaces.md)) and branchable
  ([10](10-branching.md)), because "what if I had done it differently" is a
  reasonable thing to want at exactly that moment.

**The choice is made at completion, not only at setup.** `thenDefault` seeds the
offer; it does not decide it. A player who did not know at setup whether they
wanted an ending is the normal case, and the moment of completion is when they
finally have the information.

Completed goals are retained with the turn that completed them. That gives the
reading view real structure for free — an adventure's goal chain is a much
better spine for chapters than word count is ([06 E1](06-open-questions.md)) —
and it gives the plot-hook selector (§6.1) a signal it otherwise lacks:
proximity to the current goal is a strong reason to fire a hook or hold it.

### 7.4 The assistant

A baked-in AI helper, in the spirit of Marinara's Professor Mari: summonable
anywhere, knows the app, and can help you build things rather than only explain
them. It complements the in-editor field assists ([05 §11](05-ui-surfaces.md))
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
per user ([04 §4.3](04-server-multiuser-deployment.md)).

**Docs retrieval needs no new machinery.** Ship the documentation as a built-in
lorebook and attach it to the assistant. Keyword activation plus the budgeter
already do the work ([02 §3](02-data-model.md)).

#### Propose, then apply

Every mutation is a reviewable diff, not a silent write. Marinara has this
instinct too — a change-review service sits beside its workspace agent. Libraries
are per-user ([04 §4.3](04-server-multiuser-deployment.md)), so the risk is not
editing somebody else's character; it is that an assistant quietly rewriting
your own work is the fastest way to stop trusting it.

Applied changes carry `GeneratedFieldProvenance` ([05 §11.2](05-ui-surfaces.md))
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
  joinedAtTurn: number
  leftAtTurn: number | null       // history is kept; membership is a timeline
}
```

Design rules:

1. **The party always exists and always contains the persona.** There is no
   "party enabled" flag and no null party. A solo game is a party of one. This is
   the requirement that "no additional party members is not an edge case",
   expressed as an invariant so the code has one shape instead of two.
2. **Default is one member, `control: "player"`.** Single-persona play is the
   default everywhere, including Adventure.
3. **`companion` is not player-controlled.** A companion is narrated by the
   narrator, with the player able to address, direct and influence but not
   author. This is the "we are not building a D&D engine" line, and it is the
   difference between a party member and a second player.
4. **`auto` is for temporarily-attached NPCs** — the guide who walks you to the
   next town. Same structure, different lifetime.
5. **Party membership is a timeline, not a set.** "Who was with me in chapter
   two" is a question worth being able to answer, and retrofitting history onto a
   set is unpleasant.
6. **Party is session state available to every mode**, not an Adventure feature.
   Scene mode has a party; it's usually the actors present. Messages mode has a
   party of one. Modes differ in what they *do* with it.

**[OPEN]** Whether `control: "player"` may apply to more than one member — i.e.
whether one human may author two characters. Cheap to allow structurally,
and it is the seam where genuine multiplayer would eventually attach
([04 §7](04-server-multiuser-deployment.md)).

---

## 9. What an extension mode has to be able to do

The test for whether the contract is real. An externally-authored mode must be
able to, without engine changes:

- declare its own channels, with its own schemas, widgets and reducers
- declare its own setup wizard and store config the host never interprets
- contribute pipeline steps at any stage
- define its own input kinds and its own participant policy
- contribute UI surfaces (a HUD region, a side panel, a message decoration)
- ship with a package that declares a dependency on it
- read library objects through a capability API that is *narrow and typed* —
  Marinara's `CapabilityRuntime` is the model, including its instinct to make
  wrong values compile errors rather than runtime rejections

And must **not** be able to: reach the filesystem outside its own directory,
read or use connection credentials directly (it requests a call by capability
role and the host executes it), or write another mode's `modeData`.

**Execution model: settled.** Extensions run behind a worker-thread boundary
from 1.0, and built-in modes go through the same interface — specified in
[17](17-extensions.md).

The list above is why it costs little. Five of the seven requirements are
*declarative* and cross no boundary at all; the remaining two are a function over
serialisable data and async host calls. The `reads` field on `StepDefinition`
([§6](#6-steps-and-the-pipeline)) doubles as the payload filter, so a step
receives only what it declared it needs.

Two of the "must not" items above stop being conventions and become structural:
an extension in a worker cannot reach a credential, and cannot reach an
unrecorded random source ([07 §14](07-tech-stack.md)).

---

## 10. Renditions: illustration, and the shape video and speech share

**Per-turn and on-demand illustration is a 1.0 feature.** Ask for an image, or a
short series, for a turn — automatically each turn, or on demand from any
message in the history. Video and speech are lower priority and are *not* 1.0,
but the mechanism is designed so they are additional **kinds** rather than
additional subsystems.

### 10.1 One concept, three kinds

A **rendition** is a non-text artefact derived from a turn.

```ts
interface Rendition {
  id: string
  turnId: string
  kind: "image" | "video" | "speech"
  /** Which part of the turn this renders. Whole turn, or one message under
   *  per-actor dispatch — speech needs this, images usually do not. */
  scope: { messageId?: string } | null
  state: "pending" | "ready" | "failed"
  /** Ranked prompt fragments as sent, plus what the cap dropped. [07 §5.3] */
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

### 10.2 Renditions never block the turn

**The turn completes on text.** Renditions are dispatched as their own jobs and
arrive later over the event stream ([04 §2](04-server-multiuser-deployment.md)),
rendering in place as they resolve.

This is not an optimisation, it is the only workable design: an image is seconds
and a video can be minutes, and a story that stalls on either is unusable. It
also means a failed rendition is a placeholder with a retry button, never a
failed turn.

The corollary for [10 §2](10-branching.md): a rendition is **not** a channel
effect and does not participate in state reconstruction. It is an artefact
hanging off a turn, so a branch inherits the turn's renditions by inheriting the
turn.

### 10.3 Where the prompt comes from

An ordinary pipeline step at the `post` stage, which means it composes from
what is already there rather than needing a private pathway:

- the turn's output text — what actually happened;
- present actors' `VisualDescriptors` and their `reference` media
  ([13 §3](13-schemas.md)) — this is what the Character Studio's payload exists
  to feed, and the reason typed media roles are a 1.0 obligation;
- channel state — location, time of day, weather, whatever a mode tracks;
- the setting's `tone` and any style profile.

Assembled as **ranked fragments under the provider's declared cap**
([07 §5.3](07-tech-stack.md)), so overrun drops the lowest-ranked fragment
rather than truncating mid-sentence. That work was specified for exactly this
case.

### 10.4 A series, and what "series" should not mean

A turn may produce more than one image. Two mechanisms, and only the first is
1.0:

- **Variations** — N renditions from one prompt. Trivial, useful, and what most
  people mean.
- **Beats** — split the turn into moments and illustrate each. This is
  storyboarding, it needs a planner call, and it is where Marinara's storyboard
  machinery lives. Out of scope at 1.0; expressible later as a step that emits
  several prompts, because §10.1 already allows many renditions per turn.

### 10.5 What speech needs that images do not

Recorded now because it is cheap to accommodate and awkward to retrofit:

- **`scope.messageId`.** Speech is per utterance, not per turn — under
  `per-actor` dispatch a turn holds several. Images virtually never need this;
  the field exists so speech does not force a schema change.
- **A voice binding per actor.** Belongs in `modeData` or a `speech` block on
  the actor, and — like `ModelHint` — it is a *preference resolved locally*
  ([13 §3](13-schemas.md)), never a provider binding travelling in a shared card.
- **Streaming.** Speech wants to start before the text finishes; images do not.
  That is a step-level concern and does not change the record.

### 10.6 Controls

Per session: off, on-demand only, or every turn. Per mode defaults — Scene wants
illustration far more than Messages does. And a manual **Illustrate** action on
any message in the history, which is the same step invoked by hand — **additive,
never replacing** (§10.7).

**[OPEN]** Whether an on-demand rendition of an *old* turn assembles from that
turn's recorded state or from the present. Recorded state is more correct and
more surprising; the turn record makes either possible.

### 10.7 Renditions accumulate; recipes are permanent

Two policies, both settled in [06 E3](06-open-questions.md), both cheap now and
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
