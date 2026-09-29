// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***What a running session is prompted with, and the two verbs it never had***
 * — [P7B.2].
 *
 * [P7B §0.2] lists three absences and says any one of them alone kept the
 * sentence unchangeable: no editor, no object for an editor to open, and no
 * session-level path around either. This is the third. Until it,
 * `PATCH /api/sessions/:id` accepted `name` and `archived`, no route touched a
 * session's pack, and [manual testing]'s C3 read *"hand-edit
 * `preset.params.maxTokens` in the session's own `session.json`"*.
 *
 * **The archive assertion is the one worth reading twice.** The route has
 * accepted `{ archived }` since P2 and `renameSession` has been calling that
 * very route with `{ name }` the whole time. Nothing was missing but a field on
 * a request the client already made.
 */

const SESSION_ID = 'session-1';

const setSessionPreset = vi.fn();
const setSessionArchived = vi.fn();
const deleteSession = vi.fn();
const importChatFile = vi.fn();
const navigate = vi.fn();

let session: Record<string, unknown> = {};

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  setSessionPreset: (...a: unknown[]) => setSessionPreset(...a) as unknown,
  setSessionArchived: (...a: unknown[]) => setSessionArchived(...a) as unknown,
  deleteSession: (...a: unknown[]) => deleteSession(...a) as unknown,
  importChatFile: (...a: unknown[]) => importChatFile(...a) as unknown,
  readSession: () => Promise.resolve({ session }),
  api: { listLibrary: () => Promise.resolve({ objects: [] }) },
}));

/**
 * ***`Link` joins `useNavigate` here, and it had to*** — [P11.1].
 *
 * This file mounts the panel **without a router**, so the module is replaced
 * rather than partially mocked — which works exactly as long as the panel uses
 * nothing else from it. [P11.1] added the way into the reading view, which
 * [10 §12.1] wants *"openable at any time on any session"* and which therefore
 * renders unconditionally, and the panel stopped rendering at all.
 *
 * *An anchor is the whole of what the replacement needs to be*: nothing here
 * asserts about navigation, and a link's address is the one thing about it a
 * test on this surface would ever check.
 */
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: (props: { to?: string; children?: ReactNode; className?: string }) => (
    <a href={props.to ?? '#'} className={props.className}>
      {props.children}
    </a>
  ),
}));

const { SessionPanel } = await import('./SessionPanel.js');

function renderPanel(block?: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SessionPanel sessionId={SESSION_ID} {...(block === undefined ? {} : { block })} />
    </QueryClientProvider>,
  );
}

async function open(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.click(await screen.findByText(/Prompted with|How this session is prompted/));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  setSessionPreset.mockResolvedValue({ session: {} });
  setSessionArchived.mockResolvedValue({ session: {} });
  deleteSession.mockResolvedValue(undefined);
  session = {
    id: SESSION_ID,
    name: 'The Ashfall Road',
    preset: {
      id: 'p1',
      name: 'Scene',
      params: { temperature: 0.8 },
      blocks: [
        { id: 'se.instruction', template: 'You are the narrator of a scene.' },
        { id: 'se.lore', source: { kind: 'lore' } },
      ],
    },
  };
});

