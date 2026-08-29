// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Turn } from '@storyengine/shared';

import { ApiError } from '../api.js';
import {
  cancelledTurn,
  divergenceTurn,
  legacyTurn,
  richTurn,
  SESSION_ID,
} from '../workbench/turn-fixtures.js';

/**
 * The comparison view — [P3.6].
 *
 * The claims worth pinning are the ones about turns that are *not* a matched
 * pair, because a matched pair is the easy case and the record is full of the
 * others: a turn that made a call the other did not, a turn with no request at
 * all, a turn nobody counted, a turn id that is not in this session. Each of
 * those renders something plausible if the view is careless.
 *
 * The router is mocked wholesale, `views.test.tsx`-style, so the panel's link
 * and this page's *back to the session* keep an assertable destination without
 * standing a router up. The two turns arrive through `readTurn` — this is the
 * route's first real consumer, and mocking it per-id is what lets one render
 * hold two different turns.
 */

const readTurn = vi.fn();

beforeEach(() => {
  readTurn.mockClear();
});

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: React.ReactNode;
    to?: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) => {
    let href = to ?? '#';
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value);
    }
    const query = new URLSearchParams(search ?? {}).toString();
    return <a href={query === '' ? href : `${href}?${query}`}>{children}</a>;
  },
}));

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readTurn: (sessionId: string, turnId: string) => readTurn(sessionId, turnId),
    api: {
      ...actual.api,
      authState: () => Promise.resolve({ account: null, setupRequired: false }),
    },
  };
});

const { ComparePage } = await import('./ComparePage.js');

/** Answers each id from a table, and 404s anything not in it — like the route. */
function serve(turns: Turn[]): void {
  readTurn.mockImplementation((_sessionId: string, turnId: string) => {
    const turn = turns.find((candidate) => candidate.id === turnId);
    return turn === undefined
      ? Promise.reject(new ApiError(404, 'not-found', 'No such turn.'))
      : Promise.resolve({ turn });
  });
}

async function renderCompare(pair: { before?: string; after?: string }): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ComparePage sessionId={SESSION_ID} pair={pair} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(screen.queryByText('Reading both turns…')).toBeNull();
  });
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

