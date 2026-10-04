// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newLorebook, type ImportNote, type LoreEntry, type Lorebook } from '@storyengine/shared';

import { distinctIds, stableId } from '../identity.js';
import { parsed, refused, type ParseOutcome } from '../parse.js';

/**
 * SillyTavern world info → `Lorebook`
 * ([P4 §1.11](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **The activation vocabulary carries as-is** — [04 §5] stores every field P5
 * will fire, and P4 only stores them. What the skeleton's *"carried as-is"*
 * glossed is that ST encodes two of those fields as **integers**, and an
 * integer silently reinterpreted is the worst possible import bug: the book
 * imports, validates, and fires in the wrong place forever.
 *
 * So both decodes are explicit tables against the source's own enums, and the
 * positions with no arm of ours are **mapped and flagged**, never quietly
 * reinterpreted.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `world_info_logic`, from `SillyTavern/public/scripts/world-info.js:33` at
 * `06bde939` (1.19.0, unchanged since `8172dcd0`) — and note that the numbers are **not** in the order our union
 * lists them. Writing this as an array indexed by the integer would have been
 * shorter and wrong.
 */
const SELECTIVE_LOGIC: Readonly<Record<number, LoreEntry['selectiveLogic']>> = {
  0: 'and_any',
  1: 'not_all',
  2: 'not_any',
  3: 'and_all',
};

/**
 * `world_info_position`, from the same file at `:855`.
 *
 * Four of the eight map. **Author's note and example-message positions have no
 * arm of ours and collapse to `after_char`** — the nearest sequence arm, since
 * both sit after the character definitions in ST's own assembly — *with a review
 * flag naming the original position*. Mapped-and-flagged rather than silently
 * reinterpreted, because an entry that used to sit around the author's note and
 * now sits after the character is in a different place, and the person who wrote
 * it is the only one who can say whether that matters.
 */
const POSITION: Readonly<Record<number, { position: LoreEntry['position']; flag?: string }>> = {
  0: { position: 'before_char' },
  1: { position: 'after_char' },
  2: { position: 'after_char', flag: 'authors-note-top' },
  3: { position: 'after_char', flag: 'authors-note-bottom' },
  4: { position: 'at_depth' },
  5: { position: 'after_char', flag: 'example-messages-top' },
  6: { position: 'after_char', flag: 'example-messages-bottom' },
  7: { position: 'outlet' },
};

/**
 * The six fields that are **state** rather than configuration, dropped with a
 * review note ([P4 §1.4]).
 *
 * Not `metadata`: metadata is for things we did not recognise, and these are
 * recognised precisely well enough to know they should not be carried. A
 * `dynamicState` imported into a book that never had the runtime that produced
 * it is a lie with a timestamp on it.
 */
const DROPPED_STATE = [
  'dynamicState',
  'quest',
  'embedding',
  'relationships',
  'activationConditions',
  'schedule',
];

/** Fields we read and therefore do not need to preserve as unknown. */
const CONSUMED_ENTRY_FIELDS = new Set([
  'uid',
  'key',
  'keys',
  'keysecondary',
  'comment',
  'content',
  'constant',
  'selective',
  'selectiveLogic',
  'order',
  'position',
  'disable',
  'depth',
  'probability',
  'useProbability',
  'role',
  'group',
  'groupWeight',
  'caseSensitive',
  'matchWholeWords',
  'useRegex',
  'scanDepth',
  'sticky',
  'cooldown',
  'delay',
  'preventRecursion',
  'excludeRecursion',
  'delayUntilRecursion',
  ...DROPPED_STATE,
]);

export interface ConvertedLorebook {
  lorebook: Lorebook;
  notes: ImportNote[];
}

const note = (
  key: string,
  params: ImportNote['params'],
  level: ImportNote['level'] = 'info',
): ImportNote => ({ key, params, level });

