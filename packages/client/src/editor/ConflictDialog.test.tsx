// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConflictDialog } from './ActorEditorPage.js';

/**
 * The first component test — F16.
 *
 * Its subject matters less than its existence. `vitest.config.ts` included
 * `.test.ts` and not `.test.tsx` while tsconfig and eslint both included
 * `.tsx`, so a component test would have linted, typechecked, and never run:
 * green, and asserting nothing. This file is the proof that the pipe is
 * connected, and it is deliberately first — P2.6 ships the play surface, and a
 * phase should not discover its test infrastructure while writing its most
 * complex screen.
 *
 * The subject is the conflict dialog because that is the flagship P1 mechanism
 * ([04 §4.4]): the refusal that keeps a hot-reloading server from silently
 * eating a hand edit. It is also where F18's focus trap will land, and this is
 * what will catch a regression when it does.
 */

function renderDialog(overrides: Partial<Parameters<typeof ConflictDialog>[0]> = {}) {
  const props = {
    onReload: vi.fn(),
    onSaveAsCopy: vi.fn(),
    onCancel: vi.fn(),
    copyPending: false,
    copyError: null,
    ...overrides,
  };
  render(<ConflictDialog {...props} />);
  return props;
}

describe('the conflict dialog', () => {
  it('renders, which is the whole point of this file existing', () => {
    renderDialog();

    // A dialog, announced as one. `alertdialog` rather than `dialog` because
    // it interrupts: the user pressed save and the save did not happen.
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveProperty('ariaModal', 'true');
    expect(dialog.textContent).toContain('changed while you were editing');
  });

  it('offers both ways out, and neither is destructive', () => {
    // Reload-and-reapply or save-as-a-copy — the two the design names. Asserted
    // as the *whole* list rather than by looking for each one, because what
    // must never appear here is an "overwrite anyway", and a test that only
    // checks for the buttons it expects would not notice one arriving.
    renderDialog();
    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels).toEqual([
      'Load the newer version and reapply my edits',
      'Save my version as a copy instead',
      'Cancel',
    ]);
  });

  it('shows a failed copy instead of swallowing it', () => {
    // F14: the escape hatch failing silently was worse than the conflict.
    renderDialog({ copyError: 'The server refused the copy.' });

    expect(screen.getByRole('alert').textContent).toBe('The server refused the copy.');
  });

  it('disables the copy button while a copy is in flight', () => {
    renderDialog({ copyPending: true });

    const copy = screen.getByRole('button', { name: 'Save my version as a copy instead' });
    expect(copy).toHaveProperty('disabled', true);
  });
});
