// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  newActor,
  newLoreEntry,
  newLorebook,
  newWorld,
  type EmbeddedMedia,
  type PortableSchemaId,
  WORLD_SCHEMA,
} from '@storyengine/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { backupContextOf, findBackup, takeBackup } from '../../backup/archive.js';
import { ingestFile } from '../../index-db/ingest.js';
import { create, read, readMedia, remove, update } from '../../library.js';
import { storeAsset } from '../../library/assets.js';
import { makePng, pixelBytes } from '../../storage/card/test-png.js';
import { readFileBytes } from '../../storage/files.js';
import { writeTarGz } from '../../storage/tar-archive.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import { BackupFileSource, importedBy } from '../backup-source.js';
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
    tags: server.services.tags,
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
  /**
   * ***And `skip` when nobody says*** —
   * [P13 §0.5](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * The backups route applied P12.8's default and the sweep did not: an
   * unpacked backup handed to the import panel — a folder upload or a server
   * path, neither of which sends a policy — took the sweep's own `replace`, and
   * reverted every object edited since the archive was taken.
   */
  it('keeps your edit when no policy is given, as the import panel sends none', async () => {
    const id = await addLorebook('Rain City', 'It rains.');
    const files = await archiveOf();

    const current = read(server.services.library, 'ned', id);
    const edited = structuredClone(current.body) as { entries: { content: string }[] };
    edited.entries[0]!.content = 'It has stopped raining.';
    const { update } = await import('../../library.js');
    await update(server.services.library, 'ned', id, edited, current.contentHash);

    const report = await importInto(files);
    expect(report.items[0]?.notes.map((note) => note.key)).toContain(
      'import.object.differsAndKept',
    );
    expect(
      (read(server.services.library, 'ned', id).body as { entries: { content: string }[] })
        .entries[0]?.content,
    ).toBe('It has stopped raining.');
  });

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
      tags: server.services.tags,
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

/**
 * ***What comes back with an object*** (2026-09-27).
 *
 * An actor's card is its portrait and carries its expressions as chunks; a
 * lorebook keeps its pictures in `assets/` beside its file. The import passed
 * no card and skipped `assets/`, so a deleted actor came back on the blank
 * 1×1 card with every expression answering *the bytes are missing*, and a
 * book's gallery named files that were not there. The review said `created`.
 */
/**
 * ***An archive taken before Package was renamed World*** — [P16 §1.1]. It
 * holds `library/packages/<slug>/package.json`, saying `storyengine.package/1`,
 * and the reader knows `packages` as the World's old folder. **The first case
 * fails with that alias removed** — each Package is then an `unknownKind` row,
 * skipped — and with the body's upgrade removed, a `wrongKind` one.
 */
describe('a backup holding Packages, from before P16.0', () => {
  /** A Package's folder as a pre-P16.0 build wrote it, in the live library. */
  async function plantPackage(slug: string): Promise<{ id: string; path: string }> {
    const world = newWorld('Rain City');
    const folder = join(server.dataDir, 'users', 'ned', 'library', 'packages', slug);
    await mkdir(folder, { recursive: true });
    const path = join(folder, 'package.json');
    await writeFile(
      path,
      `${JSON.stringify({ ...world, schema: 'storyengine.package/1' }, null, 2)}\n`,
    );
    return { id: world.id, path };
  }

  it('imports each Package as a World, written where Worlds go', async () => {
    const planted = await plantPackage('rain-city');
    const files = await archiveOf();
    // Gone from this install, so the archive is the only copy.
    await rm(join(server.dataDir, 'users', 'ned', 'library', 'packages'), {
      recursive: true,
      force: true,
    });

    const report = await importInto(files, 'skip');
    const item = report.items.find((one) => one.source.includes('/packages/rain-city/'));
    expect(item?.disposition, JSON.stringify(item)).toBe('converted');

    const world = read(server.services.library, 'ned', planted.id, WORLD_SCHEMA);
    expect((world.body as { schema: string }).schema).toBe(WORLD_SCHEMA);
    const written = JSON.parse(
      await readFile(
        join(server.dataDir, 'users', 'ned', 'library', 'worlds', 'rain-city', 'world.json'),
        'utf8',
      ),
    ) as { schema: string; id: string };
    expect(written).toMatchObject({ schema: WORLD_SCHEMA, id: planted.id });
  });

  /**
   * ***Over the library it came from, with the Package not yet moved*** — the
   * file on disk still says the old id and the object arriving has been read as
   * a World, so their bytes can never match. It is the same object, and an
   * import over it writes nothing (`identifyNative`).
   */
  it('finds an unmoved Package unchanged, rather than different from itself', async () => {
    const planted = await plantPackage('rain-city');
    await ingestFile(server.services.index.db, server.services.layout, planted.path);
    const files = await archiveOf();

    const report = await importInto(files, 'skip');
    const item = report.items.find((one) => one.source.includes('/packages/rain-city/'));
    expect(item?.disposition, JSON.stringify(item)).toBe('unchanged');
    // And nothing moved: an import that wrote nothing is not a write.
    await expect(readFile(planted.path, 'utf8')).resolves.toContain('storyengine.package/1');
  });
});

