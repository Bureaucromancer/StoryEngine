// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  ACTOR_SCHEMA,
  type ClosureRule,
  LEGACY_PACKAGE_SCHEMA,
  LOREBOOK_SCHEMA,
  type PortableSchemaId,
  PRESET_SCHEMA,
  SESSION_SCHEMA,
  SETUP_SCHEMA,
  TREATMENT_SCHEMA,
  WORLD_SCHEMA,
  worldIdsOf,
} from '@storyengine/shared';

import { actorsWithState } from '../sessions/cast.js';

/**
 * ***[04 §9.1]'s table, read off one object at a time*** —
 * [04 §9.1](../../../../docs/design/04-schemas.md),
 * [16 §4](../../../../docs/design/16-publish.md),
 * [P16 §1.4](../../../../docs/design/workplan/35-p16-world.md), [P16.3a].
 *
 * **The table is normative in 04, and this is its reader** — one function per
 * kind, each emitting the references its rows name, in row order and then in
 * the document's own array order, so a walk over it is deterministic without
 * sorting anything. [P16 §1.4] says the walker is built *against the table as it
 * stands*, and the table's own history is why that sentence exists: the three
 * hook rows were owed for five phases, and *"the only reason that has cost
 * nothing is that the walker does not exist either."* It exists now, and the
 * rows it reads are the rows 04 prints — not the rows anybody remembers, and not
 * `index-db/links.ts`'s `referencesIn`, which ~~disagrees with the table in three
 * places (no Actor arm, no session `treatment`, no session hook pool) and is
 * re-pointed at this module at P16.3b rather than trusted here~~ *disagreed with
 * the table in those three places until [P16.3b] (2026-10-10) re-pointed it, and
 * `indexSession` with it, at this module*: the index's *Used by* is this
 * module's ids now, so the walker and the index read one table.
 *
 * ***Thirteen rows, and one of them is a query*** — as the table stands after
 * the owner's answers of 2026-10-10 at [P16.3]'s plan. Rows 1–11 and 13 are
 * fields an object holds, and {@link edgesOf} and {@link sessionEdges} read
 * them. **Row 12 — a World reaches the books scoped to it — is not a field of
 * the World**: the book names the World, in `LoreScope`'s `world` arm, so the
 * reference points *inward* and no reading of the World could find it. What is
 * pure about that row is the question asked of each book, and it is here as
 * {@link worldScopeEdge}; the asking — every book this person can read — is the
 * walker's reader's (`packaging/closure.ts`).
 *
 * ***Bare and wrapped are different shapes, and the paragraph 04 spends on it is
 * this module's specification.*** `Treatment.cast[i]` and `lore[i]` wrap their
 * `Ref` in `.ref`; a hook's `involves[k]`, its `introduces.actor` and an actor's
 * `lore[i]` *are* `Ref`s. A reader that spelled `hooks[].involves[].ref` would
 * resolve `undefined` on every element and drop every `involves` edge
 * **silently**, while `introduces.actor` beside it worked — 04 §9.1's own words
 * for the walker this one must not be. So every position goes through
 * {@link refLike}, which accepts **a `Ref`, a `{ ref }` wrapper, or a bare id
 * string** wherever it looks, and records which it found in the pointer: the
 * schema says which shape a field holds, and hand-edited files say otherwise
 * often enough that `links.ts` already learned the tolerance (its `entryRef`,
 * retired at [P16.3b] in this module's favour, its lesson kept in `links.ts`).
 *
 * ***Pure, shape-guarded, and it never throws.*** It is handed whatever a file
 * held — the index validates library bodies, but a session file is validated by
 * nothing beyond its id ([P5.6]'s `resolveLore` says the same of itself) — and a
 * walk that threw on one malformed hook would refuse to publish a World over a
 * typo. A position that holds nothing usable yields no edge; a position that
 * holds a usable reference to nothing is the walker's to report as missing.
 * *Pure in its imports too*: ~~`sessions/hooks.ts`, the one module reached for, is
 * the hook filter's — a function of its arguments that `mode-loader.ts` already
 * imports precisely because it touches no storage.~~ *`sessions/cast.ts` since
 * 2026-10-10* — the one module reached for, for `actorsWithState`, the function
 * `resolveCast` plays a turn's cast with (see {@link sessionEdges}); it reads a
 * channel map's keys and nothing else, touches no storage, and was already in
 * this module's import graph through `sessions/hooks.ts`, which imports it — so
 * the swap added no edge to the graph and no cycle (nothing `sessions/cast.ts`
 * reaches imports this module). `sessions/hooks.ts` went with the fired gate it
 * was imported for.
 *
 * ***What is not followed, and why each is deliberate*** — the list is the
 * table's complement, and a reader that "helpfully" followed any of these would
 * be a second table:
 *
 * - **`LoreScope`, every arm** — `linked.actorIds`, `world.worldIds`, `global`,
 *   and the open arm (`{ kind }` of any other string, which a later build may
 *   define). Each says who a book is *for*, which is an inbound statement — the
 *   book names its audience — and following it outward would make every book
 *   publish the cast it was scoped to. *Row 12 reads the `world` arm from the
 *   other end*, as a question put to the book on the World's behalf
 *   ({@link worldScopeEdge}); a book walked for any other reason still reaches
 *   no World through it, which is why a selection holding a scoped book does not
 *   grow the World it names.
 * - **`actorFilter`, `actorTagFilter`** — filters matched against whoever is in
 *   the session, bare strings and tag names; `links.ts` draws the same line.
 * - **`spentHooks`, `blockedBy`, `notBefore.afterHook`** — hook ids, which name
 *   hooks *inside* the same object or pool, never a library object.
 * - **`Setup.goals[].next`** — a goal id, naming the next goal in the same
 *   Setup's chain.
 * - **`modeHints`, `Preset.modes`** — advisory, and a mode is not a library
 *   object.
 * - **On a session:** `setup`, `preset` and `goals` are its own copies, inside
 *   its session export already (04 §9.1's Session row); so is its hook pool —
 *   whose *actors* row 13 follows (2026-10-10), and nothing else of it: a pooled
 *   hook's `source` (`HookSource`) names the treatment, setup or book it was
 *   copied from, and that is **provenance** — following it would publish the
 *   treatment a session was started under after the session dropped it, through
 *   the back of a copy. `memory`'s `associations` name *other sessions* —
 *   exactly the sibling the row says is never pulled in; `roles` and `stepRoles`
 *   are connection bindings, which never travel ([16 §2]); `branchRefs`,
 *   `renditionSelection`, `lastSelectedChild` and `hidden` name turns; and the
 *   actor ids that key ~~`channels` (`se.status#<actorId>`) and~~
 *   `prompts.cards` describe the cast rather than choosing it ~~— the cast is
 *   `cast`, which is followed~~. *Questioned 2026-10-10, at [P16.3b]*: a fired
 *   arrival's subject reaches the cast a turn is played with only through these
 *   keys, since firing adds nobody to `cast` — see {@link sessionEdges}'s note.
 *   ***Corrected the same day***: the actor ids that key `se.presence`,
 *   `se.status` and `se.party` **do** choose the cast — `resolveCast` plays
 *   every actor they name — so row 13 follows them, as `session.cast.arrived`.
 *   What stays unfollowed is what never put anybody in a turn: a card prompt
 *   keyed by an actor (`prompts.cards`), and every other channel (`se.hook#`'s
 *   hook ids, the clock, a mode's dials).
 * - **Memory books.** A session's cast reaches its memory books only through
 *   `resolveLore`, which *queries* the library for them; nothing names one. The
 *   walker never calls it — see `packaging/closure.ts`.
 *
 * A Preset points at nothing: its blocks are inside it and it carries no `Ref`
 * — `links.ts`'s argument, which survives intact.
 */

