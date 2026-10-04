// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The import flow — [P12.10](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***What is asserted here is what the component decides***, per
 * `Backups.test.tsx`'s rule: rendering a list the server sent works nothing out.
 * Five things here are decisions, and each would be **silently** wrong rather
 * than visibly broken — which is the worst kind of wrong for a surface that
 * writes into a live account.
 *
 * - **Every optional group defaults off**, so an archive somebody was handed
 *   does not install their provider keys into the account importing it.
 * - **The conflict policy defaults to `skip`**, which contradicts `sweep`'s own
 *   default one module over and would revert to it invisibly.
 * - **The handle offered is the archive's**, not this install's — an account
 *   here that the archive has nothing for is not a choice.
 * - **The account half sends no handle at all**, because a person may only read
 *   their own subtree; the route refuses otherwise and this is the half that
 *   keeps them from meeting that refusal.
 * - **It takes two clicks**, because this writes.
 */

const readMineManifest = vi.fn();
const readInstallManifest = vi.fn();
const importMine = vi.fn();
const importInstall = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  backupApi: {
    readMineManifest: (...a: unknown[]) => readMineManifest(...a) as unknown,
    readInstallManifest: (...a: unknown[]) => readInstallManifest(...a) as unknown,
    importMine: (...a: unknown[]) => importMine(...a) as unknown,
    importInstall: (...a: unknown[]) => importInstall(...a) as unknown,
  },
}));

const { ApiError } = await import('../api.js');
const { ImportBackup } = await import('./ImportBackup.js');
const { formatTimestamp } = await import('../format.js');

const ID = '0199aa33-7c41-7b0e-9d1a-4f2c8e5a1b60';

const ROW = {
  id: ID,
  scope: 'account' as const,
  handle: 'ned',
  contents: 'full' as const,
  takenAt: 1_790_000_000_000,
  bytes: 184_320,
};

const MANIFEST = {
  scope: 'account' as const,
  handle: 'ned',
  contents: 'full' as const,
  takenBy: { version: '1.0.0-alpha.1', at: '2026-09-20T10:00:00.000Z' },
  reason: 'manual' as const,
  files: 42,
  bytes: 184_320,
  unpackedBytes: 512_000,
  handles: ['ned'],
  omitted: [],
};

const RESULT = {
  report: { jobId: 'j1', source: 'backup', items: [], counts: { converted: 3 } },
  sessions: { imported: 2, skipped: 0 },
  tags: { added: 1, kept: 0 },
  notes: [{ key: 'import.backup.prefsNotTaken', params: {}, level: 'info' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  readMineManifest.mockResolvedValue({ manifest: MANIFEST });
  readInstallManifest.mockResolvedValue({
    manifest: { ...MANIFEST, scope: 'install', handle: null, handles: ['ned', 'ada'] },
  });
  importMine.mockResolvedValue(RESULT);
  importInstall.mockResolvedValue(RESULT);
});

function renderFlow(
  scope: 'account' | 'install',
  rows = [ROW],
  locale: string | undefined = 'en-US',
): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ImportBackup scope={scope} rows={rows} locale={locale} />
    </QueryClientProvider>,
  );
}

/** Picks the archive, and waits for the manifest the rest of the form hangs on. */
async function choose(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.selectOptions(screen.getByLabelText('Which backup'), ID);
  await waitFor(() => {
    expect(screen.getByLabelText('When something is already here')).toBeTruthy();
  });
}

/**
 * ***Why it did not run, by the class*** (2026-09-27). The panel searched the
 * route's English, and two refusals that say what is wrong fell through it:
 * an archive that does not hold the account asked for, and one bigger than an
 * import reads at once — which was the likelier of the two to be called
 * unreadable, and is not. Reddened by putting the search back.
 */
describe('an import the server refused', () => {
  async function runIt(): Promise<void> {
    const user = userEvent.setup();
    renderFlow('account');
    await choose(user);
    await user.click(screen.getByRole('button', { name: 'Import from this backup' }));
    await user.click(screen.getByRole('button', { name: 'Import it' }));
  }

  it('says the archive does not hold that account', async () => {
    importMine.mockRejectedValue(
      new ApiError(422, 'unreadable-root', 'That archive does not hold the account you asked for.'),
    );
    await runIt();

    expect(
      await screen.findByText('That archive does not hold the account you asked for.'),
    ).toBeTruthy();
  });

  it('says an archive is too big to read at once, not that it is unreadable', async () => {
    importMine.mockRejectedValue(new ApiError(422, 'too-large', 'Too big.'));
    await runIt();

    expect(
      await screen.findByText('That archive holds more than an import reads in one go.'),
    ).toBeTruthy();
  });
});

