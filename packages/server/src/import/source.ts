// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportItemReport, ImportNote } from '@storyengine/shared';

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
 * way `layout.assertReal` does for our own tree.
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
  | 'loose-files';

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
}
