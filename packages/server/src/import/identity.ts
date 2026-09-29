// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { PortableSchemaId, Provenance } from '@storyengine/shared';

import { contentHashOf } from '../index-db/ingest.js';
import { findPriorImport } from '../index-db/query.js';
import { LibraryError, encodeForCompare, read, type LibraryContext } from '../library.js';
import { userOwner } from '../storage/layout.js';

/**
 * Re-import identity — *"nothing doubles silently, which is the whole of what
 * step 6 asks"*
 * ([P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * A person who imports the same directory twice is not asking for two libraries.
 * Nothing before this stage stopped them getting one: the sweep wrote through
 * `create()` alone, so a second run either collided on the global id check or —
 * with fresh ids, which import mints — quietly doubled everything.
 *
 * **The rule is same owner, same kind, same `Provenance.originalFilename`**, and
 * the argument for it is that foreign files have no id we could key on. A
 * SillyTavern V2 card carries none at all; a world file's identity *is* its
 * name. Whether filename identity holds up is [P4 §6.2]'s open question, with a
 * source-app tag and a content hash named as the additive answers if a real
 * corpus proves it too weak.
 */

/** What to do when a re-import differs from what is stored. */
export type ConflictPolicy =
  /**
   * Overwrite, through `update()` with the `{ kind: 'import' }` attribution —
   * whose **first writer this is**, three phases after the type declared it.
   * Safe because history snapshots the replaced state, so the person's own edits
   * are what the snapshot preserves rather than what the import destroys.
   */
  | 'replace'
  /** A fresh id and a suffixed slug. Both are named in the review. */
  | 'keep-both'
  /** Leave what is stored alone and report the difference. */
  | 'skip';

/**
 * ***`skip` rather than `sweep`'s `replace`, and the disagreement is the
 * point.***
 *
 * A re-imported foreign file **is** the object that file produced, so replacing
 * is safe and history catches the edit. A backup meeting a live account is the
 * **past meeting the present**, and the present is usually what somebody wants
 * to keep — *bring in what I do not have* is what people mean when they reach
 * for this. All three policies are offered and each is named in the review.
 *
 * ***Applied by the sweep as well as by the backups route*** —
 * [P13 §0.5](../../../../docs/design/workplan/30-p13-aventuras-import.md). An
 * unpacked backup handed to the import panel is swept like any other folder,
 * and the panel sends no policy — so it took the sweep's `replace` and reverted
 * every object edited since the archive was taken. Moved here from
 * `backup/import.ts` so the sweep can apply it without importing its caller.
 */
export const DEFAULT_BACKUP_CONFLICT: ConflictPolicy = 'skip';

export type ImportIdentity =
  /** Nothing here came from this file before. */
  | { kind: 'new' }
  /** Already here and byte-identical — the no-op rule, extended to import. */
  | { kind: 'unchanged'; id: string }
  /** Already here and different. What happens next is the policy's business. */
  | { kind: 'changed'; id: string; contentHash: string };

/**
 * Stamps an object as imported, which is what makes it findable next time.
 *
 * `source: 'import'` and `originalFilename` are the two fields the rule reads,
 * and they have been in `Provenance` since P1 with nothing writing them
 * ([P4 §0]). The filename is **source-relative**, never absolute — the
 * foreign-path doctrine applies to what we store as much as to what we log
 * ([21 §4.1.1]).
 */
export function stampImported<T extends { provenance: Provenance }>(
  object: T,
  originalFilename: string,
): T {
  object.provenance.source = 'import';
  object.provenance.originalFilename = originalFilename;
  return object;
}

/**
 * ***The id a file's object already has here, or null*** — the lookup
 * `identify` starts with, and nothing else (2026-09-27).
 *
 * For an object another is about to name: a card's embedded book scopes itself
 * to the card's actor, and the actor links back to the book, both by id. Both
 * ids used to be minted fresh by the converter, and `identify` re-pointed each
 * object to its prior id only as it was stored, so a re-import wrote a book
 * scoped to an actor that did not exist and an actor linking to a book that
 * was never stored, and neither could ever compare `unchanged`.
 */
export function priorImportId(
  context: LibraryContext,
  handle: string,
  schemaId: PortableSchemaId,
  filename: string,
): string | null {
  const owner = userOwner(handle);
  return (
    findPriorImport(
      context.db,
      owner.kind === 'system' ? 'system' : `user:${owner.handle}`,
      schemaId,
      filename,
    )?.id ?? null
  );
}

