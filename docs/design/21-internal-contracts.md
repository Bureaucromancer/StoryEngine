# 21 — Internal contracts

**Status: proposal.** The structures that never leave the install but that
everything is built against.

**Why this document exists.** [04](04-schemas.md) covers portable structures and
deliberately stops there — a turn record never crosses an install boundary, so it
is free to migrate ([04 §1](04-schemas.md)) and defining it early buys no
compatibility. That reasoning is right and produced a gap: *free to move* was
read as *need not exist*, and four of the turn record's substructures ended up
referenced across eight documents and defined nowhere.

They are not incidental. The turn record is described as the artefact everything
reads ([00 §1](00-stance.md)), the highest-value test surface
([work plan P2](workplan/01-work-plan.md)), and what branching, replay and the workbench are all
built on. **P2 cannot be written without these types.**

> **The tier is unchanged: internal, migrate at will.** Nothing here carries a
> `schema` field or a version number, nothing here is validated on import, and
> changing any of it is a normal refactor rather than a compatibility event.
> Defined because the first line of code needs them, not because they are stable.

---

## 1. The turn record, completed

[03 §8](03-data-model.md) defines `Turn` and `AssembledBlock` and references four
types it does not define. Here they are, with the properties other documents
depend on called out.

### 1.1 `BlockSource` — one vocabulary, used from both ends

Currently two vocabularies describing the same thing:
`AssembledBlock.source.kind` ([03 §8](03-data-model.md)) and `SlotSource.of`
([04 §8.2](04-schemas.md)). They overlap, disagree, and nothing relates them —
which would mean the workbench's block list and a preset's slot list disagreeing
about what anything *is*, while golden-file tests snapshot the former and authors
edit the latter.

**They are one vocabulary.** A preset slot names a source, the assembler fills
it, the resulting block records where it came from. Same name, both ends.

```ts
type BlockSource =
  /** The persona is an actor too (P3.0): the id makes the block clickable and
   *  the hash addresses the bytes that were used; both null when the session
   *  has no persona. */
  | { kind: "persona"; actorId: ActorId | null; contentHash: string | null }
  /** contentHash since P3.0 — the cast is a link read fresh each turn, so the
   *  id resolves to the actor as it is now; the hash to the actor as sent. */
  | { kind: "actor"; actorId: ActorId; contentHash: string; sectionId?: string; field?: "traits" | "visual" }
  /** `bookId` since [P8.4] (written in 2026-10-01): the book an entry came
   *  from, so a memory book's entry names its origin; absent before then. */
  | { kind: "lore"; entryId: string; phase: "before" | "after"; bookId?: string }
  /** turnId is the identity (P3.0); the window-relative range stays as display
   *  information — where in this prompt the turn sat. `part` is which half of
   *  the turn, and `attachment` (2026-09-27, [25 E15]) is one picture on its
   *  input, named by `attachmentId`. */
  | { kind: "history"; turnId: TurnId; range: [number, number];
      part: "input" | "output" | "attachment"; attachmentId?: string; message?: number }
  /** One writing sample, from whichever kind carried it — [04 §3.1],
   *  [14](14-writing-samples.md). `owner` rather than a bare `actorId` because
   *  the slot outgrew the actor; `contentHash` for the reason the `actor` arm
   *  carries one — the carrier is a link read fresh every turn. */
  | { kind: "samples"; owner: { kind: "actor" | "treatment" | "lore"; id: string; contentHash: string }; sampleId: string }
  | { kind: "channel"; channelId: ChannelId }
  /** ([P14.5a](workplan/31-p14-scene-and-session-import.md); written in
   *  2026-10-01.) What the story has established: every channel declaring
   *  itself established state, scoped values included, as one block; `keys`
   *  names the channels it read. */
  | { kind: "state"; keys: string[] }
  | { kind: "treatment"; part: "framing" | "tone" }
  /** *Added 2026-09-30*, with the slot of the same name ([04 §8.2]): a text
   *  answer the session was set up with; `field` is the wizard field's id. */
  | { kind: "setup"; field: string }
  | { kind: "goal"; goalId: string }
  /** ([P7.8](workplan/23-p7-implementation.md); written in 2026-10-01.) One
   *  fragment of a dial's level — the `difficulty` and `directedness` slots
   *  both record here, `axis` saying which; `fragmentIndex` is its place in
   *  the level, which has no ids. Each fragment is budgeted at its block's
   *  priority and ranked within it by its order — deliberate, and recorded as
   *  a decision by [main audit §2](workplan/32-main-audit.md). */
  | { kind: "difficulty"; axis: "difficulty" | "directedness"; levelId: string; fragmentIndex: number }
  /** The guidance slot ([06 §5.1](06-modes-and-turn-pipeline.md)). `producer` because that
   *  section is explicit that one slot has several — the user's box, a rule's
   *  `giveGuidance`, a Narrative Director push — and the workbench should be
   *  able to say which without three sources to keep in step. */
  | { kind: "guidance"; producer: "user" | "rule" | "step" }
  /** The previous attempt a guided redo showed the model ([06 §5.1]). `turnId`
   *  is the sibling whose output was shown — what makes *which attempt* a
   *  question the record answers; null only when a preset emits the slot over
   *  nothing, the claim `persona`'s nulls make. */
  | { kind: "attempt"; turnId: TurnId | null }
  /** What the player just did. Not `history`: history is turns that happened,
   *  and this is the one that is happening. With `part: "attachment"`, one
   *  picture on it ([25 E15]); absent is the words. */
  | { kind: "input"; part?: "attachment"; attachmentId?: string }
  /** ([P8.1](workplan/25-p8-implementation.md); written in 2026-10-01.) One
   *  link of the summary chain: `linkKey` is its content address, `range` the
   *  stretch of story it covers. One candidate per link, so the budgeter drops
   *  the oldest stretch first. */
  | { kind: "summary"; linkKey: string; range: [number, number] }
  /** ([P7.4](workplan/23-p7-implementation.md); written in 2026-10-01.) The
   *  engine's own JSON instruction, for an endpoint that cannot be handed a
   *  schema — protocol rather than content, and named by no slot. */
  | { kind: "schema" }
  // ── ~~The two~~ ~~The three~~ ~~The four~~ The five a slot can never name, because no preset positions them ──
  /** `presetId` since P4.4 (written in 2026-10-01): the preset the block was
   *  authored in, which a session's copy keeps. */
  | { kind: "preset"; blockId: string; presetId?: string }   // a TextBlock: authored prose
  | { kind: "step"; stepId: StepId }      // contributed at runtime
  /** ([P14.2](workplan/31-p14-scene-and-session-import.md), corrected
   *  2026-09-29.) One reply of a round that has not been committed yet — an
   *  earlier speaking call of this turn — placed by the collector after the
   *  input and never by a pack. `message` is its index into the turn's
   *  `output.messages`; `actorId` who said it, null for a narrator's. */
  | { kind: "round"; message: number; actorId: ActorId | null }
  /** ([P14.3](workplan/31-p14-scene-and-session-import.md), 2026-09-29.) The
   *  session's author's note, placed by the collector at its own depth on
   *  every `every`-th input — never by a pack. */
  | { kind: "note" }
  /** ([P14.4](workplan/31-p14-scene-and-session-import.md), 2026-09-29;
   *  written in 2026-10-01.) The continue nudge, which the engine puts last. */
  | { kind: "continue" }
  // ~~(2026-09-30) Behind the shipped type: `summary`, `schema`, `difficulty`,
  // `state` and `continue` are arms of `BlockSource` this list never gained.~~
  // Written in 2026-10-01 (the audit's record, [main audit §4](workplan/32-main-audit.md)),
  // with lore's `bookId` and preset's `presetId`, which it had not gained either.
```

**`preset` and `step` are the asymmetry**, and naming it is the point. A slot
positions content the engine produces, so it can never point at "the preset's own
prose" — that is a `TextBlock`, which *is* a block rather than a reference to
one. Likewise a step's contribution has no slot because it did not exist when the
preset was authored. `SlotSource` is therefore **`BlockSource` minus those
~~two~~ three**, which is a derivation rather than a second list. *Corrected
2026-09-29, at [P14.2](workplan/31-p14-scene-and-session-import.md)*: `round`
is the third, and cannot be slot-named for the reason a step's contribution
cannot — the replies do not exist when the pack is authored — and for one more:
every pack written before P14.2 positions no such slot, and a round a pack had
to opt into would be a round in which each member answered the player alone.
*And again at [P14.3](workplan/31-p14-scene-and-session-import.md), 2026-09-29*:
`note`, the author's note, is the fourth, for the round's second reason — a
note a pack had to position would be a setting that did nothing in every pack
written before it. The `history` arm gained an optional `message` index at the
same stage, for a turn's `output.messages` entries. *And at
[P14.4](workplan/31-p14-scene-and-session-import.md), 2026-09-29* (written in
here 2026-10-01): `continue`, the nudge the engine puts last, is the fifth —
which is what `assembly/types.ts` excludes. `schema`, the engine's own JSON
instruction, is named by no slot either, and the derivation leaves it in: no
pack arm can produce it, so excluding it would guard nothing.

**`guidance` and `input` were added at P2.5, and their absence was a real
gap rather than an omission.** [06 §5.1](06-modes-and-turn-pipeline.md) says the guidance
block is *"positioned by the preset"* — which makes it slot-nameable by
definition — but the only source it could have claimed was `step`, one of the
two `SlotSource` excludes. So a preset could not position the one block that
section says it positions. Found when the first real producer needed a source to
declare.

