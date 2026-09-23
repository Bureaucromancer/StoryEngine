// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

import { BLOCK, headerName, padding, tarHeader, trailer } from './tar.mjs';

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
 * ***What never goes in the archive***, as paths relative to the data root.
 *
 * **`index/` — the derived index, whole.** SQLite writes a `-wal` and a `-shm`
 * beside the database, and an archive that took the database without them (or
 * with them, from a running server) would restore a file that is neither
 * current nor empty. All three are derived, so the directory goes rather than a
 * list of filenames.
 *
 * ***This rule was written and did not fire, for six days.*** It read
 * `if (at === '' && DERIVED.test(entry.name))` — a filename test applied only at
 * the data root — and [03 §5.1] puts the index at **`index/index.sqlite`**, one
 * level down, where `at === ''` is false. So every archive this script has ever
 * written carried the index, which is the exact failure [25 E6], [P11.11] and
 * `docs/deploy.md` all exist to prevent: *a stale belief about a newer tree,
 * silently, because a stale index answers queries.* `restore.test.ts` did not
 * catch it because its fixture wrote `index.sqlite` at the **root**, agreeing
 * with the mistake rather than with the layout. Found by reading `layout.ts`
 * beside this file.
 *
 * **`users/<handle>/trash/`** — [03 §10.2]: *"trash is excluded from export and
 * from backup by default… restoring a backup should not resurrect everything the
 * user threw away before taking it."* That sentence cites [25 E6] and has never
 * had an enforcer.
 *
 * **`backups/` and `users/<handle>/backups/`** — where the in-app backups land.
 * An archive of the archives grows without bound, and each generation contains
 * every one before it.
 */
const EXCLUDED = [
  /^index$/,
  // The root-level spelling, which nothing writes and the old rule named. Kept
  // as a belt: a data directory somebody assembled by hand may carry one, and it
  // is as derived there as anywhere.
  /^index\.sqlite(-wal|-shm)?$/,
  /^backups$/,
  /^users\/[^/]+\/(trash|backups)$/,
];

/** Whether a path relative to the data root is one of {@link EXCLUDED}. */
function excluded(path) {
  return EXCLUDED.some((rule) => rule.test(path));
}

async function main() {
  const [command, first, second] = process.argv.slice(2);
  if (command === 'create' && first && second) {
    const count = await create(resolve(first), resolve(second));
    console.log(`${second}: ${String(count)} files; index, trash and backups excluded.`);
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

/**
 * Every file under a root, relative and POSIX-separated, minus {@link EXCLUDED}.
 *
 * **The test is on the path rather than the filename, and it runs before the
 * recursion** — which is both halves of the fix. A directory that is excluded is
 * never descended into, so `index/` costs one comparison rather than a walk, and
 * a rule can say *where* as well as *what*. The old filename-at-the-root form
 * could express neither.
 */
async function filesUnder(root, at = '') {
  const found = [];
  for (const entry of await readdir(join(root, at), { withFileTypes: true })) {
    const here = at === '' ? entry.name : `${at}/${entry.name}`;
    if (excluded(here)) continue;
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
  // The same listener cap `pack-tarball.mjs` raises, for the same reason: one
  // `close` listener per member on one gzip stream, and Node warns past ten.
  gzip.setMaxListeners(0);

  for (const name of files) {
    const path = join(dataDir, ...name.split('/'));
    const info = await stat(path);
    // **The backup's mtime is now**, where a release artifact's is zero: the
    // two callers of `tarHeader` want opposite things from that field, which is
    // why it is a parameter rather than a constant inside it.
    gzip.write(tarHeader(name, info.size, { mtime: Date.now() / 1000 }));
    await pipeline(createReadStream(path), gzip, { end: false });
    const pad = padding(info.size);
    if (pad > 0) gzip.write(Buffer.alloc(pad));
  }
  gzip.end(trailer());
  await done;
  return files.length;
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

    // **Both name fields, rejoined** — `headerName`, not the first hundred
    // bytes. A long member is written as a 155-byte `prefix` plus a `name`, and
    // a reader that took only the second would write `history/v/<hex>.json` to
    // the destination root, scattering one library's version payloads into a
    // flat pile at the top of somebody's data directory.
    const name = headerName(block);
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
