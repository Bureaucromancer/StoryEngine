// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NO_LORE_REPORT } from '@storyengine/shared';

import type { ChatSettings, TurnRecord } from '../api.js';
import type { StreamHandlers } from './stream.js';

/**
 * ***The play page as a chat*** —
 * [P14 §1.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [P14.5].
 *
 * `PlayPage.test.tsx` holds the page's older claims and its fixtures have no
 * `chat`, which is itself a claim this file leans on: a session whose mode is
 * not a chat renders exactly as it did. What is proved here is §1.8's list —
 * each message drawn with its speaker, the gestures each sending the body
 * `routes/gestures.ts` reads, the composer's empty send, who speaks next, the
 * round painted as it streams with its order, and auto-mode — through the
 * same mocked API and real query client, for that file's reason.
 */

const readSession = vi.fn();
const readTranscript = vi.fn();
const submitTurn = vi.fn();
const moveHead = vi.fn();
const previewTurn = vi.fn();
const readRenditions = vi.fn();
const listLibrary = vi.fn();
const setTurnHidden = vi.fn();
const setChatSettings = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readSession: (...a: unknown[]) => readSession(...a) as unknown,
    readTranscript: (...a: unknown[]) => readTranscript(...a) as unknown,
    submitTurn: (...a: unknown[]) => submitTurn(...a) as unknown,
    moveHead: (...a: unknown[]) => moveHead(...a) as unknown,
    previewTurn: (...a: unknown[]) => previewTurn(...a) as unknown,
    readRenditions: (...a: unknown[]) => readRenditions(...a) as unknown,
    setTurnHidden: (...a: unknown[]) => setTurnHidden(...a) as unknown,
    setChatSettings: (...a: unknown[]) => setChatSettings(...a) as unknown,
    impersonateAs: () => Promise.resolve({ text: '' }),
    api: {
      ...actual.api,
      listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown,
      authState: () => Promise.resolve({ setupRequired: false, account: null }),
      readPrefs: () => Promise.resolve({ prefs: {} }),
      patchPrefs: () => Promise.resolve({ prefs: {} }),
    },
  };
});

let handlers: StreamHandlers;
vi.mock('./stream.js', () => ({
  openTurnStream: (_id: string, given: StreamHandlers) => {
    handlers = given;
    return { close: vi.fn() };
  },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: (props: { to?: string; children?: ReactNode }) => (
      <a href={props.to ?? '#'}>{props.children}</a>
    ),
  };
});

const { PlayPage } = await import('./PlayPage.js');

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';
const VERA = { id: 'actor-vera', name: 'Vera' };
const LUND = { id: 'actor-lund', name: 'Lund' };
const NED = { id: 'actor-ned', name: 'Ned' };

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

const ROUND: TurnRecord = {
  id: 'turn-round',
  sessionId: SESSION_ID,
  parentTurnId: 'turn-greeting',
  createdAt: '2026-09-29T10:00:00.000Z',
  status: 'complete',
  input: { actorId: NED.id, text: 'Well?', kind: 'do', raw: 'Well?' },
  output: {
    text: 'Rain on the glass.\n\n"You came."\n\n"Aye."',
    messages: [
      { speaker: null, text: 'Rain on the glass.' },
      { speaker: VERA, text: '"You came."', reasoning: 'She is relieved.' },
      { speaker: LUND, text: '"Aye."' },
    ],
  },
  request: { calls: [] },
  effects: [],
  tape: [],
};

const LEGACY: TurnRecord = {
  id: 'turn-greeting',
  sessionId: SESSION_ID,
  parentTurnId: null,
  createdAt: '2026-09-29T09:00:00.000Z',
  status: 'complete',
  input: { actorId: null, text: 'I knock.', kind: 'do', raw: 'I knock.' },
  output: { text: 'The door opens.' },
  effects: [],
  tape: [],
};

const row = (actorId: string, presence = true): Record<string, unknown> => ({
  actorId,
  presence,
  status: 'alive',
  pending: null,
  introduced: true,
  party: null,
});

