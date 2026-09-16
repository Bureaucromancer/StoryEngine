// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { Layout } from '../storage/layout.js';
import { walkPath } from './segments.js';
import { appendTurnOnly, createSession, readTurns, type SessionContext } from './store.js';
import { ensureChain, listSummaries, readSummary, type Summariser } from './summaries.js';
import {
  linkKeyOf,
  planChain,
  summariserKey,
  unitKeyOf,
  type SummaryPolicy,
} from './summary-chain.js';
import type { Turn } from './types.js';

/**
 * ***Summaries shared across a fork are byte-identical to the parent's*** —
 * [testing §1](../../../../docs/design/workplan/03-testing.md)'s waiting row
 * getting its first producer, and [P8.0]'s proof obligation.
 *
 * **The row has been waiting since it was written, and a row with no producer
 * is a claim nobody has checked.** What makes it checkable is
 * [07 §5.1](../../../../docs/design/07-branching.md)'s content addressing, and
 * what makes *checking* it worth anything is the second arm below.
 *
 * ---
 *
 * ***One arm alone is satisfiable by a bug, which is why this file is a pair.***
 * [P8 §1.9] is explicit: *"summaries shared across a fork are byte-identical to
 * the parent's* is trivially true of a cache keyed on too little. It is a real
 * assertion only with its converse beside it — **the same turns under a
 * different summariser produce a different key**."* A chain keyed on nothing at
 * all would pass the first arm perfectly, share every link with every fork, and
 * hand every session the same summary.
 *
 * **The falsifying mutation, stated so a later reader can re-run it:** delete
 * `summariser` from `unitKeyOf` and `linkKeyOf` in `summary-chain.ts`. The
 * sharing arms stay green and *a different summariser is a different chain*
 * goes red. That is the pair doing its job, and it was run before this file was
 * committed.
 *
 * ---
 *
 * ***Synthesised is the honest word*** ([P8 §0.2], [P8 §3.1]). Nothing in this
 * project has ever played four hundred turns — `tools/seed.mjs` writes a
 * treatment, a lorebook and a session and no turns at all — so the tree below is
 * scripted through `appendTurnOnly` and **it tests the chain, not the summary.**
 * Scripted output can prove that keys are shared and files are not duplicated;
 * it cannot prove that a summary of four hundred real turns is worth reading.
 * That second question is PLAYABLE's, and under
 * [manual testing §0](../../../../docs/design/workplan/05-manual-testing.md)'s
 * clause (iii) it is a deferral rather than a check.
 *
 * *The pure half runs over `fast-check`-generated shapes and needs no disk at
 * all*, which is the dividend of keeping `summary-chain.ts` free of I/O: the
 * property that matters is a statement about values, so it is asserted over
 * values rather than over a temporary directory.
 */

const ACCOUNT = 'ned';
const POLICY: SummaryPolicy = { span: 20, window: 20 };

let dataDir: string;
let index: OpenedIndex;
let context: SessionContext;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-summary-chain-'));
  index = await openIndex({ path: ':memory:' });
  context = {
    layout: new Layout(dataDir),
    index: index.db,
    snapshotEvery: () => 10,
  };
});

