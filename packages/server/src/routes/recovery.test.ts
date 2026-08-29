// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SCENE_PRESET } from '../modes/scene/preset.js';
import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import { readAllTurns } from '../sessions/segments.js';
import { Layout } from '../storage/layout.js';
import { callOnRecord, onRecord } from '../test-record.js';
import { makeTestServer, setUpAdmin, type SseFrame, type TestServer } from '../test-server.js';

/**
 * What survives a kill, and what the log says about it — [P2 §2.10], gates 10
 * and 19.
 *
 * The stage makes two falsifiable claims and these are them: **a turn
 * interrupted mid-generation is recovered as a failed turn with what it had**,
 * and **a killed turn's whole lifecycle is reconstructable from the log by its
 * job id alone**. A claim like the second is a slogan until something fails when
 * it stops being true.
 */

let dataDir: string;
let logLines: string[];
let server: TestServer;

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a03';

function capture(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      logLines.push(chunk.toString());
      done();
    },
  });
}

function parsedLog(): Record<string, unknown>[] {
  return logLines
    .join('')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * The one line for an event, and a failure that says so when there is not one.
 *
 * `find` would hand back `undefined` and every field assertion after it would
 * then fail as *"cannot read property of undefined"* — which reads as a broken
 * test rather than as *the lifecycle is missing its commit line*. Exactly one is
 * asserted rather than at-least-one because a milestone logged twice is its own
 * defect: gate 19's reader reconstructs a lifecycle by reading the sequence, and
 * a duplicated `job.recovered` would say the turn was recovered twice.
 */
function lineFor(lines: Record<string, unknown>[], event: string): Record<string, unknown> {
  const found = lines.filter((line) => line['event'] === event);
  if (found.length !== 1) {
    throw new Error(
      `Expected exactly one ${event} line, saw ${String(found.length)} in ${JSON.stringify(
        lines.map((line) => line['event']),
      )}`,
    );
  }
  return found[0]!;
}

/** The frame that ends a turn. Same predicate the session suite closes on. */
const finished = (frame: SseFrame): boolean =>
  frame.event === 'progress' && (frame.data as { key: string }).key === 'turn.finished';

/**
 * A server on the shared data directory, with a scripted provider behind it.
 *
 * Each one gets a **fresh cookie jar**, which is faithful — a restarted server
 * is a new process and the browser is a separate thing — so the caller signs in
 * again. Forgetting that is why the first draft of these tests read a `503` as
 * a missing session.
 */
async function start(script: ScriptedReply[]): Promise<TestServer> {
  const provider = new FakeProvider({ script });
  return makeTestServer({
    dataDir,
    providers: () => provider,
    logStream: capture(),
    config: {
      log: { level: 'info', format: 'json' },
      sessions: { snapshotEveryNTurns: 10, streamKeepaliveMs: 15000, streamCoalesceMs: 0 },
    },
  });
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-recover-'));
  logLines = [];
});

afterEach(async () => {
  // Defensively, because a test that failed early left its server holding the
  // sqlite files — and on Windows that is an `EBUSY` on cleanup that buries the
  // real failure under a second one.
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

/** Signs the client into a freshly started server. */
async function signIn(): Promise<void> {
  await server.request({
    method: 'POST',
    url: '/api/auth/login',
    payload: { handle: 'ned', password: 'correct horse battery' },
  });
}

async function seedAccount(): Promise<string> {
  await setUpAdmin(server, 'ned');
  const root = new Layout(dataDir).userConnectionsRoot('ned');
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
    join(dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );

  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Rain City' },
  });
  return created.body.session.id as string;
}

/**
 * A turn killed mid-generation, and **what the client had been shown when it
 * died** — the setup three of the tests below share.
 *
 * One helper rather than the same twenty lines three times, because the thing
 * being reproduced is a *kill* and three slightly different kills would be three
 * different tests that all claim to be gate 10's. The two subtleties are worth
 * stating once here rather than being rediscovered in each copy:
 *
 * **Two delta frames, not one.** One proves only that the stream opened. Two
 * proves the runner has been round its coalescing checkpoint at least once with
 * real text in the draft — which is the whole of gate 10's second half, since
 * text that reached the socket but never reached a checkpoint is text the
 * restart cannot possibly recover.
 *
 * **The snapshot's text plus the deltas is exactly what the client saw**, with
 * no overlap to subtract. `attachToSession` reads the accumulated text and
 * flushes its buffer in one synchronous block — the function is forbidden from
 * becoming `async` precisely so that nothing can interleave there — so a delta
 * is either already inside the snapshot's `text` or arrives after it, never
 * both. Concatenating them would double-count if that ever stopped being true,
 * and the prefix assertions in the tests are what would notice.
 *
 * Returns with `server` **disposed**: the caller starts the next process, since
 * what that one is scripted to say is the caller's business.
 */
