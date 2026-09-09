// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  entryGate,
  newActor,
  newLorebook,
  newLoreEntry,
  uuidv7,
  type Lorebook,
  type LoreEntry,
  type Preset,
} from '@storyengine/shared';

import { SCENE_PRESET } from '../modes/scene/preset.js';
import { Rng } from '../rng/rng.js';
import { seededSource } from '../rng/source.js';
import { channelKey, SE_LORE_TIMING } from '../sessions/channels.js';
import type { ChannelState, Turn } from '../sessions/types.js';
import type { LoreSource } from '../turns/lore.js';
import { loreReport } from './blocks.js';
import { retrieve, type RetrieveContext } from './retrieve.js';

/**
 * The retrieval step end to end — [P5.6].
 *
 * The parts are tested apart in `activate`, `shelf` and `blocks`; what is only
 * visible here is the **joins**, and every one of them is a place where a
 * correct piece can be wired to the wrong thing and produce silence: which
 * messages are scanned and in which order, what `delay` counts, where the
 * counters are read from, and which of them are worth writing back.
 */

function bookOf(entries: LoreEntry[], edits: Partial<Lorebook> = {}): LoreSource {
  const book = { ...newLorebook('Rain City'), entries, ...edits };
  return { book, id: 'book-1', contentHash: 'sha256:0', required: false, by: 'session' };
}

function entryOf(name: string, edits: Partial<LoreEntry> = {}): LoreEntry {
  return { ...newLoreEntry(name), ...edits };
}

function turnOf(input: string, output: string): Turn {
  return {
    id: uuidv7(),
    parentTurnId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'ok',
    input: { actorId: null, kind: 'do', text: input, raw: input },
    output: { text: output },
    effects: [],
    steps: [],
  } as unknown as Turn;
}

function run(
  books: LoreSource[],
  edits: Partial<RetrieveContext> = {},
): ReturnType<typeof retrieve> {
  return retrieve({
    lore: { treatment: null, books, missing: [] },
    preset: SCENE_PRESET,
    history: [],
    channels: {},
    persona: null,
    actors: [],
    callKind: 'prose',
    rng: new Rng({ source: seededSource(0x9e3779b9) }),
    ...edits,
  });
}

function firedNames(result: ReturnType<typeof retrieve>): string[] {
  return result.blocks.map((one) => one.candidate.text);
}

