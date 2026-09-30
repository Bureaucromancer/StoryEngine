// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';

import {
  ACTOR_SCHEMA,
  LOREBOOK_SCHEMA,
  TREATMENT_SCHEMA,
  uuidv7,
  SESSION_EXPORT_SCHEMA,
  type PortableSchemaId,
  type Rendition,
  type SessionExport,
  type Turn,
} from '@storyengine/shared';

import { findById } from '../index-db/query.js';
import { sessionHoldingTurns, sessionImportedFrom } from '../index-db/sessions.js';
import { renditionFrom, sessionAssetsRoot, writeRendition } from '../renditions/store.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { ensureDirectory, writeFileBytes } from '../storage/files.js';
import { resolveWithin } from '../storage/paths.js';
import {
  appendTurnOnly,
  indexWrittenSession,
  scopeOf,
  sessionFilePath,
  sessionRoot,
  type SessionContext,
} from './store.js';
import type { SessionFile } from './types.js';

/**
 * ***The other half of [P11.10]'s format*** —
 * [18 §3](../../../../docs/design/18-session-import.md),
 * [25 B12](../../../../docs/design/25-open-questions.md),
 * [P11 §3](../../../../docs/design/workplan/28-p11-implementation.md)'s row 10.
 *
 * The gate's row 10 is *"a session exported from this install **loads on another
 * one**, siblings and all"*, and until this there was nothing to load it with —
 * the format was written, the file could be downloaded, and the sentence was
 * unwalkable. [25 E4]'s whole argument for writing the format *with import in
 * mind* was that the two are different documents; this is the reader that makes
 * that claim checkable rather than aspirational.
 *
 * ***A new session, always, and never a merge.*** [07 §3] makes a session a
 * tree of turns keyed by parent, and an import that reconciled two trees would
 * have to decide what a turn with a parent it has never seen means — which is a
 * question nobody has asked and every answer to it loses something. So an import
 * is a **new** session with new local identity, and the thing it came from
 * travels as provenance rather than as an identity claim.
 *
 * ***The turn ids are kept, and that is the decision most likely to be
 * re-argued.*** Every turn names its parent by id, so re-minting them means
 * rewriting every parent link, every `headTurnId`, every effect's turn
 * reference and every rendition's — a graph rewrite over the one structure this
 * project spends the most care on. ~~Keeping them costs a collision **only**
 * between two installs importing each other's sessions of the same session~~
 * (corrected 2026-09-27): it also costs one on **this** install whenever the
 * session is still here, which is every backup import of an account's own
 * sessions and every export loaded back where it came from. The index keeps
 * one row per turn id, so the copy took the original's. That case is refused
 * (`already-here`, below) rather than paid for with a graph rewrite. *The
 * session's own id is re-minted*, because that one is an address on this
 * install and two installs with the same session id is a real and immediate
 * confusion rather than a theoretical one.
 *
 * ***Every turn is marked foreign.*** `Turn.foreign` exists for this — [18 §3]'s
 * second consequence, *"a foreign identifier has somewhere to go"* — and marking
 * is what keeps *this install made this* answerable afterwards. A turn that
 * arrived with its own `foreign` keeps it: the first install it came from is the
 * one that matters, and overwriting it would make a session that had travelled
 * twice claim it came from the middle.
 *
 * ***And a second caller*** — [P13.10](../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * [P13 §0.3](../../../../docs/design/workplan/30-p13-aventuras-import.md#03-how-this-sits-with-25-e4).
 * [25 E4]'s *one format, not N importers* is kept by making every other
 * source a **producer** of this format that hands its document here, so this
 * reader is the only thing that writes an imported session. The first
 * producer was our own backup (`backup/import.ts`); the second is Aventuras'
 * stories, and it is the first whose document this build did not write. Four
 * things a reader of our own exports could leave unchecked had to be checked
 * once somebody else's converter was writing the input:
 *
 * - **A key to be found by again** — `SessionImportOptions.originalFilename`,
 *   stamped as `origin.originalFilename` and indexed, so a re-import of the
 *   same source is refused as `already-here` naming the session it made.
 * - **A tree**, rather than a list whose order the file promised — see
 *   {@link treeOf}.
 * - **Links that resolve**, or a report of the ones that do not — see
 *   `SessionImportOptions.requireLinks`.
 * - **Turn ids a producer derives rather than mints**, which is
 *   `producer.ts`'s, and the reason the refusal above is a refusal and not a
 *   copy.
 *
 * ***What the trash does to both refusals***, recorded rather than solved: a
 * session in the trash has no index rows, so neither its turns nor its key
 * are *here*, and an import of the same session or source is written — and
 * restoring the trashed one afterwards gives two sessions one set of turn
 * ids. `backup/import.ts` asks the trash by session id for its own case; an
 * export or a producer's source has no id the trash could be asked by.
 */

