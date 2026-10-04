// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLorebook, newLoreEntry, type Lorebook, type LoreEntry } from '@storyengine/shared';

import { marinaraFixture } from '../import/fixtures/test-marinara.js';
import { sillyTavernFixture } from '../import/fixtures/test-sillytavern.js';
import { convertLorebook as convertMarinara } from '../import/marinara/lorebook.js';
import { convertLorebook as convertSillyTavern } from '../import/sillytavern/lorebook.js';
import { matchEntry, type ScanInput } from './match.js';

/**
 * The matching engine — [P5.4].
 *
 * **The imported corpus is the test input, and the stage says why**: P4's
 * converters decode `selectiveLogic` from two different integer encodings and
 * collapse positions from two different tables, so *a matcher tested only
 * against entries this repository wrote is a matcher tested against its own
 * assumptions*. The first `describe` below is therefore the load-bearing one —
 * it runs against what the converters actually produce — and the hand-built
 * cases after it exist to pin the individual rules the corpus only exercises in
 * combination.
 */

function scan(text: string, over: Partial<ScanInput> = {}): ScanInput {
  return { messages: [text], ...over };
}

function entry(over: Partial<LoreEntry> = {}): LoreEntry {
  return { ...newLoreEntry('An entry'), ...over };
}

function book(over: Partial<Lorebook> = {}): Lorebook {
  return { ...newLorebook('Ardent'), ...over };
}

/** The Rain City book as SillyTavern wrote it, through the real converter. */
function importedFromSillyTavern(): Lorebook {
  const raw = JSON.parse(sillyTavernFixture()['worlds/Rain City.json'] as string) as unknown;
  const outcome = convertSillyTavern(raw, 'Rain City');
  if (!outcome.ok) throw new Error(`the fixture would not convert: ${outcome.refusal}`);
  return outcome.value.lorebook;
}

/** The same book as Marinara stored it, through the other converter. */
function importedFromMarinara(): Lorebook {
  const files = marinaraFixture();
  const parse = (path: string): unknown => JSON.parse(files[path] as string) as unknown;
  const outcome = convertMarinara(
    (parse('storage/tables/lorebooks.json') as unknown[])[0],
    parse('storage/tables/lorebook_entries.json') as unknown[],
    parse('storage/tables/lorebook_folders.json') as unknown[],
  );
  if (!outcome.ok) throw new Error(`the fixture would not convert: ${outcome.refusal}`);
  return outcome.value.lorebook;
}

describe('against entries the converters produced', () => {
  /**
   * **The case that would have shipped broken.** Both SillyTavern entries carry
   * `selective: true` with an empty `keysecondary`. Read literally, `and_any`
   * means *at least one secondary matched*, which over an empty list is
   * vacuously false — so a matcher built from the schema alone makes every one
   * of those entries dead, and every book imported from ST with it. The corpus
   * is what says so; no hand-written entry would have.
   */
  it('fires a selective entry whose secondary list is empty', () => {
    const imported = importedFromSillyTavern();
    const docks = imported.entries.find((each) => each.name === 'The docks');

    expect(docks?.selective).toBe(true);
    expect(docks?.secondaryKeys).toEqual([]);
    expect(matchEntry(imported, docks!, scan('down at the docks, after dark')).outcome).toBe(
      'matched',
    );
  });

  it('reports which of the entry’s own keys hit', () => {
    const imported = importedFromSillyTavern();
    const docks = imported.entries.find((each) => each.name === 'The docks')!;

    // The fixture's keys are `docks` and `harbour`; the second one is the test,
    // because a matcher that only ever consulted the first would pass on the
    // first.
    expect(matchEntry(imported, docks, scan('the harbour was quiet')).by).toMatchObject({
      key: 'harbour',
      source: 'message',
    });
  });

  it('says nothing matched when nothing does', () => {
    const imported = importedFromSillyTavern();
    const council = imported.entries.find((each) => each.name === 'The council')!;

    expect(matchEntry(imported, council, scan('a quiet morning')).outcome).toBe('no-match');
  });

  /**
   * The other converter, over the other storage shape, decoding
   * `selectiveLogic` from a **string** where SillyTavern gives an integer. Both
   * have to land on the same union or this file is testing one importer.
   */
  it('matches an entry the Marinara converter produced', () => {
    const imported = importedFromMarinara();
    const [docks] = imported.entries;

    expect(docks?.keys).toContain('docks');
    expect(matchEntry(imported, docks!, scan('paperwork at the docks')).outcome).toBe('matched');
  });

  /**
   * **The two converters have to agree**, which is the sharpest thing this
   * fixture pair can be asked. The same book stored two ways, matched against
   * the same sentence, must reach the same verdict — and a difference here is
   * a decoding difference rather than a matcher difference, which is exactly
   * the class of bug the stage says hand-written entries cannot find.
   */
  it('reaches the same verdict for the same book stored two ways', () => {
    const line = 'the docks run on paperwork';
    const fromSillyTavern = importedFromSillyTavern();
    const fromMarinara = importedFromMarinara();

    const a = matchEntry(
      fromSillyTavern,
      fromSillyTavern.entries.find((each) => each.name === 'The docks')!,
      scan(line),
    );
    const b = matchEntry(fromMarinara, fromMarinara.entries[0]!, scan(line));

    expect(a.outcome).toBe(b.outcome);
    expect(a.by?.key).toBe(b.by?.key);
  });
});

