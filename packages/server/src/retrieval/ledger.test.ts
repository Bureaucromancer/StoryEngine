// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, describe, expect, it, vi } from 'vitest';

import { newLorebook, newLoreEntry, type Lorebook, type LoreEntry } from '@storyengine/shared';

import { Rng } from '../rng/rng.js';
import { seededSource } from '../rng/source.js';
import type { LoreSource } from '../turns/lore.js';
import { activate } from './activate.js';
import { SCAN_TIMEOUT_LIMIT } from './match.js';
import { testPattern } from './regex.js';

/**
 * ***A scan pays for a bad pattern once, and for bad patterns a bounded
 * amount*** (2026-09-27) — `RegexLedger` in `match.ts`.
 *
 * `testPattern`'s fifty milliseconds bounds one call, and a scan made a great
 * many: every key against every message, every recursive pass, every secondary
 * key. A pattern that timed out on the first message was run again on the
 * second, so five catastrophic keys over an eight-hundred-message session cost
 * minutes a turn, for every account on the server.
 *
 * `testPattern` is wrapped so a pattern called `SLOW` times out without anybody
 * waiting fifty milliseconds for it, and the calls are the assertion: what
 * changed is how often a pattern is run, which a scan's result cannot show.
 */
vi.mock('./regex.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./regex.js')>();
  return {
    ...actual,
    testPattern: vi.fn((pattern: string, flags: string, haystack: string) =>
      pattern.startsWith('SLOW')
        ? { kind: 'timed-out' as const, pattern }
        : actual.testPattern(pattern, flags, haystack),
    ),
  };
});

afterEach(() => {
  vi.mocked(testPattern).mockClear();
});

function bookOf(name: string, entries: LoreEntry[], edits: Partial<Lorebook> = {}): LoreSource {
  const book = { ...newLorebook(name), entries, ...edits };
  return { book, id: `book-${name}`, contentHash: 'sha256:0', required: false, by: 'session' };
}

function regexEntry(name: string, key: string): LoreEntry {
  return { ...newLoreEntry(name), keys: [key], useRegex: true };
}

function scan(books: LoreSource[], messages: string[]) {
  return activate({
    books,
    input: { messages },
    messagesSoFar: 100,
    timing: {},
    filters: { actorIds: [], actorTags: [], generationTrigger: 'story' },
    rng: new Rng({ source: seededSource(7) }),
  });
}

const calls = (pattern: string): number =>
  vi.mocked(testPattern).mock.calls.filter(([source]) => source === pattern).length;

const TWENTY_MESSAGES = Array.from({ length: 20 }, (_, at) => `Message ${String(at)}.`);

describe('a pattern that cannot be run', () => {
  it('is run once in a scan, whatever it is read against, and reported once', () => {
    // The whole session, so every message is a haystack.
    const result = scan(
      [bookOf('Rain City', [regexEntry('Slow', 'SLOW-1')], { scanDepth: 0 })],
      TWENTY_MESSAGES,
    );

    expect(calls('SLOW-1')).toBe(1);
    expect(result.refused.filter((one) => one.key === 'SLOW-1')).toHaveLength(1);
  });

  it('is run once across books and entries that share it', () => {
    // An invalid pattern is invalid everywhere, and costs nothing to discover
    // twice, but there is no reason to.
    scan(
      [
        bookOf('One', [regexEntry('A', '(unclosed'), regexEntry('B', '(unclosed')], {
          scanDepth: 0,
        }),
        bookOf('Two', [regexEntry('C', '(unclosed')], { scanDepth: 0 }),
      ],
      TWENTY_MESSAGES,
    );

    expect(calls('(unclosed')).toBe(1);
  });
});

describe('a scan full of patterns that time out', () => {
  it('stops running patterns once it has spent its limit, and says which it skipped', () => {
    const slow = Array.from({ length: SCAN_TIMEOUT_LIMIT + 3 }, (_, at) =>
      regexEntry(`Slow ${String(at)}`, `SLOW-${String(at)}`),
    );
    const result = scan([bookOf('Rain City', slow, { scanDepth: 0 })], TWENTY_MESSAGES);

    const run = vi.mocked(testPattern).mock.calls.filter(([source]) => source.startsWith('SLOW'));
    expect(run).toHaveLength(SCAN_TIMEOUT_LIMIT);
    // Every one of them is reported, the skipped ones as timed out, because
    // the scan's time for patterns is what ran out.
    const refused = result.refused.filter((one) => one.key.startsWith('SLOW'));
    expect(new Set(refused.map((one) => one.key)).size).toBe(SCAN_TIMEOUT_LIMIT + 3);
    expect(refused.every((one) => one.reason === 'timed-out')).toBe(true);
  });

  it('still matches a literal key after its patterns are spent', () => {
    const entries = [
      ...Array.from({ length: SCAN_TIMEOUT_LIMIT }, (_, at) =>
        regexEntry(`Slow ${String(at)}`, `SLOW-${String(at)}`),
      ),
      { ...newLoreEntry('The Ferryman'), keys: ['ferryman'] },
    ];
    const result = scan(
      [bookOf('Rain City', entries, { scanDepth: 0 })],
      ['I asked the ferryman about the bridge.'],
    );

    expect(result.activated.map((one) => one.entry.name)).toContain('The Ferryman');
  });
});
