// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newActor, newLoreEntry, newLorebook } from '@storyengine/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { backupContextOf, findBackup, takeBackup } from '../../backup/archive.js';
import { create, read } from '../../library.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import { BackupFileSource } from '../backup-source.js';
import type { ConflictPolicy } from '../identity.js';
import { sweep } from '../sweep.js';

/**
 * ***A backup, imported into a live account*** —
 * [P12.8](../../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***This is [P4 §1.3]'s seam being paid a third time.*** With one `FileSource`
 * and one reader, a backup goes through the same sweep, the same conflict
 * policy and the same review vocabulary as a SillyTavern folder — so what is
 * worth testing here is the two things that are **not** the same, and both of
 * them are about our own objects having identifiers that foreign files do not.
 */

let server: TestServer;
let scratch: string;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
  scratch = await mkdtemp(join(tmpdir(), 'se-import-'));
});

afterEach(async () => {
  await server.dispose();
  await rm(scratch, { recursive: true, force: true });
});

/** Takes a backup of `ned` and opens it as a source. */
async function archiveOf(): Promise<BackupFileSource> {
  const context = backupContextOf(server.services);
  const record = await takeBackup(context, {
    owner: { kind: 'account', handle: 'ned' },
    contents: 'full',
    reason: 'manual',
  });
  const found = await findBackup(context, { kind: 'account', handle: 'ned' }, record.id);
  const opened = await BackupFileSource.open(found!.path);
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error(opened.refusal);
  return opened.source;
}

async function importInto(files: BackupFileSource, onConflict?: ConflictPolicy) {
  const outcome = await sweep({
    library: server.services.library,
    handle: 'ned',
    fromHandle: 'ned',
    files,
    ...(onConflict === undefined ? {} : { onConflict }),
  });
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(outcome.refusal);
  return outcome.report;
}

async function addLorebook(name: string, content: string): Promise<string> {
  const book = newLorebook(name);
  const entry = newLoreEntry('An entry');
  entry.keys = ['rain'];
  entry.content = content;
  book.entries = [entry];
  await create(server.services.library, 'ned', book);
  return book.id;
}

