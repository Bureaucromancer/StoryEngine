// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  importSessionDocument: (...a: unknown[]) => importSessionDocument(...a) as unknown,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
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

async function choose(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(input, {
      target: { files: [new File([text], 'story.json', { type: 'application/json' })] },
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

  /** [P13.10]'s new class: a file whose turns name a parent it does not hold. */
  it('says a broken tree is one', async () => {
    importSessionDocument.mockRejectedValue(new ApiError(422, 'broken-tree', 'broken-tree'));
    const input = renderPicker();

    await choose(input, JSON.stringify({ schema: 'storyengine.session-export/1' }));

    expect(
      await screen.findByText(
        'That export’s turns do not make a story: one names a turn before it that is not in the file.',
      ),
    ).toBeTruthy();
  });
});
