// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * ***The review's chunk failing to arrive, through the real factory*** —
 * [P16.3g](../../../../../docs/design/workplan/34-p16-world.md),
 * [21 §7.2](../../../../../docs/design/21-client-loading.md).
 *
 * `PublishRoute.test.tsx` holds the boundary's two sentences apart by throwing
 * at it directly — a `PublishChunkError` already made — so the one line that
 * *makes* one, the `lazy()` factory's rejection handler in `PublishRoute.tsx`,
 * was never run: a factory that rethrew the import's own `TypeError` would have
 * told a tab opened before an upgrade that *the review stopped with an error*,
 * with no word about reloading, and every test would have passed (the P16.3g
 * review, 2026-10-11). Here the review's module is one that never loads, as a
 * browser reports a chunk an old tab knows by name and the server no longer
 * has — `home/ChangelogLoad.test.tsx`'s and `play/SetupFromTurn.load.test.tsx`'s
 * arrangement, and in a file of its own for their reason: a `vi.mock` holds for
 * the whole file.
 *
 * *What this cannot prove is that the review is off the entry*: a mocked
 * module is a module however it is imported ([21 §6]).
 * `tools/entry-budget.test.ts` asks that of the build.
 */

vi.mock('./PublishPage.js', () => {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/PublishPage-old.js');
});

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => ({ world: 'w-1' }) }),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

vi.mock('../../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.js')>()),
  api: {
    authState: () => Promise.resolve({ account: { handle: 'ned', locale: null } }),
  },
}));

const { PublishRoute } = await import('./PublishRoute.js');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loading the publish review', () => {
  it('tells a chunk that never arrives to reload, and keeps the way back', async () => {
    // React reports an error a boundary caught; expected here.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PublishRoute />
      </QueryClientProvider>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('reload the page');
    expect(alert.textContent).not.toContain('stopped with an error');
    expect(screen.getByRole('link', { name: 'Back to the library' })).toBeTruthy();
  });
});
