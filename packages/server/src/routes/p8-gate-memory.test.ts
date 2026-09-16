// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, uuidv7, type Turn } from '@storyengine/shared';

import { AdvisoryLeakError, assemble } from '../assembly/assemble.js';
import { collectCandidates } from '../assembly/collect.js';
import { ensureMemoryBook, memoryBookFor } from '../memory/books.js';
import { rememberThis } from '../memory/capture.js';
import type { SessionMemoryConfig } from '../memory/config.js';
import { retrieve } from '../retrieval/retrieve.js';
import { Rng } from '../rng/rng.js';
import { seededSource } from '../rng/source.js';
import { appendTurnToSession, readSession, setMemoryConfig } from '../sessions/store.js';
import { TEST_PRESET } from '../test-mode.js';
import { callPurposeFor, type StepDefinition } from '../turns/steps.js';
import { resolveLore } from '../turns/lore.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***Four combinations, four outcomes, and the block says where it came from*** —
 * [P8.4]'s proof obligation.
 *
 * *`TEST_PRESET` rather than a shipped mode's pack*, and not by preference:
 * `tools/repo-shape.test.ts` holds [P7.0]'s exit condition that **the engine
 * imports no mode from anywhere in its source**, and a test under
 * `packages/server/src` is engine source. The test mode's pack positions the
 * same two lore slots, which is all this file needs of a preset.
 *
 * **[08 §4](../../../../docs/design/08-cross-session-memory.md) enumerates the
 * four and says why they are two controls rather than one:** on/on is a
 * continuing relationship, **off/on** is *"an experiment — learns from history
 * without polluting it"*, on/off is *"a fresh start that still becomes canon
 * going forward"*, and off/off is *"a sealed alternate universe"*. Each is a
 * thing somebody wants, so each has to actually happen.
 *
 * ***All four run through one predicate***, which is what makes this a claim
 * about `admits()` rather than about four code paths that happen to agree today.
 *
 * ---
 *
 * ***And the second half is the expensive one*** — [P8 §1.6], [P8 §3.1] row 7.
 *
 * *"A memory block never reaches an effect-producing call"* looks like a
 * property that already exists: `admit()` throws rather than filtering, and
 * [testing §1](../../../../docs/design/workplan/03-testing.md) has carried it
 * since P2 with guidance as its first consumer. **But as written the row cannot
 * fail for the wrong reason** — nothing on the lore path was advisory, so a test
 * written before this stage would pass over a block that was never marked. §3.1
 * says the assertion has to be *the memory block **is** advisory* **and** *the
 * call refuses it*, or it asserts nothing. Both are below, in that order.
 *
 * **The purpose is derived rather than named.** `callPurposeFor` over a step
 * with a non-empty `writes` is what produces `'effects'`, which is the clause
 * that makes the refusal structural: a step that could pass its own purpose
 * would be one honest declaration away from walking a memory into a verdict.
 */

const PASSWORD = 'correct horse battery';

let dataDir: string;
let server: TestServer;
let vera: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-p8-memory-'));
  server = await makeTestServer({ dataDir });
  await setUpAdmin(server, 'ned', PASSWORD);

  const actor = newActor('Vera');
  await server.request({ method: 'POST', url: '/api/library/actors', payload: actor });
  vera = actor.id;
});

afterEach(async () => {
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

async function aSession(name: string): Promise<string> {
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name, cast: { persona: null, actors: [vera] } },
  });
  return created.body.session.id as string;
}

/** A turn to remember, on a session. */
async function aTurn(sessionId: string): Promise<string> {
  const session = await readSession(server.services.sessions, 'ned', sessionId);
  const turn: Turn = {
    id: uuidv7(),
    sessionId,
    parentTurnId: session?.headTurnId ?? null,
    createdAt: new Date().toISOString(),
    status: 'complete',
    input: { actorId: null, kind: 'do', text: 'She waited.', raw: 'She waited.' },
    output: { text: 'The ferryman took her coin.' },
    effects: [],
    tape: [],
  };
  await appendTurnToSession(server.services.sessions, 'ned', sessionId, turn);
  return turn.id;
}

async function configure(sessionId: string, over: Partial<SessionMemoryConfig>): Promise<void> {
  await setMemoryConfig(server.services.sessions, 'ned', sessionId, {
    share: true,
    intake: true,
    associations: {},
    acrossPersonas: false,
    ...over,
  });
}

/** What a session's resolver admits, as entry contents. */
async function memoriesReaching(sessionId: string): Promise<string[]> {
  const session = await readSession(server.services.sessions, 'ned', sessionId);
  const resolved = resolveLore(server.services.library, 'ned', session);
  return resolved.books
    .filter((book) => book.by === 'memory')
    .flatMap((book) => book.book.entries.map((entry) => entry.content));
}