/** One reference an object makes, as its row reads it — unresolved. */
export interface OutboundRef {
  rule: ClosureRule;
  /**
   * A JSON pointer into the object to the reference itself, wrapper included
   * when there was one. For row 12 ({@link worldScopeEdge}) it points into the
   * *book*, which is the object that holds the reference.
   */
  field: string;
  /**
   * The kind to resolve in. `null` for a World member, whose envelope names its
   * own kind in {@link envelopeSchema} and which the walker classifies — a
   * member may be a session, a World, or a kind this build does not know.
   */
  target: PortableSchemaId | typeof SESSION_SCHEMA | null;
  /** A World member's envelope `schema`, as written. */
  envelopeSchema?: string;
  /** The reference as written; an empty string reads as absent. */
  ref: { id: string | null; name: string | null };
  /**
   * `ref`: exact id, then case-insensitive name within the kind, then missing —
   * every `Ref`'s documented order ([P5.6]'s `resolveRef`). `id`: by id alone,
   * for an envelope and a session's links. *A session link has no name to fall
   * back on, and the World editor matches a member by id*, so a name arm there
   * would make the review and the editor disagree about what a World holds.
   */
  resolve: 'ref' | 'id';
  /** `LoreLink.required === true`, on the two carriers that have one. */
  required: boolean;
  /** 04 §9.1's *Default* column, as `ClosureEdge.default` says. */
  default: 'included' | 'optional';
}

