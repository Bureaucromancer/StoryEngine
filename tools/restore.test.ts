// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * ***A `.mjs` tool, imported by the one test that is about it.***
 *
 * `allowJs` resolves it, so the functions arrive as `any` rather than
 * unresolved — which is why the annotations below are written out at each call
 * site rather than inferred. The alternative is a second build target for a
 * script that runs under plain node by design, which is the property
 * `tools/*.mjs` exists to have.
 */
import { create, filesUnder, OWN_ENTRIES, restore } from './backup.mjs';
import { performPendingRestore } from '../packages/server/src/backup/restore.js';
import { OWN_ENTRIES as SERVER_OWN_ENTRIES } from '../packages/server/src/backup/swap.js';
import { Layout } from '../packages/server/src/storage/layout.js';
import { writeTarGz } from '../packages/server/src/storage/tar-archive.js';

/**
 * ***An untested restore is not a backup*** —
 * [25 E6](../docs/design/25-open-questions.md),
 * [work plan §8](../docs/design/workplan/01-work-plan.md),
 * [P11.11](../docs/design/workplan/28-p11-implementation.md).
 *
 * E6 says the part that matters is this file: *"populate a data directory, back
 * it up, restore into a clean install, assert the library and sessions are
 * intact."* And the stage's proof obligation adds the clause that makes it a
 * **restore** test rather than a copy test: ***the index is rebuilt, not
 * carried.***
 *
 * ***Why that clause is the whole point.*** [03 §5.1] makes `index.sqlite`
 * derived — a cache of what the files say, dropped and rebuilt whenever its
 * schema version moves. An archive that carried it would restore correctly
 * today and, the first time somebody restored across a version, restore a stale
 * belief about a newer tree — **silently, because a stale index answers
 * queries.** So the archive must not contain it, and *"an archive that quietly
 * included the index would pass every other check"*, which is why this file
 * asserts the absence directly rather than only the outcome.
 *
 * *The live half — restore into a running install and watch a search answer —
 * is [testing](../docs/design/workplan/03-testing.md)'s, and this phase's one
 * case of the check living outside the document that owes it.*
 */

let source: string;
let archive: string;
let destination: string;

beforeEach(async () => {
  source = await mkdtemp(join(tmpdir(), 'se-backup-'));
  destination = await mkdtemp(join(tmpdir(), 'se-restore-'));
  archive = join(await mkdtemp(join(tmpdir(), 'se-archive-')), 'backup.tar.gz');
});

afterEach(async () => {
  for (const path of [source, destination, archive]) {
    await rm(path, { recursive: true, force: true });
  }
});

/** A data directory with the shapes a real one has. */
async function populate(): Promise<void> {
  await mkdir(join(source, 'users', 'ned', 'library', 'actors', 'vera'), { recursive: true });
  await writeFile(
    join(source, 'users', 'ned', 'library', 'actors', 'vera', 'actor.json'),
    JSON.stringify({ schema: 'se.actor.v1', id: 'actor-1', name: 'Vera' }),
  );
  await mkdir(join(source, 'users', 'ned', 'sessions', 'session-1', 'turns'), { recursive: true });
  await writeFile(
    join(source, 'users', 'ned', 'sessions', 'session-1', 'session.json'),
    JSON.stringify({ id: 'session-1', name: 'Rain City' }),
  );
  await writeFile(
    join(source, 'users', 'ned', 'sessions', 'session-1', 'turns', '0000.jsonl'),
    '{"id":"turn-1","output":{"text":"The keeper points north."}}\n',
  );
  await writeFile(join(source, 'accounts.json'), JSON.stringify({ accounts: [] }));

  /**
   * ***The derived half, at the depth it actually has.***
   *
   * This fixture wrote `index.sqlite` at the **source root** for six days, which
   * is not where [03 §5.1] puts it — `Layout.indexFile` is `index/index.sqlite`
   * — and the script's exclusion was a filename test applied only at the root.
   * The two agreed with each other and neither agreed with the layout, so the
   * suite was green over an archive that carried the index every time. Writing
   * it where it lives is the whole of what makes the assertion below mean
   * anything.
   */
  await mkdir(join(source, 'index'), { recursive: true });
  await writeFile(join(source, 'index', 'index.sqlite'), 'a stale belief about a newer tree');
  await writeFile(join(source, 'index', 'index.sqlite-wal'), 'and its write-ahead log');

  // What [03 §10.2] says must not travel: *restoring a backup should not
  // resurrect everything the user threw away before taking it.*
  await mkdir(join(source, 'users', 'ned', 'trash', 'actors', 'gone-0199'), { recursive: true });
  await writeFile(
    join(source, 'users', 'ned', 'trash', 'actors', 'gone-0199', 'actor.json'),
    JSON.stringify({ name: 'Deliberately discarded' }),
  );

  // And the archives themselves, which would otherwise make every generation
  // carry every one before it.
  await mkdir(join(source, 'backups'), { recursive: true });
  await writeFile(join(source, 'backups', 'install-full-2026-09-21-x.tar.gz'), 'an older archive');
  await mkdir(join(source, 'users', 'ned', 'backups'), { recursive: true });
  await writeFile(join(source, 'users', 'ned', 'backups', 'account-ned-full-x.tar.gz'), 'theirs');
}

