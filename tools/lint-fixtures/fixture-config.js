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
      'no-restricted-syntax': restrictedSyntax,
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

  {
    files: [`${FIXTURE_ROOT}/packages/server/src/storage/**/*.ts`],
    rules: {
      'no-restricted-imports': restrictedImports({
        allowFs: true,
        bannedPackages: bannedPackagesFor('server'),
      }),
    },
  },
);
