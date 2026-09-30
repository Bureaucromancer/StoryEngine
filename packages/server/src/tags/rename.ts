// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  ACTOR_SCHEMA,
  LOREBOOK_SCHEMA,
  normaliseTagName,
  sameTag,
  type PortableSchemaId,
} from '@storyengine/shared';

import { list, LibraryError, update, type LibraryContext } from '../library.js';
import { TagsError, type TagStore } from './store.js';

/**
 * Renaming a tag — [05 §1](../../../../docs/design/05-tagging.md) and §5.
 *
 * **The registry write is one write, and that is the whole point of ids.** An
 * adopted object references the entry, so changing the entry changes what every
 * carrier is called without touching a single object file.
 *
 * **But §1 is why that is not the end of it.** A lore entry's `actorTagFilter`
 * holds tag *names*, not references — they are author-written strings inside a
 * lorebook, and activation compares them with `includes`, exactly and
 * case-sensitively. A rename that ignored them would silently change which lore
 * fires, which is the failure that section exists to name.
 *
 * So gates are **found and reported always, and rewritten only when asked**.
 * Both directions are defensible and the surface should not choose: an author
 * who wrote a gate on *noir* may have meant that tag, or may have meant that
 * word.
 */

export interface RenameReport {
  /** Lore entries whose actor-tag gate mentions the old name. */
  gatesFound: { book: string; entry: string }[];
  /**
   * ***The actors this rename actually renames*** (2026-09-28): the account's
   * own whose `tagIds` hold the tag, index-aligned with `tags`, which are the
   * only carriers `resolveTagNames` reads through the registry. The question
   * about the gates is worth asking only when this is not zero — see
   * `renameTag`.
   */
  actorsRenamed: number;
  /** Books actually rewritten, when the caller asked for it. */
  booksRewritten: string[];
  /** Books that could not be written, and why. */
  skipped: { id: string; name: string; reason: string }[];
}

/**
 * ***Asked before it is done*** (2026-09-28). The dialog renamed first and
 * offered to rewrite the gates second — and by the second press the registry
 * already held the new name, so the scan for the old one found nothing and
 * *Update them to the new name* rewrote nothing, every time. A `dryRun` scans
 * and counts and moves nothing, so the one real rename can carry the answer.
 *
 * **The clash is checked before the dry run answers**, against the registry it
 * read, so a question about gates is never asked of a rename that is going to
 * be refused. The write keeps its own check inside the mutation, because the
 * registry can change between the two.
 */
