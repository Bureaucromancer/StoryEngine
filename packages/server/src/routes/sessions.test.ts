// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  newActor,
  newLorebook,
  newPreset,
  newSetup,
  newTreatment,
  TREATMENT_SCHEMA,
  uuidv7,
  type PlotHook,
} from '@storyengine/shared';

import { DOCS_LOREBOOK_ID } from '../docs-lorebook.js';
import { defaultMode, registerMode } from '../mode-registry.js';
import { channelDefinition, registerChannel } from '../sessions/channels.js';
import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import {
  GENERATING_MODE,
  GENERATING_MODE_ID,
  SETUP_MODE,
  SETUP_MODE_ID,
  TEST_MODE,
  TEST_MODE_ID,
} from '../test-mode.js';
import { Layout, userOwner } from '../storage/layout.js';
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

/**
 * `session.json` as the store wrote it. ***The pool and the Setup copy are read
 * here, not off a reply*** (2026-09-27): a reply no longer carries either, for
 * `presentSession`'s reasons, and what these tests claim is what the session
 * holds.
 */
async function sessionFileOf(id: string): Promise<any> {
  return JSON.parse(
    await readFile(join(server.dataDir, 'users', 'ned', 'sessions', id, 'session.json'), 'utf8'),
  );
}

const finished = (frame: SseFrame): boolean =>
  frame.event === 'progress' && (frame.data as { key: string }).key === 'turn.finished';

/**
 * ***How long a whole turn may take to say it has finished*** (2026-09-27).
 *
 * The scripted turn takes about fifty milliseconds on a developer's machine.
 * CI run 66's Windows leg, with the rest of the suite running beside it, saw
 * every frame of one up to its last `step.finished` and then no
 * `turn.finished` within the four seconds this file allowed. Between those two
 * frames is the commit, which is fsync'd writes, and that runner's disk under
 * that load is slower than a budget written here. The P2 gate allows eight
 * seconds for the same frame, so this file does too. A turn that never
 * finishes still fails, eight seconds later instead of four.
 */
const TURN_FINISHES_MS = 8_000;

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

  /**
   * A session need not be named — [10 §11.1a](../../../../docs/design/10-ui-surfaces.md).
   *
   * Nothing resolves a session by name and no folder is derived from one, so a
   * name freezes nothing at creation and demanding one bought only a form to
   * fill in first. The API draws no distinction between an absent name and an
   * empty one, which is why both of the first two cases land in the same place.
   */
  it('starts without a name, and stores the empty string', async () => {
    const bare = await server.request({ method: 'POST', url: '/api/sessions', payload: {} });
    expect(bare.status).toBe(201);
    expect(bare.body.session.name).toBe('');

    // Trimmed at the route, so a name of three spaces cannot produce a list
    // entry that renders as an invisible link.
    const spaces = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: '   ' },
    });
    expect(spaces.body.session.name).toBe('');

    // Both are real sessions, listed beside the named one from `standUp`.
    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    expect(listed.body.sessions).toHaveLength(3);
  });

  /** `maxLength` survived the field becoming optional. */
  it('still refuses a name longer than the schema allows', async () => {
    const long = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'x'.repeat(201) },
    });
    expect(long.status).toBe(400);
  });

  /**
   * Renaming through the same `PATCH` that archives — [03 §8].
   *
   * The follow-up `GET` is the half that matters: a handler could build a
   * correct response body without the write ever reaching disk, and only a
   * second request through a different route proves it did.
   */
  it('renames a session, and un-names it again', async () => {
    const renamed = await server.request({
      method: 'PATCH',
      url: `/api/sessions/${sessionId}`,
      payload: { name: 'Rain City, after the fire' },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.session.name).toBe('Rain City, after the fire');

    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    expect(listed.body.sessions.map((each: { name: string }) => each.name)).toEqual([
      'Rain City, after the fire',
    ]);

    // Clearing it is allowed, because it is the state a session may start in.
    // A rule that let you never name a session but never un-name one would be
    // arbitrary in a way somebody would have to discover.
    const cleared = await server.request({
      method: 'PATCH',
      url: `/api/sessions/${sessionId}`,
      payload: { name: '' },
    });
    expect(cleared.body.session.name).toBe('');
  });

  /**
   * `archived` had to relax from required to optional for a rename to be
   * expressible, which is what makes an empty body expressible too.
   * `minProperties` is what keeps that from being a 200 that did nothing.
   */
  it('refuses a patch that asks for nothing, and one that asks for something unknown', async () => {
    const empty = await server.request({
      method: 'PATCH',
      url: `/api/sessions/${sessionId}`,
      payload: {},
    });
    expect(empty.status).toBe(400);

    const unknown = await server.request({
      method: 'PATCH',
      url: `/api/sessions/${sessionId}`,
      payload: { headTurnId: 'turn-1' },
    });
    expect(unknown.status).toBe(400);
  });

  it("answers 404 for another account's session, not 403", async () => {
    // The path is the owner ([09 §4.3]): confirming the id exists elsewhere
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
    await stream.until(finished, TURN_FINISHES_MS);
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

  it('rejects an empty redoOf, which names no turn', async () => {
    // `minLength: 1`, as `rewriteOf` has: an empty id is a malformed request
    // rather than a turn that is not there, and it should not reach the read
    // that would answer 404.
    const bad = await submit({ redoOf: '' });
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

    const end = await stream.until(finished, TURN_FINISHES_MS);
    expect((end.data as { params: { state: string } }).params.state).toBe('complete');
    await stream.abort();
  });

  it('gives two clients the same ordered events, and unsubscribes both', async () => {
    // [09 §3.1]: the session stream is subscribed while viewing, so two tabs on
    // one session is the ordinary case rather than an exotic one.
    await server.dispose();
    await standUp([{ text: 'abcdef', chunks: 3, chunkDelayMs: 5 }]);
    await submit();

    const a = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    const b = await server.stream({ url: `/api/sessions/${sessionId}/stream` });

    await a.until(finished, TURN_FINISHES_MS);
    await b.until(finished, TURN_FINISHES_MS);

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
    await second.until(finished, TURN_FINISHES_MS);

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
    await live.until(finished, TURN_FINISHES_MS);
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
    await stream.until(finished, TURN_FINISHES_MS);

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

    const end = await stream.until(finished, TURN_FINISHES_MS);
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
    await stream.until(finished, TURN_FINISHES_MS);
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
    // effect log, which is the failure [03 §8.1] exists to prevent.
    await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, TURN_FINISHES_MS);
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
    await stream.until(finished, TURN_FINISHES_MS);
    await stream.abort();

    const before = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const after = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });

    expect(after.body.turns).toHaveLength(before.body.turns.length);
  });
});

/**
 * **The error surface** — [06 §4.2], [P7.1].
 *
 * That section calls this *"the part worth building properly, and the part the
 * sources have nothing like"*: a health record on the session, a banner saying
 * the story is unaffected, and **recovery offered rather than applied**. The
 * banner is the client's; the record and the recovery are these.
 *
 * ***Driven by changing a schema under a live session, which is the scenario
 * 4.2 is actually about*** — *"a session that has been open for three months
 * will meet a channel that has changed shape"*. The first draft of these tests
 * drove it with a hand-edited `session.json` and found nothing, which was the
 * mechanisms working: a bad value *arriving* is refused at the divergence step
 * and never reaches state, so there is nothing to quarantine. The two paths are
 * genuinely different and only one of them ends here.
 *
 * The substitution is a plausible evolution rather than a contrived one: a clock
 * that moved to quarter-hour granularity. The stored `08:05` stops fitting; the
 * declared init of `08:00` still does, which matters because a channel whose own
 * default fails its new schema is deliberately left alone.
 */
describe('a channel whose schema changed under a live session', () => {
  const QUARTER_HOURS = { enum: [0, 15, 30, 45] };

  /** Runs a turn, then tightens the clock's schema the way a new build would. */
  async function afterASchemaChange(): Promise<() => void> {
    await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, TURN_FINISHES_MS);
    await stream.abort();

    const original = channelDefinition('se.clock');
    if (original === null) throw new Error('se.clock is not registered');
    registerChannel({
      ...original,
      schema: {
        ...(original.schema as Record<string, unknown>),
        properties: {
          day: { type: 'integer', minimum: 1 },
          hour: { type: 'integer', minimum: 0, maximum: 23 },
          minute: { type: 'integer', ...QUARTER_HOURS },
        },
      },
    });
    // The registry is a module global the server shares, so a substitution left
    // behind would reach every test after this one.
    return () => {
      registerChannel(original);
    };
  }

  it('opens the session anyway, which is the rule the whole ladder serves', async () => {
    // *"A session must always open. Load never fails on a channel problem."*
    const restore = await afterASchemaChange();
    try {
      const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(read.status).toBe(200);
    } finally {
      restore();
    }
  });

  it('reports which channel, which version, why, and what the value was', async () => {
    // All of 06 §4.2's first bullet — *"which channels are degraded, which
    // version they were written against, and why they failed"* — plus the raw
    // value, because recovery is a decision nobody can make unseen.
    const restore = await afterASchemaChange();
    try {
      const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      const health = read.body.health as {
        channelId: string;
        version: number;
        reason: string;
        raw: { minute: number };
      }[];

      expect(health).toHaveLength(1);
      expect(health[0]?.channelId).toBe('se.clock');
      expect(health[0]?.version).toBe(1);
      expect(health[0]?.reason).toContain('/minute');
      expect(health[0]?.raw.minute).toBe(5);
    } finally {
      restore();
    }
  });

  it('resets the channel to what the mode declared, and records doing so', async () => {
    const restore = await afterASchemaChange();
    try {
      await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });

      const turns = await server.request({
        method: 'GET',
        url: `/api/sessions/${sessionId}/turns`,
      });
      const last = turns.body.turns.at(-1) as {
        effects: { channelId: string; proposedBy: { kind: string }; after: unknown }[];
      };
      const quarantine = last.effects.find((each) => each.channelId === 'se.clock');

      // The engine noticed; nobody proposed. And `after` is Scene's declared
      // init, not a value the engine invented.
      expect(quarantine?.proposedBy).toEqual({ kind: 'engine' });
      expect(quarantine?.after).toEqual({ day: 1, hour: 8, minute: 0 });
    } finally {
      restore();
    }
  });

  it('does not re-quarantine on the next read, so the log stays bounded', async () => {
    // A rung that fired on every load would turn one stale value into an
    // unbounded effect log. The marker stays, because clearing it is the
    // person's decision rather than the second read's.
    const restore = await afterASchemaChange();
    try {
      await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      const before = await server.request({
        method: 'GET',
        url: `/api/sessions/${sessionId}/turns`,
      });

      const again = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      const after = await server.request({
        method: 'GET',
        url: `/api/sessions/${sessionId}/turns`,
      });

      expect((again.body.health as unknown[]).length).toBe(1);
      expect(after.body.turns).toHaveLength(before.body.turns.length);
    } finally {
      restore();
    }
  });

  it('accepts the reset when a person writes the value that is standing', async () => {
    // One of 06 §4.2's three offers. Writing the current value clears the
    // marker, because a `degraded` state is only ever written by an effect
    // carrying a reason.
    const restore = await afterASchemaChange();
    try {
      await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });

      const accepted = await server.request({
        method: 'PUT',
        url: `/api/sessions/${sessionId}/channels/se.clock`,
        payload: { value: { day: 1, hour: 8, minute: 0 } },
      });

      expect(accepted.status).toBe(200);
      expect(accepted.body.effect.applied).toBe(true);
      expect(accepted.body.health).toEqual([]);
    } finally {
      restore();
    }
  });

  it('refuses a retry that still does not fit, without losing the record', async () => {
    // **The property that makes recovery safe to offer**: the button cannot put
    // the session back in the state it was rescued from. Recorded as a refusal
    // rather than answered with a 4xx, because a status code throws away the
    // record the workbench is meant to show.
    const restore = await afterASchemaChange();
    try {
      const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      const raw = (read.body.health as { raw: unknown }[])[0]?.raw;

      const retried = await server.request({
        method: 'PUT',
        url: `/api/sessions/${sessionId}/channels/se.clock`,
        payload: { value: raw },
      });

      expect(retried.status).toBe(200);
      expect(retried.body.effect.applied).toBe(false);
      expect(retried.body.effect.rejectedReason).toBe('schema');
      // Still reset, still degraded, still recoverable.
      expect(retried.body.health).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('takes an edited value when it fits, which is the third offer', async () => {
    const restore = await afterASchemaChange();
    try {
      await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });

      const edited = await server.request({
        method: 'PUT',
        url: `/api/sessions/${sessionId}/channels/se.clock`,
        payload: { value: { day: 1, hour: 21, minute: 45 } },
      });

      expect(edited.body.effect.applied).toBe(true);
      expect(edited.body.health).toEqual([]);
    } finally {
      restore();
    }
  });

  it('reports nothing for a session that is fine', async () => {
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });

    expect(read.body.health).toEqual([]);
  });
});

