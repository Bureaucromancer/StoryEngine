// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { relative } from 'node:path';

import type { BackupManifest } from '@storyengine/shared';

import { writeJsonAtomic } from '../storage/atomic.js';
import { freeBytes } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { readTarGz } from '../storage/tar-archive.js';

import { readArchiveManifest } from './archive.js';

/**
 * ***Putting an archive back as the install*** —
 * [25 E6](../../../../docs/design/25-open-questions.md),
 * [P12.11](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***A running server cannot replace its own data directory in place***, and
 * that is not a limitation to work around but the shape of the feature. It
 * holds open sqlite handles on files the archive would overwrite, and the
 * session key it would replace is the one validating the request asking for
 * this. So the restore is real and it is **not in-place**: it is a handoff
 * across a restart, and every piece of it already exists — `beginRestart`'s
 * drain, a marker file, and a boot that reads one ([P12.12]).
 *
 * ***This module is the half that runs while the server is still up, and every
 * precondition lives here for one reason: a refusal after the process has
 * exited is a refusal nobody can read.*** An admin who clicked restore and got
 * a dead process and a log line they cannot reach has been handed the exact
 * situation [09 §6.4] refuses to create for a plain restart. So the archive is
 * read end to end, its scope is checked, its redaction is confirmed and the
 * disk is measured — all before anything is written and long before anything
 * drains.
 */

export type RestoreRefusal =
  /** Not a gzip, not a tar, or no manifest of ours at the head of it. */
  | 'unreadable'
  /** An `account` archive. A person's subtree is not a whole install. */
  | 'wrong-scope'
  /** A member name that would escape the data root when written out. */
  | 'unsafe-path'
  /** `redacted`, and the body did not say it meant it. */
  | 'needs-confirmation'
  /** Less free space than the archive unpacks to, plus a margin. */
  | 'no-space';

/**
 * What the marker says, and what the next boot acts on.
 *
 * ***`archive` is data-root-relative***, per [21 §4.1]'s foreign-path doctrine
 * and for a second reason of its own: the absolute path contains the data
 * directory, which is the one thing about to be renamed. A relative name still
 * resolves against whichever directory the marker is read from.
 */
export interface RestorePlan {
  archive: string;
  manifest: BackupManifest;
  /** Who asked, for the log and for the notice raised on the next boot. */
  requestedBy: string;
  at: string;
  /**
   * ***How many times a boot has tried and failed to act on this.***
   *
   * **A second attempt refuses outright**, which is the whole of the
   * restart-loop defence: a supervisor restarts a process that exits, so an
   * unpack that fails and leaves the marker in place would restart forever,
   * and a bad archive would take the install down rather than one boot.
   */
  attempts: number;
}

/**
 * ***The margin over `unpackedBytes`, and why it is a fraction rather than a
 * constant.***
 *
 * The archive's own bytes are already on this disk and stay there through the
 * swap — the previous directory is moved aside and **not deleted** — so a
 * restore genuinely needs room for a second copy of the data, not for a
 * difference. Ten per cent over covers the filesystem's own overhead for a few
 * thousand small files, which is where a directory of library objects spends
 * space that `unpackedBytes` does not count.
 */
export const RESTORE_HEADROOM = 1.1;

export interface RestoreRequest {
  /** The archive, by absolute path — the caller resolved it against a listing. */
  path: string;
  requestedBy: string;
  /** Somebody said out loud that an install nobody can sign into is intended. */
  acceptRedacted?: boolean;
}

export type RestorePreparation =
  { ok: true; plan: RestorePlan } | { ok: false; refusal: RestoreRefusal };

/**
 * Checks everything, then writes the marker. Nothing here drains.
 *
 * **The order is deliberate**: the cheap and certain refusals first, the full
 * read of the archive last but still before the marker, and the marker last of
 * all — so a request that is going to be refused never leaves a file behind
 * that a boot would act on.
 */
