// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor } from '@storyengine/shared';

import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type SseFrame, type TestServer } from '../test-server.js';

/**
 * Sessions, turns and the stream, end to end — [P2 §2.5], [P2 §2.10].
 *
 * Through the real routes and the real SSE transport, with the scripted
 * provider behind them. What these hold to account is the *contract a client
 * sees*: the statuses, the frame ordering, and the promise that a reattach loses
 * nothing and repeats nothing.
 */

let server: TestServer;
let provider: FakeProvider;
let sessionId: string;

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a02';

/**
 * Stands the server up with a scripted provider behind it.
 *
 * The factory is passed at construction rather than assigned afterwards: the
 * runner captures it when it is built, so a test that swapped
 * `services.providers` later would change something nothing reads and then
 * quietly assert against the real adapter.
 */
async function standUp(script?: ScriptedReply[]): Promise<void> {
  provider = new FakeProvider(script === undefined ? {} : { script });
  server = await makeTestServer({
    providers: () => provider,
    config: {
      sessions: {
        snapshotEveryNTurns: 10,
        streamKeepaliveMs: 15000,
        // One checkpoint per chunk, so frame ordering is deterministic rather
        // than a function of how fast the machine is.
        streamCoalesceMs: 0,
      },
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

  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Rain City' },
  });
  sessionId = created.body.session.id;
}

beforeEach(async () => {
  await standUp();
});

afterEach(async () => {
  await server.dispose();
});

function submit(body: Record<string, unknown> = {}): Promise<{ status: number; body: any }> {
  return server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: {
      idempotencyKey: 'key-1',
      headTurnId: null,
      input: { text: 'She opened the door.' },
      ...body,
    },
  });
}

const finished = (frame: SseFrame): boolean =>
  frame.event === 'progress' && (frame.data as { key: string }).key === 'turn.finished';

describe('the session surface', () => {
  it('creates, lists, reads and archives', async () => {
    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    expect(listed.body.sessions.map((each: { name: string }) => each.name)).toEqual(['Rain City']);

    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.body.session.id).toBe(sessionId);
    expect(read.body.activeJob).toBeNull();

    await server.request({
      method: 'PATCH',
      url: `/api/sessions/${sessionId}`,
      payload: { archived: true },
    });
    expect((await server.request({ method: 'GET', url: '/api/sessions' })).body.sessions).toEqual(
      [],
    );
    const withArchived = await server.request({
      method: 'GET',
      url: '/api/sessions?archived=true',
    });
    expect(withArchived.body.sessions).toHaveLength(1);
  });

  it("answers 404 for another account's session, not 403", async () => {
    // The path is the owner ([04 §4.3]): confirming the id exists elsewhere
    // would leak the one fact the separation keeps.
    await server.services.accounts.create({
      handle: 'sister',
      password: 'correct horse battery',
      role: 'user',
    });
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'sister', password: 'correct horse battery' },
    });

    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.status).toBe(404);
  });
});

describe('submitting a turn', () => {
  it('accepts with 202 and a cursor to stream from', async () => {
    const accepted = await submit();

    expect(accepted.status).toBe(202);
    expect(accepted.body.cursor).toBe(`${String(accepted.body.jobId)}.0`);
    expect(accepted.body.stream).toContain(`/api/sessions/${sessionId}/stream?after=`);
  });

  it('makes one job and one provider call for a repeated key', async () => {
    // A browser that reconnects mid-turn resubmits. A second provider call is
    // the thing that charges twice.
    const first = await submit();
    const retry = await submit();

    expect(retry.status).toBe(200);
    expect(retry.body.jobId).toBe(first.body.jobId);
    await server.services.runner.settle();
    expect(provider.requests).toHaveLength(1);
  });

  it('refuses a second turn while one is in flight, with the job', async () => {
    await server.dispose();
    await standUp([{ text: 'slow', chunks: 6, chunkDelayMs: 20 }]);
    const first = await submit();
    const second = await submit({ idempotencyKey: 'key-2' });

    expect(second.status).toBe(409);
    expect(second.body.job.id).toBe(first.body.jobId);
  });

  it('refuses a stale head, with the head it should have used', async () => {
    const accepted = await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, 4000);
    await stream.abort();

    const stale = await submit({ idempotencyKey: 'key-2' });
    expect(stale.status).toBe(412);
    // Without this a client's only recovery is a full reload.
    expect(stale.body.head).toBe(accepted.body.turnId);
  });

  it('rejects a body that names an unknown field', async () => {
    const bad = await submit({ mode: 'scene' });
    expect(bad.status).toBe(400);
  });
});

