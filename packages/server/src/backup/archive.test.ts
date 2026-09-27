// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readBackupManifest, BACKUP_MANIFEST_MEMBER } from '@storyengine/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureDirectory, listTreeFiles, writeFileBytes } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import { readTarGz, writeTarGz } from '../storage/tar-archive.js';
import {
  BackupSpaceError,
  findBackup,
  listBackups,
  readArchiveManifest,
  removeBackup,
  sweepAbandonedBackups,
  takeBackup,
  type BackupContext,
} from './archive.js';

/**
 * ***What an archive carries, and what it must never carry*** —
 * [P12.2](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * This file holds [P11.11](../../../../docs/design/workplan/28-p11-implementation.md)'s
 * proof obligation, inherited and sharpened: ***the index is rebuilt, not
 * carried***, and *"an archive that quietly included the index would pass every
 * other check."* The version of that assertion which shipped could not fail —
 * it tested a filename at the data root and the index is a directory down — so
 * the one here is written against the path, over a fixture that puts the index
 * where [03 §5.1](../../../../docs/design/03-data-model.md) puts it.
 */

let root: string;
let layout: Layout;
let context: BackupContext;
let state: DatabaseSync;

/** The members an archive holds, by name. */
async function membersOf(path: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for await (const member of readTarGz(path)) {
    found.set(member.name, new TextDecoder().decode(member.bytes));
  }
  return found;
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function put(relative: string, text: string): Promise<void> {
  const path = join(root, ...relative.split('/'));
  await ensureDirectory(join(path, '..'));
  await writeFileBytes(path, bytes(text));
}

/** A data directory with the shapes a real one has, including the awkward ones. */
async function populate(): Promise<void> {
  await put('config.json', '{"server":{"port":8080}}');
  await put('accounts.json', '{"accounts":[{"handle":"ned","passwordHash":"scrypt$secret"}]}');
  await put('system/library/actors/narrator/card.png', 'a shipped actor');
  await put('system/connections/house.json', '{"apiKey":"sk-the-house-key"}');

  await put('users/ned/library/actors/vera/card.png', 'vera');
  await put('users/ned/library/lorebooks/rain-city/lorebook.json', '{"name":"Rain City"}');
  await put('users/ned/prefs.json', '{"pane.collapsed":true}');
  await put('users/ned/tags.json', '{"tags":[]}');
  await put('users/ned/connections/mine.json', '{"apiKey":"sk-neds-own-key"}');
  await put('users/ned/sessions/s1/session.json', '{"id":"s1"}');
  await put('users/ned/sessions/s1/turns/000001.jsonl', '{"id":"t1"}\n');
  await put('users/ned/trash/actors/gone-0199/card.png', 'deliberately discarded');

  await put('users/mari/library/actors/dex/card.png', 'dex');
  await put('users/mari/connections/hers.json', '{"apiKey":"sk-maris-key"}');

  await put('state/session.key', 'the key that validates every session');
  await put('state/setup.token', 'the first-run token');
  await put('state/build.json', '{"version":"1.0.0-alpha.4"}');
  await put('removed/old-0199/connections/theirs.json', '{"apiKey":"sk-a-removed-key"}');
  // What a removed account took with it: its own archives, and its trash.
  await put(
    'removed/old-0199/backups/account-old-full-2026-09-01-x.tar.gz',
    'sk-inside-an-archive',
  );
  await put('removed/old-0199/trash/actors/gone-0199/card.png', 'discarded before removal');

  // The derived half, **at the depth it actually has**.
  await put('index/index.sqlite', 'a stale belief about a newer tree');
  await put('index/index.sqlite-wal', 'and its write-ahead log');

  // An older archive, at both of its homes.
  await put('backups/install-full-2026-09-01-x.tar.gz', 'an older archive');
  await put('users/ned/backups/account-ned-full-2026-09-01-x.tar.gz', 'theirs');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'se-archive-'));
  layout = new Layout(root);
  await ensureDirectory(layout.stateRoot);
  state = new DatabaseSync(layout.stateFile);
  state.exec('create table job (id text primary key, account text)');
  state.exec("insert into job values ('job-1', 'ned')");
  context = { layout, state, build: { version: '1.0.0-alpha.4' } as never };
  await populate();
});

