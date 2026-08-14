// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The day-one rules, factored out of `eslint.config.js` so that the fixture
 * tests in `tools/lint-fixtures/` exercise *these objects* rather than a
 * hand-copied approximation of them.
 *
 * That indirection is the whole point. P1.0's deliverable is a set of claims
 * about what is a build error (docs/design/19-p1-implementation.md §P1.0), and
 * an untested lint rule is a claim, not a check.
 *
 * The path-dependent rules take a prefix so the tests can root them at a
 * sandbox directory. Everything else is path-independent.
 */

/** The header every TypeScript source file carries. */
export const SPDX_CONTENT =
  'SPDX-License-Identifier: AGPL-3.0-or-later\nCopyright (C) {year} StoryEngine contributors';

export const COPYRIGHT_YEAR = '2026';

export const headerRule = {
  'headers/header-format': [
    'error',
    {
      source: 'string',
      style: 'line',
      content: SPDX_CONTENT,
      variables: { year: COPYRIGHT_YEAR },
      trailingNewlines: 2,
    },
  ],
};

// ---------------------------------------------------------------------------
// No direct `fs` outside server/src/storage
// ---------------------------------------------------------------------------

const FS_MODULES = [
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
  'graceful-fs',
  'write-file-atomic',
];

const FS_MESSAGE =
  'Filesystem access goes through packages/server/src/storage. One audited path ' +
  'resolver is the only door (docs/design/07-tech-stack.md §9).';

// ---------------------------------------------------------------------------
// No randomness outside the RNG service
// ---------------------------------------------------------------------------

const RANDOM_MESSAGE =
  'Every random draw comes from the single RNG service and is recorded, or replay ' +
  'and branching break silently (docs/design/07-tech-stack.md §14). The service ' +
  'does not exist until P2, so this is banned everywhere until it does.';

const CRYPTO_RANDOM_NAMES = [
  'randomInt',
  'randomBytes',
  'randomUUID',
  'randomFill',
  'randomFillSync',
  'getRandomValues',
];

/**
 * Builds the `no-restricted-imports` value. ESLint allows a rule to be
 * configured once per config object, so the fs ban, the crypto ban and the
 * cross-package ban have to be assembled together rather than layered.
 *
 * @param {{ allowFs?: boolean, bannedPackages?: { name: string, message: string }[] }} options
 */
export function restrictedImports({ allowFs = false, bannedPackages = [] } = {}) {
  const paths = [];

  if (!allowFs) {
    for (const name of FS_MODULES) {
      paths.push({ name, message: FS_MESSAGE });
    }
  }

  for (const name of ['crypto', 'node:crypto']) {
    paths.push({ name, importNames: CRYPTO_RANDOM_NAMES, message: RANDOM_MESSAGE });
  }

  for (const banned of bannedPackages) {
    paths.push({ name: banned.name, message: banned.message });
    paths.push({ name: `${banned.name}/*`, message: banned.message });
  }

  return ['error', { paths }];
}

export const restrictedProperties = [
  'error',
  { object: 'Math', property: 'random', message: RANDOM_MESSAGE },
];

// ---------------------------------------------------------------------------
// No physical-direction Tailwind utilities
// ---------------------------------------------------------------------------

/**
 * Tailwind v4 ships logical equivalents for every one of these, so the message
 * can name the replacement rather than only refusing:
 *
 *   ml-*  → ms-*      pl-*        → ps-*        text-left  → text-start
 *   mr-*  → me-*      pr-*        → pe-*        text-right → text-end
 *   left-*  → start-*  border-l-* → border-s-*  rounded-l-* → rounded-s-*
 *   right-* → end-*    border-r-* → border-e-*  rounded-r-* → rounded-e-*
 *
 * Stylelint cannot see any of this, because a utility class is not a
 * declaration — which is why the CSS half of docs/design/07-tech-stack.md
 * §12.6 needs two rules rather than one.
 */
const PHYSICAL_UTILITY_PATTERN = String.raw`(?:^|\s)(?:[\w[\]-]+:)*-?(?:(?:ml|mr|pl|pr|left|right|scroll-ml|scroll-mr|scroll-pl|scroll-pr|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)(?:-[^\s]*)?|text-left|text-right|float-left|float-right|clear-left|clear-right)(?:\s|$)`;

const TAILWIND_MESSAGE =
  'Physical-direction utility. Use the logical equivalent (ms/me, ps/pe, ' +
  'start/end, border-s/border-e, rounded-s/rounded-e, text-start/text-end). ' +
  'RTL is a dir attribute or a rewrite — see docs/design/07-tech-stack.md §12.6.';