export async function prepareRestore(
  layout: Layout,
  request: RestoreRequest,
): Promise<RestorePreparation> {
  const manifest = await readArchiveManifest(request.path);
  if (manifest === null) return { ok: false, refusal: 'unreadable' };

  /**
   * ***An account archive is refused rather than restored into an install.***
   * Member names are data-root-relative in both scopes, so an account archive
   * *would* unpack into the right place — and a restore replaces the directory,
   * so what would land is one person's tree and **nothing else**: every other
   * account, the settings and the operational store gone. `tools/backup.mjs
   * restore` refuses it for the same reason, and this is that refusal reaching
   * the surface that a person can click.
   */
  if (manifest.scope !== 'install') return { ok: false, refusal: 'wrong-scope' };

  /**
   * ***A redacted archive restores to an install nobody can sign into.***
   * `accounts.json`, the session key and every connection are omitted from one
   * by design, which is what makes it safe to store elsewhere and exactly what
   * makes it the wrong thing to restore by accident. A confirmation rather than
   * a refusal, because it is a legitimate thing to want — a fresh install
   * carrying everybody's work, set up again from scratch.
   */
  if (manifest.contents === 'redacted' && request.acceptRedacted !== true) {
    return { ok: false, refusal: 'needs-confirmation' };
  }

  /**
   * ***Read end to end, and this is the expensive check earning its place.***
   *
   * A truncated archive is the realistic failure — a copy that ran out of
   * space, a download that stopped — and it is invisible from the manifest,
   * which is the first member and therefore the part that always survives.
   * Finding out half way through the unpack is finding out after the old
   * directory has been renamed aside. This costs one inflate of an archive the
   * admin is about to restore anyway, and it is the only way to know.
   */
  const scanned = await scanArchive(request.path, manifest);
  if (!scanned.ok) return scanned;

  const free = await freeBytes(layout.dataRoot);
  /**
   * **A filesystem that will not answer is not a refusal.** `statfs` is missing
   * on some platforms, and refusing a restore because we could not measure the
   * disk would make an unanswerable question into a permanent no.
   */
  if (free !== null && free < manifest.unpackedBytes * RESTORE_HEADROOM) {
    return { ok: false, refusal: 'no-space' };
  }

  const plan: RestorePlan = {
    archive: relative(layout.dataRoot, request.path),
    manifest,
    requestedBy: request.requestedBy,
    at: new Date().toISOString(),
    attempts: 0,
  };
  await writeJsonAtomic(layout.restorePendingFile, plan);
  return { ok: true, plan };
}

/**
 * Every header, every name, and the count the manifest claims.
 *
 * ***Containment runs on the rejoined name***, because a long member arrives as
 * a `prefix` and a `name` that a reader puts back together — so checking either
 * half would miss `..` in the other. **Refused rather than sanitised**, which
 * is `storage/zip.ts`'s posture coming the other way: silently rewriting
 * `../../x` to `x` would write a file the archive did not describe, under a
 * name nobody chose, into a directory that is about to become the install.
 */
async function scanArchive(
  path: string,
  manifest: BackupManifest,
): Promise<{ ok: true } | { ok: false; refusal: RestoreRefusal }> {
  let members = 0;
  try {
    for await (const member of readTarGz(path)) {
      const name = member.name.replaceAll('\\', '/');
      if (name === '' || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
        return { ok: false, refusal: 'unsafe-path' };
      }
      if (name.split('/').some((part) => part === '..') || name.includes('\0')) {
        return { ok: false, refusal: 'unsafe-path' };
      }
      members += 1;
    }
  } catch {
    return { ok: false, refusal: 'unreadable' };
  }

  /**
   * ***The count is the truncation check.*** The manifest is the first member
   * and says how many follow it; an archive cut short inflates cleanly up to
   * the cut and simply stops, which no other check here would notice.
   */
  if (members - 1 !== manifest.files) return { ok: false, refusal: 'unreadable' };
  return { ok: true };
}
