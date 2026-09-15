// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***A gate step that has been failing since it was written*** — [P7B.8].
 *
 * `GET /api/library/errors` shipped at P2 and
 * [manual gate §3.5] has said *"No client code calls it"* ever since. Its own
 * text names the consequence: break an actor by hand and the app is silent,
 * then presents stale content as current, then blames a concurrent editor for
 * the conflict. This is the first thing in the repository that asks the route
 * anything.
 *
 * **The absent case is the one worth the test.** A panel that renders *0
 * problems* on every visit is a panel people stop seeing, and this has to be
 * noticed the once it matters.
 */

const libraryErrors = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  api: { libraryErrors: (...a: unknown[]) => libraryErrors(...a) as unknown },
}));

const { QuarantinePanel } = await import('./QuarantinePanel.js');

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <QuarantinePanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  libraryErrors.mockResolvedValue({ errors: [] });
});

describe('the quarantine listing', () => {
  it('renders nothing at all when the library is clean', async () => {
    renderPanel();
    await waitFor(() => {
      expect(libraryErrors).toHaveBeenCalled();
    });

    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.body.textContent).toBe('');
  });

  it('names the file, why it was refused, and where to look', async () => {
    libraryErrors.mockResolvedValue({
      errors: [
        {
          path: 'users/ned/library/actors/vera-kohl/actor.png',
          source: 'user',
          kind: 'storyengine.actor/1',
          slug: 'vera-kohl',
          reason: 'invalid-json',
          detail: 'Unexpected token } at position 412',
          seenAt: 0,
        },
      ],
    });
    renderPanel();

    expect(await screen.findByText(/vera-kohl/)).toBeTruthy();
    expect(screen.getByText('invalid-json')).toBeTruthy();
    // The detail is the only thing that says *where in the file* to look, which
    // is the difference between a report and an errand.
    expect(screen.getByText(/position 412/)).toBeTruthy();
  });

  it('says nothing was deleted, because the obvious reading is that it was', async () => {
    libraryErrors.mockResolvedValue({
      errors: [
        {
          path: 'users/ned/library/lorebooks/rain-city/lorebook.json',
          source: 'user',
          kind: 'storyengine.lorebook/1',
          slug: 'rain-city',
          reason: 'invalid-json',
          detail: null,
          seenAt: 0,
        },
      ],
    });
    renderPanel();

    expect(await screen.findByText(/Nothing was deleted/)).toBeTruthy();
  });
});
