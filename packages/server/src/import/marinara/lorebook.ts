// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  newLorebook,
  type ImportNote,
  type LoreEntry,
  type LoreFilter,
  type Lorebook,
} from '@storyengine/shared';

import { distinctIds, stableId } from '../identity.js';
import { parsed, refused, type ParseOutcome } from '../parse.js';

/**
 * Marinara lorebooks → `Lorebook`
 * ([P4 §1.5](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **Nearly free, as the plan predicted, and for a specific reason**: our
 * `LoreEntry` was ported from Marinara's `types/lorebook.ts` close to unchanged
 * ([03 §3]), so this is mostly a rename. Which makes the two places it is *not*
 * a rename the dangerous ones, because everything around them reads as a copy.
 *
 * **`position` is numbered differently from SillyTavern's.** Marinara's
 * `LorebookEntryPosition` is `0 | 1 | 2 | 7` where `2` means *at depth*;
 * SillyTavern's `world_info_position` uses `4` for the same thing and `2` for
 * the top of the author's note. Reusing the ST table here would silently turn
 * every at-depth entry into an after-character one — an entry that imports,
 * validates, and fires in the wrong place. Hence a separate table, and a test
 * whose only job is to catch somebody merging them.
 *
 * **`selectiveLogic` has five arms to our four.** Marinara added `or`; our union
 * took SillyTavern's four. So `or` is mapped and flagged rather than dropped or
 * guessed at.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `LorebookEntryPosition`, from `Marinara-Engine/packages/shared/src/types/lorebook.ts:21`
 * at `34442e26d`. **Not SillyTavern's numbering** — see the module comment.
 */
const POSITION: Readonly<Record<number, LoreEntry['position']>> = {
  0: 'before_char',
  1: 'after_char',
  2: 'at_depth',
  7: 'outlet',
};

/**
 * `SelectiveLogic`, same file at `:17`.
 *
 * Four map. `or` does not: ours is SillyTavern's closed set, where the primary
 * key always has to match and the logic governs the *secondary* keys. Marinara's
 * `or` relaxes that, and the nearest honest arm is `and_any` — flagged, because
 * an entry that used to fire on either key now needs the primary one, and only
 * its author can say whether that matters.
 */
const SELECTIVE_LOGIC: Readonly<Record<string, LoreEntry['selectiveLogic']>> = {
  and: 'and_any',
  and_all: 'and_all',
  not: 'not_any',
  not_all: 'not_all',
};

export interface ConvertedLorebook {
  lorebook: Lorebook;
  notes: ImportNote[];
}

const note = (
  key: string,
  params: ImportNote['params'],
  level: ImportNote['level'] = 'info',
): ImportNote => ({ key, params, level });

/**
 * A book row plus the entry rows that point at it.
 *
 * **Joined by the caller**, because the rows live in two tables and neither
 * knows about the other — which is the shape of every Marinara object and the
 * reason the source reader exists at all ([P4 §1.3]).
 */
export function convertLorebook(
  book: unknown,
  entries: readonly unknown[],
  folders: readonly unknown[] = [],
): ParseOutcome<ConvertedLorebook> {
  if (!isRecord(book)) return refused('wrong-shape');
  if (typeof book['name'] !== 'string') return refused('missing-field', 'name');

  const notes: ImportNote[] = [];
  const lorebook = newLorebook(book['name']);

  lorebook.description = str(book['description']);
  lorebook.enabled = bool(book['enabled'], true);
  // Marinara's *categories* map to `tags`, because `Lorebook.category` was
  // removed deliberately ([24 §2d]) — an organisational field that affected
  // nothing, replaced by the general one.
  const category = str(book['category']);
  if (category.length > 0 && category !== 'uncategorized') lorebook.tags = [category];

  lorebook.folders = folders.filter(isRecord).map((row) => ({
    id: str(row['id']) || stableId('folder', str(row['name'])),
    name: str(row['name']),
    enabled: bool(row['enabled'], true),
    order: num(row['order']) ?? 0,
    parentFolderId: str(row['parentFolderId']) || null,
  }));

  lorebook.entries = entries.filter(isRecord).map((row) => convertEntry(row, notes));
  // As SillyTavern's: one name and one content twice would be one id twice.
  distinctIds(lorebook.entries, 'entry', lorebook.name);

  return parsed({ lorebook, notes });
}

function convertEntry(row: Record<string, unknown>, notes: ImportNote[]): LoreEntry {
  const name = str(row['name']) || 'Untitled entry';

  const positionCode = num(row['position']) ?? 0;
  const position = POSITION[positionCode];
  if (position === undefined) {
    notes.push(note('import.lore.unknownPosition', { entry: name, code: positionCode }, 'warn'));
  }

  const rawLogic = str(row['selectiveLogic']) || 'and';
  const logic = SELECTIVE_LOGIC[rawLogic];
  if (logic === undefined) {
    notes.push(note('import.lore.logicNarrowed', { entry: name, original: rawLogic }, 'warn'));
  }

  return {
    // Renumbered freely ([04 §5.2]) — and derived rather than minted, so a
    // second sweep of the same store produces the same book.
    id: stableId('entry', name, str(row['content'])),
    name,
    content: str(row['content']),
    description: str(row['description']),

    keys: strings(row['keys']),
    secondaryKeys: strings(row['secondaryKeys']),
    selectiveLogic: logic ?? 'and_any',
    selective: bool(row['selective'], true),
    matchWholeWords: bool(row['matchWholeWords'], false),
    caseSensitive: bool(row['caseSensitive'], false),
    useRegex: bool(row['useRegex'], false),
    scanDepth: num(row['scanDepth']),

    enabled: bool(row['enabled'], true),
    constant: bool(row['constant'], false),
    probability: num(row['probability']),

    sticky: num(row['sticky']),
    cooldown: num(row['cooldown']),
    delay: num(row['delay']),
    ephemeral: num(row['ephemeral']),

    position: position ?? 'before_char',
    outletName: str(row['outletName']) || null,
    depth: num(row['depth']) ?? 4,
    order: num(row['order']) ?? 100,
    role: roleOf(row['role']),

    group: str(row['group']) || null,
    groupWeight: num(row['groupWeight']),
    folderId: str(row['folderId']) || null,
    // Mode plus a list, in both models — one of the several places our shape is
    // theirs with different field names.
    actorFilter: filter(row['characterFilterMode'], row['characterFilterIds']),
    actorTagFilter: filter(row['characterTagFilterMode'], row['characterTagFilters']),
    generationTriggerFilter: filter(
      row['generationTriggerFilterMode'],
      row['generationTriggerFilters'],
    ),
    additionalMatchingSources: strings(row['additionalMatchingSources']),

    preventRecursion: bool(row['preventRecursion'], false),
    excludeRecursion: bool(row['excludeRecursion'], false),
    delayUntilRecursion: bool(row['delayUntilRecursion'], false),

    tag: str(row['tag']) || null,
    media: [],
    locked: bool(row['locked'], false),
    metadata: {},
  };
}

function filter(mode: unknown, values: unknown): LoreFilter | null {
  const list = strings(values);
  const named = str(mode);
  if (named !== 'include' && named !== 'exclude') return null;
  if (list.length === 0) return null;
  return { mode: named, values: list };
}

function roleOf(value: unknown): LoreEntry['role'] {
  return value === 'user' || value === 'assistant' ? value : 'system';
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
