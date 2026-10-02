// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The day-one rules, factored out of `eslint.config.js` so that the fixture
 * tests in `tools/lint-fixtures/` exercise *these objects* rather than a
 * hand-copied approximation of them.
 *
 * That indirection is the whole point. P1.0's deliverable is a set of claims
 * about what is a build error (docs/design/workplan/07-p1-implementation.md §P1.0), and
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
  'resolver is the only door (docs/design/19-tech-stack.md §9).';

// ---------------------------------------------------------------------------
// No randomness outside the RNG service
// ---------------------------------------------------------------------------

const RANDOM_MESSAGE =
  'Every random draw comes from the single RNG service and is recorded, or replay ' +
  'and branching break silently (docs/design/19-tech-stack.md §14). The service ' +
  'is packages/server/src/rng — draw through `rng.at(site, purpose)`, which is ' +
  'what puts the value on the turn tape. An unrecorded draw does not fail here; ' +
  'it fails much later, as a branch that reconstructs wrong.';

const CRYPTO_RANDOM_NAMES = [
  'randomInt',
  'randomBytes',
  'randomUUID',
  'randomFill',
  'randomFillSync',
  'getRandomValues',
  // The Web Crypto object `node:crypto` also exports, whose `getRandomValues`
  // is a draw like any other (2026-10-01).
  'webcrypto',
];

/**
 * The same names as a pattern, for the syntax rule's member and destructuring
 * selectors below — one list, so a name added to the import ban is a name the
 * syntax ban sees.
 */
const CRYPTO_RANDOM_PATTERN = `^(${CRYPTO_RANDOM_NAMES.join('|')})$`;

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

  // ~~`paths.push({ name: \`${banned.name}/*\` })`~~ — `paths` compares exact
  // names, so that entry matched only a module literally called
  // `@storyengine/server/*` and a deep import walked past it (2026-10-01).
  // `patterns` is the glob form; TypeScript's export maps refuse most such
  // imports too, but the lint layer is the one that survives a resolver
  // failing, which is the reason it exists at all.
  const patterns = bannedPackages.map((banned) => ({
    group: [`${banned.name}/*`],
    message: banned.message,
  }));
  for (const banned of bannedPackages) {
    paths.push({ name: banned.name, message: banned.message });
  }

  return ['error', patterns.length === 0 ? { paths } : { paths, patterns }];
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
 * declaration — which is why the CSS half of docs/design/19-tech-stack.md
 * §12.6 needs two rules rather than one.
 *
 * **Why this pattern is exact rather than generous**, which is the part worth
 * knowing before editing it. The rule used to be anchored on
 * `JSXAttribute[name.name="className"]`, and that anchor let position do the
 * work of precision: everything inside a `className` is a class, so `left` and
 * `right` could carry an *optional* suffix and match the bare words harmlessly.
 *
 * The anchor stopped being tenable when the class strings moved into
 * `packages/client/src/ui/`. A string in a `const` has no `JSXAttribute`
 * ancestor, so the rule would have gone silent exactly where the appearance of
 * the whole app had just been gathered — and it had been silent for a while
 * already, on the five class constants that predate `ui/` and on `Shell.tsx`'s
 * `activeProps={{ className }}`, where the class travels through an *object
 * property* rather than an attribute.
 *
 * Unanchored, the rule sees every string in the repo, and this repo is full of
 * strings that a generous pattern reads as physical utilities:
 *
 *   packages/server/src/index-db/sessions.ts   `from turn left join turn_fts`
 *   packages/server/src/routes/routes.test.ts  `accepts the right password`
 *   packages/client/src/settings/…test.tsx     `when it was left blank`
 *
 * So `left` and `right` require a Tailwind-shaped suffix — a digit, `px`,
 * `full`, `auto`, an arbitrary `[…]` or a `(…)` variable. Nothing real is lost:
 * bare `ml`, `pl`, `left` and `right` are not utilities, since the utility is
 * always `ml-4` or `left-0`. `tools/lint-fixtures` pins both halves of that —
 * the physical forms still report, and a fixture of ordinary English and SQL
 * reports nothing. Do not relax this back into the anchored shape.
 */
const PHYSICAL_UTILITY_PATTERN = String.raw`(?:^|\s)(?:[\w[\]-]+:)*-?(?:(?:left|right)-(?:\d|px|full|auto|\[|\()[^\s]*|(?:ml|mr|pl|pr|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-[^\s]+|(?:border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)(?:-[^\s]*)?|text-left|text-right|float-left|float-right|clear-left|clear-right)(?:\s|$)`;

