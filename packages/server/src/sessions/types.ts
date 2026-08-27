// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { GenerationParams, Preset } from '@storyengine/shared';

import type { AssembledBlock, BudgetVerdict, CallPurpose } from '../assembly/types.js';
import type {
  ErrorClass,
  FinishReason,
  ModelRole,
  RenderedMessage,
  TokenUsage,
} from '../providers/types.js';
import type { Tape } from '../rng/rng.js';

/**
 * Sessions and turns on disk — [02 §5.5](../../../../docs/design/02-data-model.md),
 * [13 §1](../../../../docs/design/13-internal-contracts.md).
 *
 * P2.3 wrote the shapes storage itself depends on; P2.5 fills in the rest of
 * [02 §8](../../../../docs/design/02-data-model.md)'s record — what was assembled, what was
 * called, what each step did, and what it cost.
 *
 * **`mentions` is the one field of §8 still absent**, and deliberately: it is
 * an overlay of resolved actor spans over `input.text` and `output.text`
 * ([03 §8.2](../../../../docs/design/03-modes-and-turn-pipeline.md)), and nothing resolves an
 * actor mention until there is a cast. P2.6 gives a session one, but resolving
 * mentions is an `extract` step ([03 §8.2]) — a *second* step, which [P2 §5]
 * fences to P7. Re-pointed there rather than left to be rediscovered.
 */

/**
 * One model call — [13 §1.4](../../../../docs/design/13-internal-contracts.md), verbatim.
 *
 * `resolved` records what the role actually became, because the binding can
 * change between turns and *"why is this turn different"* needs an answer.
 *
 * **It carries the connection's id and never the connection.** A `Connection`
 * holds `apiKey` and `baseUrl`, and this record is a line in a JSONL file on
 * somebody's disk — a spread here would write a credential into the story.
 */
export interface ModelCall {
  id: string;
  stepId: string;
  role: ModelRole;
  /**
   * What this call was allowed to produce — the committed half of
   * [testing §1](../../../../docs/design/workplan/10-testing.md)'s invariant,
   * beside `advisory` on the block ([P3.0]). Not derivable after the fact:
   * it is computed from the step's declared `contributes` and `writes`, and
   * `StepOutcome` records neither — only their counts.
   */
  purpose: CallPurpose;
  resolved: { connectionId: string; modelId: string };
  /**
   * The blocks this call assembled and the verdict that ruled them — [P3.0],
   * making [05 §3]'s *"one per model call"* the shape rather than a promise.
   * The runner used to keep one turn-level table that every call overwrote,
   * so an earlier call's block ids named rows no longer in it, and the
   * per-block estimate could never sit beside this call's reported usage.
   * The turn's blocks are a derived union now — readers fold over
   * `request.calls`; nothing stores the union.
   *
   * Non-null by construction: a `ModelCall` exists only downstream of
   * `assemble()`, including the provisional in-flight entry the runner
   * checkpoints before dispatch.
   */
  blocks: AssembledBlock[];
  budget: BudgetVerdict;
  messages: RenderedMessage[];
  params: GenerationParams;
  /** Provider-reported, or null. Never estimated — the estimate decides, the measurement records. */
  usage: TokenUsage | null;
  cost: { amount: number; currency: string } | null;
  wallMs: number;
  /**
   * Why the model stopped — [13 §1.4](../../../../docs/design/13-internal-contracts.md).
   *
   * The field that tells a *truncated* answer from a finished one, which is
   * otherwise invisible: a completion ceiling reached produces the same shape,
   * the same absence of an error, and a shorter reply that reads as a choice.
   * Null on a call that never returned.
   */
  finishReason: FinishReason | null;
  /**
   * `refused` now has a producer: a provider reporting a content filter.
   * `truncated` is a ceiling reached, and `incomplete` a stream that stopped
   * without saying why — neither is an error and neither is a clean answer,
   * and calling either `ok` is what made the local runtime's characteristic
   * failure look like a short reply.
   *
   * `cancelled` is a person's Stop landing mid-call — finding 2 in
   * [16](../../../../docs/design/workplan/16-p2c-log.md). Not an `error`,
   * because nothing failed; not absent, because the most-pressed button in a
   * manual phase was producing turns whose record could not say which model
   * had been asked.
   */
  outcome: 'ok' | 'refused' | 'truncated' | 'incomplete' | 'error' | 'cancelled';
  /** Classified, so the UI can offer the right recovery rather than a provider string. */
  error: { class: ErrorClass; message: string } | null;
  retries: number;
}

/**
 * Why a step failed, in the vocabulary a client can act on.
 *
 * The provider's own words go to the log ([07 §12.7] keeps that untranslated);
 * a class is what crosses to a reader.
 */