afterEach(async () => {
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

/**
 * A deterministic summariser, which is what makes byte-identity assertable.
 *
 * **A real one is a model call and a model call is not a function**, so a test
 * that used one could assert that keys are shared and never that files are. The
 * interface exists for exactly this reason — [P8.0] is pure engine, and
 * `summaries.ts` says why the model-backed implementation waits for P8.1.
 *
 * `calls` is the instrumentation [P8 §1.3]'s procedure asks for, read here as
 * the assertion *a warm chain derives nothing*.
 */
function scriptedSummariser(identity: string): Summariser & { calls: number } {
  return {
    key: identity,
    calls: 0,
    run(input) {
      this.calls += 1;
      const said = input.units.map((unit) => unit.text).join(' ');
      return Promise.resolve(`[${identity}] ${input.previous ?? '-'} :: ${said}`);
    },
  };
}

/**
 * A turn with words in it and nothing else — the chain reads `input` and
 * `output`.
 *
 * **A fresh `uuidv7` every time, deliberately.** Two calls with the same `at`
 * produce the same words under different ids, so every assertion that two keys
 * match is also an assertion that the id did not reach the key.
 */
function turnOf(sessionId: string, parentTurnId: string | null, at: number, line = ''): Turn {
  const id = uuidv7();
  const said = `turn ${String(at)}${line}`;
  return {
    id,
    sessionId,
    parentTurnId,
    createdAt: new Date(Date.UTC(2026, 8, 2, 0, at)).toISOString(),
    status: 'complete',
    input: { actorId: null, kind: 'say', text: said, raw: said },
    output: { text: `and then, at ${said}, something happened` },
    effects: [],
    tape: [],
  };
}

/** A line of turns in memory, with no store underneath it. */
function aLine(count: number, from: readonly Turn[] = [], line = ''): Turn[] {
  const path = [...from];
  for (let at = path.length; at < count; at += 1) {
    path.push(turnOf('in-memory', path.at(-1)?.id ?? null, at, line));
  }
  return path;
}

describe('the chain shares a prefix by construction', () => {
  /**
   * The floor `route-callers.test.ts` and `page-column.test.ts` both carry, for
   * their reason: a generator that produced nothing would make every assertion
   * below vacuously true, and a policy whose window swallowed every tree would
   * do it silently.
   */
  it('plans links at all, so a chain that covered nothing could not pass', () => {
    const planned = planChain(aLine(100), 'S', POLICY);
    expect(planned.length).toBe(4);
    expect(planned.every((link) => link.complete)).toBe(true);
    expect(planned[0]?.previousKey).toBeNull();
    expect(planned[1]?.previousKey).toBe(planned[0]?.key);

    /**
     * And the other half of non-vacuity: two lines that genuinely diverge
     * diverge in the keys. The property above asserts that a shared prefix is
     * shared; without this, a `planChain` that returned one constant key per
     * position would satisfy it.
     */
    const prefix = aLine(60);
    const left = planChain(aLine(100, prefix, ' (left)'), 'S', POLICY).map((one) => one.key);
    const right = planChain(aLine(100, prefix, ' (right)'), 'S', POLICY).map((one) => one.key);
    // Four links over eighty covered turns; the first three lie inside the
    // sixty shared ones and the fourth is where the lines part.
    expect(left).toHaveLength(4);
    expect(left.slice(0, 3)).toEqual(right.slice(0, 3));
    expect(left[3]).not.toBe(right[3]);
  });

  it('covers nothing inside the window, whatever the path length', () => {
    fc.assert(
      fc.property(fc.nat({ max: 40 }), (length) => {
        const planned = planChain(aLine(length), 'S', POLICY);
        const covered = planned.reduce((count, link) => count + (link.to - link.from + 1), 0);
        expect(covered).toBe(Math.max(0, length - POLICY.window));
      }),
    );
  });

  /**
   * The parent's links, key for key, over the turns two lines genuinely share.
   *
   * The generated shape is *where the fork is* and *how far each line ran
   * afterwards*, because those are the two things that could move a boundary. A
   * fork is a sibling inside the same session, so the shared prefix has
   * identical depth indices — the property is a consequence of anchoring
   * boundaries to the root, and this is the assertion that anchoring is what
   * `planChain` actually does.
   */
  it('resolves the same keys over the shared prefix, wherever the fork is', () => {
    fc.assert(
      fc.property(
        fc.record({
          shared: fc.integer({ min: 21, max: 200 }),
          left: fc.nat({ max: 80 }),
          right: fc.nat({ max: 80 }),
        }),
        ({ shared, left, right }) => {
          const prefix = aLine(shared);
          const a = aLine(shared + left, prefix, ' (left)');
          const b = aLine(shared + right, prefix, ' (right)');
          // Both lines continue from the same node, so the sibling turns differ
          // by id and by text and the shared ones are the same objects.
          expect(a.slice(0, shared)).toEqual(b.slice(0, shared));

          const keysA = planChain(a, 'S', POLICY).map((link) => link.key);
          const keysB = planChain(b, 'S', POLICY).map((link) => link.key);

          /**
           * ***A link is shared when it is complete on both lines and lies
           * below the fork*** — and the middle clause is a finding rather than
           * bookkeeping. The obvious oracle is *every link whose last index is
           * below the fork*, and it is wrong: the window truncates whichever
           * link is last on each line, so a line that has barely outgrown its
           * window holds a **partial** link over indices a longer line covers in
           * full. Same indices, different unit lists, different keys — correctly
           * so. Sharing is a property of the inputs a link declares, not of
           * where its turns sit.
           */
          const coverable = (path: readonly Turn[]): number =>
            Math.max(0, path.length - POLICY.window);
          const sharedLinks = Math.floor(
            Math.min(shared, coverable(a), coverable(b)) / POLICY.span,
          );
          const bothHave = Math.min(keysA.length, keysB.length, sharedLinks);
          expect(keysA.slice(0, bothHave)).toEqual(keysB.slice(0, bothHave));
        },
      ),
    );
  });

  /**
   * ***The converse, and the reason this file is a pair.*** Without it the arm
   * above is satisfiable by a cache keyed on too little — see the header.
   */
  it('gives the same turns under a different summariser a different key', () => {
    fc.assert(
      fc.property(fc.integer({ min: 21, max: 200 }), (length) => {
        const path = aLine(length);
        const one = new Set(planChain(path, 'summariser-one', POLICY).map((link) => link.key));
        const other = new Set(planChain(path, 'summariser-two', POLICY).map((link) => link.key));

        expect(one.size).toBeGreaterThan(0);
        expect([...one].filter((key) => other.has(key))).toEqual([]);
      }),
    );
  });

  /**
   * A resolved binding is the identity, not the declared role — [P8 §1.9]'s
   * third bullet. A session's `stepRoles` send the same role to different
   * models, so a key over the role would collide across exactly the sessions the
   * feature exists to keep apart.
   */
  it('reads the whole resolved binding, so one model is not another', () => {
    const prompt = 'Summarise what happened.';
    const here = summariserKey({ connectionId: 'c1', modelId: 'm1' }, prompt, { temperature: 0 });
    expect(summariserKey({ connectionId: 'c1', modelId: 'm1' }, prompt, { temperature: 0 })).toBe(
      here,
    );
    expect(
      summariserKey({ connectionId: 'c2', modelId: 'm1' }, prompt, { temperature: 0 }),
    ).not.toBe(here);
    expect(
      summariserKey({ connectionId: 'c1', modelId: 'm2' }, prompt, { temperature: 0 }),
    ).not.toBe(here);
    expect(
      summariserKey({ connectionId: 'c1', modelId: 'm1' }, 'Other.', { temperature: 0 }),
    ).not.toBe(here);
    expect(
      summariserKey({ connectionId: 'c1', modelId: 'm1' }, prompt, { temperature: 1 }),
    ).not.toBe(here);
  });

  /**
   * **The in-progress link freezes for free**, which is a property rather than a
   * convenience: a partial link's key is its unit list, so when the list reaches
   * a full span it *is* the complete link's list and the key already matches.
   * Had `complete` been folded into the key, every link would have been derived
   * twice — once while growing and once on freezing — and nothing would have
   * said so.
   */
  it('arrives at the frozen key rather than being given a second one', () => {
    const growing = planChain(aLine(35), 'S', POLICY).at(-1);
    const frozen = planChain(aLine(40), 'S', POLICY).at(-1);
    expect(growing?.complete).toBe(false);
    expect(frozen?.complete).toBe(true);
    // Different unit lists, so different keys — a partial link is not a frozen
    // one wearing a flag.
    expect(growing?.key).not.toBe(frozen?.key);

    /**
     * ***And the freezing itself is free.*** The first link of a forty-turn path
     * is complete; the first link of a hundred-turn path covers the same twenty
     * indices. Same units, therefore the same key — **the growing link arrives
     * at the key it would have been given**, so nothing is derived twice. Had
     * `complete` or the path's length reached the key, this would be two files.
     */
    const short = planChain(aLine(40), 'S', POLICY)[0];
    const long = planChain(aLine(100), 'S', POLICY)[0];
    expect(short?.complete).toBe(true);
    expect(short?.key).toBe(long?.key);
  });

  /** A unit is keyed by content and never by the id — [P8 §1.9]'s first bullet. */
  it('keys a unit by what it says, not by which node said it', () => {
    const one = turnOf('s', null, 1);
    const twin = { ...one, id: uuidv7(), createdAt: new Date().toISOString() };
    const other = { ...one, output: { text: 'something else entirely' } };

    expect(unitKeyOf('S', twin)).toBe(unitKeyOf('S', one));
    expect(unitKeyOf('S', other)).not.toBe(unitKeyOf('S', one));
  });

  /** A link is keyed by its unit keys and never by prose — the second bullet. */
  it('keys a link by its units, so a re-summarise is a cheap pass over keys', () => {
    const units = ['u1', 'u2', 'u3'];
    expect(linkKeyOf('S', null, units)).toBe(linkKeyOf('S', null, units));
    expect(linkKeyOf('S', 'p', units)).not.toBe(linkKeyOf('S', null, units));
    expect(linkKeyOf('S', null, ['u1', 'u2'])).not.toBe(linkKeyOf('S', null, units));
    // Length-prefixed, so a boundary cannot be moved without changing the key.
    expect(linkKeyOf('S', null, ['u1u2', 'u3'])).not.toBe(linkKeyOf('S', null, ['u1', 'u2u3']));
  });
});

describe('a synthesised four-hundred-turn tree, forked at three hundred', () => {
  /**
   * The tree is built through `appendTurnOnly` — the store's own write path with
   * no head advance, which is what `snapshots.test.ts` uses and for its reason:
   * this file is about a read path, and folding each turn as it lands would make
   * the thing under test unnecessary.
   */
  async function aTree(): Promise<{ sessionId: string; left: string; right: string }> {
    const session = await createSession(context, ACCOUNT, 'Rain City');
    let parent: string | null = null;
    let forkParent: string | null = null;

    for (let at = 0; at < 400; at += 1) {
      const turn = turnOf(session.id, parent, at);
      await appendTurnOnly(context, ACCOUNT, session.id, turn);
      parent = turn.id;
      if (at === 299) forkParent = turn.id;
    }

    let sibling: string | null = forkParent;
    for (let at = 0; at < 50; at += 1) {
      const turn = turnOf(session.id, sibling, 1000 + at);
      await appendTurnOnly(context, ACCOUNT, session.id, turn);
      sibling = turn.id;
    }

    if (parent === null || sibling === null) throw new Error('the tree grew no heads');
    return { sessionId: session.id, left: parent, right: sibling };
  }

  it('shares the files rather than copying them', async () => {
    const { sessionId, left, right } = await aTree();
    const turns = await readTurns(context, ACCOUNT, sessionId);
    const a = walkPath(turns, left);
    const b = walkPath(turns, right);
    expect(a).toHaveLength(400);
    expect(b).toHaveLength(350);

    const summariser = scriptedSummariser('the-only-one');
    const first = await ensureChain(context.layout, ACCOUNT, sessionId, a, summariser, POLICY);
    const second = await ensureChain(context.layout, ACCOUNT, sessionId, b, summariser, POLICY);

    // 400 - 20 windowed = 380 covered, at a span of 20: nineteen links.
    expect(first.links).toHaveLength(19);
    expect(first.derived).toBe(19);

    // 350 - 20 = 330: sixteen complete links and one still in progress.
    expect(second.links).toHaveLength(17);
    // Fifteen links lie entirely below turn 300 and are read, not recomputed.
    expect(second.derived).toBe(2);

    /**
     * ***The sharpest form of the claim.*** Nineteen links plus seventeen is
     * thirty-six; the directory holds twenty-one, because fifteen of them are
     * one file each rather than two. *Shared, not copied* — asserted by
     * counting, which is the one way to say it that a cache keyed on too little
     * could not also satisfy.
     */
    expect((await listSummaries(context.layout, ACCOUNT, sessionId)).size).toBe(21);

    const sharedKeys = first.links.slice(0, 15).map((link) => link.key);
    expect(second.links.slice(0, 15).map((link) => link.key)).toEqual(sharedKeys);
    expect(second.links[15]?.key).not.toBe(first.links[15]?.key);
    // And the shared ones are the parent's own bytes, not a second derivation
    // that happened to agree: the scripted summariser was never asked for them.
    expect(summariser.calls).toBe(21);
  });

  it('derives nothing on a second pass over the same line', async () => {
    const { sessionId, left } = await aTree();
    const a = walkPath(await readTurns(context, ACCOUNT, sessionId), left);

    const summariser = scriptedSummariser('the-only-one');
    await ensureChain(context.layout, ACCOUNT, sessionId, a, summariser, POLICY);
    const again = await ensureChain(context.layout, ACCOUNT, sessionId, a, summariser, POLICY);

    expect(again.derived).toBe(0);
    expect(summariser.calls).toBe(19);
  });

  /**
   * [P8]'s gate step 3, and **§3.1 says the assertion is stronger than the step
   * asks**: content addressing makes regeneration byte-identical rather than
   * merely equivalent, so this is an equality and not a judgement.
   *
   * *Which is only true because a link carries no timestamp* — see
   * `SummaryLink`, where the absence is argued rather than assumed.
   */
  it('regenerates byte-identically after every summary is deleted', async () => {
    const { sessionId, left } = await aTree();
    const a = walkPath(await readTurns(context, ACCOUNT, sessionId), left);
    const summariser = scriptedSummariser('the-only-one');

    const before = await ensureChain(context.layout, ACCOUNT, sessionId, a, summariser, POLICY);
    const held = await Promise.all(
      before.links.map((link) => readSummary(context.layout, ACCOUNT, sessionId, link.key)),
    );

    await rm(join(context.layout.sessionRoot(ACCOUNT, sessionId), 'summaries'), {
      recursive: true,
      force: true,
    });
    expect((await listSummaries(context.layout, ACCOUNT, sessionId)).size).toBe(0);

    const after = await ensureChain(context.layout, ACCOUNT, sessionId, a, summariser, POLICY);
    expect(after.derived).toBe(19);
    expect(
      await Promise.all(
        after.links.map((link) => readSummary(context.layout, ACCOUNT, sessionId, link.key)),
      ),
    ).toEqual(held);
  });
});