async function killMidGeneration(script: ScriptedReply[]): Promise<{
  sessionId: string;
  jobId: string;
  turnId: string;
  /** The words already on the screen when the process died. */
  seen: string;
}> {
  server = await start(script);
  const sessionId = await seedAccount();

  const accepted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: 'k', headTurnId: null, input: { text: 'She waited.' } },
  });

  const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
  await stream.until(
    () => stream.frames().filter((frame) => frame.event === 'delta').length >= 2,
    4000,
  );

  const snapshot = stream.frames().find((frame) => frame.event === 'snapshot');
  const seen =
    ((snapshot?.data as { text?: string | null } | undefined)?.text ?? '') +
    stream
      .frames()
      .filter((frame) => frame.event === 'delta')
      .map((frame) => (frame.data as { text: string }).text)
      .join('');

  await stream.abort();
  /**
   * **A kill, not a shutdown**, and then no pause before the stores close.
   *
   * `halt()` drops the run without finalising and `dispose()` closes the
   * databases underneath it, so the detached generation finds them gone exactly
   * as it would find a dead process's. Waiting here for the abort to land would
   * let the runner reach `finaliseTurn` against an open store — the turn would
   * commit, there would be nothing left active, and these tests would be
   * asserting that cancellation works rather than that recovery does.
   */
  server.services.runner.halt();
  await server.dispose();

  return {
    sessionId,
    jobId: accepted.body.jobId as string,
    turnId: accepted.body.turnId as string,
    seen,
  };
}

