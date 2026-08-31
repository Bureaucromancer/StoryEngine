// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api.js';
import { ImportPanel } from './ImportPanel.js';

/**
 * The review step, rendered ([P4 §1.4]).
 *
 * **The assertion that matters is that the server sends no prose.** It sends
 * `{ key, params, level }`, and this composes the sentence — which is what keeps
 * a report from being English frozen into a durable record ([06 A2d]). So the
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
    // The file is named as it arrived, relative to the root ([13 §4.1.1]).
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

  it('imports the file and names what was chosen', async () => {
    // The input is out of sight, so a chosen file that left no trace would be a
    // picker whose choice you cannot check before committing to it.
    vi.spyOn(api, 'importFile').mockResolvedValue({
      item: { source: 'Vera.png', disposition: 'converted', notes: [] },
      notes: [],
    });
    render(mount());

    expect(screen.getByText(/no file chosen/i)).toBeTruthy();

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, png());

    await waitFor(() => {
      // Twice, and both are wanted: the picker says what it is holding, and the
      // review says what became of it. One of them alone would be a gap.
      expect(screen.getAllByText('Vera.png')).toHaveLength(2);
    });
    expect(screen.queryByText(/no file chosen/i)).toBeNull();
    // Also twice: the counts summary and the row it counted.
    expect(screen.getAllByText('Imported')).toHaveLength(2);
  });

  it('says what went wrong rather than failing silently', async () => {
    vi.spyOn(api, 'importFile').mockRejectedValue(new Error('That file is too large.'));
    render(mount());

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, png());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('too large');
    });
  });
});
