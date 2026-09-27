// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const navigate = vi.fn();

let session: Record<string, unknown> = {};
/** The transcript the panel reads — empty unless a test gives it turns. */
let turns: Record<string, unknown>[] = [];

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  setSessionPreset: (...a: unknown[]) => setSessionPreset(...a) as unknown,
  setSessionArchived: (...a: unknown[]) => setSessionArchived(...a) as unknown,
  deleteSession: (...a: unknown[]) => deleteSession(...a) as unknown,
  readSession: () => Promise.resolve({ session }),
  readTranscript: () => Promise.resolve({ turns }),
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
  turns = [];
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

    // One character, deliberately. The control is fed from the session query
    // and the fixture never changes, so the value does not round-trip here the
    // way it does against a real server — typing two digits would send `1` and
    // then `0`, which is an artefact of the stub rather than of the panel.
    await user.type(screen.getByLabelText(/Maximum reply length/), '9');

    expect(setSessionPreset).toHaveBeenCalled();
    const [, body] = setSessionPreset.mock.calls.at(-1) as [
      string,
      { preset: Record<string, unknown> },
    ];
    expect((body.preset['params'] as Record<string, unknown>)['maxTokens']).toBe(9);
    // Untouched fields ride through: the route takes the whole pack, so a panel
    // that rebuilt it from its own two controls would silently drop the rest.
    expect((body.preset['params'] as Record<string, unknown>)['temperature']).toBe(0.8);
    expect(body.preset['name']).toBe('Scene');
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
 * ***An export containing attachments should say so*** — [25 E15], said where
 * the choice is made.
 *
 * An export is the story's text: it carries the record of every picture and
 * its caption, and not the picture. A person choosing between *Export* and a
 * backup is owed that sentence **before** the file is on another install and
 * the pictures are placeholders — and owed its absence on a story with no
 * pictures, where it would be a warning about nothing, which is how a
 * warning teaches people to stop reading warnings.
 */
describe('exporting a story with pictures', () => {
  const NOTE = /travel as their captions\. A backup carries the pictures themselves\./;

  /** A turn with a move, and whatever that move carried. */
  function turnWith(id: string, input: Record<string, unknown>): Record<string, unknown> {
    return {
      id,
      sessionId: SESSION_ID,
      parentTurnId: null,
      createdAt: '2026-09-27T10:00:00.000Z',
      status: 'complete',
      input: { actorId: null, text: 'I hold it up.', kind: 'do', raw: 'I hold it up.', ...input },
      output: { text: 'The light catches it.' },
      effects: [],
      tape: [],
    };
  }

  /**
   * Mounted with a client the test keeps, so the negative case can wait for
   * the transcript to have **landed** before asserting that nothing is shown.
   * Asserted any earlier, the note's absence would be the absence of an answer
   * rather than the answer — a test that passes against a panel that never
   * reads the transcript at all.
   */
  async function renderSettled(): Promise<ReturnType<typeof userEvent.setup>> {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SessionPanel sessionId={SESSION_ID} />
      </QueryClientProvider>,
    );
    const user = await open();
    await waitFor(() => {
      expect(client.getQueryData(['transcript', SESSION_ID])).toBeDefined();
    });
    // The cache holds the answer a beat before its observers are told, and the
    // telling is a scheduled task — so one more task, inside `act`, is what
    // puts the rendering after it rather than racing it.
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 0));
    });
    return user;
  }

  it('says pictures travel as captions when a move on the story carried one', async () => {
    // The first turn has none and the second has one: *any* move is enough,
    // which is the mutation of reading only the first or the last turn.
    turns = [
      turnWith('turn-1', {}),
      turnWith('turn-2', {
        attachments: [{ id: '0', kind: 'image', digest: `sha256:${'f'.repeat(64)}` }],
      }),
    ];
    await renderSettled();

    expect(screen.getByText(NOTE)).toBeTruthy();
    // Beside the link it qualifies, not somewhere else in the panel.
    expect(screen.getByText('Export this session').parentElement?.textContent).toMatch(NOTE);
  });

  it('says nothing about pictures on a story that has none', async () => {
    // Both spellings of *no pictures*: no field, and an empty list. The
    // mutation is testing for the field's presence rather than its length,
    // which an empty list — a shape a writer is free to produce — would fool.
    turns = [turnWith('turn-1', {}), turnWith('turn-2', { attachments: [] })];
    await renderSettled();

    expect(screen.getByText('Export this session')).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});
