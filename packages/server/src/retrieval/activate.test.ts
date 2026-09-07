// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLorebook, newLoreEntry, type Lorebook, type LoreEntry } from '@storyengine/shared';

import { Rng } from '../rng/rng.js';
import { seededSource } from '../rng/source.js';
import type { LoreSource } from '../turns/lore.js';
import { activate, inScanOrder, type ScanContext, type SkipReason } from './activate.js';
import type { EntryTiming } from './timing.js';

/**
 * The scan — [P5.6], [P5 §1.3].
 *
 * Written mostly as *this entry did not fire, and here is which rule stopped
 * it*, because that is the output the surfaces consume and because a scan is
 * one big precedence question: nearly every bug this code can have is two rules
 * in the wrong order, which shows up as the right answer with the wrong reason.
 */

function bookOf(name: string, entries: LoreEntry[], edits: Partial<Lorebook> = {}): LoreSource {
  const book = { ...newLorebook(name), entries, ...edits };
  return { book, id: `book-${name}`, contentHash: 'sha256:0', required: false, by: 'session' };
}

function entryOf(name: string, edits: Partial<LoreEntry> = {}): LoreEntry {
  return { ...newLoreEntry(name), ...edits };
}

/**
 * A deterministic RNG.
 *
 * **The seed is spread before it is used, and that is not decoration.**
 * `seededSource` is xorshift128 seeded into `x` alone, with the other three
 * words held at fixed constants — so the *first* draw of seeds 1, 2, 3 … is
 * 0.059017, 0.059016, 0.059016, differing far below anything a comparison
 * against a probability can see. A loop over small seeds therefore produces one
 * outcome forty times and reads exactly like proof of determinism. It was
 * written that way here first, and two tests passed that should not have.
 *
 * Multiplying by the golden-ratio constant scatters the seed across the whole
 * word, which is what makes *sometimes this and sometimes that* testable at
 * all. Anything in this repo that samples a distribution across seeds needs the
 * same treatment.
 */
function rngOf(seed = 1): Rng {
  return new Rng({ source: seededSource((seed * 2654435761) >>> 0) });
}

function scan(
  books: LoreSource[],
  messages: string[],
  edits: Partial<ScanContext> = {},
): ReturnType<typeof activate> {
  return activate({
    books,
    input: { messages },
    messagesSoFar: 100,
    timing: {},
    filters: { actorIds: [], actorTags: [], generationTrigger: 'story' },
    rng: rngOf(),
    ...edits,
  });
}

function reasonFor(result: ReturnType<typeof activate>, name: string): SkipReason | undefined {
  return result.skipped.find((one) => one.entry.name === name)?.reason;
}

function firedNames(result: ReturnType<typeof activate>): string[] {
  return result.activated.map((one) => one.entry.name);
}

