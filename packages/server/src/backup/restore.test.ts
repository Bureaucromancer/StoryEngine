// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BACKUP_MANIFEST_MEMBER, BACKUP_MANIFEST_SCHEMA } from '@storyengine/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureDirectory, fileExists, readFileBytes, writeFileBytes } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import { readTarGz, writeTarGz } from '../storage/tar-archive.js';
import { findBackup, takeBackup, type BackupContext } from './archive.js';
import { prepareRestore, type RestorePlan } from './restore.js';

/**
 * The preconditions of a restore —
 * [P12.11](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***The single claim this file exists to prove is that nothing is written
 * until everything has been checked.*** A restore is a handoff across a
 * restart: the marker is what the next boot acts on, so a marker written beside
 * a refusal is a restore that happens anyway, at a moment nobody chose, for a
 * reason somebody was told was a refusal. Every case below therefore asserts
 * the refusal **and** the absence of the marker, which is the half that would
 * rot silently.
 *
 * *What is not here is the swap*, which is [P12.12]'s and happens in a process
 * this one has already ended.
 */

let root: string;
let layout: Layout;
let context: BackupContext;
let state: DatabaseSync;

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function put(relative: string, text: string): Promise<void> {
  const path = join(root, ...relative.split('/'));
  await ensureDirectory(join(path, '..'));
  await writeFileBytes(path, bytes(text));
}

async function marker(): Promise<RestorePlan | null> {
  const raw = await readFileBytes(layout.restorePendingFile);
  return raw === null ? null : (JSON.parse(new TextDecoder().decode(raw)) as RestorePlan);
}

/** An archive of whatever is in the fixture, and its path. */
async function archive(
  owner: { kind: 'install' } | { kind: 'account'; handle: string },
  contents: 'full' | 'redacted' = 'full',
): Promise<string> {
  const record = await takeBackup(context, { owner, contents, reason: 'manual' });
  const found = await findBackup(context, owner, record.id);
  return found!.path;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'se-restore-'));
  layout = new Layout(root);
  await ensureDirectory(layout.stateRoot);
  state = new DatabaseSync(layout.stateFile);
  state.exec('create table job (id text primary key, account text)');
  context = { layout, state, build: { version: '1.0.0-alpha.4' } as never };

  await put('config.json', '{"server":{"port":8080}}');
  await put('accounts.json', '{"accounts":[{"handle":"ned"}]}');
  await put('users/ned/library/actors/vera/card.png', 'vera');
  await put('users/ned/connections/mine.json', '{"apiKey":"sk-neds-own-key"}');
  await put('state/session.key', 'the key that validates every session');
});

afterEach(async () => {
  state.close();
  await rm(root, { recursive: true, force: true });
});

const INSTALL = { kind: 'install' } as const;
const NED = { kind: 'account', handle: 'ned' } as const;

