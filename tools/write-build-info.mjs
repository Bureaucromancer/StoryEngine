// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Writes `packages/server/build-info.json` — [P6A §1.5](../docs/design/workplan/23-p6a-alpha-1.md).
 *
 * **Run by the release build, not by `pnpm build`.** That is the line that keeps
 * development identity-free: a build nobody released has no version to claim,
 * `readBuildInfo` reports it as such, and the data-directory stamp neither
 * writes nor refuses. If `pnpm build` wrote this, every developer would have an
 * identified build carrying their own commit, and the stamp would start
 * refusing directories over versions nobody released.
 *
 * **The version is the root `package.json`'s**, which is the one place a human
 * edits it, and it has to equal the tag the release is cut at
 * ([P6A §1.6](../docs/design/workplan/23-p6a-alpha-1.md) fixes that as `v` plus
 * this string). The changelog entry names the same version, so the three agree
 * or the release is wrong in a way somebody will notice.
 *
 * **The commit comes from git, and a dirty tree is refused** unless
 * `--allow-dirty` is passed. A build identified by a commit it does not match
 * is worse than one with no identity at all: the whole promise of P6A is *a
 * build you can go back to*, and you cannot go back to a working tree.
 *
 * Exempt from the no-direct-`fs` rule for the reason `emit-schemas.ts` is: that
 * rule keeps one audited resolver the only door to *user data* reached from a
 * request, and a build script writing into the repository has no user root to
 * be contained within.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowDirty = process.argv.includes('--allow-dirty');

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (typeof version !== 'string' || version === '0.0.0') {
  console.error(`The root package.json version is ${String(version)}, which is not a release.`);
  process.exit(1);
}

const dirty = git('status', '--porcelain');
if (dirty !== '' && !allowDirty) {
  console.error(
    'The working tree is not clean, so this build cannot honestly name a commit.\n' +
      'Commit, or pass --allow-dirty for a local build you are not going to keep.\n' +
      dirty,
  );
  process.exit(1);
}

const commit = git('rev-parse', 'HEAD') + (dirty === '' ? '' : '-dirty');
const path = join(root, 'packages', 'server', 'build-info.json');
writeFileSync(path, `${JSON.stringify({ version, commit }, null, 2)}\n`);
console.log(`${path}: ${version} at ${commit}`);
