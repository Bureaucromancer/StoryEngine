// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  backupIntervalMs,
  type BackupContents,
  type BackupFrequency,
  type BackupReason,
} from '@storyengine/shared';

import type { PublicAccount } from '../auth/accounts.js';
import { announceBackupFailed, type NoticeContext } from '../notifications/notices.js';
import { KeyedQueue } from '../storage/keyed-queue.js';
import {
  listBackups,
  takeBackup,
  type BackupContext,
  type BackupOwner,
  type BackupRecord,
} from './archive.js';

/**
 * ***Backups on a timer*** —
 * [P12.5](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * `startTrashSweep`'s shape, and the resemblance is not cosmetic: both are
 * periodic housekeeping over files a request path put somewhere and nobody is
 * coming back for, both read live config **through closures rather than
 * captured values** — the mistake `watcher.ts`'s docstring records about
 * `history.keepPerObject` — and both are `unref`ed, because housekeeping must
 * never be the reason a process asked to exit stays alive.
 *
 * ***The archives are the state, and there is no last-run row anywhere.***
 * Each pass asks, per scope: *is the newest archive for this scope older than
 * the frequency?* Three things fall out of that and each is worth more than the
 * row would have been.
 *
 * **A run missed while the server was down happens on the next pass**, which is
 * the case that actually matters on a machine that is off overnight — and the
 * case a *next fire at* timestamp gets wrong, because it fires once on wake and
 * then believes it is caught up.
 *
 * **Deleting an archive by hand stays a non-event.** The listing is a directory
 * read ([03 §5.1]'s posture about the index, applied to something disposable in
 * the same way), so a person who clears out `backups/` gets a fresh one on the
 * next pass rather than a schedule that thinks it already ran.
 *
 * **And there is no migration to write**, for a feature whose whole promise is
 * about not losing things.
 *
 * *The timer only has to tick often enough to notice*, so it is hourly against
 * a window measured in days. The frequency decides; the tick does not.
 */

export interface ScheduleContext {
  backups: BackupContext;
  notices: NoticeContext;
  /** Every account, read per pass — the list changes while the server runs. */
  accounts: () => Promise<PublicAccount[]>;
  /** One account's schedule. */
  settingsOf: (handle: string) => Promise<{
    frequency: BackupFrequency;
    onStart: boolean;
    contents: BackupContents;
  }>;
  /** The install's, from the live config. A closure, never a captured value. */
  install: () => { frequency: BackupFrequency; onStart: boolean; contents: BackupContents };
  log: (event: Record<string, unknown>, message: string) => void;
}

export interface BackupSchedule {
  /** Runs one pass now, and answers what it took. */
  runOnce(reason: 'schedule' | 'start'): Promise<BackupRecord[]>;
  stop(): void;
}

/** Fine enough for a window measured in days, coarse enough to be free. */
export const BACKUP_TICK_MS = 60 * 60 * 1000;

/**
 * How long after boot the *on start* pass runs.
 *
 * `FIRST_CHECK_DELAY_MS`'s reason, one subsystem along and with more at stake:
 * a container in a restart loop must not become a **disk-write** loop. It also
 * keeps a large archive from competing with the index rebuild and the session
 * reconciliation that a boot is already doing.
 */
export const START_BACKUP_DELAY_MS = 30_000;

/**
 * ***How new an archive has to be for *on start* to skip — and this is not a
 * retention policy.***
 *
 * A retention policy decides what to **delete**, and [P12] defers that
 * deliberately. This decides whether to **write**, and it exists because
 * *on start* on a laptop rebooted five times a day is five copies of a
 * directory that nothing wrote to in between. **A restart is not a reason to
 * take a second copy.**
 *
 * One constant, and it can be removed in a line if somebody decides they want
 * a copy per boot after all.
 */
export const START_FLOOR_MS = 60 * 60 * 1000;

/**
 * Whether a scope is due, and under which name.
 *
 * ***The frequency wins when both apply***, so a boot that is also overdue
 * records `schedule` and writes **one** archive rather than two. The reason
 * ends up in the manifest, where it is the only record of why a file exists.
 */
export function backupDue(
  settings: { frequency: BackupFrequency; onStart: boolean },
  newestAt: number | null,
  now: number,
  pass: 'schedule' | 'start',
): BackupReason | null {
  const interval = backupIntervalMs(settings.frequency);
  if (interval !== null && (newestAt === null || now - newestAt >= interval)) return 'schedule';

  if (pass === 'start' && settings.onStart) {
    if (newestAt !== null && now - newestAt < START_FLOOR_MS) return null;
    return 'start';
  }
  return null;
}

/**
 * ***How far ahead of the clock an archive's own time may be and still count as
 * the newest*** (2026-09-27). A little, for a clock NTP has just nudged back;
 * no more, because an archive stamped in the future made nothing due until the
 * clock reached it (see {@link startBackupSchedule}'s `consider`).
 */
export const FUTURE_SKEW_MS = 10 * 60 * 1000;

