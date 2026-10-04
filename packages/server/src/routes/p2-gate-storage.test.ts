// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, newLorebook } from '@storyengine/shared';

import { INDEX_SCHEMA_VERSION } from '../index-db/migrations.js';
import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import { readClock, SE_CLOCK } from '../sessions/channels.js';
import { readAllTurns, walkPath } from '../sessions/segments.js';
import { replayChannels } from '../sessions/store.js';
import type { ChannelEffect, SessionFile, Turn } from '../sessions/types.js';
import { STATE_SCHEMA_VERSION } from '../state/migrations.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, ownObjects, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The two storage claims of the exit gate — [P2 §4](../../../../docs/design/workplan/08-p2-implementation.md)
 * steps 15 and 16, through the app.
 *
 * **Step 15 is one claim with two halves and the halves point opposite ways.**
 * *"Delete `index.sqlite` → sessions, turns and library all still read, and the
 * admin still logs in. Delete `state.sqlite` → an in-flight turn is lost and
 * that is expected; nothing else is."* The index is derived
 * ([03 §5.1](../../../../docs/design/03-data-model.md), [22 §5](../../../../docs/design/22-internal-contracts.md)),
 * so losing it costs a rescan and nothing a person can perceive except a pause;
 * the operational store is authoritative ([22 §5.1]), so losing it costs
 * exactly one thing — the turn that had not been written down yet — and the
 * value of the step is that the cost is *named and bounded* rather than
 * discovered.
 *
 * **Step 16 is the replay claim over what the engine actually wrote.**
 * `sessions/channels.test.ts` already replays and reconciles, but over turns the
 * test hand-builds: it holds `replayChannels` to account and says nothing about
 * whether the shipped pipeline emits effects a replay can be folded over. The
 * gate step is about the running system, so everything here goes in through
 * `POST /api/sessions/:id/turns` and comes back off disk.
 *
 * **Why a route suite and not a store suite.** Every one of these steps names a
 * user-visible surface — *still log in*, *still read*, *still search* — and each
 * of those is a route over a service over a file. A store-level version of step
 * 15 would delete a database the store does not open and assert on a reader the
 * user never reaches; it is the composition that is under test.
 */

/** The connection id the bindings point at. Fixed, so a failure names one file. */
const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a05';

const PASSWORD = 'correct horse battery';

/**
 * The word every search assertion in this file looks for.
 *
 * One distinctive token shared by a lorebook name and a turn's prose, because
 * the F10 route searches both tables and the interesting failure — a rebuild
 * that repopulated objects and skipped sessions — shows up only when one query
 * has to answer for both.
 */
const NEEDLE = 'cathedral';

const NARRATION = 'Bells rang from the cathedral across the flooded square.';

let dataDir: string;
let server: TestServer;
let provider: FakeProvider;

/**
 * A server on the shared data directory, with a scripted provider behind it.
 *
 * The directory is **borrowed**, which is the whole mechanism of this file: a
 * `makeTestServer` that minted its own would remove it on dispose, and there
 * would be nothing left for the second process to rebuild from. `afterEach`
 * owns the removal instead.
 *
 * Each start gets a fresh provider and a fresh cookie jar, both of which are
 * faithful — a restarted server is a new process holding no adapter state, and
 * the browser is a separate thing that has to sign in again.
 */
async function start(script: ScriptedReply[]): Promise<TestServer> {
  provider = new FakeProvider({ script });
  return makeTestServer({
    dataDir,
    providers: () => provider,
    config: {
      sessions: {
        snapshotEveryNTurns: 10,
        streamKeepaliveMs: 15000,
        // One checkpoint per chunk. The kill in step 15's second half has to
        // land *between* chunks, and a coalescing window is exactly a period in
        // which nothing durable happens — with the default 250 ms the whole
        // scripted stream can drain inside one window and the "mid-generation"
        // in the test name stops being true.
        streamCoalesceMs: 0,
      },
    },
  });
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-p2-storage-'));
});

