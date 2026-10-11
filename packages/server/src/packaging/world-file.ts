// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';

import {
  ACTOR_SCHEMA,
  type ImportNote,
  isKnownSchema,
  isWrittenByPlay,
  LEGACY_PACKAGE_SCHEMA,
  type LeftBehind,
  LIBRARY_DIRECTORIES,
  mediaRowsIn,
  mergeRequires,
  type NodeFacts,
  type PortableSchemaId,
  type PublishOrigin,
  SESSION_SCHEMA,
  type SessionExport,
  type SessionFacts,
  slugify,
  upgradeLegacySchema,
  uuidv7,
  WORLD_FILE_MANIFEST,
  WORLD_FILE_MANIFEST_MAX_BYTES,
  WORLD_FILE_SCHEMA,
  WORLD_FILE_SESSION_EXPORT,
  WORLD_SCHEMA,
  type World,
  type WorldFileManifest,
  type WorldFileObject,
  type WorldFileSession,
} from '@storyengine/shared';

import type { BuildInfo } from '../build-info.js';
import type { IndexedObject } from '../index-db/query.js';
import { encodeObject, LibraryError, read, type LibraryContext } from '../library.js';
import { assetFile, digestOf } from '../library/assets.js';
import { edgesOf, sessionEdges } from '../library/references.js';
import { attachmentOnDisk, digestsOf } from '../sessions/attachments.js';
import { exportSession } from '../sessions/export.js';
import type { SessionContext } from '../sessions/store.js';
import { CardFormatError } from '../storage/card/envelope.js';
import { pngCardCodec } from '../storage/card/png.js';
import { readFileBytes, statFile, writeNewTextFile } from '../storage/files.js';
import { listVersions, type VersionRecord } from '../storage/history.js';
import type { ScratchSpace } from '../storage/import-scratch.js';
import { OBJECT_FILENAMES, SYSTEM_OWNER, userOwner } from '../storage/layout.js';
import { PathEscapeError, resolveWithinReal } from '../storage/paths.js';
import {
  DEFAULT_ZIP_WRITE_LIMITS,
  storedZipBytes,
  storedZipRefusal,
  writeStoredZip,
  type ZipMember,
  type ZipWriteLimits,
  zipNameRefusal,
} from '../storage/zip-writer.js';

/**
 * ***The World file: planned, then written*** —
 * [16 §5.2](../../../../docs/design/16-publish.md),
 * [04 §9.1](../../../../docs/design/04-schemas.md),
 * [03 §5.2.3](../../../../docs/design/03-data-model.md),
 * [P16.3c](../../../../docs/design/workplan/35-p16-world.md).
 *
 * **What goes in is the owner's decision of 2026-10-10**: *a stored zip of the
 * members' stored folders* (16 §5.2), sessions inside as their session exports
 * with their pictures beside them (the owner's answer at P16.3's plan). The
 * layout is `@storyengine/shared`'s `world-file.ts`, and it mirrors `data/`:
 * every object is its own stored file **copied byte for byte** — `card.png`
 * included, so an actor arrives with the face and expressions its card holds
 * (*but for a card holding a picture no row names*, 2026-10-10 — below) —
 * under `library/<kind-dir>/<folder>/`, with the pictures its media rows name
 * under `assets/`, and its history only when the person opted into it.
 *
 * ***Two steps, and the second can fail on purpose.*** {@link planWorldFile}
 * decides every member, reads and hashes every file once (a card twice — once
 * to see what it holds), stages each session export in scratch, holds each
 * stored file to the index's hash, and refuses what will not fit — all before a
 * byte of the World file exists, so a refusal costs the person a sentence and
 * nothing on disk ([P16.3]'s plan, R11). {@link writeWorldFile} then streams
 * the members through the zip writer, **re-hashing every file as it reads it**
 * against what the plan saw: an object the person saved in between, a picture
 * swept, a card replaced — any of them throws {@link WorldFileChangedError} and
 * leaves no file (the writer removes its `.part`). The route answers that `409
 * publish.changed`, and the person publishes again, which is honest and cheap
 * ([16 §3]); a file that was half the old object and half the new would be
 * neither.
 *
 * ***The file names nothing its carried things do not already name*** — the
 * rule the leak test holds it to, and the reason for every strip below:
 *
 * - **The World is re-encoded, not copied.** Its `contents` become the carried
 *   members and the carried sessions, in the World's own order, so an
 *   unchecked member or an unticked session appears nowhere — not by id, not by
 *   name. Its `requires` stays as its author stored it (R12); the derived union
 *   goes in the manifest for the reader's warning.
 * - **The World's own history never travels**, whatever the history choice:
 *   its versions are earlier `contents`, and they name members and sessions the
 *   publish left out. The file's `world.json` is a re-encoding, not the stored
 *   object, so there is no stored object whose history it would be.
 * - **A session travels without its bindings and its associations**: `roles`
 *   and `stepRoles` (a binding the recipient cannot honour is a pointer to
 *   nothing — [16 §2]'s *a connection is never on it*), and
 *   `memory.associations`, whose **keys are sibling sessions' ids**, unticked
 *   ones included (the fact check of 2026-10-10). A turn's recorded calls keep
 *   the connection id that answered: an id is not a connection — no URL, no
 *   key — and the record of which model wrote a turn is the transcript's.
 * - **A carried object's history is re-encoded, not copied** (2026-10-10, the
 *   P16.3c review). Play writes into it: the session panel's promote control
 *   records *Plot hook saved from "<session name>"* on the treatment it saves
 *   onto, and a memory records the session's id in the version's `source` and
 *   its name in the reason. So when history travels its `index.jsonl` is
 *   written from the parsed records with those two scrubbed — the source keeps
 *   its kind, the reason says *a session* — and the payloads, which are
 *   bodies, are copied as they are.
 * - **An object play wrote stays home** (2026-10-10, the P16.3c review):
 *   `provenance.source === 'session'`, the marking a memory book carries and
 *   the library page reads to say *not meant to be shared or published*. Its
 *   entries carry the session and turn each was remembered from, and their
 *   text is what that play produced, so carrying one would send an unticked
 *   session's id and something of its transcript. It is `not-portable` in
 *   `leftBehind`, with a note. *Since [P16.3d] the rule itself says so*:
 *   the walker marks such a node `writtenByPlay` and `fileSet` never carries
 *   it, listing it the way this does — so a plan built from `fileSet` never
 *   asks for one, and the check below is the backstop, not the rule.
 * - **A card carries the pictures its rows name, and no others** (2026-10-10,
 *   the P16.3c review). The store never takes a picture out of a card — the
 *   card is where a restored version finds its pixels — so a card copied whole
 *   would send an expression the author removed. A card holding a picture no
 *   current row names is re-spliced without it; every other card is copied
 *   byte for byte.
 *
 * What it deliberately does not scrub, said here so it is not mistaken for an
 * oversight: a turn's recorded prompt may quote memory another session wrote
 * (it is what that session sent, and the review says so — P16.3g — the lead's
 * decision of 2026-10-10). ~~an object that names a session in its own body —
 * a memory book's entries carry their origin session — travels as its body
 * says, because it is that object's content.~~ *Corrected 2026-10-10, the
 * P16.3c review:* that decision covered rendered prompts, not a carried
 * object's structured session ids, and the corrections bind the leak test to
 * the unticked session's **id** — so such an object stays home (above). *Which
 * of the two answers the lead keeps — home, or carried with its session
 * pointers stripped — is the lead's to record*; home is the one that can be
 * taken back.
 */

/**
 * ***What the confirm decided***, in the terms the file is written in — built
 * by P16.3d from a closure and `fileSet`, and taken here as given.
 */
