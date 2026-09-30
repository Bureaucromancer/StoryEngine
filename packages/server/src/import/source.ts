// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportItemReport, ImportNote } from '@storyengine/shared';

import type { ScratchSpace } from '../storage/import-scratch.js';

/**
 * The seam the whole import phase is built on, and the one thing P4.0 exists to
 * get right before anything is written on top of it
 * ([P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **The unit is a candidate, not a file.** The plan originally said "one sweep
 * engine over an abstract file source with two adapters — a local-path walker
 * and an uploaded batch", which quietly assumes one file yields zero or one
 * object. That is true of SillyTavern, where the tree *is* the library: one PNG
 * is one character, one JSON is one world. It is false of Marinara, whose
 * library is a relational store — `characters.json` holds every character at
 * once, and an actor is a join across four tables and a file under `avatars/`
 * ([survey §1](../../../../docs/design/01-source-survey.md)). Written as a
 * walker, the engine would have needed a second, unlike path bolted on inside
 * the stage that depends on it most.
 *
 * So the seam sits one level up. A **reader** opens a root and yields items; a
 * **file source** is what it reads through, and is where the transport lives —
 * a local path, an uploaded batch, an archive. The SillyTavern reader is the
 * degenerate one-candidate-per-file case, and that is the check on the
 * abstraction: **if the ST path gets more complicated in order to accommodate
 * Marinara, the seam is in the wrong place.**
 *
 * Converters stay ignorant of all of it. A card converter is handed a card; it
 * never learns whether the bytes came from a PNG on disk, a row in a JSON table,
 * or an entry in a zip.
 */

/**
 * Bytes, addressed by a path relative to the root.
 *
 * **An interface rather than the filesystem, and the lint rule agrees**:
 * `node:fs` is confined to `server/src/storage`, so an import module that
 * touched it directly would not build. What looks like an abstraction for
 * testing is the boundary the project already draws — and it is why an uploaded
 * batch and a zip entry cost a class each rather than a second engine.
 *
 * Every path is relative, `/`-separated, and never escapes the root: an
 * implementation is responsible for refusing `..` and symlinks that leave, the
 * way `layout.assertReal` does for our own tree. *(`DirectorySource` refused
 * the first and followed the second in `read` and `exists` until P13.1's
 * review; see its `#reach`.)*
 */
export interface FileSource {
  /**
   * Every file under the root, relative, recursively.
   *
   * An async iterable because a real SillyTavern tree is years of data and a
   * sweep that materialises the list before starting has already lost. Order is
   * not guaranteed; a reader that needs one sorts what it kept.
   */
  list(): AsyncIterable<string>;

  /** Bytes at a relative path, or `null` when it is missing or unreadable. */
  read(path: string): Promise<Uint8Array | null>;

  /**
   * Whether something exists at a relative path.
   *
   * Separate from `read` because detection asks about *shape* — is there a
   * `storage/tables/` here — and answering that by reading a directory's bytes
   * would be a strange question to ask a zip.
   */
  exists(path: string): Promise<boolean>;

  /**
   * ***The file's real, absolute path on this machine, when it has one*** —
   * [P13 §1.3](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   * `null` when the path is missing, is not a regular file, or would leave the
   * root or enter our data directory by any spelling, links included.
   *
   * **Optional, because only a local directory has one.** An upload, a zip
   * entry and a Marinara envelope are bytes with a name; there is no file
   * under them to point at, and making each of them answer `null` would make
   * every new transport restate a method whose only honest answer is *no*.
   *
   * ***So the method's absence and its `null` mean different things***, and a
   * reader must not treat them alike — corrected at review, 2026-09-29, when
   * this said *"asks with `realPath?.()` and falls back to `read`"*.
   * **Absent** — `source.realPath === undefined` — is a transport with no
   * disk under it, and `read` is how that source is read. **`null` from a
   * source that has the method** is a refusal of *that path*, and is final:
   * the path leads out of the root or into our data directory, or is not a
   * file. Reading the same path again through `read` would ask a second door
   * the question the first one just answered — and until `DirectorySource`'s
   * `read` checked where a link leads (the same review), that second door
   * returned the bytes of our own operational store through a link the first
   * had refused.
   *
   * **It exists for SQLite**, which opens a path rather than a byte array:
   * `storage/sqlite-snapshot.ts` copies a database somebody else may be
   * writing with `VACUUM INTO` from the real file, which is consistent and
   * never holds the file in memory, where `read` is capped at 64 MB and a copy
   * of the bytes is torn by whatever was written while it was taken. A path
   * given out here is followed by something that is not us, which is why the
   * implementation checks where it really leads rather than how it is spelled.
   */
  realPath?(path: string): Promise<string | null>;

