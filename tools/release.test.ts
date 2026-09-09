// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The packaging artefacts agree about what version this is — [P6A.4],
 * [P6A §1.6](../docs/design/workplan/19-p6a-alpha-1.md),
 * [releases §7](../docs/design/workplan/04-repo-and-releases.md).
 *
 * **Four files name a version and nothing compared them.** The root
 * `package.json` is the source; the CHANGELOG entry, `compose.yaml`'s image tag
 * and the unraid template's `Repository` all repeat it. The release workflow
 * already refuses a *tag* that disagrees with `package.json`, and
 * `write-build-info.mjs` is where that check lives — but a compose file left at
 * the previous alpha is invisible to it, and the person it misleads is the one
 * following the deploy page to run the thing.
 *
 * This is the same drift class `config.test.ts` guards for config keys, and it
 * is guarded the same way: parse the shipped artefact, compare, name the file
 * that is wrong.
 *
 * **A regex rather than a YAML and an XML parser**, deliberately: two
 * dependencies to check two strings, and the thing under test is the string. If
 * a pattern stops matching, the assertion that the match was found fails first
 * — so this cannot quietly agree about nothing.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

const { version } = JSON.parse(read('package.json')) as { version: string };

describe('the version this build claims', () => {
  it('is a release, not the workspace default', () => {
    // `write-build-info.mjs` refuses `0.0.0`, and this is the same claim one
    // step earlier: a version nobody set is not something to tag.
    expect(version).not.toBe('0.0.0');
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  it('has a changelog entry', () => {
    // [releases §7]: every release tag needs one, because
    // [09 §7] makes *what am I running* a user-facing question.
    expect(read('CHANGELOG.md')).toContain(`## ${version}`);
  });

  it('is the image tag the compose file pulls', () => {
    const tag = /image:\s*ghcr\.io\/[\w.-]+\/storyengine:(\S+)/.exec(read('compose.yaml'));
    expect(tag, 'no image line matched in compose.yaml').not.toBeNull();
    expect(tag?.[1]).toBe(version);
  });

  it('is not what the unraid template pulls — that follows the testing channel', () => {
    // The template is the install that wants to be offered the next alpha, so
    // it tracks the channel every tag moves ([releases §4]); compose above is
    // the build you can go back to, so it stays pinned. Pinning the template
    // to the version, or pointing it at `latest`, fails here.
    const xml = read('deploy/unraid/storyengine.xml');
    const repository = /<Repository>ghcr\.io\/[\w.-]+\/storyengine:(\S+)<\/Repository>/.exec(xml);
    expect(repository, 'no Repository element matched in the template').not.toBeNull();
    expect(repository?.[1]).toBe('testing');
  });
});

/**
 * Two claims about the release trigger that are cheap to check and expensive to
 * discover — [P6A §3](../docs/design/workplan/19-p6a-alpha-1.md) steps 2 and 12.
 */
describe('the release workflow', () => {
  const workflow = read('.github/workflows/release.yml');

  it('fires on `v*` and nothing else', () => {
    // The only tag in this repository is `p1`, a bare phase marker, and phase
    // tags are a habit here — an unfiltered trigger would try to cut a release
    // from the next one.
    expect(workflow).toContain("tags: ['v*']");
  });

  it('asks for no more permission than publishing needs', () => {
    /**
     * **The block, not the file.** The first version of this read the whole
     * workflow and failed on the sentence in its own comment explaining why
     * `contents` is read-only — a test matching prose about the thing rather
     * than the thing, which would equally have passed a file that granted the
     * write and never mentioned it.
     */
    const block = /\npermissions:\n((?:[ ].*\n|#.*\n)*)/.exec(workflow);
    expect(block, 'no permissions block matched').not.toBeNull();
    const granted = (block?.[1] ?? '')
      .split('\n')
      .filter((line) => /^\s+\w+:/.test(line))
      .map((line) => line.trim());

    // Nothing in that file creates a release, edits a tag or pushes a commit,
    // and a token that could is one something else eventually uses.
    expect(granted).toContain('packages: write');
    expect(granted).toContain('contents: read');
    expect(granted).not.toContain('contents: write');
  });

  it('pushes exactly two tags: the bare version, and the testing channel', () => {
    // `github.ref_name` is the tag, `v` included. compose.yaml pulls the version
    // without it and the test above holds it to that, so the workflow strips
    // the `v` before the string becomes an image tag — the first version of the
    // workflow tagged with `ref_name`, and the tests enforced the mismatch
    // rather than catching it. And `testing` is the channel [releases §4]
    // defines as a chosen commit on main, gated on a human deciding: a tag on
    // main is that decision, so every tagged alpha moves it, and the unraid
    // template follows it. Exactly these two, in this order — a `latest` line,
    // a missing `testing`, or `ref_name` each fail here.
    expect(workflow).toMatch(/echo "version=\$\{GITHUB_REF_NAME#v\}" >> "\$GITHUB_OUTPUT"/);
    // Whole lines, not non-space runs: the expressions carry spaces inside
    // their braces, and a `\S+` here matched nothing on the real file.
    const block = /\n[ \t]+tags: \|\n((?:[ \t]+ghcr\.io\/[^\n]+\n)+)/.exec(workflow);
    expect(block, 'no tags block matched').not.toBeNull();
    const tags = (block?.[1] ?? '')
      .trim()
      .split('\n')
      .map((line) => line.trim());
    expect(tags).toEqual([
      'ghcr.io/${{ steps.names.outputs.owner }}/storyengine:${{ steps.names.outputs.version }}',
      'ghcr.io/${{ steps.names.outputs.owner }}/storyengine:testing',
    ]);
    expect(workflow).not.toMatch(/storyengine:\$\{\{ github\.ref_name \}\}/);
  });

  it('lowercases the owner, because a registry path must be', () => {
    // `github.repository_owner` keeps the owner's case, and this one is not
    // lowercase. A comment saying "lowercased" beside it was the whole of the
    // lowercasing until this test.
    expect(workflow).toMatch(/echo "owner=\$\{GITHUB_REPOSITORY_OWNER,,\}" >> "\$GITHUB_OUTPUT"/);
    expect(workflow).toMatch(/ghcr\.io\/\$\{\{ steps\.names\.outputs\.owner \}\}\/storyengine:/);
    expect(workflow).not.toMatch(/ghcr\.io\/\$\{\{ github\.repository_owner \}\}/);
  });
});

/**
 * The build context excludes what must not reach an image — [P6A.4].
 *
 * Two of these are about size and one is not. A developer's `build-info.json`
 * arriving in the context would claim the image is a build it is not, which is
 * the single lie [§1.5] exists to prevent; `data/` is the user's and is
 * canonical ([03 §5]).
 */
describe('the docker build context', () => {
  const ignored = read('.dockerignore');

  it('excludes the user data and the local secrets', () => {
    expect(ignored).toMatch(/^data\/$/m);
    expect(ignored).toMatch(/^config\.json$/m);
    expect(ignored).toMatch(/^\.env$/m);
    expect(ignored).toMatch(/^captures\/$/m);
  });

  it('excludes a local build identity, so the image writes its own', () => {
    expect(ignored).toMatch(/^packages\/server\/build-info\.json$/m);
  });
});

/**
 * The image's build stage gets pnpm the way the workspace pins it — [P6A.4],
 * and the first run of the release workflow (2026-09-06, `v1.0.0-alpha.1`).
 *
 * That run failed at `corepack enable` with exit 127: Node 25 stopped shipping
 * corepack, so the `node:26-slim` base has no such command, and the Dockerfile
 * had never been run by a daemon before a tag ran it. pnpm is installed with
 * npm now, and this holds the version it installs to the one `packageManager`
 * names — the same one-source-of-truth check the version tests above make,
 * for the other number a release build carries.
 */
describe("the image's build stage", () => {
  const dockerfile = read('Dockerfile');
  const { packageManager } = JSON.parse(read('package.json')) as { packageManager: string };

  it('installs the pnpm the workspace pins, with npm', () => {
    expect(packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    expect(dockerfile).toContain(`RUN npm install -g ${packageManager}`);
  });

  it('does not ask for corepack, which the base image no longer has', () => {
    // Comments stripped first: the one above the install line says why not.
    expect(dockerfile.replace(/^#.*$/gm, '')).not.toMatch(/corepack/);
  });
});
