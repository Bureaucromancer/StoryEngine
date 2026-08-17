// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { uuidv7 } from '@storyengine/shared';

import { writeJsonAtomic } from '../storage/atomic.js';
import { ensureDirectory, listDirectoryNames, readFileBytes } from '../storage/files.js';
import { KeyedQueue } from '../storage/keyed-queue.js';
import type { Layout } from '../storage/layout.js';
import { resolveWithin } from '../storage/paths.js';
import { divergenceEffects, divergenceTurn } from './channels.js';
import {
  appendTurn,
  readAllTurns,
  type SegmentLimits,
  type TurnLocation,
  walkPath,
} from './segments.js';
import type { ChannelEffect, ChannelState, SessionFile, Turn } from './types.js';

/**
 * Session storage — [02 §5.5](../../../../docs/design/02-data-model.md),
 * [02 §8.1](../../../../docs/design/02-data-model.md).
 *
 * The library's write path proved a thesis for objects; this is the sessions
 * half of it, and it is deliberately built on the *fixed* pattern rather than
 * beside it — the same per-key write queue, for the same reason. A turn append
 * and a head-snapshot write are a check-then-write sequence, and two of them
 * interleaving is how a head points at a turn that is not there.
 */

/** Serialises writes per session. Unrelated sessions never wait on each other. */
const writes = new KeyedQueue();

/**
 * Runs a task under one session's write lock.
 *
 * Exported because the turn-submission protocol
 * ([P2 §2.10](../../../../docs/design/workplan/04-p2-implementation.md)) runs *under the session's
 * keyed write queue* by name: it re-reads the head, decides, and reserves in a
 * sequence that means nothing if another writer can land between the read and
 * the decision. Sharing this queue is what makes "the head I checked" and "the
 * head I wrote against" the same head.
 *
 * **The lock is not reentrant**, so anything called from inside a task must be
 * an `…Locked` function rather than the public wrapper — which is why the pair
 * below is split the way it is.
 */
export function withSessionLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  return writes.run(`session:${sessionId}`, task);
}

export interface SessionContext {
  layout: Layout;
  /** Test seam; production uses the defaults. */
  limits?: SegmentLimits;
}

export function sessionRoot(layout: Layout, handle: string, sessionId: string): string {
  return layout.sessionRoot(handle, sessionId);
}

function sessionFilePath(layout: Layout, handle: string, sessionId: string): string {
  return resolveWithin(sessionRoot(layout, handle, sessionId), 'session.json');
}

function turnsRoot(layout: Layout, handle: string, sessionId: string): string {
  return resolveWithin(sessionRoot(layout, handle, sessionId), 'turns');
}

export async function createSession(
  context: SessionContext,
  handle: string,
  name: string,
): Promise<SessionFile> {
  const now = new Date().toISOString();
  const session: SessionFile = {
    schema: 'storyengine.session/1',
    id: uuidv7(),
    name,
    createdAt: now,
    updatedAt: now,
    headTurnId: null,
    channels: {},
  };

  const root = sessionRoot(context.layout, handle, session.id);
  await ensureDirectory(root);
  await context.layout.assertReal(root);
  await writeJsonAtomic(sessionFilePath(context.layout, handle, session.id), session);

  return session;
}

export async function readSession(
  context: SessionContext,
  handle: string,
  sessionId: string,
): Promise<SessionFile | null> {
  const path = sessionFilePath(context.layout, handle, sessionId);
  await context.layout.assertReal(path);

  const bytes = await readFileBytes(path);
  if (bytes === null) return null;

  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== 'object' || value === null) return null;
    const session = value as SessionFile;
    return typeof session.id === 'string' ? session : null;
  } catch {
    return null;
  }
}

export async function listSessions(context: SessionContext, handle: string): Promise<string[]> {
  return listDirectoryNames(context.layout.sessionsRoot(handle));
}

/**
 * Appends a turn and advances the head.
 *
 * The order is deliberate and matches the library's: **write the durable thing
 * first, then the derived one.** A turn that is on disk with a head that has not
 * caught up is a recoverable state — the head is a snapshot and can be
 * recomputed. The reverse is a head pointing at a turn nobody wrote.
 */
export async function appendTurnToSession(
  context: SessionContext,
  handle: string,
  sessionId: string,
  turn: Turn,
): Promise<{ location: TurnLocation; session: SessionFile }> {
  return withSessionLock(sessionId, () => appendTurnLocked(context, handle, sessionId, turn));
}

/**
 * The body of the append, for a caller that already holds the session lock.
 *
 * **It is the two halves below, composed** — which is the point rather than an
 * implementation detail. The commit protocol
 * ([P2 §2.10](../../../../docs/design/workplan/04-p2-implementation.md)) must be able to be
 * interrupted *between* the append and the head advance and resume from either,
 * so the two have to be separately callable. Building the ordinary path out of
 * the same two pieces is what stops the recoverable version from drifting into a
 * second implementation of appending a turn.
 */
export async function appendTurnLocked(
  context: SessionContext,
  handle: string,
  sessionId: string,
  turn: Turn,
): Promise<{ location: TurnLocation; session: SessionFile }> {
  const location = await appendTurnOnly(context, handle, sessionId, turn);
  const session = await advanceHead(context, handle, sessionId, turn);
  if (session === null) throw new Error(`No session with id ${sessionId}.`);
  return { location, session };
}

