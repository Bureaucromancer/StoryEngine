// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImportPreview } from '@storyengine/shared';

import { api, uploadFailure, type LibraryObject } from '../api.js';
import { useLibrary } from '../queries.js';
import { ImportPanel } from './ImportPanel.js';

/**
 * The review step, rendered ([P4 §1.4]).
 *
 * **The assertion that matters is that the server sends no prose.** It sends
 * `{ key, params, level }`, and this composes the sentence — which is what keeps
 * a report from being English frozen into a durable record ([25 A2d]). So the
 * tests here are mostly about the composition: that params reach the sentence,
 * and that a class this build has never heard of still renders as *something*,
 * because a record written by a newer build can arrive at an older client.
 */

function mount(): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ImportPanel />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('after a sweep', () => {
  it('composes each note from its key and params', async () => {
    vi.spyOn(api, 'importSweep').mockResolvedValue({
      suggestions: [],
      report: {
        jobId: 'job-1',
        source: 'sillytavern',
        counts: { converted: 2, unchanged: 1 },
        items: [
          {
            source: 'OpenAI Settings/Harbour.json',
            disposition: 'converted',
            notes: [
              {
                key: 'import.preset.credentialsRemoved',
                params: { fields: 'reverse_proxy, proxy_password' },
                level: 'warn',
              },
            ],
          },
        ],
      },
    });

    render(mount());
    await userEvent.type(screen.getByPlaceholderText(/full path/i), '/somewhere/data');
    await userEvent.click(screen.getByRole('button', { name: /import folder/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Removed connection fields: reverse_proxy, proxy_password\./),
      ).toBeTruthy();
    });
    // The file is named as it arrived, relative to the root ([21 §4.1.1]).
    expect(screen.getByText('OpenAI Settings/Harbour.json')).toBeTruthy();
  });

  it('shows the counts, so a large sweep is readable without reading every row', async () => {
    vi.spyOn(api, 'importSweep').mockResolvedValue({
      suggestions: [],
      report: {
        jobId: 'job-1',
        source: 'marinara',
        counts: { converted: 12, unchanged: 3, skipped: 40, credential: 1 },
        items: [],
      },
    });

    render(mount());
    await userEvent.type(screen.getByPlaceholderText(/full path/i), '/somewhere/data');
    await userEvent.click(screen.getByRole('button', { name: /import folder/i }));

    await waitFor(() => {
      expect(screen.getByText('Imported')).toBeTruthy();
    });
    // `unchanged` and `skipped` are different answers and both are shown.
    expect(screen.getByText('Already here')).toBeTruthy();
    expect(screen.getByText('Skipped')).toBeTruthy();
    expect(screen.getByText('Credential removed')).toBeTruthy();
  });

  it('renders a class it has never heard of as the word itself', async () => {
    // The open-map rule ([P3.0]): a newer build's disposition must not render as
    // a blank cell, which reads as *nothing happened to this file*.
    vi.spyOn(api, 'importSweep').mockResolvedValue({
      suggestions: [],
      report: {
        jobId: 'job-1',
        source: 'sillytavern',
        counts: { quarantined: 1 },
        items: [{ source: 'odd.json', disposition: 'quarantined', notes: [] }],
      },
    });

    render(mount());
    await userEvent.type(screen.getByPlaceholderText(/full path/i), '/somewhere/data');
    await userEvent.click(screen.getByRole('button', { name: /import folder/i }));

    await waitFor(() => {
      expect(screen.getAllByText('quarantined').length).toBeGreaterThan(0);
    });
  });

  it('keeps an unknown note key visible rather than dropping the row', async () => {
    vi.spyOn(api, 'importSweep').mockResolvedValue({
      suggestions: [],
      report: {
        jobId: 'job-1',
        source: 'sillytavern',
        counts: { converted: 1 },
        items: [
          {
            source: 'a.json',
            disposition: 'converted',
            notes: [{ key: 'import.something.new', params: {}, level: 'info' }],
          },
        ],
      },
    });

    render(mount());
    await userEvent.type(screen.getByPlaceholderText(/full path/i), '/somewhere/data');
    await userEvent.click(screen.getByRole('button', { name: /import folder/i }));

    await waitFor(() => {
      expect(screen.getByText('import.something.new')).toBeTruthy();
    });
  });

  it('says what went wrong rather than failing silently', async () => {
    vi.spyOn(api, 'importSweep').mockRejectedValue(
      new Error('That folder is inside this install’s own data directory.'),
    );

    render(mount());
    await userEvent.type(screen.getByPlaceholderText(/full path/i), '/somewhere/data');
    await userEvent.click(screen.getByRole('button', { name: /import folder/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('inside this install');
    });
  });
});

