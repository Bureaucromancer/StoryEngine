// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The backups panel — [P12.6](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***What is worth testing here is what the component decides***, which is
 * `MyRoles.test.tsx`'s rule: a list rendered from what the server sent works
 * nothing out, so asserting on its rows would be asserting on a fixture. Three
 * things here are decisions, and each would be silently wrong rather than
 * visibly broken.
 *
 * **The schedule form is absent without the capability** — the mechanism
 * `SettingsPage.tsx` relies on, and the one that keeps a browser from issuing a
 * request that would be refused.
 *
 * **Deleting takes two clicks, with Cancel where Delete was** — so a second
 * click that arrives before the eye has caught up lands on the harmless answer.
 *
 * **And the delete says the file does not go to the trash**, because *delete*
 * reads as *recoverable* everywhere else in this build.
 */

const readMine = vi.fn();
const takeMine = vi.fn();
const deleteMine = vi.fn();
const readSettings = vi.fn();
const writeSettings = vi.fn();
// The panel mounts `<ImportBackup />`, which asks nothing until an archive is
// picked — but a mock missing them would fail as *undefined is not a function*
// in whichever test first picks one, which is a long way from the cause.
const readMineManifest = vi.fn();
const importMine = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  backupApi: {
    readMine: (...a: unknown[]) => readMine(...a) as unknown,
    takeMine: (...a: unknown[]) => takeMine(...a) as unknown,
    deleteMine: (...a: unknown[]) => deleteMine(...a) as unknown,
    readSettings: (...a: unknown[]) => readSettings(...a) as unknown,
    writeSettings: (...a: unknown[]) => writeSettings(...a) as unknown,
    readMineManifest: (...a: unknown[]) => readMineManifest(...a) as unknown,
    importMine: (...a: unknown[]) => importMine(...a) as unknown,
  },
}));

const { ApiError } = await import('../api.js');
const { Backups } = await import('./Backups.js');
const { formatTimestamp } = await import('../format.js');

const ONE = {
  id: '0199aa33-7c41-7b0e-9d1a-4f2c8e5a1b60',
  scope: 'account' as const,
  handle: 'ned',
  contents: 'full' as const,
  takenAt: 1_790_000_000_000,
  bytes: 184_320,
};

beforeEach(() => {
  vi.clearAllMocks();
  readMine.mockResolvedValue({ backups: [ONE], totalBytes: ONE.bytes });
  takeMine.mockResolvedValue({ backup: ONE });
  deleteMine.mockResolvedValue(undefined);
  readSettings.mockResolvedValue({
    settings: { frequency: 'off', onStart: false, contents: 'full' },
  });
  writeSettings.mockResolvedValue({
    settings: { frequency: 'daily', onStart: false, contents: 'full' },
  });
});

function renderPanel(capable = false, locale: string | undefined = 'en-US'): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Backups capable={capable} locale={locale} />
    </QueryClientProvider>,
  );
}

describe('Backups', () => {
  it('lists what is there, with a link that is the route', async () => {
    renderPanel();

    const download = await screen.findByRole('link', { name: 'Download' });
    expect(download.getAttribute('href')).toBe(`/api/me/backups/${ONE.id}/download`);
    // The `download` attribute is what makes it a file rather than a navigation.
    expect(download.hasAttribute('download')).toBe(true);
  });

  it('says so when there is nothing yet', async () => {
    readMine.mockResolvedValue({ backups: [], totalBytes: 0 });
    renderPanel();

    expect(await screen.findByText('You have not taken a backup yet.')).toBeTruthy();
  });

  it('takes one with the kind that was chosen', async () => {
    renderPanel();
    await screen.findByRole('button', { name: 'Back up now' });

    const kind = screen.getByRole('combobox', { name: /What to include/ });
    await userEvent.selectOptions(kind, 'redacted');
    await userEvent.click(screen.getByRole('button', { name: 'Back up now' }));

    await waitFor(() => {
      expect(takeMine).toHaveBeenCalledWith('redacted');
    });
  });

  /**
   * ***Delete first and Cancel last***, so the pixels the question was asked
   * from hold the harmless answer once it has been asked.
   */
  it('needs two clicks to delete, and says the file does not go to the trash', async () => {
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(deleteMine).not.toHaveBeenCalled();
    expect(screen.getByText(/does not go to the trash/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Delete this file' }));
    await waitFor(() => {
      expect(deleteMine).toHaveBeenCalledWith(ONE.id);
    });
  });

  it('can be backed out of', async () => {
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteMine).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Delete this file' })).toBeNull();
  });

  /**
   * ***Absent, not disabled*** — so the hook never mounts, the browser issues
   * no request to `/api/me/backups/settings`, and nobody who has done nothing
   * wrong reads an error. The boundary is still the route.
   */
  it('renders no schedule for an account without the capability, and asks the server nothing', async () => {
    renderPanel(false);
    await screen.findByRole('button', { name: 'Back up now' });

    expect(screen.queryByRole('combobox', { name: /How often/ })).toBeNull();
    expect(readSettings).not.toHaveBeenCalled();
  });

  it('renders the schedule for an account with it, and writes the whole document', async () => {
    renderPanel(true);

    const often = await screen.findByRole('combobox', { name: /How often/ });
    await userEvent.selectOptions(often, 'daily');

    await waitFor(() => {
      expect(writeSettings).toHaveBeenCalledWith({
        frequency: 'daily',
        onStart: false,
        contents: 'full',
      });
    });
  });

  /**
   * ~~Rejected with `new Error('no space left on device')`~~ — which the client
   * can never receive: `request()` throws an `ApiError`, and a full disk was
   * the server's bare 500 until the take route learned to say `no-space`. The
   * test was green over a branch that could not run (2026-09-27). It is the
   * route's own refusal now, in other words than the route uses today — the
   * class is what is read, so a reworded sentence must not move this one.
   */
  it('reports a failed backup without claiming it happened', async () => {
    takeMine.mockRejectedValue(new ApiError(507, 'no-space', 'The disk is full.'));
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Back up now' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('There was not enough room on the disk for that backup.')).toBeTruthy();
  });

  it('does not blame the disk for a failure that did not say so', async () => {
    takeMine.mockRejectedValue(new ApiError(500, 'internal', 'The request failed.'));
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Back up now' }));
    expect(await screen.findByText('That backup could not be taken.')).toBeTruthy();
  });
});

/**
 * ***When each backup was taken, in the account's format*** (2026-09-28) — the
 * panel was handed no locale and wrote the browser's.
 */
describe('the dates', () => {
  it('are written in the account’s format', async () => {
    renderPanel(false, 'de-DE');
    const german = formatTimestamp(new Date(ONE.takenAt).toISOString(), 'de-DE');
    expect(german).not.toBe(formatTimestamp(new Date(ONE.takenAt).toISOString(), 'en-US'));
    expect(await screen.findByText(`Taken ${german}.`)).toBeTruthy();
  });
});