describe('the three per-entry flags', () => {
  it('ignores case unless the entry asks not to', () => {
    const insensitive = entry({ keys: ['Harbour'] });
    const sensitive = entry({ keys: ['Harbour'], caseSensitive: true });

    expect(matchEntry(book(), insensitive, scan('the harbour')).outcome).toBe('matched');
    expect(matchEntry(book(), sensitive, scan('the harbour')).outcome).toBe('no-match');
    expect(matchEntry(book(), sensitive, scan('the Harbour')).outcome).toBe('matched');
  });

  it('matches whole words by default and inside one when told to', () => {
    // `matchWholeWords` defaults to true, which is why `dockside` is the case:
    // the substring reading fires and the word reading does not.
    const whole = entry({ keys: ['docks'] });
    const partial = entry({ keys: ['docks'], matchWholeWords: false });

    expect(matchEntry(book(), whole, scan('the dockside warehouses')).outcome).toBe('no-match');
    expect(matchEntry(book(), whole, scan('the docks, after dark')).outcome).toBe('matched');
    expect(matchEntry(book(), partial, scan('the dockside warehouses')).outcome).toBe('matched');
  });

  /**
   * ***A word is a word in every script*** (2026-09-30): a vowel sign is a
   * combining mark, and a mark belongs to its word — so a Devanagari key fires
   * on its own word and not inside a longer one (UAX #29 WB4, the rule the
   * speakers already read names by).
   */
  it('matches a whole word whose next letter is a combining mark as one word', () => {
    const ram = entry({ keys: ['राम'] });

    expect(matchEntry(book(), ram, scan('उसने रामायण पढ़ी')).outcome).toBe('no-match');
    expect(matchEntry(book(), ram, scan('राम घर गया')).outcome).toBe('matched');
  });

  it('treats a key as a pattern only when the entry says so', () => {
    const literal = entry({ keys: ['ferry(man|boat)'], matchWholeWords: false });
    const pattern = entry({ keys: ['ferry(man|boat)'], useRegex: true });

    expect(matchEntry(book(), literal, scan('the ferryboat')).outcome).toBe('no-match');
    expect(matchEntry(book(), pattern, scan('the ferryboat')).outcome).toBe('matched');
  });

  /**
   * A pattern already says where its own boundaries are, so wrapping it in an
   * implicit `\b…\b` would change what the author wrote. Asserted because
   * `matchWholeWords` defaults to **true**, so this is the arm that runs unless
   * somebody turned it off.
   */
  it('does not impose whole words on a pattern', () => {
    const pattern = entry({ keys: ['dock'], useRegex: true, matchWholeWords: true });

    expect(matchEntry(book(), pattern, scan('the dockside')).outcome).toBe('matched');
  });

  it('respects case sensitivity in a pattern too', () => {
    const sensitive = entry({ keys: ['Harbour'], useRegex: true, caseSensitive: true });
    const insensitive = entry({ keys: ['Harbour'], useRegex: true });

    expect(matchEntry(book(), sensitive, scan('the harbour')).outcome).toBe('no-match');
    expect(matchEntry(book(), insensitive, scan('the harbour')).outcome).toBe('matched');
  });
});

