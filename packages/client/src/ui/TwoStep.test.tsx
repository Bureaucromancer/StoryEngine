// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TwoStep } from './TwoStep.js';

/**
 * ***A destructive action asks once, the same way everywhere*** — polish 8
 * (2026-10-01), `TwoStep.tsx`.
 *
 * Three claims, each one a thing the copies it replaced got wrong: the keyboard
 * **stays** (on Cancel, the answer that undoes nothing), the question is
 * **announced** there (Cancel is described by it), and the keyboard **comes
 * back** to the trigger when the question closes.
 */

/** What a screen reader says after an element's name: its description. */
function descriptionOf(element: HTMLElement): string {
  const id = element.getAttribute('aria-describedby');
  return id === null ? '' : (document.getElementById(id)?.textContent ?? '');
}

function setup(onConfirm: () => unknown = vi.fn()) {
  render(
    <TwoStep
      label="Remove"
      name="Remove the harbour"
      question="Remove this entry from the book?"
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm };
}

describe('a two-step', () => {
  it('asks before it acts', async () => {
    const { onConfirm } = setup();
    expect(screen.queryByText('Remove this entry from the book?')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Remove the harbour' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Remove this entry from the book?')).toBeTruthy();
  });

  it('moves the keyboard to Cancel, which says what it answers', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Remove the harbour' }));

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    expect(descriptionOf(cancel)).toBe('Remove this entry from the book?');
    expect(descriptionOf(screen.getByRole('button', { name: 'Remove' }))).toBe(
      'Remove this entry from the book?',
    );
    // And no live region of its own, in this row or any other.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('gives the keyboard back to the trigger when cancelled, having done nothing', async () => {
    const { onConfirm } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Remove the harbour' }));
    await userEvent.keyboard('{Enter}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove the harbour' }));
    expect(screen.queryByText('Remove this entry from the book?')).toBeNull();
  });

  it('acts on the answer, once, and closes', async () => {
    const { onConfirm } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Remove the harbour' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove the harbour' }));
  });

  it('holds the answer while a slow one settles, so it cannot be sent twice', async () => {
    let settle: () => void = () => undefined;
    const { onConfirm } = setup(
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve;
          }),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove the harbour' }));
    const answer = screen.getByRole('button', { name: 'Remove' });
    await userEvent.click(answer);

    expect(answer).toHaveProperty('disabled', true);
    await userEvent.click(answer);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    settle();
    expect(await screen.findByRole('button', { name: 'Remove the harbour' })).toBeTruthy();
  });
});
