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

  // Build scripts are not in any package tsconfig — they import from `dist`,
  // and putting them in the project that produces `dist` would be circular. So
  // they are linted, but not type-aware.
  {
    files: ['packages/*/scripts/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { projectService: false },
    },
  },

  // Tests assert things the type system cannot see — that an index is in range,
  // that a union narrowed the way the fixture guarantees. Writing around that
  // makes a test harder to read without making it safer.
  //
  // The `no-unsafe-*` family goes too, and only here. A decoded JSON response
  // body genuinely *is* dynamic: `response.body.objects[0].contentHash` is the
  // assertion, and the alternative is either a cast on every line or a declared
  // response type per route, which would be ceremony that tests nothing. In
  // production code these rules stay on, which is where they earn their keep.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test-*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  packageOverride('shared', 'packages/shared/**/*.ts'),
  packageOverride('sdk', 'packages/sdk/**/*.ts'),
  packageOverride('server', 'packages/server/**/*.ts'),
  packageOverride('client', 'packages/client/**/*.{ts,tsx}'),
  packageOverride('modes', 'packages/modes/*/**/*.{ts,tsx}'),

  // The one place permitted to touch the filesystem at request time.
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

  // Build scripts. The fs rule exists to keep one audited path resolver the only
  // door to *user data*, reached from a request whose user is the thing being
  // checked (docs/design/07-tech-stack.md §9). A script that emits build
  // artefacts into the repository never sees a request and has no user root to
  // be contained within, so the rule has nothing to say about it.
  //
  // This is a category, not a hole: `packages/*/scripts` is build-time code, and
  // the fixture tests assert that the sibling `src` directory is still caught.
  {
    files: ['packages/*/scripts/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({ allowFs: true }),
    },
  },

  // Tests may touch the filesystem directly, and it is the point rather than a
  // concession. The rule keeps *production* code behind one audited resolver;
  // a storage test is playing the part of the user with a file manager —
  // renaming a folder, hand-editing a card, deleting one mid-write — which is
  // exactly the behaviour under test. Routing that through the storage helpers
  // would mean the tests could only exercise what those helpers already allow,
  // and would grow the production surface with a `rename` and an `rm` that
  // nothing in the server needs.
  //
  // Deliberately last, so it wins over the per-package overrides above; the
  // cross-package bans are restated here rather than lost.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test-*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({ allowFs: true }),
    },
  },

  // Id generation. The randomness rule protects replay and branching: every
  // draw that can change what happens must be recorded, or a reconstructed
  // branch silently diverges (docs/design/07-tech-stack.md §14.1). A uuidv7 is
  // not a draw — nothing replays it, no outcome depends on its value, and it is
  // written into the object it identifies before anything else sees it.
  //
  // Deliberately one file wide. When the RNG service lands at P2 this stays
  // separate from it, because routing identity through a recorded, replayable
  // generator would put uuids on the tape and make a rewrite mint new ids.
  {
    files: ['packages/shared/src/ids.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({ allowRandomness: true }),
    },
  },

  // Cryptographic material — password salts, the session signing key, the
  // console setup token. Same argument as `ids.ts` and worth restating because
  // it is the second exemption rather than the first: the randomness rule
  // protects replay and branching, and a salt is not a draw. Nothing replays
  // it and no outcome depends on its value. Routing secrets through a
  // recorded, replayable generator would be actively wrong — it would put them
  // on the turn tape.
  //
  // One file, like `ids.ts`, so the fixture tests can keep proving that the
  // file next door is still caught.
  {
    files: ['packages/server/src/auth/secrets.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({
        allowRandomness: true,
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
