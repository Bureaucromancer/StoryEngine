// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  LOREBOOK_SCHEMA,
  type PortableObjectEnvelope,
  TREATMENT_SCHEMA,
  WORLD_SCHEMA,
  type World,
  worldIdsOf,
} from '@storyengine/shared';

import { LibraryError, type LibraryContext, list, read, update } from '../library.js';

/**
 * ***Membership, written in one place*** —
 * [P16 §1.2](../../../../docs/design/workplan/35-p16-world.md),
 * [15 §3.2](../../../../docs/design/15-world.md).
 *
 * **A World's `contents` is the only place membership is written**, and that
 * includes sessions: a session member is an envelope like any other,
 * `{ schema: 'storyengine.session/1', id, name }`, and the session carries no
 * World of its own. [15 §3.2] argues it — two records of one membership is a
 * query that has to agree with another query ([00 §2.8]) — and P16 §1.2 adds
 * the reason it matters here: a field on the session would be accrual's key
 * answered by accident, and accrual is not this phase's.
 *
 * **The reverse view is a query, and it is the client's**: a session's *In
 * these Worlds* is the Worlds whose `contents` name it, read off the same list
 * of Worlds its *Add to a World* control offers — one fetch for both, and a
 * fine cost for a panel (P16 §1.2). A library object's is *Used by*, which the
 * index's link table already answers.
 *
 * So everything that adds a member comes through {@link addMembers}: the
 * editor's picker writes the whole object, as every editor does, but *Add to a
 * World* from a session's page or list, and a session started in a World
 * ([P16.2]), each add one envelope to a set somebody else may be editing — and
 * a read-modify-write done in a browser is one that loses a member to a second
 * tab. Done here, it is the library's ordinary hash-checked write, retried on
 * the one refusal that a retry answers.
 */

export interface MemberEnvelope {
  schema: string;
  id: string;
  name?: string;
}

/** How many times a stale read is re-read before the refusal is the caller's. */
const ATTEMPTS = 3;

/**
 * Adds members to a World that does not already hold them, and answers the
 * World as stored afterwards.
 *
 * **Idempotent by id**: a member already in `contents` is left where it is,
 * under the name it was added with, and adding nothing new writes nothing — the
 * library's no-op rule one level up, so *Add to a World* pressed twice is one
 * member and one history entry. New members go at the end, in the order given.
 *
 * **A World is not a member of a World** ([15 §3.1]): a set of sets is a
 * question nobody has asked, and refusing it at the door that writes membership
 * means the picker's refusal is not the only one. A file that arrives holding a
 * World inside a World is the importer's to carry, as the envelope rule says,
 * and is not written through here.
 *
 * ***A first write, if the World is still under its old name.*** Adding a
 * member is an ordinary `update`, so a Package not yet moved moves now
 * ([P16 §1.1] lists *a member added* among the writes that do it).
 */
export async function addMembers(
  context: LibraryContext,
  handle: string,
  worldId: string,
  members: readonly MemberEnvelope[],
): Promise<{ contentHash: string; object: unknown; written: boolean }> {
  for (const member of members) {
    if (member.schema === WORLD_SCHEMA) {
      throw new LibraryError('invalid', 'A World holds library objects and sessions, not Worlds.');
    }
    if (member.id === worldId) {
      throw new LibraryError('invalid', 'A World cannot be a member of itself.');
    }
  }

  for (let attempt = 1; ; attempt += 1) {
    const current = read(context, handle, worldId, WORLD_SCHEMA);
    const world = current.body as World;
    const held = new Set(world.contents.map((member) => member.id));
    const added: PortableObjectEnvelope[] = [];
    for (const member of members) {
      if (held.has(member.id)) continue;
      held.add(member.id);
      added.push({
        schema: member.schema,
        id: member.id,
        ...(member.name === undefined ? {} : { name: member.name }),
      });
    }
    if (added.length === 0) {
      return { contentHash: current.contentHash, object: current.body, written: false };
    }

    try {
      const stored = await update(
        context,
        handle,
        worldId,
        { ...world, contents: [...world.contents, ...added] },
        current.contentHash,
        undefined,
        WORLD_SCHEMA,
      );
      return { contentHash: stored.contentHash, object: stored.object, written: true };
    } catch (error) {
      // Somebody saved the World between the read and the write — another tab,
      // the editor, a hand edit. Their change is kept and this one is applied
      // on top of it, which is what *add* means; anything else is the caller's.
      if (error instanceof LibraryError && error.code === 'stale' && attempt < ATTEMPTS) continue;
      throw error;
    }
  }
}

/**
 * ***What a World contributes to a session started in it*** —
 * [P16 §1.3](../../../../docs/design/workplan/35-p16-world.md), [P16.2].
 *
 * **Read once, at creation, and copied** — never a query that re-decides each
 * turn, which is what separates this from [P5.7]'s reversed scope rule: a World
 * is a subset somebody named, and what it contributes becomes the session's own
 * data, on disk and editable ([00 §3.1]'s *prefill, never binding*).
 *
 * - **Its lorebook members**, in the order the World holds them, for
 *   `session.lore` — **and, after them, every lorebook this person can read
 *   whose own scope names the World** (`LoreScope`'s `world` arm, built at
 *   [P16.2] once [26 B16] was answered), ordered by name. Membership is the
 *   curator's statement and the arm the author's ([15 §5.3]); both contribute,
 *   and both land in the same list, where the person sees them and can drop
 *   either before the session starts. *Read here, once, by copying* — the arm
 *   is never consulted again, so a book scoped to a World after a session
 *   started in it reaches that session only by being chosen there.
 * - **Its treatment members**, all of them, for the form to offer; and the
 *   one to use when the caller chose none — **only when there is exactly one**,
 *   because picking the first of several would be the server choosing a story
 *   on somebody's behalf.
 *
 * Members are taken as the World names them, by id: a member since deleted is
 * a dangling id in `session.lore`, which the retriever already reports every
 * turn rather than refusing at the door ([00 §3.3]).
 */
export interface WorldContribution {
  world: { id: string; name: string };
  lore: string[];
  treatments: string[];
  treatment: string | null;
}

export function worldContribution(
  context: LibraryContext,
  handle: string,
  worldId: string,
): WorldContribution {
  const current = read(context, handle, worldId, WORLD_SCHEMA);
  const world = current.body as World;
  const members = world.contents.filter((m) => m.schema === LOREBOOK_SCHEMA).map((m) => m.id);
  const scoped = list(context, handle, LOREBOOK_SCHEMA)
    .filter(
      (row) =>
        !row.shadowed && worldIdsOf((row.body as { scope?: unknown }).scope).includes(current.id),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => row.id);
  const lore = [...new Set([...members, ...scoped])];
  const treatments = world.contents.filter((m) => m.schema === TREATMENT_SCHEMA).map((m) => m.id);
  return {
    world: { id: current.id, name: current.name },
    lore,
    treatments,
    treatment: treatments.length === 1 ? (treatments[0] ?? null) : null,
  };
}