describe('a turn killed mid-generation', () => {
  it('is recovered by the next start as a failed turn with what it had', async () => {
    // Gate 10, end to end through the routes.
    server = await start([{ text: 'a long slow answer', chunks: 12, chunkDelayMs: 20 }]);
    const sessionId = await seedAccount();

    const accepted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k', headTurnId: null, input: { text: 'She waited.' } },
    });
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    // Wait for real work to have happened, so the kill lands mid-generation
    // rather than before anything started.
    await stream.until((frame) => frame.event === 'delta', 4000);
    await stream.abort();

    /**
     * **A kill, not a shutdown.** `halt()` drops every run without finalising,
     * which is what a dead process leaves behind. Draining would let the runner
     * *finish*, and the test would then be asserting that a graceful shutdown
     * works — a different and much weaker claim.
     */
    server.services.runner.halt();
    await server.dispose();

    server = await start([{ text: 'unused' }]);
    await signIn();
    const reconciliation = server.services.reconciliation;
    expect(reconciliation.finalised).toEqual([accepted.body.jobId]);
    expect(reconciliation.failed).toEqual([]);

    const written = await readAllTurns(
      join(dataDir, 'users', 'ned', 'sessions', sessionId, 'turns'),
    );
    expect(written).toHaveLength(1);
    const turn = onRecord(written[0], 'the recovered turn on disk').turn;
    // Failed, because generation is never resumed — but *present*, with what it
    // managed, rather than a turn that silently never happened.
    expect(turn.status).toBe('failed');
    expect(onRecord(callOnRecord(turn).blocks, 'the recovered blocks').length).toBeGreaterThan(0);
    expect(turn.input?.text).toBe('She waited.');

    // And the head advanced exactly once. Read off the narrowed turn rather than
    // through `turn?.id`, which compared undefined against undefined and passed
    // for the wrong reason if the response body ever stopped carrying a head.
    const session = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(session.body.session.headTurnId).toBe(turn.id);
  });

  it('leaves the session usable, not permanently busy', async () => {
    // The failure mode the one-active-job index makes possible: a job stuck
    // active means every later submission is refused, forever.
    server = await start([{ text: 'slow', chunks: 8, chunkDelayMs: 20 }]);
    const sessionId = await seedAccount();

    await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k', headTurnId: null, input: { text: 'x' } },
    });
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until((frame) => frame.event === 'delta', 4000);
    await stream.abort();
    server.services.runner.halt();
    await server.dispose();

    server = await start([{ text: 'the next one' }]);
    await signIn();
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.body.activeJob).toBeNull();

    const next = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: 'k2',
        headTurnId: read.body.session.headTurnId,
        input: { text: 'again' },
      },
    });
    expect(next.status).toBe(202);

    /**
     * **And then the re-run is watched to the end, because a 202 is an
     * acceptance and not a turn.**
     *
     * Gate 10's last clause is *"and can be re-run"*, and a status code is
     * evidence only that `submitTurn` reserved a job — every interesting way for
     * this to be broken lives after that point and leaves the 202 intact. A
     * runner that refused to start on a session whose previous job had been
     * recovered, a head that had not really advanced so the second turn attached
     * to nothing, an append that overwrote the failed record rather than
     * following it: all of them are a 202 followed by silence, so the stream is
     * watched to `turn.finished` and the two turns are read back.
     */
    const watching = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    const end = await watching.until(finished, 6000);
    expect((end.data as { params: { state: string } }).params.state).toBe('complete');
    await watching.abort();

    // Through the route, because *on the path* is what gate 10 claims and the
    // path is a walk back from the head — a turn appended to the segment but
    // never linked would still be in the file and absent from here.
    const path = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    expect(path.body.turns).toHaveLength(2);
    const [recovered, rerun] = path.body.turns;

    expect(recovered.status).toBe('failed');
    expect(rerun.status).toBe('complete');
    // The *second* process's script, so this is genuinely a new generation
    // rather than the recovered draft being replayed or re-committed.
    expect(rerun.output.text).toBe('the next one');
    expect(rerun.id).toBe(next.body.turnId);
    // The chain, which is what makes the failed turn part of the story rather
    // than a thing the re-run stepped over ([09 §4] — a re-run is a child, and
    // `parentTurnId` is written now so branching has something to read later).
    expect(rerun.parentTurnId).toBe(recovered.id);

    const written = await readAllTurns(
      join(dataDir, 'users', 'ned', 'sessions', sessionId, 'turns'),
    );
    expect(written.map((each) => each.turn.id)).toEqual([recovered.id, rerun.id]);
  });

  it('keeps the words the user had already been shown', async () => {
    /**
     * **Gate 10's "with blocks intact", read as *the whole request*.**
     *
     * The turn record's claim is that a killed turn carries what it had, and
     * "what it had" is two separate things: the prompt that was in flight and
     * the prose that was already on somebody's screen. The second is the one a
     * user would notice losing, and it is the one a plausible implementation
     * drops — assigning `draft.output` once, from the result, at the end of the
     * call is the obvious way to write that code and passes every test that only
     * checks a completed turn. The runner instead assigns it inside the
     * streaming callback, per coalescing window, and this is the assertion that
     * makes that a requirement rather than a detail.
     *
     * Twenty chunks at thirty milliseconds, killed after two: six hundred
     * milliseconds of script against a kill at roughly sixty, so *partial*
     * stays true with a wide margin on a loaded machine.
     */
    const full = 'a long slow answer that keeps going and going and going';
    const { sessionId, seen } = await killMidGeneration([
      { text: full, chunks: 20, chunkDelayMs: 30 },
    ]);

    server = await start([{ text: 'unused' }]);
    await signIn();

    const written = await readAllTurns(
      join(dataDir, 'users', 'ned', 'sessions', sessionId, 'turns'),
    );
    const turn = written[0]?.turn;
    const recorded = turn?.output?.text ?? '';

    // Vacuity guard: a kill that landed before the first delta would make every
    // prefix assertion below trivially true.
    expect(seen).not.toBe('');
    expect(recorded).not.toBe('');

    /**
     * **The recorded text starts with what was shown, and is itself a prefix of
     * the script.** Written as slices rather than `startsWith` so a failure
     * prints the two strings against each other instead of `false !== true`.
     *
     * `startsWith` rather than equality in the first direction because the
     * durable text may legitimately run *ahead* of the frames this client
     * parsed — the checkpoint is written in the same tick as the delta is
     * published, and more deltas can land between the last frame read and the
     * kill. Ahead is fine; behind is the bug, and behind is what this catches.
     */
    expect(recorded.slice(0, seen.length)).toBe(seen);
    expect(full.slice(0, recorded.length)).toBe(recorded);
    // Partial, not the whole answer: otherwise the kill did not land
    // mid-generation and this test is asserting about a completed turn.
    expect(recorded).not.toBe(full);

    /**
     * **And the request that produced those words survived with it.**
     *
     * `blocks.length > 0` — which is what the sibling test above asserts — is
     * satisfied by a checkpoint that kept the array and lost everything that
     * makes a block legible. [13 §1.1] makes the source one vocabulary the
     * record and the preset both speak, and [03 §5] makes the reason *"a
     * product feature, not a debug string"* — gate 11 reads both off this very
     * field. So what is checked here is that the *player's own message* is in
     * the recovered prompt, attributed, with the budgeter's verdict beside it.
     * A draft that checkpointed only ids, or that wrote `budget: null` until
     * the call returned, passes the weaker form and fails this one.
     */
    const call = callOnRecord(onRecord(turn, 'the recovered turn on disk'));
    const blocks = onRecord(call.blocks, 'the blocks on the in-flight call');
    // **Not `onRecord`, and the distinction is the one that helper is built on.**
    // An absent `se.input` block is not a thin record — `blocks` above already
    // proved the writer recorded what it assembled. It is the assembler having
    // left the player's own message out of the recovered prompt, which is this
    // gate's central behavioural claim and belongs in a reported expectation
    // rather than in a throw that says the build stopped writing.
    const input = blocks.find((block) => block.id === 'se.input');
    expect(input?.text).toBe('She waited.');
    expect(input?.source.kind).toBe('input');
    expect(input?.included).toBe(true);
    // No `?? []` on the walk. An empty list would have run zero assertions and
    // passed, and the only thing standing in its way was the accident that the
    // three expectations above execute first.
    for (const block of blocks) expect(block.reason).not.toBe('');

    const budget = call.budget ?? null;
    expect(budget).not.toBeNull();
    // The honest stamp since [P3.0]: the ceiling is the config's, the share is
    // the preset's, and neither claims the other's number.
    expect(budget?.limit.source).toBe('user');
    expect(budget?.limit.share).toBe(SCENE_PRESET.budget.contextShare);
    expect(budget?.spent).toBeGreaterThan(0);
    // Every block ruled on, including the kept ones ([13 §1.5]) — a verdict
    // listing only the drops cannot answer "what falls out next", which is what
    // `nextToDrop` is.
    expect(budget?.decisions.map((decision) => decision.blockId)).toEqual(
      blocks.map((block) => block.id),
    );
    expect(budget?.nextToDrop).toContain('se.instruction');
  });

  /**
   * The half of "blocks intact" that was a `todo` until [P3.0] built the
   * provisional call. A killed process throws nothing, so the last durable
   * checkpoint is all there is — and the runner now checkpoints the call the
   * moment it is assembled and rendered, before dispatch, stamped for exactly
   * this reader: `outcome: 'error'`, class `terminal`, the server-stopped
   * message. Not `cancelled` — nobody pressed Stop, and blaming the person is
   * the mislabel the timeout work refused. Every live exit replaces the
   * provisional by id, so this stamp reaches disk only over a corpse.
   *
   * The falsifying mutation is skipping the provisional push in the runner's
   * `onCallAssembled` — the todo's own documented gap returns, `calls` is
   * empty on the recovered turn, and every assertion here fails.
   */
  it('names the model call that was in flight when the process died', async () => {
    const { sessionId, turnId } = await killMidGeneration([
      { text: 'a long slow answer that will not finish', chunks: 20, chunkDelayMs: 25 },
    ]);

    // Reconcile runs at start; the read below is off disk, so no sign-in.
    server = await start([]);
    const turns = await readAllTurns(join(dataDir, 'users', 'ned', 'sessions', sessionId, 'turns'));
    const turn = turns.find((entry) => entry.turn.id === turnId)?.turn;

    const call = turn?.request?.calls[0];
    expect(call).toBeDefined();
    // The model that was asked, because nothing answered — the same asymmetry
    // the cancelled record draws.
    expect(call?.resolved).toEqual({ connectionId: CONNECTION_ID, modelId: 'fake-hi' });
    expect(call?.purpose).toBe('prose');
    expect(call?.outcome).toBe('error');
    expect(call?.error?.class).toBe('terminal');
    expect(call?.error?.message).toBe('The server stopped before this call returned.');
    // Real elapsed time up to the last durable checkpoint, not zero — the
    // mid-call writes keep refreshing it.
    expect(call?.wallMs).toBeGreaterThan(0);
    // And what a call that never returned honestly lacks.
    expect(call?.usage).toBeNull();
    expect(call?.finishReason).toBeNull();
  });
});

