// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';

import { stylelintRules } from '../../stylelint.rules.js';

import { FIXTURE_ROOT } from './fixture-config.js';

/**
 * The CSS half of the logical-properties rule. Written before there was any CSS
 * in the project (docs/design/workplan/03-p1-implementation.md §P1.0), which is why the
 * first stylesheet could not have been written the wrong way — and why this
 * test is the only thing that would have noticed if the rule did not work.
 */

async function rulesFiredIn(fixture: string): Promise<string[]> {
  const { results } = await stylelint.lint({
    files: `${FIXTURE_ROOT}/css/${fixture}`,
    config: {
      extends: ['stylelint-config-standard'],
      plugins: ['stylelint-use-logical'],
      rules: stylelintRules,
    },
  });

  const [result] = results;
  if (!result) {
    throw new Error(`No lint result for ${fixture} — is the path right?`);
  }
  return result.warnings.map((w) => w.rule);
}

describe('logical properties in CSS (docs/design/07-tech-stack.md §12.6)', () => {
  it('flags every physical property in the fixture', async () => {
    const fired = await rulesFiredIn('physical.css');

    // margin-left, padding-right and border-left are caught twice over: once by
    // the plugin and once by the disallow list that backstops it. Both layers
    // are asserted, because the backstop exists precisely for the day the
    // plugin's coverage shifts under a version bump.
    expect(fired).toContain('csstools/use-logical');
    expect(fired).toContain('property-disallowed-list');
    expect(fired).toContain('declaration-property-value-disallowed-list');
  });

  it('passes the logical equivalents', async () => {
    const fired = await rulesFiredIn('logical.css');
    expect(fired).toEqual([]);
  });
});
