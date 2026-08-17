// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { GenerationParams } from '@storyengine/shared';

import type { AssembledBlock, BudgetVerdict } from '../assembly/types.js';
import type { ErrorClass, ModelRole, RenderedMessage, TokenUsage } from '../providers/types.js';
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
 * actor mention until there is a cast — which is P2.6's. Naming it here rather
 * than leaving the omission to be rediscovered.
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
  resolved: { connectionId: string; modelId: string };
  messages: RenderedMessage[];
  params: GenerationParams;
  /** Provider-reported, or null. Never estimated — the estimate decides, the measurement records. */
  usage: TokenUsage | null;
  cost: { amount: number; currency: string } | null;
  wallMs: number;
  /** `refused` has no producer at P2: no adapter reports a content refusal distinctly. */
  outcome: 'ok' | 'refused' | 'error';
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

/** What was assembled and asked for — [02 §8]'s `request`. */
export interface TurnRequest {
  blocks: AssembledBlock[];
  /** The verdict of the most recent assembly. Null until something is assembled. */
  budget: BudgetVerdict | null;
  calls: ModelCall[];
}

export interface TurnCost {
  promptTokens: number;
  completionTokens: number;
  wallMs: number;
  model: string;
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
  /** Present when `applied` is false. */
  rejectedReason: string | null;
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
  /** Set when load-time validation failed and the value was quarantined. */
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
