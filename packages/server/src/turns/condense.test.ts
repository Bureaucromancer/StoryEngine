// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newSetup, uuidv7, type Turn, type TurnAttachment } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import type { GenerationRequest, Provider } from '../providers/types.js';
import { appendTurnToSession } from '../sessions/store.js';
import { listSummaries } from '../sessions/summaries.js';
import { Layout } from '../storage/layout.js';
import { eventually, makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { Cancelled } from './calls.js';
import { draftSetupFromTurn, STORY_SO_FAR_PROMPT, type SetupPart } from './condense.js';
import { SUMMARISE_PROMPT } from './summarise.js';

/**
 * ***The draft's chain is the runner's chain*** —
 * [P15.6](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md), and the
 * rewrite the merge into `main` owed it (2026-10-03).
 *
 * The draft extends the session's own summary chain rather than building one
 * of its own, so everything it writes under the runner's key is something the
 * next turn reads as held. That is only a saving while the two agree on what a
 * link is keyed on and what a link may hold — and the branch's draft agreed with
 * neither once `main` had put pictures in the unit keys (`c082162c`), refused to
 * keep a cut-off summary (`8669ed3e`), and put the chain into stretches
 * (`e9d1a142`). Each test here is one of those agreements, driven through the
 * function the route calls and, where the claim is *the runner reads it*,
 * through a real turn.
 *
 * *Turns are appended through the store rather than played*, the route test's
 * arrangement: what is under test is the draft, and a narration per turn would
 * only make the summariser's script harder to read.
 */

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a31';

/** Whether a request is the summariser's — by its prompt, which is in its key. */
function summarising(request: GenerationRequest): boolean {
  return JSON.stringify(request.messages).includes(SUMMARISE_PROMPT.split('\n')[0] ?? '');
}

/**
 * Whether a request is the story-so-far part's — over the messages' own text,
 * since the prompt's first line has quotation marks a JSON encoding escapes.
 */
function storySoFar(request: GenerationRequest): boolean {
  const first = STORY_SO_FAR_PROMPT.split('\n')[0] ?? '';
  return request.messages.some((message) => message.content.includes(first));
}

/**
 * Two scripts behind one provider: the summariser's, which each test sets, and
 * everything else's — the draft's parts and a turn's own calls.
 */
class Scripted {
  readonly summariser = new FakeProvider({ script: [{ text: 'A stretch of the road.' }] });
  readonly rest = new FakeProvider({ script: [{ text: 'The rain kept on.' }] });
  readonly asked: GenerationRequest[] = [];
  summaries = 0;

  readonly provider: Provider = {
    kind: 'fake',
    capabilities: this.rest.capabilities,
    generate: async (request) => {
      this.asked.push(request);
      if (!summarising(request)) return await this.rest.generate(request);
      this.summaries += 1;
      return await this.summariser.generate(request);
    },
    stream: (request) => {
      this.asked.push(request);
      return this.rest.stream(request);
    },
  };
}

let server: TestServer;
let scripted: Scripted;

beforeEach(async () => {
  scripted = new Scripted();
  server = await makeTestServer({ providers: () => scripted.provider });
  await setUpAdmin(server, 'ned');
  const connections = new Layout(server.dataDir).userConnectionsRoot('ned');
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
    join(server.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );
});

afterEach(async () => {
  await server.dispose();
});

/**
 * A session of `count` written turns after whatever its creation wrote, the
 * move at `pictured` (if any) carrying a captioned picture. Started from a Setup
 * with `storySoFar` when one is given.
 */
async function aSession(
  count: number,
  over: { pictured?: number; storySoFar?: string } = {},
): Promise<{ id: string; head: string }> {
  let payload: Record<string, unknown> = { name: 'The harbour road' };
  if (over.storySoFar !== undefined) {
    const setup = await server.request({
      method: 'POST',
      url: '/api/library/setups',
      payload: { ...newSetup('From the docks'), storySoFar: over.storySoFar },
    });
    expect(setup.status).toBe(201);
    payload = { setup: setup.body.object.id as string };
  }
  const created = await server.request({ method: 'POST', url: '/api/sessions', payload });
  expect(created.status).toBe(201);
  const id = created.body.session.id as string;

  let parent = (created.body.session.headTurnId as string | null) ?? null;
  for (let at = 0; at < count; at += 1) {
    const attachments: TurnAttachment[] | undefined =
      at === over.pictured ? [{ id: 'a0', kind: 'image', caption: 'a brass key' }] : undefined;
    const turn: Turn = {
      id: uuidv7(),
      sessionId: id,
      parentTurnId: parent,
      createdAt: new Date(Date.UTC(2026, 9, 3, 0, at)).toISOString(),
      status: 'complete',
      input: {
        actorId: null,
        kind: 'do',
        text: `I walk on, ${String(at)}.`,
        raw: `I walk on, ${String(at)}.`,
        ...(attachments === undefined ? {} : { attachments }),
      },
      output: { text: `At ${String(at)} the road bends toward the sea.` },
      effects: [],
      tape: [],
    };
    await appendTurnToSession(server.services.sessions, 'ned', id, turn);
    parent = turn.id;
  }
  if (parent === null) throw new Error('a session with no turns has no head');
  return { id, head: parent };
}

function draft(
  sessionId: string,
  turnId: string,
  parts: SetupPart[],
  signal: AbortSignal = new AbortController().signal,
) {
  return draftSetupFromTurn(
    {
      sessions: server.services.sessions,
      accounts: server.services.accounts,
      providers: server.services.providers,
      config: server.services.config,
    },
    { account: 'ned', sessionId, turnId, parts, signal },
  );
}

async function held(sessionId: string): Promise<Set<string>> {
  return await listSummaries(server.services.layout, 'ned', sessionId);
}

interface RecordedTurn {
  steps?: { stepId: string; state: string }[];
  request?: { calls?: { stepId: string }[] };
}

/** One real turn after the head, waited for. */
async function aTurn(sessionId: string, head: string): Promise<RecordedTurn> {
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: 'after-the-draft', headTurnId: head, input: { text: 'Onward.' } },
  });
  expect(submitted.status).toBe(202);
  await eventually(async () => {
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    return read.body.activeJob === null;
  });
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
  return read.body.turns.at(-1) as RecordedTurn;
}

