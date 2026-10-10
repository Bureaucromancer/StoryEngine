// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { PortableObjectEnvelope } from '@storyengine/shared';

import {
  kindOfSchema,
  LIBRARY_KINDS,
  type LibraryKind,
  type LibraryObject,
  type SessionSummary,
} from '../api.js';
import { matches } from '../library/search.js';
import { sessionLabel } from '../play/session-label.js';
import { mergeKeyed, type Draft } from './book-form.js';

/**
 * ***A World's members, as data*** —
 * [P16.1](../../../../docs/design/workplan/35-p16-world.md),
 * [15 §3.1](../../../../docs/design/15-world.md),
 * [P16 §1.2](../../../../docs/design/workplan/35-p16-world.md).
 *
 * **Pure, and apart from the field that draws it**, for the reason
 * `hook-form.ts` is apart from `HookList`: the three things here — what a
 * member resolves to, what the picker may offer, and how two people's edits to
 * the list combine — are each a rule somebody will want to change without
 * reading a component, and each is worth a test that does not need a DOM.
 *
 * **The list is `contents`, and it holds references.** A stored World names
 * its members by `{ schema, id, name }` envelope and never holds a copy
 * ([15 §3.1]'s *embedding is a fact about the file; linking is a fact about
 * the store*), so everything below works on envelopes and looks the object up
 * by id when it needs to say something about it.
 */

/**
 * ***The schema a session member is named by*** — [P16 §1.2].
 *
 * **Spelled here because `@storyengine/shared` exports no constant for it**:
 * the server writes the literal in each of the four places that make a session
 * (`sessions/store.ts`, `sessions/import.ts`, the chat import and the route),
 * and a session is not a library kind, so `LIBRARY_DIRECTORIES` does not carry
 * it either. One constant on this side, so the picker that writes it, the
 * resolver that reads it and the *Add to a world* control that posts it cannot
 * disagree about a string — and when shared grows one, this becomes a
 * re-export.
 */
export const SESSION_MEMBER_SCHEMA = 'storyengine.session/1';

export type Member = PortableObjectEnvelope;

/** What a member is, as this build can say it: a library kind, a session, or neither. */
export type MemberKind = LibraryKind | 'session';

/**
 * The World's members, or none.
 *
 * *Read defensively*, for `hooksOf`'s reason one level up: the draft is
 * whatever the file held, and `contentsShape` below is what keeps a list that
 * is not one from reaching the field — this is the read that would otherwise
 * have to trust it.
 */
export function membersOf(world: Draft): Member[] {
  const contents = world['contents'];
  return Array.isArray(contents) ? (contents as Member[]) : [];
}

/**
 * The World with its members replaced, and everything else untouched.
 *
 * *No absence rule*, which is where this differs from `withHooks`:
 * `World.contents` is required by the schema, so an emptied World carries
 * `"contents": []` and there is no second claim an absent key could make.
 */
export function withMembers(world: Draft, members: Member[]): Draft {
  return { ...world, contents: members };
}

/**
 * Why a World's `contents` cannot be drawn, or null — `hookShape`'s guard for
 * the other keyed list a simple editor walks.
 *
 * **What the field dereferences, and nothing the schema would add.** The member
 * list maps over `contents`, keys each row on `id` and reads `schema` to say
 * what kind it is, so a hand edit that left `"contents": "none"`, `[null]` or
 * `[{ "id": 7 }]` would throw inside the field — and there is no error boundary
 * in this package, so that is the whole application rather than the section
 * (`SimpleEditorPage`'s `shapeOf` has the argument). `name` is optional on an
 * envelope and is not checked; a member with no name is shown by its id.
 */
export function contentsShape(contents: unknown): string | null {
  if (!Array.isArray(contents)) return 'its "contents" is not a list';
  for (const member of contents as unknown[]) {
    if (typeof member !== 'object' || member === null) return 'a member is not an object';
    if (typeof (member as Record<string, unknown>)['id'] !== 'string') {
      return 'a member has no "id" string';
    }
    if (typeof (member as Record<string, unknown>)['schema'] !== 'string') {
      return 'a member has no "schema" string';
    }
  }
  return null;
}

/**
 * The list with this member at the end — **unless it is already held**, by id.
 *
 * Idempotent for the reason the server's `addMembers` is: membership is a set
 * that happens to have an order, and a World naming one lorebook twice would
 * export it twice and count it twice on the panel. The picker already shows a
 * held member as held, so this is the second line rather than the first — a
 * double click, or an add racing a 412's reapply, lands here.
 */
export function addMember(members: readonly Member[], member: Member): Member[] {
  if (members.some((held) => held.id === member.id)) return [...members];
  return [...members, member];
}

