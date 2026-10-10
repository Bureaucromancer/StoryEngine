// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { LOREBOOK_SCHEMA, newLorebook, type Lorebook } from '@storyengine/shared';

import { ownerKey } from '../index-db/ingest.js';
import { create, list, type LibraryContext } from '../library.js';
import { KeyedQueue } from '../storage/keyed-queue.js';
import { userOwner } from '../storage/layout.js';

/**
 * Memory books — [08 §2](../../../../docs/design/08-cross-session-memory.md),
 * [P8 §1.1], [P8.2].
 *
 * ***A memory is a lorebook entry, which is the reason this feature is smaller
 * than it looks.*** [08 §2] is the whole argument: *"A memory is a discrete,
 * keyed, retrievable piece of text with an origin and a date. That is a lorebook
 * entry."* So keyword and similarity retrieval, the two-tier token budget, the
 * trim order, skip reporting, sticky and cooldown timing and the workbench's
 * *which memories reached this turn and why* all already exist. **No new
 * retrieval path, no new budgeter, no new inspection UI.**
 *
 * ---
 *
 * ***Where they live was the phase's one storage decision, and the argument that
 * settled it is not the one that was expected*** ([P8 §1.1]).
 * [03 §5.1](../../../../docs/design/03-data-model.md) put `memories/` beside
 * `library/`, outside everything the index walks, and `Layout.memoriesRoot()`
 * had sat there since P1 with no caller. A book under it would have been
 * unindexed, unsearchable and **unaddressable**, while [08 §7] asks for *a link
 * to the memory book itself, opening the ordinary lorebook editor* — which needs
 * a library address.
 *
 * The section's own two arguments were about cost. **The deciding one is that
 * the resolver needs a *query*:** a book reaches a session by being *found*, not
 * by being pointed at, so this module has to be able to answer *"the memory book
 * for this user, this actor and this persona"* — and only one of the three
 * options already has a table to ask. So a memory book is an **ordinary library
 * lorebook**, and `memoriesRoot` is deleted with a repo-shape assertion behind
 * the deletion.
 *
 * ---
 *
 * ***The marking is `provenance.source = 'session'`, and it is a field with a
 * reader rather than a new field*** ([P8 §1.9]).
 * [11 §4](../../../../docs/design/11-lorebooks-as-a-format.md) refuses new
 * lorebook fields by name, with a documented override and a test any next field
 * must pass: *does it have a reader on the day it lands, and is it a fact about
 * the book rather than about how you like the book?* `Provenance.source` already
 * includes `'session'`, already travels with every portable object, and **has
 * had no writer anywhere** outside `import/identity.ts`. It has three readers on
 * the day it lands — the shelf badge, the export warning and the third
 * `LoreRoute` — and it is a fact about the book.
 *
 * *The residue is honest and small.* **Non-shareable and derived-from-a-session
 * are not the same claim**, and reading the second as the first is an inference.
 * Stated, and defended: an imported book is `'import'`, a generated one
 * `'generated'`, and `'session'` is the only member meaning *this account's play
 * produced it* — which is exactly the population that must not leave without a
 * warning. If the inference is ever refused, the field opens under 11 §4's
 * override procedure and the override is recorded there, as `writingSamples`'
 * was.
 */

/**
 * Where the scope lives on the book.
 *
 * **`metadata`, which [11 §4] calls an open record**, rather than a field: the
 * refusal above applies to the scope exactly as it applies to the marking, and
 * this is the same place [P8 §1.4]'s origin refs and timestamps go on the
 * entries. A key namespaced like a channel id, so a book somebody hand-edits
 * says whose namespace it is in.
 */
export const MEMORY_METADATA_KEY = 'se.memory';