/**
 * The references a library object makes, by kind. An unknown kind — or a
 * Preset — makes none.
 *
 * *A World read as either name*: a Package not yet moved to `worlds/` is indexed
 * as the World it is, but a caller holding a raw legacy body should not get
 * nothing back for it.
 */
export function edgesOf(schemaId: string, body: unknown): OutboundRef[] {
  const object = recordOf(body);
  if (object === null) return [];
  switch (schemaId) {
    case TREATMENT_SCHEMA:
      return treatmentEdges(object);
    case ACTOR_SCHEMA:
      return actorEdges(object);
    case SETUP_SCHEMA:
      return setupEdges(object);
    case LOREBOOK_SCHEMA:
      return lorebookEdges(object);
    case WORLD_SCHEMA:
    case LEGACY_PACKAGE_SCHEMA:
      return worldEdges(object);
    case PRESET_SCHEMA:
      return [];
    default:
      return [];
  }
}

/**
 * ***Row 13 — a session's links, ~~and~~ the cast it plays with, and the actors
 * its hook pool names.***
 *
 * **Its links first**: its `treatment`, its `lore[]`, its persona and its
 * actors — bare id strings on `SessionFile`, resolved by id alone, as
 * `resolveLore` and `resolveCast` resolve them when the session plays.
 *
 * ***Then the rest of the cast it plays with*** — *corrected 2026-10-10*, the
 * lead's decision after the [P16.3b] review, following the owner's answer
 * (*"actors named by its plot hooks travel"*) more literally than the row's
 * first amendment did. [04 §9.1]'s Session row says *its cast (persona and
 * actors)*, and **the cast is the played cast**: the persona, and `cast.actors`
 * together with every actor the session's channels hold state for — exactly
 * the set `resolveCast` (`turns/cast.ts`) sends cards for, because that is the
 * set a turn is assembled around. An arrived character joins it through
 * `actorsWithState` — the same function, imported rather than re-spelled, so
 * which channels put somebody in the story (`se.presence`, `se.status`,
 * `se.party`) is decided once — and through nothing that touches `cast.actors`:
 * firing an arrival writes the hook's channel and nothing else, and the
 * narrator's presence effect that walks the subject in, or a person's write
 * through `PUT /sessions/:id/channels/:key`, writes a channel too. Reading only
 * the roster left every such character out of a publish of the session and out
 * of their own *Used by* — which is the bug the review proved.
 *
 * - **Their own rule, `session.cast.arrived`**, so the review can say *arrived
 *   during play* rather than calling a character nobody configured part of the
 *   configured cast. By id alone, like the session's other links: a channel's
 *   scope key is an id and there is no name to fall back on. *What the rule
 *   means exactly* (2026-10-10, the review of this correction): **in play
 *   through channel state, and not in the configured cast** — which is wider
 *   than an arrival. `setCast` replaces `cast` and touches no channel, so an
 *   actor a person removed from the roster, or a persona they swapped out,
 *   after the narrator or the opening (`se.party: companion`) gave them state
 *   is still played by `resolveCast` and is reached here under this rule. That
 *   is the decision's set, and right; it is the *label* that must not promise
 *   an arrival, which is P16.3g's to word (see the arm in `publish.ts`).
 * - **`resolveCast`'s exclusions, and its order.** An actor the roster already
 *   reaches is not also an arrival, nor is the persona — *a player who has a
 *   presence effect is not also an NPC* — so neither is ever reported as
 *   arrived; the arrivals follow the roster, sorted, as `resolveCast` appends
 *   them. "Already reaches" is the roster's *edges*, which tolerate a `Ref`
 *   where `resolveCast` takes only strings: the set of actors reached is
 *   `resolveCast`'s either way, and a hand-edited `{ id }` in the roster is
 *   reached once, under the roster's rule, rather than twice.
 * - **`resolveCast`'s guard too**: a `cast` that is not an object plays nobody,
 *   arrivals included, so it reaches nobody here either.
 * - **The head's channels**, `session.channels`, because that is the state the
 *   file holds and the node the next turn is played from ([03 §8.1]: the
 *   snapshot is the state at `headTurnId`). A rewind past an arrival takes the
 *   arrival out of it, so it leaves here too; *an arrival only on a branch the
 *   head is not on is not in the snapshot, and is not reached* — stated, not
 *   decided here.
 * - **The pointer** is the first key in the file's channel map that names the
 *   actor — asked of `actorsWithState` one key at a time, so the pointer and
 *   the decision cannot disagree about which keys are about actors — escaped as
 *   RFC 6901 says, since a scope key is data. *Found in one pass over the map*
 *   (2026-10-10), not one scan per arrival: this runs on every write of
 *   `session.json`, through `indexSession`, and is held to that by
 *   `references-cost.test.ts`.
 *
 * The gate on these is the session's tick, as on every edge here: they are
 * edges from the session node, so the walker's `NodeBase.base` keeps them home
 * with an unticked transcript and needed no change to do it.
 *
 * ***Then its pool's actors*** — *added 2026-10-10*, the owner's first answer at
 * [P16.3]'s plan. A session's `hooks` is a copy, carried inside its export and
 * needing no walk, but the copy's `Ref`s point out of it at actors in the
 * library, for the reason rows 4, 8 and 10 exist: a pooled arrival whose subject
 * stayed home lands as *"an arrival with nobody to arrive"*. So every pooled
 * hook's bare `involves[]` is followed, fired or not — a fired hook that
 * involved somebody still names them — and its `introduces.actor` ~~**only while
 * the hook has not fired**, because a fired arrival's subject has arrived and is
 * in the cast, which the links above reach already~~ ***fired or not***
 * (corrected 2026-10-10): the owner's answer is about the actors the hooks
 * *name*, and a fired arrival's subject is in the story — the struck reason was
 * false of the roster, below, and the played-cast clause above is what reaches
 * them as arrived when the story walked them in. *Resolved as `Ref`s*, id then
 * name, like every other hook row: they were copied from a treatment, a setup or
 * a book, and carry whatever that object's refs carried.
 *
 * *Questioned 2026-10-10, at [P16.3b], and ~~left as the row says~~ settled the
 * same day as above.* "In the cast" is true of the cast a turn is played with —
 * `resolveCast` unions the roster with whoever the channels name — and not of
 * the `cast` field the links above read: firing an arrival writes `se.hook` and
 * adds nobody to `cast.actors`. So a fired arrival's subject ~~is~~ *was* reached
 * only if the roster or another hook names them. ~~04 §9.1's row says the same
 * as this paragraph, so the disagreement is the row's to settle; the index reads
 * this function and agrees with it either way (`index-db/sessions.ts`).~~ The
 * row was the one to settle it, and it reads the played cast now; the index
 * reads this function and agrees with it either way (`index-db/sessions.ts`).
 *
 * ~~***Fired is read where the session keeps it***: the head's `se.hook#<id>`
 * channel, through `readHookState` — the reader the hook filter itself uses —
 * so this and the selector cannot disagree about what has happened. **Only
 * `fired` stops the edge.** `provisional` is an introduction the narrator was
 * offered and may have declined ([06 §6.1]: *"a silent permanent loss — marked
 * fired, character never arrived"* is the failure the state exists to prevent),
 * and it returns to the pool on a lapse; `committed` and `forced` are a person's
 * intent that it fire, not a record that it did. A hook with no usable id has
 * no channel to read and counts as unfired, which errs toward carrying the
 * subject.~~ *Struck 2026-10-10 with the gate it described*: no hook state
 * stops an edge now, so this function reads no `se.hook#` channel at all. The
 * gate on all of these is the session's tick, which is the walker's
 * (`NodeBase.base`): what only a session reaches travels with it.
 *
 * Nothing else on a session is a reference this row names; the module header
 * lists what is deliberately not read and why.
 */
