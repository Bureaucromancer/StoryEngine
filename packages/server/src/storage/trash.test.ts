// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import type { Logger } from '../state/commit.js';
import { eventually } from '../test-server.js';
import { Layout } from './layout.js';
import {
  deletedAtFrom,
  listTrash,
  restoreFromTrash,
  startTrashSweep,
  sweepTrash,
} from './trash.js';

/**
 * ***Gone after the window, and a clock the test controls*** —
 * [03 §10.2](../../../../docs/design/03-data-model.md),
 * [P11.7](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * The stage's proof obligation names this shape by name: *"a sweep test over a
 * **clock the test controls** — the one shape that can assert *gone after it*
 * without waiting thirty days, and the reason to write it here rather than let
 * somebody reach for a real date."*
 *
 * ***What it is really holding is the timestamp's source.*** The sweep reads
 * when a thing was deleted out of its **folder name** — `trashDestination`
 * suffixes every entry with a `uuidv7`, whose first forty-eight bits are the
 * millisecond it was minted — rather than out of the filesystem's mtime. The
 * mutation that would break it is switching to `stat`, which passes every test
 * that makes a file and then immediately sweeps, and fails silently on the one
 * thing that actually happens: a restore from backup, where every mtime is
 * today and a month of trash either survives forever or vanishes overnight.
 */

let dataDir: string;
let layout: Layout;

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-trash-'));
  layout = new Layout(dataDir);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** Puts one folder in the trash as a delete at `at` would have. */
async function deleted(kind: string, name: string, at: number): Promise<string> {
  const suffix = uuidAt(at);
  const folder = join(layout.trashRoot('ned'), kind, `${name}-${suffix}`);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'actor.json'), '{}');
  return `${kind}/${name}-${suffix}`;
}

/** A `uuidv7` whose timestamp is the millisecond given. */
function uuidAt(at: number): string {
  const real = uuidv7();
  const stamp = at.toString(16).padStart(12, '0');
  return `${stamp.slice(0, 8)}-${stamp.slice(8, 12)}-${real.slice(14)}`;
}

describe('when something was deleted', () => {
  it('is read out of the folder name rather than off the disk', () => {
    const at = 1_757_000_000_000;
    expect(deletedAtFrom(uuidAt(at).replace(/-/g, ''))).toBe(at);
  });

  /**
   * ***A folder this build did not put there is listed and never swept.***
   * Zero would read as *deleted in 1970*, and the next pass would delete
   * somebody's directory because it did not recognise the name.
   */
  it('is unknown for a name that carries no timestamp', () => {
    expect(deletedAtFrom('handmade')).toBeNull();
  });
});

describe('the retention sweep', () => {
  it('keeps what is inside the window and takes what is past it', async () => {
    const now = 1_757_000_000_000;
    const fresh = await deleted('actors', 'vera', now - 3 * DAY);
    const stale = await deleted('actors', 'keeper', now - 31 * DAY);

    const taken = await sweepTrash(layout, 'ned', 30, now);

    expect(taken).toEqual([stale]);
    const left = await listTrash(layout, 'ned', 30);
    expect(left.map((one) => one.id)).toEqual([fresh]);
  });

  /**
   * ***Zero is keep forever, not delete immediately.*** The schema's minimum is
   * zero, and the reading is load-bearing in the direction that cannot be
   * undone: an operator turning the window off would otherwise have emptied
   * their trash by doing so.
   */
  it('takes nothing at all when the window is off', async () => {
    const now = 1_757_000_000_000;
    await deleted('actors', 'keeper', now - 3650 * DAY);

    expect(await sweepTrash(layout, 'ned', 0, now)).toEqual([]);
    expect(await listTrash(layout, 'ned', 0)).toHaveLength(1);
  });

  it('never takes a folder whose age it cannot tell', async () => {
    await mkdir(join(layout.trashRoot('ned'), 'actors', 'handmade'), { recursive: true });
    expect(await sweepTrash(layout, 'ned', 1, 1_757_000_000_000)).toEqual([]);
  });

  it('answers an empty trash without inventing a directory', async () => {
    expect(await listTrash(layout, 'ned', 30)).toEqual([]);
    expect(await sweepTrash(layout, 'ned', 30, Date.now())).toEqual([]);
  });
});

