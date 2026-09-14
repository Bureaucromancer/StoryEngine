// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SelectorBar, selectionHref, toggleSelection } from './SelectorBar.js';

/**
 * The one selector bar the Library's kinds and Play's modes share.
 *
 * **The contract is the interaction, not the look**: a plain click switches,
 * Ctrl/⌘-click adds or removes, and the *Select several* toggle makes a plain
 * click add or remove for anybody without a Ctrl key. Two surfaces answering
 * one gesture differently is the thing the component exists to prevent, so
 * each gesture is pinned here once rather than per page.
 */

const ALL = ['a', 'b', 'c'] as const;
type Letter = (typeof ALL)[number];
const OPTIONS = ALL.map((value) => ({ value, label: value.toUpperCase() }));

const onChange = vi.fn();

beforeEach(() => {
  onChange.mockReset();
});

function renderBar(selected: readonly Letter[], options = OPTIONS): void {
  render(
    <SelectorBar
      label="Filter by letter"
      allLabel="All letters"
      options={options}
      selected={selected}
      hrefFor={(next) => selectionHref('/letters', 'letter', next)}
      onChange={onChange}
    />,
  );
}

function chip(name: string): HTMLElement {
  return screen.getByRole('link', { name });
}

describe('toggleSelection', () => {
  it('adds and removes, in the order of the options rather than of clicking', () => {
    expect(toggleSelection<Letter>(['c'], 'a', ALL)).toEqual(['a', 'c']);
    expect(toggleSelection<Letter>(['a', 'c'], 'c', ALL)).toEqual(['a']);
  });

  it('collapses to All when the last one is removed', () => {
    expect(toggleSelection<Letter>(['b'], 'b', ALL)).toEqual([]);
  });

  /** Otherwise the unfiltered view would have two addresses. */
  it('collapses to All when every one is selected', () => {
    expect(toggleSelection<Letter>(['a', 'b'], 'c', ALL)).toEqual([]);
  });
});

describe('selectionHref', () => {
  it('is the bare path for All, and a comma list otherwise', () => {
    expect(selectionHref('/library', 'kind', [])).toBe('/library');
    expect(selectionHref('/library', 'kind', ['actors'])).toBe('/library?kind=actors');
    expect(selectionHref('/library', 'kind', ['actors', 'lorebooks'])).toBe(
      '/library?kind=actors%2Clorebooks',
    );
  });
});

describe('a plain click', () => {
  it('switches to that option alone, even from a multi-selection', () => {
    renderBar(['a', 'b']);
    // The toggle starts on for a multi-selection, so turn it off to test the
    // plain gesture itself.
    fireEvent.click(screen.getByRole('button', { name: 'Select several' }));
    fireEvent.click(chip('C'));
    expect(onChange).toHaveBeenLastCalledWith(['c']);
  });

  it('on All clears the selection', () => {
    renderBar(['b']);
    fireEvent.click(chip('All letters'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('is kept from following the href, because the page navigates', () => {
    renderBar([]);
    const event = createEvent.click(chip('A'), { button: 0 });
    fireEvent(chip('A'), event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('Ctrl-click and ⌘-click', () => {
  it('add to the selection', () => {
    renderBar(['a']);
    fireEvent.click(chip('B'), { ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
  });

  /**
   * From a *single* selection, deliberately: several selected starts the toggle
   * on, and then a plain click toggles too — so a test starting from two would
   * pass with the ⌘ branch deleted, which is how this one was first written.
   */
  it('treat ⌘ the same as Ctrl', () => {
    renderBar(['a']);
    fireEvent.click(chip('B'), { metaKey: true });
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
  });

  it('remove from the selection, back to All when it was the last', () => {
    renderBar(['a']);
    fireEvent.click(chip('A'), { ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  /** The chips give up Ctrl-click, not every modifier: shift still opens a window. */
  it('leaves shift-click to the browser', () => {
    renderBar([]);
    // Read on the way out, then cancelled, so jsdom is not asked to perform a
    // navigation it does not implement.
    let leftToBrowser = false;
    const observe = (event: Event): void => {
      leftToBrowser = !event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener('click', observe);
    fireEvent.click(chip('A'), { button: 0, shiftKey: true });
    document.removeEventListener('click', observe);

    expect(leftToBrowser).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keep an href on every chip, so middle-click still opens the view in a tab', () => {
    renderBar([]);
    expect(chip('B').getAttribute('href')).toBe('/letters?letter=b');
    expect(chip('All letters').getAttribute('href')).toBe('/letters');
  });
});

describe('the Select several toggle', () => {
  it('makes a plain click add and remove while it is on', () => {
    renderBar(['a']);
    const toggle = screen.getByRole('button', { name: 'Select several' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(chip('B'));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
  });

  /** A person landing on a multi-selection should see the mode that made it. */
  it('starts on when the address already holds several', () => {
    renderBar(['a', 'c']);
    expect(
      screen.getByRole('button', { name: 'Select several' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('what it announces', () => {
  it('marks a single option as the page, and several as items of it', () => {
    renderBar(['b']);
    expect(chip('B').getAttribute('aria-current')).toBe('page');
    expect(chip('All letters').getAttribute('aria-current')).toBeNull();
  });

  it('marks each of several as a current item rather than the page', () => {
    renderBar(['a', 'b']);
    expect(chip('A').getAttribute('aria-current')).toBe('true');
    expect(chip('B').getAttribute('aria-current')).toBe('true');
    expect(chip('C').getAttribute('aria-current')).toBeNull();
  });

  it('marks All as the page when nothing is selected', () => {
    renderBar([]);
    expect(chip('All letters').getAttribute('aria-current')).toBe('page');
  });
});

/** `InputKind`'s rule: a bar with one option cannot do anything. */
it('renders nothing with fewer than two options', () => {
  renderBar([], OPTIONS.slice(0, 1));
  expect(screen.queryByRole('navigation')).toBeNull();
});