export type StepFailureReason =
  ErrorClass | 'cancelled' | 'advisory-leak' | 'unbound' | 'dangling' | 'internal';

/** Why a step did not run. [03 §6]'s three condition arms, from the other side. */
export type StepSkipReason = 'cadence' | 'stage' | 'not-armed';

export type StepStage = 'pre' | 'assemble' | 'generate' | 'extract' | 'post';

/**
 * What one step did — the durable counterpart of the `step.*` progress events.
 *
 * [04 §3.3](../../../../docs/design/04-server-multiuser-deployment.md) opens by saying the live
 * view **is** the turn record being built, which only holds if every progress
 * event has somewhere durable to land. Without this, `step.skipped` and
 * `step.failed` are live-only, and the history view silently disagrees with the
 * live one about what happened — the exact failure that section exists to
 * prevent.
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
 * turn-level table would be either a copy or a lie. The absent-vs-empty
 * doctrine below still applies to the field as a whole — a turn that never
 * assembled has no `request` at all.
 */
export interface TurnRequest {
  calls: ModelCall[];
}

/**
 * What the turn cost, in the units this build can actually count.
 *
 * **The token totals are null unless every call reported**, and that is the
 * whole design of this type. They used to be plain numbers summed over the calls
 * that happened to report, which meant a turn where nothing reported said
 * `promptTokens: 0` — a fabricated total, in a record whose sibling field
 * `ModelCall.cost` is hard-coded null specifically to avoid fabricating one.
 * [13 §1.4](../../../../docs/design/13-internal-contracts.md) is *provider-reported, not
 * estimated*, and a zero is an estimate with a confident face.
 *
 * **All-or-nothing rather than a partial sum**, because this is a *total*: a
 * total missing one of its terms is not a smaller total, it is wrong, and a
 * reader cannot see which. The partial truth is not lost — every `ModelCall`
 * carries its own `usage`, so a surface that wants *what we do know* reads the
 * calls rather than this.
 */
export interface TurnCost {
  /** Null unless every call reported. Never a sum over some of them. */
  promptTokens: number | null;
  /** Null unless every call reported. Never a sum over some of them. */
  completionTokens: number | null;
  /** Always real: measured here, not reported by anybody. */
  wallMs: number;
  /** The model that answered last, or null when nothing was called. */
  model: string | null;
}

/**
 * One effect on one channel — [13 §1.2](../../../../docs/design/13-internal-contracts.md).
 *
 * **The most load-bearing type in that document.** It carries reversibility, it
 * crosses the worker boundary, it is what a branch replays and what undo
 * inverts; an effect that cannot state its own inverse breaks all four at once.
 * Which is why `before` is stored rather than derived: undoing the tip means
 * applying `before`, not replaying 0..N−1.
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
   * Present when `applied` is false. The two shipped refusals are classes,
   * not one string, since [P3.0]: `'engine-computed'` and `'user-only'` name
   * *which* update policy refused, plus `'unknown-channel'` for an id nothing
   * declared. Open vocabulary — an extension's channel may refuse in its own
   * words.
   */
  rejectedReason: string | null;
  /**
   * The effect this one replaced — [P3.0], and [05 §3]'s third outcome. When
   * the engine's own computation lands on a channel a same-turn proposal was
   * refused for, this carries the refusal's id, so the panel can render
   * *overridden by an engine-computed rule* as a link rather than an
   * inference. Null is data: this effect superseded nothing.
   */
  supersedes: string | null;
  channelVersion: number;
  /**
   * Whether the effect stayed inside the session or escaped it. Escaped effects
   * are recorded like everything else but never replayed or reverted. **P2
   * writes only `session`** — the field exists so P6 needs a field rather than
   * a migration.
   */
  scope: 'session' | 'escaped';
}

export type EffectOp =
  | { type: 'set'; path: string }
  | { type: 'merge'; path: string }
  | { type: 'delete'; path: string }
  | { type: 'append'; path: string }
  | { type: 'increment'; path: string; by: number };

/** [13 §1.3](../../../../docs/design/13-internal-contracts.md). */
export interface ChannelState {
  /** Which schema version the value was written against. */
  version: number;
  value: unknown;
  /**
   * Set when load-time validation failed and the value was quarantined.
   *
   * **No writer exists yet, and that is a recorded decision rather than an
   * oversight** — [P3.0] §3(b) asked for "a writer-shaped home" and this is
   * the honest shape of one: `ChannelDefinition` ships without `schema`
   * ([13 §6] refuses to invent it ahead of the mode contract), so there is
   * nothing to validate against and a guard on a validation that cannot fail
   * would be dead code impersonating a mechanism. The writer arrives with the
   * first `ChannelDefinition.schema`, validating in `applyEffects` /
   * `replayChannels` and quarantining here. The panel renders the field
   * whenever present, so the reader half is already paid for.
   */
  degraded?: { reason: string; raw: unknown };
}