export interface ImportContext {
  sessions: SessionContext;
}

export interface SessionImportOptions {
  /**
   * A rendition's pixels, by the record's `asset.path`, when the source has
   * them. A backup does; an export carries the records and not the pixels
   * (`SessionExport.renditions`), so a picture imported without them arrives
   * as one whose pixels were cleared, with its recipe and a retry.
   */
  pixels?: (path: string) => Promise<Uint8Array | null>;
  /**
   * ***What the session was made from, in its source's own terms*** — a
   * producer's idempotence key, e.g. `aventura.db/stories/<id>`
   * ([P13 §1.5](../../../../docs/design/workplan/30-p13-aventuras-import.md#15-identity-is-the-row-not-the-file)).
   *
   * Stamped as the session's `origin.originalFilename` — the field [03 §8]
   * gave `origin` from the start and this reader wrote `null` into — and
   * indexed (`session.origin_filename`), so an import carrying a key a session
   * of this account already carries is refused `already-here`, with that
   * session's id. **The library's rule, applied to a session**: same owner,
   * same source, one object ([P4 §1.3]). Source-relative, never an absolute
   * path, for the foreign-path doctrine `stampImported` states ([21 §4.1.1]).
   *
   * ***An option rather than a field of the format***, and the format's
   * version does not move. The format already carries the value — `origin` is
   * part of the session document, which the exporter writes as it is on disk
   * — so a session a producer made takes its key with it when it is exported,
   * and this reader keeps it (below). What was missing was a way for a
   * producer to *say* it without writing an `origin` of its own into a
   * document whose `origin` this reader owns.
   */
  originalFilename?: string;
  /**
   * ***Refuse, rather than report, a link that resolves to nothing here.***
   *
   * `cast`, `lore` and `treatment` are **links** ([03 §8]) — ids resolved
   * fresh every turn — and play already survives one that names nothing
   * (`resolveCast`, `resolveLore`: *resolve what you can, show what you
   * cannot, never block*, [00 §3.3]). So an export loaded on another install,
   * whose cast lives on the install it came from, is imported and the result
   * names what did not resolve: refusing it would refuse nearly every real
   * session on row 10's *"loads on another one"*, and dropping the links would
   * lose them for the day the same objects arrive by package.
   *
   * *A producer is the other case.* It writes the objects its session links
   * to before it writes the session, so a link that resolves to nothing is its
   * own defect, and a session written around it is the half-written import
   * this reader's header exists to prevent. It passes this and is refused
   * `missing-links` instead, before anything is written.
   */
  requireLinks?: boolean;
}

/** The links a session names that resolve to nothing this account can read. */
export interface MissingLinks {
  cast: string[];
  lore: string[];
  treatment: string[];
}

export type SessionImport =
  | {
      ok: true;
      sessionId: string;
      turns: number;
      renditions: number;
      /** Reported, not refused, unless `requireLinks` — see there. */
      missing: MissingLinks;
    }
  | {
      ok: false;
      reason: 'unreadable' | 'wrong-schema' | 'no-turns' | 'broken-tree' | 'already-here';
    }
  | {
      ok: false;
      reason: 'already-here';
      /**
       * The session of this account an earlier import of the same source made
       * — present only when the key found it, because a turn found by id may
       * be another account's, and naming it would say so.
       */
      prior: { sessionId: string; name: string };
    }
  | { ok: false; reason: 'missing-links'; missing: MissingLinks };

/**
 * ***The session of this account a source already became, asked before a
 * producer writes anything*** —
 * [P13.12](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * {@link importSession} answers the same question, but only once it is handed
 * a document — and a producer whose session links to library objects writes
 * those objects *first*, so `requireLinks` holds. For a source already here
 * that order would rewrite the objects of a session that is not going to be
 * written again: new actors nobody's cast names, and a replaced book beside
 * turns that never saw it. So the producer asks here, and writes nothing when
 * the answer is a session. The same index row, under the same owner key, as
 * the check in {@link importSession} — one question, asked earlier, and never
 * a second rule.
 */