export function sessionEdges(session: unknown): OutboundRef[] {
  const object = recordOf(session);
  if (object === null) return [];
  const out: OutboundRef[] = [];
  edge(out, object['treatment'], '/treatment', 'session.treatment', TREATMENT_SCHEMA, BY_ID);
  each(object['lore'], (one, i) => {
    edge(out, one, `/lore/${String(i)}`, 'session.lore', LOREBOOK_SCHEMA, BY_ID);
  });
  const roster: OutboundRef[] = [];
  const cast = recordOf(object['cast']);
  if (cast !== null) {
    edge(roster, cast['persona'], '/cast/persona', 'session.cast.persona', ACTOR_SCHEMA, BY_ID);
    each(cast['actors'], (one, i) => {
      edge(roster, one, `/cast/actors/${String(i)}`, 'session.cast.actors', ACTOR_SCHEMA, BY_ID);
    });
  }
  out.push(...roster, ...arrivedEdges(object['cast'], object['channels'], roster));
  out.push(
    ...hookEdges(object['hooks'], (h) => `/hooks/${String(h)}/hook`, SESSION_HOOKS, {
      pick: (element) => recordOf(element)?.['hook'],
    }),
  );
  return out;
}

/**
 * ***Who the channels put in the story that the roster does not*** — row 13's
 * played cast, the half `resolveCast` adds to `cast.actors` (2026-10-10; see
 * {@link sessionEdges}). `roster` is the persona's and the actors' edges,
 * already read, whose ids are not arrivals.
 */
