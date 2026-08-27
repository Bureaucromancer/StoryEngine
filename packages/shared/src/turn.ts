// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { GenerationParams } from './schema/preset.js';

/**
 * The turn record — [02 §8](../../../docs/design/02-data-model.md),
 * [13 §1](../../../docs/design/13-internal-contracts.md) — as plain types the
 * server writes and the client reads.
 *
 * **Internal tier, deliberately, and unlike everything under `schema/`.**
 * [13 §1] and [10 §1] put these shapes in the *free to move* tier: no `schema`
 * field, no `$id`, no entry in `PORTABLE_SCHEMAS`, no emitted JSON Schema, no
 * validation on import — changing any of it is a refactor, not a
 * compatibility event, because a turn record never crosses an install
 * boundary. They live in this package only so the client can stop re-declaring
 * them ([P3.0] — the workbench is the first surface that needs more of them
 * than a chat view does). **Session export ([06 B12]) is the event that ends
 * this freedom**: the day a stored turn becomes a portable artefact, these
 * graduate to `schema/` and the registry, and not before.
 *
 * **`mentions` is the one field of [02 §8] still absent**, and deliberately:
 * it is an overlay of resolved actor spans over `input.text` and
 * `output.text` ([03 §8.2]), and resolving mentions is an `extract` step —
 * fenced to P7. Re-pointed here rather than left to be rediscovered.
 *
 * Pure types plus one constant, per this package's header rule: no I/O and no
 * runtime behaviour. The machinery that *produces* these — the assembler, the
 * runner, the `Rng` — stays in the server.
 */

/**
 * The roles a step can ask for. Steps name roles, never models —
 * [07 §5.1](../../../docs/design/07-tech-stack.md) — which is what makes an
 * install portable and an extension safe to share.
 */
export const MODEL_ROLES = [
  'prose',
  'fast',
  'reasoning',
  'vision',
  'image',
  'video',
  'speech',
  'embedding',
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

/**
 * A rendered message, on its way to a provider — [13 §2].
 *
 * `fromBlocks` is the requirement merging must not break: the workbench maps
 * every sent byte back to the block that produced it, and a merge that
 * concatenates six blocks into one string without recording which six destroys
 * that mapping quietly, and only noticeably when somebody is debugging.
 */
export interface RenderedMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Which blocks produced this message, in order. Non-empty always. */
  fromBlocks: string[];
}

/** Provider-reported token usage. Never estimated — see `ModelCall.usage`. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * How a call failed, in the vocabulary the record and the UI both use.
 *
 * The class is what lets the UI offer the right recovery rather than surfacing
 * a provider string ([13 §1.4]).
 */
export type ErrorClass = 'transient' | 'retryable' | 'terminal';

/**
 * Why generation stopped, in the vocabulary a reader can act on.
 *
 * Narrower than any SDK's, deliberately: this is what reaches a turn record
 * and eventually a person, and a class travels where a provider's own string
 * must not ([13 §1.4]).
 */
export type FinishReason = 'stop' | 'length' | 'filtered' | 'tool' | 'unknown';

export type DrawKind =
  'int' | 'float' | 'bool' | 'chance' | 'pick' | 'weightedPick' | 'shuffle' | 'dice';

/**
 * One recorded draw — [07 §14.6](../../../docs/design/07-tech-stack.md).
 *
 * `detail` is what makes the workbench legible: `skill-check:persuasion d20 →
 * 7` rather than an anonymous list of numbers.
 */
export interface Draw {
  /** `site:purpose#index`. Stable across a rewrite that takes the same path. */
  key: string;
  site: string;
  purpose: string;
  index: number;
  kind: DrawKind;
  /** How the draw was asked for — `d20`, `p=0.3`, `0..5`. */
  detail: string;
  /** What it produced. JSON, because the tape is part of the turn record. */
  value: unknown;
  /** True when this value came off a tape rather than from the source. */
  replayed: boolean;
}

/** A turn's draws, in the order they happened. */
export type Tape = Draw[];

/**
 * Where a block came from — **one vocabulary, used from both ends**
 * ([13 §1.1]). A preset slot names a source, the assembler fills it, and the
 * resulting block records where it came from: same names, both ends. The
 * identifiers are what make provenance clickable — *which* lore entry, not "a
 * lore entry".
 */