export function priorSessionImport(
  context: ImportContext,
  handle: string,
  originalFilename: string,
): { sessionId: string; name: string } | null {
  return sessionImportedFrom(
    context.sessions.index,
    scopeOf(context.sessions, handle),
    originalFilename,
  );
}

/**
 * Reads a document that came from somewhere else.
 *
 * ***Defensive at every step, because the input is a file a person chose.***
 * [00 §3.3]'s posture applied to an import: a document this build cannot read is
 * a refusal with a reason, never a half-written session — and half-written is
 * the failure that is worst here, because a session is a tree and a tree missing
 * its middle is not a smaller tree.
 */
export function readSessionExport(document: unknown): SessionExport | { reason: string } {
  if (typeof document !== 'object' || document === null) return { reason: 'unreadable' };
  /**
   * ***Narrowed through `Record<string, unknown>` rather than through
   * `Partial<SessionExport>`.*** The partial would make every guard below
   * *unnecessary* to the type checker — and the lint rule that says so would be
   * right about the type and wrong about the world: what arrives here is a file
   * somebody chose, and the type is what we are trying to establish rather than
   * what we have.
   */
  const row = document as Record<string, unknown>;
  if (row['schema'] !== SESSION_EXPORT_SCHEMA) return { reason: 'wrong-schema' };
  const session = row['session'];
  if (typeof session !== 'object' || session === null) return { reason: 'unreadable' };
  if (!Array.isArray(row['turns'])) return { reason: 'unreadable' };
  return document as SessionExport;
}

export async function importSession(
  context: ImportContext,
  handle: string,
  document: unknown,
  options: SessionImportOptions = {},
): Promise<SessionImport> {
  const read = readSessionExport(document);
  if ('reason' in read) {
    return { ok: false, reason: read.reason as 'unreadable' | 'wrong-schema' };
  }
  /**
   * *A session with no turns is a session with nothing in it*, and importing one
   * would produce an empty session whose only content is a claim about where it
   * came from. Refused with its own reason rather than folded into
   * `unreadable`, because the two have different remedies: one is a broken file
   * and the other is the wrong file.
   */
  if (read.turns.length === 0) return { ok: false, reason: 'no-turns' };

  // `unknown[]` rather than `Turn[]`, for `readSessionExport`'s reason: the
  // declared element type is the claim the file makes about itself, and a
  // malformed member is exactly what a hand-edited export has.
  const listed = (read.turns as unknown[]).filter(
    (candidate): candidate is Turn =>
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as { id?: unknown }).id === 'string',
  );

  const turns = treeOf(listed, read.session.headTurnId);
  if (turns === null) return { ok: false, reason: 'broken-tree' };

  const owner = scopeOf(context.sessions, handle);
  const originalFilename = options.originalFilename ?? carriedFilename(read);

  /**
   * ***A source this account has already imported is refused, naming the
   * session it made*** ([P13.10]). Asked before the turns, because it is the
   * answer a person can act on: *already here, as Rain City*. The turn check
   * below would refuse the same re-import whenever the producer's ids are
   * stable (`producer.ts`); this one holds when they are not — a producer
   * whose derivation changed between versions — and it is scoped to the
   * account, where a turn id is one row on the install.
   */
  if (originalFilename !== null) {
    const prior = sessionImportedFrom(context.sessions.index, owner, originalFilename);
    if (prior !== null) return { ok: false, reason: 'already-here', prior };
  }

  /**
   * ***A session whose turns are already here is refused*** (2026-09-27), the
   * header's correction. The copy used to be made, and the original's search
   * hits and by-id reads then went to the copy's segments at the copy's
   * offsets; deleting the copy took the original's rows with it.
   */
  if (sessionHoldingTurns(context.sessions.index, turnIdsOf(turns)) !== null) {
    return { ok: false, reason: 'already-here' };
  }

  const missing = missingLinks(context, owner, read.session);
  if (
    options.requireLinks === true &&
    missing.cast.length + missing.lore.length + missing.treatment.length > 0
  ) {
    return { ok: false, reason: 'missing-links', missing };
  }

  const now = new Date().toISOString();
  const id = uuidv7();
  const { id: was, ...document_ } = read.session;
  const session = {
    ...document_,
    schema: 'storyengine.session/1',
    id,
    createdAt: now,
    updatedAt: now,
    /**
     * ***What it came from*** — [03 §8]'s `origin`, which that section specified
     * and nothing implemented until the format needed it.
     *
     * *The exporting install's own id for the session is not an address here*
     * once this install has minted its own; it is a fact about where the file
     * was made. It travels on every turn, as `foreign.source` (below), and this
     * record carries the rest of that fact.
     */
    origin: {
      source: 'import' as const,
      creator: null,
      version: exportedBy(read),
      license: null,
      originalFilename,
      createdAt: read.session.createdAt,
      updatedAt: read.session.updatedAt,
    },
  } as unknown as SessionFile;

  const root = sessionRoot(context.sessions.layout, handle, id);
  await ensureDirectory(root);
  await context.sessions.layout.assertReal(root);
  await writeJsonAtomic(sessionFilePath(context.sessions.layout, handle, id), session);
  // Indexed as every other session write is, so the session lists, links and
  // joins its turns' search rows from the moment it exists. This wrote the
  // file and nothing else, and an imported session had no row until somebody
  // happened to save it.
  indexWrittenSession(context.sessions, handle, session);

  /**
   * ***Parents before children, which is {@link treeOf}'s order.*** The tree
   * is the parent links and the file order is not the tree — but appending a
   * child before its parent would make every reader that walks forward see a
   * turn with a dangling parent for the length of the import. ~~In the order
   * the exporter wrote them, which is creation order~~ — this used to trust
   * the file for that, and nothing checked it (corrected 2026-09-29, [P13.10]).
   *
   * ***Each turn names the session it is in now.*** It kept the exporter's id,
   * which went into the index beside a location in this session's segments.
   * The id it came from is `foreign.source`, which is where provenance lives.
   */
  for (const turn of turns) {
    await appendTurnOnly(context.sessions, handle, id, { ...foreignise(turn, was), sessionId: id });
  }

  const renditions = await importRenditions(
    context,
    handle,
    { id, was },
    read,
    new Set(turnIdsOf(turns)),
    options,
  );
  return { ok: true, sessionId: id, turns: turns.length, renditions, missing };
}

