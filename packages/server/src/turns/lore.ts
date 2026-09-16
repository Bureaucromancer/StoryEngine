// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  LOREBOOK_SCHEMA,
  type LoreEntry,
  TREATMENT_SCHEMA,
  type Lorebook,
  type Treatment,
  validate,
} from '@storyengine/shared';

import { resolveRef } from '../library.js';
import { memoryBooksOf } from '../memory/books.js';
import { admits, readMemoryConfig, type SessionMemoryConfig } from '../memory/config.js';
import type { LibraryContext } from '../library.js';

/**
 * Reads a session's Treatment and the Lorebooks it plays with. **Never throws.**
 *
 * **This is the precondition for the entire retriever half** — [P5 §1.10] moved
 * it forward from P5.9 to here for the blunt reason that *a retriever with no
 * books to scan has nothing to do*. Everything P5.6 builds on top of it —
 * activation, per-book verdicts, the arbiter — is unreachable until a session
 * can name a book at all.
 *
 * ## What the schema change is, and the one place two design notes disagree
 *
 * [P5 §0]'s audit priced this correctly and left the choice open: `SessionFile`
 * had *no lore links and no treatment reference at all*, so this stage adds a
 * field — **"copy or live link"**, in its words — under the constraint that
 * `gather.ts` reads only from `(account, sessionId, parentTurnId)`.
 *
 * **Live links, both of them.** That is [03 §8]'s own shape for the lore half:
 * the session carries `lore: Ref<Lorebook>[]`, alongside a `cast` of links and
 * a `preset` that is a resolved *copy*. The asymmetry is the design, and
 * `cast.ts` states it — improving a character card should reach an ongoing
 * game, while editing a preset must not. A lorebook is a character card, not a
 * preset. It is the world, and a world with a typo in it should be fixable
 * without abandoning the story being told in it.
 *
 * **The treatment half is where two notes have to be read together, so the
 * reading is written down rather than assumed.** [03 §8] gives the session no
 * treatment field, only `origin: Provenance`, and says of it: *"editing the
 * source treatment later must not affect this session."* Meanwhile [14 §7]
 * schedules the treatment arm of writing samples for P5 on the grounds that *"a
 * session references neither object today"*, and [P5 §1.10] asks for Treatment
 * and Lorebooks together. Those reconcile on one reading, and it is the reading
 * taken here: `origin` names **which Setup seeded this**, and the sentence
 * forbids reaching back down that provenance chain — Setup, then whatever
 * treatment the Setup points at *now* — because the Setup is a separate object
 * that can be re-aimed after the fact. A treatment the session names itself is
 * not that chain: it is seeded once at creation and is the session's own from
 * then on, exactly like the cast, and re-aiming the Setup cannot reach it.
 *
 * That is defensible and it is still a reading, so it is flagged rather than
 * buried. If the intent was that a session freezes its treatment, the change is
 * confined to this function and the field becomes a copy.
 *
 * ## Order, and why the treatment's books come first
 *
 * Books arrive from two places — the treatment's `lore: LoreLink[]`, and the
 * session's own list, which [03 §7] describes as extras *beyond whatever the
 * treatment already links*. They are concatenated in that order and
 * **deduplicated by the object each link resolved to, first mention winning**,
 * because a book linked twice is one book: scanning it twice would double every
 * entry it activates and hand the budgeter two copies of each to trim.
 *
 * Deduplication is on the resolved object's path rather than on the text of the
 * link, because two different-looking links can be the same book — an id and a
 * name, which is exactly what an imported treatment plus a hand-added extra
 * produces.
 *
 * ## Two shapes, and why the session's is the simpler one
 *
 * A treatment links with `LoreLink { ref: Ref, required }`, so its links carry
 * a name and resolve through {@link resolveRef}'s documented *id, then
 * case-insensitive name* order. The session's own `lore` is a plain list of
 * ids. That asymmetry is deliberate: the name arm of a `Ref` exists for links
 * that crossed an **import** boundary, where the ids belong to whatever
 * produced the file. A session file is written by this server, against this
 * server's library, so its ids are always ours — and storing a name beside each
 * one would be storing a copy of the book's title that goes stale the moment
 * somebody renames it.
 */