afterEach(async () => {
  // Tolerated, because a test that failed early left its server holding the
  // sqlite files — and on Windows that is an `EBUSY` during cleanup, burying
  // the real failure under a second one that names a file nobody wrote.
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

/** Signs the client into a freshly started server. */
async function signIn(): Promise<{ status: number; body: any }> {
  return server.request({
    method: 'POST',
    url: '/api/auth/login',
    payload: { handle: 'ned', password: PASSWORD },
  });
}

/**
 * Everything a turn needs before it can be taken: an admin, a connection file,
 * and a role binding that points at it.
 *
 * Written as files rather than through a route because there is no connections
 * API at P2 — `resolveConnections` reads `users/<handle>/connections/*.json` off
 * disk, so this *is* the supported way to configure one, and a test that faked
 * it at the service level would skip the resolution the runner actually does.
 */
async function seedAccount(): Promise<void> {
  await setUpAdmin(server, 'ned');

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
}

/** One actor and one lorebook, so the library half of step 15 has something to lose. */
async function seedLibrary(): Promise<{ actorId: string; bookId: string }> {
  const actor = newActor('Vera Solano');
  await server.request({ method: 'POST', url: '/api/library/actors', payload: actor });
  // Named for the needle: the object half and the turn half of `GET /api/search`
  // are then answered by one query, which is what makes a partial rebuild show.
  const book = newLorebook('The Cathedral District');
  await server.request({ method: 'POST', url: '/api/library/lorebooks', payload: book });
  return { actorId: actor.id, bookId: book.id };
}

async function createSession(name = 'Rain City'): Promise<string> {
  const created = await server.request({ method: 'POST', url: '/api/sessions', payload: { name } });
  return created.body.session.id as string;
}

/**
 * Submits a turn and waits for it to be **committed**, not merely finished.
 *
 * `runner.settle()` rather than waiting on the `turn.finished` frame, and the
 * difference is one step of the commit protocol: `turn.finished` is published
 * inside step 4 ([P2 §2.10]) and the job row is marked committed after it, so a
 * test that resumed at the frame could dispose the server between the two and
 * leave a job that startup reconciliation would then legitimately resume — a
 * second turn record appearing for reasons that have nothing to do with what is
 * being asserted. Settling is strictly later than the frame, and the SSE
 * transport is gate steps 9, 12 and 14's to prove.
 */
async function takeTurn(
  sessionId: string,
  key: string,
  headTurnId: string | null,
  text: string,
): Promise<{ status: number; body: any }> {
  const accepted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: key, headTurnId, input: { text } },
  });
  await server.services.runner.settle();
  return accepted;
}

/**
 * Removes a SQLite database the way a person with a file manager would.
 *
 * **All three files, and the `-wal` one is not decoration.** Both stores run in
 * WAL mode (`index-db/open.ts`, `state/open.ts`), so the committed tail of the
 * database lives outside the main file — deleting `index.sqlite` alone leaves a
 * write-ahead log that SQLite will happily recover from, and the test would
 * assert against a database that was never gone.
 */
async function removeDatabase(path: string): Promise<void> {
  for (const suffix of ['', '-wal', '-shm']) await rm(`${path}${suffix}`, { force: true });
}

function sessionFilePath(sessionId: string): string {
  return join(new Layout(dataDir).sessionRoot('ned', sessionId), 'session.json');
}

/** `session.json` as a person opening it in an editor would see it. */
async function readSessionFile(sessionId: string): Promise<SessionFile> {
  return JSON.parse(await readFile(sessionFilePath(sessionId), 'utf8')) as SessionFile;
}

/**
 * The turns off disk, by id — the cold read, with no index in the path.
 *
 * `readAllTurns` and `walkPath` are production functions on purpose: step 16
 * says *replay-from-zero reproduces the head channel state*, and a test that
 * reimplemented either the walk or the fold would be comparing two of its own
 * beliefs while the shipped pair drifted underneath it.
 */
async function turnsOnDisk(sessionId: string): Promise<Map<string, Turn>> {
  const found = await readAllTurns(
    join(new Layout(dataDir).sessionRoot('ned', sessionId), 'turns'),
  );
  return new Map(found.map(({ turn }) => [turn.id, turn]));
}

