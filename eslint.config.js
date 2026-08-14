// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import headers from 'eslint-plugin-headers';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import {
  bannedPackagesFor,
  boundariesGraph,
  headerRule,
  restrictedImports,
  restrictedProperties,
  restrictedSyntax,
} from './eslint.rules.js';

const graph = boundariesGraph('packages');

/**
 * Builds the per-package override that layers the package-name import ban on
 * top of the resolved-path boundary rule. See `forbiddenPackages` in
 * eslint.rules.js for why there are two layers.
 *
 * @param {'shared' | 'sdk' | 'server' | 'client' | 'modes'} name
 * @param {string} files
 */
function packageOverride(name, files) {
  return {
    files: [files],
    rules: {
      'no-restricted-imports': restrictedImports({ bannedPackages: bannedPackagesFor(name) }),
    },
  };
}

export default tseslint.config(
  {
    ignores: [
      '**/dist/',
      '**/dist-types/',
      '**/coverage/',
      '**/node_modules/',
      'data/',
      // Files that exist to violate the rules below. They are linted
      // deliberately, by the fixture tests, and never by `pnpm lint`.
      'tools/lint-fixtures/fixtures/',
    ],
  },

  // ---------------------------------------------------------------------
  // Everything: the licence header, and the rules that have no exceptions.
  // ---------------------------------------------------------------------
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    plugins: { headers },
    rules: {
      ...headerRule,
      'no-restricted-properties': restrictedProperties,
      'no-restricted-syntax': restrictedSyntax,
      'no-restricted-imports': restrictedImports(),
    },
  },

  // ---------------------------------------------------------------------
  // Package sources: type-aware linting and the boundary graph.
  // ---------------------------------------------------------------------
  js.configs.recommended,
  {
    files: ['packages/**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { boundaries },
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
    rules: graph.rules,
  },

  packageOverride('shared', 'packages/shared/**/*.ts'),
  packageOverride('sdk', 'packages/sdk/**/*.ts'),
  packageOverride('server', 'packages/server/**/*.ts'),
  packageOverride('client', 'packages/client/**/*.{ts,tsx}'),
  packageOverride('modes', 'packages/modes/*/**/*.{ts,tsx}'),

  // The one place permitted to touch the filesystem directly.
  // See packages/server/src/storage/README.md.
  {
    files: ['packages/server/src/storage/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({
        allowFs: true,
        bannedPackages: bannedPackagesFor('server'),
      }),
    },
  },

  {
    files: ['packages/server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ---------------------------------------------------------------------
  // Tooling and config files: linted, but not type-aware. They are not in
  // any package tsconfig and do not need to be.
  // ---------------------------------------------------------------------
  {
    files: ['*.{js,ts}', 'tools/**/*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
);
