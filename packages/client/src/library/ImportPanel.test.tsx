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
