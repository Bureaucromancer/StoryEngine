// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * What a channel declares about itself —
 * [22 §1.3](../../../docs/design/22-internal-contracts.md).
 *
 * ~~**Deliberately short of the documented type**, and the absences are a
 * schedule rather than an oversight. `schema`, `init: InitPolicy`, `migrate`
 * and `surface?: WidgetSpec` are all specified and none is here.~~
 *
 * **`schema` and `init` arrived at [P7.1](../../../docs/design/workplan/23-p7-implementation.md)**,
 * which is the stage
 * [22 §6](../../../docs/design/22-internal-contracts.md) was waiting for: it
 * defers `InitPolicy` and `WidgetSpec` on the grounds that they *"want the mode
 * contract built first"*, and that contract is this package. Designing them
 * before it existed would have been the one thing worse than leaving them out —
 * a shape other code starts depending on before the section that owns it exists.
 *
 * **Still absent, and still a schedule**: `migrate`, which [22 §1.3] makes
 * optional and which [06 §4.2] wants only for *"the genuine minority"* of schema
 * changes, so it acquires a consumer or it does not arrive; and
 * `surface?: WidgetSpec`, which is the HUD half of [10 §8]'s vocabulary and a
 * different thing from `schema` — this one says what the value *is*, that one
 * says how it looks.
 *
 * **Moved out of the engine at [P7.0], and that move is what dissolves a cycle
 * the engine had been routing around.** `sessions/channels.ts` used to declare
 * this type *and* `CLOCK_CHANNEL`, and said why in as many words — the clock's
 * definition lives engine-side because `retrieval/timing.ts` needs the type and
 * a mode importing the value while the engine imported the mode would be a
 * `const` cycle and a TDZ `ReferenceError` at load. With the type in a third
 * package that neither imports, a mode can declare its own channels and the
 * engine can read them, and nothing has to be defined in the wrong place to
 * avoid a loop.
 */
/**
 * Where a channel's value comes from before anything has changed it —
 * [06 §4](../../../docs/design/06-modes-and-turn-pipeline.md)'s *"literal
 * default, from treatment, or generated at start"*, built at
 * [P7.1](../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **Two arms of the three, and the third is deferred for a reason that is not
 * "no consumer yet".** A *generated* init means a draw or a call at session
 * start, and session start is not a turn: the RNG tape is keyed
 * `site:purpose#index` and lives on a turn record
 * ([20 §14.6](../../../docs/design/20-tech-stack.md)), so a value drawn before
 * the first turn has nowhere to be recorded — and replay-from-zero, which
 * [07 §4](../../../docs/design/07-branching.md) makes a CI assertion, could not
 * reproduce it. The two arms below are pure functions of declarations the
 * session already stores, which is what makes them replay-safe for free.
 *
 * So *generated* is not one more arm on this union. It is **init becoming a
 * recorded effect** on the first turn that needs the channel, which is a
 * mechanism rather than a case, and the day something needs it that is the
 * change to make. Stated here rather than discovered then, because 06 §4 names
 * three arms and a published type that silently ships two is the divergence
 * [P7.0] spent a commit correcting elsewhere.
 */
export type InitPolicy =
  /** The value a channel starts at, written into the declaration. */
  | { kind: 'literal'; value: unknown }
  /**
   * An advisory value the author wrote down, wherever they wrote it.
   *
   * **`authored` rather than `treatment`, though 06 §4 says "from treatment".**
   * [04 §6.1b](../../../docs/design/04-schemas.md) settles where such a value
   * may be written and the answer is both: *"a Treatment proposes, a Setup
   * overrides, and the running session owns it"*. A name that said `treatment`
   * would be wrong the first time a Setup won, and a published name is
   * expensive to correct.
   *
   * `fallback` is what an unauthored session gets, and it is required: absent
   * means *unspecified*, which 04 §6.1b is explicit does not mean the middle
   * value of the range. The channel says what unspecified resolves to.
   */
  | { kind: 'authored'; field: string; fallback: unknown };

