// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { planUpload, type ManifestEntry } from './directory-upload.js';
import { MemoryFileSource } from './memory-source.js';

/**
 * Which files a browser directory upload carries, and which it only names
 * ([P4 §7.13]).
 *
 * The property under everything here: **`wanted` and `declared` together are the
 * manifest, exactly once each**. A file that fell out of both would be the
 * silent drop this whole design exists to prevent, and it would be invisible —
 * the review would simply not mention it, which is indistinguishable from a
 * folder that never held it.
 */

function entries(...paths: string[]): ManifestEntry[] {
  return paths.map((path) => ({ path, bytes: 10 }));
}

const HUGE = 1_000_000;

describe('what a SillyTavern tree has to carry', () => {
  const TREE = entries(
    'settings.json',
    'characters/Vera.png',
    'worlds/Rain City.json',
    'OpenAI Settings/Harbour.json',
    'User Avatars/inspector.png',
    'chats/Vera/2026-01-01.jsonl',
    'backups/settings_2026.json',
    'thumbnails/bg/beach.png',
    'vectors/index.bin',
  );

  it('carries the library and only names the rest', () => {
    const plan = planUpload('sillytavern', TREE, HUGE);

    expect(plan.wanted).toEqual([
      'settings.json',
      'characters/Vera.png',
      'worlds/Rain City.json',
      'OpenAI Settings/Harbour.json',
      'User Avatars/inspector.png',
    ]);
    // Chats, backups, thumbnails and vectors are the bulk of a real install and
    // the importer never opens one of them. Sending them to be told they were
    // skipped is the thing this avoids.
    expect(plan.declared).toEqual([
      'chats/Vera/2026-01-01.jsonl',
      'backups/settings_2026.json',
      'thumbnails/bg/beach.png',
      'vectors/index.bin',
    ]);
  });

  it('carries settings.json, which belongs to no directory', () => {
    // A persona is a join between the settings file and `User Avatars/`, so the
    // file is read even though it is not in any directory the registry lists.
    // Routing purely by top-level directory would drop it.
    const plan = planUpload('sillytavern', entries('settings.json'), HUGE);
    expect(plan.wanted).toEqual(['settings.json']);
  });

  it('does not carry a directory the registry does not know', () => {
    const plan = planUpload('sillytavern', entries('something-new/file.json'), HUGE);
    expect(plan.wanted).toEqual([]);
    expect(plan.declared).toEqual(['something-new/file.json']);
  });

  it('is not fooled by a directory named after a property of Object', () => {
    // The prototype-chain hole [P4 §7.8] found on the walker's side of this
    // registry: a bare lookup hands `constructor` a function, which is neither
    // `'converted'` nor absent, and the comparison would answer whatever the
    // author of the comparison happened to write.
    const plan = planUpload(
      'sillytavern',
      entries('constructor/x.json', 'toString/y.json', '__proto__/z.json'),
      HUGE,
    );
    expect(plan.wanted).toEqual([]);
  });
});

describe('what a Marinara data root has to carry', () => {
  it('carries the store and the four asset trees', () => {
    const plan = planUpload(
      'marinara',
      entries(
        'storage/manifest.json',
        'storage/tables/characters.json',
        'avatars/char_vera.png',
        'sprites/vera/happy.png',
        'lorebooks/images/map.png',
        'prompts/images/banner.png',
        'gallery/holiday.png',
        'fonts/serif.woff2',
      ),
      HUGE,
    );

    expect(plan.wanted).toEqual([
      'storage/manifest.json',
      'storage/tables/characters.json',
      'avatars/char_vera.png',
      'sprites/vera/happy.png',
      'lorebooks/images/map.png',
      'prompts/images/banner.png',
    ]);
    expect(plan.declared).toEqual(['gallery/holiday.png', 'fonts/serif.woff2']);
  });
});

describe('a folder nobody arranged', () => {
  it('carries everything, because the probe reads every file', () => {
    // [P4 §7.8]: a loose root has no positions to route by, so it asks each file
    // what it is. There is nothing to narrow and pretending otherwise would make
    // the transport quietly worse than the server-path sweep at the same job.
    const plan = planUpload('loose-files', entries('a.png', 'b.json', 'notes/c.txt'), HUGE);
    expect(plan.wanted).toEqual(['a.png', 'b.json', 'notes/c.txt']);
    expect(plan.declared).toEqual([]);
  });
});

describe('the budget', () => {
  it('declares what will not fit rather than truncating silently', () => {
    const plan = planUpload(
      'loose-files',
      [
        { path: 'small.json', bytes: 10 },
        { path: 'huge.png', bytes: 5_000 },
        { path: 'also-small.json', bytes: 10 },
      ],
      100,
    );

    expect(plan.wanted).toEqual(['small.json', 'also-small.json']);
    expect(plan.declared).toEqual(['huge.png']);
    expect(plan.wantedBytes).toBe(20);
  });

  it('accounts for every entry exactly once, whatever the budget', () => {
    // The property. A file in neither list is one the review cannot mention.
    const manifest = entries(
      'settings.json',
      'characters/Vera.png',
      'chats/a.jsonl',
      'worlds/W.json',
      'vectors/i.bin',
    );

    for (const budget of [0, 15, 25, HUGE]) {
      const plan = planUpload('sillytavern', manifest, budget);
      expect([...plan.wanted, ...plan.declared].sort()).toEqual(
        manifest.map((entry) => entry.path).sort(),
      );
    }
  });
});

describe('a path that is named but not carried', () => {
  it('is listed and found, and reads as nothing', async () => {
    const files = new MemoryFileSource({ 'worlds/Rain City.json': '{}' }, ['chats/a.jsonl']);

    expect(await files.exists('chats/a.jsonl')).toBe(true);
    expect(await files.exists('chats')).toBe(true);
    expect(await files.read('chats/a.jsonl')).toBeNull();

    const listed: string[] = [];
    for await (const path of files.list()) listed.push(path);
    // Both, because a walker that never saw the declared one could not report
    // it, and a report that omits what it did not carry is the silent drop.
    expect(listed.sort()).toEqual(['chats/a.jsonl', 'worlds/Rain City.json']);
  });

  it('never shadows bytes that did arrive', async () => {
    // A caller that sends the whole manifest as `declared` and the carried
    // subset as files needs no filtering of its own; bytes win.
    const files = new MemoryFileSource({ 'a.json': '{"real":true}' }, ['a.json', 'b.json']);

    expect(new TextDecoder().decode((await files.read('a.json'))!)).toBe('{"real":true}');
    const listed: string[] = [];
    for await (const path of files.list()) listed.push(path);
    expect(listed.sort()).toEqual(['a.json', 'b.json']);
  });
});
