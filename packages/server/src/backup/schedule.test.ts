// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BackupContents, BackupFrequency } from '@storyengine/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicAccount } from '../auth/accounts.js';
import { ensureDirectory, writeFileBytes } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import { BACKUP_MANIFEST_MEMBER, readBackupManifest } from '@storyengine/shared';

import { readTarGz } from '../storage/tar-archive.js';
import { findBackup, listBackups, type BackupContext } from './archive.js';
import {
  backupDue,
  START_FLOOR_MS,
  startBackupSchedule,
  type ScheduleContext,
} from './schedule.js';

/**
 * ***The schedule, and the thing it is for*** —
 * [P12.5](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * **The case that matters is a machine that was off.** A household install is
 * not up all the time, so *daily* has to mean *if it has been a day* rather
 * than *at this hour*, and a `nextFireAt` timestamp gets that wrong in the
 * quiet direction: it fires once on wake and then believes it is caught up.
 * Reading the newest archive instead makes a missed run indistinguishable from
 * a due one, which is the property being asserted here.
 */

let root: string;
let layout: Layout;
let backups: BackupContext;
let state: DatabaseSync;
let notified: { account: string; notice: string }[];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function account(handle: string, scheduledBackups: boolean, enabled = true): PublicAccount {
  return {
    handle,
    displayName: handle,
    role: 'user',
    enabled,
    locale: null,
    capabilities: {
      privateConnections: true,
      fileAccess: 'none',
      enableExtensions: false,
      scheduledBackups,
    },
    createdAt: 0,
  };
}

interface Harness {
  context: ScheduleContext;
  settings: Map<string, { frequency: BackupFrequency; onStart: boolean; contents: BackupContents }>;
  install: { frequency: BackupFrequency; onStart: boolean; contents: BackupContents };
  accounts: PublicAccount[];
}

function harness(): Harness {
  const settings = new Map<
    string,
    { frequency: BackupFrequency; onStart: boolean; contents: BackupContents }
  >();
  const install = {
    frequency: 'off' as BackupFrequency,
    onStart: false,
    contents: 'full' as BackupContents,
  };
  const accounts: PublicAccount[] = [];

  return {
    settings,
    install,
    accounts,
    context: {
      backups,
      notices: {
        accounts: {
          list: () => Promise.resolve(accounts),
        } as unknown as ScheduleContext['notices']['accounts'],
        notify: (occurrence) => {
          notified.push({
            account: (occurrence as { account: string }).account,
            notice: (occurrence as { notice?: string }).notice ?? '',
          });
        },
      },
      accounts: () => Promise.resolve(accounts),
      settingsOf: (handle) =>
        Promise.resolve(
          settings.get(handle) ?? { frequency: 'off', onStart: false, contents: 'full' },
        ),
      install: () => install,
      log: () => undefined,
    },
  };
}

beforeEach(async () => {
  notified = [];
  root = await mkdtemp(join(tmpdir(), 'se-schedule-'));
  layout = new Layout(root);
  await ensureDirectory(layout.stateRoot);
  state = new DatabaseSync(layout.stateFile);
  state.exec('create table job (id text primary key)');
  backups = { layout, state, build: null };

  await ensureDirectory(join(root, 'users', 'ned', 'library'));
  await writeFileBytes(
    join(root, 'users', 'ned', 'library', 'a.json'),
    new TextEncoder().encode('{}'),
  );
});

afterEach(async () => {
  state.close();
  await rm(root, { recursive: true, force: true });
});

/**
 * ***The decision, isolated from the clock and the disk.***
 *
 * `backupDue` is exported for this: the rest of the file proves the plumbing,
 * and the table below proves the rule — which is the half somebody will change
 * without meaning to.
 */