/**
 * The list without the member at `index`.
 *
 * ***By position rather than by id***, which is the one place this list is not
 * keyed. A hand edit can name one id twice — the schema checks the envelope,
 * not uniqueness — and a remove by id would take both rows out from under a
 * click on one. Position is exact for the row that was pressed, and the list
 * never reorders under the person pressing it.
 */
export function removeMemberAt(members: readonly Member[], index: number): Member[] {
  return members.filter((_member, at) => at !== index);
}

/**
 * Their member list with mine put back — the 412 merge for `contents`,
 * [P16.1].
 *
 * **`mergeKeyed`, the walk the hook and entry merges already share**, because
 * a member is a keyed item for the same reason a hook is: its id is the
 * object's, it survives every copy, and so *was this here when I opened it* is
 * answerable. The coarse field rule `descriptorFor` keeps for every other key
 * would take one side's whole list — so an add made from a session's page
 * while this editor was open (`POST …/members`, which is exactly the write
 * that makes this editor's Save come back 412) would vanish the moment the
 * person here pressed *reapply my edits*. Through the walk:
 *
 * - **An add on either side survives**, mine appended after theirs.
 * - **A removal on mine is kept** — in `pristine`, gone from my draft.
 * - **A removal on theirs is kept**, unless my copy of that member differs
 *   from the one I opened, which is `mergeKeyed`'s *I had changed it* rule.
 *
 * ***The limit, said rather than discovered.*** *Removed and then re-added by
 * me* writes back the same envelope I opened with (the picker names a member
 * by the object's current name, which is usually the name it had), so it is
 * indistinguishable from *untouched* — and their removal wins. That is the
 * three-way answer rather than a bug in it: my net change to that member was
 * nothing. A re-add after the object was renamed differs, and is kept.
 *
 * **A whole envelope at a time**, which is `mergedHooks`' resolution: an
 * envelope is three fields that name one thing, and the only way either side
 * changes one is to remove and add it.
 */
export function mergedMembers(pristine: Draft, mine: Draft, fresh: Draft): Member[] {
  return mergeKeyed(membersOf(pristine), membersOf(mine), membersOf(fresh), (was, held, theirs) =>
    was !== undefined && JSON.stringify(was) === JSON.stringify(held) ? theirs : held,
  );
}

/** What kind a member envelope names, or null for a schema this build does not know. */
export function memberKindOf(member: Pick<Member, 'schema'>): MemberKind | null {
  if (member.schema === SESSION_MEMBER_SCHEMA) return 'session';
  return kindOfSchema(member.schema);
}

/**
 * What a member resolves to here and now.
 *
 * - **`found`**: the object or session exists — its *current* name, which is
 *   what a World holding a reference is for: an edit to the member is seen
 *   here because nothing was copied ([15 §3.1]).
 * - **`missing`**: the list it would be in has loaded, and it is not in it —
 *   deleted, or never arrived with the file that named it. **Shown, never
 *   removed**: [15 §3.1]'s *the reference dangles, visibly and without blocking
 *   anything*, and P16.1's *a dangling reference, visible and non-blocking,
 *   being the correct outcome*.
 * - **`unknown-kind`**: a schema this build has no kind for — a newer kind, or
 *   a nested World a file carried. The World keeps it verbatim (the envelope
 *   rule, `world.ts`), so this says so rather than calling it missing.
 * - **`unchecked`**: the list it would be in has not answered, or failed. *Not
 *   missing*: a badge claiming something was deleted because a request is
 *   slow would be the surface asserting what nobody yet knows.
 *
 * ***The library match is by id and schema, the winner first.*** A shadowed
 * copy has the same id at a later path and the winner is what every id-only
 * read resolves to, so it is the name a reader of the World should see.
 */
export type Resolution =
  | { state: 'found'; name: string }
  | { state: 'missing' }
  | { state: 'unknown-kind' }
  | { state: 'unchecked' };

export function resolveMember(
  member: Member,
  library: readonly LibraryObject[] | undefined,
  sessions: readonly SessionSummary[] | undefined,
): Resolution {
  const kind = memberKindOf(member);
  if (kind === null) return { state: 'unknown-kind' };

  if (kind === 'session') {
    if (sessions === undefined) return { state: 'unchecked' };
    const session = sessions.find((one) => one.id === member.id);
    return session === undefined ? { state: 'missing' } : { state: 'found', name: session.name };
  }

  if (library === undefined) return { state: 'unchecked' };
  const held = library.filter((one) => one.id === member.id && one.schema === member.schema);
  const winner = held.find((one) => !one.shadowed) ?? held[0];
  return winner === undefined ? { state: 'missing' } : { state: 'found', name: winner.name };
}