function answerSession(over: { chat?: ChatSettings | null; cast?: unknown[] } = {}): void {
  readSession.mockResolvedValue({
    session: {
      id: SESSION_ID,
      name: 'Harbour',
      createdAt: '',
      updatedAt: '',
      headTurnId: ROUND.id,
      mode: { id: 'storyengine.scene' },
      cast: { persona: NED.id, actors: [VERA.id, LUND.id] },
    },
    activeJob: null,
    health: [],
    hud: [],
    cast: over.cast ?? [row(VERA.id), row(LUND.id)],
    ...(over.chat === null ? {} : { chat: over.chat ?? CHAT }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  answerSession();
  readTranscript.mockResolvedValue({ turns: [LEGACY, ROUND] });
  submitTurn.mockResolvedValue({ jobId: 'job-1', cursor: 'job-1.0' });
  moveHead.mockResolvedValue({ session: {}, abandoned: { turns: 0, escapedEffects: 0 } });
  previewTurn.mockResolvedValue({
    preview: {
      state: 'assembled',
      headTurnId: ROUND.id,
      pendingInput: false,
      stepId: 'se.narrate',
      callKind: 'narrate',
      purpose: 'prose',
      resolved: { connectionId: 'c', modelId: 'm' },
      blocks: [],
      budget: {
        limit: { tokens: 6144, ceiling: 8192, source: 'user', share: 0.75 },
        reserved: 1024,
        spent: 100,
        decisions: [],
        nextToDrop: [],
      },
      notFilled: [],
      lore: NO_LORE_REPORT,
    },
  });
  readRenditions.mockResolvedValue({ renditions: [], selection: {} });
  listLibrary.mockResolvedValue({
    objects: [VERA, LUND, NED].map((one) => ({
      id: one.id,
      name: one.name,
      schema: 'storyengine.actor/1',
      slug: one.name.toLowerCase(),
      source: 'user',
      contentHash: `hash-${one.id}`,
      shadowed: false,
      object: { id: one.id, name: one.name, media: [] },
    })),
  });
  setTurnHidden.mockResolvedValue({ session: {} });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlayPage sessionId={SESSION_ID} />
    </QueryClientProvider>,
  );
}

/** The line a message is drawn in, found by its words. */
async function lineOf(text: string): Promise<HTMLElement> {
  const words = await screen.findByText(text);
  const line = words.closest('.group\\/line');
  if (!(line instanceof HTMLElement)) throw new Error(`no line holds ${text}`);
  return line;
}

describe('the transcript as a chat', () => {
  it('names each message’s speaker, the persona’s on the input, and draws the narrator as narration', async () => {
    renderPage();
    const vera = await lineOf('"You came."');
    expect(within(vera).getByText('Vera')).toBeTruthy();
    expect(within(await lineOf('Well?')).getByText('Ned')).toBeTruthy();
    // The narrator's line has no name above it.
    const narration = await lineOf('Rain on the glass.');
    expect(within(narration).queryByText('Vera')).toBeNull();
    expect(within(narration).queryByText('Lund')).toBeNull();
  });

  it('keeps the reasoning behind a closed disclosure', async () => {
    renderPage();
    const vera = await lineOf('"You came."');
    const details = within(vera).getByText('Thinking').closest('details');
    expect(details?.open).toBe(false);
    expect(within(vera).getByText('She is relieved.')).toBeTruthy();
  });

  it('draws a turn written before P14 as narration, with the chat’s gestures on it', async () => {
    renderPage();
    const narration = await lineOf('The door opens.');
    // Nobody's line: no name above it, and nothing "by the same speaker".
    expect(within(narration).queryByText('Ned')).toBeNull();
    expect(within(narration).queryByRole('button', { name: 'Another reply' })).toBeNull();
    expect(within(narration).getByRole('button', { name: 'Hide' })).toBeTruthy();
    expect(within(narration).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(within(await lineOf('I knock.')).getByText('Ned')).toBeTruthy();
  });

  it('offers neither swipe nor continue once the chat is narrated', async () => {
    answerSession({ chat: { ...CHAT, voice: 'narrator' } });
    renderPage();
    const lund = await lineOf('"Aye."');
    expect(within(lund).queryByRole('button', { name: 'Another reply' })).toBeNull();
    expect(within(lund).queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Who speaks next' })).toBeNull();
  });

  it('ghosts a hidden line and says why', async () => {
    answerSession({ chat: { ...CHAT, hidden: { [ROUND.id]: [2] } } });
    renderPage();
    const lund = await lineOf('"Aye."');
    expect(lund.dataset['hidden']).toBe('true');
    expect(within(lund).getByText(/Hidden from the story/)).toBeTruthy();
    expect((await lineOf('"You came."')).dataset['hidden']).toBeUndefined();
  });

  it('draws the swipe counter on the message it belongs to', async () => {
    readTranscript.mockResolvedValue({
      turns: [LEGACY, ROUND],
      siblings: { [ROUND.id]: [ROUND.id, 'turn-swipe'] },
      swipes: { [ROUND.id]: { messages: [[], [], [ROUND.id, 'turn-swipe'], []], turn: [] } },
    });
    renderPage();
    const lund = await lineOf('"Aye."');
    expect(within(lund).getByText('1 of 2')).toBeTruthy();
    expect(within(await lineOf('"You came."')).queryByText('1 of 2')).toBeNull();
    // Every alternative is a message swipe, and the node can still be named.
    expect(screen.getByRole('button', { name: 'Name this line' })).toBeTruthy();

    await userEvent.click(within(lund).getByRole('button', { name: 'Next reply' }));
    await waitFor(() => {
      expect(moveHead).toHaveBeenCalledWith(SESSION_ID, 'turn-swipe', true);
    });
  });
});

describe('the gestures on a message', () => {
  it('swipes a message by rewriting from it', async () => {
    renderPage();
    const lund = await lineOf('"Aye."');
    await userEvent.click(within(lund).getByRole('button', { name: 'Another reply' }));
    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          rewriteOf: ROUND.id,
          fromMessage: 2,
          parentTurnId: ROUND.parentTurnId,
        }),
      );
    });
    expect(submitTurn.mock.calls[0]?.[0]).not.toHaveProperty('text');
  });

  it('offers continue on the last line only, and never on the narrator’s', async () => {
    renderPage();
    expect(
      within(await lineOf('"You came."')).queryByRole('button', { name: 'Continue' }),
    ).toBeNull();
    const narration = await lineOf('Rain on the glass.');
    expect(within(narration).queryByRole('button', { name: 'Another reply' })).toBeNull();

    await userEvent.click(within(await lineOf('"Aye."')).getByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(
        expect.objectContaining({ continueOf: ROUND.id, parentTurnId: ROUND.parentTurnId }),
      );
    });
  });

  it('edits a line as a sibling written by hand, the rest carried as they were', async () => {
    renderPage();
    const vera = await lineOf('"You came."');
    await userEvent.click(within(vera).getByRole('button', { name: 'Edit' }));
    const box = within(vera).getByRole('textbox', { name: 'Edit this line' });
    await userEvent.clear(box);
    await userEvent.type(box, '"Finally."');
    await userEvent.click(within(vera).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          editOf: ROUND.id,
          authored: {
            messages: [
              { speaker: null, text: 'Rain on the glass.' },
              { speaker: VERA.id, text: '"Finally."' },
              { speaker: LUND.id, text: '"Aye."' },
            ],
          },
        }),
      );
    });
  });

  /**
   * ***The editor's two marks*** — [P14 §1.9.4], [P14.5c]: an edited line
   * offers what the model wrote, and a continuity finding on a line is applied
   * by the edit gesture with its one substitution.
   */
  it('marks an edited line and offers its original behind a disclosure', async () => {
    const edited: TurnRecord = {
      ...ROUND,
      output: {
        text: ROUND.output?.text ?? '',
        messages: (ROUND.output?.messages ?? []).map((message, at) =>
          at === 1 ? { ...message, original: '"You came, ozone and all."' } : message,
        ),
      },
    };
    readTranscript.mockResolvedValue({ turns: [LEGACY, edited] });
    renderPage();
    const vera = await lineOf('"You came."');
    const shown = within(vera).getByText('Edited: show the original');
    expect(shown.closest('details')?.open).toBe(false);
    await userEvent.click(shown);
    expect(shown.closest('details')?.open).toBe(true);
    expect(within(vera).getByText('"You came, ozone and all."')).toBeDefined();
    // The other lines were not edited and say nothing.
    expect(within(await lineOf('"Aye."')).queryByText('Edited: show the original')).toBeNull();
  });

  it('lists continuity findings on their line, and applies one as an edit', async () => {
    const found: TurnRecord = {
      ...ROUND,
      steps: [
        {
          stepId: 'se.scene.edit',
          stage: 'post',
          state: 'ok',
          contributed: { blocks: 0, effects: 0 },
          wallMs: 1,
          revisions: [
            {
              index: 1,
              notices: [
                { issue: 'Vera has never met you.', quote: 'You came', fix: 'Who are you' },
                { issue: 'It stopped raining an hour ago.' },
              ],
            },
          ],
        },
      ],
    };
    readTranscript.mockResolvedValue({ turns: [LEGACY, found] });
    renderPage();
    const vera = await lineOf('"You came."');
    const list = within(vera).getByRole('list', { name: 'What the continuity check found' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    // Only the finding that names its words and their fix can be applied.
    const apply = within(list).getAllByRole('button', { name: 'Apply' });
    expect(apply).toHaveLength(1);
    await userEvent.click(apply[0]!);
    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          editOf: ROUND.id,
          authored: {
            messages: [
              { speaker: null, text: 'Rain on the glass.' },
              { speaker: VERA.id, text: '"Who are you."' },
              { speaker: LUND.id, text: '"Aye."' },
            ],
          },
        }),
      );
    });
  });

  it('hides one line by sending the turn’s whole entry', async () => {
    answerSession({ chat: { ...CHAT, hidden: { [ROUND.id]: [0] } } });
    renderPage();
    await userEvent.click(within(await lineOf('"Aye."')).getByRole('button', { name: 'Hide' }));
    await waitFor(() => {
      expect(setTurnHidden).toHaveBeenCalledWith(SESSION_ID, ROUND.id, [0, 2]);
    });
  });

  it('hides the whole exchange from the player’s line', async () => {
    renderPage();
    await userEvent.click(
      within(await lineOf('Well?')).getByRole('button', { name: 'Hide this exchange' }),
    );
    await waitFor(() => {
      expect(setTurnHidden).toHaveBeenCalledWith(SESSION_ID, ROUND.id, true);
    });
  });

  it('branches mid-round as an edit that stops there', async () => {
    renderPage();
    await userEvent.click(
      within(await lineOf('"You came."')).getByRole('button', { name: 'Branch here' }),
    );
    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          editOf: ROUND.id,
          authored: {
            messages: [
              { speaker: null, text: 'Rain on the glass.' },
              { speaker: VERA.id, text: '"You came."' },
            ],
          },
        }),
      );
    });
  });

  it('branches at an earlier turn’s last line by moving the head, writing nothing', async () => {
    renderPage();
    await userEvent.click(
      within(await lineOf('The door opens.')).getByRole('button', { name: 'Branch here' }),
    );
    await waitFor(() => {
      expect(moveHead).toHaveBeenCalledWith(SESSION_ID, LEGACY.id);
    });
    expect(submitTurn).not.toHaveBeenCalled();
  });

  it('offers no branch on the head’s last line, where it would do nothing', async () => {
    renderPage();
    const lund = await lineOf('"Aye."');
    expect(within(lund).queryByRole('button', { name: 'Branch here' })).toBeNull();
  });

  it('deletes the greeting by moving the head to the root', async () => {
    renderPage();
    await userEvent.click(
      within(await lineOf('The door opens.')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => {
      expect(moveHead).toHaveBeenCalledWith(SESSION_ID, null);
    });
    expect(submitTurn).not.toHaveBeenCalled();
  });
});