export function convertLorebook(input: unknown, name: string): ParseOutcome<ConvertedLorebook> {
  if (!isRecord(input)) return refused('wrong-shape');

  // ST writes `entries` as an object keyed by uid; an entry-subset file may
  // write an array. [04 §5.2] makes an entry subset a lorebook like any other,
  // so both shapes are the same thing arriving differently.
  const raw = input['entries'];
  const rows = Array.isArray(raw) ? raw : isRecord(raw) ? Object.values(raw) : null;
  if (rows === null) return refused('missing-field', 'entries');

  const notes: ImportNote[] = [];
  const lorebook = newLorebook(typeof input['name'] === 'string' ? input['name'] : name);

  lorebook.entries = rows.filter(isRecord).map((row) => convertEntry(row, notes));
  // Two rows of one name and content (blank drafts, most often) would derive
  // one id twice; `distinctIds` says what that cost.
  distinctIds(lorebook.entries, 'entry', lorebook.name);

  applyBookFields(input, lorebook, notes);
  applyScope(input, lorebook, notes);

  return parsed({ lorebook, notes });
}

function convertEntry(row: Record<string, unknown>, notes: ImportNote[]): LoreEntry {
  const name = str(row['comment']) || str(row['name']) || 'Untitled entry';

  const positionCode = num(row['position']) ?? 0;
  const decoded = POSITION[positionCode] ?? { position: 'before_char' as const, flag: 'unknown' };
  if (decoded.flag !== undefined) {
    notes.push(
      note('import.lore.positionCollapsed', { entry: name, original: decoded.flag }, 'warn'),
    );
  }

  for (const field of DROPPED_STATE) {
    if (row[field] !== undefined) {
      notes.push(note('import.lore.stateDropped', { entry: name, field }));
    }
  }

  return {
    /**
     * **Entry ids may be renumbered freely** ([04 §5.2], reaffirmed by
     * [11 §4.1]) — and the same rule is why re-import cannot match *entries* by
     * id, which §1.3's object-level rule works around.
     *
     * Derived rather than minted, though, so converting the same book twice
     * produces the same book: a minted id would make every re-import differ on
     * a field the source never had a say in.
     */
    id: stableId('entry', name, str(row['content'])),
    name,
    content: str(row['content']),
    description: '',

    keys: strings(row['key'] ?? row['keys']),
    secondaryKeys: strings(row['keysecondary']),
    selectiveLogic: SELECTIVE_LOGIC[num(row['selectiveLogic']) ?? 0] ?? 'and_any',
    selective: bool(row['selective'], true),
    matchWholeWords: bool(row['matchWholeWords'], false),
    caseSensitive: bool(row['caseSensitive'], false),
    useRegex: bool(row['useRegex'], false),
    scanDepth: num(row['scanDepth']),

    // ST spells the flag inverted — `disable` rather than `enabled` — which is
    // exactly the shape a careless converter reads straight through, turning
    // every enabled entry off.
    enabled: !bool(row['disable'], false),
    constant: bool(row['constant'], false),
    probability: bool(row['useProbability'], true) ? (num(row['probability']) ?? 100) : null,

    sticky: num(row['sticky']),
    cooldown: num(row['cooldown']),
    delay: num(row['delay']),
    ephemeral: null,

    position: decoded.position,
    outletName: str(row['outletName']) || null,
    depth: num(row['depth']) ?? 4,
    order: num(row['order']) ?? 100,
    /**
     * **Synthesised as `system` where ST carries none** ([P4 §1.11]). ST only
     * has roles on at-depth entries; ours is required, and `system` is what an
     * un-roled world-info entry has always effectively been.
     */
    role: roleOf(row['role']),

    group: str(row['group']) || null,
    groupWeight: num(row['groupWeight']),
    folderId: null,
    actorFilter: null,
    actorTagFilter: null,
    generationTriggerFilter: null,
    additionalMatchingSources: [],

    preventRecursion: bool(row['preventRecursion'], false),
    excludeRecursion: bool(row['excludeRecursion'], false),
    delayUntilRecursion: bool(row['delayUntilRecursion'], false),

    /**
     * Marinara's book-level `category` maps to `tags` on the object, but an
     * *entry* tag is free text and ST has no equivalent field at all — so this
     * stays null rather than being invented from `comment`.
     */
    tag: null,
    media: [],
    /** Nothing imported is agent-locked; locking is something a person does. */
    locked: false,

    // [04 §2]'s preservation rule: what we did not recognise survives, so
    // nothing is lost even where nothing reads it.
    metadata: Object.fromEntries(
      Object.entries(row).filter(([key]) => !CONSUMED_ENTRY_FIELDS.has(key)),
    ),
  };
}

