// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  SESSION_EXPORT_SCHEMA,
  type ImportNote,
  type ImportReport,
  type SessionExport,
  type TagEntry,
} from '@storyengine/shared';

import type { PrefsStore } from '../auth/prefs.js';
import { BackupFileSource } from '../import/backup-source.js';
import { sweep } from '../import/sweep.js';
import type { ConflictPolicy } from '../import/identity.js';
import type { LibraryContext } from '../library.js';
import { importSession } from '../sessions/import.js';
import type { SessionContext } from '../sessions/store.js';
import { ensureDirectory, fileExists, writeFileBytes } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import type { TagStore } from '../tags/store.js';

/**
 * ***Bringing an archive's content into a live account*** —
 * [P12.9](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***Import is not restore, and this module is the whole of the difference.***
 * A restore replaces a data directory and needs the server not to be running.
 * This merges, into a server that is, and **touches nothing that is install
 * authority**: `accounts.json`, `state/` and `system/library/` are never read
 * here. That line is what keeps the two verbs distinct rather than a slider,
 * and it is why somebody who clicks the wrong one loses nothing.
 *
 * ***Work and tags always; everything else is a switch somebody ticked.***
 * Library objects and sessions are what a person means by *my stuff*, and tags
 * travel with them because objects reference tags **by id** ([05 §4]) — an
 * import without them would leave every imported object pointing at names that
 * resolve to nothing. The rest are opt-in and each is off by default:
 * importing somebody's archive should not silently install their provider keys.
 */

export interface BackupImportOptions {
  /** `users/<h>/connections/*.json`. Off by default: these are credentials. */
  connections?: boolean;
  /** `prefs.json`, merged key-wise. */
  prefs?: boolean;
}

export interface BackupImportRequest {
  files: BackupFileSource;
  /** Whose subtree in the archive to read. */
  fromHandle: string;
  /** Whose library it lands in. The same account, unless an admin says otherwise. */
  handle: string;
  onConflict?: ConflictPolicy;
  options?: BackupImportOptions;
}

export interface BackupImportContext {
  layout: Layout;
  library: LibraryContext;
  sessions: SessionContext;
  tags: TagStore;
  prefs: PrefsStore;
}

export interface BackupImportResult {
  /** The library half, in the vocabulary every other import already uses. */
  report: ImportReport;
  sessions: { imported: number; skipped: number };
  tags: { added: number; kept: number };
  /** What each optional group did, whether it was asked for or not. */
  notes: ImportNote[];
}

export type BackupImportOutcome =
  { ok: true; result: BackupImportResult } | { ok: false; refusal: string };

/**
 * ***`skip` rather than `sweep`'s `replace`, and the disagreement is the
 * point.***
 *
 * A re-imported foreign file **is** the object that file produced, so replacing
 * is safe and history catches the edit. A backup meeting a live account is the
 * **past meeting the present**, and the present is usually what somebody wants
 * to keep — *bring in what I do not have* is what people mean when they reach
 * for this. All three policies are offered and each is named in the review.
 */
export const DEFAULT_BACKUP_CONFLICT: ConflictPolicy = 'skip';

export async function importBackup(
  context: BackupImportContext,
  request: BackupImportRequest,
): Promise<BackupImportOutcome> {
  const notes: ImportNote[] = [];

  const outcome = await sweep({
    library: context.library,
    handle: request.handle,
    fromHandle: request.fromHandle,
    files: request.files,
    onConflict: request.onConflict ?? DEFAULT_BACKUP_CONFLICT,
  });
  if (!outcome.ok) return { ok: false, refusal: outcome.refusal };

  const tags = await mergeTags(context, request, notes);
  const sessions = await importSessions(context, request, notes);

  if (request.options?.connections === true) {
    await copyConnections(context, request, notes);
  } else {
    notes.push({ key: 'import.backup.connectionsNotTaken', params: {}, level: 'info' });
  }

  if (request.options?.prefs === true) {
    await mergePrefs(context, request, notes);
  } else {
    notes.push({ key: 'import.backup.prefsNotTaken', params: {}, level: 'info' });
  }

  return { ok: true, result: { report: outcome.report, sessions, tags, notes } };
}

