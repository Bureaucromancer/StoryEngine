// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
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

/**
 * ***The second artifact beta requires*** —
 * [09 §5.4](../docs/design/09-server-multiuser-deployment.md),
 * [work plan §8](../docs/design/workplan/01-work-plan.md),
 * [P11.9](../docs/design/workplan/28-p11-implementation.md).
 *
 * [releases §0](../docs/design/workplan/04-repo-and-releases.md) names the bar
 * in one sentence — *"the canonical build must deliver the OCI image and the
 * tarball ([09 §5.4]) for beta to count"* — and everything above this block is
 * about the first one. P11.9's obligation is this file *"extended from one
 * artifact to five"*, and the count is the part worth correcting rather than
 * copying: **§0 and [work plan §8] both say two for beta**, with the other four
 * packaging artifacts a 1.0 requirement and the reason written down —
 * *"standing up four more build chains is exactly the kind of work that reads as
 * progress while delaying the thing being packaged"*. So this is the extension
 * from one to **two**, and the remaining three are not owed here.
 *
 * *What these check is the shape of a job nothing in this repository can run*,
 * which is the same standing the image job's tests have and the reason they
 * exist: the workflow runs on a tag, on a runner, once, and the failures it has
 * actually had were a stripped `v` and an unlowercased owner — string mistakes,
 * visible from here.
 */
