// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The day-one rules, factored out of `eslint.config.js` so that the fixture
 * tests in `tools/lint-fixtures/` exercise *these objects* rather than a
 * hand-copied approximation of them.
 *
 * That indirection is the whole point. P1.0's deliverable is a set of claims
 * about what is a build error (docs/design/workplan/03-p1-implementation.md §P1.0), and
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
 * @param {{ allowFs?: boolean, allowRandomness?: boolean, bannedPackages?: { name: string, message: string }[] }} options
 */
export function restrictedImports({
  allowFs = false,
  allowRandomness = false,
  bannedPackages = [],
} = {}) {
  const paths = [];

  if (!allowFs) {
    for (const name of FS_MODULES) {
      paths.push({ name, message: FS_MESSAGE });
    }
  }

  if (!allowRandomness) {
    for (const name of ['crypto', 'node:crypto']) {
      paths.push({ name, importNames: CRYPTO_RANDOM_NAMES, message: RANDOM_MESSAGE });
    }
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

/**
 * Builds the `no-restricted-syntax` value. A function for the same reason
 * `restrictedImports` is: the rule can only be configured once per config
 * object, and the two exempt files (`ids.ts`, `secrets.ts`) need the Tailwind
 * bans without the Web Crypto ban — `crypto.getRandomValues` is how they draw
 * randomness portably, since `shared` must also run in a browser (the
 * `client → shared` edge in docs/design/workplan/10-testing.md §2).
 *
 * @param {{ allowRandomness?: boolean }} options
 */
/**
 * Prose, for the purposes of the assembly rule.
 *
 * Two plain words in a row — three letters or more each, neither continuing
 * into a hyphen, digit or underscore — or a parenthesised word after a space.
 *
 * The lookaheads are what keep this off **class lists**, which are the other
 * thing in a component that is a long string full of spaces:
 * `border border-slate-300 bg-white` has word-space-word in it, and every
 * candidate is followed by a hyphen. That distinction is the whole reason this
 * pattern is fussier than "letters and a space" — a rule that fired on every
 * Tailwind string would be worked around within a day, and a day-one rule that
 * gets worked around is worse than no rule.
 *
 * The second alternative catches ` (copy)` where it is *joined* to a name — the
 * same mistake in miniature.
 *
 * And note what is deliberately **not** caught: a template literal with a
 * placeholder. One message with a value substituted into it is exactly the
 * shape ICU MessageFormat wants (docs/design/07-tech-stack.md §12.3) and
 * exactly what an extraction sweep turns into a catalogue entry. The
 * unretrofittable mistake is the sentence that only exists in pieces, which is
 * why both selectors below are about *joins* rather than about interpolation.
 */
const PROSE_PATTERN = String.raw`(?:(?:^|\s)[A-Za-z]{3,}(?![\w-])\s+[A-Za-z]{3,}(?![\w-])|\s\([A-Za-z])`;

const ASSEMBLY_MESSAGE =
  'A user-facing sentence assembled from fragments. Put the whole sentence in ' +
  'one string with the value substituted into it, and keep helpers like ' +
  '`revisionLabel(n)` for the whole phrase rather than half of it. Word order ' +
  'differs between languages, so a sentence built by concatenation cannot be ' +
  'translated at all — docs/design/workplan/01-work-plan.md §2 keeps this part ' +
  'of i18n discipline on day one precisely because it is the unretrofittable ' +
  'part.';

const DISPLAYED_TEXT_MESSAGE =
  'Branching on displayed text. Compare a code or an enum, never a sentence: ' +
  'the moment a label is also an identifier, translating it changes what the ' +
  'program does (docs/design/workplan/01-work-plan.md §2).';

const INTL_MESSAGE =
  'Hand-rolled date, time or number formatting. Use `Intl` — see ' +
  'packages/client/src/format.ts. A locale is a property of the reader, and ' +
  'a format assembled from parts bakes in one (docs/design/07-tech-stack.md ' +
  '§12.6).';

export function restrictedSyntax({ allowRandomness = false, userFacing = false } = {}) {
  const entries = [
    {
      selector: `JSXAttribute[name.name="className"] Literal[value=/${PHYSICAL_UTILITY_PATTERN}/]`,
      message: TAILWIND_MESSAGE,
    },
    {
      selector: `JSXAttribute[name.name="className"] TemplateElement[value.raw=/${PHYSICAL_UTILITY_PATTERN}/]`,
      message: TAILWIND_MESSAGE,
    },
    // `Intl` only. Everywhere, not only in user-facing code: a formatted date
    // that reaches a person through an API response is the same problem one
    // step further away, and nothing in this repo formats for display outside
    // the client anyway — so the rule costs nothing and closes the door.
    {
      selector:
        'MemberExpression[property.name=/^(toLocaleString|toLocaleDateString|toLocaleTimeString|toDateString|toTimeString|toUTCString)$/]',
      message: INTL_MESSAGE,
    },
  ];

  if (userFacing) {
    // A sentence joined with `+`, from either side: the clauses are separate
    // strings, so a translator is handed half a sentence at a time and cannot
    // reorder them.
    entries.push({
      selector: `BinaryExpression[operator="+"] > Literal[value=/${PROSE_PATTERN}/]`,
      message: ASSEMBLY_MESSAGE,
    });
    // A sentence split across JSX children: `<span>Revision {n}</span>`. Worse
    // than the `+` case, because there is no single string to hand anybody —
    // the sentence exists only as a shape in the tree. The element must hold
    // *both* words and an expression, so `<span>{name}</span>` is a value and
    // `<code>{kind}/{slug}/</code>` is a path, and neither fires.
    entries.push({
      selector: 'JSXElement:has(> JSXText[value=/[A-Za-z]{2,}/]):has(> JSXExpressionContainer)',
      message: ASSEMBLY_MESSAGE,
    });
    // Branching on displayed text — the rule's other half. A comparison against
    // a sentence turns a label into an identifier, and then translating the
    // label changes what the program does.
    entries.push({
      selector: `BinaryExpression[operator=/^[=!]==?$/] > Literal[value=/${PROSE_PATTERN}/]`,
      message: DISPLAYED_TEXT_MESSAGE,
    });
  }

  if (!allowRandomness) {
    entries.push({
      selector:
        'MemberExpression[object.name=/^(crypto|globalThis)$/][property.name=/^(getRandomValues|randomUUID)$/]',
      message: RANDOM_MESSAGE,
    });
  }

  return ['error', ...entries];
}

// ---------------------------------------------------------------------------
// The architectural boundary graph
// ---------------------------------------------------------------------------

const BOUNDARY_MESSAGE =
  'Architectural boundary violated. The graph is docs/design/workplan/10-testing.md §2: ' +
  'modes → sdk, shared; client → shared; sdk → shared; server → shared, sdk.';

/** @param {string} type */
const from = (type) => ({ element: { type } });

/** @param {string[]} types */
const to = (types) => ({ to: { element: { types: { anyOf: types } } } });

/**
 * The graph from docs/design/workplan/10-testing.md §2, as eslint-plugin-boundaries
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
    message: `${from} may not import ${name}. See docs/design/workplan/10-testing.md §2.`,
  }));
}
