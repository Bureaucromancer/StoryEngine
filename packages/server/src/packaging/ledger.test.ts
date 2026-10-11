// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PUBLISH_RECORD_SCHEMA, type PublishRecord } from '@storyengine/shared';

import { Layout } from '../storage/layout.js';
import { appendPublishRecord, lastPublishOf, readPublishRecords } from './ledger.js';

/**
 * ***The publish ledger*** — `users/<handle>/publishes.jsonl`,
 * [16 §5](../../../../docs/design/16-publish.md),
 * [16 §8](../../../../docs/design/16-publish.md), [P16.3d].
 *
 * Four claims, each one a reader or a writer depends on. **Appended in order
 * and read newest first**, without trusting the clock, because the diff a
 * re-publish opens on reads the newest line ([P16.3h]). **Filtered by World**,
 * because a World's page counts its own. **What it cannot read it skips** — a
 * torn last line, a later schema, a hand-edited line with no shape — rather
 * than failing every read of the account. And **an append never throws**,
 * because by the time it runs the file has been delivered and there is nobody
 * left to tell (`usage/log.ts`'s posture, whose tests these mirror).
 */

let dataDir: string;
let layout: Layout;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-ledger-'));
  layout = new Layout(dataDir);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function aRecord(over: Partial<PublishRecord> = {}): PublishRecord {
  return {
    schema: PUBLISH_RECORD_SCHEMA,
    at: '2026-10-10T12:00:00.000Z',
    build: null,
    origin: 'world',
    start: ['w-1'],
    world: { id: 'w-1', name: 'Rain City', kept: 'existing' },
    fileName: 'Rain-City.seworld',
    bytes: 1234,
    entries: 5,
    objects: [{ schema: 'storyengine.actor/1', id: 'a-1', name: 'Vera', contentHash: 'sha256:a' }],
    sessions: [],
    offered: { objects: 3, sessions: 1 },
    unticked: [],
    ticked: [],
    history: false,
    justTheObject: false,
    missing: 0,
    drift: false,
    ...over,
  };
}

describe('the publish ledger', () => {
  it('lives in the account’s own directory, beside usage.jsonl', () => {
    // Against the layout's resolved root (F26), as `usage/log.test.ts` does.
    expect(layout.publishLogFile('ned')).toBe(
      join(layout.dataRoot, 'users', 'ned', 'publishes.jsonl'),
    );
  });

  it('appends one line per publish and reads them back newest first', async () => {
    await appendPublishRecord(layout, 'ned', aRecord({ fileName: 'first.seworld' }));
    await appendPublishRecord(layout, 'ned', aRecord({ fileName: 'second.seworld' }));
    await appendPublishRecord(layout, 'ned', aRecord({ fileName: 'third.seworld' }));

    const text = await readFile(layout.publishLogFile('ned'), 'utf8');
    expect(text.split('\n').filter((line) => line !== '')).toHaveLength(3);
    const records = await readPublishRecords(layout, 'ned');
    expect(records.map((one) => one.fileName)).toEqual([
      'third.seworld',
      'second.seworld',
      'first.seworld',
    ]);
  });

  /**
   * ***Newest is the last appended, whatever `at` says.*** A clock moved back
   * between two publishes must not make the diff open against the older one.
   */
  it('orders by the file, not by a clock that moved back', async () => {
    await appendPublishRecord(layout, 'ned', aRecord({ at: '2026-10-10T12:00:00.000Z', bytes: 1 }));
    await appendPublishRecord(layout, 'ned', aRecord({ at: '2020-01-01T00:00:00.000Z', bytes: 2 }));
    expect((await lastPublishOf(layout, 'ned', 'w-1'))?.bytes).toBe(2);
  });

  it('keeps every line when publishes land together', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        appendPublishRecord(layout, 'ned', aRecord({ bytes: index })),
      ),
    );
    expect(await readPublishRecords(layout, 'ned')).toHaveLength(20);
  });

  it('filters by World, and answers the newest of one, or nothing', async () => {
    const other = { id: 'w-2', name: 'Elsewhere', kept: 'created' as const };
    await appendPublishRecord(layout, 'ned', aRecord({ bytes: 1 }));
    await appendPublishRecord(layout, 'ned', aRecord({ world: other, bytes: 2 }));
    await appendPublishRecord(
      layout,
      'ned',
      aRecord({ origin: 'object', world: null, start: ['a-1'], bytes: 3 }),
    );
    await appendPublishRecord(layout, 'ned', aRecord({ bytes: 4 }));

    const mine = await readPublishRecords(layout, 'ned', { world: 'w-1' });
    expect(mine.map((one) => one.bytes)).toEqual([4, 1]);
    expect((await readPublishRecords(layout, 'ned')).map((one) => one.bytes)).toEqual([4, 3, 2, 1]);
    expect((await lastPublishOf(layout, 'ned', 'w-2'))?.bytes).toBe(2);
    expect(await lastPublishOf(layout, 'ned', 'w-nowhere')).toBeNull();
    // Another account's ledger is another file.
    expect(await readPublishRecords(layout, 'mari')).toEqual([]);
  });

  /**
   * ***What it cannot read, it skips.*** A torn last line (a crash or a full
   * disk mid-append), a later build's schema, a line that parses and is not a
   * record — none of them is a reason to answer *never published*, or to fail
   * the World page.
   */
  it('skips a torn last line, an unknown schema and a line with no shape', async () => {
    await appendPublishRecord(layout, 'ned', aRecord({ bytes: 1 }));
    const path = layout.publishLogFile('ned');
    await appendFile(
      path,
      [
        JSON.stringify({ ...aRecord({ bytes: 2 }), schema: 'storyengine.publish-record/2' }),
        JSON.stringify({ ...aRecord({ bytes: 3 }), world: 'w-1' }),
        JSON.stringify({ ...aRecord({ bytes: 4 }), objects: null }),
        '[1, 2, 3]',
        '',
      ].join('\n'),
    );
    await appendFile(path, '{"schema":"storyengine.publish-record/1","at":"2026-10-1');

    expect((await readPublishRecords(layout, 'ned')).map((one) => one.bytes)).toEqual([1]);
    expect((await lastPublishOf(layout, 'ned', 'w-1'))?.bytes).toBe(1);

    // And the next append closes the torn tail off rather than joining it.
    await appendPublishRecord(layout, 'ned', aRecord({ bytes: 5 }));
    expect((await readPublishRecords(layout, 'ned')).map((one) => one.bytes)).toEqual([5, 1]);
  });

  it('reads no file as no records', async () => {
    expect(await readPublishRecords(layout, 'ned')).toEqual([]);
    expect(await lastPublishOf(layout, 'ned', 'w-1')).toBeNull();
  });

  /**
   * ***A receipt that cannot be written does not fail anything.*** Two ways
   * down: a handle the layout will not resolve, and an account directory where
   * a file stands in the way, so the append itself fails on the disk.
   */
  it('never throws on an append that cannot be written', async () => {
    await expect(appendPublishRecord(layout, '../escape', aRecord())).resolves.toBeUndefined();

    await mkdir(join(layout.dataRoot, 'users'), { recursive: true });
    await writeFile(join(layout.dataRoot, 'users', 'ned'), 'a file, not a directory');
    await expect(appendPublishRecord(layout, 'ned', aRecord())).resolves.toBeUndefined();
  });
});