describe('a backup as an import source', () => {
  it('is recognised by its manifest, and read through the ordinary sweep', async () => {
    await addLorebook('Rain City', 'It rains.');

    const report = await importInto(await archiveOf());

    expect(report.source).toBe('storyengine-backup');
    // Everything in it is already here, byte for byte, so nothing is written.
    expect(report.counts.unchanged).toBeGreaterThan(0);
    expect(report.counts.converted).toBe(0);
  });

  /**
   * ***The case filename identity gets wrong, and the reason `identifyNative`
   * exists.***
   *
   * Renaming an object changes nothing on disk — the slug is frozen at creation
   * — but it is the thing a later archive's *name* would differ by. Keyed on a
   * filename this would still be one object; the sharper case is below.
   */
  it('finds an object again by its id, so nothing doubles', async () => {
    const id = await addLorebook('Rain City', 'It rains.');
    const files = await archiveOf();

    await importInto(files);
    await importInto(files);

    // One object, still, under the id it was created with.
    expect(read(server.services.library, 'ned', id).id).toBe(id);
  });

  /**
   * ***`skip` is the right default for a backup and `replace` is the right
   * default for a re-import***, which is the one place this source disagrees
   * with `sweep`'s own default — and it disagrees because the two situations
   * are different. A re-imported foreign file *is* the object that file
   * produced. A backup meeting a live account is **the past meeting the
   * present**, and the present is usually what somebody wants to keep.
   */
  it('keeps your edit under skip, and reverts it under replace', async () => {
    const id = await addLorebook('Rain City', 'It rains.');
    const files = await archiveOf();

    const current = read(server.services.library, 'ned', id);
    const edited = structuredClone(current.body) as {
      entries: { content: string }[];
    };
    edited.entries[0]!.content = 'It has stopped raining.';
    const { update } = await import('../../library.js');
    await update(server.services.library, 'ned', id, edited, current.contentHash);

    const kept = await importInto(files, 'skip');
    /**
     * ***The note, not `counts.skipped`.*** `Writer.dispositionOf` maps
     * `skipped` onto the **`unchanged`** row deliberately — *"created and
     * unchanged are different rows in the review, so map them"* — so the count
     * cannot tell *we left yours alone* from *they were identical*, and the note
     * is the only thing that can.
     */
    expect(kept.items[0]?.notes.map((note) => note.key)).toContain('import.object.differsAndKept');
    expect(
      (read(server.services.library, 'ned', id).body as { entries: { content: string }[] })
        .entries[0]?.content,
    ).toBe('It has stopped raining.');

    await importInto(files, 'replace');
    expect(
      (read(server.services.library, 'ned', id).body as { entries: { content: string }[] })
        .entries[0]?.content,
    ).toBe('It rains.');
  });

  /**
   * ***The object comes back after it was deleted***, which is the sentence
   * somebody actually wants from this feature and the one the whole second half
   * exists for.
   */
  it('brings back what was deleted, without touching what was not', async () => {
    const goes = await addLorebook('Rain City', 'It rains.');
    const stays = await addLorebook('Dry County', 'It does not.');
    const files = await archiveOf();

    const { remove } = await import('../../library.js');
    await remove(
      server.services.library,
      'ned',
      goes,
      read(server.services.library, 'ned', goes).contentHash,
    );

    const report = await importInto(files, 'skip');
    expect(report.counts.converted).toBeGreaterThan(0);

    expect(read(server.services.library, 'ned', goes).id).toBe(goes);
    expect(read(server.services.library, 'ned', stays).id).toBe(stays);
  });

  it('refuses an archive that does not hold the account it was asked for', async () => {
    const files = await archiveOf();
    const outcome = await sweep({
      library: server.services.library,
      handle: 'ned',
      fromHandle: 'mara',
      files,
    });

    expect(outcome).toEqual({ ok: false, refusal: 'unreadable-root' });
  });

  it('carries an actor, whose card is the object rather than a mirror of one', async () => {
    const actor = newActor('Vera Solano');
    await create(server.services.library, 'ned', actor);

    const report = await importInto(await archiveOf());
    expect(report.items.some((item) => item.source.endsWith('card.png'))).toBe(true);
    expect(read(server.services.library, 'ned', actor.id).id).toBe(actor.id);
  });
});

describe('the source itself', () => {
  it('refuses something that is not an archive', async () => {
    const { writeFileBytes } = await import('../../storage/files.js');
    const path = join(scratch, 'not-a-tar.gz');
    await writeFileBytes(path, new TextEncoder().encode('just some text'));

    expect(await BackupFileSource.open(path)).toEqual({ ok: false, refusal: 'unreadable' });
  });

  /**
   * ***An archive is somebody else's bytes***, and the fact that this project
   * writes its own is exactly the assumption a reader must not make: the thing
   * a person imports is the file that survived.
   */
  it('refuses a member that would escape the root', async () => {
    const { writeTarGz } = await import('../../storage/tar-archive.js');
    const path = join(scratch, 'escaping.tar.gz');
    await writeTarGz(
      path,
      [{ name: 'a/../../etc/passwd', bytes: new TextEncoder().encode('no') }],
      0,
    );

    expect(await BackupFileSource.open(path)).toEqual({ ok: false, refusal: 'unsafe-path' });
  });

  it('refuses an archive past its bounds before it has read all of it', async () => {
    const { writeTarGz } = await import('../../storage/tar-archive.js');
    const path = join(scratch, 'big.tar.gz');
    await writeTarGz(path, [{ name: 'a.json', bytes: new Uint8Array(4096) }], 0);

    expect(
      await BackupFileSource.open(path, {
        maxEntries: 4096,
        maxEntryBytes: 16,
        maxTotalBytes: 1024,
      }),
    ).toEqual({ ok: false, refusal: 'too-large' });
  });

  /** A directory exists when something is under it — what the probes ask. */
  it('answers about a directory the paths only imply', async () => {
    await addLorebook('Rain City', 'It rains.');
    const files = await archiveOf();

    expect(await files.exists('backup.json')).toBe(true);
    expect(await files.exists('users')).toBe(true);
    expect(await files.exists('users/ned/library')).toBe(true);
    expect(await files.exists('users/mara')).toBe(false);
  });
});
