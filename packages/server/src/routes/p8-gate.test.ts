// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7, type Turn } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { appendTurnToSession } from '../sessions/store.js';
import { listSummaries } from '../sessions/summaries.js';
import { Layout } from '../storage/layout.js';
import { eventually, makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * **Gate step 1** — *a long session assembles inside budget with the chain in
 * place, and the workbench shows which summary links covered which turns* —
 * [P8 §3](../../../../docs/design/workplan/25-p8-implementation.md), [P8.1].
 *
 * ***Row 1a of §3.1, which is the half a test can hold.*** That table splits the
 * step: **1a** *a long session assembles with the chain in place* is AUTO over a
 * synthesised tree, and **1b** *the workbench shows it* is Standing, because a
 * mislabelled link is a rendering fix at any time. What makes 1b reachable at
 * all is a schema decision rather than a UI one — `BlockSource` gains a
 * `summary` arm, so the block table has something to show — and §3.1 says
 * covering the arm is cheaper than walking it. **This is that cover.**
 *
 * **Synthesised, and the word is load-bearing** ([P8 §0.2]). The forty-five
 * turns below are written straight through the store rather than played:
 * nothing in this project has ever played four hundred turns, and a scripted
 * tree **proves the chain, not the summary**. What can be asserted is that the
 * links exist, that they cover the turns above the window and no others, that
 * the record names them, and that the files on disk are the ones the record
 * points at. What cannot is whether any of it is worth reading, which is
 * PLAYABLE's question and sitting G's.
 *
 * ---
 *
 * **Why forty-five.** The window is twenty and the span is twenty, so a
 * forty-five-turn path has twenty-five coverable turns: **one complete link and
 * one still in progress.** Twenty-five turns would have produced a single
 * partial link, and a test with one link cannot tell an ordered chain from a
 * lucky singleton — the second link's `previousKey` is the whole claim that this
 * is a chain rather than a list.
 */

const PASSWORD = 'correct horse battery';
const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a08';

/** One distinctive sentence, so a summary block can only have come from the fake. */
const SUMMARISED = 'They had been walking north for some time.';

/** The mode's `historyWindow`, and `DEFAULT_SUMMARY_POLICY.span`. */
const WINDOW = 20;
const SPAN = 20;
const PAST = 45;

let dataDir: string;
let server: TestServer;
let sessionId: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-p8-gate-'));
  server = await makeTestServer({
    dataDir,
    providers: () => new FakeProvider({ script: [{ text: SUMMARISED }] }),
  });
  await setUpAdmin(server, 'ned', PASSWORD);

  const connections = new Layout(dataDir).userConnectionsRoot('ned');
  await mkdir(connections, { recursive: true });
  await writeFile(
    join(connections, 'fake.json'),
    JSON.stringify({
      id: CONNECTION_ID,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-hi'],
    }),
  );
  await writeFile(
    join(dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );

  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'The long road' },
  });
  sessionId = created.body.session.id;
});

