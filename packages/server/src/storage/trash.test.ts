// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
  TrashAddressError,
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
    // As its own error, which is what lets the route tell a malformed address
    // from a rename the disk refused (2026-09-27).
    await expect(restoreFromTrash(layout, 'ned', '../../etc')).rejects.toBeInstanceOf(
      TrashAddressError,
    );
    await expect(restoreFromTrash(layout, 'ned', 'actors/..')).rejects.toBeInstanceOf(
      TrashAddressError,
    );
  });

  /**
   * ***Two restores of one entry at once*** (2026-09-27) — two tabs, or a
   * double press. Both find the entry and its place free, and the second
   * rename finds nothing left to move. That was a throw, which the route then
   * turned into *not an address in the trash*; it is the refusal a moment's
   * later look would have given.
   */
  it('answers the second of two restores at once with a refusal, not a throw', async () => {
    const id = await deleted('actors', 'vera', 1_757_000_000_000);

    const both = await Promise.allSettled([
      restoreFromTrash(layout, 'ned', id),
      restoreFromTrash(layout, 'ned', id),
    ]);

    expect(both.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    const answers = both.map((outcome) => (outcome.status === 'fulfilled' ? outcome.value : null));
    expect(answers.filter((answer) => answer?.ok)).toHaveLength(1);
    const refused = answers.find((answer) => answer?.ok === false);
    expect(['not-found', 'occupied']).toContain(refused?.ok === false ? refused.reason : null);
  });

  /**
   * ***A sweep and a restore of one entry, one after the other*** (2026-10-01).
   * The sweep's recursive delete and a restore at the very end of an entry's
   * window could interleave — and a rename halfway through a delete brings
   * back a folder missing whatever had already gone. They queue now: what was
   * asked first happens first, whole.
   */
  it('does not let a restore run through the middle of a sweep', async () => {
    const id = await deleted('actors', 'vera', 1_757_000_000_000);
    const folder = join(layout.trashRoot('ned'), id);
    for (let index = 0; index < 50; index += 1) {
      await writeFile(join(folder, `asset-${String(index)}.bin`), 'x');
    }

    const [taken, restored] = await Promise.all([
      sweepTrash(layout, 'ned', 30, 1_757_000_000_000 + 31 * DAY),
      restoreFromTrash(layout, 'ned', id),
    ]);

    expect(taken).toEqual([id]);
    expect(restored).toEqual({ ok: false, reason: 'not-found' });
  });
});

/**
 * ***A Package trashed before P16.0*** — [P16 §1.1]. `trash/packages/` is no
 * longer a library folder, and every case below fails with the legacy trash kind
 * removed: unlisted, refused as an address, and never expired — a folder on disk
 * for good that nobody can see or restore.
 */
describe('a Package trashed before the kind was renamed World', () => {
  const PACKAGE_ID = '0199c000-0000-7000-8000-0000000000aa';

  /** A Package's folder as a pre-P16.0 delete left it: its file, and its history. */
  async function trashedPackage(name: string, at: number): Promise<string> {
    const suffix = uuidAt(at);
    const folder = join(layout.trashRoot('ned'), 'packages', `${name}-${suffix}`);
    await mkdir(join(folder, 'history'), { recursive: true });
    await writeFile(
      join(folder, 'package.json'),
      `${JSON.stringify({ schema: 'storyengine.package/1', id: PACKAGE_ID, name: 'Rain City', contents: [] }, null, 2)}\n`,
    );
    await writeFile(join(folder, 'history', 'index.jsonl'), '');
    return `packages/${name}-${suffix}`;
  }

  const worlds = (): string => join(dataDir, 'users', 'ned', 'library', 'worlds');

  it('is listed, under the folder it is in', async () => {
    const id = await trashedPackage('rain-city', Date.now());
    const listed = await listTrash(layout, 'ned', 30);
    expect(listed.map((entry) => entry.id)).toEqual([id]);
    expect(listed[0]?.kind).toBe('packages');
    expect(listed[0]?.name).toBe('rain-city');
  });

  it('is expired by the sweep like anything else', async () => {
    const now = Date.now();
    const id = await trashedPackage('rain-city', now - 31 * DAY);
    await expect(sweepTrash(layout, 'ned', 30, now)).resolves.toEqual([id]);
    await expect(listTrash(layout, 'ned', 30)).resolves.toEqual([]);
  });

  it('restores into the World folder as world.json, with its id, its history, and nothing old left', async () => {
    const id = await trashedPackage('rain-city', Date.now());
    const outcome = await restoreFromTrash(layout, 'ned', id);
    expect(outcome).toEqual({
      ok: true,
      path: join(worlds(), 'rain-city'),
      restored: { kind: 'object', schemaId: 'storyengine.world/1', slug: 'rain-city' },
    });

    const body = JSON.parse(await readFile(join(worlds(), 'rain-city', 'world.json'), 'utf8')) as {
      schema: string;
      id: string;
      name: string;
    };
    expect(body).toMatchObject({
      schema: 'storyengine.world/1',
      id: PACKAGE_ID,
      name: 'Rain City',
    });
    await expect(stat(join(worlds(), 'rain-city', 'package.json'))).rejects.toThrow();
    await expect(stat(join(worlds(), 'rain-city', 'history', 'index.jsonl'))).resolves.toBeTruthy();
    await expect(listTrash(layout, 'ned', 30)).resolves.toEqual([]);
  });

  /**
   * ***A World made since holds the name.*** Slugs are frozen, so renaming that
   * World frees nothing, and the refusal every other kind gives here would
   * strand the Package in the trash for good.
   */
  it('takes a fresh name rather than refusing when a World already has its own', async () => {
    await mkdir(join(worlds(), 'rain-city'), { recursive: true });
    await writeFile(join(worlds(), 'rain-city', 'world.json'), 'the other World');
    const id = await trashedPackage('rain-city', Date.now());

    const outcome = await restoreFromTrash(layout, 'ned', id);
    expect(outcome).toMatchObject({
      ok: true,
      restored: { kind: 'object', schemaId: 'storyengine.world/1', slug: 'rain-city-2' },
    });
    await expect(readFile(join(worlds(), 'rain-city', 'world.json'), 'utf8')).resolves.toBe(
      'the other World',
    );
    await expect(readFile(join(worlds(), 'rain-city-2', 'world.json'), 'utf8')).resolves.toContain(
      PACKAGE_ID,
    );
  });

  it('leaves a body it cannot read under its old name rather than rewriting it', async () => {
    const suffix = uuidAt(Date.now());
    const folder = join(layout.trashRoot('ned'), 'packages', `broken-${suffix}`);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), '{ not json');

    const outcome = await restoreFromTrash(layout, 'ned', `packages/broken-${suffix}`);
    expect(outcome).toMatchObject({ ok: true, restored: { slug: 'broken' } });
    await expect(readFile(join(worlds(), 'broken', 'package.json'), 'utf8')).resolves.toBe(
      '{ not json',
    );
    await expect(stat(join(worlds(), 'broken', 'world.json'))).rejects.toThrow();
  });
});