function arrivedEdges(
  cast: unknown,
  channelsValue: unknown,
  roster: readonly OutboundRef[],
): OutboundRef[] {
  // `resolveCast`'s own guard, kept to the letter — an array passes it, as it
  // passes there — so a cast this reaches nobody through is one that plays
  // nobody.
  if (typeof cast !== 'object' || cast === null) return [];
  const channels = channelsOf(channelsValue);
  const named = new Set(roster.map((one) => one.ref.id));
  // ~~Each arrival's key was found by scanning the map from the top, once per
  // arrival~~ — *one pass since 2026-10-10*, the review of this correction:
  // the scan was O(arrivals × keys) on `indexSession`'s per-turn write path,
  // and a long session's map holds a `se.lore.timing#` key per entry whose
  // counters ever moved (`references-cost.test.ts`). Still asked of `actorsWithState` one key
  // at a time, so the pointer and the decision cannot disagree about which keys
  // are about actors; the first key to name an actor keeps the pointer.
  const firstKey = new Map<string, string>();
  for (const [key, state] of Object.entries(channels)) {
    for (const id of actorsWithState({ [key]: state })) {
      if (!firstKey.has(id)) firstKey.set(id, key);
    }
  }
  const out: OutboundRef[] = [];
  for (const id of [...actorsWithState(channels)].filter((one) => !named.has(one)).sort()) {
    const key = firstKey.get(id);
    // Never taken: `actorsWithState` is a union over the map's keys, so some
    // one key names every id it answered. The guard is for the type alone.
    if (key === undefined) continue;
    edge(out, id, `/channels/${pointerToken(key)}`, 'session.cast.arrived', ACTOR_SCHEMA, BY_ID);
  }
  return out;
}

/**
 * ***Row 12's question, put to one book*** — does this lorebook's scope name
 * this World, and where? *Added 2026-10-10*, the owner's second answer at
 * [P16.3]'s plan: [P16.2]'s `world` arm offers a book to every session started
 * in a World it names, and a World published without those books would start
 * sessions with fewer of them on the other side than it does here — the set
 * failing to travel.
 *
 * **The decision is `worldIdsOf`'s**, the one reader of the arm in shared, which
 * the session-start contribution (`library/worlds.ts`) also asks — so a book a
 * World offers at a session's start and a book a World's publish reaches are one
 * set by construction rather than by two functions agreeing. What this adds is
 * the edge: a pointer into the book at the element that names the World, and
 * the row's default — *included, each individually uncheckable*, because the
 * book's author said it belongs and the person sending decides.
 *
 * `null` for anything else, malformed shapes included. The World's id is the
 * reference as written, so `ref.id` is it and `ref.name` is null: the arm holds
 * ids, and there is no name to fall back on.
 */
