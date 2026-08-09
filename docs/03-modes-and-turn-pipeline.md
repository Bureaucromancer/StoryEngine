# 03 — Modes and the turn pipeline

**Status: proposal.** This document is the core of the design. If any single
piece is worth arguing about at length before writing code, it is §2 and §4.

---

## 1. Naming

"Game Mode" needs a better name and the other two could use one too. A proposal,
flagged as entirely open:

| Requirement's name | Proposed | Why |
|---|---|---|
| Marinara "Convo" | **Messages** | Says what it is. Nobody needs it explained. |
| SillyTavern/Marinara RP | **Scene** | Names the unit of play, and generalises to VN-style staging. |
| "Game Mode" | **Adventure** | Covers both official presets without promising dice. |

Adventure ships two official presets: **Adventure · Campaign** (the Marinara RPG
shape — party, sheets, combat, dice, map, clock) and **Adventure · Chronicle**
(the Aventuras shape — do/say/think/story input, chapters, world-state
classification, branching, light or no mechanics).

Naming the *presets* rather than making them separate modes is the load-bearing
part: they share a mode contract, so a Chronicle game can switch on the dice
channel without becoming a different kind of thing.

**[OPEN]** All three names. "Chronicle" in particular is doing a lot of work for
a mode most likely to be someone's daily driver.

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
  presets: ModePreset[]           // "campaign", "chronicle"

  participants: ParticipantPolicy // §3 — who may speak and how turns are allocated
  assembly: AssemblyPlan          // §5 — which blocks, in what order, under what budgets
  steps: StepDefinition[]         // §6 — the pipeline
  channels: ChannelDefinition[]   // §4 — the state it owns
  inputs: InputKind[]             // free text / do / say / think / story / choice / …
  surfaces: SurfaceContribution[] // §7 — UI it contributes
  setup: SetupSchema              // the wizard, declared not coded
}
```

Everything an extension can do, a built-in mode does the same way. The three v1
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

**[OPEN]** Whether `voice` can vary *within* a turn — a narrator paragraph
followed by embodied dialogue from two characters, as three calls stitched into
one message. Powerful, and it multiplies latency and failure modes. Probably a
mode-preset capability rather than a per-turn toggle.

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
  Chronicle turns on `clock`, `chapters`, `relationships` and leaves the rest
  off. A user who wants dice in Chronicle turns on one channel. No new mode, no
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

**[OPEN]** Channel schema migration when a mode updates and an in-flight session
has old state. Needs a versioning story before anything ships; a `migrate`
function on the definition is the obvious answer and the obvious maintenance
burden.

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
   what a chat API looks like, and the only place a raw-completion adapter has to
   touch ([00 §2.2](00-stance.md)).

The `AssemblyPlan` in the mode definition declares the ordering constraints and
budget policy; it does not build strings.

Templates (Liquid, following Aventuras) render *within* a block. Aventuras'
`PackTemplate` dual-hash trick — `contentHash` plus `baselineHash`, where the
divergence distinguishes "app shipped a new default" from "user edited this" — is
the correct solution to updating shipped templates and should be adopted
wholesale.

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

## 7. The three modes at 1.0

### 7.1 Messages

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

### 7.2 Scene

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

### 7.3 Adventure

Two official presets over one contract.

**Campaign** — the Marinara RPG shape. Channels: party sheets, HP/pools,
attributes, inventory, quests, map, clock, weather, NPC reputation, session
summaries. Narrator voice, merged dispatch, engine-computed combat resolution.
Sessions-within-a-campaign with structured recaps and a bridging message on
resume — a genuinely good pattern that should be a shared capability, not
Campaign-specific.

**Chronicle** — the Aventuras shape, and per the requirements the one most likely
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
  Generalising it means Scene and Chronicle get it free — which is exactly the
  cross-pollination the requirements ask for.
- The three address modes (in-scene / to the party / to the GM) generalise to an
  **input target** on the input bar, available to any mode with more than one
  addressable audience. Messages mode gets "reply to X" from the same mechanism.

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
([04 §5](04-server-multiuser-deployment.md)).

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

**[OPEN]** Extension execution model — in-process modules, or sandboxed workers
with a message-passing API? In-process is far simpler and makes every installed
extension fully trusted. Given LAN multi-user with a shared library, that may be
acceptable at 1.0 if extension installation is admin-only. Needs an explicit
decision because it is very hard to retrofit.