/**
 * **A bad value *arriving* never reaches the health record**, which is the
 * interaction between the two mechanisms and the thing that surprised the first
 * draft of the tests above.
 */
describe('a hand edit that does not fit its channel', () => {
  it('is refused at the divergence step, so nothing is ever degraded', async () => {
    await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, TURN_FINISHES_MS);
    await stream.abort();

    const file = join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json');
    const onDisk = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(
      file,
      JSON.stringify({
        ...onDisk,
        // Past the schema's `maximum: 23`, and reachable only this way —
        // `advance` carries minutes into hours, so nothing in the engine
        // produces a 25.
        channels: { 'se.clock': { version: 1, value: { day: 1, hour: 25, minute: 0 } } },
      }),
    );

    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    const last = turns.body.turns.at(-1) as {
      effects: { channelId: string; applied: boolean; rejectedReason: string | null }[];
    };
    const attempt = last.effects.find((each) => each.channelId === 'se.clock');

    // Recorded and attributed, as [03 §8.1] requires — and not applied, so the
    // quarantine below it has nothing to rescue.
    expect(attempt?.applied).toBe(false);
    expect(attempt?.rejectedReason).toBe('schema');
    expect(read.body.health).toEqual([]);
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
    await stream.until(finished, TURN_FINISHES_MS);
    await stream.abort();

    const turns = await server.request({ method: 'GET', url: `/api/sessions/${withCast}/turns` });
    const blocks = turns.body.turns[0].request.calls[0].blocks as {
      source: { kind: string; actorId?: string | null; contentHash?: string | null };
    }[];
    const kinds = blocks.map((block) => block.source.kind);

    expect(kinds).toContain('persona');
    expect(kinds).toContain('actor');
    // And each names the object as it was *used* — [P3.0]: the id for the
    // click-through, the hash for the bytes, end to end through the real
    // library rather than a fixture's spelling of them.
    const personaSource = blocks.find((block) => block.source.kind === 'persona')?.source;
    expect(personaSource?.actorId).toBe(personaId);
    expect(personaSource?.contentHash).toMatch(/^sha256:/);
    const actorSource = blocks.find((block) => block.source.kind === 'actor')?.source;
    expect(actorSource?.actorId).toBe(actorId);
    expect(actorSource?.contentHash).toMatch(/^sha256:/);
    // And the actor's own words reached the model, rather than an empty slot.
    const sent = provider.requests[0]?.messages.map((message) => message.content).join('\n') ?? '';
    expect(sent).toContain('Vera wears a long coat');
    expect(sent).toContain('Ned keeps the rain off other people');
  });

  /**
   * [P3.0]'s by-id read, through the route: one turn without the transcript
   * riding along, and the same 404 for a turn that never existed as for one
   * that is not this session's — "No such turn." confirms nothing.
   */
  it('serves one turn by its own address, and 404s one that is not there', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'By id' },
    });
    const sessionId = created.body.session.id as string;
    await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k-by-id', headTurnId: null, input: { text: 'She waited.' } },
    });
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, TURN_FINISHES_MS);
    await stream.abort();

    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    const head = turns.body.turns.at(-1);
    const headId = head.id as string;
    const one = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/turns/${headId}`,
    });
    expect(one.status).toBe(200);
    // The whole record, byte-equal with the transcript's copy of it.
    expect(one.body.turn).toEqual(head);

    const missing = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/turns/01a00000-0000-7000-8000-000000000000`,
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'not-found', message: 'No such turn.' });
  });

  it('copies the preset rather than referencing it', async () => {
    // [03 §8]: the session owns its pack from creation, so editing the mode's
    // default never rewrites a game in progress. The asymmetry with the cast —
    // which is links — is the design.
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Owns its preset' },
    });

    // Tracks the Scene preset's block count, so it moves when that preset
    // gains a block — 25 since the time and the place (2026-09-30), 23 since
    // the secret plot's slot ([P14.5b]), 22 since
    // the established-state slot ([P14.5a]), 21
    // since the embodied instruction and the card's three
    // prompt slots ([P14.3]), 17 since the summary slot ([07 §5.1]'s chain, [P8.1]), 16
    // from the goal slot ([06 §7.3.3]'s *always injected*, [P7.6]), 15 from the
    // second lore slot ([P6B.1], the phase every `after_char` entry was being
    // dropped for), 14 from the previous-attempt slot ([06 §5.1]), 13 from the
    // writing-samples slot ([04 §3.1]) before it.
    //
    // *The count is the weaker half and is kept for the history it carries.*
    // What this test is actually for is that a session **copies** the pack, and
    // an absolute count of a shipped object is a number that changes whenever
    // anything ships — the lesson [P7B.0]'s scan-count assertion learned. So the
    // block below names the slot instead, which is the claim that survives.
    expect(created.body.session.preset.blocks).toHaveLength(25);
    expect(created.body.session.preset.blocks.map((block: { id: string }) => block.id)).toContain(
      'se.summary',
    );
    expect(created.body.session.mode).toEqual({ id: 'storyengine.scene', config: null });
  });

  /**
   * ***Voice, dispatch and the speaker policy are written down at creation*** —
   * [P14 §1.2](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
   * [P14.0].
   *
   * Read off the file rather than the reply, because what matters is what a
   * later build reads: a session with none of the three is taken for one made
   * before P14.0 and read as the mode's *legacy* values, so a session made now
   * has to carry what it was made with — or the stage that changes Scene's
   * declared values would re-voice it.
   */
  it('writes the mode’s declared voice, dispatch and speakers onto the session', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Says how it plays' },
    });
    expect(created.status).toBe(201);

    const definition = defaultMode().definition;
    const file = await sessionFileOf(created.body.session.id as string);
    expect(file.voice).toBe(definition.voice);
    expect(file.dispatch).toBe(definition.dispatch);
    expect(file.speakers).toEqual({
      policy: definition.participants.select,
      allowSelfResponses: false,
      namesInHistory: 'groups',
      maxPerRound: 3,
    });
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
    // nothing read. ~~Scene seats one.~~ Scene seats 32 since [P14.3] — the
    // cast body's own ceiling — so the test mode, which seats one, asks.
    registerMode(TEST_MODE);
    const refused = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'x', mode: TEST_MODE_ID, cast: { persona: null, actors: ['a', 'b'] } },
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

  /**
   * **Selection is the only way a lorebook reaches a session**, so there has to
   * be a way to select one after the session exists.
   *
   * Without this route a session started without naming books could never gain
   * a world, and every session written before the field existed would be stuck
   * without one permanently. It is the cast route's sibling for the same
   * reason: both are links a story legitimately changes partway through.
   */
  it('lets the world change mid-story, the way the cast does', async () => {
    const updated = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/lore`,
      payload: { treatment: null, lore: ['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4abc'] },
    });

    expect(updated.status).toBe(200);
    expect(updated.body.session.lore).toEqual(['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4abc']);

    // And back to none, which is how somebody removes a book they regret.
    const cleared = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/lore`,
      payload: { treatment: null, lore: [] },
    });
    expect(cleared.body.session.lore).toEqual([]);
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
    const end = await stream.until(finished, TURN_FINISHES_MS);
    expect((end.data as { params: { state: string } }).params.state).toBe('complete');
    await stream.abort();
  });
});

describe('the transcript is bounded and in order', () => {
  async function twoTurns(): Promise<void> {
    await submit({ input: { text: 'The first thing.' } });
    let stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, TURN_FINISHES_MS);
    await stream.abort();

    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    await submit({
      idempotencyKey: 'k2',
      headTurnId: read.body.session.headTurnId,
      input: { text: 'The second.' },
    });
    stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, TURN_FINISHES_MS);
    await stream.abort();
  }

  it('returns the path oldest first', async () => {
    // The only transcript test submitted one turn, so the order was
    // unobservable — and `api.md` said the opposite of what the route does.
    await twoTurns();

    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    expect(turns.body.turns.map((each: { input: { text: string } }) => each.input.text)).toEqual([
      'The first thing.',
      'The second.',
    ]);
  });

  it('keeps the newest when a limit trims', async () => {
    await twoTurns();

    const one = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/turns?limit=1`,
    });
    expect(one.body.turns).toHaveLength(1);
    // The tail, because a transcript is read from the end.
    expect(one.body.turns[0].input.text).toBe('The second.');
  });

  it('treats a limit of zero as one rather than as everything', async () => {
    // `slice(-0)` is `slice(0)` — the whole array. A caller asking for none got
    // every turn in the file, which is the wrong direction for a bound.
    await twoTurns();

    const none = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/turns?limit=0`,
    });
    expect(none.body.turns).toHaveLength(1);
  });
});