/**
 * One turn, as it is written to a segment.
 *
 * `parentTurnId` from the very first turn ([P2 §2.5]): the turn store is a tree
 * that P2 happens to use linearly, and retrofitting the edge at P6 would be a
 * migration where writing it now is a field.
 */
export interface Turn {
  id: string;
  sessionId: string;
  /** Null for the first turn of a session. Every other turn names its parent. */
  parentTurnId: string | null;
  createdAt: string;
  status: 'complete' | 'failed' | 'suspended';
  /**
   * What the player sent and what came back — [02 §8]'s `input` and `output`.
   *
   * The two searchable fields, which is why they land at P2.3 rather than with
   * the rest of the record: turn text goes into FTS **on write**
   * ([07 §7.1](../../../../docs/design/07-tech-stack.md)), and a field that arrives later
   * would mean either a reindex or a search that silently misses old turns.
   *
   * Both optional, and not out of laziness: a turn recording a hand edit to
   * `session.json` has neither ([02 §8.1]), and writing empty strings there
   * would be a record claiming an empty message was sent. `mentions` is the
   * one field of §8 still absent — see this module's header.
   */
  input?: { actorId: string | null; kind: string; text: string; raw: string };
  output?: { text: string; reasoning?: string };
  /**
   * What was assembled, called and run — all optional for the same reason.
   *
   * A hand-edit divergence turn made no request, ran no steps and cost nothing
   * ([02 §8.1]); an empty `request` there would be a record claiming a prompt
   * was built. Absent means *this never happened*, which is a different claim
   * from *this happened and was empty*, and the distinction is exactly what the
   * workbench renders.
   */
  request?: TurnRequest;
  cost?: TurnCost;
  steps?: StepOutcome[];
  /** Applied and rejected alike — a rejected effect is part of the record. */
  effects: ChannelEffect[];
  /** Every draw the turn consumed, keyed by site ([07 §14.6]). */
  tape: Tape;
  /**
   * A removed turn is a tombstone the reader skips, not a rewritten segment.
   * Nothing removes turns at 1.0; pruning a branch subtree does, and
   * retrofitting deletion into a format that assumed pure append is a
   * migration rather than a feature ([02 §5.5]).
   */
  removed?: true;
}

/**
 * `session.json` — metadata, cast, branch refs, and the head channel snapshot.
 *
 * **The snapshot is derived, not authoritative** ([02 §8.1]). A session is a
 * tree, so "the channel state of a session" is not a thing that exists: state
 * exists *at a node*. A single `channels` map here can therefore only mean
 * state at `headTurnId`, and deleting it must cost a recomputation and nothing
 * else. It is in the file at all because somebody will open it, and a session
 * file that cannot tell you what time it is in the story fails the legibility
 * promise the whole storage design rests on.
 */
export interface SessionFile {
  schema: 'storyengine.session/1';
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Null before the first turn. */
  headTurnId: string | null;
  /** State at `headTurnId`. Derived. Hand-editing it writes an effect. */
  channels: Record<string, ChannelState>;
  /**
   * Which mode this session plays, and how it was configured — [03 §1].
   *
   * Optional because every session written by P2.3 to P2.5 predates it, and a
   * read that healed the file would need the session lock, which is not
   * reentrant. Absent reads as the default mode.
   */
  mode?: { id: string; config: unknown };
  /**
   * The session's own copy of its prompt pack — [02 §8].
   *
   * **A copy, not a link**, and the asymmetry with `cast` is deliberate:
   * editing a preset must not silently change how an ongoing game is assembled,
   * while improving a character card *should* reach it.
   */
  preset?: Preset;
  /**
   * Who is in it. **Links, resolved fresh every turn** — see `preset` above for
   * why this one is the opposite.
   */
  cast?: { persona: string | null; actors: string[] };
  /**
   * Set when the session is archived — [02 §10.3].
   *
   * **Archive is not deletion**, and it is here because most sessions people
   * stop playing are not sessions they want gone; they are sessions they want
   * out of the way. Offering only Delete for that pushes people into a
   * destructive action to solve a cosmetic problem.
   *
   * A field in the file rather than a marker file or a directory move: it is
   * legible to somebody who opens `session.json`, it survives a copy, and — the
   * deciding reason — an archived session is *fully intact*, so moving it would
   * make "restorable, never swept" a second code path instead of a flag.
   */
  archivedAt?: string;
}