export type BlockSource =
  /**
   * The persona is an actor too ([P3.0]): `actorId` is what makes the block
   * clickable through to the object it came from, and `contentHash` addresses
   * the bytes that were *used* rather than the object with that id today.
   * Both null when the session has no persona — a persona slot with
   * `omitWhenEmpty: false` still emits over nothing, and null is that claim.
   */
  | { kind: 'persona'; actorId: string | null; contentHash: string | null }
  /**
   * `contentHash` since [P3.0] — the cast is a *link* read fresh every turn,
   * so the id alone resolves to whatever the actor is *now*; the hash is what
   * gate step 4 clicks through to the actor as it was sent.
   */
  | {
      kind: 'actor';
      actorId: string;
      contentHash: string;
      sectionId?: string;
      field?: 'traits' | 'visual';
    }
  | { kind: 'lore'; entryId: string; phase: 'before' | 'after' }
  /**
   * One half of one past turn — F36: `part` because a turn is **two** blocks,
   * the player's words as `user` and the model's as `assistant`. `turnId` is
   * the identity ([P3.0]); `range` is an index into the *window* and stays as
   * display information — where in this prompt the turn sat.
   */
  | { kind: 'history'; turnId: string; range: [number, number]; part: 'input' | 'output' }
  | { kind: 'examples'; actorId: string }
  | { kind: 'channel'; channelId: string }
  | { kind: 'setting'; part: 'framing' | 'tone' }
  | { kind: 'goal'; goalId: string }
  /**
   * The guidance slot — [03 §5.1]. `producer` because one slot has several
   * producers — the user's box, a rule's `giveGuidance`, a Narrative Director
   * push — and the workbench should say which.
   */
  | { kind: 'guidance'; producer: 'user' | 'rule' | 'step' }
  /** What the player just did — the turn that is happening, not history. */
  | { kind: 'input' }
  // The two a slot can never name, because no preset positions them.
  | { kind: 'preset'; blockId: string }
  | { kind: 'step'; stepId: string };

/**
 * A call's declared appetite — [03 §6]. `effects` and `verdict` are the two
 * that may not see advisory content. (`CallPurpose`, not `CallKind` — that
 * name is taken by the portable `appliesTo` vocabulary in `schema/preset`.)
 */
export type CallPurpose = 'prose' | 'effects' | 'verdict';

/**
 * Why a slot collected nothing — [P3.0], the [P3 §7.5] decision. A class, not
 * prose, per the rule progress events are held to: the panel maps class to
 * sentence, and nothing durable grows another free-English field.
 *
 * - `disabled` — the author switched the block off.
 * - `not-applicable` — `appliesTo` excludes this call's kind.
 * - `no-producer` — the source has no producer at this phase (lore is P5,
 *   goals are Setup-borne, a channel has no text renderer…).
 * - `empty-source` — the producer ran and yielded nothing: an empty guidance
 *   box, an empty cast, a first turn with no history.
 * - `unknown-slot` — a slot kind from a newer build, skipped rather than
 *   thrown.
 */
export type NotFilledReason =
  'disabled' | 'not-applicable' | 'no-producer' | 'empty-source' | 'unknown-slot';

/**
 * A preset block that emitted no candidate — the record's answer to *why is
 * there no lore in this prompt*. A **second list** beside the blocks, never a
 * third `included` state: a slot that produced nothing has no text, no tokens
 * and no budget ruling, so `blocks` keeps meaning exactly *what was
 * assembled*.
 */
export interface NotFilledSlot {
  /** The preset block that positioned the slot. */
  blockId: string;
  /**
   * The slot's source kind — `'preset'` for a skipped text block, the
   * foreign word itself for an `unknown-slot`.
   */
  source: BlockSource['kind'] | (string & {});
  reason: NotFilledReason;
}

/** A candidate the budgeter has ruled on — [02 §8]. */
export interface AssembledBlock {
  id: string;
  source: BlockSource;
  /** Why it is here, in the words the workbench shows — a product feature, not a debug string. */
  reason: string;
  role: 'system' | 'user' | 'assistant';
  text: string;
  /** The estimate that decided; the measured figure is per call, on `usage`. */
  tokens: number;
  included: boolean;
  /** Which budget rule dropped it. Absent when it was included. */
  droppedBy?: string;
  /**
   * Carried from the candidate ([P3.0]): with `purpose` on the call, this is
   * what makes [testing §1]'s invariant — no advisory block in an
   * effect-producing call — expressible over a committed record. Absent means
   * not advisory.
   */
  advisory?: true;
}

/**
 * The window a turn may spend, and the honest account of where it came from —
 * [13 §1.5], reshaped by [P3.0]. `source` names the origin of the **ceiling**
 * — whichever side won: the endpoint's declared window, the preset's absolute
 * cap, or the config default (`'user'`, live-editable). The preset's
 * `contextShare` narrows the ceiling to `tokens` without relabelling it.
 *
 * Invariants: `share` present ⇒ a preset budget was in play and
 * `tokens === floor(ceiling × share)`; absent ⇒ `tokens === ceiling`.
 */