describe('the snapshot frame carries what a client needs to render', () => {
  it('names every field the client reducer reads', async () => {
    // **The contract between the two halves is bound by nothing** — the client
    // re-declares these shapes by hand, and a rename on this side turns into a
    // plausible *idle* state over there rather than an error. Until there is a
    // shared type, this is the assertion that at least makes the server half
    // fail loudly.
    await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    const snapshot = await stream.until((frame) => frame.event === 'snapshot');
    const data = snapshot.data as Record<string, unknown>;

    expect(Object.keys(data).sort()).toEqual(['cursor', 'job', 'sessionId', 'text', 'turn']);
    expect(data['sessionId']).toBe(sessionId);
    // A job in flight, with the four fields the client's status derives from.
    expect(Object.keys(data['job'] as object).sort()).toEqual([
      'commitStep',
      'id',
      'status',
      'turnId',
    ]);
    await stream.abort();
  });

  it('carries the accumulated text and a resumable cursor once a turn is under way', async () => {
    // `.not.toBeNull()` on the job was the whole of the previous assertion, so
    // `text` and `cursor` — the two fields that make a reattach lossless — were
    // never checked at all.
    await submit();
    let stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, TURN_FINISHES_MS);
    await stream.abort();

    stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    const snapshot = await stream.until((frame) => frame.event === 'snapshot');
    const data = snapshot.data as { text: string; cursor: string; turn: { status: string } };

    expect(data.text).toContain('The rain had not stopped');
    // `<jobId>.<seq>` — what `?after=` and `Last-Event-ID` both take.
    expect(data.cursor).toMatch(/^[0-9a-f-]+\.\d+$/);
    expect(data.turn.status).toBe('complete');
    await stream.abort();
  });

  it('opens with a null job and no text between turns', async () => {
    // The ordinary state of a session somebody is reading, and the one the
    // client must not mistake for a finished turn.
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    const snapshot = await stream.until((frame) => frame.event === 'snapshot');
    const data = snapshot.data as { job: unknown; text: unknown; cursor: unknown };

    expect(data.job).toBeNull();
    expect(data.text).toBeNull();
    expect(data.cursor).toBeNull();
    await stream.abort();
  });
});

/**
 * **A session can play an imported preset** — [P4 §1.9], the wiring PLAYABLE
 * needs and the minimum that makes it possible at all.
 *
 * A library full of imported presets that no session can play is a library
 * nobody can evaluate, which is why this lands at P4.1 rather than waiting for
 * P7's surface. The recorded position that *"choosing a different pack is P7's
 * surface"* is amended in place rather than contradicted: P7 keeps browsing,
 * previewing and switching mid-session.
 */
describe('creating a session with a chosen preset', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
  });

  afterEach(async () => {
    await server.dispose();
  });

  async function makePreset(name: string): Promise<string> {
    const preset = newPreset(name);
    const created = await server.request({
      method: 'POST',
      url: '/api/library/presets',
      payload: { object: preset },
    });
    expect(created.status).toBe(201);
    return preset.id;
  }

  it('copies the named preset instead of the mode default', async () => {
    const id = await makePreset('Harbour');

    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'A session', preset: id },
    });

    expect(created.status).toBe(201);
    expect(created.body.session.preset.name).toBe('Harbour');
  });

  it('still copies the mode default when none is named', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'A session' },
    });

    expect(created.status).toBe(201);
    expect(created.body.session.preset.id).toBe(defaultMode().definition.assembly.defaultPreset.id);
  });

  it('refuses an unknown preset rather than falling back to the default', async () => {
    // Falling back would give somebody a different prompt pack than they asked
    // for and say nothing, which is the same surprise an unknown mode gets
    // refused for a few lines above.
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'A session', preset: '01950000-0000-7000-8000-000000000000' },
    });

    expect(created.status).toBe(422);
    expect(created.body.error).toBe('unknown-preset');
  });

  it('refuses an id that is not a preset', async () => {
    const actor = newActor('Vera Solano');
    await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: { object: actor },
    });

    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'A session', preset: actor.id },
    });

    expect(created.status).toBe(422);
  });
});

/**
 * **The declaration held to** — [06 §7.3], [P7.4].
 *
 * A mode says what it needs before the first turn, and creation is where that
 * either means something or does not. Without a check, a declared wizard
 * describes a screen somebody might build and constrains nothing; with one, a
 * `required` field cannot be skipped and a key the mode never asked for cannot
 * reach a session file.
 */
describe('a session for a mode with a wizard', () => {
  beforeEach(() => {
    registerMode(SETUP_MODE);
  });

  async function create(setup?: unknown) {
    return server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        name: 'Wizard',
        mode: SETUP_MODE_ID,
        ...(setup === undefined ? {} : { modeConfig: setup }),
      },
    });
  }

  const ANSWERS = { premise: 'A city that does not sleep.', difficulty: 'harsh', dice: true };

  it('keeps the answers it was given', async () => {
    const response = await create(ANSWERS);

    expect(response.status).toBe(201);
    expect(response.body.session.mode.config).toEqual(ANSWERS);
  });

  it('takes a session without the optional field', async () => {
    const response = await create({ premise: 'Rain.', difficulty: 'even' });

    expect(response.status).toBe(201);
    // Absent rather than defaulted: a toggle nobody touched is not `false`, it
    // is a question the person did not answer, and the mode's steps can tell.
    expect(response.body.session.mode.config).toEqual({ premise: 'Rain.', difficulty: 'even' });
  });

  it('refuses one that skips a required field, and says which', async () => {
    const response = await create({ premise: 'Rain.' });

    // 422, not 400: the body is well-formed JSON of the declared shape, and
    // what is wrong is that it does not satisfy *this mode's* requirements.
    expect(response.status).toBe(422);
    expect(response.body.error).toBe('setup-invalid');
    // The issues travel, because a refusal reading only *invalid* leaves a
    // person guessing which field on a form the engine generated.
    expect(JSON.stringify(response.body.issues)).toContain('difficulty');
  });

  it('refuses a choice the mode does not offer', async () => {
    const response = await create({ ...ANSWERS, difficulty: 'impossible' });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('setup-invalid');
  });

  it('refuses a field of the wrong type', async () => {
    const response = await create({ ...ANSWERS, dice: 'yes' });

    expect(response.status).toBe(422);
  });

  /**
   * **A key the mode never asked for does not reach the file.** A wizard's
   * answers are the one place a client could quietly persist arbitrary data into
   * a session, and *ignoring* an unknown key would teach the next version of
   * that client that it worked — the argument `ProfilePatch` makes in
   * `routes/me.ts`.
   */
  it('refuses a field the mode never declared', async () => {
    const response = await create({ ...ANSWERS, apiKey: 'sk-nope' });

    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).not.toContain('sk-nope');
  });

  it('refuses it with nothing at all, because two fields are required', async () => {
    expect((await create()).status).toBe(422);
    expect((await create({})).status).toBe(422);
  });

  /**
   * Every session written before [P7.4], and every Scene session after it. `{}`
   * would be a claim that a wizard ran and collected nothing.
   */
  it('writes no setup key for a mode that has no wizard', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Plain' },
    });

    expect(response.status).toBe(201);
    // `null`, not `{}`: *no wizard ran* and *a wizard ran and collected nothing*
    // are different, and every session written before [P7.4] is in the first.
    expect(response.body.session.mode.config).toBeNull();
  });

  it('refuses answers to a mode that asked for nothing', async () => {
    // Told rather than quietly ignored: the derivation is
    // `additionalProperties: false` over no properties, so a client sending a
    // wizard's answers to Scene hears about it.
    const response = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Plain', modeConfig: { premise: 'Rain.' } },
    });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('setup-invalid');
  });
});

/**
 * **The world made on the session's first turn** — [06 §7.3], [P7.4], and
 * [00 §2.3]'s *single biggest reliability difference available versus the
 * source*.
 *
 * The design asks for *"separate validated generations, each individually
 * retryable, applied as they succeed"*, and read back that sentence describes
 * the step loop: an ordered list, a model call each, a schema each, a `failure`
 * policy each, a record each, and effects applied as each returns. So setup is a
 * turn and the parts are its steps — which is why these tests assert on a turn
 * rather than on a generation pipeline, and why there is no second pipeline to
 * assert on.
 */
describe('a mode that generates its world', () => {
  beforeEach(() => {
    registerMode(GENERATING_MODE);
  });

  const ANSWERS = { premise: 'A city that does not sleep.', difficulty: 'even' };

  /** Creates a generating session and waits for its setup turn to finish. */
  async function generate(script: ScriptedReply[]): Promise<string> {
    await standUp(script);
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Generated', mode: GENERATING_MODE_ID, modeConfig: ANSWERS },
    });
    const id = created.body.session.id as string;

    // The same stream a client opens for any turn, which is the point: nothing
    // about watching a generation is new.
    const stream = await server.stream({ url: `/api/sessions/${id}/stream` });
    await stream.until(finished, 6000);
    await stream.abort();
    return id;
  }

  it('reserves a turn and hands back the job to watch', async () => {
    await standUp([{ object: { hour: 21 } }, { text: 'Rain.' }]);

    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Generated', mode: GENERATING_MODE_ID, modeConfig: ANSWERS },
    });

    expect(created.status).toBe(201);
    // The same shape `POST /sessions/:id/turns` answers with, so the client
    // opens the stream it already knows how to open: generation is a thing you
    // watch, not a thing you wait out behind a spinner.
    expect(created.body.activeJob).toMatchObject({ sessionId: created.body.session.id as string });
  });

  it('applies each part as it succeeds', async () => {
    const id = await generate([{ object: { hour: 21 } }, { text: 'It never stops.' }]);

    const session = await server.request({ method: 'GET', url: `/api/sessions/${id}` });
    // The first part's effect is on the session's channels, which is what
    // *applied* means — and it went through `acceptEffect` like any other, so
    // it is in the turn record and it branches.
    expect(session.body.session.channels['se.test.opening'].value).toEqual({ hour: 21 });
  });

  it('hands a part the answers the wizard collected', async () => {
    const id = await generate([{ object: { hour: 21 } }, { text: 'It never stops.' }]);

    const turns = await server.request({ method: 'GET', url: `/api/sessions/${id}/turns` });
    // The part echoed `StepInput.setup`, which is the only way to see from
    // outside that the answers reached it.
    expect(turns.body.turns[0].output.text).toContain('A city that does not sleep.');
  });

  /**
   * ***Individually retryable means individually **failable*** — the property
   * the design is actually after, and the one a single part could not show.
   * `failure: 'warn'` is the right policy for a part where `abort` is right for
   * narration: a world half-made is worth more than no world, and the part that
   * failed is named in the record for a person to run again.
   */
  it('keeps what succeeded when a part fails', async () => {
    // The first part asks for `{hour}` and gets a shape that is not one, for as
    // many attempts as the ladder has — so it fails, and the second still runs.
    const wrong = { object: { our: 21 } };
    const id = await generate([wrong, wrong, wrong, { text: 'It never stops.' }]);

    const session = await server.request({ method: 'GET', url: `/api/sessions/${id}` });
    const turns = await server.request({ method: 'GET', url: `/api/sessions/${id}/turns` });

    // The channel was never written, because its part never produced a usable
    // answer — where a turn that fell over would have written neither.
    expect(session.body.session.channels['se.test.opening']).toBeUndefined();
    // And the turn committed with the other part's output, rather than falling
    // over and leaving a session with nothing.
    expect(turns.body.turns[0].output.text).toContain('It never stops.');
    expect(turns.body.turns[0].status).toBe('complete');
  });

  it('starts no turn at all for a mode that generates nothing', async () => {
    // An empty plan would commit a turn that did nothing — a blank first entry
    // in somebody's transcript, which is the cost [P7.3] refused for the roster.
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Wizard only', mode: SETUP_MODE_ID, modeConfig: ANSWERS },
    });

    expect(created.status).toBe(201);
    expect('activeJob' in (created.body as object)).toBe(false);
  });
});

