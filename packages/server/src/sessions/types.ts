// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ChannelState, Preset } from '@storyengine/shared';

/**
 * Sessions and turns on disk — [02 §5.5](../../../../docs/design/02-data-model.md),
 * [13 §1](../../../../docs/design/13-internal-contracts.md).
 *
 * **The turn record's shapes live in `@storyengine/shared` since [P3.0]** —
 * `packages/shared/src/turn.ts`, which carries the contracts' documentation
 * and the internal-tier argument (free to migrate until session export makes
 * a stored turn portable). They moved *after* the P3.0 repairs landed, per
 * §1.9's rule: the promise to stop churning the shapes is only keepable once
 * they have stopped churning. This module re-exports them so the server's
 * import paths stay put, and keeps the one shape that never crosses:
 * `SessionFile` describes a file on this install's disk, and the client reads
 * a projection of it through the routes rather than the file's own type.
 */
export type {
  AssembledBlock,
  BlockSource,
  BudgetLimit,
  BudgetVerdict,
  CallPurpose,
  ChannelEffect,
  ChannelState,
  EffectOp,
  ModelCall,
  NotFilledReason,
  NotFilledSlot,
  StepFailureReason,
  StepOutcome,
  StepSkipReason,
  StepStage,
  Turn,
  TurnCost,
  TurnRequest,
} from '@storyengine/shared';

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
