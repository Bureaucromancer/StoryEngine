// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RENDITION_SCHEMA, type Rendition } from '@storyengine/shared';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { FakeProvider } from '../providers/fake.js';
import { createSession } from '../sessions/store.js';
import { openState, type OpenedState } from '../state/open.js';
import { Layout } from '../storage/layout.js';
import { eventually } from '../test-server.js';
import { jobForRendition, reconcileRenditionJobs } from './jobs.js';
import { readRendition, writeRendition } from './store.js';
import { dispatchRenditions, recoverRenditions, type RenditionWorkerContext } from './worker.js';

/**
 * ***A rendition's record always has a job behind it, and an open page hears
 * it is coming*** (2026-09-27) — `dispatchRenditions`.
 *
 * The runner and the Illustrate route wrote a `pending` record and then claimed
 * its job, so a process that died between the two left a record no job row
 * named, and recovery, which reads job rows, never found it. P9 recorded the
 * window. The dispatch now claims first, and writes the record itself.
 *
 * `writeRendition` is wrapped, so a test can look at the job rows at the moment
 * a record is written, and can make one write fail.
 */
vi.mock('./store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store.js')>();
  return { ...actual, writeRendition: vi.fn(actual.writeRendition) };
});

const ACCOUNT = 'ned';

let dataDir: string;
let index: OpenedIndex;
let state: OpenedState;
/** A real session: the worker writes into a session only while it is there. */
let sessionId: string;
let context: RenditionWorkerContext;
let frames: Rendition['state'][];

beforeEach(async () => {
  // The real write, unless a test says otherwise. `mockReset` would leave an
  // empty function, and a record that is never written is a different test.
  const actual = await vi.importActual<typeof import('./store.js')>('./store.js');
  vi.mocked(writeRendition).mockReset().mockImplementation(actual.writeRendition);
  dataDir = await mkdtemp(join(tmpdir(), 'se-dispatch-'));
  index = await openIndex({ path: ':memory:' });
  sessionId = (
    await createSession({ layout: new Layout(dataDir), index: index.db }, ACCOUNT, 'Harbour')
  ).id;
  state = await openState({ path: ':memory:' });
  frames = [];
  context = {
    db: state.db,
    layout: new Layout(dataDir),
    providers: () => new FakeProvider({ script: [] }),
    // No connection makes pictures, so every job ends quickly, as `no-binding`.
    connectionFor: () => Promise.resolve(null),
    changed: (_sessionId, rendition) => {
      frames.push(rendition.state);
    },
    inFlight: new Set(),
  };
});

afterEach(async () => {
  await Promise.all([...(context.inFlight ?? [])]);
  state.close();
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

function pending(id: string): Rendition {
  return {
    schema: RENDITION_SCHEMA,
    id,
    sessionId: sessionId,
    turnId: 't-1',
    createdAt: '2026-09-27T10:00:00.000Z',
    kind: 'image',
    purpose: 'illustration',
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
      at: null,
      binding: { connectionId: 'c-1', modelId: 'sdxl' },
      answeredAs: null,
      seed: 7,
      workflow: {},
    },
    error: null,
    digest: 'd-1',
    ordering: 0,
  };
}

describe('a rendition dispatched', () => {
  it('has its job row before its record is on disk', async () => {
    const rowAtWrite: boolean[] = [];
    vi.mocked(writeRendition).mockImplementation(async (layout, account, sessionId, record) => {
      rowAtWrite.push(jobForRendition(state.db, record.id) !== null);
      const actual = await vi.importActual<typeof import('./store.js')>('./store.js');
      await actual.writeRendition(layout, account, sessionId, record);
    });

    await dispatchRenditions(context, ACCOUNT, sessionId, [pending('t-1.0')], 't-1');

    // The first write is the dispatch's; the worker's later ones do not count.
    expect(rowAtWrite[0]).toBe(true);
  });

  it('starts its job when the record landed and the write still threw', async () => {
    // The atomic writer stats after its rename, so a write can land and throw.
    vi.mocked(writeRendition).mockImplementationOnce(async (layout, account, session, record) => {
      const actual = await vi.importActual<typeof import('./store.js')>('./store.js');
      await actual.writeRendition(layout, account, session, record);
      throw new Error('the stat after the rename failed');
    });

    const result = await dispatchRenditions(context, ACCOUNT, sessionId, [pending('t-1.0')], 't-1');
    await eventually(() => Promise.resolve(frames.length >= 2));

    // Run, rather than abandoned under a record that says it is coming.
    expect(result.dispatched).toBe(1);
    expect(jobForRendition(state.db, 't-1.0')?.status).toBe('done');
  });

  it('is found by the next start if the process stops between the record and the run', async () => {
    // Stopped once the record is on disk and before its job runs: what a
    // process killed there leaves, and what recovery, reading job rows, has to
    // find. Before the job was claimed first, no row named this record.
    context.changed = () => {
      throw new Error('killed here');
    };
    await expect(
      dispatchRenditions(context, ACCOUNT, sessionId, [pending('t-1.0')], 't-1'),
    ).rejects.toThrow('killed here');
    expect(await readRendition(context.layout, ACCOUNT, sessionId, 't-1.0')).toMatchObject({
      state: 'pending',
    });

    const recovered = await recoverRenditions(context);

    expect(recovered).toEqual({ interrupted: 1, marked: 1 });
    expect(await readRendition(context.layout, ACCOUNT, sessionId, 't-1.0')).toMatchObject({
      state: 'failed',
      error: 'interrupted',
    });
  });

  it('gives its claim up when the record cannot be written, and starts nothing', async () => {
    vi.mocked(writeRendition).mockRejectedValueOnce(new Error('ENOSPC'));

    const result = await dispatchRenditions(context, ACCOUNT, sessionId, [pending('t-1.0')], 't-1');

    expect(result.dispatched).toBe(0);
    expect(frames).toEqual([]);
    // Abandoned, so a later retry is not answered *already in hand*.
    expect(jobForRendition(state.db, 't-1.0')?.status).toBe('abandoned');
    expect(reconcileRenditionJobs(state.db).interrupted).toEqual([]);
  });

  it('tells an open page it is pending before anything says it finished', async () => {
    await dispatchRenditions(context, ACCOUNT, sessionId, [pending('t-1.0')], 't-1');
    await eventually(() => Promise.resolve(frames.length >= 2));

    expect(frames).toEqual(['pending', 'failed']);
  });
});
