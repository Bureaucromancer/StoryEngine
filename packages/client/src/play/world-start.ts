// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  LOREBOOK_SCHEMA,
  SETUP_SCHEMA,
  TREATMENT_SCHEMA,
  WORLD_SCHEMA,
  worldIdsOf,
} from '@storyengine/shared';

import type { LibraryObject } from '../api.js';

/**
 * ***Starting a session in a World, as the form reads it*** —
 * [P16.2](../../../../docs/design/workplan/34-p16-world.md),
 * [P16 §1.3](../../../../docs/design/workplan/34-p16-world.md),
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
 *
 * ***And the books that say they are for it*** — `LoreScope`'s `world` arm,
 * built at [P16.2] once [26 B16] was answered *open the unions*. The server
 * puts every lorebook the person can read whose scope names the World **after**
 * the World's own, by name, each once; this side reads the library the same way
 * so that those books are ticked on the form too — [15 §5.3]'s *visibly*, said
 * of the copy, holds only if what the copy would add is on screen before Start.
 * Membership is the curator's statement and scope the author's; both end as
 * ticks the person can take off.
 *
 * ***And its Setup, when it holds exactly one*** — **the owner's answer of
 * 2026-10-12**, *"Use the World's Setup when it holds exactly one"*, closing
 * the disagreement the P16 final audit recorded against
 * [04 §9](../../../../docs/design/04-schemas.md) and
 * [03 §7.2](../../../../docs/design/03-data-model.md), which say a World is
 * started *through* its Setup. The server now starts `{ world }` through the
 * World's sole Setup member; this side chooses that Setup on the form the same
 * way it ticks the books — as ordinary form state, said why, taken back with
 * the World, and never in place of a Setup the person chose — so that the
 * Setup the session starts through is one the person saw in the select.
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
  /**
   * What lands in `session.lore`: its lorebook members, in the World's order,
   * then the books whose own scope names it, by name — each once, a member
   * first, as the server reads them (`worldContribution`).
   */
  books: Named[];
  /**
   * The ids among `books` that are there **only** because their scope names the
   * World — so the form can say why a book it did not hold was ticked.
   */
  scoped: string[];
  /** Its treatment members, in the World's order — offered, never chosen among. */
  treatments: Named[];
  /**
   * Its Setup members, in the World's order, each once — the owner's answer of
   * 2026-10-12. Offered first; chosen only when there is exactly one
   * ({@link soleSetup}).
   */
  setups: Named[];
  /**
   * ***The ids among `setups` the library holds*** — the ones the form can
   * start from. **A Setup is what to create**, so one the library no longer
   * holds is not a choice to offer: the session form starts from the Setup
   * object it finds on the shelf, and the route refuses a Setup named outright
   * that is not there (`unknown-setup`). The rest are said, not offered — and
   * a World's *only* Setup that is gone is started without, which is the
   * server's reading of the same World (`library/worlds.ts`). *Empty until the
   * Setups shelf has been read*, since nothing can be started from a shelf this
   * page has not seen.
   */
  heldSetups: string[];
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

/**
 * ***The library's books whose scope names this World*** — [P16.2],
 * [15 §5.3].
 *
 * **The server's filter, row for row**: every lorebook the person can read —
 * theirs and the system's, since a book shipped for a World is as much the
 * author's statement as one written here — that is not a shadowed copy (the id
 * reaches the winner, so the loser's scope is not the book's), ordered by name
 * with the same `localeCompare`. `worldIdsOf` is the one reading of the arm both
 * sides share, so a hand-edited scope that says `world` beside a non-list is
 * read as naming nothing here exactly as it is there.
 */
export function booksScopedTo(
  worldId: string,
  lorebooks: readonly LibraryObject[] | undefined,
): Named[] {
  return (lorebooks ?? [])
    .filter(
      (row) =>
        row.schema === LOREBOOK_SCHEMA &&
        !row.shadowed &&
        worldIdsOf(row.object['scope']).includes(worldId),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({ id: row.id, name: row.name }));
}

/**
 * What one World would bring, read off its row — and off the library's
 * lorebooks for the ones whose scope names it. *Without the lorebooks* the
 * offer is its members alone, which is what it was before the arm and what a
 * caller that has not read the shelf yet can honestly say.
 */