/**
 * ***An import leaves the shelf on screen*** — 2026-09-27.
 *
 * The refresh after an import was a `resetQueries`, which puts every library
 * entry back to *pending* before refetching it; `useLibrary` keeps no
 * placeholder, so the list beside this panel unmounted its table — and the sort,
 * filters and search set on it — to show *Loading…* for a list about to gain a
 * row. The refetch here is held open, so what the shelf shows *while* it runs is
 * what is asserted. Reddened by putting the reset back.
 */
describe('what an import leaves on screen', () => {
  function Shelf(): JSX.Element {
    const library = useLibrary();
    return (
      <p data-testid="shelf">
        {library.data === undefined
          ? 'Nothing to show'
          : library.data.objects.map((object) => object.name).join(', ')}
      </p>
    );
  }

  it('import refreshes the shelf without emptying it', async () => {
    const listLibrary = vi
      .spyOn(api, 'listLibrary')
      // Only the name is read, by the shelf above.
      .mockResolvedValueOnce({ objects: [{ name: 'Harbour' } as LibraryObject] })
      .mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, 'importSweep').mockResolvedValue({
      suggestions: [],
      report: { jobId: 'job-1', source: 'sillytavern', counts: { converted: 1 }, items: [] },
    });
    vi.spyOn(api, 'importJobs').mockResolvedValue({ jobs: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Shelf />
        <ImportPanel />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('shelf').textContent).toBe('Harbour');
    });

    await userEvent.type(screen.getByPlaceholderText(/full path/i), '/somewhere/data');
    await userEvent.click(screen.getByRole('button', { name: /import folder/i }));
    await waitFor(() => {
      expect(screen.getByText('Imported')).toBeTruthy();
    });

    // The refetch was asked for, and the shelf kept what it had while it runs.
    await waitFor(() => {
      expect(listLibrary).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId('shelf').textContent).toBe('Harbour');
  });
});