export interface PublishPlan {
  origin: PublishOrigin;
  /**
   * The World as stored (a World start) or as just kept (a selection); `null`
   * for no World.
   *
   * ***`contentHash`, for a stored World*** (2026-10-11, the P16.3d review):
   * the hash the body was read at — the confirm's walk's. `world.json` is
   * encoded from `body`, while the World's folder and pictures come from the
   * row {@link planWorldFile} reads itself, later; a save between the two
   * would pair one World's `world.json` with another's pictures. Given, the
   * plan's read must still hash to it, or it throws
   * {@link WorldFileChangedError}. Absent for a World kept in memory, which
   * has no stored row to disagree with.
   */
  world: { body: World; contentHash?: string } | null;
  /** What travels, members first or not — {@link planWorldFile} puts members first. */
  objects: { id: string; member: boolean }[];
  /** Each must be a session member of `world` — anything else is refused, `not-a-member`. */
  sessions: string[];
  /** `fileSet`'s, from carried things to what stays home. */
  leftBehind: LeftBehind[];
  /** The **derived** requirements; the stored World's are merged over them for the manifest. */
  requires: World['requires'];
  history: boolean;
}

export interface WorldFileContext {
  library: LibraryContext;
  sessions: SessionContext;
  build: BuildInfo | null;
  /** The zip writer's bounds — injected by tests; the readers' own by default. */
  limits?: ZipWriteLimits;
  /** The moment the file says it was published — every member's mtime. */
  now?: () => Date;
}

/**
 * One member as planned: bytes already in hand (the manifest, the World, a
 * history's index), or a file to read at write time, which must still give
 * `size` bytes hashing to `expect` — the plan's reading of it.
 */
export type PlannedMember =
  | { name: string; bytes: Uint8Array }
  | {
      name: string;
      file: string;
      size: number;
      expect: string;
      /**
       * ***A card carried without the pictures no row names*** (2026-10-10):
       * the blob ids it keeps, and the size its stored file had when the plan
       * read it — the write re-splices the same bytes the same way and checks
       * the result, and refuses a stored file of any other size before reading
       * it, so one member is still all the write holds.
       */
      card?: { keep: readonly string[]; storedSize: number };
    };

export interface PlannedWorldFile {
  manifest: WorldFileManifest;
  /** In the order they will be written; the manifest first. */
  members: PlannedMember[];
  entries: number;
  /** The archive's exact size — what the download's `Content-Length` will be. */
  bytes: number;
  /** What the file does not carry and says so — the manifest's `omitted`, for the route. */
  notes: ImportNote[];
  /** `manifest.exportedBy.at`, which every member is stamped with. */
  mtime: Date;
  limits: ZipWriteLimits;
}

export interface WorldFileRefusal {
  refusal: 'too-many-files' | 'too-large' | 'not-a-member' | 'manifest-too-large';
}

/**
 * ***Something the plan read is not what is there now*** — an object saved, a
 * picture removed, a session export's staged copy touched. The route answers
 * `409 publish.changed` ([P16.3]'s plan, P16.3d).
 *
 * `path` is the **member name** the file would have held — `library/actors/
 * vera/card.png` — never the path on disk: this reaches a response, and an
 * absolute path in one is a description of somebody's filesystem ([22 §4.1]).
 * For an object that could no longer be read at all, before it had a member
 * name, it is the object's id, which is what the review showed beside it.
 */
export class WorldFileChangedError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`This changed while it was being published: ${path}`);
    this.name = 'WorldFileChangedError';
    this.path = path;
  }
}

// ── What one object carries ─────────────────────────────────────────────────

/** A file the plan would copy: its member name, where it is, and how large it was. */
interface Candidate {
  name: string;
  path: string;
  size: number;
}

/**
 * ***One object, surveyed by `stat` alone*** — what it would contribute, before
 * anything is read. Shared by {@link measureObject} (the review's numbers) and
 * {@link planWorldFile} (the file's members), so the size the review shows and
 * the size the file has are one count.
 */
interface ObjectSurvey {
  row: IndexedObject;
  schema: PortableSchemaId;
  /** The object's folder on disk — the one it is really in, `packages/` included. */
  folder: string;
  /**
   * The stored file; `null` when the index names a file that is not there.
   * `size` is what the member will hold — for a card re-spliced without a
   * picture, that size, and `stored` the file's own.
   */
  file: { path: string; size: number; stored: number } | null;
  /** Set when the card holds a picture no current row names — see {@link cardAsCarried}. */
  card: { keep: readonly string[] } | null;
  /** Pictures beside it that would travel: the media rows' files, each once. */
  assets: { ref: string; base: string; path: string; size: number }[];
  /** Pictures over the entry limit — named, never carried. */
  tooLarge: { ref: string; bytes: number }[];
  /** Rows naming a file that is not there, or not where a row may point. */
  missing: string[];
  pictures: { count: number; bytes: number };
  history: {
    versions: number;
    /** `history/index.jsonl` as it travels — {@link travellingHistory} — or null when there is none. */
    index: Uint8Array | null;
    /** The payloads, `history/v/<sha256>.json`, copied as they are. */
    files: { relative: string; path: string; size: number }[];
    tooLarge: string[];
  };
}

/** Nothing travels: the facts of an object that stays home whole — a fresh record each time. */
function nothing(): NodeFacts {
  return {
    entries: 0,
    bytes: 0,
    pictures: { count: 0, bytes: 0 },
    history: { versions: 0, entries: 0, bytes: 0 },
    omitted: [],
  };
}

/**
 * ***What carrying one object would cost*** — the review's numbers (P16.3d),
 * from the same survey the plan copies from.
 *
 * **What it counts**, where the plan left it open: `entries` and `bytes` are
 * the stored file and the pictures beside it that would travel; `pictures` is
 * every media row that travels — inside the card for an actor (already in
 * `bytes`, as the card is), beside the object for every other kind; `history`
 * is what opting in would add — the index and each payload present on disk —
 * and is surveyed only when `o.history` asks, so a caller that will not offer
 * history does not pay for a listing. A stored file over the entry limit
 * contributes nothing and is named in `omitted`: the whole object stays home
 * (risk 3 — *a large card leaves its actor behind*).
 *
 * *Since 2026-10-10 (the P16.3c review)*: a card's `bytes` are the card as it
 * travels, re-spliced when it holds a picture no row names; `history` counts
 * the index as it travels, scrubbed; and an object play wrote — a memory book
 * — measures as nothing, since it stays home ({@link writtenByPlay}).
 */
export async function measureObject(
  context: WorldFileContext,
  handle: string,
  row: IndexedObject,
  o: { history: boolean },
): Promise<NodeFacts> {
  if (writtenByPlay(row.body)) return nothing();
  const limit = limitsOf(context).maxEntryBytes;
  const survey = await surveyObject(context, handle, row, { history: o.history, limit });
  const index = survey.history.index;
  const history = {
    versions: survey.history.versions,
    entries: survey.history.files.length + (index === null ? 0 : 1),
    bytes: survey.history.files.reduce((sum, one) => sum + one.size, index?.length ?? 0),
  };
  if (survey.file === null || survey.file.stored > limit) {
    return {
      ...nothing(),
      omitted:
        survey.file === null
          ? []
          : [{ ref: OBJECT_FILENAMES[survey.schema], bytes: survey.file.stored }],
    };
  }
  return {
    entries: 1 + survey.assets.length,
    bytes: survey.file.size + survey.assets.reduce((sum, one) => sum + one.size, 0),
    pictures: survey.pictures,
    history,
    omitted: survey.tooLarge,
  };
}

