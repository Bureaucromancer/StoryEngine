// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSettings } from '../api.js';

/**
 * ***The cast panel in a chat*** — [P14 §1.8], [P14.5]: add and remove over
 * the cast route, mute as presence, talkativeness on the card, speak, and the
 * card's prompt switches. `CastPanel.test.tsx` keeps the P7 claims, on a
 * session that is not a chat, and those must still hold.
 */

const readSession = vi.fn();
const writeSessionChannel = vi.fn();
const setSessionCast = vi.fn();
const setChatSettings = vi.fn();
const listLibrary = vi.fn();
const updateObject = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readSession: (...a: unknown[]) => readSession(...a) as unknown,
    writeSessionChannel: (...a: unknown[]) => writeSessionChannel(...a) as unknown,
    setSessionCast: (...a: unknown[]) => setSessionCast(...a) as unknown,
    setChatSettings: (...a: unknown[]) => setChatSettings(...a) as unknown,
    api: {
      ...actual.api,
      listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown,
      updateObject: (...a: unknown[]) => updateObject(...a) as unknown,
    },
  };
});

const { CastPanel } = await import('./CastPanel.js');

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

const CHAT: ChatSettings = {
  voice: 'embodied',
  dispatch: 'per-actor',
  speakers: {
    policy: 'natural',
    allowSelfResponses: false,
    namesInHistory: 'groups',
    maxPerRound: 3,
  },
  note: null,
  hidden: {},
  prompts: { instruction: true, cards: { 'actor-vera': ['depth'] } },
};

const card = (id: string, name: string, object: Record<string, unknown> = {}) => ({
  id,
  name,
  schema: 'storyengine.actor/1',
  slug: name.toLowerCase(),
  source: 'user',
  contentHash: `hash-${id}`,
  shadowed: false,
  object: { id, name, ...object },
});

const row = (actorId: string, presence = true) => ({
  actorId,
  presence,
  status: 'alive',
  pending: null,
  introduced: true,
  party: null,
});

function answerWith(chat: ChatSettings | undefined, rows = [row('actor-vera')]): void {
  readSession.mockResolvedValue({
    session: {
      id: SESSION_ID,
      name: 'Harbour',
      mode: { id: 'storyengine.scene' },
      cast: { persona: null, actors: ['actor-vera'] },
    },
    activeJob: null,
    health: [],
    hud: [],
    cast: rows,
    ...(chat === undefined ? {} : { chat }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  answerWith(CHAT);
  listLibrary.mockResolvedValue({
    objects: [
      card('actor-vera', 'Vera', {
        modeData: { 'storyengine.scene': { talkativeness: 0.3 } },
      }),
      card('actor-lund', 'Lund'),
    ],
  });
  writeSessionChannel.mockResolvedValue({
    session: { id: SESSION_ID },
    effect: { applied: true, rejectedReason: null },
    health: [],
  });
  setSessionCast.mockResolvedValue({ session: { id: SESSION_ID } });
  setChatSettings.mockResolvedValue({ session: { id: SESSION_ID }, chat: CHAT });
  updateObject.mockResolvedValue({ contentHash: 'next', object: {} });
});

const onSpeak = vi.fn();

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CastPanel sessionId={SESSION_ID} onSpeak={onSpeak} />
    </QueryClientProvider>,
  );
}

describe('the cast panel in a chat', () => {
  it('reads presence as a mute, ticked when muted, and writes the same channel', async () => {
    answerWith(CHAT, [row('actor-vera', false)]);
    renderPanel();
    const muted = await screen.findByRole('checkbox', { name: 'Muted' });
    expect((muted as HTMLInputElement).checked).toBe(true);

    await userEvent.click(muted);
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.presence#actor-vera', true);
    });
  });

  it('keeps "In the scene" for a narrated chat, where presence means the room', async () => {
    answerWith({ ...CHAT, voice: 'narrator' });
    renderPanel();
    expect(await screen.findByRole('checkbox', { name: 'In the scene' })).toBeTruthy();
  });

  it('asks a member to speak', async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Speak' }));
    expect(onSpeak).toHaveBeenCalledWith('actor-vera');
  });

  it('seats somebody and takes them out again, the roster sent whole', async () => {
    renderPanel();
    await screen.findByText('Vera');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Somebody to add' }),
      'actor-lund',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add to the cast' }));
    await waitFor(() => {
      expect(setSessionCast).toHaveBeenCalledWith(SESSION_ID, {
        persona: null,
        actors: ['actor-vera', 'actor-lund'],
      });
    });

    await userEvent.click(screen.getByRole('button', { name: 'Remove from the cast' }));
    await waitFor(() => {
      expect(setSessionCast).toHaveBeenLastCalledWith(SESSION_ID, { persona: null, actors: [] });
    });
  });

  it('shows and writes talkativeness on the card, under the session’s mode', async () => {
    renderPanel();
    const select = await screen.findByRole('combobox', { name: /How readily they join in/ });
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe('0.3');
    });
    await userEvent.selectOptions(select, '0.8');
    await waitFor(() => {
      expect(updateObject).toHaveBeenCalledWith(
        'actors',
        'actor-vera',
        expect.objectContaining({
          modeData: { 'storyengine.scene': { talkativeness: 0.8 } },
        }),
        'hash-actor-vera',
        undefined,
      );
    });
  });

  it('switches one card prompt part, the others as they were', async () => {
    renderPanel();
    await screen.findByText('Vera');
    await userEvent.click(screen.getByText('Card prompts'));
    const parts = within(screen.getByRole('group', { name: /Vera’s card sends/ }));
    expect(
      parts.getByRole<HTMLInputElement>('checkbox', { name: 'Its depth prompt' }).checked,
    ).toBe(false);
    await userEvent.click(parts.getByRole('checkbox', { name: 'Its system prompt' }));
    await waitFor(() => {
      expect(setChatSettings).toHaveBeenCalledWith(SESSION_ID, {
        prompts: { cards: { 'actor-vera': ['system', 'depth'] } },
      });
    });
  });

  it('offers none of it on a session that is not a chat', async () => {
    answerWith(undefined);
    renderPanel();
    await screen.findByText('Vera');
    expect(screen.queryByRole('button', { name: 'Speak' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to the cast' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'In the scene' })).toBeTruthy();
  });
});