describe('checking the folder before importing from it', () => {
  /** One near miss, shaped as the route sends it. */
  const installRoot = {
    verdict: 'loose-files',
    suggestions: [
      {
        situation: 'sillytavern-install-root' as const,
        suggest: 'data/default-user',
        root: '/home/bob/SillyTavern/data/default-user',
        leadsTo: 'sillytavern' as const,
        confidence: 'verified' as const,
        note: {
          key: 'import.root.sillytavernBelow',
          params: { path: 'data/default-user' },
          level: 'warn' as const,
        },
      },
    ],
  };

  it('asks what the folder is when the box loses focus, not on every keystroke', async () => {
    // A check is up to thirty-six `stat` calls on somebody else's filesystem.
    // Typing a path is not thirty-six questions.
    const inspect = vi.spyOn(api, 'importInspect').mockResolvedValue({
      verdict: 'sillytavern',
      suggestions: [],
    });
    render(mount());

    await userEvent.type(screen.getByPlaceholderText(/full path/i), '/home/bob/st');
    expect(inspect).not.toHaveBeenCalled();

    await userEvent.tab();
    await waitFor(() => {
      expect(inspect).toHaveBeenCalledWith('/home/bob/st');
    });
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('composes the advice from its key and params, like every other note', async () => {
    vi.spyOn(api, 'importInspect').mockResolvedValue(installRoot);
    render(mount());

    await userEvent.type(screen.getByPlaceholderText(/full path/i), '/home/bob/SillyTavern');
    await userEvent.tab();

    await waitFor(() => {
      expect(screen.getByText(/The library is in data\/default-user/)).toBeTruthy();
    });
  });

  it('puts the suggested folder in the box and checks it again', async () => {
    const inspect = vi
      .spyOn(api, 'importInspect')
      .mockResolvedValueOnce(installRoot)
      .mockResolvedValueOnce({ verdict: 'sillytavern', suggestions: [] });
    render(mount());

    const box = screen.getByPlaceholderText<HTMLInputElement>(/full path/i);
    await userEvent.type(box, '/home/bob/SillyTavern');
    await userEvent.tab();
    await userEvent.click(await screen.findByRole('button', { name: /use that folder/i }));

    await waitFor(() => {
      expect(box.value).toBe('/home/bob/SillyTavern/data/default-user');
    });
    expect(inspect).toHaveBeenLastCalledWith('/home/bob/SillyTavern/data/default-user');
    // The advice is about the old path and must not outlive it.
    expect(screen.queryByRole('button', { name: /use that folder/i })).toBeNull();
  });

  it('drops the advice as soon as the path changes under it', async () => {
    vi.spyOn(api, 'importInspect').mockResolvedValue(installRoot);
    render(mount());

    const box = screen.getByPlaceholderText(/full path/i);
    await userEvent.type(box, '/home/bob/SillyTavern');
    await userEvent.tab();
    await screen.findByRole('button', { name: /use that folder/i });

    await userEvent.type(box, '/elsewhere');
    expect(screen.queryByRole('button', { name: /use that folder/i })).toBeNull();
  });

  it('says what should have been pointed at after a sweep that found the wrong folder', async () => {
    // The sweep succeeded. Nothing in the report says the wrong folder was
    // named, which is exactly why the advice has to arrive with it.
    vi.spyOn(api, 'importSweep').mockResolvedValue({
      report: {
        jobId: 'job-1',
        source: 'loose-files',
        items: [],
        counts: { converted: 0 },
      },
      suggestions: installRoot.suggestions,
    });
    render(mount());

    await userEvent.type(screen.getByPlaceholderText(/full path/i), '/home/bob/SillyTavern');
    await userEvent.click(screen.getByRole('button', { name: /import folder/i }));

    await waitFor(() => {
      expect(screen.getByText(/The library is in data\/default-user/)).toBeTruthy();
    });
  });
});

describe('a look and a sweep in flight together', () => {
  it('keeps the sweep’s answer when the look it raced resolves last', async () => {
    // Clicking *Import folder* blurs the path box, so this is not a contrived
    // ordering — it is what happens every time somebody imports. Without a
    // guard the slower request wins, and a look that resolves after the sweep
    // replaces the sweep's advice with an answer about the folder as it was
    // before anything was imported.
    // Assigned synchronously by the Promise executor below, before any await.
    let releaseLook!: (value: { verdict: string; suggestions: never[] }) => void;
    vi.spyOn(api, 'importInspect').mockReturnValue(
      new Promise((resolve) => {
        releaseLook = resolve;
      }),
    );
    vi.spyOn(api, 'importSweep').mockResolvedValue({
      report: {
        jobId: 'job-1',
        source: 'loose-files',
        items: [],
        counts: { converted: 0 },
      },
      suggestions: [
        {
          situation: 'sillytavern-install-root',
          suggest: 'data/default-user',
          root: '/home/bob/SillyTavern/data/default-user',
          leadsTo: 'sillytavern',
          confidence: 'verified',
          note: {
            key: 'import.root.sillytavernBelow',
            params: { path: 'data/default-user' },
            level: 'warn',
          },
        },
      ],
    });

    render(mount());
    await userEvent.type(screen.getByPlaceholderText(/full path/i), '/home/bob/SillyTavern');
    await userEvent.click(screen.getByRole('button', { name: /import folder/i }));

    await waitFor(() => {
      expect(screen.getByText(/The library is in data\/default-user/)).toBeTruthy();
    });

    // The look now answers, too late to matter.
    releaseLook({ verdict: 'sillytavern', suggestions: [] });
    await waitFor(() => {
      expect(screen.getByText(/The library is in data\/default-user/)).toBeTruthy();
    });
    expect(screen.queryByText(/Ready to import/)).toBeNull();
  });
});

/**
 * The file chooser, which is now a button ([P4 §7.12]).
 *
 * `<input type="file">` renders as the user agent's own widget — grey, unlike
 * everything else here, and reading as text rather than as something to press.
 * The input stays for the dialog and the accessible name; the button drives it.
 * There was no test for this path at all before.
 */
/**
 * What the server would say about one hand-picked preset.
 *
 * A whole  rather than a partial one, because the component
 * branches on four of its fields and a fixture that omitted them would pass by
 * rendering nothing.  is here for the one reason that matters: it is a
 * setting that converts, is stored, is shown, and never reaches a model.
 */
const PREVIEW: ImportPreview = {
  source: 'Harbour.json',
  disposition: 'converted',
  notes: [{ key: 'import.preset.paramsCarried', params: { count: 2 }, level: 'info' }],
  advisories: [
    {
      key: 'import.preset.samplerNotForwarded',
      params: { fields: 'minP', count: 1 },
      level: 'warn',
    },
  ],
  object: {
    kind: 'preset',
    name: 'Harbour',
    blocks: [
      {
        id: 'st.main',
        label: 'Main Prompt',
        kind: 'text',
        role: 'system',
        enabled: true,
        at: 'sequence',
        appliesTo: [],
      },
      {
        id: 'st.chatHistory',
        label: 'Chat History',
        kind: 'slot',
        role: 'system',
        enabled: true,
        at: 'sequence',
        fills: 'history',
        appliesTo: [],
      },
    ],
    params: [
      { name: 'temperature', value: 0.9, reaches: true },
      { name: 'minP', value: 0.05, reaches: false },
    ],
    maxContextTokens: 8192,
    preferredModelIds: ['gpt-4'],
    compatKeys: ['chat_completion_source'],
  },
  reimport: 'new',
};

describe('choosing one file', () => {
  const png = () => new File([new Uint8Array([1, 2, 3])], 'Vera.png', { type: 'image/png' });

  it('offers a button, and keeps the input reachable behind it', () => {
    render(mount());

    expect(screen.getByRole('button', { name: /choose a file/i })).toBeTruthy();
    // Still an input, still labelled — `sr-only` hides it from sight, not from
    // assistive technology, and removing it would take the file dialog with it.
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.className).toContain('sr-only');
  });

  it('looks at the file first, and imports nothing until the word is given', async () => {
    // The behaviour this stage changed. Choosing a file used to import it; it
    // now asks. `importFile` not being called is the assertion — everything
    // else on this screen is presentation.
    const preview = vi.spyOn(api, 'importFilePreview').mockResolvedValue({ preview: PREVIEW });
    const commit = vi.spyOn(api, 'importFile');
    render(mount());

    expect(screen.getByText(/no file chosen/i)).toBeTruthy();

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, png());

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^import$/i })).toBeTruthy();
    });
    expect(preview).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    // The picker still says what it is holding.
    expect(screen.queryByText(/no file chosen/i)).toBeNull();
  });

  it('imports on the word, and then shows what happened', async () => {
    vi.spyOn(api, 'importFilePreview').mockResolvedValue({ preview: PREVIEW });
    const commit = vi.spyOn(api, 'importFile').mockResolvedValue({
      item: { source: 'Harbour.json', disposition: 'converted', notes: [] },
      notes: [],
    });
    render(mount());

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, png());
    await userEvent.click(await screen.findByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Imported').length).toBeGreaterThan(0);
    });
    expect(commit).toHaveBeenCalledTimes(1);
    // The preview is gone: one union, so the two cannot both be on screen.
    expect(screen.queryByRole('button', { name: /^import$/i })).toBeNull();
  });

  it('cancels without writing anything', async () => {
    vi.spyOn(api, 'importFilePreview').mockResolvedValue({ preview: PREVIEW });
    const commit = vi.spyOn(api, 'importFile');
    render(mount());

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, png());
    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^import$/i })).toBeNull();
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('marks a sampler setting that does not reach the model, in a word', async () => {
    // Not a colour. Somebody reading this in greyscale still has to be told that
    // a setting they can see does nothing.
    vi.spyOn(api, 'importFilePreview').mockResolvedValue({ preview: PREVIEW });
    render(mount());

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, png());

    expect(await screen.findByText('not sent')).toBeTruthy();
  });

  it('renders the advisory with both of its parameters substituted', async () => {
    vi.spyOn(api, 'importFilePreview').mockResolvedValue({ preview: PREVIEW });
    render(mount());

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, png());

    expect(
      await screen.findByText(
        /1 of them are stored but do not reach the model in this build: minP./,
      ),
    ).toBeTruthy();
  });

  it('offers replace or keep both only when the file has been here before', async () => {
    vi.spyOn(api, 'importFilePreview').mockResolvedValue({ preview: PREVIEW });
    const { unmount } = render(mount());

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, png());
    await screen.findByRole('button', { name: /^import$/i });
    expect(screen.queryByLabelText(/what to do with the one already here/i)).toBeNull();
    unmount();

    vi.spyOn(api, 'importFilePreview').mockResolvedValue({
      preview: { ...PREVIEW, reimport: 'changed' },
    });
    const commit = vi.spyOn(api, 'importFile').mockResolvedValue({
      item: { source: 'Harbour.json', disposition: 'converted', notes: [] },
      notes: [],
    });
    render(mount());

    const second = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(second, png());

    const choice = await screen.findByLabelText(/what to do with the one already here/i);
    await userEvent.selectOptions(choice, 'keep-both');
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      // The policy, not the call's shape. `importFile` grew a third argument for
      // the destination — `undefined` on a file with no choice in it — and an
      // arity-exact assertion here would fail on every later argument too, which
      // is not what this test is about.
      expect(commit.mock.calls[0]?.[1]).toBe('keep-both');
    });
  });

  it('says what went wrong rather than failing silently', async () => {
    vi.spyOn(api, 'importFilePreview').mockRejectedValue(new Error('That file is too large.'));
    render(mount());

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, png());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('too large');
    });
  });
});

