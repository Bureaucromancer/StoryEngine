// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RENDITION_SCHEMA, type Rendition } from '@storyengine/shared';

import { openState, type OpenedState } from '../state/open.js';
import { Layout } from '../storage/layout.js';
import { enqueueRendition, readRenditionJob } from './jobs.js';
import { readRendition } from './store.js';
import { dispatchRenditions, drainRenditions, type RenditionWorkerContext } from './worker.js';

/**
 * ***A job held by another session is never run for this one*** —
 * [P13.0](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * A rendition id is `${turnId}.${n}` and a job is unique by rendition id, so
 * while an imported copy shared the original's turn ids, an Illustrate on the
 * copy found the original's job and **ran it**: a paid render, the original's
 * picture overwritten, and — for a backdrop — a turn appended to the original's
 * session, which could be another account's. Import re-mints ids now; a copy
 * made before that, or a session folder copied by hand, can still collide, and
 * this is the guard for them.
 */

const ORIGINAL = '01900000-0000-7000-8000-00000000000a';
const COPY = '01900000-0000-7000-8000-00000000000b';
const TURN = '01900000-0000-7000-8000-000000000001';
const RENDITION = `${TURN}.0`;

let dataDir: string;
let state: OpenedState;
let context: RenditionWorkerContext;
let rendered = 0;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-rendition-dispatch-'));
  state = await openState({ path: ':memory:' });
  rendered = 0;
  context = {
    db: state.db,
    layout: new Layout(dataDir),
    providers: () => {
      rendered += 1;
      throw new Error('a render was attempted');
    },
    connectionFor: () => Promise.resolve(null),
    inFlight: new Set(),
  };
});

afterEach(async () => {
  state.close();
  await rm(dataDir, { recursive: true, force: true });
});

function pending(sessionId: string): Rendition {
  return {
    schema: RENDITION_SCHEMA,
    id: RENDITION,
    sessionId,
    turnId: TURN,
    createdAt: '2026-09-16T10:00:00.000Z',
    kind: 'image',
    purpose: 'background',
    scope: null,
    state: 'pending',
    prompt: {
      fragments: [{ id: 'moment', text: 'a lantern', rank: 100, required: true }],
      separator: ', ',
      budget: { maxChars: null, usefulChars: null },
      text: 'a lantern',
      kept: ['moment'],
      dropped: [],
      overCap: false,
    },
    asset: null,
    provenance: {
      at: '2026-09-16T10:00:02.000Z',
      binding: null,
      answeredAs: null,
      seed: 7,
      workflow: {},
    },
    error: null,
    digest: 'd-1',
    ordering: 0,
  };
}

describe('dispatching a rendition whose id another session already holds', () => {
  it('fails this session’s record and leaves the other session’s job alone', async () => {
    const held = enqueueRendition(state.db, {
      sessionId: ORIGINAL,
      account: 'ned',
      renditionId: RENDITION,
      turnId: TURN,
      purpose: 'background',
    });

    const result = dispatchRenditions(context, 'mara', COPY, [pending(COPY)], TURN);
    await drainRenditions(context);

    expect(result.dispatched).toBe(0);
    expect(rendered).toBe(0);
    expect(await readRendition(context.layout, 'mara', COPY, RENDITION)).toMatchObject({
      state: 'failed',
      error: 'terminal',
    });
    // Untouched: still waiting for its own session's worker, not marked by ours.
    expect(readRenditionJob(state.db, held.id)?.status).toBe(held.status);
  });
});