function turnIdsOf(turns: readonly Turn[]): string[] {
  return turns.map((turn) => turn.id);
}

/**
 * ***The turns as a tree, parents first — or null when they are not one***
 * ([P13.10], 2026-09-29).
 *
 * The append loop's comment has always said the file is in creation order and
 * that creation order puts a parent before its child. Nothing checked either
 * half, and a producer is a second writer that could get the first wrong in
 * a way our own exports never showed.
 *
 * ***Ordered here rather than refused for being out of order***, which is the
 * one place this departs from [P13.10]'s wording (*"parents validated to
 * precede children"*). **Our own exporter can write a child first**: it sorts
 * by id on the argument that a uuidv7 carries its mint time
 * (`sessions/export.ts`), and a session played on two installs — exported
 * from one whose clock ran ahead, imported and played on one behind — has
 * children whose ids sort before their parents'. Refusing that would refuse
 * our own file for a property no person could see or fix, and the order is
 * recoverable from the parent links, which are the tree. So the order is
 * made, stably — file order wherever file order already works — and what is
 * refused is what no order can mend:
 *
 * - **a parent that names no turn in the file** — the tree missing its middle
 *   that this reader's docstring calls worse than no session at all;
 * - **a cycle**, which is a turn that is its own ancestor and has no place in
 *   any order;
 * - **a head that names no turn in the file**, which would leave the new
 *   session pointing at nothing — a producer that took the head from the
 *   wrong branch, say — where a head that fails to resolve reads as an empty
 *   story.
 *
 * ***A repeated id is one turn, the last line of it***, which is what the
 * segment reader does (`readTurns` keeps the last) and so what the session
 * the file came from showed. A segment can legitimately hold a turn twice —
 * an append the commit protocol re-ran — and a backup carries its segments
 * as they are.
 *
 * *A tombstone is exempt from the parent check*, since it names a turn that
 * was removed rather than one that is part of the story; it is carried, as
 * the segment would carry it, and every reader skips it.
 */
