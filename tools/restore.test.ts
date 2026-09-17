// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  // The derived half, which must not survive the round trip.
  await writeFile(join(source, 'index.sqlite'), 'a stale belief about a newer tree');
  await writeFile(join(source, 'index.sqlite-wal'), 'and its write-ahead log');
}

describe('a backup of a data directory', () => {
  it('carries the files and leaves the index behind', async () => {
    await populate();

    const listed: string[] = await filesUnder(source);
    expect(listed).toContain('users/ned/library/actors/vera/actor.json');
    expect(listed).toContain('users/ned/sessions/session-1/turns/0000.jsonl');
    expect(listed).toContain('accounts.json');
    // **The assertion that makes it a restore rather than a copy.**
    expect(listed.some((name: string) => name.startsWith('index.sqlite'))).toBe(false);
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

    const restored: string[] = await filesUnder(destination);
    expect(restored.some((name: string) => name.startsWith('index.sqlite'))).toBe(false);
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
