// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { uuidv7 } from '@storyengine/shared';

import { writeJsonAtomic } from '../storage/atomic.js';
import { ensureDirectory, listDirectoryNames, readFileBytes } from '../storage/files.js';
import { KeyedQueue } from '../storage/keyed-queue.js';
import type { Layout } from '../storage/layout.js';
import { resolveWithin } from '../storage/paths.js';
import { appendTurn, readAllTurns, type SegmentLimits, type TurnLocation } from './segments.js';
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
  return writes.run(`session:${sessionId}`, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) {
      throw new Error(`No session with id ${sessionId}.`);
    }

    const root = turnsRoot(context.layout, handle, sessionId);
    await context.layout.assertReal(root);
    const location = await appendTurn(root, turn, context.limits);

    const next: SessionFile = {
      ...session,
      updatedAt: new Date().toISOString(),
      headTurnId: turn.id,
      channels: applyEffects(session.channels, turn.effects),
    };
    await writeJsonAtomic(sessionFilePath(context.layout, handle, sessionId), next);

    return { location, session: next };
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
