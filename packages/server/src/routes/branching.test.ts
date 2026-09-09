// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newLorebook, newLoreEntry } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { readClock } from '../sessions/channels.js';
import { walkPath } from '../sessions/segments.js';
import { readSession, readTurns, replayChannels } from '../sessions/store.js';
import type { Turn } from '../sessions/types.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * Branching through the route — [P6.0c], and [P6 §1.7]'s stale-head decision.
 *
 * **The decision, so a reader does not have to reconstruct it from the code:**
 * a submission names the node it attaches to, and naming one that is not the
 * head has to be deliberate. `parentTurnId` absent is every submission P2
 * through P5 makes and still refuses a moved head with `412`; `parentTurnId`
 * present says *I mean this node* and the head check does not apply. The two
 * answers [P2 §2.10] left open — *an explicit sibling* or *a refusal that
 * offers one* — turn out not to be alternatives: the refusal is for the client
 * that did not ask, the sibling for the client that did.
 *
 * **Why a route suite.** The claim is a composition — the gate in
 * `state/jobs.ts`, the runner gathering at a parent that is not the head
 * ([P6.0b]), and `advanceHead` folding onto that parent's map — and each of
 * those is separately tested. What only shows here is that a turn submitted
 * against an old node comes back as a sibling of it with the state that node
 * had, through the pipeline a person actually reaches.
 */

const PASSWORD = 'correct horse battery';
const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a05';

let server: TestServer;
let provider: FakeProvider;

beforeEach(async () => {
  provider = new FakeProvider({ script: [{ text: 'The rain kept on.' }] });
  server = await makeTestServer({ providers: () => provider });
  await setUpAdmin(server, 'ned', PASSWORD);

  // No connections API at P2, so the supported way to configure one is to write
  // the files the resolver reads — the same seam `p2-gate-storage.test.ts` uses.
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
  await server.dispose().catch(() => undefined);
});

async function createSession(name = 'Rain City'): Promise<string> {
  const created = await server.request({ method: 'POST', url: '/api/sessions', payload: { name } });
  return created.body.session.id as string;
}

/**
 * Submits a turn and waits for it to be **committed**, not merely finished:
 * `turn.finished` is published inside step 4 of the commit protocol and the job
 * is marked committed after it, so a test that resumed at the frame could read
 * a head that had not moved yet.
 */
async function takeTurn(
  sessionId: string,
  key: string,
  headTurnId: string | null,
  text: string,
  branchFrom?: {
    parentTurnId?: string | null;
    rewriteOf?: string;
    redoOf?: string;
    guidance?: string;
  },
): Promise<{ status: number; body: any }> {
  const accepted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: {
      idempotencyKey: key,
      headTurnId,
      input: { text },
      ...(branchFrom ?? {}),
    },
  });
  await server.services.runner.settle();
  return accepted;
}

/** Every turn of the session off disk, by id — the cold read, no index. */
async function turnsOnDisk(sessionId: string): Promise<Map<string, Turn>> {
  return readTurns(server.services.sessions, 'ned', sessionId);
}

