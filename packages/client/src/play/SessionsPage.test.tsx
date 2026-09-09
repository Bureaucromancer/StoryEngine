// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Starting a session with something to retrieve from — [P6B.0].
 *
 * **This form is where PLAYABLE stopped.** `POST /api/sessions` has accepted
 * `treatment`, `lore` and `preset` since P5.6 and this page sent `name` alone,
 * so every session ever started in the browser resolved zero lorebooks and ran
 * the mode's built-in preset — which made an imported preset unplayable and the
 * retrieval half of P5 unreachable
 * ([P6B §0.1](../../../../docs/design/workplan/24-p6b-playable.md)).
 *
 * The preset is the field with no second chance: a session copies it at
 * creation and no route changes it afterwards, so a session started without one
 * is on the default forever.
 */

const listSessions = vi.fn();
const createSession = vi.fn();
const listLibrary = vi.fn();
const renameSession = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    listSessions: (...a: unknown[]) => listSessions(...a) as unknown,
    createSession: (...a: unknown[]) => createSession(...a) as unknown,
    renameSession: (...a: unknown[]) => renameSession(...a) as unknown,
    api: { ...actual.api, listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown },
  };
});

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const { SessionsPage, setupLine } = await import('./SessionsPage.js');

function aSession(id: string, name: string) {
  return {
    id,
    name,
    createdAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:00:00Z',
    headTurnId: null,
  };
}

function libraryObject(id: string, name: string, schema: string) {
  return {
    id,
    name,
    schema,
    slug: id,
    source: 'user',
    contentHash: 'sha256:x',
    shadowed: false,
    object: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listSessions.mockResolvedValue({ sessions: [] });
  createSession.mockResolvedValue({ session: { id: 'new-1', name: 'A wet week' } });
  listLibrary.mockImplementation((kind: string) => {
    if (kind === 'lorebooks') {
      return Promise.resolve({
        objects: [libraryObject('book-rain', 'Rain City', 'storyengine.lorebook.1')],
      });
    }
    if (kind === 'treatments') {
      return Promise.resolve({
        objects: [libraryObject('treat-wet', 'A wet week', 'storyengine.treatment.1')],
      });
    }
    return Promise.resolve({
      objects: [libraryObject('preset-noir', 'Rain noir', 'storyengine.preset.1')],
    });
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SessionsPage />
    </QueryClientProvider>,
  );
}

describe('setupLine', () => {
  it('says plainly when a session would start with nothing', () => {
    // The fold is closed by default, so this line is the only thing between
    // somebody and the state every session was in before [P6B.0].
    expect(setupLine(0, false, false)).toBe(
      'Nothing chosen yet — the mode default, and no lorebooks',
    );
  });

  it('names what was chosen, and counts the books', () => {
    expect(setupLine(1, false, false)).toBe('With one lorebook');
    expect(setupLine(2, true, false)).toBe('With a treatment, 2 lorebooks');
    expect(setupLine(0, true, true)).toBe('With a treatment, a preset');
  });
});

describe('starting a session', () => {
  it('sends the name alone when nothing else was chosen', async () => {
    renderPage();

    await userEvent.type(
      screen.getByLabelText('Name for the new session, if you have one'),
      'A wet week',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    // Absent rather than empty: the route's optional fields mean *unset*, and
    // an empty list would be a session that has decided to retrieve nothing.
    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({ name: 'A wet week' });
    });
  });

  it('sends the treatment, the books and the preset that were chosen', async () => {
    renderPage();

    await userEvent.type(
      screen.getByLabelText('Name for the new session, if you have one'),
      'A wet week',
    );
    await userEvent.click(await screen.findByText(/Nothing chosen yet/));

    await userEvent.selectOptions(screen.getByLabelText('Treatment'), 'treat-wet');
    await userEvent.selectOptions(screen.getByLabelText('Preset'), 'preset-noir');
    await userEvent.click(screen.getByLabelText('Rain City'));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({
        name: 'A wet week',
        treatment: 'treat-wet',
        preset: 'preset-noir',
        lore: ['book-rain'],
      });
    });
  });

  /**
   * **The change this whole workstream is.**
   *
   * Start used to read `if (name.trim().length > 0) create.mutate()`, so this
   * exact interaction — press Start, having typed nothing — did nothing at all.
   * Not a refusal and not a prevention, which is the shape
   * [05 §11.1a](../../../../docs/design/05-ui-surfaces.md) exists to rule out. Asserting on
   * the argument rather than only on the call matters: sending `{ name: '' }`
   * would also "work", and would put an empty string on the wire as though it
   * were a choice somebody made.
   */
  it('starts a session with nothing typed at all', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({});
    });
  });

  it('says so when the server refuses', async () => {
    createSession.mockRejectedValue(new Error('No such preset.'));
    renderPage();

    await userEvent.type(
      screen.getByLabelText('Name for the new session, if you have one'),
      'A wet week',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('No such preset.');
    });
  });
});

describe('a session that has not been named', () => {
  /**
   * A bug that predates unnamed sessions being reachable from the form: the
   * list rendered `{session.name}` bare, so a session whose name is `''` — one
   * hand-edit away, since `session.json` is meant to be edited — produced a
   * link with no accessible name and nothing to click. Queried by role rather
   * than by text, because *findable and clickable* is the actual claim.
   */
  it('is labelled, and its link can still be found and followed', async () => {
    listSessions.mockResolvedValue({ sessions: [aSession('s-1', '')] });
    renderPage();

    expect(await screen.findByRole('link', { name: 'Untitled session' })).toBeTruthy();
  });

  /**
   * The rename box opens on the *stored* name, not on the label. Seeding it
   * with *Untitled session* is how a placeholder becomes somebody's real
   * session name the first time they press Save without reading it.
   */
  it('opens its rename box empty rather than seeded with the placeholder', async () => {
    listSessions.mockResolvedValue({ sessions: [aSession('s-1', '')] });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Rename Untitled session' }));

    const box = screen.getByRole('textbox', { name: 'Session name' });
    expect((box as HTMLInputElement).value).toBe('');
  });
});

describe('renaming a session from the list', () => {
  it('sends the id and the typed name, and shows the result', async () => {
    listSessions.mockResolvedValue({ sessions: [aSession('s-1', 'Rain City')] });
    renameSession.mockImplementation((_id: string, name: string) => {
      // The list refetches on success, so the mock has to start answering with
      // the new name — otherwise this would pass on a stale cache and prove
      // nothing about the invalidation.
      listSessions.mockResolvedValue({ sessions: [aSession('s-1', name)] });
      return Promise.resolve({ session: aSession('s-1', name) });
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Rename Rain City' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Session name' }), ', after the fire');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(renameSession).toHaveBeenCalledWith('s-1', 'Rain City, after the fire');
    });
    expect(await screen.findByRole('link', { name: 'Rain City, after the fire' })).toBeTruthy();
  });

  it('leaves the name alone when the rename is cancelled', async () => {
    listSessions.mockResolvedValue({ sessions: [aSession('s-1', 'Rain City')] });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Rename Rain City' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Session name' }), ' burned');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(renameSession).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Rain City' })).toBeTruthy();
  });
});
