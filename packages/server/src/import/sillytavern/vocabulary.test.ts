// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { SILLYTAVERN_SENSITIVE_FIELDS } from './sensitive-fields.js';
import {
  CHAT_COMPLETION_DEFAULT_PROMPTS,
  CHAT_COMPLETION_MODEL_FIELD,
  CHAT_COMPLETION_ORDER_ID,
  CHAT_PRESET_KEYS,
  GENERATION_TYPE_TRIGGERS,
  LEGACY_PROMPT_ORDER_ID,
  PERSONA_DESCRIPTOR_KEYS,
  SPEC_ENTRY_KEYS,
  ST_DEFAULT_PROMPT_ORDER,
  ST_MODULE_WORLD_INFO,
  ST_SHIPPED_WORLD_INFO,
  SYSPROMPT_KEYS,
  TEXTGEN_KEYS,
  V2_BOOK_EXTENSION_KEYS,
  WI_BOOK_KEYS,
  WI_ENTRY_KEYS,
  WI_ENTRY_TYPES,
} from './vocabulary.js';

/**
 * **What a vendored vocabulary can be wrong about, and what a test can catch**
 * ([P4 §7.19](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * These lists were extracted from SillyTavern's source rather than typed, which
 * removes the transcription error and leaves two that a test can still hold:
 * an edit that drops a name — the list stays plausible and quietly stops
 * recognising a field — and a claim in one list that contradicts another.
 *
 * The sizes below are therefore the point, and every one of them is a count
 * taken from the source at `06bde939`. A refresh that moves one is expected to
 * change the number here in the same commit, which is what makes moving the pin
 * a decision rather than a drift.
 *
 * Duplicates get their own test because a list that gained a name twice has the
 * right length while covering one fewer field — the same failure the size test
 * exists for, wearing a passing size.
 */

const SIZES: readonly [string, readonly unknown[], number][] = [
  // 39 template keys (42 less the 3 `excludeFromTemplate` UI fields), plus
  // `uid`, `displayIndex`, `characterFilter` and `extensions`.
  ['WI_ENTRY_KEYS', WI_ENTRY_KEYS, 43],
  ['WI_BOOK_KEYS', WI_BOOK_KEYS, 4],
  // The 12 SillyTavern's own writer emits, plus the 3 the V2 spec allows.
  ['SPEC_ENTRY_KEYS', SPEC_ENTRY_KEYS, 15],
  ['V2_BOOK_EXTENSION_KEYS', V2_BOOK_EXTENSION_KEYS, 31],
  // 103 in `settingsToUpdate`, 5 shipped-but-unmapped, 3 pre-manager names.
  ['CHAT_PRESET_KEYS', CHAT_PRESET_KEYS, 111],
  ['CHAT_COMPLETION_DEFAULT_PROMPTS', CHAT_COMPLETION_DEFAULT_PROMPTS, 12],
  ['ST_DEFAULT_PROMPT_ORDER', ST_DEFAULT_PROMPT_ORDER, 12],
  // 74 in `setting_names`, plus `rep_pen_size`, `genamt` and `max_length`.
  ['TEXTGEN_KEYS', TEXTGEN_KEYS, 77],
  ['SYSPROMPT_KEYS', SYSPROMPT_KEYS, 3],
  ['PERSONA_DESCRIPTOR_KEYS', PERSONA_DESCRIPTOR_KEYS, 7],
  ['GENERATION_TYPE_TRIGGERS', GENERATION_TYPE_TRIGGERS, 6],
  ['CHAT_COMPLETION_MODEL_FIELD', Object.keys(CHAT_COMPLETION_MODEL_FIELD), 26],
];

describe('the vendored SillyTavern vocabularies are the size they were taken at', () => {
  it.each(SIZES)('%s', (_name, list, expected) => {
    expect(list).toHaveLength(expected);
  });

  it.each(SIZES)('%s holds no name twice', (_name, list) => {
    const names = list.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)));

    expect([...new Set(names)]).toHaveLength(names.length);
  });
});