export function startBackupSchedule(
  context: ScheduleContext,
  intervalMs: number = BACKUP_TICK_MS,
  startDelayMs: number = START_BACKUP_DELAY_MS,
): BackupSchedule {
  let stopped = false;
  /**
   * Keyed by scope, so two passes overlapping cannot write one scope twice.
   * ~~and a slow install archive does not hold up anybody's own~~ *Corrected
   * 2026-09-27:* a pass takes the install's archive before anybody's own, and
   * `takeBackup` now writes one archive at a time on a data directory, so a
   * slow one does hold the rest up, which is what keeps two from sizing the
   * disk for themselves alone.
   */
  const queue = new KeyedQueue();
  /** Scopes whose newest archive was stamped in the future, said once each. */
  const skewed = new Set<string>();

  const keyOf = (owner: BackupOwner): string =>
    owner.kind === 'install' ? 'install' : `account:${owner.handle}`;

  /**
   * ***The scopes whose last attempt failed, so a person is told once.*** A
   * backup that fails stays due, so it is tried again at the next hourly tick,
   * and each failure used to be a notification: a disk that stayed full for a
   * weekend was forty-eight of them. Now the first failure is announced and the
   * rest are logged, and a success clears it, so the next failure is news again.
   */
  const failing = new Set<string>();

  async function consider(
    owner: BackupOwner,
    settings: { frequency: BackupFrequency; onStart: boolean; contents: BackupContents },
    pass: 'schedule' | 'start',
    now: number,
  ): Promise<BackupRecord | null> {
    return queue.run(keyOf(owner), async () => {
      if (stopped) return null;
      /**
       * ***The newest archive that is not from the future*** (2026-09-27). An
       * archive's time is read from its id, and one taken while the clock was
       * ahead stays ahead once it is put right. Measured from it, `now` minus
       * the newest was negative, so no frequency was ever due and no boot
       * either: backups stopped, silently, until the clock caught up. Such an
       * archive is passed over for the decision and said once in the log; it
       * is still listed, and still somebody's to download.
       */
      const listed = await listBackups(context.backups, owner);
      const newest = listed.find((one) => one.takenAt <= now + FUTURE_SKEW_MS) ?? null;
      if (newest !== listed[0] && !skewed.has(keyOf(owner))) {
        skewed.add(keyOf(owner));
        context.log(
          { event: 'backup.futureStamped', scope: owner.kind },
          'The newest backup is dated in the future, so the schedule measures from the one before it',
        );
      }
      const reason = backupDue(settings, newest?.takenAt ?? null, now, pass);
      if (reason === null) return null;

      return takeBackup(context.backups, { owner, contents: settings.contents, reason });
    });
  }

  /**
   * One scope, with its failure kept to itself.
   *
   * ***A backup that throws must not stop the pass***, because the commonest
   * cause is one account's library — a path too long for an archive to carry —
   * and that is not a reason for nobody else on the install to get one.
   *
   * **Paths never reach the log**, per [22 §4.1]: what goes in is the scope and
   * the error's class. A person is told through a notification, which is where
   * somebody who is not reading `docker logs` will actually see it.
   */
  async function attempt(
    owner: BackupOwner,
    settings: { frequency: BackupFrequency; onStart: boolean; contents: BackupContents },
    pass: 'schedule' | 'start',
    now: number,
    taken: BackupRecord[],
  ): Promise<void> {
    try {
      const record = await consider(owner, settings, pass, now);
      if (record !== null) {
        failing.delete(keyOf(owner));
        taken.push(record);
        context.log(
          { event: 'backup.taken', scope: record.scope, reason: pass, bytes: record.bytes },
          'Backup taken',
        );
      }
    } catch (error) {
      context.log(
        {
          event: 'backup.failed',
          scope: owner.kind,
          reason: error instanceof Error ? error.name : 'unknown',
        },
        'A scheduled backup failed',
      );
      if (failing.has(keyOf(owner))) return;
      failing.add(keyOf(owner));
      await announceBackupFailed(context.notices, owner).catch(() => undefined);
    }
  }

  const runOnce = async (pass: 'schedule' | 'start'): Promise<BackupRecord[]> => {
    const taken: BackupRecord[] = [];
    const now = Date.now();

    await attempt({ kind: 'install' }, context.install(), pass, now, taken);

    for (const account of await context.accounts()) {
      if (stopped) break;
      /**
       * ***Read per pass rather than captured***, so an admin revoking the
       * capability takes effect on the next tick rather than on the next
       * restart — which is what `live` is supposed to mean.
       */
      if (!account.enabled || !account.capabilities.scheduledBackups) continue;
      const settings = await context.settingsOf(account.handle);
      await attempt({ kind: 'account', handle: account.handle }, settings, pass, now, taken);
    }

    return taken;
  };

  const first = setTimeout(() => {
    void runOnce('start').catch(() => undefined);
  }, startDelayMs);
  first.unref();

  const repeat = setInterval(() => {
    void runOnce('schedule').catch(() => undefined);
  }, intervalMs);
  repeat.unref();

  return {
    runOnce,
    stop: () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(repeat);
    },
  };
}
