// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

import { padding, tarHeader, trailer } from './tar.mjs';

/**
 * ***Tier 2's artifact*** —
 * [09 §5.4](../docs/design/09-server-multiuser-deployment.md),
 * [work plan §8](../docs/design/workplan/01-work-plan.md),
 * [P11.9](../docs/design/workplan/28-p11-implementation.md).
 *
 * [releases §0](../docs/design/workplan/04-repo-and-releases.md) makes **two**
 * artifacts the beta bar — *"the canonical build must deliver the OCI image and
 * the tarball… for beta to count"* — and the image has existed since
 * [P6A](../docs/design/workplan/19-p6a-alpha-1.md). This is the other one, and
 * [09 §5.4] is unusually direct about why it is worth having: it is *"the single
 * highest-value non-container artifact, and the one most easily skipped"*,
 * because it answers *does it start on boot* for every Linux that is not Debian
 * or Arch, which is what quietly retires the case for an `.rpm`.
 *
 * ***What is in it is the image's own tree plus two files.*** The archive is
 * the deployed server — `dist`, the resolved `node_modules`, the built client,
 * `build-info.json` — with `storyengine.service` and `install.sh` beside it.
 * That is deliberate: two artifacts built from two different trees are two
 * things to test, and the difference between the tiers should be **how it is
 * supervised**, not what it runs.
 *
 * ***Reproducible, which is the clause this file exists to make checkable.***
 * [work plan §8] asks for *"reproducible builds of the container and the
 * tarball, from a tag"*, and [P11.9]'s proof obligation sharpens it to the only
 * form that distinguishes it from *the build works*: **tag twice on one commit
 * and get identical artifacts.** For a tarball that is four decisions, all of
 * them here — three below, and the mode after them:
 *
 * - **Entries are sorted**, because `readdir` order is a fact about a
 *   filesystem rather than about a release.
 * - **`mtime` is zero and ownership is zero**, because a timestamp is the
 *   commonest way an otherwise identical build stops being identical, and a uid
 *   from the packing machine is how an unpack produces files its own service
 *   cannot read.
 * - **gzip runs with no `mtime` field of its own**, which is the one that is
 *   easy to miss: the gzip *container* has a timestamp independent of anything
 *   in the tar, and Node stamps it unless told otherwise.
 *
 * ***And the mode is a fourth, which this file used to get wrong.*** Every member
 * is `0644` except the names in {@link EXECUTABLE}, which are `0755` — decided
 * by the member's **name**, never by what the packing filesystem says about it.
 * Until 2026-09-23 it was the other way round: the packer kept the executable
 * bit from `stat()` and normalised everything else, on the reasoning that the
 * bit was the one thing worth keeping and a `umask` the one thing worth
 * dropping. **Half of that was right.** The `umask` was dropped; the bit was
 * still a fact about the packing machine, and on Windows it is a fact that is
 * always false — Node reports `0666` for every file there, because NTFS has no
 * executable bit to report, and git records `100755` in its index while
 * `core.fileMode` is off and writes nothing to the disk that says so. So a
 * tarball packed on Windows shipped an `install.sh` that
 * [docs/deploy.md](../docs/deploy.md)'s one instruction, `sudo ./install.sh`,
 * cannot run — and `pack-tarball.test.ts` said so on every Windows CI run from
 * the day it landed, in a main that had been red for other reasons since
 * 2026-09-15 — which is why nobody read it.
 *
 * *Why a named list rather than asking git*, since git is the thing that does
 * know. `pack()` is given two directories and one of them is a build output
 * git has never seen; answering from the index would split the members into
 * two classes with two sources of truth, tie the packer to running inside a
 * checkout, and still leave every `node_modules` file's mode to the packing
 * filesystem. A list makes the archive a function of **names and bytes** and
 * nothing else, which is the reproducibility claim above in its strongest form:
 * not *the same machine twice* but *any machine*. Git is still the authority —
 * the test compares this list against the index, so a second executable added
 * to `deploy/tarball/` fails a test rather than shipping as `0644`.
 *
 * *And nothing else in the tree needs the bit*, which is what makes a list of
 * one honest rather than lossy: the unit runs `node dist/main.js`, so no member
 * of the deployed tree is ever executed directly, and the server's runtime
 * dependencies are pure JavaScript with no binary to spawn. Package `bin`
 * scripts that were `0755` on a Linux packer now ship `0644`, and nothing
 * calls them.
 *
 * Usage:
 *   node tools/pack-tarball.mjs <deployed-dir> <extras-dir> <archive.tar.gz>
 */