afterEach(async () => {
  state.close();
  await rm(root, { recursive: true, force: true });
});

const INSTALL = { kind: 'install' } as const;
const NED = { kind: 'account', handle: 'ned' } as const;

describe('an install backup', () => {
  it('carries the install and everybody in it', async () => {
    const record = await takeBackup(context, {
      owner: INSTALL,
      contents: 'full',
      reason: 'manual',
    });
    const found = await findBackup(context, INSTALL, record.id);
    const members = await membersOf(found!.path);

    expect(members.has('config.json')).toBe(true);
    expect(members.has('accounts.json')).toBe(true);
    expect(members.get('users/ned/library/actors/vera/card.png')).toBe('vera');
    expect(members.get('users/mari/library/actors/dex/card.png')).toBe('dex');
    expect(members.get('users/ned/sessions/s1/turns/000001.jsonl')).toBe('{"id":"t1"}\n');
    expect(members.has('system/library/actors/narrator/card.png')).toBe(true);
  });

  /**
   * ***The clause that makes it a restore rather than a copy.*** Written against
   * the path, because the assertion it replaces tested a filename that no member
   * name can begin with once the index is a directory down — and so passed for
   * six days over archives that carried it every time.
   */
  it('leaves the derived index behind, at the depth it has', async () => {
    const record = await takeBackup(context, {
      owner: INSTALL,
      contents: 'full',
      reason: 'manual',
    });
    const found = await findBackup(context, INSTALL, record.id);
    const members = await membersOf(found!.path);

    expect([...members.keys()].filter((name) => name.startsWith('index/'))).toEqual([]);
  });

  it('leaves the trash behind, which 03 §10.2 has always said', async () => {
    const record = await takeBackup(context, {
      owner: INSTALL,
      contents: 'full',
      reason: 'manual',
    });
    const found = await findBackup(context, INSTALL, record.id);
    const members = await membersOf(found!.path);

    expect([...members.keys()].filter((name) => name.includes('/trash/'))).toEqual([]);
  });

  /**
   * ***A removed account's archives and trash stay behind too.*** Removal moves
   * the directory whole to `removed/`, so they used to be archived from there:
   * every install archive, `redacted` ones included, carried the removed
   * account's own full archives with their provider keys in them.
   *
   * Catches: dropping the `removed/` rule from `alwaysSkipped`.
   */
  it('leaves a removed account’s archives and trash behind, redacted or not', async () => {
    for (const contents of ['full', 'redacted'] as const) {
      const record = await takeBackup(context, { owner: INSTALL, contents, reason: 'manual' });
      const found = await findBackup(context, INSTALL, record.id);
      const names = [...(await membersOf(found!.path)).keys()];

      expect(names.filter((name) => name.startsWith('removed/old-0199/backups'))).toEqual([]);
      expect(names.filter((name) => name.startsWith('removed/old-0199/trash'))).toEqual([]);
    }
  });

  /**
   * ***No room, found before anything is written*** (2026-09-27). A backup used
   * to learn it did not fit by filling the disk, as a `.part` grown until
   * `ENOSPC` and then unlinked: for that moment the server could not save a
   * turn. Nor may the snapshot be written first, because it is a full copy of
   * the operational store.
   *
   * Catches: a room check after the snapshot, or none.
   */
  it('refuses a backup there is no room for, and writes nothing to find out', async () => {
    const full = { ...context, freeBytes: () => Promise.resolve(1024 * 1024) };
    const before = await listTreeFiles(layout.backupsRoot);
    // The snapshot would be unlinked again afterwards, so it is caught asking.
    const exec = vi.spyOn(state, 'exec');

    await expect(
      takeBackup(full, { owner: INSTALL, contents: 'full', reason: 'manual' }),
    ).rejects.toBeInstanceOf(BackupSpaceError);

    expect(await listTreeFiles(layout.backupsRoot)).toEqual(before);
    expect(exec.mock.calls.filter(([sql]) => sql.includes('VACUUM INTO'))).toEqual([]);
  });

  /** A disk that will not say how much is free is not a full one. */
  it('takes one when the disk will not say how much room there is', async () => {
    const unknown = { ...context, freeBytes: () => Promise.resolve(null) };

    const record = await takeBackup(unknown, {
      owner: INSTALL,
      contents: 'full',
      reason: 'manual',
    });

    expect(record.bytes).toBeGreaterThan(0);
  });

  /**
   * ***What a killed backup leaves, and only that.*** The `finally`s that
   * remove a `.part` and a snapshot do not run in a process that was killed,
   * so both used to stay for good: invisible to the listing, and as large as
   * what they copied.
   *
   * Catches: a sweep that misses a home, and one that takes anything else.
   */
  it('sweeps what an interrupted backup left, and nothing else', async () => {
    await put('backups/install-full-2026-09-27-x.tar.gz.part', 'half an archive');
    await put('users/ned/backups/account-ned-full-2026-09-27-x.tar.gz.part', 'half of theirs');
    await put('state/state.snapshot-0199aaaa.sqlite', 'a copy of the store');
    await put('users/@eaDir/backups/thumbs.part', 'a NAS indexer’s, not ours');

    expect(await sweepAbandonedBackups(layout)).toBe(3);

    const left = [
      ...(await listTreeFiles(layout.backupsRoot)),
      ...(await listTreeFiles(layout.userBackupsRoot('ned'))),
      ...(await listTreeFiles(layout.stateRoot)),
    ].map((file) => file.name);
    expect(left.filter((name) => name.endsWith('.part') || name.includes('snapshot'))).toEqual([]);
    // The finished archives and the live store stay.
    expect(left).toContain('install-full-2026-09-01-x.tar.gz');
    expect(left).toContain('account-ned-full-2026-09-01-x.tar.gz');
    expect(left).toContain('state.sqlite');
  });

  /** An archive of the archives makes every generation carry every one before it. */
  it('leaves the stored backups behind, at both of their homes', async () => {
    const record = await takeBackup(context, {
      owner: INSTALL,
      contents: 'full',
      reason: 'manual',
    });
    const found = await findBackup(context, INSTALL, record.id);
    const members = await membersOf(found!.path);

    expect([...members.keys()].filter((name) => name.includes('backups/'))).toEqual([]);
  });

  /**
   * ***The install a restore replaced is not part of this one.*** Since the
   * swap moved inside the data directory (2026-09-27), the undo sits at
   * `.restore/<id>/replaced`, and an archive that took it would carry a whole
   * second install, and the next would carry both.
   *
   * Catches: dropping `.restore` from `alwaysSkipped`.
   */
  it('leaves a restore’s kept install behind', async () => {
    await put('.restore/0199-old/replaced/users/ned/library/actors/vera/card.png', 'the old vera');
    await put('.restore/swap.json', '{"schema":"storyengine.restore-swap/1"}');

    const record = await takeBackup(context, {
      owner: INSTALL,
      contents: 'full',
      reason: 'manual',
    });
    const found = await findBackup(context, INSTALL, record.id);
    const members = await membersOf(found!.path);

    expect([...members.keys()].filter((name) => name.startsWith('.restore'))).toEqual([]);
    // And the rest is still there, so the filter above is not passing over nothing.
    expect(members.has('users/ned/library/actors/vera/card.png')).toBe(true);
  });

  /**
   * ***A snapshot, not a copy*** — [21 §5.1] makes `state.sqlite` authoritative
   * and not rebuildable, so it is the one file here whose torn copy loses
   * something. `VACUUM INTO` is what the script cannot do and is the concrete
   * form of [25 E6]'s quiesce argument being answered rather than restated.
   */
  it('carries the operational store as a readable database, and not its write-ahead log', async () => {
    const record = await takeBackup(context, {
      owner: INSTALL,
      contents: 'full',
      reason: 'manual',
    });
    const found = await findBackup(context, INSTALL, record.id);
    const members = await membersOf(found!.path);

    expect(members.has('state/state.sqlite')).toBe(true);
    expect([...members.keys()].filter((name) => /-wal$|-shm$/.test(name))).toEqual([]);
    // And no snapshot left lying in `state/` afterwards.
    expect([...members.keys()].filter((name) => name.includes('snapshot'))).toEqual([]);
  });

  it('puts the manifest first, so a reader can say what it holds before inflating it', async () => {
    const record = await takeBackup(context, {
      owner: INSTALL,
      contents: 'full',
      reason: 'schedule',
    });
    const found = await findBackup(context, INSTALL, record.id);

    const names: string[] = [];
    for await (const member of readTarGz(found!.path)) names.push(member.name);
    expect(names[0]).toBe(BACKUP_MANIFEST_MEMBER);

    const members = await membersOf(found!.path);
    const manifest = readBackupManifest(JSON.parse(members.get(BACKUP_MANIFEST_MEMBER)!));
    expect('reason' in manifest && typeof manifest.reason === 'string').toBe(true);
    if ('schema' in manifest) {
      expect(manifest.scope).toBe('install');
      expect(manifest.contents).toBe('full');
      expect(manifest.reason).toBe('schedule');
      expect(manifest.handle).toBeNull();
      expect(manifest.handles).toEqual(['mari', 'ned']);
      expect(manifest.unpackedBytes).toBeGreaterThan(0);
      expect(manifest.files).toBe(names.length - 1);
    }
  });

  /**
   * ***The read that stops at the first member*** —
   * [P12.10](../../../../docs/design/workplan/29-p12-implementation.md).
   *
   * The interesting half is the refusal. `readArchiveManifest` takes the
   * **first** member or nothing rather than searching, because reading on to
   * look for a manifest means inflating an arbitrary file handed to us to find
   * out whether it was ours — which is the cost the function exists to avoid,
   * paid exactly when the archive is least trustworthy.
   */
  it('reads the manifest without inflating the rest, and refuses an archive that is not ours', async () => {
    const record = await takeBackup(context, {
      owner: INSTALL,
      contents: 'full',
      reason: 'manual',
    });
    const found = await findBackup(context, INSTALL, record.id);

    const manifest = await readArchiveManifest(found!.path);
    expect(manifest?.scope).toBe('install');
    expect(manifest?.handles).toEqual(['mari', 'ned']);

    const foreign = join(root, 'not-ours.tar.gz');
    await writeTarGz(foreign, [{ name: 'readme.txt', bytes: new TextEncoder().encode('hi') }], 0);
    expect(await readArchiveManifest(foreign)).toBeNull();
  });
});

