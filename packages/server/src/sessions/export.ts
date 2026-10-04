// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  SESSION_EXPORT_SCHEMA,
  type Rendition,
  type SessionExport,
  type Turn,
} from '@storyengine/shared';

import type { BuildInfo } from '../build-info.js';
import { readRenditions } from '../renditions/store.js';
import { readSession, readTurns, type SessionContext } from './store.js';

/**
 * ***A session, serialised whole*** — [26 B12], [19 §3],
 * [P11.10](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **Three lines of work and one of them is the feature.** Reading the session
 * and the renditions is bookkeeping; reading **every turn rather than the
 * path** is the thing [19 §3]'s third consequence is about, and it is the one a
 * serialiser written against our own read surfaces gets wrong — because every
 * read surface in this build calls `walkPath(head)` and that is the natural
 * thing to reach for.
 *
 * ***`readTurns` rather than `walkPath`***, and the difference is the whole
 * obligation: `readTurns` answers with the file, and `walkPath` answers with one
 * walk of it. [07 §3](../../../../docs/design/07-branching.md) makes swipes and
 * branches one mechanism, so a serialised path drops every swipe — **lossy
 * against our own data before any import touched it**, and invisible against a
 * linear session, which is what every test fixture is.
 */

export interface ExportContext {
  sessions: SessionContext;
  build: BuildInfo | null;
}

export async function exportSession(
  context: ExportContext,
  handle: string,
  sessionId: string,
): Promise<SessionExport | null> {
  const session = await readSession(context.sessions, handle, sessionId);
  if (session === null) return null;

  const byId = await readTurns(context.sessions, handle, sessionId);
  /**
   * ***Creation order, which is a total order and is not the tree.*** The tree
   * is the parent links; this is only so that two exports of one session are
   * byte-identical, which is what makes a diff of two exports mean something.
   * `uuidv7` sorts by mint time, so the ids already carry it.
   */
  const turns: Turn[] = [...byId.values()].sort((one, two) => (one.id < two.id ? -1 : 1));

  /**
   * A session with no renditions, or a store that would not answer: **an export
   * missing its pictures is worth having and an export that failed is not.**
   * The records travel and the pixels do not — see `SessionExport.renditions`.
   */
  const held = await readRenditions(context.sessions.layout, handle, sessionId).catch(
    () => new Map<string, Rendition>(),
  );
  const renditions: Rendition[] = [...held.values()].sort((one, two) => (one.id < two.id ? -1 : 1));

  return {
    schema: SESSION_EXPORT_SCHEMA,
    exportedBy: { version: context.build?.version ?? null, at: new Date().toISOString() },
    /**
     * ***The document as it is on disk, spread.*** [19 §3]'s first consequence
     * says not to tighten what the record leaves loose, and the cheapest way to
     * honour it is not to restate the shape at all: a field this build grows
     * next phase travels without anybody remembering to add it here, and a
     * field it drops stops travelling for the same reason.
     *
     * *What is deliberately not stripped is `channels`*, which is derived —
     * see `SessionExport.session` for why a cache with its source in the same
     * file is the safe kind.
     */
    session: { ...session },
    turns,
    renditions,
  };
}
