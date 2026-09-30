// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The install panel, and the most destructive control in the build —
 * [P12.13](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***Three decisions are asserted and each would be silently wrong.***
 *
 * - **The restore control is absent where nothing would restart the process**,
 *   with a sentence giving the shell command instead. [09 §6.4]'s trap: *a bare
 *   `node server.js` will simply exit and the admin who clicked the button now
 *   has no server*. The route refuses it as well — a surface is never the
 *   boundary — but a person who has done nothing wrong should not meet an
 *   error to learn it.
 * - **It takes the words typed back**, because a destructive control whose
 *   confirmation is a second button is a control people click twice.
 * - **A `redacted` archive is accepted only with the flag that says so**, which
 *   is the difference between restoring one deliberately and restoring an
 *   install nobody can sign into by accident.
 */

const readInstall = vi.fn();
const readInstallManifest = vi.fn();
const restoreInstall = vi.fn();
const cancelRestore = vi.fn();
const notices = vi.fn();
const takeInstall = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  backupApi: {
    readInstall: (...a: unknown[]) => readInstall(...a) as unknown,
    readInstallManifest: (...a: unknown[]) => readInstallManifest(...a) as unknown,
    restoreInstall: (...a: unknown[]) => restoreInstall(...a) as unknown,
    cancelRestore: (...a: unknown[]) => cancelRestore(...a) as unknown,
    takeInstall: (...a: unknown[]) => takeInstall(...a) as unknown,
    deleteInstall: vi.fn(),
    importInstall: vi.fn(),
  },
  adminApi: {
    ...(await importOriginal<typeof import('../api.js')>()).adminApi,
    notices: (...a: unknown[]) => notices(...a) as unknown,
  },
}));

const { ApiError } = await import('../api.js');
const { AdminBackups } = await import('./AdminBackups.js');

const ID = '0199aa33-7c41-7b0e-9d1a-4f2c8e5a1b60';

const ROW = {
  id: ID,
  scope: 'install' as const,
  handle: null,
  contents: 'full' as const,
  takenAt: 1_790_000_000_000,
  bytes: 4_194_304,
};

const MANIFEST = {
  scope: 'install' as const,
  handle: null,
  contents: 'full' as const,
  takenBy: { version: '1.0.0-alpha.1', at: '2026-09-20T10:00:00.000Z' },
  reason: 'manual' as const,
  files: 120,
  unpackedBytes: 8_000_000,
  handles: ['ned', 'ada'],
  omitted: [],
};

function supervised(canRestart: boolean, restorePending = false, draining = false): void {
  notices.mockResolvedValue({
    pendingRestart: [],
    canRestart,
    supervision: canRestart ? 'declared' : 'none',
    interrupts: { mine: 0, others: 0 },
    draining,
    restorePending,
    updates: {
      state: 'disabled',
      latest: null,
      checkedAt: null,
      online: null,
      needsInternet: false,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  readInstall.mockResolvedValue({ backups: [ROW], totalBytes: ROW.bytes });
  readInstallManifest.mockResolvedValue({ manifest: MANIFEST });
  restoreInstall.mockResolvedValue({ draining: true });
  cancelRestore.mockResolvedValue(undefined);
  supervised(true);
});

function renderPanel(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AdminBackups />
    </QueryClientProvider>,
  );
  return client;
}

/**
 * The notices asked again, as the page does when the server comes back — a
 * few milliseconds on, so the answer is plainly later than the press.
 */
async function askedAgain(client: QueryClient): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['admin', 'notices'] });
    // The cache tells its observers on a timer of its own; waited out here, so
    // an assertion that nothing changed reads the page the answer left.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

/** Picks the archive, and waits for the manifest the confirmation is built on. */
async function chooseArchive(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.selectOptions(await screen.findByLabelText('Which archive to become'), ID);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Restore this install…' })).toHaveProperty(
      'disabled',
      false,
    );
  });
}

