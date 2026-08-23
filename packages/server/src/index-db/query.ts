// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import type { PortableSchemaId } from '@storyengine/shared';

import type { LibraryOwner } from '../storage/layout.js';
import { ownerKey } from './ingest.js';

/**
 * Reading the index.
 *
 * Everything here is a restatement of what is on disk
 * ([02 §5.1](../../../../docs/design/02-data-model.md)) — **nothing is answerable only from
 * the index**, and a feature that needed something to be would be storing data
 * in the wrong place ([13 §5](../../../../docs/design/13-internal-contracts.md)).
 *
 * The merge of a user's library with `system/library/` is a *query*, not a
 * special case, which is the whole reason both have the same layout on disk.
 * That is this file's one structural obligation and `listObjects` is where it
 * is discharged.
 */

export interface IndexedObject {
  path: string;
  id: string;
  owner: string;
  schemaId: string;
  slug: string;
  name: string;
  contentHash: string;
  /**
   * True when another file holds this id at a lexicographically earlier path
   * ([P1 §1.2](../../../../docs/design/workplan/03-p1-implementation.md)).
   *
   * Surfaced rather than filtered: the library shows both with a warning on the
   * shadowed one. Refusing to load either would punish a user for copying a
   * folder, which the design explicitly invites.
   */
  shadowed: boolean;
  body: unknown;
}

interface RawRow {
  path: string;
  id: string;
  owner: string;
  schema_id: string;
  slug: string;
  name: string;
  content_hash: string;
  shadowed: number;
  body: string;
}

/**
 * node:sqlite types a row as `Record<string, SQLOutputValue>`, which does not
 * overlap a named shape closely enough for a direct assertion. One helper, so
 * the widening is written once and is visible rather than sprinkled.
 */
function asRows(result: unknown): RawRow[] {
  return result as RawRow[];
}

function hydrate(row: RawRow): IndexedObject {
  return {
    path: row.path,
    id: row.id,
    owner: row.owner,
    schemaId: row.schema_id,
    slug: row.slug,
    name: row.name,
    contentHash: row.content_hash,
    shadowed: row.shadowed === 1,
    body: JSON.parse(row.body) as unknown,
  };
}

export interface ListQuery {
  /**
   * Which libraries to read. Pass the user's *and* the system owner to get the
   * merged list a library surface shows ([05 §5](../../../../docs/design/05-ui-surfaces.md)).
   */
  owners: LibraryOwner[];
  /**
   * Omit for every kind. Cross-kind reads are a real thing to want — search,
   * counts, an export sweep — and this is not a statement about the browsing
   * surface, which is per kind ([05 §5](../../../../docs/design/05-ui-surfaces.md)).
   */
  schemaId?: PortableSchemaId;
}

export function listObjects(db: DatabaseSync, query: ListQuery): IndexedObject[] {
  const ownerKeys = query.owners.map(ownerKey);
  if (ownerKeys.length === 0) return [];

  const placeholders = ownerKeys.map(() => '?').join(', ');
  const kindClause = query.schemaId ? ' and schema_id = ?' : '';
  const parameters: string[] = [...ownerKeys];
  if (query.schemaId) parameters.push(query.schemaId);

  const rows = db
    .prepare(
      `select * from object
        where tombstoned_at is null and owner in (${placeholders})${kindClause}
        order by name collate nocase, path`,
    )
    .all(...parameters);

  return asRows(rows).map(hydrate);
}

/**
 * The live row for an id, or null.
 *
 * Resolves by **id, never by slug** ([P1 §1.1](../../../../docs/design/workplan/03-p1-implementation.md)).
 * That is what keeps a foreign rename an update to an existing row rather than
 * the creation of a second object, and it is why the folder name is free to
 * drift from the object's name.
 */
export function findById(db: DatabaseSync, id: string): IndexedObject | null {
  const row = db
    .prepare(
      `select * from object
        where id = ? and tombstoned_at is null
        order by shadowed, path limit 1`,
    )
    .get(id) as RawRow | undefined;

  return row ? hydrate(row) : null;
}

/**
 * A specific copy of a duplicated id, addressed by where it lives.
 *
 * `findById` answers with the *winner* — the earliest path — which is right for
 * every ordinary reference and wrong for exactly one case: the list shows both
 * copies of a duplicated id, warns about the shadowed one, and then had no way
 * to open it (F19). Following that row's link opened the winner while the page
 * said otherwise.
 *
 * Discriminated by `(owner, slug)` rather than by the stored path, because the
 * path is the *native* absolute one — it differs by platform, and ordering over
 * it is why the shadow winner itself is platform-divergent (F23). The slug is
 * the folder name, which is the portable half and the same string on both.
 */
export function findByIdAt(
  db: DatabaseSync,
  id: string,
  at: { owner: string; slug: string },
): IndexedObject | null {
  const row = db
    .prepare(
      `select * from object
        where id = ? and owner = ? and slug = ? and tombstoned_at is null
        limit 1`,
    )
    .get(id, at.owner, at.slug) as RawRow | undefined;

  return row ? hydrate(row) : null;
}

export function findByPath(db: DatabaseSync, path: string): IndexedObject | null {
  const row = db
    .prepare('select * from object where path = ? and tombstoned_at is null')
    .get(path) as RawRow | undefined;

  return row ? hydrate(row) : null;
}

/**
 * Full-text search across the indexed objects.
 *
 * FTS5 ([07 §7](../../../../docs/design/07-tech-stack.md)). Turn text joins this at P2 —
 * the table exists, nothing writes to it yet.
 */
export function search(db: DatabaseSync, term: string, limit = 50): IndexedObject[] {
  const rows = db
    .prepare(
      `select object.* from object_fts
         join object on object.path = object_fts.path
        where object_fts match ? and object.tombstoned_at is null
        order by rank limit ?`,
    )
    .all(term, limit);

  return asRows(rows).map(hydrate);
}

/**
 * A deterministic dump of every live row, for the CI gate.
 *
 * `mtime_ms` and `size` are deliberately absent. They are properties of the
 * file rather than of the object, and a rebuild reads them fresh — including
 * them would make *rebuild equals incremental* fail for a reason that is not a
 * defect. What must agree is the content: which objects exist, where, under
 * what id, and which of a duplicated pair is shadowed.
 */
export function snapshot(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      `select path, id, owner, schema_id, slug, name, content_hash, shadowed, body
         from object where tombstoned_at is null order by path`,
    )
    .all();

  return asRows(rows).map((row) =>
    [
      row.path,
      row.id,
      row.owner,
      row.schema_id,
      row.slug,
      row.name,
      row.content_hash,
      String(row.shadowed),
      row.body,
    ].join(' | '),
  );
}