/**
 * **Starting from a Setup** — [04 §7], [P7.4], and the consumer that library
 * kind has never had.
 *
 * `setups/` has had a folder, a canonical filename, an index walk, full CRUD, a
 * shelf and a `newSetup` factory whose only caller was a test. What it had no
 * consumer for was *anything*: session creation took mode, preset, treatment,
 * cast and lore as five separate parameters and had no way to be handed the one
 * object that holds all five.
 *
 * **And it is what makes [04 §6.1b]'s middle rung reachable.** That section
 * settles where an authored default may be written down — *"a Treatment
 * proposes, a Setup overrides, and the running session owns it"* — and there was
 * no Setup rung, because a session did not record which one it came from.
 */
describe('a session started from a Setup', () => {
  async function aSetup(over: Record<string, unknown> = {}): Promise<string> {
    const made = { ...newSetup('The Fixer’s Debt'), ...over };
    const response = await server.request({
      method: 'POST',
      url: '/api/library/setups',
      payload: made,
    });
    if (response.status !== 201) throw new Error(`setup create failed: ${String(response.status)}`);
    return response.body.object.id as string;
  }

  async function startFrom(setup: string, over: Record<string, unknown> = {}) {
    return server.request({ method: 'POST', url: '/api/sessions', payload: { setup, ...over } });
  }

  it('keeps a copy, so editing the Setup cannot reach the game', async () => {
    const id = await aSetup();

    const created = await startFrom(id);

    expect(created.status).toBe(201);
    // The object itself, not a link — [00 §3.1], the asymmetry the preset has.
    const held = await sessionFileOf(created.body.session.id as string);
    expect(held.setup).toMatchObject({ id, schema: 'storyengine.setup/1' });
    // And a reply names it without carrying it, goals and hooks and all.
    expect(created.body.session.setup).toEqual({ id, name: held.setup.name });
  });

  it('takes its name when the session was not given one', async () => {
    const id = await aSetup();

    const created = await startFrom(id);

    // A session made from *The Fixer's Debt* and left unnamed is that, not
    // *Untitled*.
    expect(created.body.session.name).toBe('The Fixer’s Debt');
  });

  it('takes the mode it names', async () => {
    registerMode(SETUP_MODE);
    const id = await aSetup({
      mode: { id: SETUP_MODE_ID, config: { premise: 'Rain.', difficulty: 'harsh' } },
    });

    const created = await startFrom(id);

    expect(created.body.session.mode.id).toBe(SETUP_MODE_ID);
    // `Setup.mode.config` is *"whatever the mode's own setup collected"*, which
    // is the same value the wizard collects — so it lands where the wizard's
    // answers land, and is validated against the mode's declaration on the way.
    expect(created.body.session.mode.config).toEqual({ premise: 'Rain.', difficulty: 'harsh' });
  });

  it('refuses a Setup whose config the mode would not accept', async () => {
    registerMode(SETUP_MODE);
    const id = await aSetup({
      mode: { id: SETUP_MODE_ID, config: { premise: 'Rain.', difficulty: 'impossible' } },
    });

    // Held to the declaration exactly as a wizard's answers are: a Setup
    // written against a different build is not a reason to write a config the
    // mode cannot read.
    expect((await startFrom(id)).status).toBe(422);
  });

  it('takes its treatment and its lore', async () => {
    const id = await aSetup({
      treatment: { id: 'treat-1', name: 'Rain City, noir' },
      lore: [{ ref: { id: 'book-1', name: 'Rain City' }, required: false }],
    });

    const created = await startFrom(id);

    expect(created.body.session.treatment).toBe('treat-1');
    expect(created.body.session.lore).toEqual(['book-1']);
  });

  it('offers the first persona it names, because choosing is the wizard’s job', async () => {
    const id = await aSetup({
      cast: {
        personaOptions: [{ id: 'actor-vera', name: 'Vera' }],
        partyDefault: [],
        narrator: null,
      },
    });

    const created = await startFrom(id);

    expect(created.body.session.cast).toEqual({ persona: 'actor-vera', actors: [] });
  });

  /**
   * **Everything it carries is a default a parameter overrides** — [04 §6.1b]'s
   * layering with the session's own parameters as the last word. Somebody who
   * picked a Setup and then changed the treatment meant the treatment they
   * changed it to.
   */
  it('gives way to a parameter sent beside it', async () => {
    const id = await aSetup({ treatment: { id: 'treat-1', name: 'Rain City, noir' } });

    const created = await startFrom(id, { name: 'My own', treatment: 'treat-2' });

    expect(created.body.session.name).toBe('My own');
    expect(created.body.session.treatment).toBe('treat-2');
  });

  /**
   * A dangling *treatment* is a session missing a book, which [00 §3.3] says to
   * carry on with. A dangling **Setup** is a session that would be created as
   * something other than what was asked for, because the Setup is *what to
   * create*.
   */
  it('is refused when there is no such Setup, rather than ignored', async () => {
    const created = await startFrom('not-a-setup');

    expect(created.status).toBe(422);
    expect(created.body.error).toBe('unknown-setup');
  });

  it('leaves the field off a session that was not started from one', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'By hand' },
    });

    expect('setup' in (created.body.session as object)).toBe(false);
  });
});

/**
 * **The hook pool, copied at creation from all four sources** — [03 §4.1],
 * [06 §6.1], [P7.5].
 *
 * The pool's fourth source had no home until this stage: `SessionFile` had no
 * `hooks` field and `NewSession` no way to pass one, though 03 §4.1 calls adding
 * one to a running session *the primary path*.
 *
 * **And [15 §5]'s first obligation is pinned end to end here**, not only over
 * the builder: *a copied hook keeps the source hook's id*, because a corpus of
 * sessions whose hooks have unrelated ids cannot be retro-fitted into a
 * continuity. [P7.5] calls it free now and unrecoverable later.
 */
