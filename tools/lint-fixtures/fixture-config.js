// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import boundaries from 'eslint-plugin-boundaries';
import headers from 'eslint-plugin-headers';
import tseslint from 'typescript-eslint';

import {
  bannedPackagesFor,
  boundariesGraph,
  headerRule,
  restrictedImports,
  restrictedProperties,
  restrictedSyntax,
} from '../../eslint.rules.js';

export const FIXTURE_ROOT = 'tools/lint-fixtures/fixtures';

// Both roots: the fixture files themselves, and the real packages their
// imports resolve to through pnpm's symlinks. See `boundariesGraph`.
const graph = boundariesGraph([`${FIXTURE_ROOT}/packages`, 'packages']);

/**
 * The same rule objects `eslint.config.js` uses, rooted at the fixture tree and
 * without type-aware linting — none of the rules under test needs type
 * information, and the fixtures deliberately are not in any tsconfig.
 *
 * The point of importing rather than restating them is that a rule someone
 * loosens in `eslint.rules.js` gets loosened here too, and the test that
 * asserted it fires goes red. A hand-copied config would just keep passing.
 */
export const fixtureConfig = tseslint.config(
  {
    files: [`${FIXTURE_ROOT}/**/*.{ts,tsx}`],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { boundaries, headers },
    settings: {
      ...graph.settings,
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['packages/*/tsconfig.json'],
        },
        node: true,
      },
    },
    rules: {
      ...graph.rules,
      ...headerRule,
      'no-restricted-properties': restrictedProperties,
      'no-restricted-syntax': restrictedSyntax(),
      'no-restricted-imports': restrictedImports(),
    },
  },

  ...['shared', 'sdk', 'server', 'client'].map((name) => ({
    files: [`${FIXTURE_ROOT}/packages/${name}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': restrictedImports({
        bannedPackages: bannedPackagesFor(name),
      }),
    },
  })),

  {
    files: [`${FIXTURE_ROOT}/packages/modes/*/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': restrictedImports({
        bannedPackages: bannedPackagesFor('modes'),
      }),
    },
  },

  // The engine names no mode — the same scope `eslint.config.js` gives it, and
  // placed above the randomness carve-outs there for the reason stated there.
  {
    files: [`${FIXTURE_ROOT}/packages/server/src/**/*.ts`],
    rules: {
      'no-restricted-syntax': restrictedSyntax({ engineOnly: true }),
    },
  },

  {
    files: [`${FIXTURE_ROOT}/packages/server/src/storage/**/*.ts`],
    rules: {
      'no-restricted-imports': restrictedImports({
        allowFs: true,
        bannedPackages: bannedPackagesFor('server'),
      }),
    },
  },

  // Build scripts: fs allowed, because they never see a request.
  {
    files: [`${FIXTURE_ROOT}/packages/*/scripts/**/*.ts`],
    rules: {
      'no-restricted-imports': restrictedImports({ allowFs: true }),
    },
  },

  // The client writes what people read, so the assembly rule applies to it and
  // not to the server — the same split `eslint.config.js` makes, mirrored here
  // so the fixtures can prove *both* halves.
  {
    files: [`${FIXTURE_ROOT}/packages/client/src/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-syntax': restrictedSyntax({ userFacing: true, tokensOnly: true }),
    },
  },

  // The appearance layer, which adds the `+` ban to the client's rules rather
  // than replacing any of them. `ui/labels.ts` is the fixture that proves the
  // assembly rule survives the addition.
  {
    files: [`${FIXTURE_ROOT}/packages/client/src/ui/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-syntax': restrictedSyntax({
        userFacing: true,
        classList: true,
        tokensOnly: true,
      }),
    },
  },

  // The RNG service: the destination the randomness rule points at, and
  // deliberately two files wide rather than a directory.
  {
    files: [
      `${FIXTURE_ROOT}/packages/server/src/rng/source.ts`,
      `${FIXTURE_ROOT}/packages/server/src/rng/rng.ts`,
    ],
    rules: {
      'no-restricted-imports': restrictedImports({
        allowRandomness: true,
        bannedPackages: bannedPackagesFor('server'),
      }),
      'no-restricted-syntax': restrictedSyntax({ allowRandomness: true, engineOnly: true }),
    },
  },

  // Cryptographic material: randomness allowed, and deliberately one file wide.
  {
    files: [`${FIXTURE_ROOT}/packages/server/src/auth/secrets.ts`],
    rules: {
      'no-restricted-imports': restrictedImports({
        allowRandomness: true,
        bannedPackages: bannedPackagesFor('server'),
      }),
      'no-restricted-syntax': restrictedSyntax({ allowRandomness: true, engineOnly: true }),
    },
  },

  // Id generation: randomness allowed, and deliberately one file wide. The
  // syntax rule is relaxed too — ids.ts draws through the Web Crypto global,
  // because `shared` must also run in a browser (client → shared).
  {
    files: [`${FIXTURE_ROOT}/packages/shared/src/ids.ts`],
    rules: {
      'no-restricted-imports': restrictedImports({
        allowRandomness: true,
        bannedPackages: bannedPackagesFor('shared'),
      }),
      'no-restricted-syntax': restrictedSyntax({ allowRandomness: true }),
    },
  },
);
