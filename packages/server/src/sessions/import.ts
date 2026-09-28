// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { uuidv7, SESSION_EXPORT_SCHEMA, type SessionExport } from '@storyengine/shared';

import { remint } from './remint.js';
import { appendTurnOnly, writeNewSession, type SessionContext } from './store.js';
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
 * ~~***The turn ids are kept, and that is the decision most likely to be
 * re-argued.***~~ ***The turn ids are re-minted*** —
 * [P13.0](../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * 2026-09-28, reversing the decision this paragraph used to record. It argued
 * that keeping them cost a collision *only between two installs importing each
 * other's sessions*. It cost one on **one** install, every time: an export
 * imported back onto the install that wrote it, and every backup imported into
 * its own account, put two sessions' turns under one set of ids — and the
 * index, the rendition jobs and the notification dedupe all key a turn by its
 * id alone. The copy's turns were filed under the original, and an Illustrate
 * on the copy re-rendered the original's picture. The graph rewrite the old
 * paragraph declined is `remint.ts`, and it is done by value rather than by a
 * list of paths, so fields this build does not know are rewritten too. *The
 * session's own id is re-minted* for the reason it always was.
 *
 * ***Every turn is marked foreign.*** `Turn.foreign` exists for this — [18 §3]'s
 * second consequence, *"a foreign identifier has somewhere to go"* — and marking
 * is what keeps *this install made this* answerable afterwards. With the ids
 * re-minted it is also where the old id lives: `foreign.id` is the identity
 * that travels, and `turn.id` is an address on this install. A turn that
 * arrived with its own `foreign` keeps it: the first install it came from is the
 * one that matters, and overwriting it would make a session that had travelled
 * twice claim it came from the middle.
 */

export interface ImportContext {
  sessions: SessionContext;
}

export type SessionImport =
  | {
      ok: true;
      sessionId: string;
      turns: number;
      renditions: number;
      /**
       * Old turn id to new — not for the wire (a route sends the counts), for a
       * caller that has to place something by turn id afterwards.
       */
      turnIds: ReadonlyMap<string, string>;
    }
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
  const was = typeof read.session.id === 'string' ? read.session.id : '';
  /**
   * ***New ids before anything is written***, so nothing on disk ever holds a
   * turn under an id another session already uses — [P13.0]. `remint` also
   * puts every parent before its children: the format's turns are *"in no
   * particular order"*, and a backup's envelope is in archive order, so the
   * order is established here rather than assumed of the file.
   */
  const reminted = remint(read, { sessionId: id, was });
  const session = {
    ...reminted.session,
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

  await writeNewSession(context.sessions, handle, session);

  for (const turn of reminted.turns) {
    await appendTurnOnly(context.sessions, handle, id, turn);
  }

  const renditions = read.renditions as unknown;
  return {
    ok: true,
    sessionId: id,
    turns: reminted.turns.length,
    renditions: Array.isArray(renditions) ? renditions.length : 0,
    turnIds: reminted.turnIds,
  };
}

/** What wrote the file, if it said — the same unknown-first reading as above. */
function exportedBy(read: SessionExport): string | null {
  const said = (read as unknown as Record<string, unknown>)['exportedBy'];
  if (typeof said !== 'object' || said === null) return null;
  const version = (said as Record<string, unknown>)['version'];
  return typeof version === 'string' ? version : null;
}
