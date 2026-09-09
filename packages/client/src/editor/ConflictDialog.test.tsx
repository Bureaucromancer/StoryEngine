// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
 * ([09 §4.4]): the refusal that keeps a hot-reloading server from silently
 * eating a hand edit. It is also where F18's focus trap will land, and this is
 * what will catch a regression when it does.
 */

function propsFor(overrides: Partial<Parameters<typeof ConflictDialog>[0]> = {}) {
  return {
    onReload: vi.fn(),
    onSaveAsCopy: vi.fn(),
    onCancel: vi.fn(),
    copyPending: false,
    copyError: null,
    ...overrides,
  };
}

function renderDialog(overrides: Partial<Parameters<typeof ConflictDialog>[0]> = {}) {
  const props = propsFor(overrides);
  render(<ConflictDialog {...props} />);
  return props;
}

/** The render handle itself, for the test that needs to unmount. */
function renderDialogRaw() {
  return render(<ConflictDialog {...propsFor()} />);
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

describe('the focus trap', () => {
  // F18. `aria-modal` is a claim made to a screen reader and does nothing to
  // the Tab key, so the form underneath stayed reachable while the dialog
  // insisted the save had been refused.

  it('wraps Tab from the last control back to the first', async () => {
    renderDialog();
    const buttons = screen.getAllByRole('button');
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;

    last.focus();
    await userEvent.tab();

    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first control back to the last', async () => {
    renderDialog();
    const buttons = screen.getAllByRole('button');
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;

    first.focus();
    await userEvent.tab({ shift: true });

    expect(document.activeElement).toBe(last);
  });

  it('pulls focus back if it escapes to the page behind', async () => {
    // A click on the form underneath, or a browser that moves focus somewhere
    // unexpected. The trap has to recover, not only prevent.
    const outside = document.createElement('button');
    document.body.append(outside);
    renderDialog();

    outside.focus();
    await userEvent.tab();

    expect(document.activeElement).not.toBe(outside);
    outside.remove();
  });

  it('treats Escape as Cancel, so the dialog is not a dead end', async () => {
    const props = renderDialog();

    await userEvent.keyboard('{Escape}');

    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('returns focus to whatever opened it', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const { unmount } = renderDialogRaw();
    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