  /**
   * ***The file, landed on our own disk, and handed over*** —
   * [P13.8](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * `realPath`'s counterpart for a source whose file is **ours** rather than
   * somebody else's: an upload that was streamed into the import scratch root
   * rather than held in memory, or an entry of an archive landed there. The
   * answer is a scratch space of its own with the file in it under `name`, and
   * **the space is the caller's from here** — the snapshot's `owned` input,
   * which keeps it or disposes of it. A `<path>-wal` the source also holds is
   * landed beside it as `<name>-wal`, since the file without its log is an
   * older database that looks whole ([P13 §1.2]).
   *
   * `null` when the path is not there, or is not what the source said it was
   * — an archive entry that will not inflate to its declared size — or its
   * log is named and could not be landed. Final, as `realPath`'s is: a reader
   * does not then ask `read`, which for a landed upload holds nothing.
   *
   * **Optional, and asked after `realPath`**: a source with a real path has
   * no reason to make a copy of its own when the snapshot will make one. It
   * exists for SQLite, as `realPath` does, and throws what landing throws —
   * no room above all (`SnapshotSpaceError`, a `507`).
   */
  land?(path: string): Promise<LandedFile | null>;
}

/** A file in a scratch space whose ownership has passed to whoever holds this. */
export interface LandedFile {
  space: ScratchSpace;
  /** The file's name inside the space. */
  name: string;
}

/** Which source a root turned out to be. Open by intent — a new source adds an arm. */
export type ImportSourceKind =
  | 'sillytavern'
  | 'marinara'
  | 'marinara-archive'
  | 'marinara-envelope'
  /** The V3 spec's zip container: one `card.json`, and its assets beside it. */
  | 'charx'
  /** A directory of files somebody assembled by hand. The walker's plain mode. */
  | 'loose-files'
  /**
   * ***One of ours*** — [P12.8](../../../../docs/design/workplan/29-p12-implementation.md).
   *
   * The only arm here that is not somebody else's format, and the reader for it
   * is the only one that converts nothing: it decides what it is looking at and
   * refuses what it cannot vouch for. It is an arm rather than a separate
   * engine because *"an archive is a root read through a different file
   * source"* is as true of ours as of a CHARX, and everything downstream — the
   * conflict policy, the review vocabulary, the job ledger — is the same work.
   */
  | 'storyengine-backup'
  /**
   * ***A whole Aventuras install: one SQLite file*** —
   * [P13 §1.1](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * One arm for four transports — the config directory by server path, an
   * unzipped backup uploaded as a folder, the backup zip, a bare `aventura.db`
   * — because every one of them arrives at the same thing: a root with
   * `aventura.db` in it. [P12.8]'s *an archive is a root read through a
   * different file source* again, and the reason the reader never asks which.
   */
  | 'aventuras';

/**
 * Why a root was refused **before anything was written**.
 *
 * All three are pre-flight ([P4 §1.3]). A poisoned *file* is not here: one bad
 * file never aborts a sweep — it is one `warn` row in the review and the sweep
 * completes around it, which is F22's original sin pre-paid and not repeated.
 */
export type SourceRefusal =
  /**
   * A running Marinara, or one part-way through its shard migration. It saves on
   * a 750 ms debounce and marks itself with `.writer-lease`; a store mid-migration
   * carries `.migrating`. Reading either produces a torn library, and it does it
   * *quietly*, which is why this refuses rather than warns.
   */
  | 'live-install'
  /**
   * A storage format this build does not know. Marinara's own store refuses to
   * open a format newer than it knows, and that is the posture to copy rather
   * than improve on: a best-effort parse of a layout we have not seen produces
   * a plausible, wrong library.
   */
  | 'unknown-format'
  /** Two probes matched. Never guessed — a wrong guess converts through the wrong tables. */
  | 'ambiguous-root'
  /** Nothing readable at the path at all. */
  | 'unreadable-root';

/** What a reader says about a root before it reads it. */
export type SourceSurvey =
  | { ok: true; kind: ImportSourceKind; notes: readonly ImportNote[] }
  | { ok: false; refusal: SourceRefusal; notes: readonly ImportNote[] };

