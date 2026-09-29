// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';

import {
  uuidv7,
  SESSION_EXPORT_SCHEMA,
  type Rendition,
  type SessionExport,
  type Turn,
} from '@storyengine/shared';

import { sessionHoldingTurns } from '../index-db/sessions.js';
import { renditionFrom, sessionAssetsRoot, writeRendition } from '../renditions/store.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { ensureDirectory, writeFileBytes } from '../storage/files.js';
import { resolveWithin } from '../storage/paths.js';
import {
  appendTurnOnly,
  indexWrittenSession,
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
}

export type SessionImport =
  | { ok: true; sessionId: string; turns: number; renditions: number }
  | { ok: false; reason: 'unreadable' | 'wrong-schema' | 'no-turns' | 'already-here' };

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
  const turns = (read.turns as unknown[]).filter(
    (candidate): candidate is Turn =>
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as { id?: unknown }).id === 'string',
  );

  /**
   * ***A session whose turns are already here is refused*** (2026-09-27), the
   * header's correction. The copy used to be made, and the original's search
   * hits and by-id reads then went to the copy's segments at the copy's
   * offsets; deleting the copy took the original's rows with it.
   */
  if (sessionHoldingTurns(context.sessions.index, turnIdsOf(turns)) !== null) {
    return { ok: false, reason: 'already-here' };
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
      originalFilename: null,
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
   * ***In the order the exporter wrote them, which is creation order.*** The
   * tree is the parent links and the file order is not the tree — but appending
   * a child before its parent would make every reader that walks forward see a
   * turn with a dangling parent for the length of the import, and creation order
   * is a total order in which that cannot happen.
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
  return { ok: true, sessionId: id, turns: turns.length, renditions };
}

function turnIdsOf(turns: readonly Turn[]): string[] {
  return turns.map((turn) => turn.id);
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