/**
 * Writes the turn to a segment and touches nothing else.
 *
 * **The durable thing before the derived one**, which is the same order the
 * library's write path uses and for the same reason: a turn on disk with a head
 * that has not caught up is recoverable, because the head is a snapshot. A head
 * pointing at a turn nobody wrote is not.
 */
export async function appendTurnOnly(
  context: SessionContext,
  handle: string,
  sessionId: string,
  turn: Turn,
): Promise<TurnLocation> {
  const root = turnsRoot(context.layout, handle, sessionId);
  await context.layout.assertReal(root);
  return appendTurn(root, turn, context.limits);
}

/**
 * Points the head at a turn that is already on disk, applying its effects.
 *
 * Idempotent by construction: it *sets* rather than advances, and the channel
 * map is recomputed from the turn's effects rather than mutated by them, so
 * running it twice produces the state it produced the first time. That is what
 * makes step 3 of the commit protocol safe to resume without knowing whether it
 * already ran.
 */
export async function advanceHead(
  context: SessionContext,
  handle: string,
  sessionId: string,
  turn: Turn,
): Promise<SessionFile | null> {
  const session = await readSession(context, handle, sessionId);
  if (session === null) return null;

  const next: SessionFile = {
    ...session,
    updatedAt: new Date().toISOString(),
    headTurnId: turn.id,
    channels: applyEffects(session.channels, turn.effects),
  };
  await writeJsonAtomic(sessionFilePath(context.layout, handle, sessionId), next);
  return next;
}

/**
 * Reconciles a hand-edited `session.json` into the effect log — [02 §8.1].
 *
 * The load-time half of the rule. It replays the channels the log says are true
 * at head, compares them with what the file holds, and — if a person has been in
 * there — appends a turn whose effects carry their edit, attributed to them.
 *
 * **This is why the file may be edited at all.** [05 §4](../../../../docs/design/05-ui-surfaces.md)
 * promises that editing your own data on disk works, and without this it would
 * work for library objects and silently not for sessions: the next head advance
 * would recompute `channels` from the log and the edit would vanish with no
 * error, which is the worst of the three possible behaviours.
 *
 * Returns the effects it recorded — empty when the file and the log agree, which
 * is the ordinary case and costs one replay.
 */
export async function reconcileHandEdits(
  context: SessionContext,
  handle: string,
  sessionId: string,
): Promise<ChannelEffect[]> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return [];

    const turns = await readTurns(context, handle, sessionId);
    const replayed = replayChannels(walkPath(turns, session.headTurnId));

    const effects = divergenceEffects(session.headTurnId ?? '', replayed, session.channels);
    if (effects.length === 0) return [];

    const turn = divergenceTurn(sessionId, session.headTurnId, effects);
    await appendTurnOnly(context, handle, sessionId, turn);
    await advanceHead(context, handle, sessionId, turn);
    return turn.effects;
  });
}

/**
 * Applies a turn's effects to a channel map.
 *
 * Only `applied` effects change anything: a rejected effect is part of the
 * record — the model tried to give itself 40 gold and the engine said no — and
 * replaying it would apply what was refused.
 *
 * `escaped` effects are recorded and never replayed, because a library write or
 * a generated asset is not something a branch can un-write.
 */
export function applyEffects(
  channels: Record<string, ChannelState>,
  effects: readonly ChannelEffect[],
): Record<string, ChannelState> {
  let next = { ...channels };

  for (const effect of effects) {
    if (!effect.applied || effect.scope === 'escaped') continue;

    if (effect.op.type === 'delete') {
      // Rebuilt without the key rather than deleted from: the map is a value
      // here, and a channel that was removed on one branch must not disappear
      // from a map another branch is still replaying against.
      const { [effect.channelId]: removed, ...rest } = next;
      void removed;
      next = rest;
      continue;
    }

    next[effect.channelId] = {
      version: effect.channelVersion,
      value: effect.after,
    };
  }

  return next;
}

/**
 * The channel state at a turn, replayed from zero.
 *
 * P2 has no snapshot *cache* — that is P6's, and it is an optimisation rather
 * than a mechanism ([09 §4](../../../../docs/design/09-branching.md)). What
 * matters now is that the head in `session.json` is **derived**: this function
 * is the thing it is derived from, and deleting the file must cost a
 * recomputation and nothing else.
 */
export function replayChannels(path: readonly Turn[]): Record<string, ChannelState> {
  let channels: Record<string, ChannelState> = {};
  for (const turn of path) {
    channels = applyEffects(channels, turn.effects);
  }
  return channels;
}

/**
 * Every turn on disk for a session, by id.
 *
 * The cold read. P2.3's index rows make the hot path cheap; this is what a
 * rebuild — or a deleted index — falls back to, and it is why deleting the
 * index stays a non-event for sessions as well as for the library.
 */
export async function readTurns(
  context: SessionContext,
  handle: string,
  sessionId: string,
): Promise<Map<string, Turn>> {
  const root = turnsRoot(context.layout, handle, sessionId);
  const found = await readAllTurns(root);
  return new Map(found.map(({ turn }) => [turn.id, turn]));
}