async function usageLines(): Promise<{ purpose: string; sessionId?: string; role: string }[]> {
  try {
    const text = await readFile(server.services.layout.usageLogFile('ned'), 'utf8');
    return text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { purpose: string; sessionId?: string; role: string });
  } catch {
    return [];
  }
}

describe('the chain a draft extends', () => {
  /**
   * ***Twenty-five turns over a twenty-turn window is one link***, and the
   * third move in it was a picture. The draft derives the link; the turn after
   * it must read that link and derive nothing.
   *
   * Falsified by the branch's own path — `{ input: { text } }`, which drops the
   * picture's caption from the unit key ([26 E15]) — under which the draft
   * writes a link keyed on a move without its picture, the turn's summariser
   * keys the move with it, misses, and calls again.
   */
  it('writes a pictured move’s link under the key the next turn reads', async () => {
    const { id, head } = await aSession(25, { pictured: 2 });

    const drafted = await draft(id, head, ['storySoFar']);
    expect('parts' in drafted && drafted.parts.storySoFar).toMatchObject({ ok: true });
    expect(scripted.summaries).toBe(1);
    const written = await held(id);
    expect(written.size).toBe(1);

    const turn = await aTurn(id, head);
    expect(turn.steps?.find((step) => step.stepId === 'se.summary')?.state).toBe('ok');
    expect(turn.request?.calls?.some((call) => call.stepId === 'se.summary')).toBe(false);
    expect(scripted.summaries).toBe(1);
    expect(await held(id)).toEqual(written);
  });

  /**
   * ***Only a finished summary is kept*** — `keptSummary`, the runner's own
   * rule. A link cut off at its length limit, or one that came back empty,
   * would be served to every later turn by its content key; the draft must not
   * be the one door that writes it.
   *
   * Falsified by keeping the reply as it came, `outcome.text.trim()`, which is
   * what the branch did: the cut and the empty reply both land on disk.
   *
   * *And the parts say it was the summary* (2026-10-03, at review):
   * `summary-truncated` and `summary-no-answer`, not a part's own
   * `truncated` and `no-answer`, whose sentences tell a person to steer the
   * part with a note that never reaches the summariser. Falsified by throwing
   * the part's reasons from the summariser, as the merge first did.
   */
  it('never writes a link cut off at its length limit, or an empty one', async () => {
    const { id, head } = await aSession(25);

    scripted.summariser.setScript([{ text: 'Marlow walked to the', finishReason: 'length' }]);
    const cut = await draft(id, head, ['storySoFar', 'title']);
    expect('parts' in cut && cut.parts).toEqual({
      storySoFar: { ok: false, reason: 'summary-truncated' },
      title: { ok: false, reason: 'summary-truncated' },
    });
    expect((await held(id)).size).toBe(0);

    scripted.summariser.setScript([{ text: '   ' }]);
    const empty = await draft(id, head, ['storySoFar']);
    expect('parts' in empty && empty.parts).toEqual({
      storySoFar: { ok: false, reason: 'summary-no-answer' },
    });
    expect((await held(id)).size).toBe(0);

    // And no part was asked for on a chain that stopped short.
    expect(scripted.asked.filter((request) => !summarising(request))).toEqual([]);
  });

  /**
   * ***`ensureChain` returns a failure; it does not throw one.*** Since
   * `e9d1a142` it hands back the held prefix beside it, so the branch's
   * `catch (CallFailed)` never fired and a draft went on to write a story so
   * far from a chain that stopped short. Now every part still wanted fails with
   * the link's own class and remedy, and nothing is asked of the parts.
   *
   * Falsified by not reading `failure`: the parts are drafted, from nothing
   * but the window.
   */
  it('fails every part with the link’s class when a link cannot be derived', async () => {
    const { id, head } = await aSession(25);
    scripted.summariser.setScript([
      { error: { class: 'terminal', message: 'The endpoint refused.', detail: 'Bad key.' } },
    ]);

    const drafted = await draft(id, head, ['storySoFar', 'opening']);

    const failed = {
      ok: false,
      reason: 'call-failed',
      class: 'terminal',
      remedy: 'endpoint-refused',
      detail: 'Bad key.',
    };
    expect('parts' in drafted && drafted.parts).toEqual({ storySoFar: failed, opening: failed });
    expect(scripted.asked.filter((request) => !summarising(request))).toEqual([]);
  });

  /**
   * ***A stop is still a stop.*** The route ends a request whose client left
   * by catching `Cancelled`; a draft that turned the stop into a failed part
   * would answer a person who is no longer there, and keep asking the parts.
   *
   * Falsified by filing `Cancelled` under a part like any other failure.
   */
  it('lets a stop through rather than filing it under a part', async () => {
    const { id, head } = await aSession(25);

    await expect(draft(id, head, ['storySoFar'], AbortSignal.abort())).rejects.toBeInstanceOf(
      Cancelled,
    );
    expect(scripted.asked).toEqual([]);
  });

  /**
   * ***The root and every link, not the newest link alone.*** Forty-five turns
   * over the window is two stretches — turns 0–19 and 20–24 — and the session
   * began from a Setup's story so far. Each link is its own stretch since
   * `e9d1a142`, so the story before the window is all three, oldest first.
   *
   * Falsified by the branch's `links.at(-1)?.text ?? root`: the story-so-far
   * part is shown the second stretch alone, as though it were everything.
   */
  it('shows the parts the story so far and every stretch, oldest first', async () => {
    const { id, head } = await aSession(45, {
      storySoFar: 'Before any of this, the ledger was lost.',
    });
    scripted.summariser.setScript([{ text: 'Stretch one.' }, { text: 'Stretch two.' }]);

    const drafted = await draft(id, head, ['storySoFar']);
    expect('parts' in drafted && drafted.parts.storySoFar).toMatchObject({ ok: true });
    expect(scripted.summaries).toBe(2);

    const asked = scripted.asked.find(storySoFar);
    const shown = (asked?.messages ?? []).map((message) => message.content).join('\n');
    const root = shown.indexOf('Before any of this, the ledger was lost.');
    const one = shown.indexOf('Stretch one.');
    const two = shown.indexOf('Stretch two.');
    expect(root).toBeGreaterThanOrEqual(0);
    expect(one).toBeGreaterThan(root);
    expect(two).toBeGreaterThan(one);
  });
});