describe('a turn submitted against an old node', () => {
  it('becomes a sibling of it, with that node’s state rather than the head’s', async () => {
    const sessionId = await createSession();

    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const firstId = first.body.turnId as string;
    const second = await takeTurn(sessionId, 'k2', firstId, 'She stepped out.');
    const secondId = second.body.turnId as string;

    // Composed against the first turn, deliberately, while the head is on the
    // second. Before [P6.0c] this was a 412 and there was no way to say it.
    const branched = await takeTurn(sessionId, 'k3', firstId, 'She stayed in.', {
      parentTurnId: firstId,
    });
    expect(branched.status).toBe(202);

    const siblingId = branched.body.turnId as string;
    expect(branched.body.parentTurnId).toBe(firstId);

    const byId = await turnsOnDisk(sessionId);
    expect(byId.size).toBe(3);

    // Two lines that share one turn and nothing else. The falsifying mutation
    // is taking `headTurnId` as the parent regardless, which makes this a third
    // turn on one line.
    expect(walkPath(byId, secondId).map((turn) => turn.id)).toEqual([firstId, secondId]);
    expect(walkPath(byId, siblingId).map((turn) => turn.id)).toEqual([firstId, siblingId]);

    /**
     * And the state each line reconstructs to. Two turns deep on either line,
     * so the clock is the same number by arithmetic — what is being asserted is
     * that the *sibling* is two turns deep rather than three, which is what a
     * turn assembled and committed against the head's state would have made it.
     * [P6.0b] is why this holds: the runner gathered at the parent and
     * `advanceHead` folded onto that parent's map.
     */
    expect(readClock(replayChannels(walkPath(byId, secondId)))).toEqual({
      day: 1,
      hour: 8,
      minute: 10,
    });
    expect(readClock(replayChannels(walkPath(byId, siblingId)))).toEqual({
      day: 1,
      hour: 8,
      minute: 10,
    });

    // The head follows the new line, and the snapshot is the replay at it —
    // [P6.0b]'s invariant, through the pipeline rather than at store level.
    const session = await readSession(server.services.sessions, 'ned', sessionId);
    expect(session?.headTurnId).toBe(siblingId);
    expect(session?.channels).toEqual(replayChannels(walkPath(byId, siblingId)));
  });

  it('is still refused when nobody asked for it — gate step 12', async () => {
    const sessionId = await createSession();

    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const firstId = first.body.turnId as string;
    const second = await takeTurn(sessionId, 'k2', firstId, 'She stepped out.');
    const secondId = second.body.turnId as string;

    // A second tab, composing against the head it last saw. Nothing here says
    // *branch*, so the answer is the refusal it has always been — and the
    // session still has two turns, not three.
    const stale = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k3', headTurnId: firstId, input: { text: 'She stayed in.' } },
    });

    expect(stale.status).toBe(412);
    expect(stale.body.error).toBe('stale-head');
    // The head it should have used, by name rather than by shape.
    expect(stale.body.head).toBe(secondId);
    expect((await turnsOnDisk(sessionId)).size).toBe(2);

    // The refusal carries what the client needs to make it a choice: rebase on
    // `head`, or resubmit naming the parent and keep the line it was on.
    const chosen = await takeTurn(sessionId, 'k4', firstId, 'She stayed in.', {
      parentTurnId: firstId,
    });
    expect(chosen.status).toBe(202);
    expect((await turnsOnDisk(sessionId)).size).toBe(3);
  });

  it('refuses a branch point that is not a turn of this session', async () => {
    const sessionId = await createSession();
    const other = await createSession('Another city');
    const theirs = await takeTurn(other, 'k1', null, 'Elsewhere entirely.');

    const crossed = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: 'k2',
        headTurnId: null,
        parentTurnId: theirs.body.turnId as string,
        input: { text: 'She stayed in.' },
      },
    });

    expect(crossed.status).toBe(404);
    expect(crossed.body.error).toBe('no-such-parent');
    expect((await turnsOnDisk(sessionId)).size).toBe(0);
  });

  it('charges once for a branch that is submitted twice', async () => {
    // [21 §5.1]: a retry must never make a second provider call. Branching does
    // not get its own path through the reservation, and this is what says so.
    const sessionId = await createSession();
    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const firstId = first.body.turnId as string;
    await takeTurn(sessionId, 'k2', firstId, 'She stepped out.');

    const calls = provider.requests.length;

    const branched = await takeTurn(sessionId, 'k3', firstId, 'She stayed in.', {
      parentTurnId: firstId,
    });
    const retry = await takeTurn(sessionId, 'k3', firstId, 'She stayed in.', {
      parentTurnId: firstId,
    });

    expect(retry.body.jobId).toBe(branched.body.jobId);
    expect(retry.body.turnId).toBe(branched.body.turnId);
    expect(provider.requests.length).toBe(calls + 1);
    expect((await turnsOnDisk(sessionId)).size).toBe(3);
  });
});