/**
 * ***An archive, and a large upload*** —
 * [P13.8](../../../../docs/design/workplan/30-p13-aventuras-import.md)'s client
 * half. An archive or a database is looked at here from its first bytes and
 * not sent for a preview; the word's upload shows how far it has got; and a
 * failure with no word of ours in it reaches the person as a sentence.
 */
describe('an archive, and a large upload', () => {
  const zip = () =>
    new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], 'aventura-backup.zip', {
      type: 'application/zip',
    });
  const database = () =>
    new File([new TextEncoder().encode('SQLite format 3\0 and its pages')], 'aventura.db');
  const input = (): HTMLInputElement =>
    document.querySelector<HTMLInputElement>('input[type="file"]')!;

  it('looks at an archive without sending it, and says it imports as a folder', async () => {
    const preview = vi.spyOn(api, 'importFilePreview');
    render(mount());

    await userEvent.upload(input(), zip());

    expect(await screen.findByText(/Everything inside would be imported\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^import$/i })).toBeTruthy();
    expect(preview).not.toHaveBeenCalled();
  });

  it('does the same for a bare database, by its bytes and not its name', async () => {
    const preview = vi.spyOn(api, 'importFilePreview');
    render(mount());

    await userEvent.upload(input(), database());

    expect(await screen.findByText(/Everything inside would be imported\./)).toBeTruthy();
    expect(preview).not.toHaveBeenCalled();
  });

  it('shows every row of an archive’s review, so a second upload reads unchanged row by row', async () => {
    // [P13.7]: the answer's one-row summary named the first converted row, and
    // for a re-upload of the same backup a `recorded` row for the zip — the
    // review a sweep of the folder gives was nowhere on screen.
    vi.spyOn(api, 'importFile').mockResolvedValue({
      item: { source: 'aventura-backup.zip', disposition: 'recorded', notes: [] },
      notes: [],
      report: {
        jobId: 'unsaved',
        source: 'aventuras',
        items: [
          { source: 'aventura.db/lorebook_vault/book-1', disposition: 'unchanged', notes: [] },
          { source: 'aventura.db/character_vault/char-1', disposition: 'unchanged', notes: [] },
        ],
        counts: { unchanged: 2 },
      },
    });
    render(mount());

    await userEvent.upload(input(), zip());
    await userEvent.click(await screen.findByRole('button', { name: /^import$/i }));

    expect(await screen.findByText('aventura.db/lorebook_vault/book-1')).toBeTruthy();
    expect(screen.getByText('aventura.db/character_vault/char-1')).toBeTruthy();
    // The summary row is not the review: the file's name stays a label above
    // it, and is not a row of what happened.
    const rows = [...document.querySelectorAll('section[aria-label="What happened"] code')];
    expect(rows.map((row) => row.textContent)).toEqual([
      'aventura.db/lorebook_vault/book-1',
      'aventura.db/character_vault/char-1',
    ]);
  });

  it('shows how far the upload has got, and then that it is being read', async () => {
    let report: ((progress: { sent: number; total: number }) => void) | undefined;
    const commit = vi
      .spyOn(api, 'importFile')
      .mockImplementation((file, onConflict, destination, onProgress) => {
        report = onProgress;
        return new Promise(() => undefined);
      });
    render(mount());

    await userEvent.upload(input(), zip());
    await userEvent.click(await screen.findByRole('button', { name: /^import$/i }));
    await waitFor(() => {
      expect(commit).toHaveBeenCalledTimes(1);
    });

    act(() => {
      report?.({ sent: 25 * 1024 * 1024, total: 100 * 1024 * 1024 });
    });
    expect(await screen.findByText(/Sending… 25% of 100 MB/)).toBeTruthy();

    act(() => {
      report?.({ sent: 100 * 1024 * 1024, total: 100 * 1024 * 1024 });
    });
    expect(await screen.findByText(/Sent\. Reading it into your library…/)).toBeTruthy();
  });

  it('says what a dropped connection may mean, rather than that the file was bad', async () => {
    vi.spyOn(api, 'importFile').mockRejectedValue(uploadFailure(0, null));
    render(mount());

    await userEvent.upload(input(), zip());
    await userEvent.click(await screen.findByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/connection was lost/);
    });
    // The meter is gone with the upload.
    expect(screen.queryByText(/Sending…/)).toBeNull();
  });

  it('says a proxy’s refusal is a proxy’s', async () => {
    vi.spyOn(api, 'importFile').mockRejectedValue(uploadFailure(413, null));
    render(mount());

    await userEvent.upload(input(), zip());
    await userEvent.click(await screen.findByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/reverse proxy/);
    });
  });
});