export function worldScopeEdge(book: unknown, worldId: string): OutboundRef | null {
  const object = recordOf(book);
  if (object === null || worldId === '') return null;
  const scope = object['scope'];
  if (!worldIdsOf(scope).includes(worldId)) return null;
  // `worldIdsOf` drops non-strings, so its index is not the element's; the
  // pointer is into the array as the file holds it.
  const held = recordOf(scope)?.['worldIds'];
  const at = Array.isArray(held) ? held.indexOf(worldId) : -1;
  return {
    rule: 'world.scopedBook',
    field: `/scope/worldIds/${String(at)}`,
    target: WORLD_SCHEMA,
    ref: { id: worldId, name: null },
    resolve: 'id',
    required: false,
    default: 'included',
  };
}

/** Rows 1–4: lore (required or not), cast, and the hooks' two actor fields. */
function treatmentEdges(object: Record<string, unknown>): OutboundRef[] {
  const out: OutboundRef[] = [];
  /**
   * ***Rows 1 and 2 are one field read once***, in array order, with the row
   * decided per link: a required link is *included, and cannot be silently
   * dropped*; any other is *included, can be unchecked*, which the review calls
   * `optional`. `=== true` because `required` defaults to false and a
   * hand-edited `"yes"` is not the author's loud statement.
   */
  each(object['lore'], (link, i) => {
    const required = recordOf(link)?.['required'] === true;
    edge(out, link, `/lore/${String(i)}`, 'treatment.lore', LOREBOOK_SCHEMA, {
      required,
      default: required ? 'included' : 'optional',
    });
  });
  each(object['cast'], (entry, i) => {
    edge(out, entry, `/cast/${String(i)}`, 'treatment.cast', ACTOR_SCHEMA, INCLUDED);
  });
  out.push(...hookEdges(object['hooks'], (h) => `/hooks/${String(h)}`, TREATMENT_HOOKS));
  return out;
}

/**
 * Row 5 — an actor's lore, **bare `Ref`s**, which the table says out loud and
 * `referencesIn` ~~has no arm for at all: the index's *Used by* on a lorebook
 * omits the actors that link it until P16.3b~~ *had no arm for until [P16.3b]
 * (2026-10-10) made it read this one, so a lorebook's Used by names the actors
 * that link it now.*
 */
function actorEdges(object: Record<string, unknown>): OutboundRef[] {
  const out: OutboundRef[] = [];
  each(object['lore'], (one, i) => {
    edge(out, one, `/lore/${String(i)}`, 'actor.lore', LOREBOOK_SCHEMA, INCLUDED);
  });
  return out;
}

/**
 * Rows 6–9: the treatment, then the Setup's own lore and cast, its own hooks,
 * and its preset.
 *
 * **The cast is `{ personaOptions, partyDefault, narrator }`**, and `links.ts`
 * keeps the record of a first draft that read a session's `{ persona, actors }`
 * here and found nothing, silently. A setup shaped like a session yields no
 * cast edges, and a test says so.
 *
 * **A Setup's own required link keeps `required`**, and so warns when left out —
 * `required` belongs to the `LoreLink`, and the same author statement should not
 * mean two things on two carriers — while its *default* stays the row's
 * `included` ([P16.3]'s decisions).
 */
function setupEdges(object: Record<string, unknown>): OutboundRef[] {
  const out: OutboundRef[] = [];
  edge(out, object['treatment'], '/treatment', 'setup.treatment', TREATMENT_SCHEMA, INCLUDED);
  each(object['lore'], (link, i) => {
    edge(out, link, `/lore/${String(i)}`, 'setup.lore', LOREBOOK_SCHEMA, {
      required: recordOf(link)?.['required'] === true,
      default: 'included',
    });
  });
  const cast = recordOf(object['cast']);
  if (cast !== null) {
    each(cast['personaOptions'], (one, i) => {
      edge(
        out,
        one,
        `/cast/personaOptions/${String(i)}`,
        'setup.cast.personaOptions',
        ACTOR_SCHEMA,
        INCLUDED,
      );
    });
    each(cast['partyDefault'], (one, i) => {
      edge(
        out,
        one,
        `/cast/partyDefault/${String(i)}`,
        'setup.cast.partyDefault',
        ACTOR_SCHEMA,
        INCLUDED,
      );
    });
    edge(out, cast['narrator'], '/cast/narrator', 'setup.cast.narrator', ACTOR_SCHEMA, INCLUDED);
  }
  out.push(...hookEdges(object['hooks'], (h) => `/hooks/${String(h)}`, SETUP_HOOKS));
  /**
   * Row 9 — *included, can be unchecked: a preset is tuning, and some authors
   * ship it while others would not.* The review's `optional`, so leaving one out
   * is silent.
   */
  edge(out, object['preset'], '/preset', 'setup.preset', PRESET_SCHEMA, {
    required: false,
    default: 'optional',
  });
  return out;
}

