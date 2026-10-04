// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { ApiError } from '../api.js';
import { assistFailure } from './FieldAssist.js';

/**
 * ***What a failed assist says*** (2026-09-27).
 *
 * The editor read the server's class from `body.error`, which an `ApiError`
 * does not have — the class is `code` — so every failure read *the assist did
 * not finish*, an unbound role included, and the remedy a person could act on
 * never reached them. The endpoint's own failures now get the sentence a failed
 * turn gets.
 */
describe('a failed assist, in words', () => {
  it('sends an unbound role to Settings', () => {
    expect(assistFailure(new ApiError(422, 'not-bound', 'x'))).toMatch(/Bind one in Settings/);
  });

  it('tells an empty answer apart', () => {
    expect(assistFailure(new ApiError(422, 'no-answer', 'x'))).toMatch(/answered with nothing/);
  });

  it('says what a failed turn would say about the endpoint', () => {
    const refused = new ApiError(
      502,
      'provider-failed',
      'x',
      undefined,
      undefined,
      undefined,
      'endpoint-refused',
    );
    expect(assistFailure(refused)).toMatch(/refused the request\. Check the key/);
  });

  it('names the setting when the window has no room', () => {
    expect(assistFailure(new ApiError(422, 'window-too-small', 'x'))).toMatch(
      /Raise the context window/,
    );
  });

  it('falls back to saying only that it did not finish', () => {
    expect(assistFailure(new Error('the network went away'))).toBe('The assist did not finish.');
  });
});
