// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from './import.js';
import type { LeftBehind, PublishOrigin } from './publish.js';
import type { World } from './schema/world.js';

/**
 * ***The World file*** — [16 §5.2](../../../docs/design/16-publish.md),
 * [04 §9](../../../docs/design/04-schemas.md),
 * [03 §5.2.3](../../../docs/design/03-data-model.md),
 * [P16.3c](../../../docs/design/workplan/35-p16-world.md).
 *
 * **What it is, decided by the owner on 2026-10-10**: *a stored zip of the
 * members' stored folders* (16 §5.2). An actor travels as its card, portrait
 * and expressions inside it; a lorebook as its `lorebook.json` with its
 * `assets/`; a session as its session export, with its pictures beside it
 * (the owner's answer of the same day). A manifest goes first, so that *do I
 * want these in my library* can be answered from the head of the file before
 * anything is written (16 §5.1). The layout mirrors the data directory, so a
 * person who knows `data/` can read one:
 *
 * ```
 * storyengine-world.json                         the manifest, always first, ≤ 4 MiB
 * library/worlds/<folder>/world.json             the World as published (absent when `world` is null)
 * library/<kind-dir>/<folder>/<stored file>      card.png, lorebook.json, treatment.json, …
 * library/<kind-dir>/<folder>/assets/<sha256>.<ext>   only what the object's media rows name
 * library/<kind-dir>/<folder>/history/index.jsonl     only when history is opted into
 * library/<kind-dir>/<folder>/history/v/<sha256>.json
 * sessions/<session-id>/session-export.json      storyengine.session-export/1, bindings stripped
 * sessions/<session-id>/assets/<asset path>      rendition pixels present on disk
 * sessions/<session-id>/attachments/<name>       the pictures moves carried
 * ```
 *
 * ***Shared, for the reason `publish.ts` is***: the server writes it (P16.3c)
 * and reads it (P16.3e), and the client looks at the head of a file a person
 * picked before it uploads anything (P16.3f) — and a manifest reader that
 * differed between the two sides by one field would show a preview of a file
 * the server then reads otherwise. Pure: no I/O, and the zip parsing here is
 * the first local header only, over bytes the caller already holds.
 *
 * ***A plain interface with a hand-written reader, never an emitted JSON
 * Schema*** — the precedent of `storyengine.backup-manifest/1` and
 * `storyengine.session-export/1`: an envelope is not an object somebody edits,
 * so it carries a `schema` string and a reader rather than an artefact in
 * `schemas/`, and `repo-shape.test.ts` pins the six emitted schemas, which are
 * the six library kinds.
 *
 * ***A new schema name, not `package-export/2`*** ([P16.3]'s plan, §3): the
 * frozen JSON envelope P11.10 wrote is still read beside this (P16.3e), and one
 * id with two shapes is the worst of the options — a `/2` would claim a
 * read-compatibility with `/1` this does not have.
 */

/** The format's id. Bumped when a reader would need to behave differently. */
export const WORLD_FILE_SCHEMA = 'storyengine.world-file/1';

/**
 * ***The manifest's member name***, at the root — specific rather than
 * `manifest.json`, because the import probe sniffs for it (P16.3e): a generic
 * name would match unrelated zips of cards that happen to carry one, and
 * refuse them as damaged World files instead of sweeping them as loose files.
 */
export const WORLD_FILE_MANIFEST = 'storyengine-world.json';

/** The file's extension. Served as `application/zip`: a vendor type is registered nowhere. */
export const WORLD_FILE_EXTENSION = '.seworld';

/** A session's export inside its `sessions/<id>/` folder. */
export const WORLD_FILE_SESSION_EXPORT = 'session-export.json';

/**
 * ***The manifest's ceiling***, which is what lets a reader take it from the
 * head of a file: the client slices this much at most from what a person
 * picked and sends only that to the preview (P16.3f). A manifest names every
 * object, session and dangling reference by id and name — four MiB is tens of
 * thousands of rows, far past the 4,096 members the zip readers allow.
 */
export const WORLD_FILE_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;