async function surveyObject(
  context: WorldFileContext,
  handle: string,
  row: IndexedObject,
  o: { history: boolean; limit: number },
): Promise<ObjectSurvey> {
  const { layout } = context.library;
  const schema = row.schemaId as PortableSchemaId;
  const folder = layout.folderOf(row.path);
  // The read door every object read goes through: a folder that leads out of
  // the data directory is refused rather than copied into somebody's download.
  await layout.assertReal(row.path);
  const facts = await statFile(row.path);
  let file: ObjectSurvey['file'] =
    facts === null ? null : { path: row.path, size: facts.size, stored: facts.size };
  let card: ObjectSurvey['card'] = null;

  const assets: ObjectSurvey['assets'] = [];
  const tooLarge: ObjectSurvey['tooLarge'] = [];
  const missing: string[] = [];
  let pictures: ObjectSurvey['pictures'];
  const rows = mediaRowsIn(row.body);
  if (schema === ACTOR_SCHEMA) {
    // A card is its own container ([03 §5.2.2]): every row's bytes ride inside
    // `card.png`, so nothing is read beside it — and a stray `assets/` folder
    // in an actor's directory names nothing that travels.
    //
    // ~~which is copied whole~~ — *2026-10-10, the P16.3c review*: whole only
    // when it holds nothing else. The store keeps every picture a card ever
    // held (a restored version finds its pixels there), so the card is read
    // here — the one kind whose survey reads, since what it carries is decided
    // by what it holds — and one holding a picture no row names is measured
    // as it will travel, re-spliced. A card over the entry limit is not read:
    // it stays home whatever it holds.
    if (file !== null && file.stored <= o.limit) {
      const bytes = await readFileBytes(row.path);
      const keep = [...new Set(rows.map((one) => one.ref))].sort(compare);
      const carried = bytes === null ? null : cardAsCarried(bytes, keep);
      if (carried !== null) {
        card = { keep };
        file = { ...file, size: carried.byteLength };
      }
    }
    pictures = {
      count: rows.length,
      bytes: rows.reduce((sum, one) => sum + (Number.isFinite(one.bytes) ? one.bytes : 0), 0),
    };
  } else {
    /**
     * ***Only what the rows name*** — 16 §5.2's *a lorebook with its
     * `assets/`* read as the object reads it, never as the folder lists it. A
     * file no row names is an upload nobody saved, or a picture the author
     * removed and the sweep has not collected; either way it is not part of
     * the object, and a person publishing a book has not chosen to send it.
     * Rows resolve through `assetFile` — the one function a read, a store and
     * a sweep resolve a `ref` through — so a `ref` that climbs out, or an
     * `assets` that is a link elsewhere, is missing here as it is there.
     *
     * *The current rows, even with history opted in* — read narrowly where
     * the plan's tree says *only what `mediaRowsIn` names*. The sweep keeps a
     * picture any surviving version names ([03 §11.2]), so here a restored
     * version finds its pictures; carried history does not bring them, and a
     * version restored on the other side that names a picture the author has
     * since removed shows it missing. The alternative would send pictures the
     * author took out of the object, which is the wrong way to be wrong.
     */
    const seen = new Set<string>();
    for (const media of rows) {
      const base = basename(media.ref);
      if (['', '.', '..'].includes(base) || seen.has(base)) continue;
      seen.add(base);
      let path: string;
      try {
        path = await assetFile(context.library, handle, row, media.ref);
      } catch (error) {
        if (!(error instanceof PathEscapeError)) throw error;
        missing.push(media.ref);
        continue;
      }
      const held = await statFile(path);
      if (held === null) missing.push(media.ref);
      else if (held.size > o.limit) tooLarge.push({ ref: media.ref, bytes: held.size });
      else assets.push({ ref: media.ref, base, path, size: held.size });
    }
    pictures = {
      count: assets.length,
      bytes: assets.reduce((sum, one) => sum + one.size, 0),
    };
  }

  const history: ObjectSurvey['history'] = { versions: 0, index: null, files: [], tooLarge: [] };
  if (o.history) {
    const versions = await listVersions(folder);
    history.versions = versions.length;
    // The index as it travels, from the parsed records ~~copied from disk~~
    // (2026-10-10, the P16.3c review) — see {@link travellingHistory}.
    if (versions.length > 0) {
      const index = travellingHistory(versions);
      if (index.length > o.limit) history.tooLarge.push('history/index.jsonl');
      else history.index = index;
    }
    const wanted: { relative: string; segments: string[] }[] = [];
    for (const digest of new Set(versions.map((version) => version.digest))) {
      // `listVersions` reads a hand-editable file; a digest that is not one
      // names no payload this would copy, whatever it says.
      if (!/^[0-9a-f]{64}$/.test(digest)) continue;
      wanted.push({
        relative: `history/v/${digest}.json`,
        segments: ['history', 'v', `${digest}.json`],
      });
    }
    for (const one of wanted) {
      let path: string;
      try {
        path = await resolveWithinReal(folder, ...one.segments);
      } catch (error) {
        if (!(error instanceof PathEscapeError)) throw error;
        continue;
      }
      const held = await statFile(path);
      if (held === null) continue;
      if (held.size > o.limit) history.tooLarge.push(one.relative);
      else history.files.push({ relative: one.relative, path, size: held.size });
    }
  }

  return { row, schema, folder, file, card, assets, tooLarge, missing, pictures, history };
}

/**
 * ***A card as it travels*** — re-spliced to carry only the blobs `keep`
 * names, or `null` when it already carries nothing else (the common case,
 * which is then copied byte for byte) or is not a card this codec can splice.
 *
 * *Splice, never re-encode*: the codec drops its own two chunks and writes
 * them again, leaving the pixels and every other chunk as they were
 * (`png.ts`), so the portrait the person sees is the one they had. The same
 * bytes and the same `keep` always splice to the same result, which is what
 * lets the write check the member against the plan's hash.
 */
function cardAsCarried(bytes: Uint8Array, keep: readonly string[]): Uint8Array | null {
  let contents;
  try {
    contents = pngCardCodec.read(bytes);
  } catch (error) {
    if (error instanceof CardFormatError) return null;
    throw error;
  }
  if (contents.envelope === null) return null;
  const named = new Set(keep);
  const kept = new Map([...contents.blobs].filter(([id]) => named.has(id)));
  if (kept.size === contents.blobs.size) return null;
  return pngCardCodec.write(bytes, contents.envelope, kept);
}

/**
 * ***A history as it travels*** (2026-10-10, the P16.3c review) — every
 * record, one line each, with what names a session taken out:
 *
 * - a `memory` source keeps its kind and loses its `sessionId` — the history
 *   still says *a memory did this*, not whose play it was;
 * - a reason one of play's own writers composed — `sessions/promote.ts`'s
 *   *Plot hook saved from "<name>"*, `memory/capture.ts`'s and
 *   `memory/extract.ts`'s *remembered from …* — says *a session* instead,
 *   matched only on the source kind its writer uses, so a person's own words
 *   in a renamed version are theirs and travel as written.
 *
 * Re-encoded rather than filtered line by line, so a torn last line — which
 * `listVersions` already skips — is not sent either. The leak test drives the
 * real promotion, so a writer whose wording drifts fails it.
 */
function travellingHistory(versions: readonly VersionRecord[]): Uint8Array {
  return encoder.encode(versions.map((one) => `${JSON.stringify(scrubbed(one))}\n`).join(''));
}

/** [source kind, what its writer composes, what travels instead]. */
const SESSION_REASONS: readonly (readonly [string, RegExp, string])[] = [
  ['manual', /^Plot hook saved from "[\s\S]*"$/, 'Plot hook saved from a session'],
  ['memory', /^remembered from [\s\S]*$/, 'remembered from a session'],
];

function scrubbed(version: VersionRecord): Record<string, unknown> {
  const kind = (version.source as { kind?: unknown } | undefined)?.kind;
  const source = kind === 'memory' ? { kind } : version.source;
  const match = SESSION_REASONS.find(
    ([of, pattern]) =>
      of === kind && typeof version.reason === 'string' && pattern.test(version.reason),
  );
  return { ...version, source, reason: match?.[2] ?? version.reason };
}