describe('a backup of a data directory', () => {
  it('carries the files and leaves the index behind', async () => {
    await populate();

    const listed: string[] = await filesUnder(source);
    expect(listed).toContain('users/ned/library/actors/vera/actor.json');
    expect(listed).toContain('users/ned/sessions/session-1/turns/0000.jsonl');
    expect(listed).toContain('accounts.json');
    /**
     * ***The assertion that makes it a restore rather than a copy***, and it is
     * written against the path rather than a filename on purpose: the version
     * of this line that tested `startsWith('index.sqlite')` passed for six days
     * over archives that carried `index/index.sqlite`, because no member name
     * ever *starts* with that string once the index is one directory down.
     */
    expect(listed.some((name: string) => name.startsWith('index/'))).toBe(false);
  });

  it('leaves the trash behind, which the design has always said and nothing enforced', async () => {
    await populate();

    const listed: string[] = await filesUnder(source);
    expect(listed.some((name: string) => name.includes('/trash/'))).toBe(false);
  });

  /**
   * ***An archive of the archives is how a data directory fills a disk.*** Each
   * generation would carry every one before it, so the growth is not linear in
   * the library but in the number of backups taken.
   */
  it('leaves the stored backups behind, at both of their homes', async () => {
    await populate();

    const listed: string[] = await filesUnder(source);
    expect(listed.some((name: string) => name.startsWith('backups/'))).toBe(false);
    expect(listed.some((name: string) => name.includes('/backups/'))).toBe(false);
  });
});