describe('what a session is prompted with', () => {
  it('names the pack in the summary, without being opened', async () => {
    renderPanel();

    expect(await screen.findByText('Prompted with Scene')).toBeTruthy();
  });

  /**
   * C3, without a text editor. The assertion is on the sent body because the
   * route takes the pack whole — the panel edits the session's own copy, which
   * [P7B §1.1] says is the same operation as switching to a pack of one.
   */
  it('sets maxTokens, which the walk sheet says to hand-edit on disk', async () => {
    renderPanel();
    const user = await open();

    // Three characters and one write, on Enter. ~~One character, deliberately~~:
    // the control used to write on every keystroke, so typing `400` sent `4`,
    // `40` and `400`, and a test typing one character was working around the
    // bug rather than an artefact of the stub (2026-09-27).
    await user.type(screen.getByLabelText(/Maximum reply length/), '400{Enter}');

    expect(setSessionPreset).toHaveBeenCalledTimes(1);
    const [, body] = setSessionPreset.mock.calls.at(-1) as [
      string,
      { preset: Record<string, unknown> },
    ];
    expect((body.preset['params'] as Record<string, unknown>)['maxTokens']).toBe(400);
    // Untouched fields ride through: the route takes the whole pack, so a panel
    // that rebuilt it from its own two controls would silently drop the rest.
    expect((body.preset['params'] as Record<string, unknown>)['temperature']).toBe(0.8);
    expect(body.preset['name']).toBe('Scene');
  });

  /**
   * ***A decimal, typed*** (2026-09-27). `0.75` passes through `0` and `0.` on
   * the way, and writing each of those sent a zero and then a string that is not
   * a number.
   */
  it('sends the temperature typed, once, when the box is left', async () => {
    renderPanel();
    const user = await open();

    const temperature = screen.getByLabelText(/Temperature/);
    await user.clear(temperature);
    await user.type(temperature, '0.75');
    expect(setSessionPreset).not.toHaveBeenCalled();
    await user.tab();

    expect(setSessionPreset).toHaveBeenCalledTimes(1);
    const [, body] = setSessionPreset.mock.calls[0] as [
      string,
      { preset: Record<string, unknown> },
    ];
    expect(body.preset['params']).toEqual({ temperature: 0.75 });
  });

  it('says what a reply length has to be, and sends nothing until it is one', async () => {
    renderPanel();
    const user = await open();

    await user.type(screen.getByLabelText(/Maximum reply length/), '0.5{Enter}');

    expect(await screen.findByText('A whole number of tokens, 1 or more.')).toBeTruthy();
    expect(setSessionPreset).not.toHaveBeenCalled();
  });

  /**
   * ***The second write builds on the first*** (2026-09-27). Every write sends
   * the whole pack from the session in the cache, and the cache caught up only
   * when the refetch after a write landed — so a second write made while the
   * first was on its way put the first back.
   */
  it('builds a second setting on the first while the first is still on its way', async () => {
    setSessionPreset.mockImplementationOnce(() => new Promise(() => undefined));
    renderPanel();
    const user = await open();

    const temperature = screen.getByLabelText(/Temperature/);
    await user.clear(temperature);
    await user.type(temperature, '0.75{Enter}');
    await user.type(screen.getByLabelText(/Maximum reply length/), '400{Enter}');

    const sent = setSessionPreset.mock.calls.map(
      (call) => (call[1] as { preset: { params: Record<string, unknown> } }).preset.params,
    );
    expect(sent.find((params) => params['maxTokens'] === 400)).toEqual({
      temperature: 0.75,
      maxTokens: 400,
    });
  });

  it('archives through the field the client was already able to send', async () => {
    renderPanel();
    const user = await open();

    await user.click(screen.getByRole('button', { name: 'Archive this session' }));

    expect(setSessionArchived).toHaveBeenCalledWith(SESSION_ID, true);
  });

  it('offers to take an archived one back out', async () => {
    session = { ...session, archivedAt: '2026-09-01T00:00:00.000Z' };
    renderPanel();
    const user = await open();

    expect(screen.getByRole('button', { name: 'Take out of the archive' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Take out of the archive' }));
    expect(setSessionArchived).toHaveBeenCalledWith(SESSION_ID, false);
  });

  it('asks before deleting, and says where it goes rather than that it is gone', async () => {
    renderPanel();
    const user = await open();

    await user.click(screen.getByRole('button', { name: 'Delete this session' }));
    expect(deleteSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Move it to trash' }));
    expect(deleteSession).toHaveBeenCalledWith(SESSION_ID);
  });
});

/**
 * ***Edit a block and re-run*** — [10 §3]'s sentence, answered at [P7B.4].
 *
 * [P3 §1.8] found three mechanical reasons it could not be built and handed it
 * to P6; [P6 §1.8] answered a different question and left the override with
 * nobody. [P7B §1.6] takes the second of its two shapes: **an edit to the
 * session's own copy, then an ordinary reroll** — no new field on the record,
 * which [P7B §0.4] refuses this phase.
 *
 * The address is what opens the panel, which is why these render with `block`
 * rather than clicking anything: the workbench's link carries it, and a panel
 * opened by poking its own state would leave the address unable to say what the
 * page is showing.
 */
describe('editing one block of the pack', () => {
  it('opens on the block the address names, without being clicked', async () => {
    renderPanel('se.instruction');

    expect(await screen.findByLabelText('Block: se.instruction')).toBeTruthy();
  });

  it('saves the whole pack with that block changed, and nothing else touched', async () => {
    renderPanel('se.instruction');
    const user = userEvent.setup();

    const field = await screen.findByLabelText('Block: se.instruction');
    await user.clear(field);
    await user.type(field, 'You are a weary harbourmaster.');
    await user.click(screen.getByRole('button', { name: 'Save this block' }));

    const [, body] = setSessionPreset.mock.calls.at(-1) as [
      string,
      { preset: Record<string, unknown> },
    ];
    const blocks = body.preset['blocks'] as { id: string; template?: string }[];
    expect(blocks.find((b) => b.id === 'se.instruction')?.template).toBe(
      'You are a weary harbourmaster.',
    );
    // The slot rides through untouched — the route takes the whole pack, so a
    // panel that rebuilt it from the one field it edits would drop the rest.
    expect(blocks.find((b) => b.id === 'se.lore')).toBeDefined();
    expect((body.preset['params'] as Record<string, unknown>)['temperature']).toBe(0.8);
  });

  /**
   * ***A draft belongs to one block*** (2026-09-27). The page stays mounted when
   * only `?block=` changes, and the draft typed for one block used to stand in
   * the next one's field under the next one's label, with *Save* live — so
   * saving it wrote the first block's prose over the second's.
   */
  it('starts a fresh draft when the address names another block', async () => {
    const preset = session['preset'] as { blocks: Record<string, unknown>[] };
    preset.blocks.push({ id: 'se.style', template: 'Short sentences.' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const panel = (block: string): ReactNode => (
      <QueryClientProvider client={client}>
        <SessionPanel sessionId={SESSION_ID} block={block} />
      </QueryClientProvider>
    );
    const view = render(panel('se.instruction'));
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Block: se.instruction'), ' And the rain.');
    view.rerender(panel('se.style'));

    expect(await screen.findByLabelText('Block: se.style')).toHaveProperty(
      'value',
      'Short sentences.',
    );
    expect(screen.getByRole('button', { name: 'Save this block' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  /** The draft is let go once the pack is written — not when the write is asked for. */
  it('keeps the draft when the save fails', async () => {
    setSessionPreset.mockRejectedValue(new Error('The server could not be reached.'));
    renderPanel('se.instruction');
    const user = userEvent.setup();

    const field = await screen.findByLabelText('Block: se.instruction');
    await user.clear(field);
    await user.type(field, 'You are a weary harbourmaster.');
    await user.click(screen.getByRole('button', { name: 'Save this block' }));

    expect(await screen.findByText('The server could not be reached.')).toBeTruthy();
    expect(screen.getByLabelText('Block: se.instruction')).toHaveProperty(
      'value',
      'You are a weary harbourmaster.',
    );
  });

  it('says so for a slot, which has no text in the pack to edit', async () => {
    renderPanel('se.lore');

    expect(await screen.findByText(/positions something the engine supplies/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save this block' })).toBeNull();
  });
});

/**
 * ***Update from source*** — [P13 §2.7], [P13.10a].
 *
 * The session menu's verb on a session made from a chat, and its two doors:
 * the server sweeps the folder the ledger recorded, or, for a chat that came as
 * one file, says so and the panel offers the picker for that same file. What an
 * update does and does not do is said beside the button, before it is pressed.
 */
describe('update from source', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answer = (status: number, body: unknown): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
  };
  const fromChat = (originalFilename: string): void => {
    session = { ...session, origin: { source: 'import', originalFilename } };
  };

  it('is offered only on a session made from a chat', async () => {
    renderPanel();
    await open();

    expect(screen.queryByRole('button', { name: 'Update from source' })).toBeNull();
  });

  it('says what it does and does not do, and what the sweep brought', async () => {
    fromChat('chats/Vera/Vera - 2026.jsonl');
    answer(200, {
      item: {
        source: 'chats/Vera/Vera - 2026.jsonl',
        disposition: 'converted',
        objectId: SESSION_ID,
        notes: [{ key: 'import.chat.extended', params: { name: 'Vera', count: 3 }, level: 'info' }],
      },
    });
    renderPanel();
    const user = await open();

    expect(screen.getByText(/Nothing in this session is deleted or rewritten/)).toBeTruthy();
    expect(screen.getByText(/your place is kept/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Update from source' }));

    expect(await screen.findByText(/brought up to date from its source: 3 new turns/)).toBeTruthy();
  });

  it('offers the same file again when the chat came as one, and refuses another', async () => {
    fromChat('Vera.jsonl');
    answer(409, { error: 'no-recorded-source', message: 'Choose the file again.' });
    importChatFile.mockResolvedValue({
      item: {
        source: 'Vera.jsonl',
        disposition: 'unchanged',
        objectId: SESSION_ID,
        notes: [{ key: 'import.chat.alreadyHere', params: {}, level: 'info' }],
      },
      notes: [],
    });
    renderPanel();
    const user = await open();

    await user.click(screen.getByRole('button', { name: 'Update from source' }));
    expect(await screen.findByRole('button', { name: 'Choose Vera.jsonl' })).toBeTruthy();

    const input = document.querySelector<HTMLInputElement>('input[accept=".jsonl"]');
    if (input === null) throw new Error('no picker');
    await user.upload(input, new File(['{}'], 'Maris.jsonl'));
    expect(await screen.findByText(/That is not “Vera.jsonl”/)).toBeTruthy();
    expect(importChatFile).not.toHaveBeenCalled();

    await user.upload(input, new File(['{}'], 'Vera.jsonl'));
    expect(await screen.findByText(/Nothing new/)).toBeTruthy();
    expect(importChatFile).toHaveBeenCalledTimes(1);
  });

  it('sends a chat that came with its folder back to the folder', async () => {
    fromChat('chats/Vera/Vera - 2026.jsonl');
    answer(409, { error: 'no-recorded-source', message: 'Choose the file again.' });
    renderPanel();
    const user = await open();

    await user.click(screen.getByRole('button', { name: 'Update from source' }));

    expect(await screen.findByText(/Import that folder again/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Choose/ })).toBeNull();
  });
});