/** The prefix every member sits under, so an unpack cannot scatter a tree. */
const ROOT = 'storyengine';

/**
 * The members that ship `0755`, by name relative to the archive root — which is
 * also their name under `deploy/tarball/`, because extras land beside the tree
 * rather than under it. See the header for why this is a list, and
 * `pack-tarball.test.ts` for the test that keeps it equal to what git records.
 */
export const EXECUTABLE = new Set(['install.sh']);

async function main() {
  const [tree, extras, archive] = process.argv.slice(2);
  if (!tree || !extras || !archive) {
    console.error(
      'Usage: node tools/pack-tarball.mjs <deployed-dir> <extras-dir> <archive.tar.gz>',
    );
    process.exit(1);
  }
  const count = await pack(resolve(tree), resolve(extras), resolve(archive));
  console.log(`${archive}: ${String(count)} files.`);
}

/** Every file under a root, relative and POSIX-separated, sorted. */
export async function filesUnder(root, at = '') {
  const found = [];
  for (const entry of await readdir(join(root, at), { withFileTypes: true })) {
    const here = at === '' ? entry.name : `${at}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await filesUnder(root, here)));
    else if (entry.isFile()) found.push(here);
  }
  // **Sorted here rather than at the call site**, because an unsorted walk is
  // the reproducibility bug that only appears on somebody else's filesystem.
  return found.sort();
}

/**
 * Writes the archive and answers how many files went in.
 *
 * `extras` lands beside the tree rather than under it: `install.sh` is run from
 * the unpacked directory and copies its siblings into `PREFIX`, so it has to be
 * a sibling.
 */
export async function pack(tree, extras, archive) {
  const members = [
    ...(await filesUnder(extras)).map((name) => ({ name, from: join(extras, name) })),
    ...(await filesUnder(tree)).map((name) => ({ name, from: join(tree, name) })),
  ].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  // **A listed executable that is not in the archive is a refusal, not a
  // skip.** A list keyed by name has one way to go quietly wrong, which is a
  // rename: `install.sh` becomes `setup.sh`, the list still says `install.sh`,
  // and the new script ships `0644` with nothing to notice it. Failing the pack
  // is what makes the list safe to rely on — the alternative is the bug this
  // file just stopped having, reintroduced by a tidy-up.
  const names = new Set(members.map((member) => member.name));
  const missing = [...EXECUTABLE].filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(
      `pack-tarball: ${missing.join(', ')} should ship executable and is not in the archive — ` +
        'a renamed script has to be renamed in EXECUTABLE too.',
    );
  }

  await mkdir(dirname(archive), { recursive: true });
  // `mtime: 0` on the gzip container itself. Without it Node writes the current
  // time into the gzip header and two identical trees produce two different
  // files — the reproducibility failure that survives every check of the
  // contents.
  const gzip = createGzip({ level: 9, mtime: 0 });
  const done = pipeline(gzip, createWriteStream(archive));
  /**
   * ***A listener cap raised rather than a warning tolerated.*** Each
   * `pipeline(read, gzip, { end: false })` below attaches its own `close`
   * listener to the same gzip stream and Node warns past ten — on a tree with a
   * `node_modules` in it that is a warning per file, in the log of the one
   * command a release runs. It is not a leak: the listeners are the cost of
   * getting backpressure per member, and they go when the stream does.
   */
  gzip.setMaxListeners(0);

  for (const member of members) {
    const info = await stat(member.from);
    // By name, and `info.mode` is deliberately never read: neither a `umask`
    // nor a filesystem with no executable bit may reach the artifact.
    const mode = EXECUTABLE.has(member.name) ? 0o755 : 0o644;
    gzip.write(tarHeader(`${ROOT}/${member.name}`, info.size, { mtime: 0, mode }));
    await pipeline(createReadStream(member.from), gzip, { end: false });
    const pad = padding(info.size);
    if (pad > 0) gzip.write(Buffer.alloc(pad));
  }
  gzip.end(trailer());
  await done;
  return members.length;
}

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
