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
   * *And each record without its binding's connection id* (2026-10-13, the
   * owner's decision): {@link travellingRendition}.
   */
  const held = await readRenditions(context.sessions.layout, handle, sessionId).catch(
    () => new Map<string, Rendition>(),
  );
  const renditions: Rendition[] = [...held.values()]
    .sort((one, two) => (one.id < two.id ? -1 : 1))
    .map((one) => travellingRendition(one));

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

/**
 * ***A rendition as it travels: the model it was asked of, never the
 * connection's id*** — the owner's decision of 2026-10-13, which answers what
 * [26 B20](../../../../docs/design/26-open-questions.md) and
 * [22 §7](../../../../docs/design/22-internal-contracts.md) left *not decided*
 * the same morning.
 *
 * **Why here, in the writer, and not in `travelling()` or the reader.** Every
 * road a rendition record takes off this install starts in
 * {@link exportSession}: the session export route, the World file (whose
 * `travelling()` builds on this), the review's `measureSession`, and the
 * session digest the publish ledger records. One strip here keeps all four
 * saying the same thing — a strip in `travelling()` alone would leave the plain
 * export carrying the id while the World file did not, and the review would
 * measure a different document from the one the route sends. *The reader is
 * the wrong place for the only strip* because a backup's merge reads through
 * the same session reader, and a backup is the account's own data, whose
 * merge lands each session verbatim: its `session.json` keeps `roles` and
 * `stepRoles` naming connections and its turns keep `resolved.connectionId`,
 * so a rendition's id is treated no differently — ids kept as they are, the
 * argument `backup/import.ts` makes for the connections themselves, where
 * re-minting would orphan every binding that names one. *That keeps the id; it
 * does not make it name something.* It names a connection when the merge
 * lands on the account that still holds it, or when a full archive's
 * connections are taken with it (`options.connections`, off by default); a
 * redacted archive carries none, and a merge never brings a system connection
 * in. On a default merge of somebody else's archive, or of a redacted one, it
 * names nothing, as it did before this decision — harmless, because nothing
 * reads it from a record — and whether that merge should strip it is **not
 * decided**. The World file's reader takes the id out a second time
 * (`import/world/session.ts`), for a file this writer did not make.
 *
 * ***The key goes and `binding` stays.*** `null` stays `null`, which is *not
 * recorded*; a binding becomes `{ modelId }`, the `connectionId` key deleted
 * from a copy rather than set to `undefined` or `''` — absent is what says
 * *this record travelled* (`RenditionProvenance.binding`), and an empty string
 * would be a value claiming to name a connection. Removing `binding` itself is
 * the one shape that breaks a reader: the workbench's *Asked* row reads
 * `binding.modelId` whenever it is not `null`.
 *
 * *Read as `unknown` below `provenance`*, because the record is whatever is
 * on disk: `readRenditions` checks the seed and the workflow and not the
 * binding, so a hand-edited file can hold anything there, and anything that is
 * not an object holding the key is passed on as it is — the writer's job is to
 * drop one field, not to judge the record. *A copy, never the record*: the
 * file on this install keeps its id, which retries and the reuse key are
 * computed beside.
 *
 * ***What it does not touch.*** `Rendition.digest`, which still folds the id
 * in (one-way, and only ever compared — see its docstring in `rendition.ts`);
 * and the turns' recorded calls, `ModelCall.resolved`, which carry the same
 * kind of id — which connection answered each call — and are **not** decided
 * by this: the decision names renditions only, and the calls stay as they are
 * written.
 */
export function travellingRendition<T>(record: T): T {
  if (typeof record !== 'object' || record === null) return record;
  const provenance: unknown = (record as Record<string, unknown>)['provenance'];
  if (typeof provenance !== 'object' || provenance === null) return record;
  const binding: unknown = (provenance as Record<string, unknown>)['binding'];
  if (typeof binding !== 'object' || binding === null || !('connectionId' in binding)) {
    return record;
  }
  const kept: Record<string, unknown> = { ...binding };
  delete kept['connectionId'];
  return { ...record, provenance: { ...provenance, binding: kept } };
}