/**
 * ***Answers that arrive after the question changed*** (2026-09-27).
 *
 * Every request here writes the one outcome slot when it lands, and a person
 * can change the question in the meantime: cancel a preview while its other
 * reading is being asked for, pick a file while an earlier report is being
 * fetched. Each answer used to be written whatever had happened since, so a
 * cancelled question came back and a report replaced a question being asked.
 */
describe('answers that arrive after the question changed', () => {
  const fileInput = (): HTMLInputElement => {
    const found = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (found === null) throw new Error('no file input');
    return found;
  };
  const png = (): File => new File([new Uint8Array([1, 2, 3])], 'Vera.png', { type: 'image/png' });

  const scenario = {
    kind: 'scenario' as const,
    name: 'Rain City',
    blurb: 'A city where it always rains.',
    framingChars: 420,
    cast: ['Vera'],
    openings: 1,
    destination: 'treatment' as const,
    alternatives: ['treatment' as const, 'lorebook' as const],
  };
  const SCENARIO: ImportPreview = {
    source: 'Rain City.json',
    disposition: 'converted',
    notes: [],
    advisories: [],
    object: scenario,
    reimport: 'new',
  };

  const JOB = {
    id: 'job-1',
    root: '/imports/last-week',
    source: 'sillytavern',
    status: 'finished' as const,
    createdAt: 0,
    finishedAt: 1,
    counts: { converted: 3 },
  };

  it('stays cancelled when the other reading arrives after Cancel', async () => {
    let second: (value: { preview: ImportPreview }) => void = () => undefined;
    vi.spyOn(api, 'importFilePreview')
      .mockResolvedValueOnce({ preview: SCENARIO })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            second = resolve;
          }),
      );
    render(mount());

    await userEvent.upload(fileInput(), new File(['{}'], 'Rain City.json'));
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'What this should become' }),
      'lorebook',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => {
      second({ preview: { ...SCENARIO, object: { ...scenario, destination: 'lorebook' } } });
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', { name: /^import$/i })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'What this should become' })).toBeNull();
  });

  /** The same rule its twin above keeps: nothing chosen while a request is on its way. */
  it('holds the conflict choice still while the import is on its way', async () => {
    vi.spyOn(api, 'importFilePreview').mockResolvedValue({
      preview: { ...PREVIEW, reimport: 'changed' },
    });
    vi.spyOn(api, 'importFile').mockImplementation(() => new Promise(() => undefined));
    render(mount());

    await userEvent.upload(fileInput(), png());
    const choice = await screen.findByRole('combobox', {
      name: 'What to do with the one already here',
    });
    expect(choice).toHaveProperty('disabled', false);
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

    expect(choice).toHaveProperty('disabled', true);
  });

  it('does not let a report opened earlier replace a preview asked for since', async () => {
    vi.spyOn(api, 'importJobs').mockResolvedValue({ jobs: [JOB] });
    let arrive: (value: Awaited<ReturnType<typeof api.importJob>>) => void = () => undefined;
    vi.spyOn(api, 'importJob').mockImplementation(
      () =>
        new Promise((resolve) => {
          arrive = resolve;
        }),
    );
    vi.spyOn(api, 'importFilePreview').mockResolvedValue({ preview: PREVIEW });
    render(mount());

    await userEvent.click(await screen.findByRole('button', { name: '/imports/last-week' }));
    await userEvent.upload(fileInput(), png());
    await screen.findByRole('button', { name: /^import$/i });
    await act(async () => {
      arrive({ report: { jobId: 'job-1', source: 'sillytavern', items: [], counts: {} } });
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: /^import$/i })).toBeTruthy();
  });

  it('offers no earlier report while a preview waits for its answer', async () => {
    vi.spyOn(api, 'importJobs').mockResolvedValue({ jobs: [JOB] });
    vi.spyOn(api, 'importFilePreview').mockResolvedValue({ preview: PREVIEW });
    render(mount());

    const earlier = await screen.findByRole('button', { name: '/imports/last-week' });
    await userEvent.upload(fileInput(), png());
    await screen.findByRole('button', { name: /^import$/i });

    expect(earlier).toHaveProperty('disabled', true);
  });

  it('says so when an earlier report cannot be opened', async () => {
    vi.spyOn(api, 'importJobs').mockResolvedValue({ jobs: [JOB] });
    vi.spyOn(api, 'importJob').mockRejectedValue(new Error('That import is no longer on record.'));
    render(mount());

    await userEvent.click(await screen.findByRole('button', { name: '/imports/last-week' }));

    expect(await screen.findByText('That import is no longer on record.')).toBeTruthy();
  });
});