function treeOf(listed: readonly Turn[], head: unknown): Turn[] | null {
  const byId = new Map<string, Turn>();
  for (const turn of listed) byId.set(turn.id, turn);

  const childrenOf = new Map<string, Turn[]>();
  const roots: Turn[] = [];
  for (const turn of byId.values()) {
    const parent: unknown = turn.parentTurnId;
    if (turn.removed === true || parent === null) {
      roots.push(turn);
      continue;
    }
    if (typeof parent !== 'string' || !byId.has(parent)) return null;
    const siblings = childrenOf.get(parent);
    if (siblings === undefined) childrenOf.set(parent, [turn]);
    else siblings.push(turn);
  }
  if (typeof head === 'string' && !byId.has(head)) return null;

  /**
   * *Depth first with an explicit stack*, because a story is a chain and a
   * long one would overflow a recursive walk. Children are pushed in reverse
   * so they come off in file order, which keeps an already-ordered file in
   * its own order.
   */
  const ordered: Turn[] = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const turn = stack.pop();
    if (turn === undefined) break;
    ordered.push(turn);
    const children = childrenOf.get(turn.id);
    if (children !== undefined)
      for (let at = children.length - 1; at >= 0; at -= 1) {
        const child = children[at];
        if (child !== undefined) stack.push(child);
      }
  }
  // What no root reached is a cycle, or hangs from one.
  return ordered.length === byId.size ? ordered : null;
}

/**
 * The key a session carries from where it was last imported, if the document
 * says — the same unknown-first reading as {@link exportedBy}.
 *
 * ***Kept, as `foreign` is.*** A session a producer made and somebody then
 * exported is still the story that source row was; importing that export on
 * another install and then the source itself there would otherwise make it
 * twice. Only an `import` origin's key is read, which is the only kind this
 * reader writes and the only kind the index files.
 */
function carriedFilename(read: SessionExport): string | null {
  const origin = (read.session as Record<string, unknown>)['origin'];
  if (typeof origin !== 'object' || origin === null) return null;
  const { source, originalFilename } = origin as Record<string, unknown>;
  if (source !== 'import') return null;
  return typeof originalFilename === 'string' && originalFilename !== '' ? originalFilename : null;
}

/**
 * ***The links that would resolve to nothing if this session were played
 * here*** — see `SessionImportOptions.requireLinks` for why they are
 * reported, and refused only when a producer asks.
 *
 * **The three conditions `library.read` applies, asked of the index**: a live
 * row under the id, owned by this account or the system library, of the kind
 * the link means. That is what `resolveCast` and `resolveLore` ask at every
 * turn, so a link reported here is one play would miss, and one play would
 * find is never reported. *Not by name*: a session's links are ids
 * (`lore: string[]`), and `resolveLore` passes them with an empty name, so the
 * name fallback never runs for them.
 *
 * Read from the document unknown-first, for `readSessionExport`'s reason.
 */