/**
 * How a channel appears in the HUD — [10 §8](../../../docs/design/10-ui-surfaces.md),
 * built at [P7.1](../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **Declared, never shipped.** 10 §8 settles this and calls it *"what decouples
 * the frontend framework choice from everything else"*: extensions do not ship
 * UI components, they declare widgets from a versioned vocabulary the host
 * renders. That buys three things — an extension cannot break the app's
 * rendering, the frontend framework stays a reversible decision, and an
 * extension written today still works after a framework upgrade.
 *
 * **One arm, and the count is the honest minimum rather than a placeholder.**
 * P7.1's brief is *"the minimum of the declarative widget vocabulary… no
 * extension-shipped components, now or later"*, and a vocabulary is only worth
 * the arms that have a subject: the clock is the shipped channel, and it is
 * text. A `meter` with `min` and `max` is the obvious second — Aventuras'
 * `RuntimeVariable` carries exactly that — and it arrives with the first numeric
 * channel rather than ahead of one, which is the same rule `InitPolicy`'s third
 * arm is held to.
 *
 * **The paired commitment matters more than the deferral**, and 10 §8 says so:
 * deferring the iframe escape hatch is only honest if this keeps growing. *When
 * an extension cannot express something, the first response is to ask what
 * widget would let it — a gauge, a grid, a small table, a timeline, a picker —
 * and add that.*
 *
 * **What must never happen is an `html: string` field.** 10 §8 names it: *"that
 * is the escape hatch arriving without any of the safety, and it is how this
 * decision would be undone by accident rather than on purpose."*
 */
export type WidgetSpec =
  /**
   * A short value, read. The clock is the shipped one.
   *
   * ~~**An interface with one literal rather than a union today**, which becomes
   * a union the moment there is a second arm.~~ ***It did, at [P7.11]*** — and
   * the shape the docstring promised is the shape it took: additive, because a
   * declaration naming a `kind` the host does not know is one the host can
   * ignore rather than one that breaks it.
   */
  | { kind: 'text'; label: string }
  /**
   * ***A picture*** — [06 §7.2], [06 §10.1a], added at [P7.11].
   *
   * **The arm a backdrop and a sprite both needed, and neither could have.**
   * §7.2 has described Scene as *"staged scene, optional background and
   * sprites"* since the first draft; what was missing was not the channel — it
   * ships — but any way for a mode to say *this value is a picture, show it*.
   *
   * *What crosses the wire is a URL and an alt text*, which is the same posture
   * `text` takes: the server resolves the channel's {@link MediaSelection} the
   * way it renders a template, and a browser is handed something to display
   * rather than something to interpret. A client that resolved a media
   * reference itself would be a second implementation of the manifest living in
   * a browser.
   *
   * *No dimensions and no fit.* Where a picture goes and how big it is are the
   * region's business, not the declaration's — [10 §2.3] settles it for the one
   * region that exists: a backdrop is *chrome*, *"the first thing to go"* on a
   * phone. A mode that could specify a height could break the layout, which is
   * the whole thing 10 §8 is preventing.
   */
  | { kind: 'image'; label: string }
  /**
   * ***A boolean somebody can change*** — added at [P7.11], and it is the
   * vocabulary's **first writable arm**.
   *
   * **Everything before this was a readout.** A channel could say *here is the
   * time*; nothing could say *here is a switch*. [P7.9] left two controls as
   * hand-written client components for want of this, and `turns/suggest.ts`
   * says so in as many words: *"no `surface` yet: the control belongs beside the
   * suggestions, and that is a layout a mode cannot declare until `surfaces` is
   * built."*
   *
   * ***Writable does not mean the widget writes.*** It renders a control; the
   * write goes through `PUT /sessions/:id/channels/:key`, which already refuses
   * a channel the session's mode does not own and already records the result as
   * an effect. So a mode gains a control and gains no new authority — the
   * policy that decides whether a person may set this is still the channel's
   * own `update`, and a `toggle` over an `engine-computed` channel produces a
   * recorded refusal rather than a change.
   *
   * *Boolean and nothing else, which is the honest minimum again.* A `choice`
   * is the obvious next arm and it wants a vocabulary to choose from — the
   * dials' levels come from the prompt pack rather than from the channel's
   * schema, so the arm that serves them is a different shape and should be
   * designed against them rather than ahead of them.
   */
  | { kind: 'toggle'; label: string }
  /**
   * ***A stat bar*** — [P14 §1.9.2](../../../docs/design/workplan/31-p14-scene-and-session-import.md),
   * added at [P14.5a], and it is [10 §8.0]'s *"a `meter` arrives with the
   * first numeric channel"* arriving.
   *
   * **Over a number, or over a value that carries its own ceiling.** A plain
   * number is bounded by the declaration (`min`, else 0; `max`); a
   * `{ value, max }` is bounded by itself, which is Marinara's `CharacterStat`
   * and the shape every tracker stat is — a character's health has a ceiling
   * the story sets, not one the mode could know when it was written. The
   * trackers' stats are rows of a {@link RecordField} `meters` field rather
   * than channels of their own, and the host draws both with one bar, so the
   * arm and the field are one thing seen from two sizes.
   *
   * *A readout, never a control*: a bar dragged to a value is a number edited,
   * and the record's editor is where a number is edited.
   */
  | { kind: 'meter'; label: string; min?: number; max?: number }
  /**
   * ***A structured value, read and edited field by field*** — [P14 §1.9.2],
   * added at [P14.5a]. *"Which is new here."*
   *
   * **The fields are declared, not inferred from the schema.** A JSON Schema
   * says what a value may be; it does not say that `stats` is a row of bars,
   * that `objectives` is a checklist, or which of eight strings a person reads
   * first — and a host guessing presentation from `type: 'array'` would be the
   * second description of a value that 10 §8 exists to prevent a mode shipping
   * as code. So a record names each field and how it is shown, from a small
   * closed vocabulary ({@link RecordField}), and a field whose `show` the host
   * does not know is skipped, as an arm is.
   *
   * ***`locks` and `hidden` name channels, and that is the whole of the per-field
   * affordances.*** Each is the id of a set-valued channel of field paths
   * (`<channel key>/<JSON Pointer>`, a list row addressed by its `name`); the
   * host offers *lock* and *hide* on each field and writes the set through the
   * ordinary channel route, so what a lock *means* stays the mode's — the
   * trackers write a locked field back before proposing — and the widget only
   * says where the set lives. Absent, the field has neither control.
   *
   * *Editing is the channel write every widget uses*: the whole value, changed
   * at one field, through `PUT /sessions/:id/channels/:key` — an engine turn
   * with a `user` effect, branch-correct and undoable, and still refused by the
   * channel's own `update` policy where it refuses.
   */
  | {
      kind: 'record';
      label: string;
      fields: readonly RecordField[];
      locks?: string;
      hidden?: string;
    };

