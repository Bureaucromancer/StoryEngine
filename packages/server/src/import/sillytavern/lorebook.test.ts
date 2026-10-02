// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { validate } from '@storyengine/shared';

import { malformedInputs } from '../parse.js';
import { convertLorebook } from './lorebook.js';

/**
 * SillyTavern world info → `Lorebook` ([P4 §1.11]).
 *
 * **The decode tables get the most attention here**, because an integer
 * silently reinterpreted is the worst import bug available: the book imports, it
 * validates, and it fires in the wrong place forever. Nothing about the result
 * looks wrong until somebody wonders why an entry stopped appearing.
 */

const ENTRY = {
  uid: 0,
  key: ['docks', 'harbour'],
  keysecondary: ['manifest'],
  comment: 'The docks',
  content: 'The docks run on paperwork and nobody reads it.',
  constant: false,
  selective: true,
  selectiveLogic: 0,
  order: 100,
  position: 0,
  disable: false,
  depth: 4,
  probability: 100,
};

const BOOK = { name: 'Rain City', entries: { '0': ENTRY } };

function convert(overrides: Record<string, unknown> = {}, book: Record<string, unknown> = {}) {
  const result = convertLorebook(
    { ...BOOK, ...book, entries: { '0': { ...ENTRY, ...overrides } } },
    'fallback',
  );
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.value;
}

describe('the numeric decode tables', () => {
  it('decodes selectiveLogic against ST’s own enum, which is not in our order', () => {
    // `world_info_logic` is AND_ANY 0, NOT_ALL 1, NOT_ANY 2, AND_ALL 3. An array
    // indexed by the integer would have been shorter and wrong, which is
    // exactly the shape this test exists to prevent.
    const expected = ['and_any', 'not_all', 'not_any', 'and_all'];

    for (const [code, logic] of expected.entries()) {
      expect(convert({ selectiveLogic: code }).lorebook.entries[0]?.selectiveLogic).toBe(logic);
    }
  });

  it('decodes the four positions that have an arm of ours', () => {
    expect(convert({ position: 0 }).lorebook.entries[0]?.position).toBe('before_char');
    expect(convert({ position: 1 }).lorebook.entries[0]?.position).toBe('after_char');
    expect(convert({ position: 4 }).lorebook.entries[0]?.position).toBe('at_depth');
    expect(convert({ position: 7 }).lorebook.entries[0]?.position).toBe('outlet');
  });

  it('collapses the four that do not, and names the original in the review', () => {
    // Author's-note and example-message positions have no arm of ours. Mapped
    // *and flagged* — never silently reinterpreted, because an entry that used
    // to sit around the author's note is now somewhere else and only its author
    // can say whether that matters.
    for (const [code, original] of [
      [2, 'authors-note-top'],
      [3, 'authors-note-bottom'],
      [5, 'example-messages-top'],
      [6, 'example-messages-bottom'],
    ] as const) {
      const { lorebook, notes } = convert({ position: code });
      const flag = notes.find((n) => n.key === 'import.lore.positionCollapsed');

      expect(lorebook.entries[0]?.position).toBe('after_char');
      expect(flag?.level).toBe('warn');
      expect(flag?.params['original']).toBe(original);
    }
  });
});

describe('the fields whose spelling inverts', () => {
  it('reads ST’s `disable` as our `enabled`, the right way round', () => {
    // The shape a careless converter reads straight through, turning every
    // enabled entry off — and the result validates and imports cleanly.
    expect(convert({ disable: false }).lorebook.entries[0]?.enabled).toBe(true);
    expect(convert({ disable: true }).lorebook.entries[0]?.enabled).toBe(false);
  });

  it('synthesises a role where ST carries none', () => {
    // ST only has roles on at-depth entries; ours is required, and `system` is
    // what an un-roled world-info entry has always effectively been.
    expect(convert().lorebook.entries[0]?.role).toBe('system');
    expect(convert({ role: 1 }).lorebook.entries[0]?.role).toBe('user');
  });
});