/**
 * Whose memory this is — [08 §3](../../../../docs/design/08-cross-session-memory.md).
 *
 * **Per user, absolutely**, and that axis is not here because it is not a
 * *field*: sessions are private ([09 §4.3]) and the path is the owner, so a book
 * in Alice's library can never inform Bob's however this record reads. Naming it
 * here would imply it was overridable.
 *
 * **Per actor**, the obvious axis. **Per persona by default**, the non-obvious
 * one: *"If you play two personas, Vera remembering what she did with persona A
 * while talking to persona B is both a coherence failure and a spoiler. She is
 * talking to a different person, and she should know a different history."*
 *
 * ***A record of named keys, not a tuple, and [P8 §1.2] is why.*** A fourth
 * scope key already has a name — narrator-level memory is a World
 * ([15](../../../../docs/design/15-world.md)) — and §1.2's constraint is the
 * part to hold whatever the granularity answer turns out to be: **nothing may
 * hard-code the three-tuple into how books are keyed and named on disk.** Adding
 * `world` here is adding a field to an open record; a book written before it
 * simply has no such key, which reads as *no world* the way every optional field
 * in this corpus reads as the state its files had.
 */
export interface MemoryScope {
  actor: string;
  /** Null for a session played with no persona, which is a scope and not an absence. */
  persona: string | null;
}

/**
 * ***One book per `(actor, persona)`, which is the shape that cannot be wrong
 * about retrieval*** — [P8.2]'s *deliberately not built*.
 *
 * [08 §8] leaves the granularity open — separate books against one book with
 * per-entry persona tags and filtered retrieval — and [P8 §1.2] declines to
 * settle it here, because *"the constraint is the part to hold and the answer
 * wants volume"*. Separate books is the arm that needs no filter to be correct:
 * a book that is only ever scanned for the pair it belongs to cannot leak
 * between personas by forgetting a predicate.
 */
export function scopeOf(object: unknown): MemoryScope | null {
  if (typeof object !== 'object' || object === null) return null;
  const book = object as { provenance?: { source?: unknown }; metadata?: unknown };
  if (book.provenance?.source !== 'session') return null;

  const metadata = book.metadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const held = (metadata as Record<string, unknown>)[MEMORY_METADATA_KEY];
  if (typeof held !== 'object' || held === null) return null;

  const scope = held as { actor?: unknown; persona?: unknown };
  if (typeof scope.actor !== 'string' || scope.actor === '') return null;
  // Absent and null are the same statement — *no persona* — and a book
  // hand-edited to drop the key should not become a book for every persona.
  const persona = typeof scope.persona === 'string' && scope.persona !== '' ? scope.persona : null;
  return { actor: scope.actor, persona };
}

export function sameScope(one: MemoryScope, other: MemoryScope): boolean {
  return one.actor === other.actor && one.persona === other.persona;
}

/**
 * What it is called on the shelf.
 *
 * **Names, not ids**, because this is the only part of a memory book a person
 * reads before opening it, and *"Memories — 0199c0…"* answers nothing. The ids
 * are in `metadata`, where the resolver looks; the name is for the shelf.
 *
 * *The persona clause is present only when there is one*, so a single-persona
 * install — where [08 §3] says the distinction is invisible anyway — gets
 * *Memories — Vera* rather than a parenthesis about itself.
 */
export function memoryBookName(actorName: string, personaName: string | null): string {
  const who = actorName === '' ? 'someone' : actorName;
  return personaName === null || personaName === ''
    ? `Memories — ${who}`
    : `Memories — ${who} (with ${personaName})`;
}

/**
 * A memory book, empty, marked and scoped.
 *
 * **Built on `newLorebook` rather than beside it.** Everything that makes a
 * lorebook work — the scan depth, the two-tier budget, the entry limit — is a
 * default somebody argued for once, and a memory book that quietly disagreed
 * with them would be a second lorebook shape wearing the first one's schema.
 * What differs is the three things that make it *this* book: the name, the
 * marking and the scope.
 *
 * *The scope `newLorebook` gives — `{ kind: 'linked', actorIds: [] }` since
 * [P16.2], `{ kind: 'global' }` before — is inherited and means nothing here*:
 * since [P5.7] a book reaches a session by being found rather than by claiming
 * to apply, and the third `LoreRoute` is what finds this one.
 */
export function newMemoryBook(
  scope: MemoryScope,
  names: { actor: string; persona: string | null },
): Lorebook {
  const book = newLorebook(memoryBookName(names.actor, names.persona));
  return {
    ...book,
    description:
      'Written by play, not by hand. Entries here were extracted from sessions ' +
      'with this character; correcting one is expected, and a corrected entry is ' +
      'left alone afterwards.',
    provenance: { ...book.provenance, source: 'session' },
    metadata: { ...book.metadata, [MEMORY_METADATA_KEY]: { ...scope } },
  };
}