describe('a pattern that cannot be run', () => {
  const CATASTROPHIC = '(a+)+b';

  /**
   * Gate step 15, at the level that has to carry it: the turn completes, the
   * scan continues, and the entry **reports why** rather than being quietly
   * absent.
   */
  it('does not stop the scan, and says which key was abandoned', () => {
    const hostile = entry({ keys: [CATASTROPHIC, 'harbour'], useRegex: true });

    const result = matchEntry(book(), hostile, scan(`${'a'.repeat(40)} harbour`));

    expect(result.outcome).toBe('matched');
    expect(result.by?.key).toBe('harbour');
    expect(result.refused).toEqual([{ key: CATASTROPHIC, reason: 'timed-out' }]);
  });

  it('reports a malformed pattern without failing the entry', () => {
    const broken = entry({ keys: ['(unclosed'], useRegex: true });

    const result = matchEntry(book(), broken, scan('anything'));

    expect(result.outcome).toBe('no-match');
    expect(result.refused[0]).toMatchObject({ key: '(unclosed', reason: 'invalid' });
  });
});

describe('secondary keys and selective logic', () => {
  const withSecondary = (logic: LoreEntry['selectiveLogic']): LoreEntry =>
    entry({
      keys: ['harbour'],
      secondaryKeys: ['fog', 'night'],
      selective: true,
      selectiveLogic: logic,
    });

  it('and_any needs one of them', () => {
    expect(matchEntry(book(), withSecondary('and_any'), scan('the harbour in fog')).outcome).toBe(
      'matched',
    );
    expect(matchEntry(book(), withSecondary('and_any'), scan('the harbour')).outcome).toBe(
      'held-by-secondary',
    );
  });

  it('and_all needs every one', () => {
    expect(
      matchEntry(book(), withSecondary('and_all'), scan('the harbour in fog at night')).outcome,
    ).toBe('matched');
    expect(matchEntry(book(), withSecondary('and_all'), scan('the harbour in fog')).outcome).toBe(
      'held-by-secondary',
    );
  });

  it('not_any refuses if any of them is there', () => {
    expect(matchEntry(book(), withSecondary('not_any'), scan('the harbour')).outcome).toBe(
      'matched',
    );
    expect(matchEntry(book(), withSecondary('not_any'), scan('the harbour in fog')).outcome).toBe(
      'held-by-secondary',
    );
  });

  it('not_all refuses only when every one is there', () => {
    expect(matchEntry(book(), withSecondary('not_all'), scan('the harbour in fog')).outcome).toBe(
      'matched',
    );
    expect(
      matchEntry(book(), withSecondary('not_all'), scan('the harbour in fog at night')).outcome,
    ).toBe('held-by-secondary');
  });

  it('ignores secondary keys entirely when the entry is not selective', () => {
    const notSelective = entry({
      keys: ['harbour'],
      secondaryKeys: ['fog'],
      selective: false,
      selectiveLogic: 'and_all',
    });

    expect(matchEntry(book(), notSelective, scan('the harbour')).outcome).toBe('matched');
  });

  /**
   * *Matched then held* is the answer somebody debugging selective logic needs,
   * and it is the one `no-match` would hide — so the key that hit travels with
   * the refusal.
   */
  it('says which primary key hit even when the secondary condition held it', () => {
    const held = matchEntry(book(), withSecondary('and_any'), scan('the harbour'));

    expect(held.by).toMatchObject({ key: 'harbour', source: 'message' });
  });
});