export interface BudgetLimit {
  /** The spendable window the budgeter enforces. */
  tokens: number;
  /** The resolved window before the share narrowed it. */
  ceiling: number;
  source: 'provider' | 'preset' | 'user';
  /** The preset's contextShare, when one applied. */
  share?: number;
}

/** [13 §1.5]. */
export interface BudgetVerdict {
  limit: BudgetLimit;
  /** Held back for the completion. */
  reserved: number;
  spent: number;
  /**
   * Ordered as considered. **Every block appears, including the included
   * ones** — a verdict listing only drops cannot answer "what falls out next".
   */
  decisions: {
    blockId: string;
    tokens: number;
    included: boolean;
    /** The rule, in the language the workbench shows. */
    rule: string;
  }[];
  /**
   * What would drop on the next turn at current pressure. The UI promises this
   * is answerable *before* it happens, which requires computing it.
   */
  nextToDrop: string[];
}

/**
 * One model call — [13 §1.4].
 *
 * `resolved` records what the role actually became, because the binding can
 * change between turns and *"why is this turn different"* needs an answer.
 * **It carries the connection's id and never the connection** — a
 * `Connection` holds `apiKey` and `baseUrl`, and this record is a line in a
 * JSONL file on somebody's disk.
 */
export interface ModelCall {
  id: string;
  stepId: string;
  role: ModelRole;
  /**
   * What this call was allowed to produce — the committed half of
   * [testing §1]'s invariant, beside `advisory` on the block ([P3.0]). Not
   * derivable after the fact: it is computed from the step's declared
   * `contributes` and `writes`, and `StepOutcome` records neither — only
   * their counts.
   */
  purpose: CallPurpose;
  resolved: { connectionId: string; modelId: string };
  /**
   * The blocks this call assembled and the verdict that ruled them — [P3.0],
   * making [05 §3]'s *"one per model call"* the shape rather than a promise.
   * The turn's blocks are a derived union — readers fold over
   * `request.calls`; nothing stores the union. Non-null by construction: a
   * `ModelCall` exists only downstream of assembly, including the provisional
   * in-flight entry the runner checkpoints before dispatch.
   */
  blocks: AssembledBlock[];
  budget: BudgetVerdict;
  /**
   * The preset blocks that emitted nothing for this call, each with a reason
   * class — [P3.0]'s §7.5 decision. Empty when a step supplied its own
   * candidates: the preset was not consulted, so it honestly has nothing to
   * say.
   */
  notFilled: NotFilledSlot[];
  messages: RenderedMessage[];
  params: GenerationParams;
  /** Provider-reported, or null. Never estimated — the estimate decides, the measurement records. */
  usage: TokenUsage | null;
  cost: { amount: number; currency: string } | null;
  wallMs: number;
  /**
   * Why the model stopped — the field that tells a *truncated* answer from a
   * finished one. Null on a call that never returned.
   */
  finishReason: FinishReason | null;
  /**
   * `refused` is a provider content filter; `truncated` a ceiling reached;
   * `incomplete` a stream that stopped without saying why; `cancelled` a
   * person's Stop landing mid-call (finding 2 in [16]) — not an `error`,
   * because nothing failed. There is deliberately **no un-sent value**: that
   * arrives with P3.7's dry run.
   */
  outcome: 'ok' | 'refused' | 'truncated' | 'incomplete' | 'error' | 'cancelled';
  /** Classified, so the UI can offer the right recovery rather than a provider string. */
  error: { class: ErrorClass; message: string } | null;
  retries: number;
}

/**
 * Why a step failed, in the vocabulary a client can act on. The provider's
 * own words go to the log; a class is what crosses to a reader.
 */
export type StepFailureReason =
  ErrorClass | 'cancelled' | 'advisory-leak' | 'unbound' | 'dangling' | 'internal';

/** Why a step did not run. [03 §6]'s three condition arms, from the other side. */
export type StepSkipReason = 'cadence' | 'stage' | 'not-armed';

export type StepStage = 'pre' | 'assemble' | 'generate' | 'extract' | 'post';

/**
 * What one step did — the durable counterpart of the `step.*` progress
 * events. [04 §3.3] opens by saying the live view **is** the turn record
 * being built, which only holds if every progress event has somewhere durable
 * to land.
 */
