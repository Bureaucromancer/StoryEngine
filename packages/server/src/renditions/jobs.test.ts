// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateState } from '../state/migrations.js';
import { enqueueRendition, jobForRendition } from './jobs.js';

/**
 * ***A rendition job is one per record, and a record is its session plus its
 * id*** — [06 §10.2](../../../../docs/design/06-modes-and-turn-pipeline.md).
 *
 * Rendition ids are `<turnId>.<n>`, and session import keeps turn ids, so a copy
 * of a session on the install that exported it holds records whose ids are the
 * original's. The falsifying mutation is keying the job by the id alone: the
 * copy's Illustrate would then be handed the original's job, and the worker —
 * which reads the record at the job's own session — would redraw the original
 * while the copy waited forever.
 */

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  migrateState(db);
});

afterEach(() => {
  db.close();
});

function ask(sessionId: string): ReturnType<typeof enqueueRendition> {
  return enqueueRendition(db, {
    sessionId,
    account: 'ned',
    renditionId: 'turn-1.0',
    turnId: 'turn-1',
    purpose: 'illustration',
  });
}

describe('queuing a picture', () => {
  it('returns the job already queued for the same record', () => {
    const first = ask('session-original');
    const again = ask('session-original');
    expect(again.id).toBe(first.id);
  });

  it('queues a separate job for the same id in another session', () => {
    const original = ask('session-original');
    const copy = ask('session-copy');

    expect(copy.id).not.toBe(original.id);
    expect(copy.sessionId).toBe('session-copy');
    expect(jobForRendition(db, 'session-copy', 'turn-1.0')?.id).toBe(copy.id);
    expect(jobForRendition(db, 'session-original', 'turn-1.0')?.id).toBe(original.id);
  });
});