describe('a redacted archive', () => {
  it('omits every credential and keeps everything else', async () => {
    const record = await takeBackup(context, {
      owner: INSTALL,
      contents: 'redacted',
      reason: 'manual',
    });
    const found = await findBackup(context, INSTALL, record.id);
    const members = await membersOf(found!.path);

    expect(members.has('accounts.json')).toBe(false);
    expect(members.has('state/session.key')).toBe(false);
    expect(members.has('state/setup.token')).toBe(false);
    expect(members.has('system/connections/house.json')).toBe(false);
    expect(members.has('users/ned/connections/mine.json')).toBe(false);
    expect(members.has('users/mari/connections/hers.json')).toBe(false);
    // A removed account's directory carries theirs too.
    expect(members.has('removed/old-0199/connections/theirs.json')).toBe(false);

    // And the work is all still there, which is the point of the option.
    expect(members.get('users/ned/library/actors/vera/card.png')).toBe('vera');
    expect(members.has('users/ned/prefs.json')).toBe(true);
    expect(members.has('state/build.json')).toBe(true);
  });

  /** No hash may survive in any member, whatever the path rules said. */
  it('carries no password hash anywhere in it', async () => {
    const record = await takeBackup(context, {
      owner: INSTALL,
      contents: 'redacted',
      reason: 'manual',
    });
    const found = await findBackup(context, INSTALL, record.id);
    const members = await membersOf(found!.path);

    for (const body of members.values()) {
      expect(body).not.toContain('scrypt$secret');
      expect(body).not.toContain('sk-the-house-key');
      expect(body).not.toContain('sk-neds-own-key');
    }
  });
});

