// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';

import { useToggleChord } from './useToggleChord.js';

/**
 * The chord hook, alone — [P3.1](../../../../docs/design/workplan/05-p3-implementation.md).
 *
 * The gate's step 1 claims live here at the mechanism level: the chord fires,
 * typing does not fire it, and an unmounted hook stops answering — the last
 * one on the `useFocusTrap.test.tsx` template, because a document listener
 * that outlives its surface is the classic leak shape.
 *
 * `[Backquote]` is user-event's *code* syntax, which matters: the hook matches
 * `event.code`, so a test that sent `` ` `` as a key value would pass against
 * an implementation that matched the character and broke on dead-key layouts.
 *
 * Falsifying mutations, one per test: match `'KeyQ'` instead of
 * `'Backquote'`; delete the editable guard; delete the cleanup return.
 */

function Harness({ onToggle }: { onToggle: () => void }): JSX.Element {
  useToggleChord(onToggle);
  return (
    <div>
      <label>
        Action
        <input />
      </label>
      <label>
        Guidance
        <textarea />
      </label>
      {/* `tabIndex` so jsdom will programmatically focus it — a browser treats
          an editable region as focusable on its own; jsdom does not. */}
      <div contentEditable tabIndex={-1} data-testid="editable" />
    </div>
  );
}

describe('the workbench toggle chord', () => {
  it('answers Ctrl+` and only Ctrl+`', async () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);

    await userEvent.keyboard('{Control>}[Backquote]{/Control}');
    expect(onToggle).toHaveBeenCalledTimes(1);

    // A bare backquote is a character somebody typed; a shifted chord is a
    // different chord. Neither is the toggle.
    await userEvent.keyboard('[Backquote]');
    await userEvent.keyboard('{Control>}{Shift>}[Backquote]{/Shift}{/Control}');
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('stays quiet while an editable element has focus', async () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);

    for (const editable of [
      screen.getByLabelText('Action'),
      screen.getByLabelText('Guidance'),
      screen.getByTestId('editable'),
    ]) {
      editable.focus();
      expect(document.activeElement).toBe(editable);
      await userEvent.keyboard('{Control>}[Backquote]{/Control}');
    }
    expect(onToggle).not.toHaveBeenCalled();

    // And the guard is a guard, not a dead listener: focus something
    // non-editable and the same chord lands.
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('{Control>}[Backquote]{/Control}');
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('stops answering once unmounted', async () => {
    const onToggle = vi.fn();
    const { unmount } = render(<Harness onToggle={onToggle} />);

    await userEvent.keyboard('{Control>}[Backquote]{/Control}');
    expect(onToggle).toHaveBeenCalledTimes(1);

    unmount();
    await userEvent.keyboard('{Control>}[Backquote]{/Control}');
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
