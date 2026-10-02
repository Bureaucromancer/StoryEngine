// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';
import { chmod, mkdir, mkdtemp, readdir, rename, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { BACKUP_MANIFEST_MEMBER, BACKUP_MANIFEST_SCHEMA } from '@storyengine/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureDirectory, fileExists, readFileBytes, writeFileBytes } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import { readTarGz, writeTarGz } from '../storage/tar-archive.js';
import { findBackup, takeBackup, type BackupContext } from './archive.js';
import { performPendingRestore, prepareRestore, type RestorePlan } from './restore.js';
import { SWAP_JOURNAL_SCHEMA, type Rename } from './swap.js';

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
  /**
   * ***One level down, in a directory of its own***, so the swap tests can
   * make the data directory's parent read-only, which is what a container's
   * `/data` and the unit's `ProtectSystem=strict` both give the process.
   */
  root = join(await mkdtemp(join(tmpdir(), 'se-restore-')), 'data');
  await mkdir(root);
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
  await chmod(dirname(root), 0o755).catch(() => undefined);
  await rm(dirname(root), { recursive: true, force: true });
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

  it('replaces the install and keeps what was there, inside the data directory', async () => {
    const path = await archiveOfSomethingElse();
    await prepareRestore(layout, { path, requestedBy: 'ned' });
    // Written after the archive was taken, so its absence afterwards is proof
    // the install was replaced rather than written into.
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
     * covers **the restore worked and was the wrong archive**. And it is inside
     * the data directory now, under `.restore/`, because beside it is a place
     * no shipped install can write.
     */
    expect(outcome.moved.startsWith(layout.restoreRoot)).toBe(true);
    expect(
      await fileExists(
        join(outcome.moved, 'users', 'ned', 'library', 'actors', 'later', 'card.png'),
      ),
    ).toBe(true);
    // And the swap left nothing of its own behind but the undo.
    expect(await fileExists(layout.restoreJournalFile)).toBe(false);
    expect(await readdir(dirname(outcome.moved))).toEqual(['replaced']);
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

    // Nothing staged is left inside the data directory,
    expect(await readdir(layout.restoreRoot)).toEqual([]);
    // and nothing was ever written beside it. **Proof the listing is the right
    // one**, so the filter cannot pass over nothing: `root.split('/')` did
    // exactly that on Windows, where no name could start with a whole path.
    const siblings = await readdir(dirname(root));
    expect(siblings).toContain(basename(root));
    expect(siblings.filter((name) => name.startsWith(`${basename(root)}.`))).toEqual([]);
  });

  /**
   * ***Where every shipped install is.*** In a container `/data` is a mount
   * point in a parent owned by root, and the unit makes everything but the
   * data directory read-only. The old swap staged beside the data directory
   * and renamed it whole, which failed with `EACCES` in exactly those places:
   * a restore that worked only from a checkout. Everything happens inside the
   * data directory now.
   *
   * *Not on Windows, whose read-only bit does not guard a directory, and not
   * as root, which no permission stops.* The Linux leg of CI runs it.
   *
   * Catches: staging or setting aside anywhere outside the data directory.
   */
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'swaps inside the data directory, so a parent it cannot write is no obstacle',
    async () => {
      const path = await archiveOfSomethingElse();
      await prepareRestore(layout, { path, requestedBy: 'ned' });
      closeLikeBoot();
      await chmod(dirname(root), 0o555);

      const outcome = await performPendingRestore(layout);

      expect(outcome.kind).toBe('restored');
      expect(
        await fileExists(join(root, 'users', 'ada', 'library', 'actors', 'other', 'card.png')),
      ).toBe(true);
    },
  );

  /**
   * ***The archives stay where the lists look for them.*** The old swap moved
   * the whole directory aside, `backups/` and everybody's own archives with
   * it, so every backup list came back empty after a restore, and
   * `deploy.md`'s *delete the replaced directory when you are sure* deleted
   * them all.
   *
   * Catches: moving `backups/` with the install, and not carrying a person's
   * own archives across.
   */
  it('keeps every archive live, the install’s and each person’s', async () => {
    const path = await archiveOfSomethingElse();
    // Neither is in the archive: archives are never inside one.
    await put('users/ned/backups/account-ned-full-2026-09-01-x.tar.gz', 'ned’s own');
    // Somebody the archive does not bring back.
    await put('users/zed/backups/account-zed-full-2026-09-01-x.tar.gz', 'zed’s own');
    await prepareRestore(layout, { path, requestedBy: 'ned' });
    closeLikeBoot();

    const outcome = await performPendingRestore(layout);

    expect(outcome.kind).toBe('restored');
    if (outcome.kind !== 'restored') return;
    // The install's, including the one just restored, never moved.
    expect(await fileExists(path)).toBe(true);
    // A person's, carried into the restored install's directory for them.
    expect(
      await fileExists(
        join(root, 'users', 'ned', 'backups', 'account-ned-full-2026-09-01-x.tar.gz'),
      ),
    ).toBe(true);
    // And one with nobody to come back to stays with the undo, and is said.
    expect(outcome.backupsLeftBehind).toEqual(['zed']);
    expect(
      await fileExists(
        join(outcome.moved, 'users', 'zed', 'backups', 'account-zed-full-2026-09-01-x.tar.gz'),
      ),
    ).toBe(true);
  });

  /**
   * ***What is not StoryEngine's stays where it is.*** A data directory that
   * is the root of its own filesystem has a `lost+found` that root owns and
   * the server's user cannot rename. Moving it would fail every restore on
   * such a volume.
   */
  it('leaves an entry that is not its own, and not in the archive, where it is', async () => {
    const path = await archiveOfSomethingElse();
    await put('lost+found/0001', 'recovered by fsck');
    await prepareRestore(layout, { path, requestedBy: 'ned' });
    closeLikeBoot();

    const outcome = await performPendingRestore(layout);

    expect(outcome.kind).toBe('restored');
    expect(await fileExists(join(root, 'lost+found', '0001'))).toBe(true);
  });

  /**
   * ***A marker whose archive has gone is a failed restore, not a crash.*** The
   * archive's read error used to reach nothing, which Node makes an uncaught
   * exception: at boot, a crash on every start, under a supervisor that
   * restarts it.
   */
  it('fails, rather than crashing, when the archive has gone', async () => {
    const path = await archiveOfSomethingElse();
    await prepareRestore(layout, { path, requestedBy: 'ned' });
    await rm(path);
    closeLikeBoot();

    const outcome = await performPendingRestore(layout);

    expect(outcome.kind).toBe('failed');
    expect((await marker())?.attempts).toBe(1);
    expect(await fileExists(join(root, 'accounts.json'))).toBe(true);
  });
});