function missingLinks(context: ImportContext, owner: string, session: unknown): MissingLinks {
  const document = session as Record<string, unknown>;
  const cast = document['cast'];
  const castIds: unknown[] =
    typeof cast === 'object' && cast !== null
      ? [
          (cast as Record<string, unknown>)['persona'],
          ...arrayOf((cast as Record<string, unknown>)['actors']),
        ]
      : [];

  const missing = (ids: readonly unknown[], kind: PortableSchemaId): string[] => {
    const out: string[] = [];
    for (const id of ids) {
      if (typeof id !== 'string' || id === '' || out.includes(id)) continue;
      const row = findById(context.sessions.index, id);
      const readable = row !== null && (row.owner === owner || row.owner === 'system');
      if (!readable || row.schemaId !== kind) out.push(id);
    }
    return out;
  };

  return {
    cast: missing(castIds, ACTOR_SCHEMA),
    lore: missing(arrayOf(document['lore']), LOREBOOK_SCHEMA),
    treatment: missing([document['treatment']], TREATMENT_SCHEMA),
  };
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/**
 * ***The pictures' records, which the import counted and never wrote***
 * (2026-09-27) — [06 §10.7]'s *recipes are never discarded*.
 *
 * It answered `renditions: n` for the records in the file and wrote none of
 * them, so the imported session's `se.backdrop` and `renditionSelection`
 * named records that did not exist, and the recipes were gone. Each record
 * `readRendition` would accept is written under the new session, and:
 *
 * - **A `pending` one becomes `interrupted`**, as boot recovery writes it: no
 *   job on this install will ever finish it, and `interrupted` is the state
 *   that offers a retry.
 * - **A picture keeps its pixels only if they came with it**, written where
 *   its `asset.path` says, inside this session's `assets/` and nowhere else.
 *   Without them it is a picture whose pixels were cleared: the recipe and a
 *   retry, which is `SessionExport.renditions`' own promise for an export.
 * - **A record of a turn that did not come across is left out**, because
 *   nothing could show it.
 * - **Marked foreign once**, as a turn is: `Rendition.foreign` names the
 *   session and the id it had where it was made, and a record that already
 *   carries one keeps it, for `foreignise`'s reason.
 */
async function importRenditions(
  context: ImportContext,
  handle: string,
  session: { id: string; was: string },
  read: SessionExport,
  turnIds: ReadonlySet<string>,
  options: SessionImportOptions,
): Promise<number> {
  const listed = (read as unknown as Record<string, unknown>)['renditions'];
  if (!Array.isArray(listed)) return 0;

  const { layout } = context.sessions;
  const sessionId = session.id;
  let written = 0;
  for (const candidate of listed) {
    const record = renditionFrom(candidate);
    if (record === null || !turnIds.has(record.turnId)) continue;

    let rendition: Rendition = {
      ...record,
      sessionId,
      foreign: record.foreign ?? { source: session.was, id: record.id },
    };
    if (rendition.state === 'pending') {
      rendition = { ...rendition, state: 'failed', asset: null, error: 'interrupted' };
    }
    rendition = {
      ...rendition,
      asset: await carryPixels(layout, handle, sessionId, rendition.asset, options),
    };

    try {
      await writeRendition(layout, handle, sessionId, rendition);
      written += 1;
    } catch {
      // An id that names no path, which `writeRendition` refuses. The record
      // is somebody's hand edit rather than a picture this install could show.
    }
  }
  return written;
}

/**
 * A rendition's pixels, written into the new session, or null when absent.
 *
 * The asset is read as `unknown`: `renditionFrom` checks the recipe, which is
 * what must survive, and not this, which may be anything a file says.
 */
async function carryPixels(
  layout: SessionContext['layout'],
  handle: string,
  sessionId: string,
  held: unknown,
  options: SessionImportOptions,
): Promise<Rendition['asset']> {
  if (options.pixels === undefined || typeof held !== 'object' || held === null) return null;
  const asset = held as Record<string, unknown>;
  const path = asset['path'];
  const mime = asset['mime'];
  if (typeof path !== 'string' || typeof mime !== 'string') return null;
  /**
   * ***The type is one the worker writes***, because the asset route serves the
   * record's `mime` as the response's content type: without this, a record in
   * an archive saying `text/html` over bytes that are a page would be served as
   * one, from this server's origin.
   */
  if (!IMAGE_TYPES.has(mime)) return null;

  const root = sessionAssetsRoot(layout, handle, sessionId);
  let to: string;
  try {
    to = resolveWithin(root, path);
  } catch {
    return null;
  }
  if (to === root) return null;

  const bytes = await options.pixels(path);
  if (bytes === null) return null;

  try {
    await ensureDirectory(root);
    await writeFileBytes(to, bytes);
  } catch {
    // A picture that cannot be written is one whose pixels are not here, which
    // is a state the record already has words and a retry for. It is not a
    // reason to lose the session it belongs to.
    return null;
  }
  // Described by the bytes that arrived, since `digest` is the route's etag.
  return {
    path,
    mime,
    bytes: bytes.byteLength,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

/**
 * The types an imported picture may keep its pixels under — PNG, JPEG and WebP,
 * the three every other picture this server stores is held to. Anything else
 * arrives as a picture that can be made again, which costs a regeneration.
 */
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** What wrote the file, if it said — the same unknown-first reading as above. */
function exportedBy(read: SessionExport): string | null {
  const said = (read as unknown as Record<string, unknown>)['exportedBy'];
  if (typeof said !== 'object' || said === null) return null;
  const version = (said as Record<string, unknown>)['version'];
  return typeof version === 'string' ? version : null;
}

/**
 * Marks a turn as having come from somewhere else, once.
 *
 * *A turn that already carries `foreign` keeps it*, because the first install it
 * came from is the one that matters — a session that had travelled twice and
 * claimed it came from the middle would be a provenance record that gets less
 * true the more it is used.
 */
function foreignise(turn: Turn, source: string): Turn {
  if (turn.foreign !== undefined) return turn;
  return { ...turn, foreign: { source, id: turn.id } };
}
