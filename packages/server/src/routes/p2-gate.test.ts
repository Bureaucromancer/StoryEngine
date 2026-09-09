// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import { readAllTurns } from '../sessions/segments.js';
import { Layout } from '../storage/layout.js';
import {
  makeTestServer,
  setUpAdmin,
  type SseFrame,
  type StreamHandle,
  type TestServer,
} from '../test-server.js';

/**
 * The P2 exit gate's stream-shaped steps — [P2 §4](../../../../docs/design/workplan/08-p2-implementation.md),
 * steps 9, 12, 13 and 14.
 *
 * The P2 sibling of `gate.test.ts`, and it exists for the same reason that file
 * did: four steps of the gate had *neighbours* in the suite rather than
 * assertions of their own. `sessions.test.ts` opens streams, aborts them and
 * reattaches — but never with generation provably under way, never with the
 * disconnect proved to have detached, and never with the two halves of a
 * fan-out compared against the committed record. A step whose test passes
 * because the timing happened to be favourable is a step that is not automated.
 *
 * So everything here is built around three habits the existing tests do not
 * have:
 *
 * - **the precondition is established, not assumed.** Every test that claims to
 *   act "mid-turn" waits for a `delta` frame first, because that is the only
 *   evidence the provider is actually streaming rather than about to;
 * - **the observation is made through the wire the client uses.** `activeJob`
 *   is read from `GET /api/sessions/:id` and never from `services.state`,
 *   because the claim in the gate is about what a returning browser sees;
 * - **the assertion closes over the committed record.** Text observed live is
 *   compared with `turn.output.text` read back through the route, so a
 *   fan-out that reached one subscriber and a stream that showed a different
 *   answer than it stored both fail.
 *
 * The scripted provider is what makes any of it possible: `chunkDelayMs` is the
 * seam ([`providers/fake.ts`]) that gives "mid-generation" a duration to happen
 * in, and `streamCoalesceMs: 0` makes one durable checkpoint per chunk so frame
 * ordering is a fact rather than a race with the machine's speed.
 */

let server: TestServer;
let provider: FakeProvider;
let sessionId: string;

/** Distinct from every other suite's, so a leaked fixture cannot be mistaken for this one's. */
const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a04';

/**
 * A generation slow enough that "mid-turn" is a window rather than a wish.
 *
 * Thirty-six characters over twelve chunks is twelve pieces of three, so the
 * eleven inter-chunk waits give roughly a fifth of a second in which a client
 * can disconnect, a second one can attach, and a submission can be refused as
 * busy. Without `chunkDelayMs` the whole stream drains inside one macrotask —
 * `fake.ts` measured forty chunks in under a millisecond — and every test below
 * would be asserting about a turn that had already finished.
 */
const SLOW: ScriptedReply[] = [
  { text: 'a long slow answer that keeps arriving', chunks: 12, chunkDelayMs: 20 },
];

/** What `SLOW` finally says. Asserted against, so it is named once. */
const SLOW_TEXT = 'a long slow answer that keeps arriving';

/**
 * Stands the server up with a scripted provider behind it — the shape
 * `sessions.test.ts` established, and deliberately not a variation on it.
 *
 * The factory is passed at construction rather than assigned afterwards,
 * because the runner captures it when it is built: a test that swapped
 * `services.providers` later would be changing something nothing reads and then
 * quietly asserting against the real adapter.
 *
 * A connection file plus `bindings.json` plus a session is the minimum that
 * makes a turn *runnable*. Without the binding the `prose` role resolves
 * `unbound`, the narrate step aborts, and every test here would pass or fail on
 * a failed turn — which looks remarkably like a slow one.
 */