describe('how far back it looks', () => {
  const recent = ['the third thing', 'the second thing', 'the first thing'];

  it('reads the book’s depth when the entry has none of its own', () => {
    const shallow = book({ scanDepth: 1 });
    const harbour = entry({ keys: ['first'] });

    expect(matchEntry(shallow, harbour, { messages: recent }).outcome).toBe('no-match');
    expect(matchEntry(book({ scanDepth: 3 }), harbour, { messages: recent }).outcome).toBe(
      'matched',
    );
  });

  it('lets the entry override the book', () => {
    const shallow = book({ scanDepth: 1 });
    const deep = entry({ keys: ['first'], scanDepth: 3 });

    expect(matchEntry(shallow, deep, { messages: recent }).outcome).toBe('matched');
  });

  /**
   * Zero means the whole session at either level. It is the format's convention
   * and not ours to improve — the books carrying it were written elsewhere.
   */
  it('treats zero as the whole session, not as nothing', () => {
    const harbour = entry({ keys: ['first'] });

    expect(matchEntry(book({ scanDepth: 0 }), harbour, { messages: recent }).outcome).toBe(
      'matched',
    );
    expect(
      matchEntry(book({ scanDepth: 5 }), entry({ keys: ['first'], scanDepth: 0 }), {
        messages: recent,
      }).outcome,
    ).toBe('matched');
  });

  it('counts from the most recent message', () => {
    const harbour = entry({ keys: ['third'], scanDepth: 1 });

    expect(matchEntry(book(), harbour, { messages: recent }).outcome).toBe('matched');
  });
});

describe('the places other than messages', () => {
  it('scans a source the entry names', () => {
    const persona = entry({ keys: ['dockhand'], additionalMatchingSources: ['persona'] });

    expect(
      matchEntry(book(), persona, {
        messages: ['nothing here'],
        sources: { persona: 'a dockhand, mostly' },
      }).outcome,
    ).toBe('matched');
  });

  it('reports where the hit was, not just that there was one', () => {
    const persona = entry({ keys: ['dockhand'], additionalMatchingSources: ['persona'] });

    /**
     * ***And where in it, since [P7.7]*** — [P7 §1.7] measured the gap as
     * *"the scanner knows which key fired and in which haystack, never
     * **where**"*, and this is the test whose name already promised the third.
     * The offsets are into the **source's own text**, which is what a highlight
     * over that source needs: `'a dockhand'` puts `dockhand` at 2.
     */
    expect(
      matchEntry(book(), persona, {
        messages: ['nothing'],
        sources: { persona: 'a dockhand' },
      }).by,
    ).toEqual({ key: 'dockhand', source: 'persona', at: { start: 2, end: 10 } });
  });

  /**
   * A source is a place rather than a point in the conversation, so a depth of
   * one does not mean *and none of the sources*. Asserted because the opposite
   * reading is the natural one and would make a shallow book silently ignore
   * every extra source an author configured.
   */
  it('is not narrowed by the scan depth', () => {
    const persona = entry({
      keys: ['dockhand'],
      scanDepth: 1,
      additionalMatchingSources: ['persona'],
    });

    expect(
      matchEntry(book(), persona, {
        messages: ['one', 'two', 'three'],
        sources: { persona: 'a dockhand' },
      }).outcome,
    ).toBe('matched');
  });

  it('names a source it was asked for and not given', () => {
    const persona = entry({ keys: ['dockhand'], additionalMatchingSources: ['persona', 'card'] });

    const result = matchEntry(book(), persona, {
      messages: ['nothing'],
      sources: { persona: 'a clerk' },
    });

    expect(result.outcome).toBe('no-match');
    expect(result.unknownSources).toEqual(['card']);
  });
});

describe('an entry with nothing to match on', () => {
  /**
   * Its own outcome because it is a property of the *entry* rather than of the
   * text, and because it is the commonest reason a newly created entry never
   * fires — `newLoreEntry` makes one with no keys at all.
   */
  it('is told apart from an entry whose keys missed', () => {
    expect(matchEntry(book(), entry({ keys: [] }), scan('anything')).outcome).toBe('no-keys');
    expect(matchEntry(book(), entry({ keys: ['harbour'] }), scan('anything')).outcome).toBe(
      'no-match',
    );
  });
});