describe('the composer in a chat', () => {
  it('sends an empty box as let them talk — no input at all', async () => {
    renderPage();
    await lineOf('"Aye."');
    await userEvent.click(screen.getByRole('button', { name: 'Let them talk' }));
    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledTimes(1);
    });
    expect(submitTurn.mock.calls[0]?.[0]).not.toHaveProperty('text');
  });

  it('still sends an empty box under manual with nobody named', async () => {
    answerSession({ chat: { ...CHAT, speakers: { ...CHAT.speakers, policy: 'manual' } } });
    renderPage();
    await lineOf('"Aye."');
    await userEvent.click(screen.getByRole('button', { name: 'Let them talk' }));
    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledTimes(1);
    });
  });

  it('names who speaks next, once', async () => {
    renderPage();
    await lineOf('"Aye."');
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Who speaks next' }),
      LUND.id,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'What do you do?' }), 'Well?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Well?', speakers: [LUND.id] }),
      );
    });
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLSelectElement>('combobox', { name: 'Who speaks next' }).value,
      ).toBe('');
    });
  });

  /**
   * ***Push story*** — [P14 §1.9.3], [P14.5b]: the director armed for one
   * turn, sent as the submission's `push` and cleared once it is.
   */
  it('pushes the story for one turn, then forgets it', async () => {
    renderPage();
    await lineOf('"Aye."');
    const push = await screen.findByRole<HTMLSelectElement>('combobox', {
      name: 'Push the story',
    });
    expect(push.value).toBe('');
    await userEvent.selectOptions(push, 'random');
    await userEvent.click(screen.getByRole('button', { name: 'Let them talk' }));
    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(expect.objectContaining({ push: 'random' }));
    });
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLSelectElement>('combobox', { name: 'Push the story' }).value,
      ).toBe('');
    });
  });

  it('rerolls a pushed turn pushed, reading the push off its director outcome', async () => {
    const pushed: TurnRecord = {
      ...ROUND,
      tape: [
        {
          key: 'lore.probability:e1#0',
          site: 'lore.probability',
          purpose: 'e1',
          index: 0,
          kind: 'chance',
          detail: 'p=0.5',
          value: true,
          replayed: false,
        },
      ],
      steps: [
        {
          stepId: 'se.scene.direct',
          stage: 'pre',
          state: 'ok',
          contributed: { blocks: 0, effects: 0 },
          wallMs: 0,
          direction: { push: 'random', by: 'model', text: 'A fire starts.' },
        },
      ],
    };
    readTranscript.mockResolvedValue({ turns: [LEGACY, pushed] });
    renderPage();
    await lineOf('"Aye."');
    await userEvent.click(screen.getByRole('button', { name: 'Reroll' }));
    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(expect.objectContaining({ push: 'random' }));
    });
    expect(submitTurn.mock.calls[0]?.[0]).not.toHaveProperty('rewriteOf');
  });

  it('sends no push when none was chosen', async () => {
    renderPage();
    await lineOf('"Aye."');
    await userEvent.click(screen.getByRole('button', { name: 'Let them talk' }));
    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledTimes(1);
    });
    expect(submitTurn.mock.calls[0]?.[0]).not.toHaveProperty('push');
  });

  it('says nobody can reply rather than sending, when everyone is muted', async () => {
    answerSession({ cast: [row(VERA.id, false), row(LUND.id, false)] });
    renderPage();
    await lineOf('"Aye."');
    await userEvent.click(screen.getByRole('button', { name: 'Let them talk' }));
    expect(await screen.findByText(/Nobody here can reply/)).toBeTruthy();
    expect(submitTurn).not.toHaveBeenCalled();
  });

  it('keeps the old composer for a session that is not a chat', async () => {
    answerSession({ chat: null });
    renderPage();
    await screen.findByText('The door opens.');
    expect(screen.queryByRole('combobox', { name: 'Who speaks next' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Push the story' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(submitTurn).not.toHaveBeenCalled();
  });
});

describe('a round as it streams', () => {
  it('paints each speaker’s message as it opens, and shows the picked order', async () => {
    renderPage();
    await lineOf('"Aye."');
    await userEvent.click(screen.getByRole('button', { name: 'Let them talk' }));
    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalled();
    });

    const progress = (seq: number, key: string, params: Record<string, unknown>) => ({
      event: 'progress',
      id: `job-1.${String(seq)}`,
      data: { jobId: 'job-1', seq, key, params, at: 0 },
    });
    act(() => {
      handlers.onFrame({ event: 'snapshot', data: { job: { id: 'job-1', status: 'running' } } });
      handlers.onFrame(progress(1, 'turn.started', { turnId: 't' }));
      handlers.onFrame(progress(2, 'speakers.picked', { speakers: [LUND, VERA], by: 'model' }));
      handlers.onFrame(progress(3, 'call.started', { stepId: 'g', message: 0, speaker: LUND }));
      handlers.onFrame({ event: 'delta', data: { text: '"Rain again."', message: 0 } });
    });

    expect(await screen.findByText('Replying: Lund → Vera A model chose.')).toBeTruthy();
    const live = (await screen.findByText('"Rain again."')).closest('[aria-live]');
    expect(live).toBeTruthy();
    expect(within(live as HTMLElement).getByText('Lund')).toBeTruthy();
  });
});