/**
 * ***One library object in the file.***
 *
 * `folder` and `file` are **member names in this zip** — `library/actors/vera`
 * and `library/actors/vera/card.png` — rather than parts to be joined, so a
 * reader looks a file up by the string the manifest gives and never rebuilds a
 * path. `<folder>` is the object's own folder name on the sender's side,
 * suffixed `-2`, `-3` where two carried objects of one kind shared one, and it
 * means nothing on arrival: `create` picks its own folder.
 */
export interface WorldFileObject {
  schema: string;
  id: string;
  name: string;
  folder: string;
  file: string;
  /**
   * `sha256:<hex>` **of the bytes in this zip** — the integrity check the reader
   * makes per file ([P16.3]'s plan, R9), instead of enforcing the zip's CRC on
   * every third-party archive. The same spelling, and for a copied file the
   * same value, as the index's `contentHash`.
   */
  contentHash: string;
  /**
   * Whether the published World names it in `contents`. `false` for what the
   * walk reached beyond the members — a book a treatment links, an actor a hook
   * involves — and for **a book scoped to the World** that is not a member:
   * it travels because it names the World, so the World need not name it
   * (04 §9.1's query row). Always `false` on the World itself.
   */
  member: boolean;
}

/** One session in the file — the review's numbers for it, and where it is. */
export interface WorldFileSession {
  /** The session's id on the sender's side, which is also its folder's name. */
  id: string;
  name: string;
  /** `sessions/<id>` — a member-name prefix, as {@link WorldFileObject.folder} is. */
  folder: string;
  turns: number;
  headTurnId: string | null;
  /** Rendition pixels carried under `assets/`. */
  pictures: number;
  /** Move attachments carried under `attachments/`. */
  attachments: number;
  /** The mode it plays, a recipient needs to play it on. */
  mode: string | null;
}

export interface WorldFileManifest {
  schema: typeof WORLD_FILE_SCHEMA;
  /** What wrote it, and when — a header for the review, **never a gate** (`schema` is the gate). */
  exportedBy: { version: string | null; at: string };
  origin: PublishOrigin;
  /** The World as published; `null` for one object, or a selection sent as a snapshot. */
  world: (WorldFileObject & { description: string }) | null;
  /** Members first, then what the walk reached, in the order the review drew them. */
  objects: WorldFileObject[];
  sessions: WorldFileSession[];
  /** References from carried things to things the file does not carry ([P16.3]'s plan, R13). */
  leftBehind: LeftBehind[];
  /**
   * ***The stored `requires` ∪ the derived***, authored winning by id
   * (`mergeRequires`) — the reader's warning only ([P16.3]'s plan, R12). The
   * World inside the file keeps `requires` as its author wrote it, so
   * importing your own file back is `unchanged`.
   */
  requires: World['requires'];
  /** Whether version history was opted into ([03 §11.6]). */
  history: boolean;
  /**
   * What the file does not carry and says so: a picture over the entry
   * limit, a session picture missing on disk, a session too large to travel.
   * `{ key, params }`, never prose, as every note is.
   */
  omitted: ImportNote[];
}

/**
 * ***The manifest a document claims to be, or why it is not one*** —
 * `readBackupManifest`'s shape, `{ refusal }` and all, for its reasons.
 *
 * **A wrong schema is refused, and so is `/2`**: a reader that took the next
 * version on trust would read a format nobody has written yet as this one. The
 * checks after that are the fields a reader *acts on* before it trusts
 * anything — the lists it iterates, the hashes it verifies against, the paths
 * it looks members up by; a manifest missing one is not one this build can
 * act on, whatever else it holds.
 *
 * ***Unknown fields are kept*** ([04 §2]): the document is returned as it
 * came, not rebuilt from the fields read here, so a `/1` writer that adds a
 * field a later build reads does not lose it to this one on the way through.
 */
