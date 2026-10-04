// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { outputMessagesOf } from '@storyengine/shared';

import { writeJsonAtomic } from '../storage/atomic.js';
import {
  indexWrittenSession,
  readSession,
  readTurnById,
  sessionFilePath,
  withSessionLock,
  type SessionContext,
} from './store.js';
import type { SessionFile } from './types.js';

/**
 * ***Hide and unhide*** — [P14 §1.6](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
 * last mutable gesture, built at [P14.4]: SillyTavern's `is_system` and
 * Marinara's `hiddenFromAI`, as `session.hidden`.
 *
 * **What one turn's entry becomes**: `true` hides the turn whole — its input
 * and every message — and a list hides those message indices, by
 * `outputMessagesOf`'s numbering, which is how the history filter reads them
 * (`assembly/collect.ts`, `visibleMessages`; P14.3). `false` or an empty list
 * clears the entry, which is unhiding: *no entry* and *an empty list* already
 * read the same (`chatSettingsOf`'s `hiddenOf`), so the file keeps only the
 * first.
 *
 * ***Set rather than toggled***, so a retried request lands where the first
 * one did and two tabs agree on what they asked for. The client sends the
 * turn's whole entry — hiding a second message sends both indices — which
 * costs it one read it already has on screen.
 */
export type HiddenEntry = true | false | readonly number[];

export type HiddenOutcome =
  | { kind: 'written'; session: SessionFile }
  | { kind: 'no-session' }
  | { kind: 'no-turn' }
  /** An index the turn has no message at. */
  | { kind: 'no-message'; index: number };

/**
 * Writes one turn's hide entry, **under the session's lock**, which is the
 * whole of its concurrency story: a turn committing meanwhile reads and writes
 * the session file under the same lock, so neither write can lose the other.
 *
 * ***Not refused while a turn is in flight***, unlike a head move. A hide
 * changes no node and no channel — nothing a running turn's commit could
 * orphan — and the running turn assembled its history before it started, so
 * the change reaches the next one, which is what hiding a line mid-reply
 * means.
 *
 * *The turn must be this session's*, read through the session's own index,
 * so an id from another session is `no-turn` rather than a key nobody would
 * ever read; and an index must name a message the turn has, because an entry
 * past the end is a hide that silently hides nothing.
 */
export async function setHidden(
  context: SessionContext,
  handle: string,
  sessionId: string,
  turnId: string,
  entry: HiddenEntry,
): Promise<HiddenOutcome> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return { kind: 'no-session' };
    const turn = await readTurnById(context, handle, sessionId, turnId);
    if (turn === null) return { kind: 'no-turn' };

    const indices =
      entry === true || entry === false ? [] : [...new Set(entry)].sort((a, b) => a - b);
    const count = outputMessagesOf(turn.output).length;
    const past = indices.find((index) => index >= count);
    if (past !== undefined) return { kind: 'no-message', index: past };

    // Rebuilt without this turn's entry rather than deleted from, then given
    // the new one — the same map, with no key removed by name.
    const hidden: Record<string, true | number[]> = Object.fromEntries(
      Object.entries(session.hidden ?? {}).filter(([id]) => id !== turnId),
    );
    if (entry === true) hidden[turnId] = true;
    else if (indices.length > 0) hidden[turnId] = indices;

    const next: SessionFile = { ...session, updatedAt: new Date().toISOString() };
    // Absent rather than `{}` when nothing is hidden, the record's usual shape
    // for *none* — and what a session that never hid anything already holds.
    if (Object.keys(hidden).length === 0) delete next.hidden;
    else next.hidden = hidden;
    await writeJsonAtomic(sessionFilePath(context.layout, handle, sessionId), next);
    indexWrittenSession(context, handle, next);
    return { kind: 'written', session: next };
  });
}