export function worldOffer(
  world: LibraryObject,
  lorebooks?: readonly LibraryObject[],
  setups?: readonly LibraryObject[],
): WorldOffer {
  const members = membersOfSchema(world, LOREBOOK_SCHEMA);
  const held = new Set(members.map((book) => book.id));
  // A member that also names the World in its scope stays where the World put
  // it — the server's `new Set([...members, ...scoped])`, which keeps the first.
  const scoped = booksScopedTo(world.id, lorebooks).filter((book) => !held.has(book.id));
  const setupMembers = membersOfSchema(world, SETUP_SCHEMA);
  const shelf = new Set((setups ?? []).map((row) => row.id));
  return {
    id: world.id,
    name: world.name,
    books: [...members, ...scoped],
    scoped: scoped.map((book) => book.id),
    treatments: membersOfSchema(world, TREATMENT_SCHEMA),
    setups: setupMembers,
    heldSetups: setupMembers.filter((one) => shelf.has(one.id)).map((one) => one.id),
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
export function worldsToOffer(
  objects: readonly LibraryObject[] | undefined,
  lorebooks?: readonly LibraryObject[],
  setups?: readonly LibraryObject[],
): WorldOffer[] {
  return ownWorlds(objects).map((world) => worldOffer(world, lorebooks, setups));
}

/**
 * The Worlds a person can start in — `worldsToOffer`'s filter on its own, for
 * the lorebook editor's scope picker ([P16.2]), which offers the same set for
 * the same reason: a book scoped to a World nobody can start a session in here
 * would be a choice that does nothing on this install.
 */
export function ownWorlds(objects: readonly LibraryObject[] | undefined): LibraryObject[] {
  return (objects ?? []).filter(
    (one) => one.schema === WORLD_SCHEMA && one.source === 'user' && !one.shadowed,
  );
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
 * ***The Setup a World chooses by itself*** — the owner's answer of
 * 2026-10-12. **Only when it holds exactly one**, the treatment's rule and the
 * server's, because the first of several would be somebody else choosing the
 * game; **and only when the library holds it**, because there is nothing to
 * start from otherwise. *Counted as members*, as the server counts them, so a
 * World holding two Setups of which one is gone chooses neither — the one
 * still here is not *the only one*, it is the one left.
 */
export function soleSetup(offer: WorldOffer | undefined): string | null {
  if (offer?.setups.length !== 1) return null;
  const id = offer.setups[0]?.id;
  return id !== undefined && offer.heldSetups.includes(id) ? id : null;
}

/**
 * ***Choosing a World, for the Setup select*** — the owner's answer of
 * 2026-10-12, as `chooseWorld` is for the books and the treatment, and apart
 * from it because the Setup is its own control: choosing one switches the form
 * to the Setup's path, where the books and the treatment are the route's to
 * layer under it rather than controls.
 *
 * - **A Setup the person chose is never replaced.** The World's sole Setup is
 *   filled only into an empty select — `''`, *None* — which is the treatment's
 *   rule: a choice outranks a default one rung below it.
 * - **Changing World takes back only what the last one chose, and only while
 *   it is still chosen** — so *No world* returns the select to where it was,
 *   and a Setup the person picked after the World chose one stays theirs.
 *
 * `prefilled` is the Setup the last World chose, or `null`; the answer's
 * `prefilled` is the one this World chose, for the next change to take back.
 *
 * ***`prefilled` is the caller's to drop*** (2026-10-12, at the review). Read
 * here by id, it cannot tell the World's choice from the same Setup picked
 * back by hand — *None*, then the World's Setup again — which would be taken
 * back as the World's. So the session form passes `null` once the person has
 * changed the select at all; the second bullet holds because of that, not
 * because of the comparison alone.
 */
export function chooseWorldSetup(
  current: string,
  prefilled: string | null,
  next: WorldOffer | undefined,
): { setup: string; prefilled: string | null } {
  const setup = prefilled !== null && current === prefilled ? '' : current;
  const sole = soleSetup(next);
  return setup === '' && sole !== null
    ? { setup: sole, prefilled: sole }
    : { setup, prefilled: null };
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
 * *The World's books include the ones whose scope names it* (`worldOffer`),
 * so they arrive after its members and go back with them — nothing below
 * needs to know which statement put a book there.
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