export function readWorldFileManifest(
  document: unknown,
): WorldFileManifest | { refusal: 'unreadable' | 'wrong-schema' } {
  if (!isRecord(document)) return { refusal: 'unreadable' };
  if (document['schema'] !== WORLD_FILE_SCHEMA) return { refusal: 'wrong-schema' };

  const exportedBy = document['exportedBy'];
  if (!isRecord(exportedBy) || typeof exportedBy['at'] !== 'string') {
    return { refusal: 'unreadable' };
  }
  const version = exportedBy['version'];
  if (version !== null && typeof version !== 'string') return { refusal: 'unreadable' };
  if (!ORIGINS.has(document['origin'])) return { refusal: 'unreadable' };

  const world = document['world'];
  if (world !== null && !(isObjectRow(world) && typeof world['description'] === 'string')) {
    return { refusal: 'unreadable' };
  }
  const objects = document['objects'];
  if (!Array.isArray(objects) || !objects.every(isObjectRow)) return { refusal: 'unreadable' };
  const sessions = document['sessions'];
  if (!Array.isArray(sessions) || !sessions.every(isSessionRow)) return { refusal: 'unreadable' };

  if (!Array.isArray(document['leftBehind'])) return { refusal: 'unreadable' };
  if (!Array.isArray(document['omitted'])) return { refusal: 'unreadable' };
  if (typeof document['history'] !== 'boolean') return { refusal: 'unreadable' };
  const requires = document['requires'];
  if (
    !isRecord(requires) ||
    !Array.isArray(requires['modes']) ||
    !Array.isArray(requires['extensions']) ||
    !Array.isArray(requires['capabilities'])
  ) {
    return { refusal: 'unreadable' };
  }
  return document as unknown as WorldFileManifest;
}

/**
 * ***The first member of a zip, from its local header alone*** — what a reader
 * holding only the head of a file can know about it.
 *
 * **Why the head is enough, and when it is not.** The World file's writer puts
 * the manifest first, stored, with its sizes in the local header (no data
 * descriptor), so the client can read the first few kilobytes of a picked file,
 * see the manifest's name, method and size here, and slice exactly its bytes
 * from `dataStart` — without the central directory at the far end of a file
 * that may be gigabytes (P16.3f). This returns what the header *says*; the
 * caller decides whether it can be trusted:
 *
 * - `method !== 0` — deflated — has no slice to take; the bytes are a stream.
 * - `flags & 0x0008` — a data descriptor — means the sizes here are zero or
 *   wrong, and the real ones are after the data. `size` is reported as the
 *   header wrote it, which for such an entry is not the entry's size.
 * - `size` past what the caller holds means the head was cut too short.
 *
 * **Null when the bytes are not a local header**, or are cut off inside the
 * header or its name. The name is decoded as UTF-8, as `storage/zip.ts`
 * decodes every name, whether or not bit 11 says so.
 */
export function firstLocalEntry(
  head: Uint8Array,
): { name: string; method: number; flags: number; dataStart: number; size: number } | null {
  if (head.length < LOCAL_HEADER_BYTES) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (view.getUint32(0, true) !== LOCAL_SIGNATURE) return null;
  const flags = view.getUint16(6, true);
  const method = view.getUint16(8, true);
  const size = view.getUint32(18, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  if (head.length < LOCAL_HEADER_BYTES + nameLength) return null;
  const name = new TextDecoder().decode(
    head.subarray(LOCAL_HEADER_BYTES, LOCAL_HEADER_BYTES + nameLength),
  );
  return { name, method, flags, dataStart: LOCAL_HEADER_BYTES + nameLength + extraLength, size };
}

/**
 * ***A download name for a World file*** — `<slug>.seworld`, replacing
 * `packFileName`'s `.sepack.json` when the route moves to it (P16.3d).
 *
 * The same rules as that function, for its reason: **ASCII only**, because
 * `content-disposition` is latin-1 by specification, and a World called
 * *Ciudad de la lluvia* or *灯台* still has to arrive as a file the browser can
 * name. Accents fold away (NFKD, then the non-ASCII dropped), anything else
 * becomes a hyphen, and a name with nothing left is `world`.
 */
export function worldFileName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^\p{ASCII}]/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${slug === '' ? 'world' : slug}${WORLD_FILE_EXTENSION}`;
}

const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_BYTES = 30;
const ORIGINS: ReadonlySet<unknown> = new Set<PublishOrigin>(['object', 'selection', 'world']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The fields a reader looks a member up by and verifies it against. */
function isObjectRow(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value['schema'] === 'string' &&
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['folder'] === 'string' &&
    typeof value['file'] === 'string' &&
    typeof value['contentHash'] === 'string' &&
    typeof value['member'] === 'boolean'
  );
}

function isSessionRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['folder'] === 'string'
  );
}