**`attempt` was added on `main` after P6A, and it is the first slot whose
content is another turn's output.** That is why it carries a `turnId` the way
`history` does and the advisory marker the way `guidance` does, and why it is a
slot of its own rather than a fourth producer of `guidance`: the block table has
to say which attempt the instruction was about, and a producer field cannot
name a turn. The same route as guidance in every other respect — the runner
collects it, no step is handed it, and the firewall refuses it from anything
that is not prose.

**A picture is a `part`, not a source — added 2026-09-27, with R1 of
[25 E15](25-open-questions.md).** A picture on a player's move is emitted as its
own block from inside the `input` and `history` expansions, because a
top-level arm would, by the derivation above, be a slot any preset could
position — and a picture belongs where its turn is, not wherever a preset puts
it. Its own block rather than more text in the move's block because the
budgeter, the block table and the send rule all need to name it separately: it
is the unit that goes as pixels or as words.

The identifiers (`actorId`, `entryId`, `stepId`) are what make a block's
provenance clickable in the workbench — *which* lore entry, not just "a lore
entry". [06 §5](06-modes-and-turn-pipeline.md)'s "the reason is a product
feature, not a debug string" needs this to be true of the source as well.

### 1.2 `ChannelEffect` — the one to get right

**The most load-bearing type in this document.** It carries reversibility
([07 §2](07-branching.md)), it crosses the worker boundary
([22 §4](22-extensions.md)), it is what a branch replays
([07 §4](07-branching.md)), and it is what undo inverts
([00 §2.8](00-stance.md)). An effect that cannot state its own inverse breaks all
four at once.

```ts
interface ChannelEffect {
  id: string
  turnId: TurnId
  channelId: ChannelId
  /** Which value, when the channel is scoped per actor or per entry. */
  scopeKey: string | null

  op: EffectOp
  /** State before, for exactly the keys this effect touched. This is what
   *  makes the effect invertible without replaying from zero — §1.2.1. */
  before: unknown
  after: unknown

  /** Who proposed it, and who decided. The model proposing and the engine
   *  deciding is [06 §4]'s update policy, recorded rather than assumed. */
  proposedBy: { kind: "model"; callId: string }
               | { kind: "step"; stepId: StepId }
               | { kind: "user" }
               | { kind: "engine" }
  applied: boolean
  /** Present when `applied` is false. Validation failure, an engine-computed
   *  rule overriding a model proposal, or a policy refusal — *and (2026-09-30)
   *  a step's proposal its declaration does not cover*: a channel outside its
   *  `writes` (`undeclared-write`), or a proposer it is not
   *  (`not-its-proposer`, recorded under the step's own stamp). The engine's
   *  classes are `EffectRefusal` in `shared`; the field stays open. */
  rejectedReason: string | null

  /** Schema version of the channel this was written against. [06 §4.2] */
  channelVersion: number

  /** Whether the effect stayed inside the session or escaped it — a library
   *  write, a generated asset, anything a branch cannot un-write. Escaped
   *  effects are recorded like everything else but never replayed or
   *  reverted ([07 §7]). Added ahead of P2 so P6 needs a field, not a
   *  migration ([P2 §2.7], closing [P6 §1.5]); P2 writes only "session". */
  scope: "session" | "escaped"
}

type EffectOp =
  | { type: "set"; path: string }
  | { type: "merge"; path: string }
  | { type: "delete"; path: string }
  | { type: "append"; path: string }
  | { type: "increment"; path: string; by: number }
```

***Four of the five arms are unimplemented, by decision rather than by backlog —
recorded 2026-09-11 at [P7 §0.2](workplan/23-p7-implementation.md).*** `acceptEffect`
throws a *programmer error* on anything but `set` at `/`, because `applyEffects`
replaces the whole value at a key. The first candidate for a partial op was P7.2's
party membership — a timeline that grows ([06 §8](06-modes-and-turn-pipeline.md))
— and it turned out not to need one: `scopeKey` already partitions a channel's
value, so an actor-scoped party makes each effect carry one actor's records
instead of the party's history.

**The reason to keep them unimplemented is §1.2.1's, not economy.** Whole-value
replacement is what makes replay-from-zero equal snapshot-plus-replay by
construction, and what makes an inverse a *swap*. Every partial op is a reducer —
a second implementation of the value's semantics that the replay assertion has to
be re-proved against and that `before` must be able to invert. So an arm is
implemented when a channel genuinely needs it, and that channel first has to say
why its value cannot be scoped instead. *The arms stay in the type because they
are the vocabulary a channel would declare against; a type is cheaper to keep
than a migration is to run.*

#### 1.2.1 Why `before` is stored rather than derived

It looks redundant — the previous state is replayable — and storing it makes
three things cheap:

- **Undoing the tip is local.** Reverting the newest turn means applying
  `before`, not replaying 0..N-1. [00 §2.8](00-stance.md)'s promise, in place of
  Aventuras' hand-maintained `PersistentRetryState`.
- **The workbench can show a diff** without materialising two full states.
- **A snapshot disagreement is diagnosable.** [07 §4](07-branching.md) requires
  CI to assert replay-from-zero equals snapshot-plus-replay; when that fails,
  `before`/`after` pairs say *which effect* diverged rather than only that the
  end states differ.

##### `before` does not give arbitrary historical undo

An earlier draft of this section claimed it did — *"inverting turn N means
applying `before`"* — and that is wrong for any N that is not the tip.

> HP goes `10 → 8` at turn N. Later it goes `8 → 5`. Applying turn N's
> `before: 10` at the current head does not undo turn N; it destroys the later
> change and produces a state no turn ever wrote.

The general rule: **`before` is only a valid inverse when nothing has touched
the same path since.** Blind application is a silent corruption, and silent is
the operative word — the value is plausible, so nothing surfaces.

**Two operations, and they are genuinely different:**

| | Mechanism |
|---|---|
| **Undo the tip** | Apply `before`. Local, O(1), what the undo button does. |
| **Change something further back** | **Branch and replay** ([07 §3](07-branching.md)) |

The second is not a limitation to apologise for — it is the design's existing
answer. "Go back to turn N and do it differently" is a pointer move plus new
turns, which is cheaper *and* more honest than mutating history in place: the
original line survives, both are readable, and nothing is destroyed. A tree
model that also offered destructive historical edit would be offering a worse
version of what it already does well.

**So the implementation rule:** applying an inverse requires the effect to be at
the tip for its `(channelId, scopeKey, path)`. If it is not, the operation is
refused and the branch path is offered instead. That check is cheap — the index
knows the latest effect per path — and it converts a silent corruption into a
UI affordance.

*Cost:* effects grow with the state they touch, and a `merge` over a large object
stores a large `before`. Bounded by scoping `before` to the touched keys — hence
`op` carrying a `path` — and channel state is tracked numbers and flags
([06 §4.2](06-modes-and-turn-pipeline.md)), not prose.

#### 1.2.2 Rejected effects are recorded, not dropped