describe('whether a scope is due', () => {
  const daily = { frequency: 'daily' as const, onStart: false };
  const now = 10 * DAY;

  it('takes the first one when there is nothing to compare against', () => {
    expect(backupDue(daily, null, now, 'schedule')).toBe('schedule');
  });

  it('waits while the newest is younger than the frequency', () => {
    expect(backupDue(daily, now - 3 * HOUR, now, 'schedule')).toBeNull();
  });

  /**
   * ***The one that a `nextFireAt` gets wrong.*** Four days without a pass is
   * four days the machine was off, and the answer has to be *yes* on the first
   * tick after it comes back rather than *no, the hour has gone*.
   */
  it('fires on the first pass after the machine was off for days', () => {
    expect(backupDue(daily, now - 4 * DAY, now, 'schedule')).toBe('schedule');
  });

  it('does nothing at all when the frequency is off', () => {
    expect(backupDue({ frequency: 'off', onStart: false }, null, now, 'schedule')).toBeNull();
  });

  it('takes one on start when asked to, and records why', () => {
    expect(backupDue({ frequency: 'off', onStart: true }, null, now, 'start')).toBe('start');
  });

  /** A restart is not a reason to take a second copy of an unchanged directory. */
  it('skips a start backup when the newest is under the floor', () => {
    const settings = { frequency: 'off' as const, onStart: true };
    expect(backupDue(settings, now - (START_FLOOR_MS - 1), now, 'start')).toBeNull();
    expect(backupDue(settings, now - (START_FLOOR_MS + 1), now, 'start')).toBe('start');
  });

  /** One archive, not two — and the frequency is the honest name for it. */
  it('writes one archive when a boot is also overdue, named for the frequency', () => {
    expect(backupDue({ frequency: 'daily', onStart: true }, now - 4 * DAY, now, 'start')).toBe(
      'schedule',
    );
  });

  it('never fires on start for a pass that is not one', () => {
    expect(backupDue({ frequency: 'off', onStart: true }, null, now, 'schedule')).toBeNull();
  });
});

describe('a pass', () => {
  it('takes the install’s when the config asks for one, and stops when it does not', async () => {
    const one = harness();
    const schedule = startBackupSchedule(one.context, HOUR, 10 * 60 * 1000);
    try {
      expect(await schedule.runOnce('schedule')).toEqual([]);

      one.install.frequency = 'daily';
      const taken = await schedule.runOnce('schedule');
      expect(taken).toHaveLength(1);
      expect(taken[0]?.scope).toBe('install');

      // And not again, because the newest is now minutes old.
      expect(await schedule.runOnce('schedule')).toEqual([]);
    } finally {
      schedule.stop();
    }
  });

  /**
   * ***Read per pass rather than captured***, so revoking takes effect on the
   * next tick rather than on the next restart — which is what `live` means.
   */
  it('skips an account the capability was never granted to, and picks it up when it is', async () => {
    const one = harness();
    one.accounts.push(account('ned', false));
    one.settings.set('ned', { frequency: 'daily', onStart: false, contents: 'full' });

    const schedule = startBackupSchedule(one.context, HOUR, 10 * 60 * 1000);
    try {
      expect(await schedule.runOnce('schedule')).toEqual([]);

      one.accounts[0] = account('ned', true);
      const taken = await schedule.runOnce('schedule');
      expect(taken).toHaveLength(1);
      expect(taken[0]?.handle).toBe('ned');
      expect(await listBackups(backups, { kind: 'account', handle: 'ned' })).toHaveLength(1);
    } finally {
      schedule.stop();
    }
  });

  it('skips a disabled account even with the capability and a schedule', async () => {
    const one = harness();
    one.accounts.push(account('ned', true, false));
    one.settings.set('ned', { frequency: 'daily', onStart: false, contents: 'full' });

    const schedule = startBackupSchedule(one.context, HOUR, 10 * 60 * 1000);
    try {
      expect(await schedule.runOnce('schedule')).toEqual([]);
    } finally {
      schedule.stop();
    }
  });

  it('honours each account’s own choice of contents', async () => {
    const one = harness();
    one.accounts.push(account('ned', true));
    one.settings.set('ned', { frequency: 'daily', onStart: false, contents: 'redacted' });

    const schedule = startBackupSchedule(one.context, HOUR, 10 * 60 * 1000);
    try {
      const taken = await schedule.runOnce('schedule');
      expect(taken[0]?.contents).toBe('redacted');
    } finally {
      schedule.stop();
    }
  });

  /**
   * ***A path no archive can carry is left out, said so, and does not cost
   * anybody their backup.***
   *
   * This project refuses rather than sanitises almost everywhere, and a backup
   * is the one place that trade runs the other way: all-or-nothing is right for
   * a *restore*, where a partial result is a corrupt install, and for a backup
   * it means one pathological name in one library leaves the whole install with
   * **no archive at all** — discovered on the day somebody needs one.
   *
   * *This test was written expecting the opposite*, and the run is what settled
   * it: a name that cannot be expressed sat in a user's library, and the
   * **install** archive — every other account's work included — failed with it.
   */
  it('leaves out a path no archive can name, and says so in the manifest', async () => {
    const one = harness();
    one.install.frequency = 'daily';
    one.accounts.push(account('ned', true));
    one.settings.set('ned', { frequency: 'daily', onStart: false, contents: 'full' });

    const impossible = `${'x'.repeat(180)}.json`;
    await ensureDirectory(join(root, 'users', 'ned', 'library', 'lorebooks'));
    await writeFileBytes(
      join(root, 'users', 'ned', 'library', 'lorebooks', impossible),
      new TextEncoder().encode('{}'),
    );

    const schedule = startBackupSchedule(one.context, HOUR, 10 * 60 * 1000);
    try {
      const taken = await schedule.runOnce('schedule');
      expect(taken.map((row) => row.scope)).toEqual(['install', 'account']);
      expect(notified).toEqual([]);

      const found = await findBackup(backups, { kind: 'install' }, taken[0]!.id);
      let manifest: unknown = null;
      for await (const member of readTarGz(found!.path)) {
        if (member.name === BACKUP_MANIFEST_MEMBER) {
          manifest = JSON.parse(new TextDecoder().decode(member.bytes));
          break;
        }
      }
      const read = readBackupManifest(manifest);
      expect('schema' in read).toBe(true);
      if ('schema' in read) {
        const warned = read.omitted.filter((one_) => one_.level === 'warn');
        expect(warned.map((one_) => one_.key)).toEqual(['backup.omitted.unarchivablePath']);
        expect(warned[0]?.params['path']).toContain(impossible);
      }

      // And everything else is in there, which is the whole point of skipping.
      const names: string[] = [];
      for await (const member of readTarGz(found!.path)) names.push(member.name);
      expect(names).toContain('users/ned/library/a.json');
    } finally {
      schedule.stop();
    }
  });

  /**
   * ***One scope failing is not everybody's problem.*** The pass carries on and
   * the person whose backup did not happen is told — because the alternative is
   * that they find out when they need the archive that was never written.
   */
  it('carries on past a scope that failed, and tells the person it was for', async () => {
    const one = harness();
    one.install.frequency = 'daily';
    one.accounts.push(account('ned', true));
    one.settings.set('ned', { frequency: 'daily', onStart: false, contents: 'full' });

    // Their backups directory is a file, so nothing can be written into it.
    await writeFileBytes(
      layout.userBackupsRoot('ned'),
      new TextEncoder().encode('not a directory'),
    );

    const schedule = startBackupSchedule(one.context, HOUR, 10 * 60 * 1000);
    try {
      const taken = await schedule.runOnce('schedule');
      expect(taken.map((row) => row.scope)).toEqual(['install']);
      expect(notified).toEqual([{ account: 'ned', notice: 'backup-failed' }]);
    } finally {
      schedule.stop();
    }
  });
});

