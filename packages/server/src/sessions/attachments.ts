// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { TurnAttachment } from '@storyengine/shared';

import { sniff } from '../auth/avatars.js';
import { digestOf } from '../library/assets.js';
import { writeAtomic } from '../storage/atomic.js';
import { listEntryNames, readFileBytes, statFile, unlinkFile } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { PathEscapeError, resolveWithin } from '../storage/paths.js';
import { sessionRoot } from './store.js';

/**
 * ***Pictures a player attached to a move*** — [25 E15](../../../../docs/design/25-open-questions.md),
 * R1: `sessions/<id>/attachments/`.
 *
 * **Not `assets/`, and that is the whole reason this is its own directory.**
 * [03 §5.5](../../../../docs/design/03-data-model.md) makes `assets/` the one
 * disposable directory in a session, on the strength of every file in it having
 * a recipe that can make it again — a rendition. A picture somebody uploaded has
 * no recipe. Put there, the first eviction policy anyone writes would delete
 * the only copy of something a person made.
 *
 * ***Content-addressed***, `<sha256 hex>.<ext>`: the same picture attached twice
 * is one file, and a redo or a sibling that carries a picture across is a
 * reference rather than a copy. The extension is derived from the bytes'
 * signature and never from a filename, which is `avatars.ts`'s rule and its
 * reason: what a client calls a file is not evidence of what it is.
 *
 * **Written atomically**, unlike `assets/`: a torn picture here cannot be made
 * again, so it is the library's posture rather than the renditions'.
 *
 * A module function rather than a `Layout` method, which is how a session
 * subdirectory has always been added ([03 §5.5]).
 */

export function attachmentsRoot(layout: Layout, handle: string, sessionId: string): string {
  return resolveWithin(sessionRoot(layout, handle, sessionId), 'attachments');
}

/** `sha256:` and 64 hex digits — the one spelling a digest arrives in. */
const DIGEST = /^sha256:([0-9a-f]{64})$/;

export function isDigest(value: string): boolean {
  return DIGEST.test(value);
}

/** The extensions a stored picture can have, and so every name to look under. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

function candidatesFor(
  layout: Layout,
  handle: string,
  sessionId: string,
  digest: string,
): { path: string; mime: string }[] {
  const hex = DIGEST.exec(digest)?.[1];
  if (hex === undefined) return [];
  try {
    const root = attachmentsRoot(layout, handle, sessionId);
    return Object.entries(EXTENSIONS).map(([extension, mime]) => ({
      path: resolveWithin(root, `${hex}.${extension}`),
      mime,
    }));
  } catch (error) {
    if (error instanceof PathEscapeError) return [];
    throw error;
  }
}

export interface StoredAttachment {
  digest: string;
  mime: string;
  bytes: number;
}

/**
 * Stores a picture, or refuses what is not one.
 *
 * Null when the bytes are not a PNG, JPEG or WebP by their own signature — the
 * same three the avatar and the library accept, and the three every
 * image-reading endpoint this build talks to takes.
 */
export async function storeAttachment(
  layout: Layout,
  handle: string,
  sessionId: string,
  bytes: Uint8Array,
): Promise<StoredAttachment | null> {
  const kind = sniff(bytes);
  if (kind === null) return null;
  const digest = digestOf(bytes);
  const hex = DIGEST.exec(digest)?.[1] ?? '';
  const path = resolveWithin(
    attachmentsRoot(layout, handle, sessionId),
    `${hex}.${kind.extension}`,
  );
  // Content-addressed, so a file already here under this name *is* these bytes.
  if ((await statFile(path)) === null) await writeAtomic(path, bytes);
  return { digest, mime: kind.mime, bytes: bytes.byteLength };
}

/** What the store holds under a digest — its type and size — or null. */
export async function describeAttachment(
  layout: Layout,
  handle: string,
  sessionId: string,
  digest: string,
): Promise<StoredAttachment | null> {
  for (const candidate of candidatesFor(layout, handle, sessionId, digest)) {
    const facts = await statFile(candidate.path);
    if (facts !== null) return { digest, mime: candidate.mime, bytes: facts.size };
  }
  return null;
}

export async function readAttachment(
  layout: Layout,
  handle: string,
  sessionId: string,
  digest: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  for (const candidate of candidatesFor(layout, handle, sessionId, digest)) {
    const bytes = await readFileBytes(candidate.path);
    if (bytes !== null) return { bytes, mime: candidate.mime };
  }
  return null;
}

