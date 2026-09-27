// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { basename, dirname, join, resolve, sep } from 'node:path';
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
  // And a removed account's, which went to `removed/` with its directory. The
  // server's archive leaves them out too: see `alwaysSkipped` there.
  /^removed\/[^/]+\/(trash|backups)$/,
  // A restore's own directory, which holds the whole install it replaced, and
  // a restore asked for and not yet done: the server's archive leaves both out
  // (`backup/archive.ts`), and an archive that carried the second would ask for
  // a restore the moment it was itself restored.
  /^\.restore$/,
  /^state\/restore\.pending$/,
];

/** Whether a path relative to the data root is one of {@link EXCLUDED}. */
function excluded(path) {
  return EXCLUDED.some((rule) => rule.test(path));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'create' && rest.length === 2) {
    const [dataDir, archive] = rest;
    const count = await create(resolve(dataDir), resolve(archive));
    console.log(`${archive}: ${String(count)} files; index, trash and backups excluded.`);
    return;
  }
  if (command === 'restore' && rest.length === 2) {
    const [archive, dataDir] = rest;
    let outcome;
    try {
      outcome = await restore(resolve(archive), resolve(dataDir));
    } catch (error) {
      // Refused before anything was written: say why, in one line.
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    if (outcome.staged === null) {
      console.log(
        `${dataDir}: ${String(outcome.files)} files restored. Start the server to rebuild the index.`,
      );
    } else {
      console.log(
        [
          `${dataDir}: ${String(outcome.files)} files staged, and nothing in the install has changed yet.`,
          'Start the server: before it opens anything it swaps these in, and keeps what they',
          `replace in ${outcome.staged.replaced}. Delete that when you are sure.`,
        ].join('\n'),
      );
    }
    return;
  }
  /**
   * ***Exactly one archive, and a glob that matched two is refused by name.***
   * `docs/deploy.md` shows `install-full-2026-09-22-*.tar.gz`, and two backups
   * on one day expand it to two names. This used to read the second archive
   * as the data directory, empty it with `rm -rf` (deleting that backup) and
   * restore the first into a directory named after it.
   */
  if (command === 'restore' && rest.length > 2) {
    console.error(
      `restore takes one archive and one data directory, and was given ${String(rest.length)} paths. If a pattern matched several archives, name the one you mean.`,
    );
    process.exit(1);
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

/**
 * ***StoryEngine's own entries at a data directory's root***, which say an
 * install is there. `OWN_ENTRIES` in `packages/server/src/backup/swap.ts` is
 * the list the server's swap moves aside, and `restore.test.ts` holds the two
 * to one set.
 */
const OWN_ENTRIES = [
  'accounts.json',
  'backup.json',
  'config.json',
  'index',
  'removed',
  'state',
  'system',
  'users',
];

/** The swap journal's format, which the server reads: `SWAP_JOURNAL_SCHEMA`. */
const SWAP_JOURNAL_SCHEMA = 'storyengine.restore-swap/1';

/**
 * Where a restore never writes: the stored archives, anybody's own, and a
 * restore's own directory. No archive either writer makes carries them.
 */
function keptLive(name) {
  return /^(backups|\.restore)(\/|$)/.test(name) || /^users\/[^/]+\/backups(\/|$)/.test(name);
}

/**
 * Every member, checked, and nothing written — the half of a restore that can
 * still say no.
 *
 * ***All of it before the first byte lands.*** This used to empty the data
 * directory with `rm -rf` and then check each header as it wrote, so an archive
 * whose tenth member was hostile, or cut short, left an install that was gone
 * and a restore that was half done.
 */
function membersOf(tar, dataDir) {
  const members = [];
  let at = 0;
  while (at + BLOCK <= tar.length) {
    const block = tar.subarray(at, at + BLOCK);
    if (block.every((byte) => byte === 0)) break;

    // **Both name fields, rejoined** — `headerName`, not the first hundred
    // bytes. A long member is written as a 155-byte `prefix` plus a `name`, and
    // a reader that took only the second would write `history/v/<hex>.json` to
    // the destination root, scattering one library's version payloads into a
    // flat pile at the top of somebody's data directory.
    const name = headerName(block).replaceAll('\\', '/');
    const size = Number.parseInt(
      block.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(),
      8,
    );
    at += BLOCK;
    if (!Number.isFinite(size) || size < 0 || at + size > tar.length) {
      throw new Error(`The archive is cut short at ${name}, and nothing was restored.`);
    }

    /**
     * ***Every path is checked against the destination.*** An archive is
     * somebody else's bytes, and `../../etc/passwd` in a tar header is the
     * oldest attack there is. This one is written by the script above, and
     * *that is exactly the assumption a restore must not make*: the thing a
     * person restores is the file that survived, from a disk that may have had
     * a bad week.
     */
    const target = resolve(dataDir, name);
    if (!target.startsWith(dataDir + sep)) {
      throw new Error(`The archive names a path outside the data directory: ${name}`);
    }
    if (keptLive(name)) {
      throw new Error(
        `The archive carries ${name}, where a restore never writes: the stored archives, or a restore's own directory.`,
      );
    }

    if (!name.endsWith('/')) members.push({ name, bytes: tar.subarray(at, at + size) });
    at += size + ((BLOCK - (size % BLOCK)) % BLOCK);
  }
  return members;
}

/**
 * ***An account archive is refused*** — the refusal `shared/backup.ts` says
 * this script makes and it never did. Member names are data-root-relative in
 * both scopes, so one person's archive unpacks into the right place, and
 * restoring it *as the install* would leave that person's tree and nothing
 * else. The count is checked too, where the archive has a manifest to count
 * against: an archive this script made has none.
 */
function checkManifest(members) {
  const first = members[0];
  if (first?.name !== 'backup.json') return;
  let manifest;
  try {
    manifest = JSON.parse(first.bytes.toString('utf8'));
  } catch {
    throw new Error(
      'The archive begins with a manifest that cannot be read, and nothing was restored.',
    );
  }
  if (manifest?.scope === 'account') {
    throw new Error(
      "This is one account's archive, not the install's, and restoring it as the install would leave nothing else. To put one person's work back, unpack it into the data directory with tar, as docs/deploy.md shows.",
    );
  }
  if (typeof manifest?.files === 'number' && manifest.files !== members.length - 1) {
    throw new Error(
      `The archive's manifest names ${String(manifest.files)} files and it holds ${String(members.length - 1)}: it has been cut short, and nothing was restored.`,
    );
  }
}

async function writeMembers(members, root) {
  for (const { name, bytes } of members) {
    const target = join(root, ...name.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

async function entriesOf(path) {
  try {
    return await readdir(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Restores an archive into a data directory, and **deletes nothing**.
 *
 * - **Into a directory with no install in it**, the members are written
 *   straight in. That is the clean restore `docs/deploy.md` recommends.
 * - **Over an install**, they are staged in `.restore/<id>/staging` with a
 *   journal, and the server's next start swaps them in before it opens
 *   anything, keeping the install they replace in `.restore/<id>/replaced`.
 *   One swap, the server's, with its roll-back and its journal, rather than a
 *   second copy of it here. And a swap this script started could not be
 *   trusted not to run under a server somebody forgot to stop.
 *
 * ***It used to `rm -rf` the data directory first***, before reading a header:
 * every stored backup in it went too, and a bad archive left nothing at all.
 */
async function restore(archive, dataDir) {
  // Read whole rather than streamed, and the archive's size is why that is
  // fine: a data directory of stories and cards is megabytes, and a streaming
  // tar reader is a state machine — which is a thing to get wrong in the one
  // tool somebody reaches for when things have already gone wrong.
  const chunks = [];
  for await (const chunk of createReadStream(archive).pipe(createGunzip())) chunks.push(chunk);
  const tar = Buffer.concat(chunks);

  const members = membersOf(tar, dataDir);
  checkManifest(members);
  const files = members.filter((member) => member.name !== 'backup.json').length;

  const journal = join(dataDir, '.restore', 'swap.json');
  if ((await entriesOf(join(dataDir, '.restore'))).includes('swap.json')) {
    throw new Error(
      `A restore is already staged in ${dataDir}. Start the server to finish it, or delete ${journal} to call it off.`,
    );
  }

  const installed = (await entriesOf(dataDir)).some((name) => OWN_ENTRIES.includes(name));
  if (!installed) {
    await writeMembers(members, dataDir);
    return { files, staged: null };
  }

  // A timestamp rather than a random id: this repository draws nothing it does
  // not record (19 §14), and a name only has to be unique among restores staged
  // here, of which the journal check above allows one at a time.
  const id = `cli-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
  const work = join(dataDir, '.restore', id);
  await writeMembers(members, join(work, 'staging'));
  // Temp and rename, which is the server's `writeJsonAtomic` by hand: a journal
  // is read at boot, and a torn one would stop it.
  const record = {
    schema: SWAP_JOURNAL_SCHEMA,
    id,
    archive: basename(archive),
    requestedBy: '',
    files,
    phase: 'staged',
  };
  await writeFile(`${journal}.part`, JSON.stringify(record));
  await rename(`${journal}.part`, journal);
  return { files, staged: { id, replaced: join(work, 'replaced') } };
}

/** Exported for the restore test, which drives them rather than the argv above. */
export { create, restore, filesUnder, OWN_ENTRIES };

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