/**
 * Row 10 — **the first time a lorebook follows anything at all**, and only its
 * hooks' actors: its entries and folders are inside it, and 04 §9.1 explains
 * why the dependency is soft (*an unresolvable subject breaks the hook, never
 * the book*). `Lorebook.hooks` is optional, so absent is the ordinary state.
 */
function lorebookEdges(object: Record<string, unknown>): OutboundRef[] {
  return hookEdges(object['hooks'], (h) => `/hooks/${String(h)}`, LOREBOOK_HOOKS);
}

/**
 * ***Row 11 — every member, in the World's order***, as an envelope the walker
 * classifies: a library kind is read by id in the kind its envelope names; a
 * session is read as a session; a World, or a kind this build does not know, is
 * excluded without being read. *By id alone* — an envelope's `name` is a label
 * for the panel, and the World editor resolves members by id.
 *
 * An envelope with no id names nothing addressable and yields no edge, which is
 * what P11.10's export did with one (`packaging/export.ts`).
 */
function worldEdges(object: Record<string, unknown>): OutboundRef[] {
  const out: OutboundRef[] = [];
  each(object['contents'], (member, i) => {
    const envelope = recordOf(member);
    if (envelope === null) return;
    const id = text(envelope['id']);
    if (id === null) return;
    const schema = envelope['schema'];
    out.push({
      rule: 'world.member',
      field: `/contents/${String(i)}`,
      target: null,
      envelopeSchema: typeof schema === 'string' ? schema : '',
      ref: { id, name: text(envelope['name']) },
      resolve: 'id',
      required: false,
      default: 'included',
    });
  });
  return out;
}

/** The two hook rules a carrier's hooks produce. */
interface HookRules {
  involves: ClosureRule;
  introduces: ClosureRule;
}

const TREATMENT_HOOKS: HookRules = {
  involves: 'treatment.hooks.involves',
  introduces: 'treatment.hooks.introduces',
};
const SETUP_HOOKS: HookRules = {
  involves: 'setup.hooks.involves',
  introduces: 'setup.hooks.introduces',
};
const LOREBOOK_HOOKS: HookRules = {
  involves: 'lorebook.hooks.involves',
  introduces: 'lorebook.hooks.introduces',
};
const SESSION_HOOKS: HookRules = {
  involves: 'session.hooks.involves',
  introduces: 'session.hooks.introduces',
};

/**
 * ***A hook's two actor fields, on any carrier*** — rows 4, 8, 10 and 13's
 * second clause, which are one shape on four carriers ([04 §6.1], [04 §6.1a]).
 *
 * **Both, and per hook in order** — every `involves[k]`, then the hook's
 * `introduces.actor` — because they point for opposite reasons and an export
 * needs them for the same one: a file that dropped `involves` arrives with hooks
 * silently ineligible, and one that dropped `introduces.actor` arrives with *an
 * arrival and nobody to arrive*.
 *
 * `at` builds the pointer to hook `h`; `how.pick` finds the hook in an array
 * element, so a carrier that wraps its hooks — a session's pool holds
 * `{ hook, source }` — is one call rather than a second reader~~; and
 * `how.introduces` says whether a hook's subject is still to come, which only a
 * session can answer (a library object's hooks have not fired anywhere)~~.
 * *`how.introduces` went 2026-10-10*, with the fired gate that was its one
 * caller: a session's pool names its arrivals' subjects fired or not, as every
 * other carrier's hooks always did, so all four carriers read one rule now.
 */
