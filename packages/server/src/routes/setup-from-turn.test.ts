// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  newActor,
  newSetup,
  newTreatment,
  uuidv7,
  type Goal,
  type PlotHook,
  type Setup,
  type Turn,
} from '@storyengine/shared';

import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import { SE_PARTY } from '../sessions/cast.js';
import { SE_GOAL, SE_GOAL_CURRENT } from '../sessions/goals.js';
import { SE_HOOK } from '../sessions/hooks.js';
import { appendTurnToSession } from '../sessions/store.js';
import { acceptEffect } from '../turns/effects.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***Make a setup from here, through the routes*** —
 * [04 §7.2](../../../../docs/design/04-schemas.md),
 * [P13.6](../../../../docs/design/workplan/30-p13-implementation.md).
 *
 * **What the model is shown, and what the browser is sent, are the two things
 * held to account.** Every assertion about hidden content reads the provider's
 * request log and the response body as bytes, because a redaction that holds in
 * a pure function and leaks through a prompt is a redaction that does not hold.
 *
 * *Turns are appended through the store rather than played*, which is the
 * summary property test's arrangement: what is under test is the draft, and a
 * scripted narration per turn would only make the provider's script harder to
 * read.
 */

let server: TestServer;
let provider: FakeProvider;

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a13';

afterEach(async () => {
  await server.dispose();
});

async function standUp(script: ScriptedReply[], bind = true): Promise<void> {
  provider = new FakeProvider({ script });
  server = await makeTestServer({ providers: () => provider });
  await setUpAdmin(server, 'ned');
  if (!bind) return;

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
}

const SECRET_HOOK: PlotHook = {
  id: 'hook-the-informer',
  title: 'The informer',
  premise: 'SECRETPREMISE: the harbourmaster has been selling Marlow out all along.',
  magnitude: 'local',
  involves: [],
  weight: 1,
  delivery: 'guidance',
  once: true,
};

const HIDDEN_GOAL: Goal = {
  id: 'goal-arc',
  statement: 'SECRETGOAL: the ledger was forged from the start.',
  detail: null,
  visibility: 'hidden',
  completion: { kind: 'narrative' },
  thenDefault: 'advance',
  next: null,
};

/** A session started from a Setup carrying one unfired hook and one hidden goal. */
async function aSession(turns: number): Promise<{ id: string; turnIds: string[] }> {
  const setup = await server.request({
    method: 'POST',
    url: '/api/library/setups',
    payload: { ...newSetup('The Fixer’s Debt'), hooks: [SECRET_HOOK], goals: [HIDDEN_GOAL] },
  });
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { setup: setup.body.object.id as string },
  });
  const id = created.body.session.id as string;

  const turnIds: string[] = [];
  let parent: string | null = null;
  for (let at = 0; at < turns; at += 1) {
    const turn: Turn = {
      id: uuidv7(),
      sessionId: id,
      parentTurnId: parent,
      createdAt: new Date(Date.UTC(2026, 8, 26, 0, at)).toISOString(),
      status: 'complete',
      input: {
        actorId: null,
        kind: 'do',
        text: `turn ${String(at)} said`,
        raw: `turn ${String(at)} said`,
      },
      output: { text: `and at turn ${String(at)} the rain kept on` },
      effects: [],
      tape: [],
    };
    await appendTurnToSession(server.services.sessions, 'ned', id, turn);
    turnIds.push(turn.id);
    parent = turn.id;
  }
  return { id, turnIds };
}