/**
 * ***Every note below is written out where it is emitted, key and params
 * together, and that is a constraint rather than a preference.***
 *
 * `note-labels.test.ts` proves each `{placeholder}` in a review sentence is a
 * parameter some emitter actually sends, and it does it by reading this source.
 * A `note(key, params)` helper hides the pair from that scan, so the check
 * reports *which no emitter sends* for a parameter that is always sent — which
 * is what it did here, on the first run, for a helper that used to be at this
 * spot.
 */

async function readJson(files: BackupFileSource, path: string): Promise<unknown> {
  const bytes = await files.read(path);
  if (bytes === null) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * ***Tags are merged by id, and an existing entry wins.***
 *
 * [05 §4] makes an object reference a tag **by id** so that renaming one
 * renames it everywhere — which means an import that brought objects and not
 * their tags would leave every imported object carrying ids that resolve to
 * nothing, and the library would show a row of blanks.
 *
 * **The existing entry wins a collision** because the same id meaning two
 * different things is not a case that arises from our own archives, and where
 * it does arise the one already in use is the one somebody is looking at.
 */
async function mergeTags(
  context: BackupImportContext,
  request: BackupImportRequest,
  notes: ImportNote[],
): Promise<{ added: number; kept: number }> {
  const document = await readJson(request.files, `users/${request.fromHandle}/tags.json`);
  const incoming = (document as { tags?: TagEntry[] } | null)?.tags;
  if (!Array.isArray(incoming)) return { added: 0, kept: 0 };

  const current = await context.tags.read(request.handle);
  const byId = new Map(current.tags.map((tag) => [tag.id, tag]));

  let added = 0;
  let kept = 0;
  for (const tag of incoming) {
    if (typeof tag.id !== 'string') continue;
    if (byId.has(tag.id)) {
      kept += 1;
      continue;
    }
    byId.set(tag.id, tag);
    added += 1;
  }

  if (added > 0) await context.tags.write(request.handle, [...byId.values()]);
  notes.push({ key: 'import.backup.tagsMerged', params: { added, kept }, level: 'info' });
  return { added, kept };
}

/**
 * ***Sessions go through the envelope rather than through a converter.***
 *
 * A backup holds a session the way the disk does — `session.json`, append-only
 * `turns/*.jsonl`, one file per rendition — and `sessions/import.ts` reads the
 * **export envelope**. Building one here rather than teaching the importer
 * about directories is the cheaper half by a long way, and it means every
 * property that path already has comes free: a re-minted session id, the turn
 * ids kept, every turn marked foreign, and `origin` recorded.
 *
 * ***A session already here is skipped and never replaced.*** A session is an
 * append-only log, so *replace* would be a delete plus an import — two
 * decisions wearing one word — and the one it would throw away is the one
 * somebody has been playing.
 */
async function importSessions(
  context: BackupImportContext,
  request: BackupImportRequest,
  notes: ImportNote[],
): Promise<{ imported: number; skipped: number }> {
  const prefix = `users/${request.fromHandle}/sessions/`;
  const ids = new Set<string>();
  for await (const path of request.files.list()) {
    if (!path.startsWith(prefix)) continue;
    const id = path.slice(prefix.length).split('/')[0];
    if (id !== undefined && id !== '') ids.add(id);
  }

  let imported = 0;
  let skipped = 0;
  for (const id of [...ids].sort()) {
    const session = await readJson(request.files, `${prefix}${id}/session.json`);
    if (session === null) {
      skipped += 1;
      continue;
    }

    const turns: unknown[] = [];
    for await (const path of request.files.list()) {
      if (!path.startsWith(`${prefix}${id}/turns/`)) continue;
      const bytes = await request.files.read(path);
      if (bytes === null) continue;
      for (const line of new TextDecoder().decode(bytes).split('\n')) {
        if (line.trim() === '') continue;
        try {
          turns.push(JSON.parse(line));
        } catch {
          // A segment is the one file a crash can leave half-written, and
          // `sessions/segments.ts` already drops a line that does not parse.
          // An archive carries whatever was there, so this does the same.
        }
      }
    }
    if (turns.length === 0) {
      skipped += 1;
      continue;
    }

    const renditions: unknown[] = [];
    for await (const path of request.files.list()) {
      if (!path.startsWith(`${prefix}${id}/renditions/`)) continue;
      const record = await readJson(request.files, path);
      if (record !== null) renditions.push(record);
    }

    const envelope = {
      schema: SESSION_EXPORT_SCHEMA,
      exportedBy: { version: null, at: new Date().toISOString() },
      session,
      turns,
      renditions,
    } as unknown as SessionExport;

    /**
     * ***And the pixels, because they are in the archive.*** An export carries
     * the records and not the pictures; a backup carries the session directory
     * whole, `assets/` included, and until 2026-09-27 this built the envelope
     * and left them where they lay. `importSession` checks what it is handed —
     * a bare file name, an image type, the bytes matching the record's digest —
     * so this only has to say where the bytes would be.
     */
    const result = await importSession(
      {
        sessions: context.sessions,
        assets: (asset) => request.files.read(`${prefix}${id}/assets/${asset.path}`),
      },
      request.handle,
      envelope,
    );
    if (result.ok) imported += 1;
    else skipped += 1;
  }

  notes.push({ key: 'import.backup.sessions', params: { imported, skipped }, level: 'info' });
  return { imported, skipped };
}

/**
 * ***Provider connections, only when asked for.***
 *
 * Off by default because an archive is a file somebody may have been handed:
 * importing one should not silently install another person's provider keys into
 * the account doing the importing, where they would be spent against somebody
 * else's bill.
 *
 * **Never overwritten.** A connection already here is one this account is
 * using, and an import is not a reason to point it somewhere else.
 */
async function copyConnections(
  context: BackupImportContext,
  request: BackupImportRequest,
  notes: ImportNote[],
): Promise<void> {
  const prefix = `users/${request.fromHandle}/connections/`;
  const root = context.layout.userConnectionsRoot(request.handle);
  let added = 0;
  let kept = 0;

  for await (const path of request.files.list()) {
    if (!path.startsWith(prefix) || !path.endsWith('.json')) continue;
    const name = path.slice(prefix.length);
    if (name.includes('/')) continue;

    const bytes = await request.files.read(path);
    if (bytes === null) continue;

    const to = `${root}/${name}`;
    if (await fileExists(to)) {
      kept += 1;
      continue;
    }
    await ensureDirectory(root);
    await writeFileBytes(to, bytes);
    added += 1;
  }

  notes.push({ key: 'import.backup.connectionsTaken', params: { added, kept }, level: 'info' });
}

/**
 * Preferences, merged key-wise and only when asked for.
 *
 * **An existing preference wins**, which is the same rule the tags take: what
 * somebody is looking at now is more likely to be what they want than what a
 * snapshot said.
 */
async function mergePrefs(
  context: BackupImportContext,
  request: BackupImportRequest,
  notes: ImportNote[],
): Promise<void> {
  const document = await readJson(request.files, `users/${request.fromHandle}/prefs.json`);
  const incoming = (document as { prefs?: Record<string, unknown> } | null)?.prefs;
  if (typeof incoming !== 'object') {
    notes.push({ key: 'import.backup.prefsTaken', params: { added: 0 }, level: 'info' });
    return;
  }

  const current = await context.prefs.read(request.handle);
  const missing: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in current)) missing[key] = value;
  }

  if (Object.keys(missing).length > 0) await context.prefs.patch(request.handle, missing);
  notes.push({
    key: 'import.backup.prefsTaken',
    params: { added: Object.keys(missing).length },
    level: 'info',
  });
}
