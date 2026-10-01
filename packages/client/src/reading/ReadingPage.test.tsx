// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TurnRecord } from '../api.js';

/**
 * The reading view, mounted — [10 §12](../../../../docs/design/10-ui-surfaces.md),
 * [P11.1].
 *
 * [`fence.test.ts`](./fence.test.ts) holds the §1.4 fence over the whole
 * directory and [`prose.test.ts`](./prose.test.ts) holds the model, so what is
 * left for a mount is the two things neither can see: **that the story renders
 * at all**, and that the controls a print must not carry are marked as such.
 */

let turns: TurnRecord[] = [];
let sessionName = 'The harbour';
let unreadable = false;

/**
 * The router mocked wholesale, `ComparePage.test.tsx`-style: a link keeps an
 * assertable destination without standing a router up.
 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    className,
  }: {
    children: React.ReactNode;
    to?: string;
    params?: Record<string, string>;
    className?: string;
  }) => {
    let href = to ?? '#';
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value);
    }
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
}));

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  readTranscript: () =>
    unreadable ? Promise.reject(new Error('no such turn')) : Promise.resolve({ turns }),
  readSession: () => Promise.resolve({ session: { id: 's1', name: sessionName } }),
  readRenditions: () => Promise.resolve({ renditions: [], selection: {} }),
  listLibrary: () => Promise.resolve({ objects: [{ id: 'actor-vera', name: 'Vera' }] }),
  api: { listLibrary: () => Promise.resolve({ objects: [{ id: 'actor-vera', name: 'Vera' }] }) },
}));

const { ReadingPage } = await import('./ReadingPage.js');

function renderPage(from?: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReadingPage sessionId="s1" {...(from === undefined ? {} : { from })} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionName = 'The harbour';
  unreadable = false;
  turns = [
    {
      id: 't1',
      sessionId: 's1',
      parentTurnId: null,
      createdAt: '2026-09-17T00:00:00.000Z',
      status: 'complete',
      input: { actorId: 'actor-vera', kind: 'say', text: 'Where is the lighthouse?', raw: '' },
      output: { text: 'The keeper points north.' },
    } as TurnRecord,
  ];
});

describe('reading a session', () => {
  /**
   * ***An unnamed session is called what the app calls it*** (2026-09-27).
   * `?? 'Untitled'` caught only a missing name, and a session never named has
   * an empty one, so the page's heading was blank and a copy began with an
   * empty title.
   */
  it('titles a session nobody has named', async () => {
    sessionName = '';
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Untitled session' })).toBeTruthy();
  });

  it('renders the story with its speakers', async () => {
    renderPage();
    expect(await screen.findByText('The keeper points north.')).toBeTruthy();
    expect(screen.getByText('Where is the lighthouse?')).toBeTruthy();
    expect(screen.getByText('Vera said')).toBeTruthy();
  });

  /**
   * ***The controls are chrome and a print must not carry them*** — §12.2's
   * whole PDF story is the browser's own print, so anything that would land on
   * paper and is not the story is a defect in the output.
   */
  it('marks its own controls as not for print', async () => {
    renderPage();
    const print = await screen.findByRole('button', { name: 'Print' });
    expect(print.closest('.print\\:hidden')).toBeTruthy();
  });

  /**
   * ***Reading a node that is not the head says so*** — §12.1's *any node*,
   * and [07 §7]'s rule that a line you left must not read as the one you are
   * on. The reading view is the surface where that is easiest to forget,
   * because the prose looks identical either way.
   */
  it('says when it is showing a point in the past rather than the current line', async () => {
    renderPage('t1');
    expect(await screen.findByText(/as it stood at one point/)).toBeTruthy();
  });

  /**
   * ***A way back to the story*** (2026-10-01). Opened from the session panel,
   * the view offered no route back to the session but the browser's own — and
   * none at all to somebody who arrived on a pasted link. Not on paper: the
   * link sits with the controls a print drops.
   */
  it('offers the way back to the session, and keeps it off the page', async () => {
    renderPage();
    const back = await screen.findByRole('link', { name: 'Back to the session' });
    expect(back.getAttribute('href')).toBe('/play/s1');
    expect(back.closest('.print\\:hidden')).toBeTruthy();
  });

  it('offers it when the story could not be read, too', async () => {
    unreadable = true;
    renderPage('t-missing');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the session' }).getAttribute('href')).toBe(
      '/play/s1',
    );
  });

  it('says so rather than rendering nothing when the session is empty', async () => {
    turns = [];
    renderPage();
    expect(await screen.findByText(/Nothing has been written/)).toBeTruthy();
  });
});
