// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { uuidv7 } from '@storyengine/shared';

import { writeAtomic } from './atomic.js';
import { appendLine, fileExists, listEntryNames, readFileBytes, removeTree } from './files.js';
import { KeyedQueue } from './keyed-queue.js';
import { resolveWithin } from './paths.js';

/**
 * Version history on library objects — [03 §11](../../../../docs/design/03-data-model.md).
 *
 * **History lives inside the object's own folder**, not in the index:
 *
 * ```
 * <object>/history/
 *   index.jsonl        append-only: one VersionRecord per line
 *   v/<sha256>.json    snapshot payloads, content-addressed
 * ```
 *
 * The folder is the object, so dragging it out takes the history along; and
 * because the payloads are content-addressed, edit-revert-edit stores the
 * repeated state once with two entries pointing at it.
 *
 * **This module records; it does not decide.** Whether a write deserves a
 * snapshot — the no-op rule, whose state is being replaced, what the source
 * was — is the write path's call (`library.ts`, and the watcher for foreign
 * edits). The one policy held here is the consecutive-duplicate guard, because
 * it is a property of the record stream rather than of any caller.
 */

/**
 * What made the change this snapshot preserves the state before
 * ([21 §1.6](../../../../docs/design/21-internal-contracts.md)). More things edit objects
 * here than in the design this is adopted from, and *"who changed my
 * character"* is the question history answers — `assist`, `extension` and
 * `import` have no writers until their phases, but the type is the contract.
 */
export type VersionSource =
  | { kind: 'manual' }
  | { kind: 'assist'; field: string }
  | { kind: 'extension'; extensionId: string }
  | { kind: 'import'; from: string }
  | { kind: 'external' }
  | { kind: 'restore'; fromVersionId: string }
  /**
   * ***A memory this account's own play wrote*** — [08 §2], [P8.2]. The seventh
   * kind, and the first added since the type was written.
   *
   * **Named rather than folded into `extension`**, which is the arm it looks
   * most like. *"Who changed my character"* is the question history answers, and
   * *an extension did* and *a session did* are different answers with different
   * repairs: one is software somebody installed, the other is the story they
   * were playing. `sessionId` is what makes the second one act-on-able — it is
   * the line in the list that says **which** story, and it is the same origin ref
   * the entry itself carries in its metadata.
   *
   * ***And it prices what [P8 §1.1] left unpriced.*** That section's cost table
   * has a row reading *"a history version per extraction — a seventh
   * `VersionSource` kind and a retention posture. Real, unpriced above, an
   * afternoon."* This is the kind; the retention posture is
   * [03 §11.3](../../../../docs/design/03-data-model.md)'s ordinary pruning,
   * which a derived book has more need of than an authored one and no different
   * a rule for.
   */
  | { kind: 'memory'; sessionId: string };

