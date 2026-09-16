// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, uuidv7, type Lorebook, type Turn } from '@storyengine/shared';

import { read } from '../library.js';
import { walkPath } from '../sessions/segments.js';
import { appendTurnToSession, moveHead, readSession, readTurns } from '../sessions/store.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { memoryBookFor } from './books.js';
import { rememberThis } from './capture.js';
import { SE_MEMORY_WRITTEN } from './channel.js';

/**
 * ***An extraction is an escaped effect, and a hand-written memory is locked*** —
 * [P8.3]'s proof obligation in its cut form, [P8 §5].
 *
 * **[P8 §5]'s named fallback cut is what this build ships**: the chain, the
 * pipeline, the books, **manual capture** and the toggles, with the automatic
 * extractor deferred — *"that version ships the chain (the load-bearing part),
 * the books (the reuse) and the toggles, and defers the one component whose
 * value nobody can currently evidence and whose failure mode §1.5 calls
 * unforgivable."* So the obligation's two arms land against the writer that
 * exists rather than the one that does not.
 *
 * ***The escaped arm's falsifying mutation is the one §P8.3 names***: restoring
 * `scope: 'session'` in `acceptEffect` returns `abandonedBy` to counting zero,
 * which is the exact state `sessions/store.ts` documented before this phase. Run
 * before this file was committed; the first test is what goes red.
 *
 * **What this file cannot hold is C2**, and saying so is the honest half. *A
 * hand correction survives the next extraction* needs an extraction, and the cut
 * removes it — so `LoreEntry.locked` gets a **writer** here and its reader
 * arrives with the extractor. The last test pins the writer, so that obligation
 * lands on subjects that are already on disk.
 */

const PASSWORD = 'correct horse battery';

let dataDir: string;
let server: TestServer;
let sessionId: string;
let vera: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-capture-'));
  server = await makeTestServer({ dataDir });
  await setUpAdmin(server, 'ned', PASSWORD);

  const actor = newActor('Vera');
  await server.request({ method: 'POST', url: '/api/library/actors', payload: actor });
  vera = actor.id;

  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Rain City', cast: { persona: null, actors: [vera] } },
  });
  sessionId = created.body.session.id;
});

