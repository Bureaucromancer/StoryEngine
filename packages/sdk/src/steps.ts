// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  BlockSource,
  ChannelEffect,
  ChannelState,
  EffectOp,
  GenerationParams,
  MessageRevision,
  ModelCall,
  ModelRole,
  OutputMessage,
  Ref,
  StepStage,
  TokenUsage,
  Turn,
  TurnAttachment,
} from '@storyengine/shared';

import type { RandomApi } from './random.js';

/**
 * Steps, and the boundary they run behind —
 * [06 §6](../../../docs/design/06-modes-and-turn-pipeline.md).
 *
 * A turn is an ordered sequence of steps; the built-in stages are steps that
 * always exist. A step declares what it reads, what it writes, and where it may
 * run — and the declaration is what the engine enforces, rather than a
 * convention the step is trusted to follow.
 *
 * **These moved here from `server` at [P7.0](../../../docs/design/workplan/23-p7-implementation.md),
 * and the move is what makes them a contract.** They were always written as
 * one — `modes/contract.ts` enumerated them so a mode reached for nothing else
 * — but a type list a mode is *asked* to respect and one it is *able* to reach
 * are different things, and the second needs a package the engine is not on the
 * other side of. What stays in the engine is everything that decides: the
 * condition evaluator, the payload filter, the purpose derivation, the runner.
 * What is here is what a step author writes against.
 */

/**
 * When a step runs — [06 §6]'s closed set, spelled out.
 *
 * Three arms and no more: *a cadence, a stage flag, an explicit arm by the
 * user*. Deliberately **not an expression language**, and deliberately not the
 * authored-rule predicate vocabulary either — the tempting move once rules
 * arrive is to let steps take rule predicates, and that quietly makes an
 * internal shape depend on a portable one.
 *
 * A step that runs every turn is `{ when: 'cadence', everyNTurns: 1 }`. There is
 * no `always` arm, because adding one would be a fourth member of a set the
 * design calls closed, and the cadence already says it.
 */
export type StepCondition =
  | { when: 'cadence'; everyNTurns: number }
  | { when: 'stage'; flag: string }
  | { when: 'armed'; flag: string };

export interface StepDefinition {
  id: string;
  stage: StepStage;
  /**
   * Channel ids, plus the two pseudo-sources [06 §6] names — `history` and
   * `output`.
   *
   * Typed as bare `string` rather than `string | 'history' | 'output'`: a
   * union with `string` in it collapses to `string` anyway, so the literals
   * would be documentation pretending to be types. A channel id is an open
   * vocabulary ([06 §4] lets a mode declare its own), so this cannot be closed.
   */
  reads: string[];
  /** Channel ids this step may propose effects on. */
  writes: string[];
  contributes?: 'blocks' | 'effects' | 'messages';
  /**
   * What kind of call this step makes — [04 §8.2]'s portable, open string, which
   * a preset block's `appliesTo` filters on.
   *
   * Distinct from the assembler's `CallPurpose`, which is *derived* from
   * `contributes` and `writes` and decides whether guidance is admitted. This
   * one is authored vocabulary: it is how a preset says *this block is for
   * narration and not for the summariser*.
   */
  callKind: string;
  when: StepCondition;
  failure: 'abort' | 'warn' | 'ignore';
  /** The role its call asks for, or null when it makes none. */
  role: ModelRole | null;
  /**
   * ***A person may run this step between turns*** —
   * [P14 §1.9.2](../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
   * *Update trackers*, declared at [P14.5a].
   *
   * **A declaration rather than a route that runs whatever it is named**, for
   * the reason `confirm` is one on a channel: the alternative is engine code
   * naming a mode's step, or a door through which a client could run the
   * narrator outside a turn and have its prose land nowhere. Only a `post` step
   * that contributes nothing but effects can mean anything run on its own —
   * the engine refuses the declaration on anything else rather than guessing
   * what a detached narrator call would be for.
   *
   * *What running it writes is an engine turn*, the shape a person's channel
   * edit already writes: the step's call and its effects on a child of the
   * head, with no `steps` record, so it is not a story turn and moves no
   * cadence. The step is told it was asked for through
   * {@link StepInput.onDemand}, which is how one declared `when` can mean *on
   * a cadence, and also whenever somebody presses the button*.
   *
   * Absent is *never on demand*, which is every step written before this.
   *
   * ***`{ label }` rather than `true`*** — changed at [P14.5a]'s client half.
   * A control that runs the step has to say something, and what it says is
   * authored content that travels with the mode, as a widget's label does:
   * *Update trackers* is Scene's sentence, and a host that minted the words
   * from the step's id would be the engine naming a mode's feature.
   */
  onDemand?: { label: string };
  /**
   * ***This step may revise the turn's messages before the turn is written***
   * — [P14 §1.9.4](../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
   * editor, declared at [P14.5c].
   *
   * **A declaration, because what it permits is the one thing no step could
   * do before**: change what an earlier step said. A `post` step has always
   * been handed the output to read; only a step declaring this may answer with
   * {@link StepResult.revisions}, and only in the `post` stage, since a
   * revision of prose nobody has written yet is nothing. The engine refuses a
   * revision from any other step as that step's failure.
   *
   * - `enabledBy` — the boolean channels that switch it on, **any of which**
   *   will do (an editor for style and one for continuity are one call). The
   *   step still reads its own switches; this is for the engine, which has to
   *   know *before the prose streams* whether an edit is coming.
   * - `hold` — a boolean channel: while it is on (and the step is), the
   *   engine streams none of the round until the step has answered, so a
   *   person never reads a sentence the editor then takes back — Marinara's
   *   *hold for rewrite*. Absent is never held.
   *
   * *The step names channels; the engine reads switches.* Neither says which
   * mode's editor this is, which is the rule every declaration here keeps.
   */
  revises?: { enabledBy: readonly string[]; hold?: string };
}