/**
 * ***One field of a {@link WidgetSpec} `record`*** — [P14.5a].
 *
 * `key` is one property of the value, or `''` for **the value itself** — JSON
 * Pointer's own spelling of the whole document — which is how a record shows a
 * channel whose value is a list (the quests, the custom fields).
 *
 * `show` is how, and each is a shape the host knows how to read and edit:
 *
 * - `line` — a short string. `number` — a number. `flag` — a boolean.
 * - `lines` — a list of strings, newest last.
 * - `pairs` — rows of `{ name, value }`; `map` — an object of name to string.
 *   A person may add and remove rows; *which names exist* is theirs to say,
 *   which is the custom tracker's whole contract.
 * - `items` — rows of `{ name, qty? }`.
 * - `meters` — rows of `{ name, value, max, color? }`, each a {@link WidgetSpec}
 *   `meter`.
 * - `checklists` — rows of `{ name, stage?, objectives: [{ text, completed }],
 *   completed }`, each objective a box a person can tick.
 *
 * *Closed, and grown the way the arms grow*: a field no `show` here can say is
 * a reason to add one — [10 §8.1]'s *"ask what widget would let it, and add
 * that"* — never a reason for a mode to ship a component.
 */
export interface RecordField {
  key: string;
  label: string;
  show: 'line' | 'number' | 'flag' | 'lines' | 'pairs' | 'map' | 'items' | 'meters' | 'checklists';
}