/** One thing the picker can offer: what it is, what it is called, and the envelope it adds. */
export interface Candidate {
  kind: MemberKind;
  name: string;
  member: Member;
  /** A session put out of the way — offered, and said. */
  archived: boolean;
}

/**
 * Everything the picker may offer, in the order it lists them.
 *
 * ***Yours, and not the system's.*** The system library is the install's
 * shipped material, read-only to every account; a World is the person's own
 * set, and P16.1 scopes the picker to *the objects you own*. A system object
 * already named by a World (by hand, or by a file that brought it) still
 * resolves and is still shown — this is what is *offered*, not what is
 * allowed.
 *
 * ***Every library kind but one.*** **A World does not hold a World** at 1.0
 * — [15 §3.1]: *a set of sets is a question nobody has asked*, and the
 * envelope rule already carries one found inside a file, so refusing nesting
 * here forecloses nothing. The server refuses it too (`library/worlds.ts`),
 * so this is the surface agreeing with the door rather than the only guard.
 *
 * **One row per id**, the winner's, for the reason `resolveMember` takes the
 * winner: two rows for one id would be two buttons that add the same member.
 *
 * Sessions are the account's own by construction — the route lists nobody
 * else's — and archived ones are included, because a World of *my six Rain
 * City sessions* ([15 §3.2]) does not stop holding the two I archived.
 */
export function candidatesFor(
  library: readonly LibraryObject[],
  sessions: readonly SessionSummary[],
): Candidate[] {
  const byId = new Map<string, { object: LibraryObject; kind: LibraryKind }>();
  for (const object of library) {
    const kind = kindOfSchema(object.schema);
    if (object.source !== 'user' || kind === null || kind === 'worlds') continue;
    const seen = byId.get(object.id);
    if (seen === undefined || (seen.object.shadowed && !object.shadowed)) {
      byId.set(object.id, { object, kind });
    }
  }

  const order = (kind: MemberKind): number =>
    kind === 'session' ? LIBRARY_KINDS.length : LIBRARY_KINDS.indexOf(kind);

  const objects: Candidate[] = [...byId.values()].map(({ object, kind }) => ({
    kind,
    name: object.name,
    member: { schema: object.schema, id: object.id, name: object.name },
    archived: false,
  }));
  const played: Candidate[] = sessions.map((session) => ({
    kind: 'session',
    name: session.name,
    member: sessionMember(session.id, session.name),
    archived: session.archivedAt !== undefined,
  }));

  // Alphabetical by the label a row shows rather than by the stored name, so an
  // unnamed session sorts among the *U*s where its *Untitled session* is read
  // rather than first, under an empty string nobody can see.
  return [...objects, ...played].sort(
    (a, b) => order(a.kind) - order(b.kind) || candidateLabel(a).localeCompare(candidateLabel(b)),
  );
}

/**
 * The words a picker row shows for a candidate — its name, or for a session
 * with none, the placeholder every other session surface shows
 * (`sessionLabel`).
 *
 * **Here rather than in the field**, because the sort above and the filter
 * below have to read the same words the row does: a filter over the stored
 * name could not find an unnamed session by typing what its row says.
 */
export function candidateLabel(candidate: Candidate): string {
  return candidate.kind === 'session' ? sessionLabel(candidate.name) : candidate.name;
}

/**
 * The envelope a session is a member by — [P16 §1.2]'s
 * `{ schema: 'storyengine.session/1', id, name }`.
 *
 * ***The name only when there is one.*** `name` is optional on an envelope and
 * is what a World can still say about a member it can no longer find; an empty
 * string says nothing there, and *Untitled session* would be the label written
 * down as data — `RenameSession`'s argument against seeding a box with a
 * placeholder, one write further along.
 */
export function sessionMember(id: string, name: string): Member {
  return {
    schema: SESSION_MEMBER_SCHEMA,
    id,
    ...(name.trim() === '' ? {} : { name }),
  };
}

/**
 * Whether a candidate answers the picker's two narrowings — a kind, `''` for
 * any, and a piece of its name.
 *
 * **The name and nothing else**, which is the shelf search's choice
 * (`panels.tsx`'s `searchText`) made narrower on purpose: the picker's rows
 * show a name and a kind, the kind has its own control, and matching on what
 * a row does not show is a result nobody can see the reason for. *The name as
 * the row shows it* (`candidateLabel`), for the same reason: an unnamed
 * session's row reads *Untitled session*, and typing that has to find it.
 */
export function candidateMatches(candidate: Candidate, kind: string, query: string): boolean {
  if (kind !== '' && candidate.kind !== kind) return false;
  return matches(candidateLabel(candidate), query.trim());
}