export async function renameTag(
  library: LibraryContext,
  tags: TagStore,
  handle: string,
  id: string,
  to: string,
  options: { rewriteGates: boolean; dryRun?: boolean },
): Promise<RenameReport> {
  const { rewriteGates } = options;
  const name = normaliseTagName(to);
  if (name === '') throw new TagsError('invalid', 'A tag needs a name.');

  const before = await tags.read(handle);
  const entry = before.tags.find((tag) => tag.id === id);
  if (!entry) throw new TagsError('not-found', `No tag with id ${id}.`);
  const taken = before.tags.find((tag) => tag.id !== id && sameTag(tag.name, name));
  if (taken) throw new TagsError('conflict', `${taken.name} is already a tag.`);

  const from = entry.name;

  const report: RenameReport = {
    gatesFound: [],
    actorsRenamed: 0,
    booksRewritten: [],
    skipped: [],
  };

  /**
   * **Found before the registry moves.** Once the entry is renamed the old name
   * exists nowhere to search for, so the scan has to happen first — and it has
   * to happen even when nothing will be rewritten, because the count is what
   * the caller is being asked to decide about.
   */
  const rows = list(library, handle);
  const books = rows.filter((row) => row.schemaId === LOREBOOK_SCHEMA);
  for (const book of books) {
    for (const entryName of gatesMentioning(book.body, from)) {
      report.gatesFound.push({ book: book.name, entry: entryName });
    }
  }
  report.actorsRenamed = rows.filter(
    (row) => row.schemaId === ACTOR_SCHEMA && carriesById(row.body, id),
  ).length;

  if (options.dryRun === true) return report;

  await tags.mutate(handle, (current) => {
    const clash = current.tags.find((tag) => tag.id !== id && sameTag(tag.name, name));
    if (clash) {
      // Merging is a different operation with a different answer about what
      // happens to the objects, so this refuses rather than quietly doing it.
      throw new TagsError('conflict', `${clash.name} is already a tag.`);
    }
    return current.tags.map((tag) => (tag.id === id ? { ...tag, name } : tag));
  });

  if (!rewriteGates || report.gatesFound.length === 0) return report;

  for (const book of books) {
    if (book.owner === 'system') {
      if (gatesMentioning(book.body, from).length > 0) {
        report.skipped.push({
          id: book.id,
          name: book.name,
          reason: 'System library objects cannot be edited.',
        });
      }
      continue;
    }
    const rewritten = withRenamedGates(book.body, from, name);
    if (rewritten === null) continue;

    try {
      await update(
        library,
        handle,
        book.id,
        rewritten,
        book.contentHash,
        { source: { kind: 'manual' }, reason: `Renamed tag "${from}" to "${name}"` },
        book.schemaId as PortableSchemaId,
      );
      report.booksRewritten.push(book.name);
    } catch (error) {
      // Ordered, best-effort, fully reported — there is no cross-file
      // transaction and the registry has already moved, which is safe: a book
      // this pass could not write simply keeps a gate on the old word, and the
      // report says which.
      report.skipped.push({
        id: book.id,
        name: book.name,
        reason: error instanceof LibraryError ? error.message : 'The book could not be written.',
      });
    }
  }

  return report;
}

/** The names of entries whose actor-tag gate mentions this tag. */
function gatesMentioning(body: unknown, name: string): string[] {
  return entriesOf(body)
    .filter((entry) => valuesOf(entry).some((value) => value === name))
    .map((entry) => (typeof entry['name'] === 'string' ? entry['name'] : ''));
}

/**
 * The book with its gates renamed, or null when none of them mention the name.
 *
 * **Compared exactly**, because that is how activation compares them: a gate on
 * `Noir` is a different gate from one on `noir`, and rewriting both would be
 * this function deciding something the author did not.
 */
function withRenamedGates(body: unknown, from: string, to: string): Record<string, unknown> | null {
  const entries = entriesOf(body);
  if (!entries.some((entry) => valuesOf(entry).some((value) => value === from))) return null;

  return {
    ...(body as Record<string, unknown>),
    entries: entries.map((entry) => {
      const values = valuesOf(entry);
      if (!values.some((value) => value === from)) return entry;
      const filter = entry['actorTagFilter'] as Record<string, unknown>;
      return {
        ...entry,
        actorTagFilter: { ...filter, values: values.map((value) => (value === from ? to : value)) },
      };
    }),
  };
}

/**
 * Whether an object carries this tag **by its id** — adopted, with `tagIds`
 * index-aligned with `tags`. Anything else is read from its own names
 * (`resolveTagNames`), so a rename of the registry row does not reach it.
 */
function carriesById(body: unknown, id: string): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const { tags, tagIds } = body as { tags?: unknown; tagIds?: unknown };
  if (!Array.isArray(tags) || !Array.isArray(tagIds)) return false;
  if (tags.length !== tagIds.length) return false;
  return tagIds.includes(id);
}

function entriesOf(body: unknown): Record<string, unknown>[] {
  if (typeof body !== 'object' || body === null) return [];
  const entries = (body as Record<string, unknown>)['entries'];
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
}

function valuesOf(entry: Record<string, unknown>): string[] {
  const filter = entry['actorTagFilter'];
  if (typeof filter !== 'object' || filter === null) return [];
  const values = (filter as Record<string, unknown>)['values'];
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === 'string');
}
