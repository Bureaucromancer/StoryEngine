// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TagEntry } from '@storyengine/shared';
import { useState, type JSX } from 'react';
import { describe, expect, it } from 'vitest';

import {
  passesTagFilters,
  TagFilterBar,
  type TagFilters,
  type TagFilterState,
} from './TagFilterBar.js';

/**
 * The library's tag filter — [05 §5](../../../../docs/design/05-tagging.md).
 *
 * Two subjects. The **cycle**, because a three-state control has no attribute
 * to carry its state and therefore nothing but its accessible name to be tested
 * through; and the **combination rule**, which is the part somebody would
 * simplify into an AND without noticing that *anything but the drafts* stops
 * working.
 */

function entry(over: Partial<TagEntry> = {}): TagEntry {
  return {
    id: 'tag-1',
    name: 'noir',
    swatch: null,
    sortOrder: 0,
    folder: 'none',
    hidden: false,
    createdAt: '2026-09-08T00:00:00Z',
    ...over,
  };
}

function Host(props: { names: string[]; registry?: TagEntry[] }): JSX.Element {
  const [filters, setFilters] = useState<TagFilters>(new Map());
  return (
    <TagFilterBar
      names={props.names}
      registry={props.registry ? { tags: props.registry } : undefined}
      filters={filters}
      onChange={setFilters}
    />
  );
}

function chipNames(): (string | null)[] {
  return screen.getAllByRole('button').map((node) => node.getAttribute('aria-label'));
}

describe('the cycle', () => {
  it('starts unfiltered and goes to showing only, then hidden, then back', async () => {
    render(<Host names={['noir']} />);

    expect(screen.getByRole('button', { name: 'noir, not filtered' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'noir, not filtered' }));
    expect(screen.getByRole('button', { name: 'noir, showing only these' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'noir, showing only these' }));
    expect(screen.getByRole('button', { name: 'noir, hidden' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'noir, hidden' }));
    expect(screen.getByRole('button', { name: 'noir, not filtered' })).toBeTruthy();
  });

  /**
   * `aria-pressed` is two-state and this control is three, so a toggle button
   * would have to lie about one of them. The state is a word in the name.
   */
  it('does not claim to be a two-state toggle', async () => {
    render(<Host names={['noir']} />);
    await userEvent.click(screen.getByRole('button', { name: 'noir, not filtered' }));

    expect(
      screen.getByRole('button', { name: 'noir, showing only these' }).hasAttribute('aria-pressed'),
    ).toBe(false);
  });

  it('offers a way out once anything is filtered', async () => {
    render(<Host names={['noir']} />);
    expect(screen.queryByRole('button', { name: 'Clear tags' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'noir, not filtered' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear tags' }));

    expect(screen.getByRole('button', { name: 'noir, not filtered' })).toBeTruthy();
  });

  it('draws nothing at all when the shelf carries no tags', () => {
    const { container } = render(<Host names={[]} />);

    expect(container.textContent).toBe('');
  });
});

describe('the order of the chips', () => {
  /**
   * A tag that has been given a place keeps it; one nobody has arranged still
   * appears, because it filters exactly as well ([05 §2] invariant 1) and a bar
   * that hid it would lie about what the shelf holds.
   */
  it('puts arranged tags first and the rest alphabetically after', () => {
    render(
      <Host
        names={['zeta', 'alpha', 'noir', 'city']}
        registry={[
          entry({ id: 'a', name: 'noir', sortOrder: 0 }),
          entry({ id: 'b', name: 'city', sortOrder: 1 }),
        ]}
      />,
    );

    expect(chipNames()).toEqual([
      'noir, not filtered',
      'city, not filtered',
      'alpha, not filtered',
      'zeta, not filtered',
    ]);
  });

  it('is alphabetical when nothing has been arranged', () => {
    render(<Host names={['zeta', 'alpha']} />);

    expect(chipNames()).toEqual(['alpha, not filtered', 'zeta, not filtered']);
  });
});

/**
 * **Selected are ORed, excluded reject.** The reading `activate.ts` already
 * argues for its own `include`: a filter listing three tags means *anything
 * with one of these*, because that is what somebody writing a list expects. An
 * exclusion is not a preference to be outvoted by a match.
 */
describe('what passes the filter', () => {
  function filters(...pairs: [string, TagFilterState][]): TagFilters {
    return new Map(pairs);
  }

  it('passes everything when nothing is filtered', () => {
    expect(passesTagFilters(['noir'], new Map())).toBe(true);
    expect(passesTagFilters([], new Map())).toBe(true);
  });

  it('passes an object carrying any one of the selected tags', () => {
    const chosen = filters(['noir', 'selected'], ['city', 'selected']);

    expect(passesTagFilters(['city'], chosen)).toBe(true);
    expect(passesTagFilters(['noir', 'ronin'], chosen)).toBe(true);
    expect(passesTagFilters(['ronin'], chosen)).toBe(false);
  });

  it('rejects an excluded tag even when something else matched', () => {
    const chosen = filters(['noir', 'selected'], ['wip', 'excluded']);

    expect(passesTagFilters(['noir'], chosen)).toBe(true);
    expect(passesTagFilters(['noir', 'wip'], chosen)).toBe(false);
  });

  it('lets an exclusion stand alone, which is the half a two-state bar cannot do', () => {
    const chosen = filters(['wip', 'excluded']);

    expect(passesTagFilters(['noir'], chosen)).toBe(true);
    expect(passesTagFilters([], chosen)).toBe(true);
    expect(passesTagFilters(['wip'], chosen)).toBe(false);
  });

  it('compares case-insensitively, the way every other tag comparison does', () => {
    expect(passesTagFilters(['Noir'], filters(['noir', 'selected']))).toBe(true);
    expect(passesTagFilters(['NOIR'], filters(['noir', 'excluded']))).toBe(false);
  });
});
