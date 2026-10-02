// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { PRESET_SCHEMA, TREATMENT_SCHEMA } from '@storyengine/shared';

import { usedByLine } from './UsedBy.js';

/**
 * ***The sentence over a delete*** — the line's first test, written with the
 * fix it covers (2026-09-27).
 *
 * A reference's kind arrives as the referring file's schema id, or `session`;
 * the words were keyed by a spelling no server has sent, so every library kind
 * fell through to its id and the confirmation read *Referenced by 1 session and
 * 2 storyengine.treatment/1*. The fixtures below are the shared constants
 * rather than literals, so the test cannot agree with the table by repeating
 * its mistake.
 */

function from(
  fromKind: string,
  fromId: string,
): {
  fromKind: string;
  fromId: string;
  fromName: string;
} {
  return { fromKind, fromId, fromName: fromId };
}

describe('the used-by line', () => {
  it('names each kind in words, counted', () => {
    expect(
      usedByLine([
        from(TREATMENT_SCHEMA, 't-1'),
        from('session', 's-1'),
        from(PRESET_SCHEMA, 'p-1'),
        from(TREATMENT_SCHEMA, 't-2'),
      ]),
    ).toBe('Referenced by 1 session, 1 preset and 2 treatments.');
  });

  it('says nothing when nothing refers here', () => {
    expect(usedByLine([])).toBeNull();
  });

  it('renders a kind this build has no word for as its own id', () => {
    // A newer server's kind, and one that names a key every object inherits:
    // neither may vanish, and neither may be read through the prototype.
    expect(usedByLine([from('storyengine.scrapbook/1', 'x'), from('constructor', 'y')])).toBe(
      'Referenced by 1 constructor and 1 storyengine.scrapbook/1.',
    );
  });
});