describe('a session’s hook pool', () => {
  function hook(id: string): PlotHook {
    return {
      id,
      title: id,
      premise: 'The Flower Kingdom will declare war.',
      magnitude: 'sweeping',
      involves: [],
      weight: 1,
      delivery: 'guidance',
      once: true,
    };
  }

  async function aTreatment(hooks: PlotHook[]): Promise<string> {
    const made = { ...newTreatment('Rain City, noir'), hooks };
    const response = await server.request({
      method: 'POST',
      url: '/api/library/treatments',
      payload: made,
    });
    return response.body.object.id as string;
  }

  it('copies a treatment’s hooks, keeping their ids', async () => {
    const id = await aTreatment([hook('hook-war')]);

    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain', treatment: id },
    });

    expect((await sessionFileOf(created.body.session.id as string)).hooks).toEqual([
      { hook: expect.objectContaining({ id: 'hook-war' }), source: { kind: 'treatment', id } },
    ]);
  });

  it('takes the session’s own hooks, which had nowhere to be passed', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain', hooks: [hook('hook-mine')] },
    });

    expect((await sessionFileOf(created.body.session.id as string)).hooks).toEqual([
      { hook: expect.objectContaining({ id: 'hook-mine' }), source: { kind: 'session' } },
    ]);
  });

  it('takes a Setup’s hooks too, attributed to it', async () => {
    const made = { ...newSetup('The Fixer’s Debt'), hooks: [hook('hook-debt')] };
    const setup = await server.request({
      method: 'POST',
      url: '/api/library/setups',
      payload: made,
    });
    const setupId = setup.body.object.id as string;

    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { setup: setupId },
    });

    expect((await sessionFileOf(created.body.session.id as string)).hooks).toEqual([
      {
        hook: expect.objectContaining({ id: 'hook-debt' }),
        source: { kind: 'setup', id: setupId },
      },
    ]);
  });

  it('writes no pool at all when nothing carried a hook', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain' },
    });

    // Absent rather than `[]`: a session whose sources carried none is not a
    // session somebody emptied, and every session before [P7.5] is the former.
    expect('hooks' in (created.body.session as object)).toBe(false);
  });

  /**
   * [06 §6.1]'s *pulled, never pushed* over [00 §3.1]: editing a treatment must
   * not reach a game already in progress. The preset's asymmetry, not the cast's.
   */
  it('does not follow the treatment after the session exists', async () => {
    const id = await aTreatment([hook('hook-war')]);
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain', treatment: id },
    });
    const sessionId = created.body.session.id as string;

    const read = await server.request({ method: 'GET', url: `/api/library/treatments/${id}` });
    await server.request({
      method: 'PUT',
      url: `/api/library/treatments/${id}`,
      payload: { object: { ...read.body.object, hooks: [hook('hook-different')] } },
      headers: { 'if-match': read.body.contentHash as string },
    });

    expect((await sessionFileOf(sessionId)).hooks[0].hook.id).toBe('hook-war');
  });

  /**
   * ***The primary path, and creation was the only way in*** — [03 §4.1],
   * [P7.5]. That section says a session *"may add its own while running"* and
   * calls it that: a treatment is where hooks primarily live, but *I want this
   * to happen in this game* is a thought people have while playing.
   */
  describe('adding one to a running session', () => {
    async function aSession(): Promise<string> {
      const created = await server.request({
        method: 'POST',
        url: '/api/sessions',
        payload: { name: 'Rain' },
      });
      return created.body.session.id as string;
    }

    it('takes a hook mid-session, attributed to the session itself', async () => {
      const sessionId = await aSession();

      const added = await server.request({
        method: 'POST',
        url: `/api/sessions/${sessionId}/hooks`,
        payload: { hook: hook('hook-mine') },
      });

      expect(added.status).toBe(200);
      expect((await sessionFileOf(sessionId)).hooks).toEqual([
        { hook: expect.objectContaining({ id: 'hook-mine' }), source: { kind: 'session' } },
      ]);
      // And it is in the panel the same turn, with its source named — the one
      // source with no object to navigate to, because the session is what you
      // are already looking at.
      const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(read.body.hooks.rows[0]).toMatchObject({
        hookId: 'hook-mine',
        source: { kind: 'session' },
        refusal: null,
      });
    });

    /**
     * ***An id is minted when there is none, and this is the one source where
     * that is right.*** Every other hook in the pool was copied from an object
     * that had one, and [15 §5]'s obligation is that copying keeps it. A
     * session's own hook has no upstream to keep an id from — and without one it
     * cannot be committed, blocked, or recorded as fired, because every one of
     * those keys on `hook.id`.
     */
    it('mints an id for a hook that arrives without one', async () => {
      const sessionId = await aSession();
      const added = await server.request({
        method: 'POST',
        url: `/api/sessions/${sessionId}/hooks`,
        // Written out rather than derived from `hook()` with the id removed: a
        // rest element would name a binding nothing reads, and this is the whole
        // of what a client posts anyway.
        payload: {
          hook: {
            title: 'Mine',
            premise: 'The old bridge gives way in the storm.',
            magnitude: 'local',
            involves: [],
            weight: 1,
            delivery: 'guidance',
            once: true,
          },
        },
      });

      expect(added.status).toBe(200);
      const minted = (await sessionFileOf(sessionId)).hooks[0].hook.id as string;
      expect(minted).toMatch(/^[0-9a-f-]{36}$/);
      // Usable, which is the whole point of minting it: a hook with no id cannot
      // be committed, because Commit writes `se.hook#<id>`.
      const written = await server.request({
        method: 'PUT',
        url: `/api/sessions/${sessionId}/channels/${encodeURIComponent(`se.hook#${minted}`)}`,
        payload: { value: 'committed' },
      });
      expect(written.body.effect.applied).toBe(true);
    });

    /**
     * **An authoring act, not a story event** — [03 §4.1]: *"adding a hook
     * mid-session is an authoring act, not a story event, and must survive a
     * rewind"*. So it lands on the session file rather than as a channel effect,
     * and the pool a turn is judged against is session-wide.
     */
    it('writes the pool and not an effect', async () => {
      const sessionId = await aSession();
      await server.request({
        method: 'POST',
        url: `/api/sessions/${sessionId}/hooks`,
        payload: { hook: hook('hook-mine') },
      });

      const turns = await server.request({
        method: 'GET',
        url: `/api/sessions/${sessionId}/turns`,
      });
      // A channel write appends a turn carrying the effect. This one appends
      // nothing, because nothing happened in the story.
      expect(turns.body.turns).toEqual([]);
    });

    /**
     * *Removal takes **any** hook, whatever its source*, which is
     * [00 §3.1]'s prefill-not-binding: the pool was copied at creation, so a
     * treatment-borne entry in it is this session's copy, and declining to
     * remove it would make the copy a binding.
     */
    it('removes a hook the treatment put there, without touching the treatment', async () => {
      const id = await aTreatment([hook('hook-war')]);
      const created = await server.request({
        method: 'POST',
        url: '/api/sessions',
        payload: { name: 'Rain', treatment: id },
      });
      const sessionId = created.body.session.id as string;

      const removed = await server.request({
        method: 'DELETE',
        url: `/api/sessions/${sessionId}/hooks/hook-war`,
      });

      // Absent rather than `[]` when the last one goes — the claim the creation
      // path already makes.
      expect('hooks' in (removed.body.session as object)).toBe(false);
      const treatment = await server.request({
        method: 'GET',
        url: `/api/library/treatments/${id}`,
      });
      expect(treatment.body.object.hooks).toHaveLength(1);
    });

    it('succeeds at removing a hook that is already gone', async () => {
      const sessionId = await aSession();

      const removed = await server.request({
        method: 'DELETE',
        url: `/api/sessions/${sessionId}/hooks/never-there`,
      });

      // The state the caller asked for. A 404 would make a double-click an
      // error, where a missing *session* stays a 404 because it is a different
      // claim.
      expect(removed.status).toBe(200);
    });

    /**
     * ***One row, the one pressed*** (2026-09-28). A pool holds one hook
     * through two carriers on purpose, and the panel draws each as its own
     * row; by id alone, Remove on either took both. The pool is written by
     * hand because that is the plainest way to hold two entries under one id —
     * a treatment's and a lorebook's, edited apart.
     */
    describe('when two rows share one id', () => {
      async function twoRows(): Promise<string> {
        const sessionId = await aSession();
        const file = join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json');
        const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
        await writeFile(
          file,
          JSON.stringify({
            ...stored,
            hooks: [
              { hook: hook('hook-war'), source: { kind: 'treatment', id: 't-rain' } },
              {
                hook: { ...hook('hook-war'), title: 'The war, as the kingdom tells it' },
                source: { kind: 'lore', id: 'book-flowers' },
              },
            ],
          }),
        );
        return sessionId;
      }

      function sourcesOf(held: { hooks?: { source: unknown }[] }): unknown[] {
        return (held.hooks ?? []).map((entry) => entry.source);
      }

      it('removes only the row the caller names', async () => {
        const sessionId = await twoRows();

        const removed = await server.request({
          method: 'DELETE',
          url: `/api/sessions/${sessionId}/hooks/hook-war?from=lore&fromId=book-flowers`,
        });

        expect(removed.status).toBe(200);
        expect(sourcesOf(await sessionFileOf(sessionId))).toEqual([
          { kind: 'treatment', id: 't-rain' },
        ]);
      });

      it('removes every row under the id when no row is named, as before', async () => {
        const sessionId = await twoRows();

        await server.request({
          method: 'DELETE',
          url: `/api/sessions/${sessionId}/hooks/hook-war`,
        });

        expect((await sessionFileOf(sessionId)).hooks).toBeUndefined();
      });

      it('removes nothing, and succeeds, for a row the pool does not hold', async () => {
        const sessionId = await twoRows();

        const removed = await server.request({
          method: 'DELETE',
          url: `/api/sessions/${sessionId}/hooks/hook-war?from=setup&fromId=s-elsewhere`,
        });

        expect(removed.status).toBe(200);
        expect(sourcesOf(await sessionFileOf(sessionId))).toHaveLength(2);
      });

      it('refuses a source whose id does not fit its kind, and removes nothing', async () => {
        const sessionId = await twoRows();

        for (const query of ['from=session&fromId=x', 'from=lore', 'fromId=book-flowers']) {
          const refused = await server.request({
            method: 'DELETE',
            url: `/api/sessions/${sessionId}/hooks/hook-war?${query}`,
          });
          expect(refused.status, query).toBe(400);
        }
        expect(sourcesOf(await sessionFileOf(sessionId))).toHaveLength(2);
      });

      /**
       * *A malformed row is found by the source it is shown with* — the panel
       * draws a source it cannot read as the session's own, and the remove
       * reads it through the same function, so the row's Remove reaches it.
       */
      it('finds a malformed row by the source the panel showed for it', async () => {
        const sessionId = await aSession();
        const file = join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json');
        const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
        await writeFile(
          file,
          JSON.stringify({
            ...stored,
            hooks: [
              { hook: { id: 'broken', title: 'Storm' }, source: { kind: 'somewhere' } },
              { hook: hook('broken'), source: { kind: 'treatment', id: 't-rain' } },
            ],
          }),
        );
        const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
        const shown = (read.body.hooks.rows as { hookId: string; source: unknown }[]).filter(
          (row) => row.hookId === 'broken',
        );
        expect(shown.map((row) => row.source)).toContainEqual({ kind: 'session' });

        await server.request({
          method: 'DELETE',
          url: `/api/sessions/${sessionId}/hooks/broken?from=session`,
        });

        expect(sourcesOf(await sessionFileOf(sessionId))).toEqual([
          { kind: 'treatment', id: 't-rain' },
        ]);
      });
    });

    it('is a 404 for a session that is not there', async () => {
      const response = await server.request({
        method: 'POST',
        url: `/api/sessions/${uuidv7()}/hooks`,
        payload: { hook: hook('hook-mine') },
      });

      expect(response.status).toBe(404);
    });
  });

  /**
   * ***The same copy running the other way*** — [03 §4.1], [15 §5.1].
   *
   * The block above pins *copies a treatment's hooks, keeping their ids*. This
   * is its counterpart: a hook the session gained while playing, saved back onto
   * one of the three carriers [03 §4.1] already gives hooks a home on. **Until
   * it existed there was no way out of a session at all**, so a hook realised
   * mid-play — which [06 §6.1] calls *most of why the feature earns its place* —
   * died with the session it was realised in.
   *
   * *Through the route rather than only the function*, because two of the claims
   * are the route's own: the three 404s are three different claims a client has
   * to tell apart, and the system-library refusal reaches this route through a
   * mapping that lives in a file this one cannot call into.
   */
  describe('saving one back out of a session', () => {
    async function aLorebook(): Promise<string> {
      const response = await server.request({
        method: 'POST',
        url: '/api/library/lorebooks',
        payload: newLorebook('The Flower Kingdom'),
      });
      return response.body.object.id as string;
    }

    /** A session whose pool holds one hook of its own — the case with no upstream. */
    async function aSessionWith(
      one: PlotHook,
      over: Record<string, unknown> = {},
    ): Promise<string> {
      const created = await server.request({
        method: 'POST',
        url: '/api/sessions',
        payload: { name: 'Rain City', hooks: [one], ...over },
      });
      return created.body.session.id as string;
    }

    function promote(
      session: string,
      hookId: string,
      target: { kind: string; id: string },
      from?: { kind: string; id?: string },
    ): Promise<{ status: number; body: any }> {
      return server.request({
        method: 'POST',
        url: `/api/sessions/${session}/hooks/${hookId}/promote`,
        payload: from === undefined ? { target } : { target, from },
      });
    }

    /**
     * ***The id survives, which is the obligation [15 §5.1] calls unrecoverable
     * later.*** A session's own hook has no upstream, so the id it carries onto
     * the treatment is the only one it will ever have — and every session
     * started from that treatment afterwards copies *that* id, which is what
     * makes cross-session de-duplication possible at all.
     */
    it('keeps the hook’s id on the treatment it lands on', async () => {
      const treatment = await aTreatment([]);
      const session = await aSessionWith(hook('hook-war'));

      const saved = await promote(session, 'hook-war', { kind: 'treatment', id: treatment });

      expect(saved.status).toBe(200);
      expect(saved.body.object).toEqual({
        id: treatment,
        name: 'Rain City, noir',
        kind: 'treatment',
      });
      const after = await server.request({
        method: 'GET',
        url: `/api/library/treatments/${treatment}`,
      });
      // The whole hook, not the panel's redaction of it: `hookRows` sends
      // `premise` only once a hook is spent and never sends `involves`,
      // `weight`, `delivery` or `once` at all — which is the entire reason this
      // is a server route rather than a client read-modify-write.
      expect(after.body.object.hooks).toEqual([hook('hook-war')]);
    });

    it('takes it onto the session’s Setup', async () => {
      const made = newSetup('The Fixer’s Debt');
      const response = await server.request({
        method: 'POST',
        url: '/api/library/setups',
        payload: made,
      });
      const setup = response.body.object.id as string;
      const session = await aSessionWith(hook('hook-war'), { setup });

      const saved = await promote(session, 'hook-war', { kind: 'setup', id: setup });

      expect(saved.status).toBe(200);
      expect(saved.body.object).toMatchObject({ id: setup, kind: 'setup' });
      const after = await server.request({ method: 'GET', url: `/api/library/setups/${setup}` });
      expect(after.body.object.hooks.map((one: PlotHook) => one.id)).toEqual(['hook-war']);
    });

    /**
     * **Allowed, secondary, and for hooks genuinely inseparable from a piece of
     * lore** — [03 §4.1]'s own three words for the lorebook carrier. `hooks` is
     * optional there, and the distinction the whole feature keeps is that
     * *absent is not an emptied list*: the key appears on the first promotion
     * and is never written as `[]`.
     */
    it('takes it onto one of the session’s lorebooks, creating the key', async () => {
      const book = await aLorebook();
      const session = await aSessionWith(hook('hook-war'), { lore: [book] });

      const before = await server.request({
        method: 'GET',
        url: `/api/library/lorebooks/${book}`,
      });
      expect('hooks' in (before.body.object as object)).toBe(false);

      const saved = await promote(session, 'hook-war', { kind: 'lore', id: book });

      expect(saved.status).toBe(200);
      const after = await server.request({ method: 'GET', url: `/api/library/lorebooks/${book}` });
      expect(after.body.object.hooks).toEqual([hook('hook-war')]);
    });

    /**
     * Pressing the control twice is a thing people do — the first press leaves
     * the panel row looking exactly as it did. **Never a silent duplicate and
     * never a re-minted id**: [15 §5.1] calls the re-mint the one thing that
     * cannot be repaired afterwards, because a corpus of sessions whose hooks
     * have unrelated ids cannot be retro-fitted into a continuity.
     */
    it('refuses the second promotion of the same hook, and writes nothing', async () => {
      const treatment = await aTreatment([]);
      const session = await aSessionWith(hook('hook-war'));
      await promote(session, 'hook-war', { kind: 'treatment', id: treatment });
      const once = await server.request({
        method: 'GET',
        url: `/api/library/treatments/${treatment}`,
      });

      const again = await promote(session, 'hook-war', { kind: 'treatment', id: treatment });

      expect(again.status).toBe(409);
      expect(again.body.error).toBe('already-there');
      const now = await server.request({
        method: 'GET',
        url: `/api/library/treatments/${treatment}`,
      });
      // The hash is the assertion that nothing at all was written — a second
      // copy, a re-minted id and a no-op rewrite are all excluded by it.
      expect(now.body.contentHash).toBe(once.body.contentHash);
      expect(now.body.object.hooks).toHaveLength(1);
    });

    /**
     * ***The omission the feature rests on*** — [06 §6.1]'s *pulled, never
     * pushed*, in the direction that bites. Re-attributing the pool entry to the
     * object it was just saved to would claim the target owns the running copy,
     * and for a lorebook it would silently add `refuse`'s `book-inactive` clause
     * to a hook that did not have one — so a hook somebody wrote in the panel
     * and then saved would stop being eligible in the session they wrote it in.
     */
    it('leaves the session’s pool and the entry’s source exactly as they were', async () => {
      const book = await aLorebook();
      const session = await aSessionWith(hook('hook-war'), { lore: [book] });
      const before = await server.request({ method: 'GET', url: `/api/sessions/${session}` });
      const record = JSON.stringify(before.body.session);

      await promote(session, 'hook-war', { kind: 'lore', id: book });

      const after = await server.request({ method: 'GET', url: `/api/sessions/${session}` });
      // The whole record rather than the pool alone: a rewrite that restamped
      // `updatedAt` or reordered the pool would satisfy a comparison of the one
      // field somebody thought to assert on.
      expect(JSON.stringify(after.body.session)).toBe(record);
      expect((await sessionFileOf(session)).hooks[0].source).toEqual({ kind: 'session' });
    });

    it('is a 404 naming the object when the target is gone', async () => {
      const session = await aSessionWith(hook('hook-war'));

      const saved = await promote(session, 'hook-war', { kind: 'treatment', id: uuidv7() });

      expect(saved.status).toBe(404);
      // Three 404s, three claims. A person told *not found* about a promotion
      // cannot tell whether to look for their session, their hook or the
      // treatment they picked.
      expect(saved.body.error).toBe('no-such-object');
    });

    it('is a 404 naming the hook when the pool does not carry it', async () => {
      const treatment = await aTreatment([]);
      const session = await aSessionWith(hook('hook-war'));

      const saved = await promote(session, 'hook-elsewhere', {
        kind: 'treatment',
        id: treatment,
      });

      expect(saved.status).toBe(404);
      expect(saved.body.error).toBe('no-such-hook');
    });

    it('is a 404 naming the session when there is no such session', async () => {
      const treatment = await aTreatment([]);

      const saved = await promote(uuidv7(), 'hook-war', { kind: 'treatment', id: treatment });

      expect(saved.status).toBe(404);
      expect(saved.body.error).toBe('no-session');
    });

    /**
     * ***A target that moved underneath the write answers `409 target-moved`,
     * and the thing being asserted is what the body does **not** carry.***
     *
     * Every other library refusal this route can raise goes through
     * `respondToLibraryError`, which is right for each of them. `stale` is the
     * exception, and it is the exception because of what its 412 arm attaches:
     * `current`, the whole target object, so that an *editor* can offer
     * reload-and-reapply. On this route that object is a treatment's hooks —
     * every **unfired** `premise` and every `Entrance.text` on it — sent to the
     * play client, which is the content [08 §6] and [10 §10.1] name as hidden
     * and the surface they name it about. The whole reason promotion is a server
     * act is that redaction, so its own error path is the last place that may
     * break it.
     *
     * *Reachable without a race*: a hand-edited `treatment.json` is first-class
     * ([03 §1]), and promoting against one before the watcher settles is this
     * test verbatim. And there is nothing the envelope could buy — the client has
     * never held the hook, so there is no *reapply my edits* for it to offer.
     */
    it('answers a moved target without handing the panel the object', async () => {
      const treatment = await aTreatment([]);
      const session = await aSessionWith(hook('hook-war'));

      const row = await server.request({
        method: 'GET',
        url: `/api/library/treatments/${treatment}`,
      });
      const path = server.services.layout.objectFile(
        userOwner('ned'),
        TREATMENT_SCHEMA,
        row.body.slug as string,
      );
      const stored = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      await writeFile(
        path,
        JSON.stringify({ ...stored, hooks: [hook('hook-secret')] }, null, 2),
        'utf8',
      );

      const saved = await promote(session, 'hook-war', { kind: 'treatment', id: treatment });

      expect(saved.status).toBe(409);
      expect(saved.body.error).toBe('target-moved');
      // The assertion the paragraph above is about: no envelope, under any
      // spelling. `current` is what the 412 arm calls it, and a body with no
      // hook content at all is what the panel is owed.
      expect(saved.body.current).toBeUndefined();
      expect(JSON.stringify(saved.body)).not.toContain('hook-secret');
    });

    /**
     * The refusal every other write to a system object already gets ([10 §4.2]):
     * app-shipped, and a release would overwrite the edit anyway. *Copy to my
     * library* first, and the copy is an ordinary target.
     */
    it('refuses a system-library target through the library’s own read-only path', async () => {
      const session = await aSessionWith(hook('hook-war'));

      const saved = await promote(session, 'hook-war', { kind: 'lore', id: DOCS_LOREBOOK_ID });

      expect(saved.status).toBe(403);
      expect(saved.body.error).toBe('read-only');
    });

    /**
     * ***The separation is structural here, and that is exactly why it is worth
     * a test.*** This route does not go through `mine` — its docstring argues
     * why, and the argument is that `readSession` and `read` both resolve
     * **under the account's handle**, so the path is the owner ([09 §4.3]) and
     * somebody else's object is the same absence it has always been. That is a
     * property of two functions three files away rather than of a check on this
     * route, which makes it precisely the kind of protection that survives
     * review and dies to a later refactor nobody connected to it.
     *
     * *Both halves, because they fail through different code.* The session is
     * `readSession` returning `null`; the target is `read` raising `not-found`
     * from a collection this handle does not own. And both are **404**, never
     * 403: the route beside them answers *another account's session* with the
     * same absence, because confirming an id exists elsewhere leaks the one
     * fact the separation is keeping.
     */
    it('answers 404 for another account’s session and another account’s target', async () => {
      const treatment = await aTreatment([]);
      const session = await aSessionWith(hook('hook-war'));

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

      // Hers now, and neither of the two objects is.
      const theirSession = await promote(session, 'hook-war', {
        kind: 'treatment',
        id: treatment,
      });
      expect(theirSession.status).toBe(404);
      expect(theirSession.body.error).toBe('no-session');

      // And with a session of her own, the treatment is still not reachable —
      // the second half, which the first cannot reach past.
      const mine = await aSessionWith(hook('hook-war'));
      const theirTreatment = await promote(mine, 'hook-war', {
        kind: 'treatment',
        id: treatment,
      });
      expect(theirTreatment.status).toBe(404);
      expect(theirTreatment.body.error).toBe('no-such-object');
    });
  });

  /**
   * **What the hook panel is shown** — [10 §10.1], [P7.5].
   *
   * *"Which hooks have fired and when, which are eligible right now, and which
   * are blocked **with the clause that blocked them**."* Eligibility is live
   * because the mechanical filter already runs every turn, so the route runs the
   * same filter the selector does rather than a second reading of the rules.
   */
  it('sends the panel its rows and the dial that explains an empty one', async () => {
    const id = await aTreatment([
      hook('hook-war'),
      { ...hook('hook-late'), notBefore: { turn: 40 } },
    ]);
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain', treatment: id },
    });
    const sessionId = created.body.session.id as string;

    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });

    expect(read.body.hooks.pacing).toBe('normal');
    expect(read.body.hooks.rows).toEqual([
      {
        hookId: 'hook-war',
        title: 'hook-war',
        source: { kind: 'treatment', id },
        state: null,
        refusal: null,
        entrances: [],
      },
      {
        hookId: 'hook-late',
        title: 'hook-late',
        source: { kind: 'treatment', id },
        state: null,
        // The clause, not a boolean — an author must see *which are blocked and
        // by what*, and the remedy for this one is to wait or lower the bound.
        refusal: 'too-early',
        entrances: [],
      },
    ]);
    // **The premise is not on the wire**, which is the panel's defining
    // constraint rather than an omission: an unfired hook's premise is hidden
    // content ([08 §6]), and the one thing worse than spoiling it in a panel is
    // spoiling it in the prompt.
    expect(JSON.stringify(read.body.hooks)).not.toContain('declare war');
  });

  /**
   * The dial is [04 §6.1b]'s three rungs, and the panel shows the resolved
   * value — a control reading the channel alone would say `normal` for every
   * session whose treatment asked for something else and has not been turned.
   */
  it('resolves the dial through the treatment that proposed it', async () => {
    const made = {
      ...newTreatment('Rain City, noir'),
      hooks: [hook('hook-war')],
      hookPacing: 'sparse',
    };
    const treatment = await server.request({
      method: 'POST',
      url: '/api/library/treatments',
      payload: made,
    });
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain', treatment: treatment.body.object.id as string },
    });
    const sessionId = created.body.session.id as string;

    const before = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(before.body.hooks.pacing).toBe('sparse');

    // And the running session owns it thereafter, which is the top rung.
    await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/channels/se.hook.pacing`,
      payload: { value: 'aggressive' },
    });
    const after = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(after.body.hooks.pacing).toBe('aggressive');
  });

  /**
   * **Commit goes through the channel write and needed no route of its own** —
   * [06 §6.1], and the panel's one control. The first rule is that skipping the
   * filter says what it skipped, so the row carries the clause it walked past.
   */
  it('commits a blocked hook and reports the clause it overrode', async () => {
    const id = await aTreatment([{ ...hook('hook-late'), notBefore: { turn: 40 } }]);
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain', treatment: id },
    });
    const sessionId = created.body.session.id as string;

    const written = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/channels/${encodeURIComponent('se.hook#hook-late')}`,
      payload: { value: 'committed' },
    });
    expect(written.body.effect.applied).toBe(true);

    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.body.hooks.rows[0]).toMatchObject({
      state: 'committed',
      refusal: null,
      committed: { overrode: 'too-early' },
    });
  });

  /**
   * ***A hook is checked before it is kept*** (2026-09-27). Both doors took any
   * object and stored it as a hook by a cast, so one with no `involves` made
   * every later read of the session a 500 and every turn a failure: the actor
   * lookup iterates `involves` on every gather.
   */
  it('refuses a hook with no involves, at creation and when added, and keeps nothing', async () => {
    const storm = { title: 'Storm', premise: 'The bridge falls.' };

    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain', hooks: [storm] },
    });
    expect(created.status).toBe(400);

    const added = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/hooks`,
      payload: { hook: storm },
    });
    expect(added.status).toBe(400);
    expect(JSON.stringify(added.body.issues)).toMatch(/involves/);
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.status).toBe(200);
    expect((await sessionFileOf(sessionId)).hooks).toBeUndefined();
  });

  /**
   * ***A session's own hook gets an id at creation, as it does when added***
   * (2026-09-27). Without one it pooled as `se.hook#` with nothing after it,
   * and could never be committed, blocked, recorded as fired or removed.
   */
  it('mints an id for a hook a session is created with', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        name: 'Rain',
        hooks: [
          {
            title: 'Storm',
            premise: 'The bridge falls.',
            magnitude: 'sweeping',
            involves: [],
            weight: 1,
            delivery: 'guidance',
            once: true,
          },
        ],
      },
    });

    expect(created.status).toBe(201);
    const held = await sessionFileOf(created.body.session.id as string);
    expect(held.hooks[0].hook.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  /**
   * ***And one already in the file is shown as broken and never read***
   * (2026-09-27): a hand edit, an import or an older build can hold one. The
   * session reads, the turn plays past it, the panel names it `malformed`, and
   * Remove takes it out, which is the repair that was on a page that would not
   * load.
   */
  it('reads past a malformed hook in the file, shows it as broken, and removes it', async () => {
    const file = join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json');
    const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(
      file,
      JSON.stringify({
        ...stored,
        hooks: [
          { hook: { id: 'broken', title: 'Storm', premise: 'x' }, source: { kind: 'session' } },
          { hook: hook('hook-fine'), source: { kind: 'session' } },
        ],
      }),
    );

    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.status).toBe(200);
    const rows = read.body.hooks.rows as { hookId: string; refusal: string | null }[];
    expect(rows.find((row) => row.hookId === 'broken')?.refusal).toBe('malformed');
    expect(rows.find((row) => row.hookId === 'hook-fine')?.refusal).not.toBe('malformed');

    await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, TURN_FINISHES_MS);
    await stream.abort();
    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    expect(turns.body.turns.at(-1)?.status).toBe('complete');

    // Never saved out into a library object, which it would break too.
    const treatment = await aTreatment([]);
    const promoted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/hooks/broken/promote`,
      payload: { target: { kind: 'treatment', id: treatment } },
    });
    expect(promoted.status).toBe(404);

    const removed = await server.request({
      method: 'DELETE',
      url: `/api/sessions/${sessionId}/hooks/broken`,
    });
    expect(removed.status).toBe(200);
    expect(
      ((await sessionFileOf(sessionId)).hooks as { hook: { id: string } }[]).map(
        (entry) => entry.hook.id,
      ),
    ).toEqual(['hook-fine']);
  });

  it('removes a hook beside an entry with no hook in it at all', async () => {
    const file = join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json');
    const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(
      file,
      JSON.stringify({
        ...stored,
        hooks: [
          { source: { kind: 'session' } },
          { hook: hook('hook-fine'), source: { kind: 'session' } },
        ],
      }),
    );

    const removed = await server.request({
      method: 'DELETE',
      url: `/api/sessions/${sessionId}/hooks/hook-fine`,
    });

    expect(removed.status).toBe(200);
    expect((await sessionFileOf(sessionId)).hooks).toEqual([{ source: { kind: 'session' } }]);
  });
});

/**
 * **The goal chain, copied at creation and extended while running** —
 * [04 §7.1], [06 §7.3.3], [06 §7.3.4], [P7.6].
 *
 * *"Ordered: `goals[0]` is where play begins. Empty = no win condition, which is
 * the deliberate opt-out rather than the default."*
 */
describe('a session’s goals', () => {
  function goal(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id,
      statement: `Do ${id}`,
      detail: null,
      visibility: 'player',
      completion: { kind: 'narrative' },
      thenDefault: 'advance',
      next: null,
      ...over,
    };
  }

  async function aSetup(goals: Record<string, unknown>[]): Promise<string> {
    const made = { ...newSetup('The Fixer’s Debt'), goals };
    const response = await server.request({
      method: 'POST',
      url: '/api/library/setups',
      payload: made,
    });
    return response.body.object.id as string;
  }

  it('copies a Setup’s chain, in order', async () => {
    const setup = await aSetup([goal('g-one'), goal('g-two')]);

    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { setup },
    });

    expect((created.body.session.goals as { id: string }[]).map((one) => one.id)).toEqual([
      'g-one',
      'g-two',
    ]);
  });

  it('writes no chain at all when the Setup carried none', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain' },
    });

    // [04 §7.1] calls empty *the deliberate opt-out*; absent is what a session
    // with no Setup is, and the two should not be spelled the same.
    expect('goals' in (created.body.session as object)).toBe(false);
  });

  /**
   * [00 §3.1]'s prefill-not-binding, the same asymmetry the pool and the pack
   * have: editing a Setup must not reach a game in progress.
   */
  it('does not follow the Setup after the session exists', async () => {
    const setup = await aSetup([goal('g-one')]);
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { setup },
    });
    const sessionId = created.body.session.id as string;

    const read = await server.request({ method: 'GET', url: `/api/library/setups/${setup}` });
    await server.request({
      method: 'PUT',
      url: `/api/library/setups/${setup}`,
      payload: { object: { ...read.body.object, goals: [goal('g-different')] } },
      headers: { 'if-match': read.body.contentHash as string },
    });

    const after = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(after.body.session.goals[0].id).toBe('g-one');
  });

  it('sends the panel its rows, with the first goal current', async () => {
    const setup = await aSetup([goal('g-one', { next: 'g-two' }), goal('g-two')]);
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { setup },
    });
    const sessionId = created.body.session.id as string;

    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });

    expect(read.body.goals.concluded).toBe(false);
    expect(read.body.goals.rows).toEqual([
      {
        goalId: 'g-one',
        statement: 'Do g-one',
        visibility: 'player',
        completion: 'narrative',
        current: true,
        achieved: false,
        // [25 C12]'s gate, seen from the wire: a goal nobody has judged yet is
        // neither done nor waiting on an answer.
        proposed: false,
        next: 'g-two',
        thenDefault: 'advance',
      },
      expect.objectContaining({ goalId: 'g-two', current: false }),
    ]);
  });

  /**
   * ***The three offers, through the routes they actually use.*** All three are
   * channel writes — [06 §7.3.4]'s *continue open*, *advance* and *end* — which
   * is why none of them needed a route of its own, and why each lands as a turn
   * that a rewind can undo.
   */
  it('advances, carries on and ends through the channel write', async () => {
    const setup = await aSetup([goal('g-one', { next: 'g-two' }), goal('g-two')]);
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { setup },
    });
    const sessionId = created.body.session.id as string;

    // Manual completion, which [06 §7.3.3] keeps always available.
    await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/channels/${encodeURIComponent('se.goal#g-one')}`,
      payload: { value: 'achieved' },
    });
    const done = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(done.body.goals.rows[0]).toMatchObject({ achieved: true, current: true });
    // Retained with the turn that completed it, derived from the path.
    expect(typeof done.body.goals.rows[0].achievedOn).toBe('string');

    await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/channels/se.goal.current`,
      payload: { value: 'g-two' },
    });
    const advanced = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(advanced.body.goals.rows[1]).toMatchObject({ goalId: 'g-two', current: true });

    await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/channels/se.concluded`,
      payload: { value: true },
    });
    const ended = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(ended.body.goals.concluded).toBe(true);
    // *A state, not a deletion* — the chain is still there and still readable.
    expect(ended.body.goals.rows).toHaveLength(2);
  });

  /**
   * ***Advance's second arm*** — [06 §7.3.4]'s *"or one written now"*, which is
   * the clause that makes the chain a session field rather than a link.
   */
  it('takes a goal written at a completion, minting an id for it', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain' },
    });
    const sessionId = created.body.session.id as string;

    const added = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/goals`,
      payload: {
        goal: {
          statement: 'Find the fixer.',
          detail: null,
          visibility: 'player',
          completion: { kind: 'narrative' },
          thenDefault: 'continue-open',
          next: null,
        },
      },
    });

    const minted = (added.body.session.goals as { id: string }[])[0]?.id ?? '';
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);

    // Usable, which is the point of minting it: the cursor and the achievement
    // channel are both scoped by the id.
    const pointed = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/channels/se.goal.current`,
      payload: { value: minted },
    });
    expect(pointed.body.effect.applied).toBe(true);
  });

  /**
   * **An authoring act, not a story event** — so it lands on the session file
   * and appends no turn. *Pointing play at it* is the story event, and that is
   * the channel write above.
   */
  it('writes the chain and not a turn', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain' },
    });
    const sessionId = created.body.session.id as string;

    await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/goals`,
      payload: { goal: { statement: 'Find the fixer.', next: null } },
    });

    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    expect(turns.body.turns).toEqual([]);
  });

  it('is a 404 for a session that is not there', async () => {
    const response = await server.request({
      method: 'POST',
      url: `/api/sessions/${uuidv7()}/goals`,
      payload: { goal: goal('g-x') },
    });

    expect(response.status).toBe(404);
  });

  /**
   * ***A goal is checked before it is kept*** (2026-09-27). The body was open
   * and the goal was stored behind a cast, so one without a `completion` made
   * every later read of the session a 500 and every turn a failure, with no
   * route to take it out again. It is a `400` naming the field now, and
   * nothing is written.
   */
  it('refuses a goal missing what a goal must say, and keeps nothing', async () => {
    const refused = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/goals`,
      payload: { goal: { statement: 'Find the key' } },
    });

    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('invalid');
    expect(JSON.stringify(refused.body.issues)).toMatch(/completion/);
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.status).toBe(200);
    expect(read.body.goals.rows).toEqual([]);
  });

  /**
   * ***And one already in the file is read past*** (2026-09-27): a hand edit,
   * an import or an older build can hold a goal nothing checked. Placed first,
   * where play begins, so the runner would have read its `completion` on the
   * first turn. The file is left as it is: it is somebody's writing.
   */
  it('reads past a goal in the file that is not one, and plays on', async () => {
    const file = join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json');
    const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(
      file,
      JSON.stringify({
        ...stored,
        goals: [{ id: 'broken', statement: 'Find the key' }, goal('g-fine')],
      }),
    );

    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.status).toBe(200);
    expect(read.body.goals.rows.map((row: { goalId: string }) => row.goalId)).toEqual(['g-fine']);
    expect(read.body.goals.rows[0].current).toBe(true);

    await submit();
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until(finished, TURN_FINISHES_MS);
    await stream.abort();
    const after = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(after.body.activeJob).toBeNull();
    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    expect(turns.body.turns.at(-1)?.status).toBe('complete');
    expect((JSON.parse(await readFile(file, 'utf8')) as { goals: unknown[] }).goals).toHaveLength(
      2,
    );
  });
});