describe('retrieve', () => {
  /**
   * The message the player just typed is not in the history yet, and it is the
   * one an entry is overwhelmingly most likely to be about. A scan that ignored
   * it would notice a name exactly one turn after it was said.
   */
  it('scans the pending input, not only the history', () => {
    const entry = entryOf('The Ferryman', {
      keys: ['ferryman'],
      content: 'He works the crossing.',
    });
    const result = run([bookOf([entry])], { input: { text: 'Ask the ferryman.' } });

    expect(firedNames(result)).toEqual(['He works the crossing.']);
  });

  it('scans the history when there is no pending input', () => {
    const entry = entryOf('The Ferryman', {
      keys: ['ferryman'],
      content: 'He works the crossing.',
    });
    const result = run([bookOf([entry])], {
      history: [turnOf('The ferryman waited.', 'She left.')],
    });

    expect(firedNames(result)).toEqual(['He works the crossing.']);
  });

  /**
   * `scanDepth` counts from the newest message, so the order is load-bearing
   * rather than cosmetic: reversed, a depth of one would search the oldest
   * message in the window instead of the newest.
   */
  it('puts the newest message first, which is what scanDepth counts from', () => {
    const shallow = entryOf('Shallow', { keys: ['ferryman'], content: 'Found.', scanDepth: 2 });
    const deep = entryOf('Deep', { keys: ['ferryman'], content: 'Found.', scanDepth: 4 });
    // Each turn contributes two strings — its output, then its input — so the
    // older turn's pair sits at depths 3 and 4.
    const older = turnOf('Nothing much.', 'The ferryman waited.');
    const newer = turnOf('Nothing at all.', 'Still nothing.');
    const history = [older, newer];

    // Depth 2 reaches only the newer turn, which does not name him.
    expect(run([bookOf([shallow])], { history }).blocks).toEqual([]);
    // Depth 4 reaches the older one, which does.
    expect(run([bookOf([deep])], { history }).blocks).toHaveLength(1);
  });

  /**
   * `delay` is a fact about the story's length, so it counts the **path** —
   * not the messages this scan happens to read, which are capped by the window
   * and inflated by the pending input. An entry told to wait twenty messages
   * must not fire on turn three.
   */
  it('counts delay against the path rather than against what it scanned', () => {
    /**
     * **The two numbers have to differ or the test proves nothing**, which is
     * how the first version of this went wrong: a delay of ten was past both,
     * so counting the wrong one gave the same answer. Two turns on the path
     * produce *five* scannable strings — two per turn plus the pending input —
     * so a delay of four is reached by one count and not the other.
     */
    const entry = entryOf('Later', { keys: ['ferryman'], content: 'Found.', delay: 4 });
    const history = [turnOf('a', 'b'), turnOf('c', 'd')];

    const result = run([bookOf([entry])], { history, input: { text: 'the ferryman' } });

    expect(result.blocks).toEqual([]);
    expect(result.scan.skipped.find((one) => one.entry.name === 'Later')?.reason).toBe('delayed');
  });

  describe('the gating filters', () => {
    it('offers the cast to an actor filter', () => {
      const vera = newActor('Vera');
      const entry = entryOf('Hers', {
        keys: ['ferryman'],
        content: 'Found.',
        actorFilter: { mode: 'include', values: [vera.id] },
      });

      const withVera = run([bookOf([entry])], {
        input: { text: 'the ferryman' },
        actors: [{ actor: vera }],
      });
      const without = run([bookOf([entry])], { input: { text: 'the ferryman' } });

      expect(withVera.blocks).toHaveLength(1);
      expect(without.blocks).toEqual([]);
    });

    it('offers the call kind to a trigger filter', () => {
      const entry = entryOf('Summaries', {
        keys: ['ferryman'],
        content: 'Found.',
        generationTriggerFilter: { mode: 'include', values: ['summarise'] },
      });

      expect(run([bookOf([entry])], { input: { text: 'x ferryman' } }).blocks).toEqual([]);
      expect(
        run([bookOf([entry])], { input: { text: 'x ferryman' }, callKind: 'summarise' }).blocks,
      ).toHaveLength(1);
    });
  });

  describe('the named sources', () => {
    it('offers the persona under a name an entry can ask for', () => {
      const inspector = newActor('The Inspector');
      inspector.profile.sections = [
        { id: 'a', title: 'Background', body: 'Once a ferryman.', disposition: 'always' },
      ] as never;
      const entry = entryOf('From the persona', {
        keys: ['ferryman'],
        content: 'Found.',
        additionalMatchingSources: ['persona'],
      });

      const result = run([bookOf([entry])], { persona: { actor: inspector } });

      expect(result.blocks).toHaveLength(1);
      expect(result.scan.unknownSources).toEqual([]);
    });

    /**
     * The supplied set is small and knowable on purpose: a name nobody
     * recognises has to surface as a question rather than as an entry that
     * quietly never fires.
     */
    it('reports a source name it does not supply', () => {
      const entry = entryOf('Elsewhere', {
        keys: ['ferryman'],
        content: 'Found.',
        additionalMatchingSources: ['the-moon'],
      });

      expect(run([bookOf([entry])]).scan.unknownSources).toEqual(['the-moon']);
    });
  });

  describe('the timing effects', () => {
    it('proposes an entry-scoped effect for an entry that fired', () => {
      const entry = entryOf('The Ferryman', {
        keys: ['ferryman'],
        content: 'Found.',
        cooldown: 3,
      });
      const result = run([bookOf([entry])], { input: { text: 'the ferryman' } });

      expect(result.effects).toEqual([
        {
          channelId: SE_LORE_TIMING,
          scopeKey: entry.id,
          op: { type: 'set', path: '/' },
          after: { sticky: 0, cooldown: 3, fired: 1 },
          proposedBy: { kind: 'engine' },
        },
      ]);
    });

    /**
     * A library of four hundred entries would otherwise write four hundred
     * no-op effects every turn, and the effect log is what [07 §4] replays.
     * Every one would be a real line in a real file somebody may read.
     */
    it('proposes nothing for an entry whose counters did not move', () => {
      const entry = entryOf('Idle', { keys: ['nothing-here'], content: 'Found.' });

      expect(run([bookOf([entry])], { input: { text: 'a quiet evening' } }).effects).toEqual([]);
    });

    it('reads the stored counters back out of the channel', () => {
      const entry = entryOf('The Ferryman', { keys: ['ferryman'], content: 'Found.' });
      const channels: Record<string, ChannelState> = {
        [channelKey(SE_LORE_TIMING, entry.id)]: {
          value: { sticky: 0, cooldown: 2, fired: 1 },
          version: 1,
          updatedBy: { kind: 'engine' },
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as unknown as ChannelState,
      };

      const result = run([bookOf([entry])], { input: { text: 'the ferryman' }, channels });

      // Held back by the cooldown it was carrying, and counted down by one.
      expect(result.blocks).toEqual([]);
      expect(result.effects[0]?.after).toEqual({ sticky: 0, cooldown: 1, fired: 1 });
    });
  });

  describe('what the preset decides', () => {
    it('takes the outlets the preset positions', () => {
      const entry = entryOf('Rules', {
        keys: ['ferryman'],
        content: 'Found.',
        position: 'outlet',
        outletName: 'rules',
      });
      const withOutlet: Preset = {
        ...SCENE_PRESET,
        blocks: SCENE_PRESET.blocks.map((block) =>
          block.kind === 'slot' && block.source.of === 'lore'
            ? { ...block, source: { ...block.source, outlet: 'rules' } }
            : block,
        ),
      };

      const positioned = run([bookOf([entry])], {
        input: { text: 'the ferryman' },
        preset: withOutlet,
      });
      const not = run([bookOf([entry])], { input: { text: 'the ferryman' } });

      expect(positioned.blocks).toHaveLength(1);
      expect(positioned.unplaced).toEqual([]);
      expect(not.blocks).toEqual([]);
      expect(
        not.unplaced.map((one) => (one.kind === 'outlet' ? one.outletName : one.kind)),
      ).toEqual(['rules']);
    });
  });
});

/**
 * The report the keyword tester is a surface over — [P5.8].
 *
 * Assembled from three sources the tester has no business knowing apart: the
 * scan's refusals, the shelf's per-book spend, and the books themselves. What
 * is asserted here is that each of them arrives whole, because the surface can
 * only show what the report contains and *my lorebook never fires* is answered
 * by the half nothing else records.
 */
describe('loreReport', () => {
  function reportFor(
    books: LoreSource[],
    edits: Partial<RetrieveContext> = {},
  ): ReturnType<typeof loreReport> {
    const result = run(books, edits);
    return loreReport({
      books,
      scan: result.scan,
      shelf: result.shelf,
      unplaced: result.unplaced,
    });
  }

  it('carries every reason an entry did not fire', () => {
    const report = reportFor([
      bookOf([
        entryOf('No keys', { keys: [] }),
        entryOf('Missed', { keys: ['nowhere'] }),
        entryOf('Switched off', { keys: ['ferryman'], enabled: false }),
      ]),
    ]);

    expect(
      report.skipped
        .map((one) => `${one.entryName}: ${one.reason}`)
        .sort((left, right) => (left < right ? -1 : 1)),
    ).toEqual(['Missed: no-match', 'No keys: no-keys', 'Switched off: entry-disabled']);
  });

  /** [P5.7]'s folder gate, named — the outermost shut one, as the surface names it. */
  /**
   * **Gate step 13's second half, as an assertion** — *where the answer is a
   * gate or a disabled book rather than a match, it agrees with what the
   * document half already showed*.
   *
   * It agrees because both come from one function: [P5.7] made `activate` call
   * the same `entryGate` the fold and the editor call, and the report carries
   * the scan's reason verbatim. This pins the whole chain — page → `entryGate`
   * ← scan → report → tester — at the point where a future edit could insert a
   * second opinion.
   */
  it('gives the tester the same gate the reading surface shows', () => {
    const inside = entryOf('Inside', { keys: ['ferryman'], folderId: 'act-two' });
    const book = bookOf([inside], {
      folders: [{ id: 'act-two', name: 'Act Two', parentFolderId: null, enabled: false, order: 0 }],
    });

    expect(entryGate(book.book, inside).blockedBy[0]).toEqual({
      kind: 'folder-off',
      folderId: 'act-two',
      folderName: 'Act Two',
    });
    expect(reportFor([book]).skipped[0]).toMatchObject({
      reason: 'folder-disabled',
      folder: { id: 'act-two', name: 'Act Two' },
    });
  });

  /**
   * A book that activated nothing is the row somebody most needs: *being
   * scanned and contributing nothing* and *not being scanned* are different
   * problems, and only a row tells them apart.
   */
  it('lists a book that contributed nothing at all', () => {
    const report = reportFor([bookOf([entryOf('Quiet', { keys: ['nowhere'] })])]);

    expect(report.books).toEqual([
      {
        bookId: 'book-1',
        bookName: 'Rain City',
        by: 'session',
        tokenBudget: 2048,
        tokensSpent: 0,
        entryLimit: 100,
        entriesKept: 0,
      },
    ]);
  });

  it('reports what each book spent of its own budget', () => {
    const report = reportFor(
      [bookOf([entryOf('Fires', { keys: ['ferryman'], content: 'Yes.' })])],
      {
        input: { text: 'the ferryman' },
      },
    );

    expect(report.books[0]?.entriesKept).toBe(1);
    expect(report.books[0]?.tokensSpent).toBeGreaterThan(0);
  });

  it('says which selection put a book here', () => {
    const byTreatment = { ...bookOf([entryOf('One', { keys: ['x'] })]), by: 'treatment' as const };

    expect(reportFor([byTreatment]).books[0]?.by).toBe('treatment');
  });

  describe('the patterns it could not run', () => {
    /**
     * **Deduplicated by key, and the reason is arithmetic.** `firstHit` walks
     * every haystack, so one bad pattern in an entry scanned across a
     * `scanDepth` of eight produces eight identical refusals — and somebody
     * reading *8 patterns could not be run* goes looking for eight problems.
     */
    it('reports one bad pattern once, however many haystacks it was tried in', () => {
      const entry = entryOf('Broken', { keys: ['('], useRegex: true, scanDepth: 0 });
      const report = reportFor([bookOf([entry])], {
        history: [turnOf('a', 'b'), turnOf('c', 'd'), turnOf('e', 'f')],
      });

      expect(report.refused).toHaveLength(1);
      expect(report.refused[0]).toMatchObject({ key: '(', reason: 'invalid' });
    });

    /** The entry is recovered from the key, so a person has something to open. */
    it('names the entry the pattern belongs to', () => {
      const entry = entryOf('Broken', { keys: ['('], useRegex: true });

      expect(
        reportFor([bookOf([entry])], { input: { text: 'anything at all' } }).refused[0],
      ).toMatchObject({
        entryId: entry.id,
        entryName: 'Broken',
      });
    });
  });

  it('carries the sources nothing supplied', () => {
    const entry = entryOf('Elsewhere', {
      keys: ['ferryman'],
      additionalMatchingSources: ['the-moon'],
    });

    expect(reportFor([bookOf([entry])]).unknownSources).toEqual(['the-moon']);
  });
});
