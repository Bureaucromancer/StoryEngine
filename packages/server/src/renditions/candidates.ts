// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { MediaSelection } from '@storyengine/sdk';
import {
  ACTOR_SCHEMA,
  type EmbeddedMedia,
  LIBRARY_DIRECTORIES,
  LOREBOOK_SCHEMA,
  mediaRowsIn,
  type PortableSchemaId,
  SETUP_SCHEMA,
  TREATMENT_SCHEMA,
  WORLD_SCHEMA,
} from '@storyengine/shared';

import { usedBy } from '../index-db/links.js';
import type { IndexedObject } from '../index-db/query.js';
import { LibraryError, read, readableOwners, type LibraryContext } from '../library.js';
import { mediaUrlFor } from '../mode-registry.js';
import { actorsWithState } from '../sessions/cast.js';
import type { SessionFile } from '../sessions/types.js';
import type { Layout } from '../storage/layout.js';
import { resolveLore } from '../turns/lore.js';
import { SE_BACKDROP } from './backdrop.js';
import { readRenditions } from './store.js';
import { hasPixels } from './worker.js';

/**
 * ***What a person may stage behind a session*** — [10 §2.3](../../../../docs/design/10-ui-surfaces.md),
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.2, under its
 * §0.4: *choose from what the session already uses*.
 *
 * [10 §2.3] says a backdrop is *generated or uploaded* in its first sentence,
 * and until this stage only the first half was reachable: `se.backdrop`
 * admitted a person's write through the channel route and both arms of
 * `MediaSelection` were served, but nothing in the client could name a picture
 * to write. This is the list that names them — one row per picture, each
 * carrying the selection that choosing it writes and the URL it is drawn from.
 *
 * ***Assembled here rather than stitched together in the browser***, which was
 * the alternative and is the reason this is a route. The client would have had
 * to read the session's lore links, resolve its treatment's own links, list
 * the Worlds and test each for membership, read every cast member's card, and
 * then build `{ from: 'authored', kind, objectId, mediaId }` itself — a second
 * reader of [04 §9.1]'s session row and a second resolver of [04 §3]'s media
 * reference, living in a browser, which `ModeRegion`'s docstring refuses for
 * the stage's own surface (*"a client that resolved a `MediaSelection` itself
 * would be a second implementation"*). Here, every reference is followed by the
 * function the engine follows it with: the lore through `resolveLore`, the cast
 * through `resolveCast`'s union (the roster and whoever the channels put in the
 * story), the Worlds through the index's *Used by*, and every URL through
 * `mediaUrlFor`, which is what the stage itself is drawn from. The client
 * shows the rows and sends a row's `selection` back unread.
 *
 * ***Only what the session already uses, and no upload into a session.*** §0.4
 * decided both: a new picture goes into a library object first, through the
 * galleries that exist, and is offered here from then on — so a backdrop is
 * always a picture of something the story is made of, and nothing about
 * choosing one needs a new arm of `MediaSelection`, which would be a schema
 * change under live sessions (`sdk/src/media.ts` calls it a migration).
 */
export interface BackdropCandidate {
  /** What choosing it writes to `se.backdrop` — the server's, sent back unread. */
  selection: MediaSelection;
  /** Where its pixels are fetched from: the URL the stage would draw it from. */
  url: string;
  /**
   * Whose picture it is: the library object, by its folder's kind, its id and
   * its name — or `null` for a picture this session made, which belongs to no
   * object.
   */
  source: { kind: string; id: string; name: string } | null;
  /**
   * What the picture is called, when anything calls it something: the media
   * row's own label, or the lorebook entry it hangs on. `null` otherwise, and
   * the client numbers it.
   */
  label: string | null;
  /** Whether it is the backdrop the session's head is showing now. */
  current: boolean;
}

/**
 * ***Which roles can stand behind a story on their own.***
 *
 * A picture is a candidate unless its role says it is part of something else:
 * an expression and a pose are members of a set and *"meaningless alone"*
 * (`MediaRole`'s own words), and a portrait source is the uncropped original
 * behind a card's face. Every other role on a treatment, a lorebook or its
 * entries, a setup or a World is a picture of the world the story is set in —
 * a gallery's establishing shot, a map, a place's likeness, a backdrop
 * somebody filed as one — and choosing which is the person's business.
 */