describe('importing from a backup', () => {
  it('offers nothing at all when there are no archives', () => {
    renderFlow('account', []);
    expect(screen.queryByText('Import from a backup')).toBeNull();
  });

  it('reads the archive before it offers the controls', async () => {
    const user = userEvent.setup();
    renderFlow('account');

    // Nothing has been asked of the server yet: choosing is what asks.
    expect(readMineManifest).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('When something is already here')).toBeNull();

    await choose(user);
    expect(readMineManifest).toHaveBeenCalledWith(ID);
    expect(screen.getByText(/It holds 42 files/)).toBeTruthy();
  });

  it('sends every optional group off, and skip, when nothing is ticked', async () => {
    const user = userEvent.setup();
    renderFlow('account');
    await choose(user);

    await user.click(screen.getByRole('button', { name: 'Import from this backup' }));
    await user.click(screen.getByRole('button', { name: 'Import it' }));

    await waitFor(() => {
      expect(importMine).toHaveBeenCalledTimes(1);
    });
    const [body] = importMine.mock.calls[0] as [Record<string, unknown>];
    expect(body['onConflict']).toBe('skip');
    expect(body['options']).toEqual({});
    // A person may only read their own subtree, so this half never says whose.
    expect(body['handle']).toBeUndefined();
  });

  it('takes two clicks, and the first one commits nothing', async () => {
    const user = userEvent.setup();
    renderFlow('account');
    await choose(user);

    await user.click(screen.getByRole('button', { name: 'Import from this backup' }));
    expect(importMine).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(importMine).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Import from this backup' })).toBeTruthy();
  });

  it('carries the ticked groups and the chosen policy', async () => {
    const user = userEvent.setup();
    renderFlow('account');
    await choose(user);

    await user.click(screen.getByLabelText('Provider connections'));
    await user.selectOptions(screen.getByLabelText('When something is already here'), 'replace');
    await user.click(screen.getByRole('button', { name: 'Import from this backup' }));
    await user.click(screen.getByRole('button', { name: 'Import it' }));

    await waitFor(() => {
      expect(importMine).toHaveBeenCalledTimes(1);
    });
    const [body] = importMine.mock.calls[0] as [Record<string, unknown>];
    expect(body['onConflict']).toBe('replace');
    expect(body['options']).toEqual({ connections: true });
  });

  it('offers no connections to take from a redacted archive', async () => {
    readMineManifest.mockResolvedValue({ manifest: { ...MANIFEST, contents: 'redacted' } });
    const user = userEvent.setup();
    renderFlow('account');
    await choose(user);

    expect(screen.getByLabelText('Provider connections')).toHaveProperty('disabled', true);
  });

  it('asks an administrator whose work, from the archive’s own list', async () => {
    const user = userEvent.setup();
    renderFlow('install');
    await choose(user);

    const control = screen.getByLabelText('Whose work in the backup');
    const offered = [...(control as HTMLSelectElement).options].map((option) => option.value);
    expect(offered).toEqual(['', 'ned', 'ada']);

    // Until one is chosen there is nothing to import into.
    expect(screen.getByRole('button', { name: 'Import from this backup' })).toHaveProperty(
      'disabled',
      true,
    );

    await user.selectOptions(control, 'ada');
    await user.click(screen.getByRole('button', { name: 'Import from this backup' }));
    await user.click(screen.getByRole('button', { name: 'Import it' }));

    await waitFor(() => {
      expect(importInstall).toHaveBeenCalledTimes(1);
    });
    expect((importInstall.mock.calls[0] as [Record<string, unknown>])[0]['handle']).toBe('ada');
  });

  it('offers the settings box only to an administrator', async () => {
    const user = userEvent.setup();
    renderFlow('account');
    await choose(user);
    expect(screen.queryByLabelText('Install settings')).toBeNull();
  });

  it('reports what did not happen as well as what did', async () => {
    const user = userEvent.setup();
    renderFlow('account');
    await choose(user);

    await user.click(screen.getByRole('button', { name: 'Import from this backup' }));
    await user.click(screen.getByRole('button', { name: 'Import it' }));

    await waitFor(() => {
      expect(screen.getByText('What the import did')).toBeTruthy();
    });
    // The sentence is the catalogue's, composed from the class the server sent.
    expect(screen.getByText(/preferences were not brought across/i)).toBeTruthy();
  });
});

/**
 * ***Each archive's date, in the account's format*** (2026-09-28) — the picker
 * was handed no locale and wrote the browser's.
 */
describe('the dates', () => {
  it('are written in the account’s format', () => {
    renderFlow('account', [ROW], 'de-DE');
    const german = formatTimestamp(new Date(ROW.takenAt).toISOString(), 'de-DE');
    expect(german).not.toBe(formatTimestamp(new Date(ROW.takenAt).toISOString(), 'en-US'));
    const options = [...screen.getByLabelText<HTMLSelectElement>('Which backup').options];
    expect(options.some((one) => one.text.includes(german))).toBe(true);
  });

  it('writes the chosen archive’s own date in it too', async () => {
    const user = userEvent.setup();
    renderFlow('account', [ROW], 'de-DE');
    await choose(user);

    const german = formatTimestamp(MANIFEST.takenBy.at, 'de-DE');
    expect(german).not.toBe(formatTimestamp(MANIFEST.takenBy.at, 'en-US'));
    expect(screen.getByText((text) => text.startsWith(`Taken ${german} by`))).toBeTruthy();
  });
});
