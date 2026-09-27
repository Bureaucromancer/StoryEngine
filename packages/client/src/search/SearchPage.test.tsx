// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchResults } from '../api.js';

/**
 * Searching your own story — [10 §14](../../../../docs/design/10-ui-surfaces.md),
 * [P11.1].
 *
 * ***What is asserted here is §14.2***, which §14 itself calls *"the one
 * genuinely tricky part"*: a hit on a branch you left is **returned, visually
 * distinguished, and labelled**. [07 §6] makes a discarded line permanently
 * recoverable — a feature none of the three sources offers — and [07 §7] is
 * equally clear that it must not surface as though it were current. *Hiding them
 * loses real answers; showing them undifferentiated produces the worse failure
 * of somebody acting on something that never happened in their story.*
 */

let results: SearchResults;

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  searchEverything: () => Promise.resolve(results),
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

const { SearchPage } = await import('./SearchPage.js');

function renderPage(query: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SearchPage query={query} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  results = {
    // The schema id the server sends. `'actor'` stood here, a value no server
    // has ever sent, and nothing read the link it made (2026-09-27).
    objects: [
      { id: 'o1', schema: 'storyengine.actor/1', name: 'Vera', slug: 'vera', source: 'user' },
    ],
    turns: [
      {
        turnId: 't-on',
        sessionId: 's1',
        sessionName: 'The harbour',
        snippet: 'the lighthouse keeper',
        onPath: true,
        headTurnId: 't-on',
      },
      {
        turnId: 't-off',
        sessionId: 's1',
        sessionName: 'The harbour',
        snippet: 'a lighthouse nobody built',
        onPath: false,
        headTurnId: 't-on',
      },
    ],
    entries: [
      {
        entryId: 'e1',
        entryName: 'The lighthouse',
        objectId: 'b1',
        objectName: 'Harbour lore',
        slug: 'harbour-lore',
        source: 'user',
        snippet: 'built in 1840',
      },
    ],
  };
});

describe('one surface, three kinds of hit', () => {
  /**
   * ***A library hit opens the file it found*** (2026-09-27). Every one of
   * these linked to `/library/storyengine.actor/1s/<id>`, which no route
   * matches: the schema with an `s` on it, where the kind belonged.
   */
  it('links a library hit to its kind, and to the copy that matched', async () => {
    renderPage('vera');
    const hit = await screen.findByRole('link', { name: 'Vera' });
    expect(hit.getAttribute('href')).toBe('/library/actors/o1?source=user&slug=vera');
  });

  it('calls a hit in an unnamed session by the name the app gives it', async () => {
    results = {
      ...results,
      turns: [{ ...results.turns[0]!, sessionName: '' }],
    };
    renderPage('lighthouse');
    expect(await screen.findByRole('link', { name: 'Untitled session' })).toBeTruthy();
  });

  it('returns objects, turns and lore entries from one query', async () => {
    renderPage('lighthouse');
    expect(await screen.findByText('the lighthouse keeper')).toBeTruthy();
    expect(screen.getByText('Vera')).toBeTruthy();
    expect(screen.getByText('built in 1840')).toBeTruthy();
  });

  /**
   * The default is the current path and one click widens — §14.2. The count is
   * on the control because a *show branches too* with no number beside it
   * cannot be told from a filter that would change nothing.
   */
  it('hides branch hits by default and says how many are waiting', async () => {
    renderPage('lighthouse');
    expect(await screen.findByText('the lighthouse keeper')).toBeTruthy();
    expect(screen.queryByText('a lighthouse nobody built')).toBeNull();
    expect(screen.getByText(/1 hit on a branch you left/)).toBeTruthy();
  });

  it('shows them labelled when the filter is widened', async () => {
    const user = userEvent.setup();
    renderPage('lighthouse');
    await user.click(await screen.findByRole('checkbox'));
    expect(screen.getByText('a lighthouse nobody built')).toBeTruthy();
    expect(screen.getByText('On a branch you left.')).toBeTruthy();
  });

  /**
   * ***A turn hit lands on the reading view at that node***, which is why §14
   * and §12 are one stage: *"a hit lands on the reading view's addressable
   * node"*. A link to the session alone would put somebody back at the head,
   * which is where they already were.
   */
  it('links a turn hit to the reading view at that turn', async () => {
    renderPage('lighthouse');
    const link = await screen.findByRole('link', { name: 'The harbour' });
    expect(link.getAttribute('href')).toBe('/read/s1?from=t-on');
  });

  it('says nothing matched rather than rendering an empty page', async () => {
    results = { objects: [], turns: [], entries: [] };
    renderPage('nothing');
    expect(await screen.findByText('Nothing matched.')).toBeTruthy();
  });
});