describe('auto-mode', () => {
  it('lets them talk after the quiet it was given, and typing turns it off', async () => {
    renderPage();
    await lineOf('"Aye."');
    const seconds = screen.getByRole('spinbutton', { name: 'Seconds of quiet' });
    await userEvent.clear(seconds);
    await userEvent.type(seconds, '1');
    await userEvent.click(screen.getByRole('checkbox', { name: /keep talking on their own/ }));

    await waitFor(
      () => {
        expect(submitTurn).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );
    expect(submitTurn.mock.calls[0]?.[0]).not.toHaveProperty('text');
  });

  it('waits out a reconnect rather than talking over the round it lost sight of', async () => {
    renderPage();
    await lineOf('"Aye."');
    const seconds = screen.getByRole('spinbutton', { name: 'Seconds of quiet' });
    await userEvent.clear(seconds);
    await userEvent.type(seconds, '1');
    act(() => {
      handlers.onFrame({ event: 'snapshot', data: { job: { id: 'job-9', status: 'running' } } });
      handlers.onFrame({ event: 'overflow', data: { cursor: 'job-9.4' } });
    });
    expect(await screen.findByText('Reconnecting…')).toBeTruthy();
    await userEvent.click(screen.getByRole('checkbox', { name: /keep talking on their own/ }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    });
    expect(submitTurn).not.toHaveBeenCalled();
  });

  it('is switched off by opening a line’s edit box', async () => {
    renderPage();
    const lund = await lineOf('"Aye."');
    const toggle = screen.getByRole('checkbox', { name: /keep talking on their own/ });
    await userEvent.click(toggle);
    expect((toggle as HTMLInputElement).checked).toBe(true);
    await userEvent.click(within(lund).getByRole('button', { name: 'Edit' }));
    expect((toggle as HTMLInputElement).checked).toBe(false);
  });

  it('is switched off by typing', async () => {
    renderPage();
    await lineOf('"Aye."');
    const toggle = screen.getByRole('checkbox', { name: /keep talking on their own/ });
    await userEvent.click(toggle);
    expect((toggle as HTMLInputElement).checked).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: 'What do you do?' }), 'I');
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(submitTurn).not.toHaveBeenCalled();
  });
});