/**
 * ***A session's own pack is checked as a pack*** (2026-09-27). The body took
 * any object and stored it as a `Preset` by a cast, so a pack with no `blocks`
 * was a session whose every turn failed. The library checks a preset before it
 * keeps one, and the session's copy is checked the same way.
 */
describe('a session’s pack, sent whole', () => {
  it('refuses something that is not a pack, and keeps the one it had', async () => {
    const before = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });

    const refused = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/preset`,
      payload: { preset: { name: 'Not a pack' } },
    });

    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('invalid');
    const after = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(after.body.session.preset).toEqual(before.body.session.preset);
  });

  it('takes the pack it has, edited', async () => {
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const pack = read.body.session.preset as Record<string, unknown>;

    const saved = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/preset`,
      payload: { preset: { ...pack, name: 'Mine now' } },
    });

    expect(saved.status).toBe(200);
    expect(saved.body.session.preset.name).toBe('Mine now');
  });
});

/**
 * ***What a reply carries, which is not the file*** (2026-09-27).
 *
 * Every route that answered with a session sent `session.json` whole: the hook
 * pool with every unfired premise in it, the Setup copy with its goals and
 * hooks, and each goal's `detail`. The panel's rows redact a premise until the
 * hook fires, and that redaction did nothing while the reply beside it carried
 * the pool. So a spoiler is planted in each, and every route that answers with
 * a session is asked for it.
 */
