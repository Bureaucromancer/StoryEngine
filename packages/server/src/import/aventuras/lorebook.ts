// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  newLoreEntry,
  newLorebook,
  type ImportNote,
  type LoreEntry,
  type Lorebook,
} from '@storyengine/shared';

import { distinctIds, stableId } from '../identity.js';
import { parsed, refused, type ParseOutcome } from '../parse.js';

import { isAventurasLorebook, isRecord, note, strings, text } from './shapes.js';

/**
 * Aventuras' *own* lorebook format — a bare `Entry[]` array — → `Lorebook`.
 *
 * **The path [P4 §1.5] thought was already closed.** That stage found Aventuras
 * exports lorebooks *as SillyTavern files* and concluded its lore arrives
 * through `convertLorebook` with **no Aventuras-specific code at all** — *"the
 * best possible answer to the gating question, and one nothing in this plan
 * anticipated."* True, and one of three: `export/formats.ts` offers `aventura`,
 * `sillytavern` and `text`, and `exportToAventura` is
 * `JSON.stringify(entries, null, 2)`.
 *
 * So a person who picked the default format in Aventuras' own export dialog got
 * a file this build could not read, and could not be *told* it could not read:
 * `readUpload` rejects a top-level array before the probe table is reached, so
 * the answer was `unrecognised` with no note naming the format. That is the
 * silent arm [P4 §1.8] spends its argument on, arriving through a door nobody
 * had checked.
 *
 * **What is taken, and what is not.** Aventuras' `Entry` unifies a lorebook
 * entry with the thing that tracks its state — [01 §2] calls that *"a genuinely
 * good idea"* and it is the seed of the channel model in
 * [06](../../../../../docs/design/06-modes-and-turn-pipeline.md). Only the
 * static half converts. The typed per-entry `state`, `adventureState` and
 * `creativeState` are channel-shaped and belong to a session rather than to a
 * book — [04 §5] is explicit that an exported lorebook must not carry somebody's
 * playthrough — so they are preserved in the entry's `metadata` and reported,
 * never promoted to fields.
 */

export interface ConvertedAventurasLorebook {
  lorebook: Lorebook;
  notes: ImportNote[];
}

/** Read per entry, and so not also preserved into its `metadata`. */
const CONSUMED = new Set([
  'id',
  'storyId',
  'name',
  'type',
  'description',
  'hiddenInfo',
  'aliases',
  'injection',
]);

/** Carried to `metadata` and named in the review, rather than dropped or promoted. */
const SESSION_STATE = ['state', 'adventureState', 'creativeState'] as const;

export function convertAventurasLorebook(
  input: unknown,
  fallbackName: string,
): ParseOutcome<ConvertedAventurasLorebook> {
  if (!isAventurasLorebook(input)) return refused('wrong-shape');
  return parsed(convertAventurasEntries(input, fallbackName));
}

/**
 * ***The conversion without the recognition*** — split out at
 * [P13.4](../../../../../docs/design/workplan/30-p13-aventuras-import.md) for
 * `vault-lorebook.ts`, which has a `lorebook_vault` row in hand rather than a
 * file.
 *
 * {@link isAventurasLorebook} is the question *is this file an Aventuras
 * lorebook?*, and it answers from the first element, so an empty array is not
 * one — nothing to import and nothing to identify it by. That is right for a
 * file and wrong for a row: a vault book with no entries yet *exists*, a person
 * made it and named it, and a row that is already known to be a lorebook does
 * not need its first entry to vouch for it. So the row's reader asks nothing
 * of the array but that it is one, and an empty book imports as an empty book.
 *
 * `bookName` names the book and namespaces its entries' derived ids, so it
 * must be the same on every import of the same book.
 *
 * ***`idSpace`, when given, namespaces the ids instead, by each row's own
 * id*** — [P13.12](../../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * for a story's world. A vault book's ids come from its name and each entry's,
 * which is what a file has; so two books of one name derive the same ids,
 * which P13.4 recorded as harmless in a book and not in a session, because
 * `se.lore.timing` is keyed by entry id alone ([P13 §0.5]). A story's rows
 * *have* ids — Aventuras' uuids, which survive a rename — so an entry of the
 * story's book is `stableId('aventuras-entry', idSpace, rowId)`: the space is
 * the story's own row key and the table (`aventura.db/stories/<id>/locations`),
 * so no vault book, no other story and no other kind of row can derive it,
 * and renaming a place in Aventuras keeps the entry's id — and its timing —
 * rather than re-deriving it. A row with no id falls back to the name, in the
 * same space.
 */
