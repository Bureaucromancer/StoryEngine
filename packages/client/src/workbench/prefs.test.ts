// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SIZE,
  MAX_SIZE,
  MIN_SIZE,
  OPEN_KEY,
  SIZE_KEY,
  workbenchOpenFromPrefs,
  workbenchOpenPatch,
  workbenchSizeFromPrefs,
  workbenchSizePatch,
} from './prefs.js';

/**
 * The pure half of [P3.1a](../../../../docs/design/workplan/15-p3-implementation.md):
 * what the workbench reads out of a prefs document it does not control.
 * `prefs.json` is hand-editable by design and the server validates nothing
 * but the key shape, so the read helpers are the whole defence — the clamp
 * is [P3 §1.2]'s one-line answer to a laptop and a monitor fighting over one
 * number, and it has to hold against garbage, not just against big.
 *
 * A node-project file on purpose: nothing here touches the DOM, and the
 * jsdom half (the drag writing once, the clamp reaching the stylesheet) is
 * `dock.test.tsx`'s.
 */

describe('the open preference', () => {
  it('opens only on the stored literal, not on anything truthy', () => {
    expect(workbenchOpenFromPrefs({ [OPEN_KEY]: true })).toBe(true);
    expect(workbenchOpenFromPrefs(undefined)).toBe(false);
    expect(workbenchOpenFromPrefs({})).toBe(false);
    // Hand edits happen; 'true' the string and 1 the number are not a claim
    // the client ever wrote, and guessing at them would make the file's
    // contents load-bearing in a way nothing documents.
    expect(workbenchOpenFromPrefs({ [OPEN_KEY]: 'true' })).toBe(false);
    expect(workbenchOpenFromPrefs({ [OPEN_KEY]: 1 })).toBe(false);
  });

  it('writes open as the value and closed as the deletion', () => {
    expect(workbenchOpenPatch(true)).toEqual({ [OPEN_KEY]: true });
    expect(workbenchOpenPatch(false)).toEqual({ [OPEN_KEY]: null });
  });
});

describe('the size preference', () => {
  it('reads anything unusable as the default', () => {
    expect(workbenchSizeFromPrefs(undefined)).toBe(DEFAULT_SIZE);
    expect(workbenchSizeFromPrefs({})).toBe(DEFAULT_SIZE);
    expect(workbenchSizeFromPrefs({ [SIZE_KEY]: 'wide' })).toBe(DEFAULT_SIZE);
    expect(workbenchSizeFromPrefs({ [SIZE_KEY]: '400' })).toBe(DEFAULT_SIZE);
    expect(workbenchSizeFromPrefs({ [SIZE_KEY]: Number.NaN })).toBe(DEFAULT_SIZE);
    expect(workbenchSizeFromPrefs({ [SIZE_KEY]: Number.POSITIVE_INFINITY })).toBe(DEFAULT_SIZE);
  });

  it('clamps what it reads, and keeps a legal number as it is', () => {
    expect(workbenchSizeFromPrefs({ [SIZE_KEY]: 10 })).toBe(MIN_SIZE);
    expect(workbenchSizeFromPrefs({ [SIZE_KEY]: 10_000 })).toBe(MAX_SIZE);
    expect(workbenchSizeFromPrefs({ [SIZE_KEY]: 400 })).toBe(400);
    // Sub-pixel widths round rather than travel: a fractional number in a
    // hand-editable file reads as noise, and the width the drag writes back
    // is always whole.
    expect(workbenchSizeFromPrefs({ [SIZE_KEY]: 400.6 })).toBe(401);
  });

  it('clamps what it writes, so a drag released off-screen stores a legal number', () => {
    expect(workbenchSizePatch(10_000)).toEqual({ [SIZE_KEY]: MAX_SIZE });
    expect(workbenchSizePatch(-50)).toEqual({ [SIZE_KEY]: MIN_SIZE });
    expect(workbenchSizePatch(420.4)).toEqual({ [SIZE_KEY]: 420 });
  });
});