/**
 * How a book came to be in play.
 *
 * **Selection is the only route, and that is the rule rather than the current
 * state of the code.** A lorebook is in play because *this session* named it,
 * or because the treatment this session names links it. Nothing else puts a
 * book in a prompt.
 *
 * ~~[P5.7] also admitted books by their own `LoreScope` — `global` applying
 * everywhere, `linked` applying wherever one of its actors is cast.~~
 * **Reversed, and it was a mistake rather than a scheduling decision.** Read
 * literally, [03 §3.4]'s union does describe where a book *applies*, and P5.7
 * took that as a discovery mechanism. The consequence made the error plain:
 * `global` is the factory default *and* the SillyTavern importer's fallback, so
 * every book a person had ever created or imported was in every session's
 * prompt, and the only way out was hand-editing JSON. A person's library is not
 * their world.
 *
 * The rule now is: **no lorebook is active that has not been selected for the
 * session.** Inheritance — a Worlds concept that could let something above the
 * session contribute books — is the shape that would relax this, and it does
 * not exist. Until it does, a field cannot volunteer.
 *
 * Reported because [P5.8]'s tester has to answer *why is this book being
 * scanned at all*, which is a different question from why an entry fired: the
 * repair is unlinking the book, or unlinking the treatment that brought it.
 */
export type LoreRoute =
  /** The treatment this session names links it. */
  | 'treatment'
  /** The session's own list names it. */
  | 'session'
  /**
   * ***The account's own memory book for somebody in the cast*** — [08 §2],
   * [P8.2].
   *
   * **This is not the field volunteering.** The refusal above stands: no
   * lorebook is active that has not been selected for the session, and
   * [P5.7]'s reversal is why. What admits a book here is not something the book
   * *claims* — its `scope`, its tags, its name — it is an **engine rule over the
   * session's own declared cast**, plus a toggle the session owns. A book cannot
   * put itself on this list by being edited; it gets on it by being the memory
   * book of somebody this session declared it is playing with.
   *
   * *Which is exactly the shape [P8 §0.1]'s finding 8 says was missing.* A
   * memory book reaches a session by being **found**, and finding it is a query
   * against the library the account already owns — not a link somebody has to
   * remember to add, which for an auto-maintained book nobody would.
   *
   * **Reported, like the other two, and here it is what makes [P5.8]'s tester
   * answerable.** *Why is this book being scanned* has a different repair for
   * each route: unlink the book, unlink the treatment, or **turn intake off for
   * this session**. A memory book arriving under `by: 'session'` would send
   * somebody looking through a link list it is not in.
   */
  | 'memory';

/** A resolved object with the address of the bytes that were read — [P3.0]. */
export interface LoreSource {
  book: Lorebook;
  /** The id it was linked by, so a later refusal can say which link it was. */
  id: string;
  contentHash: string;
  /**
   * From the treatment's `LoreLink`. A session's own extras are never required
   * — nothing has asked for a strength on them, and inventing one here would be
   * a schema decision made by a resolver.
   */
  required: boolean;
  /** The first route that admitted it. See {@link LoreRoute}. */
  by: LoreRoute;
}

export interface TreatmentSource {
  treatment: Treatment;
  id: string;
  contentHash: string;
}

/**
 * A link that named something this account cannot read — deleted, renamed,
 * belonging to somebody else, or hand-edited into invalidity.
 *
 * **Carried out rather than dropped**, which is where this parts company with
 * `resolveCast`. [00 §3.3] is *resolve what you can, **show** what you cannot*,
 * and P5.6's whole theme is that a block missing from a prompt can say why. A
 * missing book is the most consequential absence the retriever has: nothing
 * errors, the prompt is quietly smaller, and the story loses its world.
 */