describe('moving the head, through the routes', () => {
  async function moveTo(
    sessionId: string,
    turnId: string,
    resume?: boolean,
  ): Promise<{ status: number; body: any }> {
    return server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/head`,
      payload: { turnId, ...(resume === undefined ? {} : { resume }) },
    });
  }

  async function history(sessionId: string): Promise<string[]> {
    const read = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/turns`,
    });
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    return (read.body.turns as { id: string }[]).map((turn) => turn.id);
  }

  it('makes history the path to the new head, and nothing else', async () => {
    // Proof obligation (ii): *history shows the selected path only* ([07 §6]).
    // The transcript route walks from the head, so moving the head is the whole
    // of switching lines — no turn is rewritten and no list is reordered.
    const sessionId = await createSession();
    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const firstId = first.body.turnId as string;
    const second = await takeTurn(sessionId, 'k2', firstId, 'She stepped out.');
    const secondId = second.body.turnId as string;
    const branched = await takeTurn(sessionId, 'k3', firstId, 'She stayed in.', {
      parentTurnId: firstId,
    });
    const siblingId = branched.body.turnId as string;

    // The branch took the head with it, so history is that line.
    expect(await history(sessionId)).toEqual([firstId, siblingId]);

    const moved = await moveTo(sessionId, secondId);
    expect(moved.status).toBe(200);
    expect(moved.body.session.headTurnId).toBe(secondId);

    // The other line, whole, and the sibling is not in it.
    expect(await history(sessionId)).toEqual([firstId, secondId]);

    // Back to the fork: one turn of history, both children still on disk.
    await moveTo(sessionId, firstId);
    expect(await history(sessionId)).toEqual([firstId]);
    expect((await turnsOnDisk(sessionId)).size).toBe(3);

    // And forward resumes the line last selected rather than picking one.
    const forward = await moveTo(sessionId, firstId, true);
    expect(forward.body.session.headTurnId).toBe(secondId);
  });

  it('is refused while a turn is in flight, and says which job', async () => {
    // Proof obligation (iii), first half. The running turn is going to set the
    // head when it commits; a move that raced it would either be overwritten
    // without a word or overwrite the turn's own parentage. One turn advances a
    // session at a time — the same rule `submitTurn` applies to submissions.
    const sessionId = await createSession();
    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const firstId = first.body.turnId as string;

    // A provider that has not answered yet, so the job is still in flight when
    // the move arrives. The submission is awaited — it answers `202` the moment
    // the job is reserved, which is strictly before the provider replies — so
    // the refusal below is a fact about the job rather than a race with it.
    provider.setScript([{ text: 'A long while later.', stallMs: 1000 }]);
    const accepted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k2', headTurnId: firstId, input: { text: 'She waited.' } },
    });
    expect(accepted.status).toBe(202);

    const refused = await moveTo(sessionId, firstId);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('busy');
    expect(refused.body.job.sessionId).toBe(sessionId);

    await server.services.runner.settle();

    // And once it has landed, the move it refused is allowed.
    expect((await moveTo(sessionId, firstId)).status).toBe(200);
  });

  it('leaves an open stream alone, and the next turn lands on the moved head', async () => {
    // Proof obligation (iii), second half. A head move is not a turn: nothing
    // is published for it, so a client watching this session sees no frame it
    // would have to interpret. What it *does* see is the next turn — appended
    // to the node the head was moved to, which is how a viewer's stream and the
    // story stay the same story.
    const sessionId = await createSession();
    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const firstId = first.body.turnId as string;
    const second = await takeTurn(sessionId, 'k2', firstId, 'She stepped out.');
    const secondId = second.body.turnId as string;

    const tab = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await tab.until((frame) => frame.event === 'snapshot');
    const seen = tab.frames().length;

    await moveTo(sessionId, firstId);
    expect(tab.frames()).toHaveLength(seen);

    // The next turn goes where the head now is, and the watching tab is told
    // about it on the same stream it already had open.
    const next = await takeTurn(sessionId, 'k3', firstId, 'She looked back.');
    // The frame's SSE event name is `progress` for every progress event; which
    // one it is lives in `key` beside the sequence number.
    await tab.until(
      (frame) =>
        frame.event === 'progress' && (frame.data as { key?: string }).key === 'turn.finished',
      8000,
    );
    await tab.abort();

    const byId = await turnsOnDisk(sessionId);
    expect(byId.get(next.body.turnId as string)?.parentTurnId).toBe(firstId);
    expect(walkPath(byId, next.body.turnId as string).map((turn) => turn.id)).toEqual([
      firstId,
      next.body.turnId as string,
    ]);
    expect(secondId).not.toBe(next.body.turnId);
  });

  it('names a node without moving one, and forgets the name the same way', async () => {
    // Proof obligation (iv) through the routes: promote, rename, delete.
    const sessionId = await createSession();
    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const firstId = first.body.turnId as string;
    await takeTurn(sessionId, 'k2', firstId, 'She stepped out.');
    const before = await turnsOnDisk(sessionId);

    const created = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/refs`,
      payload: { name: 'The way in', turnId: firstId },
    });
    expect(created.status).toBe(200);
    const refId = created.body.session.branchRefs[0].id as string;

    const renamed = await server.request({
      method: 'PATCH',
      url: `/api/sessions/${sessionId}/refs/${refId}`,
      payload: { name: 'The other way' },
    });
    expect(renamed.body.session.branchRefs[0].name).toBe('The other way');

    const deleted = await server.request({
      method: 'DELETE',
      url: `/api/sessions/${sessionId}/refs/${refId}`,
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body.session.branchRefs).toEqual([]);

    // Nothing moved, through all three.
    const after = await turnsOnDisk(sessionId);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());

    // And a name on a node that is not here is refused rather than stored.
    const nowhere = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/refs`,
      payload: { name: 'Nowhere', turnId: '0192b7c0-0000-7000-8000-00000000dead' },
    });
    expect(nowhere.status).toBe(404);
    expect(nowhere.body.error).toBe('no-such-turn');
  });
});

