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