describe('the vocabularies agree with each other', () => {
  /**
   * The credential list is a subset of the preset keys, which is the check that
   * would have caught either list going stale on its own: a sensitive field
   * SillyTavern renamed would still be stripped by name while no longer being a
   * field any preset carries.
   */
  it('strips only fields a preset actually has', () => {
    const known = new Set<string>(CHAT_PRESET_KEYS);
    const orphans = SILLYTAVERN_SENSITIVE_FIELDS.filter((field) => !known.has(field));

    expect(orphans, `sensitive fields no preset carries: ${orphans.join(', ')}`).toEqual([]);
  });

  /**
   * Every model field a preset can carry belongs to some source, and every
   * source's field is one a preset carries. Both directions, because each one
   * fails differently: an unowned `*_model` key is a provider whose preset would
   * import with no model preference at all, and a source pointing at a field no
   * preset has is a mapping that can never fire.
   */
  it('maps every model field to a source, and every source to a real field', () => {
    const targets = new Set(Object.values(CHAT_COMPLETION_MODEL_FIELD));
    const unowned = CHAT_PRESET_KEYS.filter((key) => key.endsWith('_model') && !targets.has(key));

    expect(unowned, `model fields no source claims: ${unowned.join(', ')}`).toEqual([]);

    const known = new Set<string>(CHAT_PRESET_KEYS);
    const dangling = Object.entries(CHAT_COMPLETION_MODEL_FIELD).filter(
      ([, field]) => !known.has(field),
    );

    expect(dangling, `sources pointing at no preset field: ${dangling.join(', ')}`).toEqual([]);
  });

  /** The order this build reads, and the one it only recognises, are not the same. */
  it('keeps the two prompt-order ids apart', () => {
    expect(CHAT_COMPLETION_ORDER_ID).not.toBe(LEGACY_PROMPT_ORDER_ID);
  });

  /** Every default order entry names a prompt SillyTavern would restore. */
  it('orders only prompts the defaults define', () => {
    const known = new Set<string>(CHAT_COMPLETION_DEFAULT_PROMPTS);
    const unknown = ST_DEFAULT_PROMPT_ORDER.filter((entry) => !known.has(entry.identifier));

    expect(unknown.map((entry) => entry.identifier)).toEqual([]);
  });
});

describe('the two world-info fallbacks are different things', () => {
  /**
   * **The one that would be easy to collapse into a single table.** A key
   * missing from a present `settings.json` falls back to SillyTavern's module
   * defaults, where whole-word matching and recursion are *off*; a tree with no
   * `settings.json` at all is read as a fresh install, where its shipped file
   * turns both *on*. Using one for the other changes how every imported entry
   * matches, in opposite directions depending on which way the mistake goes.
   */
  it('disagrees exactly where SillyTavern disagrees with itself', () => {
    expect(ST_MODULE_WORLD_INFO.matchWholeWords).toBe(false);
    expect(ST_SHIPPED_WORLD_INFO.matchWholeWords).toBe(true);
    expect(ST_MODULE_WORLD_INFO.recursive).toBe(false);
    expect(ST_SHIPPED_WORLD_INFO.recursive).toBe(true);
    expect(ST_MODULE_WORLD_INFO.characterStrategy).not.toBe(
      ST_SHIPPED_WORLD_INFO.characterStrategy,
    );
  });
});

describe('the entry types say which fields mean “ask the install”', () => {
  /**
   * Four fields are declared nullable by SillyTavern itself, and `null` on each
   * of them means *use the global setting* rather than *false*. Pinned here
   * because the whole of the matching fix rests on it, and because the types
   * are the only place the distinction is written down.
   */
  it('keeps the nullable four nullable', () => {
    expect(WI_ENTRY_TYPES.scanDepth).toBe('number?');
    expect(WI_ENTRY_TYPES.caseSensitive).toBe('boolean?');
    expect(WI_ENTRY_TYPES.matchWholeWords).toBe('boolean?');
    expect(WI_ENTRY_TYPES.useGroupScoring).toBe('boolean?');
  });

  it('types every key it lists', () => {
    expect(Object.keys(WI_ENTRY_TYPES)).toEqual([...WI_ENTRY_KEYS]);
  });
});