const NOT_ON_ITS_OWN: ReadonlySet<string> = new Set(['expression', 'pose', 'portrait-source']);

/**
 * ***An actor offers only a likeness of a place, or a backdrop.*** Its pictures
 * are mostly the actor — its card's source, its faces and bodies, a gallery of
 * the character — and offering a person's portrait as the room they stand in
 * is noise in a list somebody is reading for a place. What an actor *can* hold
 * of a place is a `reference` (*"canonical likeness — of a person, or of a
 * place"*, which is how a location written as an actor carries one) or a
 * `background` somebody filed on it.
 */
const FROM_AN_ACTOR: ReadonlySet<string> = new Set(['reference', 'background']);

/**
 * Every picture the session could stage, in the order a person would look for
 * one: what this session made, then its treatment, its setup, the Worlds it is
 * in, its lorebooks (the treatment's and its own, as a turn reads them), and
 * its cast. **Each object once**, under the first of those it was reached by —
 * a book the treatment links and the session names again is one book.
 *
 * ***Nothing the session does not use.*** The library is not listed: an object
 * the session names nowhere is not in its story, and offering it would make the
 * dialog a picture browser for the whole library — the shelf [10 §2.1] says
 * Play should never have to teach. A reference that resolves to nothing is
 * skipped, as `resolveLore` skips a missing book: the turn plays without it,
 * and so does this list.
 */
export async function backdropCandidates(
  library: LibraryContext,
  layout: Layout,
  handle: string,
  session: SessionFile,
): Promise<BackdropCandidate[]> {
  const showing: unknown = session.channels[SE_BACKDROP]?.value ?? null;
  const out: BackdropCandidate[] = [];
  const push = (
    selection: MediaSelection,
    source: BackdropCandidate['source'],
    label: string | null,
  ): void => {
    const url = mediaUrlFor(selection, session.id);
    // Never null for a selection built here with every field a string; the
    // guard is for the type, and a row with no address would be a thumbnail
    // nobody can draw.
    if (url === null) return;
    out.push({ selection, url, source, label, current: sameSelection(selection, showing) });
  };

  /**
   * ***What this session made*** — its background renditions, newest first,
   * **and only those with pixels**: a failed or evicted one has nothing to
   * show, and the stage would draw it as nothing. `hasPixels` is the
   * renditions list's own test, so a picture this list offers is one that
   * list would serve. Illustrations are left out: an illustration is a
   * moment, and a backdrop is a place.
   */
  const made = [...(await readRenditions(layout, handle, session.id)).values()].filter(
    (one) => one.purpose === 'background' && one.asset !== null,
  );
  const ready: typeof made = [];
  for (const one of made) {
    if (await hasPixels(layout, handle, session.id, one)) ready.push(one);
  }
  ready.sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
  );
  for (const one of ready) push({ from: 'rendition', renditionId: one.id }, null, null);

  const seen = new Set<string>();
  const offer = (object: { id: string; name: string; body: unknown }, schemaId: string): void => {
    if (seen.has(object.id)) return;
    seen.add(object.id);
    const kind = LIBRARY_DIRECTORIES[schemaId as PortableSchemaId] as string | undefined;
    if (kind === undefined) return;
    const entries = entryNames(object.body);
    for (const row of picturesOf(object.body, schemaId === ACTOR_SCHEMA)) {
      push(
        { from: 'authored', kind, objectId: object.id, mediaId: row.id },
        { kind, id: object.id, name: object.name },
        nonEmpty(row.label) ?? entries.get(row.id) ?? null,
      );
    }
  };

  const lore = resolveLore(library, handle, session);
  if (lore.treatment !== null) {
    offer(
      {
        id: lore.treatment.id,
        name: lore.treatment.treatment.name,
        body: lore.treatment.treatment,
      },
      TREATMENT_SCHEMA,
    );
  }

  /**
   * ***The setup, as the library holds it now.*** The session keeps a copy
   * ([04 §7]), and a copy's media rows name bytes that live in the library
   * object's container, not in the session — so the pictures offered are the
   * live object's, found by the id the copy kept, and a setup deleted since is
   * a setup with nothing to offer.
   */
  const setupId = typeof session.setup?.id === 'string' ? session.setup.id : null;
  if (setupId !== null) {
    const setup = readable(library, handle, setupId, SETUP_SCHEMA);
    if (setup !== null) offer(setup, SETUP_SCHEMA);
  }

  /**
   * ***The Worlds it is in***, by the index's *Used by* — the membership
   * `InTheseWorlds` shows on the page, read from the session's end: a World
   * that names the session among its members is a World whose pictures are
   * pictures of this story's world.
   */
  const owners = readableOwners(handle).map((owner) =>
    owner.kind === 'system' ? 'system' : `user:${owner.handle}`,
  );
  for (const use of usedBy(library.db, session.id, owners)) {
    if (use.fromKind !== WORLD_SCHEMA) continue;
    const world = readable(library, handle, use.fromId, WORLD_SCHEMA);
    if (world !== null) offer(world, WORLD_SCHEMA);
  }

  for (const book of lore.books) {
    offer({ id: book.id, name: book.book.name, body: book.book }, LOREBOOK_SCHEMA);
  }

  /**
   * ***The cast a turn is played with***, which is `resolveCast`'s union and
   * [04 §9.1]'s row 13: the persona, the roster, then whoever the channels put
   * in the story that the roster does not name — an arrival is in the scene
   * whether or not anybody added them to `cast.actors`.
   */
  const cast = session.cast;
  const actors = [
    ...(cast?.persona == null ? [] : [cast.persona]),
    ...(cast?.actors ?? []),
    ...[...actorsWithState(session.channels)].sort(),
  ];
  for (const actorId of actors) {
    if (typeof actorId !== 'string' || actorId === '') continue;
    const actor = readable(library, handle, actorId, ACTOR_SCHEMA);
    if (actor !== null) offer(actor, ACTOR_SCHEMA);
  }

  return out;
}

