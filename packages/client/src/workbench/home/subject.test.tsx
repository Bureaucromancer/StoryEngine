// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The release index over the real changelog — [home, revised].
 *
 * `workbench/library/subject.test.tsx`'s harness: the router is mocked
 * wholesale and the stub flattens `to` + `search` into an `href`, because the
 * claim under test is precisely which address each row carries — `/` for the
 * newest and `/?release=…` for the rest.
 *
 * **The real `CHANGELOG.md`, through the same `?raw` import the page uses.**
 * The parse itself is `changelog.test.ts`'s subject; what this file is about is
 * that the panel and the page read *one* document, and a fixture would assert
 * that over a document neither of them ever sees.
 */

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    'aria-current': current,
  }: {
    children: React.ReactNode;
    to?: string;
    search?: Record<string, string>;
    'aria-current'?: 'page';
  }) => {
    const query = new URLSearchParams(search ?? {}).toString();
    return (
      <a href={query === '' ? (to ?? '#') : `${to ?? '#'}?${query}`} aria-current={current}>
        {children}
      </a>
    );
  },
}));

const build = vi.hoisted(() => ({ current: null as { version: string; commit: string } | null }));

vi.mock('../../queries.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries.js')>()),
  useAuthState: () => ({ data: { account: null, build: build.current } }),
}));

const { ReleaseSubject } = await import('./ReleaseSubject.js');
const { CHANGELOG, NEWEST } = await import('../../home/log.js');

function rows(): HTMLElement[] {
  const table = screen.getByRole('table');
  return within(table).getAllByRole('row').slice(1);
}

describe('the release index', () => {
  it('lists every release the build carries, newest first', () => {
    render(<ReleaseSubject selected={undefined} />);

    const listed = rows().map((row) => within(row).getByRole('link').textContent);

    expect(listed).toEqual(CHANGELOG.releases.map((release) => release.name));
    expect(listed[0]).toBe(NEWEST?.name);
    expect(listed.length).toBeGreaterThanOrEqual(4);
  });

  /**
   * The newest keeps the default address. `TurnPicker`'s blank option is the
   * precedent: the default is a live answer rather than an absence, so it does
   * not need a query string to say so, and `/` stays the address home is
   * bookmarked at.
   */
  it('links the newest at `/` and every older one at `?release=`', () => {
    render(<ReleaseSubject selected={undefined} />);

    const [newest, ...older] = rows().map((row) => within(row).getByRole('link'));

    expect(newest?.getAttribute('href')).toBe('/');
    for (const row of older) {
      expect(row.getAttribute('href')).toMatch(/^\/\?release=/);
    }
    expect(older[0]?.getAttribute('href')).toBe(
      `/?release=${encodeURIComponent(CHANGELOG.releases[1]?.version ?? '')}`,
    );
  });

  /**
   * **The likeliest silent bug in this panel.** Every row's `to` is `/`, so a
   * router's own active detection would mark all four current: the search param
   * is what tells them apart and is not part of that comparison. Uniqueness is
   * the assertion, not merely that the right one is marked.
   */
  it('marks exactly one row current, and it is the newest by default', () => {
    render(<ReleaseSubject selected={undefined} />);

    const marked = rows().filter(
      (row) => within(row).getByRole('link').getAttribute('aria-current') === 'page',
    );

    expect(marked).toHaveLength(1);
    expect(within(marked[0]!).getByRole('link').textContent).toBe(NEWEST?.name);
  });

  it('moves the mark to whichever release the address names', () => {
    const older = CHANGELOG.releases[2];
    render(<ReleaseSubject selected={older?.version} />);

    const marked = rows().filter(
      (row) => within(row).getByRole('link').getAttribute('aria-current') === 'page',
    );

    expect(marked).toHaveLength(1);
    expect(within(marked[0]!).getByRole('link').textContent).toBe(older?.name);
  });

  /**
   * The same fallback the page makes, through the same function — which is the
   * concrete reason `findRelease` lives in `shared`. A panel whose marked row
   * disagreed with the release rendered beside it is what this forecloses.
   */
  it('falls back to the newest when the address names a release it does not have', () => {
    render(<ReleaseSubject selected="9.9.9" />);

    const marked = rows().filter(
      (row) => within(row).getByRole('link').getAttribute('aria-current') === 'page',
    );

    expect(marked).toHaveLength(1);
    expect(within(marked[0]!).getByRole('link').textContent).toBe(NEWEST?.name);
  });

  /**
   * The mark has to be perceivable, not only announced — `aria-current` alone
   * is a marker half the people using this panel cannot see. Asserted as a
   * class because that is the whole of the decision: nothing else in the suite
   * would go red if the fill were dropped, and `tailwind-utilities.test.ts`
   * separately proves the name emits a rule.
   */
  it('fills the current row, so the mark is visible and not only announced', () => {
    render(<ReleaseSubject selected={CHANGELOG.releases[2]?.version} />);

    const filled = rows().filter((row) => row.className.includes('bg-surface-muted'));

    expect(filled).toHaveLength(1);
    expect(within(filled[0]!).getByRole('link').getAttribute('aria-current')).toBe('page');
  });

  it('renders each release’s date as a date rather than as its heading field', () => {
    render(<ReleaseSubject selected={undefined} />);

    const cells = rows().map((row) => within(row).getAllByRole('cell')[1]?.textContent ?? '');

    for (const cell of cells) {
      expect(cell).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(cell).not.toBe('');
    }
  });
});

describe('which release this build is', () => {
  it('badges nothing at all on a development build', () => {
    build.current = null;
    render(<ReleaseSubject selected={undefined} />);

    expect(screen.queryByText('This build')).toBeNull();
  });

  it('badges the row whose version the build reports', () => {
    const older = CHANGELOG.releases[1];
    build.current = { version: older?.version ?? '', commit: 'abc1234' };
    render(<ReleaseSubject selected={undefined} />);

    const badged = rows().filter((row) => within(row).queryByText('This build') !== null);

    expect(badged).toHaveLength(1);
    expect(within(badged[0]!).getByRole('link').textContent).toBe(older?.name);
  });

  it('badges nothing when the build names a release this changelog lacks', () => {
    build.current = { version: '9.9.9', commit: 'abc1234' };
    render(<ReleaseSubject selected={undefined} />);

    expect(screen.queryByText('This build')).toBeNull();
  });
});