describe('what comes back with an object', () => {
  /** Six bytes of GIF header: an image a browser would take, and not a card. */
  const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

  function row(
    id: string,
    role: EmbeddedMedia['role'],
    ref: string,
    digest: string,
  ): EmbeddedMedia {
    return { id, role, mime: 'image/gif', digest, bytes: GIF.byteLength, ref, tags: [] };
  }

  /** Bytes as numbers, so a `Buffer` and a `Uint8Array` of the same bytes compare equal. */
  const plain = (bytes: Uint8Array | Uint8Array[]): number[] | number[][] =>
    Array.isArray(bytes) ? bytes.map((each) => [...each]) : [...bytes];

  async function removeObject(id: string, kind?: PortableSchemaId): Promise<void> {
    const { contentHash } = read(server.services.library, 'ned', id, kind);
    await remove(server.services.library, 'ned', id, contentHash, kind);
  }

  async function anActorWithAnExpression(): Promise<{ id: string; portrait: Uint8Array }> {
    const portrait = makePng(6, 3);
    const actor = {
      ...newActor('Vera Solano'),
      media: [row('m-neutral', 'expression', 'blob-neutral', 'sha256:deadbeef')],
    };
    await create(server.services.library, 'ned', actor, undefined, {
      cardPixels: portrait,
      media: new Map([['blob-neutral', GIF]]),
    });
    return { id: actor.id, portrait };
  }

  it('brings a deleted actor back on its own card, with its expressions', async () => {
    const { id, portrait } = await anActorWithAnExpression();
    const files = await archiveOf();
    await removeObject(id);

    await importInto(files, 'skip');

    const back = read(server.services.library, 'ned', id);
    expect(plain(pixelBytes((await readFileBytes(back.path))!))).toEqual(
      plain(pixelBytes(portrait)),
    );
    const media = await readMedia(server.services.library, 'ned', id, 'm-neutral');
    expect(plain(media.bytes)).toEqual(plain(GIF));
  });

  it('brings a deleted lorebook back with the pictures in its folder', async () => {
    const id = await addLorebook('Rain City', 'It rains.');
    const stored = await storeAsset(server.services.library, 'ned', id, GIF, 'image/gif');
    const current = read(server.services.library, 'ned', id);
    await update(
      server.services.library,
      'ned',
      id,
      {
        ...(current.body as Record<string, unknown>),
        media: [row('m-map', 'gallery', stored.ref, stored.digest)],
      },
      current.contentHash,
    );
    const files = await archiveOf();
    await removeObject(id);

    await importInto(files, 'skip');

    const media = await readMedia(server.services.library, 'ned', id, 'm-map');
    expect(plain(media.bytes)).toEqual(plain(GIF));
  });

  /**
   * ***A replace keeps the portrait that is here and gains the archive's
   * pictures.*** An actor's history keeps its JSON and not its pixels, so a
   * replace that swapped the portrait would destroy one with nothing to
   * restore it from. Adding the archive's blobs destroys nothing, and without
   * them the rows the replace writes name pictures this card never held.
   */
  it('on a replace, keeps the portrait here and gains the pictures the archive names', async () => {
    const { id } = await anActorWithAnExpression();
    const files = await archiveOf();
    await removeObject(id);
    const here = makePng(5, 9);
    await create(
      server.services.library,
      'ned',
      { ...newActor('Vera, made again'), id },
      undefined,
      { cardPixels: here },
    );

    await importInto(files, 'replace');

    const back = read(server.services.library, 'ned', id);
    expect((back.body as { name: string }).name).toBe('Vera Solano');
    expect(plain(pixelBytes((await readFileBytes(back.path))!))).toEqual(plain(pixelBytes(here)));
    const media = await readMedia(server.services.library, 'ned', id, 'm-neutral');
    expect(plain(media.bytes)).toEqual(plain(GIF));
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

  /**
   * ***Only what the import reads is held and counted*** (2026-09-27). The
   * bounds used to apply to every member, so another account's work, the
   * operational store, and each object's history all counted against an
   * import that reads none of them: an account of about eighty edited objects
   * passed 4,096 files, and was refused as unreadable.
   */
  it('holds and counts only what an import of one account reads', async () => {
    const path = join(scratch, 'install.tar.gz');
    const bytes = (size: number): Uint8Array => new Uint8Array(size);
    await writeTarGz(
      path,
      [
        { name: 'backup.json', bytes: new TextEncoder().encode('{}') },
        { name: 'users/ned/library/lorebooks/rain/lorebook.json', bytes: bytes(512) },
        { name: 'users/ned/library/lorebooks/rain/history/v1.json', bytes: bytes(4096) },
        { name: 'users/mara/library/lorebooks/big/lorebook.json', bytes: bytes(4096) },
        { name: 'state/state.sqlite', bytes: bytes(4096) },
      ],
      0,
    );
    const limits = { maxEntries: 4096, maxEntryBytes: 1024, maxTotalBytes: 2048 };

    expect(await BackupFileSource.open(path, limits)).toEqual({ ok: false, refusal: 'too-large' });

    const opened = await BackupFileSource.open(path, limits, importedBy('ned'));
    if (!opened.ok) throw new Error(opened.refusal);
    const held: string[] = [];
    for await (const name of opened.source.list()) held.push(name);
    expect(held.sort()).toEqual(['backup.json', 'users/ned/library/lorebooks/rain/lorebook.json']);
  });

  it('still refuses an archive with an escaping member it would not have read', async () => {
    const path = join(scratch, 'escaping-elsewhere.tar.gz');
    await writeTarGz(
      path,
      [{ name: 'users/mara/../../etc/passwd', bytes: new TextEncoder().encode('no') }],
      0,
    );

    expect(await BackupFileSource.open(path, undefined, importedBy('ned'))).toEqual({
      ok: false,
      refusal: 'unsafe-path',
    });
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