describe('the turns after the chain', () => {
  /**
   * ***In the summariser's own words*** — `renderUnits` over `unitWordsOf`, so
   * a picture move inside the window reads to the draft as its stand-in, quoted
   * as the player's, exactly as the summariser is shown one inside a link.
   *
   * Falsified by the branch's rendering, `{ said: input.text }`, which shows a
   * model the move's words and not the picture it was.
   */
  it('shows a picture move as the summariser shows it', async () => {
    const { id, head } = await aSession(3, { pictured: 1 });

    await draft(id, head, ['storySoFar']);

    const asked = scripted.asked.find(storySoFar);
    const shown = (asked?.messages ?? []).map((message) => message.content).join('\n');
    expect(shown).toContain('> I walk on, 1.\n> [Picture: a brass key]\nAt 1 the road bends');
  });
});

describe('a part that did not finish', () => {
  /**
   * ***A cut-off story so far is refused, not offered*** — `finished`'s
   * argument: its end, *where things stand*, is what a cut removes, and a
   * person reviewing a long draft reads it for whether it is right. The part
   * beside it is unaffected.
   *
   * Falsified by offering the reply as it came, which hands the wizard a story
   * so far that stops mid-sentence as though it were finished.
   */
  it('refuses a story so far cut off at its length limit, and keeps the opening', async () => {
    const { id, head } = await aSession(3);
    scripted.rest.setScript([
      { text: 'Marlow lost the ledger, and then', finishReason: 'length' },
      { text: 'The docks, still wet.' },
    ]);

    const drafted = await draft(id, head, ['storySoFar', 'opening']);

    expect('parts' in drafted && drafted.parts).toEqual({
      storySoFar: { ok: false, reason: 'truncated' },
      opening: { ok: true, value: 'The docks, still wet.', model: 'fake-hi' },
    });
  });
});