/**
 * ***A swap that goes wrong*** — the roll-back, the one outcome that stops a
 * boot, and the journal that lets the next start finish what the last began.
 *
 * The renames that fail here are injected, because the disks that make them
 * fail (a mount point, a Windows virus scanner holding a file just unpacked,
 * a process killed mid-swap) are not ones a test can arrange. Each test
 * names which rename it breaks.
 */
describe('a swap that goes wrong', () => {
  async function staged(): Promise<void> {
    await put('users/ada/library/actors/other/card.png', 'somebody else entirely');
    const path = await archive(INSTALL);
    await prepareRestore(layout, { path, requestedBy: 'ned' });
    // Only in the install as it is now, so the restored one cannot have it.
    await put('users/ned/library/actors/later/card.png', 'added after the backup');
    state.close();
  }

  /** Which side of the swap a rename moves from. */
  const outOf = (from: string, part: 'staging' | 'replaced'): boolean =>
    from.split(/[\\/]/).includes(part);

  /** A rename that throws `EBUSY` when `when` says so, and renames otherwise. */
  function breaking(when: (from: string) => boolean): Rename {
    return async (from, to) => {
      if (when(from)) {
        throw Object.assign(new Error(`EBUSY: resource busy or locked, rename '${from}'`), {
          code: 'EBUSY',
        });
      }
      await rename(from, to);
    };
  }

  /**
   * The install as it was: `later` was written after the archive was taken,
   * and a root `backup.json` is the note a restored install keeps. (`ada` is in
   * both, because the fixture puts her there before archiving.)
   */
  async function theOldInstall(): Promise<void> {
    expect(await fileExists(join(root, 'accounts.json'))).toBe(true);
    expect(
      await fileExists(join(root, 'users', 'ned', 'library', 'actors', 'later', 'card.png')),
    ).toBe(true);
    expect(await fileExists(join(root, 'backup.json'))).toBe(false);
  }

  async function theRestoredInstall(): Promise<void> {
    expect(await fileExists(join(root, 'accounts.json'))).toBe(true);
    expect(
      await fileExists(join(root, 'users', 'ned', 'library', 'actors', 'later', 'card.png')),
    ).toBe(false);
    expect(await fileExists(join(root, 'backup.json'))).toBe(true);
  }

  /**
   * ***Half way through, and put back.*** The entries come in in name order,
   * and bringing `users/` in fails after `state/` has already arrived. That is
   * the case that needs both halves of the roll-back: `state/` has to go back
   * out before the old one can return, because a directory cannot be renamed
   * onto a directory with something in it. (A file can, silently, which is why
   * failing after only `accounts.json` had arrived proved nothing about the
   * first half.) The old swap's second rename failing booted an **empty
   * install**, with a setup token, and logged *unchanged*.
   *
   * Catches: a failure that is not rolled back, and a roll-back that misses
   * the entries that had already arrived (it then cannot put `state/` back,
   * and strands the boot).
   */
  it('puts the install back when a move fails half way', async () => {
    await staged();
    const rename = breaking((from) => outOf(from, 'staging') && basename(from) === 'users');

    const outcome = await performPendingRestore(layout, { rename });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.why).toContain('EBUSY');
    await theOldInstall();
    // Refused next time, like any failed restore.
    expect((await marker())?.attempts).toBe(1);
    // And nothing of the attempt is left: no journal, no staging, no empty undo.
    expect(await fileExists(layout.restoreJournalFile)).toBe(false);
    expect(await readdir(layout.restoreRoot)).toEqual([]);
  });

  /**
   * ***Neither forward nor back: the boot stops, and the next one finishes.***
   * Every move out of staging fails, so the swap cannot go forward, and every
   * move out of `replaced/` fails, so it cannot go back either. The directory
   * is then neither install, so the outcome is `stranded`, which `main.ts`
   * refuses to boot past, naming both halves. The journal stays, and the next
   * start, with the disk behaving, **finishes the swap** from it.
   *
   * Catches: a roll-back failure reported as anything that boots; a journal
   * removed or never written; a resume that is not idempotent.
   */
  it('stops the boot when it can go neither forward nor back, and finishes next time', async () => {
    await staged();

    const stuck = await performPendingRestore(layout, {
      rename: breaking((from) => outOf(from, 'staging') || outOf(from, 'replaced')),
    });

    expect(stuck.kind).toBe('stranded');
    if (stuck.kind !== 'stranded') return;
    expect(stuck.why).toContain('Putting the install back failed too');
    expect(await fileExists(join(stuck.replaced, 'accounts.json'))).toBe(true);
    expect(await fileExists(layout.restoreJournalFile)).toBe(true);

    const next = await performPendingRestore(layout);

    expect(next.kind).toBe('restored');
    await theRestoredInstall();
    expect(await fileExists(layout.restoreJournalFile)).toBe(false);
  });

  /**
   * ***`pnpm backup restore` stages; the boot swaps.*** The command line
   * unpacks into `.restore/<id>/staging` and writes a `staged` journal, and
   * does no swap of its own, so it cannot rename directories under a running
   * server and there is one swap to trust rather than two.
   */
  it('finishes a swap the command line staged', async () => {
    state.close();
    const id = '0199aaaa-0000-7000-8000-000000000001';
    await put(`.restore/${id}/staging/accounts.json`, '{"accounts":[{"handle":"ada"}]}');
    await put(`.restore/${id}/staging/users/ada/library/actors/other/card.png`, 'ada');
    await writeFileBytes(
      layout.restoreJournalFile,
      bytes(
        JSON.stringify({
          schema: SWAP_JOURNAL_SCHEMA,
          id,
          archive: 'from the command line',
          requestedBy: '',
          files: 2,
          phase: 'staged',
        }),
      ),
    );

    const outcome = await performPendingRestore(layout);

    expect(outcome.kind).toBe('restored');
    expect(
      await fileExists(join(root, 'users', 'ada', 'library', 'actors', 'other', 'card.png')),
    ).toBe(true);
    // StoryEngine's own entries went aside even where the archive had none.
    expect(await fileExists(join(root, 'config.json'))).toBe(false);
    expect(await fileExists(join(root, 'state', 'session.key'))).toBe(false);
  });

  /**
   * ***A resume whose staging tree has lost an entry puts the install back***
   * rather than finishing a restore with a hole in it. The journal lists
   * `users` as coming in, and nothing is there to bring.
   *
   * Catches: a resume that skips an incoming entry it cannot find.
   */
  it('puts the install back when a staged entry has gone missing', async () => {
    state.close();
    const id = '0199aaaa-0000-7000-8000-000000000003';
    await put(`.restore/${id}/staging/accounts.json`, '{"accounts":[{"handle":"ada"}]}');
    await writeFileBytes(
      layout.restoreJournalFile,
      bytes(
        JSON.stringify({
          schema: SWAP_JOURNAL_SCHEMA,
          id,
          archive: 'half gone',
          requestedBy: '',
          files: 2,
          phase: 'swapping',
          aside: ['accounts.json', 'config.json', 'state', 'users'],
          incoming: ['accounts.json', 'users'],
        }),
      ),
    );

    const outcome = await performPendingRestore(layout);

    expect(outcome.kind).toBe('failed');
    expect(
      await fileExists(join(root, 'users', 'ned', 'library', 'actors', 'vera', 'card.png')),
    ).toBe(true);
    expect(await fileExists(join(root, 'state', 'session.key'))).toBe(true);
    expect(await fileExists(layout.restoreJournalFile)).toBe(false);
  });

  /**
   * ***A journal it cannot read is not *no journal*.*** It exists because a
   * swap may be half done, and booting past it would serve a directory that is
   * part of each install.
   */
  it('will not boot past a journal it cannot read', async () => {
    state.close();
    await put('.restore/swap.json', '{ not json');

    expect((await performPendingRestore(layout)).kind).toBe('stranded');
  });

  /**
   * ***A journal whose staging tree has gone swaps nothing in***, rather than
   * moving the whole install aside to make room for nothing.
   */
  it('moves nothing when nothing was staged', async () => {
    state.close();
    await writeFileBytes(
      layout.restoreJournalFile,
      bytes(
        JSON.stringify({
          schema: SWAP_JOURNAL_SCHEMA,
          id: '0199aaaa-0000-7000-8000-000000000002',
          archive: 'gone',
          requestedBy: '',
          files: 0,
          phase: 'staged',
        }),
      ),
    );

    expect((await performPendingRestore(layout)).kind).toBe('failed');
    expect(await fileExists(join(root, 'accounts.json'))).toBe(true);
    expect(await fileExists(layout.restoreJournalFile)).toBe(false);
  });
});
