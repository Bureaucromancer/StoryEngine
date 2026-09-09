// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  normaliseTagName,
  sameTag,
  uuidv7,
  type PortableSchemaId,
  type TagEntry,
} from '@storyengine/shared';

import { list, LibraryError, update, type LibraryContext } from '../library.js';
import type { TagStore } from './store.js';

/**
 * Adoption — [25 §3](../../../../docs/design/25-tagging.md).
 *
 * **One deliberate, visible pass, and then renaming is free.** An object with no
 * `tagIds` works exactly as it always did, from its names; it just cannot
 * benefit from a rename, because nothing connects the name it holds to the
 * registry row that changed. This walks the library once, mints a registry entry
 * for every name it has not seen, and stamps the ids alongside the names.
 *
 * **Why a button and not a migration on startup.** It is a write across the
 * whole library, and a write across the whole library is a thing somebody should
 * ask for rather than discover — every object it touches gains a history entry,
 * and a server that did that on first boot after an upgrade would be a server
 * that rewrote a person's files without being asked.
 *
 * **Idempotent, and that is load-bearing rather than tidy.** Running it twice
 * mints nothing and writes nothing: an object whose ids already resolve to its
 * own names is skipped before `update` is called, so a second run is free and a
 * half-finished first run can simply be repeated.
 */

export interface AdoptionReport {
  /** Objects that gained ids, by kind and id. */
  adopted: { kind: string; id: string; name: string }[];
  /** Registry entries this pass created, because nothing had named them before. */
  minted: string[];
  /** Objects it could not write, and why — system-owned, or moved underneath it. */
  skipped: { kind: string; id: string; name: string; reason: string }[];
  /** Objects that were already adopted and correct. */
  unchanged: number;
}

export async function adoptLibraryTags(
  library: LibraryContext,
  tags: TagStore,
  handle: string,
): Promise<AdoptionReport> {
  const report: AdoptionReport = { adopted: [], minted: [], skipped: [], unchanged: 0 };

  /**
   * **Every name first, then one registry write, then the objects.**
   *
   * Minting inside the per-object loop would be a registry write per object,
   * each one a read-modify-write through the queue — and a run over two hundred
   * objects would be two hundred rewrites of the same small file. It also makes
   * the mint atomic: either the vocabulary is there or the pass did nothing.
   */
  const rows = list(library, handle);
  const wanted = new Set<string>();
  for (const row of rows) {
    if (row.owner === 'system') continue;
    for (const name of tagNamesOf(row.body)) wanted.add(name);
  }

  const registry = await tags.mutate(handle, (current) => {
    const minted: TagEntry[] = [];
    for (const name of wanted) {
      if (current.tags.some((tag) => sameTag(tag.name, name))) continue;
      if (minted.some((tag) => sameTag(tag.name, name))) continue;
      minted.push({
        id: uuidv7(),
        name,
        swatch: null,
        sortOrder: current.tags.length + minted.length,
        folder: 'none',
        hidden: false,
        createdAt: new Date().toISOString(),
      });
    }
    report.minted = minted.map((tag) => tag.name);
    return [...current.tags, ...minted];
  });

  const byName = new Map(registry.tags.map((tag) => [tag.name.toLowerCase(), tag.id]));

  for (const row of rows) {
    if (row.owner === 'system') {
      // Read-only and replaced by the next release ([05 §4.2]). Reported rather
      // than swallowed: a tag used only by the system library is still in use,
      // and somebody counting will want to know why it has no ids.
      if (tagNamesOf(row.body).length > 0) {
        report.skipped.push({
          kind: row.schemaId,
          id: row.id,
          name: row.name,
          reason: 'System library objects cannot be edited.',
        });
      }
      continue;
    }

    const names = tagNamesOf(row.body);
    const ids = names.map((name) => byName.get(name.toLowerCase()) ?? '');
    if (ids.some((id) => id === '')) {
      // Unreachable unless the mint above missed a name, which would be a bug
      // rather than a state. Reported instead of written, because writing a
      // blank id would be worse than leaving the object as it is.
      report.skipped.push({
        kind: row.schemaId,
        id: row.id,
        name: row.name,
        reason: 'A tag on this object has no registry entry.',
      });
      continue;
    }

    if (alreadyAdopted(row.body, ids)) {
      report.unchanged += 1;
      continue;
    }

    try {
      await update(
        library,
        handle,
        row.id,
        { ...(row.body as Record<string, unknown>), tagIds: ids },
        row.contentHash,
        { source: { kind: 'manual' }, reason: 'Adopted tags into the registry' },
        row.schemaId as PortableSchemaId,
      );
      report.adopted.push({ kind: row.schemaId, id: row.id, name: row.name });
    } catch (error) {
      /**
       * **Reported, never thrown.** There is no cross-file transaction here and
       * there should not be — files on disk are the truth and the atomic unit is
       * one file. So the pass is ordered, best-effort and fully reported, and a
       * second run picks up whatever the first could not write.
       */
      report.skipped.push({
        kind: row.schemaId,
        id: row.id,
        name: row.name,
        reason: error instanceof LibraryError ? error.message : 'The object could not be written.',
      });
    }
  }

  return report;
}

/** An object's tag names, read defensively — a hand-edited file is invited input. */
function tagNamesOf(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const tags = (body as Record<string, unknown>)['tags'];
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => normaliseTagName(tag))
    .filter((tag) => tag !== '');
}

/** Whether this object already carries exactly these ids, in this order. */
function alreadyAdopted(body: unknown, ids: readonly string[]): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const held = (body as Record<string, unknown>)['tagIds'];
  if (!Array.isArray(held) || held.length !== ids.length) return false;
  return held.every((id, index) => id === ids[index]);
}
