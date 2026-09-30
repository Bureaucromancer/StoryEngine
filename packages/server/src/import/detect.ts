// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { FileSource, ImportSourceKind, SourceRefusal } from './source.js';

/**
 * What a root is, decided by **probing it rather than by what somebody typed**
 * ([P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * The person points at a directory and the engine says what it found. That
 * matters more than it sounds: a wrong guess converts somebody's library through
 * the wrong tables and the review would report that it went fine.
 *
 * **Two probes matching refuses. No probe matching does not** — the directory is
 * swept as loose files, which is the walker's plain mode and the right answer
 * for a folder of cards somebody assembled by hand. The review names which
 * verdict a root got either way, because *"I pointed it at my Marinara folder
 * and it found four cards"* is otherwise indistinguishable from success.
 */

/** A probe: the marks that identify one source, and what it identifies it as. */
interface Probe {
  kind: ImportSourceKind;
  /** Every path must be present for the probe to match. */
  requires: readonly string[];
}

/**
 * The marks, in no particular order — order must not matter, because a probe
 * table where it does is one where adding a source can change an old answer.
 *
 * SillyTavern is identified by `settings.json` beside the two directories that
 * are the library: `characters` and `worlds`. Not by `characters` alone, which
 * a hand-assembled folder could plausibly have.
 *
 * Marinara is identified by `storage/tables/`, which is the store itself
 * ([survey §1](../../../../docs/design/01-source-survey.md)). Deliberately not
 * by `storage/manifest.json`: a manifest can be lost and is recovered from its
 * `.bak` or inferred from the tables, so requiring it would refuse a store that
 * the app itself would open.
 */
const PROBES: readonly Probe[] = [
  { kind: 'sillytavern', requires: ['settings.json', 'characters', 'worlds'] },
  { kind: 'marinara', requires: ['storage/tables'] },
  /**
   * CHARX — the V3 spec's container, one `card.json` beside an `assets/`
   * directory ([P4 §7.5]). A root, not a file, because that is what it is once
   * `ZipFileSource` has opened it: the probe cannot tell an archive from a
   * directory and does not need to.
   *
   * `assets` is deliberately not required. The spec allows a card with no
   * attachments, and an archive carrying only `card.json` is a perfectly good
   * CHARX — requiring the directory would refuse the simplest valid case, which
   * is the mistake the Marinara probe's own comment records not making about
   * `storage/manifest.json`.
   */
  { kind: 'charx', requires: ['card.json'] },
  /**
   * ***One of ours*** — [P12.8]. `backup.json` is the archive's manifest and is
   * written as its **first** member, so a probe costs one read rather than a
   * pass.
   *
   * *The name alone is the probe, and the manifest's schema is the check.*
   * `BackupReader.survey()` refuses `unknown-format` for a `backup.json` that
   * is not ours — which is the same division the Marinara probe makes between
   * *is this that kind of root* and *is it one this build can read*.
   */
  { kind: 'storyengine-backup', requires: ['backup.json'] },
  /**
   * ***A whole Aventuras install*** —
   * [P13 §1.1](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   * The database is the install: every story, every vault object, every pack,
   * tag and setting is in the one file. `metadata.json` is deliberately not
   * required, because a config directory has none — only a backup carries one
   * — and requiring it would refuse the transport that has no size ceiling.
   *
   * ***No pre-flight here, unlike Marinara's — and §1.1 said there would be
   * one.*** §1.1 puts an `aventurasPreflight` in `classifyRoot` as well as in
   * the reader's `survey()`, so that a preview and a sweep cannot disagree.
   * Every check worth making on this root is a question for SQLite about a
   * *copy* of the file, and this function cannot make one: it also answers the
   * folder plan, which holds names and no bytes at all, and `inspect`, which
   * must stay a probe; and a real database is hundreds of megabytes where a
   * directory source's `read` stops at sixty-four. What `exists` can say — the
   * name is there — is the probe itself, so the whole gate
   * (`aventuras/schema.ts`'s `aventurasPreflight`) runs in `survey()`, once,
   * on the snapshot. A preview can therefore call a root `aventuras` that the
   * sweep then refuses as `unknown-format`, which is the order the two already
   * run in for a backup whose manifest is not ours.
   */
  { kind: 'aventuras', requires: ['aventura.db'] },
];

/** The sentinels a Marinara data root carries while it is not safe to read. */
const MARINARA_LIVE_MARKS = ['storage/.writer-lease', 'storage/.migrating'] as const;

