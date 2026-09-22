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
 * and get identical artifacts.** For a tarball that is three decisions, all of
 * them here:
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
 * *The mode is decided by name, as executable-or-not*, which is the one bit
 * that matters (`install.sh`) and the one bit a `umask` on the packing machine
 * could otherwise leak into the artifact.
 *
 * **It is read from the name rather than from the file**, because the third
 * decision above is not achievable any other way: Windows has no executable
 * bit to read, so `stat` there reports `0644` for a file `chmod 0755` claims to
 * have set, and the same tree packed on two machines produced two different
 * artifacts — one of them shipping an `install.sh` the tier's one instruction
 * cannot run. A name is the same on every machine.
 *
 * Usage:
 *   node tools/pack-tarball.mjs <deployed-dir> <extras-dir> <archive.tar.gz>
 */

/** The prefix every member sits under, so an unpack cannot scatter a tree. */
const ROOT = 'storyengine';

/**
 * Which members the artifact carries as executable, by name.
 *
 * A shell script is the only thing in this tree anybody runs, and `install.sh`
 * is the one the deploy note names. Widening this to "whatever the filesystem
 * says" is what the header paragraph rejects; narrowing it to the literal
 * `install.sh` would leave a second script silently unrunnable, which is the
 * same failure one file later.
 */
const isExecutable = (name) => name.endsWith('.sh');

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
    // Executable or not, and nothing else: neither a `umask` nor a filesystem
    // that cannot hold the bit may reach the artifact.
    const mode = isExecutable(member.name) ? 0o755 : 0o644;
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