/**
 * ***Part of what the story has established*** —
 * [P14 §1.9.2](../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * declared at [P14.5a].
 *
 * A channel carrying this is rendered by a preset's `{ of: 'state' }` slot:
 * every such channel, every scoped key of it, through its own {@link
 * ChannelDefinition.render}, as **one** block headed *what the story has
 * established*. That is Marinara's committed tracker context
 * (`committed-tracker-context.ts:299`) as a declaration: a mode says which of
 * its channels are facts the prose has settled, and the pack says where they
 * go.
 *
 * **A declaration and not a list in the engine**, which is the only way it
 * could be: the trackers are Scene's channels, the collector is engine code,
 * and engine code does not name a mode's content. The existing `{ of:
 * 'channel' }` slot reads one unscoped key, so six of them would still leave
 * each present character's state out — scoped values are the point.
 */
export interface EstablishedState {
  /** The heading the value goes under — authored content, like a widget's label. */
  label: string;
  /**
   * ***The switch this channel waits on***: the id of a boolean channel whose
   * value must be `true` for this one to be rendered anywhere — the state
   * block, and the other channel digests the engine builds.
   *
   * *A switched-off tracker says nothing*, including what it said while it was
   * on: its values stay on the tree, so switching it back on resumes rather
   * than restarts, and until then the prompt is the one a session that never
   * had it would send. Absent means always rendered.
   */
  enabledBy?: string;
  /**
   * ***What this block already says in a channel of its own*** (2026-09-30): the
   * ids of channels whose **prompt slots** stand aside while this one is
   * switched on.
   *
   * Scene's world tracker keeps a model-written date, time and place, and
   * Scene's pack also tells the narrator the engine's clock and the stager's
   * place. Two clocks that disagree are worse than either, so while the
   * tracker is on the narrator hears the tracker's. *Only a slot stands aside*:
   * the channel's surface still shows it and a backdrop is still drawn from
   * it, since neither is the prompt the two would contradict each other in.
   * Declared by the tracker rather than listed by the engine, the rule that
   * keeps a mode's content out of engine code. Absent means nothing stands
   * aside.
   */
  supersedes?: readonly string[];
}

