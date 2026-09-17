// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import {
  LOREBOOK_SCHEMA,
  PACKAGE_SCHEMA,
  PRESET_SCHEMA,
  SETUP_SCHEMA,
  TREATMENT_SCHEMA,
} from '@storyengine/shared';

/**
 * ***What points at what*** —
 * [03 §10.1](../../../../docs/design/03-data-model.md),
 * [10 §5.2](../../../../docs/design/10-ui-surfaces.md),
 * [P11.7](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **Two surfaces, one query, and [P4 §6.6] said so first**: *"whichever phase
 * builds that panel pays both."* The delete confirmation's *referenced by 12
 * sessions, 3 treatments and 1 package* and the object page's *Used by* are the
 * same question asked at two moments, and the reason they were one debt is that
 * building either separately produces two answers that can disagree about what a
 * reference is.
 *
 * ***A reference is a link somebody authored, not a mention.*** A setup naming a
 * treatment, a session's chosen cast, a treatment's lorebooks, a package's
 * contents — each is a field whose whole purpose is to point. **What is
 * deliberately not here** is text that happens to contain a name: a lore entry
 * mentioning *Vera* is not a reference to the actor, and counting it would make
 * the delete confirmation's number grow with the prose rather than with the
 * links. That is the same line [10 §14.5] draws for indexing fragments — *a
 * fragment is indexable when it has an address* — read from the other end.
 *
 * ***Deleting is not blocked by it, and that is [03 §10.2]'s posture.*** Delete
 * is a move to trash until the retention window closes, so the count is
 * information rather than a gate: a person deleting an actor twelve sessions
 * use should be told, and then allowed to do it.
 */

/** A reference one file makes to one object. */
export interface Link {
  fromKind: string;
  fromId: string;
  fromName: string;
  owner: string;
  toId: string;
}

/**
 * The ids a portable object points at, by kind.
 *
 * ***Hand-written per kind rather than walked generically***, and the
 * alternative is worth naming because it looks principled: collecting every
 * `{ id, name }` shaped value anywhere in the document. That would scoop up the
 * object's **own** id, every lore entry's id, every tag's, and every folder's —
 * producing a table where a book references its own entries, which is not what
 * *used by* means and not a number anybody could act on. The kinds are five and
 * the fields are named in the schemas; enumerating them is cheaper than the
 * rule that would have to exclude the rest.
 */
export function referencesIn(schemaId: string, payload: unknown): string[] {
  /**
   * ***A guard for something that cannot happen, in a build whose storage
   * design invites it.*** `ingestFile` validates before reaching here, so a
   * malformed payload is unreachable through the one production caller — and
   * this whole index is fed by files people hand-edit, which is the reason
   * every other reader in it is defensive too. A throw here would take a
   * rebuild down over one bad file.
   */
  if (typeof payload !== 'object' || payload === null) return [];
  const object = payload as Record<string, unknown>;
  const found: (string | undefined)[] = [];

  if (schemaId === SETUP_SCHEMA) {
    found.push(refId(object['treatment']), refId(object['preset']));
    found.push(...setupCastIds(object['cast']));
    found.push(...loreIds(object['lore']));
  } else if (schemaId === TREATMENT_SCHEMA) {
    found.push(...loreIds(object['lore']));
    // A treatment's cast is a list of entries rather than a persona-plus-actors
    // pair, so it is read as a list of refs.
    found.push(...asArray(object['cast']).map((entry) => refId(entryRef(entry))));
  } else if (schemaId === PACKAGE_SCHEMA) {
    found.push(...asArray(object['contents']).map((one) => idOf(one)));
  } else if (schemaId === LOREBOOK_SCHEMA || schemaId === PRESET_SCHEMA) {
    /**
     * **Neither points at anything, and saying so is the point.** A lorebook's
     * entries and a preset's blocks are *inside* the object, so a table that
     * recorded them would answer *used by* with the object's own contents —
     * which is the failure the generic walk above would have had, arriving
     * through the one kind where it looks most reasonable.
     */
    return [];
  }

  return [...new Set(found.filter((id): id is string => typeof id === 'string' && id !== ''))];
}

