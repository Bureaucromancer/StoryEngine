// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The HUD strip — [10 §8], [P7.1].
 *
 * **The claim under test is an absence**: this component knows no channel, and
 * the two assertions that matter are the ones a future shortcut would break —
 * that an unrecognised `kind` is skipped rather than rendered or thrown, and
 * that the labels come from the payload rather than from anything here.
 */

const readSession = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return { ...actual, readSession: (...a: unknown[]) => readSession(...a) as unknown };
});

const { ChannelHud } = await import('./ChannelHud.js');

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

function answerWith(hud: unknown[]): void {
  readSession.mockResolvedValue({
    session: { id: SESSION_ID, name: 'A wet week' },
    activeJob: null,
    health: [],
    hud,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

function renderHud() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChannelHud sessionId={SESSION_ID} />
    </QueryClientProvider>,
  );
}

describe('the channel HUD', () => {
  it('shows the label and the text the server rendered', async () => {
    answerWith([
      {
        key: 'se.clock',
        channelId: 'se.clock',
        scopeKey: null,
        kind: 'text',
        label: 'Time',
        text: 'Day 3, 09:05',
      },
    ]);
    renderHud();

    expect(await screen.findByText('Time')).toBeTruthy();
    expect(screen.getByText('Day 3, 09:05')).toBeTruthy();
  });

  it('renders nothing when no channel declared a surface', async () => {
    // A strip of empty labels above the transcript would be worse than no
    // strip, and a mode with no surfaced channel is the ordinary case.
    answerWith([]);
    renderHud();

    await waitFor(() => {
      expect(readSession).toHaveBeenCalled();
    });
    expect(screen.queryByLabelText('Session state')).toBeNull();
  });

  it('skips a widget kind it does not know, which is what keeps the vocabulary additive', async () => {
    // **A session opened against a newer build.** Rendering the widgets this
    // build understands and omitting the rest is the same posture the collector
    // takes toward a preset slot kind from the future — and the alternative, a
    // thrown render, would make widening the vocabulary a breaking change.
    answerWith([
      {
        key: 'se.clock',
        channelId: 'se.clock',
        scopeKey: null,
        kind: 'text',
        label: 'Time',
        text: 'Day 3, 09:05',
      },
      {
        key: 'example.hp',
        channelId: 'example.hp',
        scopeKey: null,
        kind: 'meter',
        label: 'Health',
        text: '7 / 10',
      },
    ]);
    renderHud();

    expect(await screen.findByText('Time')).toBeTruthy();
    expect(screen.queryByText('Health')).toBeNull();
  });

  it('renders one entry per scope key, because the payload says so and not this file', async () => {
    answerWith([
      {
        key: 'example.mood#vera',
        channelId: 'example.mood',
        scopeKey: 'vera',
        kind: 'text',
        label: 'Mood',
        text: 'watchful',
      },
      {
        key: 'example.mood#ned',
        channelId: 'example.mood',
        scopeKey: 'ned',
        kind: 'text',
        label: 'Mood',
        text: 'tired',
      },
    ]);
    renderHud();

    expect(await screen.findByText('watchful')).toBeTruthy();
    expect(screen.getByText('tired')).toBeTruthy();
  });
});