/** The highest storage format this build knows how to read. */
export const MARINARA_KNOWN_FORMAT = 4;

export type RootClassification =
  | { ok: true; kind: ImportSourceKind }
  | { ok: false; refusal: SourceRefusal; matched?: readonly ImportSourceKind[] };

/**
 * Whether the marks that identify `kind` are all present under `prefix`.
 *
 * **The prefix is the whole of what {@link near-miss} needed from this file.**
 * Detection asks *is this root a SillyTavern tree*; a near miss asks *is
 * `data/default-user` one*, and those have to be the same question or a
 * suggestion can name a folder the classifier then rejects. Exporting `PROBES`
 * instead would have put the join — and the trailing-slash hazard below — in two
 * files, which is the argument `marinaraPreflight` already makes one paragraph
 * down about pre-flights.
 *
 * `prefix` is relative, `/`-separated, with **no leading and no trailing
 * slash**, or `''` for the root itself. Both hazards are real rather than
 * theoretical, and they break in opposite directions: `MemoryFileSource` finds
 * nothing under `'storage/tables/'` where a real directory answers `true`, and a
 * leading `/` inverts the two adapters — memory strips it and finds the file,
 * `DirectorySource` resolves outside its root and returns `false`. A test that
 * used the wrong one would pass.
 *
 * Adding an arm to `PROBES` gives near-miss a new mark set for free but no new
 * prefixes: the places worth looking are that module's own table, extended by
 * hand.
 */
export async function probeMarks(
  files: Pick<FileSource, 'exists'>,
  kind: ImportSourceKind,
  prefix = '',
): Promise<boolean> {
  const probe = PROBES.find((candidate) => candidate.kind === kind);
  if (probe === undefined) return false;
  for (const mark of probe.requires) {
    if (!(await files.exists(prefix === '' ? mark : `${prefix}/${mark}`))) return false;
  }
  return true;
}

/**
 * Which source this root is, or why it will not be read.
 *
 * The Marinara refusals live here rather than in its reader because they are
 * decisions about *whether to start*, and the whole point of the pre-flight
 * survey is that nothing is written before it answers.
 */
export async function classifyRoot(files: FileSource): Promise<RootClassification> {
  const matched: ImportSourceKind[] = [];
  for (const probe of PROBES) {
    if (await probeMarks(files, probe.kind)) matched.push(probe.kind);
  }

  if (matched.length > 1) {
    return { ok: false, refusal: 'ambiguous-root', matched };
  }

  const kind = matched[0];
  if (kind === undefined) {
    // Not a refusal. A directory of loose cards is a thing people have, and
    // sweeping it is the walker's plain mode.
    return { ok: true, kind: 'loose-files' };
  }

  if (kind === 'marinara') {
    const refusal = await marinaraPreflight(files);
    if (refusal !== null) return { ok: false, refusal };
  }

  return { ok: true, kind };
}

/**
 * The reasons a Marinara root is refused **before anything is written**.
 *
 * One implementation, called from two places: the classifier reaches it so a
 * root is refused as early as possible, and the reader's own `survey()` reaches
 * it so a reader constructed directly cannot skip the check. Two copies of a
 * pre-flight is one copy that eventually stops matching.
 */
export async function marinaraPreflight(files: FileSource): Promise<SourceRefusal | null> {
  for (const mark of MARINARA_LIVE_MARKS) {
    if (await files.exists(mark)) return 'live-install';
  }
  const format = await readMarinaraFormat(files);
  // An unreadable or absent manifest is not a refusal: the store recovers one
  // from its `.bak` or infers it, so requiring it would refuse a directory the
  // app itself would open. A manifest that *states* a version we do not know is
  // a different thing, and stops us.
  return format !== null && format > MARINARA_KNOWN_FORMAT ? 'unknown-format' : null;
}

/**
 * The storage format a Marinara root declares, or `null` if it does not.
 *
 * **The manifest states the version and cannot be trusted for the layout** —
 * Marinara's own comment records that a crash between the shard migration and
 * its first flush leaves sharded data under a version-2 manifest. So this is
 * read for the version gate only; whether a table is a file or a directory of
 * shards is a question for the filesystem, asked per table by the reader.
 */
export async function readMarinaraFormat(files: FileSource): Promise<number | null> {
  const bytes = await files.read('storage/manifest.json');
  if (bytes === null) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const version = (parsed as { version?: unknown }).version;
    return typeof version === 'number' ? version : null;
  } catch {
    return null;
  }
}
