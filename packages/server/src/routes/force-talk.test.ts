// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, uuidv7 } from '@storyengine/shared';

import { registerMode } from '../mode-registry.js';
import { FakeProvider } from '../providers/fake.js';
import { Layout } from '../storage/layout.js';
import { ENSEMBLE_MODE, ENSEMBLE_MODE_ID } from '../test-mode.js';
import { makeTestServer, setUpAdmin, type SseFrame, type TestServer } from '../test-server.js';

/**
 * ***Force-talk, through the route*** — `POST /sessions/:id/turns` with
 * `speakers`, [P13 §1.3](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * built at [P13.1].
 *
 * ST's member *speak* button and `/trigger`, Marinara's `forCharacterId`: a
 * person names who should reply, and that overrides whatever the session's
 * speaker policy would have chosen. What only the route can show is the
 * **door**: the three refusals are 422s naming their class before any job
 * exists, the check is made at the node the turn will answer at rather than at
 * whatever the head happens to be, and a name that passes reaches the step.
 *
 * *Played on the ensemble fixture*, whose step echoes the speakers it was
 * handed — the one way a selection is observable from outside, since a merged
 * call names nobody by design. Its policy is `list` and nobody is written
 * present, so **every speaker a turn here names was forced**: under the old
 * reading of presence the fixture's own policy answers an empty room.
 */

let server: TestServer;
let sessionId: string;
let vera: string;
let lund: string;
let ned: string;

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a07';

/**
 * ***How long a whole turn may take to say it has finished*** — the budget
 * `sessions.test.ts` settled on for a loaded CI leg, for the same reason.
 */
const TURN_FINISHES_MS = 8_000;

const finished = (frame: SseFrame): boolean =>
  frame.event === 'progress' && (frame.data as { key: string }).key === 'turn.finished';

async function anActor(name: string): Promise<string> {
  const actor = newActor(name);
  const created = await server.request({
    method: 'POST',
    url: '/api/library/actors',
    payload: actor,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return actor.id;
}

beforeEach(async () => {
  // Additive and process-wide, as `runner.test.ts` explains for the same
  // fixture: nothing else names this id.
  registerMode(ENSEMBLE_MODE);
  server = await makeTestServer({
    providers: () => new FakeProvider(),
    config: {
      sessions: { snapshotEveryNTurns: 10, streamKeepaliveMs: 15000, streamCoalesceMs: 0 },
    },
  });
  await setUpAdmin(server, 'ned');

  const root = new Layout(server.dataDir).userConnectionsRoot('ned');
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'fake.json'),
    JSON.stringify({
      id: CONNECTION_ID,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-hi'],
    }),
  );
  await writeFile(
    join(server.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );

  vera = await anActor('Vera');
  lund = await anActor('Lund');
  ned = await anActor('Ned');
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: {
      name: 'Ensemble',
      mode: ENSEMBLE_MODE_ID,
      cast: { persona: ned, actors: [vera, lund] },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  sessionId = created.body.session.id as string;
});

afterEach(async () => {
  await server.dispose();
});

function submit(body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  return server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: uuidv7(), headTurnId: null, input: { text: 'Well?' }, ...body },
  });
}

/** Submits, waits for the turn, and returns who its step said it spoke for. */
async function forcedTurn(
  body: Record<string, unknown>,
): Promise<{ id: string; chosen: string[] }> {
  const submitted = await submit(body);
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);
  // The stream the reply hands back, which starts at this job — so the frame
  // waited for is this turn's and never an earlier one's.
  const stream = await server.stream({ url: submitted.body.stream as string });
  await stream.until(finished, TURN_FINISHES_MS);
  await stream.abort();

  const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
  const turn = (turns.body.turns as { id: string; output?: { text: string } }[]).find(
    (one) => one.id === submitted.body.turnId,
  );
  // Landed, and said something — so an empty `chosen` below is the step being
  // handed nobody, never the turn not being found.
  expect(turn?.output?.text.startsWith('['), 'the turn is on the record').toBe(true);
  const said = turn?.output?.text ?? '';
  const inside = said.slice(1, said.indexOf(']'));
  return { id: submitted.body.turnId as string, chosen: inside === '' ? [] : inside.split(',') };
}