/**
 * One candidate, before the budgeter has ruled on it.
 *
 * **This is the shape a step returns, and publishing it settles a divergence
 * the boundary document recorded and left open**
 * ([22 §4](../../../docs/design/22-extensions.md),
 * [P7 §1.2](../../../docs/design/workplan/23-p7-implementation.md)). 22 has a
 * step handing back `blocks: AssembledBlock[]`; the engine has it handing back
 * candidates, and the engine is right — a *block* is what the assembler
 * produces once the budgeter has ruled, and a step cannot produce one because
 * it does not know what fits. So the contract takes the step's shape and 22 is
 * the document that gets corrected.
 */
export interface Candidate {
  id: string;
  source: BlockSource;
  /**
   * Why it is here, in the words the workbench shows: *"keyword match:
   * 'cathedral'"*, *"pinned by user"*, *"always"*. **A product feature, not a
   * debug string** — which is also why it is required rather than optional.
   */
  reason: string;
  role: 'system' | 'user' | 'assistant';
  text: string;
  /**
   * Lower drops first. Absent means "the preset did not say", which the
   * budgeter treats as the middle rather than as the most expendable.
   */
  priority?: number;
  /**
   * Never dropped by the budgeter. For the things a request is meaningless
   * without — the user's own message.
   */
  required?: boolean;
  /**
   * **Guidance, and anything else that may influence prose and nothing else.**
   *
   * [06 §5.2](../../../docs/design/06-modes-and-turn-pipeline.md) is a
   * specification rather than a preference: guidance must never be admissible
   * to a call whose output determines a systematic result. Enforced
   * structurally rather than by convention — the assembler refuses to admit an
   * advisory block to a call declared as producing effects or verdicts, and a
   * step declaring a non-empty `writes` is such a call.
   */
  advisory?: boolean;
  /**
   * ***The picture this candidate stands for*** — [25 E15], R1, and a change to
   * this published contract made deliberately: optional, so every step written
   * before it is unchanged.
   *
   * `text` is the picture's rendering **as words**, which is what goes when the
   * pixels do not; `sentText` is what goes beside them when they do. The engine
   * decides which per call, from the model that call resolved to, and records
   * the answer on the assembled block. A step never decides it — a step cannot
   * know which model will answer.
   */
  image?: CandidateImage;
}

/** What a picture candidate carries — see {@link Candidate.image}. */
export interface CandidateImage {
  attachmentId: string;
  kind: string;
  digest: string | null;
  mime: string | null;
  /** The text that accompanies the pixels when they are sent. */
  sentText: string;
  /**
   * Whether the picture belongs to the move being made now. R1 sends only
   * these; a picture from an earlier turn always goes as its words.
   */
  current: boolean;
}

/**
 * What a step hands back when it wants to change channel state. It cannot stamp
 * `before`, `applied` or an id.
 *
 * **The second divergence [22 §4] recorded, settled the same way**: a step
 * *proposes* and the engine decides, so the proposal carries no verdict. 22
 * described a step returning full effects; the engine's narrower shape is the
 * one that makes [21 §1.2](../../../docs/design/21-internal-contracts.md)'s
 * *a refused effect stays in the record* enforceable, because only the engine
 * can record a refusal.
 */