describe('preparing a restore', () => {
  it('writes the marker, relative to the directory it will replace', async () => {
    const path = await archive(INSTALL);

    const prepared = await prepareRestore(layout, { path, requestedBy: 'ned' });

    expect(prepared.ok).toBe(true);
    const written = await marker();
    expect(written?.attempts).toBe(0);
    expect(written?.requestedBy).toBe('ned');
    /**
     * ***Relative, and that is load-bearing rather than tidy.*** The absolute
     * path contains the data directory, which is the one thing a restore
     * renames — so a marker holding one would name a directory that does not
     * exist by the time anything reads it back.
     */
    expect(written?.archive).toMatch(/^backups\//);
    expect(written?.archive.startsWith(root)).toBe(false);
    expect(written?.manifest.scope).toBe('install');
  });

  it('refuses an account archive, and writes nothing', async () => {
    const path = await archive(NED);

    const prepared = await prepareRestore(layout, { path, requestedBy: 'ned' });

    expect(prepared).toEqual({ ok: false, refusal: 'wrong-scope' });
    /**
     * Member names are data-root-relative in both scopes, so this one *would*
     * unpack into the right place — and a restore replaces the directory, so
     * what would be left is one person's tree and nothing else. The refusal is
     * the only thing between that and an install.
     */
    expect(await marker()).toBeNull();
  });

  it('asks before restoring an install nobody could sign into', async () => {
    const path = await archive(INSTALL, 'redacted');

    const refused = await prepareRestore(layout, { path, requestedBy: 'ned' });
    expect(refused).toEqual({ ok: false, refusal: 'needs-confirmation' });
    expect(await marker()).toBeNull();

    // A legitimate thing to want, once it has been said out loud.
    const accepted = await prepareRestore(layout, {
      path,
      requestedBy: 'ned',
      acceptRedacted: true,
    });
    expect(accepted.ok).toBe(true);
    expect((await marker())?.manifest.contents).toBe('redacted');
  });

  it('refuses an archive that stops half way', async () => {
    const path = await archive(INSTALL);
    /**
     * ***The realistic failure.*** A copy that ran out of space or a download
     * that stopped leaves a file whose beginning is a perfectly good archive,
     * and the only way to learn otherwise is to read it to the end — which is
     * what `prepareRestore` does before it writes anything, rather than
     * discovering it half way through an unpack with the old directory already
     * renamed aside.
     */
    await truncate(path, 200);

    const prepared = await prepareRestore(layout, { path, requestedBy: 'ned' });

    expect(prepared).toEqual({ ok: false, refusal: 'unreadable' });
    expect(await marker()).toBeNull();
  });

  it('refuses an archive that claims more members than it holds', async () => {
    /**
     * ***The count check, exercised where truncation cannot reach it.***
     * A cut file fails to inflate at all, so it never gets this far. This is
     * the other shape of the same lie: a *valid* archive whose manifest
     * overstates it — which is what a writer interrupted between the manifest
     * and the members would leave, and which every other check here would
     * accept.
     */
    const path = join(root, 'backups', 'install-full-2026-09-22-overstated.tar.gz');
    const manifest = {
      schema: BACKUP_MANIFEST_SCHEMA,
      scope: 'install',
      handle: null,
      contents: 'full',
      takenBy: { version: null, at: new Date().toISOString() },
      reason: 'manual',
      files: 99,
      unpackedBytes: 10,
      handles: ['ned'],
      omitted: [],
    };
    await writeTarGz(
      path,
      [
        { name: BACKUP_MANIFEST_MEMBER, bytes: bytes(JSON.stringify(manifest)) },
        { name: 'config.json', bytes: bytes('{}') },
      ],
      0,
    );

    const prepared = await prepareRestore(layout, { path, requestedBy: 'ned' });

    expect(prepared).toEqual({ ok: false, refusal: 'unreadable' });
    expect(await marker()).toBeNull();
  });

  it('refuses a file that is not one of ours at all', async () => {
    const path = join(root, 'backups', 'not-an-archive.tar.gz');
    await ensureDirectory(join(root, 'backups'));
    await writeFileBytes(path, bytes('this is not a gzip'));

    const prepared = await prepareRestore(layout, { path, requestedBy: 'ned' });

    expect(prepared).toEqual({ ok: false, refusal: 'unreadable' });
    expect(await fileExists(layout.restorePendingFile)).toBe(false);
  });

  it('is never carried inside an archive it asked for', async () => {
    const first = await archive(INSTALL);
    await prepareRestore(layout, { path: first, requestedBy: 'ned' });
    expect(await marker()).not.toBeNull();

    /**
     * ***This is the property that lets a successful restore need no
     * cleanup.*** The marker lives in the directory the swap moves aside, and
     * no archive holds one — so the directory that arrives has none, and
     * nothing has to delete a file from a directory that is being replaced.
     */
    const second = await archive(INSTALL);
    const names: string[] = [];
    for await (const member of readTarGz(second)) names.push(member.name);
    expect(names).not.toContain('state/restore.pending');
  });
});
