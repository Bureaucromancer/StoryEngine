// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { formatEpochMs } from '../format.js';
import { NotificationBell } from './NotificationBell.js';
import type { NotificationsState } from './useNotifications.js';

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