describe('the four combinations each do what the table says', () => {
  it('on and on: a continuing relationship', async () => {
    const first = await aSession('One');
    const written = await rememberThis(
      server.services.sessions,
      server.services.library,
      'ned',
      first,
      { turnId: await aTurn(first), actorId: vera, text: 'He takes coin.', keys: ['ferryman'] },
    );
    expect(written.kind).toBe('captured');

    const second = await aSession('Two');
    expect(await memoriesReaching(second)).toEqual(['He takes coin.']);
  });

  it('share off, intake on: an experiment that learns without polluting', async () => {
    const first = await aSession('One');
    await rememberThis(server.services.sessions, server.services.library, 'ned', first, {
      turnId: await aTurn(first),
      actorId: vera,
      text: 'He takes coin.',
      keys: ['ferryman'],
    });

    const experiment = await aSession('Experiment');
    await configure(experiment, { share: false });

    // Reads history…
    expect(await memoriesReaching(experiment)).toEqual(['He takes coin.']);

    // …and refuses to add to it, with the reason rather than silently.
    const refused = await rememberThis(
      server.services.sessions,
      server.services.library,
      'ned',
      experiment,
      {
        turnId: await aTurn(experiment),
        actorId: vera,
        text: 'She did not pay.',
        keys: ['coin'],
      },
    );
    expect(refused.kind).toBe('refused');
    expect(
      memoryBookFor(server.services.library, 'ned', { actor: vera, persona: null })?.book.entries,
    ).toHaveLength(1);
  });

  it('share on, intake off: a fresh start that still becomes canon', async () => {
    const first = await aSession('One');
    await rememberThis(server.services.sessions, server.services.library, 'ned', first, {
      turnId: await aTurn(first),
      actorId: vera,
      text: 'He takes coin.',
      keys: ['ferryman'],
    });

    const fresh = await aSession('Fresh');
    await configure(fresh, { intake: false });

    expect(await memoriesReaching(fresh)).toEqual([]);

    const written = await rememberThis(
      server.services.sessions,
      server.services.library,
      'ned',
      fresh,
      { turnId: await aTurn(fresh), actorId: vera, text: 'She did not pay.', keys: ['coin'] },
    );
    expect(written.kind).toBe('captured');
    // It became canon: the next ordinary session reads both.
    const third = await aSession('Three');
    expect((await memoriesReaching(third)).toSorted()).toEqual([
      'He takes coin.',
      'She did not pay.',
    ]);
  });

  it('both off: a sealed alternate universe', async () => {
    const first = await aSession('One');
    await rememberThis(server.services.sessions, server.services.library, 'ned', first, {
      turnId: await aTurn(first),
      actorId: vera,
      text: 'He takes coin.',
      keys: ['ferryman'],
    });

    const sealed = await aSession('Sealed');
    await configure(sealed, { share: false, intake: false });

    expect(await memoriesReaching(sealed)).toEqual([]);
    expect(
      (
        await rememberThis(server.services.sessions, server.services.library, 'ned', sealed, {
          turnId: await aTurn(sealed),
          actorId: vera,
          text: 'She did not pay.',
          keys: ['coin'],
        })
      ).kind,
    ).toBe('refused');
  });

  /**
   * ***The tri-state, which is the control [08 §4] says a boolean cannot
   * express*** — *"exclude this one specific session despite intake being on"*,
   * and its mirror: pull one in despite intake being off. **Manual association
   * overrides the toggles in both directions**, per the requirement.
   */
  it('overrides the toggles in both directions', async () => {
    const one = await aSession('One');
    const two = await aSession('Two');
    for (const [session, text] of [
      [one, 'He takes coin.'],
      [two, 'She did not pay.'],
    ] as const) {
      await rememberThis(server.services.sessions, server.services.library, 'ned', session, {
        turnId: await aTurn(session),
        actorId: vera,
        text,
        keys: ['ferryman'],
      });
    }

    const reader = await aSession('Reader');

    // Intake on, one session excluded.
    await configure(reader, { associations: { [two]: 'never' } });
    expect(await memoriesReaching(reader)).toEqual(['He takes coin.']);

    // Intake off, one session pulled in anyway.
    await configure(reader, { intake: false, associations: { [two]: 'always' } });
    expect(await memoriesReaching(reader)).toEqual(['She did not pay.']);
  });

  /**
   * [08 §3]'s *per persona by default*, and gate step 5: *"the same actor with a
   * different persona recalls nothing, until the widening setting is on."*
   * **The compounding half is in the resolver, not in the switch**, which is why
   * both halves are asserted here rather than through the panel.
   */
  it('keeps two personas apart until the widening setting says otherwise', async () => {
    await ensureMemoryBook(
      server.services.library,
      'ned',
      { actor: vera, persona: 'persona-1' },
      { actor: 'Vera', persona: 'Kestrel' },
    );
    const withPersona = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Other persona', cast: { persona: 'persona-2', actors: [vera] } },
    });
    const other = withPersona.body.session.id as string;
    const session = await readSession(server.services.sessions, 'ned', other);
    expect(
      resolveLore(server.services.library, 'ned', session).books.filter(
        (book) => book.by === 'memory',
      ),
    ).toEqual([]);

    await configure(other, { acrossPersonas: true });
    const widened = await readSession(server.services.sessions, 'ned', other);
    // ***And with the setting on, the other persona's book is in play.*** The
    // widening is one predicate in the resolver, which is where §3.1 says the
    // compounding half lives — *"not in the switch"*.
    expect(
      resolveLore(server.services.library, 'ned', widened)
        .books.filter((book) => book.by === 'memory')
        .map((book) => book.book.name),
    ).toEqual(['Memories — Vera (with Kestrel)']);
  });
});