describe('what a session reply carries', () => {
  const SPOILER = 'The Flower Kingdom will declare war.';
  const SECOND = 'The old bridge gives way in the storm.';
  const DETAIL = 'The ledger is under the third floorboard.';

  function spoiler(id: string, premise: string): PlotHook {
    return {
      id,
      title: id,
      premise,
      magnitude: 'sweeping',
      involves: [],
      weight: 1,
      delivery: 'guidance',
      once: true,
    };
  }

  it('never carries an unfired premise, the Setup copy or a goal’s detail', async () => {
    const setup = await server.request({
      method: 'POST',
      url: '/api/library/setups',
      payload: {
        ...newSetup('The Fixer’s Debt'),
        hooks: [spoiler('hook-war', SPOILER)],
        goals: [
          {
            id: 'g-ledger',
            statement: 'Find the ledger.',
            detail: DETAIL,
            visibility: 'player',
            completion: { kind: 'narrative' },
            thenDefault: 'continue-open',
            next: null,
          },
        ],
      },
    });
    const setupId = setup.body.object.id as string;

    const replies: { status: number; body: unknown }[] = [];
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { setup: setupId },
    });
    replies.push(created);
    const id = created.body.session.id as string;
    // The spoilers are in the file, which is where they belong.
    const held = JSON.stringify(await sessionFileOf(id));
    expect(held).toContain(SPOILER);
    expect(held).toContain(DETAIL);

    replies.push(await server.request({ method: 'GET', url: `/api/sessions/${id}` }));
    replies.push(await server.request({ method: 'GET', url: '/api/sessions' }));
    replies.push(
      await server.request({
        method: 'POST',
        url: `/api/sessions/${id}/hooks`,
        payload: { hook: spoiler('hook-bridge', SECOND) },
      }),
    );
    replies.push(
      await server.request({
        method: 'PUT',
        url: `/api/sessions/${id}/lore`,
        payload: { treatment: null, lore: [] },
      }),
    );
    replies.push(
      await server.request({ method: 'PATCH', url: `/api/sessions/${id}`, payload: { name: 'X' } }),
    );
    replies.push(
      await server.request({
        method: 'PUT',
        url: `/api/sessions/${id}/channels/se.goal.current`,
        payload: { value: 'g-ledger' },
      }),
    );
    replies.push(
      await server.request({
        method: 'POST',
        url: `/api/sessions/${id}/goals`,
        payload: {
          goal: {
            statement: 'Pay the fixer.',
            detail: DETAIL,
            visibility: 'player',
            completion: { kind: 'manual' },
            thenDefault: 'end',
            next: null,
          },
        },
      }),
    );

    for (const answer of replies) {
      expect(answer.status).toBeLessThan(300);
      const said = JSON.stringify(answer.body);
      expect(said).not.toContain(SPOILER);
      expect(said).not.toContain(SECOND);
      expect(said).not.toContain(DETAIL);
    }
    // What the client reads is still there: the Setup by id, the goals by id.
    const read = replies[1]?.body as { session: { setup: unknown; goals: { id: string }[] } };
    expect(read.session.setup).toEqual({ id: setupId, name: 'The Fixer’s Debt' });
    expect(read.session.goals.map((goal) => goal.id)).toEqual(['g-ledger']);
  });
});

