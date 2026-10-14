// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sheet } from './classes.js';
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

/**
 * ***On a phone, a sheet*** (2026-10-13,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.8) —
 * `sheet` in `classes.ts`. **The stylesheet's, so this reads classes**: jsdom
 * applies no stylesheet and answers no media query, so what can be held here
 * is that both placements carry the phone's arm, and — the other half of the
 * decision — that nothing about the panel moves when the viewport is a
 * phone's: no script asks, so a `matchMedia` that says *phone* draws the same
 * element in the same place as one that says *desk*, which is what keeps the
 * keyboard, Escape and the four closes the desk's. Where the sheet lands, and
 * how it sits under a phone's keyboard, are T4's.
 */
describe('the popover on a phone', () => {
  const has = (element: Element, recipe: string): boolean => {
    const classes = (element.getAttribute('class') ?? '').split(/\s+/);
    return recipe.split(' ').every((token) => classes.includes(token));
  };

  function renderBoth() {
    return render(
      <div>
        <p>
          <Popover trigger="Vera" triggerClassName="" label="Who Vera is">
            <a href="#vera">Open Vera</a>
          </Popover>
        </p>
        <div className="relative">
          <Popover trigger="Place" triggerClassName="" label="The place" place="under">
            <a href="#place">Change the place</a>
          </Popover>
        </div>
      </div>,
    );
  }

  /** A viewport that answers every query as a phone does, or as a desk does. */
  function viewport(phone: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: phone,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('is a sheet in both its places', async () => {
    renderBoth();

    await userEvent.click(screen.getByRole('button', { name: 'Vera' }));
    expect(has(screen.getByRole('dialog', { name: 'Who Vera is' }), sheet)).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Place' }));
    expect(has(screen.getByRole('dialog', { name: 'The place' }), sheet)).toBe(true);
  });

  it('draws the same panel in the same place, whatever the viewport says', async () => {
    const drawn = async (phone: boolean): Promise<string[]> => {
      viewport(phone);
      const { container, unmount } = renderBoth();
      await userEvent.click(screen.getByRole('button', { name: 'Vera' }));
      const beside = container.innerHTML;
      await userEvent.click(screen.getByRole('button', { name: 'Place' }));
      const under = container.innerHTML;
      // The panel follows its trigger in the document, as Tab needs it to.
      expect(screen.getByRole('button', { name: 'Place' }).nextElementSibling).toBe(
        screen.getByRole('dialog', { name: 'The place' }),
      );
      unmount();
      return [beside, under];
    };
    // React's ids come from a counter, so two renders differ in their ids and
    // in nothing else that matters here.
    const ids = (html: string): string => html.replace(/_r_[\w]+_|:r[\w]+:/g, 'id');
    expect((await drawn(true)).map(ids)).toEqual((await drawn(false)).map(ids));
  });
});
