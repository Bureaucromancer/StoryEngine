// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { TurnAttachment } from '@storyengine/shared';

import { sniff } from '../auth/avatars.js';
import { digestOf } from '../library/assets.js';
import { writeAtomic } from '../storage/atomic.js';
import {
  listEntryNames,
  readFileBytes,
  statFile,
  touchFile,
  unlinkFile,
} from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { PathEscapeError, resolveWithinReal } from '../storage/paths.js';
import { pictureSize } from './picture-size.js';
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
 * ***Checked where it lands, not only as it is spelled*** (2026-09-27, the
 * library's same-day fix brought here). Every path below stays inside the
 * session's folder by spelling, and the folder can still send it elsewhere: an
 * `attachments` that is a link to another account, or to the data root. So
 * every path is resolved against the real session folder — rooted at the
 * session and not at `attachments/`, because a check rooted at a link resolves
 * the root through the link too, and then everything is inside it — and an
 * escape is a picture this store does not have.
 *
 * A module function rather than a `Layout` method, which is how a session
 * subdirectory has always been added ([03 §5.5]).
 */

/** The session folder, checked to be where it says it is. */
async function realSession(layout: Layout, handle: string, sessionId: string): Promise<string> {
  const root = sessionRoot(layout, handle, sessionId);
  await layout.assertReal(root);
  return root;
}

/** One name inside `attachments/`, resolved against the real session folder. */
async function attachmentPath(
  layout: Layout,
  handle: string,
  sessionId: string,
  name: string,
): Promise<string> {
  return resolveWithinReal(await realSession(layout, handle, sessionId), 'attachments', name);
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

/**
 * ***The only names the sweep deletes*** — the shape {@link storeAttachment}
 * writes, and nothing else. A file somebody put in the folder by hand is not
 * this store's to collect, whatever it is called.
 */
const STORED_NAME = new RegExp(`^([0-9a-f]{64})\\.(?:${Object.keys(EXTENSIONS).join('|')})$`);

/**
 * Where a digest's bytes would be, one path per possible extension. Empty for a
 * string that is not a digest, and for a folder that leads out of the session.
 */
async function candidatesFor(
  layout: Layout,
  handle: string,
  sessionId: string,
  digest: string,
): Promise<{ path: string; mime: string }[]> {
  const hex = DIGEST.exec(digest)?.[1];
  if (hex === undefined) return [];
  try {
    const found: { path: string; mime: string }[] = [];
    for (const [extension, mime] of Object.entries(EXTENSIONS)) {
      found.push({
        path: await attachmentPath(layout, handle, sessionId, `${hex}.${extension}`),
        mime,
      });
    }
    return found;
  } catch (error) {
    if (error instanceof PathEscapeError) return [];
    throw error;
  }
}

export interface StoredAttachment {
  digest: string;
  mime: string;
  bytes: number;
  /** From the file's header; absent when it could not be read. */
  width?: number;
  height?: number;
}

function described(digest: string, mime: string, bytes: Uint8Array): StoredAttachment {
  const size = pictureSize(bytes);
  return { digest, mime, bytes: bytes.byteLength, ...(size ?? {}) };
}

/**
 * Stores a picture, or refuses what is not one.
 *
 * Null when the bytes are not a PNG, JPEG or WebP by their own signature — the
 * same three the avatar and the library accept, and the three every
 * image-reading endpoint this build talks to takes.
 *
 * ***A picture already here is renewed rather than rewritten.*** Content
 * addressing means the file under this name *is* these bytes, so there is
 * nothing to write — but there is something to say: that somebody wants it
 * today. Until 2026-09-27 a second upload of a picture first uploaded more than
 * a day before changed nothing on disk, and the sweep in the same request then
 * deleted it as a day-old file nothing named, so the upload answered `201` and
 * the move that named it was refused.
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
  const path = await attachmentPath(layout, handle, sessionId, `${hex}.${kind.extension}`);
  if (!(await touchFile(path))) await writeAtomic(path, bytes);
  return described(digest, kind.mime, bytes);
}

/**
 * What the store holds under a digest — its type, size and dimensions — or null.
 *
 * `measure: false` answers from the file's stat alone, without dimensions: the
 * preview asks on every pause in typing and never records what it reads, so
 * reading up to four whole pictures to learn a size it throws away is the cost
 * of the record paid by the meter.
 */
export async function describeAttachment(
  layout: Layout,
  handle: string,
  sessionId: string,
  digest: string,
  measure = true,
): Promise<StoredAttachment | null> {
  if (measure) {
    const held = await readAttachment(layout, handle, sessionId, digest);
    return held === null ? null : described(digest, held.mime, held.bytes);
  }
  for (const candidate of await candidatesFor(layout, handle, sessionId, digest)) {
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
  for (const candidate of await candidatesFor(layout, handle, sessionId, digest)) {
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
    for (const candidate of await candidatesFor(layout, handle, sessionId, digest)) {
      if ((await statFile(candidate.path)) === null) continue;
      present.add(digest);
      break;
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
 *
 * *Measured from the last time anybody wanted it*, not from the first write:
 * an upload renews it ({@link storeAttachment}) and so does a move that names it
 * ({@link attachmentsFor}), which is what keeps a picture safe while the turn
 * that names it is still running and nothing on disk names it yet.
 */
export const UNSENT_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Removes pictures nothing names and nobody has wanted for a day.
 *
 * ***On age, never on commit***, and the difference is the bug this avoids: a
 * session commits constantly while the composer holds uploads no turn names yet
 * — a redo from a turn's own controls commits and leaves the composer alone — so
 * a sweep that ran on commit would delete the picture somebody is about to send.
 *
 * ***Every turn a reader sees is a reference***, siblings included. Walking the
 * head path is the obvious reachability function and it is wrong here: it would
 * delete a swipe's pictures, which is the case `export.test.ts` exists to catch
 * for turns. *A tombstoned turn is not one* — the reader skips it, and nothing
 * writes tombstones at 1.0; whether a pruned branch keeps its pictures is a
 * question for whoever designs pruning ([03 §5.5]).
 *
 * ***The turns are read only when something is old enough to go***, which is
 * the library sweep's rule and its reason: the common upload has nothing past
 * its grace, and reading every segment of a long session to learn that is the
 * cost of the uncommon one paid every time.
 *
 * *A folder that leads out of the session deletes nothing.*
 */
export async function sweepAttachments(
  layout: Layout,
  handle: string,
  sessionId: string,
  referenced: () => Promise<ReadonlySet<string>>,
  now: number = Date.now(),
): Promise<number> {
  let root: string;
  try {
    root = await resolveWithinReal(await realSession(layout, handle, sessionId), 'attachments');
  } catch (error) {
    if (error instanceof PathEscapeError) return 0;
    throw error;
  }

  const old: { path: string; digest: string }[] = [];
  for (const name of await listEntryNames(root)) {
    const hex = STORED_NAME.exec(name)?.[1];
    if (hex === undefined) continue;
    let path: string;
    try {
      path = await attachmentPath(layout, handle, sessionId, name);
    } catch (error) {
      // One file that leads elsewhere is not this store's, and not a reason to
      // stop collecting the rest.
      if (error instanceof PathEscapeError) continue;
      throw error;
    }
    const facts = await statFile(path);
    if (facts === null || now - facts.mtimeMs < UNSENT_GRACE_MS) continue;
    old.push({ path, digest: `sha256:${hex}` });
  }
  if (old.length === 0) return 0;

  const named = await referenced();
  let removed = 0;
  for (const { path, digest } of old) {
    if (named.has(digest)) continue;
    /**
     * ***Asked again, a moment before it goes.*** Reading the turns is the slow
     * part, and it is not under the session's lock: a re-upload of this
     * picture, or a move naming it, can renew it while the read runs — and was
     * told it succeeded. Deleting from the list made before the read would take
     * the picture that move is about to send. The window left is a stat and an
     * unlink wide.
     */
    const facts = await statFile(path);
    if (facts === null || now - facts.mtimeMs < UNSENT_GRACE_MS) continue;
    try {
      await unlinkFile(path);
      removed += 1;
    } catch {
      // Something with a stored name that will not unlink — a directory put
      // there by hand — is not this store's, and not a reason to stop.
    }
  }
  return removed;
}

/**
 * The move's pictures as the record keeps them, from what a composer named.
 *
 * ***The client names digests and captions and nothing else***; type, size and
 * dimensions are read from this server's own store, on `rewriteOf`'s reasoning
 * — *ids, not claims*. Ids are ordinals of the list as sent.
 *
 * ***A digest the store does not hold*** is refused by a submission, and left
 * out by a preview — which runs every time somebody pauses typing, and for which
 * a picture swept a moment ago is not a request worth a 422. Left out *in
 * place*: the pictures that remain keep the ids they will have when the move is
 * sent, so a preview labels them as the turn will.
 *
 * *A redo does not come through here.* Its pictures are the record's, copied by
 * {@link attachmentsAgain}; this is for pictures somebody has just uploaded.
 *
 * ***Submitting a picture renews it***, so the sweep's day is counted from the
 * move that wants it: the turn may still be running when another upload sweeps,
 * and until it commits nothing on disk names it.
 */
export async function attachmentsFor(
  layout: Layout,
  handle: string,
  sessionId: string,
  named: readonly { digest: string; caption?: string }[],
  /**
   * `submit` refuses a digest the store does not hold and renews the ones it
   * does; `preview` leaves an unknown one out and writes nothing, as a preview
   * promises.
   */
  purpose: 'submit' | 'preview',
): Promise<{ ok: true; attachments: TurnAttachment[] } | { ok: false; digest: string }> {
  const attachments: TurnAttachment[] = [];
  for (const [index, one] of named.entries()) {
    const caption = one.caption?.trim() ?? '';
    const stored = await describeAttachment(
      layout,
      handle,
      sessionId,
      one.digest,
      purpose === 'submit',
    );
    if (stored === null) {
      if (purpose === 'submit') return { ok: false, digest: one.digest };
      continue;
    }
    if (purpose === 'submit') await renew(layout, handle, sessionId, one.digest);
    attachments.push({
      id: String(index),
      kind: 'image',
      ...factsOf(stored),
      ...(caption === '' ? {} : { caption }),
    });
  }
  return { ok: true, attachments };
}

function factsOf(stored: StoredAttachment): Omit<TurnAttachment, 'id' | 'kind' | 'caption'> {
  return {
    digest: stored.digest,
    mime: stored.mime,
    bytes: stored.bytes,
    ...(stored.width === undefined || stored.height === undefined
      ? {}
      : { width: stored.width, height: stored.height }),
  };
}

async function renew(layout: Layout, handle: string, sessionId: string, digest: string) {
  for (const candidate of await candidatesFor(layout, handle, sessionId, digest)) {
    if (await touchFile(candidate.path)) return;
  }
}

/**
 * ***A redo's pictures: the record's, as it stands*** — [25 E15], *"redo
 * carrying attachments, because they are input"*.
 *
 * **Copied, not re-sent.** Until 2026-09-27 a redo's client rebuilt the list
 * from digest and caption and the server re-minted it, which is lossless for
 * every record this build writes and lossy for every other: a picture recorded
 * without a digest (an importer that had no bytes) was dropped with its
 * caption, a kind this build does not know became `image` — so a newer build's
 * kind whose bytes happened to be here would have gone as pixels — and the ids
 * moved. A record that did not fit the composer's limits made the whole redo a
 * `400`. So a redo names the turn and the server copies what it recorded: every
 * id, kind and caption as they are, and digest-less pictures too.
 *
 * *The facts only bytes can give are re-read* for every digest the store holds
 * now — a picture restored since from a backup is sent like any other — and
 * kept as recorded otherwise.
 */
export async function attachmentsAgain(
  layout: Layout,
  handle: string,
  sessionId: string,
  recorded: readonly TurnAttachment[],
): Promise<TurnAttachment[]> {
  const again: TurnAttachment[] = [];
  for (const one of recorded) {
    const stored =
      one.digest === undefined
        ? null
        : await describeAttachment(layout, handle, sessionId, one.digest);
    if (stored !== null && one.digest !== undefined) {
      await renew(layout, handle, sessionId, one.digest);
    }
    again.push(stored === null ? { ...one } : { ...one, ...factsOf(stored) });
  }
  return again;
}