/**
 * ***Written by play*** — `provenance.source === 'session'`, the marking
 * `memory/books.ts` puts on a memory book and the library page reads to say
 * the book *is not meant to be shared or published*. That page's own comment
 * names what is owed when an export path is built: *that it read the same
 * marking*. This is that read.
 *
 * ~~A private predicate~~ — *since [P16.3d] (2026-10-10) the shared
 * `isWrittenByPlay`*, which the walker records on a node and `fileSet` acts
 * on, so the review says a memory book stays home before this does. The check
 * here stays, belt and braces: a plan built some other way than from
 * `fileSet` still cannot carry one.
 */
const writtenByPlay = isWrittenByPlay;

// ── What one session carries ────────────────────────────────────────────────

interface SessionSurvey {
  id: string;
  name: string;
  turns: number;
  headTurnId: string | null;
  mode: string | null;
  /** The export's size as it travels — bindings and associations gone. */
  size: number;
  /**
   * Where it was written, and the hash of what was — `null` for a measure,
   * which writes nothing, and for an export over the entry limit, which is
   * never written.
   */
  staged: { path: string; digest: string } | null;
  /** The ids its links name, for what a too-large object is named by. */
  names: ReadonlySet<string>;
  pictures: Candidate[];
  attachments: (Candidate & { hex: string })[];
  missingPictures: number;
  missingAttachments: number;
  tooLarge: { path: string; bytes: number }[];
}

/**
 * ***What carrying one session would cost*** — the review's numbers for a
 * session row (P16.3d), from the same survey the plan stages from.
 *
 * **The export is built to be measured**, because its size is the one number
 * that decides whether it travels at all: a session records the rendered
 * prompt of every call (`turn.ts`), so a long one can pass the readers' 64 MiB
 * entry bound, and the review should say so before the person ticks it. An
 * unreadable session measures as nothing.
 *
 * *Measured as the plan will write it* (2026-10-10, the P16.3c review): with
 * an `exportedBy` of the plan's own shape — this build's version and an ISO
 * moment, which is fixed-width — rather than an empty one, which made every
 * session's number some thirty bytes short of the file's.
 */
export async function measureSession(
  context: WorldFileContext,
  handle: string,
  id: string,
): Promise<SessionFacts> {
  const limit = limitsOf(context).maxEntryBytes;
  const survey = await surveySession(context, handle, id, exportedByOf(context), limit, null);
  if (survey === null) {
    return { turns: 0, pictures: 0, attachments: 0, missingPixels: 0, entries: 0, bytes: 0 };
  }
  const files = [...survey.pictures, ...survey.attachments];
  return {
    turns: survey.turns,
    pictures: survey.pictures.length,
    attachments: survey.attachments.length,
    missingPixels: survey.missingPictures,
    entries: 1 + files.length,
    bytes: survey.size + files.reduce((sum, one) => sum + one.size, 0),
  };
}

/** The header every member of one file carries, in the shape the plan writes it. */
function exportedByOf(context: WorldFileContext): SessionExport['exportedBy'] {
  return {
    version: context.build?.version ?? null,
    at: (context.now?.() ?? new Date()).toISOString(),
  };
}

/** The session fields that never leave this install — see the module comment. */
const STRIPPED_SESSION_FIELDS: ReadonlySet<string> = new Set(['roles', 'stepRoles']);

/**
 * ***The session export as it travels*** — P11.10's envelope, unchanged but
 * for what the module comment says leaves: `roles`, `stepRoles`, and
 * `memory.associations`. The rest of `memory` stays (whether this session
 * shares and draws on memories is the transcript's own setting), and an
 * absent `associations` reads as *auto* (`memory/config.ts`), so nothing on
 * the other side has to know it was removed. `exportedBy` is the manifest's,
 * so every member of one file says the same moment.
 */
function travelling(
  exported: SessionExport,
  exportedBy: SessionExport['exportedBy'],
): Record<string, unknown> {
  const kept = Object.fromEntries(
    Object.entries(exported.session as Record<string, unknown>).filter(
      ([key]) => !STRIPPED_SESSION_FIELDS.has(key),
    ),
  );
  const memory = kept['memory'];
  if (typeof memory === 'object' && memory !== null && !Array.isArray(memory)) {
    kept['memory'] = Object.fromEntries(
      Object.entries(memory as Record<string, unknown>).filter(([key]) => key !== 'associations'),
    );
  }
  return { ...exported, exportedBy, session: kept };
}

/**
 * ***The export's JSON, a piece at a time*** (2026-10-10, the P16.3c review)
 * — exactly what `JSON.stringify(document)` answers, compact, without ever
 * being one string.
 *
 * **Why not the one string.** A long transcript's export is tens of MiB
 * (every call's rendered prompt is recorded, `turn.ts`), and a plan of several
 * held every one of them, encoded, until it returned — the sum of all of them
 * in memory on a small container, where the zip writer holds one member at a
 * time. Past V8's string limit (just under 512 Mi characters) `JSON.stringify`
 * throws instead, and the publish failed where it should have left that
 * session behind. Pieces are the top-level fields, and each element of an
 * array field — the turns, the renditions — on its own, so the largest string
 * is one turn.
 *
 * *The same bytes as `JSON.stringify`, by its own rules at the one level this
 * takes apart*: a field whose value it would omit (undefined, a function) is
 * omitted, an array element it would write as `null` is `null`, and everything
 * below is `JSON.stringify`'s own. The test holds the staged member to
 * `JSON.stringify(JSON.parse(it))`.
 */
function* compactPieces(document: Readonly<Record<string, unknown>>): Generator<string> {
  yield '{';
  let first = true;
  for (const [key, value] of Object.entries(document)) {
    const head = `${first ? '' : ','}${JSON.stringify(key)}:`;
    if (Array.isArray(value)) {
      first = false;
      yield `${head}[`;
      for (let at = 0; at < value.length; at += 1) {
        const text = JSON.stringify(value[at]) as string | undefined;
        yield `${at === 0 ? '' : ','}${text ?? 'null'}`;
      }
      yield ']';
      continue;
    }
    const text = JSON.stringify(value) as string | undefined;
    if (text === undefined) continue;
    first = false;
    yield `${head}${text}`;
  }
  yield '}';
}

/** What a document's pieces come to, in UTF-8 bytes — counted, never held. */
function sizeOfPieces(pieces: Iterable<string>): number {
  let size = 0;
  for (const piece of pieces) size += Buffer.byteLength(piece, 'utf8');
  return size;
}

/**
 * Writes a document's pieces to `to` (a name nothing else holds), hashing as
 * it goes — the staged copy the write re-reads and checks.
 */
async function stagePieces(
  pieces: Iterable<string>,
  to: string,
): Promise<{ size: number; digest: string }> {
  const hash = createHash('sha256');
  function* hashed(): Generator<string> {
    for (const piece of pieces) {
      hash.update(piece, 'utf8');
      yield piece;
    }
  }
  const size = await writeNewTextFile(to, hashed());
  return { size, digest: `sha256:${hash.digest('hex')}` };
}

/**
 * One session surveyed: its export built once, counted, and — when `stageTo`
 * is given and it fits — written there a turn at a time; then let go, so a
 * plan holds a session's numbers and never its transcript.
 */
