// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Popover } from './Popover.js';

/**
 * The non-modal popover — [P12A](../../../../docs/design/workplan/35-p12a-the-look.md)
 * P12A.3, built for a mention's card and kept for P12A.4's HUD.
 *
 * ***What makes it not a `Dialog` is what is held***: it closes four ways, it
 * gives the keyboard back to its trigger on Escape and leaves it where a press
 * put it otherwise, it traps nothing, and its Escape is its own. *(The fourth,
 * focus leaving it, since 2026-10-14, after review: it was three, and a card
 * the keyboard had Tabbed out of stayed drawn and deaf to Escape.)*
 */

function renderPopover(onOuterEscape = vi.fn()) {
  render(
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape') onOuterEscape();
      }}
    >
      <p>
        <span>Rain on the glass, and </span>
        <Popover trigger="Vera" triggerClassName="" label="Who “Vera” is">
          <a href="/library/actors/actor-vera/edit">Open Vera</a>
          <a href="/library/actors/actor-vera/edit#aliases">Edit Vera’s aliases</a>
        </Popover>
        <span> at the door.</span>
      </p>
      <button type="button">After the story</button>
    </div>,
  );
  return { trigger: screen.getByRole('button', { name: 'Vera' }), onOuterEscape };
}

describe('the popover', () => {
  it('opens from its trigger, named, and hands the keyboard to what is inside', async () => {
    const { trigger } = renderPopover();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(trigger);

    const panel = screen.getByRole('dialog', { name: 'Who “Vera” is' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
    // Not a modal: nothing behind it is declared inert.
    expect(panel.getAttribute('aria-modal')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Open Vera' }));
  });

  it('closes on Escape and gives the keyboard back to its trigger', async () => {
    const { trigger, onOuterEscape } = renderPopover();
    await userEvent.click(trigger);

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    // Its Escape is its own: a workbench round it stays open.
    expect(onOuterEscape).not.toHaveBeenCalled();
  });

  /**
   * ***A press outside closes it and leaves focus where the press put it*** —
   * on the control pressed, here — rather than pulling it back to the trigger
   * and undoing the click.
   */
  it('closes on a press outside, and leaves the keyboard where the press put it', async () => {
    const { trigger } = renderPopover();
    await userEvent.click(trigger);

    const after = screen.getByRole('button', { name: 'After the story' });
    await userEvent.click(after);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(after);
  });

  it('stays open for a press inside it, and closes on its trigger again', async () => {
    const { trigger } = renderPopover();
    await userEvent.click(trigger);

    fireEvent.pointerDown(screen.getByRole('link', { name: 'Edit Vera’s aliases' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    // A press on the card's own text puts focus on the panel, which is inside:
    // focus moving within it is not focus leaving it (2026-10-14, after review).
    await userEvent.click(screen.getByRole('dialog'));
    expect(document.activeElement).toBe(screen.getByRole('dialog'));

    await userEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /**
   * ***Focus going nowhere is not focus leaving it*** (2026-10-14, after
   * review). The window losing focus — another application brought forward —
   * blurs what is focused with no element to go to, as Safari's press on a
   * button that takes no focus does. Neither is a press outside, and a card
   * that closed on them would be gone when the reader came back, or would close
   * under the trigger's own press and open again on its click.
   */
  it('stays open when focus goes to no element at all', async () => {
    const { trigger } = renderPopover();
    await userEvent.click(trigger);

    fireEvent.focusOut(screen.getByRole('link', { name: 'Open Vera' }), { relatedTarget: null });

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  /**
   * ***Traps nothing***: Tab leaves it, in reading order, as from any part of
   * the page. ***And leaving it closes it*** (2026-10-14, after review): Tab
   * past the last link is the keyboard's press outside, so the card does not
   * stay drawn over the control focus went to, nor wait for an Escape that can
   * no longer reach it. Moving inside — trigger to link, link to link — keeps
   * it open, which the first Tab holds.
   */
  it('lets Tab leave it in reading order, and closes as it goes', async () => {
    const { trigger } = renderPopover();
    await userEvent.click(trigger);

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Edit Vera’s aliases' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await userEvent.tab();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After the story' }));
  });
});