/**
 * The actors a `Setup.cast` names — [04 §7](../../../../docs/design/04-schemas.md).
 *
 * ***Three fields, and the first draft read two that do not exist.*** A setup's
 * cast is `{ personaOptions, partyDefault, narrator }`; the `{ persona, actors }`
 * pair is a **session**'s shape, and reading a setup with it found nothing at
 * all — silently, because an absent field and an empty list are the same
 * `[]` here. The unit test did not catch it because the unit test was written
 * from the same wrong picture; the route test did, by making a real setup
 * through the real route. *That is the argument for having both, stated
 * concretely.*
 *
 * Sessions do not come through here at all — `indexSession` hands `writeLinks`
 * its ids directly, because a session is not a portable object and has no
 * schema id to dispatch on.
 */
function setupCastIds(cast: unknown): (string | undefined)[] {
  if (typeof cast !== 'object' || cast === null) return [];
  const shape = cast as { personaOptions?: unknown; partyDefault?: unknown; narrator?: unknown };
  return [
    ...asArray(shape.personaOptions).map((one) => refId(one)),
    ...asArray(shape.partyDefault).map((one) => refId(one)),
    refId(shape.narrator),
  ];
}

function loreIds(lore: unknown): (string | undefined)[] {
  return asArray(lore).map((link) => refId((link as { ref?: unknown } | null)?.ref));
}

function entryRef(entry: unknown): unknown {
  if (typeof entry !== 'object' || entry === null) return entry;
  return (entry as { ref?: unknown }).ref ?? entry;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * A `Ref`'s id, a bare id string, or nothing.
 *
 * *Both shapes, because the corpus has both*: `Setup.treatment` is a `Ref` and a
 * session's `cast.actors` is an array of ids. A reader that took only one would
 * silently count half the references, which is worse than counting none.
 */
function refId(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return idOf(value);
}

function idOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Replaces everything one file says it points at.
 *
 * **Delete then insert, inside the caller's transaction.** A reference removed
 * is a row that has to go, and the producer knows what the file says *now*
 * rather than what it said before — which makes *what changed* a question
 * nobody has to answer.
 */
export function writeLinks(
  db: DatabaseSync,
  from: { kind: string; id: string; name: string; owner: string },
  toIds: readonly string[],
): void {
  clearLinks(db, from.kind, from.id);
  if (toIds.length === 0) return;

  const insert = db.prepare(
    `insert into object_link (from_kind, from_id, from_name, owner, to_id)
       values (?, ?, ?, ?, ?)
       on conflict(from_kind, from_id, to_id) do update set from_name = excluded.from_name,
                                                            owner = excluded.owner`,
  );
  for (const toId of toIds) {
    // A file pointing at itself is not a use of itself, and a package whose
    // contents include its own envelope is a real shape.
    if (toId === from.id) continue;
    insert.run(from.kind, from.id, from.name, from.owner, toId);
  }
}

export function clearLinks(db: DatabaseSync, fromKind: string, fromId: string): void {
  db.prepare('delete from object_link where from_kind = ? and from_id = ?').run(fromKind, fromId);
}

export interface Usage {
  fromKind: string;
  fromId: string;
  fromName: string;
}

/**
 * Who points at this object, among the owners a caller may see.
 *
 * **Scoped in the SQL**, which is `searchLoreEntries`' arrangement and for its
 * stated reason: the limit is applied by the database, so a filter applied
 * afterwards returns fewer rows than it should — and under-reporting a
 * reference count is the direction that makes a delete confirmation lie.
 */
export function usedBy(db: DatabaseSync, objectId: string, owners: readonly string[]): Usage[] {
  if (owners.length === 0) return [];
  const placeholders = owners.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `select from_kind, from_id, from_name
         from object_link
        where to_id = ? and owner in (${placeholders})
        order by from_kind, from_name`,
    )
    .all(objectId, ...owners) as { from_kind: string; from_id: string; from_name: string }[];

  return rows.map((row) => ({
    fromKind: row.from_kind,
    fromId: row.from_id,
    fromName: row.from_name,
  }));
}