async function surveySession(
  context: WorldFileContext,
  handle: string,
  id: string,
  exportedBy: SessionExport['exportedBy'],
  limit: number,
  stageTo: (() => string) | null,
): Promise<SessionSurvey | null> {
  /**
   * ***A session that cannot be read is left behind, not fatal*** — the
   * walker's own posture for the same failure (`closure.ts`: *one unreadable
   * transcript becomes a missing row rather than a World that cannot be
   * published*). The confirm re-walks, so this is a session that went between
   * that walk and this read; the plan names it in `omitted` and the World in
   * the file does not name it.
   */
  let exported: SessionExport | null;
  try {
    exported = await exportSession(
      { sessions: context.sessions, build: context.build },
      handle,
      id,
    );
  } catch {
    exported = null;
  }
  if (exported === null) return null;

  const session = exported.session as Record<string, unknown>;
  // Compact, as the session export route sends it: the readers' entry bound
  // is the one a long transcript meets, and indentation would spend it on
  // whitespace. Counted first, and written only when it fits — an export
  // over the bound is never on disk, even in scratch.
  const document = travelling(exported, exportedBy);
  const size = sizeOfPieces(compactPieces(document));
  let staged: { path: string; size: number; digest: string } | null = null;
  if (stageTo !== null && size <= limit) {
    const path = stageTo();
    staged = { path, ...(await stagePieces(compactPieces(document), path)) };
  }
  const names = new Set(
    sessionEdges(session)
      .map((edge) => edge.ref.id)
      .filter((one): one is string => one !== null),
  );
  const sessionRoot = context.sessions.layout.sessionRoot(handle, id);
  const tooLarge: SessionSurvey['tooLarge'] = [];

  /**
   * ***A rendition's pixels, by the record's own `asset.path`*** — which is
   * what `importSession`'s `pixels(path)` will be asked for on the other side,
   * so the member is `sessions/<id>/assets/<asset.path>` exactly, or it is not
   * carried: a path the zip writer would refuse, or one that climbs out of the
   * session's `assets/`, is a picture that cannot travel under its own name,
   * and it is counted with the ones whose pixels are not on disk.
   */
  const pictures: Candidate[] = [];
  let missingPictures = 0;
  const seen = new Set<string>();
  for (const rendition of exported.renditions) {
    const asset = (rendition as { asset?: unknown }).asset;
    if (typeof asset !== 'object' || asset === null) continue;
    const path = (asset as { path?: unknown }).path;
    if (typeof path !== 'string') {
      missingPictures += 1;
      continue;
    }
    const name = `sessions/${id}/assets/${path}`;
    if (seen.has(name)) continue;
    seen.add(name);
    if (zipNameRefusal(name) !== null) {
      missingPictures += 1;
      continue;
    }
    let disk: string;
    try {
      disk = await resolveWithinReal(sessionRoot, 'assets', path);
    } catch (error) {
      if (!(error instanceof PathEscapeError)) throw error;
      missingPictures += 1;
      continue;
    }
    const held = await statFile(disk);
    if (held === null) missingPictures += 1;
    else if (held.size > limit) tooLarge.push({ path, bytes: held.size });
    else pictures.push({ name, path: disk, size: held.size });
  }

  /**
   * ***The pictures on its moves*** — every digest a turn names, siblings
   * included, as the attachment sweep counts them; never the folder's other
   * files, which are uploads no move ever sent and so not part of what was
   * played.
   */
  const attachments: SessionSurvey['attachments'] = [];
  let missingAttachments = 0;
  for (const digest of digestsOf(exported.turns)) {
    const held = await attachmentOnDisk(context.sessions.layout, handle, id, digest);
    if (held === null) {
      missingAttachments += 1;
      continue;
    }
    if (held.bytes > limit) {
      tooLarge.push({ path: `attachments/${held.name}`, bytes: held.bytes });
      continue;
    }
    attachments.push({
      name: `sessions/${id}/attachments/${held.name}`,
      path: held.path,
      size: held.bytes,
      hex: digest.replace(/^sha256:/, ''),
    });
  }

  const mode = session['mode'];
  return {
    id,
    name: typeof session['name'] === 'string' ? session['name'] : '',
    turns: exported.turns.length,
    headTurnId: typeof session['headTurnId'] === 'string' ? session['headTurnId'] : null,
    mode:
      typeof mode === 'object' && mode !== null && typeof (mode as { id?: unknown }).id === 'string'
        ? (mode as { id: string }).id
        : null,
    size: staged?.size ?? size,
    staged: staged === null ? null : { path: staged.path, digest: staged.digest },
    names,
    pictures,
    attachments,
    missingPictures,
    missingAttachments,
    tooLarge,
  };
}

// ── The plan ────────────────────────────────────────────────────────────────

/** A file the plan will copy beside a stored file, with what decides it on a short or failed read. */
interface Copy extends Candidate {
  /** A content-addressed name's hex — the bytes must hash to it, or the file is damaged. */
  addressed: string | null;
  /** The note to emit when it cannot be carried after all — it has gone. */
  missing: ImportNote;
  /** The note to emit when its bytes contradict its name. */
  damaged: ImportNote;
}

/**
 * ***Plan the file***: every member, its bytes or its hash, the manifest — or
 * a refusal, before anything is written ([P16.3]'s plan, R11).
 *
 * **In order**: the manifest (always first, so the head of the file is enough
 * to preview it); the World as published; the objects, members first in the
 * order the plan gives them, each as its stored file then its pictures then
 * its history; then the sessions, in the World's own order, each as its export
 * then its pictures then its attachments. Within an object or a session,
 * names sort, so the same library publishes the same bytes.
 *
 * **Where the plan was silent, decided here** (each also in the report):
 *
 * - *Folder names that collide* — a system preset and a person's preset called
 *   the same, two folders differing only in case — are suffixed `-2`, `-3` in
 *   the order the objects come, compared case-folded so the file extracts the
 *   same on a filesystem that folds case. A folder name the zip writer would
 *   refuse is replaced by the object's slug; the name means nothing on
 *   arrival either way, because `create` picks its own.
 * - *A book scoped to the World that is not a member* travels as `member:
 *   false` and is **not** added to the World's `contents`: it names the World,
 *   so the World need not name it, and adding it would publish a World that
 *   differs from the stored one by a member nobody added (04 §9.1's query row).
 * - *A session member that cannot be read* is left behind with
 *   `publish.file.sessionUnreadable` and is not in `contents`; *one whose
 *   export is over the entry limit* is left behind with
 *   `publish.file.sessionTooLarge` and a `too-large` row in `leftBehind`
 *   naming it — the fact check's correction: the readers' 64 MiB bound reaches
 *   a long transcript before it reaches any card.
 * - *An object whose stored file is over the limit* stays home whole, as
 *   `too-large` in `leftBehind`, `from` the carried things whose references
 *   name its id (name-only references are not followed here — the plan holds
 *   no closure, and the review already said where they lead). *An object play
 *   wrote* stays home the same way, as `not-portable` (2026-10-10, the P16.3c
 *   review — see the module comment).
 *
 * **Two checks that were missing, 2026-10-10 (the P16.3c review):**
 *
 * - *The bytes copied are the body the plan read.* An object's pictures, its
 *   name and its edges come from the index's row; its stored file is read
 *   later. A file that is not the row's — saved between the two, or edited by
 *   hand before the watcher re-read it — would carry one body's bytes with the
 *   other's pictures. So the stored file must hash to `row.contentHash` (the
 *   same sha256 over the same bytes, `index-db/ingest.ts`), or the plan throws
 *   {@link WorldFileChangedError} — the same `409` as a change between plan
 *   and write.
 * - *The early refusal counts the file the plan will write*: the manifest, and
 *   a `world.json` only when there is a World. It counted the second always,
 *   and refused a one-object file of exactly `maxEntries` the writer takes.
 *
 * Throws {@link WorldFileChangedError} when an object it was asked for is no
 * longer readable here, or its stored file has gone or is not the body the
 * index holds; when a stored World handed over with its `contentHash` is gone
 * or saved since (2026-10-11, the P16.3d review); and whatever the disk
 * throws. Session exports are staged in `stage` as each is surveyed, which
 * the caller owns and disposes of after the write — or after a refusal, which
 * can come after some are staged.
 */
