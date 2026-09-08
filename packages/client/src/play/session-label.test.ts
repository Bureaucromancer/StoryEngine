// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { sessionLabel } from './session-label.js';

/**
 * The fallback every session name is rendered through — [02 §8].
 *
 * Cheap to test and easy to get subtly wrong, which is the combination worth
 * covering: the `??` this replaced at `PlayPage.tsx` looked right and only
 * caught `undefined`, so an empty name went straight through it and the
 * heading rendered blank.
 */
describe('what to call an unnamed session', () => {
  it('names the ones that have names', () => {
    expect(sessionLabel('Rain City')).toBe('Rain City');
  });

  it('labels an empty name rather than rendering nothing', () => {
    expect(sessionLabel('')).toBe('Untitled session');
  });

  /**
   * The route trims, but `session.json` is hand-editable, so a name of three
   * spaces can arrive here without having passed the route that cleans it.
   */
  it('treats whitespace as no name at all', () => {
    expect(sessionLabel('   ')).toBe('Untitled session');
    expect(sessionLabel('\n\t')).toBe('Untitled session');
  });

  it('handles a session that has not loaded yet', () => {
    expect(sessionLabel(undefined)).toBe('Untitled session');
  });

  /** Inner whitespace is somebody's name, not padding to be cleaned up. */
  it('does not trim the name it returns', () => {
    expect(sessionLabel(' Rain City ')).toBe(' Rain City ');
  });
});
