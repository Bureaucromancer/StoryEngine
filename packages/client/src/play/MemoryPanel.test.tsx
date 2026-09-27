// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***Two switches in a row*** (2026-09-27).
 *
 * Every write sends the whole memory config, built from the panel's cache, and
 * the switches come back on as soon as a write lands. The cache used to catch up
 * only when the refetch after the write did, so a second switch thrown in that
 * window sent the first one straight back. The refetch here never answers,
 * which holds that window open for as long as the test needs it.
 */

const readMemoryPanel = vi.fn();
const setMemoryConfig = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  readMemoryPanel: (...a: unknown[]) => readMemoryPanel(...a) as unknown,
  setMemoryConfig: (...a: unknown[]) => setMemoryConfig(...a) as unknown,
}));

const { MemorySection } = await import('./MemoryPanel.js');

const PANEL = {
  config: { share: true, intake: true, acrossPersonas: false, associations: {} },
  books: [],
  others: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  readMemoryPanel
    .mockResolvedValueOnce(structuredClone(PANEL))
    .mockImplementation(() => new Promise(() => undefined));
  setMemoryConfig.mockImplementation((_id: string, config: unknown) =>
    Promise.resolve({ memory: config }),
  );
});

describe('the memory switches', () => {
  it('keep the first switch when a second is thrown before the panel refetches', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemorySection sessionId="s-1" />
      </QueryClientProvider>,
    );
    const fold = screen.getByText('Memories').closest('details');
    if (fold === null) throw new Error('the memories fold is not a disclosure');
    act(() => {
      fold.setAttribute('open', '');
      fold.dispatchEvent(new Event('toggle'));
    });

    const share = await screen.findByRole('checkbox', { name: /Share memories from this session/ });
    const intake = screen.getByRole('checkbox', { name: /Use memories from these characters/ });
    const user = userEvent.setup();

    await user.click(share);
    await waitFor(() => {
      expect(intake).toHaveProperty('disabled', false);
    });
    await user.click(intake);

    await waitFor(() => {
      expect(setMemoryConfig).toHaveBeenCalledTimes(2);
    });
    expect(setMemoryConfig.mock.calls[1]?.[1]).toMatchObject({ share: false, intake: false });
  });
});