export async function planWorldFile(
  context: WorldFileContext,
  handle: string,
  plan: PublishPlan,
  stage: ScratchSpace,
): Promise<PlannedWorldFile | WorldFileRefusal> {
  const limits = limitsOf(context);
  const at = context.now?.() ?? new Date();
  const exportedBy = { version: context.build?.version ?? null, at: at.toISOString() };
  const omitted: ImportNote[] = [];
  const leftBehind: LeftBehind[] = [...plan.leftBehind];
  const folders = new FolderNames();

  const world = plan.world === null ? null : upgradeLegacySchema(plan.world.body);
  const contents = world === null ? [] : uniqueById(listOf(world.contents));
  const named = new Set(contents.map((entry) => entry.id));

  const sessionIds = [...new Set(plan.sessions)];
  const sessionMembers = new Set(
    contents.filter((entry) => entry.schema === SESSION_SCHEMA).map((entry) => entry.id),
  );
  if (sessionIds.some((id) => !sessionMembers.has(id))) return { refusal: 'not-a-member' };

  // ── Phase one: survey, by `stat` (and a card by its chunks) — no file is
  // copied yet; each session's export is staged as it is surveyed. ──
  const ordered = membersFirst(plan.objects);
  const surveys: { survey: ObjectSurvey; member: boolean }[] = [];
  const stayHome: { row: IndexedObject; reason: 'too-large' | 'not-portable'; note: ImportNote }[] =
    [];
  for (const wanted of ordered) {
    let row: IndexedObject;
    try {
      row = read(context.library, handle, wanted.id);
    } catch (error) {
      if (error instanceof LibraryError && error.code === 'not-found') {
        // Gone between the confirm's walk and this read — deleted, or moved
        // out of reach. The object has no member name yet; its id is what the
        // review showed.
        throw new WorldFileChangedError(wanted.id);
      }
      throw error;
    }
    if (!isKnownSchema(row.schemaId) || isWorld(row.schemaId)) {
      // A World is the file, never a thing inside it ([15 §3.1]); the walk
      // excludes one, so this is a plan built some other way.
      if (row.id !== world?.id) {
        omitted.push(note('publish.file.nestedWorld', 'info', { id: row.id, name: row.name }));
      }
      continue;
    }
    const label = { id: row.id, name: row.name, schema: row.schemaId };
    if (writtenByPlay(row.body)) {
      stayHome.push({
        row,
        reason: 'not-portable',
        note: note('publish.file.writtenByPlay', 'warn', label),
      });
      continue;
    }
    const survey = await surveyObject(context, handle, row, {
      history: plan.history,
      limit: limits.maxEntryBytes,
    });
    if (survey.file === null) throw new WorldFileChangedError(memberNameOf(row));
    if (survey.file.stored > limits.maxEntryBytes) {
      stayHome.push({
        row,
        reason: 'too-large',
        note: note('publish.file.objectTooLarge', 'warn', { ...label, bytes: survey.file.stored }),
      });
      continue;
    }
    surveys.push({ survey, member: wanted.member });
  }

  // The World's own folder and pictures, when it is stored; never its history.
  let worldRow: IndexedObject | null = null;
  if (world !== null) {
    try {
      worldRow = read(context.library, handle, world.id, WORLD_SCHEMA);
    } catch (error) {
      if (!(error instanceof LibraryError && error.code === 'not-found')) throw error;
    }
    // The row is the body's (2026-10-11, the P16.3d review): a World saved
    // or gone since the confirm read it would otherwise travel as its old
    // `world.json` beside its new pictures — the same `409` as an object's
    // stored file that is not its row (below). The id is what the review
    // showed for it; it has no member name yet.
    const expected = plan.world?.contentHash;
    if (expected !== undefined && worldRow?.contentHash !== expected) {
      throw new WorldFileChangedError(world.id);
    }
  }
  const worldSurvey =
    worldRow === null
      ? null
      : await surveyObject(context, handle, worldRow, {
          history: false,
          limit: limits.maxEntryBytes,
        });

  const sessions: SessionSurvey[] = [];
  for (const entry of contents) {
    if (entry.schema !== SESSION_SCHEMA || !sessionIds.includes(entry.id)) continue;
    // A name no other plan in the same space can take: a space shared by two
    // plans would otherwise have the second overwrite what the first will
    // re-read, and fail it as changed when nothing the person did changed it.
    const survey = await surveySession(
      context,
      handle,
      entry.id,
      exportedBy,
      limits.maxEntryBytes,
      () => stage.path(`${uuidv7()}.json`),
    );
    const name = entry.name ?? '';
    if (survey === null) {
      omitted.push(note('publish.file.sessionUnreadable', 'warn', { id: entry.id, name }));
      continue;
    }
    if (survey.staged === null) {
      omitted.push(
        note('publish.file.sessionTooLarge', 'warn', {
          id: survey.id,
          name: survey.name,
          bytes: survey.size,
        }),
      );
      leftBehind.push({
        schema: SESSION_SCHEMA,
        id: survey.id,
        name: survey.name,
        reason: 'too-large',
        required: false,
        from: [],
      });
      continue;
    }
    sessions.push(survey);
  }

  // Refused before a file is read, on the survey's own sizes — a World of ten
  // thousand pictures is told so without first being hashed. Every entry the
  // survey counted can only be dropped by phase two, never added, so this is
  // never fewer than the file; checked again at the end with the manifest,
  // which is the exact answer.
  const early = storedZipRefusal(
    [
      { name: WORLD_FILE_MANIFEST, size: 0 },
      ...(world === null ? [] : [{ name: 'library/worlds/x/world.json', size: 0 }]),
      ...surveyedMembers(surveys, worldSurvey, sessions),
    ],
    limits,
  );
  if (early !== null) return { refusal: refusalOf(early) };

  // ── Phase two: read and hash every file, once. ──
  const objectRows: WorldFileObject[] = [];
  const objectMembers: PlannedMember[] = [];
  const carriedBodies: { id: string; schema: string; body: unknown }[] = [];
  for (const { survey, member } of surveys) {
    const { row, schema } = survey;
    const kindDirectory = LIBRARY_DIRECTORIES[schema];
    const folder = folders.take(kindDirectory, basename(survey.folder), row.name);
    const prefix = `library/${kindDirectory}/${folder}`;
    const stored = `${prefix}/${OBJECT_FILENAMES[schema]}`;
    const label = { id: row.id, name: row.name };

    const head = await readStored(row, survey, stored, limits.maxEntryBytes);
    const copies: Copy[] = [
      ...[...survey.assets]
        .sort((one, two) => compare(one.base, two.base))
        .map((asset): Copy => ({
          name: `${prefix}/assets/${asset.base}`,
          path: asset.path,
          size: asset.size,
          addressed: addressedHex(asset.base),
          missing: note('publish.file.pictureMissing', 'info', { ...label, ref: asset.ref }),
          damaged: note('publish.file.pictureDamaged', 'warn', { ...label, ref: asset.ref }),
        })),
      ...survey.history.files.map((file): Copy => ({
        name: `${prefix}/${file.relative}`,
        path: file.path,
        size: file.size,
        addressed: addressedHex(basename(file.relative)),
        missing: note('publish.file.versionMissing', 'info', { ...label, ref: file.relative }),
        damaged: note('publish.file.versionDamaged', 'warn', { ...label, ref: file.relative }),
      })),
    ];
    for (const ref of survey.missing) {
      omitted.push(note('publish.file.pictureMissing', 'info', { ...label, ref }));
    }
    for (const big of survey.tooLarge) {
      omitted.push(note('publish.file.pictureTooLarge', 'warn', { ...label, ...big }));
    }
    for (const relative of survey.history.tooLarge) {
      omitted.push(note('publish.file.versionTooLarge', 'warn', { ...label, ref: relative }));
    }

    const copied = await readCopies(copies, limits.maxEntryBytes, omitted);
    const index = survey.history.index;
    const history: PlannedMember[] =
      index === null ? [] : [{ name: `${prefix}/history/index.jsonl`, bytes: index }];
    // The index before the payloads it lists, as the folder reads.
    const assetsCopied = copied.filter((one) => !one.name.startsWith(`${prefix}/history/`));
    const versionsCopied = copied.filter((one) => one.name.startsWith(`${prefix}/history/`));
    objectMembers.push(head, ...assetsCopied, ...history, ...versionsCopied);
    objectRows.push({
      schema,
      id: row.id,
      name: row.name,
      folder: prefix,
      file: stored,
      contentHash: head.expect,
      member: member && (world === null || named.has(row.id)),
    });
    carriedBodies.push({ id: row.id, schema, body: row.body });
  }

  const sessionRows: WorldFileSession[] = [];
  const sessionMembersPlanned: PlannedMember[] = [];
  for (const survey of sessions) {
    const folder = `sessions/${survey.id}`;
    const staged = survey.staged;
    if (staged === null) continue;
    const label = { id: survey.id, name: survey.name };
    const exportMember: PlannedMember = {
      name: `${folder}/${WORLD_FILE_SESSION_EXPORT}`,
      file: staged.path,
      size: survey.size,
      expect: staged.digest,
    };
    const pictures = await readCopies(
      [...survey.pictures]
        .sort((one, two) => compare(one.name, two.name))
        .map((picture): Copy => ({
          ...picture,
          addressed: null,
          missing: note('publish.file.sessionPicturesMissing', 'info', { ...label, count: 1 }),
          damaged: note('publish.file.pictureDamaged', 'warn', label),
        })),
      limits.maxEntryBytes,
      omitted,
    );
    const attachments = await readCopies(
      [...survey.attachments]
        .sort((one, two) => compare(one.name, two.name))
        .map((attachment): Copy => ({
          name: attachment.name,
          path: attachment.path,
          size: attachment.size,
          addressed: attachment.hex,
          missing: note('publish.file.sessionAttachmentsMissing', 'info', { ...label, count: 1 }),
          damaged: note('publish.file.pictureDamaged', 'warn', {
            ...label,
            ref: `attachments/${basename(attachment.name)}`,
          }),
        })),
      limits.maxEntryBytes,
      omitted,
    );
    if (survey.missingPictures > 0) {
      omitted.push(
        note('publish.file.sessionPicturesMissing', 'info', {
          ...label,
          count: survey.missingPictures,
        }),
      );
    }
    if (survey.missingAttachments > 0) {
      omitted.push(
        note('publish.file.sessionAttachmentsMissing', 'info', {
          ...label,
          count: survey.missingAttachments,
        }),
      );
    }
    for (const big of survey.tooLarge) {
      omitted.push(
        note('publish.file.sessionPictureTooLarge', 'warn', {
          ...label,
          ref: big.path,
          bytes: big.bytes,
        }),
      );
    }
    sessionMembersPlanned.push(exportMember, ...pictures, ...attachments);
    sessionRows.push({
      id: survey.id,
      name: survey.name,
      folder,
      turns: survey.turns,
      headTurnId: survey.headTurnId,
      pictures: pictures.length,
      attachments: attachments.length,
      mode: survey.mode,
    });
  }

  for (const home of stayHome) {
    const id = home.row.id;
    const from = [
      ...carriedBodies
        .filter((carried) => namesId(edgesOf(carried.schema, carried.body), id))
        .map((carried) => carried.id),
      ...sessions.filter((carried) => carried.names.has(id)).map((carried) => carried.id),
    ];
    const required = carriedBodies.some((carried) =>
      edgesOf(carried.schema, carried.body).some((edge) => edge.ref.id === id && edge.required),
    );
    leftBehind.push({
      schema: home.row.schemaId,
      id,
      name: home.row.name,
      reason: home.reason,
      required,
      from,
    });
    omitted.push(home.note);
  }

  // ── The World as published ──
  let worldEntry: WorldFileManifest['world'] = null;
  const worldMembers: PlannedMember[] = [];
  if (world !== null) {
    const carried = new Set([
      ...objectRows.filter((one) => one.member).map((one) => one.id),
      ...sessionRows.map((one) => one.id),
    ]);
    const published: World = {
      ...world,
      contents: contents.filter((entry) => carried.has(entry.id)),
    };
    const owner = worldRow?.owner === 'system' ? SYSTEM_OWNER : userOwner(handle);
    const slug = worldRow?.slug ?? slugify(world.name);
    const encoded = await encodeObject(
      context.library.layout,
      owner,
      WORLD_SCHEMA,
      slug,
      published,
    );
    const folder = folders.take(
      LIBRARY_DIRECTORIES[WORLD_SCHEMA],
      worldSurvey === null ? slug : basename(worldSurvey.folder),
      world.name,
    );
    // ***Always `worlds/`, never `packages/`*** — [P16 §1.1]: the kind's
    // folder is its current name, and a World still stored under the old one
    // is published as what it is now, `world/1`, `world.json`.
    const prefix = `library/${LIBRARY_DIRECTORIES[WORLD_SCHEMA]}/${folder}`;
    const file = `${prefix}/${OBJECT_FILENAMES[WORLD_SCHEMA]}`;
    worldMembers.push({ name: file, bytes: encoded.bytes });
    if (worldSurvey !== null) {
      const label = { id: world.id, name: world.name };
      worldMembers.push(
        ...(await readCopies(
          [...worldSurvey.assets]
            .sort((one, two) => compare(one.base, two.base))
            .map((asset): Copy => ({
              name: `${prefix}/assets/${asset.base}`,
              path: asset.path,
              size: asset.size,
              addressed: addressedHex(asset.base),
              missing: note('publish.file.pictureMissing', 'info', { ...label, ref: asset.ref }),
              damaged: note('publish.file.pictureDamaged', 'warn', { ...label, ref: asset.ref }),
            })),
          limits.maxEntryBytes,
          omitted,
        )),
      );
      for (const ref of worldSurvey.missing) {
        omitted.push(note('publish.file.pictureMissing', 'info', { ...label, ref }));
      }
      for (const big of worldSurvey.tooLarge) {
        omitted.push(note('publish.file.pictureTooLarge', 'warn', { ...label, ...big }));
      }
    }
    worldEntry = {
      schema: WORLD_SCHEMA,
      id: world.id,
      name: world.name,
      folder: prefix,
      file,
      contentHash: encoded.contentHash,
      member: false,
      description: typeof world.description === 'string' ? world.description : '',
    };
  }

  // ── The manifest, and the exact answer ──
  const manifest: WorldFileManifest = {
    schema: WORLD_FILE_SCHEMA,
    exportedBy,
    origin: plan.origin,
    world: worldEntry,
    objects: objectRows,
    sessions: sessionRows,
    leftBehind,
    requires: mergeRequires(plan.requires, world?.requires ?? null),
    history: plan.history,
    omitted,
  };
  const manifestBytes = encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
  if (manifestBytes.length > WORLD_FILE_MANIFEST_MAX_BYTES) {
    return { refusal: 'manifest-too-large' };
  }

  const members: PlannedMember[] = [
    { name: WORLD_FILE_MANIFEST, bytes: manifestBytes },
    ...worldMembers,
    ...objectMembers,
    ...sessionMembersPlanned,
  ];
  const sizes = members.map((member) => ({ name: member.name, size: sizeOf(member) }));
  const exact = storedZipRefusal(sizes, limits);
  if (exact !== null) return { refusal: refusalOf(exact) };
  const bytes = storedZipBytes(sizes);

  return { manifest, members, entries: members.length, bytes, notes: omitted, mtime: at, limits };
}