/**
 * ***Stories are asked for, each time*** —
 * [P13.11](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * The server writes no session unless the request says `stories`
 * (`SweepRequest.stories` has why), so what the panel owes is that the
 * question reaches the request when it is ticked, and only then.
 */
describe('bringing Aventuras stories across', () => {
  const empty = {
    suggestions: [],
    report: { jobId: 'job-s', source: 'aventuras', counts: {}, items: [] },
  };

  it('does not ask unless the box is ticked', async () => {
    const sweep = vi.spyOn(api, 'importSweep').mockResolvedValue(empty);

    render(mount());
    const box = screen.getByRole('checkbox', { name: /aventuras stories/i });
    expect((box as HTMLInputElement).checked).toBe(false);
    await userEvent.type(screen.getByPlaceholderText(/full path/i), '/somewhere/aventura');
    await userEvent.click(screen.getByRole('button', { name: /import folder/i }));

    await waitFor(() => {
      expect(sweep).toHaveBeenCalledWith('/somewhere/aventura', undefined, false);
    });
  });

  it('asks when it is', async () => {
    const sweep = vi.spyOn(api, 'importSweep').mockResolvedValue(empty);

    render(mount());
    await userEvent.click(screen.getByRole('checkbox', { name: /aventuras stories/i }));
    await userEvent.type(screen.getByPlaceholderText(/full path/i), '/somewhere/aventura');
    await userEvent.click(screen.getByRole('button', { name: /import folder/i }));

    await waitFor(() => {
      expect(sweep).toHaveBeenCalledWith('/somewhere/aventura', undefined, true);
    });
  });
});