const TAILWIND_MESSAGE =
  'Physical-direction utility. Use the logical equivalent (ms/me, ps/pe, ' +
  'start/end, border-s/border-e, rounded-s/rounded-e, text-start/text-end). ' +
  'RTL is a dir attribute or a rewrite — see docs/design/19-tech-stack.md §12.6.';

/**
 * Builds the `no-restricted-syntax` value. A function for the same reason
 * `restrictedImports` is: the rule can only be configured once per config
 * object, and the two exempt files (`ids.ts`, `secrets.ts`) need the Tailwind
 * bans without the Web Crypto ban — `crypto.getRandomValues` is how they draw
 * randomness portably, since `shared` must also run in a browser (the
 * `client → shared` edge in docs/design/workplan/03-testing.md §2).
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
 * shape ICU MessageFormat wants (docs/design/19-tech-stack.md §12.3) and
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

// ---------------------------------------------------------------------------
// The palette lives in one file
// ---------------------------------------------------------------------------

/**
 * A Tailwind palette scale — `bg-slate-800`, `text-red-900`, `border-amber-300`.
 *
 * Every one of these is a colour decision made at a call site, and the client
 * made about a hundred and seventy of them before they were gathered. The
 * semantic tokens in `packages/client/src/index.css` replaced them, and this
 * rule is what stops the hundred and seventy-first: after it, the *only* place
 * in the client that can name a scale is that stylesheet, which ESLint does not
 * read and Stylelint does.
 *
 * That is not tidiness. A second theme is a redefinition of those tokens, so a
 * component that reaches past them for `bg-slate-100` is a component that stays
 * light when everything around it goes dark — which is exactly the defect this
 * work started from, where a play surface written against one palette was
 * rendered inside a shell written against another and typed text came out at
 * 1.01 to 1.
 *
 * The arbitrary-value escape (`bg-[#fff]`) is deliberately *not* matched. It is
 * loud, greppable and occasionally correct for a one-off; the failure mode this
 * rule exists for is the quiet, plausible one.
 */
const PALETTE_PATTERN = String.raw`(?:^|\s)(?:[\w[\]-]+:)*-?(?:bg|text|border|ring|outline|decoration|divide|from|via|to|accent|caret|placeholder|shadow|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+(?:\/\d+)?(?:\s|$)`;

const PALETTE_MESSAGE =
  'Tailwind palette scale in a component. Use a semantic token — bg-surface, ' +
  'text-ink-muted, border-line, text-danger-ink — and if none of them says what ' +
  'you mean, add one. The palette lives in packages/client/src/index.css and ' +
  'nowhere else, because a second theme redefines those tokens: a scale named ' +
  'here is a surface that stays light when the rest of the app goes dark.';

/**
 * `dark:` in a component, which is the same mistake wearing a different hat.
 *
 * The dark theme redefines tokens; it does not add variants. So a component
 * that needs `dark:` is a component whose token is missing — and the fix is to
 * add the token, which fixes every other surface that was about to need the
 * same variant.
 */
const DARK_VARIANT_MESSAGE =
  'A `dark:` variant. The dark theme redefines tokens rather than adding ' +
  'variants, so a component that needs one is a component whose token is ' +
  'missing: add it to the @theme block and the dark override in ' +
  'packages/client/src/index.css, and every other surface gets it too.';

const CLASS_JOIN_MESSAGE =
  'A class list joined with `+`. Each variant is one string literal, however ' +
  'long — Prettier will not split it. If the assembly rule also fired here, ' +
  'this is the message that applies: that rule cannot tell a class list from a ' +
  'sentence, because `rounded border` is two plain words in a row, and its ' +
  'advice about word order is not what is wrong with a class list. Position — ' +
  'a margin, an `mt-` — belongs at the call site rather than in the recipe, so ' +
  'there is nothing left to join.';

const INTL_MESSAGE =
  'Hand-rolled date, time or number formatting. Use `Intl` — see ' +
  'packages/client/src/format.ts. A locale is a property of the reader, and ' +
  'a format assembled from parts bakes in one (docs/design/19-tech-stack.md ' +
  '§12.6).';

/**
 * The ids a shipped or planned mode uses. Deliberately a fixed list rather
 * than `storyengine\.\w+`, which would fire on `storyengine.cast` and every other
 * namespaced string in the build — and deliberately *not* the whole of row 2b,
 * because a selector cannot recognise the id of a mode nobody has written yet.
 * The enumeration with its reasoned allowlist stays in `tools/repo-shape.test.ts`;
 * this catches the **shapes**, at type time.
 *
 * ***`assistant` since 2026-10-01*** — the third shipped mode, and the one this
 * list was a fixed list of four without: P11.3 made it a mode package like any
 * other, and nothing here noticed, so the engine could have switched on it
 * freely. `repo-shape.test.ts`'s survey carries the same list and was missing
 * it the same way.
 */