describe('the compare view', () => {
  it('reads each turn by id rather than walking the path from the head', async () => {
    serve([richTurn(), cancelledTurn()]);

    await renderCompare({ before: 't-10', after: 't-11' });

    // The mutation is a view built on `useTranscript`: it renders the same
    // page for a pair on the current path and cannot render one at all for a
    // turn the head has passed, which is the case the address exists for.
    expect(readTurn).toHaveBeenCalledWith(SESSION_ID, 't-10');
    expect(readTurn).toHaveBeenCalledWith(SESSION_ID, 't-11');
    expect(within(section('The pair')).getByText('t-10')).toBeTruthy();
    expect(within(section('The pair')).getByText('t-11')).toBeTruthy();
  });

  it('says a call only one turn made is only one turn’s, rather than aligning it against nothing', async () => {
    // The rich turn made two calls; the cancelled one made a single call and
    // stopped. Pairing by ordinal leaves the second unmatched, and the honest
    // rendering says so — the mutation is aligning `before[at]` against
    // `after[at]` unguarded, which crashes or, worse, renders half a table.
    serve([richTurn(), cancelledTurn()]);

    await renderCompare({ before: 't-10', after: 't-11' });

    expect(section('Call 2').textContent).toContain('Only the turn on the left made this call');
  });

  it('names both step ids when the pairing crosses two different steps', async () => {
    // Pairing by position is the only rule the record supports, and it is only
    // honest if it says when the positions hold different steps. The mutation
    // is dropping the notice: the view then shows an extractor's blocks beside
    // a narrator's as though they were versions of one thing.
    const crossed: Turn = { ...richTurn(), id: 't-20' };
    const calls = richTurn().request?.calls ?? [];
    crossed.request = { calls: calls.slice(1) };
    serve([crossed, cancelledTurn()]);

    await renderCompare({ before: 't-20', after: 't-11' });

    expect(section('The call').textContent).toContain('se.extract before, se.narrate after');
  });

  it('says a turn that assembled nothing assembled nothing', async () => {
    // A divergence turn has no `request` at all. Absent is not empty: an empty
    // block table would report it as *nothing was in the prompt*, which is a
    // claim about assembly rather than the truth, which is that assembly never
    // happened. The mutation is `?? []` rendering an empty aligned table.
    serve([divergenceTurn()]);

    await renderCompare({ before: 't-12', after: 't-12' });

    expect(screen.getByText(/Neither of these turns assembled a call/)).toBeTruthy();
  });

  it('reports an uncounted cost as uncounted, never as free', async () => {
    // The cancelled turn's `promptTokens` is null — nobody counted. Rendering
    // `0` there is the exact bug `TurnCost`'s comment was written about, and
    // a comparison is where it would be read as *this turn was cheaper*.
    serve([richTurn(), cancelledTurn()]);

    await renderCompare({ before: 't-10', after: 't-11' });

    const rows = within(section('The pair')).getAllByRole('row');
    const prompt = rows.find((row) => row.textContent.startsWith('Prompt tokens'));
    const cells = [...(prompt?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent);
    expect(cells[0]).toBe('92');
    expect(cells[1]).toBe('Not counted');
  });

  it('gives the budget as window, reserved and spent, so the arithmetic is on the page', async () => {
    // The browser walk found this: the page showed a 24,000 window beside a
    // meter reading 23,200, and the difference is the reservation — which was
    // nowhere on screen, so the two surfaces read as disagreeing. Three rows,
    // and the subtraction is visible. The mutation is dropping the reserved
    // row, which restores the apparent contradiction.
    serve([richTurn(), cancelledTurn()]);

    await renderCompare({ before: 't-10', after: 't-11' });

    const labels = within(section('Call 1'))
      .getAllByRole('row')
      .map((row) => row.querySelector('th')?.textContent);
    expect(labels).toContain('Window');
    expect(labels).toContain('Reserved for the answer');
    expect(labels).toContain('Spent');
  });

  it('shows both outputs, and says which turn produced none', async () => {
    serve([richTurn(), cancelledTurn()]);

    await renderCompare({ before: 't-10', after: 't-11' });

    const outputs = section('What came out');
    expect(outputs.textContent).toContain('The air was thick with the scent of damp stone.');
    expect(outputs.textContent).toContain('This turn produced no output.');
  });

  it('will not align a call recorded before the turn kept its blocks', async () => {
    // The same P2-era record that crashed the workbench reaches this view
    // through the panel's compare link, and a comparison spanning [P3.0]
    // has one readable side and one that never kept its blocks. The
    // mutation is handing the aligner an undefined side, which throws in
    //  and takes the page down.
    serve([legacyTurn(), richTurn()]);

    await renderCompare({ before: 't-13', after: 't-10' });

    expect(screen.getByText(/The earlier call was recorded before the turn kept/)).toBeTruthy();
  });

  it('says a budget nobody kept was not recorded, rather than showing a zero', async () => {
    serve([legacyTurn(), richTurn()]);

    await renderCompare({ before: 't-13', after: 't-10' });

    const rows = within(section('Call 1')).getAllByRole('row');
    const window = rows.find((row) => row.textContent.startsWith('Window'));
    const cells = [...(window?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent);
    expect(cells[0]).toBe('Not recorded');
    expect(cells[1]).toBe('6,144');
  });
  it('says plainly when an id is not in this session', async () => {
    // The failure this surface will actually meet: a hand-typed id, a saved
    // link to a removed turn, or a turn of somebody else's session — which
    // answers 404 too, and that is the anti-leak behaviour rather than a bug
    // to explain away. The mutation is rendering the raw error message.
    serve([richTurn()]);

    await renderCompare({ before: 't-10', after: 't-404' });

    expect(screen.getByRole('alert').textContent).toBe(
      'One of these turns is not in this session.',
    );
  });

  it('asks for nothing when the address names no pair', async () => {
    serve([richTurn(), cancelledTurn()]);

    await renderCompare({ before: 't-10' });

    // Not an error card: half an address is a real thing to arrive at, and the
    // page says what it is missing. The mutation is calling `useTurn` with an
    // empty string, which sends a request that can only 404.
    expect(screen.getByText(/does not name two turns/)).toBeTruthy();
    expect(readTurn).not.toHaveBeenCalled();
  });

  it('keeps a way back to the session it is comparing turns of', async () => {
    serve([richTurn(), cancelledTurn()]);

    await renderCompare({ before: 't-10', after: 't-11' });

    expect(screen.getByRole('link', { name: 'Back to the session' }).getAttribute('href')).toBe(
      `/play/${SESSION_ID}`,
    );
  });
});