describe('restoring the install', () => {
  it('is absent where nothing would start the server again, and says what to run', async () => {
    supervised(false);
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/Nothing would start this server again/)).toBeTruthy();
    });
    // Absent, not disabled: no control, and therefore no request to be refused.
    expect(screen.queryByLabelText('Which archive to become')).toBeNull();
  });

  it('takes the word typed back before it will start', async () => {
    const user = userEvent.setup();
    renderPanel();
    await chooseArchive(user);

    await user.click(screen.getByRole('button', { name: 'Restore this install…' }));
    const go = screen.getByRole('button', { name: 'Stop the server and restore' });
    expect(go).toHaveProperty('disabled', true);
    await user.click(go);
    expect(restoreInstall).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Type restore to confirm'), 'restore');
    await user.click(screen.getByRole('button', { name: 'Stop the server and restore' }));

    await waitFor(() => {
      expect(restoreInstall).toHaveBeenCalledWith(ID, false);
    });
  });

  it('says what a redacted archive would leave, and sends the flag that accepts it', async () => {
    readInstallManifest.mockResolvedValue({ manifest: { ...MANIFEST, contents: 'redacted' } });
    const user = userEvent.setup();
    renderPanel();
    await chooseArchive(user);

    expect(screen.getByText(/leaves an install nobody can sign into/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Restore this install…' }));
    await user.type(screen.getByLabelText('Type restore to confirm'), 'restore');
    await user.click(screen.getByRole('button', { name: 'Stop the server and restore' }));

    /**
     * ***The flag is derived from the archive rather than from a second
     * checkbox.*** The person has already read what a redacted archive leaves
     * and typed the word; asking them to tick a box saying the same thing
     * would be a confirmation of a confirmation.
     */
    await waitFor(() => {
      expect(restoreInstall).toHaveBeenCalledWith(ID, true);
    });
  });

  it('offers a way out of a pending one, which is the state a failure leaves', async () => {
    supervised(true, true);
    const user = userEvent.setup();
    renderPanel();

    const out = await screen.findByRole('button', { name: 'Call it off' });
    await user.click(out);

    await waitFor(() => {
      expect(cancelRestore).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * ***A restore that failed as it started, seen from the tab that asked***
   * (2026-09-28). The press's success outlived the restart it reported, so
   * this tab kept saying *The server is stopping* and hid *Call it off* — the
   * one way out of a failed restore on an install with no shell.
   */
  it('offers Call it off on the tab that asked, once a new process has the marker', async () => {
    const user = userEvent.setup();
    const client = renderPanel();
    await chooseArchive(user);
    await user.click(screen.getByRole('button', { name: 'Restore this install…' }));
    await user.type(screen.getByLabelText('Type restore to confirm'), 'restore');
    await user.click(screen.getByRole('button', { name: 'Stop the server and restore' }));
    expect(await screen.findByText(/The server is stopping/)).toBeTruthy();

    // The old process, still draining with its marker written: not a failure.
    supervised(true, true, true);
    await askedAgain(client);
    expect(screen.queryByRole('button', { name: 'Call it off' })).toBeNull();
    expect(screen.getByText(/The server is stopping/)).toBeTruthy();

    // A new process that found the marker and refused it.
    supervised(true, true);
    await askedAgain(client);
    expect(await screen.findByRole('button', { name: 'Call it off' })).toBeTruthy();
    expect(screen.queryByText(/The server is stopping/)).toBeNull();
  });

  it('says nothing about a pending restore when there is none', async () => {
    renderPanel();
    await screen.findByLabelText('Which archive to become');
    expect(screen.queryByRole('button', { name: 'Call it off' })).toBeNull();
  });

  /**
   * ***By the class, whatever the server's sentence says*** (2026-09-27). The
   * panel searched the refusal's English for `free space`, so this refusal —
   * the same class in other words — would have read as a restore that simply
   * *could not be started*. Reddened by putting the search back.
   */
  it('says why a restore was refused by its class, not by its wording', async () => {
    restoreInstall.mockRejectedValue(new ApiError(507, 'no-space', 'Not enough room to unpack.'));
    const user = userEvent.setup();
    renderPanel();
    await chooseArchive(user);

    await user.click(screen.getByRole('button', { name: 'Restore this install…' }));
    await user.type(screen.getByLabelText('Type restore to confirm'), 'restore');
    await user.click(screen.getByRole('button', { name: 'Stop the server and restore' }));

    expect(
      await screen.findByText(
        'There is not enough free space to unpack that archive. Delete some archives and try again.',
      ),
    ).toBeTruthy();
  });
});

describe('taking an install backup', () => {
  /**
   * The admin half reaches the same route code as the account half, and had
   * no sentence for a full disk at all (2026-09-27).
   */
  it('says when the disk had no room for it', async () => {
    takeInstall.mockRejectedValue(new ApiError(507, 'no-space', 'No room.'));
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Back up now' }));

    expect(
      await screen.findByText('There was not enough room on the disk for that backup.'),
    ).toBeTruthy();
  });
});