/**
 * ***A treatment made from a scenario is identified by its whole text***
 * (2026-09-27).
 *
 * A treatment the sweep synthesises from a card's scenario has no file of its
 * own, so its `originalFilename` is the scenario's identity — and that was the
 * first 120 characters of it. Two scenarios sharing an opening (a series of
 * cards with one preamble) were one identity: the second, found as a prior
 * import of the first, *replaced* it by default, in the same sweep or the next
 * upload, and one of the two premises was gone. [P4 §1.10] promises one
 * treatment per distinct scenario text, and a prefix is not a text.
 *
 * The stamp is a digest of the whole scenario now. A treatment written before
 * this carries the old stamp, and is still this scenario's when — and only
 * when — its framing is this whole text: then the old stamp is kept, so the
 * next import finds it rather than making a second. A treatment whose first
 * 120 characters merely match is someone else's, and is left alone.
 */
export function scenarioStamp(
  context: LibraryContext,
  handle: string,
  schemaId: PortableSchemaId,
  framing: string,
): string {
  const digest = `scenario:${contentHashOf(new TextEncoder().encode(framing))}`;
  const owner = userOwner(handle);
  const scope = owner.kind === 'system' ? 'system' : `user:${owner.handle}`;
  if (findPriorImport(context.db, scope, schemaId, digest) !== null) return digest;

  const legacy = `scenario:${framing.slice(0, 120)}`;
  const earlier = findPriorImport(context.db, scope, schemaId, legacy);
  const same = (earlier?.body as { framing?: unknown } | undefined)?.framing === framing;
  return earlier !== null && same ? legacy : digest;
}

/**
 * Whether this object has been imported from this file before, and if so
 * whether anything about it changed.
 *
 * The candidate is given the **prior object's id** before comparing, and that is
 * not a trick: a re-import of a file *is* the object that file produced, and
 * comparing a fresh-id copy against the stored one would find every re-import
 * different on the one field the source never had a say in.
 */
export async function identify(
  context: LibraryContext,
  handle: string,
  schemaId: PortableSchemaId,
  object: { id: string; provenance: Provenance },
): Promise<ImportIdentity> {
  const filename = object.provenance.originalFilename;
  if (filename === null) return { kind: 'new' };

  const owner = userOwner(handle);
  const prior = findPriorImport(
    context.db,
    owner.kind === 'system' ? 'system' : `user:${owner.handle}`,
    schemaId,
    filename,
  );
  if (prior === null) return { kind: 'new' };

  const wasId = object.id;
  object.id = prior.id;

  /**
   * **The object also keeps the timestamps it had here**, and that is a
   * behaviour decision before it is a comparison one.
   *
   * A re-import of a file is the same object that file produced, so its
   * `createdAt` is when it entered *this* library — not when the sweep ran
   * again. Letting it move would make every re-imported card look created
   * today, which is wrong in the library listing before it is wrong in this
   * function.
   *
   * It happens to be what makes byte-identity reachable at all: the converter
   * stamps `createdAt` and `updatedAt` from the clock, so without this no
   * re-import could ever compare equal and §1.3's *skipped and reported
   * unchanged* would be unreachable code.
   */
  const priorProvenance = (prior.body as { provenance?: Provenance }).provenance;
  const wasCreated = object.provenance.createdAt;
  const wasUpdated = object.provenance.updatedAt;
  if (priorProvenance !== undefined) {
    object.provenance.createdAt = priorProvenance.createdAt;
    object.provenance.updatedAt = priorProvenance.updatedAt;
  }

  try {
    const encoded = await encodeForCompare(context, owner, schemaId, prior.slug, object);
    if (encoded === prior.contentHash) return { kind: 'unchanged', id: prior.id };
    return { kind: 'changed', id: prior.id, contentHash: prior.contentHash };
  } catch {
    // Encoding is the only way to know, and a failure here means we cannot say —
    // so the object is treated as new rather than silently replacing something.
    object.id = wasId;
    object.provenance.createdAt = wasCreated;
    object.provenance.updatedAt = wasUpdated;
    return { kind: 'new' };
  }
}

/**
 * An id derived from what it names, rather than minted.
 *
 * **Because a converter that mints ids is not reproducible**, and re-import
 * identity is a byte comparison ([P4 §1.3]). An imported card's openings and
 * writing samples had fresh `uuidv7` ids on every run, so converting the same
 * file twice produced two different objects and *skipped and reported
 * unchanged* was unreachable code — the rule would have replaced every object
 * on every sweep, silently, while looking like it worked.
 *
 * These ids name content that came from the source and has no identity of its
 * own there, so deriving them from that content is the honest choice as well as
 * the convenient one: the same greeting is the same greeting.
 *
 * `Id` is any non-empty string ([04 §3]), so this is legal — and the prefix
 * makes it obvious in a stored file that the id was derived rather than
 * allocated.
 */
