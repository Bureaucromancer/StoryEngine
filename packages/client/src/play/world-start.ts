// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { LOREBOOK_SCHEMA, TREATMENT_SCHEMA, WORLD_SCHEMA } from '@storyengine/shared';

import type { LibraryObject } from '../api.js';

/**
 * ***Starting a session in a World, as the form reads it*** —
 * [P16.2](../../../../docs/design/workplan/35-p16-world.md),
 * [P16 §1.3](../../../../docs/design/workplan/35-p16-world.md),
 * [15 §5.3](../../../../docs/design/15-world.md).
 *
 * **Pure, and apart from the page**, for the reason `members-form.ts` is apart
 * from `MembersField`: what a World offers, and how choosing one changes a form
 * somebody has already half filled in, are each a rule worth a test that does
 * not need a DOM — and the second is where a form quietly loses a choice.
 *
 * **The server reads the same World the same way** (`library/worlds.ts`,
 * `worldContribution`): lorebook members in the World's order, treatment
 * members all offered and one used only when there is exactly one. This side
 * reads it first so that the person *sees* that contribution as ordinary form
 * state — ticked books, a chosen treatment — and changes it before Start; the
 * form then sends what it shows, explicitly, so what the server would have
 * filled in is never what decides ([00 §3.1]'s *prefill, never binding*). The
 * two readers match on the schema exactly, as the server's does, so a member
 * the server would not contribute is one this form does not tick.
 */

/** A member as the form names it: its id, and the name the World last saw it by. */
export interface Named {
  id: string;
  name: string;
}

/** What one World would bring to a session started in it. */
export interface WorldOffer {
  id: string;
  name: string;
  /** Its lorebook members, in the World's order — what lands in `session.lore`. */
  books: Named[];
  /** Its treatment members, in the World's order — offered, never chosen among. */
  treatments: Named[];
}

/**
 * The World's members of one schema, read defensively.
 *
 * *`SessionWorlds.tsx`'s `holds` reason*: the row is whatever the server read
 * off disk, and these readers sit on the session list's page, where there is no
 * error boundary — so a `null` member, or one with no string id, is skipped
 * rather than thrown on. **Each id once**: membership is a set that happens to
 * have an order (`addMember`'s rule), and a hand-edited World naming a book
 * twice should not tick it twice.
 */
function membersOfSchema(world: LibraryObject, schema: string): Named[] {
  const contents = world.object['contents'];
  if (!Array.isArray(contents)) return [];
  const seen = new Set<string>();
  const out: Named[] = [];
  for (const member of contents as unknown[]) {
    if (typeof member !== 'object' || member === null) continue;
    const { schema: held, id, name } = member as Record<string, unknown>;
    if (held !== schema || typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: typeof name === 'string' && name !== '' ? name : id });
  }
  return out;
}

export function worldOffer(world: LibraryObject): WorldOffer {
  return {
    id: world.id,
    name: world.name,
    books: membersOfSchema(world, LOREBOOK_SCHEMA),
    treatments: membersOfSchema(world, TREATMENT_SCHEMA),
  };
}

/**
 * ***The Worlds the form offers — your own, and only the copy an id reaches.***
 *
 * **Yours** because starting in a World writes to it — the session joins its
 * `contents` ([P16 §1.2]) — and a system World is read-only to every account,
 * so offering one would offer a start whose second half the server cannot do
 * (it logs that and starts the session anyway, which is right for a race and
 * wrong as a thing a menu invites). **Not a shadowed copy**, `AddToWorld`'s
 * reason: the server resolves the id to the winner, so the loser would
 * contribute another World's members under this one's name. *Filtered by
 * schema* although fetched by kind, because the row's schema is the object's
 * own claim and checking it costs nothing.
 */
export function worldsToOffer(objects: readonly LibraryObject[] | undefined): WorldOffer[] {
  return (objects ?? [])
    .filter((one) => one.schema === WORLD_SCHEMA && one.source === 'user' && !one.shadowed)
    .map(worldOffer);
}

/**
 * The treatment a World chooses by itself — **only when it holds exactly one**,
 * the server's rule, because the first of several would be somebody else
 * choosing a story.
 */
export function soleTreatment(offer: WorldOffer | undefined): string | null {
  return offer?.treatments.length === 1 ? (offer.treatments[0]?.id ?? null) : null;
}

/**
 * What a World put into the form, so that choosing another — or none — takes
 * back exactly that and nothing the person chose themselves.
 */
export interface Prefilled {
  lore: string[];
  treatment: string | null;
}

export const NOTHING_PREFILLED: Prefilled = { lore: [], treatment: null };

/** The two fields a World fills in, as the form holds them: `''` is *no treatment*. */
export interface WorldFields {
  lore: string[];
  treatment: string;
}

/**
 * ***Choosing a World, as a change to a form already in progress.***
 *
 * **The books are added, not substituted.** Somebody who ticked a book before
 * choosing the World meant it, and the World's books are *more* of the
 * session's books — the server's own reading, which takes the union of a
 * Setup's and a World's rather than choosing between them. The World's go after
 * what was already ticked, in the World's order.
 *
 * **The treatment is filled only into an empty select**, and only with a World's
 * sole one: a treatment somebody already picked is a choice, and a World is a
 * default one rung below it (the route's layering, read in the same order).
 *
 * **Changing World takes back what the last one added — and only what is still
 * as it left it.** A book it ticked that is still ticked is unticked; a book the
 * person unticked stays unticked, and one the person had ticked before the
 * World came is never touched, because it was never the World's. The treatment
 * goes back to none only if it is still the one the World put there. So
 * choosing a World and then *No world* returns the form to where it was, which
 * is the property that makes the select safe to try.
 */
export function chooseWorld(
  current: WorldFields,
  prefilled: Prefilled,
  next: WorldOffer | undefined,
): WorldFields & { prefilled: Prefilled } {
  const taken = new Set(prefilled.lore);
  const lore = current.lore.filter((id) => !taken.has(id));
  const treatment =
    prefilled.treatment !== null && current.treatment === prefilled.treatment
      ? ''
      : current.treatment;
  if (next === undefined) return { lore, treatment, prefilled: NOTHING_PREFILLED };

  const added = next.books.map((book) => book.id).filter((id) => !lore.includes(id));
  const sole = soleTreatment(next);
  const fills = treatment === '' && sole !== null;
  return {
    lore: [...lore, ...added],
    treatment: fills ? sole : treatment,
    prefilled: { lore: added, treatment: fills ? sole : null },
  };
}
