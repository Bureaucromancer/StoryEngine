// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The settings page's contents, as the workbench lists them — 2026-10-07.
 *
 * `SettingsPage.test.tsx` holds the page's anchors to `settingsContents`; this
 * file holds the panel to it — which rows, in what order, for whom — and the
 * two things the panel adds: which row is marked, and that a row lands on its
 * section. *Which route draws this panel* is `dock.test.tsx`'s question,
 * asked through the real router.
 *
 * `Link` is a plain anchor here, as `home/subject.test.tsx` makes it, carrying
 * the hash, the mark and the click — the parts this file asserts on.
 */

const location = vi.hoisted(() => ({ hash: '' }));

vi.mock('@tanstack/react-router', () => ({
  useLocation: (options?: { select?: (value: { hash: string }) => unknown }) =>
    options?.select === undefined ? location : options.select(location),
  Link: ({
    children,
    to,
    hash,
    onClick,
    'aria-current': current,
  }: {
    children: ReactNode;
    to?: string;
    hash?: string;
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
    'aria-current'?: 'page';
  }) => (
    <a
      href={`${to ?? ''}#${hash ?? ''}`}
      aria-current={current}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

const auth = vi.hoisted(() => ({
  account: null as null | {
    role: 'admin' | 'user';
    capabilities: { privateConnections: boolean };
  },
}));

vi.mock('../../queries.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries.js')>()),
  useAuthState: () => ({ data: { account: auth.account } }),
}));

const { SettingsSubject } = await import('./SettingsSubject.js');
const { SECTIONS, settingsContents } = await import('../../settings/contents.js');

function rowNames(): string[] {
  return within(screen.getByRole('navigation', { name: 'Settings contents' }))
    .getAllByRole('link')
    .map((row) => row.textContent);
}

beforeEach(() => {
  location.hash = '';
  auth.account = { role: 'user', capabilities: { privateConnections: false } };
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the contents', () => {
  it('lists the sections the page draws for this account, in its order', () => {
    render(<SettingsSubject onClose={() => undefined} />);

    expect(rowNames()).toEqual(settingsContents(auth.account).yours.map((entry) => entry.title));
    expect(rowNames()).not.toContain('Your connections');
    expect(rowNames()).not.toContain('Administration');
  });

  it('lists your connections only for an account that may have them', () => {
    auth.account = { role: 'user', capabilities: { privateConnections: true } };
    render(<SettingsSubject onClose={() => undefined} />);

    expect(rowNames()).toContain('Your connections');
  });

  /**
   * **Absent, as the page draws it**, and nested under its own row for an
   * administrator — the page's two halves, kept as two in the list.
   */
  it('lists the administration half for an administrator, under its own row', () => {
    auth.account = { role: 'admin', capabilities: { privateConnections: true } };
    render(<SettingsSubject onClose={() => undefined} />);

    const administration = screen.getByRole('link', { name: 'Administration' });
    const nested = within(administration.closest('li') as HTMLElement).getAllByRole('link');
    expect(nested.map((row) => row.textContent)).toEqual([
      'Administration',
      'Accounts',
      'Connections',
      'This install',
      'Backups',
    ]);
  });

  it('points each row at its section by the address', () => {
    render(<SettingsSubject onClose={() => undefined} />);

    expect(screen.getByRole('link', { name: 'Trash' }).getAttribute('href')).toBe(
      `/settings#${SECTIONS.trash.anchor}`,
    );
  });
});

describe('which row is marked', () => {
  it('marks none when the address names no section', () => {
    render(<SettingsSubject onClose={() => undefined} />);

    const nav = screen.getByRole('navigation', { name: 'Settings contents' });
    expect(nav.querySelectorAll('[aria-current]')).toHaveLength(0);
  });

  /**
   * **One mark, and the one the address names** — `ReleaseSubject`'s
   * regression, asserted the same way: every row's address is `/settings`, so
   * a mark that went by path alone would light all of them.
   */
  it('marks the section the address names, and only that one', () => {
    location.hash = SECTIONS.backups.anchor;
    render(<SettingsSubject onClose={() => undefined} />);

    const nav = screen.getByRole('navigation', { name: 'Settings contents' });
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Backups' }).getAttribute('aria-current')).toBe('page');
  });
});

describe('a row', () => {
  /**
   * **Lands even when the address already names it** — the press the page's
   * hash effect never hears, because no address changed. The section is a
   * stand-in drawn into the document the way the page draws it.
   */
  it('moves the page to its section and hands it focus', () => {
    location.hash = SECTIONS.trash.anchor;
    const section = document.createElement('div');
    section.id = SECTIONS.trash.anchor;
    section.dataset['settingsAnchor'] = 'trash';
    section.tabIndex = -1;
    document.body.append(section);
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<SettingsSubject onClose={() => undefined} />);

    fireEvent.click(screen.getByRole('link', { name: 'Trash' }));

    expect(document.activeElement).toBe(section);
    expect(scrolled.mock.contexts).toContain(section);
  });

  it('leaves the page alone for a press that opens a new tab', () => {
    const section = document.createElement('div');
    section.id = SECTIONS.trash.anchor;
    section.dataset['settingsAnchor'] = 'trash';
    section.tabIndex = -1;
    document.body.append(section);
    render(<SettingsSubject onClose={() => undefined} />);

    fireEvent.click(screen.getByRole('link', { name: 'Trash' }), { ctrlKey: true });

    expect(document.activeElement).not.toBe(section);
  });
});

/**
 * ***On a phone the dock is the view*** and the shell hides the page beneath
 * it, so a jump there would scroll and focus nothing. Choosing a section
 * closes the dock and lands once the page is drawn again. The page here is a
 * stand-in `main` hidden the way the shell's breakpoint hides it, and the
 * dock's close shows it again a tick later, as the preference's optimistic
 * write does.
 */
describe('a row, on a phone', () => {
  it('closes the dock, then lands on its section once the page is drawn', async () => {
    const main = document.createElement('main');
    main.id = 'main';
    main.style.display = 'none';
    const section = document.createElement('div');
    section.id = SECTIONS.trash.anchor;
    section.dataset['settingsAnchor'] = 'trash';
    section.tabIndex = -1;
    main.append(section);
    document.body.append(main);
    const onClose = vi.fn(() => {
      setTimeout(() => {
        main.style.display = '';
      }, 0);
    });
    render(<SettingsSubject onClose={onClose} />);

    fireEvent.click(screen.getByRole('link', { name: 'Trash' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(section);
    await waitFor(() => {
      expect(document.activeElement).toBe(section);
    });
  });

  it('leaves the dock open where the page is beside it', () => {
    const onClose = vi.fn();
    render(<SettingsSubject onClose={onClose} />);

    fireEvent.click(screen.getByRole('link', { name: 'Trash' }));

    expect(onClose).not.toHaveBeenCalled();
  });
});
