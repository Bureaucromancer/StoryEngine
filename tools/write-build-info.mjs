// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Writes `packages/server/build-info.json` — [P6A §1.5](../docs/design/workplan/19-p6a-alpha-1.md).
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
 * ([P6A §1.6](../docs/design/workplan/19-p6a-alpha-1.md) fixes that as `v` plus
 * this string). The changelog entry names the same version, so the three agree
 * or the release is wrong in a way somebody will notice.
 *
 * **The commit comes from git, and a dirty tree is refused** unless
 * `--allow-dirty` is passed. A build identified by a commit it does not match
 * is worse than one with no identity at all: the whole promise of P6A is *a
 * build you can go back to*, and you cannot go back to a working tree.
 *
 * **`--commit <sha>` says it instead**, for the one caller that cannot ask git:
 * an image build, whose context has no `.git` because `.dockerignore` excludes
 * it. That is the *build* environment stating a fact it has in hand — the
 * release workflow passes `github.sha` — and not the runtime environment, which
 * is the thing `build-info.ts` refuses to trust. A caller that says the commit
 * is trusted about it; there is nothing here that could check.
 *
 * Exempt from the no-direct-`fs` rule for the reason `emit-schemas.ts` is: that
 * rule keeps one audited resolver the only door to *user data* reached from a
 * request, and a build script writing into the repository has no user root to
 * be contained within.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowDirty = process.argv.includes('--allow-dirty');
const stated = argumentValue('--commit');
const expected = argumentValue('--expect-version');

/** The value after a flag, or undefined. Refuses a flag with nothing after it. */
function argumentValue(flag) {
  const at = process.argv.indexOf(flag);
  if (at === -1) return undefined;
  const value = process.argv[at + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`${flag} needs a value.`);
    process.exit(1);
  }
  return value;
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (typeof version !== 'string' || version === '0.0.0') {
  console.error(`The root package.json version is ${String(version)}, which is not a release.`);
  process.exit(1);
}

/**
 * **`--expect-version` makes the three-way agreement mechanical.** The tag, the
 * root `package.json` and the changelog entry all name one version, and the
 * failure mode is tagging `v1.0.0-alpha.2` against a tree that still says
 * `alpha.1` — an image that reports a version nobody released, discovered by
 * whoever tries to reproduce it. The release workflow passes the tag here, so
 * that mistake stops the build instead of shipping.
 */
if (expected !== undefined && expected !== version && expected !== `v${version}`) {
  console.error(
    `The release says ${expected} and the root package.json says ${version}.\n` +
      'Bump the version and its CHANGELOG entry, or tag the version that is there.',
  );
  process.exit(1);
}

let commit = stated;
if (commit === undefined) {
  const dirty = git('status', '--porcelain');
  if (dirty !== '' && !allowDirty) {
    console.error(
      'The working tree is not clean, so this build cannot honestly name a commit.\n' +
        'Commit, pass --commit <sha>, or pass --allow-dirty for a local build you\n' +
        'are not going to keep.\n' +
        dirty,
    );
    process.exit(1);
  }
  commit = git('rev-parse', 'HEAD') + (dirty === '' ? '' : '-dirty');
}
const path = join(root, 'packages', 'server', 'build-info.json');
writeFileSync(path, `${JSON.stringify({ version, commit }, null, 2)}\n`);
console.log(`${path}: ${version} at ${commit}`);