export interface StepOutcome {
  stepId: string;
  stage: StepStage;
  state: 'ok' | 'skipped' | 'failed';
  /** How the definition declared a failure should be handled. */
  failure?: 'abort' | 'warn' | 'ignore';
  skipReason?: StepSkipReason;
  error?: { reason: StepFailureReason; message: string };
  contributed: { blocks: number; effects: number };
  wallMs: number;
}

/**
 * What was assembled and asked for — [02 §8]'s `request`.
 *
 * Just the calls since [P3.0]: each carries its own blocks and verdict, so a
 * turn-level table would be either a copy or a lie. Absent on the turn when
 * nothing was assembled — *absent* and *empty* are different claims.
 */
export interface TurnRequest {
  calls: ModelCall[];
}

/**
 * The turn's totals — null means *nobody counted*, which is a different claim
 * from *counted, and it was nothing*. A cancelled turn's `{promptTokens: 0}`
 * was the bug; the cost view owes *unknown* a rendering distinct from *free*.
 */
export interface TurnCost {
  promptTokens: number | null;
  completionTokens: number | null;
  wallMs: number;
  /** The model that answered last, or null when nothing was called. */
  model: string | null;
}

/**
 * One effect on one channel — [13 §1.2], the most load-bearing type in that
 * document. It carries reversibility, it crosses the worker boundary, it is
 * what a branch replays and what undo inverts — which is why `before` is
 * stored rather than derived.
 */
export interface ChannelEffect {
  id: string;
  turnId: string;
  channelId: string;
  /** Which value, when the channel is scoped per actor or per entry. */
  scopeKey: string | null;
  op: EffectOp;
  /** State before, for exactly the keys this effect touched. */
  before: unknown;
  after: unknown;
  /** Who proposed it, and who decided. */
  proposedBy:
    | { kind: 'model'; callId: string }
    | { kind: 'step'; stepId: string }
    | { kind: 'user' }
    | { kind: 'engine' };
  applied: boolean;
  /**
   * Present when `applied` is false. The two shipped refusals are classes —
   * `'engine-computed'` and `'user-only'` name *which* update policy refused,
   * plus `'unknown-channel'` ([P3.0]). Open vocabulary for extensions.
   */
  rejectedReason: string | null;
  /**
   * The effect this one replaced — [P3.0], and [05 §3]'s third outcome: when
   * the engine's own computation lands on a channel a same-turn proposal was
   * refused for, this carries the refusal's id. Null is data: this effect
   * superseded nothing.
   */
  supersedes: string | null;
  channelVersion: number;
  /**
   * Whether the effect stayed inside the session or escaped it. **P2 writes
   * only `session`** — the field exists so P6 needs a field rather than a
   * migration.
   */
  scope: 'session' | 'escaped';
}

export type EffectOp =
  | { type: 'set'; path: string }
  | { type: 'merge'; path: string }
  | { type: 'delete'; path: string }
  | { type: 'append'; path: string }
  | { type: 'increment'; path: string; by: number };

/** [13 §1.3]. */
export interface ChannelState {
  /** Which schema version the value was written against. */
  version: number;
  value: unknown;
  /**
   * Set when load-time validation failed and the value was quarantined.
   *
   * **No writer exists yet, and that is a recorded decision** ([P3.0]):
   * `ChannelDefinition` ships without `schema` ([13 §6] refuses to invent it
   * ahead of the mode contract), so a guard on a validation that cannot fail
   * would be dead code impersonating a mechanism. The writer arrives with the
   * first `ChannelDefinition.schema`; the panel renders the field whenever
   * present.
   */
  degraded?: { reason: string; raw: unknown };
}

/**
 * One turn, as it is written to a segment — [02 §8].
 *
 * `parentTurnId` from the very first turn: the turn store is a tree that P2
 * happens to use linearly. `request`, `output`, `cost` and `steps` are
 * **absent rather than empty when nothing happened** — an empty `request` on
 * a turn that never assembled would be a record claiming a prompt was built,
 * and the workbench renders the difference.
 */
export interface Turn {
  id: string;
  sessionId: string;
  /** Null for the first turn of a session. Every other turn names its parent. */
  parentTurnId: string | null;
  createdAt: string;
  status: 'complete' | 'failed' | 'suspended';
  input?: { actorId: string | null; kind: string; text: string; raw: string };
  output?: { text: string; reasoning?: string };
  request?: TurnRequest;
  cost?: TurnCost;
  steps?: StepOutcome[];
  effects: ChannelEffect[];
  /** Every draw the turn consumed, keyed by site ([07 §14.6]). */
  tape: Tape;
  /** A tombstone the reader skips. */
  removed?: true;
}