const MODE_ID_PATTERN = String.raw`^storyengine\.(scene|freeform|assistant|campaign|messages)`;

const MODE_SWITCH_MESSAGE =
  'A `switch` on a mode. docs/design/06-modes-and-turn-pipeline.md §2: the host ' +
  'never branches on which mode is running — it reads a declaration and ' +
  'enforces it. If the engine needs behaviour that differs per mode, the mode ' +
  'declares it and this file reads the declaration.';

const MODE_BRANCH_MESSAGE =
  'A comparison against a mode id. This is `switch (mode)` with the switch ' +
  'spelled out, and docs/design/06-modes-and-turn-pipeline.md §2 refuses both. ' +
  'A mode id in engine code is the engine knowing which modes exist, which is ' +
  'the bet docs/design/19-tech-stack.md §10 calls the design’s central one.';

const MODE_KEY_MESSAGE =
  'A lookup keyed by mode id. A table of per-mode behaviour is the third shape ' +
  'docs/design/06-modes-and-turn-pipeline.md §2 refuses, and the one that looks ' +
  'most like data: it still means a third-party mode gets no row. The ' +
  'declaration belongs on `ModeDefinition`, where every mode has one.';

export function restrictedSyntax({
  allowRandomness = false,
  userFacing = false,
  classList = false,
  tokensOnly = false,
  engineOnly = false,
  readsTheScreen = false,
} = {}) {
  const entries = [
    // Not anchored on `className`. See the pattern's docstring: the anchor was
    // what made the class constants in `packages/client/src/ui/` invisible, and
    // those are now where the app's appearance lives.
    {
      selector: `Literal[value=/${PHYSICAL_UTILITY_PATTERN}/]`,
      message: TAILWIND_MESSAGE,
    },
    {
      selector: `TemplateElement[value.raw=/${PHYSICAL_UTILITY_PATTERN}/]`,
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

  // And the same through a string method (2026-09-27). Four settings panels
  // chose their failure sentence with `message.includes('free space')` and its
  // like — a server's English made into an identifier all the same, and out of
  // the comparison selector's sight. A refusal carries its class, and
  // `errorCode()` in the client's api.ts is how to read it.
  //
  // *Not in a test* (`readsTheScreen`): a test searching what was rendered for
  // `'Prompt tokens'` is reading the screen, which is its job, and a rule that
  // fired there would be worked around in every one of them.
  if (userFacing && !readsTheScreen) {
    entries.push({
      selector: `CallExpression[callee.property.name=/^(includes|startsWith|endsWith)$/] > Literal[value=/${PROSE_PATTERN}/]`,
      message: DISPLAYED_TEXT_MESSAGE,
    });
  }

  if (tokensOnly) {
    entries.push(
      { selector: `Literal[value=/${PALETTE_PATTERN}/]`, message: PALETTE_MESSAGE },
      { selector: `TemplateElement[value.raw=/${PALETTE_PATTERN}/]`, message: PALETTE_MESSAGE },
      {
        selector: String.raw`Literal[value=/(?:^|\s)dark:/]`,
        message: DARK_VARIANT_MESSAGE,
      },
      {
        selector: String.raw`TemplateElement[value.raw=/(?:^|\s)dark:/]`,
        message: DARK_VARIANT_MESSAGE,
      },
    );
  }

  if (classList) {
    // A `+` whose operand holds a hyphenated utility (`text-sm`, `bg-surface`).
    // Deliberately narrower than a blanket ban on `+`: arithmetic is fine, and
    // the thing being prevented is specifically a class list arriving in
    // pieces, where the assembly rule would fire with the wrong explanation.
    entries.push({
      selector: String.raw`BinaryExpression[operator="+"] > Literal[value=/(?:^|\s)[a-z][a-z0-9]*-[a-z0-9[\]/.-]+(?:\s|$)/]`,
      message: CLASS_JOIN_MESSAGE,
    });
  }

  if (!allowRandomness) {
    /*
     * ~~`MemberExpression[object.name=/^(crypto|globalThis)$/][property.name=…]`~~
     * — which saw `crypto.randomUUID()` and nothing else (2026-10-01): not
     * `globalThis.crypto.randomUUID()`, whose object is a member expression;
     * not `window.crypto`, `self.crypto` or a default import under another
     * name; not `crypto['randomUUID']()`; not `const { randomInt } = await
     * import('node:crypto')`. **Matched on the name being drawn**, whatever it
     * is reached through, because the name is the draw: the import ban holds
     * the module, and these hold every way of getting a function out of it.
     */
    entries.push(
      {
        selector: `MemberExpression[property.name=/${CRYPTO_RANDOM_PATTERN}/]`,
        message: RANDOM_MESSAGE,
      },
      {
        selector: `MemberExpression[computed=true][property.value=/${CRYPTO_RANDOM_PATTERN}/]`,
        message: RANDOM_MESSAGE,
      },
      {
        selector: `ObjectPattern > Property[key.name=/${CRYPTO_RANDOM_PATTERN}/]`,
        message: RANDOM_MESSAGE,
      },
    );
  }

  if (engineOnly) {
    /*
     * ***The engine names no mode*** — docs/design/06-modes-and-turn-pipeline.md
     * §2, and the exit gate's row 2b, which asks for *"a lint rule with
     * fixtures, plus a tracked-file survey"* and got only the survey until P7.13.
     *
     * **Two layers on purpose, the way the boundary rules already are.** The
     * survey in `tools/repo-shape.test.ts` enumerates every mode id in engine
     * source against an allowlist with a reason on each entry — which is the
     * only half that can notice an id nobody has coined yet. These selectors
     * catch the three *shapes* §3.1 names, in the editor, as they are typed.
     * Neither is redundant: a survey runs at `pnpm test` and a selector cannot
     * recognise a new mode.
     */
    entries.push(
      // `switch (mode)` and `switch (session.modeId)`, which is what somebody
      // reaches for first when the pressure to special-case one mode arrives.
      {
        selector: 'SwitchStatement[discriminant.name=/[Mm]ode(Id)?$/]',
        message: MODE_SWITCH_MESSAGE,
      },
      {
        selector: 'SwitchStatement[discriminant.property.name=/[Mm]ode(Id)?$/]',
        message: MODE_SWITCH_MESSAGE,
      },
      /*
       * ***And the shape the engine's data actually has*** (2026-10-01).
       * A session stores `mode?: { id, config }`, so the switch somebody writes
       * is `switch (session.mode?.id)` — a `ChainExpression`, whose property is
       * `id`, which neither selector above could see — or `switch
       * (session.mode.id)`, or `switch (mode.id)`. Matched on the object being
       * a mode and the property being `id`, in all three spellings; and,
       * whatever the discriminant, on a `case` that names a mode id, which is
       * the half of a switch that cannot be renamed away.
       */
      {
        selector:
          'SwitchStatement[discriminant.property.name="id"][discriminant.object.name=/[Mm]ode$/]',
        message: MODE_SWITCH_MESSAGE,
      },
      {
        selector:
          'SwitchStatement[discriminant.property.name="id"][discriminant.object.property.name=/[Mm]ode$/]',
        message: MODE_SWITCH_MESSAGE,
      },
      {
        selector:
          'SwitchStatement[discriminant.type="ChainExpression"][discriminant.expression.property.name="id"][discriminant.expression.object.property.name=/[Mm]ode$/]',
        message: MODE_SWITCH_MESSAGE,
      },
      {
        selector: `SwitchCase[test.value=/${MODE_ID_PATTERN}/]`,
        message: MODE_SWITCH_MESSAGE,
      },
      // `if (modeId === 'storyengine.scene')` — the same switch, spelled out.
      {
        selector: `BinaryExpression[operator=/^[=!]==?$/] > Literal[value=/${MODE_ID_PATTERN}/]`,
        message: MODE_BRANCH_MESSAGE,
      },
      // `{ 'storyengine.scene': … }` — a table of per-mode behaviour, which is
      // the shape that looks most like data and is not.
      {
        selector: `Property[key.value=/${MODE_ID_PATTERN}/]`,
        message: MODE_KEY_MESSAGE,
      },
    );
  }

  return ['error', ...entries];
}

// ---------------------------------------------------------------------------
// The architectural boundary graph
// ---------------------------------------------------------------------------

const BOUNDARY_MESSAGE =
  'Architectural boundary violated. The graph is docs/design/workplan/03-testing.md §2: ' +
  'modes → sdk, shared; client → shared; sdk → shared; server → shared, sdk.';

/** @param {string} type */
const from = (type) => ({ element: { type } });

/** @param {string[]} types */
const to = (types) => ({ to: { element: { types: { anyOf: types } } } });

/**
 * The graph from docs/design/workplan/03-testing.md §2, as eslint-plugin-boundaries
 * settings and rules.
 *
 * `modes` is defined here even though `packages/modes/` does not exist. That is
 * deliberate: docs/design/19-tech-stack.md §10 claims built-in modes consume the
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
    message: `${from} may not import ${name}. See docs/design/workplan/03-testing.md §2.`,
  }));
}