/** A person setting a channel, which is a bookkeeping turn that moves the head. */
async function setChannel(key: string, value: unknown): Promise<void> {
  const written = await server.request({
    method: 'PUT',
    url: `/api/sessions/${sessionId}/channels/${encodeURIComponent(key)}`,
    payload: { value },
  });
  expect(written.status, JSON.stringify(written.body)).toBeLessThan(300);
}

async function headOf(): Promise<string | null> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  return read.body.session.headTurnId as string | null;
}

async function turnCount(): Promise<number> {
  const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
  return (turns.body.turns as unknown[]).length;
}

describe('force-talk on submission', () => {
  it('answers with whoever was named, over the session’s policy', async () => {
    // Nobody is present, so the fixture's `list` answers an empty room — and
    // the forced turn answers with Lund, then Vera, in the order asked.
    const forced = await forcedTurn({ speakers: [lund, vera] });
    expect(forced.chosen).toEqual([lund, vera]);

    const unforced = await forcedTurn({ headTurnId: forced.id });
    expect(unforced.chosen).toEqual([]);
  });

  it('reaches a muted member, which is what the button is for', async () => {
    await setChannel(`se.presence#${vera}`, false);
    const forced = await forcedTurn({ headTurnId: await headOf(), speakers: [vera] });
    expect(forced.chosen).toEqual([vera]);
  });

  it('refuses the persona, with a 422 naming the class', async () => {
    const refused = await submit({ speakers: [vera, ned] });

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: 'speaker-is-persona', speaker: ned });
    // Before a job existed: nothing was reserved and nothing was written.
    expect(await turnCount()).toBe(0);
  });

  it('refuses somebody who is not in the cast', async () => {
    const stranger = await anActor('Stranger');
    const refused = await submit({ speakers: [stranger] });

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: 'speaker-not-in-cast', speaker: stranger });
  });

  it('refuses somebody the story has written out, dead or departed', async () => {
    await setChannel(`se.status#${vera}`, 'dead');
    await setChannel(`se.status#${lund}`, 'departed');
    const head = await headOf();

    for (const speaker of [vera, lund]) {
      const refused = await submit({ headTurnId: head, speakers: [speaker] });
      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({ error: 'speaker-written-out', speaker });
    }
  });

  /**
   * ***At the node, not at the head*** — status is per node, so a character
   * dead on the line being extended is alive on a branch written from before
   * they died, and `parentTurnId` is how a submission says which.
   */
  it('checks the node the turn answers at, so a branch from before a death may name them', async () => {
    const before = await forcedTurn({ speakers: [vera] });
    await setChannel(`se.status#${vera}`, 'dead');

    const atHead = await submit({ headTurnId: await headOf(), speakers: [vera] });
    expect(atHead.status).toBe(422);
    expect(atHead.body.error).toBe('speaker-written-out');

    const branched = await forcedTurn({ parentTurnId: before.id, speakers: [vera] });
    expect(branched.chosen).toEqual([vera]);
  });

  /**
   * ***A rewrite keeps who was forced, read off the record*** — [P13.1]. A
   * `rewriteOf` submission sends no `speakers` of its own, and force-talk is
   * not a draw, so before the turn recorded it the rewrite played the
   * fixture's policy over an empty room and answered with nobody. The route
   * now reads the redone turn's `input.speakers` and forces the rewrite with
   * them; a reroll reads nothing, and answers the empty room.
   */
  it('keeps who was forced on a rewrite, from the record, and not on a reroll', async () => {
    const forced = await forcedTurn({ speakers: [lund, vera] });
    const recorded = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/turns/${forced.id}`,
    });
    expect(recorded.body.turn.input.speakers).toEqual([lund, vera]);

    const rewrite = await forcedTurn({
      headTurnId: forced.id,
      parentTurnId: null,
      rewriteOf: forced.id,
    });
    expect(rewrite.chosen).toEqual([lund, vera]);

    const reroll = await forcedTurn({ headTurnId: rewrite.id, parentTurnId: null });
    expect(reroll.chosen).toEqual([]);

    // Sent beside `rewriteOf`, the body's list is the newer request and wins.
    const renamed = await forcedTurn({
      headTurnId: reroll.id,
      parentTurnId: null,
      rewriteOf: forced.id,
      speakers: [vera],
    });
    expect(renamed.chosen).toEqual([vera]);
  });

  it('refuses an empty or repeated list at the schema, as a malformed request', async () => {
    expect((await submit({ speakers: [] })).status).toBe(400);
    expect((await submit({ speakers: [vera, vera] })).status).toBe(400);
  });
});
