// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TextSpan } from '@storyengine/shared';

import { MentionOverlay } from './MentionOverlay.js';

/**
 * The mention overlay — [10 §13.1], [06 §8.2], [P7.7].
 *
 * ***The claim worth holding is that the text is untouched.*** 06 §8.2: *"spans
 * on the turn record, never a rewrite of the message text."* Every assertion
 * here is ultimately about that — the same characters, with marks around some of
 * them.
 */

function span(over: Partial<TextSpan> = {}): TextSpan {
  return {
    field: 'output',
    start: 0,
    end: 4,
    target: { kind: 'actor', ref: { id: 'actor-vera', name: 'Vera Kohl' } },
    method: 'matched',
    confidence: null,
    ...over,
  };
}

describe('drawing what the engine understood', () => {
  it('renders the prose unchanged when there is nothing to mark', () => {
    const { container } = render(<MentionOverlay text="Vera opened the door." spans={[]} />);

    expect(container.textContent).toBe('Vera opened the door.');
    expect(container.querySelector('mark')).toBeNull();
  });

  it('marks the span and leaves every other character where it was', () => {
    const { container } = render(<MentionOverlay text="Vera opened the door." spans={[span()]} />);

    // The mark is the name…
    expect(screen.getByText('Vera').tagName).toBe('MARK');
    // …and the text as a whole is byte-for-byte what the model wrote.
    expect(container.textContent).toBe('Vera opened the door.');
  });

  it('marks two people in one sentence separately', () => {
    const { container } = render(
      <MentionOverlay
        text="Vera told Lund."
        spans={[
          span(),
          span({
            start: 10,
            end: 14,
            target: { kind: 'actor', ref: { id: 'actor-lund', name: 'Lund' } },
          }),
        ]}
      />,
    );

    expect([...container.querySelectorAll('mark')].map((one) => one.textContent)).toEqual([
      'Vera',
      'Lund',
    ]);
    expect(container.textContent).toBe('Vera told Lund.');
  });

  /**
   * *`runsFor` walks one cursor forward*, so an unsorted list would silently
   * drop marks rather than draw them wrongly — which is the worse failure,
   * because a missing highlight reads as *the engine did not understand that*.
   */
  it('marks spans that arrive out of order', () => {
    const { container } = render(
      <MentionOverlay
        text="Vera told Lund."
        spans={[
          span({
            start: 10,
            end: 14,
            target: { kind: 'actor', ref: { id: 'actor-lund', name: 'Lund' } },
          }),
          span(),
        ]}
      />,
    );

    expect(container.querySelectorAll('mark')).toHaveLength(2);
  });
});