describe('what the book itself carries', () => {
  it('validates', () => {
    const result = validate(convert().lorebook);

    expect(result.valid, result.valid ? '' : JSON.stringify(result.issues)).toBe(true);
  });

  it('clamps entryLimit visibly rather than failing the file', () => {
    // The one hard numeric constraint an ST book can trip. Refusing a whole book
    // over a budget number is the wrong trade.
    const { lorebook, notes } = convert({}, { entryLimit: 5000 });

    expect(lorebook.entryLimit).toBe(1000);
    expect(notes.find((n) => n.key === 'import.lore.entryLimitClamped')?.params['from']).toBe(5000);
  });

  it('imports a chat-scoped book as global, and names the drop', () => {
    // `LoreScope` shipped with two arms rather than three: session scoping moved
    // to the session's own lore links, so an ST book bound to a chat has no
    // representable target — and P4 imports no chats for it to bind to anyway.
    const { lorebook, notes } = convert({}, { chatId: 'chat-1' });

    expect(lorebook.scope).toEqual({ kind: 'global' });
    expect(notes.find((n) => n.key === 'import.lore.chatScopeDropped')?.level).toBe('warn');
  });

  it('drops state with a note rather than preserving it as metadata', () => {
    // `metadata` is for what we did not recognise. These are recognised
    // precisely well enough to know they should not be carried: a `dynamicState`
    // imported into a book that never had the runtime that produced it is a lie
    // with a timestamp on it.
    const { lorebook, notes } = convert({ dynamicState: { seen: 3 }, embedding: [0.1] });

    expect(lorebook.entries[0]?.metadata['dynamicState']).toBeUndefined();
    expect(lorebook.entries[0]?.metadata['embedding']).toBeUndefined();
    expect(notes.filter((n) => n.key === 'import.lore.stateDropped')).toHaveLength(2);
  });

  it('preserves what it did not recognise', () => {
    const { lorebook } = convert({ someFutureField: 'kept' });

    expect(lorebook.entries[0]?.metadata['someFutureField']).toBe('kept');
  });

  it('takes entries as an object keyed by uid or as an array', () => {
    // ST writes an object; an entry-subset file may write an array, and
    // [04 §5.2] makes an entry subset a lorebook like any other.
    const asArray = convertLorebook({ name: 'Rain City', entries: [ENTRY] }, 'fallback');

    expect(asArray.ok).toBe(true);
    expect(asArray.ok && asArray.value.lorebook.entries).toHaveLength(1);
  });

  it('gives two blank drafts ids of their own, and leaves a unique one alone', () => {
    /**
     * An id is derived from the entry's name and content, which is the same
     * text twice for two rows somebody made keys for and never wrote: both are
     * *Untitled entry* with nothing in them. They shared an id, so [04 §5.2]'s
     * *unique within one book* was false on import, and the editor opened the
     * first for either (2026-09-27).
     */
    const blank = { ...ENTRY, comment: '', content: '' };
    const result = convertLorebook(
      { name: 'Rain City', entries: [ENTRY, { ...blank, uid: 1 }, { ...blank, uid: 2 }] },
      'fallback',
    );
    const ids = result.ok ? result.value.lorebook.entries.map((entry) => entry.id) : [];

    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe(convert().lorebook.entries[0]?.id);
  });
});

describe('the parses-but-is-wrong table', () => {
  for (const { label, input } of malformedInputs(BOOK, ['entries'])) {
    it(`answers with a status for ${label}`, () => {
      expect(() => convertLorebook(input, 'fallback')).not.toThrow();
      expect(convertLorebook(input, 'fallback').ok).toBe(false);
    });
  }
});

/**
 * **Aventuras' SillyTavern export, which is why this converter reads two
 * spellings** ([P4 §1.5]).
 *
 * The Aventuras survey turned up something better than the extraction path it
 * was gated on: Aventuras exports lorebooks *as SillyTavern files*, so its lore
 * arrives through this converter with no Aventuras-specific code at all. It also
 * exposed a bug — its export writes the book-level settings in snake_case, as
 * the V3 `character_book` spec does, and this read only camelCase. An embedded
 * book's scan depth and budget were being silently replaced by our defaults.
 */
describe('a book written the way the V3 spec and Aventuras write it', () => {
  const AVENTURAS_EXPORT = {
    name: 'Aventura Export',
    description: 'Exported from Aventura',
    scan_depth: 5,
    token_budget: 4096,
    recursive_scanning: true,
    entries: {
      '0': { uid: 0, key: ['rail'], content: 'Pay at the rail.', comment: 'The rail' },
    },
  };

  it('reads the book-level settings in snake_case', () => {
    const result = convertLorebook(AVENTURAS_EXPORT, 'fallback');
    if (!result.ok) throw new Error('refused');

    expect(result.value.lorebook.scanDepth).toBe(5);
    expect(result.value.lorebook.tokenBudget).toBe(4096);
    expect(result.value.lorebook.recursiveScanning).toBe(true);
  });

  it('still reads the camelCase form, which other tools write', () => {
    const result = convertLorebook(
      { name: 'x', scanDepth: 7, tokenBudget: 100, entries: {} },
      'fallback',
    );
    if (!result.ok) throw new Error('refused');

    expect(result.value.lorebook.scanDepth).toBe(7);
    expect(result.value.lorebook.tokenBudget).toBe(100);
  });
});
