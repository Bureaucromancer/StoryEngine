// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Actor } from '@storyengine/shared';

import { ownerKey } from '../index-db/ingest.js';
import { listSessionRows } from '../index-db/sessions.js';
import { read, type LibraryContext } from '../library.js';
import { readSession, type SessionContext } from '../sessions/store.js';
import { userOwner } from '../storage/layout.js';
import { memoryBooksOf } from './books.js';
import { admits, readMemoryConfig, type SessionMemoryConfig } from './config.js';

/**
 * ***The UI, as the requirement describes it*** —
 * [08 §7](../../../../docs/design/08-cross-session-memory.md), [P8.4].
 *
 * *Per session, in settings:* **two switches**, **a list of the account's other
 * sessions involving the same actors**, each tri-state, and **a link to the
 * memory book itself, opening the ordinary lorebook editor**.
 *
 * ***The third of those is what [P8 §1.1]'s storage decision was for.*** *"That
 * is where individual memories are read, corrected and deleted, and it needs no
 * bespoke UI"* — true only because a memory book has a **library address**,
 * which the `memories/` root this phase deleted could never have given it.
 *
 * ---
 *
 * ***Sessions the toggles already include show as auto-on rather than being
 * hidden***, which 08 §7 asks for by name: *"so the effective result is visible
 * rather than inferred."* That is why each row carries **both** what the person
 * chose (`association`) and what it comes to (`effective`): a list that showed
 * only the choice would make *intake is off* invisible on every auto row, and a
 * list that showed only the result would make the tri-state look like a boolean.
 *
 * **Its own route rather than a field on the session read.** `GET /sessions/:id`
 * is fetched on every turn by every open tab; this walks every session file the
 * account owns to find the ones with a shared actor, and putting that on the hot
 * path to serve a panel somebody opens occasionally would be paying for it
 * always. *The walk is files rather than an index query because the index's
 * session row has no cast* — adding one would be a schema change to serve one
 * panel, which [03 §5.1]'s *the index is never the only home for a fact* makes
 * the wrong direction to solve it from.
 */

export interface MemoryBookLink {
  actorId: string;
  actorName: string;
  /** Null until the first memory is written — books are created lazily. */
  bookId: string | null;
  entries: number;
}

export interface MemoryAssociationRow {
  sessionId: string;
  name: string;
  /** What the person chose. `auto` is the absence of a choice, shown as one. */
  association: 'auto' | 'always' | 'never';
  /** What it comes to, with `intake` applied — 08 §7's *visible rather than inferred*. */
  effective: boolean;
  /** Which of this session's actors it shares, for the row's subtitle. */
  shared: string[];
}

export interface MemoryPanel {
  config: SessionMemoryConfig;
  /** One per actor in the cast, whether or not a book exists yet. */
  books: MemoryBookLink[];
  others: MemoryAssociationRow[];
}

export async function memoryPanel(
  sessions: SessionContext,
  library: LibraryContext,
  handle: string,
  sessionId: string,
): Promise<MemoryPanel | null> {
  const session = await readSession(sessions, handle, sessionId);
  if (session === null) return null;

  const config = readMemoryConfig(session);
  const cast = session.cast ?? { persona: null, actors: [] };
  const held = memoryBooksOf(library, handle);

  const books: MemoryBookLink[] = cast.actors.map((actorId) => {
    const found = held.find(
      (one) =>
        one.scope.actor === actorId &&
        (config.acrossPersonas || one.scope.persona === cast.persona),
    );
    return {
      actorId,
      actorName: nameOf(library, handle, actorId) ?? actorId,
      bookId: found?.id ?? null,
      entries: found?.book.entries.length ?? 0,
    };
  });

  /**
   * **Every other session of this account that plays with one of these actors.**
   *
   * Archived ones included: an archived session is *"fully intact"*
   * ([03 §10.3]) and its memories are in the book either way, so hiding it from
   * the list would hide a row whose `never` is the only way to exclude it.
   */
  const mine =
    cast.actors.length === 0
      ? []
      : listSessionRows(sessions.index, [ownerKey(userOwner(handle))], { includeArchived: true });
  const others: MemoryAssociationRow[] = [];
  for (const row of mine) {
    if (row.sessionId === sessionId) continue;
    const other = await readSession(sessions, handle, row.sessionId);
    const shared = (other?.cast?.actors ?? []).filter((id) => cast.actors.includes(id));
    if (shared.length === 0) continue;

    others.push({
      sessionId: row.sessionId,
      name: row.name,
      association: config.associations[row.sessionId] ?? 'auto',
      // Through the same predicate the resolver uses, so the panel cannot
      // disagree with what actually happens — which is the whole of what
      // *visible rather than inferred* is asking for.
      effective: admits(config, sessionId, row.sessionId),
      shared: shared.map((id) => nameOf(library, handle, id) ?? id),
    });
  }

  return { config, books, others };
}

/** An actor's name, or null when the card is gone — [00 §3.3]. */
function nameOf(library: LibraryContext, handle: string, id: string): string | null {
  try {
    return (read(library, handle, id).body as Actor).name;
  } catch {
    return null;
  }
}