describe('step 15 — deleting index.sqlite costs a rescan and nothing a user can see', () => {
  it('rebuilds the library, the session, the turn record and search, and still logs in', async () => {
    server = await start([{ text: NARRATION }]);
    await seedAccount();
    const { actorId, bookId } = await seedLibrary();
    const sessionId = await createSession();

    const accepted = await takeTurn(sessionId, 'k1', null, 'She looked up at the spire.');
    const turnId = accepted.body.turnId as string;

    const before = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const headTurnId = before.body.session.headTurnId as string;
    // The turn really did complete, before anything is deleted. Without this the
    // rest of the file could be asserting that a *failed* turn survives a
    // rebuild, which is a much smaller claim than the one the step makes.
    expect(headTurnId).toBe(turnId);

    await server.dispose();

    await removeDatabase(new Layout(dataDir).indexFile);
    // Observed directly rather than trusted: `rm` with `force` is silent about a
    // path that was never there, so a layout change that moved the index would
    // otherwise turn this whole test into a very slow way of asserting that a
    // server starts.
    expect(existsSync(new Layout(dataDir).indexFile)).toBe(false);

    server = await start([{ text: 'unused' }]);

    /**
     * **(1) The guard.** Everything below reads through routes that would also
     * pass on an untouched index, so the test needs one assertion that can only
     * hold when the file was gone *and* the rebuild path ran.
     *
     * `migration.from` is the version read out of the database header before
     * anything was done: `0` is a file that did not exist, and any other value
     * means the delete missed. `rebuildRequired` is the exact flag `buildServices`
     * branches on to call `rebuild()`, so the pair says the scan was asked for.
     * Whether it *produced* anything is (6)'s job.
     *
     * And the state store's version says the delete was surgical — this half of
     * the step is about the derived database only, and a test that had wiped
     * `state/` too would be proving something weaker while looking identical.
     */
    expect(server.services.index.migration).toEqual({
      from: 0,
      to: INDEX_SCHEMA_VERSION,
      rebuildRequired: true,
    });
    expect(server.services.state.migration.from).toBe(STATE_SCHEMA_VERSION);

    // **(2) The admin still logs in.** The half F11 recorded as never tested and
    // the reason the step exists: accounts live in `accounts.json`, so an index
    // that had become load-bearing for identity would lock the owner out of
    // their own install over a file the design calls disposable.
    const login = await signIn();
    expect(login.status).toBe(200);
    expect(login.body.account.handle).toBe('ned');

    // **(3) The session is listed, with its head.**
    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    expect(
      (listed.body.sessions as SessionFile[]).map((each) => ({
        id: each.id,
        headTurnId: each.headTurnId,
      })),
    ).toEqual([{ id: sessionId, headTurnId: turnId }]);

    /**
     * **(4) The turn reads back with its record, not just its id.**
     *
     * `request.calls` is the part that would be quietly lost by a store that
     * kept only what search needs, and `resolved` is [22 §1.4]'s answer to *"why
     * is this turn different"* — a turn record without it is a log line.
     */
    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    const [turn] = turns.body.turns as Turn[];
    expect(turn?.id).toBe(turnId);
    expect(turn?.status).toBe('complete');
    expect(turn?.output?.text).toBe(NARRATION);
    expect(turn?.request?.calls.map((call) => call.resolved)).toEqual([
      { connectionId: CONNECTION_ID, modelId: 'fake-hi' },
    ]);

    // **(5) The library holds both objects.** This one *is* index-backed —
    // `GET /api/library` lists rows, not files — so it fails outright if the
    // rebuild never ran over the object half.
    // The account's own — [P7B.0]'s shipped packs share this list ([10 §5]).
    const library = await ownObjects(server);
    expect(library.objects.map((row) => row.id).sort()).toEqual([actorId, bookId].sort());

    /**
     * **(6) The load-bearing one.**
     *
     * (3) and (4) read from **disk** — `listSessionFiles` walks folders and
     * `readTurns` walks segments, neither touching a row — so they would both
     * pass over an index in which `rebuildSessions` had been deleted outright.
     * Search is the only surface that can answer nothing but from the index, so
     * this is where a rebuild that repopulated objects and skipped sessions
     * finally shows. Both halves of the answer are asserted, because a route
     * that returned only objects would satisfy a weaker reading of the step.
     */
    const found = await server.request({ method: 'GET', url: `/api/search?q=${NEEDLE}` });
    expect(found.status).toBe(200);
    expect((found.body.turns as { turnId: string }[]).map((row) => row.turnId)).toEqual([turnId]);
    expect((found.body.objects as { id: string }[]).map((row) => row.id)).toEqual([bookId]);
  });
});

