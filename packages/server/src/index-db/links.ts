// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import { edgesOf, type OutboundRef } from '../library/references.js';

/**
 * ***What points at what*** —
 * [03 §10.1](../../../../docs/design/03-data-model.md),
 * [10 §5.2](../../../../docs/design/10-ui-surfaces.md),
 * [P11.7](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **Two surfaces, one query, and [P4 §6.6] said so first**: *"whichever phase
 * builds that panel pays both."* The delete confirmation's *referenced by 12
 * sessions, 3 treatments and 1 World* and the object page's *Used by* are the
 * same question asked at two moments, and the reason they were one debt is that
 * building either separately produces two answers that can disagree about what a
 * reference is.
 *
 * ***A reference is a link somebody authored, not a mention.*** A setup naming a
 * treatment, a session's chosen cast, a treatment's lorebooks, a World's
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
 *
 * ***And a third reader, which is why the deciding moved out of this file*** —
 * [P16.3b](../../../../docs/design/workplan/35-p16-world.md), 2026-10-10.
 * [10 §5.2] counts the package closure ([04 §9.1](../../../../docs/design/04-schemas.md))
 * as this query's third consumer, and for five phases it was a consumer in name
 * only: nothing walked the closure, so nothing could disagree with this file
 * about it. [P16.3a] built the walker against 04's table, in
 * `library/references.ts`, and found this file disagreeing with the table in
 * three places — every one of them the index counting fewer references than
 * the table names. The argument above for one query is the argument for one
 * reader, made a phase later: **what a reference *is* is decided once, in
 * `references.ts`**, and this file decides only how the index stores what that
 * reader says.
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
 * The ids a portable object points at, by kind — **[04 §9.1]'s table, as
 * `library/references.ts` reads it** ([P16.3b], 2026-10-10).
 *
 * ***Hand-written per kind rather than walked generically***, and the
 * alternative is worth naming because it looks principled: collecting every
 * `{ id, name }` shaped value anywhere in the document. That would scoop up the
 * object's **own** id, every lore entry's id, every tag's, and every folder's —
 * producing a table where a book references its own entries, which is not what
 * *used by* means and not a number anybody could act on. ~~The kinds are five
 * and the fields are named in the schemas; enumerating them is cheaper than the
 * rule that would have to exclude the rest.~~ *Still the reason, and the
 * enumeration moved* ([P16.3b]): it is {@link edgesOf}'s now, one function per
 * kind over 04 §9.1's rows, and this is the ids of what it reads.
 *
 * ***One table, read once.*** Until [P16.3b] this function was a second reading
 * of [04 §9.1](../../../../docs/design/04-schemas.md)'s rows — written before the
 * table was complete, and compared with it only when [P16.3a]'s parity case
 * put the two side by side. It had **no Actor arm** (row 5), so a lorebook's
 * *Used by* never named the actors whose lore links it, which [10 §5.2] lists
 * in so many words — *"Actors, setups and Worlds follow as ordinary rows"* —
 * and the delete confirmation counted a book the cast depends on as used by
 * fewer things than it is. Two readers of one table drift and one cannot, so
 * the walker's reader is the index's: what changed is exactly what 04 says and
 * this did not — **an actor's `lore[]` is indexed** — and no position this
 * linked before is lost. Every field the old arms read is a row of the table (a
 * Setup's treatment, cast, lore, hooks and preset; a Treatment's lore, cast and
 * hooks; a World's contents; a lorebook's hooks), and every shape they accepted
 * `edgesOf` accepts but one, below.
 *
 * ***Ids as written, never resolved*** — which is where the index and the walker
 * still answer different questions, deliberately. The walker resolves a `Ref`
 * by id and then by name; this stores the id the file holds. So a `Ref` whose
 * id names nothing and whose name names Vera is a walk that reaches Vera and a
 * link to an id nobody holds, and **Vera's *Used by* does not name the file**.
 * Resolving here would make one file's links a function of every *other* file —
 * which actor holds that name today — and nothing re-derives a file's links
 * when another object is created, renamed or deleted: the links of every file
 * that named something by name would go stale at the first rename, and a
 * rebuild would answer differently from the incremental index depending on the
 * order the two files were read in, which is the gate this index is held to.
 * *A `Ref` with a name and no id*, which the schema refuses and a hand edit can
 * still write, links nothing — as it never did.
 *
 * ***The shapes it accepts are `edgesOf`'s***, which took this file's lesson
 * from `entryRef` and `refId` (below): a `Ref`, a `{ ref }` wrapper, or a
 * **bare id string**, at every position. That is more than the old arms read —
 * they unwrapped a wrapper only on a treatment's cast and the hooks' fields, and
 * took a bare `Ref` on a lore link nowhere — and *one shape is read
 * differently*: a value that is a `Ref` and also carries a `ref` key of its own.
 * The schemas allow extra keys (`additionalProperties` is never set) and no
 * writer produces one. `edgesOf` reads such a value as a wrapper whatever its
 * `ref` holds, so it links the inner reference's id — or nothing when the
 * inner is anything but an id string or an object with a non-empty string `id`
 * (`null`, `{}`, `''`, a number, a boolean, a list, a name alone, a second
 * wrapper) — and never the outer id. The old arms differed by position.
 * *On a Setup's own fields* (`treatment`, `preset`, the three cast fields)
 * `refId` read the outer id and never looked at `ref`, so there **any `ref`
 * key displaces the outer id**: an inner id string or `{ id }` is linked in its
 * place, and anything else leaves the position linking nothing. *On the hooks'
 * fields and a treatment's cast* `entryRef` already preferred the inner, and
 * fell back to the outer only when the inner was `null`, so there **only
 * `ref: null` loses a link**. **Measured, not reasoned to** — every position of
 * every kind, old against new, over fourteen shapes, and remeasured at review
 * with fourteen `ref` values at each (2026-10-10): this one class, a `Ref` that
 * carries its own `ref` key, holds the only links the old function made that
 * this one does not, and every one of them sits at a position the table names.
 * They are dropped rather than kept, because keeping them would put back a
 * second reading of the table, and the case belongs to `refLike` if it ever
 * needs deciding. Stated because it is the only answer the index gives for a
 * hand-edited file that moved other than by gaining a row.
 *
 * ***A guard for something that cannot happen, in a build whose storage design
 * invites it*** — kept, though the guarding is `edgesOf`'s now. `ingestFile`
 * validates before reaching here, so a malformed payload is unreachable through
 * the one production caller — and this whole index is fed by files people
 * hand-edit, which is the reason every other reader in it is defensive too. A
 * throw here would take a rebuild down over one bad file, and `edgesOf` never
 * throws: a payload that is not an object, or a field of the wrong shape,
 * names nothing.
 */
