// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The banner a degraded channel raises — [06 §4.2], [P7.1].
 *
 * That section specifies three things and calls them *"the part worth building
 * properly, and the part the sources have nothing like"*. The health record and
 * the recovery are the server's and are tested there; these are about the
 * remaining one — **a persistent banner on that session** — and about the two
 * claims in it that are easy to lose in a refactor: the reassurance, which 4.2
 * says is load-bearing, and the fact that a refused retry says so.
 */

const readSession = vi.fn();
const writeSessionChannel = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readSession: (...a: unknown[]) => readSession(...a) as unknown,
    writeSessionChannel: (...a: unknown[]) => writeSessionChannel(...a) as unknown,
  };
});

const { ChannelHealth, headline } = await import('./ChannelHealth.js');

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

const CLOCK = {
  key: 'se.clock',
  channelId: 'se.clock',
  scopeKey: null,
  version: 1,
  reason: '/minute must be equal to one of the allowed values',
  raw: { day: 1, hour: 8, minute: 5 },
  value: { day: 1, hour: 8, minute: 0 },
};

function answerWith(health: unknown[]): void {
  readSession.mockResolvedValue({
    session: { id: SESSION_ID, name: 'A wet week' },
    activeJob: null,
    health,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  answerWith([CLOCK]);
  writeSessionChannel.mockResolvedValue({
    session: { id: SESSION_ID, name: 'A wet week' },
    effect: { applied: true, rejectedReason: null },
    health: [],
  });
});

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChannelHealth sessionId={SESSION_ID} />
    </QueryClientProvider>,
  );
}

describe('the channel health banner', () => {
  it('says what failed and that the story is unaffected', async () => {
    // **The reassurance is not padding.** 06 §4.2: *"'2 channels could not be
    // loaded. Your story is unaffected.' … The reassurance is load-bearing;
    // without it people assume the worst."* The calibration behind it is that
    // channel state is tracked numbers and flags, not the story.
    renderBanner();

    expect(await screen.findByText(/1 channel could not be loaded/)).toBeTruthy();
    expect(screen.getByText(/Your story is unaffected/)).toBeTruthy();
    expect(screen.getByText(/must be equal to one of the allowed values/)).toBeTruthy();
  });

  it('renders nothing at all when nothing is wrong', async () => {
    // A banner that showed an empty box on every healthy session would train
    // people to ignore it, which is the one thing a persistent banner cannot
    // afford.
    answerWith([]);
    renderBanner();

    await waitFor(() => {
      expect(readSession).toHaveBeenCalled();
    });
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('is a status rather than an alert, because it was here when the page loaded', async () => {
    // `Alert`'s own docstring draws the line: announcing this as an alert would
    // interrupt a screen reader for old news.
    renderBanner();

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toContain('could not be loaded');
  });

  it('sends the quarantined value back when asked to try again', async () => {
    // One of 06 §4.2's three offers, and the one that only works after an author
    // ships a fix — which is why it is a button rather than something automatic.
    renderBanner();

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.clock', CLOCK.raw);
    });
  });

  it('sends the value that is standing when asked to accept the reset', async () => {
    // Writing the current value clears the marker, because a degraded state is
    // only ever written by an effect carrying a reason.
    renderBanner();

    await userEvent.click(await screen.findByRole('button', { name: 'Accept the reset' }));

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.clock', CLOCK.value);
    });
  });

  it('says so when a retry is refused, rather than appearing to do nothing', async () => {
    // **A refusal arrives as a 200 with an unapplied effect** — the record is the
    // point — so this reads the effect rather than catching an error. A button
    // that looked like it had done nothing would read as broken, and the honest
    // answer until an author ships a fix is *not yet*.
    writeSessionChannel.mockResolvedValue({
      session: { id: SESSION_ID, name: 'A wet week' },
      effect: { applied: false, rejectedReason: 'schema' },
      health: [CLOCK],
    });
    renderBanner();

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(/still does not fit/)).toBeTruthy();
  });
});

describe('headline', () => {
  it('keeps singular and plural apart, because "1 channels" reads as a bug', () => {
    expect(headline(1)).toBe('1 channel could not be loaded.');
    expect(headline(2)).toBe('2 channels could not be loaded.');
  });
});