describe('the log alone reconstructs a killed turn', () => {
  it('spans both processes, filtered by job id and nothing else', async () => {
    // Gate 19. Both servers write into one capture, so the filter is over the
    // whole corpus — which is the point: the recovering process is where the
    // interesting half happens, and a log that only covered the dying one would
    // satisfy a weaker claim.
    server = await start([{ text: 'a long slow answer', chunks: 12, chunkDelayMs: 20 }]);
    const sessionId = await seedAccount();

    const accepted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k', headTurnId: null, input: { text: 'She waited.' } },
    });
    const jobId = accepted.body.jobId as string;

    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until((frame) => frame.event === 'delta', 4000);
    await stream.abort();
    server.services.runner.halt();
    await server.dispose();

    server = await start([{ text: 'unused' }]);
    await signIn();
    await server.dispose();

    const mine = parsedLog().filter((line) => line['jobId'] === jobId);

    // Falsifiable in both directions: this job has a lifecycle…
    expect(mine.length).toBeGreaterThan(2);
    // …and a different one has none.
    expect(parsedLog().filter((line) => line['jobId'] === 'not-a-job')).toEqual([]);

    /**
     * **Asserted on a parsed `event` field, never a regex over `msg`.**
     * That is what "bindings, not prose" means operationally: a message is
     * developer-facing English that may be reworded, and a test that matched it
     * would be pinning the wording rather than the fact.
     */
    const events = mine.map((line) => line['event']);
    expect(events).toContain('job.running');
    expect(events).toContain('step.started');
    // The half that only the *recovering* process can write.
    expect(events).toContain('job.recovered');
    expect(events).toContain('job.committed');
  });

  it('carries no output text, no guidance and no absolute path', async () => {
    // [13 §4.1]'s three prohibitions. The first is one well-meant debug of the
    // draft away, and none of them was enforced or tested before this.
    server = await start([{ text: 'the-secret-narration' }]);
    const sessionId = await seedAccount();

    await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: 'k',
        headTurnId: null,
        input: { text: 'x' },
        guidance: 'the-secret-guidance',
      },
    });
    await server.services.runner.settle();
    await server.dispose();

    const corpus = logLines.join('');
    expect(corpus).not.toContain('the-secret-narration');
    expect(corpus).not.toContain('the-secret-guidance');
    expect(corpus).not.toContain(dataDir);
  });

  it('is an ordered lifecycle that names the model, the outcome and the turn', async () => {
    /**
     * **Gate 19 in full: *reconstructable*, not *present*.**
     *
     * The sibling test above proves the four milestone names appear somewhere in
     * the corpus, and a set of names is not a lifecycle — it cannot say whether
     * the call was attempted before or after the turn was committed, which model
     * was asked, whether the turn survived, or how to get from the job id
     * somebody was paged with to the record on disk. Those are the four things
     * an operator actually does with this log, and they are the four blocks
     * below.
     */
    const { sessionId, jobId, turnId } = await killMidGeneration([
      { text: 'a long slow answer', chunks: 12, chunkDelayMs: 20 },
    ]);

    server = await start([{ text: 'unused' }]);
    await signIn();
    /**
     * The premise, asserted before anything reads the log.
     *
     * If the dying process had won the race and finalised its own turn there
     * would be no active job at startup, no recovery half, and the missing
     * `job.recovered` line would read as *the log lost it* rather than as *the
     * kill did not kill*. One line here turns the second failure into the
     * message it actually is.
     */
    expect(server.services.reconciliation.finalised).toEqual([jobId]);
    await server.dispose();

    const mine = parsedLog().filter((line) => line['jobId'] === jobId);

    /**
     * **1. Order.** An exact equality over the milestone subsequence, not a
     * containment check: containment passes for a log that emits the commit
     * before the call.
     *
     * `step.failed` is deliberately not in the chain, and its absence is the
     * one thing here that is about the test rather than about the system. The
     * dying run is detached when the stores close, so its last line is written
     * whenever its abort lands — a few tens of milliseconds later, possibly
     * after the next process has already reconciled. Every other line in the
     * chain is emitted before the kill or by the recovering process, so their
     * relative order is causal rather than raced. Pinning `step.failed` here
     * would buy a stronger-looking assertion and pay for it with a test that
     * fails on a busy machine.
     *
     * **And the chain starts one step later than [13 §4.1] describes.** That
     * section says the job binds `jobId` *"when the job is created"* — but
     * `submitTurn` reserves the job, writes its idempotency row and returns a
     * 202 without logging anything, and the first line carrying the id is
     * `job.running`, written by the runner after it has already taken the job.
     * The window between them is small and it is not empty: a process that dies
     * inside it leaves a reserved job, a session that startup will have to
     * release, and **no log line at all** — the one interruption this gate's
     * claim does not cover. The chain begins where the code begins rather than
     * where the contract says, because adding the reservation line is a change
     * to `state/jobs.ts` and this file does not make production changes to
     * satisfy itself.
     */
    const chain = ['job.running', 'step.started', 'call.started', 'job.committed', 'job.recovered'];
    const events = mine.map((line) => String(line['event']));
    expect(events.filter((event) => chain.includes(event))).toEqual(chain);
    // `job.committed` before `job.recovered` is not an accident of writing
    // order: `reconcile` logs the recovery *after* `finaliseTurn` returns,
    // because until it has returned there is nothing true to say.

    // …and the timeline agrees with the ordering. Weak alone — pino stamps and
    // writes in one synchronous step, so arrival order is time order — but it
    // is what makes the sequence above a timeline rather than a list, and it
    // fails the moment a line is emitted with a captured or borrowed `time`.
    const times = mine.map((line) => Number(line['time']));
    expect(times).toEqual([...times].sort((first, second) => first - second));

    /**
     * **2. The call.** *Which model was attempted* is the first question asked
     * of a turn that died mid-flight, and the turn record cannot answer it — no
     * `ModelCall` is written until a call returns or fails with `CallFailed`,
     * and an abort throws `Cancelled` before either (see the todo above). So
     * this line is the only place the answer exists.
     *
     * `model` is pinned to the *resolved* model id rather than to the role,
     * which is [13 §1.4]'s point about `ModelCall.resolved` one layer down:
     * steps name roles, so a line logging `prose` would name the binding and
     * never the endpoint, and *what actually ran* is the first question anyone
     * asks about a turn that came out wrong. `fake-hi` is what `bindings.json`
     * resolves to here, so the assertion is on a value the seeding chose.
     */
    const callStarted = lineFor(mine, 'call.started');
    expect(callStarted['model']).toBe('fake-hi');
    expect(callStarted['stepId']).toBe('se.narrate');

    /**
     * **3. The outcome.** Without this the log's answer to *did it survive?* is
     * a name — `job.committed` is emitted for a turn that finished perfectly and
     * for one that died at its first token, and only the field distinguishes
     * them. `fromStep: 0` is the other half: it says the interruption was during
     * generation rather than during finalisation, which is the difference
     * between a turn that lost its prose and one that had already written it.
     */
    expect(lineFor(mine, 'job.recovered')['status']).toBe('failed');
    expect(lineFor(mine, 'job.recovered')['fromStep']).toBe(0);
    expect(lineFor(mine, 'job.committed')['status']).toBe('failed');

    /**
     * **4. The pivot keys.** [13 §4.1] makes `jobId` the binding gate 19 turns
     * on, and names `sessionId` and `turnId` beside it — because a job id is
     * what an alert carries and a turn record is what a human wants to read, so
     * the log has to be the bridge. Asserted against the id of the turn actually
     * on disk rather than against itself: a line binding a plausible-looking
     * wrong id is exactly the failure this catches.
     */
    const written = await readAllTurns(
      join(dataDir, 'users', 'ned', 'sessions', sessionId, 'turns'),
    );
    expect(written.map((each) => each.turn.id)).toEqual([turnId]);
    expect(lineFor(mine, 'job.running')).toMatchObject({ sessionId, turnId, account: 'ned' });
    expect(lineFor(mine, 'job.recovered')).toMatchObject({ sessionId, turnId });
    /**
     * **`job.committed` names the session and the account now**, and this
     * assertion used to be the divergence rather than the contract.
     *
     * It read `toMatchObject({ turnId })` with a docstring explaining that
     * [13 §4.1] asks for more and the code did not do it — *asserted as the code
     * behaves and reported as a finding*. That was honest and it was also the
     * shape that lets a divergence sit for four phases: a test agreeing with the
     * bug, in the file whose whole subject is that a lifecycle can be filtered
     * by one id.
     *
     * The cause was one line in three places. The runner built its child inside
     * `#body`, so `job.unstartable` and both `job.lost` sites — written outside
     * it — carried `jobId` alone; and `advanceCommit` logged through the app's
     * *root* logger. **The id a person actually has is the session's**, because
     * it is the one in the URL, so the lines that say *a turn ended without
     * finalising* could not be found by the only thing they could search with.
     */
    expect(lineFor(mine, 'job.committed')).toMatchObject({
      sessionId,
      turnId,
      account: 'ned',
    });
  });

  it('holds nothing of the next job, and the next job holds nothing of it', async () => {
    /**
     * **The negative control, done with a real second job.**
     *
     * *Filtering by a job id that never existed returns nothing* is a fact about
     * the string `'not-a-job'` and survives any bug that could plausibly exist
     * here: a child logger that leaked its bindings, a `jobId` bound from a
     * captured variable rather than the job, a reconciler that stamped the job
     * it was recovering onto lines belonging to another. All of those need two
     * real jobs in one process to show up, and the second one has to be an
     * *ordinary* turn — the interesting confusion is between the turn that died
     * and the turn that came after it on the same session.
     */
    const killed = await killMidGeneration([
      { text: 'a long slow answer', chunks: 12, chunkDelayMs: 20 },
    ]);

    server = await start([{ text: 'the second answer' }]);
    await signIn();
    expect(server.services.reconciliation.finalised).toEqual([killed.jobId]);

    const read = await server.request({ method: 'GET', url: `/api/sessions/${killed.sessionId}` });
    const second = await server.request({
      method: 'POST',
      url: `/api/sessions/${killed.sessionId}/turns`,
      payload: {
        idempotencyKey: 'k2',
        headTurnId: read.body.session.headTurnId,
        input: { text: 'again' },
      },
    });
    const stream = await server.stream({ url: `/api/sessions/${killed.sessionId}/stream` });
    await stream.until(finished, 6000);
    await stream.abort();
    await server.dispose();

    // Parsed once, so the two filters are two views of one corpus rather than
    // two independent readings of a file that is still being written to.
    const corpus = parsedLog();
    const killedLines = corpus.filter((line) => line['jobId'] === killed.jobId);
    const secondLines = corpus.filter((line) => line['jobId'] === second.body.jobId);
    expect(killedLines.length).toBeGreaterThan(2);
    expect(secondLines.length).toBeGreaterThan(2);

    /**
     * Neither filter mentions the other's turn. This is the assertion the
     * `'not-a-job'` one was standing in for: the killed turn and the re-run
     * share a session, an account and a process, so `turnId` is the field that
     * has to separate them, and a leaked binding puts both ids in one filter.
     */
    const turnsNamed = (lines: Record<string, unknown>[]): unknown[] => [
      ...new Set(lines.map((line) => line['turnId']).filter((id) => id !== undefined)),
    ];
    expect(turnsNamed(killedLines)).toEqual([killed.turnId]);
    expect(turnsNamed(secondLines)).toEqual([second.body.turnId]);

    /**
     * And the two lifecycles read as different stories, which is the point of
     * being able to filter at all. The ordinary turn's call came back and its
     * step finished; the killed one's did neither and needed a recovery the
     * ordinary one has no line for.
     */
    const killedEvents = killedLines.map((line) => String(line['event']));
    const secondEvents = secondLines.map((line) => String(line['event']));
    expect(secondEvents).toContain('call.finished');
    expect(secondEvents).toContain('step.finished');
    expect(secondEvents).not.toContain('job.recovered');
    expect(killedEvents).toContain('job.recovered');
    expect(killedEvents).not.toContain('call.finished');
    expect(killedEvents).not.toContain('step.finished');
  });
});
