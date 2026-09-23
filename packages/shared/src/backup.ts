// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from './import.js';

/**
 * ***What an archive says it is*** —
 * [25 E6](../../../docs/design/25-open-questions.md),
 * [P12](../../../docs/design/workplan/29-p12-implementation.md).
 *
 * The first member of every backup archive, and the reason a reader can answer
 * *what am I holding* without inflating the rest of it: a listing, an import
 * preview and a restore's precondition check all need the answer before they
 * need the bytes.
 *
 * ***A plain interface with a hand-written reader***, which is
 * `session-export.ts`'s shape rather than TypeBox's. The two export envelopes
 * this project already has are written that way and validated by
 * `readSessionExport`, and matching them matters more than reaching for the
 * schema library — what arrives here is a file somebody chose, so the type is
 * what we are trying to establish rather than what we have.
 *
 * ***Deliberately outside `PORTABLE_SCHEMAS`***, for the reason
 * `SESSION_EXPORT_SCHEMA` is: that registry holds the six library kinds and
 * `emit-schemas` writes one artefact per entry. An envelope is not an object
 * somebody edits, and a JSON Schema for it would suggest it were.
 *
 * ***It carries no path from the machine that wrote it.*** [21 §4.1]'s rule
 * about logs applies with more force to a file that travels: an absolute path
 * says where somebody's data lives, and a restore reading one back would point
 * an install at a directory that may be somebody else's. Member names are
 * relative to the data root and this record names none at all.
 */

/** The current format. Bumped when a reader would need to behave differently. */
export const BACKUP_MANIFEST_SCHEMA = 'storyengine.backup-manifest/1';

/**
 * Whose data an archive holds.
 *
 * **`account` is a strict subset of `install`**, because member names are
 * data-root-relative in both — so one reader serves both and an account archive
 * unpacks into a data directory exactly where it belongs. That is a decision
 * with a cost, and the cost is that `tools/backup.mjs restore` must refuse an
 * account archive rather than `rm -rf` a whole install for one person's tree.
 */
export type BackupScope = 'install' | 'account';

/**
 * Whether the archive carries credentials.
 *
 * ***Both exist because the two audiences are different and neither is wrong.***
 * `full` restores to a working install — `accounts.json`, the connections and
 * the session key — which is what makes it a backup rather than a partial copy.
 * `redacted` omits them, which makes it a file somebody can put in cloud
 * storage without handing over the keys to their provider account and everybody
 * on the install's password hashes.
 *
 * **A `redacted` archive restores to an install nobody can sign into**, which is
 * why the restore path refuses one unless it is told to proceed. It is the
 * right file to *keep* and the wrong file to be handed in an emergency without
 * being told.
 */
export type BackupContents = 'full' | 'redacted';

/** Why the backup ran. `start` is the *also on every server start* switch. */
export type BackupReason = 'manual' | 'schedule' | 'start';

export interface BackupManifest {
  schema: typeof BACKUP_MANIFEST_SCHEMA;
  scope: BackupScope;
  /** The account an `account` archive holds. Null for an `install` one. */
  handle: string | null;
  contents: BackupContents;
  /**
   * What wrote it. **Not for deciding whether to load** — that is `schema`'s —
   * but for the sentence a restore shows before it replaces an install, where
   * *taken by a newer build than this one* is worth reading first.
   */
  takenBy: { version: string | null; at: string };
  reason: BackupReason;
  /** Members, excluding this manifest. */
  files: number;
  /**
   * Their uncompressed total.
   *
   * Here rather than computed by a reader because a restore has to check free
   * disk **before** it commits, and the only other way to know is to inflate the
   * archive — which is the thing being checked for room.
   */
  unpackedBytes: number;
  /**
   * The handles the archive holds, so an install import can plan per account
   * without a pass over every member first.
   */
  handles: string[];
  /**
   * ***What this archive does not carry, and why.***
   *
   * In the `{ key, params }` vocabulary the import review uses rather than
   * prose, for [01 §2]'s reason and the localisation catalogue's: the server
   * emits classes and the client renders sentences. `export/writers.ts` already
   * answers *what this file does not carry* this way, and an archive owes the
   * same answer — a person handed a `redacted` file should be able to read what
   * was left out of it rather than discover it during a restore.
   */
  omitted: ImportNote[];
}