/**
 * Every memory book this account owns, with its scope — **the query [P8 §1.1]
 * decided on.**
 *
 * `list` is the library's own read and returns the indexed row *with its body*,
 * so this is one pass over a table that already holds every lorebook rather than
 * a directory walk or a second index. **Not `resolveRef`**, which answers *which
 * book is this link*, where the question here is *which books are mine and
 * about whom* — the difference [P8 §0.1]'s finding 8 turns on.
 *
 * ***Own books only.*** `list` merges the user's scope with the system's
 * ([10 §5](../../../../docs/design/10-ui-surfaces.md)) and a shipped book could
 * in principle carry the marking; a system-owned memory book would be somebody
 * else's play. The owner check is what keeps [08 §3]'s *per user, absolutely*
 * true of the read as well as of the path.
 */
/** One memory book as the index holds it, with the scope read off its metadata. */
export interface MemoryBookRow {
  id: string;
  path: string;
  contentHash: string;
  book: Lorebook;
  scope: MemoryScope;
}

export function memoryBooksOf(library: LibraryContext, handle: string): MemoryBookRow[] {
  const found: MemoryBookRow[] = [];
  const mine = ownerKey(userOwner(handle));
  for (const row of list(library, handle, LOREBOOK_SCHEMA)) {
    if (row.owner !== mine) continue;
    const scope = scopeOf(row.body);
    if (scope === null) continue;
    found.push({
      id: row.id,
      // The index row's own path, which is what `resolveLore` de-duplicates on:
      // an id and a name can be the same book, and so can a link and a query.
      path: row.path,
      contentHash: row.contentHash,
      book: row.body as Lorebook,
      scope,
    });
  }
  return found;
}

/** The one book for a scope, or null — the lookup the writer and the resolver share. */
export function memoryBookFor(
  library: LibraryContext,
  handle: string,
  scope: MemoryScope,
): { id: string; contentHash: string; book: Lorebook } | null {
  const match = memoryBooksOf(library, handle).find((one) => sameScope(one.scope, scope));
  return match === undefined
    ? null
    : { id: match.id, contentHash: match.contentHash, book: match.book };
}

/** One queue for every scope's first write; tasks on different scopes run at once. */
const ENSURING = new KeyedQueue();

/**
 * The book for a scope, creating it on the first write.
 *
 * ***Lazily, rather than provisioned per pair*** — [P8.2]. A session with four
 * actors and a persona would otherwise put four empty books on the shelf the
 * moment it started, three of which may never be written to; and a shelf that
 * fills with empty derived objects is the cost [P8 §1.1]'s table prices as *one
 * filter row and one badge* only because the books that exist are books that
 * hold something.
 *
 * ***The look-up and the create take turns, per scope*** (2026-09-27). This
 * said the race was benign — *two turns extracting at once can both miss and
 * both create, which the id-conflict check inside `create` refuses for the
 * second* — and the check could not refuse it: each create mints its own id,
 * so both landed, the second under a suffixed slug. A *Remember this* pressed
 * while the extractor wrote, or two sessions with the same cast, left two
 * books claiming one scope: later writes went to whichever the list yielded
 * first, and the other sat on the shelf holding its own entries. `create`'s
 * own queue is per kind and covers the write, not the look-up before it; this
 * one covers both, keyed by the scope, so the second caller finds the first
 * one's book.
 */
export async function ensureMemoryBook(
  library: LibraryContext,
  handle: string,
  scope: MemoryScope,
  names: { actor: string; persona: string | null },
): Promise<{ id: string; contentHash: string; book: Lorebook }> {
  return ENSURING.run(`${handle}\u0000${scope.actor}\u0000${scope.persona ?? ''}`, async () => {
    const held = memoryBookFor(library, handle, scope);
    if (held !== null) return held;

    const made = newMemoryBook(scope, names);
    const stored = await create(library, handle, made, LOREBOOK_SCHEMA);
    return {
      id: made.id,
      contentHash: stored.contentHash,
      book: stored.object as Lorebook,
    };
  });
}