export interface EffectProposal {
  channelId: string;
  scopeKey?: string | null;
  op: EffectOp;
  after: unknown;
  /**
   * ***Who proposed it — and from a step, only the step itself or a model call
   * it made*** (2026-09-30). The type is the record's whole union because the
   * engine's own proposals share it (its clock, a person's write); **from a
   * step**, `{ kind: 'step', stepId }` naming another step, a `model` call it
   * did not make, `user` or `engine` is recorded refused, `not-its-proposer`,
   * under the step's own stamp — and a channel outside the step's `writes` is
   * refused `undeclared-write`. Not narrowed here, so the engine keeps one
   * proposal type; the refusal is what holds the line.
   */
  proposedBy: ChannelEffect['proposedBy'];
}

/**
 * What a step is given — plain data, and **no guidance**.
 *
 * The omission is the design. [22 §3.1] gives the payload-filter rule this
 * implements — *a step that did not declare `history` does not receive it* — and
 * `reads` names a channel or one of [06 §6]'s pseudo-sources and **nothing that
 * is not a source**, so guidance is not expressible there and could only arrive
 * as an ungated extra.
 *
 * *Was "`history` or `output` and nothing else", which `cast` made wrong 78
 * lines below at [P7.12] — the same sentence [06 §6] and [22 §3.1] carry, and
 * all three needed the same correction (2026-09-13). What matters to the
 * argument is unchanged, and is why the count was never load-bearing: every
 * member of that union is a **source**, and guidance is not one.*
 * A step handed the guidance text could re-emit it as an ordinary candidate, and
 * the assembler would admit it: the refusal keys on `Candidate.advisory`, not on
 * where the words came from. Guidance therefore reaches the prompt only as a
 * candidate the *runner* collects, marked advisory, and never passes through a
 * step at all.
 *
 * Serialisable both ways, because [01 §2](../../../docs/design/01-source-survey.md)
 * makes the step contract async and serialisable a day-one item — this is the
 * payload that crosses a worker hop, and the host below is what gets proxied
 * rather than cloned.
 */
/**
 * One person in the scene, as a step sees them — [P7.12].
 *
 * *Deliberately not an `Actor`.* The full card is prose, sections, provenance
 * and forty fields, and handing one to every step that wants a name would make
 * the payload filter meaningless. This is what a step can act on: who they are,
 * and what pictures travel with them.
 */
export interface CastEntry {
  actorId: string;
  name: string;
  /** The object kind that carries the media, for addressing it. Actors today. */
  kind: string;
  media: readonly { id: string; role: string; label?: string }[];
  /**
   * ***What somebody looks like, structured*** — [04 §3]'s `VisualDescriptors`,
   * added at [P9.1](../../../docs/design/workplan/26-p9-implementation.md).
   *
   * **The field this type was missing for the one consumer it was built to
   * serve.** [P7.12] added `CastEntry` so a step could do *expression selection*
   * and handed over ids, names and a media manifest; [06 §10.3] asks a rendition
   * step for *"present actors' `VisualDescriptors` and their `reference`
   * media"*, and only the second half was here. A step that had to fetch the
   * other half itself would be a step doing I/O, which is the thing `StepHost`
   * has no verb for.
   *
   * ***It is also the field that makes §10.3's first assembler rule
   * mechanical.*** *"A character's name never appears in an image prompt — the
   * image model does not know who Elena is; it knows what a woman with cropped
   * grey hair looks like."* [04 §3] says the structured field exists *precisely
   * so the substitution is mechanical*, and it only is if the substitute is on
   * the same record as the name. Aventuras states that rule **to the model**,
   * which is the wrong place for it and the clearest vindication the structured
   * field has had.
   *
   * *Prose `appearance` is deliberately not here.* It is a section, it is for
   * the narrator, and handing a paragraph to an image model is the failure
   * §10.3 opens by describing.
   *
   * Absent when the card has none, which is every card imported from a format
   * that had no such field — most of them.
   */
  visual?: {
    face?: string;
    hair?: string;
    eyes?: string;
    build?: string;
    clothing?: string;
    accessories?: string;
    distinguishing?: string;
  };
  /**
   * ***This entry is the player's own character*** — added at [P14.5a].
   *
   * `castEntries` has put the persona first in this list since [P7.12]
   * (*"the persona is an actor too"*), and nothing could tell it from the
   * others: position is a convention a step would be trusting, and a session
   * with no persona puts somebody else first. The trackers are the first step
   * that has to know, because *the persona* and *each present character* are
   * two trackers with two shapes ([P14 §1.9.2]), and a character tracker that
   * tracked the player too would be the same person described twice.
   *
   * Absent means an ordinary member of the cast.
   */
  persona?: true;
  /**
   * ***This member is muted*** — out of the room by the mode's own reading of
   * presence, added 2026-09-29 (the [P14.5a] review).
   *
   * The cards and the tracker panel have left a muted member out since
   * [P14.3], but the character tracker asked about everyone in this list, so a
   * call a turn went on somebody the player had taken out of the scene —
   * Marinara's character tracker follows only the characters present. The
   * host says it here, from the one reading the collector and the panel use,
   * rather than handing a step the presence channel: a step that read
   * `se.presence` would be the engine's reading of presence written twice.
   *
   * Absent means present, which is what every mode without a reading of
   * presence gets.
   *
   * ***And written out — dead or departed — since 2026-09-30***, under any
   * reading of presence: a picture that drew somebody the story killed, or a
   * chorus line in their voice, is the story forgetting its own events. The
   * persona is never marked.
   */
  present?: false;
}