/**
 * The manifest a document claims to be, or why it is not one.
 *
 * ***`{ refusal }` where `readSessionExport` answers `{ reason }`***, and the
 * difference is forced rather than stylistic: a manifest **has** a `reason`
 * field of its own — why the backup ran — so `'reason' in manifest` would
 * discriminate nothing and every caller would narrow to `never`. Found by the
 * compiler on the first caller. `refusal` is the vocabulary `storage/zip.ts`
 * and `import/source.ts` already use for *why this will not be read*, so the
 * collision resolves toward the more consistent word rather than away from it.
 *
 * Otherwise `readSessionExport`'s shape exactly, including the narrowing
 * through
 * `Record<string, unknown>` rather than `Partial<BackupManifest>` — the partial
 * would make every guard below unnecessary to the type checker, which would be
 * right about the type and wrong about the world.
 *
 * ***The checks are the fields a caller acts on before it trusts anything.***
 * A restore branches on `scope` and `contents` and sizes a disk from
 * `unpackedBytes`; an import branches on `handles`. A manifest missing one of
 * those is not a manifest this build can act on, whatever else is in it.
 * Unknown fields are carried, per [04 §2].
 */
export function readBackupManifest(document: unknown): BackupManifest | { refusal: string } {
  if (typeof document !== 'object' || document === null) return { refusal: 'unreadable' };
  const row = document as Record<string, unknown>;
  if (row['schema'] !== BACKUP_MANIFEST_SCHEMA) return { refusal: 'wrong-schema' };
  if (row['scope'] !== 'install' && row['scope'] !== 'account') return { refusal: 'unreadable' };
  if (row['contents'] !== 'full' && row['contents'] !== 'redacted')
    return { refusal: 'unreadable' };
  if (typeof row['unpackedBytes'] !== 'number') return { refusal: 'unreadable' };
  if (!Array.isArray(row['handles'])) return { refusal: 'unreadable' };
  /**
   * An `account` archive with no handle names a person it cannot identify, and
   * every caller that branches on the scope goes on to use the handle.
   */
  if (row['scope'] === 'account' && typeof row['handle'] !== 'string') {
    return { refusal: 'unreadable' };
  }
  return document as BackupManifest;
}

/**
 * The name the manifest is stored under, at the archive root.
 *
 * ***At the root and therefore inside the data directory after a restore***,
 * which is deliberate rather than tolerated: the restored install keeps a record
 * of which archive it came from, the way `state/build.json` keeps a record of
 * which build last opened the directory. It is excluded when an archive is
 * *taken*, so a manifest is always written fresh rather than being a stale copy
 * of an older one.
 */
export const BACKUP_MANIFEST_MEMBER = 'backup.json';

/**
 * How often the server takes somebody's backups for them.
 *
 * ***A frequency and an independent* also on every server start *switch, rather
 * than one list holding both*** — [P12](../../../docs/design/workplan/29-p12-implementation.md)
 * §1.4. A machine that is up for an hour and a machine that is up for a month
 * want different halves of that, and a machine that is usually up but
 * occasionally rebooted wants both; a single list can express the first two and
 * not the third.
 */
export type BackupFrequency = 'off' | 'daily' | 'weekly';

export const BACKUP_SETTINGS_SCHEMA = 'storyengine.backup-settings/1';

/**
 * One account's schedule.
 *
 * ***Validated and schema'd, which puts it on `tags.json`'s side of the line
 * `layout.ts` draws against `prefs.json`***: the preferences file is
 * deliberately a bag the server does not interpret, and this is a document the
 * server reads on a timer and acts on. A setting that decides whether a file
 * gets written to somebody's disk is not a preference.
 *
 * **Absent means everything off**, so an account that has never opened the
 * panel costs nothing and no migration is owed to one created before this
 * existed.
 */
export interface BackupSettings {
  frequency: BackupFrequency;
  onStart: boolean;
  contents: BackupContents;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  frequency: 'off',
  onStart: false,
  contents: 'full',
};

/** How long a frequency waits, in milliseconds. `off` is null. */
export function backupIntervalMs(frequency: BackupFrequency): number | null {
  if (frequency === 'daily') return 24 * 60 * 60 * 1000;
  if (frequency === 'weekly') return 7 * 24 * 60 * 60 * 1000;
  return null;
}
