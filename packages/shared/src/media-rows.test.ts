// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { mediaRowsIn } from './media-rows.js';

describe('finding the rows', () => {
  it('walks both levels and ignores anything that is not a row', () => {
    const rows = mediaRowsIn({
      media: [{ id: 'a', ref: 'assets/a.png' }, 'nonsense', null],
      entries: [{ media: [{ id: 'b', ref: 'assets/b.png' }] }, { media: 'not an array' }],
    });
    expect(rows.map((one) => one.id)).toEqual(['a', 'b']);
  });

  it('stops rather than looping on a cycle', () => {
    const looped: Record<string, unknown> = { media: [{ id: 'a', ref: 'assets/a.png' }] };
    looped['self'] = looped;
    expect(mediaRowsIn(looped).map((one) => one.id)).toEqual(['a']);
  });
});
