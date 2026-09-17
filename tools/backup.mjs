// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

/**
 * Backs up and restores a data directory —
 * [25 E6](../docs/design/25-open-questions.md),
 * [P11.11](../docs/design/workplan/28-p11-implementation.md).
 *
 * ***E6's whole instruction is "do not build a subsystem".*** *"Files on disk
 * means `rsync` is a legitimate backup strategy and should be documented as
 * one. What is worth building is small: a command that briefly quiesces writes,
 * archives the data directory **excluding the index**, and a restore that puts
 * it back and rebuilds."* So this is a script rather than a route, a server
 * feature or a schedule — and the two things it does that `rsync` does not are
 * the two that matter.
 *
 * ***The first is the exclusion, and it is the whole design.*** [03 §5.1] makes
 * the index **derived**: `index.sqlite` is a cache of what the files say, it is
 * rebuilt whenever its schema version moves, and carrying it in an archive
 * would make the archive carry a schema. An archive that included it would
 * restore correctly today and restore a *stale belief about a newer tree* the
 * first time somebody restored across a version — and it would do so silently,
 * because a stale index answers queries. **Leaving it out is what makes the
 * restore a restore rather than a copy**, and it is why the restore test's
 * assertion is that a *search answers*: a search is the only observable proof
 * the rebuild ran.
 *
 * ***The second is the quiesce.*** A backup taken mid-write catches a session
 * file half-written, which is a corrupt story rather than a corrupt cache. The
 * honest way to quiesce this build is to **not be running** — there is no
 * write-lock to take from outside the process, and inventing one would be the
 * subsystem E6 forbids. So the script says so rather than pretending, and
 * `POST /api/admin/restart` with a drain is how an operator gets there
 * ([09 §6.4], [P10.3]).
 *
 * **A tar, written by hand, and no dependency.** The format is forty years old
 * and the subset an archive of a directory tree needs is a header struct and
 * padding. A dependency here would be a supply-chain surface on the one tool
 * somebody reaches for when things have already gone wrong.
 *
 * Usage:
 *   node tools/backup.mjs create <data-dir> <archive.tar.gz>
 *   node tools/backup.mjs restore <archive.tar.gz> <data-dir>
 */

/**
 * ***What never goes in the archive.***
 *
 * `index.sqlite` and its two companions — SQLite writes a `-wal` and a `-shm`
 * beside the database, and an archive that took the database without them (or
 * with them, from a running server) would restore a file that is neither
 * current nor empty. All three are derived, so all three go.
 */
const DERIVED = /^index\.sqlite(-wal|-shm)?$/;

const BLOCK = 512;

async function main() {
  const [command, first, second] = process.argv.slice(2);
  if (command === 'create' && first && second) {
    const count = await create(resolve(first), resolve(second));
    console.log(`${second}: ${String(count)} files, index excluded.`);
    return;
  }
  if (command === 'restore' && first && second) {
    const count = await restore(resolve(first), resolve(second));
    console.log(
      `${second}: ${String(count)} files restored. Start the server to rebuild the index.`,
    );
    return;
  }
  console.error(
    [
      'Usage:',
      '  node tools/backup.mjs create <data-dir> <archive.tar.gz>',
      '  node tools/backup.mjs restore <archive.tar.gz> <data-dir>',
      '',
      'Stop the server first. There is no way to quiesce writes from outside the',
      'process, and a backup taken mid-write catches a half-written session.',
    ].join('\n'),
  );
  process.exit(1);
}

/** Every file under a root, relative and POSIX-separated, with the index left out. */
async function filesUnder(root, at = '') {
  const found = [];
  for (const entry of await readdir(join(root, at), { withFileTypes: true })) {
    const here = at === '' ? entry.name : `${at}/${entry.name}`;
    if (at === '' && DERIVED.test(entry.name)) continue;
    if (entry.isDirectory()) found.push(...(await filesUnder(root, here)));
    else if (entry.isFile()) found.push(here);
  }
  return found;
}

async function create(dataDir, archive) {
  const files = await filesUnder(dataDir);
  await mkdir(dirname(archive), { recursive: true });

  const gzip = createGzip();
  const out = createWriteStream(archive);
  const done = pipeline(gzip, out);

  for (const name of files) {
    const path = join(dataDir, ...name.split('/'));
    const info = await stat(path);
    gzip.write(header(name, info.size));
    await pipeline(createReadStream(path), gzip, { end: false });
    const padding = (BLOCK - (info.size % BLOCK)) % BLOCK;
    if (padding > 0) gzip.write(Buffer.alloc(padding));
  }
  // Two empty blocks end a tar, and a reader that trusts the format needs them.
  gzip.end(Buffer.alloc(BLOCK * 2));
  await done;
  return files.length;
}

/**
 * One ustar header.
 *
 * Only the fields a directory tree needs: name, mode, size, mtime, type and the
 * checksum. Ownership is deliberately zero — a restore into a container runs as
 * whoever the container runs as, and carrying uids from the machine the backup
 * was taken on is how a restore produces files its own server cannot read.
 */
function header(name, size) {
  const block = Buffer.alloc(BLOCK);
  block.write(name.slice(0, 100), 0, 100, 'utf8');
  block.write('0000644\0', 100, 8, 'ascii');
  block.write('0000000\0', 108, 8, 'ascii');
  block.write('0000000\0', 116, 8, 'ascii');
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  block.write(
    `${Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, '0')}\0`,
    136,
    12,
    'ascii',
  );
  block.write('        ', 148, 8, 'ascii');
  block.write('0', 156, 1, 'ascii');
  block.write('ustar\0', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');

  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return block;
}

async function restore(archive, dataDir) {
  // Read whole rather than streamed, and the archive's size is why that is
  // fine: a data directory of stories and cards is megabytes, and a streaming
  // tar reader is a state machine — which is a thing to get wrong in the one
  // tool somebody reaches for when things have already gone wrong.
  const chunks = [];
  for await (const chunk of createReadStream(archive).pipe(createGunzip())) chunks.push(chunk);
  const tar = Buffer.concat(chunks);

  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  let at = 0;
  let count = 0;
  while (at + BLOCK <= tar.length) {
    const block = tar.subarray(at, at + BLOCK);
    if (block.every((byte) => byte === 0)) break;

    const name = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = Number.parseInt(
      block.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(),
      8,
    );
    at += BLOCK;

    /**
     * ***Every path is checked against the destination before it is written.***
     * An archive is somebody else's bytes, and `../../etc/passwd` in a tar
     * header is the oldest attack there is. This one is written by the script
     * above, and *that is exactly the assumption a restore must not make*: the
     * thing a person restores is the file that survived, from a disk that may
     * have had a bad week.
     */
    const target = resolve(dataDir, name);
    if (target !== dataDir && !target.startsWith(dataDir + sep)) {
      throw new Error(`The archive names a path outside the data directory: ${name}`);
    }

    await mkdir(dirname(target), { recursive: true });
    await pipeline(async function* () {
      yield tar.subarray(at, at + size);
    }, createWriteStream(target));
    at += size + ((BLOCK - (size % BLOCK)) % BLOCK);
    count += 1;
  }
  return count;
}

/** Exported for the restore test, which drives them rather than the argv above. */
export { create, restore, filesUnder };

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
