// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***The line a session started without something carries*** — 2026-10-13.
 * `session.startedWithout` is written once, when a start was refused
 * `unmet-requirements` and the person chose **Start anyway**; the session's
 * page says it in ChannelHealth's register — a warning, a status, and the
 * reassurance that it plays without them — and each item as what it lacked.
 */

const readSession = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return { ...actual, readSession: (...a: unknown[]) => readSession(...a) as unknown };
});

const { StartedWithout } = await import('./StartedWithout.js');

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

function renderLine(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <StartedWithout sessionId={SESSION_ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('what a session started without', () => {
  it('says each thing it lacked, and that it plays without them', async () => {
    readSession.mockResolvedValue({
      session: {
        id: SESSION_ID,
        name: 'A wet week',
        startedWithout: {
          at: '2026-10-13T09:00:00.000Z',
          unmet: [
            { kind: 'mode', id: 'storyengine.campaign', installed: null, substituted: true },
            { kind: 'mode', id: 'storyengine.scene', minVersion: '2.0.0', installed: '1.0.0' },
            { kind: 'capability', id: 'image', checkable: true },
            { kind: 'capability', id: 'audio', checkable: false },
            { kind: 'extension', id: 'dice', minVersion: '0.1.0' },
          ],
        },
      },
      activeJob: null,
      health: [],
    });
    renderLine();

    const line = await screen.findByRole('status');
    expect(line.textContent).toContain('It plays without them');
    const items = [...line.querySelectorAll('li')].map((one) => one.textContent);
    expect(items).toEqual([
      'the storyengine.campaign mode — it plays in this install’s default mode',
      'the storyengine.scene mode at version 2.0.0 or later — it uses 1.0.0',
      'a model for “Making images”',
      '“audio”, which this build cannot check for',
      'the dice extension',
    ]);
  });

  it('says nothing for a session that lacked nothing', async () => {
    readSession.mockResolvedValue({
      session: { id: SESSION_ID, name: 'A wet week' },
      activeJob: null,
      health: [],
    });
    renderLine();

    // The read has answered: nothing appears, now or after.
    await vi.waitFor(() => {
      expect(readSession).toHaveBeenCalled();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