/**
 * ***Write a planned file to `to`*** — every file re-read and re-hashed as it
 * goes in, against what the plan saw. A file that has changed, or gone,
 * throws {@link WorldFileChangedError} from inside the member source, and the
 * zip writer removes its `.part` on the way out: **an edit during a publish
 * fails it whole** ([P16.3]'s plan, risk 6), and leaves no file.
 */
export async function writeWorldFile(
  planned: PlannedWorldFile,
  to: string,
): Promise<{ entries: number; bytes: number }> {
  return writeStoredZip(to, reread(planned.members), {
    mtime: planned.mtime,
    limits: planned.limits,
  });
}

/**
 * One member at a time, read and checked as the writer asks for it. A file
 * whose size is not the one the plan read is refused by `stat`, before a byte
 * of it is held; a card the plan re-spliced is re-spliced the same way, and
 * the result held to the plan's hash.
 */
async function* reread(members: readonly PlannedMember[]): AsyncGenerator<ZipMember> {
  for (const member of members) {
    if ('bytes' in member) {
      yield member;
      continue;
    }
    const held = await statFile(member.file);
    if (held?.size !== (member.card?.storedSize ?? member.size)) {
      throw new WorldFileChangedError(member.name);
    }
    const read = await readFileBytes(member.file);
    const bytes =
      read === null || member.card === undefined
        ? read
        : (cardAsCarried(read, member.card.keep) ?? read);
    if (bytes?.byteLength !== member.size || digestOf(bytes) !== member.expect) {
      throw new WorldFileChangedError(member.name);
    }
    yield { name: member.name, bytes };
  }
}