describe('activate', () => {
  it('fires an entry whose key is in the text, and names the key that did it', () => {
    const entry = entryOf('The Ferryman', { keys: ['ferryman'] });
    const result = scan([bookOf('Rain City', [entry])], ['I asked the ferryman about the bridge.']);

    expect(firedNames(result)).toEqual(['The Ferryman']);
    expect(result.activated[0]?.by).toBe('keyword');
    expect(result.activated[0]?.hit).toEqual({ key: 'ferryman', source: 'message' });
    expect(result.activated[0]?.depth).toBe(0);
  });

  it('fires a constant entry with no key in sight', () => {
    const entry = entryOf('The Rain', { constant: true, keys: [] });
    const result = scan([bookOf('Rain City', [entry])], ['Nothing to do with weather.']);

    expect(result.activated[0]?.by).toBe('constant');
    expect(result.activated[0]?.hit).toBeNull();
  });

  it('reports an entry with keys that are not in the text', () => {
    const entry = entryOf('The Ferryman', { keys: ['ferryman'] });
    const result = scan([bookOf('Rain City', [entry])], ['A quiet evening.']);

    expect(result.activated).toEqual([]);
    expect(reasonFor(result, 'The Ferryman')).toBe('no-match');
  });

  /**
   * The commonest reason a newly written entry never fires, and the one that is
   * useless as `no-match`: nothing is wrong with the text, the entry has
   * nothing to match on.
   */
  it('distinguishes an entry with no keys from one whose keys missed', () => {
    const result = scan(
      [bookOf('Rain City', [entryOf('Blank', { keys: [] }), entryOf('Missed', { keys: ['x'] })])],
      ['nothing here'],
    );

    expect(reasonFor(result, 'Blank')).toBe('no-keys');
    expect(reasonFor(result, 'Missed')).toBe('no-match');
  });

  it("reports every entry of a disabled book against the book's own switch", () => {
    const entry = entryOf('The Ferryman', { keys: ['ferryman'] });
    const result = scan([bookOf('Rain City', [entry], { enabled: false })], ['the ferryman']);

    expect(result.activated).toEqual([]);
    expect(reasonFor(result, 'The Ferryman')).toBe('book-disabled');
  });

  it('reports a disabled entry against its own switch, not the text', () => {
    const entry = entryOf('The Ferryman', { keys: ['ferryman'], enabled: false });
    const result = scan([bookOf('Rain City', [entry])], ['the ferryman']);

    expect(reasonFor(result, 'The Ferryman')).toBe('entry-disabled');
  });

  describe('timing', () => {
    const cooling: Record<string, EntryTiming> = {};

    it('holds a cooling entry back even when its key is right there', () => {
      const entry = entryOf('The Ferryman', { keys: ['ferryman'], cooldown: 3 });
      const result = scan([bookOf('Rain City', [entry])], ['the ferryman'], {
        timing: { ...cooling, [entry.id]: { sticky: 0, cooldown: 2, fired: 1 } },
      });

      expect(reasonFor(result, 'The Ferryman')).toBe('cooling');
    });

    /** The whole of what `sticky` means: contributing without matching. */
    it('fires a sticky entry with nothing in the text', () => {
      const entry = entryOf('The Ferryman', { keys: ['ferryman'], sticky: 3 });
      const result = scan([bookOf('Rain City', [entry])], ['a quiet evening'], {
        timing: { [entry.id]: { sticky: 2, cooldown: 0, fired: 1 } },
      });

      expect(result.activated[0]?.by).toBe('sticky');
      expect(result.activated[0]?.hit).toBeNull();
    });

    it('holds a delayed entry back until the conversation is long enough', () => {
      const entry = entryOf('The Ferryman', { keys: ['ferryman'], delay: 10 });
      const result = scan([bookOf('Rain City', [entry])], ['the ferryman'], { messagesSoFar: 4 });

      expect(reasonFor(result, 'The Ferryman')).toBe('delayed');
    });

    it('reports a spent ephemeral entry as spent rather than as a miss', () => {
      const entry = entryOf('The Ferryman', { keys: ['ferryman'], ephemeral: 1 });
      const result = scan([bookOf('Rain City', [entry])], ['the ferryman'], {
        timing: { [entry.id]: { sticky: 0, cooldown: 0, fired: 1 } },
      });

      expect(reasonFor(result, 'The Ferryman')).toBe('spent');
    });

    it('advances the counters of an entry that fired', () => {
      const entry = entryOf('The Ferryman', { keys: ['ferryman'], cooldown: 3 });
      const result = scan([bookOf('Rain City', [entry])], ['the ferryman']);

      expect(result.timing[entry.id]).toEqual({ sticky: 0, cooldown: 3, fired: 1 });
    });

    /**
     * A cooldown has to run down on turns the entry takes no part in, or it
     * never expires — the bug this makes a test rather than a comment.
     */
    it('counts a cooling entry down on a turn it did not fire', () => {
      const entry = entryOf('The Ferryman', { keys: ['ferryman'] });
      const result = scan([bookOf('Rain City', [entry])], ['nothing'], {
        timing: { [entry.id]: { sticky: 0, cooldown: 2, fired: 1 } },
      });

      expect(result.timing[entry.id]?.cooldown).toBe(1);
    });

    /** A book that is off is not time passing for the entries inside it. */
    it('leaves the counters of a disabled book alone', () => {
      const entry = entryOf('The Ferryman', { keys: ['ferryman'] });
      const result = scan([bookOf('Rain City', [entry], { enabled: false })], ['nothing'], {
        timing: { [entry.id]: { sticky: 0, cooldown: 2, fired: 1 } },
      });

      expect(result.timing).toEqual({});
    });
  });

  describe('gating filters', () => {
    const filters = { actorIds: ['vera'], actorTags: ['detective'], generationTrigger: 'story' };

    it('lets an entry through when the filtered actor is in the scene', () => {
      const entry = entryOf('Vera', {
        keys: ['vera'],
        actorFilter: { mode: 'include', values: ['vera'] },
      });

      expect(firedNames(scan([bookOf('B', [entry])], ['vera'], { filters }))).toEqual(['Vera']);
    });

    it('holds an entry back when none of its actors are in the scene', () => {
      const entry = entryOf('Absent', {
        keys: ['vera'],
        actorFilter: { mode: 'include', values: ['someone-else'] },
      });

      expect(reasonFor(scan([bookOf('B', [entry])], ['vera'], { filters }), 'Absent')).toBe(
        'filtered-out',
      );
    });

    it('excludes on a tag', () => {
      const entry = entryOf('No Detectives', {
        keys: ['vera'],
        actorTagFilter: { mode: 'exclude', values: ['detective'] },
      });

      expect(reasonFor(scan([bookOf('B', [entry])], ['vera'], { filters }), 'No Detectives')).toBe(
        'filtered-out',
      );
    });

    it('filters on the call kind', () => {
      const entry = entryOf('Summaries Only', {
        keys: ['vera'],
        generationTriggerFilter: { mode: 'include', values: ['summary'] },
      });

      expect(reasonFor(scan([bookOf('B', [entry])], ['vera'], { filters }), 'Summaries Only')).toBe(
        'filtered-out',
      );
    });

    /**
     * `any` and null are the same statement: no opinion.
     *
     * **The values have to be ones that are present**, which the first version
     * of this test got wrong by listing an absent actor: `any` and `exclude`
     * agree on a value nobody has, so a mutation collapsing `any` into the
     * exclude arm survived. The case that separates them is a filter naming
     * somebody who *is* in the scene.
     */
    it('treats a filter in any mode as no filter at all', () => {
      const entry = entryOf('Open', {
        keys: ['vera'],
        actorFilter: { mode: 'any', values: ['vera'] },
      });

      expect(firedNames(scan([bookOf('B', [entry])], ['vera'], { filters }))).toEqual(['Open']);
    });

    /**
     * `include` is *at least one of mine*, not *all of mine*. An author listing
     * three actors means "any scene with one of these"; the other reading turns
     * a list into a conjunction nobody asked for, and quietly stops a filter
     * with two names from ever passing in a two-hander.
     */
    it('includes on any one of its values rather than all of them', () => {
      const entry = entryOf('Either', {
        keys: ['vera'],
        actorFilter: { mode: 'include', values: ['vera', 'somebody-absent'] },
      });

      expect(firedNames(scan([bookOf('B', [entry])], ['vera'], { filters }))).toEqual(['Either']);
    });
  });

  describe('recursion', () => {
    const recursive = { recursiveScanning: true, maxRecursionDepth: 3 };

    it("finds an entry named only by another entry's text", () => {
      const first = entryOf('The Ferryman', {
        keys: ['ferryman'],
        content: 'He works the crossing at Marrow Wharf.',
      });
      const second = entryOf('Marrow Wharf', { keys: ['marrow wharf'] });
      const result = scan([bookOf('B', [first, second], recursive)], ['the ferryman']);

      expect(firedNames(result).sort()).toEqual(['Marrow Wharf', 'The Ferryman']);
      expect(result.activated.find((one) => one.entry.name === 'Marrow Wharf')?.by).toBe(
        'recursive',
      );
    });

    /**
     * **A chain of width three, which is what no recursion test had** —
     * [P6B.1], and the reason the defect below survived two phases.
     *
     * The recursive pass fed the activated entries' content in as `messages`,
     * and `haystacksFor` sliced *that* by `scanDepth`. A default book scans two
     * messages, so on any pass that activated three entries **only the first
     * two fed anything into the next one** — silently, forever, with the entry
     * that never fired reported `no-match` as though its keys were wrong.
     *
     * Every existing recursion test was a chain of width one, so the slice
     * never had a second element to drop and the whole thing was invisible
     * ([P5 §0.5]). This is that width, at the default depth.
     */
    it('feeds every entry that activated into the next pass, not the first scanDepth of them', () => {
      // Three entries fire together at depth zero, and the third names the one
      // that only recursion can reach. `scanDepth` is the default 2.
      const one = entryOf('One', { keys: ['start'], content: 'Nothing to see.' });
      const two = entryOf('Two', { keys: ['start'], content: 'Also nothing.' });
      const three = entryOf('Three', { keys: ['start'], content: 'It happened at Marrow Wharf.' });
      const target = entryOf('Marrow Wharf', { keys: ['marrow wharf'] });

      const result = scan([bookOf('B', [one, two, three, target], recursive)], ['start']);

      expect(firedNames(result).sort()).toEqual(['Marrow Wharf', 'One', 'Three', 'Two']);
      const found = result.activated.find((each) => each.entry.name === 'Marrow Wharf');
      expect(found?.by).toBe('recursive');
      // And the hit says where it happened: another entry's text, not the
      // conversation, which is what the surfaces show.
      expect(found?.hit?.source).toBe('entry');
    });

    it('does not recurse when the book has the switch off', () => {
      const first = entryOf('The Ferryman', { keys: ['ferryman'], content: 'Marrow Wharf.' });
      const second = entryOf('Marrow Wharf', { keys: ['marrow wharf'] });
      const result = scan([bookOf('B', [first, second])], ['the ferryman']);

      expect(firedNames(result)).toEqual(['The Ferryman']);
      expect(reasonFor(result, 'Marrow Wharf')).toBe('no-match');
    });

    it('stops at the depth limit and says so', () => {
      const one = entryOf('One', { keys: ['start'], content: 'two' });
      const two = entryOf('Two', { keys: ['two'], content: 'three' });
      const three = entryOf('Three', { keys: ['three'], content: 'four' });
      const four = entryOf('Four', { keys: ['four'] });
      const result = scan(
        [bookOf('B', [one, two, three, four], { recursiveScanning: true, maxRecursionDepth: 2 })],
        ['start'],
      );

      expect(firedNames(result).sort()).toEqual(['One', 'Three', 'Two']);
      expect(reasonFor(result, 'Four')).toBe('depth-exhausted');
    });

    it("does not let a preventRecursion entry's text trigger anything", () => {
      const first = entryOf('The Ferryman', {
        keys: ['ferryman'],
        content: 'Marrow Wharf.',
        preventRecursion: true,
      });
      const second = entryOf('Marrow Wharf', { keys: ['marrow wharf'] });
      const result = scan([bookOf('B', [first, second], recursive)], ['the ferryman']);

      expect(firedNames(result)).toEqual(['The Ferryman']);
    });

    it('keeps an excludeRecursion entry out of the later passes', () => {
      const first = entryOf('The Ferryman', { keys: ['ferryman'], content: 'Marrow Wharf.' });
      const second = entryOf('Marrow Wharf', { keys: ['marrow wharf'], excludeRecursion: true });
      const result = scan([bookOf('B', [first, second], recursive)], ['the ferryman']);

      expect(reasonFor(result, 'Marrow Wharf')).toBe('excluded-from-recursion');
    });

    /**
     * `delayUntilRecursion` is a *later*, not a refusal, at depth zero — the
     * entry is waiting for the pass it exists for. Reporting it as skipped
     * there would take it out of the loop before that pass ran, which is a bug
     * that hides behind a plausible-looking reason string.
     */
    it('fires a delayUntilRecursion entry on the pass it was waiting for', () => {
      const first = entryOf('The Ferryman', { keys: ['ferryman'], content: 'Marrow Wharf.' });
      const second = entryOf('Marrow Wharf', {
        keys: ['marrow wharf'],
        delayUntilRecursion: true,
      });
      const result = scan([bookOf('B', [first, second], recursive)], ['the ferryman']);

      expect(firedNames(result).sort()).toEqual(['Marrow Wharf', 'The Ferryman']);
    });

    it('reports a delayUntilRecursion entry that never got a pass as awaiting one', () => {
      const entry = entryOf('Marrow Wharf', { keys: ['marrow wharf'], delayUntilRecursion: true });
      const result = scan([bookOf('B', [entry], recursive)], ['nothing at all']);

      expect(reasonFor(result, 'Marrow Wharf')).toBe('awaiting-recursion');
    });

    it('reports an entry carrying both inbound flags as never firing', () => {
      const entry = entryOf('Impossible', {
        keys: ['x'],
        excludeRecursion: true,
        delayUntilRecursion: true,
      });

      expect(reasonFor(scan([bookOf('B', [entry], recursive)], ['x']), 'Impossible')).toBe(
        'never-fires',
      );
    });

    /**
     * A recursive pass reads the activated text and **not** the conversation:
     * an entry the messages would have matched had its chance at depth zero.
     * Without the swap the loop would re-find the same entries every pass and
     * terminate on the pending list rather than on the depth.
     */
    it('scans the activated text rather than the messages on a later pass', () => {
      const first = entryOf('The Ferryman', { keys: ['ferryman'], content: 'Nothing useful.' });
      const second = entryOf('Bridge', {
        keys: ['bridge'],
        delayUntilRecursion: true,
      });
      // 'bridge' is in the messages but never in an activated entry's content.
      const result = scan([bookOf('B', [first, second], recursive)], ['the ferryman on a bridge']);

      expect(firedNames(result)).toEqual(['The Ferryman']);
      /**
       * `no-match` rather than `depth-exhausted`, and the difference is the
       * point: the loop stopped because the first pass fed it nothing worth
       * re-scanning, not because it hit the book's limit. Entry `Bridge` was
       * genuinely considered against the text it was shown and did not match
       * it. `depth-exhausted` is reserved for the case where there *was* more
       * text and the limit refused the pass — the setting to change is
       * different, so the reason has to be.
       */
      expect(reasonFor(result, 'Bridge')).toBe('no-match');
    });

    /**
     * The sources travel with every pass while the messages do not. Dropping
     * them would make an entry that names a supplied source report it as
     * *unknown* the moment a second pass ran, turning a working scan into a
     * page of warnings about sources that were right there.
     */
    it('keeps the named sources on a later pass', () => {
      const first = entryOf('The Ferryman', { keys: ['ferryman'], content: 'Marrow Wharf.' });
      const second = entryOf('Marrow Wharf', {
        keys: ['marrow wharf'],
        additionalMatchingSources: ['persona'],
      });
      const result = activate({
        books: [bookOf('B', [first, second], recursive)],
        input: { messages: ['the ferryman'], sources: { persona: 'A detective.' } },
        messagesSoFar: 100,
        timing: {},
        filters: { actorIds: [], actorTags: [], generationTrigger: 'story' },
        rng: rngOf(),
      });

      expect(firedNames(result).sort()).toEqual(['Marrow Wharf', 'The Ferryman']);
      expect(result.unknownSources).toEqual([]);
    });

    /**
     * **The loop's own depth check is not the same one `considerAt` makes**,
     * and this is the case that separates them: an entry held for recursion
     * that the book will never grant. Without the check the loop runs one pass
     * too many, and the entry is reported against the depth limit instead of
     * against the thing an author can act on — that it is waiting for a
     * recursion this book does not do.
     */
    it('does not run a pass the book forbids, even with text to feed it', () => {
      const speaker = entryOf('Speaker', { constant: true, keys: [], content: 'Marrow Wharf.' });
      const waiting = entryOf('Waiting', {
        keys: ['marrow wharf'],
        delayUntilRecursion: true,
      });
      const result = scan(
        [bookOf('B', [speaker, waiting], { recursiveScanning: true, maxRecursionDepth: 0 })],
        ['anything'],
      );

      expect(firedNames(result)).toEqual(['Speaker']);
      expect(reasonFor(result, 'Waiting')).toBe('awaiting-recursion');
    });
  });

  describe('grouping', () => {
    const grouped = (weights: (number | null)[]): LoreSource =>
      bookOf(
        'Weather',
        weights.map((weight, at) =>
          entryOf(`Option ${String(at)}`, {
            keys: ['weather'],
            group: 'weather',
            groupWeight: weight,
            order: at,
          }),
        ),
      );

    it('lets exactly one of a group fire and reports the rest', () => {
      const result = scan([grouped([1, 1, 1])], ['the weather']);

      expect(result.activated).toHaveLength(1);
      expect(result.skipped.filter((one) => one.reason === 'lost-its-group')).toHaveLength(2);
    });

    it('draws the same winner again for the same tape', () => {
      const first = scan([grouped([1, 2, 3])], ['the weather'], { rng: rngOf(7) });
      const second = scan([grouped([1, 2, 3])], ['the weather'], { rng: rngOf(7) });

      expect(firedNames(first)).toEqual(firedNames(second));
    });

    /**
     * The weight has to *weigh*. Sorting by it — which is what this function
     * did first — would make the heaviest entry win every single time, which is
     * indistinguishable from a weight of infinity.
     */
    it('lets a lighter entry win sometimes', () => {
      const winners = new Set<string>();
      for (let seed = 0; seed < 40; seed += 1) {
        winners.add(
          firedNames(scan([grouped([1, 1, 1])], ['the weather'], { rng: rngOf(seed) }))[0] ?? '',
        );
      }

      expect(winners.size).toBeGreaterThan(1);
    });

    it('never draws an entry whose weight is zero', () => {
      for (let seed = 0; seed < 20; seed += 1) {
        const result = scan([grouped([0, 5, 0])], ['the weather'], { rng: rngOf(seed) });
        expect(firedNames(result)).toEqual(['Option 1']);
      }
    });

    /** Zeroing a whole group is *none of these for now*, not a crash. */
    it('falls back to the first in scan order when every weight is zero', () => {
      const result = scan([grouped([0, 0, 0])], ['the weather']);

      expect(firedNames(result)).toEqual(['Option 0']);
    });

    it('does not let two books compete for one group name', () => {
      const first = bookOf('One', [entryOf('A', { keys: ['w'], group: 'weather' })]);
      const second = bookOf('Two', [entryOf('B', { keys: ['w'], group: 'weather' })]);

      expect(firedNames(scan([first, second], ['w'])).sort()).toEqual(['A', 'B']);
    });

    /**
     * A recursive pass must not unseat the entry already in the prompt: the
     * text that triggered the pass would then be justifying an entry that is no
     * longer there.
     */
    it('does not let a later pass take a group that an earlier one won', () => {
      const winner = entryOf('Winner', {
        keys: ['weather'],
        group: 'weather',
        content: 'It mentions fog.',
      });
      const latecomer = entryOf('Latecomer', { keys: ['fog'], group: 'weather', groupWeight: 99 });
      const result = scan(
        [bookOf('B', [winner, latecomer], { recursiveScanning: true, maxRecursionDepth: 3 })],
        ['the weather'],
      );

      expect(firedNames(result)).toEqual(['Winner']);
      expect(reasonFor(result, 'Latecomer')).toBe('lost-its-group');
    });

    /**
     * A loser is not in the prompt, so its text must not reach into it. Letting
     * it feed the next pass would let an entry nobody can read pull in an entry
     * they can — a citation to a source that was never shown.
     */
    it("does not let a group loser's text trigger anything", () => {
      const winner = entryOf('Winner', {
        keys: ['weather'],
        group: 'weather',
        groupWeight: 100,
        order: 0,
        content: 'Nothing else.',
      });
      const loser = entryOf('Loser', {
        keys: ['weather'],
        group: 'weather',
        groupWeight: 0,
        order: 1,
        content: 'It mentions Marrow Wharf.',
      });
      const downstream = entryOf('Marrow Wharf', { keys: ['marrow wharf'] });
      const result = scan(
        [
          bookOf('B', [winner, loser, downstream], {
            recursiveScanning: true,
            maxRecursionDepth: 3,
          }),
        ],
        ['the weather'],
      );

      expect(firedNames(result)).toEqual(['Winner']);
      expect(reasonFor(result, 'Loser')).toBe('lost-its-group');
      // 'no-match', not 'depth-exhausted': the winner's own text fed a second
      // pass that simply found nothing, so the limit was never reached.
      expect(reasonFor(result, 'Marrow Wharf')).toBe('no-match');
    });
  });

  describe('probability', () => {
    it('always fires an entry whose probability is null', () => {
      const entry = entryOf('Certain', { keys: ['x'], probability: null });

      for (let seed = 0; seed < 10; seed += 1) {
        expect(firedNames(scan([bookOf('B', [entry])], ['x'], { rng: rngOf(seed) }))).toEqual([
          'Certain',
        ]);
      }
    });

    it('never fires an entry whose probability is zero, and says which rule it was', () => {
      const entry = entryOf('Never', { keys: ['x'], probability: 0 });

      for (let seed = 0; seed < 10; seed += 1) {
        const result = scan([bookOf('B', [entry])], ['x'], { rng: rngOf(seed) });
        expect(result.activated).toEqual([]);
        expect(reasonFor(result, 'Never')).toBe('lost-the-roll');
      }
    });

    it('fires an entry at fifty percent sometimes and not others', () => {
      const entry = entryOf('Maybe', { keys: ['x'], probability: 50 });
      const outcomes = new Set<number>();
      for (let seed = 0; seed < 30; seed += 1) {
        outcomes.add(scan([bookOf('B', [entry])], ['x'], { rng: rngOf(seed) }).activated.length);
      }

      expect(outcomes).toEqual(new Set([0, 1]));
    });

    /**
     * **Each entry's roll is keyed to that entry** — [07 §14]'s *keyed by site,
     * never by position*. Two entries drawing under one purpose are told apart
     * only by an index, and an index is a position: drop the first entry on a
     * rewrite and the second inherits its coin flip.
     *
     * Asserted on the **purpose**, not on the key, which is where the first
     * version of this test went wrong. `Rng.at` appends an automatic index, so
     * a mutation collapsing every entry onto one purpose still produced two
     * distinct keys — `…#0` and `…#1` — and the test passed while proving
     * nothing. The index is exactly the thing the design says not to rely on.
     */
    it('keys each roll to its own entry rather than to the scan', () => {
      const rng = rngOf(3);
      const first = entryOf('One', { keys: ['x'], probability: 50 });
      const second = entryOf('Two', { keys: ['x'], probability: 50 });
      scan([bookOf('B', [first, second])], ['x'], { rng });

      const purposes = rng.tape
        .filter((draw) => draw.site === 'lore.probability')
        .map((draw) => draw.purpose);
      expect(purposes.sort()).toEqual([first.id, second.id].sort());
    });

    /**
     * A window is one firing continuing. Re-rolling it every turn would make a
     * 50% entry with `sticky: 4` almost never reach its fourth turn, which is
     * the two fields silently disagreeing rather than composing.
     */
    it('does not re-roll an entry that is already sticky', () => {
      const entry = entryOf('Held', { keys: ['x'], probability: 1, sticky: 4 });

      for (let seed = 0; seed < 10; seed += 1) {
        const result = scan([bookOf('B', [entry])], ['nothing'], {
          rng: rngOf(seed),
          timing: { [entry.id]: { sticky: 3, cooldown: 0, fired: 1 } },
        });
        expect(firedNames(result)).toEqual(['Held']);
      }
    });
  });

  describe('what it reports about the patterns it could not run', () => {
    it('carries a refused pattern out rather than treating it as a miss', () => {
      const entry = entryOf('Broken', { keys: ['('], useRegex: true });
      const result = scan([bookOf('B', [entry])], ['anything']);

      expect(result.refused).toEqual([expect.objectContaining({ key: '(', reason: 'invalid' })]);
      expect(reasonFor(result, 'Broken')).toBe('no-match');
    });

    it('names a source an entry asked for that nobody supplied', () => {
      const entry = entryOf('Looking Elsewhere', {
        keys: ['x'],
        additionalMatchingSources: ['nowhere'],
      });
      const result = scan([bookOf('B', [entry])], ['x']);

      expect(result.unknownSources).toEqual(['nowhere']);
    });
  });

  describe('inScanOrder', () => {
    it('walks the entries in their declared order', () => {
      const entries = [entryOf('C', { order: 3 }), entryOf('A', { order: 1 })];

      expect(inScanOrder(entries).map((one) => one.name)).toEqual(['A', 'C']);
    });

    /**
     * A total order, not a partial one. Two entries at the same `order` have to
     * come out the same way every scan, or a group's fallback and the panel's
     * listing both wobble between runs for no reason a reader could see.
     */
    it('breaks a tie on the id so the order is total', () => {
      const first = entryOf('First', { order: 1, id: 'aaa' });
      const second = entryOf('Second', { order: 1, id: 'bbb' });

      expect(inScanOrder([second, first]).map((one) => one.id)).toEqual(['aaa', 'bbb']);
    });

    it('does not touch the array it was given', () => {
      const entries = [entryOf('C', { order: 3 }), entryOf('A', { order: 1 })];
      inScanOrder(entries);

      expect(entries.map((one) => one.name)).toEqual(['C', 'A']);
    });

    /**
     * And the scan actually uses it. Asserted through `activate` rather than
     * only on the helper, because a sort nothing calls is a sort that passes
     * its own tests while the prompt comes out in file order — which is what a
     * mutation removing the call proved, by surviving.
     */
    it('walks a book in order rather than in the order the file listed', () => {
      const result = scan(
        [
          bookOf('B', [
            entryOf('Third', { keys: ['x'], order: 30 }),
            entryOf('First', { keys: ['x'], order: 10 }),
            entryOf('Second', { keys: ['x'], order: 20 }),
          ]),
        ],
        ['x'],
      );

      expect(firedNames(result)).toEqual(['First', 'Second', 'Third']);
    });
  });
});