export interface ChannelDefinition {
  id: string;
  /**
   * Who owns this channel — a mode, an extension, or a package
   * ([06 §4.1](../../../docs/design/06-modes-and-turn-pipeline.md)).
   *
   * Accepting a package id from the first channel definition written is one of
   * two things §4.1 says 1.0 owes, because widening it afterwards is a
   * migration over every stored channel. It is already exercised: the
   * retriever's timing channel is owned by `storyengine.lore`, which is a
   * package and not a mode.
   */
  owner: string;
  version: number;
  /**
   * What one value is *about*, and therefore what a scoped key names.
   *
   * *`hook` joined the three at [P7.5]*, for the firing state [P7 §1.5] moved
   * out of the session file before it was ever in one: *"a flat set does not
   * branch"*, and per-hook state keyed the way per-entry and per-actor state
   * already are costs no new concept. ***`goal` joined at [P7.6]***, for the
   * reason [06 §7.3.3] gives in one sentence — *"progress is a channel"* — and
   * because [06 §7.3.4] wants a completed goal *"retained with the turn that
   * completed them"*, which is what a per-goal key on an effect log is and what
   * a field on a session record is not.
   *
   * ***`book` joined at [P8.2]***, for the reason the two before it did and with
   * one of its own: a session plays with more than one character, so *what this
   * turn wrote into which memory book* is a fact about a book, and a
   * session-scoped value would have to be a map keyed by book to say it — which
   * is what a `scopeKey` is. The alternative, `entry`, is the scope of the
   * **things written** rather than of the place they went.
   *
   * **Nothing reads this mechanically** — the key is composed from whatever
   * `scopeKey` an effect carries — so it is a declaration, and widening it is a
   * widening of what a mode may honestly say about itself.
   */
  scope: 'session' | 'actor' | 'entry' | 'hook' | 'goal' | 'book';
  /**
   * ***Whether writing this channel reaches outside the session*** —
   * [07 §7](../../../docs/design/07-branching.md), [P8 §1.9], [P8.2].
   *
   * 07 §7 classifies an **escaped effect** as one branching cannot un-write: a
   * lorebook entry promoted to the shared library, a file on disk, a message
   * sent. P6 shipped the whole mechanism for them — `ChannelEffect.scope`, the
   * four readers that skip a replay, the abandoned count on `moveHead` — and
   * then `acceptEffect` **hard-coded `scope: 'session'`**, so nothing could ever
   * be one. P6's own comment said so: *"P2 writes only `session`; the field
   * exists so P6 needs a field rather than a migration."*
   *
   * **The declaration is the right home and a step's proposal is not**, which is
   * the correction: whether an effect escapes is a fact about *the channel* —
   * about what writing it does in the world — and a step that could claim its
   * own writes were session-local would be one honest declaration away from
   * making a branch look reversible when it is not. So it is declared once,
   * beside the channel, and read by the engine.
   *
   * **Absent is `false`**, which is every channel written before this and is
   * what all of them mean: a clock, a trust level and an entry's timing are
   * session state, and rewinding past them genuinely does un-write them.
   */
  escapes?: boolean;
  update: 'model-proposed' | 'engine-computed' | 'user-only';
  visibility: 'player' | 'hidden';
  /** Tokens the channel may spend when rendered into a prompt. Null for none. */
  budget: number | null;
  /**
   * The state shape, as JSON Schema — [06 §4.2], [26 B7], built at [P7.1].
   *
   * **Required rather than optional, which is 06 §4's own shape and not a
   * tightening.** A channel without one cannot be validated, so it cannot be
   * coerced, migrated or quarantined either — the whole
   * validate-coerce-migrate-quarantine ladder is downstream of this field
   * existing. Making it optional would make the ladder optional, and the ladder
   * is what keeps *a session must always open* true when a mode changes shape
   * under a three-month-old game.
   *
   * `object` rather than a JSON Schema type: this is what Ajv compiles, the
   * validator the workspace already carries, and importing a schema type into
   * the published contract would put a dependency in front of every extension
   * author for a field they write as a literal.
   */
  schema: object;
  /**
   * How the value reads when a preset injects it — [06 §4], [P7.1].
   *
   * **A Liquid template over the channel's own value, and nothing else.** The
   * same engine a preset block's `template` uses, with a context that is the
   * channel value rather than
   * [06 §5](../../../docs/design/06-modes-and-turn-pipeline.md)'s closed
   * participant namespace: a clock declaring `Day {{day}}, {{hour}}:{{minute}}`
   * is the mode saying how its own state reads in a prompt, which is exactly the
   * declarative contract [10 §8](../../../docs/design/10-ui-surfaces.md) draws
   * for the HUD, applied to text.
   *
   * **This is the *injection* half of the channel contract and it did not
   * exist.** `{ of: 'channel', channelId }` has been a legal preset slot since
   * P2, and the collector returned nothing for it — so an author could name a
   * channel in a preset and get silence, with no error and nothing to read. That
   * is also why `budget` had no reader: there was no path that spent tokens.
   *
   * **Optional, and absent is a real answer**: a channel with no template is one
   * with nothing worth saying to a model. Lore timing is the shipped example —
   * `sticky`, `cooldown` and `fired` are bookkeeping, and a player asking why an
   * entry fired gets a reason from the workbench rather than from the prompt.
   *
   * *A template rather than a function, for the reason nothing on this type is a
   * function: a mode is data ([06 §2]), and a `render()` here would be the back
   * door that section says means the contract is wrong.*
   */
  render?: string;
  /**
   * Values a model may not set on its own — [06 §8.1], [10 §13.2], [26 C12],
   * built at [P7.2](../../../docs/design/workplan/23-p7-implementation.md).
   *
   * **A declared list, because the alternative is engine code naming a
   * channel.** The rule this exists for is *"a proposed status change to `dead`
   * is surfaced prominently rather than applied as a quiet badge"* — and
   * expressing that as `if (channelId === 'se.status')` inside the engine is the
   * shape [P7.1] spent a stage removing. A channel says which of its own values
   * are the loaded ones.
   *
   * **Refused rather than applied-and-flagged, and the two source documents are
   * ambiguous about which.** 06 §8.1 says *"flagged, not applied quietly"* and
   * 10 §13.2 says *"surfaced prominently rather than applied as a quiet
   * badge"* — both of which contrast with *quiet* and neither of which settles
   * *applied*. [26 C12](../../../docs/design/26-open-questions.md) settles it:
   * *"**Under-firing** plus always-available manual completion is the position
   * regardless."* And the harm 10 §13.2 names is in the applying — *"a false one
   * silently removes someone from the story, and every subsequent turn is then
   * assembled around their absence"* — so refusing until a person says otherwise
   * is the reading that prevents the stated failure. The refusal is recorded,
   * which is the prominent surface, and the manual path is the ordinary channel
   * write.
   *
   * **Two consumers by design.** Status-to-terminal is the first; goal
   * completion ([P7.6]) is documented as the same posture, and building one
   * status-shaped now is the reinvention this phase keeps catching itself
   * about.
   *
   * *Strings, because the values that are loaded are the ones a person can
   * name. A channel whose loaded state is a shape rather than a value wants a
   * predicate, and a predicate is code — which is the door [06 §2] keeps shut.*
   */
  confirm?: readonly string[];
  /**
   * How it appears in the HUD, if at all — see {@link WidgetSpec}.
   *
   * **Optional, and absent is the answer for most channels.** A channel with no
   * surface is one there is nothing useful to show about: lore timing is the
   * shipped example, and [22 §6](../../../docs/design/22-internal-contracts.md)
   * deferred this field precisely so it would be designed against a channel that
   * wanted one rather than three that might.
   *
   * *Distinct from {@link render}, and the pair is worth keeping straight: that
   * one says how the value reads **to a model**, this one how it reads **to a
   * person**. They differ in more than wording — a prompt wants "Day 3, 09:05"
   * in a sentence's worth of tokens, a HUD wants a label beside it and no budget
   * at all.*
   */
  surface?: WidgetSpec;
  /**
   * Whether the value is established state, and under what heading — see
   * {@link EstablishedState}. Absent for every channel that is not.
   */
  state?: EstablishedState;
  /**
   * ***The switch this channel waits on, wherever it is read*** —
   * [P14 §1.9.3](../../../docs/design/workplan/31-p14-scene-and-session-import.md),
   * added at [P14.5b]: the id of a boolean channel whose value must be `true`
   * for this one to reach a prompt slot, a channel digest or a surface.
   *
   * **{@link EstablishedState.enabledBy}, for a channel that is not established
   * state.** The trackers' switch rides on `state` because the state block was
   * the one place they are read; a secret plot is read through an ordinary `{
   * of: 'channel' }` slot among the system blocks, and giving it a `state` to
   * reach the switch would put it in the *what the story has established* block
   * too — which a plot the story has not reached is exactly not. So the switch
   * is said here, once, and the engine reads either (`stateEnabled`).
   *
   * *Switched off is silent, not cleared*: the value stays on the tree, so a
   * plot switched back on resumes where it was. Absent means always read.
   */
  enabledBy?: string;
  /**
   * ***The reveal affordance*** — [06 §7.3](../../../docs/design/06-modes-and-turn-pipeline.md):
   * *"Hidden GM state (… the Narrative Director's Secret Plot) is a channel
   * with `visibility: "hidden"` and a reveal affordance."* Added at [P14.5b].
   *
   * The id of a boolean channel a person switches: while it is `true`, this
   * hidden channel's surfaces are drawn as though it were `player`, and while
   * it is not, it is kept from every surface **and from the channel digests
   * that feed a picture** — a secret drawn into an illustration is a secret
   * shown. The narrator is told either way; `visibility` is about the player
   * ([04 §7.1]'s *hidden is the GM's arc*).
   *
   * *Only meaningful on a `hidden` channel*: a `player` channel has nothing to
   * reveal. Absent is hidden for good, which is every hidden channel before
   * this — bookkeeping, not a secret.
   */
  reveal?: string;
  /**
   * Where the value starts. See {@link InitPolicy}.
   *
   * **Required, and that is the point of adding it.** `CLOCK_START` and
   * `NO_TIMING` were engine constants beside the code that read them, so a
   * channel's initial value was something the *engine* knew and the declaration
   * did not — the same shape of gap `ModeDefinition.channels` had before [P7.0]
   * gave it teeth. A mode that cannot say where its own channel starts has not
   * declared the channel.
   */
  init: InitPolicy;
}
