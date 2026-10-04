// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { planUpload, type ManifestEntry } from './directory-upload.js';
import { MemoryFileSource } from './memory-source.js';
import { MARINARA_DISPOSITIONS } from './registries/marinara.js';

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
  /**
   * ~~carries the store and the four asset trees~~ — *corrected 2026-10-02*.
   * The reader attaches `avatars/` alone; `sprites/`, `lorebooks/images/` and
   * `prompts/images/` have been `recorded` by name since 2026-09-27, and their
   * row is the same whether their bytes came or not. So they are named, not
   * sent, however large the budget.
   */
  it('carries the store and the portraits, and names the pictures it only records', () => {
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
    ]);
    expect(plan.declared).toEqual([
      'sprites/vera/happy.png',
      'lorebooks/images/map.png',
      'prompts/images/banner.png',
      'gallery/holiday.png',
      'fonts/serif.woff2',
    ]);
    expect(plan.overLimit).toEqual([]);
  });

  /**
   * ***A tree of expressions can never cost a chat*** (2026-10-02). With the
   * pictures ranked ahead of the chats, sixty megabytes of sprites under the
   * default limit carried every sprite and cut the message shard — every
   * session in the store gone, for bytes nothing opens.
   */
  it('spends nothing on pictures it only records, whatever they would push out', () => {
    const MB = 1024 * 1024;
    const sprites = Array.from({ length: 30 }, (_, i) => ({
      path: `sprites/vera/expression-${String(i)}.png`,
      bytes: 2 * MB,
    }));
    const plan = planUpload(
      'marinara',
      [
        ...sprites,
        { path: 'storage/manifest.json', bytes: 1_000 },
        { path: 'storage/tables/characters.json.pre-shard', bytes: 4 * MB },
        { path: 'storage/tables/chats/chat%5F1.json', bytes: 2_000 },
        { path: 'storage/tables/messages/chat%5F1.json', bytes: 8 * MB },
      ],
      64 * MB,
    );

    expect(plan.wanted).toEqual([
      'storage/manifest.json',
      'storage/tables/characters.json.pre-shard',
      'storage/tables/chats/chat%5F1.json',
      'storage/tables/messages/chat%5F1.json',
    ]);
    // Declared, and not over the limit: nothing wanted them.
    expect(plan.overLimit).toEqual([]);
  });
});

