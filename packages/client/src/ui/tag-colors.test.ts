// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { TAG_SWATCHES } from '@storyengine/shared';
import { describe, expect, it } from 'vitest';

import { isSwatch, NEUTRAL_TAG_CLASS, TAG_SWATCH_STYLES, tagClassFor } from './tag-colors.js';

/**
 * The swatch table, held to the two things it cannot be trusted about.
 *
 * **It is a two-place edit** — the ids live in `@storyengine/shared` because the
 * server stores them, and the classes live here because only the client draws
 * them — and a two-place edit is the thing `config.test.ts` exists to police
 * elsewhere in this repo. Same shape of guard, much smaller subject.
 *
 * **And a class list here cannot be checked by anything else.** Tailwind emits
 * only utilities whose names appear literally in the scanned source, so a
 * mistyped `bg-tag-teel-surface` is not a lint error, not a type error and not
 * a test failure anywhere: it is a chip with no background, found by looking at
 * it. Asserting the strings against the tokens is the cheapest thing that
 * notices.
 */
describe('the tag swatches', () => {
  it('are exactly the ids the registry can store', () => {
    expect(Object.keys(TAG_SWATCH_STYLES).sort()).toEqual([...TAG_SWATCHES].sort());
  });

  it('spend the tokens they say they spend', () => {
    for (const [id, style] of Object.entries(TAG_SWATCH_STYLES)) {
      expect(style.surfaceToken, id).toBe(`tag-${id}-surface`);
      expect(style.inkToken, id).toBe(`tag-${id}-ink`);
      expect(style.className, id).toBe(`bg-${style.surfaceToken} text-${style.inkToken}`);
    }
  });

  it('give every swatch a label somebody could pick from', () => {
    for (const [id, style] of Object.entries(TAG_SWATCH_STYLES)) {
      expect(style.label.length, id).toBeGreaterThan(0);
    }
  });
});

/**
 * The open-string promise, from [05 §4](../../../../docs/design/05-tagging.md):
 * a swatch this build has never heard of costs one grey chip, not a file that
 * will not load. The hand-edited case is the whole reason `swatch` is a string
 * rather than a union, so it is worth a test rather than a comment.
 */
describe('an unknown swatch', () => {
  it('falls back to the neutral chip rather than throwing', () => {
    expect(tagClassFor('chartreuse')).toBe(NEUTRAL_TAG_CLASS);
    expect(tagClassFor('')).toBe(NEUTRAL_TAG_CLASS);
  });

  it('is what a tag with no swatch gets too', () => {
    expect(tagClassFor(null)).toBe(NEUTRAL_TAG_CLASS);
  });

  it('is told apart from a known one', () => {
    expect(isSwatch('rose')).toBe(true);
    expect(isSwatch('chartreuse')).toBe(false);
  });

  it('does not stop a known swatch from painting', () => {
    expect(tagClassFor('rose')).toBe('bg-tag-rose-surface text-tag-rose-ink');
  });
});
