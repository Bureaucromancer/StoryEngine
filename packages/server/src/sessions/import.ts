// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  uuidv7,
  SESSION_EXPORT_SCHEMA,
  type Rendition,
  type RenditionAsset,
  type SessionExport,
  type Turn,
} from '@storyengine/shared';

import { digestOf } from '../library/assets.js';
import {
  namesARendition,
  parseRendition,
  sessionAssetsRoot,
  writeRendition,
} from '../renditions/store.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { ensureDirectory, writeFileBytes } from '../storage/files.js';
import { PathEscapeError, resolveWithin } from '../storage/paths.js';
import { appendTurnOnly, sessionFilePath, sessionRoot, type SessionContext } from './store.js';
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
 * project spends the most care on. Keeping them costs a collision **only**
 * between two installs importing each other's sessions of the same session,
 * which is `uuidv7` on two machines and is the collision the id scheme is chosen
 * to make negligible. *The session's own id is re-minted*, because that one is
 * an address on this install and two installs with the same session id is a
 * real and immediate confusion rather than a theoretical one.
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
  /**
   * The bytes of a rendition's picture, when whoever is importing has them.
   *
   * ***Absent for a session export, present for a backup.*** An export carries
   * *"the records, not the pixels"* (`SessionExport`), so a picture that arrives
   * that way arrives as its recipe and a placeholder. A backup archive holds the
   * session directory whole, `assets/` included, and throwing away pixels that
   * are physically in the file somebody handed over would be a loss with no
   * reason behind it.
   */
  assets?: (asset: RenditionAsset) => Promise<Uint8Array | null>;
}

export type SessionImport =
  | { ok: true; sessionId: string; turns: number; renditions: number }
  | { ok: false; reason: 'unreadable' | 'wrong-schema' | 'no-turns' };

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
     * *The exporting install's own id for the session goes here*, which is the
     * only place it can honestly live once this install has minted its own: it
     * is not an address here, it is a fact about where the file was made.
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

  /**
   * ***In the order the exporter wrote them, which is creation order.*** The
   * tree is the parent links and the file order is not the tree — but appending
   * a child before its parent would make every reader that walks forward see a
   * turn with a dangling parent for the length of the import, and creation order
   * is a total order in which that cannot happen.
   */
  let written = 0;
  const arrivedTurns = new Set<string>();
  // `unknown[]` rather than `Turn[]`, for `readSessionExport`'s reason: the
  // declared element type is the claim the file makes about itself, and a
  // malformed member is exactly what a hand-edited export has.
  for (const candidate of read.turns as unknown[]) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const turn = candidate as Turn;
    if (typeof turn.id !== 'string') continue;
    await appendTurnOnly(context.sessions, handle, id, foreignise(turn, was));
    arrivedTurns.add(turn.id);
    written += 1;
  }

  /**
   * ***The renditions come across as records*** — written, not counted, which
   * is what this function did until 2026-09-27 while reporting a number as if
   * it had. [21 §7.1]'s *"the recipe travels and the pixels do not"* is a rule
   * about what the **file** carries; the recipe was never meant to stop at the
   * importer, and [testing]'s export → re-import walk names renditions among
   * what has to survive it.
   *
   * *Only records whose turn arrived.* A rendition names its turn and nothing
   * else holds it in place, so one pointing at a turn that was skipped above is
   * a picture of nothing.
   */
  let renditions = 0;
  const offered = read.renditions as unknown;
  if (Array.isArray(offered)) {
    for (const candidate of offered as unknown[]) {
      const rendition = parseRendition(candidate);
      if (rendition === null || !arrivedTurns.has(rendition.turnId)) continue;
      if (!namesARendition(context.sessions.layout, handle, id, rendition.id)) continue;
      const asset = await carriedAsset(context, handle, id, rendition);
      await writeRendition(context.sessions.layout, handle, id, arrived(rendition, id, was, asset));
      renditions += 1;
    }
  }

  return { ok: true, sessionId: id, turns: written, renditions };
}

/**
 * A rendition as this session holds it.
 *
 * - ***Its id is kept***, for the reason turn ids are: a rendition's id is its
 *   turn's plus an ordinal, the session document's `renditionSelection` names
 *   records by it, and re-minting would be a rewrite of every one of those
 *   references. That the same id can now exist in two sessions of one install
 *   is why the job table is keyed by session as well.
 * - ***Its session is this one.*** The record's own `sessionId` is what a live
 *   frame is matched against, and a record that still named the session it was
 *   exported from would never update on screen.
 * - ***A picture still being made becomes one that was interrupted.*** Nothing
 *   will ever run an imported `pending` record — the job that owned it is on
 *   another install, or on this one under another session — so left as it
 *   was it would say *"Making a picture of this…"* for good, with no retry.
 *   `interrupted` is what boot recovery calls the same fact, and it renders
 *   with a reason and a *Try again*.
 * - ***Marked foreign once***, as a turn is.
 */
function arrived(
  rendition: Rendition,
  sessionId: string,
  source: string,
  asset: RenditionAsset | null,
): Rendition {
  return {
    ...rendition,
    sessionId,
    ...(rendition.state === 'pending'
      ? { state: 'failed' as const, error: 'interrupted' as const }
      : {}),
    asset,
    foreign: rendition.foreign ?? { source, id: rendition.id },
  };
}

/**
 * The picture's bytes, written beside the record — or null, which is the
 * ordinary answer.
 *
 * Null from an export, which carries no pixels, and null from anything that
 * fails a check. A `ready` record with a null asset is the state this build
 * already renders as a picture that can be made again ([25 E3]), so every
 * refusal here costs a regeneration and never the record.
 *
 * ***Every field is somebody else's claim, so each is checked before it is
 * believed:***
 *
 * - **The path is a bare file name inside this session's `assets/`.** The route
 *   that serves pixels joins it to that directory, so a `../` here would be a
 *   way to have this server hand out any file under the data root.
 * - **The type is one the worker writes.** The route serves the record's `mime`
 *   as the response's content type, and a picture that said `text/html` would
 *   be a page on this server's own origin.
 * - **The bytes are the ones the record describes**, by their digest — the
 *   `sha256:` spelling `RenditionAsset.digest` already uses.
 */
async function carriedAsset(
  context: ImportContext,
  handle: string,
  sessionId: string,
  rendition: Rendition,
): Promise<RenditionAsset | null> {
  const asset = rendition.asset;
  if (asset === null || context.assets === undefined) return null;
  if (!SAFE_FILE_NAME.test(asset.path) || !IMAGE_TYPES.has(asset.mime)) return null;

  let target: string;
  try {
    target = resolveWithin(
      sessionAssetsRoot(context.sessions.layout, handle, sessionId),
      asset.path,
    );
  } catch (error) {
    if (error instanceof PathEscapeError) return null;
    throw error;
  }

  const bytes = await context.assets(asset);
  if (bytes === null || digestOf(bytes) !== asset.digest) return null;
  await writeFileBytes(target, bytes);
  return { ...asset, bytes: bytes.byteLength };
}

/** What `fileNameFor` in the worker produces: an id, a dot, an extension. */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The three types the rendition worker writes, and so the three it can serve. */
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