/** One line of `history/index.jsonl` — [21 §1.6](../../../../docs/design/21-internal-contracts.md). */
export interface VersionRecord {
  id: string;
  /** sha256 of the snapshot payload — the filename under `history/v/`. */
  digest: string;
  /**
   * When the snapshotted state was *authored*, not when it was superseded.
   * Taken from the replaced object's `provenance.updatedAt`, so a restored
   * version keeps its real date in the list ([03 §11.1]).
   */
  authoredAt: string;
  /** When the snapshot was taken. */
  recordedAt: string;
  source: VersionSource;
  /** Free text. Sometimes generated, sometimes the user's — renameable later. */
  reason: string;
  /** The author's own `provenance.version` at the time — theirs, not ours ([03 §11.5]). */
  authorVersion: string | null;
  /** Exempt from retention pruning ([03 §11.3]). */
  pinned: boolean;
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Serialises the mutators per object root. Two producers write history
 * concurrently — the API write path (`library.ts`) and the watcher's
 * external-edit snapshots — and the index file mixes an append
 * (`recordVersion`) with whole-file rewrites (`patchVersion`,
 * `pruneVersions`): an append landing between a rewrite's read and its write
 * would be silently discarded. Reads (`listVersions`) stay unlocked; the
 * torn-tail tolerance already covers reading mid-append.
 */
const mutations = new KeyedQueue();

function indexFile(objectRoot: string): string {
  return resolveWithin(objectRoot, 'history', 'index.jsonl');
}

function payloadFile(objectRoot: string, digest: string): string {
  if (!DIGEST_PATTERN.test(digest)) {
    throw new Error(`Not a payload digest: ${JSON.stringify(digest)}`);
  }
  return resolveWithin(objectRoot, 'history', 'v', `${digest}.json`);
}

/**
 * The snapshot's canonical bytes: the same two-space, trailing-newline form the
 * store itself uses, so a payload diffs and greps like any other file in the
 * data directory.
 */
function encodePayload(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(payload, null, 2)}\n`);
}

function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function provenanceString(payload: unknown, field: 'updatedAt' | 'version'): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const provenance = (payload as { provenance?: unknown }).provenance;
  if (typeof provenance !== 'object' || provenance === null) return null;
  const value: unknown = (provenance as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Every version of this object, in the order they were recorded — oldest
 * first, which makes an entry's position its revision number.
 *
 * A line that does not parse is skipped rather than fatal: the file is
 * append-only precisely so that a corrupted tail costs the newest entry and
 * not the history ([03 §11.2]).
 */
export async function listVersions(objectRoot: string): Promise<VersionRecord[]> {
  const bytes = await readFileBytes(indexFile(objectRoot));
  if (bytes === null) return [];

  const records: VersionRecord[] = [];
  for (const line of new TextDecoder().decode(bytes).split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as VersionRecord;
      if (typeof parsed.id === 'string' && DIGEST_PATTERN.test(parsed.digest)) {
        records.push(parsed);
      }
    } catch {
      // The torn tail of an interrupted append. The entries above it are fine.
    }
  }
  return records;
}

/** The snapshotted object for a digest, or null if no such payload exists. */
export async function readVersionPayload(objectRoot: string, digest: string): Promise<unknown> {
  if (!DIGEST_PATTERN.test(digest)) return null;
  const bytes = await readFileBytes(payloadFile(objectRoot, digest));
  if (bytes === null) return null;
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

/**
 * Records the state a write is about to replace. Returns the new record, or
 * null when the newest entry already holds this exact state — the guard that
 * keeps a repeatedly-interrupted hand edit from writing the same snapshot line
 * after line.
 */
export async function recordVersion(
  objectRoot: string,
  payload: unknown,
  source: VersionSource,
  reason: string,
): Promise<VersionRecord | null> {
  return mutations.run(objectRoot, () =>
    recordVersionUnlocked(objectRoot, payload, source, reason),
  );
}

async function recordVersionUnlocked(
  objectRoot: string,
  payload: unknown,
  source: VersionSource,
  reason: string,
): Promise<VersionRecord | null> {
  const bytes = encodePayload(payload);
  const digest = digestOf(bytes);

  const existing = await listVersions(objectRoot);
  if (existing.at(-1)?.digest === digest) return null;

  const recordedAt = new Date().toISOString();
  const record: VersionRecord = {
    id: uuidv7(),
    digest,
    authoredAt: provenanceString(payload, 'updatedAt') ?? recordedAt,
    recordedAt,
    source,
    reason,
    authorVersion: provenanceString(payload, 'version'),
    pinned: false,
  };

  // Content-addressed: an edit-and-revert stores one payload with two entries
  // pointing at it, so the second arrival is a no-op.
  const payloadPath = payloadFile(objectRoot, digest);
  if (!(await fileExists(payloadPath))) {
    await writeAtomic(payloadPath, bytes);
  }

  // A plain append rather than an atomic rewrite: the file is append-only by
  // design, one small line per write, and rewriting the whole history to add a
  // line would turn its failure mode from "lost the newest entry" into "lost
  // the file". Through `appendLine` (2026-09-27), which closes off a torn last
  // line first; this appended straight onto one, so the version after a crash
  // mid-append vanished from the list along with the one it cut short.
  await appendLine(indexFile(objectRoot), `${JSON.stringify(record)}\n`);

  return record;
}

/**
 * Updates the caller-editable half of a record: `reason` (rename) and `pinned`
 * ([10 §11.2a](../../../../docs/design/10-ui-surfaces.md)). Returns the updated record, or
 * null if no entry has that id.
 */
export async function patchVersion(
  objectRoot: string,
  versionId: string,
  patch: { reason?: string; pinned?: boolean },
): Promise<VersionRecord | null> {
  return mutations.run(objectRoot, () => patchVersionUnlocked(objectRoot, versionId, patch));
}

async function patchVersionUnlocked(
  objectRoot: string,
  versionId: string,
  patch: { reason?: string; pinned?: boolean },
): Promise<VersionRecord | null> {
  const records = await listVersions(objectRoot);
  const target = records.find((record) => record.id === versionId);
  if (!target) return null;

  if (patch.reason !== undefined) target.reason = patch.reason;
  if (patch.pinned !== undefined) target.pinned = patch.pinned;

  await rewriteIndex(objectRoot, records);
  return target;
}

/**
 * Prunes to the retention cap: oldest unpinned first, pinned never
 * ([03 §11.3](../../../../docs/design/03-data-model.md)). Payload files no surviving entry
 * references are collected; ones still referenced stay, because pruning is
 * bookkeeping and not deletion of content.
 */
export async function pruneVersions(objectRoot: string, keepPerObject: number): Promise<number> {
  return mutations.run(objectRoot, () => pruneVersionsUnlocked(objectRoot, keepPerObject));
}

async function pruneVersionsUnlocked(objectRoot: string, keepPerObject: number): Promise<number> {
  /**
   * ***Zero keeps everything*** (2026-09-27), the house rule for a limit: a
   * trash window of `0` keeps forever and a provider timeout of `0` never times
   * out. Read as a count, `0` pruned every unpinned version on every save,
   * including the one the save had just recorded, and the pictures only those
   * versions named went with them at the next asset sweep. The schema's
   * minimum stays `0`, since a file that already says it must still start.
   */
  if (keepPerObject <= 0) return 0;
  const records = await listVersions(objectRoot);
  let excess = records.length - keepPerObject;
  if (excess <= 0) return 0;

  const surviving: VersionRecord[] = [];
  let pruned = 0;
  for (const record of records) {
    if (excess > 0 && !record.pinned) {
      pruned += 1;
      excess -= 1;
    } else {
      surviving.push(record);
    }
  }
  if (pruned === 0) return 0;

  await rewriteIndex(objectRoot, surviving);

  const referenced = new Set(surviving.map((record) => record.digest));
  const payloadDirectory = resolveWithin(objectRoot, 'history', 'v');
  for (const entry of await listEntryNames(payloadDirectory)) {
    const digest = entry.replace(/\.json$/, '');
    if (DIGEST_PATTERN.test(digest) && !referenced.has(digest)) {
      await removeTree(payloadFile(objectRoot, digest));
    }
  }

  return pruned;
}

async function rewriteIndex(objectRoot: string, records: VersionRecord[]): Promise<void> {
  const lines = records.map((record) => JSON.stringify(record)).join('\n');
  await writeAtomic(indexFile(objectRoot), lines.length === 0 ? '' : `${lines}\n`);
}

/**
 * The one call the write paths make: record the replaced state, then hold the
 * history to its cap. Skips (returns null) when the newest entry already holds
 * this state.
 *
 * One critical section spanning both halves — record-then-prune through the
 * separately-locked publics would let a concurrent `patchVersion` slip in
 * between them and be pruned away.
 */
export async function snapshotReplaced(input: {
  objectRoot: string;
  payload: unknown;
  source: VersionSource;
  reason: string;
  keepPerObject: number;
}): Promise<VersionRecord | null> {
  return mutations.run(input.objectRoot, async () => {
    const record = await recordVersionUnlocked(
      input.objectRoot,
      input.payload,
      input.source,
      input.reason,
    );
    if (record) await pruneVersionsUnlocked(input.objectRoot, input.keepPerObject);
    return record;
  });
}
