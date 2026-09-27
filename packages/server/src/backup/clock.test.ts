// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUuidv7, uuidv7, uuidv7Timestamp } from '@storyengine/shared';

import { ensureDirectory, writeFileBytes } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import { takeBackup, type BackupContext } from './archive.js';
import { startBackupSchedule, type ScheduleContext } from './schedule.js';

/**
 * ***Backups on an honest clock*** (2026-09-27).
 *
 * An archive's time is read from its id, and the shared id generator is
 * monotonic: after the clock steps back it goes on minting at the last
 * millisecond it used. So once the clock had been ahead, every archive after
 * carried that time, the newest stood in the future, and the schedule, measuring
 * *due* from it, found nothing due until the clock caught up.
 *
 * **A file of its own**, because the first case moves the shared generator a
 * year ahead, and every id minted after it in the same module graph would
 * inherit that.
 */

const HOUR = 60 * 60 * 1000;
const YEAR = 365 * 24 * HOUR;

let root: string;
let layout: Layout;
let backups: BackupContext;
let state: DatabaseSync;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'se-backup-clock-'));
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

describe('an archive', () => {
  it('carries the time it was taken, after a clock that was once ahead', async () => {
    // The shared generator after a clock a year ahead that was then put right.
    uuidv7(Date.now() + YEAR);
    const before = Date.now();

    const record = await takeBackup(backups, {
      owner: { kind: 'install' },
      contents: 'full',
      reason: 'manual',
    });

    expect(record.takenAt).toBeGreaterThanOrEqual(before);
    expect(record.takenAt).toBeLessThanOrEqual(Date.now());
  });
});

describe('the schedule', () => {
  it('measures from the newest archive not dated in the future, and says so once', async () => {
    // One left by a clock that was ahead, named the way archives are.
    const ahead = createUuidv7()(Date.now() + YEAR);
    const day = new Date(uuidv7Timestamp(ahead) ?? 0).toISOString().slice(0, 10);
    await ensureDirectory(layout.backupsRoot);
    await writeFileBytes(
      join(layout.backupsRoot, `install-full-${day}-${ahead}.tar.gz`),
      new TextEncoder().encode('an archive from the future'),
    );
    const logged: string[] = [];
    const context: ScheduleContext = {
      backups,
      notices: {
        accounts: {
          list: () => Promise.resolve([]),
        } as unknown as ScheduleContext['notices']['accounts'],
        notify: () => undefined,
      },
      accounts: () => Promise.resolve([]),
      settingsOf: () => Promise.resolve({ frequency: 'off', onStart: false, contents: 'full' }),
      install: () => ({ frequency: 'daily', onStart: false, contents: 'full' }),
      log: (fields) => {
        logged.push(String(fields['event']));
      },
    };

    const schedule = startBackupSchedule(context, HOUR, HOUR);
    try {
      expect(await schedule.runOnce('schedule')).toHaveLength(1);
      // And now the newest real one is minutes old, so nothing is due.
      expect(await schedule.runOnce('schedule')).toEqual([]);
    } finally {
      schedule.stop();
    }
    expect(logged.filter((event) => event === 'backup.futureStamped')).toHaveLength(1);
  });
});
