// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  readTagRegistry,
  sameTag,
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
import { storeAttachment } from '../sessions/attachments.js';
import { importSession } from '../sessions/import.js';
import { readSession, type SessionContext } from '../sessions/store.js';
import {
  ensureDirectory,
  fileExists,
  listDirectoryNames,
  writeFileBytes,
} from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { resolveWithin } from '../storage/paths.js';
import { splitTrashEntry } from '../storage/trash.js';
import { MAX_TAG_NAME_LENGTH, MAX_TAGS, type TagStore } from '../tags/store.js';

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
 * **The existing entry wins a collision**, by id or by name, because the one
 * already in use is the one somebody is looking at.
 *
 * ***A name clash is kept, not thrown*** (2026-09-27). This merged by id only
 * and wrote the list whole, and the store refuses two tags of one name. Two
 * installs that each minted an `npc` (adoption mints fresh ids, and an
 * Aventuras import tags every NPC) met here, and the import failed *after*
 * the library was written: no sessions, no ledger row, and the same wall on
 * every retry. Now the tag here keeps its name, and an imported object whose
 * id for it is the archive's still reads `npc`, because a dangling id falls
 * back to the name stored beside it ([05 §3]'s invariant 4); adopting tags
 * again points it at this registry's id.
 *
 * Read with `readTagRegistry`, which drops a row with no name or id and the
 * archive's own duplicates, and written inside `mutate`, so a tag made in
 * another tab meanwhile is merged with rather than overwritten. What the store
 * would refuse — a registry at its bound, a name past its length, which only a
 * hand edit writes — is kept out rather than thrown at.
 */
async function mergeTags(
  context: BackupImportContext,
  request: BackupImportRequest,
  notes: ImportNote[],
): Promise<{ added: number; kept: number }> {
  const document = await readJson(request.files, `users/${request.fromHandle}/tags.json`);
  const incoming = document === null ? [] : readTagRegistry(document).tags;
  if (incoming.length === 0) return { added: 0, kept: 0 };

  let added = 0;
  let kept = 0;
  await context.tags.mutate(request.handle, (current) => {
    // Counted afresh on each call: the queue runs this once, but a count that
    // depended on that would be wrong the day it ran twice.
    added = 0;
    kept = 0;
    const out: TagEntry[] = [...current.tags];
    for (const tag of incoming) {
      const here = out.some((held) => held.id === tag.id || sameTag(held.name, tag.name));
      if (here || out.length >= MAX_TAGS || tag.name.length > MAX_TAG_NAME_LENGTH) {
        kept += 1;
        continue;
      }
      out.push({ ...tag, sortOrder: out.length });
      added += 1;
    }
    return out;
  });

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
 * ***A session already here is skipped and never replaced***, whatever the
 * policy the library took. A session is an append-only log, so *replace*
 * would be a delete plus an import — two decisions wearing one word — and the
 * one it would throw away is the one somebody has been playing. *keep both*
 * would be a second session holding the same turn ids, which the index cannot
 * tell apart.
 *
 * ***And "already here" is now asked*** (2026-09-27). Nothing checked, so
 * every import of somebody's own backup brought a second copy of every
 * session, and the next import a third. Here means one of three things:
 *
 * - **the session**, under its own id: an import of this account's backup.
 *   Its turns would say so too, but this is one file read rather than every
 *   segment, and it holds when the index is behind;
 * - **its turns**, anywhere on the install: a copy an earlier import made
 *   (`importSession` refuses it, since the copy holds the same turn ids);
 * - **the account's trash**, under its own id: restoring it from there brings
 *   back the newer copy, and an import as well would leave two sessions
 *   holding one set of turns once it was restored.
 *
 * The pixels ride along: a backup holds `assets/`, which an export does not.
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

  const trashed = await trashedSessionIds(context, request.handle);

  let imported = 0;
  let skipped = 0;
  for (const id of [...ids].sort()) {
    if (trashed.has(id) || (await isSessionHere(context, request.handle, id))) {
      skipped += 1;
      continue;
    }

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

    const result = await importSession({ sessions: context.sessions }, request.handle, envelope, {
      // A record's `asset.path` is relative to the session's `assets/`, and a
      // name the source does not hold is a picture that did not come across.
      pixels: async (path) => request.files.read(`${prefix}${id}/assets/${path}`),
    });
    if (result.ok) {
      imported += 1;
      /**
       * ***The pictures on its moves, which only a backup can bring*** —
       * [25 E15]. An export carries the records and not the bytes; an archive
       * carries the session directory whole. Stored through the attachment
       * store rather than copied by name, so every file is re-addressed by its
       * own bytes: one renamed or altered in the archive lands under the digest
       * it actually has, where no turn names it, and the turn that named the
       * original sends its words.
       */
      for await (const path of request.files.list()) {
        if (!path.startsWith(`${prefix}${id}/attachments/`)) continue;
        const bytes = await request.files.read(path);
        if (bytes === null) continue;
        await storeAttachment(context.sessions.layout, request.handle, result.sessionId, bytes);
      }
    } else skipped += 1;
  }

  notes.push({ key: 'import.backup.sessions', params: { imported, skipped }, level: 'info' });
  return { imported, skipped };
}

/** Whether this account has a session under this id now. */
async function isSessionHere(
  context: BackupImportContext,
  handle: string,
  id: string,
): Promise<boolean> {
  try {
    return (await readSession(context.sessions, handle, id)) !== null;
  } catch {
    // An id that is not a path here is not a session here either, and the
    // import that follows refuses it for itself.
    return false;
  }
}

/** The ids of the sessions in this account's trash, read as the trash reads them. */
async function trashedSessionIds(
  context: BackupImportContext,
  handle: string,
): Promise<Set<string>> {
  const names = await listDirectoryNames(
    resolveWithin(context.layout.trashRoot(handle), 'sessions'),
  );
  const ids = new Set<string>();
  for (const name of names) {
    const split = splitTrashEntry(name);
    if (split !== null) ids.add(split.name);
  }
  return ids;
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