export const restrictedSyntax = [
  'error',
  {
    selector: `JSXAttribute[name.name="className"] Literal[value=/${PHYSICAL_UTILITY_PATTERN}/]`,
    message: TAILWIND_MESSAGE,
  },
  {
    selector: `JSXAttribute[name.name="className"] TemplateElement[value.raw=/${PHYSICAL_UTILITY_PATTERN}/]`,
    message: TAILWIND_MESSAGE,
  },
  {
    selector:
      'MemberExpression[object.name=/^(crypto|globalThis)$/][property.name=/^(getRandomValues|randomUUID)$/]',
    message: RANDOM_MESSAGE,
  },
];

// ---------------------------------------------------------------------------
// The architectural boundary graph
// ---------------------------------------------------------------------------

const BOUNDARY_MESSAGE =
  'Architectural boundary violated. The graph is docs/design/16-testing.md §2: ' +
  'modes → sdk, shared; client → shared; sdk → shared; server → shared, sdk.';

/** @param {string} type */
const from = (type) => ({ element: { type } });

/** @param {string[]} types */
const to = (types) => ({ to: { element: { types: { anyOf: types } } } });

/**
 * The graph from docs/design/16-testing.md §2, as eslint-plugin-boundaries
 * settings and rules.
 *
 * `modes` is defined here even though `packages/modes/` does not exist. That is
 * deliberate: docs/design/07-tech-stack.md §10 claims built-in modes consume the
 * published SDK exactly as a third party would, and the claim is only true if
 * violating it is a build error. A rule added after the first mode is written is
 * a rule negotiated with existing code.
 *
 * Takes a list of prefixes rather than one because the fixture tests need both:
 * their source files live under the fixture root, but their imports resolve —
 * through pnpm's symlinks — to the *real* packages. An element set covering only
 * one of the two classifies the import as unknown, and an unknown import is
 * silently permitted rather than reported. That is the quiet failure the second
 * layer below exists to survive, and the reason it is worth a test.
 *
 * @param {string | string[]} prefixes path prefixes the packages live under, no trailing slash
 */
export function boundariesGraph(prefixes) {
  const roots = Array.isArray(prefixes) ? prefixes : [prefixes];

  /** @param {string} suffix */
  const pattern = (suffix) => roots.map((root) => `${root}/${suffix}`);

  return {
    settings: {
      'boundaries/include': pattern('**/*'),
      // Patterns cover the whole package, not just `src`. A workspace import
      // resolves through the package's `types` entry into `dist`, so an
      // element defined as src-only would classify half its own package as
      // unknown and quietly stop matching.
      'boundaries/elements': [
        { type: 'modes', pattern: pattern('modes/*/**/*'), partialMatch: false },
        { type: 'shared', pattern: pattern('shared/**/*'), partialMatch: false },
        { type: 'sdk', pattern: pattern('sdk/**/*'), partialMatch: false },
        { type: 'server', pattern: pattern('server/**/*'), partialMatch: false },
        { type: 'client', pattern: pattern('client/**/*'), partialMatch: false },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message: BOUNDARY_MESSAGE,
          policies: [
            { from: from('shared'), allow: to(['shared']) },
            { from: from('sdk'), allow: to(['sdk', 'shared']) },
            { from: from('server'), allow: to(['server', 'sdk', 'shared']) },
            { from: from('client'), allow: to(['client', 'shared']) },
            { from: from('modes'), allow: to(['modes', 'sdk', 'shared']) },
          ],
        },
      ],
    },
  };
}

/**
 * The second, dumber layer.
 *
 * `boundaries` matches on the *resolved* path of an import, which means it
 * depends on the `@storyengine` package names resolving through pnpm's symlinks
 * into each package's `src`. That resolution is the part most likely to fail, and
 * a boundary rule that silently stops matching is worse than no boundary rule —
 * so the same graph is also expressed as a ban on package *names*, which needs
 * no resolver at all. The fixture tests assert both fire.
 */
export const forbiddenPackages = {
  shared: ['@storyengine/sdk', '@storyengine/server', '@storyengine/client'],
  sdk: ['@storyengine/server', '@storyengine/client'],
  server: ['@storyengine/client'],
  client: ['@storyengine/server', '@storyengine/sdk'],
  modes: ['@storyengine/server', '@storyengine/client'],
};

/** @param {keyof typeof forbiddenPackages} from */
export function bannedPackagesFor(from) {
  return forbiddenPackages[from].map((name) => ({
    name,
    message: `${from} may not import ${name}. See docs/design/16-testing.md §2.`,
  }));
}