/**
 * Rewrite and reroll — [19 §14.5], [P6 §3] step 3, [P6.2].
 *
 * **The fixture has to be built to roll**, which [P6 §0.1a] found the hard way:
 * the production draw sites are `lore.probability` and `lore.group`, so a turn
 * against an ordinary book commits an empty tape and every assertion about
 * replay would pass by asserting nothing. This session selects a book whose one
 * entry carries a `probability` below a hundred, and **the tape is asserted
 * non-empty before anything is asserted about it** — that assertion is the one
 * that fails if a future change quietly stops drawing.
 *
 * *And the trap [P6 §2] names for this fixture:* a session's lore links are
 * live, so the book must not change between the turn and its rewrite, or the
 * step reddens for a reason that is not a defect. Nothing here touches it after
 * the session is created.
 */
describe('rewrite replays the draws, and reroll does not', () => {
  const KEY = 'ferryman';

  /** A session that selects a book built to roll. */
  async function rollingSession(): Promise<string> {
    const book = {
      ...newLorebook('Rain City'),
      scanDepth: 1,
      entries: [
        {
          ...newLoreEntry('The ferryman'),
          keys: [KEY],
          content: 'He takes coin, not names.',
          // Below a hundred, so activation is a draw rather than a certainty —
          // which is the whole of what makes this fixture roll.
          probability: 50,
        },
      ],
    };
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const session = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain City', lore: [book.id] },
    });
    expect(session.status, JSON.stringify(session.body)).toBe(201);
    return session.body.session.id as string;
  }

  async function turnOnDisk(sessionId: string, turnId: string): Promise<Turn> {
    const found = (await turnsOnDisk(sessionId)).get(turnId);
    if (found === undefined) throw new Error('the turn is not on disk');
    return found;
  }

  it('reproduces the draw it was given, and marks it replayed', async () => {
    const sessionId = await rollingSession();

    const first = await takeTurn(sessionId, 'k1', null, `I ask about the ${KEY}.`);
    const firstId = first.body.turnId as string;
    const original = await turnOnDisk(sessionId, firstId);

    // **Before anything about replay**: the fixture actually rolled. Without
    // this the rest of the test holds just as well for a turn that drew
    // nothing, which is what an ordinary book produces.
    expect(original.tape.length).toBeGreaterThan(0);
    expect(original.tape.map((draw) => draw.site)).toContain('lore.probability');
    expect(original.tape.every((draw) => !draw.replayed)).toBe(true);

    // Redo, rewriting: a sibling of the same parent, replaying that turn's
    // draws.
    const rewritten = await takeTurn(sessionId, 'k2', null, `I ask about the ${KEY}.`, {
      parentTurnId: original.parentTurnId,
      rewriteOf: firstId,
    });
    expect(rewritten.status).toBe(202);
    const rewrite = await turnOnDisk(sessionId, rewritten.body.turnId as string);

    // A sibling, not a continuation.
    expect(rewrite.parentTurnId).toBe(original.parentTurnId);
    // The same mechanical outcome, and the record says which draws were taken
    // off the tape — gate step 3's *the record marks replayed vs fresh draws*.
    expect(rewrite.tape.map((draw) => draw.key)).toEqual(original.tape.map((draw) => draw.key));
    expect(rewrite.tape.map((draw) => draw.value)).toEqual(original.tape.map((draw) => draw.value));
    expect(rewrite.tape.every((draw) => draw.replayed)).toBe(true);
  });

  it('draws fresh when nothing was handed to it, which is reroll', async () => {
    const sessionId = await rollingSession();
    const first = await takeTurn(sessionId, 'k1', null, `I ask about the ${KEY}.`);
    const original = await turnOnDisk(sessionId, first.body.turnId as string);
    expect(original.tape.length).toBeGreaterThan(0);

    // The same gesture without a tape: a sibling that rolls again.
    const rerolled = await takeTurn(sessionId, 'k2', null, `I ask about the ${KEY}.`, {
      parentTurnId: original.parentTurnId,
    });
    const reroll = await turnOnDisk(sessionId, rerolled.body.turnId as string);

    expect(reroll.parentTurnId).toBe(original.parentTurnId);
    expect(reroll.tape.length).toBeGreaterThan(0);
    // **Fresh, and it says so.** The value may coincide — a coin can land the
    // same way twice — so the assertion is on the flag rather than on the
    // outcome, which is exactly what the flag is for.
    expect(reroll.tape.every((draw) => !draw.replayed)).toBe(true);
  });

  it('refuses to rewrite a turn that is not in this session', async () => {
    const sessionId = await rollingSession();
    const elsewhere = await createSession('Another city');
    const theirs = await takeTurn(elsewhere, 'k1', null, 'Elsewhere entirely.');

    const refused = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: 'k2',
        headTurnId: null,
        rewriteOf: theirs.body.turnId as string,
        input: { text: 'I ask again.' },
      },
    });

    // The tape is read from this server's record, and only from this session's
    // — so a rewrite cannot reach across the boundary for somebody else's luck.
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe('no-such-turn');
    expect((await turnsOnDisk(sessionId)).size).toBe(0);
  });

  /**
   * Either may carry an instruction — [06 §5.1], [07 §7]. A guided redo names
   * the attempt it is redoing (`redoOf`) so the model is shown it beside the
   * instruction; the words half and the draws half are independent, which is
   * what the last two tests pin.
   *
   * Scripted with distinct outputs, because a redo's *input* is the original's
   * and only the outputs can tell the attempt apart from the history.
   */
  describe('and either may carry an instruction — a guided redo', () => {
    const FIRST = 'First: he did not look up.';
    const SECOND = 'Second: he looked up.';

    function attemptBlocksOf(turn: Turn): { turnId: string | null; text: string }[] {
      return (turn.request?.calls ?? [])
        .flatMap((call) => call.blocks ?? [])
        .flatMap((block) =>
          block.source.kind === 'attempt'
            ? [{ turnId: block.source.turnId, text: block.text }]
            : [],
        );
    }

    function sentTo(index: number): string {
      return (provider.requests[index]?.messages ?? [])
        .map((message) => message.content)
        .join('\n');
    }

    it('carries the attempt it was told about, on the record and on the wire', async () => {
      provider.setScript([{ text: FIRST }, { text: SECOND }]);
      const sessionId = await rollingSession();
      const first = await takeTurn(sessionId, 'k1', null, `I ask about the ${KEY}.`);
      const firstId = first.body.turnId as string;
      const original = await turnOnDisk(sessionId, firstId);
      expect(original.output?.text).toBe(FIRST);

      const guided = await takeTurn(sessionId, 'k2', null, `I ask about the ${KEY}.`, {
        parentTurnId: original.parentTurnId,
        rewriteOf: firstId,
        redoOf: firstId,
        guidance: 'Make him look up.',
      });
      expect(guided.status).toBe(202);
      const redo = await turnOnDisk(sessionId, guided.body.turnId as string);

      // A sibling, rewriting: the tape replays as before, because the
      // instruction and the attempt are advisory blocks and touch no draw.
      expect(redo.parentTurnId).toBe(original.parentTurnId);
      expect(redo.tape.length).toBeGreaterThan(0);
      expect(redo.tape.every((draw) => draw.replayed)).toBe(true);

      // **On the record**: one attempt block, naming the turn, advisory,
      // wrapped rather than bare. The falsifying mutations are forgetting the
      // runner's spread (no block), reading the wrong turn (wrong id), and
      // dropping the wrapper (bare prose as a system message).
      const blocks = (redo.request?.calls ?? []).flatMap((call) => call.blocks ?? []);
      const attempt = blocks.filter((block) => block.source.kind === 'attempt');
      expect(attempt).toHaveLength(1);
      expect(attempt[0]?.source).toEqual({ kind: 'attempt', turnId: firstId });
      expect(attempt[0]?.id).toBe('se.attempt');
      expect(attempt[0]?.advisory).toBe(true);
      expect(attempt[0]?.included).toBe(true);
      expect(attempt[0]?.role).toBe('system');
      expect(attempt[0]?.text).toContain(FIRST);
      expect(attempt[0]?.text).not.toBe(FIRST);
      // And the instruction beside it, in its own block.
      expect(blocks.find((block) => block.source.kind === 'guidance')?.text).toBe(
        'Make him look up.',
      );

      // **On the wire**: the provider was handed the attempt, attributed to
      // its block — by block id, since a merged message still says which
      // blocks it came from.
      expect(
        provider.requests[1]?.messages.some((message) => message.fromBlocks.includes('se.attempt')),
      ).toBe(true);
      expect(sentTo(1)).toContain(FIRST);
    });

    it('keeps the attempt out of the history the next turn assembles from', async () => {
      provider.setScript([{ text: FIRST }, { text: SECOND }, { text: 'Third: he left.' }]);
      const sessionId = await rollingSession();
      const first = await takeTurn(sessionId, 'k1', null, `I ask about the ${KEY}.`);
      const original = await turnOnDisk(sessionId, first.body.turnId as string);

      const guided = await takeTurn(sessionId, 'k2', null, `I ask about the ${KEY}.`, {
        parentTurnId: original.parentTurnId,
        redoOf: original.id,
        guidance: 'Make him look up.',
      });
      const redoId = guided.body.turnId as string;

      // A child of the redo, on the line it made — the head followed it.
      const next = await takeTurn(sessionId, 'k3', redoId, 'I wait.');
      const child = await turnOnDisk(sessionId, next.body.turnId as string);

      expect(attemptBlocksOf(child)).toEqual([]);
      const corpus = JSON.stringify(
        (child.request?.calls ?? []).flatMap((call) => call.blocks ?? []),
      );
      // The redo itself is in the history — the guard against a vacuous pass —
      // and neither the attempt it was shown nor the wrapper's framing is.
      expect(corpus).toContain(SECOND);
      expect(corpus).not.toContain(FIRST);
      expect(corpus).not.toContain('previous attempt');
      expect(sentTo(2)).toContain(SECOND);
      expect(sentTo(2)).not.toContain(FIRST);
    });

    it('shows nothing on a plain redo, and the record says the slot was empty', async () => {
      provider.setScript([{ text: FIRST }, { text: SECOND }]);
      const sessionId = await rollingSession();
      const first = await takeTurn(sessionId, 'k1', null, `I ask about the ${KEY}.`);
      const original = await turnOnDisk(sessionId, first.body.turnId as string);

      const plain = await takeTurn(sessionId, 'k2', null, `I ask about the ${KEY}.`, {
        parentTurnId: original.parentTurnId,
        rewriteOf: original.id,
      });
      const redo = await turnOnDisk(sessionId, plain.body.turnId as string);

      // A plain redo is *same setup, different words* ([19 §14.6]): the model
      // is not shown a reply it might then avoid or copy. The route inventing
      // `redoOf` from `rewriteOf` is the mutation, and it fills the slot.
      expect(attemptBlocksOf(redo)).toEqual([]);
      expect(sentTo(1)).not.toContain(FIRST);
      expect(redo.request?.calls[0]?.notFilled).toContainEqual({
        blockId: 'se.attempt',
        source: 'attempt',
        reason: 'empty-source',
      });
    });

    it('draws fresh on a guided reroll, which is redoOf without rewriteOf', async () => {
      provider.setScript([{ text: FIRST }, { text: SECOND }]);
      const sessionId = await rollingSession();
      const first = await takeTurn(sessionId, 'k1', null, `I ask about the ${KEY}.`);
      const original = await turnOnDisk(sessionId, first.body.turnId as string);
      expect(original.tape.length).toBeGreaterThan(0);

      const guided = await takeTurn(sessionId, 'k2', null, `I ask about the ${KEY}.`, {
        parentTurnId: original.parentTurnId,
        redoOf: original.id,
        guidance: 'Not him.',
      });
      const reroll = await turnOnDisk(sessionId, guided.body.turnId as string);

      // The words half must not smuggle in the draws half: deriving the tape
      // from `redoOf` is the mutation.
      expect(reroll.tape.length).toBeGreaterThan(0);
      expect(reroll.tape.every((draw) => !draw.replayed)).toBe(true);
      expect(attemptBlocksOf(reroll).map((block) => block.turnId)).toEqual([original.id]);
    });

    it('refuses to show an attempt that is not in this session', async () => {
      const sessionId = await rollingSession();
      const elsewhere = await createSession('Another city');
      const theirs = await takeTurn(elsewhere, 'k1', null, 'Elsewhere entirely.');

      const refused = await server.request({
        method: 'POST',
        url: `/api/sessions/${sessionId}/turns`,
        payload: {
          idempotencyKey: 'k2',
          headTurnId: null,
          redoOf: theirs.body.turnId as string,
          guidance: 'Again, but here.',
          input: { text: 'I ask again.' },
        },
      });

      // The words are read from this server's record, and only from this
      // session's — the same boundary the tape has. Skipping the read is the
      // mutation: the turn would then run with an empty attempt and a 202.
      expect(refused.status).toBe(404);
      expect(refused.body.error).toBe('no-such-turn');
      expect((await turnsOnDisk(sessionId)).size).toBe(0);
    });
  });
});