export interface StepInput {
  turnId: string;
  sessionId: string;
  parentTurnId: string | null;
  input?: {
    actorId: string | null;
    kind: string;
    text: string;
    raw: string;
    /** Pictures on the move — `Turn.input.attachments`'s shape. */
    attachments?: TurnAttachment[];
  };
  /**
   * **Who the mode's participant policy says talks this turn** — [06 §7.2],
   * [P7.3].
   *
   * Actor ids, in the order the policy chose them, over whoever presence and
   * status say is available. A step that makes one merged call can ignore it; a
   * ~~step that speaks for somebody passes one of these as
   * `StepCallRequest.actorId`, which is how an actor reaches `resolveRole`'s
   * last layer.~~ step that speaks for somebody passes one of these as
   * `StepCallRequest.speaker` (*corrected 2026-09-29, at [P14.2]*), which
   * implies the `actorId` that reaches `resolveRole`'s last layer under
   * `per-actor` dispatch. Scene's embodied `merged` call does not ignore the
   * list either: it speaks as the first entry, one call for the scene.
   *
   * **Not filtered by `reads`, and the exception is principled.** [22 §3.1]'s
   * payload filter is about *sources* — a channel, the history, the output —
   * things a step might not be entitled to. This is the mode's own declaration
   * applied to the mode's own turn, so every step of that mode is entitled to
   * it by construction, the same way `input` is. A `reads: ['speakers']` would
   * be a fourth pseudo-source in a set [06 §6] names as two.
   *
   * **Empty is a real answer**, and `manual` is where it happens: ~~nobody was
   * named~~ the player sent an input and nobody was asked to reply
   * (*corrected 2026-09-29, at [P14.1]*), so nobody in particular is speaking.
   * It is not the same as absent, which is a turn whose ~~mode declares~~
   * **session plays** `fixed` and makes no selection at all.
   *
   * *The session's policy, not the mode's, since [P14.1]*: the mode's
   * `participants.select` is what a session is created with, and a session
   * may say otherwise ([P14 §1.2](../../../docs/design/workplan/31-p14-scene-and-session-import.md)).
   * **And a force-talk submission overrides both**, so a turn can carry
   * speakers under `fixed` too — the one case where somebody asked by name.
   *
   * ***Under `smart`, possibly a model's answer*** ([P14 §1.3a]). When no rule
   * settles the turn, an engine step runs first and asks; every step after it
   * is handed that answer, and a step never sees the rule-based pick it
   * replaced. A mode reads this the same way whichever produced it — which is
   * the point: who chose is on the record, and what to do with the choice is
   * the mode's.
   */
  speakers?: readonly string[];
  /**
   * ***How the session speaks*** — [06 §3](../../../docs/design/06-modes-and-turn-pipeline.md)'s
   * two axes as this session plays them, [P14 §1.2](../../../docs/design/workplan/31-p14-scene-and-session-import.md),
   * handed to steps at [P14.2](../../../docs/design/workplan/31-p14-scene-and-session-import.md).
   *
   * - `voice` is **who the prose is in**: `narrator`, a voice outside the scene
   *   describing it, or `embodied`, the characters speaking as themselves.
   * - `dispatch` is **how many calls a round takes**: `merged` is one reply for
   *   everybody who speaks, and `per-actor` is one speaking call per member in
   *   `speakers`, in that order, each seeing the replies before it
   *   ({@link StepCallRequest.speaker}).
   *
   * ***The session's values, not the mode's*** — the ones the server resolves
   * from the session file (a field the session carries wins, a session written
   * before these fields existed reads the mode's `legacy`, and otherwise the
   * mode's declaration). A step that read its own `ModeDefinition` instead would
   * be right until somebody changed a session's settings and then wrong about
   * every turn after, which is the failure `legacy` exists to prevent one level
   * up.
   *
   * **What to do with them is the mode's**, which is the whole point of handing
   * them over rather than acting on them: the engine owns what a speaking call
   * *is* — whose card comes first, what the next speaker is shown, how a reply
   * is cleaned — and the step owns whether to make one call or several. A mode
   * with no voice of its own ignores both.
   *
   * **Not filtered by `reads`**, for `speakers`' reason: the session's own
   * settings applied to the session's own turn, which every step of the mode is
   * entitled to. *Optional*, so a host that predates them — a test double, an
   * older engine — hands none, and a step reads their absence as its mode's own
   * declared values, which is what such a host played.
   */
  voice?: 'narrator' | 'embodied';
  dispatch?: 'merged' | 'per-actor';
  /**
   * ***Who is in the scene, and what they look like*** — declared by
   * `reads: ['cast']`, added at
   * [P7.12](../../../docs/design/workplan/23-p7-implementation.md).
   *
   * **A gap a mode found by needing it.** [06 §7.2] asks for *expression
   * selection* as a step writing a channel, and a step could not see an actor's
   * expression set at all: `speakers` above carries ids and nothing else, and
   * `StepHost` has no library reader until [22 §4]'s capability API. A mode that
   * had to be handed its own cast by the engine would be the back door [06 §2]
   * refuses — so the contract widens instead, which is what P7 is for.
   *
   * ***The manifest, never the bytes.*** [04 §3] makes `EmbeddedMedia` *"a
   * reference to bytes carried by the container"*, and this carries the
   * reference: an id, a role and a label. A step that wanted pixels would be a
   * step doing I/O, and nothing here does I/O.
   *
   * *Filtered like a channel*, so a step that does not declare `cast` is not
   * handed one — which is what `reads` is for, and what keeps a step's payload
   * the thing it said it needed.
   */
  cast?: readonly CastEntry[];
  /**
   * **What the mode's wizard was answered with** — [06 §7.3], [P7.4].
   *
   * Keyed by the field ids the mode declared, and validated against the schema
   * derived from that declaration before the session was written — so a key here
   * is one this mode asked for, and its value is the shape the widget implies.
   *
   * **Present on every turn, not only the setup one**, which is a choice worth
   * naming: a part generates from the answers, and a *step* may want them too —
   * a narrator that knows the premise, a difficulty dial the prompt pack keys
   * off. The alternative is a mode reading its own setup through a back door,
   * which [06 §2] is the section that refuses.
   *
   * **Not filtered by `reads`**, like `input` and `speakers` and for the same
   * reason: [22 §3.1]'s filter is about *sources* a step might not be entitled
   * to, and this is the mode's own declaration answered for the mode's own
   * session.
   *
   * Absent for a mode with no wizard, which is every mode with
   * `setup: { kind: 'none' }`.
   */
  setup?: Readonly<Record<string, unknown>>;
  /** Only the channels `reads` named. */
  channels: Record<string, ChannelState>;
  /** Present only when `reads` includes `history`. */
  history?: readonly Turn[];
  /**
   * ***What was said, and nothing about how it was produced*** — declared by
   * `reads: ['transcript']`, added at
   * [P8.1](../../../docs/design/workplan/25-p8-implementation.md).
   *
   * **The narrow half of `history`, and it exists because the wide half cannot
   * be narrowed later.** [08 §6](../../../docs/design/08-cross-session-memory.md)
   * asks that memory never be extracted from hidden content — a hook's premise,
   * an unfired hook's entrances, a hidden channel, GM-only state — and says the
   * mitigation must be *refuse at the source* rather than a filter, *"because
   * the extraction has already written the sentence down."*
   *
   * ***As the contract stood, that refusal was not expressible.*** `history`
   * above is `readonly Turn[]`, unfiltered, and the runner hands a step the
   * **full path** where the collector gets the windowed slice. A `Turn` carries
   * `request.calls[].blocks[].text` — so a premise, a chosen entrance's finished
   * prose and a hidden channel's rendered value all arrive verbatim inside the
   * record a step declared `history` to get, before any prompt is written.
   * [P8 §1.5] is the finding: *"refusing at the source is not expressible, and
   * filtering inside the extractor is exactly what 08 §6 rejects."*
   *
   * **Built with the payload rather than with its consumer**, which is the rule
   * `filterReads` states about itself: a payload narrowed *after* a consumer
   * exists is a payload narrowed by subtraction, and nobody can then say which
   * fields were load-bearing. The extractor arrives later; the shape it must be
   * held to arrives now.
   *
   * *What it still legitimately carries is the narrator's own output*, and an
   * entrance that fired is finished prose sitting in it. That remainder is a
   * refusal with a reason rather than a filter — [P8.5]'s, not this field's.
   *
   * ***The story's turns, not the path's*** (2026-09-27): a turn nothing was
   * said in — a channel write, an undo, a backdrop choice — is on the path and
   * not in this list, which is the list the host's history window counts too.
   */
  transcript?: readonly TranscriptTurn[];
  /**
   * Present only when `reads` includes `output`.
   *
   * ***`messages` since [P14.5c]***: the turn's output as its messages, each
   * with its speaker — present when the output has them, which is a round
   * under `per-actor` dispatch or a swipe's carried lines — so a step that
   * revises (see {@link StepDefinition.revises}) can answer about one message
   * at a time. Absent, the output is one message, index `0`. *Carried*
   * messages are marked (`OutputMessage.carried`): they are an earlier turn's
   * work, and the engine refuses a revision of one.
   */
  output?: { text: string; messages?: readonly OutputMessage[] };
  /**
   * ***A person asked for this run*** — {@link StepDefinition.onDemand},
   * [P14.5a].
   *
   * Present only on a run nobody's turn made: the step's declared `when`, and
   * any cadence or manual switch it reads for itself, answer *should I run
   * this turn*, and a person pressing *Update trackers* has already answered
   * it. `output` is then the last story turn's, and `transcript` the path up to
   * it — what the step saw when that turn committed.
   */
  onDemand?: true;
}