/**
 * One object by id, or `null` when it is gone or not this person's to read —
 * `read`'s not-found, which is how a reference to nothing reads everywhere
 * else in the engine. Anything else is a real failure and is thrown.
 */
function readable(
  library: LibraryContext,
  handle: string,
  id: string,
  kind: PortableSchemaId,
): IndexedObject | null {
  try {
    return read(library, handle, id, kind);
  } catch (error) {
    if (error instanceof LibraryError && error.code === 'not-found') return null;
    throw error;
  }
}

/**
 * The media rows an object offers, in the order it holds them — every row
 * `readMedia` can serve (`mediaRowsIn`, the walk the media route makes), less
 * those {@link NOT_ON_ITS_OWN}, and for an actor only {@link FROM_AN_ACTOR}.
 * *Pictures only*: a row whose type is not an image cannot be drawn.
 */
function picturesOf(body: unknown, isActor: boolean): EmbeddedMedia[] {
  return mediaRowsIn(body).filter(
    (row) =>
      typeof row.id === 'string' &&
      typeof row.mime === 'string' &&
      row.mime.startsWith('image/') &&
      (isActor ? FROM_AN_ACTOR.has(row.role) : !NOT_ON_ITS_OWN.has(row.role)),
  );
}

/**
 * Which lorebook entry each picture hangs on, by media id — so a picture with
 * no label of its own is called by the entry it illustrates, which is what a
 * person looking for *the harbour* is looking for. Read off `entries`, which
 * only a lorebook has; any other object answers an empty map.
 */
function entryNames(body: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const entries = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return names;
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, media } = entry as { name?: unknown; media?: unknown };
    const called = typeof name === 'string' ? nonEmpty(name) : null;
    if (called === null || !Array.isArray(media)) continue;
    for (const row of media) {
      const id = (row as { id?: unknown } | null)?.id;
      if (typeof id === 'string') names.set(id, called);
    }
  }
  return names;
}

function nonEmpty(text: string | undefined): string | null {
  const trimmed = text?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * Whether a candidate is what the channel holds. *Field by field* over the two
 * arms, because the channel's value came off a session file and an extra field
 * there must not make the picture showing look unchosen.
 */
function sameSelection(selection: MediaSelection, showing: unknown): boolean {
  if (typeof showing !== 'object' || showing === null) return false;
  const held = showing as Record<string, unknown>;
  if (selection.from === 'rendition') {
    return held['from'] === 'rendition' && held['renditionId'] === selection.renditionId;
  }
  return (
    held['from'] === 'authored' &&
    held['kind'] === selection.kind &&
    held['objectId'] === selection.objectId &&
    held['mediaId'] === selection.mediaId
  );
}