function hookEdges(
  hooks: unknown,
  at: (h: number) => string,
  rules: HookRules,
  how: { pick?: (element: unknown) => unknown } = {},
): OutboundRef[] {
  const pick = how.pick ?? ((element: unknown) => element);
  const out: OutboundRef[] = [];
  each(hooks, (element, h) => {
    const hook = recordOf(pick(element));
    if (hook === null) return;
    each(hook['involves'], (one, k) => {
      edge(out, one, `${at(h)}/involves/${String(k)}`, rules.involves, ACTOR_SCHEMA, INCLUDED);
    });
    const introduces = recordOf(hook['introduces']);
    if (introduces !== null) {
      edge(
        out,
        introduces['actor'],
        `${at(h)}/introduces/actor`,
        rules.introduces,
        ACTOR_SCHEMA,
        INCLUDED,
      );
    }
  });
  return out;
}

const INCLUDED = { required: false, default: 'included' } as const;
const BY_ID = { required: false, default: 'included', resolve: 'id' } as const;

/**
 * Pushes one edge when `value` holds a usable reference; nothing otherwise.
 *
 * *An id-only position needs an id*: a session link is a bare id, and a name
 * with no id there would resolve to nothing by the row's own rule, so it is no
 * reference at all rather than a missing one.
 */
function edge(
  out: OutboundRef[],
  value: unknown,
  field: string,
  rule: ClosureRule,
  target: PortableSchemaId,
  how: { required: boolean; default: 'included' | 'optional'; resolve?: 'ref' | 'id' },
): void {
  const found = refLike(value);
  if (found === null) return;
  const resolve = how.resolve ?? 'ref';
  if (resolve === 'id' && found.ref.id === null) return;
  out.push({
    rule,
    field: found.wrapped ? `${field}/ref` : field,
    target,
    ref: found.ref,
    resolve,
    required: how.required,
    default: how.default,
  });
}

/**
 * ***A `Ref`, a `{ ref }` wrapper, or a bare id string*** — the reference as
 * written, and whether a wrapper held it.
 *
 * One level of wrapper, never more: `{ ref: { ref: … } }` is not a shape any
 * schema or importer writes, and unwrapping it would be guessing. A value with
 * neither a usable id nor a usable name is not a reference.
 */
function refLike(
  value: unknown,
): { ref: { id: string | null; name: string | null }; wrapped: boolean } | null {
  const object = recordOf(value);
  if (object !== null && 'ref' in object) {
    const inner = plainRef(object['ref']);
    return inner === null ? null : { ref: inner, wrapped: true };
  }
  const plain = plainRef(value);
  return plain === null ? null : { ref: plain, wrapped: false };
}

function plainRef(value: unknown): { id: string | null; name: string | null } | null {
  if (typeof value === 'string') return value === '' ? null : { id: value, name: null };
  const object = recordOf(value);
  if (object === null) return null;
  const id = text(object['id']);
  const name = text(object['name']);
  return id === null && name === null ? null : { id, name };
}

/**
 * A session's channel map as ~~`readHookState`~~ `actorsWithState` reads it, or
 * an empty one — so a hand-edited `channels` that is a list, a string or absent
 * reads as ~~*nothing has fired*~~ *nobody has arrived*, the state of a session
 * with no turns, rather than throwing.
 *
 * ~~*The entries need no guard of their own*: `readHookState` reads
 * `channels[key]?.value` and keeps it only when it is one of the hook states,
 * so an entry that is `null`, a number or a string answers *in the pool*.~~
 * *The entries still need no guard of their own* (2026-10-10, when the reader
 * changed): `actorsWithState` reads the map's **keys** and never a value — by
 * design, since a character walked out of the room still holds a `false`
 * presence and is still in the story — so an entry that is `null`, a number or
 * a string under an actor's key is that actor in the story, exactly as
 * `resolveCast` reads the same file.
 */
function channelsOf(value: unknown): Readonly<Record<string, { value: unknown }>> {
  return (recordOf(value) ?? {}) as Readonly<Record<string, { value: unknown }>>;
}

/**
 * One JSON pointer reference token ([RFC 6901 §3](https://www.rfc-editor.org/rfc/rfc6901#section-3)):
 * `~` as `~0`, then `/` as `~1`. Every other pointer here is built from field
 * names and indices, which need neither; a channel key carries a scope key,
 * which is data — an imported id may hold a `/` — so it is escaped.
 */
function pointerToken(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** A non-empty string, or null — `''` is how an absent name is often written (`resolveLore`'s refs). */
function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function each(value: unknown, visit: (element: unknown, index: number) => void): void {
  if (!Array.isArray(value)) return;
  value.forEach((element: unknown, index) => {
    visit(element, index);
  });
}
