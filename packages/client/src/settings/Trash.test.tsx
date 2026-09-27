// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***Putting something back*** — the panel's first test, written with the fix
 * it covers (2026-09-27).
 *
 * A restore into a name that is taken is refused with a class, `occupied`,
 * and the panel has a sentence for it naming the remedy. It chose that
 * sentence by searching the refusal's English for `already there`: right
 * while the server says it that way, and silently the generic line the first
 * time it does not. The refusal here is the same class in other words.
 */

const readTrash = vi.fn();
const restoreFromTrash = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  readTrash: (...a: unknown[]) => readTrash(...a) as unknown,
  restoreFromTrash: (...a: unknown[]) => restoreFromTrash(...a) as unknown,
}));

const { ApiError } = await import('../api.js');
const { Trash } = await import('./Trash.js');

beforeEach(() => {
  vi.clearAllMocks();
  readTrash.mockResolvedValue({
    entries: [
      {
        id: 'lorebooks/rain-city',
        kind: 'lorebooks',
        name: 'Rain City',
        deletedAt: 1,
        expiresAt: null,
      },
    ],
    retentionDays: 30,
  });
});

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Trash />
    </QueryClientProvider>,
  );
}

describe('putting something back', () => {
  it('says a name is taken by the class the refusal carries, not its wording', async () => {
    restoreFromTrash.mockRejectedValue(new ApiError(409, 'occupied', 'Taken.'));
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Put it back' }));

    expect(
      await screen.findByText(
        'Something with that name is already there. Rename it first, then put this one back.',
      ),
    ).toBeTruthy();
  });

  it('does not claim a taken name for a failure that was something else', async () => {
    restoreFromTrash.mockRejectedValue(new ApiError(500, 'internal', 'The request failed.'));
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Put it back' }));

    expect(await screen.findByText('That could not be put back.')).toBeTruthy();
  });
});