`applied: false` with a reason, kept in the record. A model proposing an illegal
state change is information — it is how a preset gets debugged and how
`engine-computed` demonstrates that it overrode something
([10 §3](10-ui-surfaces.md) lists exactly this in the workbench's effects view).
Dropping them would make "the model tried to give itself 40 gold" invisible.

They are skipped on replay, which follows from `applied`.

### 1.3 `ChannelState` and `ChannelDefinition`

```ts
interface ChannelState {
  /** Which schema version the value was written against. One integer, never
   *  the schema itself. [06 §4.2] */
  version: number
  value: unknown                 // validated against the definition's schema
  /** Set when load-time validation failed and the value was quarantined.
   *  The raw value survives here until the user chooses. [06 §4.2] */
  degraded?: { reason: string; raw: unknown }
}
```

`ChannelDefinition` is [06 §4](06-modes-and-turn-pipeline.md)'s ~~, with one
field that section describes in prose and does not show~~ — ***and it was four
rather than one, corrected in 06 §4 on 2026-09-11.*** That sketch was missing
`version` and `visibility` outright, wrote `owner` without the `PackageId` its
own §4.1 requires from the first definition written, and named an `UpdatePolicy`
alias that exists nowhere. **The occasion was P7.0 publishing this type through
`@storyengine/sdk`**: a sketch that disagrees with a shipped contract is a design
note the first mode author reads and is misled by, so the disagreement had to be
spent at the moment of publication rather than discovered by whoever built
against it.

```ts
interface ChannelDefinition {
  id: ChannelId
  /** **Shipped at P2.6**, with the first channel definition — [06 §4.1] names
   *  accepting a package id as something 1.0 owes from that first definition,
   *  because widening it afterwards is a migration over every stored channel. */
  owner: ModeId | ExtensionId | PackageId   // package: [06 §4.1], 6.0
  version: number                            // paired with ChannelState.version
  schema: JSONSchema
  /** `hook` at P7.5 and `goal` at P7.6, each with a channel that needed it —
   *  a hook's firing state is per hook and a goal's is per goal, and neither
   *  is expressible as a session or an actor scope. */
  scope: "session" | "actor" | "entry" | "hook" | "goal"
  init: InitPolicy
  update: "model-proposed" | "engine-computed" | "user-only"
  visibility: "player" | "hidden"            // [06 §7.3]
  budget: number | null
  /** How the value reads *in a prompt*, as a template — the injection half of
   *  the contract, shipped at P7.1 beside `budget`, which was `null` on every
   *  channel until something could render one. [06 §4] */
  render?: string
  /** How the value reads *to a person*. A different sentence from `render`,
   *  and both are declarations rather than code. [10 §8] */
  surface?: WidgetSpec
  /** Terminal values a person has to confirm before they apply — P7.2, and the
   *  field [25 C12](25-open-questions.md)'s resolution turns on: a model may
   *  propose that a goal was achieved, and a person says whether it was. */
  confirm?: readonly string[]
  /** Optional, and optional deliberately — most schema evolution never needs
   *  one. Must be pure and deterministic: it sits inside the replay path.
   *  [06 §4.2] */
  migrate?: (fromVersion: number, state: unknown) => unknown
}
```

~~**What P2 actually ships of this type**: `id`, `owner`, `version`, `scope`,
`update`, `visibility` and `budget`. `schema`, `init` and `migrate` are absent —
`InitPolicy` is itself deferred by §6, and a `migrate` hook sits inside the
replay path, so guessing its contract before a channel needs one is the thing §6
refuses to do for `WidgetSpec`.~~

***Corrected 2026-09-13: one is absent, not three.*** `schema` and `init` both
shipped at [P7.1](workplan/23-p7-implementation.md) — `init` **required**, which
is the stronger form — and `render`, `surface` and `confirm` arrived at P7.1,
P7.1 and P7.2. **Only `migrate` is still absent**, and its argument is unchanged
and is its own rather than §6's: a hook inside the replay path should not have
its contract guessed before a channel needs one, and none has.

*The drift is worth naming because this block's preamble exists to prevent it.*
That paragraph was added at P7.0, and it says a sketch disagreeing with a shipped
contract *"is a design note the first mode author reads and is misled by"* — and
then the sketch drifted one stage later, four fields deep, for fifteen stages.
**A note saying keep this in step is not a mechanism**; what would be one is the
`docs` project growing a check that the sketch's field set matches the SDK's, and
that is worth more than another paragraph asking.

**`InitPolicy` now has a named first consumer, which is how §6 wanted it to
arrive.** The hook-pacing dial ([06 §6.1](06-modes-and-turn-pipeline.md),
[04 §6.1b](04-schemas.md)) is a session channel with `update: "user-only"`,
`budget: null`, and an init that reads a Treatment's advisory value — which
exercises exactly the *from treatment* arm [06 §4](06-modes-and-turn-pipeline.md)
describes and nothing has needed until now. It is a P7 dependency rather than a
free consequence: the dial cannot be built before the policy is, and scheduling
the two apart would have the dial invent its own prefill path. Worth having,
because a contract designed against one real need beats one designed against
three imagined ones — which is §6's own argument for deferring it.

**A second consumer has since appeared, and it is the same shape**, which is the
outcome that argument was betting on. Illustration pacing
([06 §10.6](06-modes-and-turn-pipeline.md)) is a session channel with
`update: "user-only"`, `budget: null` and an init from treatment — hook pacing's
declaration with a different subject. It arrives later than P7, so it does not
move the dependency above; it is worth recording only because *designed against
one real need* is a claim that has to be checked rather than assumed, and the
check came back clean. A contract that fits its second consumer without
alteration was fitted to the right thing.

### 1.4 `ModelCall`

```ts
interface ModelCall {
  id: string
  stepId: StepId
  role: ModelRole                 // never a model id — [19 §5.1]
  /** What this call was allowed to produce, derived from the step's declared
   *  contributes/writes (P3.0). Not recoverable after the fact — StepOutcome
   *  records only the counts — and the committed half of [testing §1]'s
   *  advisory invariant. */
  purpose: "prose" | "effects" | "verdict"
  /** What the role actually resolved to, recorded because the binding can
   *  change between turns and "why is this turn different" needs an answer. */
  resolved: { connectionId: string; modelId: string }
  /** This call's assembly and its verdict (P3.0) — non-null by construction,
   *  since a ModelCall exists only downstream of assemble(), including the
   *  provisional in-flight entry the runner checkpoints before dispatch so a
   *  killed process still leaves the block table it was sent. */
  blocks: AssembledBlock[]       // §1.1's vocabulary
  budget: BudgetVerdict          // §1.5
  /** The preset blocks that emitted nothing for this call, each with a reason
   *  class (P3.0, closing [P3 §7.5]) — the record's answer to "why is there
   *  no lore in this prompt". Empty when a step supplied its own candidates. */
  notFilled: { blockId: string; source: string; reason: string }[]
  messages: RenderedMessage[]     // §2
  params: GenerationParams
  /** Provider-reported, not estimated. The measured half of budgeting with a
   *  margin ([25 E5](25-open-questions.md)). */
  usage: { promptTokens: number; completionTokens: number } | null
  cost: { amount: number; currency: string } | null
  wallMs: number
  outcome: "ok" | "refused" | "error"
  /** Classified per [25 E7](25-open-questions.md), so the UI can offer the
   *  right recovery rather than surfacing a provider string. */
  error: { class: "transient" | "retryable" | "terminal"; message: string } | null
  retries: number
}
```

**`resolved` is the field most likely to be skipped and most likely to be
wanted.** Steps name roles, so nothing in the pipeline knows the model — which
means without this the record cannot answer *what actually ran*, and that is the
first question anyone asks about a turn that came out wrong.

**A call that makes no turn keeps the same three measured fields, elsewhere**
(2026-09-27). A field assist, an impersonation and the moment call behind
**Illustrate** each reach a model without a turn to carry a `ModelCall`, and
until this date each dropped the provider's figures —
[10 §11.4](10-ui-surfaces.md)'s *"must be recorded even though nothing displays
it"* unkept. They now append one line each to `users/<handle>/usage.jsonl`:

```ts
interface UsageRecord {
  schema: "storyengine.usage/1"
  at: string                                       // when the call returned
  purpose: string                                  // "impersonate", "assist:<field path>", "illustrate" — open
  role: ModelRole
  resolved: { connectionId: string; modelId: string }  // the model that answered, as above
  usage: { promptTokens: number; completionTokens: number } | null
  cost: { amount: number; currency: string } | null
  wallMs: number
  sessionId?: string                               // when the call was made from one
  subject?: string                                 // the library kind an assist wrote for
}
```

`usage` and `cost` follow this section's rule exactly: copied from the provider,
never estimated, and null when it said nothing. A file in the account's
directory rather than the index or `state.sqlite`, by §5.1's test — it is not
derived, and an account archive carries files but holds none of the install's
state.

### 1.5 `BudgetVerdict`

```ts
interface BudgetVerdict {
  /** The window, and the honest account of where it came from (P3.0).
   *  `source` names the origin of the *ceiling* — whichever side won the min:
   *  the endpoint's declared window, the preset's absolute cap ([04 §8.4.1]'s
   *  4k-must-not-apply-at-200k rule), or the config default (`"user"`, the
   *  live-editable number). The preset's `contextShare` narrows the ceiling to
   *  `tokens` without relabelling it: `share` present ⇒ a preset budget was in
   *  play and `tokens === floor(ceiling × share)`; absent ⇒ `tokens === ceiling`.
   *  The old shape stamped `"preset"` whenever a share applied, which hid the
   *  exact remedy this field exists to suggest. */
  limit: { tokens: number; ceiling: number; source: "provider" | "preset" | "user"; share?: number }
  reserved: number                // held back for the completion
  spent: number
  /** Ordered as considered. Every block appears, including the included ones —
   *  a verdict listing only drops cannot answer "what falls out next". */
  decisions: {
    blockId: string
    tokens: number
    included: boolean
    /** The rule, in the language the workbench shows. "book budget",
     *  "priority 3 < cutoff", "always". [10 §3] */
    rule: string
  }[]
  /** What would drop on the next turn at current pressure. [10 §3] promises
   *  this is answerable *before* it happens, which requires computing it. */
  nextToDrop: string[]
}
```

*(2026-09-27)* **A verdict needs `limit.tokens > reserved`, and a call without it
is refused rather than recorded.** Assembly spends `limit.tokens − reserved`; at
zero or below, every block that was not required was dropped and the call went
out anyway, so the model continued a story none of which was in front of it, and
the verdict was the only trace. `planCall` now throws `WindowTooSmall` first: the
step fails with `window-too-small` and its own remedy (the connection's window or
the reply length is the setting to change), and the preview and a draft answer
with the same class rather than a context meter over an empty prompt.

### 1.6 `VersionRecord`

One line of `history/index.jsonl` inside a library object's folder
([03 §11.2](03-data-model.md)). Internal: the *payload* is a portable object, but
the bookkeeping around it never leaves the install and is free to migrate.

```ts
interface VersionRecord {
  id: string
  /** sha256 of the snapshot payload — the filename under history/v/, and what
   *  makes an edit-and-revert store one copy rather than two. */
  digest: string

  /** When the snapshotted state was *authored*, not when it was superseded.
   *  Taken from the replaced object's `provenance.updatedAt`. The subtlety
   *  Marinara names explicitly and the reason a restored version keeps its real
   *  date in the list. [03 §11.1] */
  authoredAt: string
  /** When the snapshot was taken. Usually uninteresting; occasionally the only
   *  way to explain an out-of-order list. */
  recordedAt: string

  /** What made the change this snapshot preserves the state before. */
  source:
    | { kind: "manual" }
    | { kind: "assist"; field: string }        // [10 §11.1]
    | { kind: "extension"; extensionId: string }
    | { kind: "import"; from: string }
    | { kind: "external" }                     // a hand-edit, seen by the watcher
    | { kind: "restore"; fromVersionId: string }
  /** Free text. Sometimes generated ("Saved before restoring an earlier
   *  version"), sometimes the user's — they may rename it later. */
  reason: string

  /** The author's own version string at the time ([03 §11.5]) — theirs, not
   *  ours, and displayed alongside our revision number rather than instead
   *  of it. */
  authorVersion: string | null
  /** Exempt from retention pruning. [03 §11.3] */
  pinned: boolean
}
```

**`revision` is not a field.** It is the entry's ordinal in the file, computed on
read, exactly as Marinara does it. Storing it would mean rewriting records when
one is pruned, and an append-only file should never be rewritten for a display
number.

**The live object appears at the top of the history list** as a synthetic
current entry rather than being written to the file — also Marinara's approach,
and it is what makes "compare against current" the same operation as comparing
any two versions.

---

## 2. Rendering: blocks to provider messages

[06 §5](06-modes-and-turn-pipeline.md) step 4 is one sentence, and it hides a
decision: **what happens to adjacent blocks with the same role?** Six consecutive
`system` blocks — one message or six?

It is not a detail. Providers differ, and some reject consecutive same-role
messages outright. SillyTavern ships `squash_system_messages` as a *user-facing
treatment*, which is what a project does after discovering the answer varies by
endpoint.

**So it is a provider capability, not a global choice** — `mergeSameRole` on
`ProviderCapabilities` (§3), defaulted per known provider and overridable per
connection, exactly like the prompt caps beside it
([19 §5.3](19-tech-stack.md)).

```ts
interface RenderedMessage {
  role: "system" | "user" | "assistant"
  content: string
  /** Which blocks produced this message, in order. Non-empty always. */
  fromBlocks: string[]
  /** Only on a message carrying a picture whose pixels are sent — 2026-09-27,
   *  [25 E15]. The text parts, joined, are exactly `content`. */
  parts?: ({ kind: "text"; text: string }
         | { kind: "image"; blockId: string; digest: string; mime: string })[]
}
```

***`content` stays the whole text rendering, and `parts` rides beside it*** —
the restraint [25 E15](25-open-questions.md) asked of 1.0, kept when R1 landed
on 2026-09-27. Every reader of this record that predates pictures reads
`content` and still reads everything the model was told in words, the picture's
caption included; `parts` only says *where among those words a picture went*.
**It names the picture by digest and never carries it**: the bytes are loaded
from the session's store for the wire and never persisted, so a call record
with a picture in it is the size of one without. The adapter sends array
content only for a message that carries an admitted picture, and a string
otherwise — some text-only endpoints reject an array outright, and a
picture-less message has no reason to risk it.

**`fromBlocks` is the requirement that merging must not break.** The workbench
maps every sent byte back to the block that produced it
([10 §3](10-ui-surfaces.md)), and a merge that concatenates six blocks into one
string without recording which six destroys that mapping — quietly, and only
noticeably when someone is debugging. Keeping the list makes merging a rendering
detail rather than a loss of provenance.

Two rules that follow:

- **Merging is the last step**, after budgeting. The budget verdict is per block
  and must stay so.
- **A merged message is never re-split.** If a provider changes its mind, the
  next assembly renders differently; the record shows what was actually sent.

---

## 3. `ProviderCapabilities`

[19 §5.3](19-tech-stack.md) sketches this and trails off in a `// …`. Completed
here because the adapter layer is P2.

```ts
interface ProviderCapabilities {
  supportsTools: boolean
  supportsStructuredOutput: boolean
  supportsStreaming: boolean
  /** Whether consecutive same-role messages are acceptable. §2 */
  mergeSameRole: "required" | "preferred" | "never"
  /** Whether a leading system message is supported at all — some endpoints
   *  want it folded into the first user message. */
  systemMessage: "supported" | "fold-into-first-user"
  maxPromptChars?: number         // hard: what the endpoint accepts
  usefulPromptChars?: number      // soft: where quality degrades
  maxContextTokens?: number
  /** Whether the provider reports token usage. When false, the record's
   *  `usage` is null and the budgeter's margin is the only signal. */
  reportsUsage: boolean
  /** Whether this endpoint makes pictures. §7, [P9.2]. */
  rendersImages: boolean
  /** How many named subjects one picture can hold. [06 §10.3] */
  maxNamedSubjects?: number
}
```

***The last two are the record answering a second endpoint*** — added
2026-09-16 at [P9.2](workplan/26-p9-implementation.md), and they are also the
evidence [P9 §1.2](workplan/26-p9-implementation.md) weighed when it decided that
image providers go behind the **same** `Provider` interface as a second verb
rather than beside it as a second kind: this record already straddled both shapes
before either field existed, since `maxPromptChars` and `usefulPromptChars` are
documented against CLIP's 77-token window and sit beside `supportsTools`.

**`rendersImages` is false in the baseline and false for every known provider.**
`openai-compatible` names a *chat* protocol, and whether the URL behind it also
answers `/images/generations` is a fact about that endpoint — so it is set per
connection, which is where this section already says a limit belongs. It is also
what keeps the `image` role honest: [19 §5.1](19-tech-stack.md) leaves that role
unset until a matching connection exists, and without this a person could bind it
to their chat endpoint and find out one turn later.

**`maxNamedSubjects` is undeclared rather than defaulted**, for the reason the two
prompt caps are. [06 §10.3](06-modes-and-turn-pipeline.md) puts it here in as
many words — *"a number that varies per endpoint is the definition of a
capability"* — and notes that Aventuras caps at one while Marinara derives a
limit that runs from one to sixteen depending on the backend.

Defaults ship per known provider and are overridable **per connection**, because
a limit is a property of that endpoint and connections are private production
config ([00 §3.2](00-stance.md)).

***Seeing pictures is not here, and it is the first capability that could not
be*** — 2026-09-27, [25 E15](25-open-questions.md) R1. Everything in this
record is a property of the endpoint, and whether a model can read an image is
a property of the *model*: one Ollama URL, or one OpenRouter key, serves a
vision model and a text one. A connection-wide flag would send pixels to the
text model the first time a binding or an actor hint resolved to it, on every
redo of that turn. So a connection carries **`imageModels`**, beside `models`
and a subset of it, empty by default — and outside `capabilities`, because the
connection editor keeps stored capability overrides across model edits, which
would leave the list naming models that are gone. It departs from this
section's premise, and says so here where the premise is.

---

## 4. `config.json`

Referenced in the storage layout ([03 §5.1](03-data-model.md)), given a
permission rule ([10 §4](10-ui-surfaces.md)), promised a commented example
([03 §5.4](03-data-model.md)), and required by
[25 D0](25-open-questions.md) to annotate **every key** with a reload tier — with
no key list anywhere. It is P1 work: the bind address alone decides first-boot
behaviour.

```ts
interface Config {
  dataDir: string
  server: {
    host: string; port: number; trustProxy: boolean
    cookieSecure: boolean                    // [P6A §1.4]
    clientRoot: string
    mdnsName: string                         // [09 §5.1]                       // [P6A §1.3]
  }
  auth: {
    minPasswordLength: number
    loginScreen: "form" | "gallery"          // [12 §1.1]
  }        // [09 §4.1]
  log: { level: "silent" | "error" | "warn" | "info" | "debug"; format: "json" }
  index: { rebuildOnStart: boolean }
  sessions: {
    snapshotEveryNTurns: number
    streamKeepaliveMs: number                // [P2 §2.10]
    streamCoalesceMs: number
  }
  limits: {
    maxUploadMb: number
    maxImportUploadMb: number                // [P13.8]
    extensionStorageQuotaMb: number
    contextTokens: number                    // [25 E5]
    reservedCompletionTokens: number
    providerTimeoutMs: number                // [P2C §1.3]
  }
  trash: { retentionDays: number }          // [03 §10.2]
  backup: {                                  // [25 E6], [P12.5]
    frequency: "off" | "daily" | "weekly"
    onStart: boolean
    contents: "full" | "redacted"
  }
  history: { keepPerObject: number }        // [03 §11.3]
  updates: { checkEnabled: boolean; channel: "latest" | "testing" | "nightly" }
  dev: { enabled: boolean }                  // [19 §14]
}
```

| Key | Tier | Default | Note |
|---|---|---|---|
| `dataDir` | `restart` | `./data` | |
| `server.host` | `restart` | **`127.0.0.1`** | Loopback on first boot; the container image inverts it ([09 §5.1](09-server-multiuser-deployment.md)) |
| `server.port` | `restart` | `8080` | |
| `server.trustProxy` | `restart` | `false` | |
| `server.cookieSecure` | `restart` | `false` | `Secure` on the session and CSRF cookies. Deliberately **not** derived from the bind: [09 §5.1](09-server-multiuser-deployment.md) supports plain HTTP on a trusted LAN, and a `Secure` cookie is not sent back over HTTP — so deriving it would lock that install out silently (F10, [P6A §1.4](workplan/19-p6a-alpha-1.md)) |
| `server.clientRoot` | `restart` | `""` | Where the built client is, so one process serves the API and the UI on one port ([P6A §1.3](workplan/19-p6a-alpha-1.md)). Empty means serve nothing, which is what development wants — two processes, Vite proxying `/api`. `/api` is never the fallback: an unrouted address there answers JSON |
| `server.mdnsName` | `restart` | `storyengine` | The `.local` name this install answers to, so nobody types an IP ([09 §5.1](09-server-multiuser-deployment.md)), added at [P10.0](workplan/27-p10-implementation.md). **One key doing two jobs**: the *name*, because two installs in one household collide and the responder probes before it claims — so the second would otherwise go unnamed — and *off*, spelled as the empty string. Advertising is conditional on the bind regardless: §5.1 says *once bound beyond loopback*, and an install only its own machine can reach has nobody to tell |
| `auth.minPasswordLength` | `live` | `8` | The shortest password accepted when one is *set*: setup, an admin creating an account, either reset, a self-change. Never measured at login, and `--reset-password` honours no minimum at all ([09 §5.1](09-server-multiuser-deployment.md)). `0` means the empty string is a password |
| `auth.loginScreen` | `live` | `form` | Which of the two front doors an arrival meets ([12 §1.1](12-account-gallery.md)), added at [P10.4](workplan/27-p10-implementation.md). `form` is the handle-and-password box every install has always shown; `gallery` replaces the handle box with a grid of faces. **The install's choice, never the visitor's**, and `form` is the default for the bind address's reason: a gallery discloses who has an account here, so opening it is a decision with a person attached. The union is load-bearing — the admin config form derives a select from it, so the control ships with the key |
| `log.level` | `live` | `info` | `silent` exists for tests, which build a whole app each ([P2 §1.4](workplan/08-p2-implementation.md)) |
| `log.format` | `restart` | `json` | §4.1. `pretty` is not a value: it would be a second dependency no section here names |
| `index.rebuildOnStart` | `restart` | `false` | The rebuild-from-disk option ([work plan P1](workplan/01-work-plan.md)) |
| `sessions.snapshotEveryNTurns` | `live` | `10` | Generous during alpha ([25 C8](25-open-questions.md)) |
| `sessions.streamKeepaliveMs` | `reconnect` | `15000` | A keepalive is a property of a connection, so an open stream keeps the interval it opened with |
| `sessions.streamCoalesceMs` | `live` | `250` | How long streamed text accumulates before a durable checkpoint. `0` checkpoints every chunk |
| `limits.maxUploadMb` | `live` | `64` | The tier says what the key is *for*; ~~there is no upload route yet and Fastify fixes `bodyLimit` at construction, so it is `unread` today (§4.3)~~ *corrected 2026-09-27:* read on every upload since [P4.1](workplan/16-p4-implementation.md), a file or a folder's total, so `applied`; the only bound on an upload, since Fastify's `bodyLimit` never sees a multipart body |
| `limits.maxImportUploadMb` | `live` | `1024` | The largest archive or SQLite database `POST /api/import/file` takes, added at [P13.8](workplan/30-p13-aventuras-import.md). Those two are landed on disk as they arrive rather than buffered, and this bounds that landing alone; everything else stays under `maxUploadMb`. **A cap of its own rather than a `max()` against `maxUploadMb`**, so it can be *lowered* — below `maxUploadMb` too — and tighten the one upload written to the data volume at any size, which every signed-in account may send. `applied`: read per request, before the body and as it lands |
| `limits.extensionStorageQuotaMb` | `live` | `32` | |
| `limits.contextTokens` | `live` | `8192` | The window a turn may assemble into when the endpoint does not say. A connection may override it, which is the better place ([25 E5](25-open-questions.md)) |
| `limits.reservedCompletionTokens` | `live` | `1024` | Held back for the reply when a call does not say how long it may be |
| `limits.providerTimeoutMs` | `live` | `300000` | How long one call may make **no progress** before the turn abandons it ([P2C §1.3](workplan/12-p2c-first-real-run.md)). Silence rather than duration — a streamed chunk re-arms it — because a multi-minute first token is ordinary on a local runtime and a wall-clock ceiling would kill healthy generations. The resulting failure is `terminal`: it is transient in the ordinary sense, but two retries at the full timeout is three times the hang the key exists to end. `0` disables it |
| `trash.retentionDays` | `live` | `30` | |
| `backup.frequency` | `live` | `off` | The **install's** backup, not anybody's own — a person's schedule is theirs, gated by `scheduledBackups` ([P12.4](workplan/29-p12-implementation.md)) |
| `backup.onStart` | `live` | `false` | Independent of the frequency rather than a value in it: a machine that is usually up but occasionally rebooted wants both, and a single list cannot say so. `unread` in [§4.3](#43-what-a-live-key-actually-does-which-is-not-always-what-its-tier-says) by construction — the boot pass is over before anybody can change it |
| `backup.contents` | `live` | `full` | `redacted` leaves out `accounts.json`, the connections and the session key, and restores to an install nobody can sign into |
| `history.keepPerObject` | `live` | `50` | Pinned versions are exempt ([03 §11.3](03-data-model.md)). `0` keeps every version (2026-09-27; it pruned every unpinned one on each save) |
| `updates.checkEnabled` | `live` | `true` | Disableable in one obvious place ([09 §6.5](09-server-multiuser-deployment.md)) |
| `updates.channel` | `live` | `latest` | |
| `dev.enabled` | `restart` | `false` | |

***Every millisecond key stops at `2147483647`*** (2026-09-27), the longest
delay a Node timer holds. A larger one is not refused: Node warns once and uses
one millisecond, so `streamKeepaliveMs` meant as *effectively never* sent a
comment frame every millisecond and `providerTimeoutMs` abandoned every call at
once. The bound is `TIMER_MAX_MS` in the schema, and it reaches the form with
the others.

***And `providerTimeoutMs` is the only clock a provider call runs under***
(2026-09-27). Every call went through Node's global `fetch`, whose undici
dispatcher gives up on headers after 300 seconds and on a quiet body after 300
more — beneath this key, so a slow local model could not be given longer, and
`0` switched off only the engine's bound. When it fired, *Headers Timeout Error*
read as a connection that did not work and was retried twice. Provider calls now
go through a dispatcher with neither limit (`providers/patient-fetch.ts`), and a
transport timeout from a `fetch` handed in elsewhere is classified as the stall
it is: terminal, and remedied as `endpoint-stalled`.

**The tier annotation is the source, not documentation of it.** The
restart-required notice ([09 §6](09-server-multiuser-deployment.md)) is derived
from this table at runtime rather than hand-maintained, which is the whole point
of [25 D0](25-open-questions.md) — a hand-maintained list of "things that need a
restart" is wrong within two releases.

**No credentials here.** Connections live in `connections/`
([09 §4.5](09-server-multiuser-deployment.md)), and config has nowhere to put a
key — the same structural enforcement as the portable types
([00 §3.2](00-stance.md)).

**Three keys also take an environment variable**
([P6A §1.2](workplan/19-p6a-alpha-1.md)):

| Variable | Key |
|---|---|
| `SE_DATA_DIR` | `dataDir` |
| `SE_HOST` | `server.host` |
| `SE_PORT` | `server.port` |
| `SE_CLIENT_ROOT` | `server.clientRoot` |

These and no others, because these are the keys that decide where the config
file is, whether the process is reachable at all, and whether it serves
anything — everything else can wait for the file it finds. The last of them was
added at [P6A.4](workplan/19-p6a-alpha-1.md) for the reason the list exists: the
config file lives *inside* the data directory, so a container starting on an
empty volume has no file to be configured by. The list is
[P10 §1.2](workplan/27-p10-implementation.md)'s rule made concrete: the
container image binds `0.0.0.0` **by setting `SE_HOST`**, not by being a build
that decided differently, because *a hidden difference between artifacts is a
support burden shaped like a security feature*. The same variable tightens the
bind from a container and loosens it on bare metal.

**And one variable that is deliberately not in that table** — `SE_SUPERVISED`,
added at [P10.3](workplan/27-p10-implementation.md):

| Variable | What it says |
|---|---|
| `SE_SUPERVISED` | Something will start this process again if it exits, so *Restart now* may be offered ([09 §6.4](09-server-multiuser-deployment.md)) |

***It is not a config key and that is the whole reason it is listed
separately.*** A `config.json` travels with a data directory to a machine where
it is false, and a settings page that offered to edit it would be offering to
edit a fact about the environment. It is also not something this process can
detect: nothing inside a container can see its own restart policy, and every
heuristic that looks like it can — PID 1, `/.dockerenv`, a cgroup path — is
equally true of a `docker run` with no policy at all, which is exactly the
deployment §6.4 is warning about. So it is set **beside the restart policy**, in
`compose.yaml` and in the unraid template, and systemd's own `INVOCATION_ID` is
read as the one honest detection. Default-deny: a wrong *no* costs a manual
restart, a wrong *yes* costs the server.

*Amended 2026-09-27.* It is set beside the restart policy in **three** files
now: the tarball's unit declares it too, because detection needs systemd 248.
`INVOCATION_ID` is inherited by everything a unit's process starts, so it counts
only when `SYSTEMD_EXEC_PID` names this process, and **`SE_SUPERVISED=0` is an
answer that outranks the detection**, where it used to be read as unset. The
reasoning is [09 §6.4](09-server-multiuser-deployment.md)'s correction of the
same date.

**Precedence is defaults, then the environment, then the file** — and `--data`
above all three. The file outranking a variable is the part worth stating: the
file is what the settings page writes, so an operator who changed a value in the
UI, restarted, and found a variable had quietly outranked it would be right to
call that a bug. A variable set where the file speaks for the same key is
reported as a warning at startup rather than ignored in silence.

Two smaller rules, both of them about a container. **An empty value is an unset
variable**, because `docker compose` forwards a host variable that does not
exist as an empty string, and treating that as a value would turn *the operator
did nothing* into a refusal to start. **And a bad value is refused by name**:
validation is the same `validateConfigDocument` a file goes through — one answer
to *would this start?* — but its issues are translated from JSON pointers back
to the variable that was typed, so `SE_PORT=99999` reports `SE_PORT`, not
`/server/port`, which is in a file the operator never edited.

***Two amendments, 2026-09-27.*** **The settings write had no environment
layer**: it resolved the next config as defaults then file, so on a container
the config it said would run was not the one a restart ran, and its unedited
Save copied every `SE_*` value it had been shown into the file, where the file's
precedence then held them against the environment for good. It resolves as a
boot does now (`resolveConfigDocument`), and writes a key the file does not set
only when its value differs from what lies under the file. **And the schema is
one answer to *would this start?*, not the whole of it.** A port somebody else
holds, an address this machine lacks, a client root with no build and `Secure`
cookies over plain HTTP all pass it; the write asks the machine too
(`startable.ts`), for the deployment keys that differ from what this process
started with.

### 4.1 The log record

`log.format` had two literals and no meaning behind either. This is the meaning,
written before the first line is emitted, because
[P2 §4](workplan/08-p2-implementation.md)'s gate step 19 asks the log to answer a
question — *a turn was killed mid-flight; reconstruct its lifecycle* — and a log
answers that only if the fields were decided in advance.

**One JSON object per line on stdout.** Not a file: the process does not own its
own destination, because every way of running it already has one — a terminal, a
service manager, a container runtime. A log file would also be the only writer
outside the storage package, against the day-one rule that keeps
path resolution behind one door ([testing §2](workplan/03-testing.md)).

Every line carries `level`, `time`, `msg`. Beyond that, the contract is
**bindings, not prose**: a value a later reader will filter on is a field, never
a phrase inside `msg`. The bindings that matter are the ones that name a subject
someone will grep for — `requestId`, `account`, `sessionId`, `jobId`, `turnId`,
`objectId`, `kind` — and the rule is that a child logger binds them once at the
point the subject comes into existence rather than each call site repeating
them. `jobId` is the one gate step 19 turns on: the turn job binds it when the
job is created ([P2 §2.10](workplan/08-p2-implementation.md)) and every line from
that job inherits it, which is what makes *filter by job id* a complete
lifecycle rather than a sample of one.

Levels mean what an operator would expect, and the boundary that matters is
`warn` versus `error`: **`error` is for what the server could not do**, `warn`
for what it refused. A rejected write, a stale hash, a refused path and an
invalid foreign file are all `warn` — they are the system working. `silent`
exists for tests and is not an operational setting.

**What never appears**: credentials of any kind (there are none here to leak,
which is the point of the paragraph above), portable object bodies (a log is not
a backup and user prose is not diagnostic), and **absolute filesystem paths** —
a path is named relative to the data root, because the log is the thing people
paste into issues.

#### 4.1.1 Foreign paths — the half the rule above did not cover

*Added at P4.0, decided in [P4 §1.3](workplan/16-p4-implementation.md).* The
paragraph above governs paths inside the data root: relative to it, because the
log gets pasted into issues. Import introduces paths that are not inside it at
all — a SillyTavern user directory, a Marinara data root, somewhere on the
operator's disk — and nothing governed those.

**The rule is the same rule, one root over: a source file is named relative to
the sweep root.** In the log, in the review report, and in `VersionRecord.from`.
Never absolutely, and never with the root prefixed back on for readability,
because the reason has not changed — a review somebody pastes into an issue must
not be a description of their filesystem, and *a screenshot of an import that
went wrong* is one of the likelier things to arrive in an issue.

**The root itself is recorded once**, on the import job's own record
(`import_job.root`), where the person who typed it can see it and nobody else
has to. That is the whole exception, and it is deliberate: the operator needs to
know what was swept, and exactly one place should be able to tell them.

Two consequences worth naming, because both are easy to get wrong under
pressure:

- **A file that could not be read is `warn`, not `error`.** §4.1's boundary
  already decides this — `error` is what the server could not do, `warn` is what
  it refused — and a refused foreign file is the system working. The same
  applies to a whole root refused pre-flight ([P4 §1.3]): a live install or an
  unknown storage format is a correct refusal, not a fault.
- **One poisoned file never aborts a sweep**, and one poisoned row never aborts
  a table. F22's original sin was one bad folder aborting a whole scan; that was
  paid for once and is not repeated on the import side. *(2026-09-27: it was, by
  a SillyTavern chat preset whose prompt had a `content` that was not a string,
  which threw out of the converter and out of the sweep. The converters are now
  held to it at the table the sweep and the preview reach them through, and a
  prompt's fields are read as the types they have to be.)*

### 4.2 What a reload does, including when it cannot

`log.level` is the first key re-read live ([P2 §2.2](workplan/08-p2-implementation.md)),
so the reload path stops being hypothetical and needs its failure states stated.
Three, and only the third is the happy one:

- **The file is unreadable, unparsable, or violates the schema.** The running
  config stands, unchanged and complete. The failure is logged at `error` naming
  the file and the reason; nothing is partially applied. A config that fails to
  parse is a typo mid-edit, and a server that reverts to defaults on a typo is a
  server that silently unbinds itself from its port.
- **The file is absent.** On *startup* that is the ordinary first-run case and
  the defaults are correct. On *reload* it is not: a delete or a rename-away is
  an editor mid-save, and treating it as "every key reverts to its default"
  would silently rewrite every setting the operator has — and then report the
  `restart`-tier ones as genuine pending changes. So a reload over an absent
  file keeps the running config and is treated as the first case.
- **The file is valid.** `live` keys apply immediately. `restart`-tier
  differences are collected by `pendingRestart` and surfaced as the
  restart-required notice ([09 §6.3](09-server-multiuser-deployment.md)) — the
  notice is the *only* thing that fires; nothing restarts itself.

**A reload is never triggered by the server's own write.** The settings UI
([10 §15](10-ui-surfaces.md)) writes this file, and the write is atomic, so the
config source must consume the same self-write suppression the object watcher
uses ([P1 §1.4](workplan/07-p1-implementation.md)) rather than reacting to its
own rename.

### 4.3 What a `live` key actually does, which is not always what its tier says

A tier says what a key is **for**. Whether anything reads it *yet* is a separate
fact, and the two are allowed to disagree — `LIVE_APPLIERS`, beside
`CONFIG_TIERS` and keyed the same way, is where the disagreement is recorded.
Each `live` key is `applied` or `unread`, a test fails on a `live` key with no
entry and on an entry for a key that is not `live`, and the table ships to the
client so the settings form can put the `unread` ones in a group that says so.

~~`limits.maxUploadMb` is the standing example. The key names uploads and will
apply live when there is an upload route; there is not one, and Fastify fixes
`bodyLimit` when the instance is constructed.~~ ***The example graduated, which
is the outcome it was chosen to illustrate*** (corrected 2026-09-13). `POST
/api/import/file` shipped at [P4.1](workplan/16-p4-implementation.md) and reads
the key **per request** rather than at construction, so the applier moved from
`unread` to `applied` and [`api.md`](../api.md) says so where the route's `413`
is documented. **Three phases as a live key nobody read, then a reader** — which
is precisely why re-tiering it to `restart` would have been the wrong repair.

*The standing example is now `trash.retentionDays`*, and it is the same shape one
subsystem along: deletion is a move to trash ([03 §10.2](03-data-model.md)) and
the sweep that would honour a retention window is P11's, so the key names a
behaviour nothing performs. Re-tiering it to match today's implementation would
lock the shortcut into the contract, which
[P2 §3](workplan/08-p2-implementation.md) declined for that reason and
[P2A §2.5](workplan/09-p2a-configuration-surface.md) agreed with after its first
draft got it wrong.

**The rule this settles:** where a tier and an implementation disagree, the
appliers table records the disagreement; **the tier moves only when the *intent*
changes.**

This exists because a settings surface that shows a control doing nothing is the
placeholder [work plan §2.2](workplan/01-work-plan.md) forbids, and remembering
which keys are which is not a mechanism. ~~Of the eleven keys tiered `live` at
P2A, five are applied and six are honestly declared unread.~~ ~~**Thirteen are
tiered `live` today; nine are applied and four are honestly declared unread**
(counted 2026-09-13).~~ **Eighteen are tiered `live` today; sixteen are applied
and two are honestly declared unread** (counted 2026-09-29, when
[P13.8](workplan/30-p13-aventuras-import.md) added `limits.maxImportUploadMb`,
applied from the start). *The direction of travel is the point rather than the
figures* — the table was designed so that a key acquiring a reader is a one-word
edit and a visible one, and two phases of ordinary work moved four keys across
it without anybody re-tiering anything.

**Two repairs P2A made so the table would not be mostly lies.**
`applyLiveConfig` replaced the running config object rather than assigning into
it, so the runner, the budgeter and the library context — each holding *that
object* — kept reading a record the server had stopped using; six `live` keys
could not change on a running server for that reason alone. And the
restart notice computed its delta against the running config and then moved it,
so it was right exactly once. It is now `pendingRestart(bootConfig, config)`,
derived per request from the config this process *started* with, which is what
makes it self-healing: change a value, change it back, and the notice clears.

---

## 5. Index invariants

The index has no schema here on purpose: it is derived, disposable, and its
tables are an implementation detail. What is *not* an implementation detail is
what must be true of it.

- **Rebuild-from-disk equals incremental.** The CI assertion from
  [work plan P1](workplan/01-work-plan.md), and now sharper because there are two producers to
  agree ([03 §5.1.1](03-data-model.md)).
- **Read-after-write for the server's own writes.** A `GET` after a `POST`
  reflects it. Foreign writes have no such guarantee and need none.
- **Nothing is answerable only from the index.** The test in
  [03 §5.1](03-data-model.md): if a feature cannot be reconstructed from disk,
  it is storing data in the wrong place.
- **Turn text is indexed on write**, not lazily ([19 §7.1](19-tech-stack.md)),
  and rows off the current path stay indexed but carry their branch
  ([10 §14.2](10-ui-surfaces.md)).
- **Deleting `index.sqlite` is a non-event.** Startup notices and rebuilds.
  *Added 2026-09-27:* and so are the two ways of losing it without deleting it.
  A file that is not a database any more is set aside as `index.sqlite.damaged`
  and a fresh one opened, where it used to stop the start; and the schema
  version is written when a rebuild **finishes**, not when the empty tables are
  made, so a first start killed partway through its scan rebuilds again rather
  than serving the fraction it reached for good.
- **A start that does not rebuild checks.** *Added 2026-09-27.*
  [03 §5.1](03-data-model.md)'s start-up consistency check, which no start
  ran until then: an object is read again when its size or time differs from
  its row's, or when it has an error on record, and a row whose file is gone is
  forgotten; a session is derived again when a stamp over `session.json` and its
  segments differs from the one the last look recorded. Its answer is held to a
  rebuild's, as the watcher's is, over randomised changes made with nothing
  watching (`index-db/reconcile.test.ts`).

### 5.1 Operational state is not derived, and must not live in the index

The index's defining property is that deleting it costs time and nothing else.
Anything for which that is false does not belong in it — and three things had
been put there or implied into it:

| State | Why it is not derived |
|---|---|
| **Auth sessions** | [19 §9](19-tech-stack.md) put session records "in the index database". Deleting the index would log every user out — recoverable, but it is not a non-event, and it means the index is not disposable after all. |
| **Notification inbox** | "Persist until seen" ([09 §3.2](09-server-multiuser-deployment.md)) is a durability claim. A notification lost to a rebuild was never durable. |
| **Jobs and idempotency keys** | A turn in flight, and the keys that stop a retry charging twice, are facts about work — not restatements of anything on disk. |
| **In-flight turn drafts, and sequenced progress events** | The live turn *during* execution ([P2 §2.10](workplan/08-p2-implementation.md)). The JSONL segment is append-only and terminal-only ([03 §5.5](03-data-model.md)), so the draft's only consistent home is here; event rows carry the reattach cursor and are prunable once the terminal turn exists, because the turn record is their durable meaning. |

**So: a small operational store, separate from the index**, at
`/data/state/state.sqlite`. It is authoritative, it is backed up, and it is *not*
rebuildable — which is exactly why keeping it out of the index matters. Both are
SQLite; the distinction is what happens when you delete them.

*Small because it is pruned, which it was not until 2026-09-27.* The draft and
event rows the table above calls prunable are collected a day after their job
finished, and idempotency keys a week after, by `state/prune.ts`; a session's
latest job is kept while the session is there. [P2 §2.10](workplan/08-p2-implementation.md)
has the rule.

**Auth may not need it at all.** Signed stateless cookies with a short lifetime
and a server-side revocation list ([19 §9](19-tech-stack.md)) reduce this to a
small denylist rather than a session table, which is the cheaper answer for a
household. The store is still wanted for jobs and notifications.

The general rule, since the operational surface will grow: **if losing it would
surprise a user, it is not derived.** The index holds restatements of what is on
disk; anything else has its own home.

**What the split cost, now that both exist** (P2.3). Three differences fell out
of the rule rather than being chosen separately, and they are the whole of why
this is a second database rather than four more tables:

| | `index.sqlite` | `state.sqlite` |
|---|---|---|
| Schema change | drop everything, rescan | stepwise migration, may not drop |
| `synchronous` | `normal` — a lost transaction is a rescan | `full` — a lost transaction is a double charge |
| A version from the future | rebuild over it | refuse to open |

The `full` fsync is affordable only because streaming deltas **coalesce** into
checkpoints ([P2 §2.10](workplan/08-p2-implementation.md)); a durable transaction
per token would make this the wrong trade.

---

## 7. `Rendition`

*Added 2026-09-16, built at [P9.0](workplan/26-p9-implementation.md).*

[06 §10.1](06-modes-and-turn-pipeline.md) gives the interface and was **the only
place in the corpus that had it**: not in [04](04-schemas.md), which owns
portable objects; not here, which owns internal ones; not in
[03](03-data-model.md), which owns what is on disk. Six phases of design referred
to the type and none wrote it down — the same shape of gap
[P2B §1](workplan/10-p2b-provider-configuration.md) found for the missing
fallback layer, and the reason P9's first stage is a contract rather than a
feature.

**Admitted by §6's own rule**: something is built against it and it never leaves
the install. So §6's table gains no row — the rule is the admission.

```ts
interface Rendition {
  schema: "storyengine.rendition/1"
  id: string
  sessionId: string
  turnId: string
  createdAt: string
  kind: "image" | "video" | "speech"        // how it is made. One value ever written
  purpose: "illustration" | "background"    // what it is for. Both built
  scope: { messageId?: string; anchor?: string } | null
  state: "pending" | "ready" | "failed"
  /** Never null once the record exists — see below. */
  prompt: AssembledPrompt
  /** Null while pending, and null once evicted. §10.7 */
  asset: RenditionAsset | null
  provenance: RenditionProvenance
  /** A class, never the endpoint's words. §1.4's rule. */
  error: "transient" | "retryable" | "terminal" | "interrupted" | "no-binding" | null
  /** The reuse key: the fragments as sent, plus the resolved binding. */
  digest: string
  /** What the count judgement will sort on. Always 0 at 1.0. */
  ordering: number
  /** The anchor did not occur in the message. Absent means it did. */
  anchorResolved?: false
  /** Where this record came from, when an import brought it. Turn.foreign's shape. */
  foreign?: { source: string; id: string }
}
```

**`foreign` is the one field added after the freeze**, and it is an addition
rather than a migration for [P11.10](workplan/28-p11-implementation.md)'s
reason — *a promise not to tighten*. It arrived 2026-09-27, when session import
started writing the rendition records an export carries instead of counting
them and dropping them. §7.1's *"the recipe travels and the pixels do not"* was
always a rule about the file; the recipe was never meant to stop at the
importer. An imported record keeps its id (a rendition id is its turn's, and turn
ids are kept), takes the new session as its `sessionId`, arrives with
`asset: null` — or, from a backup archive, with the bytes the archive holds for
it, as a bare file name in the session's `assets/`, under an image type, and
described by their own digest — and a `pending` one arrives `failed` with
`error: "interrupted"`, since no job anywhere will finish it. Because the same
id can exist in two sessions of one install — copies imports made before a
session already here was refused, or a session deleted and imported back while
its job rows stayed — the rendition job table is keyed by session and id
together (`STEPS[7]`).

**Three fields of [06 §10.1]'s sketch are typed differently here, and each is a
correction rather than a preference.**

***`provenance` is not `GeneratedFieldProvenance`.*** That type ships in
`schema/common.ts` and cannot carry the recipe: its `seed` is documented *"the
input the generation ran from"* — a prompt string — where §10.7 means the
**sampling seed**, which it calls *"the load-bearing field here, and the one an
implementation is most likely to drop as uninteresting"*; and it has no field for
workflow parameters at all. The two readings of `seed` are one word apart, so an
implementation that reused the type would satisfy it, pass review, and ship a
rendition that cannot be reproduced. **And widening it would be the worse
repair**: it is portable, reachable from five emitted schemas through
`GeneratedMap`, so a sampling seed added to it travels inside every exported
actor card — production settings crossing into shareable content, which is the
line [00 §3.2](00-stance.md) draws.

```ts
interface RenditionProvenance {
  at: string | null                                            // null while pending
  binding: { connectionId: string; modelId: string } | null    // the id, never the connection
  answeredAs: string | null
  /** The sampling seed. A **number**, which is what makes it unmixable with the other reading. */
  seed: number | null
  /** Scalars only: these are re-sent verbatim and hashed, and a nested object needs canonicalising. */
  workflow: Readonly<Record<string, string | number | boolean>>
}
```

***`asset` is not an `AssetRef`.*** Three things are wrong with that type here,
and the first is the one that would have been lived with: `MediaRole` has eight
members and **none of them is `illustration`**, so a picture of a moment filed
under it would carry a role that is either a duplicate of `purpose` or a lie. It
also carries no `mime`, which is the one thing the asset route must answer with;
and it is portable, so widening `MediaRole` for an internal record is a published
-schema change bought with nothing. What is kept rather than inherited is its one
genuinely good rule — a relative path that never escapes its folder.

```ts
interface RenditionAsset {
  path: string        // relative to sessions/<id>/assets/
  mime: string
  bytes: number
  digest: string      // sha256:<hex> over the bytes. The etag.
}
```

***`prompt` is never null***, where §10.1 has it nullable. A `pending` rendition
whose prompt were null would be a record that cannot be re-run, so *the recipe
outlives the pixels* would be false during exactly the window in which the pixels
do not exist — which is the window an interrupted job leaves a record in. The
record is written after assembly and before dispatch, so there is no moment at
which the field is empty.

`AssembledPrompt` is the type [06 §10.1] names and nothing defined — one
occurrence in the whole corpus, the line that names it. It is `CappedPrompt`
([19 §5.3](19-tech-stack.md), and `providers/prompt-caps.ts` since P2) **plus the
input the cap ran over plus the separator**:

```ts
interface AssembledPrompt {
  /** Every fragment offered, ranked. Includes the ones `dropped` names. */
  fragments: { id: string; text: string; rank: number; required?: boolean }[]
  separator: string
  budget: { maxChars: number | null; usefulChars: number | null }
  text: string                     // as sent
  kept: string[]                   // fragment ids, in kept order
  dropped: { id: string; rank: number; reason: "over-hard-cap" | "over-useful-cap" }[]
  overCap: boolean
}
```

**`fragments` is the field that makes the phase's central property expressible**,
and the one an implementation would drop as a duplicate of `text`. It is not:
`CappedPrompt.kept` is a list of *ids*, so a record storing only the outcome could
name what it dropped and never reproduce the input. [06 §10.3] requires the
moment — the one fragment with an author — to be *"written once… and **replayed**
on re-creation, never asked for again"*, and [25 E3](25-open-questions.md) gives
the consequence: *"re-creating an evicted rendition makes no text call at all."*
The property, stated where the shape is: **`capPrompt(fragments, budget,
separator).text === text`, for every rendition, forever.**

*`budget` is `number | null` where `PromptBudget` is `number | undefined`,
because this is a stored record and `undefined` does not survive JSON. One
conversion each way, in one function, so the encodings cannot drift.*

### 7.1 Where it lives, and when that changes

**Internal tier, in `packages/shared/src/rendition.ts` beside the turn record**,
and governed by that module's own sentence: *"Session export ([25 B12]) is the
event that ends this freedom — the day a stored turn becomes a portable artefact,
these graduate to `schema/` and the registry, and not before."* A rendition hangs
off a turn and travels with the session directory, so it is that sentence's case
rather than a new one.

**Which is P9's answer to P11, and it owed one.**
[P9 §1.1](workplan/26-p9-implementation.md) leans internal and then says the lean
cannot be left indefinitely because export ships at 1.0. The answer: **the recipe
travels and the pixels do not** — `prompt` and `provenance` are bytes and an
`asset` is megabytes, which is §10.7's own arithmetic — and a rendition graduates
*with* the turn record, by one migration. Anything else makes exporting a turn and
exporting its pictures two events.

*The `schema` tag is not a contradiction of the tier.* It marks the **file**, so
a reader can tell a rendition from whatever else is in that directory — the
discipline `Snapshot` and `SummaryLink` already follow, and a different thing
from a `$id` in a published registry. `tools/repo-shape.test.ts` holds the tier
claim mechanically: the type is outside `schema/`, absent from the registry, and
the emitted set stays at six.

### 7.2 What the turn record keeps

A turn keeps **what it asked for** and never the records:

```ts
interface RenditionReport {
  requested: string[]                                   // ids, in the order the step emitted them
  reused?: { renditionId: string; digest: string }       // a backdrop resolved rather than paid for
  held?: "place-unchanged" | "no-moment" | "no-binding"  // why nothing was asked for
}
```

**The split is forced rather than argued**, and it is the one place a rendition
differs from every other thing a step produces. `turns/suggest.ts` names the fork
at [P7.9](workplan/23-p7-implementation.md) — *"turn segments are append-only and
never rewritten, so suggestions generated after a turn commits cannot be added to
its record"* — and takes the on-the-turn arm because a suggestion is produced
*during* the turn. A rendition is the one thing in this build produced *after*,
and its `state` then moves `pending → ready`, which a line that is never rewritten
cannot express. So the report is on the turn and the record is beside it.

*`held` is what keeps the empty list a real answer* ([06 §10.4]): a quiet turn and
a session with renditions off are different facts, and `Turn.renditions` being
absent altogether says the second. The hook selector's `nothing-eligible` draws
the same line for the same reason.

---

## 8. `Notification`

*Added 2026-09-16, built at [P10.1](workplan/27-p10-implementation.md).*

[09 §3.4](09-server-multiuser-deployment.md) names the fields a notification
needs — class, server-side target, `actionable`, a `{ key, params }` summary, a
dedupe key and a coalescing window — and says why they have to be right on the
day the first producer ships: *"trivial to design in and unpleasant to add once
producers exist."* What it does not give is the **record**, and §5.1 above has
been promising this one a durable home since P2.3.

**Admitted by §6's rule**: four producers are built against it and it is not a
portable object — no `schema` field, no export, no import. It is a row in
`state.sqlite`, which is exactly where §5.1's *"persist until seen is a
durability claim"* puts it.

```ts
type NotificationClass =
  | "turn.complete"        // a turn committed
  | "turn.failed"          // a turn ended on a class the person did not choose
  | "artifact.ready"       // a rendition settled — ready or failed, see below
  | "system.notice"        // an install-level warning; no session, no turn

interface Notification {
  id: string
  /** The **person**, resolved server-side from ownership — never from a request. */
  account: string
  class: NotificationClass
  /** Whether there is something to do. Fixed per class, except where noted. */
  actionable: boolean
  /** What a `{ key, params }` summary is composed from. No English (19 §12.5). */
  params: Record<string, string | number | boolean>
  sessionId: string | null
  turnId: string | null
  /** What two of these count as one. Chosen by the producer. */
  dedupeKey: string
  /** How many arrivals this row stands for. One unless something coalesced. */
  folded: number
  createdAt: number
  updatedAt: number
  readAt: number | null
}
```

**Four classes, not [09 §3.5](09-server-multiuser-deployment.md)'s six**, and the
absences are decisions rather than omissions —
[P10 §1.4](workplan/27-p10-implementation.md)'s *every class either has a
producer or is not shipped*. `turn.awaiting-input` is conditional on
[25 C5](25-open-questions.md)'s suspending step, which four phases did not
produce; `message.received` arrives with Messages, which
[24 §3.4](24-roadmap.md) leaves unscheduled.

***`folded` is the field that makes the fold a fold rather than a replace.***
[09 §3.4]'s example is *"five characters replying in a group chat is one
notification, not five"*, and **a replace also yields one row** — so the count is
what distinguishes *five people replied* from *somebody replied, and we told you
about the last one*. The window runs from the last arrival rather than the first,
so a trickle keeps folding instead of splitting at a boundary nobody chose; and
nothing folds into a row whose `readAt` is set, because that person has already
been told and the next arrival is news.

***`actionable` is a property of the class except where the class cannot know.***
Two of the four are constants — a completion never needs acting on and a failure
always does — which is what stops two producers eventually disagreeing. The other
two vary with the **occasion**: a `system.notice` varies with what the notice is
about, and an `artifact.ready` varies with whether the picture arrived, because a
failed one has a retry behind it. *`artifact.ready` carries its outcome in
`params` rather than splitting into a fifth class*, which is
[09 §3.5](09-server-multiuser-deployment.md)'s own reason for choosing that name
over `rendition-ready`: so its second instance would not require renaming it.

---

## 6. What is deliberately still absent

| Structure | Why not here |
|---|---|
| Preset internals beyond [04 §8](04-schemas.md) | Portable; 13 owns it |
| ~~`InitPolicy`, `WidgetSpec`~~ | ~~Want the mode contract built first~~ **Both arrived, 2026-09-13.** The contract is `packages/sdk`, shipped at [P7.0](workplan/23-p7-implementation.md); both types shipped at P7.1, one stage later. §1.3 carries `InitPolicy`; `WidgetSpec` has three consumers — `ChannelDefinition.surface`, `SurfaceContribution.widget` ([P7.11](workplan/23-p7-implementation.md)) and the session read's renderer — so the admission rule below is met twice over. **This row was quoted as live by [06 §4](06-modes-and-turn-pipeline.md) and by the SDK's own docstring**, which is why it is struck rather than deleted: the deferral was right, it expired, and the documents that leaned on it have to be able to see that |
| Rule vocabulary (`Predicate`, `Effect`) | 6.0, the authoring tier ([work plan §0.6](workplan/01-work-plan.md)) |
| The SSE wire format | [09 §3.3](09-server-multiuser-deployment.md) has the event list; the encoding is a transport detail |
| Extension `HostApi` | [22 §4](22-extensions.md) owns it |

**The rule for adding to this document:** a type belongs here when something is
*built against it* and it never leaves the install. A type that only one module
uses belongs in that module.

***And the rule is what retired the row above rather than a decision to retire
it*** (2026-09-13). Both types acquired consumers at P7.1, which is the condition
this paragraph states; the table row stayed for fifteen stages because nothing
re-read it. **A deferral list is a claim about the present tense and goes stale
like any other** — the same failure §1.3's own preamble was added to prevent one
section down.