afterEach(async () => {
  // Tolerated for `p6-gate.test.ts`'s reason: a test that failed early left its
  // server holding the sqlite handles, and the cleanup error would bury the
  // real failure under a second one.
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

/**
 * A line of `PAST` turns, written rather than played.
 *
 * Through `appendTurnToSession` — the store's own path, head and all — so the
 * session the route then takes a turn on is one the runner reads exactly as it
 * reads a played one. Each turn says something different, because a chain over
 * forty-five identical turns would share unit keys and the link boundaries would
 * stop being observable.
 */
async function aPast(): Promise<string> {
  let parent: string | null = null;
  for (let at = 0; at < PAST; at += 1) {
    const id = uuidv7();
    const turn: Turn = {
      id,
      sessionId,
      parentTurnId: parent,
      createdAt: new Date(Date.UTC(2026, 8, 2, 0, at)).toISOString(),
      status: 'complete',
      input: {
        actorId: null,
        kind: 'do',
        text: `She walked on, ${String(at)} days out.`,
        raw: `She walked on, ${String(at)} days out.`,
      },
      output: { text: `The road went on, and on the ${String(at)}th day it turned.` },
      effects: [],
      tape: [],
    };
    await appendTurnToSession(server.services.sessions, 'ned', sessionId, turn);
    parent = id;
  }
  if (parent === null) throw new Error('the past grew no head');
  return parent;
}

interface RecordedBlock {
  id: string;
  source: { kind: string; linkKey?: string; range?: [number, number] };
  included: boolean;
}

/**
 * Every block the last turn sent, across every call.
 *
 * **Across every call rather than `calls[0]`.** A summarising turn makes two —
 * the `pre` step's and the narration's — and the first has not been the
 * narration since the hook selector shipped. What this asks is *what did this
 * turn put in front of a model*, which is the union.
 *
 * Through the route the client reads, not off the segment files: gate step 1's
 * second clause is about **the workbench**, and the workbench sees what this
 * endpoint returns.
 */
async function blocksOfLastTurn(): Promise<RecordedBlock[]> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
  const turns = read.body.turns as { request?: { calls?: { blocks?: RecordedBlock[] }[] } }[];
  const last = turns.at(-1);
  if (last === undefined) throw new Error('the session committed no turn');
  return (last.request?.calls ?? []).flatMap((call) => call.blocks ?? []);
}

describe('a long session assembles with the chain in place', () => {
  it('names the links and which turns each covered', async () => {
    const head = await aPast();

    await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: 'p8-gate-1',
        headTurnId: head,
        input: { text: 'And then?' },
      },
    });
    await eventually(async () => {
      const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      return read.body.activeJob === null;
    });

    const blocks = await blocksOfLastTurn();

    /**
     * The floor. A record with no blocks at all would satisfy every `filter`
     * below, and a turn that failed before assembling is exactly how that
     * happens — so the history blocks are asserted first, as the thing that is
     * true of every turn this build has ever taken.
     */
    const fromHistory = blocks.filter((block) => block.source.kind === 'history');
    expect(fromHistory.length).toBeGreaterThan(0);

    const fromSummary = blocks
      .filter((block) => block.source.kind === 'summary')
      .map((block) => block.source);

    /**
     * ***Two links, and the ranges are the assertion.*** Forty-five turns on the
     * path, a window of twenty: indices 0..24 are coverable, so a span of twenty
     * gives one complete link over 0..19 and one still in progress over 20..24.
     * **Nothing inside the window is covered**, which is [P8.1]'s *deliberately
     * not built* — widening `historyWindow` to overlap the summary would make
     * two producers of the same turns and let the budgeter pick.
     */
    expect(fromSummary.map((source) => source.range)).toEqual([
      [0, SPAN - 1],
      [SPAN, PAST - WINDOW - 1],
    ]);

    // Distinct links, not the same one twice — which a `flatMap` over a shared
    // object would produce and a range assertion alone would not notice.
    expect(new Set(fromSummary.map((source) => source.linkKey)).size).toBe(2);

    /**
     * **And the record points at files that exist.** A `linkKey` the store does
     * not hold would mean the block table could name a link nobody can open —
     * which is [P8 §3.1] row 1b's whole premise, checked from the side a test
     * can reach.
     */
    const held = await listSummaries(server.services.layout, 'ned', sessionId);
    for (const source of fromSummary) expect(held.has(source.linkKey ?? '')).toBe(true);

    // The fake's sentence, so the blocks carry what the summariser produced
    // rather than an empty slot that happened to be positioned.
    expect(
      blocks.filter((block) => block.id.startsWith('se.summary.')).length,
    ).toBeGreaterThanOrEqual(2);
  });

  /**
   * ***The other half of gate step 1: inside budget.*** The summary competes
   * with lore and the actor card rather than with history ([P8 §5]), so the
   * assertion that matters is that the links were **included** rather than
   * trimmed — a chain that assembled and was then dropped whole would satisfy
   * every range assertion above while putting nothing in the prompt.
   */
  it('puts the chain in the prompt rather than merely in the record', async () => {
    const head = await aPast();
    await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'p8-gate-2', headTurnId: head, input: { text: 'And then?' } },
    });
    await eventually(async () => {
      const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      return read.body.activeJob === null;
    });

    const summary = (await blocksOfLastTurn()).filter((block) => block.source.kind === 'summary');

    expect(summary.length).toBeGreaterThan(0);
    expect(summary.every((block) => block.included)).toBe(true);
  });
});