/**
 * ***The sweep's own timer*** (2026-09-27). Its docstring said *once at
 * startup and then daily*, and there was only the daily interval, so a server
 * that never stayed up a day never swept.
 */
describe('the sweep on its timer', () => {
  function listening(): { log: Logger; events: string[] } {
    const events: string[] = [];
    const note = (fields: Record<string, unknown>) => {
      events.push(String(fields['event']));
    };
    const log: Logger = {
      child: () => log,
      info: note,
      warn: note,
      error: note,
    };
    return { log, events };
  }

  it('makes its first pass shortly after a start, not a day later', async () => {
    const stale = await deleted('actors', 'keeper', Date.now() - 31 * DAY);
    const { log, events } = listening();

    const sweep = startTrashSweep(
      layout,
      () => Promise.resolve(['ned']),
      () => 30,
      {
        startDelayMs: 10,
        clock: { jumped: () => false },
      },
    );
    sweep.setLogger(log);
    try {
      await eventually(async () => (await listTrash(layout, 'ned', 30)).length === 0);
      expect(events).toEqual(['trash.swept']);
    } finally {
      sweep.stop();
    }
    expect(stale).toContain('keeper');
  });

  it('skips a pass when the wall clock has jumped, and says so', async () => {
    await deleted('actors', 'keeper', Date.now() - 31 * DAY);
    const { log, events } = listening();

    const sweep = startTrashSweep(
      layout,
      () => Promise.resolve(['ned']),
      () => 30,
      {
        startDelayMs: 10,
        clock: { jumped: () => true },
      },
    );
    sweep.setLogger(log);
    try {
      await eventually(() => Promise.resolve(events.length > 0));
      expect(events).toEqual(['trash.clockJumped']);
      expect(await listTrash(layout, 'ned', 30)).toHaveLength(1);
    } finally {
      sweep.stop();
    }
  });
});

describe('restoring', () => {
  it('puts the folder back under the name it had, with the suffix gone', async () => {
    const id = await deleted('actors', 'vera', 1_757_000_000_000);

    const restored = await restoreFromTrash(layout, 'ned', id);

    expect(restored.ok).toBe(true);
    expect(await listTrash(layout, 'ned', 30)).toEqual([]);
    expect(restored.ok && restored.path.endsWith(join('library', 'actors', 'vera'))).toBe(true);
  });

  /**
   * ***Delete, recreate, restore*** — a real sequence, and the one where
   * overwriting would destroy the newer object to resurrect the older.
   */
  it('refuses rather than overwriting something already there', async () => {
    const id = await deleted('actors', 'vera', 1_757_000_000_000);
    await mkdir(join(dataDir, 'users', 'ned', 'library', 'actors', 'vera'), { recursive: true });

    const restored = await restoreFromTrash(layout, 'ned', id);

    expect(restored).toEqual({ ok: false, reason: 'occupied' });
    // And it is still in the trash, which is the half that makes the refusal
    // safe: nothing was moved and nothing was lost.
    expect(await listTrash(layout, 'ned', 30)).toHaveLength(1);
  });

  it('says so for an address that names nothing', async () => {
    const restored = await restoreFromTrash(layout, 'ned', 'actors/never-existed');
    expect(restored).toEqual({ ok: false, reason: 'not-found' });
  });

  it('refuses an address that is not one', async () => {
    await expect(restoreFromTrash(layout, 'ned', '../../etc')).rejects.toThrow();
    await expect(restoreFromTrash(layout, 'ned', 'actors/..')).rejects.toThrow();
  });
});