export interface MissingLink {
  id: string;
  /**
   * The name the link carried, which is `''` for a session's own id-only link.
   *
   * Both halves travel, because either can be the useful one: a reader who
   * renamed a book wants to see the name it was linked under, and a reader
   * whose library never had it wants the id to search for.
   */
  name: string;
  kind: 'treatment' | 'lorebook';
  /** True only for a treatment link that said so. See {@link LoreSource}. */
  required: boolean;
}

export interface ResolvedLore {
  treatment: TreatmentSource | null;
  books: LoreSource[];
  missing: MissingLink[];
}

export function resolveLore(
  library: LibraryContext,
  handle: string,
  session:
    | { id?: unknown; treatment?: unknown; lore?: unknown; cast?: unknown; memory?: unknown }
    | null
    | undefined,
): ResolvedLore {
  /**
   * **Shape-guarded, because this is handed whatever is in the file.**
   * `readSession` validates nothing beyond the id being a string, and
   * hand-editing `session.json` is a supported way to get data in — so a `lore`
   * that is a string, or a `treatment` that is a number, reaches here. The
   * never-throws claim above is only true if that is checked: the same guard,
   * for the same reason, as `resolveCast`'s.
   */
  if (session === null || typeof session !== 'object') {
    return { treatment: null, books: [], missing: [] };
  }

  const missing: MissingLink[] = [];
  const treatmentId = typeof session.treatment === 'string' ? session.treatment : null;
  const found =
    treatmentId === null
      ? null
      : oneObject(library, handle, { id: treatmentId, name: '' }, TREATMENT_SCHEMA);
  if (treatmentId !== null && found === null) {
    // A treatment that will not resolve is always loud. There is no `required`
    // flag on this link and it needs none: a session names at most one, and
    // naming it at all is the statement of intent that flag exists to make.
    missing.push({ id: treatmentId, name: '', kind: 'treatment', required: true });
  }

  const own = Array.isArray(session.lore) ? session.lore : [];
  const wanted: LoreWant[] = [
    ...(found === null ? [] : loreLinksOf(found.body as Treatment)),
    ...own
      .filter((id): id is string => typeof id === 'string' && id !== '')
      .map((id) => ({ ref: { id, name: '' }, required: false, by: 'session' as const })),
  ];

  const books: LoreSource[] = [];
  const seen = new Set<string>();
  for (const link of wanted) {
    const row = oneObject(library, handle, link.ref, LOREBOOK_SCHEMA);
    if (row === null) {
      missing.push({ ...link.ref, kind: 'lorebook', required: link.required });
      continue;
    }
    // Keyed on the resolved path, not on the link: an id and a name can be the
    // same book, and a treatment's link plus a session's extra is precisely how
    // that pair arises.
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    books.push({
      book: row.body as Lorebook,
      id: row.id,
      contentHash: row.contentHash,
      required: link.required,
      by: link.by,
    });
  }

  /**
   * ***Then the cast's memory books*** — [08 §2], [P8.2], and the one thing that
   * *is* read out of the library rather than linked.
   *
   * **Appended rather than prepended**, so an authored book keeps its place: a
   * session's own links are what somebody chose, and a memory book is what play
   * accumulated. The order matters only for the `seen` check below — a book
   * reached by both roads keeps the first route that admitted it, which for a
   * memory book somebody also linked by hand is `'session'`, and correctly: they
   * chose it, so unlinking is the repair.
   *
   * **`intake` is not read here and defaults to on**, which is [P8 §2]'s split
   * rather than an omission: P8.2 ships the route and its reporting with the
   * toggle defaulted, and [P8.4] fills the predicate along with the association
   * list. *The reporting ships first deliberately*, so [P5.8]'s keyword tester
   * never has to answer *why is this book being scanned* with a blank.
   */
  for (const found of memoryBooksFor(library, handle, session)) {
    if (seen.has(found.path)) continue;
    seen.add(found.path);
    books.push({
      book: found.book,
      id: found.id,
      contentHash: found.contentHash,
      // Never required. A memory book that failed to resolve is a session with
      // no history of this character, which is every first session — and a
      // `required` link would make that a loud failure instead of a normal one.
      required: false,
      by: 'memory',
    });
  }

  /**
   * ~~Then whatever the library's own scopes admit.~~ **Nothing else besides the
   * above. The library's own scopes are not read.**
   *
   * [P5.7] listed every book this account owns and admitted the ones whose
   * `scope` claimed to apply. That is gone: the list above is the whole answer,
   * and a book nobody selected is not in the prompt however its own fields are
   * set. See {@link LoreRoute} for why the reversal, and for what would have to
   * exist before anything could volunteer again.
   *
   * The read went with it, which is worth noting on its own: nothing here
   * enumerates the library any more, so a turn's cost no longer grows with the
   * number of books somebody owns.
   */

  return {
    treatment:
      found === null
        ? null
        : { treatment: found.body as Treatment, id: found.id, contentHash: found.contentHash },
    books,
    missing,
  };
}