describe('a model with no room', () => {
  /**
   * ***A context window no bigger than the reply is an answer, not a fault***
   * — `performCall` refuses it before anything is sent, and impersonation
   * answers it as `window-too-small`. The draft rethrew it, so the wizard got
   * a 500 for a setting a person can change.
   *
   * Falsified by dropping the `WindowTooSmall` arm of `failureOf`: the draft
   * rejects.
   */
  it('says the window is too small rather than failing', async () => {
    const { id, head } = await aSession(3);
    Object.assign(scripted.provider, {
      capabilities: { ...scripted.rest.capabilities, maxContextTokens: 8 },
    });

    const drafted = await draft(id, head, ['storySoFar', 'title']);

    expect('parts' in drafted && drafted.parts).toEqual({
      storySoFar: { ok: false, reason: 'window-too-small' },
      title: { ok: false, reason: 'window-too-small' },
    });
    expect(scripted.asked).toEqual([]);
  });
});

describe('what a draft costs', () => {
  /**
   * ***Every call is a line in the usage log*** — [10 §11.4], as every call
   * that writes no turn has been since `c814f3ed`. The links the draft had to
   * derive are filed under the wizard, beside its parts, and a call that
   * failed after reaching the provider is a line too: it was paid for.
   *
   * Falsified by dropping either `spent` — after a call that returned, or in
   * the failure path.
   */
  it('records each part and each link it derived, under the wizard’s name', async () => {
    const { id, head } = await aSession(25);
    scripted.rest.setScript([
      { text: 'Marlow lost the ledger.' },
      { error: { class: 'terminal', message: 'The endpoint refused.' } },
    ]);

    await draft(id, head, ['storySoFar', 'opening']);

    const lines = await usageLines();
    expect(lines.map((line) => line.purpose)).toEqual([
      'setup-draft:summarise',
      'setup-draft:storySoFar',
      'setup-draft:opening',
    ]);
    expect(lines.every((line) => line.sessionId === id && line.role === 'prose')).toBe(true);
  });
});
