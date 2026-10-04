// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSettings } from '../api.js';

/**
 * ***How this chat plays*** — [P14 §1.8]'s session settings, [P14.5]. The
 * claims a simplification would break: voice and dispatch are two plain
 * controls rather than a four-way enum, dispatch is not offered where it does
 * nothing, smart says its cost where it is chosen, and a pre-P14 session's
 * `fixed` is shown as itself rather than as whatever the select offers first.
 */

const readSession = vi.fn();
const setChatSettings = vi.fn();
const listLibrary = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readSession: (...a: unknown[]) => readSession(...a) as unknown,
    setChatSettings: (...a: unknown[]) => setChatSettings(...a) as unknown,
    api: { ...actual.api, listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown },
  };
});

const { ChatSettingsPanel } = await import('./ChatSettingsPanel.js');

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
  prompts: { instruction: true, cards: {} },
};

function answerWith(chat: ChatSettings | undefined): void {
  readSession.mockResolvedValue({
    session: { id: SESSION_ID, name: 'Harbour', cast: { persona: null, actors: ['actor-vera'] } },
    activeJob: null,
    health: [],
    hud: [],
    cast: [],
    ...(chat === undefined ? {} : { chat }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  answerWith(CHAT);
  listLibrary.mockResolvedValue({ objects: [] });
  setChatSettings.mockResolvedValue({ session: {}, chat: CHAT });
});

async function open(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChatSettingsPanel sessionId={SESSION_ID} />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByText('How this chat plays'));
}

describe('the chat settings', () => {
  it('asks voice and dispatch as two plain questions, and writes each alone', async () => {
    await open();
    await userEvent.click(screen.getByRole('radio', { name: 'A narrator, telling the scene' }));
    await waitFor(() => {
      expect(setChatSettings).toHaveBeenCalledWith(SESSION_ID, { voice: 'narrator' });
    });
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Each character replies in a call of their own' }),
    );
    await waitFor(() => {
      expect(setChatSettings).toHaveBeenCalledWith(SESSION_ID, { dispatch: 'merged' });
    });
  });

  it('does not offer dispatch to a narrator, who ignores it', async () => {
    answerWith({ ...CHAT, voice: 'narrator' });
    await open();
    expect(
      screen.queryByRole('checkbox', { name: 'Each character replies in a call of their own' }),
    ).toBeNull();
  });

  it('says smart’s cost in the option that chooses it', async () => {
    await open();
    const policy = screen.getByRole('combobox', { name: 'Who replies' });
    expect(
      screen.getByRole('option', {
        name: 'Smart — a model picks who replies (one extra call on turns where nobody is named)',
      }),
    ).toBeTruthy();
    await userEvent.selectOptions(policy, 'smart');
    await waitFor(() => {
      expect(setChatSettings).toHaveBeenCalledWith(SESSION_ID, { speakers: { policy: 'smart' } });
    });
  });

  it('shows a session written before P14 as it plays, not as the first option', async () => {
    answerWith({
      ...CHAT,
      voice: 'narrator',
      dispatch: 'merged',
      speakers: { ...CHAT.speakers, policy: 'fixed' },
    });
    await open();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Who replies' }).value).toBe(
      'fixed',
    );
  });

  it('writes self-responses, names in history and the instruction switch', async () => {
    await open();
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'A character may reply straight after themselves' }),
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Naming speakers to the model' }),
      'always',
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Send the prompt pack’s own instruction' }),
    );
    await waitFor(() => {
      expect(setChatSettings).toHaveBeenCalledWith(SESSION_ID, {
        speakers: { allowSelfResponses: true },
      });
      expect(setChatSettings).toHaveBeenCalledWith(SESSION_ID, {
        speakers: { namesInHistory: 'always' },
      });
      expect(setChatSettings).toHaveBeenCalledWith(SESSION_ID, { prompts: { instruction: false } });
    });
  });

  it('saves the author’s note when asked, not per keystroke, and removes it', async () => {
    answerWith({ ...CHAT, note: { text: 'Keep it wet.', depth: 4, every: 1 } });
    await open();
    const note = screen.getByRole('textbox', { name: 'Author’s note' });
    await waitFor(() => {
      expect((note as HTMLTextAreaElement).value).toBe('Keep it wet.');
    });
    await userEvent.type(note, ' Colder.');
    const every = screen.getByRole('spinbutton', { name: /Every how many/ });
    await userEvent.clear(every);
    await userEvent.type(every, '3');
    expect(setChatSettings).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Save the note' }));
    await waitFor(() => {
      expect(setChatSettings).toHaveBeenCalledWith(SESSION_ID, {
        note: { text: 'Keep it wet. Colder.', depth: 4, every: 3 },
      });
    });

    await userEvent.click(screen.getByRole('button', { name: 'Remove the note' }));
    await waitFor(() => {
      expect(setChatSettings).toHaveBeenLastCalledWith(SESSION_ID, { note: null });
    });
  });

  it('renders nothing for a session that is not a chat', async () => {
    answerWith(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <ChatSettingsPanel sessionId={SESSION_ID} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(readSession).toHaveBeenCalled();
    });
    expect(view.container.textContent).toBe('');
  });
});

/**
 * ***The Agents group*** — [P14 §1.9.6], [P14.5a]: the mode's `settings`
 * region, drawn inside this panel under the heading the mode gave it. The
 * panel knows no tracker; it draws what the session read hands it.
 */
describe('what the mode put in settings', () => {
  it('draws the mode’s switches under their group, inside the chat settings', async () => {
    readSession.mockResolvedValue({
      session: { id: SESSION_ID, name: 'Harbour', cast: { persona: null, actors: [] } },
      activeJob: null,
      health: [],
      hud: [],
      cast: [],
      chat: CHAT,
      surfaces: [
        {
          region: 'settings',
          group: 'Agents',
          key: 'se.track.world.on',
          channelId: 'se.track.world.on',
          scopeKey: null,
          kind: 'toggle',
          label: 'Track the world',
          on: false,
        },
      ],
    });
    await open();
    const group = screen.getByRole('region', { name: 'Agents' });
    expect(group.textContent).toContain('Track the world');
  });
});