describe('an account backup', () => {
  it('carries one person and nothing of the install', async () => {
    const record = await takeBackup(context, { owner: NED, contents: 'full', reason: 'manual' });
    const found = await findBackup(context, NED, record.id);
    const members = await membersOf(found!.path);

    expect(members.get('users/ned/library/actors/vera/card.png')).toBe('vera');
    expect(members.has('users/ned/sessions/s1/session.json')).toBe(true);
    expect(members.has('users/ned/connections/mine.json')).toBe(true);

    expect(members.has('accounts.json')).toBe(false);
    expect(members.has('config.json')).toBe(false);
    expect(members.has('state/state.sqlite')).toBe(false);
    expect(members.has('system/library/actors/narrator/card.png')).toBe(false);
  });

  /** `users/ned` must not admit `users/nedra`, which is a segment boundary. */
  it('carries nobody else, including an account whose handle it is a prefix of', async () => {
    await put('users/nedra/library/actors/other/card.png', 'somebody else entirely');

    const record = await takeBackup(context, { owner: NED, contents: 'full', reason: 'manual' });
    const found = await findBackup(context, NED, record.id);
    const members = await membersOf(found!.path);

    expect([...members.keys()].filter((name) => name.startsWith('users/nedra/'))).toEqual([]);
    expect([...members.keys()].filter((name) => name.startsWith('users/mari/'))).toEqual([]);
  });

  /**
   * ***Data-root-relative in both scopes***, which is what makes an account
   * archive a strict subset rather than a differently-shaped thing — one
   * reader, one restore path, and `tar -xzf … -C /path/to/data` landing it
   * where it belongs.
   */
  it('names its members relative to the data root, not to the account', async () => {
    const record = await takeBackup(context, { owner: NED, contents: 'full', reason: 'manual' });
    const found = await findBackup(context, NED, record.id);
    const members = await membersOf(found!.path);

    for (const name of members.keys()) {
      if (name === BACKUP_MANIFEST_MEMBER) continue;
      expect(name.startsWith('users/ned/')).toBe(true);
    }
  });

  it('lands in the account directory and says whose it is', async () => {
    const record = await takeBackup(context, { owner: NED, contents: 'redacted', reason: 'start' });
    const found = await findBackup(context, NED, record.id);

    expect(found!.path.startsWith(layout.userBackupsRoot('ned'))).toBe(true);
    expect(found!.path).toContain(`account-ned-redacted-`);
    expect(record.handle).toBe('ned');
  });
});