describe('restoring into a clean directory', () => {
  it('puts the library and the sessions back, byte for byte', async () => {
    await populate();
    await create(source, archive);
    await restore(archive, destination);

    const actor = await readFile(
      join(destination, 'users', 'ned', 'library', 'actors', 'vera', 'actor.json'),
      'utf8',
    );
    expect(JSON.parse(actor)).toEqual({ schema: 'se.actor.v1', id: 'actor-1', name: 'Vera' });

    const turns = await readFile(
      join(destination, 'users', 'ned', 'sessions', 'session-1', 'turns', '0000.jsonl'),
      'utf8',
    );
    expect(turns).toContain('The keeper points north.');
  });

  /**
   * ***The index is not there afterwards***, which is what leaves the server no
   * choice but to rebuild it on the next start. An archive that quietly
   * included it would pass every other check in this file.
   */
  it('leaves no index behind for a server to trust', async () => {
    await populate();
    await create(source, archive);
    await restore(archive, destination);

    /**
     * ***Asked of the filesystem, not of `filesUnder`.***
     *
     * `filesUnder` is the function that decides what an archive excludes, so
     * asking it whether the index arrived is asking the exclusion to confirm
     * itself — it would answer *no index* over a destination with one sitting in
     * it. The only witness that means anything is the directory.
     */
    await expect(stat(join(destination, 'index'))).rejects.toThrow();
    await expect(stat(join(destination, 'users', 'ned', 'trash'))).rejects.toThrow();
  });

  /**
   * ***A name past a hundred bytes, which this project reaches in ordinary
   * use.*** A version payload under a long slug —
   * `users/<handle>/library/lorebooks/<slug>/history/v/<64-hex>.json` — is about
   * 232 bytes, and the header's `name` field holds 100. The writer used to cut
   * it there, which does not produce a broken archive but a plausible one, in
   * which every version payload under that object lands on the same truncated
   * name and all but the last is lost. ustar's `prefix` field is the answer and
   * has been since 1988; this asserts the round trip rather than the header.
   */
  it('carries a member whose name needs the ustar prefix field', async () => {
    const slug = 'a-lorebook-with-a-name-somebody-actually-typed-out-in-full-abcd';
    const digest = 'c'.repeat(64);
    const deep = join('users', 'ned', 'library', 'lorebooks', slug, 'history', 'v');
    await mkdir(join(source, deep), { recursive: true });
    await writeFile(join(source, deep, `${digest}.json`), '{"version":"kept whole"}');

    const name = `${deep.split(sep).join('/')}/${digest}.json`;
    expect(name.length).toBeGreaterThan(100);

    await create(source, archive);
    await restore(archive, destination);

    expect(await readFile(join(destination, deep, `${digest}.json`), 'utf8')).toBe(
      '{"version":"kept whole"}',
    );
  });

  /**
   * ***An archive is somebody else's bytes.*** `../../etc/passwd` in a tar
   * header is the oldest attack there is, and the fact that this project writes
   * its own archives is exactly the assumption a restore must not make — the
   * thing a person restores is the file that survived, from a disk that may
   * have had a bad week.
   */
  it('refuses an archive that names a path outside the destination', async () => {
    await mkdir(join(source, 'users'), { recursive: true });
    await writeFile(join(source, 'users', 'ok.json'), '{}');
    await create(source, archive);

    // The header's name field, rewritten in place — which is what a hostile
    // archive is, and is cheaper to make than to describe.
    const { createGunzip, createGzip } = await import('node:zlib');
    const { pipeline } = await import('node:stream/promises');
    const { createReadStream, createWriteStream } = await import('node:fs');
    const chunks: Buffer[] = [];
    for await (const chunk of createReadStream(archive).pipe(createGunzip())) {
      chunks.push(chunk as Buffer);
    }
    const tar = Buffer.concat(chunks);
    tar.fill(0, 0, 100);
    tar.write('../escaped.json', 0, 100, 'utf8');
    // The checksum is now wrong and this reader does not check it, which is
    // stated rather than hidden: the path check is the boundary, not the sum.
    const gzip = createGzip();
    const done = pipeline(gzip, createWriteStream(archive));
    gzip.end(tar);
    await done;

    await expect(restore(archive, destination)).rejects.toThrow(/outside the data directory/);
  });
});

/**
 * ***Over an install, and without deleting anything*** — corrected 2026-09-27.
 *
 * This command used to begin with `rm -rf` on the data directory, before it had
 * read a single header. Every stored backup went with it, since they live in
 * the data directory, and so did the install, whatever the archive then turned
 * out to hold. And `shared/backup.ts` said it refused an account archive,
 * which it never did.
 */