/**
 * The memory books for whoever this session says it is playing with.
 *
 * **Guarded like everything else this function touches**, for `resolveLore`'s
 * stated reason: `readSession` validates nothing beyond the id being a string,
 * and a hand-edited `cast` is a supported way to get data in.
 *
 * *One book per actor, scoped to the session's persona*, which is [08 §3]'s
 * default. **Widening to every persona is [P8.4]'s setting**, and it belongs
 * there rather than here because it is a session's choice rather than a
 * resolution rule.
 */
function memoryBooksFor(
  library: LibraryContext,
  handle: string,
  session: { id?: unknown; cast?: unknown; memory?: unknown },
): { book: Lorebook; id: string; contentHash: string; path: string }[] {
  const cast = session.cast;
  if (typeof cast !== 'object' || cast === null) return [];
  const declared = cast as { persona?: unknown; actors?: unknown };
  const actors = Array.isArray(declared.actors)
    ? declared.actors.filter((id): id is string => typeof id === 'string' && id !== '')
    : [];
  if (actors.length === 0) return [];

  const config = readMemoryConfig(session);
  const sessionId = typeof session.id === 'string' ? session.id : '';

  /**
   * ***Intake off does not mean no books*** — [08 §4]'s tri-state, and this is
   * the clause it exists for. *"`'always'` pulls a session in even when
   * `intake` is off"*, so a session that has switched intake off can still be
   * told to read one particular earlier session. The book is admitted; what
   * decides is which of its **entries** survive, below.
   */
  if (!config.intake && Object.values(config.associations).every((one) => one !== 'always')) {
    return [];
  }

  const persona = typeof declared.persona === 'string' ? declared.persona : null;
  const wanted = new Set(actors);
  return memoryBooksOf(library, handle)
    .filter(
      (one) =>
        wanted.has(one.scope.actor) &&
        // [08 §3]: per persona **by default**. Widening is a setting, and it
        // widens the persona axis only — the user axis is the path.
        (config.acrossPersonas || one.scope.persona === persona),
    )
    .map((one) => ({
      book: admitted(one.book, config, sessionId),
      id: one.id,
      contentHash: one.contentHash,
      // The index row's own path, so the `seen` de-duplication above compares
      // the same thing for all three routes.
      path: one.path,
    }));
  /**
   * ***A book with nothing left in it is still returned***, and a first draft
   * filtered those out. `retrieval/blocks.ts` puts **every book in play** on the
   * shelf report *"including one that activated nothing — which is the row
   * somebody most needs"*, because *this book is being scanned and contributed
   * nothing* and *this book is not being scanned* are different problems with
   * different repairs. Dropping an empty memory book would have made the second
   * sentence the only one a memory book could ever produce — and [P5.8]'s tester
   * would have had nothing to say about a session whose associations excluded
   * everything.
   */
}