async function standUp(script: ScriptedReply[] = []): Promise<void> {
  provider = new FakeProvider(script.length === 0 ? {} : { script });
  server = await makeTestServer({
    providers: () => provider,
    config: {
      sessions: {
        snapshotEveryNTurns: 10,
        streamKeepaliveMs: 15000,
        // One durable checkpoint per chunk. With a coalescing window the
        // sequence numbers step 14 asserts over would depend on how fast the
        // machine ran, which is the one thing an exactly-once claim must not.
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

afterEach(async () => {
  // Defensively, because a test that failed early left its server holding the
  // sqlite handles — and on Windows that is an `EBUSY` on cleanup that buries
  // the real failure under a second one.
  await server.dispose().catch(() => undefined);
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

const isDelta = (frame: SseFrame): boolean => frame.event === 'delta';

/** The progress keys a connection was actually sent, in the order it got them. */
function keysOf(handle: StreamHandle): string[] {
  return handle
    .frames()
    .filter((frame) => frame.event === 'progress')
    .map((frame) => (frame.data as { key: string }).key);
}

/** The sequence numbers a connection was actually sent, in delivery order. */
function seqsOf(handle: StreamHandle): number[] {
  return handle
    .frames()
    .filter((frame) => frame.event === 'progress')
    .map((frame) => (frame.data as { seq: number }).seq);
}

/** Every token this connection received, concatenated — what a browser paints. */
function deltaTextOf(handle: StreamHandle): string {
  return handle
    .frames()
    .filter(isDelta)
    .map((frame) => (frame.data as { text: string }).text)
    .join('');
}

/** The segment directory, for the reads that must not go through the route. */
function turnsRoot(): string {
  return join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'turns');
}

/**
 * Polls an HTTP-observable condition.
 *
 * Borrowed from `gate.test.ts` rather than reached for as a sleep: a turn ends
 * when the commit protocol says so, and the only honest way to wait for that
 * from outside the process is to keep asking the question a client would ask.
 * On failure it re-runs the check so the assertion message names the condition.
 */
async function eventually(check: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((tick) => setTimeout(tick, 20));
  }
  expect(await check(), 'condition never held before the timeout').toBe(true);
}

/**
 * **Gate step 9** — *"Send a message → streamed reply → close the tab
 * mid-generation → reopen → the finished turn is there. The job survived the
 * client."*
 *
 * This is the architectural claim of [09 §2](../../../../docs/design/09-server-multiuser-deployment.md)
 * stated as a test: a turn is a server-side job, not a promise living in a
 * browser tab. Everything else in P2 — the job table, the commit protocol, the
 * snapshot-and-cursor attach — exists to make this sentence true, so the test
 * has to be the one that would notice it becoming false.
 *
 * Three things separate it from the reattach tests already in
 * `sessions.test.ts`, and each is a way the step could pass vacuously:
 *
 * 1. **the disconnect is proved to be mid-generation.** Waiting for a `delta`
 *    frame is the only evidence the provider is streaming rather than about to;
 *    a disconnect before the first token would exercise nothing, because there
 *    would be no in-flight work to survive;
 * 2. **"nobody is watching" is mechanical.** `subscriberCount(sessionId) === 0`
 *    turns the tab having closed from a description of what the test meant to do
 *    into a fact about the bus. A test that aborted a stream the server was
 *    still delivering to would be asserting that a job survives *being watched*;
 * 3. **the return is over HTTP only.** `activeJob` is read from
 *    `GET /api/sessions/:id`, never from `services.state.db` — the step is about
 *    what a returning browser can see, and an internal handle can be clean while
 *    the route that answers the browser is not.
 *
 * **The mutation this catches:** any change that ties the job's life to its
 * audience — the stream's `onClose` cancelling the run, or the runner treating a
 * detach as an abort — leaves a turn committed as `failed` with the partial
 * buffer it had at the disconnect. Asserting the *full* text and `status:
 * 'complete'` is what makes that fail; asserting only that a turn exists would
 * not. `draft.status = aborted ? 'failed' : 'complete'` collapsed to `'failed'`,
 * or `outcome: 'ok'` in `turns/calls.ts` changed to `'error'`, fail here too.
 */
describe('step 9 — the job survives the client', () => {
  it('finishes after the tab closes, and hands the whole turn back on reopen', async () => {
    await standUp(SLOW);

    const accepted = await submit();
    expect(accepted.status).toBe(202);

    const tab = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    // The precondition, established rather than assumed: a delta means the
    // provider has begun handing over text, so what follows is a disconnect
    // *during* generation.
    await tab.until(isDelta, 4000);
    await tab.abort();

    // Nobody is watching. Without this the rest of the test would hold just as
    // well for a stream that was never actually detached.
    expect(server.services.bus.subscriberCount(sessionId)).toBe(0);

    // What a returning browser asks. `activeJob` is the field a reloading client
    // uses to decide between opening a stream and offering a submit box, so it
    // is also the honest signal that the job reached its end without one.
    await eventually(async () => {
      const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      return read.body.activeJob === null;
    });

    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    expect(turns.body.turns).toHaveLength(1);
    const turn = turns.body.turns[0];

    // Complete, and **with the whole answer**. A job killed at the disconnect
    // still commits a turn — that is gate 10's recovery path — but it commits a
    // *failed* one carrying the partial buffer, so the text is what tells the
    // two outcomes apart.
    expect(turn.status).toBe('complete');
    expect(turn.output.text).toBe(SLOW_TEXT);
    // The call ran to the end rather than being classified as a failure that
    // happened to leave text behind ([21 §1.4]).
    expect(turn.request.calls[0].outcome).toBe('ok');

    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    // And the session moved on: a committed turn nothing points at would be a
    // turn the transcript cannot reach, which is the same loss wearing a
    // different shape.
    expect(read.body.session.headTurnId).toBe(turn.id);

    /**
     * **Reopening the tab**, which is the half of the step a route read cannot
     * make: a second connection with **no cursor**, exactly as a fresh
     * `EventSource` on a page load would open.
     *
     * `activeJob` is null by now, so a stream resolved from that alone would
     * show this client nothing at all — `latestJob` is what keeps the finished
     * turn reachable, and the snapshot is where it arrives.
     */
    const reopened = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    const snapshot = await reopened.until((frame) => frame.event === 'snapshot');
    const data = snapshot.data as {
      turn: { id: string; status: string } | null;
      text: string | null;
    };

    expect(data.turn?.id).toBe(turn.id);
    expect(data.turn?.status).toBe('complete');
    // The whole answer, from the checkpointed draft — the bus's live cell was
    // dropped when `turn.finished` published, so this is the durable copy.
    expect(data.text).toBe(SLOW_TEXT);
    await reopened.abort();
  });
});

/**
 * **Gate step 12** — *"Two clients on one session both see the stream."*
 *
 * [09 §3.1](../../../../docs/design/09-server-multiuser-deployment.md) scopes the session stream
 * to *one session, subscribed while viewing it*, which makes two tabs on one
 * session the ordinary case rather than an exotic one. `sessions.test.ts`
 * already opens two streams and compares their progress keys — and that test
 * would stay green under a delta fan-out that reached only the first subscriber,
 * because deltas carry no sequence number and were never compared.
 *
 * So this is the same step asserted where it can actually fail:
 *
 * - **the second client attaches mid-turn**, after the first has seen a delta.
 *   Two clients that both attach before anything happens are two clients
 *   watching the same replay, which says nothing about fan-out;
 * - **the late joiner's snapshot carries the text so far.** That is
 *   `TurnStream.live()`, and it exists because a client attaching between two
 *   coalescing checkpoints would otherwise see text that stops at the last
 *   checkpoint and then deltas that begin after it attached — a gap no offset
 *   scheme can close over a one-directional transport;
 * - **and the arithmetic is closed against the record**: for *each* connection,
 *   `snapshot.text + every delta it received` must equal the committed
 *   `turn.output.text` read back through the route.
 *
 * **The mutation this catches:** `TurnStream.#each` delivering to one listener
 * instead of iterating the set — the late joiner then receives no deltas, its
 * concatenation stops at its snapshot, and the final equality fails. Dropping
 * `bus.live()` from the attach path fails it in the other direction: the
 * snapshot text goes null and the concatenation is short by everything that
 * happened before the second client arrived.
 */
describe('step 12 — two clients on one session both see the stream', () => {
  it('gives the late joiner the text so far and every delta after it', async () => {
    await standUp(SLOW);
    const accepted = await submit();

    const first = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    const firstSnapshot = await first.until((frame) => frame.event === 'snapshot');
    // Pins the turn live: from here the second client is genuinely joining
    // something in progress rather than racing the start of it.
    await first.until(isDelta, 4000);

    const second = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    // Waited on the snapshot rather than on the `stream()` call resolving: the
    // response head is written by the `SseWriter` constructor, *before*
    // `attachToSession` subscribes, so a subscriber count read on the bare
    // handle would be reading before the thing it is counting has happened.
    const secondSnapshot = await second.until((frame) => frame.event === 'snapshot');
    expect(server.services.bus.subscriberCount(sessionId)).toBe(2);

    const joined = secondSnapshot.data as { job: { id: string } | null; text: string | null };
    expect(joined.job?.id).toBe(accepted.body.jobId);
    // Non-empty, because the whole point of the live cell is that a mid-turn
    // attach shows what has already been said rather than an empty box.
    expect(joined.text).not.toBeNull();
    expect((joined.text ?? '').length).toBeGreaterThan(0);
    expect(SLOW_TEXT.startsWith(joined.text ?? '')).toBe(true);

    await first.until(finished, 8000);
    await second.until(finished, 8000);

    // The durable half, which the existing suite already asserts — kept because
    // an ordering bug and a fan-out bug are different failures and this
    // separates them.
    expect(keysOf(first)).toEqual(keysOf(second));

    // The ephemeral half, which nothing asserted. A second subscriber that got
    // the backlog and no tokens would satisfy every existing test.
    expect(second.frames().filter(isDelta).length).toBeGreaterThan(0);

    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    const committed = turns.body.turns[0].output.text as string;

    /**
     * **The real claim of the step**, and the only assertion here that closes
     * over both transports at once.
     *
     * A connection's view of the answer is what it was holding when it attached
     * plus every token since. If that reconstructs the committed text for both
     * connections, then no token was lost, duplicated or delivered to only one
     * of them — and the live view and the stored record agree, which is what
     * [09 §3.3] means by *the live view is the turn record being built*.
     */
    const reconstructed = (snapshot: SseFrame, handle: StreamHandle): string =>
      ((snapshot.data as { text: string | null }).text ?? '') + deltaTextOf(handle);

    expect(reconstructed(firstSnapshot, first)).toBe(committed);
    expect(reconstructed(secondSnapshot, second)).toBe(committed);
    expect(committed).toBe(SLOW_TEXT);

    await first.abort();
    await second.abort();
    // Both, not just the last one: a `Set` keyed per session that leaked a
    // listener would keep a dead socket subscribed for the life of the process.
    expect(server.services.bus.subscriberCount(sessionId)).toBe(0);
  });
});

/**
 * **Gate step 13** — *"Submit the same idempotency key twice → one job id and
 * one provider call. Submit two different keys concurrently against one head →
 * one starts and the other is rejected with the active job/current head; no
 * implicit sibling turn and no double-applied effect."*
 *
 * [P2 §2.10](../../../../docs/design/workplan/08-p2-implementation.md) states the rule this
 * enforces in one line: *any number of clients may observe a session; only one
 * turn may advance it.* The failure it prevents is accidental branching — two
 * jobs claiming the same parent, racing the head snapshot and applying two sets
 * of effects in an order neither record states, five phases before branching has
 * semantics.
 *
 * **Why `readAllTurns` and not the route.** `GET /sessions/:id/turns` walks the
 * path back from `headTurnId`, so a sibling turn — a second child of the same
 * parent, which is exactly what a leaked second job would write — is *invisible*
 * through it. The route would show one turn and the file would hold two, and the
 * test would pass while the bug it exists for was on disk. A cold segment read
 * is the only observation that can see one.
 *
 * **The mutations this catches:** `if (outcome.job.status === 'queued')` in the
 * submit route made unconditional, so a retry restarts a committed job and the
 * provider is called twice; `submitTurn`'s busy branch removed, so two keys both
 * reserve against one head; and `MINUTES_PER_TURN` applied twice on the clock,
 * which is what a double-applied effect looks like from the outside.
 */
describe('step 13 — one key, one job, one provider call', () => {
  it('answers a retry with the same job while it runs and after it commits', async () => {
    await standUp(SLOW);

    const first = await submit();
    expect(first.status).toBe(202);
    const jobId = first.body.jobId as string;

    // The retry a browser makes when it reconnects mid-turn. 200 rather than
    // 202: nothing new was accepted.
    const whileRunning = await submit();
    expect(whileRunning.status).toBe(200);
    expect(whileRunning.body.jobId).toBe(jobId);

    await server.services.runner.settle();

    /**
     * **And once more after the job is committed**, which is the case the route
     * branches on `job.status` for rather than on the outcome kind.
     *
     * `existing` is returned for a queued, a running *and* a committed job, so a
     * route that restarted every `existing` would be free of double-charging
     * only for as long as the job happened to still be live — the retry that
     * arrives one millisecond after commit would run the whole turn again.
     */
    const afterCommit = await submit();
    expect(afterCommit.status).toBe(200);
    expect(afterCommit.body.jobId).toBe(jobId);

    /**
     * **Settle again before counting.**
     *
     * `runner.start` is fire-and-forget — it registers a promise and returns —
     * so a route that wrongly restarted the committed job would have a second
     * provider call *in flight*, not yet recorded, at the moment the next line
     * runs. Without this the count reads 1 either way and the assertion below
     * says nothing.
     *
     * Found by mutation: making the `status === 'queued'` branch unconditional
     * left this test green, and nothing downstream stops it — `start()` only
     * refuses a job that is still *live*, and `#body` sets a committed job back
     * to `running` and re-runs it from the top.
     */
    await server.services.runner.settle();

    // One provider call is the thing that stops a retry charging twice.
    expect(provider.requests).toHaveLength(1);
    // And one turn on disk — read cold, because the route cannot see a sibling.
    expect(await readAllTurns(turnsRoot())).toHaveLength(1);
  });

  it('starts one of two racing keys and refuses the other with the active job', async () => {
    await standUp(SLOW);

    // Genuinely concurrent, against the same null head. The session's write
    // queue is what serialises them; which one wins is not the claim, and a test
    // that assumed an order would be asserting about the scheduler.
    const [one, two] = await Promise.all([
      submit({ idempotencyKey: 'key-a' }),
      submit({ idempotencyKey: 'key-b' }),
    ]);

    expect([one.status, two.status].sort((x, y) => x - y)).toEqual([202, 409]);
    const started = one.status === 202 ? one : two;
    const refused = one.status === 409 ? one : two;

    // The job travels with the refusal ([P2 §2.10]): a UI handed a bare "no" can
    // only offer "try again", which produces the same "no". Naming the *other*
    // submission's job is what lets the loser attach to the winner's stream.
    expect(refused.body.error).toBe('busy');
    expect(refused.body.job.id).toBe(started.body.jobId);

    await server.services.runner.settle();

    const written = await readAllTurns(turnsRoot());
    // No implicit sibling. This is the assertion the route could not make.
    expect(written).toHaveLength(1);
    expect(written.filter(({ turn }) => turn.parentTurnId === null)).toHaveLength(1);

    /**
     * **And no double-applied effect**, which is the same rule seen from the
     * channel side.
     *
     * The clock is engine-computed and advances `MINUTES_PER_TURN` once per
     * turn, so a second job that reached the effect stage would show up here as
     * a clock that had run twice — 8:10 rather than 8:05 — even if its turn had
     * somehow been deduplicated on the way to disk. Asserted through the route
     * *and* on the record, because the head snapshot is derived ([03 §8.1]) and
     * a derived value agreeing is weaker evidence than the log it comes from.
     */
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.body.session.channels['se.clock'].value).toEqual({ day: 1, hour: 8, minute: 5 });

    const clockEffects = (written[0]?.turn.effects ?? []).filter(
      (effect) => effect.channelId === 'se.clock',
    );
    expect(clockEffects).toHaveLength(1);
    expect(clockEffects[0]?.applied).toBe(true);
  });
});

/**
 * **Gate step 14** — *"Disconnect between taking the SSE snapshot and
 * subscribing → reconnect from its cursor observes every later event exactly
 * once in order."*
 *
 * The narrowest window in the whole design, and the one `attach.ts` is written
 * around: subscribe, then read, with no `await` between them, so a checkpoint
 * cannot land in the gap. `sessions.test.ts` reattaches from a cursor it takes
 * from a *progress* frame, well after the snapshot — which is the comfortable
 * case. The uncomfortable one is a client that has the snapshot and nothing
 * else, because that is what a page that painted its initial state and then lost
 * the socket actually holds.
 *
 * Two things make this falsifiable rather than decorative:
 *
 * - **the cursor is checked for shape first.** `Snapshot.cursor` is null
 *   whenever the attach found no events for the current job, and `?after=` on a
 *   null cursor means *from the beginning* — so a version of this test that
 *   skipped the shape check would pass identically against a server that
 *   ignored cursors entirely;
 * - **the resumed connection's first sequence number is pinned exactly.**
 *   `seqOf(cursor) + 1` is the whole of "nothing skipped and nothing
 *   redelivered": one lower is a duplicate, one higher is a hole, and both are
 *   invisible to an assertion that only checks the sequence is sorted.
 *
 * The header variant is not a duplicate of the query one. A browser resends
 * `Last-Event-ID` by itself, with no code of ours involved — that is why [19 §8]
 * chose SSE — and the only existing test of that header proves a *nonsense*
 * value does not 500. Nothing asserted that a real cursor arriving that way
 * resumes anything.
 *
 * **The mutation this catches:** `readEvents`' `seq > ?` relaxed to `seq >= ?`
 * redelivers the cursor's own event and the first-sequence assertion fails; and
 * `headerCursor` reading anything other than `last-event-id` makes the header
 * test resume from event one instead of from the cursor.
 */
describe('step 14 — the window between the snapshot and the subscription', () => {
  /**
   * Takes the snapshot, drops the connection, resumes from its cursor, and
   * makes the exactly-once assertions over what the second connection got.
   *
   * Shared by both `it`s because the *only* difference the step cares about is
   * the door the cursor arrives through — writing it twice would invite the two
   * copies to drift, and the header case is the one that would quietly get the
   * weaker half.
   */
  async function resumesExactlyOnce(
    reconnect: (cursor: string) => Promise<StreamHandle>,
  ): Promise<void> {
    await standUp(SLOW);
    await submit();

    const painted = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    const snapshot = await painted.until((frame) => frame.event === 'snapshot');
    const cursor = (snapshot.data as { cursor: string | null }).cursor;
    /**
     * **Dropped on the snapshot**, which is the window the step names.
     *
     * The harness keeps parsing whatever the socket already delivered, so this
     * cannot stop bytes arriving — but a client's *position* is the cursor it
     * has, and this one's is the snapshot's. Resuming from it is therefore
     * resuming from the earliest point any client could be at, which is the
     * widest replay the store is ever asked for.
     */
    await painted.abort();

    // Guards the vacuous pass: a null cursor makes `?after=` mean nothing at
    // all, and every assertion below would then be describing a fresh attach.
    expect(cursor).not.toBeNull();
    expect(cursor).toMatch(/^[0-9a-f-]{36}\.\d+$/);
    const resumedAt = Number(String(cursor).split('.').at(-1));

    const resumed = await reconnect(String(cursor));
    await resumed.until(finished, 8000);

    const seqs = seqsOf(resumed);
    // Falsifiable in the trivial direction too: a connection that received no
    // progress frames would satisfy "sorted" and "no duplicates" vacuously.
    expect(seqs.length).toBeGreaterThan(0);
    // In order…
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    // …exactly once…
    expect(new Set(seqs).size).toBe(seqs.length);
    // …and continuous with what the first connection had. `readEvents` is
    // `afterSeq` rather than `fromSeq` precisely so this number is the cursor's
    // successor and not the cursor itself.
    expect(seqs[0]).toBe(resumedAt + 1);

    await resumed.abort();
  }

  it('replays from a cursor given as ?after=', async () => {
    await resumesExactlyOnce((cursor) =>
      server.stream({ url: `/api/sessions/${sessionId}/stream?after=${cursor}` }),
    );
  });

  it('replays from the same cursor given as Last-Event-ID', async () => {
    // The door a browser uses on its own. `EventSource` can send cookies and
    // cannot set headers — except this one, which it sets for you — so the
    // header path is the reconnect that happens without a client asking for it.
    await resumesExactlyOnce((cursor) =>
      server.stream({
        url: `/api/sessions/${sessionId}/stream`,
        headers: { 'last-event-id': cursor },
      }),
    );
  });
});