export function stableId(namespace: string, ...parts: readonly string[]): string {
  const hash = contentHashOf(new TextEncoder().encode([namespace, ...parts].join(' ')));
  return `im-${namespace}-${hash.slice(7, 31)}`;
}

/**
 * ***A second entry with the same derived id gets an id of its own***
 * (2026-09-27).
 *
 * [04 §5.2] makes an entry id unique within its book, and every converter
 * derives one from what the entry says. So a book that says the same thing
 * twice collided: an Aventuras location and faction both called *Ravenholm*
 * (its ids come from the name alone), an NPC called *setting* beside the
 * scenario's own setting entry, or two blank *Untitled entry* rows in a
 * half-written SillyTavern world (`stableId('entry', name, content)`). The
 * editor, the timing channels and every link key on the id, so selecting the
 * second opened the first, and the two shared their cooldowns.
 *
 * A repeat gets an ordinal, and an id that was unique stays exactly what it
 * was, so nothing already imported moves. The ordinal skips every id the book
 * already holds, because `stableId` joins its parts with a space: the second
 * *Ravenholm*'s `('Ravenholm', '2')` hashes the same text as an entry named
 * *Ravenholm 2*. Still a function of the input alone, so the same file
 * converts to the same bytes ([P4 §1.3]).
 */
export function distinctIds(
  entries: readonly { id: string; name: string }[],
  namespace: string,
  book: string,
): void {
  const taken = new Set(entries.map((entry) => entry.id));
  const kept = new Set<string>();
  for (const entry of entries) {
    if (!kept.has(entry.id)) {
      kept.add(entry.id);
      continue;
    }
    let ordinal = 2;
    let id = stableId(namespace, book, entry.name, String(ordinal));
    while (taken.has(id)) {
      ordinal += 1;
      id = stableId(namespace, book, entry.name, String(ordinal));
    }
    taken.add(id);
    kept.add(id);
    entry.id = id;
  }
}

/**
 * ***The same question, asked of an object that has an id*** —
 * [P12.8](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * The rule above keys on `(owner, kind, originalFilename)` and its docstring
 * says exactly why: *"the argument for it is that foreign files have no id we
 * could key on."* **A backup archive does.** Its contents are this project's
 * own objects, minted here, carrying the identifier the library indexes them
 * by — so keying on a filename would be throwing away the better answer and
 * keeping the workaround.
 *
 * ***It matters in the case the filename rule gets wrong.*** Somebody renames
 * an actor, which moves nothing on disk but changes what a later archive calls
 * it; or they import from a backup of an install whose slugs differ. Filename
 * identity reports those as new objects and doubles the library. The id says
 * they are the same thing, because they are.
 *
 * Everything after the lookup is the rule above, including the reason the
 * timestamps are carried over — a re-import of an object *is* that object, so
 * its `createdAt` is when it entered this library rather than when the import
 * ran.
 */
export async function identifyNative(
  context: LibraryContext,
  handle: string,
  schemaId: PortableSchemaId,
  object: { id: string; provenance: Provenance },
): Promise<ImportIdentity> {
  let prior;
  try {
    prior = read(context, handle, object.id, schemaId);
  } catch (error) {
    if (error instanceof LibraryError && error.code === 'not-found') return { kind: 'new' };
    throw error;
  }

  const priorProvenance = (prior.body as { provenance?: Provenance }).provenance;
  const wasCreated = object.provenance.createdAt;
  const wasUpdated = object.provenance.updatedAt;
  if (priorProvenance !== undefined) {
    object.provenance.createdAt = priorProvenance.createdAt;
    object.provenance.updatedAt = priorProvenance.updatedAt;
  }

  try {
    const encoded = await encodeForCompare(
      context,
      userOwner(handle),
      schemaId,
      prior.slug,
      object,
    );
    if (encoded === prior.contentHash) return { kind: 'unchanged', id: prior.id };
    return { kind: 'changed', id: prior.id, contentHash: prior.contentHash };
  } catch {
    // As above: encoding is the only way to know, so a failure means we cannot
    // say — and treating it as new is the reading that destroys nothing.
    object.provenance.createdAt = wasCreated;
    object.provenance.updatedAt = wasUpdated;
    return { kind: 'new' };
  }
}
