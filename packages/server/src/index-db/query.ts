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
 * ([03 §5.1](../../../../docs/design/03-data-model.md)) — **nothing is answerable only from
 * the index**, and a feature that needed something to be would be storing data
 * in the wrong place ([22 §5](../../../../docs/design/22-internal-contracts.md)).
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
   * ([P1 §1.2](../../../../docs/design/workplan/07-p1-implementation.md)).
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
function asRows<Row = RawRow>(result: unknown): Row[] {
  return result as Row[];
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
   * merged list a library surface shows ([10 §5](../../../../docs/design/10-ui-surfaces.md)).
   */
  owners: LibraryOwner[];
  /**
   * Omit for every kind. Cross-kind reads are a real thing to want — search,
   * counts, an export sweep — and this is not a statement about the browsing
   * surface, which is per kind ([10 §5](../../../../docs/design/10-ui-surfaces.md)).
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
 * Resolves by **id, never by slug** ([P1 §1.1](../../../../docs/design/workplan/07-p1-implementation.md)).
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
 * The object a previous import of the same source file produced, if there is
 * one — [P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md)'s
 * re-import identity rule: **same owner, same kind, same
 * `Provenance.originalFilename`.**
 *
 * That triple is the whole rule, and it is deliberately not id-based. Import
 * mints fresh ids ([P4 §1.3]), because carrying a source id through would let
 * one user's import collide with an object of another's that they cannot see —
 * a hole in the anti-leak posture. And [03 §7.2]'s *link or duplicate* is
 * package posture keyed on shared StoryEngine ids, which foreign files do not
 * carry: a SillyTavern card has no id at all, and a world file's identity *is*
 * its name.
 *
 * Read out of the indexed body rather than a column. The index is derived and
 * rebuildable, so a query is cheaper than a migration — and provenance is
 * already in `body` because the row caches the whole object.
 */
export function findPriorImport(
  db: DatabaseSync,
  owner: string,
  schemaId: string,
  originalFilename: string,
): IndexedObject | null {
  const row = db
    .prepare(
      `select * from object
        where owner = ? and schema_id = ? and tombstoned_at is null
          and json_extract(body, '$.provenance.source') = 'import'
          and json_extract(body, '$.provenance.originalFilename') = ?
        order by shadowed, path limit 1`,
    )
    .get(owner, schemaId, originalFilename) as RawRow | undefined;

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
/**
 * The name half of `Ref` resolution — [03 §11.4], [04 §8].
 *
 * **Case-insensitive in JavaScript rather than in SQL**, which is why this
 * makes two queries instead of one `where lower(name) = lower(?)`. SQLite's
 * `lower()` folds ASCII only, so a book called *Régine's Notes* would fail to
 * match `régine's notes` and the fallback would silently not fall back for
 * exactly the imported, accented, non-English data it exists to rescue.
 * `toLowerCase` is Unicode and locale-independent, which is what an identity
 * comparison wants — `toLocaleLowerCase` would make the answer depend on the
 * server's locale, and a Turkish install would resolve a different book.
 *
 * The names are fetched without their bodies and the winner is read back by
 * path, so scanning a kind costs a column rather than every object's full JSON.
 *
 * Ordered by `shadowed` then `path`, the same tie-break `findById` uses: two
 * files claiming one name is the [P1 §1.2] duplicate case, and the unshadowed
 * one is the one being used.
 */
export function findByName(
  db: DatabaseSync,
  name: string,
  at: { owners: string[]; schemaId: string },
): IndexedObject | null {
  if (at.owners.length === 0) return null;
  const rows = db
    .prepare(
      `select path, name from object
        where owner in (${at.owners.map(() => '?').join(', ')})
          and schema_id = ? and tombstoned_at is null
        order by shadowed, path`,
    )
    .all(...at.owners, at.schemaId) as { path: string; name: string }[];

  const wanted = name.toLowerCase();
  const hit = rows.find((row) => row.name.toLowerCase() === wanted);
  return hit ? findByPath(db, hit.path) : null;
}

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
 * Every row holding an id — the workbench's index-rows projection ([P3.3]).
 *
 * The one reader that does **not** filter tombstones, by decision
 * ([P3 §7.4](../../../../docs/design/workplan/15-p3-implementation.md)): the
 * projection's job is the index *as it is*, and a row inside its settling
 * window is part of that truth for as long as the window lasts. `body` is
 * deliberately not selected — the object's contents are the read route's
 * answer — and `mtime_ms`/`size` stay behind too, being the watcher's
 * change-detection bookkeeping rather than facts about the object. The
 * native `path` is returned for the store to translate; it must never reach
 * a client untranslated (F22).
 */
export interface IdRow {
  path: string;
  owner: string;
  schemaId: string;
  slug: string;
  name: string;
  contentHash: string;
  shadowed: boolean;
  tombstonedAt: number | null;
}

export function rowsForId(db: DatabaseSync, id: string): IdRow[] {
  const rows = db
    .prepare(
      `select path, owner, schema_id, slug, name, content_hash, shadowed, tombstoned_at
         from object where id = ? order by path`,
    )
    .all(id) as {
    path: string;
    owner: string;
    schema_id: string;
    slug: string;
    name: string;
    content_hash: string;
    shadowed: number;
    tombstoned_at: number | null;
  }[];

  return rows.map((row) => ({
    path: row.path,
    owner: row.owner,
    schemaId: row.schema_id,
    slug: row.slug,
    name: row.name,
    contentHash: row.content_hash,
    shadowed: row.shadowed === 1,
    tombstonedAt: row.tombstoned_at,
  }));
}

/**
 * Full-text search across the indexed objects.
 *
 * FTS5 ([20 §7](../../../../docs/design/20-tech-stack.md)). Turn text joins this at P2 —
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

/** One lore entry that matched, with enough to link to it and label it. */
export interface LoreEntryHit {
  /** The book. Half the address, and what the library row is keyed by. */
  objectId: string;
  objectName: string;
  slug: string;
  owner: string;
  /** The other half — `?entry=` on the book's own page ([10 §5.3]). */
  entryId: string;
  entryName: string;
  /** The excerpt around the match, from whichever field matched. */
  snippet: string;
}

/**
 * Lore entries that match, with the excerpt that makes a hit worth returning —
 * [10 §14.5](../../../../docs/design/10-ui-surfaces.md).
 *
 * *"A result that names the book without showing the matched text is what the
 * index gives today and it is close to useless at book scale."* So this is not
 * `search` with a different table under it: the snippet is the point, and the
 * pair `(objectId, entryId)` is the address §14.5's rule — *a fragment is
 * indexable when it has an address* — exists to produce.
 *
 * **`-1` as the snippet's column, and it is not a shortcut.** FTS5 takes a
 * 0-based index over the declared columns and `-1` means *whichever column
 * matched*. Pinning a real index is wrong in a way nothing would report: a hit
 * on `keys` under an index pinned to `content` comes back as the head of the
 * content field with nothing marked in it, which is the exact failure §14.5
 * describes one level down — and a test asserting only that a snippet is a
 * non-empty string passes over it. Pinning past the end throws, and the route
 * turns any throw here into *"that search query could not be parsed"*, so an
 * off-by-one in the server's own SQL would be reported as the user's mistake.
 *
 * **The excerpt comes back unmarked**, with the ellipsis and nothing else.
 * FTS5's markers are inserted literally and are indistinguishable from the same
 * characters occurring in the text, so a marked snippet is a string a renderer
 * has to parse and can be fooled by. The client already marks matches itself —
 * `library/search.ts`'s `highlight` returns runs, and the book page renders
 * them — so returning marked text would hand it a second, incompatible
 * mechanism for the job it already does.
 *
 * **Scoped in SQL, where `search` scopes in the route.** `searchTurns` sets
 * this precedent and the reason to follow it rather than `search` is the
 * `limit`: SQL applies it before the route ever sees a row, so an owner filter
 * applied afterwards silently returns fewer than it should — on a household
 * server with two users, one person's matches can eat the whole limit before
 * the other's are considered. That is a defect `search` has and this need not
 * inherit.
 */
export function searchLoreEntries(
  db: DatabaseSync,
  owners: readonly string[],
  term: string,
  limit = 50,
): LoreEntryHit[] {
  if (owners.length === 0 || term.trim() === '') return [];
  const placeholders = owners.map(() => '?').join(', ');

  const rows = asRows<{
    entry_id: string;
    entry_name: string;
    object_id: string;
    object_name: string;
    slug: string;
    owner: string;
    snippet: string;
  }>(
    db
      .prepare(
        // The FTS table is named rather than aliased on purpose: `match` does
        // not resolve through an alias, and neither does `snippet`'s first
        // argument.
        `select lore_entry.entry_id, lore_entry.name as entry_name,
                object.id as object_id, object.name as object_name,
                object.slug, object.owner,
                snippet(lore_entry_fts, -1, '', '', '…', 20) as snippet
           from lore_entry_fts
           join lore_entry on lore_entry.path = lore_entry_fts.path
                          and lore_entry.position = lore_entry_fts.position
           join object on object.path = lore_entry.path
          where lore_entry_fts match ?
            and object.tombstoned_at is null
            and object.owner in (${placeholders})
          order by rank limit ?`,
      )
      .all(term, ...owners, limit),
  );

  return rows.map((row) => ({
    objectId: row.object_id,
    objectName: row.object_name,
    slug: row.slug,
    owner: row.owner,
    entryId: row.entry_id,
    entryName: row.entry_name,
    snippet: row.snippet,
  }));
}

/**
 * A deterministic dump of every live row, for the CI gate.
 *
 * `mtime_ms` and `size` are deliberately absent. They are properties of the
 * file rather than of the object, and a rebuild reads them fresh — including
 * them would make *rebuild equals incremental* fail for a reason that is not a
 * defect. What must agree is the content: which objects exist, where, under
 * what id, and which of a duplicated pair is shadowed.
 *
 * **And what `object_fts` holds, which this did not cover and had to.**
 * [P5 §1.7](../../../../docs/design/workplan/17-p5-implementation.md) planned to
 * rest a helper on this property — five separate places delete an object's
 * search row by path, every one needs a sibling when a second table pair
 * arrives, and a missed one leaves a stale row in a store whose whole claim is
 * that it is derived and trustworthy. The plan then checked, and §0.4
 * mutation-proved the check: reading the `object` table alone, this could not
 * see a stale search row **at all**, so deleting any one of those five left the
 * named gate and the entire suite green. A helper landed under a property that
 * cannot see it inherits exactly that false confidence.
 *
 * **Two queries, because a search row can go wrong in two directions and a
 * single join sees only one of them.** A left join from `object` catches a row
 * that is *missing* or *duplicated* for an object that exists — which is
 * `upsert`'s failure. It cannot catch a row that *outlived its object*, because
 * there is no object left to join from, and that is what the other four sites
 * are for. So the second query asks the question from the other end: which
 * search rows name a path the `object` table has never heard of.
 *
 * *Note what is deliberately not an orphan.* A **tombstoned** object keeps its
 * search row, and that is the design rather than a leak: the row survives so an
 * add arriving moments later with the same uuid can be recognised as the second
 * half of a rename, `search` joins `object` and filters tombstones out, and
 * `matureTombstones` takes both away together. So the test is *no object row at
 * all*, live or tombstoned — which is also why this function still filters
 * tombstones out of the first query and they simply contribute nothing.
 *
 * `sessionSnapshot` has the first half of this and not the second. Left as it
 * is: turn rows are written once and never moved, so the orphan case has no
 * producer there — but if one ever gains a delete site, that asymmetry is the
 * thing to fix rather than to copy.
 */
export function snapshot(db: DatabaseSync): string[] {
  const rows = asRows<RawRow & { fts_name: string; fts_body: string }>(
    db
      .prepare(
        `select object.path, object.id, object.owner, object.schema_id, object.slug, object.name,
                object.content_hash, object.shadowed, object.body,
                coalesce(object_fts.name, '<none>') as fts_name,
                coalesce(object_fts.body, '<none>') as fts_body
           from object
           left join object_fts on object_fts.path = object.path
          where object.tombstoned_at is null
          order by object.path, fts_name, fts_body`,
      )
      .all(),
  );

  /**
   * A search row whose object is not in the table at all — the shape every
   * delete site but `upsert`'s leaves behind when its sibling is missed.
   *
   * Ordered by every column because FTS5 rows have no inherent order and two of
   * them can share a path; without the extra keys an equality assertion could
   * fail on a permutation of the same content.
   */
  const orphans = asRows<{ path: string; name: string; body: string }>(
    db
      .prepare(
        `select object_fts.path, object_fts.name, object_fts.body
           from object_fts
          where not exists (select 1 from object where object.path = object_fts.path)
          order by object_fts.path, object_fts.name, object_fts.body`,
      )
      .all(),
  );

  return [
    ...rows.map((row) =>
      [
        'object',
        row.path,
        row.id,
        row.owner,
        row.schema_id,
        row.slug,
        row.name,
        row.content_hash,
        String(row.shadowed),
        row.body,
        row.fts_name,
        row.fts_body,
      ].join(' | '),
    ),
    ...orphans.map((row) => ['orphan-fts', row.path, row.name, row.body].join(' | ')),
    ...loreLines(db),
    ...errorLines(db),
  ];
}

/**
 * The files neither producer could read, held to the same answer — [P6B.1].
 *
 * **The gate compared what got indexed and never what did not**, which is how
 * F22's divergence survived: a rebuild refused a folder named `con` and the
 * watcher indexed it, and the two snapshots agreed anyway, because the only
 * row either side could disagree about lived in a table this function did not
 * read. An absence has to be in the comparison or it is not compared.
 *
 * `seen_at` is left out on purpose. It is a clock reading, and the two
 * producers meet the same file at different moments by construction — asserting
 * on it would fail for the one reason that means nothing.
 */
function errorLines(db: DatabaseSync): string[] {
  const rows = asRows<{
    path: string;
    owner: string;
    schema_id: string;
    slug: string;
    reason: string;
  }>(
    db
      .prepare(
        `select path, owner, schema_id, slug, reason
           from file_error order by path`,
      )
      .all(),
  );
  return rows.map((row) =>
    ['file-error', row.path, row.owner, row.schema_id, row.slug, row.reason].join(' | '),
  );
}

/**
 * The lore-entry pair, as two independent lists rather than a join.
 *
 * **Deliberately not joined**, and the reason is a real trap rather than
 * taste: FTS5 columns carry no type affinity and hand back text, so
 * `lore_entry_fts.position = lore_entry.position` compares a string against an
 * integer and quietly matches nothing. A snapshot built on that join would show
 * every entry as missing its text, every time, and would therefore be equally
 * wrong for both producers — agreeing, and saying nothing.
 *
 * Two lists say more anyway. A locator row whose object has gone is a leak in
 * one direction; an FTS row whose locator has gone is a leak in the other; and
 * plain equality between producers catches both without either query having to
 * know what the other found.
 */
function loreLines(db: DatabaseSync): string[] {
  const located = asRows<{
    path: string;
    position: number;
    entry_id: string;
    name: string;
    object_row: string;
  }>(
    db
      .prepare(
        `select lore_entry.path, lore_entry.position, lore_entry.entry_id, lore_entry.name,
                case when exists (select 1 from object where object.path = lore_entry.path)
                     then 'kept' else 'orphan' end as object_row
           from lore_entry
          order by lore_entry.path, lore_entry.position`,
      )
      .all(),
  );

  const text = asRows<{
    path: string;
    position: string;
    name: string;
    keys: string;
    secondary_keys: string;
    description: string;
    content: string;
  }>(
    db
      .prepare(
        `select path, position, name, keys, secondary_keys, description, content
           from lore_entry_fts
          order by path, position, name, content`,
      )
      .all(),
  );

  return [
    ...located.map((row) =>
      ['lore', row.path, String(row.position), row.entry_id, row.name, row.object_row].join(' | '),
    ),
    ...text.map((row) =>
      [
        'lore-fts',
        row.path,
        row.position,
        row.name,
        row.keys,
        row.secondary_keys,
        row.description,
        row.content,
      ].join(' | '),
    ),
  ];
}
