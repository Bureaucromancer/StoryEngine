// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { InputKind } from './InputKind.js';

/**
 * ***A radio group moves on its arrows*** — polish 11 (2026-10-01),
 * `InputKind.tsx`.
 *
 * `role="radio"` told a screen reader this was a radio group, and the keyboard
 * found five separate buttons: a Tab stop each, and arrows that did nothing.
 * The claims are the pattern's: one stop for the group, the arrows choosing as
 * they move, wrapping, and Home and End.
 */

function Harness(props: { initial?: string }): React.JSX.Element {
  const [value, setValue] = useState(props.initial);
  return (
    <>
      <button type="button">Before</button>
      <InputKind kinds={['do', 'say', 'think']} value={value} onChange={setValue} />
      <textarea aria-label="Your move" />
    </>
  );
}

function radio(name: string): HTMLElement {
  return screen.getByRole('radio', { name });
}

describe('the turn-kind group', () => {
  it('is one Tab stop, the chosen kind, and Tab goes on past it', async () => {
    render(<Harness initial="say" />);
    screen.getByRole('button', { name: 'Before' }).focus();

    await userEvent.tab();
    expect(document.activeElement).toBe(radio('Say'));

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Your move' }));
  });

  it('stops on the first kind before one is chosen', async () => {
    render(<Harness />);
    screen.getByRole('button', { name: 'Before' }).focus();

    await userEvent.tab();

    expect(document.activeElement).toBe(radio('Do'));
  });

  it('moves the choice with the arrows, and wraps at the ends', async () => {
    render(<Harness initial="do" />);
    radio('Do').focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(radio('Say'));
    expect(radio('Say').getAttribute('aria-checked')).toBe('true');
    expect(radio('Do').getAttribute('aria-checked')).toBe('false');

    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(radio('Do'));

    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(radio('Think'));
    expect(radio('Think').getAttribute('aria-checked')).toBe('true');
  });

  it('goes to the ends on Home and End', async () => {
    render(<Harness initial="say" />);
    radio('Say').focus();

    await userEvent.keyboard('{End}');
    expect(radio('Think').getAttribute('aria-checked')).toBe('true');

    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(radio('Do'));
    expect(radio('Do').getAttribute('aria-checked')).toBe('true');
  });
});