/**
 * Which of these digests the store holds — the send rule's *are the bytes
 * here* ([25 E15]), answered before assembly because assembly is synchronous.
 * After an import from an export the answer is usually *none*, and the pictures
 * go as their words.
 */
export async function presentAttachments(
  layout: Layout,
  handle: string,
  sessionId: string,
  digests: Iterable<string>,
): Promise<Set<string>> {
  const present = new Set<string>();
  for (const digest of new Set(digests)) {
    if ((await describeAttachment(layout, handle, sessionId, digest)) !== null) {
      present.add(digest);
    }
  }
  return present;
}

/** Every digest the pictures on these turns name. */
export function digestsOf(
  turns: Iterable<{ input?: { attachments?: readonly TurnAttachment[] } | undefined }>,
): Set<string> {
  const digests = new Set<string>();
  for (const turn of turns) {
    for (const attachment of turn.input?.attachments ?? []) {
      if (attachment.digest !== undefined) digests.add(attachment.digest);
    }
  }
  return digests;
}

/**
 * ***How long an upload may wait for the turn that names it.*** A picture is
 * uploaded when it is attached and referenced when the turn is sent, and a
 * person can attach one, go and make tea, and send it later — or send it and
 * have the turn still in flight. A day is longer than any of that and short
 * enough that a picture attached and abandoned does not stay for good.
 */
export const UNSENT_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Removes pictures nothing names and nobody has touched for a day.
 *
 * ***On age, never on commit***, and the difference is the bug this avoids: a
 * session commits constantly while the composer holds uploads no turn names yet
 * — a redo from a turn's own controls commits and leaves the composer alone — so
 * a sweep that ran on commit would delete the picture somebody is about to send.
 *
 * ***Every turn in the session is a reference***, siblings and tombstones
 * included. Walking the head path is the obvious reachability function and it
 * is wrong here: it would delete a swipe's pictures, which is the case
 * `export.test.ts` exists to catch for turns.
 */
export async function sweepAttachments(
  layout: Layout,
  handle: string,
  sessionId: string,
  referenced: ReadonlySet<string>,
  now: number = Date.now(),
): Promise<number> {
  const root = attachmentsRoot(layout, handle, sessionId);
  let removed = 0;
  for (const name of await listEntryNames(root)) {
    const match = /^([0-9a-f]{64})\.[a-z]+$/.exec(name);
    if (match === null) continue;
    if (referenced.has(`sha256:${match[1] ?? ''}`)) continue;
    const path = resolveWithin(root, name);
    const facts = await statFile(path);
    if (facts === null || now - facts.mtimeMs < UNSENT_GRACE_MS) continue;
    await unlinkFile(path);
    removed += 1;
  }
  return removed;
}

/**
 * The move's pictures as the record keeps them, from what a client named.
 *
 * ***The client names digests and captions and nothing else***; type and size
 * are read from this server's own store, on `rewriteOf`'s reasoning — *ids, not
 * claims*. Ids are ordinals, and a redo that re-sends the same list in the same
 * order keeps them, which is what lets the workbench pair two siblings' pictures.
 *
 * ***A digest the store does not hold is refused — unless this session's own
 * turns already name it.*** The first half means a turn never names a picture
 * nobody uploaded. The second is the redo of an imported turn: an export carries
 * the records and not the pixels, so the picture is on the turn being redone and
 * its bytes are nowhere, and refusing the redo would make a session that once
 * had a picture harder to continue than one that never did — the lock-in the
 * whole design refuses. Such a picture is recorded as it was, without the facts
 * only bytes could give, and goes to every model as its words.
 */
export async function attachmentsFor(
  layout: Layout,
  handle: string,
  sessionId: string,
  named: readonly { digest: string; caption?: string }[],
  /** The digests this session's turns already name — read only when needed. */
  recorded: () => Promise<ReadonlySet<string>>,
): Promise<{ ok: true; attachments: TurnAttachment[] } | { ok: false; digest: string }> {
  const attachments: TurnAttachment[] = [];
  let known: ReadonlySet<string> | undefined;
  for (const [index, one] of named.entries()) {
    const caption = one.caption?.trim() ?? '';
    const stored = await describeAttachment(layout, handle, sessionId, one.digest);
    if (stored === null) {
      known ??= await recorded();
      if (!known.has(one.digest)) return { ok: false, digest: one.digest };
    }
    attachments.push({
      id: String(index),
      kind: 'image',
      digest: one.digest,
      ...(stored === null ? {} : { mime: stored.mime, bytes: stored.bytes }),
      ...(caption === '' ? {} : { caption }),
    });
  }
  return { ok: true, attachments };
}