/**
 * One past turn, as a step that may not see the record sees it.
 *
 * `turnId` so a step can attribute what it found — [P8 §1.4]'s *each entry
 * carries a ref to its origin* needs a node to point at, and an extractor handed
 * anonymous prose could not supply one. It is an identity and nothing more: no
 * request, no blocks, no effects, no tape.
 *
 * Both halves optional for the reason the record has them optional. A turn whose
 * generation failed has an input and no output, and saying so is different from
 * saying it was empty.
 */
export interface TranscriptTurn {
  turnId: string;
  input?: {
    actorId: string | null;
    kind: string;
    text: string;
    /**
     * The move's pictures, as a transcript may know them — [25 E15]: their kind
     * and the player's caption, never their bytes or their digest. Absent when
     * there were none. A step that summarises or remembers should say a picture
     * was shown; what it showed is the caption's to say.
     */
    attachments?: readonly { kind: string; caption?: string }[];
  };
  output?: { text: string };
}

export interface StepResult {
  candidates?: Candidate[];
  effects?: EffectProposal[];
  /** The turn's output, spoken by nobody in particular — the narrator's one reply. */
  message?: { text: string; reasoning?: string };
  /**
   * ***The turn's output as several messages, each with its speaker*** —
   * [P14 §1.1](../../../docs/design/workplan/31-p14-scene-and-session-import.md),
   * added at [P14.0](../../../docs/design/workplan/31-p14-scene-and-session-import.md).
   *
   * **For a step that voices several speakers**: a group round under `per-actor`
   * dispatch, one message per member who replied, or a narrator paragraph beside
   * embodied lines. It lands as `Turn.output.messages`, and **the runner derives
   * `output.text` from it** — a step never writes the joined text itself, because
   * a step that did could write one that disagrees with its own messages, and
   * `text` is what every older reader believes.
   *
   * ***One or the other, never both.*** `message` is the one-speaker case and
   * stays so that every step written before this compiles and behaves as it
   * did. A result carrying both is refused as the step's failure, under its own
   * `failure` policy, because the two are rival answers to *what did this turn
   * say* and nothing in the result says which the author meant. Silently
   * preferring one would turn an author's mistake into a transcript missing
   * whatever the other held.
   *
   * *An empty list is a step that spoke for nobody* — a `manual` round with
   * nobody named — and sets no output, which is what an absent output has always
   * meant on the record.
   */
  messages?: OutputMessage[];
  /**
   * ***What this step changed in the turn's messages, and what it noticed*** —
   * [P14 §1.9.4](../../../docs/design/workplan/31-p14-scene-and-session-import.md),
   * added at [P14.5c]. Only from a `post` step declaring
   * {@link StepDefinition.revises}.
   *
   * One entry per message the step has something to say about, by its index
   * in `output.messages` (or `0` for a turn of one message). A `text` replaces
   * the message's text **before the turn is written**, so the turn's authored
   * bytes are the edited ones; the engine keeps what it replaced as the
   * message's `original` — unless cleanup already kept the model's own reply
   * there, which is the older and truer original. `changes` and `notices` land
   * on the step's outcome (`StepOutcome.revisions`), never in the prose.
   *
   * ***Refused as the step's failure***, under its own policy, when it names a
   * message the turn does not have or one that was carried, or brings an empty
   * `text`: an editor that answered with nothing has not edited, and blanking
   * a message is not a revision.
   */
  revisions?: readonly MessageRevision[];
}

