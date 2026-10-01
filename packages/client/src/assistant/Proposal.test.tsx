// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TurnRecord } from '../api.js';

/**
 * ***An offer reads its object; no offer reads nothing*** — the component's
 * first test, written with the fix it covers (2026-09-27).
 *
 * The proposal panel read the object a proposal names whether or not there was
 * a proposal: `useLibraryObject('actors', '')` whenever the assistant was open
 * and quiet, so the library answered `404` for an empty id every two seconds
 * for as long as the panel stayed open — and a proposal already dismissed kept
 * its object polled behind a panel showing nothing.
 */

let turns: TurnRecord[] = [];
const readObject = vi.fn();
const updateObject = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  readTranscript: () => Promise.resolve({ turns }),
  api: {
    ...(await importOriginal<typeof import('../api.js')>()).api,
    readObject: (...a: unknown[]) => readObject(...a) as unknown,
    updateObject: (...a: unknown[]) => updateObject(...a) as unknown,
  },
}));

const { Proposal } = await import('./Proposal.js');

const ACTOR = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

function proposing(
  changes: Record<string, string> = { description: 'Tall, and tired.' },
): TurnRecord {
  return {
    id: 't1',
    sessionId: 's1',
    parentTurnId: null,
    createdAt: '2026-09-27T00:00:00.000Z',
    status: 'complete',
    input: { actorId: null, kind: 'say', text: 'Tighten her description.', raw: '' },
    output: { text: 'Here is a shorter one.' },
    effects: [
      {
        channelId: 'se.assistant.proposal',
        applied: true,
        after: { kind: 'actors', id: ACTOR, changes },
      },
    ],
  } as unknown as TurnRecord;
}

beforeEach(() => {
  vi.clearAllMocks();
  turns = [];
  readObject.mockResolvedValue({
    id: ACTOR,
    schema: 'storyengine.actor/1',
    name: 'Vera',
    slug: 'vera',
    source: 'user',
    contentHash: 'sha256:v',
    shadowed: false,
    object: { schema: 'storyengine.actor/1', id: ACTOR, name: 'Vera', description: 'Tall.' },
  });
});

function renderPanel(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Proposal sessionId="s1" />
    </QueryClientProvider>,
  );
  return client;
}

/** How many mounted queries are watching the proposed object — polling it. */
function watching(client: QueryClient): number {
  return (
    client
      .getQueryCache()
      .find({ queryKey: ['library', 'actors', ACTOR, 'winner'] })
      ?.getObserversCount() ?? 0
  );
}

describe('a proposal from the assistant', () => {
  it('reads no object while there is nothing proposed', async () => {
    turns = [{ ...proposing(), effects: [] }];
    renderPanel();

    // Long enough for a query mounted with the transcript to have fired.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(readObject).not.toHaveBeenCalled();
  });

  it('reads the object it names while it is offered, and stops once dismissed', async () => {
    turns = [proposing()];
    const client = renderPanel();

    expect(await screen.findByText('Now: Tall.')).toBeTruthy();
    expect(readObject).toHaveBeenCalledWith('actors', ACTOR, undefined);
    expect(watching(client)).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }));

    expect(screen.queryByText('Now: Tall.')).toBeNull();
    // Nothing mounted watches it any more, so nothing polls it.
    expect(watching(client)).toBe(0);
  });
});

/**
 * ***Only what the object holds as text is offered, and only that is written***
 * (2026-09-30). A model shown no object guesses paths — `summary`, on an actor
 * whose summary is a section — and the panel showed *Now: —* for it and wrote a
 * dead top-level field on *Apply*. A change the object cannot take is dropped
 * before it is shown; an offer with nothing left is no offer.
 */
describe('a proposal for fields the object does not hold', () => {
  it('offers and writes only the ones it does', async () => {
    updateObject.mockResolvedValue({ contentHash: 'sha256:w' });
    turns = [proposing({ description: 'Tall, and tired.', summary: 'A fence.' })];
    renderPanel();

    expect(await screen.findByText('Now: Tall.')).toBeTruthy();
    expect(screen.queryByText('summary')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Apply it' }));

    await vi.waitFor(() => {
      expect(updateObject).toHaveBeenCalledTimes(1);
    });
    const written = updateObject.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(written['description']).toBe('Tall, and tired.');
    expect(Object.hasOwn(written, 'summary')).toBe(false);
    expect(Object.keys(written['generated'] as object)).toEqual(['description']);
  });

  it('offers nothing when it holds none of them', async () => {
    turns = [proposing({ summary: 'A fence.' })];
    const client = renderPanel();

    // Until the object is in, nothing shows either way; after it, the offer
    // would have — so the absence below is about the fields, not the timing.
    await vi.waitFor(() => {
      expect(client.getQueryData(['library', 'actors', ACTOR, 'winner'])).toBeDefined();
    });
    expect(screen.queryByRole('region', { name: 'A change it suggests' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply it' })).toBeNull();
  });
});