/**
 * ***A session's reply shows the pack its turns are assembled from***
 * (2026-09-27) — `presetOf`, at the presenter and at the dials.
 *
 * Each file below is the one a session copied before something shipped would
 * hold, arriving the way such a file reaches a newer build: already on disk.
 * The panel edits the pack it is shown and writes it back whole, so a block the
 * turn assembles from and the reply leaves out is a block nobody can switch off.
 */
describe('the pack a session reply shows', () => {
  async function asCopiedBefore(id: string, change: (pack: any) => void): Promise<void> {
    const path = join(server.dataDir, 'users', 'ned', 'sessions', id, 'session.json');
    const file = JSON.parse(await readFile(path, 'utf8'));
    change(file.preset);
    await writeFile(path, JSON.stringify(file));
  }

  it('shows a block the mode shipped after the copy was taken', async () => {
    await asCopiedBefore(sessionId, (pack) => {
      pack.blocks = pack.blocks.filter((block: { id: string }) => block.id !== 'se.summary');
    });

    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });

    expect(read.status).toBe(200);
    expect(read.body.session.preset.blocks.map((block: { id: string }) => block.id)).toContain(
      'se.summary',
    );
  });

  it('offers a dial whose levels shipped after the copy was taken', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        name: 'Freeform, begun early',
        mode: 'storyengine.freeform',
        modeConfig: { premise: 'Rain.', difficulty: 'even', directedness: 'following' },
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.session.id as string;
    await asCopiedBefore(id, (pack) => {
      delete pack.difficultyLevels;
    });

    const read = await server.request({ method: 'GET', url: `/api/sessions/${id}` });

    expect(read.body.dials.difficulty.levels.map((level: { id: string }) => level.id)).toEqual([
      'gentle',
      'even',
      'harsh',
    ]);
  });
});