export function convertAventurasEntries(
  input: readonly unknown[],
  bookName: string,
  idSpace?: string,
): ConvertedAventurasLorebook {
  const notes: ImportNote[] = [];
  const lorebook = newLorebook(bookName);

  // A row that is not a record is one this reader cannot read, and it costs
  // that row alone: named by its place, the way Marinara's reader names an
  // unreadable row by its id, rather than a throw that stops the sweep.
  const rows: Record<string, unknown>[] = [];
  for (const [index, row] of input.entries()) {
    if (isRecord(row)) rows.push(row);
    else notes.push(note('import.row.unreadable', { table: bookName, row: index + 1 }, 'warn'));
  }

  let carriedState = 0;
  lorebook.entries = rows.map((row) => {
    const entry = convertEntry(row, bookName, idSpace);
    if (SESSION_STATE.some((key) => row[key] !== undefined && row[key] !== null)) carriedState += 1;
    return entry;
  });
  distinctIds(lorebook.entries, 'aventuras-entry', idSpace ?? bookName);

  notes.push(note('import.aventuras.lorebookEntries', { count: lorebook.entries.length }));
  if (carriedState > 0) {
    notes.push(note('import.aventuras.entryStateRecorded', { count: carriedState }, 'warn'));
  }

  return { lorebook, notes };
}

function convertEntry(
  row: Readonly<Record<string, unknown>>,
  book: string,
  idSpace: string | undefined,
): LoreEntry {
  const name = text(row['name']) || 'Entry';
  const entry = newLoreEntry(name);

  /**
   * Derived from the book name and the entry name rather than carried.
   *
   * [04 §5.2] says an entry's `id` *"is unique within one book and carries no
   * meaning beyond it"*, and that an importer may renumber freely — so keeping
   * Aventuras' uuid would be keeping a foreign identifier for no property it
   * buys. Deriving it buys one that matters: the same file converts to the same
   * bytes, which is what makes re-import identity a comparison ([P4 §1.3]).
   */
  const rowId = row['id'];
  entry.id =
    idSpace === undefined
      ? stableId('aventuras-entry', book, name)
      : stableId(
          'aventuras-entry',
          idSpace,
          typeof rowId === 'string' && rowId !== '' ? rowId : name,
        );

  entry.content = text(row['description']);
  entry.keys = keysOf(row, name);

  /**
   * **`aliases` and `keys` are the same field seen twice, and [11 §2] is the
   * reason this is a merge rather than a loss.**
   *
   * Aventuras keeps `aliases` (what a character is called) apart from
   * `injection.keywords` (what fires the entry). Our `keys` is documented as
   * both at once — *"activation triggers to the engine; aliases and index terms
   * to a reader"*, which that note calls the format's happiest accident. So the
   * aliases join the keys, where a reader will find them and the retriever will
   * use them, rather than being dropped for having no field of their own.
   */
  const aliases = strings(row['aliases']);
  if (aliases.length > 0) entry.secondaryKeys = aliases;

  applyInjection(row['injection'], entry);

  /**
   * `hiddenInfo` is *"info the protagonist does not know yet"* and there is no
   * field for it — nor should there be. An entry's `content` is what gets
   * injected, so appending a secret to it would leak it into the prompt, and
   * `description` is read by a router step and never injected as content, so
   * hiding it there would put a secret somewhere a person does not look for one.
   * It goes to `metadata` and the review says the entry has one.
   */
  const hidden = text(row['hiddenInfo']);
  if (hidden.length > 0) entry.metadata = { ...entry.metadata, hiddenInfo: hidden };

  // The closed `EntryType` union becomes our open `tag`. [03 §3.4] chose the
  // free string over a union on exactly this comparison, naming Aventuras'
  // closed one as the thing not to copy.
  const type = text(row['type']);
  if (type.length > 0) entry.tag = type;

  const carried = carriedMetadata(row);
  if (Object.keys(carried).length > 0) entry.metadata = { ...entry.metadata, ...carried };

  return entry;
}

function keysOf(row: Readonly<Record<string, unknown>>, name: string): string[] {
  const injection = row['injection'];
  const keywords = isRecord(injection) ? strings(injection['keywords']) : [];
  // An entry with no keywords at all still needs to be findable, and its name is
  // the term a reader would search for. `convertLorebook` makes the same call.
  return keywords.length > 0 ? keywords : [name];
}

/**
 * `mode` and `priority` → `constant` / `enabled` / `order`.
 *
 * Aventuras collapses into three modes what Marinara and SillyTavern spread
 * across `constant`, `selective` and `disable`, so this expands rather than
 * translates — and the expansion is exactly the one Aventuras' own importer
 * performs in reverse (`determineInjectionMode`, `import/parse.ts`), read off
 * their source rather than guessed.
 */
function applyInjection(value: unknown, entry: LoreEntry): void {
  if (!isRecord(value)) return;

  const mode = text(value['mode']);
  if (mode === 'always') entry.constant = true;
  if (mode === 'never') entry.enabled = false;

  const priority = value['priority'];
  if (typeof priority === 'number' && Number.isFinite(priority)) {
    /**
     * **The sense is inverted, and getting this backwards would be silent.**
     * Aventuras documents `priority` as *"Higher = inject first"*; our `order`
     * is *"lower = earlier"*. Both are legal numbers either way round, so a
     * straight copy produces a book that imports cleanly and orders its context
     * backwards — nothing to see until somebody wonders why the least important
     * entry leads.
     */
    entry.order = 1000 - Math.trunc(priority);
  }
}

function carriedMetadata(row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const carried: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!CONSUMED.has(key) && value !== undefined) carried[key] = value;
  }
  return carried;
}