/**
 * The other half of the asymmetry — [22 §5.1], [P2 §2.10].
 *
 * `state.sqlite` holds the idempotency reservations, the job rows and the
 * in-progress draft, and none of those is a restatement of anything on disk.
 * The design does not claim they survive; it claims the loss is **bounded** —
 * one turn, the one that had not been written down yet — and everything the
 * bound excludes is what these tests assert.
 */
describe('step 15 — deleting state.sqlite loses the turn in flight and nothing else', () => {
  interface Killed {
    sessionId: string;
    /** The turn that completed and was written to a segment before the kill. */
    committedTurnId: string;
    /** The turn that was mid-generation, which lived only in the operational store. */
    lostTurnId: string;
    lostJobId: string;
    actorId: string;
    bookId: string;
  }

  /**
   * One committed turn, then a second one killed mid-generation.
   *
   * **`halt()` then `dispose()`, which is a kill and not a shutdown.**
   * `drain()` — what `dispose` does on its own — lets each run *finish*, so the
   * second turn would commit and the test would be asserting that a graceful
   * stop works. `halt()` drops the runs without finalising, which is what a dead
   * process leaves behind; the detached run then finds a closed store and can
   * write nothing, exactly as a killed process cannot.
   */
  async function killMidSecondTurn(): Promise<Killed> {
    server = await start([
      { text: NARRATION },
      // Twelve chunks with a real delay between them. The delay is the only
      // thing that makes "mid-generation" mean anything (see `ScriptedReply`):
      // with no `await` between yields the whole stream drains inside one
      // macrotask and there is no window in which to kill anything.
      { text: 'A shape moved behind the obelisk.', chunks: 12, chunkDelayMs: 50 },
    ]);
    await seedAccount();
    const { actorId, bookId } = await seedLibrary();
    const sessionId = await createSession();

    const first = await takeTurn(sessionId, 'k1', null, 'She looked up at the spire.');
    const committedTurnId = first.body.turnId as string;

    const second = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: 'k2',
        headTurnId: committedTurnId,
        // A second needle, so the lost turn's absence is provable rather than
        // merely unobserved: nothing in the library or the first turn says
        // "obelisk", so a hit for it could only come from the turn that died.
        input: { text: 'She followed it past the obelisk.' },
      },
    });
    expect(second.status).toBe(202);

    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    // Real work has happened by the time a delta arrives, so the kill lands
    // during generation rather than before the provider was ever called.
    await stream.until((frame) => frame.event === 'delta', 8000);
    await stream.abort();

    server.services.runner.halt();
    await server.dispose();

    return {
      sessionId,
      committedTurnId,
      lostTurnId: second.body.turnId as string,
      lostJobId: second.body.jobId as string,
      actorId,
      bookId,
    };
  }

  it('leaves no trace of the turn that was in flight', async () => {
    const killed = await killMidSecondTurn();

    await removeDatabase(new Layout(dataDir).stateFile);
    expect(existsSync(new Layout(dataDir).stateFile)).toBe(false);

    server = await start([{ text: 'unused' }]);
    await signIn();

    /**
     * The guard, mirrored from the first half of the step: the operational store
     * is the one that was recreated from nothing, and the index is the one that
     * was left alone. Asserting both is what makes this a test of the
     * *asymmetry* rather than two tests of "a server starts".
     */
    expect(server.services.state.migration.from).toBe(0);
    expect(server.services.index.migration.rebuildRequired).toBe(false);

    /**
     * **Nothing to reconcile, because the evidence is gone.**
     *
     * With the store intact this is the case `recovery.test.ts` covers — the job
     * is still active at startup and `reconcile` finalises it into a failed turn
     * carrying its blocks. Here there is no job row to walk, so the reported
     * outcome is empty, and that emptiness is precisely the cost [22 §5.1]
     * names. A non-empty `finalised` here would mean the delete had not taken.
     */
    expect(server.services.reconciliation).toEqual({
      finalised: [],
      abandoned: [],
      failed: [],
    });

    // The session is not busy. `job_one_active_per_session` is partial on
    // `finished_at is null`, so a job that survived as active would refuse every
    // later submission as busy — forever, and with a perfectly well-formed 409.
    const read = await server.request({ method: 'GET', url: `/api/sessions/${killed.sessionId}` });
    expect(read.body.activeJob).toBeNull();

    /**
     * And the turn itself never reached disk.
     *
     * The append is step 2 of the commit protocol and generation had not
     * finished, so the draft existed only in `state.sqlite`. This is the
     * assertion that a change moving the append earlier — writing the turn at
     * reservation, say — would break: the lost turn would then be sitting in a
     * segment with nothing to complete it, which is the "duplicated or
     * discarded" outcome [P2 §2.10] refuses.
     */
    const turns = await server.request({
      method: 'GET',
      url: `/api/sessions/${killed.sessionId}/turns`,
    });
    expect((turns.body.turns as Turn[]).map((each) => each.id)).toEqual([killed.committedTurnId]);
    expect(killed.lostTurnId).not.toBe(killed.committedTurnId);

    // Nor the index, which is the surface that would still find it if the FTS
    // row had been written ahead of the segment.
    const found = await server.request({ method: 'GET', url: '/api/search?q=obelisk' });
    expect(found.body.turns).toEqual([]);

    /**
     * **Recovery resumes finalisation, never generation** ([P2 §2.10]).
     *
     * The restarted process has a fresh `FakeProvider` and it recorded nothing,
     * so nothing in the startup path re-ran the interrupted turn. A recovery
     * that tried to *continue* a killed turn would charge for it a second time,
     * which is the one failure the whole idempotency protocol exists to prevent
     * — and it is invisible in every assertion above, because a re-generated
     * turn would look exactly like a survivor.
     */
    expect(provider.requests).toEqual([]);
  });

  it('keeps the committed turn, the head, the library and the login', async () => {
    const killed = await killMidSecondTurn();

    await removeDatabase(new Layout(dataDir).stateFile);
    server = await start([{ text: 'The water kept rising.' }]);

    // Accounts are a file, not a row in either database.
    const login = await signIn();
    expect(login.status).toBe(200);
    expect(login.body.account.handle).toBe('ned');

    /**
     * **The head is where it was.**
     *
     * `session.json` is authoritative for the head snapshot ([03 §8.1]), and
     * this is the assertion that catches a head that had migrated into the
     * operational store — a plausible optimisation, since that is where the job
     * already knows the parent turn. It would look correct until the first time
     * somebody lost the file.
     */
    const read = await server.request({ method: 'GET', url: `/api/sessions/${killed.sessionId}` });
    expect(read.body.session.headTurnId).toBe(killed.committedTurnId);

    const turns = await server.request({
      method: 'GET',
      url: `/api/sessions/${killed.sessionId}/turns`,
    });
    const [turn] = turns.body.turns as Turn[];
    expect(turn?.id).toBe(killed.committedTurnId);
    expect(turn?.output?.text).toBe(NARRATION);
    // With its record, for the same reason step 15's first half insists on it:
    // a turn id that survives without its calls is not a turn record.
    expect(turn?.request?.calls.map((call) => call.resolved.modelId)).toEqual(['fake-hi']);

    // The index was never touched, so search still answers — the contrast that
    // makes this half of the step mean something.
    const found = await server.request({ method: 'GET', url: `/api/search?q=${NEEDLE}` });
    expect((found.body.turns as { turnId: string }[]).map((row) => row.turnId)).toEqual([
      killed.committedTurnId,
    ]);
    expect((found.body.objects as { id: string }[]).map((row) => row.id)).toEqual([killed.bookId]);

    // The account's own — [P7B.0]'s shipped packs share this list ([10 §5]).
    const library = await ownObjects(server);
    expect(library.objects.map((row) => row.id).sort()).toEqual(
      [killed.actorId, killed.bookId].sort(),
    );

    /**
     * **And the session takes the next turn, from where it was.**
     *
     * Submitted against the *committed* head, which is the part that proves the
     * loss was bounded: the story continues from the turn before the one that
     * died rather than from zero, and the clock — replayed channel state, held
     * in the file the delete did not touch — carries on from 8:05 rather than
     * restarting at the clock channel’s declared start.
     */
    const next = await takeTurn(
      killed.sessionId,
      'k3',
      killed.committedTurnId,
      'She tried the door again.',
    );
    expect(next.status).toBe(202);

    const after = await server.request({
      method: 'GET',
      url: `/api/sessions/${killed.sessionId}/turns`,
    });
    const path = after.body.turns as Turn[];
    expect(path.map((each) => each.id)).toEqual([killed.committedTurnId, next.body.turnId]);
    expect(path.at(-1)?.status).toBe('complete');
    expect(path.at(-1)?.parentTurnId).toBe(killed.committedTurnId);
    expect(path.at(-1)?.output?.text).toBe('The water kept rising.');

    expect(readClock((await readSessionFile(killed.sessionId)).channels)).toEqual({
      day: 1,
      hour: 8,
      minute: 10,
    });
  });
});