describe('the stream', () => {
  it('opens with a snapshot and closes the turn with turn.finished', async () => {
    await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });

    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toBe('text/event-stream');

    const snapshot = await stream.until((frame) => frame.event === 'snapshot');
    expect((snapshot.data as { sessionId: string }).sessionId).toBe(sessionId);

    const end = await stream.until(finished, 4000);
    expect((end.data as { params: { state: string } }).params.state).toBe('complete');
    await stream.abort();
  });

  it('gives two clients the same ordered events, and unsubscribes both', async () => {
    // [04 §3.1]: the session stream is subscribed while viewing, so two tabs on
    // one session is the ordinary case rather than an exotic one.
    await server.dispose();
    await standUp([{ text: 'abcdef', chunks: 3, chunkDelayMs: 5 }]);
    await submit();

    const a = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    const b = await server.stream({ url: `/api/sessions/${sessionId}/stream` });

    await a.until(finished, 4000);
    await b.until(finished, 4000);

    const keys = (handle: typeof a): string[] =>
      handle
        .frames()
        .filter((frame) => frame.event === 'progress')
        .map((frame) => (frame.data as { key: string }).key);
    expect(keys(a)).toEqual(keys(b));

    await a.abort();
    await b.abort();
    expect(server.services.bus.subscriberCount(sessionId)).toBe(0);
  });

  it('loses nothing and repeats nothing across a reattach', async () => {
    // The whole promise of snapshot-plus-cursor: the union of both connections
    // is exactly the sequence, with no gap and no duplicate.
    await server.dispose();
    await standUp([{ text: 'a longer answer here', chunks: 8, chunkDelayMs: 8 }]);
    await submit();

    const first = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    const early = await first.until(
      (frame) => frame.event === 'progress' && (frame.data as { seq: number }).seq >= 2,
      4000,
    );
    const cursor = early.id;
    await first.abort();

    const second = await server.stream({
      url: `/api/sessions/${sessionId}/stream?after=${String(cursor)}`,
    });
    await second.until(finished, 4000);

    const seqs = (handle: typeof first): number[] =>
      handle
        .frames()
        .filter((frame) => frame.event === 'progress')
        .map((frame) => (frame.data as { seq: number }).seq);

    /**
     * **Truncated at the cursor, because that is what a client is.**
     *
     * A reconnect resumes from the last event the client actually *processed*,
     * not from an arbitrary earlier one — frames that arrived after it decided
     * to reconnect are frames it is asking to be sent again. Counting those as
     * duplicates would be the test asserting against a client that keeps what it
     * has already thrown away.
     */
    const resumedAt = Number((cursor ?? '.0').split('.').at(-1));
    const kept = seqs(first).filter((seq) => seq <= resumedAt);

    const union = [...kept, ...seqs(second)];
    const sorted = [...new Set(union)].sort((x, y) => x - y);
    // No duplicate…
    expect(union).toHaveLength(sorted.length);
    // …and no gap.
    expect(sorted).toEqual(sorted.map((_value, index) => index + 1));
    await second.abort();
  });

  it('replays a job that has already finished', async () => {
    // `activeJob` returns null the instant `finished_at` is set, so a stream
    // resolved from that alone would show a client nothing.
    await submit();
    const live = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await live.until(finished, 4000);
    await live.abort();

    const late = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    const snapshot = await late.until((frame) => frame.event === 'snapshot');
    expect((snapshot.data as { job: unknown }).job).not.toBeNull();
    await late.until(finished, 2000);
    await late.abort();
  });

  it('treats an unusable cursor as absent rather than 400ing', async () => {
    // A browser resends `Last-Event-ID` on its own; a malformed one that
    // answered 400 would brick the reconnect for as long as it kept trying.
    await submit();
    const stream = await server.stream({
      url: `/api/sessions/${sessionId}/stream?after=not-a-cursor`,
    });

    expect(stream.status).toBe(200);
    await stream.until((frame) => frame.event === 'snapshot');
    await stream.abort();
  });

  it('accepts a cursor through Last-Event-ID as well as the query', async () => {
    await submit();
    const stream = await server.stream({
      url: `/api/sessions/${sessionId}/stream`,
      headers: { 'last-event-id': 'nonsense.1' },
    });
    expect(stream.status).toBe(200);
    await stream.abort();
  });

  it('refuses before it takes the socket, so the refusal is readable JSON', async () => {
    // Both framework defaults are wrong past `writeHead` — a throw is either
    // swallowed silently or kills the process — so everything that can answer in
    // JSON answers first.
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    const refused = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/stream`,
    });

    expect(refused.status).toBe(401);
    expect(refused.body.error).toBe('unauthenticated');
  });

  it('carries no id on a delta, because no store can answer for one', async () => {
    await server.dispose();
    await standUp([{ text: 'abcdef', chunks: 3, chunkDelayMs: 5 }]);
    await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, 4000);

    const deltas = stream.frames().filter((frame) => frame.event === 'delta');
    expect(deltas.length).toBeGreaterThan(0);
    for (const delta of deltas) expect(delta.id).toBeUndefined();
    await stream.abort();
  });
});

describe('cancelling', () => {
  it('stops the turn and commits it as failed', async () => {
    await server.dispose();
    await standUp([{ text: 'a slow answer', chunks: 10, chunkDelayMs: 15 }]);
    const accepted = await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until((frame) => frame.event === 'delta', 4000);

    const cancelled = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/jobs/${String(accepted.body.jobId)}/cancel`,
    });
    expect(cancelled.status).toBe(202);

    const end = await stream.until(finished, 4000);
    expect((end.data as { params: { state: string } }).params.state).toBe('failed');
    await stream.abort();

    // …and the turn is on disk with what it had, not silently never-happened.
    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    expect(turns.body.turns).toHaveLength(1);
    expect(turns.body.turns[0].status).toBe('failed');
  });

  it("answers 404 for a job that is not this account's", async () => {
    const accepted = await submit();
    await server.services.runner.settle();

    await server.services.accounts.create({
      handle: 'sister',
      password: 'correct horse battery',
      role: 'user',
    });
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'sister', password: 'correct horse battery' },
    });

    const refused = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/jobs/${String(accepted.body.jobId)}/cancel`,
    });
    expect(refused.status).toBe(404);
  });
});

describe('the transcript', () => {
  it('is the path from the head, and the turn carries its record', async () => {
    await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, 4000);
    await stream.abort();

    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    expect(turns.body.turns).toHaveLength(1);
    expect(turns.body.turns[0].output.text).toBe('The rain had not stopped for three days.');
    expect(turns.body.turns[0].request.calls).toHaveLength(1);
  });
});

describe('a hand-edited session file reaches the log', () => {
  it('turns a divergence into a user-attributed effect on read', async () => {
    // **Gate 16, through the server rather than by calling the reconciler.**
    // `reconcileHandEdits` was exported, unit-tested and reached by nothing, so
    // this step was green on code the running server never executed — and a
    // hand edit was absorbed into the head snapshot without ever entering the
    // effect log, which is the failure [02 §8.1] exists to prevent.
    await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, 4000);
    await stream.abort();

    // Open session.json in a text editor, so to speak, and set the clock.
    const file = join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json');
    const onDisk = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(
      file,
      JSON.stringify({
        ...onDisk,
        channels: { 'se.clock': { version: 1, value: { day: 1, hour: 19, minute: 30 } } },
      }),
    );

    // Reading the session is what reconciles it.
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.status).toBe(200);

    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    const last = turns.body.turns.at(-1) as {
      effects: { channelId: string; proposedBy: { kind: string }; after: unknown }[];
    };

    // A turn of its own, attributed to the person who opened the file — not a
    // silent overwrite on the next head advance.
    const effect = last.effects.find((each) => each.channelId === 'se.clock');
    expect(effect?.proposedBy).toEqual({ kind: 'user' });
    expect(effect?.after).toEqual({ day: 1, hour: 19, minute: 30 });
  });

  it('does nothing when the file and the log agree', async () => {
    // An ordinary read must not append a turn, or every page load would grow
    // the session.
    await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, 4000);
    await stream.abort();

    const before = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const after = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });

    expect(after.body.turns).toHaveLength(before.body.turns.length);
  });
});

describe('a session with a cast assembles the whole preset', () => {
  /** An actor with real prose in the sections the preset positions. */
  async function anActor(name: string): Promise<string> {
    const actor = newActor(name);
    const withProse = {
      ...actor,
      profile: {
        ...actor.profile,
        traits: ['watchful', 'unhurried'],
        sections: actor.profile.sections.map((section) =>
          section.id === 'se.summary'
            ? { ...section, body: `${name} keeps the rain off other people.` }
            : section.id === 'se.appearance'
              ? { ...section, body: `${name} wears a long coat.` }
              : section,
        ),
      },
    };
    const created = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: withProse,
    });
    expect(created.status).toBe(201);
    return actor.id;
  }

  it('fills the persona and actor slots that were unreachable before', async () => {
    // **The measurement the audit made.** Without a cast this preset yields 4 of
    // its 12 blocks, and every prompt test asserted on that — a prompt missing
    // most of the only shipped preset, pinned as correct.
    const personaId = await anActor('Ned');
    const actorId = await anActor('Vera');

    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'With a cast', cast: { persona: personaId, actors: [actorId] } },
    });
    expect(created.status).toBe(201);
    const withCast = created.body.session.id as string;

    await server.request({
      method: 'POST',
      url: `/api/sessions/${withCast}/turns`,
      payload: { idempotencyKey: 'k', headTurnId: null, input: { text: 'She waited.' } },
    });
    const stream = await server.stream({ url: `/api/sessions/${withCast}/stream` });
    await stream.until(finished, 4000);
    await stream.abort();

    const turns = await server.request({ method: 'GET', url: `/api/sessions/${withCast}/turns` });
    const kinds = (turns.body.turns[0].request.blocks as { source: { kind: string } }[]).map(
      (block) => block.source.kind,
    );

    expect(kinds).toContain('persona');
    expect(kinds).toContain('actor');
    // And the actor's own words reached the model, rather than an empty slot.
    const sent = provider.requests[0]?.messages.map((message) => message.content).join('\n') ?? '';
    expect(sent).toContain('Vera wears a long coat');
    expect(sent).toContain('Ned keeps the rain off other people');
  });

  it('copies the preset rather than referencing it', async () => {
    // [02 §8]: the session owns its pack from creation, so editing the mode's
    // default never rewrites a game in progress. The asymmetry with the cast —
    // which is links — is the design.
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Owns its preset' },
    });

    expect(created.body.session.preset.blocks).toHaveLength(12);
    expect(created.body.session.mode).toEqual({ id: 'storyengine.scene', config: null });
  });

  it('refuses a mode nobody has heard of at creation', async () => {
    // Distinct from the runner's fallback: nobody's story depends on a session
    // that does not exist yet, so silently substituting would be the surprise.
    const refused = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'x', mode: 'storyengine.nope' },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('unknown-mode');
  });

  it('refuses more actors than the mode seats', async () => {
    // The first real consumer of `ParticipantPolicy`, which was a declaration
    // nothing read. Scene seats one.
    const refused = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'x', cast: { persona: null, actors: ['a', 'b'] } },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('too-many-actors');
  });

  it('lets the cast change mid-story, unlike the mode and the preset', async () => {
    const actorId = await anActor('Marlow');
    const updated = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/cast`,
      payload: { persona: null, actors: [actorId] },
    });

    expect(updated.status).toBe(200);
    expect(updated.body.session.cast.actors).toEqual([actorId]);
  });

  it('survives a cast naming an actor that is gone', async () => {
    // [00 §3.3]: a deleted actor must not make a session unplayable.
    await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/cast`,
      payload: { persona: null, actors: ['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aff'] },
    });

    await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    const end = await stream.until(finished, 4000);
    expect((end.data as { params: { state: string } }).params.state).toBe('complete');
    await stream.abort();
  });
});