describe('what a Marinara store spends its budget on first', () => {
  /**
   * **Priority, not the browser's order** ([P4 §7.18]). From storage format 5
   * every chat is a directory of shards under `storage/`, and a picker that
   * lists them first used to spend the whole budget before reaching the one
   * directory of characters — which then arrived declared, read as nothing, and
   * imported as nothing.
   *
   * ~~the chats it only reports~~ *Since [P14.10] the reader converts them
   * too*, so they are wanted — after the library, and named in `overLimit` when
   * the limit cuts them, since nobody was asked about them first.
   */
  it('carries the library before the chats, and names the chats it cut', () => {
    const plan = planUpload(
      'marinara',
      [
        { path: 'storage/tables/messages/chat%5F1.json', bytes: 400 },
        { path: 'storage/tables/messages/chat%5F2.json', bytes: 400 },
        { path: 'storage/tables/characters/char%5Fvera.json', bytes: 50 },
        { path: 'storage/tables/characters/char%5Fvera.json.bak', bytes: 50 },
        { path: 'avatars/char_vera.png', bytes: 100 },
        { path: 'storage/manifest.json', bytes: 5 },
      ],
      300,
    );

    // Wanted in manifest order, which the upload route relies on.
    expect(plan.wanted).toEqual([
      'storage/tables/characters/char%5Fvera.json',
      'storage/tables/characters/char%5Fvera.json.bak',
      'avatars/char_vera.png',
      'storage/manifest.json',
    ]);
    expect(plan.declared).toEqual([
      'storage/tables/messages/chat%5F1.json',
      'storage/tables/messages/chat%5F2.json',
    ]);
    expect(plan.overLimit).toEqual([
      'storage/tables/messages/chat%5F1.json',
      'storage/tables/messages/chat%5F2.json',
    ]);
  });

  /**
   * **A shard and its backup travel together.** The reader reads a `.bak` when
   * its primary reads as nothing — and a declared primary reads as nothing — so
   * a budget that carried the backup and not the primary would import the
   * backup, one save stale. *(2026-10-02: the rank alone did not hold that —
   * this case had the backup listed first and the two the same size, and the
   * case beside it, where they are not, failed. A backup is now decided after
   * its primary, which this case also holds: listed first, it is still
   * decided second.)*
   */
  it('never carries a backup its primary was ranked below', () => {
    const plan = planUpload(
      'marinara',
      [
        { path: 'storage/tables/characters/char%5Fvera.json.bak', bytes: 50 },
        { path: 'avatars/char_vera.png', bytes: 60 },
        { path: 'storage/tables/characters/char%5Fvera.json', bytes: 50 },
      ],
      100,
    );

    expect(plan.wanted).toContain('storage/tables/characters/char%5Fvera.json');
    expect(plan.declared).toEqual(['avatars/char_vera.png']);
  });

  /**
   * ***The edge of the limit is where the rank alone did not hold them
   * together*** (2026-10-02). A file that does not fit is passed over for a
   * later one that does, and a message shard's `.bak` is one save older and
   * smaller than its primary — so a budget between the two sizes cut the
   * primary and carried the backup, the store read the backup in its place,
   * and the session came in one save short under a review that said only
   * *over the limit*. A backup is decided after its primary and never carried
   * without it.
   */
  it('never carries a backup whose primary the budget cut', () => {
    const plan = planUpload(
      'marinara',
      [
        { path: 'storage/manifest.json', bytes: 10 },
        { path: 'storage/tables/chats/chat%5F1.json', bytes: 20 },
        { path: 'storage/tables/messages/chat%5F1.json', bytes: 150 },
        { path: 'storage/tables/messages/chat%5F1.json.bak', bytes: 130 },
      ],
      // Everything but the primary, and a little over: room for the backup alone.
      10 + 20 + 130 + 10,
    );

    expect(plan.wanted).toEqual(['storage/manifest.json', 'storage/tables/chats/chat%5F1.json']);
    expect(plan.overLimit).toEqual([
      'storage/tables/messages/chat%5F1.json',
      'storage/tables/messages/chat%5F1.json.bak',
    ]);
  });

  /**
   * *The same at the library's rank, and for the manifest*: a character read
   * from a stale `.bak`, or a store read against last save's counts, is the
   * same wrong answer as a chat.
   */
  it('holds the library and the manifest to the same rule', () => {
    const plan = planUpload(
      'marinara',
      [
        { path: 'storage/manifest.json.bak', bytes: 10 },
        { path: 'storage/manifest.json', bytes: 80 },
        { path: 'storage/tables/characters/char%5Fvera.json.bak', bytes: 50 },
        { path: 'storage/tables/characters/char%5Fvera.json', bytes: 80 },
        { path: 'avatars/char_vera.png', bytes: 30 },
      ],
      70,
    );

    // Both backups fit, and neither primary does: neither backup goes, and
    // the budget they would have spent carries what fits honestly.
    expect(plan.wanted).toEqual(['avatars/char_vera.png']);
    expect(plan.overLimit).toEqual([
      'storage/manifest.json.bak',
      'storage/manifest.json',
      'storage/tables/characters/char%5Fvera.json.bak',
      'storage/tables/characters/char%5Fvera.json',
    ]);
  });

  /**
   * *A primary travels without its backup*, because the reader opens a backup
   * only in place of a primary that cannot be read — and every primary of a
   * rank comes before any backup of it, so a second chat is worth more than
   * the first chat's spare copy.
   */
  it('carries every primary of a rank before any backup of it', () => {
    const plan = planUpload(
      'marinara',
      [
        { path: 'storage/tables/messages/chat%5F1.json', bytes: 50 },
        { path: 'storage/tables/messages/chat%5F1.json.bak', bytes: 40 },
        { path: 'storage/tables/messages/chat%5F2.json', bytes: 50 },
        { path: 'storage/tables/messages/chat%5F2.json.bak', bytes: 40 },
      ],
      100,
    );

    expect(plan.wanted).toEqual([
      'storage/tables/messages/chat%5F1.json',
      'storage/tables/messages/chat%5F2.json',
    ]);
  });

  /** *A backup with no primary in the folder is the table's only copy*, and travels. */
  it('carries a backup whose primary the folder does not hold', () => {
    const plan = planUpload(
      'marinara',
      [{ path: 'storage/tables/messages/chat%5F1.json.bak', bytes: 40 }],
      100,
    );

    expect(plan.wanted).toEqual(['storage/tables/messages/chat%5F1.json.bak']);
  });

  /**
   * ~~`storage/tables/messages/chat%5F1.json`~~ was the first of these until
   * [P14.10] made the reader open the chats; it moved to the chats' own test
   * below. `agent_runs` is chat-scoped and still only `recorded`.
   */
  it('only names what it never reads, however large the budget', () => {
    const plan = planUpload(
      'marinara',
      entries(
        'storage/tables/agent_runs/chat%5F1.json',
        'storage/tables/noodle_posts/acct.json',
        'storage/tables/characters/char%5Fvera.json.tmp-1-2',
        'storage/tables/characters/.migrating',
      ),
      HUGE,
    );

    expect(plan.wanted).toEqual([]);
  });

  /**
   * ~~last~~ — after the pictures, and still ahead of the chats, which a test
   * below holds.
   */
  it('carries a pre-migration backup after the pictures, since it is read only when nothing else is', () => {
    const plan = planUpload(
      'marinara',
      [
        { path: 'storage/tables/characters.json.pre-shard', bytes: 90 },
        { path: 'avatars/char_vera.png', bytes: 60 },
      ],
      100,
    );

    expect(plan.wanted).toEqual(['avatars/char_vera.png']);
  });

  /**
   * ***The chats travel too*** — [P14.10] reads them from the store, so a
   * folder that came by browser has to bring them, or every chat would import
   * from a path and none from an upload. The same grammar as the library's
   * tables: a shard and its `.bak`, never the store's leftovers or a file
   * synced beside it, and never a timestamped pre-migration backup, which the
   * store does not restore from.
   */
  it('carries the chats, however large the budget, by the same grammar as the library', () => {
    const plan = planUpload(
      'marinara',
      entries(
        'storage/tables/chats/chat%5F1.json',
        'storage/tables/messages/chat%5F1.json',
        'storage/tables/messages/chat%5F1.json.bak',
        'storage/tables/message_swipes/chat%5F1.json',
        'storage/tables/game_state_snapshots/chat%5F1.json',
        'storage/tables/agent_memory/chat%5F1.json',
        'storage/tables/messages/chat%5F1.json.tmp-1-2',
        'storage/tables/messages/.migrating',
        'storage/tables/messages/._chat%5F1.json',
        'storage/tables/messages.json.pre-shard-2026-08-20T00-00-00-000Z',
      ),
      HUGE,
    );

    expect(plan.wanted).toEqual([
      'storage/tables/chats/chat%5F1.json',
      'storage/tables/messages/chat%5F1.json',
      'storage/tables/messages/chat%5F1.json.bak',
      'storage/tables/message_swipes/chat%5F1.json',
      'storage/tables/game_state_snapshots/chat%5F1.json',
      'storage/tables/agent_memory/chat%5F1.json',
    ]);
    // Never a choice, so never counted as one.
    expect(plan.chats).toEqual({ count: 0, bytes: 0, fit: { count: 0, bytes: 0 } });
  });

  /**
   * **A chat can never cost a card** ([P14.8]'s rule, kept for a store whose
   * chats nobody is asked about). A library table's pre-migration backup is the
   * table itself when nothing else is there, so it outranks every chat; a chat
   * table's own backup comes after every chat.
   */
  it('spends what the library left on the chats, and only then on their backups', () => {
    const library = planUpload(
      'marinara',
      [
        { path: 'storage/tables/messages/chat%5F1.json', bytes: 50 },
        { path: 'storage/tables/characters.json.pre-shard', bytes: 60 },
      ],
      100,
    );
    expect(library.wanted).toEqual(['storage/tables/characters.json.pre-shard']);
    expect(library.overLimit).toEqual(['storage/tables/messages/chat%5F1.json']);

    const chats = planUpload(
      'marinara',
      [
        { path: 'storage/tables/messages.json.pre-shard', bytes: 50 },
        { path: 'storage/tables/chats/chat%5F1.json', bytes: 60 },
      ],
      100,
    );
    expect(chats.wanted).toEqual(['storage/tables/chats/chat%5F1.json']);
  });

  /**
   * ***The registry decides, not a list kept here*** — a shard of every table
   * it calls `converted` travels, and of no other. So a table converted later
   * cannot stay at home unnoticed, and one that is not — a credential table
   * least of all — is never sent to be told it was dropped.
   */
  it('carries a shard of every table the registry converts, and of no other', () => {
    const tables = Object.keys(MARINARA_DISPOSITIONS);
    const plan = planUpload(
      'marinara',
      entries(...tables.map((table) => `storage/tables/${table}/x.json`)),
      HUGE,
    );

    expect(plan.wanted).toEqual(
      tables
        .filter((table) => MARINARA_DISPOSITIONS[table] === 'converted')
        .map((table) => `storage/tables/${table}/x.json`),
    );
    expect(plan.declared).toContain('storage/tables/api_connections/x.json');
  });

  /**
   * **One limit, spent once, across the library and the chats together** —
   * the running total `POST /import/directory` enforces across the whole
   * folder, which the two halves of this transport once disagreed about.
   */
  it('accounts for every entry once and stays inside the limit, whatever the budget', () => {
    const STORE: ManifestEntry[] = [
      { path: 'storage/tables/messages/chat%5F1.json', bytes: 400 },
      { path: 'storage/tables/chats/chat%5F1.json', bytes: 30 },
      { path: 'storage/tables/characters/char%5Fvera.json', bytes: 50 },
      { path: 'storage/tables/characters.json.pre-shard', bytes: 70 },
      { path: 'avatars/char_vera.png', bytes: 100 },
      { path: 'storage/manifest.json', bytes: 5 },
      { path: 'storage/tables/noodle_posts/acct.json', bytes: 20 },
    ];
    const size = new Map(STORE.map((entry) => [entry.path, entry.bytes]));

    for (const budget of [0, 5, 55, 154, 155, 225, 254, 255, 654, 655, HUGE]) {
      const plan = planUpload('marinara', STORE, budget);

      expect([...plan.wanted, ...plan.declared].sort()).toEqual(
        STORE.map((entry) => entry.path).sort(),
      );
      const carried = plan.wanted.reduce((sum, path) => sum + (size.get(path) ?? 0), 0);
      expect(plan.wantedBytes).toBe(carried);
      expect(plan.wantedBytes).toBeLessThanOrEqual(budget);
      for (const path of plan.overLimit) expect(plan.declared).toContain(path);
      expect(plan.overLimit).not.toContain('storage/tables/noodle_posts/acct.json');
    }
    expect(planUpload('marinara', STORE, HUGE).wantedBytes).toBe(655);
  });
});

