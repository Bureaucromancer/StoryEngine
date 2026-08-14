// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

import { FIXTURE_ROOT, fixtureConfig } from './fixture-config.js';

/**
 * P1.0 ships a set of claims about what is a build error
 * (docs/design/19-p1-implementation.md §P1.0). These tests are what turn each
 * claim into a check.
 *
 * The negative cases matter as much as the positive ones. A rule that fires on
 * everything is as useless as one that fires on nothing, and the failure mode
 * that actually bites — a resolver silently stopping — looks exactly like a
 * clean run.
 */

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: fixtureConfig as ESLint.Options['overrideConfig'],
  ignore: false,
  cwd: process.cwd(),
});

async function rulesFiredIn(fixture: string): Promise<string[]> {
  const [result] = await eslint.lintFiles([`${FIXTURE_ROOT}/${fixture}`]);
  if (!result) {
    throw new Error(`No lint result for ${fixture} — is the path right?`);
  }
  if (result.fatalErrorCount > 0) {
    const fatal = result.messages.find((m) => m.fatal);
    throw new Error(`${fixture} failed to parse (${fatal?.message ?? 'unknown'}).`);
  }
  return result.messages.map((m) => m.ruleId ?? '<no rule>');
}

describe('the architectural boundary graph (docs/design/16-testing.md §2)', () => {
  // The graph rule classifies an import by its *resolved* path, and workspace
  // packages resolve through their `types`/`main` entry into `dist`. If the
  // packages have not been built, every import resolves to nothing, every
  // dependency is classified unknown, and the rule reports nothing at all —
  // a clean run that means the opposite of what it looks like. Fail loudly
  // instead.
  beforeAll(() => {
    const from = resolve(process.cwd(), FIXTURE_ROOT, 'packages/client/src/probe.ts');
    try {
      createRequire(from).resolve('@storyengine/server');
    } catch {
      throw new Error(
        'Cannot resolve @storyengine/server from the fixture tree. Run `pnpm build` ' +
          'first — the boundary rule resolves imports through each package’s built ' +
          'entry point, so an unbuilt workspace makes it silently pass.',
      );
    }
  });

  it('blocks modes → server, before packages/modes/ exists', async () => {
    const fired = await rulesFiredIn('packages/modes/scene/src/imports-server.ts');
    expect(fired).toContain('boundaries/dependencies');
    expect(fired).toContain('no-restricted-imports');
  });

  it('blocks client → server', async () => {
    const fired = await rulesFiredIn('packages/client/src/imports-server.ts');
    expect(fired).toContain('boundaries/dependencies');
    expect(fired).toContain('no-restricted-imports');
  });

  it('blocks sdk → server', async () => {
    const fired = await rulesFiredIn('packages/sdk/src/imports-server.ts');
    expect(fired).toContain('boundaries/dependencies');
    expect(fired).toContain('no-restricted-imports');
  });

  it('permits sdk → shared', async () => {
    const fired = await rulesFiredIn('packages/sdk/src/imports-shared.ts');
    expect(fired).not.toContain('boundaries/dependencies');
    expect(fired).not.toContain('no-restricted-imports');
  });
});

describe('no direct fs outside server/src/storage (docs/design/07-tech-stack.md §9)', () => {
  it('blocks node:fs in an ordinary server file', async () => {
    const fired = await rulesFiredIn('packages/server/src/uses-fs.ts');
    expect(fired).toContain('no-restricted-imports');
  });

  it('permits node:fs inside server/src/storage', async () => {
    const fired = await rulesFiredIn('packages/server/src/storage/uses-fs.ts');
    expect(fired).not.toContain('no-restricted-imports');
  });

  it('permits node:fs in a build script, which never sees a request', async () => {
    // The rule keeps one audited path resolver the only door to *user data*,
    // reached from a request whose user is the thing being checked. A script
    // emitting artefacts into the repository has no user root to be contained
    // within, so the rule has nothing to say about it.
    const fired = await rulesFiredIn('packages/shared/scripts/emits-artefacts.ts');
    expect(fired).not.toContain('no-restricted-imports');
  });
});

describe('no randomness outside the RNG service (docs/design/07-tech-stack.md §14.4)', () => {
  it('blocks Math.random', async () => {
    const fired = await rulesFiredIn('packages/shared/src/uses-math-random.ts');
    expect(fired).toContain('no-restricted-properties');
  });

  it('blocks randomInt from node:crypto', async () => {
    const fired = await rulesFiredIn('packages/shared/src/uses-node-crypto.ts');
    expect(fired).toContain('no-restricted-imports');
  });

  it('blocks crypto.randomUUID on the global', async () => {
    const fired = await rulesFiredIn('packages/shared/src/uses-global-crypto.ts');
    expect(fired).toContain('no-restricted-syntax');
  });

  it('permits it in the id generator — an id is not a draw', async () => {
    // Nothing replays a uuid and no outcome depends on its value, so it is not
    // the thing docs/design/07-tech-stack.md §14.1 protects. The exemption is
    // deliberately one file wide, which the next test is what actually proves.
    const fired = await rulesFiredIn('packages/shared/src/ids.ts');
    expect(fired).not.toContain('no-restricted-imports');
  });

  it('permits it in the secrets module — a salt is not a draw either', async () => {
    // The second exemption, and the same argument: nothing replays a password
    // salt or a session key, and routing them through a recorded generator
    // would put secrets on the turn tape.
    const fired = await rulesFiredIn('packages/server/src/auth/secrets.ts');
    expect(fired).not.toContain('no-restricted-imports');
  });

  it('catches the file beside the secrets module too', async () => {
    const fired = await rulesFiredIn('packages/server/src/auth/session.ts');
    expect(fired).toContain('no-restricted-imports');
  });

  it('still catches the file next door, so the exemption is one file wide', async () => {
    // `uses-node-crypto.ts` sits in the same directory as the exempt `ids.ts`.
    // If this ever passes, the carve-out has widened into a hole.
    const fired = await rulesFiredIn('packages/shared/src/uses-node-crypto.ts');
    expect(fired).toContain('no-restricted-imports');
  });
});

describe('the AGPL header', () => {
  it('fires on a file without one', async () => {
    const fired = await rulesFiredIn('packages/shared/src/no-header.ts');
    expect(fired).toContain('headers/header-format');
  });

  it('does not fire on a file with one', async () => {
    const fired = await rulesFiredIn('packages/sdk/src/imports-shared.ts');
    expect(fired).not.toContain('headers/header-format');
  });
});

describe('physical-direction Tailwind utilities (docs/design/07-tech-stack.md §12.6)', () => {
  it('blocks every form a physical utility can arrive in', async () => {
    const fired = await rulesFiredIn('packages/client/src/physical-utility.tsx');
    // Five elements in the fixture: a plain literal, several classes in one
    // literal, a literal inside a helper call, a template literal, and one
    // behind variant prefixes. One report each — the rule reports the
    // expression, not the individual class.
    expect(fired.filter((r) => r === 'no-restricted-syntax')).toHaveLength(5);
  });

  it('permits the logical equivalents, including behind a variant prefix', async () => {
    const fired = await rulesFiredIn('packages/client/src/logical-utility.tsx');
    expect(fired).not.toContain('no-restricted-syntax');
  });
});