/**
 * ***A folder with chats in it asks first*** —
 * [P14.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * Chats are most of a SillyTavern tree's bytes, so the browser upload leaves
 * them out unless the person says otherwise — and says what saying otherwise
 * would send. Off by default; the size is on the question.
 */
describe('a folder with chats in it', () => {
  /** A picked file, as the browser hands it over: its path leads with the folder's name. */
  function picked(path: string, bytes = 3): File {
    const file = new File([new Uint8Array(bytes)], path.split('/').pop() ?? path);
    Object.defineProperty(file, 'webkitRelativePath', { value: `default-user/${path}` });
    return file;
  }

  const FILES = (): File[] => [
    picked('settings.json'),
    picked('characters/Vera.png'),
    picked('chats/Vera/2026-01-01.jsonl'),
  ];

  /** A plan whose chats all fit, unless `fit` says otherwise. */
  function plan(
    chats: { count: number; bytes: number },
    wanted: string[],
    fit: { count: number; bytes: number } = chats,
    overLimit: string[] = [],
  ) {
    return {
      verdict: 'sillytavern',
      suggestions: [],
      wanted,
      declared: [],
      wantedBytes: 0,
      limitBytes: 64 * 1024 * 1024,
      chats: { ...chats, fit },
      overLimit,
    };
  }

  const REPORT = { report: { jobId: 'job-1', source: 'sillytavern', items: [], counts: {} } };

  async function chooseFolder(files: File[]): Promise<void> {
    const input = document.querySelector<HTMLInputElement>('#import-folder');
    if (input === null) throw new Error('no folder input');
    await act(async () => {
      fireEvent.change(input, { target: { files } });
      await Promise.resolve();
    });
  }

  it('sends nothing until asked, and says how large the chats are', async () => {
    vi.spyOn(api, 'importDirectoryPlan').mockResolvedValue(
      plan({ count: 1, bytes: 2_500_000 }, ['settings.json', 'characters/Vera.png']),
    );
    const upload = vi.spyOn(api, 'importDirectory').mockResolvedValue(REPORT);
    render(mount());

    await chooseFolder(FILES());

    expect(await screen.findByText(/This folder holds one chat, 2\.4 MB/)).toBeTruthy();
    const box = screen.getByRole('checkbox', { name: 'Also import the chats (2.4 MB)' });
    expect(box).toHaveProperty('checked', false);
    expect(upload).not.toHaveBeenCalled();
  });

  it('leaves the chats out when the box is left alone, and says so to the server', async () => {
    vi.spyOn(api, 'importDirectoryPlan').mockResolvedValue(
      plan({ count: 1, bytes: 400 }, ['settings.json', 'characters/Vera.png']),
    );
    const upload = vi.spyOn(api, 'importDirectory').mockResolvedValue(REPORT);
    render(mount());

    await chooseFolder(FILES());
    await userEvent.click(await screen.findByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(1);
    });
    const [manifest, carried, , , chats] = upload.mock.calls[0] ?? [];
    expect(manifest).toEqual([
      'settings.json',
      'characters/Vera.png',
      'chats/Vera/2026-01-01.jsonl',
    ]);
    expect(carried?.map((entry) => entry.path)).toEqual(['settings.json', 'characters/Vera.png']);
    expect(chats).toBe('skip');
  });

  it('asks the server to plan them in when chosen, and sends them', async () => {
    const planned = vi
      .spyOn(api, 'importDirectoryPlan')
      .mockResolvedValueOnce(
        plan({ count: 1, bytes: 400 }, ['settings.json', 'characters/Vera.png']),
      )
      .mockResolvedValueOnce(
        plan({ count: 1, bytes: 400 }, [
          'settings.json',
          'characters/Vera.png',
          'chats/Vera/2026-01-01.jsonl',
        ]),
      );
    const upload = vi.spyOn(api, 'importDirectory').mockResolvedValue(REPORT);
    render(mount());

    await chooseFolder(FILES());
    await userEvent.click(await screen.findByRole('checkbox', { name: /also import the chats/i }));
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(1);
    });
    expect(planned.mock.calls[1]?.[1]).toBe(true);
    const [, carried, , , chats] = upload.mock.calls[0] ?? [];
    expect(carried?.map((entry) => entry.path)).toContain('chats/Vera/2026-01-01.jsonl');
    expect(chats).toBe('include');
  });

  it('asks nothing of a folder with no chats, and sends it straight away', async () => {
    vi.spyOn(api, 'importDirectoryPlan').mockResolvedValue(
      plan({ count: 0, bytes: 0 }, ['settings.json', 'characters/Vera.png']),
    );
    const upload = vi.spyOn(api, 'importDirectory').mockResolvedValue(REPORT);
    render(mount());

    await chooseFolder([picked('settings.json'), picked('characters/Vera.png')]);

    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('checkbox', { name: /also import the chats/i })).toBeNull();
  });

  it('says, before the choice, how many chats the upload limit will carry', async () => {
    vi.spyOn(api, 'importDirectoryPlan').mockResolvedValue(
      plan({ count: 3, bytes: 3_000_000 }, ['settings.json', 'characters/Vera.png'], {
        count: 1,
        bytes: 1_048_576,
      }),
    );
    vi.spyOn(api, 'importDirectory').mockResolvedValue(REPORT);
    render(mount());

    await chooseFolder(FILES());

    expect(
      await screen.findByText(/1 of these 3 chats fit under this server’s 64 MB upload limit/),
    ).toBeTruthy();
    // The size on the choice is what the choice will send, not the total.
    expect(screen.getByRole('checkbox', { name: 'Also import the chats (1.0 MB)' })).toBeTruthy();
  });

  /**
   * ***A folder the limit will not carry whole is asked about too***
   * (2026-09-28). The files it leaves out were always named and not sent; the
   * review then called them unreadable. Said before sending now, while the
   * server-path sweep is still an option, and handed back so the review names
   * the limit.
   */
  it('says before sending what the upload limit leaves out, and tells the server', async () => {
    vi.spyOn(api, 'importDirectoryPlan').mockResolvedValue(
      plan({ count: 0, bytes: 0 }, ['settings.json'], undefined, ['characters/Vera.png']),
    );
    const upload = vi.spyOn(api, 'importDirectory').mockResolvedValue(REPORT);
    render(mount());

    await chooseFolder([picked('settings.json'), picked('characters/Vera.png')]);

    expect(
      await screen.findByText(
        /One file in this folder does not fit under this server’s 64 MB upload limit/,
      ),
    ).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    // No chats in it, so no choice about them.
    expect(screen.queryByRole('checkbox', { name: /also import the chats/i })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(1);
    });
    const [, carried, , , chats, overLimit] = upload.mock.calls[0] ?? [];
    expect(carried?.map((entry) => entry.path)).toEqual(['settings.json']);
    expect(chats).toBeUndefined();
    expect(overLimit).toEqual(['characters/Vera.png']);
  });

  it('says once how a re-import behaves until sync', () => {
    render(mount());

    expect(screen.getAllByText(/comes later/)).toHaveLength(1);
  });
});