export function referencesIn(schemaId: string, payload: unknown): string[] {
  return idsOf(edgesOf(schemaId, payload));
}

/**
 * The ids a reader's edges name, each once, in the order first named — what
 * `object_link` holds for one file.
 *
 * **The same function for both producers**: {@link referencesIn} for a portable
 * object, and `indexSession` for a session, which reads it through
 * `sessionEdges` because a session has no schema id to dispatch on. *Order is
 * kept though nothing reads it* — `usedBy` sorts — because a deterministic list
 * is one a test can pin without sorting. A `null` id is no link, for the reason
 * {@link referencesIn} gives.
 */
export function idsOf(edges: readonly OutboundRef[]): string[] {
  const found = new Set<string>();
  for (const edge of edges) {
    if (edge.ref.id !== null) found.add(edge.ref.id);
  }
  return [...found];
}

/*
 * ***What the arms this replaced had learned*** — kept, because
 * `library/references.ts` cites three of these by name, and because each is a
 * mistake the reader there was written not to make. The functions went at
 * [P16.3b] (2026-10-10); the lessons did not.
 *
 * **`setupCastIds` — three fields, and the first draft read two that do not
 * exist.** A setup's cast is `{ personaOptions, partyDefault, narrator }`; the
 * `{ persona, actors }` pair is a **session**'s shape, and reading a setup with
 * it found nothing at all — silently, because an absent field and an empty
 * list are the same `[]`. The unit test did not catch it because the unit test
 * was written from the same wrong picture; the route test did, by making a real
 * setup through the real route (`routes/used-by.test.ts`). *That is the argument
 * for having both, stated concretely* — and `references.test.ts` keeps the
 * first draft as a case: a setup cast shaped like a session's yields nothing.
 *
 * **The lorebook arm — contents are not references, and a hook's actor was
 * never a content.** A lorebook's entries and a preset's blocks are *inside*
 * the object, so a table that recorded them would answer *used by* with the
 * object's own contents. That argument was once a lorebook arm returning `[]`,
 * and it never covered `hooks`, which [03 §4.1] allows on a lorebook as the
 * secondary case: a hook's `involves` and `introduces.actor` are `Ref`s to
 * actors, which a book does not contain and cannot own, so they point outward
 * exactly as a treatment's `cast` does. The exception was added and the
 * reasoning kept, rather than the reasoning replaced by the exception — which
 * is row 10's paragraph in 04 §9.1 now. **A preset keeps the whole of it**: its
 * blocks are inside it, it carries no `Ref` of any kind, and there is no field
 * whose purpose is to point.
 *
 * **The World arm — every member is an edge**, sessions among them since
 * [P16.1], so every member's *used by* names the Worlds holding it and the
 * delete confirmation counts them without blocking ([P16 §1.2]). The index holds
 * the upgraded body, so a Package not yet moved was read as the World it is;
 * `edgesOf` reads either name, so a caller holding a raw legacy body is answered
 * too.
 *
 * **`hookActorIds` — two fields, and they point for opposite reasons.**
 * `involves` is the eligibility test and `introduces.actor` the hook's subject,
 * eligible only while that actor is *not* yet introduced; [04 §6.1a] keeps them
 * apart because one field cannot mean *must be here* and *must not be here* at
 * once. For *used by* the distinction collapses — both are an author naming an
 * actor in a field whose purpose is to point. *Three carriers then, four now*:
 * a session's pool was the fourth source [03 §4.1] names, and it never came
 * through here, because `indexSession` hands `writeLinks` its ids directly — it
 * does still, and since [P16.3b] they include the pool's actors (`sessionEdges`)
 * — every arrival's subject, fired or not, since the correction of 2026-10-10,
 * which also gave them whoever arrived during play: a session's cast is the one
 * it plays with, `resolveCast`'s, and not `cast.actors` alone.
 *
 * **`entryRef` — unwrap what might be wrapped.** It was applied to values the
 * schema says are bare `Ref`s, because the fields beside them in hand-written
 * files — `cast[].ref`, `lore[].ref` — do carry the wrapper, and unwrapping one
 * that is not there costs nothing while failing to unwrap one that is loses the
 * edge silently. `refLike` in `references.ts` applies it at every position.
 * **`refId` — a `Ref`'s id or a bare id string**, because the corpus has both:
 * `Setup.treatment` is a `Ref` and a session's `cast.actors` is an array of
 * ids, and a reader that took only one would silently count half the
 * references, which is worse than counting none.
 *
 * ***This is not [04 §9.1]'s closure walker, and the two are easy to mistake
 * for each other*** — `hookActorIds`' paragraph, kept whole with its dated
 * notes. That table describes export-as-package following outbound references
 * **transitively** from a chosen object, deciding per edge what is included by
 * default and what can be unchecked. ~~It does not exist: `packaging/export.ts`
 * resolves exactly one level, the `contents[]` a package already declares.~~
 * ***It exists since [P16.3a], 2026-10-10*** — `packaging/closure.ts`, over
 * `library/references.ts`, which reads §9.1's table row by row;
 * `packaging/export.ts`'s one level stays only until the client stops calling
 * it (P16.3g). What this feeds is `object_link` — a flat *who names whom*,
 * answering [03 §10.1]'s count-before-you-delete and the object page's *Used
 * by*. ~~A walker built later is~~ The walker was written against §9.1's table,
 * not against this function, and the two agreeing about hooks is a thing to
 * check rather than a thing either one inherits — *checked now*, by
 * `links.test.ts`'s parity case, ~~which lists where they still differ (an
 * actor's lore, a session's treatment and its hook pool) until P16.3b points
 * this function at the same reader~~ *which lists no differences since
 * [P16.3b] pointed this function at the same reader* (2026-10-10). **What still
 * separates them is everything but the table**: the walker is transitive,
 * resolves by name, gates sessions on a tick and decides defaults; the index is
 * one level, ids as written, and counts.
 */

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
    // A file pointing at itself is not a use of itself, and a World whose
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
