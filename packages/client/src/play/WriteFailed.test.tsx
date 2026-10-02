// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../api.js';
import { WriteFailed, writeFailed } from './WriteFailed.js';

/**
 * ***What a play panel says when a write did not land*** — polish 9
 * (2026-10-01). Read by class: `busy` is a turn in flight and says to wait;
 * everything else is the panel's own sentence, or the generic one.
 */
describe('a refused play write', () => {
  it('says to wait when a turn is running', () => {
    expect(writeFailed(new ApiError(409, 'busy', 'In flight.'), 'That dial could not move.')).toBe(
      'A turn is running. Try again when it has finished.',
    );
  });

  it('says the panel’s own sentence for anything else, never the server’s English', () => {
    expect(
      writeFailed(new ApiError(400, 'invalid', 'body/value must be string'), 'That did not save.'),
    ).toBe('That did not save.');
    expect(writeFailed(new Error('offline'))).toBe('That could not be saved.');
  });

  it('renders nothing while there is no failure, and an alert when there is', () => {
    const { rerender } = render(<WriteFailed error={null} />);
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(<WriteFailed error={new ApiError(409, 'busy', 'In flight.')} />);
    expect(screen.getByRole('alert').textContent).toBe(
      'A turn is running. Try again when it has finished.',
    );
  });
});