function applyBookFields(
  input: Readonly<Record<string, unknown>>,
  lorebook: Lorebook,
  notes: ImportNote[],
): void {
  const limit = num(input['entryLimit']) ?? num(input['budget']);
  if (limit !== null) {
    /**
     * **`entryLimit` clamps visibly** ([P4 §1.11]). The 1..1000 range is the
     * one hard numeric constraint an ST book can trip, and a bigger source
     * value clamps with a note rather than failing the file — refusing a whole
     * book over a number is the wrong trade when the number is a budget.
     */
    const clamped = Math.min(1000, Math.max(1, Math.floor(limit)));
    lorebook.entryLimit = clamped;
    if (clamped !== Math.floor(limit)) {
      notes.push(note('import.lore.entryLimitClamped', { from: Math.floor(limit), to: clamped }));
    }
  }

  /**
   * **Both spellings, because both occur.** A standalone `worlds/*.json` carries
   * no book-level settings at all — in SillyTavern those are global
   * (`world_info_depth`, `world_info_budget`) — but the **V3 `character_book`
   * spec** does, in snake_case, and so does Aventuras' SillyTavern export.
   * Reading only the camelCase form meant an embedded book's scan depth and
   * budget were silently replaced by our defaults, which is the quiet kind of
   * wrong: the book imports and behaves differently.
   */
  const scanDepth = num(input['scan_depth']) ?? num(input['scanDepth']);
  if (scanDepth !== null) lorebook.scanDepth = scanDepth;
  const budget = num(input['token_budget']) ?? num(input['tokenBudget']);
  if (budget !== null) lorebook.tokenBudget = budget;
  const recursive = input['recursive_scanning'] ?? input['recursiveScanning'];
  if (typeof recursive === 'boolean') lorebook.recursiveScanning = recursive;
}

/**
 * **A chat-scoped book imports as `global`, and the review names the drop.**
 *
 * `LoreScope` shipped with two arms rather than [03 §3.4]'s three: session
 * scoping moved to the session's own lore links, deliberately, because session
 * ids are install-local and a shared book carrying one exports an identifier
 * that is meaningless everywhere else. So an ST book bound to a chat has no
 * representable target — and P4 imports no chats for it to bind to anyway.
 * Character and persona scoping collapse to `linked` with refs that resolve or
 * dangle like any other ([00 §3.3]).
 *
 * **This unconditional `global` is one of the two producers of the default that
 * made [P5.7] go wrong**, and it is worth knowing about here rather than only
 * at the factory. While `scope` selected books, an import turned every book in
 * a SillyTavern folder into one that applied to every session — the exact
 * outcome the reversal removed. It is safe now because nothing reads the field
 * ([03 §3.4]): a lorebook reaches a session by being selected and by nothing
 * else. Anything that gives `scope` a consumer again has to revisit this line
 * and [25 §B15](../../../../../docs/design/25-open-questions.md) together —
 * writing the most permissive value into every imported book is a decision, and
 * currently an unexamined one.
 */
function applyScope(
  input: Readonly<Record<string, unknown>>,
  lorebook: Lorebook,
  notes: ImportNote[],
): void {
  if (input['chatId'] !== undefined || input['chat_id'] !== undefined) {
    notes.push(note('import.lore.chatScopeDropped', { book: lorebook.name }, 'warn'));
  }
  lorebook.scope = { kind: 'global' };
}

function roleOf(value: unknown): LoreEntry['role'] {
  // ST encodes roles as integers on at-depth entries: 0 system, 1 user, 2 assistant.
  if (value === 1 || value === 'user') return 'user';
  if (value === 2 || value === 'assistant') return 'assistant';
  return 'system';
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