export interface StepCallRequest {
  /**
   * Which actor this call speaks for — [19 §5.1](../../../docs/design/19-tech-stack.md),
   * [P7 §1.9], added at [P7.3].
   *
   * **The last and weakest resolution layer had no way to be reached.** 19 §5.1
   * orders the layers *install default → role binding → session override → step
   * override → actor hint*, and `resolveRole` has applied a hint since P2B — but
   * §1.9 found it *"never passed either"*, and named the reason: *"today one
   * turn makes one merged call and an actor is not in the resolution at all."*
   * This is how an actor gets into it.
   *
   * **A step says who it is speaking for; the engine finds the card and applies
   * the hint.** Not the hint itself, because [04 §3]'s `ModelHint` is *"a
   * preference, never a binding — an imported card may express what it wants; it
   * can never repoint anyone's provider"*, and a step handed the preference
   * could pass one the card does not carry. Passing an *id* keeps the card the
   * only source.
   *
   * ~~**Absent is a merged call**, which is what `dispatch: 'merged'` means and
   * what every shipped step does: one reply for the scene, spoken by nobody in
   * particular, resolved with no hint.~~ *Corrected 2026-09-29, at [P14.2]*: a
   * call with neither `actorId` nor `speaker` is the narrator's or an embodied
   * merged call with nobody selected, and resolves with no hint. Scene's
   * speaking calls pass `speaker` — its embodied `merged` one too, for the
   * first selected member — which implies this field under `per-actor`
   * dispatch only: a merged speaking call still resolves with no hint, since
   * [06 §3] consults one only under `per-actor`. ~~`per-actor` dispatch is a mode fanning
   * this out — the mode half is [P7.9]'s, since no shipped mode declares it, but
   * the engine half is here and works for a single call just as well.~~
   * *Corrected 2026-09-29, at [P14.2]*: [P7.9] never built the mode half, and a
   * model hint was never enough to fan a round out with — the call also has to
   * be *assembled* for the member and its reply attributed to them. That is
   * {@link StepCallRequest.speaker}, which implies this field; `actorId` stays
   * for a call that wants an actor's model preference and nothing else.
   */
  actorId?: string;
  /**
   * ***The member this call speaks as*** — [P14 §1.4](../../../docs/design/workplan/31-p14-scene-and-session-import.md),
   * built at [P14.2]. An actor id from the scene's cast; never the persona,
   * whose words are the player's.
   *
   * **A speaking call is `actorId` and three things more**, and each is the
   * engine's rather than the step's:
   *
   * 1. ***It re-scopes assembly.*** `{{char}}` is the speaker; `{{group}}`,
   *    `{{charIfNotGroup}}` and `{{notChar}}` are named from them; the speaker's
   *    card comes first among the cast's, and a block scoped `speaker` or
   *    `others` narrows to them or away from them. Every other present card
   *    stays ([00 §2.10]'s *"the assembler is multi-actor from the start"*).
   * 2. ***It sees the round so far.*** The messages earlier speaking calls wrote
   *    this turn follow the input, in order, as the model's own lines — the
   *    second speaker answers the first.
   * 3. ***Its reply is the runner's.*** While it streams, it fills a new message
   *    on the turn's output, attributed to the speaker, and the live events
   *    carry that message's index. When it completes under the session's
   *    `per-actor` dispatch, a leading `Name:` is stripped and the text is cut
   *    where another member's line, or the persona's, begins (ST's
   *    `trimWrongNames`), as both sources clean a group
   *    reply; the result's `text` is the cleaned reply, and `original` says it
   *    was cleaned. Under `merged` the one reply may voice several members,
   *    so nothing is cut.
   *
   * *And under `per-actor` dispatch the model role resolves for the speaker*
   * exactly as `actorId` does — a speaking call implies that `actorId`, and one
   * that names a different `actorId` beside it is refused rather than guessed
   * at. Under `merged` the speaker's hint is not consulted ([06 §3]: a hint
   * applies only under `per-actor`; 2026-09-29, [P14.2] review), since the one
   * reply is the scene's whoever it is attributed to. *A speaking call
   * that brings its own `candidates`* is assembled from those alone, as any
   * call that brings them is: points 1 and 2 are the preset's collection, and
   * the preset is not consulted. Point 3 still holds.
   *
   * **One speaking call at a time.** A round is ordered — each call is shown the
   * ones before it — so a step that started a second while the first was still
   * streaming would be asking for two messages at one position, and the runner
   * refuses it. A step fans out with a loop, not with `Promise.all`.
   *
   * ***A round can lose a speaker and keep the rest.*** If a speaking call
   * fails after another speaking call of the same step finished, and the step
   * lets the failure propagate, the turn commits with the messages it has and
   * the step's outcome names who was lost: a declared `abort` is handled as a
   * `warn`, because a group round that loses its third speaker is a turn with
   * two messages rather than a lost turn. The first speaking call failing is an
   * ordinary failure under the step's own policy.
   *
   * Absent is every call that is not a member speaking: a narrator's merged
   * reply, a judge, a summary.
   */
  speaker?: string;
  params?: GenerationParams;
  /** Omitted means everything accumulated so far. */
  candidates?: readonly Candidate[];
  stream?: boolean;
  schema?: object;
}