describe('a memory block says where it came from, and never reaches a verdict', () => {
  /**
   * ***Both halves, in order*** — [P8 §3.1] row 7. The first is what this stage
   * had to build (nothing on the lore path could be advisory); the second is the
   * property that has existed since P2 and had only one consumer.
   */
  it('is advisory and carries its book, and an effects call refuses it', async () => {
    const first = await aSession('One');
    await rememberThis(server.services.sessions, server.services.library, 'ned', first, {
      turnId: await aTurn(first),
      actorId: vera,
      text: 'The ferryman takes coin, not names.',
      keys: ['ferryman'],
    });

    const second = await aSession('Two');
    const session = await readSession(server.services.sessions, 'ned', second);
    const lore = resolveLore(server.services.library, 'ned', session);

    const retrieved = retrieve({
      lore,
      preset: TEST_PRESET,
      history: [],
      input: { text: 'She asked the ferryman for passage.' },
      channels: {},
      persona: null,
      actors: [],
      callKind: 'narrate',
      rng: new Rng({ source: seededSource(8) }),
    });
    expect(retrieved.blocks.length, 'the memory activated at all').toBeGreaterThan(0);

    const { candidates } = collectCandidates({
      preset: TEST_PRESET,
      callKind: 'narrate',
      history: [],
      persona: null,
      actors: [],
      channels: {},
      lore: retrieved.blocks,
    });
    const memory = candidates.find(
      (one) => one.source.kind === 'lore' && one.text.includes('ferryman takes coin'),
    );

    // **The block says where it came from** — the demo's second half, and the
    // field `retrieval/blocks.ts` was dropping.
    expect(memory?.source).toMatchObject({ kind: 'lore', bookId: expect.any(String) });
    expect(
      memory?.source.kind === 'lore' ? memory.source.bookId : null,
      'the book a reader can open to find the origin session',
    ).toBe(memoryBookFor(server.services.library, 'ned', { actor: vera, persona: null })?.id);

    // **And it is advisory**, which is the half §3.1 says the row cannot pass
    // without: before this stage a candidate from a memory book and one from an
    // authored book were indistinguishable to the firewall.
    expect(memory?.advisory).toBe(true);

    /**
     * **And the call refuses it.** The purpose is *derived* from a step that
     * writes, rather than named here — which is the clause that makes the
     * refusal structural rather than remembered.
     */
    const writes: StepDefinition = {
      id: 'se.test.judge',
      stage: 'post',
      reads: [],
      writes: ['se.trust'],
      callKind: 'judge',
      when: { when: 'cadence', everyNTurns: 1 },
      failure: 'warn',
      role: 'prose',
    };
    const purpose = callPurposeFor(writes);
    expect(purpose).toBe('effects');

    expect(() =>
      assemble({
        candidates,
        purpose,
        policy: { limit: { tokens: 100_000, ceiling: 100_000, source: 'user' }, reserved: 0 },
      }),
    ).toThrow(AdvisoryLeakError);

    // The control [P7.13] asks for: the same candidates in a prose call are
    // admitted, so the throw above is about the purpose and not about the
    // assembly failing for some other reason.
    expect(() =>
      assemble({
        candidates,
        purpose: 'prose',
        policy: { limit: { tokens: 100_000, ceiling: 100_000, source: 'user' }, reserved: 0 },
      }),
    ).not.toThrow();
  });
});