describe('the listing', () => {
  it('reads the record off the name, newest first, and shows nobody else theirs', async () => {
    const first = await takeBackup(context, { owner: NED, contents: 'full', reason: 'manual' });
    const second = await takeBackup(context, {
      owner: NED,
      contents: 'redacted',
      reason: 'manual',
    });
    await takeBackup(context, { owner: INSTALL, contents: 'full', reason: 'manual' });

    const mine = await listBackups(context, NED);
    expect(mine.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(mine[0]?.contents).toBe('redacted');
    expect(mine[0]?.scope).toBe('account');
    expect(mine[0]?.bytes).toBeGreaterThan(0);
    expect(mine[0]?.takenAt).toBeGreaterThan(0);

    const theirs = await listBackups(context, { kind: 'account', handle: 'mari' });
    expect(theirs).toEqual([]);
  });

  /**
   * ***Anything that does not parse is not a backup***, which is what keeps a
   * half-written `.part` out of a listing that is offering people files to
   * restore from.
   */
  it('ignores a partial write and anything else in the directory', async () => {
    await takeBackup(context, { owner: NED, contents: 'full', reason: 'manual' });
    await put('users/ned/backups/account-ned-full-2026-09-22-not-a-uuid.tar.gz.part', 'half');
    await put('users/ned/backups/notes.txt', 'somebody put this here');

    const rows = await listBackups(context, NED);
    expect(rows).toHaveLength(1);
  });
});

describe('deleting one', () => {
  it('removes it, and says so when this owner has no such archive', async () => {
    const mine = await takeBackup(context, { owner: NED, contents: 'full', reason: 'manual' });

    expect(await removeBackup(context, NED, mine.id)).toBe(true);
    expect(await listBackups(context, NED)).toEqual([]);
    expect(await removeBackup(context, NED, mine.id)).toBe(false);
  });

  /**
   * ***An id from one account never reaches another's directory.*** The route's
   * schema refuses anything that is not a uuidv7 and this resolves against the
   * listing rather than building a path — both halves, because either alone is
   * the one that gets edited away.
   */
  it('will not delete another account’s archive given its id', async () => {
    const theirs = await takeBackup(context, {
      owner: { kind: 'account', handle: 'mari' },
      contents: 'full',
      reason: 'manual',
    });

    expect(await removeBackup(context, NED, theirs.id)).toBe(false);
    expect(await listBackups(context, { kind: 'account', handle: 'mari' })).toHaveLength(1);
  });
});