/**
 * Step 16 — [P2 §2.7], [03 §8.1].
 *
 * *Replay-from-zero reproduces the head channel state; hand-edit `session.json`'s
 * clock on disk → the divergence lands as a user-attributed effect.*
 *
 * The existing coverage in `sessions/channels.test.ts` replays over turns the
 * test constructs, with a `clockEffect` the test calls itself. That holds the
 * fold to account and leaves the interesting question open: whether the effects
 * the **shipped pipeline** emits are ones a replay can be folded over at all.
 * `runner.ts` computes the clock outside the step loop and pushes it through
 * `acceptEffect`, which stamps `before` from the *running* map — so the two
 * turns below chain, and a fold from zero has to arrive at the same place the
 * head snapshot did.
 */
describe('step 16 — the head snapshot is derived from what the engine wrote', () => {
  /** Two ordinary turns through the route, and the head after them. */
  async function twoTurns(): Promise<{ sessionId: string; head: string }> {
    server = await start([{ text: 'The bells stopped.' }, { text: 'Then the rain.' }]);
    await seedAccount();
    const sessionId = await createSession();

    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const second = await takeTurn(sessionId, 'k2', first.body.turnId as string, 'She stepped out.');
    return { sessionId, head: second.body.turnId as string };
  }

  it('folds the effects the engine wrote from zero back to session.json', async () => {
    const { sessionId, head } = await twoTurns();

    const file = await readSessionFile(sessionId);
    const byId = await turnsOnDisk(sessionId);

    // Both sides read off disk, with the server still running: the claim is
    // about what was *written*, and reading `services` would let an in-memory
    // value stand in for a file that was never flushed.
    expect(file.headTurnId).toBe(head);
    expect(byId.size).toBe(2);

    /**
     * The fold, through the production walk and the production applier.
     *
     * **Not vacuous**, which needs saying because `{}` deep-equals `{}`: a
     * pipeline that emitted no effects at all would satisfy the comparison and
     * fail the step. So the value is asserted too — the declared start at 08:00 plus
     * two turns of `MINUTES_PER_TURN` — and that is what a mutation to
     * `advance`, to `MINUTES_PER_TURN`, or to the clock's position outside the
     * step loop would move.
     */
    const replayed = replayChannels(walkPath(byId, file.headTurnId));
    expect(replayed).toEqual(file.channels);
    expect(readClock(file.channels)).toEqual({ day: 1, hour: 8, minute: 10 });

    /**
     * And the effects are chained rather than each computed from the pre-turn
     * state: the second turn's `before` is the first turn's `after`. [22 §1.2]
     * makes `before` stored rather than derived so that undoing the tip is an
     * apply and not a replay of 0..N−1, and an unchained `before` would restore
     * a value that had already been superseded — invisible in the head snapshot
     * and wrong the moment anybody reverts.
     *
     * **The first `before` is `null`, and that is what the shipped engine
     * writes** rather than what this test would have guessed. `runner.ts` builds
     * the effect through `acceptEffect`, which takes `before` from
     * `running[channelId]?.value ?? null` — and on turn one there is no channel
     * yet, so the absent state is recorded as absent. `channels.ts`'s
     * `clockEffect` would have written the declared start there instead, and it has
     * no production caller; the two disagree only on this one cell. Pinned as
     * observed, because the alternative is a test that documents a helper
     * nothing runs. It is also benign for reversal — `readClock` maps a
     * non-clock value back to the declared start — but it is a difference somebody
     * unifying the two constructors needs to see rather than discover.
     */
    const clockEffects = [...byId.values()]
      .flatMap((turn) => turn.effects)
      .filter((effect) => effect.channelId === SE_CLOCK);
    expect(clockEffects.map((effect) => [effect.before, effect.after])).toEqual([
      [null, { day: 1, hour: 8, minute: 5 }],
      [
        { day: 1, hour: 8, minute: 5 },
        { day: 1, hour: 8, minute: 10 },
      ],
    ]);
    // Engine-computed, so nothing the model said could have produced them
    // ([P2 §2.7]). The same proposal from a model is refused by `acceptEffect`.
    expect(clockEffects.map((effect) => effect.proposedBy)).toEqual([
      { kind: 'engine' },
      { kind: 'engine' },
    ]);
  });

  it('turns a hand-edited clock into a user-attributed effect on a new head turn', async () => {
    const { sessionId, head } = await twoTurns();

    /**
     * The edit, made the way the design says it may be made: open the file,
     * change the number, save. *"It should be the next evening by now."*
     *
     * Written back through `readFile`/`writeFile` rather than through any server
     * helper, because the promise [10 §4] makes is about a text editor — a test
     * that went through the store would be exercising a door nobody uses.
     */
    const file = await readSessionFile(sessionId);
    file.channels[SE_CLOCK] = { version: 1, value: { day: 2, hour: 21, minute: 45 } };
    await writeFile(sessionFilePath(sessionId), JSON.stringify(file, null, 2));

    /**
     * `GET /api/sessions/:id` is what forces reconciliation — the route's `mine`
     * helper calls `reconcileHandEdits` before it answers, because [03 §8.1]
     * says the comparison happens *on load*. Until that call existed the
     * reconciler was exported, unit-tested and reached by nothing, and a hand
     * edit was silently absorbed into the next head advance.
     */
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.status).toBe(200);

    /**
     * **A new turn, not effects appended to the old head.** A segment is
     * append-only, so rewriting the head turn's line to carry the edit is
     * exactly what the format forbids; `divergenceTurn` makes the edit its own
     * turn instead, which is also what keeps [03 §8.1]'s promise that the change
     * is visible *in the turn record*.
     */
    const newHead = read.body.session.headTurnId as string;
    expect(newHead).not.toBe(head);

    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    const path = turns.body.turns as Turn[];
    // Three, not two: the two generated turns are untouched and the edit is the
    // third. A reconciler that rewrote the head in place would leave two.
    expect(path).toHaveLength(3);

    const newest = path.at(-1);
    expect(newest?.id).toBe(newHead);
    expect(newest?.parentTurnId).toBe(head);
    /**
     * No request, and that is a claim rather than an absence. [03 §8.1]: a
     * divergence turn made no request, ran no steps and cost nothing — an empty
     * `request` here would be a record asserting that a prompt was built and
     * came back empty, which is a different and false statement about what
     * happened.
     */
    expect(newest?.request).toBeUndefined();
    expect(newest?.tape).toEqual([]);

    // The effect itself: the user's value, attributed to the user, reversible
    // into the value the log says was true.
    expect(newest?.effects).toHaveLength(1);
    expect(newest?.effects[0]).toMatchObject({
      turnId: newHead,
      channelId: SE_CLOCK,
      scopeKey: null,
      op: { type: 'set', path: '/' },
      before: { day: 1, hour: 8, minute: 10 },
      after: { day: 2, hour: 21, minute: 45 },
      // The whole mechanism in one field: attributed to the person who opened
      // the file, never to the engine that noticed the difference.
      proposedBy: { kind: 'user' },
      applied: true,
      rejectedReason: null,
      scope: 'session',
    } satisfies Partial<ChannelEffect>);

    /**
     * And the log now agrees with the file, which is the point of recording the
     * divergence rather than overwriting it: replay-from-zero reaches the edited
     * value, so the next turn advances from 21:45 instead of quietly resurrecting
     * 08:10 on the following head advance.
     */
    const after = await readSessionFile(sessionId);
    expect(readClock(after.channels)).toEqual({ day: 2, hour: 21, minute: 45 });
    expect(replayChannels(walkPath(await turnsOnDisk(sessionId), after.headTurnId))).toEqual(
      after.channels,
    );

    // Reconciliation is not a treadmill: a second load with no further edit
    // must append nothing, or every page view would grow somebody's story.
    const again = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(again.body.session.headTurnId).toBe(newHead);
    expect((await turnsOnDisk(sessionId)).size).toBe(3);
  });
});
