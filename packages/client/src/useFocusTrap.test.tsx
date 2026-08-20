// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useFocusTrap } from './useFocusTrap.js';

/**
 * The focus trap's **lifecycle**, which its behaviour tests do not reach.
 *
 * `ConflictDialog.test.tsx` pins what the trap does while a dialog is open —
 * Tab wraps, Escape leaves, focus returns — and those tests are what made
 * extracting this hook safe. What they cannot see, because that dialog never
 * re-renders and is never followed by another keystroke, are the two claims the
 * hook's docstring makes about *when* it reads and *when* it stops listening.
 *
 * Both were found by mutation: rewriting the opener capture and deleting the
 * listener cleanup each left the dialog's nine tests green.
 */

/**
 * A dialog that can be re-rendered and dismissed, with focus we can follow.
 *
 * The trap lives in a **child** component, mounted conditionally, because that
 * is the shape the real dialogs have — and a harness calling the hook
 * unconditionally never unmounts it, so the cleanup this file is partly about
 * would never run. The first draft did exactly that and failed both tests for
 * reasons that had nothing to do with the hook.
 */
function Dialog({ onEscape, onClose }: { onEscape: () => void; onClose: () => void }): JSX.Element {
  const [pending, setPending] = useState(false);
  const surface = useFocusTrap(onEscape);

  return (
    <div ref={surface} role="alertdialog">
      {/* `autoFocus`, exactly as the conflict dialog does it — which is what
          makes the opener capture's timing matter at all. */}
      <button
        type="button"
        autoFocus
        onClick={() => {
          setPending(!pending);
        }}
      >
        {pending ? 'Working' : 'Act'}
      </button>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

function Harness({ onEscape }: { onEscape: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open
      </button>
      {open ? (
        <Dialog
          onEscape={onEscape}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

describe('the opener', () => {
  /**
   * **Captured during the first render, not in the effect.**
   *
   * By the time effects run, `autoFocus` has already moved focus onto the
   * dialog's own first button — so a hook that read `document.activeElement`
   * later would faithfully restore focus to a button that is about to be
   * removed, and the caller lands on `<body>`. That is exactly the "where did my
   * keyboard go" a trap exists to prevent.
   *
   * The re-render is what makes this observable: a read in the component body
   * without `useState` is right the first time and wrong every time after.
   */
  it('is where focus was before the dialog, even after the dialog re-renders', async () => {
    render(<Harness onEscape={vi.fn()} />);
    const opener = screen.getByRole('button', { name: 'Open' });

    await userEvent.click(opener);
    // A re-render while the dialog holds focus — a pending state, a spinner, a
    // fetch resolving. Anything.
    await userEvent.click(screen.getByRole('button', { name: 'Act' }));
    expect(screen.getByRole('button', { name: 'Working' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(document.activeElement).toBe(opener);
  });
});

describe('the listener', () => {
  /**
   * **Removed when the dialog goes.**
   *
   * The handler is on `document`, so leaving it there means every later Escape
   * anywhere in the app calls a dismissed dialog's `onEscape` — a callback whose
   * component is gone and whose state has moved on. It fails quietly, which is
   * why nothing noticed.
   */
  it('stops answering Escape once the dialog is closed', async () => {
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.keyboard('{Escape}');

    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
