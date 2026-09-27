// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { BACKUP_MANIFEST_MEMBER, BACKUP_MANIFEST_SCHEMA } from '@storyengine/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureDirectory, fileExists, readFileBytes, writeFileBytes } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import { readTarGz, writeTarGz } from '../storage/tar-archive.js';
import { findBackup, takeBackup, type BackupContext } from './archive.js';
import { performPendingRestore, prepareRestore, type RestorePlan } from './restore.js';

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
  // The swap tests close it first, as production has it closed; closing twice
  // throws in `node:sqlite`.
  if (state.isOpen) state.close();
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

/**
 * The swap, on the next boot —
 * [P12.12](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***What is asserted here is the undo.*** Everything else about a restore can
 * be redone: a wrong archive can be restored over again, a failed unpack leaves
 * the install where it was. The one thing that cannot be recovered is the
 * directory that was replaced, so the claim that it is **moved rather than
 * deleted** is the one this file exists to keep true.
 */
describe('performing a pending restore', () => {
  /** A second data directory, archived, so there is something to become. */
  async function archiveOfSomethingElse(): Promise<string> {
    await put('users/ada/library/actors/other/card.png', 'somebody else entirely');
    return archive(INSTALL);
  }

  /**
   * ***The order production has.*** `main.ts` runs the swap before
   * `buildServices` opens a single store, so nothing holds a file inside the
   * directory being renamed. This fixture's `state.sqlite` handle did — which
   * Linux shrugs at and Windows refuses, so the swap tests failed there as
   * `failed`, over a handle the product never has open.
   */
  function closeLikeBoot(): void {
    state.close();
  }

  it('does nothing at all without a marker, which is every ordinary boot', async () => {
    expect(await performPendingRestore(layout)).toEqual({ kind: 'none' });
    expect(await fileExists(join(root, 'accounts.json'))).toBe(true);
  });

  it('replaces the directory and keeps what was there', async () => {
    const path = await archiveOfSomethingElse();
    await prepareRestore(layout, { path, requestedBy: 'ned' });
    // Written after the archive was taken, so its absence afterwards is proof
    // the directory was replaced rather than written into.
    await put('users/ned/library/actors/later/card.png', 'added after the backup');
    closeLikeBoot();

    const outcome = await performPendingRestore(layout);

    expect(outcome.kind).toBe('restored');
    if (outcome.kind !== 'restored') return;

    // The archive's contents are the install now.
    expect(
      await fileExists(join(root, 'users', 'ada', 'library', 'actors', 'other', 'card.png')),
    ).toBe(true);
    expect(
      await fileExists(join(root, 'users', 'ned', 'library', 'actors', 'later', 'card.png')),
    ).toBe(false);

    /**
     * ***The undo, and `removed/`'s precedent.*** *StoryEngine will not delete
     * this; remove it yourself when you are sure.* It is the only property that
     * covers **the restore worked and was the wrong archive**.
     */
    expect(
      await fileExists(
        join(outcome.moved, 'users', 'ned', 'library', 'actors', 'later', 'card.png'),
      ),
    ).toBe(true);
    await rm(outcome.moved, { recursive: true, force: true });
  });

  it('leaves no marker behind, because the archive carried none', async () => {
    const path = await archiveOfSomethingElse();
    await prepareRestore(layout, { path, requestedBy: 'ned' });
    closeLikeBoot();

    const outcome = await performPendingRestore(layout);

    // Asserted first, because the marker below is only proof of anything once
    // the swap has actually happened.
    expect(outcome.kind).toBe('restored');
    /**
     * ***Nothing deleted this.*** The marker lived in the directory that just
     * moved aside, and no archive holds one — which is what makes the handoff
     * idempotent without a transaction, and what would silently stop being true
     * if `state/restore.pending` ever left the always-skipped list.
     */
    expect(await marker()).toBeNull();
    if (outcome.kind === 'restored') await rm(outcome.moved, { recursive: true, force: true });
  });

  it('leaves the install untouched when the archive will not unpack, and refuses the second time', async () => {
    const path = await archiveOfSomethingElse();
    await prepareRestore(layout, { path, requestedBy: 'ned' });
    // Broken *after* the preconditions passed, which is the case they cannot
    // cover: the file has been sitting on a disk since the drain.
    await writeFileBytes(path, bytes('no longer an archive'));

    const first = await performPendingRestore(layout);
    expect(first.kind).toBe('failed');
    if (first.kind === 'failed') expect(first.willRetry).toBe(false);
    expect(await fileExists(join(root, 'accounts.json'))).toBe(true);
    // The marker survives, because the failure has to be refusable next boot.
    expect((await marker())?.attempts).toBe(1);

    /**
     * ***A bad archive must not become a restart loop.*** A supervisor restarts
     * a process that exits, so an attempt that kept failing and kept trying
     * would take the install down rather than one boot.
     */
    const second = await performPendingRestore(layout);
    expect(second).toEqual({
      kind: 'failed',
      archive: (await marker())!.archive,
      why: 'This restore already failed once and will not be attempted again.',
      willRetry: false,
    });
  });

  it('treats a marker it cannot read as no marker', async () => {
    await writeFileBytes(layout.restorePendingFile, bytes('{ not json'));

    expect(await performPendingRestore(layout)).toEqual({ kind: 'none' });
    /**
     * The alternative is a boot that refuses to start over a file nobody can
     * reach to delete — and a restore nobody can confirm was intended is not a
     * restore to perform.
     */
    expect(await fileExists(join(root, 'accounts.json'))).toBe(true);
  });

  it('leaves no staging directory behind when it fails', async () => {
    const path = await archiveOfSomethingElse();
    await prepareRestore(layout, { path, requestedBy: 'ned' });
    /**
     * ***Failing after the unpack, which is the only failure that leaves
     * anything to clean up.*** A file that is no longer an archive fails in the
     * gunzip, before staging holds a byte, and so passes whether the cleanup
     * runs or not. A count one more than the archive holds unpacks every
     * member and then refuses.
     */
    const plan = (await marker())!;
    await writeFileBytes(
      layout.restorePendingFile,
      bytes(
        JSON.stringify({ ...plan, manifest: { ...plan.manifest, files: plan.manifest.files + 1 } }),
      ),
    );
    closeLikeBoot();

    const outcome = await performPendingRestore(layout);
    expect(outcome.kind).toBe('failed');

    const { readdir } = await import('node:fs/promises');
    const siblings = await readdir(join(root, '..'));
    // **Proof the listing is the right one**, so the filter below cannot pass
    // over nothing. `root.split('/')` did exactly that on Windows, where no
    // name could start with a whole absolute path.
    expect(siblings).toContain(basename(root));
    const mine = siblings.filter((name) => name.startsWith(`${basename(root)}.`));
    expect(mine).toEqual([]);
  });
});