/**
 * One thing a converter can act on.
 *
 * `format` rather than a library kind, because what a reader knows is *what it
 * found* — an ST V2 card, a Marinara character row — and choosing the converter
 * is the next stage's job. Keeping the two apart is what lets Marinara's card
 * path be a redirection into the SillyTavern one rather than a copy of it: both
 * arrive here as candidates, and the same converter answers both.
 */
export interface ImportCandidate {
  /** Source-relative name, which becomes `Provenance.originalFilename`. */
  source: string;
  /** What the reader recognised, e.g. `sillytavern.card` or `marinara.character`. */
  format: string;
  /** Whatever that format's converter expects. Opaque to the engine. */
  payload: unknown;
  /** Files to carry with the object, source-relative — a portrait, a CHARX asset. */
  assets?: readonly string[];
  /**
   * ***Bytes the reader already holds, keyed like `assets`*** —
   * [P13 §1.6](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * **For a picture that was never a file.** Every reader before the
   * Aventuras one found its pictures beside the object — a PNG in a folder, an
   * entry in a zip — so naming the path was enough and the Writer read it
   * through the file source. An Aventuras portrait is a column: a data URL in
   * `character_vault.portrait`, inside a database that is itself one file. The
   * reader decodes it, and there is no path under the root that would give the
   * Writer those bytes, so the reader hands them over here under the name it
   * put in `assets`. The Writer asks this map first and the file source second.
   *
   * *The bytes are still sniffed, not trusted* — the Writer decides what they
   * are exactly as it would for a file; all this changes is where they came
   * from. A reader should key them under a name no file in its root can have
   * (the Aventuras reader uses a path beneath `aventura.db`, which is a file),
   * so a key missing from the map can never fall through to somebody's file.
   */
  inline?: ReadonlyMap<string, Uint8Array>;
  /**
   * ***What the reader noticed about this candidate before any converter saw
   * it*** — [P13.3](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * A reader that works from rows rather than files can meet a problem with
   * one field of an object that is otherwise fine: a JSON column that will
   * not parse, a portrait too large to carry. Refusing the object over it
   * would cost a character its whole self for one field, and saying nothing
   * would be the silent drop this seam exists to prevent. So the reader reads
   * around the field and says so here, and the Writer puts these first among
   * the notes of whatever row the candidate becomes — for every format, so a
   * reader that sets them cannot find an arm that drops them.
   */
  notes?: readonly ImportNote[];
}

/**
 * Everything a reader saw, in one stream.
 *
 * **One stream rather than two** — candidates here and observations there —
 * because *nothing is silently dropped* is a property of a single pass. Two
 * iterables that each walk the root make the claim a matter of remembering to
 * report in both, which is the kind of promise that quietly stops being true.
 */
export type SourceItem =
  | { outcome: 'candidate'; candidate: ImportCandidate }
  | { outcome: 'observed'; report: ImportItemReport };

/** A source read as a sequence of items. Three implementations, one shape. */
export interface SourceReader {
  readonly kind: ImportSourceKind;

  /**
   * Decided before `items()` is called, and the sweep does not start if this
   * refuses. Separate for exactly that reason: a refusal after the first object
   * is written is a half-import, which is worse than no import.
   */
  survey(): Promise<SourceSurvey>;

  items(): AsyncIterable<SourceItem>;

  /**
   * ***Lets go of whatever the reader holds*** —
   * [P13.2](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * **Optional, because until the Aventuras reader no reader held anything.**
   * Every other one reads through its file source and keeps nothing a garbage
   * collector will not take back. The Aventuras reader holds a private copy of
   * somebody's database in our scratch — a file the size of their whole
   * install — and an open SQLite handle on it, and neither is memory: a copy
   * nobody removes stays on the data volume until the next start sweeps it,
   * and on Windows an open handle is a file that cannot be removed at all.
   *
   * **Whoever constructs a reader calls this, however the reading ended** — a
   * survey that refused, items that were read to the end, items that threw
   * half way. `sweep()` is the one caller today. It must be safe to call more
   * than once, and after a survey that refused — which lets go by itself, so
   * that path leaks nothing even for a caller that forgot.
   *
   * *A `close()` that throws does not cost the caller its answer* (P13.3):
   * by then the reading may have written objects, and the report of them is
   * worth more than the exception. `sweep()` logs it and returns the report.
   */
  close?(): Promise<void>;
}
