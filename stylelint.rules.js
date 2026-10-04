// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The CSS half of the logical-properties rule
 * (docs/design/19-tech-stack.md §12.6, docs/design/workplan/01-work-plan.md §2).
 *
 * Split out of `stylelint.config.js` for the same reason the ESLint rules are:
 * the fixture tests in `tools/lint-fixtures/` run against these objects.
 *
 * Written before there is any CSS to check, which is the point — this is
 * docs/design/workplan/07-p1-implementation.md §P1.0's ordering, and it is why the first
 * stylesheet in the project could not have been written the wrong way.
 */

const LOGICAL_MESSAGE =
  'Physical property. Use the logical equivalent (margin-inline-start, ' +
  'padding-inline-end, inset-inline-start, border-inline-start…). RTL is a ' +
  'dir attribute or a rewrite — docs/design/19-tech-stack.md §12.6.';

/**
 * The plugin covers the common declarations. This list is the backstop, in case
 * the plugin's coverage shifts under a version bump — a boundary rule that
 * silently stops matching is worse than no boundary rule.
 *
 * Scoped to the properties that are *direction*-sensitive, which is the RTL
 * concern the design actually names. `width`, `height` and `overflow-x` are
 * axis-sensitive rather than direction-sensitive: they only matter under a
 * vertical writing mode, and banning `width` outright would be a rule people
 * fight rather than follow. The plugin still nudges them.
 */
const PHYSICAL_PROPERTIES = [
  /^margin-(left|right|top|bottom)$/,
  /^padding-(left|right|top|bottom)$/,
  /^border-(left|right|top|bottom)(-.*)?$/,
  /^(left|right|top|bottom)$/,
  /^border-(top|bottom)-(left|right)-radius$/,
  /^scroll-margin-(left|right|top|bottom)$/,
  /^scroll-padding-(left|right|top|bottom)$/,
];

/** @type {NonNullable<import('stylelint').Config['rules']>} */
export const stylelintRules = {
  'csstools/use-logical': 'always',

  'property-disallowed-list': [PHYSICAL_PROPERTIES, { message: LOGICAL_MESSAGE }],

  'declaration-property-value-disallowed-list': [
    {
      'text-align': ['left', 'right'],
      float: ['left', 'right'],
      clear: ['left', 'right'],
      resize: ['horizontal', 'vertical'],
    },
    {
      message:
        'Physical direction. Use `start` / `end` (text-align, float, clear) or ' +
        '`block` / `inline` (resize).',
    },
  ],

  // Tailwind v4 is CSS-first: its configuration lives in at-rules rather than a
  // JavaScript config file, so the standard config's unknown-at-rule check has
  // to be told about them. Configured rather than disabled — an at-rule that is
  // genuinely a typo should still fail.
  'at-rule-no-unknown': [
    true,
    {
      ignoreAtRules: [
        'theme',
        'source',
        'utility',
        'variant',
        'custom-variant',
        'apply',
        'reference',
        'config',
        'plugin',
      ],
    },
  ],

  // Same list, for the deprecation check shipped by stylelint-config-standard.
  'at-rule-no-deprecated': [true, { ignoreAtRules: ['apply'] }],

  // Tailwind v4 resolves `@import "tailwindcss"` as a package specifier, not a
  // URL, so the standard config's preference for url() is wrong here.
  'import-notation': 'string',

  // Tailwind v4 spells a token's sub-properties with a doubled hyphen —
  // `--text-section--line-height` is the line height belonging to the
  // `--text-section` step, and writing it that way is what makes `text-section`
  // set size, leading and weight in one utility. The standard config's
  // kebab-case pattern reads the doubled hyphen as a mistake.
  //
  // Widened rather than switched off, and only by that one construct: a name is
  // still kebab-case, optionally followed by a single `--` and one more
  // kebab-case name. A genuine typo like `--Text-Section` still fails.
  // A font token is a list of family names, and the standard config's
  // keyword-case rule cannot tell a name from a keyword inside a custom
  // property. It already leaves `font-family` alone for exactly this reason —
  // `Charter` is a name, and `charter` is the same name spelled worse — so the
  // tokens that hold a stack get the same exemption (2026-10-01). Narrowed to
  // `--font-*` rather than switched off: an upper-case keyword anywhere else,
  // a token included, still fails. And not answered by quoting every name,
  // because two of them cannot be quoted: `-apple-system` and
  // `BlinkMacSystemFont` are keywords to the browsers that know them, and a
  // quoted one is a family nobody has installed.
  'value-keyword-case': ['lower', { ignoreProperties: [/^--font-/] }],

  'custom-property-pattern': [
    '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$',
    {
      message:
        'Custom property names are kebab-case, optionally with one `--` before ' +
        'a Tailwind theme sub-property (`--text-section--line-height`).',
    },
  ],
};
