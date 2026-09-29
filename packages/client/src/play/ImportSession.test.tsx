// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***Loading a session somebody exported*** — the file's first test, written
 * with the fix it covers (2026-09-27).
 *
 * The component turns a refusal's class into a sentence with a remedy in it,
 * and for as long as it existed none of those sentences had rendered: it read
 * the class from `failure.body.error`, which `ApiError` has never had. That
 * read was put right with the backup import; what was still wrong is the
 * commonest mistake of all, a file that is not JSON, which fails in the
 * browser before any request and so never had a class to read.
 */

const importSessionDocument = vi.fn();
const importChatFile = vi.fn();
const navigate = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  importSessionDocument: (...a: unknown[]) => importSessionDocument(...a) as unknown,
  importChatFile: (...a: unknown[]) => importChatFile(...a) as unknown,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

const { ApiError } = await import('../api.js');
const { ImportSession } = await import('./ImportSession.js');

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPicker(): HTMLInputElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <ImportSession />
    </QueryClientProvider>,
  );
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('no file input rendered');
  return input;
}

async function choose(input: HTMLInputElement, text: string, name = 'story.json'): Promise<void> {
  await act(async () => {
    fireEvent.change(input, {
      target: { files: [new File([text], name, { type: 'application/json' })] },
    });
    await Promise.resolve();
  });
}

describe('a session file that cannot be loaded', () => {
  it('calls a file that is not JSON unreadable, without asking the server', async () => {
    const input = renderPicker();

    await choose(input, 'Chapter one. It was raining.');

    expect(
      await screen.findByText('That file is not a session export this build can read.'),
    ).toBeTruthy();
    expect(importSessionDocument).not.toHaveBeenCalled();
  });

  it('says which refusal the server sent, by its class', async () => {
    importSessionDocument.mockRejectedValue(
      new ApiError(422, 'wrong-schema', 'That file is not a session export.'),
    );
    const input = renderPicker();

    await choose(input, JSON.stringify({ schema: 'storyengine.lorebook/1' }));

    expect(await screen.findByText('That is a StoryEngine file of another kind.')).toBeTruthy();
  });
});

/**
 * ***A chat from SillyTavern or Marinara, through the same control*** —
 * [P13.8](../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * A `.jsonl` goes to the library's import, not the export's door, and comes
 * back as a review row; the row's `objectId` is the session to open.
 */
describe('a chat file', () => {
  const LINES = '{"chat_metadata":{}}\n{"name":"Vera","mes":"Hm."}';

  const IMPORTED = {
    key: 'import.chat.imported',
    params: { name: 'Vera', turns: 2 },
    level: 'info',
  };

  it('goes through the library’s import and opens the session it made', async () => {
    importChatFile.mockResolvedValue({
      item: {
        source: 'Vera.jsonl',
        disposition: 'converted',
        objectId: 'session-1',
        notes: [IMPORTED],
      },
      notes: [IMPORTED],
    });
    const input = renderPicker();

    await choose(input, LINES, 'Vera.jsonl');

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/play/$sessionId',
        params: { sessionId: 'session-1' },
      });
    });
    expect(importSessionDocument).not.toHaveBeenCalled();
  });

  it('says a chat already here is already here, in a chat’s words', async () => {
    const here = { key: 'import.chat.alreadyHere', params: {}, level: 'info' };
    importChatFile.mockResolvedValue({
      item: { source: 'Vera.jsonl', disposition: 'unchanged', notes: [here] },
      notes: [here],
    });
    const input = renderPicker();

    await choose(input, LINES, 'Vera.jsonl');

    expect(await screen.findByText(/That chat is already here as a session/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says a file that is not a chat is not one', async () => {
    importChatFile.mockResolvedValue({
      item: { source: 'Vera.jsonl', disposition: 'unrecognised', notes: [] },
      notes: [],
    });
    const input = renderPicker();

    await choose(input, 'not a chat', 'Vera.jsonl');

    expect(await screen.findByText('That file is not a chat this build can read.')).toBeTruthy();
  });

  it('says a chat that grew since its import was not loaded, and why', async () => {
    // [P13 §2.7]'s sync is P13.10a's: until then a grown chat is neither
    // already here nor a second copy, and it says so in its own words.
    const grown = {
      key: 'import.chat.grownSince',
      params: { chat: 'Vera', count: 1 },
      level: 'warn',
    };
    importChatFile.mockResolvedValue({
      item: { source: 'Vera.jsonl', disposition: 'recorded', notes: [grown] },
      notes: [grown],
    });
    const input = renderPicker();

    await choose(input, LINES, 'Vera.jsonl');

    expect(await screen.findByText(/has changed since/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens no session for a row the chat pass did not write', async () => {
    // A library object's id is not a session's; a row is a session only when
    // the chat pass says it made one.
    importChatFile.mockResolvedValue({
      item: { source: 'Vera.jsonl', disposition: 'converted', objectId: 'actor-1', notes: [] },
      notes: [],
    });
    const input = renderPicker();

    await choose(input, LINES, 'Vera.jsonl');

    expect(await screen.findByText('That file is not a chat this build can read.')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says what the import could not do before opening the session', async () => {
    const missing = {
      key: 'import.chat.speakerUnresolved',
      params: { name: 'Mira' },
      level: 'warn',
    };
    importChatFile.mockResolvedValue({
      item: {
        source: 'Vera.jsonl',
        disposition: 'converted',
        objectId: 'session-1',
        notes: [IMPORTED, missing],
      },
      notes: [IMPORTED, missing],
    });
    const input = renderPicker();

    await choose(input, LINES, 'Vera.jsonl');

    expect(await screen.findByText(/“Mira” is not in this library/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open the session' }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/play/$sessionId',
      params: { sessionId: 'session-1' },
    });
  });

  it('says why a chat was refused, rather than that it is not a chat', async () => {
    const refused = {
      key: 'import.chat.sessionRefused',
      params: { chat: 'Vera', reason: 'no-turns' },
      level: 'warn',
    };
    importChatFile.mockResolvedValue({
      item: { source: 'Vera.jsonl', disposition: 'unrecognised', notes: [refused] },
      notes: [refused],
    });
    const input = renderPicker();

    await choose(input, LINES, 'Vera.jsonl');

    expect(
      await screen.findByText('“Vera” could not be loaded as a session (no-turns).'),
    ).toBeTruthy();
    expect(screen.queryByText('That file is not a chat this build can read.')).toBeNull();
  });

  it('offers .jsonl in the picker, and says once how a re-import behaves until sync', () => {
    const input = renderPicker();

    expect(input.accept).toContain('.jsonl');
    expect(screen.getByText(/comes later/)).toBeTruthy();
  });
});