/**
 * The book as this session may read it — [08 §4]'s association list applied.
 *
 * ***A filtered copy rather than a filter downstream***, and the difference is
 * [08 §6]'s *refuse at the source* argument applied one level down: the
 * retriever scans what it is given, charges its budget against what it scans,
 * and reports what it kept. A book handed over whole and filtered after the scan
 * would spend another session's memories out of this one's token budget and then
 * drop them — which is exactly the defect [P6B.1] found on the lore path and is
 * the reason that bug is worth not repeating.
 *
 * *An entry with no recorded origin is governed by `intake`*, which is the
 * honest default for a hand-written entry somebody added to a memory book
 * themselves: it has no other session to be associated with.
 */
function admitted(book: Lorebook, config: SessionMemoryConfig, sessionId: string): Lorebook {
  return {
    ...book,
    entries: book.entries.filter((entry) => admits(config, sessionId, originOf(entry))),
  };
}

/** Which session wrote an entry, from the open record [P8 §1.4] puts it in. */
function originOf(entry: LoreEntry): string | null {
  // Read through `unknown`, `readSummary`'s rule: `metadata` is *required* by
  // the schema so the compiler believes it is always there, and it is absent
  // from a hand-built object — which [03 §5.1] supports getting data in as.
  const metadata = (entry as { metadata?: unknown }).metadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const held = (metadata as Record<string, unknown>)['se.memory'];
  if (typeof held !== 'object' || held === null) return null;
  const origin = (held as { sessionId?: unknown }).sessionId;
  return typeof origin === 'string' && origin !== '' ? origin : null;
}

interface LoreWant {
  ref: { id: string; name: string };
  required: boolean;
  by: LoreRoute;
}

/**
 * The treatment's own links.
 *
 * **Typed rather than guarded, and that is a finding rather than a shortcut.**
 * This began as a tolerant reader — `Array.isArray(lore)`, a shape check per
 * link, a *drop a ref with neither half* rule — on the reasoning that
 * hand-editing is supported ([03 §5.1]) so anything can arrive. Mutation
 * testing found all three unreachable and `ingest.ts` says why: a file that
 * fails `validate` is **skipped** and surfaces as a file error (F20), so it
 * never becomes an index row at all. Nothing invalid can reach this. The guards
 * would have read as defence and been decoration, and the same mutation run
 * that killed them is what makes {@link oneObject}'s one remaining check —
 * which *is* reachable, by a row an older build indexed — worth keeping.
 *
 * `Ref.id` also carries `minLength: 1`, so a valid link always has an id. The
 * empty-id case is real only on the session's own list, which has no validator
 * between it and the file, and it is filtered where that list is read.
 */
function loreLinksOf(treatment: Treatment): LoreWant[] {
  return treatment.lore.map((link) => ({
    ref: { id: link.ref.id, name: link.ref.name },
    required: link.required,
    by: 'treatment' as const,
  }));
}

function oneObject(
  library: LibraryContext,
  handle: string,
  ref: { id: string; name: string },
  // Borrowed from `resolveRef` rather than widened to `string`: the library's
  // own union of known schema ids is what makes passing the wrong constant here
  // a compile error instead of a runtime miss.
  schemaId: Parameters<typeof resolveRef>[3],
): { body: unknown; id: string; path: string; contentHash: string } | null {
  let row;
  try {
    row = resolveRef(library, handle, ref, schemaId);
  } catch {
    // `resolveRef` re-throws anything that is not a plain miss, and a
    // half-written index is not a reason to make a turn unplayable ([00 §3.3]).
    return null;
  }
  if (row === null) return null;
  /**
   * Validated rather than cast, as `oneActor` does — and the reason is narrower
   * than the one that comment gives, because mutation testing narrowed it.
   *
   * A *hand-edited* invalid file cannot get here: `ingestFile` validates and
   * skips, so it becomes a file error rather than a row. What can get here is a
   * row **an older build indexed** — the index is derived and long-lived, so a
   * schema tightened between then and now leaves rows that were valid when
   * written and are not now. That is the case this check survives, and handing
   * one on would move the failure to a matcher with no idea what to say.
   */
  if (!validate(row.body).valid) return null;
  return {
    body: row.body,
    id: row.id,
    path: row.path,
    contentHash: row.contentHash,
  };
}
