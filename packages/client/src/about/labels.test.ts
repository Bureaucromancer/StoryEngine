// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { buildLine } from './labels.js';

describe('buildLine', () => {
  it('names an identified build by the rule, not by its string', () => {
    expect(buildLine({ version: '1.0.0-alpha.2', commit: 'abc' })).toBe('StoryEngine 1.0-alpha 2');
  });

  it('calls a development build one, rather than inventing a version', () => {
    expect(buildLine(null)).toBe('StoryEngine development build');
  });

  it('shows a version outside the scheme as typed, so the oddity is visible', () => {
    expect(buildLine({ version: 'nightly', commit: 'abc' })).toBe('StoryEngine nightly');
  });
});
