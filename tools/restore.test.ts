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
import { create, filesUnder, restore } from './backup.mjs';

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
