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

/**
 * The same bans, for a package's test files, which are allowed the filesystem.
 *
 * This layer exists because the boundary graph resolves `@storyengine/*`
 * through pnpm's symlinks into `dist`, and a graph rule that silently stops
 * matching is worse than no graph rule. Turning it off in test files — the
 * files most likely to reach for something they should not, since a test is
 * where "just import the server to build a fixture" is tempting — left the
 * backup missing exactly where it was wanted.
 *
 * @param {keyof typeof forbiddenPackages} name
 * @param {string} dir
 */
function packageTestOverride(name, dir) {
  return {
    files: [`${dir}/**/*.test.{ts,tsx}`, `${dir}/**/test-*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': restrictedImports({
        allowFs: true,
        bannedPackages: bannedPackagesFor(name),
      }),
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
      // Claude Code's local state — and its scratch worktrees, which are whole
      // second checkouts of this repository. `.prettierignore` has excluded
      // them since the format gate first met one; this list never did, and
      // eslint does traverse the path: a file planted under
      // `.claude/worktrees/` is reported by a sweep run from the root.
      //
      // Linting everything twice is the small half of that. The real cost is
      // that the root's result becomes a property of whichever branch somebody
      // has checked out beside it — red over work that is not in this tree,
      // and green again when a directory is deleted, which is how it was
      // 'fixed' the last time. Every entry above is anchored to the root, so
      // none of them reach inside a worktree; `data/` conspicuously does not.
      '.claude/',
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
      'no-restricted-syntax': restrictedSyntax(),
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
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test-*.ts', '**/test-*.tsx'],
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

  // Operator tooling: scripts a person runs against their own install, from a
  // terminal, with no server involved. Same argument as the build scripts above
  // and a different reason to accept it — the fs rule keeps one audited resolver
  // the only door to *user data reached from a request*, and there is no request
  // here. `reset-data.mjs` removes a whole data directory on purpose; routing
  // that through the storage helpers would mean growing the server's surface
  // with an `rm` that nothing in the server needs.
  //
  // A category rather than a hole, on the same terms: it is `tools/*.mjs` only,
  // and everything under `tools/lint-fixtures` keeps the ordinary rules.
  {
    files: ['tools/*.mjs'],
    languageOptions: {
      // `fetch` because `seed.mjs` drives the API the way a browser does —
      // deliberately, so a seed that works proves the routes work.
      globals: { console: 'readonly', fetch: 'readonly', process: 'readonly' },
      sourceType: 'module',
    },
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
  // Deliberately last, so it wins over the per-package overrides above — which
  // is why the cross-package bans have to be restated rather than inherited. A
  // flat-config block *replaces* a rule's options; it does not merge them. The
  // comment here used to claim the bans were restated and they were not
  // (F25): every test file in the repo had them switched off, in the stage
  // that writes the most test files, on the platform where the resolver the
  // graph rule depends on is least proven.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test-*.ts', '**/test-*.tsx'],
    rules: {
      'no-restricted-imports': restrictedImports({ allowFs: true }),
    },
  },

  // So the package bans come back, per package, after it. Fixture files under
  // tools/ keep the block above: they belong to no package and have no edge to
  // violate.
  packageTestOverride('shared', 'packages/shared'),
  packageTestOverride('sdk', 'packages/sdk'),
  packageTestOverride('server', 'packages/server'),
  packageTestOverride('client', 'packages/client'),

  // **The router's redirect is control flow, not an error.** TanStack Router's
  // `redirect()` returns a signal the router catches and turns into a
  // navigation, and throwing it is the documented way to redirect from
  // `beforeLoad`. `only-throw-error` sees a thrown non-Error and objects,
  // correctly in general and wrongly here.
  //
  // One file wide, and it should stay that way: everywhere else in the client a
  // thrown non-Error is the mistake the rule exists to catch.
  {
    files: ['packages/client/src/router.tsx'],
    rules: { '@typescript-eslint/only-throw-error': 'off' },
  },
  // **The RNG service itself** — the destination the rule has been pointing at
  // since P1.0, landed at P2.2. It is the one place allowed to call
  // `node:crypto`'s random functions, because everything above it draws through
  // `rng.at(site, purpose)` and lands on the turn tape.
  //
  // Two files wide rather than a whole package: `source.ts` holds the
  // generator, `rng.ts` holds the service. The directory's other files —
  // `dice.ts` and the tests — have no business drawing, and a directory-wide
  // exemption would quietly permit it.
  {
    files: ['packages/server/src/rng/source.ts', 'packages/server/src/rng/rng.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({
        allowRandomness: true,
        bannedPackages: bannedPackagesFor('server'),
      }),
      'no-restricted-syntax': restrictedSyntax({ allowRandomness: true }),
    },
  },

  // Id generation. The randomness rule protects replay and branching: every
  // draw that can change what happens must be recorded, or a reconstructed
  // branch silently diverges (docs/design/07-tech-stack.md §14.1). A uuidv7 is
  // not a draw — nothing replays it, no outcome depends on its value, and it is
  // written into the object it identifies before anything else sees it.
  //
  // Deliberately separate from the RNG service above, and it stays that way:
  // routing identity through a recorded, replayable generator would put uuids
  // on the tape and make a rewrite mint new ids.
  //
  // The syntax rule is relaxed alongside the import rule because this file
  // draws through the *Web Crypto* global — `shared` runs in the browser too
  // (the client → shared edge), and `node:crypto` would break that bundle.
  {
    files: ['packages/shared/src/ids.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({ allowRandomness: true }),
      'no-restricted-syntax': restrictedSyntax({ allowRandomness: true }),
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
      'no-restricted-syntax': restrictedSyntax({ allowRandomness: true }),
    },
  },

  {
    files: ['packages/server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  /**
   * The client writes what people read, so the assembly rule applies here.
   *
   * Not to the server, and that is a decision rather than an oversight: its
   * strings are log lines and error messages, which
   * docs/design/07-tech-stack.md §12.7 keeps deliberately untranslated. A rule
   * that fired on `Refused path (${reason})` would teach people to work around
   * it, and a day-one rule that gets worked around is worse than none.
   */
  {
    files: ['packages/client/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': restrictedSyntax({ userFacing: true, tokensOnly: true }),
    },
  },
  /**
   * **The appearance layer.** `packages/client/src/ui/` is where the class
   * lists live, so it gets one rule the rest of the client does not: a class
   * list is one string literal and is never joined with `+`.
   *
   * Note this *adds* to `userFacing` rather than replacing it. The carve-outs
   * elsewhere in this file relax a rule for a file that has a reason to break
   * it; this one does not — components render labels and `aria-label`s like
   * anywhere else, so the assembly rule still applies. What the `+` ban does is
   * keep a class list from ever reaching that rule, which would report it with
   * a message about translation that is not what is wrong with it.
   */
  {
    files: ['packages/client/src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': restrictedSyntax({
        userFacing: true,
        classList: true,
        tokensOnly: true,
      }),
    },
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