/**
 * ***An Aventuras folder*** — [P13.2](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 * One database, its log and a backup's note; and the database and its log are
 * one thing, which the budget may not split (found at the P13.2 review).
 */
describe('what an Aventuras folder has to carry', () => {
  const FOLDER: ManifestEntry[] = [
    { path: 'aventura.db', bytes: 1_000 },
    { path: 'aventura.db-wal', bytes: 200 },
    { path: 'aventura.db-shm', bytes: 32 },
    { path: 'metadata.json', bytes: 10 },
    { path: 'stories/the-drowned-bell.avt', bytes: 50 },
  ];

  it('carries the database, its log and the note, and only names the rest', () => {
    const plan = planUpload('aventuras', FOLDER, HUGE);

    expect(plan.wanted).toEqual(['aventura.db', 'aventura.db-wal', 'metadata.json']);
    // The index of the log is not data, and an older backup's stories are in
    // the database already.
    expect(plan.declared).toEqual(['aventura.db-shm', 'stories/the-drowned-bell.avt']);
  });

  it('never carries the database without its log', () => {
    // Room for the database and not for its log: carrying the one would hand
    // the reader an older database that looks whole. Both are declared, and
    // what still fits is carried.
    const plan = planUpload('aventuras', FOLDER, 1_100);

    expect(plan.wanted).toEqual(['metadata.json']);
    expect(plan.declared).toEqual([
      'aventura.db',
      'aventura.db-wal',
      'aventura.db-shm',
      'stories/the-drowned-bell.avt',
    ]);
    expect(plan.wantedBytes).toBe(10);
  });

  it('decides the pair together whichever the manifest names first', () => {
    const reversed = [FOLDER[1]!, FOLDER[0]!, FOLDER[3]!];

    expect(planUpload('aventuras', reversed, 1_200).wanted).toEqual([
      'aventura.db-wal',
      'aventura.db',
    ]);
    expect(planUpload('aventuras', reversed, 1_199).wanted).toEqual(['metadata.json']);
  });

  it('carries a database with no log beside it on its own', () => {
    const plan = planUpload('aventuras', [FOLDER[0]!, FOLDER[3]!], 1_000);

    expect(plan.wanted).toEqual(['aventura.db']);
    expect(plan.declared).toEqual(['metadata.json']);
  });

  it('accounts for every entry exactly once, whatever the budget', () => {
    for (const budget of [0, 10, 1_000, 1_199, 1_200, 1_210, HUGE]) {
      const plan = planUpload('aventuras', FOLDER, budget);
      expect([...plan.wanted, ...plan.declared].sort()).toEqual(
        FOLDER.map((entry) => entry.path).sort(),
      );
      expect(plan.wantedBytes).toBeLessThanOrEqual(budget);
    }
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

  /**
   * ***And names what the limit left out, apart from what nobody wanted***
   * (2026-09-28). Both are `declared`; only one is news. A card too big to
   * send read as *not recognised* in the review, which sent people looking
   * for a broken card rather than at the limit.
   */
  it('names the library files the budget left out, and nothing else', () => {
    const plan = planUpload(
      'sillytavern',
      [
        { path: 'settings.json', bytes: 10 },
        { path: 'characters/Vera.png', bytes: 5_000 },
        { path: 'worlds/Rain City.json', bytes: 10 },
        { path: 'thumbnails/bg/beach.png', bytes: 10 },
        { path: 'chats/Vera/2026-01-01.jsonl', bytes: 10 },
      ],
      100,
    );

    // The card the limit cut; not the thumbnail nobody wanted, nor the chat,
    // which has its own count.
    expect(plan.overLimit).toEqual(['characters/Vera.png']);
    expect(plan.declared).toContain('thumbnails/bg/beach.png');
  });

  it('names a whole bundle the budget left out', () => {
    const plan = planUpload(
      'aventuras',
      [
        { path: 'aventura.db', bytes: 5_000 },
        { path: 'aventura.db-wal', bytes: 10 },
        { path: 'metadata.json', bytes: 10 },
      ],
      100,
    );

    // The database and its log, cut together; the note fitted.
    expect(plan.overLimit).toEqual(['aventura.db', 'aventura.db-wal']);
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

/**
 * ***Chats, only when chosen*** —
 * [P14.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * They are most of a SillyTavern tree's bytes, so the plan leaves them out
 * and says what they would add; asked again with the choice made, it puts
 * them in — after the library, so choosing them can never cost a card.
 */
describe('the chats in a SillyTavern tree', () => {
  const TREE: ManifestEntry[] = [
    { path: 'chats/Vera/2026-01-01.jsonl', bytes: 400 },
    { path: 'settings.json', bytes: 10 },
    { path: 'characters/Vera.png', bytes: 10 },
    { path: 'group chats/1700.jsonl', bytes: 300 },
    { path: 'groups/1700.json', bytes: 20 },
  ];

  it('leaves them out, and says how many and how large', () => {
    const plan = planUpload('sillytavern', TREE, HUGE);

    expect(plan.wanted).toEqual(['settings.json', 'characters/Vera.png']);
    // Two chats — the group's own file is not one — and every byte the choice
    // would send, the group file included, since that is what the limit counts.
    expect(plan.chats).toEqual({ count: 2, bytes: 720, fit: { count: 2, bytes: 720 } });
  });

  it('carries them when chosen, in the manifest’s order', () => {
    const plan = planUpload('sillytavern', TREE, HUGE, { chats: true });

    expect(plan.wanted).toEqual(TREE.map((entry) => entry.path));
    expect(plan.declared).toEqual([]);
    expect(plan.wantedBytes).toBe(740);
  });

  it('spends the budget on the library first, so a long chat listed early cannot push out a card', () => {
    const plan = planUpload('sillytavern', TREE, 100, { chats: true });

    expect(plan.wanted).toEqual(['settings.json', 'characters/Vera.png', 'groups/1700.json']);
    expect(plan.declared).toEqual(['chats/Vera/2026-01-01.jsonl', 'group chats/1700.jsonl']);
  });

  it('says before the choice how much of it the limit will carry', () => {
    // The same budget, asked without the choice: 80 bytes left after the
    // library, so the group's file fits and neither chat does — which the
    // panel has to say before the person agrees to send "the chats".
    const plan = planUpload('sillytavern', TREE, 100);

    expect(plan.chats.fit).toEqual({ count: 0, bytes: 20 });
    expect(plan.limitBytes).toBe(100);
    // Asking changes nothing that was sent.
    expect(plan.wanted).toEqual(['settings.json', 'characters/Vera.png']);
  });

  it('offers no choice for a root whose chats are not files of their own', () => {
    expect(planUpload('marinara', entries('storage/tables/chats.json'), HUGE).chats).toEqual({
      count: 0,
      bytes: 0,
      fit: { count: 0, bytes: 0 },
    });
  });
});

/**
 * ***A loose folder's chats are opt-in too*** — [P14.8] says the browser
 * upload makes chats opt-in, not a SillyTavern tree's upload. A loose root has
 * nothing but names to go on before a byte moves, and a `.jsonl` name is
 * enough to ask; what each file is, the content probe decides once it is sent.
 */
describe('the chats in a loose folder', () => {
  const LOOSE: ManifestEntry[] = [
    { path: 'Vera.png', bytes: 10 },
    { path: 'exports/Vera - 2026-01-01.jsonl', bytes: 400 },
  ];

  it('are counted and held back, like a tree’s', () => {
    const plan = planUpload('loose-files', LOOSE, HUGE);

    expect(plan.wanted).toEqual(['Vera.png']);
    expect(plan.declared).toEqual(['exports/Vera - 2026-01-01.jsonl']);
    expect(plan.chats).toEqual({ count: 1, bytes: 400, fit: { count: 1, bytes: 400 } });
  });

  it('are carried when chosen', () => {
    const plan = planUpload('loose-files', LOOSE, HUGE, { chats: true });

    expect(plan.wanted).toEqual(['Vera.png', 'exports/Vera - 2026-01-01.jsonl']);
    expect(plan.wantedBytes).toBe(410);
  });
});