export interface StepCallResult {
  callId: string;
  text: string;
  object?: unknown;
  usage: TokenUsage | null;
  /**
   * ***How the call ended, as its record says*** (2026-09-27): `truncated` for
   * a ceiling reached, `refused` for a provider's filter, `incomplete` for a
   * stream that stopped without saying why. A call that failed outright never
   * returns here; those reach the step as a rejection.
   *
   * **A step could not tell a finished reply from a cut-off one**, and a step
   * that keeps what it is given has to. The summariser cached a summary that
   * ran into its length limit mid-sentence, and every later link was built on
   * it. Optional, so a host that does not say is read as having nothing to
   * report, and every step written before this compiles unchanged.
   */
  outcome?: ModelCall['outcome'];
  /**
   * ***Who a speaking call spoke for, as the record names them*** — [P14.2].
   * The id the step passed and the name the card carries now, which is the
   * `Ref` the turn's message holds; so a step that builds its own `messages`
   * from its results writes the same speaker the runner streamed, without
   * declaring `cast` to find a name. Absent on a call with no `speaker`.
   */
  speaker?: Ref;
  /**
   * ***The reply as the model returned it, when cleanup changed it*** —
   * [P14 §1.4](../../../docs/design/workplan/31-p14-scene-and-session-import.md)
   * point 3, [P14.2].
   *
   * **Its presence is how a step knows `text` was cleaned**, and it is what the
   * step passes on as `OutputMessage.original` — the one place the unmodified
   * reply survives, because a call's record keeps the prompt and never the
   * answer. Absent when cleanup left the reply alone, and on every call that is
   * not a speaking one.
   */
  original?: string;
}

/**
 * The capability set a step is handed. Never the services, never a logger,
 * never a reply.
 *
 * `call` takes no role and no purpose: the runner derives both from the
 * definition. That is what stops a step choosing its own way past [06 §5.2],
 * and it is what keeps the boundary narrow enough to cross a worker hop.
 *
 * **None of these three is data, and that is the distinction worth holding.**
 * `StepInput` and `StepResult` cross the hop by being cloned; the host is
 * *proxied* — a function cannot be cloned at all, and an `AbortSignal` clones
 * to a detached object whose `aborted` never fires, which is worse. Every
 * member added here is another thing a worker has to bridge, which is the
 * argument for the set staying this small.
 */
export interface StepHost {
  call(request: StepCallRequest): Promise<StepCallResult>;
  /** Keyed and asynchronous — see [`random.ts`](./random.ts). */
  random: RandomApi;
  signal: AbortSignal;
}

export type StepImplementation = (input: StepInput, host: StepHost) => Promise<StepResult>;