/**
 * ***Told once, not every hour.*** A backup that fails stays due, so the next
 * hourly tick tries again, and each failure used to be a notification: a disk
 * that stayed full over a weekend was forty-eight of them.
 *
 * Catches: announcing every failure rather than the first of a streak.
 */
describe('a scope that keeps failing', () => {
  it('tells its person once', async () => {
    const one = harness();
    one.accounts.push(account('ned', true));
    one.settings.set('ned', { frequency: 'daily', onStart: false, contents: 'full' });
    await writeFileBytes(
      layout.userBackupsRoot('ned'),
      new TextEncoder().encode('not a directory'),
    );

    const schedule = startBackupSchedule(one.context, HOUR, 10 * 60 * 1000);
    try {
      await schedule.runOnce('schedule');
      await schedule.runOnce('schedule');
      await schedule.runOnce('schedule');
      expect(notified).toEqual([{ account: 'ned', notice: 'backup-failed' }]);
    } finally {
      schedule.stop();
    }
  });
});

describe('the timers', () => {
  it('fire on their own and stop when told', async () => {
    vi.useFakeTimers();
    try {
      const one = harness();
      one.install.frequency = 'daily';
      const schedule = startBackupSchedule(one.context, 50, 10);

      await vi.advanceTimersByTimeAsync(20);
      await vi.waitFor(async () => {
        expect(await listBackups(backups, { kind: 'install' })).toHaveLength(1);
      });

      schedule.stop();
      const after = await listBackups(backups, { kind: 'install' });
      await vi.advanceTimersByTimeAsync(500);
      expect(await listBackups(backups, { kind: 'install' })).toHaveLength(after.length);
    } finally {
      vi.useRealTimers();
    }
  });
});