afterEach(async () => {
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

/** One turn on the session, written rather than played. */
async function aTurn(over: Partial<Turn> = {}): Promise<Turn> {
  const turn: Turn = {
    id: uuidv7(),
    sessionId,
    // The session's own head, not `walkPath(turns, null)` — which is always the
    // empty path, so a first draft of this helper made every turn a root and
    // hid the second escape behind a sibling line.
    parentTurnId: await currentHead(),
    createdAt: new Date().toISOString(),
    status: 'complete',
    input: { actorId: null, kind: 'do', text: 'She waited.', raw: 'She waited.' },
    output: { text: 'The ferryman took her coin and said nothing.' },
    effects: [],
    tape: [],
    ...over,
  };
  await appendTurnToSession(server.services.sessions, 'ned', sessionId, turn);
  return turn;
}

function capture(turnId: string, over: Partial<Parameters<typeof rememberThis>[4]> = {}) {
  return rememberThis(server.services.sessions, server.services.library, 'ned', sessionId, {
    turnId,
    actorId: vera,
    text: 'The ferryman takes coin, not names.',
    keys: ['ferryman'],
    ...over,
  });
}

describe('a memory written by hand', () => {
  it('lands in the actor’s book with its origin and its timestamp', async () => {
    const turn = await aTurn();
    const outcome = await capture(turn.id);
    expect(outcome.kind).toBe('captured');

    const book = memoryBookFor(server.services.library, 'ned', { actor: vera, persona: null });
    const entry = book?.book.entries[0];
    expect(entry?.content).toBe('The ferryman takes coin, not names.');
    expect(entry?.keys).toEqual(['ferryman']);

    /**
     * **The origin ref and the timestamp, in `metadata`** — [P8 §1.4]. The only
     * place they fit without opening a schema field
     * ([11 §4](../../../../docs/design/11-lorebooks-as-a-format.md) refuses one
     * by name), and what makes the demo's second half answerable: the workbench
     * can name the entry **and the session it came from**.
     */
    const held = entry?.metadata['se.memory'] as {
      sessionId?: string;
      turnId?: string;
      at?: string;
      by?: string;
    };
    expect(held.sessionId).toBe(sessionId);
    expect(held.turnId).toBe(turn.id);
    expect(held.by).toBe('manual');
    expect(typeof held.at).toBe('string');
  });

  /**
   * ***The escaped arm.*** [07 §7] classifies *a lorebook entry promoted to the
   * shared library* as an effect branching cannot un-write, and [P8 §1.1]'s
   * storage answer makes every memory write exactly that. P6 shipped the whole
   * mechanism and `acceptEffect` then hard-coded `'session'`, so the count was
   * structurally zero — and the mutation that falsifies this test is restoring
   * that line.
   */
  it('records an escape, so abandoning the line says what is still out there', async () => {
    const before = await aTurn();
    const fork = await aTurn();
    await capture(fork.id);

    const turns = await readTurns(server.services.sessions, 'ned', sessionId);
    const path = walkPath(turns, (await currentHead()) ?? null);
    const escaped = path.flatMap((turn) => turn.effects).filter((one) => one.scope === 'escaped');

    // One escape, on a turn of its own — the shape `writeChannel`, `undoTurn`
    // and `divergenceTurn` all write, because [03 §8.1] wants a change of state
    // visible in the turn record and a turn is what the workbench shows.
    expect(escaped).toHaveLength(1);
    expect(escaped[0]?.channelId).toBe(SE_MEMORY_WRITTEN);
    expect(escaped[0]?.applied).toBe(true);

    const book = memoryBookFor(server.services.library, 'ned', { actor: vera, persona: null });
    expect(escaped[0]?.scopeKey).toBe(book?.id);
    expect(
      (escaped[0]?.after as { entryIds: string[] }).entryIds.length,
      'the entry ids written this turn',
    ).toBe(1);

    /**
     * ***And the count the banner reports is non-zero for the first time.***
     * Rewinding to before the capture leaves the memory in the library, which is
     * the true answer — so the move says so rather than implying it went along.
     */
    const moved = await moveHead(server.services.sessions, 'ned', sessionId, before.id);
    expect(moved.kind).toBe('moved');
    if (moved.kind !== 'moved') throw new Error('the head did not move');
    expect(moved.abandoned.escapedEffects).toBe(1);
    // A control: the turns it left behind are counted too, and separately —
    // a banner that conflated them would say *two things are still out there*
    // about a rewind that wrote one memory.
    expect(moved.abandoned.turns).toBe(2);

    // And the entry is still there, which is what makes the sentence true.
    const after = read(server.services.library, 'ned', book?.id ?? '');
    expect((after.body as Lorebook).entries).toHaveLength(1);
  });

  /**
   * [08 §6]'s *never from hidden content*, at the cheap end — [P8.5], [P8 §1.5].
   * *An entrance is not a summary of an arrival, it is the finished prose of
   * one*, and a bleed reproduces the exact words a second playthrough was
   * supposed to reach freshly. A turn a hook fired on may be carrying one.
   */
  it('refuses a turn a hook fired on, and says why', async () => {
    const fired = await aTurn({
      hooks: { verdict: 'fired', pacing: 'normal', hookId: 'hook-1', considered: [] },
    });
    const outcome = await capture(fired.id);

    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('expected a refusal');
    // A reason rather than a filter: §1.5 asks for the sentence by name, and a
    // refusal with no words would be the filtering 08 §6 rejects with manners.
    expect(outcome.reason).toContain('entrance');

    // Nothing was written, which is what *at the source* means — the book does
    // not exist, rather than existing with the sentence quietly left out.
    expect(
      memoryBookFor(server.services.library, 'ned', { actor: vera, persona: null }),
    ).toBeNull();
  });

  it('refuses a character who is not in the cast, and a memory with nothing to fire on', async () => {
    const turn = await aTurn();
    expect((await capture(turn.id, { actorId: uuidv7() })).kind).toBe('not-in-cast');
    expect((await capture(turn.id, { keys: [] })).kind).toBe('empty');
    expect((await capture(turn.id, { text: '   ' })).kind).toBe('empty');
    expect((await capture(uuidv7())).kind).toBe('no-turn');
  });

  /**
   * ***`LoreEntry.locked` gets a writer, and the reader is owed*** — see the
   * header. A memory somebody typed is not a mis-extraction to be refined; it is
   * the sentence they chose, and the extractor this cut defers inherits an
   * obligation with subjects already on disk.
   */
  it('locks what a person wrote, so the extractor that arrives cannot eat it', async () => {
    const turn = await aTurn();
    await capture(turn.id);
    const book = memoryBookFor(server.services.library, 'ned', { actor: vera, persona: null });
    expect(book?.book.entries[0]?.locked).toBe(true);
  });

  /** Two captures, one book — `ensureMemoryBook`'s laziness seen from the writer. */
  it('writes both memories into one book', async () => {
    const turn = await aTurn();
    const one = await capture(turn.id);
    const two = await capture(turn.id, { text: 'She does not trust him.', keys: ['trust'] });
    expect([one.kind, two.kind]).toEqual(['captured', 'captured']);

    const book = memoryBookFor(server.services.library, 'ned', { actor: vera, persona: null });
    expect(book?.book.entries).toHaveLength(2);

    const turns = await readTurns(server.services.sessions, 'ned', sessionId);
    const escaped = walkPath(turns, await currentHead())
      .flatMap((one) => one.effects)
      .filter((one) => one.scope === 'escaped');

    /**
     * ***Two escapes, each naming what its own turn wrote*** — and not a running
     * total, which is the finding this assertion pins.
     *
     * `applyEffects` skips an escaped effect, so a channel value that tried to
     * accumulate would never be read back — and it should not: `abandonedBy`
     * counts **effects on the turns being left**, so a running total would make
     * the newest turn's value the count for the whole line, and abandoning one
     * turn would report everything the line ever wrote.
     */
    expect(escaped).toHaveLength(2);
    expect(escaped.map((one) => (one.after as { entryIds: string[] }).entryIds.length)).toEqual([
      1, 1,
    ]);
    expect(escaped.map((one) => one.scopeKey)).toEqual([book?.id, book?.id]);
  });
});

/** The session's head, off the file — the capture appends a turn and moves it. */
async function currentHead(): Promise<string | null> {
  const session = await readSession(server.services.sessions, 'ned', sessionId);
  return session?.headTurnId ?? null;
}