function draft(sessionId: string, turnId: string, body: Record<string, unknown>) {
  return server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns/${turnId}/setup-draft`,
    payload: body,
  });
}

/** Every message the provider was sent, as one string, for the leak checks. */
function everythingSent(from = 0): string {
  return provider.requests
    .slice(from)
    .flatMap((request) => request.messages.map((message) => message.content))
    .join('\n');
}

describe('drafting a setup from a turn', () => {
  it('drafts every part from what the player saw, and never from what they did not', async () => {
    await standUp([
      { text: 'Marlow lost the ledger in the rain.' },
      { text: 'The docks, still wet. Vera waits under the crane.' },
      { object: { name: 'The Ledger, Lost', blurb: 'Pick it up at the docks.' } },
      { object: { memories: [{ text: 'Vera owes Marlow a favour.', keys: ['Vera'] }] } },
    ]);
    const { id, turnIds } = await aSession(4);

    const response = await draft(id, turnIds[3] ?? '', {
      parts: ['storySoFar', 'opening', 'title', 'facts'],
    });

    expect(response.status).toBe(200);
    expect(response.body.draft.parts).toEqual({
      storySoFar: { ok: true, value: 'Marlow lost the ledger in the rain.', model: 'fake-hi' },
      opening: {
        ok: true,
        value: 'The docks, still wet. Vera waits under the crane.',
        model: 'fake-hi',
      },
      title: {
        ok: true,
        value: { name: 'The Ledger, Lost', blurb: 'Pick it up at the docks.' },
        model: 'fake-hi',
      },
      facts: {
        ok: true,
        value: [{ text: 'Vera owes Marlow a favour.', keys: ['Vera'] }],
        model: 'fake-hi',
      },
    });

    // In order, one call per part, and every one of them shown the story.
    expect(provider.requests).toHaveLength(4);
    for (const request of provider.requests) {
      expect(request.messages.map((one) => one.content).join('\n')).toContain('turn 3 said');
    }

    // ***The redaction, as bytes***: nothing hidden reached a prompt, and
    // nothing hidden reached the browser.
    expect(everythingSent()).not.toMatch(/SECRET/);
    expect(JSON.stringify(response.body)).not.toMatch(/SECRET/);
    expect(response.body.draft.carry.goals.current).toEqual({ hidden: true });
    expect(response.body.draft.carry.hooks).toEqual({ carried: 1, spent: 0 });
  });

  it('keeps what succeeded when one part fails', async () => {
    await standUp([
      { text: 'Marlow lost the ledger.' },
      // Terminal, so the ladder does not retry it into the next part's reply.
      { error: { class: 'terminal', message: 'The endpoint refused.' } },
    ]);
    const { id, turnIds } = await aSession(3);

    const response = await draft(id, turnIds[2] ?? '', { parts: ['storySoFar', 'opening'] });

    expect(response.body.draft.parts.storySoFar).toMatchObject({ ok: true });
    expect(response.body.draft.parts.opening).toEqual({ ok: false, reason: 'call-failed' });
  });

  it('takes the narrator’s last words as the opening without a call', async () => {
    await standUp([]);
    const { id, turnIds } = await aSession(3);

    const response = await draft(id, turnIds[1] ?? '', {
      parts: ['opening'],
      openingFrom: 'verbatim',
    });

    // The turn it was asked about, not the head.
    expect(response.body.draft.parts.opening).toEqual({
      ok: true,
      value: 'and at turn 1 the rain kept on',
      model: null,
    });
    expect(provider.requests).toHaveLength(0);
  });

  it('hands a person’s steer to the part it steers, and to no other', async () => {
    await standUp([{ text: 'Shorter.' }, { text: 'A scene.' }]);
    const { id, turnIds } = await aSession(3);

    const response = await draft(id, turnIds[2] ?? '', {
      parts: ['storySoFar', 'opening'],
      guidance: { storySoFar: 'Leave out the weather.' },
    });
    expect(response.status).toBe(200);

    const [soFar, opening] = provider.requests.map((request) =>
      request.messages.map((one) => one.content).join('\n'),
    );
    expect(soFar).toContain('Leave out the weather.');
    expect(opening).not.toContain('Leave out the weather.');
  });

  /**
   * ***The chain is reused, not rebuilt*** — the session's own summariser key,
   * so a link on disk is read by its content address. Twenty-five turns over a
   * twenty-turn window is one link; the first draft derives it and the second
   * costs only the part it asked for.
   */
  it('extends the session’s own chain once, and reads it back after', async () => {
    await standUp([
      { text: 'The first five turns, summarised.' },
      { text: 'Everything so far.' },
      { text: 'Everything so far, again.' },
    ]);
    const { id, turnIds } = await aSession(25);
    const at = turnIds[24] ?? '';

    await draft(id, at, { parts: ['storySoFar'] });
    expect(provider.requests).toHaveLength(2);
    // The link is what the second call was shown as the story before the window.
    expect(everythingSent(1)).toContain('The first five turns, summarised.');

    await draft(id, at, { parts: ['storySoFar'] });
    expect(provider.requests).toHaveLength(3);
  });

  it('refuses a turn that is not in the session', async () => {
    await standUp([]);
    const { id } = await aSession(1);

    const response = await draft(id, 'no-such-turn', { parts: ['storySoFar'] });
    expect(response.status).toBe(404);
  });

  it('says which parts could not be drafted when nothing is bound, rather than failing', async () => {
    await standUp([], false);
    const { id, turnIds } = await aSession(2);

    const response = await draft(id, turnIds[1] ?? '', { parts: ['storySoFar', 'title'] });

    expect(response.status).toBe(200);
    expect(response.body.draft.parts).toEqual({
      storySoFar: { ok: false, reason: 'role-unbound' },
      title: { ok: false, reason: 'role-unbound' },
    });
  });
});

/**
 * ***The round trip*** — [P13.7](../../../../docs/design/workplan/30-p13-implementation.md)'s
 * proof obligation, and the phase's.
 *
 * Play a session to a turn at which a companion has joined, one goal has been
 * achieved and the story is on the next, a treatment's hook has fired and the
 * Setup's own hook has not. Make a Setup from that turn, start a new session
 * from it, and play one turn: **everything the Setup promised has to arrive** —
 * the opening as turn one, the companion in the party, the treatment's hook
 * spent rather than fresh, the goal the story was on as the one play begins on,
 * the unfired hook still waiting, the story so far in the first prompt, and a
 * kept fact activating on its key.
 */
describe('making a setup from a turn, and starting from it', () => {
  async function aTreatment(): Promise<string> {
    const made = {
      ...newTreatment('Rain City, noir'),
      hooks: [hookNamed('hook-treatment-fired'), hookNamed('hook-treatment-fresh')],
    };
    const response = await server.request({
      method: 'POST',
      url: '/api/library/treatments',
      payload: made,
    });
    return response.body.object.id as string;
  }

  async function anActor(name: string): Promise<string> {
    const response = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: newActor(name),
    });
    return response.body.object.id as string;
  }

  function hookNamed(id: string): PlotHook {
    return { ...SECRET_HOOK, id, title: id, premise: `SECRETPREMISE of ${id}` };
  }

  const goal = (id: string, over: Partial<Goal> = {}): Goal => ({
    ...HIDDEN_GOAL,
    id,
    statement: `reach ${id}`,
    visibility: 'player',
    ...over,
  });

  function commit(sessionId: string, turnId: string, over: Record<string, unknown> = {}) {
    return server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns/${turnId}/setup`,
      payload: {
        texts: {
          name: 'The Ledger, Lost',
          blurb: 'Pick it up at the docks.',
          storySoFar: 'Marlow lost the ledger at the docks, and Vera saw it happen.',
          opening: { label: 'The docks', text: 'Rain on the docks. Vera waits under the crane.' },
        },
        include: { party: true, goals: true, hooks: true },
        facts: [{ text: 'Vera owes Marlow a favour from the harbour job.', keys: ['favour'] }],
        generated: {
          storySoFar: { original: 'Marlow lost the ledger.', model: 'fake-hi' },
        },
        ...over,
      },
    });
  }

  it('carries what the turn had, and a session started from it begins there', async () => {
    await standUp([{ text: 'The rain does not let up.' }]);
    const treatment = await aTreatment();
    const vera = await anActor('Vera');
    const marlow = await anActor('Marlow');

    const setup = await server.request({
      method: 'POST',
      url: '/api/library/setups',
      payload: {
        ...newSetup('The Fixer’s Debt'),
        treatment: { id: treatment, name: 'Rain City, noir' },
        cast: {
          personaOptions: [{ id: marlow, name: 'Marlow' }],
          partyDefault: [],
          narrator: null,
        },
        hooks: [hookNamed('hook-setup-fresh')],
        goals: [goal('goal-one', { next: 'goal-two' }), goal('goal-two')],
      },
    });
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { setup: setup.body.object.id as string },
    });
    const first = created.body.session.id as string;

    // One turn of play that did four things, written as the engine writes them.
    const turnId = uuidv7();
    const writes: [string, string | null, string][] = [
      [SE_PARTY, vera, 'companion'],
      [SE_HOOK, 'hook-treatment-fired', 'fired'],
      [SE_GOAL, 'goal-one', 'achieved'],
      [SE_GOAL_CURRENT, null, 'goal-two'],
    ];
    const effects = writes.map(([channelId, scopeKey, after]) =>
      acceptEffect(
        turnId,
        {
          channelId,
          scopeKey,
          op: { type: 'set', path: '/' },
          after,
          proposedBy: { kind: 'engine' },
        },
        {},
      ),
    );
    await appendTurnToSession(server.services.sessions, 'ned', first, {
      id: turnId,
      sessionId: first,
      parentTurnId: null,
      createdAt: new Date().toISOString(),
      status: 'complete',
      input: { actorId: null, kind: 'do', text: 'I hand Vera the ledger.', raw: '' },
      output: { text: 'She takes it, and the goal is met.' },
      effects,
      tape: [],
    });

    const saved = await commit(first, turnId);
    expect(saved.status).toBe(201);
    expect(JSON.stringify(saved.body)).not.toMatch(/SECRET/);
    const setupId = saved.body.setup.id as string;
    expect(saved.body.lorebook.name).toBe('The Ledger, Lost — established facts');

    // What was written, read back through the library.
    const written = (await server.request({ method: 'GET', url: `/api/library/setups/${setupId}` }))
      .body.object as Setup;
    expect(written.provenance.source).toBe('session');
    expect(written.generated?.['storySoFar']).toMatchObject({
      original: 'Marlow lost the ledger.',
      model: 'fake-hi',
      unreviewed: false,
    });
    const book = (
      await server.request({
        method: 'GET',
        url: `/api/library/lorebooks/${saved.body.lorebook.id as string}`,
      })
    ).body.object;
    // `generated`, never `session` — which the retriever would read as a memory book.
    expect(book.provenance.source).toBe('generated');

    // ***And a session started from it begins where the first one was.***
    const next = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { setup: setupId },
    });
    const second = next.body.session;
    expect(second.cast).toEqual({ persona: marlow, actors: [vera] });
    expect((second.goals as Goal[]).map((one) => one.id)).toEqual(['goal-two']);

    const turns = (
      await server.request({ method: 'GET', url: `/api/sessions/${second.id as string}/turns` })
    ).body.turns as Turn[];
    expect(turns).toHaveLength(1);
    expect(turns[0]?.output?.text).toBe('Rain on the docks. Vera waits under the crane.');

    const read = await server.request({
      method: 'GET',
      url: `/api/sessions/${second.id as string}`,
    });
    const rows = read.body.hooks.rows as { hookId: string; state: string | null }[];
    const state = (id: string) => rows.find((row) => row.hookId === id)?.state;
    expect(state('hook-treatment-fired')).toBe('fired');
    expect(state('hook-treatment-fresh')).toBeNull();
    expect(state('hook-setup-fresh')).toBeNull();

    // One real turn: the story so far, and the kept fact on its key.
    const before = provider.requests.length;
    const submitted = await server.request({
      method: 'POST',
      url: `/api/sessions/${second.id as string}/turns`,
      payload: {
        idempotencyKey: 'first',
        headTurnId: turns[0]?.id ?? null,
        input: { text: 'I remind Vera of the favour she owes me.' },
      },
    });
    expect(submitted.status).toBe(202);
    const stream = await server.stream({ url: `/api/sessions/${second.id as string}/stream` });
    await stream.until(
      (frame) =>
        frame.event === 'progress' && (frame.data as { key: string }).key === 'turn.finished',
      4000,
    );
    await stream.abort();

    // Every call the turn made, since the narration is not necessarily the last.
    const sent = everythingSent(before);
    expect(sent).toContain('Marlow lost the ledger at the docks, and Vera saw it happen.');
    expect(sent).toContain('Vera owes Marlow a favour from the harbour job.');
    expect(sent).toContain('Rain on the docks. Vera waits under the crane.');
  });

  it('writes no book when no fact was kept, and refuses a turn that is not there', async () => {
    await standUp([]);
    const { id, turnIds } = await aSession(2);

    const saved = await commit(id, turnIds[1] ?? '', { facts: [] });
    expect(saved.status).toBe(201);
    expect(saved.body.lorebook).toBeNull();

    const missing = await commit(id, 'no-such-turn');
    expect(missing.status).toBe(404);
  });

  it('leaves out what a person switched off, whatever the turn had', async () => {
    await standUp([]);
    const { id, turnIds } = await aSession(2);

    const saved = await commit(id, turnIds[1] ?? '', {
      include: { party: false, goals: false, hooks: false },
      facts: [],
    });
    const written = (
      await server.request({
        method: 'GET',
        url: `/api/library/setups/${saved.body.setup.id as string}`,
      })
    ).body.object as Setup;

    expect(written.goals).toEqual([]);
    expect(written.hooks).toEqual([]);
    expect(written.cast.partyDefault).toEqual([]);
  });
});