/**
 * ***An object's stored file, read once and held to the row*** (2026-10-10,
 * the P16.3c review): it must hash to `row.contentHash`, or it is not the
 * body that chose its pictures, name and edges — see {@link planWorldFile}.
 * A card holding a picture no row names is planned re-spliced.
 */
async function readStored(
  row: IndexedObject,
  survey: ObjectSurvey,
  stored: string,
  limit: number,
): Promise<PlannedMember & { file: string; expect: string }> {
  const source = await readFileBytes(row.path);
  if (source === null || source.byteLength > limit || digestOf(source) !== row.contentHash) {
    throw new WorldFileChangedError(stored);
  }
  if (survey.card === null) {
    return { name: stored, file: row.path, size: source.byteLength, expect: digestOf(source) };
  }
  const carried = cardAsCarried(source, survey.card.keep) ?? source;
  return {
    name: stored,
    file: row.path,
    size: carried.byteLength,
    expect: digestOf(carried),
    card: { keep: survey.card.keep, storedSize: source.byteLength },
  };
}

function refusalOf(refusal: 'too-many-entries' | 'archive-too-large'): WorldFileRefusal['refusal'] {
  return refusal === 'too-many-entries' ? 'too-many-files' : 'too-large';
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function limitsOf(context: WorldFileContext): ZipWriteLimits {
  return context.limits ?? DEFAULT_ZIP_WRITE_LIMITS;
}

/**
 * Each copy read once and hashed: kept when it is what the plan expected,
 * noted and dropped when it is a picture or a version that went or does not
 * match its own name. (The object's own file is {@link readStored}'s, whose
 * absence is the object changing rather than a picture missing.)
 */
async function readCopies(
  copies: readonly Copy[],
  limit: number,
  omitted: ImportNote[],
): Promise<(PlannedMember & { file: string; expect: string })[]> {
  const out: (PlannedMember & { file: string; expect: string })[] = [];
  for (const copy of copies) {
    const bytes = await readFileBytes(copy.path);
    if (bytes === null || bytes.byteLength > limit) {
      omitted.push(copy.missing);
      continue;
    }
    const expect = digestOf(bytes);
    /**
     * ***A content-addressed name the bytes do not match is a damaged file***,
     * and the reader verifies each picture against its name (P16.3e): carried,
     * it would be refused on arrival. So it stays home, named — never fatal,
     * since nothing a person did between plan and write made it so, and a
     * publish that could never succeed is not a refusal anybody can act on.
     */
    if (copy.addressed !== null && expect !== `sha256:${copy.addressed}`) {
      omitted.push(copy.damaged);
      continue;
    }
    out.push({ name: copy.name, file: copy.path, size: bytes.byteLength, expect });
  }
  return out;
}

/**
 * ***Folder names inside the file, each kind's distinct.*** Case-folded and
 * NFC-normalised for the comparison, so the file extracts to the same tree on
 * a filesystem that folds case (macOS, Windows) as on one that does not.
 */
class FolderNames {
  readonly #taken = new Set<string>();

  take(kindDirectory: string, wanted: string, name: string): string {
    const usable = (folder: string): boolean =>
      folder !== '' && zipNameRefusal(`library/${kindDirectory}/${folder}/x`) === null;
    const base = usable(wanted) ? wanted : usable(slugify(name)) ? slugify(name) : 'object';
    for (let n = 1; ; n += 1) {
      const candidate = n === 1 ? base : `${base}-${String(n)}`;
      const key = `${kindDirectory}/${candidate.normalize('NFC').toLowerCase()}`;
      if (this.#taken.has(key)) continue;
      this.#taken.add(key);
      return candidate;
    }
  }
}

/** Members first, the plan's order kept within each half, each id once. */
function membersFirst(objects: PublishPlan['objects']): PublishPlan['objects'] {
  const seen = new Set<string>();
  const once = objects.filter((one) => {
    if (seen.has(one.id)) return false;
    seen.add(one.id);
    return true;
  });
  return [...once.filter((one) => one.member), ...once.filter((one) => !one.member)];
}

/**
 * What phase one would put in the file beside the manifest and `world.json`,
 * as names and sizes — for the early refusal.
 */
function surveyedMembers(
  surveys: readonly { survey: ObjectSurvey }[],
  world: ObjectSurvey | null,
  sessions: readonly SessionSurvey[],
): { name: string; size: number }[] {
  const sizes: { name: string; size: number }[] = [];
  for (const { survey } of surveys) {
    // Names here are only for their length, and a folder is at most what the
    // index holds, so the survey's own folder name is a fair stand-in.
    const prefix = `library/${LIBRARY_DIRECTORIES[survey.schema]}/${basename(survey.folder)}`;
    sizes.push({
      name: `${prefix}/${OBJECT_FILENAMES[survey.schema]}`,
      size: survey.file?.size ?? 0,
    });
    for (const asset of survey.assets)
      sizes.push({ name: `${prefix}/assets/${asset.base}`, size: asset.size });
    const index = survey.history.index;
    if (index !== null) sizes.push({ name: `${prefix}/history/index.jsonl`, size: index.length });
    for (const file of survey.history.files)
      sizes.push({ name: `${prefix}/${file.relative}`, size: file.size });
  }
  if (world !== null) {
    for (const asset of world.assets)
      sizes.push({ name: `library/worlds/x/assets/${asset.base}`, size: asset.size });
  }
  for (const session of sessions) {
    sizes.push({
      name: `sessions/${session.id}/${WORLD_FILE_SESSION_EXPORT}`,
      size: session.size,
    });
    for (const one of [...session.pictures, ...session.attachments]) sizes.push(one);
  }
  return sizes;
}

function sizeOf(member: PlannedMember): number {
  return 'bytes' in member ? member.bytes.length : member.size;
}

/** The hex a `<sha256>.<ext>` or `<sha256>.json` name claims, or null for any other name. */
function addressedHex(name: string): string | null {
  return /^([0-9a-f]{64})\.[a-z0-9]+$/.exec(name)?.[1] ?? null;
}

function namesId(edges: readonly { ref: { id: string | null } }[], id: string): boolean {
  return edges.some((edge) => edge.ref.id === id);
}

function note(key: string, level: ImportNote['level'], params: ImportNote['params']): ImportNote {
  return { key, level, params };
}

function isWorld(schema: string): boolean {
  return schema === WORLD_SCHEMA || schema === LEGACY_PACKAGE_SCHEMA;
}

/**
 * The member name a row's stored file would have, before folder names are
 * settled — what an error may name instead of a path on disk ([22 §4.1]).
 */
function memberNameOf(row: IndexedObject): string {
  const schema = row.schemaId as PortableSchemaId;
  return `library/${LIBRARY_DIRECTORIES[schema]}/${basename(dirname(row.path))}/${OBJECT_FILENAMES[schema]}`;
}

/** A stored World is validated, but `contents` is also read from hand-edited files. */
function listOf<T>(value: readonly T[] | undefined): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

function uniqueById<T extends { id: string }>(entries: readonly T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (typeof entry.id !== 'string' || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/** Code-unit order: the same on every machine, unlike `localeCompare`. */
function compare(one: string, two: string): number {
  return one < two ? -1 : one > two ? 1 : 0;
}