describe('restoring over an install', () => {
  /** An install worth losing: a library, and archives at both of their homes. */
  async function anInstallAt(dir: string): Promise<void> {
    await mkdir(join(dir, 'users', 'ned', 'library', 'actors', 'kept'), { recursive: true });
    await writeFile(join(dir, 'users', 'ned', 'library', 'actors', 'kept', 'actor.json'), '{}');
    await writeFile(join(dir, 'accounts.json'), JSON.stringify({ accounts: [] }));
    await mkdir(join(dir, 'backups'), { recursive: true });
    await writeFile(join(dir, 'backups', 'install-full-2026-09-01-x.tar.gz'), 'an archive');
    await mkdir(join(dir, 'users', 'ned', 'backups'), { recursive: true });
    await writeFile(join(dir, 'users', 'ned', 'backups', 'account-ned-full-x.tar.gz'), 'theirs');
  }

  /**
   * The two lists of what makes a directory an install, one here and one in
   * the server's swap, are one set: the command decides *write straight in*
   * or *stage for the server* with its copy, and the server moves aside with
   * its own.
   */
  it('agrees with the server about what an install’s own entries are', () => {
    expect([...OWN_ENTRIES].sort()).toEqual([...SERVER_OWN_ENTRIES].sort());
  });

  /**
   * ***Staged, and the install untouched.*** The swap is the server's, at its
   * next start, with the journal and the roll-back that has.
   *
   * Catches: writing into, or emptying, a directory that holds an install.
   */
  it('stages, and changes nothing in the install or its archives', async () => {
    await populate();
    await create(source, archive);
    await anInstallAt(destination);

    const outcome = (await restore(archive, destination)) as {
      files: number;
      staged: { id: string; replaced: string } | null;
    };

    expect(outcome.staged).not.toBeNull();
    expect(
      await readFile(
        join(destination, 'users', 'ned', 'library', 'actors', 'kept', 'actor.json'),
        'utf8',
      ),
    ).toBe('{}');
    expect(
      await readFile(join(destination, 'backups', 'install-full-2026-09-01-x.tar.gz'), 'utf8'),
    ).toBe('an archive');
    expect(await stat(join(destination, '.restore', 'swap.json'))).toBeTruthy();
    await expect(
      stat(join(destination, 'users', 'ned', 'library', 'actors', 'vera', 'actor.json')),
    ).rejects.toThrow();
  });

  /**
   * ***The server finishes it.*** The journal the command writes is the one
   * the server's boot reads, which is the whole contract between the two, so
   * it is proved with the server's own function rather than described.
   */
  it('is finished by the server’s next start, archives kept live', async () => {
    await populate();
    await create(source, archive);
    await anInstallAt(destination);
    await restore(archive, destination);

    const outcome = await performPendingRestore(new Layout(destination));

    expect(outcome.kind).toBe('restored');
    const actor = await readFile(
      join(destination, 'users', 'ned', 'library', 'actors', 'vera', 'actor.json'),
      'utf8',
    );
    expect(JSON.parse(actor)).toEqual({ schema: 'se.actor.v1', id: 'actor-1', name: 'Vera' });
    // Both archives are where the lists look for them.
    expect(
      await readFile(join(destination, 'backups', 'install-full-2026-09-01-x.tar.gz'), 'utf8'),
    ).toBe('an archive');
    expect(
      await readFile(
        join(destination, 'users', 'ned', 'backups', 'account-ned-full-x.tar.gz'),
        'utf8',
      ),
    ).toBe('theirs');
  });

  /**
   * ***One person's archive is not an install***, and restoring it as one
   * would leave that person's tree and nothing else.
   *
   * Catches: a restore that reads no manifest.
   */
  it('refuses an account archive, and writes nothing', async () => {
    const manifest = {
      schema: 'storyengine.backup-manifest/1',
      scope: 'account',
      handle: 'ned',
      files: 1,
    };
    await writeTarGz(
      archive,
      [
        { name: 'backup.json', bytes: new TextEncoder().encode(JSON.stringify(manifest)) },
        { name: 'users/ned/library/actors/vera/actor.json', bytes: new TextEncoder().encode('{}') },
      ],
      0,
    );

    await expect(restore(archive, destination)).rejects.toThrow(/one account's archive/);
    expect(await filesUnder(destination)).toEqual([]);
  });

  /**
   * ***Every header is read before anything is written.*** A hostile name as
   * the *last* member used to be found after every member before it had been
   * written, into a directory already emptied.
   *
   * Catches: checking each name as it is written.
   */
  it('refuses a bad name at the end of an archive before writing its beginning', async () => {
    await writeTarGz(
      archive,
      [
        { name: 'users/ned/library/actors/vera/actor.json', bytes: new TextEncoder().encode('{}') },
        { name: 'backups/smuggled.tar.gz', bytes: new TextEncoder().encode('not ours') },
      ],
      0,
    );

    await expect(restore(archive, destination)).rejects.toThrow(/where a restore never writes/);
    expect(await filesUnder(destination)).toEqual([]);
  });

  /**
   * ***Two archives from one pattern.*** `docs/deploy.md`'s example is a glob,
   * and two backups on one day expand it to two names. The second used to be
   * taken for the data directory: emptied, which deleted that backup, and
   * restored into.
   */
  it('takes exactly one archive, and deletes neither when given two', async () => {
    const { spawnSync } = await import('node:child_process');
    const second = join(destination, 'second.tar.gz');
    await writeFile(second, 'the other backup');
    await populate();
    await create(source, archive);

    const run = spawnSync(
      process.execPath,
      [join(import.meta.dirname, 'backup.mjs'), 'restore', archive, second, destination],
      { encoding: 'utf8' },
    );

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('one archive');
    expect(await readFile(second, 'utf8')).toBe('the other backup');
    expect(await stat(archive)).toBeTruthy();
  });
});
