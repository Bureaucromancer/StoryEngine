// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { join } from 'node:path';

import { uuidv7, type BackupManifest } from '@storyengine/shared';

import { writeJsonAtomic } from '../storage/atomic.js';
import { freeBytes, readFileBytes, removeTree, unlinkFile } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { readTarGz, unpackTarGz } from '../storage/tar-archive.js';

import { readArchiveManifest } from './archive.js';
import {
  completeSwap,
  KEPT_LIVE,
  readJournal,
  SWAP_JOURNAL_SCHEMA,
  swapPaths,
  type SwapJournal,
  type SwapOptions,
} from './swap.js';

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

  /**
   * ***Forward slashes on every platform***, through the layout's own
   * conversion. `path.relative` separates with a backslash on Windows, and the
   * marker is a record read back by string: split on `/` at the swap, shown in
   * the notice, logged. Outside the root it is not an archive this install can
   * name, whatever it holds.
   */
  const archive = layout.portablePath(request.path);
  if (archive === null) return { ok: false, refusal: 'unreadable' };

  const plan: RestorePlan = {
    archive,
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
      /**
       * ***Nor anything the swap keeps live***: the install's archives,
       * anybody's own, and the swap's own directory. No archive this build
       * writes carries them, and one that did would land on the archives the
       * restore exists to leave alone.
       */
      if (keptLive(name)) return { ok: false, refusal: 'unsafe-path' };
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

/** Whether a member name lands on something a swap never replaces. */
function keptLive(name: string): boolean {
  const [top] = name.split('/');
  return KEPT_LIVE.has(top ?? '') || /^users\/[^/]+\/backups(\/|$)/.test(name);
}

/**
 * What a boot did about a pending restore, for the one place that can say so.
 *
 * ***Returned rather than logged, because there is no logger yet.*** The swap
 * runs before `buildServices`, which is before `buildApp`, which is where the
 * logger comes from — and `main.ts` states the rule this obeys: *"everything
 * this process reports goes through one mechanism"*. So this answers, and the
 * caller says it once the machinery to say it exists.
 */
export type RestoreOutcome =
  /** No marker. The overwhelmingly common boot, and it costs one `stat`. */
  | { kind: 'none' }
  | {
      kind: 'restored';
      /** The archive, data-root-relative — the name the marker carried. */
      archive: string;
      /** Where the install that was replaced now sits. **Not deleted.** */
      moved: string;
      files: number;
      requestedBy: string;
      /**
       * Handles whose own archives stayed in `moved`, because the restored
       * install has no such account, or its directory came with archives of
       * its own.
       */
      backupsLeftBehind: string[];
    }
  | {
      kind: 'failed';
      archive: string;
      why: string;
      /** False once a second attempt has been refused rather than made. */
      willRetry: boolean;
    }
  | {
      /**
       * ***A swap that could neither finish nor be put back***, and the one
       * outcome after which the boot must not go on: the directory is part one
       * install and part another. The journal stays, so the next start tries
       * to finish it again. Both halves are named, so a person with a shell
       * can put them right.
       */
      kind: 'stranded';
      archive: string;
      why: string;
      staging: string;
      replaced: string;
    };

/**
 * Acts on `state/restore.pending`, before anything opens a handle —
 * [P12.12](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***Called from `main.ts` before `buildServices`***, and the ordering is the
 * whole design. `buildServices` opens the operational store, stamps the
 * directory with this build and starts the index — all of which are handles on,
 * or writes into, the directory about to be replaced. On Windows an open handle
 * makes the rename fail outright; everywhere else it makes it succeed and leave
 * a process writing into a directory that is no longer the install.
 *
 * **The sequence, and why each step is where it is:**
 *
 * 1. **A journal first.** `.restore/swap.json` is a swap the last process
 *    staged or started and did not finish, or one `pnpm backup restore`
 *    staged. It is finished before anything else, because until it is the
 *    directory may be neither install.
 * 2. **Read the marker.** Absent is a normal boot and costs one read.
 * 3. **Unpack inside the data directory**, into `.restore/<id>/staging`.
 *    Everything is written before anything moves, so a failure here has
 *    ruined a directory nothing was using. ~~A sibling of the data
 *    directory~~ (corrected 2026-09-27): that needs a writable parent, and no
 *    shipped deployment has one. See `swap.ts`.
 * 4. **Journal, then swap**, one root entry at a time: see `completeSwap`.
 * 5. ***Nothing deletes the marker.*** It lives in `state/`, which moves aside
 *    with the install it belonged to, and no archive carries one — so a
 *    successful restore cannot leave one behind, and an unsuccessful one keeps
 *    exactly the state that describes itself. This is the property that makes
 *    the whole handoff idempotent without a transaction.
 * 6. ***The replaced install is kept***, in `.restore/<id>/replaced`.
 *    `removed/`'s precedent — *StoryEngine will not delete this; remove it
 *    yourself when you are sure* — and it is the undo. It is the single most
 *    important safety property here, because it is the only one that covers
 *    *the restore worked and was the wrong archive*. ***The archives are not in
 *    it***: `backups/` never moves, and each person's own are carried across.
 *
 * ***A failed restore is retried exactly once, and then refused.*** A bad
 * archive must not become a restart loop: a supervisor restarts a process that
 * exits, so an attempt that keeps failing and keeps the marker would take the
 * install down rather than one boot. The first failure rewrites the marker with
 * `attempts: 1` and boots normally; the second refuses and boots normally, and
 * `DELETE /api/admin/restore` is how a person clears it without a shell.
 */
export async function performPendingRestore(
  layout: Layout,
  options: SwapOptions = {},
): Promise<RestoreOutcome> {
  const journal = await readJournal(layout);
  if (journal === 'unreadable') {
    return {
      kind: 'stranded',
      archive: '',
      why: `A restore was part way through and its journal, ${layout.restoreJournalFile}, cannot be read.`,
      staging: layout.restoreRoot,
      replaced: layout.restoreRoot,
    };
  }
  if (journal !== null) return await swapIn(layout, journal, options);

  const plan = await readMarker(layout);
  if (plan === null) return { kind: 'none' };

  if (plan.attempts >= 1) {
    return {
      kind: 'failed',
      archive: plan.archive,
      why: 'This restore already failed once and will not be attempted again.',
      willRetry: false,
    };
  }

  const id = uuidv7();
  const { staging } = swapPaths(layout, id);
  let staged: SwapJournal;
  /**
   * ***The catch covers the unpack and the journal, and never the swap.*** Its
   * clean-up deletes `.restore/<id>/`, which is harmless while that holds only
   * an unpacked archive and would be the one unrecoverable act in this file
   * once it held the replaced install. `completeSwap` answers every failure of
   * its own with an outcome rather than an exception, so nothing after the
   * journal needs catching here.
   */
  try {
    const archive = join(layout.dataRoot, ...plan.archive.split('/'));
    const written = await unpackTarGz(archive, staging);
    /**
     * ***The count again, and here it is the last line of defence.*** The route
     * checked it before the drain, but the archive has been sitting on a disk
     * since — and this is the moment after which the old install stops being
     * where anything looks for it.
     *
     * **Minus the manifest**, which `manifest.files` excludes by definition and
     * which *is* written out: a restored directory keeping the `backup.json` it
     * came from is a note to whoever looks at it later saying which archive
     * this was. `takeBackup` excludes a root `backup.json` from the walk, so it
     * never propagates into the next archive as a stale copy — that exclusion
     * exists for exactly this file arriving exactly this way.
     */
    const files = written - 1;
    if (files !== plan.manifest.files) {
      throw new Error(
        `Expected ${String(plan.manifest.files)} files and unpacked ${String(files)}`,
      );
    }
    staged = {
      schema: SWAP_JOURNAL_SCHEMA,
      id,
      archive: plan.archive,
      requestedBy: plan.requestedBy,
      files,
      phase: 'staged',
    };
    await writeJsonAtomic(layout.restoreJournalFile, staged);
  } catch (error) {
    // The journal too, if its write landed and then threw: there was none
    // when this began, so any there now is this one, naming a staging tree
    // that is about to be gone.
    await unlinkFile(layout.restoreJournalFile).catch(() => undefined);
    await removeTree(layout.restoreWork(id)).catch(() => undefined);
    await markAttempted(layout);
    return {
      kind: 'failed',
      archive: plan.archive,
      why: error instanceof Error ? error.message : 'The archive could not be unpacked.',
      willRetry: false,
    };
  }
  return await swapIn(layout, staged, options);
}

/** The swap, and what it means for the boot. */
async function swapIn(
  layout: Layout,
  journal: SwapJournal,
  options: SwapOptions,
): Promise<RestoreOutcome> {
  const outcome = await completeSwap(layout, journal, options);
  switch (outcome.kind) {
    case 'swapped':
      return {
        kind: 'restored',
        archive: journal.archive,
        moved: outcome.replaced,
        files: journal.files,
        requestedBy: journal.requestedBy,
        backupsLeftBehind: outcome.backupsLeftBehind,
      };
    case 'rolled-back':
      // Back where the marker is (when there was one): the install that asked.
      await markAttempted(layout);
      return { kind: 'failed', archive: journal.archive, why: outcome.why, willRetry: false };
    case 'stranded':
      return {
        kind: 'stranded',
        archive: journal.archive,
        why: outcome.why,
        staging: outcome.staging,
        replaced: outcome.replaced,
      };
  }
}

/**
 * ***The marker is rewritten rather than deleted***, because the failure has to
 * survive into the next boot to be refused there — and because deleting it
 * would turn *this did not work* into *nobody ever asked*, which is the state a
 * person would find if they looked. No marker (a swap `pnpm backup restore`
 * staged) is nothing to rewrite.
 */
async function markAttempted(layout: Layout): Promise<void> {
  const plan = await readMarker(layout).catch(() => null);
  if (plan === null) return;
  await writeJsonAtomic(layout.restorePendingFile, {
    ...plan,
    attempts: plan.attempts + 1,
  }).catch(() => undefined);
}

/**
 * The marker, or null.
 *
 * **A marker that will not parse is null**, which is the same answer as one
 * that is not there. The alternative is a boot that refuses to start over a
 * file nobody can reach to delete, and a restore nobody can confirm was
 * intended is not a restore to perform.
 */
async function readMarker(layout: Layout): Promise<RestorePlan | null> {
  const raw = await readFileBytes(layout.restorePendingFile);
  if (raw === null) return null;
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }

  /**
   * ***Narrowed from `unknown` rather than asserted***, because this file was
   * written by a process that is gone and may have been interrupted while
   * writing it — and the three fields below are the ones acted on. A cast here
   * would make the type system agree that a half-written marker is a plan.
   */
  if (typeof document !== 'object' || document === null) return null;
  const plan = document as Record<string, unknown>;
  if (typeof plan['archive'] !== 'string' || plan['archive'] === '') return null;
  if (typeof plan['attempts'] !== 'number') return null;

  const manifest = plan['manifest'];
  // `typeof null` is `'object'`, which is the one case a shape check here has
  // to spell out rather than lean on.
  if (typeof manifest !== 'object' || manifest === null) return null;
  if (typeof (manifest as Record<string, unknown>)['files'] !== 'number') return null;

  return plan as unknown as RestorePlan;
}
