// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, uuidv7, type StepOutcome, type Turn } from '@storyengine/shared';

import { registerMode } from '../mode-registry.js';
import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import { Layout } from '../storage/layout.js';
import { ENSEMBLE_MODE, TEST_STEP } from '../test-mode.js';
import { makeTestServer, setUpAdmin, type SseFrame, type TestServer } from '../test-server.js';
import { SE_SPEAKERS_SMART } from '../turns/smart-speakers.js';

/**
 * ***Rewrite keeps the speakers, reroll asks again — through the route*** —
 * [P14 §1.3a](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)
 * point 7, built at [P14.1].
 *
 * `runner.test.ts` proves the runner keeps a pick it is handed; **what only the
 * route can show is who hands it over.** A `rewriteOf` submission names a turn,
 * and the route reads that turn off the server's own record — its tape for
 * [P6.2]'s replay, and now its speakers, by `keptSpeakers` in the same read. A
 * client cannot post the speakers it would have liked, for the tape's reason:
 * *"not that sentence"* is a request about the prose, and the outcome it keeps
 * is the one the record says happened.
 *
 * ***A fixture with `smart` declared***, so creation writes it as the session's
 * policy the way it writes any mode's (`chatSettingsAtCreation`), and
 * `castIsPresent`, so the cast is in the room without a presence write per
 * member. Its step is the ensemble's, which echoes who it was handed — the one
 * way a selection is observable from outside.
 */

const SMART_MODE_ID = 'storyengine.test.ensemble.smart';
const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a08';

/** The budget `force-talk.test.ts` uses for a whole turn, for its reason. */
const TURN_FINISHES_MS = 8_000;

let server: TestServer;
let provider: FakeProvider;
let sessionId: string;
let vera: string;
let lund: string;
let abel: string;

const finished = (frame: SseFrame): boolean =>
  frame.event === 'progress' && (frame.data as { key: string }).key === 'turn.finished';

/** An answer as a structured endpoint gives it: the object, and its JSON as the text. */
function answer(value: unknown): ScriptedReply {
  return { object: value, text: JSON.stringify(value) };
}

const PROSE: ScriptedReply = { text: 'The lamp guttered.' };

/**
 * An actor with a talkativeness under the fixture's mode id.
 *
 * ***Rigged so the tape's pick is somebody the model never names.*** Vera
 * always joins in and nobody else does, so `natural` — what a rewrite that
 * kept nothing would replay — answers Vera alone on any draw. Without that, a
 * route that forgot to hand the kept speakers over could still pass whenever
 * the tape's pick happened to be the model's, which at the default 0.5 each is
 * often.
 */
async function anActor(name: string, talkativeness: number): Promise<string> {
  const actor = {
    ...newActor(name),
    modeData: { [SMART_MODE_ID]: { talkativeness } },
  };
  const created = await server.request({
    method: 'POST',
    url: '/api/library/actors',
    payload: actor,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return actor.id;
}

beforeEach(async () => {
  // Additive and process-wide, as `runner.test.ts` explains for the fixture it
  // is built from: nothing else names this id.
  registerMode({
    ...ENSEMBLE_MODE,
    definition: {
      ...ENSEMBLE_MODE.definition,
      id: SMART_MODE_ID,
      participants: { select: 'smart', maxActors: 4, castIsPresent: true },
    },
  });
  // One double for the whole server, so its request log is every call any
  // turn made — which is what *"a rewrite makes no call"* is asserted against.
  provider = new FakeProvider();
  server = await makeTestServer({
    providers: () => provider,
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

  vera = await anActor('Vera', 1);
  lund = await anActor('Lund', 0);
  abel = await anActor('Abel', 0);
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: {
      name: 'Lighthouse',
      mode: SMART_MODE_ID,
      cast: { persona: null, actors: [vera, lund, abel] },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  sessionId = created.body.session.id as string;
});

afterEach(async () => {
  await server.dispose();
});

/**
 * Submits a turn that names nobody — so under `smart` only the model or a
 * rewrite decides — waits for it, and returns the whole record and who its step
 * said it spoke for.
 */
async function takeTurn(
  body: Record<string, unknown>,
): Promise<{ turn: Turn & { steps?: StepOutcome[] }; chosen: string[] }> {
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: {
      idempotencyKey: uuidv7(),
      headTurnId: null,
      input: { text: 'The lamp is out again.' },
      ...body,
    },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);
  const stream = await server.stream({ url: submitted.body.stream as string });
  await stream.until(finished, TURN_FINISHES_MS);
  await stream.abort();

  const read = await server.request({
    method: 'GET',
    url: `/api/sessions/${sessionId}/turns/${submitted.body.turnId as string}`,
  });
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  const turn = read.body.turn as Turn;
  const said = turn.output?.text ?? '';
  const inside = said.slice(1, said.indexOf(']'));
  return { turn, chosen: inside === '' ? [] : inside.split(',') };
}

function smartOutcome(turn: Turn): StepOutcome | undefined {
  return turn.steps?.find((step) => step.stepId === SE_SPEAKERS_SMART);
}

describe('smart order through the route', () => {
  it('keeps the redone turn’s speakers on a rewrite, and asks the model again on a reroll', async () => {
    provider.setScript([
      answer({ speakers: [{ id: abel, because: 'He keeps the lamp.' }] }),
      PROSE,
    ]);
    const original = await takeTurn({});
    expect(original.chosen).toEqual([abel]);
    expect(smartOutcome(original.turn)?.speakers?.by).toBe('model');

    /**
     * The model would answer Lund if it were asked. A rewrite that asked would
     * therefore say Lund, or show a second call; it says Abel, and the only
     * request it made was the ensemble step's.
     */
    const lundIfAsked = [answer({ speakers: [{ id: lund }] }), PROSE];

    provider.setScript(lundIfAsked);
    const before = provider.requests.length;
    const rewrite = await takeTurn({
      headTurnId: original.turn.id,
      parentTurnId: original.turn.parentTurnId,
      rewriteOf: original.turn.id,
    });
    expect(rewrite.turn.parentTurnId).toBe(original.turn.parentTurnId);
    expect(rewrite.chosen).toEqual([abel]);
    expect(provider.requests.length - before).toBe(1);
    expect(rewrite.turn.request?.calls.map((call) => call.stepId)).toEqual([TEST_STEP.id]);
    expect(smartOutcome(rewrite.turn)).toMatchObject({
      state: 'ok',
      speakers: { by: 'rewrite', picked: [{ id: abel, name: 'Abel' }] },
    });

    provider.setScript(lundIfAsked);
    const reroll = await takeTurn({
      headTurnId: rewrite.turn.id,
      parentTurnId: original.turn.parentTurnId,
    });
    expect(reroll.chosen).toEqual([lund]);
    expect(reroll.turn.request?.calls.map((call) => call.stepId)).toEqual([
      SE_SPEAKERS_SMART,
      TEST_STEP.id,
    ]);
    expect(smartOutcome(reroll.turn)?.speakers?.by).toBe('model');
  });
});
