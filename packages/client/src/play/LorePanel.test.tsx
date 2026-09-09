// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Choosing what a session retrieves from — [P6B.0].
 *
 * **The claim under test is that the route is reachable at all.** Every part of
 * this path existed before the panel did: `PUT /api/sessions/:id/lore` writes
 * both fields, `resolveLore` reads them, and the retriever runs on what it
 * finds. What was missing was any way for a person to say which books, so every
 * session in the browser resolved none and two of PLAYABLE's four hypotheses
 * were about a subsystem nothing could reach
 * ([P6B §0.1](../../../../docs/design/workplan/20-p6b-playable.md)).
 *
 * So the assertions are about the join: what the panel shows is what the
 * session holds, and what it sends is what was ticked.
 */

const readSession = vi.fn();
const setSessionLore = vi.fn();
const listLibrary = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readSession: (...a: unknown[]) => readSession(...a) as unknown,
    setSessionLore: (...a: unknown[]) => setSessionLore(...a) as unknown,
    api: { ...actual.api, listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown },
  };
});

const { LorePanel, attachedLine } = await import('./LorePanel.js');

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

const RAIN_CITY = { id: 'book-rain', name: 'Rain City' };
const HARBOUR = { id: 'book-harbour', name: 'The Harbour' };

function libraryObject(one: { id: string; name: string }, schema: string) {
  return {
    id: one.id,
    name: one.name,
    schema,
    slug: one.name.toLowerCase(),
    source: 'user',
    contentHash: 'sha256:x',
    shadowed: false,
    object: {},
  };
}

/** A session holding whatever selection the test is about. */
function sessionWith(selection: { treatment?: string | null; lore?: string[] }) {
  return {
    session: {
      id: SESSION_ID,
      name: 'A wet week',
      createdAt: '2026-09-07T10:00:00.000Z',
      updatedAt: '2026-09-07T10:00:00.000Z',
      headTurnId: null,
      ...selection,
    },
    activeJob: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readSession.mockResolvedValue(sessionWith({}));
  setSessionLore.mockResolvedValue(sessionWith({}));
  listLibrary.mockImplementation((kind: string) =>
    Promise.resolve({
      objects:
        kind === 'lorebooks'
          ? [
              libraryObject(RAIN_CITY, 'storyengine.lorebook.1'),
              libraryObject(HARBOUR, 'storyengine.lorebook.1'),
            ]
          : [libraryObject({ id: 'treat-wet', name: 'A wet week' }, 'storyengine.treatment.1')],
    }),
  );
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LorePanel sessionId={SESSION_ID} />
    </QueryClientProvider>,
  );
}

describe('attachedLine', () => {
  it('counts what is attached, so the closed fold is still worth reading', () => {
    expect(attachedLine(0, false)).toBe('Retrieving from no lorebooks');
    expect(attachedLine(1, false)).toBe('Retrieving from one lorebook');
    expect(attachedLine(3, false)).toBe('Retrieving from 3 lorebooks');
  });

  it('says when a treatment is bringing books of its own', () => {
    expect(attachedLine(0, true)).toBe('Retrieving from a treatment, and no lorebooks');
    expect(attachedLine(2, true)).toBe('Retrieving from a treatment, and 2 lorebooks');
  });
});

describe('the lore panel', () => {
  it('says what the session is retrieving from without being opened', async () => {
    readSession.mockResolvedValue(sessionWith({ lore: [RAIN_CITY.id] }));
    renderPanel();

    // The state that made every session before [P6B.0] silent about lore is the
    // one worth seeing from outside the fold.
    expect(await screen.findByText('Retrieving from one lorebook')).toBeTruthy();
  });

  it('opens showing what is already chosen', async () => {
    readSession.mockResolvedValue(sessionWith({ lore: [HARBOUR.id] }));
    renderPanel();

    await userEvent.click(await screen.findByText('Retrieving from one lorebook'));

    // The property, not the attribute: React controls a checkbox through
    // `checked` and never writes the attribute, so an attribute assertion here
    // would fail against a working panel.
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('The Harbour').checked).toBe(true);
    });
    expect(screen.getByLabelText<HTMLInputElement>('Rain City').checked).toBe(false);
  });

  it('sends what was ticked, and nothing it was not asked about', async () => {
    renderPanel();

    await userEvent.click(await screen.findByText('Retrieving from no lorebooks'));
    await userEvent.click(screen.getByLabelText('Rain City'));
    await userEvent.click(screen.getByRole('button', { name: 'Save selection' }));

    // Both fields, because the route replaces rather than merges — a panel that
    // sent only what changed would silently clear the other one.
    await waitFor(() => {
      expect(setSessionLore).toHaveBeenCalledWith(SESSION_ID, {
        treatment: null,
        lore: [RAIN_CITY.id],
      });
    });
  });

  it('will not save what has not changed', async () => {
    readSession.mockResolvedValue(sessionWith({ lore: [RAIN_CITY.id] }));
    renderPanel();

    await userEvent.click(await screen.findByText('Retrieving from one lorebook'));

    expect(screen.getByRole('button', { name: 'Save selection' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  /**
   * A refusal is rendered rather than swallowed, which is the same line
   * [P6B.0] draws on the play page itself: a control that can fail silently is
   * one whose failures arrive as a finding about something else.
   */
  it('says so when the write is refused', async () => {
    setSessionLore.mockRejectedValue(new Error('That lorebook is no longer in the library.'));
    renderPanel();

    await userEvent.click(await screen.findByText('Retrieving from no lorebooks'));
    await userEvent.click(screen.getByLabelText('Rain City'));
    await userEvent.click(screen.getByRole('button', { name: 'Save selection' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('no longer in the library');
    });
  });
});
