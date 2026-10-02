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

const { fileErrorFor, QuarantinePanel, REASON_WORDS } = await import('./QuarantinePanel.js');

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
          reason: 'unparsable',
          detail: 'Unexpected token } at position 412',
          seenAt: 0,
        },
      ],
    });
    renderPanel();

    expect(await screen.findByText(/vera-kohl/)).toBeTruthy();
    // In words (2026-09-28): it printed the code, and the fixture's code was
    // `invalid-json`, which the server has never sent.
    expect(screen.getByText(REASON_WORDS['unparsable'] ?? '')).toBeTruthy();
    expect(screen.queryByText('unparsable')).toBeNull();
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
          reason: 'schema',
          detail: null,
          seenAt: 0,
        },
      ],
    });
    renderPanel();

    expect(await screen.findByText(/Nothing was deleted/)).toBeTruthy();
  });

  /**
   * ***Corrected 2026-09-28.*** It said these were *not in the list above*: the
   * panel is above the list, and a file that broke after it was read is in it,
   * as it last read. Only a file that never read is missing.
   */
  it('says a file that read before is still in the list below, and one that never did is not', async () => {
    libraryErrors.mockResolvedValue({
      errors: [
        {
          path: 'users/ned/library/lorebooks/rain-city/lorebook.json',
          source: 'user',
          kind: 'storyengine.lorebook/1',
          slug: 'rain-city',
          reason: 'schema',
          detail: null,
          seenAt: 0,
        },
      ],
    });
    renderPanel();

    const said = await screen.findByText(/Nothing was deleted/);
    expect(said.textContent).toMatch(/still in the list below as it last read/);
    expect(said.textContent).not.toMatch(/list above/);
  });
});

/**
 * ***Which file's trouble an object's page shows*** (2026-09-28). A pure
 * function rather than a render, because the negative is the case worth a
 * test and a render cannot hold one: the page shows Edit before the list of
 * errors answers, so *no alert* is true whether or not the match is right.
 */
describe('the trouble with one object', () => {
  const object = { source: 'user' as const, schema: 'storyengine.actor/1', slug: 'vera-kohl' };
  const row = (over: Record<string, unknown> = {}) => ({
    path: 'users/ned/library/actors/vera-kohl/card.png',
    source: 'user' as const,
    kind: 'storyengine.actor/1',
    slug: 'vera-kohl',
    reason: 'schema',
    detail: null,
    seenAt: 0,
    ...over,
  });

  it('is the row for its own file', () => {
    expect(fileErrorFor([row({ slug: 'other' }), row()], object)).toEqual(row());
  });

  it("is never another folder's, another kind's or another owner's", () => {
    const others = [
      row({ slug: 'vera-kohl-2' }),
      row({ kind: 'storyengine.lorebook/1' }),
      row({ source: 'system' }),
    ];
    expect(fileErrorFor(others, object)).toBeUndefined();
    expect(fileErrorFor(undefined, object)).toBeUndefined();
  });
});