describe('the tarball tier', () => {
  const workflow = read('.github/workflows/release.yml');
  const unit = read('deploy/tarball/storyengine.service');
  const script = read('deploy/tarball/install.sh');

  it('is a job on the same tag, not a thing somebody remembers to run', () => {
    expect(workflow).toMatch(/^ {2}tarball:$/m);
    expect(workflow).toMatch(/node tools\/pack-tarball\.mjs build\/app deploy\/tarball/);
  });

  /**
   * ***The reproducibility claim, made against the artifact rather than a
   * fixture.*** `pack-tarball.test.ts` packs a fixture twice and compares; this
   * asserts the *workflow* does the same to the thing somebody downloads, which
   * is where a stray timestamp would actually live.
   */
  it('packs twice and compares, which is what "reproducible" has to mean', () => {
    expect(workflow).toMatch(/node tools\/pack-tarball\.mjs build\/app deploy\/tarball build\//);
    expect(workflow).toMatch(/\n\s+cmp /);
  });

  /**
   * **The version in the artifact's name is the tag's, stripped of its `v`** —
   * the same string the image tag needed and the same mistake available: the
   * archive is named for a version, and a `v` in it makes the file disagree
   * with the changelog entry, the compose tag and the template.
   */
  it('names the archive for the version, without the tag’s v', () => {
    expect(workflow).toMatch(/storyengine-\$\{\{ steps\.names\.outputs\.version \}\}-linux/);
    expect(workflow).not.toMatch(/storyengine-\$\{\{ github\.ref_name \}\}/);
  });

  /**
   * ***The Node floor is one number in four places and this is the fourth.***
   * `engines.node` is the source, the Dockerfile's base carries it, the install
   * script checks it at unpack time, and the workflow's runner has to build on
   * it. A tarball built on a Node older than the floor is one the install script
   * would then refuse, which is a release that fails at the last possible
   * moment.
   */
  it('builds on the Node the workspace requires, and the script checks the same one', () => {
    const { engines } = JSON.parse(read('package.json')) as { engines?: { node?: string } };
    const floor = /(\d+)/.exec(engines?.node ?? '')?.[1];
    expect(floor, 'engines.node names no number').toBeTruthy();
    expect(workflow).toMatch(new RegExp(`node-version: ${floor ?? ''}`));
    expect(script).toMatch(new RegExp(`NEED=${floor ?? ''}`));
  });

  /**
   * ***[09 §5.4] decides the packaging list on one question*** — *"does it start
   * on boot and come back after a reboot?"* — and says a format that does not
   * answer it *"is not buying anything a tarball does not"*. A unit that is not
   * enabled, or a tier that ships no unit, is this one failing its own entrance
   * exam.
   */
  it('ships a unit that survives a reboot, and enables it', () => {
    expect(unit).toMatch(/WantedBy=multi-user\.target/);
    expect(unit).toMatch(/Restart=on-failure/);
    expect(script).toMatch(/systemctl enable storyengine/);
  });

  /**
   * ***The data directory is created and never emptied***, which is §5.4's third
   * question — *"does an upgrade leave it alone"* — and the reason re-running
   * the script **is** the upgrade path. A `rm -rf` on the data directory in an
   * install script is the one-way door this whole tier is trying not to be, so
   * it is asserted against by name rather than trusted to review.
   */
  it('creates the data directory and never removes it', () => {
    expect(script).toMatch(/mkdir -p "\$DATA"/);
    expect(script).not.toMatch(/rm -rf[^\n]*\$DATA/);
    expect(script).not.toMatch(/rm -rf[^\n]*\/var\/lib\/storyengine/);
  });

  /**
   * ***The one deliberate difference between the artifacts, and it is written
   * down in both.*** [P10 §1.2](../docs/design/workplan/27-p10-implementation.md)
   * forbids a *hidden* difference — *"a hidden difference between artifacts is a
   * support burden shaped like a security feature"* — and this one is not
   * hidden: the image binds `0.0.0.0` because a container's network namespace
   * makes that a statement about the container, and the unit binds `127.0.0.1`
   * because a systemd service has no such boundary and would otherwise put a
   * fresh install on the LAN before anybody read the setup token.
   */
  it('binds the loopback, where the image binds every interface', () => {
    expect(unit).toMatch(/Environment=SE_HOST=127\.0\.0\.1/);
    expect(read('Dockerfile')).toMatch(/SE_HOST=0\.0\.0\.0/);
    // And the unit says which one it is, so nobody reads the difference as a bug.
    expect(unit).toMatch(/0\.0\.0\.0/);
  });

  /** The data directory the unit names is the one the script creates. */
  it('agrees with the install script about where the data lives', () => {
    expect(unit).toMatch(/Environment=SE_DATA_DIR=\/var\/lib\/storyengine/);
    expect(unit).toMatch(/ReadWritePaths=\/var\/lib\/storyengine/);
    expect(script).toMatch(/DATA="\$\{DATA:-\/var\/lib\/storyengine\}"/);
  });

  /**
   * ***The archive is started before it is uploaded*** (2026-10-01). Every check
   * above held while the packer dropped all of `node_modules`' links and the
   * server in the archive could not import its first dependency; the one that
   * would have failed is a boot, so the job does one, and does it **outside the
   * checkout** — Node looks in every `node_modules` above the importing file,
   * and the checkout's would lend an archive under `build/` whatever it lacked.
   */
  it('boots the unpacked archive, outside the checkout, before uploading it', () => {
    const boot = workflow.indexOf('- name: The archive boots');
    expect(boot).toBeGreaterThan(-1);
    expect(boot).toBeLessThan(workflow.indexOf('actions/upload-artifact'));

    const step = workflow.slice(boot, workflow.indexOf('\n      - ', boot + 1));
    expect(step).toMatch(/unpacked="\$RUNNER_TEMP\/unpacked"/);
    expect(step).toMatch(/tar -xzf "\$ARCHIVE" -C "\$unpacked"/);
    expect(step).toMatch(/node dist\/main\.js/);
    expect(step).toMatch(/curl --fail [^\n]*\/api\/auth\/state/);
    // Asked as the unit runs it, so a difference between the two is a
    // difference in this file rather than in somebody's install.
    expect(step).toMatch(/SE_DATA_DIR=/);
    expect(step).toMatch(/SE_CLIENT_ROOT=/);
  });

  /**
   * ***pnpm's one link out of the tree goes before the packer sees it***, because
   * the packer refuses every link that leaves the tree, and refusing is right
   * for every one of them but this: the deployed package's own name, hoisted as
   * a link back into the checkout it was deployed from.
   */
  it('removes the link pnpm points back at the checkout, before packing', () => {
    const removal = workflow.indexOf(
      'rm -f build/app/node_modules/.pnpm/node_modules/@storyengine/server',
    );
    expect(removal).toBeGreaterThan(-1);
    expect(removal).toBeLessThan(workflow.indexOf('node tools/pack-tarball.mjs'));
  });
});

/**
 * ***The install script says what happened*** — 2026-10-01.
 *
 * It printed *"StoryEngine is installed"* after `systemctl restart`, which under
 * `Type=simple` returns the moment node is forked, so an install whose server
 * died on its first import a second later was reported a success while systemd
 * restarted it every five seconds. The script now waits out a start-up and asks
 * again, and this runs it to see that it does — **the script itself, under
 * `sh`, with `systemctl` and the other root-only commands stood in for** by
 * stubs on `PATH`, so the branch under test is the real one and nothing touches
 * this machine's services.
 *
 * *Not on Windows*, which has no `sh` to run it with — and the script is for
 * Linux.
 */
describe.skipIf(process.platform === 'win32')('the install script, run', () => {
  /**
   * Runs `install.sh` against a temporary prefix, with `systemctl` answering
   * `MainPID` from `pids` in turn and `is-active` with `active`.
   */
  function install(pids: string[], active: boolean): { status: number | null; out: string } {
    const scratch = mkdtempSync(join(tmpdir(), 'se-install-'));
    try {
      const bin = join(scratch, 'bin');
      const stub = (name: string, body: string): void => {
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
      };
      spawnSync('mkdir', ['-p', bin]);
      writeFileSync(join(scratch, 'pids'), `${pids.join('\n')}\n`);
      writeFileSync(join(scratch, 'calls'), '0\n');
      stub('id', 'echo 0');
      stub('node', 'echo v26.4.0');
      stub('useradd', 'exit 0');
      stub('chown', 'exit 0');
      stub('sleep', 'exit 0');
      stub('journalctl', 'echo "the end of the journal"');
      stub(
        'systemctl',
        [
          'case "$1" in',
          // One answer per call, in order — counted rather than consumed with
          // `sed -i`, which BSD sed spells differently.
          `  show) n=$(($(cat "${join(scratch, 'calls')}") + 1)); echo "$n" > "${join(scratch, 'calls')}"; sed -n "\${n}p" "${join(scratch, 'pids')}" ;;`,
          `  is-active) exit ${active ? '0' : '3'} ;;`,
          '  *) exit 0 ;;',
          'esac',
        ].join('\n'),
      );

      const result = spawnSync('sh', [join(root, 'deploy', 'tarball', 'install.sh')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
          PREFIX: join(scratch, 'opt'),
          DATA: join(scratch, 'data'),
          UNIT: join(scratch, 'storyengine.service'),
        },
      });
      return { status: result.status, out: `${result.stdout}${result.stderr}` };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  it('reports success when the server it started is still the one running', () => {
    const run = install(['4242', '4242'], true);

    expect(run.out).toMatch(/StoryEngine is installed in .* and its data lives in/);
    expect(run.status).toBe(0);
  });

  /**
   * The last three each trip exactly one of the script's three conditions, so
   * none of them can be dropped without a case here going red; the first is the
   * one the script was written for, which trips two.
   */
  it.each([
    ['dead and waiting out RestartSec', ['4242', '0'], false],
    ['never started at all', ['0', '0'], true],
    ['restarted under another PID', ['4242', '4243'], true],
    ['the same process, no longer active', ['4242', '4242'], false],
  ])('reports failure, with the log, when the server is %s', (_why, pids, active) => {
    const run = install(pids, active);

    expect(run.out).toMatch(/is installed in .*, but it is not running/);
    expect(run.out).toContain('the end of the journal');
    expect(run.out).not.toMatch(/and its data lives in/);
    expect(run.status).toBe(1);
  });
});

/**
 * ***What brings the server back, in each of the three wrappers*** — [09 §6.4],
 * corrected 2026-09-27.
 *
 * *Restart now* and a restore both end the process and count on something to
 * start it again, and the settings page offers them only where
 * `SE_SUPERVISED` (or systemd) says something will. So a wrapper that declares
 * supervision and has no policy that restarts a *clean* exit is the trap §6.4
 * refuses, and it shipped twice: the unit restarted only on failure while the
 * restart exited 0, and the unraid template declared supervision with no
 * restart policy at all. Each wrapper is held to its own half here, because
 * none of it runs anywhere this repository can reach.
 */
describe('what restarts the server, in each wrapper', () => {
  const unit = read('deploy/tarball/storyengine.service');
  const compose = read('compose.yaml');
  const template = read('deploy/unraid/storyengine.xml');

  /** `RESTART_EXIT_CODE`, read out of the source so the two cannot drift. */
  const code = /export const RESTART_EXIT_CODE = (\d+);/.exec(
    read('packages/server/src/restart.ts'),
  )?.[1];

  it('restarts the unit on the status a requested restart exits with', () => {
    expect(code, 'RESTART_EXIT_CODE was not found in restart.ts').toBeDefined();
    expect(code).not.toBe('0');
    expect(unit).toMatch(new RegExp(`^RestartForceExitStatus=${code ?? ''}$`, 'm'));
    expect(unit).toMatch(new RegExp(`^SuccessExitStatus=${code ?? ''}$`, 'm'));
  });

  /**
   * *Every wrapper that says supervised has a policy that brings a requested
   * restart back.* The unraid template is the one that shipped with none.
   * `unless-stopped` there, as in compose, rather than `on-failure`: the
   * restart's own status would satisfy either, but `unless-stopped` also
   * covers an exit this build does not know it makes, and a stop from the
   * Docker tab stays a stop under both.
   */
  it('declares supervision only beside a restart policy', () => {
    expect(unit).toMatch(/^Environment=SE_SUPERVISED=1$/m);
    expect(unit).toMatch(/^Restart=on-failure$/m);

    expect(compose).toMatch(/SE_SUPERVISED: '1'/);
    expect(compose).toMatch(/^ {4}restart: unless-stopped$/m);

    expect(template).toMatch(/Target="SE_SUPERVISED"\s+Default="1"/);
    expect(template).toMatch(/<ExtraParams>[^<]*--restart=unless-stopped[^<]*<\/ExtraParams>/);
  });

  /**
   * ***One stop timeout in three places.*** The server bounds its own
   * shutdown (`CLOSE_BACKSTOP_MS`, then `RENDITION_DRAIN_MS` and
   * `RENDITION_ABORT_SETTLE_MS`, about twenty seconds at worst), and Docker's
   * own default of ten seconds is shorter than that. So each wrapper gives it
   * the same thirty, and a change to one is a change to all three.
   */
  it('gives shutdown the same time in all three', () => {
    const seconds = {
      unit: /^TimeoutStopSec=(\d+)$/m.exec(unit)?.[1],
      compose: /^ {4}stop_grace_period: (\d+)s$/m.exec(compose)?.[1],
      template: /<ExtraParams>[^<]*--stop-timeout=(\d+)[^<]*<\/ExtraParams>/.exec(template)?.[1],
    };
    expect(seconds.unit, 'no TimeoutStopSec in the unit').toBeDefined();
    expect(seconds).toEqual({ unit: seconds.unit, compose: seconds.unit, template: seconds.unit });
    expect(Number(seconds.unit)).toBeGreaterThanOrEqual(30);
  });
});
