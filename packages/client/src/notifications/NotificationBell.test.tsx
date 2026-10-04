// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { NotificationsState } from './useNotifications.js';

/**
 * The router mocked wholesale, `ComparePage.test.tsx`-style, with the click
 * passed through: following a row is what reads it and closes the list.
 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    onClick,
  }: {
    children: React.ReactNode;
    to?: string;
    params?: Record<string, string>;
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  }) => {
    let href = to ?? '#';
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value);
    }
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          onClick?.(event);
        }}
      >
        {children}
      </a>
    );
  },
}));

const { formatEpochMs } = await import('../format.js');
const { NotificationBell } = await import('./NotificationBell.js');

/**
 * ***The list's dates, in the account's format*** (2026-09-28). The bell was
 * handed no locale and wrote each notification's date in the browser's format,
 * whatever the account's *Language and formats* said — the one surface every
 * page carries.
 */

const UPDATED = Date.UTC(2026, 8, 3, 14, 5);

function state(): NotificationsState {
  return {
    list: {
      notifications: [
        {
          id: 'n-1',
          class: 'turn.complete',
          actionable: false,
          params: { sessionName: 'The harbour' },
          sessionId: 's-1',
          turnId: 't-1',
          folded: 1,
          createdAt: UPDATED,
          updatedAt: UPDATED,
          readAt: null,
        },
      ],
      unread: 1,
    },
    connected: true,
    toast: null,
    dismissToast: vi.fn(),
    markRead: vi.fn(),
    muted: false,
    setMuted: vi.fn(),
  };
}

describe('the notification list', () => {
  it('dates each row in the account’s format', async () => {
    render(<NotificationBell state={state()} locale="de-DE" />);

    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));

    const german = formatEpochMs(UPDATED, 'de-DE');
    expect(german).not.toBe(formatEpochMs(UPDATED, 'en-US'));
    expect(await screen.findByText(german)).toBeTruthy();
  });
});

/**
 * ***A row goes where it is about*** (2026-10-01). Three of the four classes
 * name a session, and the list said which in words with no way to get there.
 */
describe('a notification about a session', () => {
  it('links to that session, and following it reads the row and closes the list', async () => {
    const given = state();
    render(<NotificationBell state={given} locale="en-GB" />);
    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));

    const row = await screen.findByRole('link');
    expect(row.getAttribute('href')).toBe('/play/s-1');

    await userEvent.click(row);
    expect(given.markRead).toHaveBeenCalledWith(['n-1']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has nothing to link when the notice is about the install', async () => {
    const given = state();
    const [first] = given.list.notifications;
    if (first === undefined) throw new Error('the fixture has a row');
    given.list.notifications = [
      { ...first, class: 'system.notice', params: {}, sessionId: null, turnId: null },
    ];
    render(<NotificationBell state={given} locale="en-GB" />);
    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));

    await screen.findByRole('dialog');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
