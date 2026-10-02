// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***A write refreshes what it changed*** (2026-09-28) — audit run 2's two
 * client-core findings about what a save left stale.
 *
 * Each is a statement about the cache after a write, so each is asserted on
 * the cache: an entry nothing is watching is marked invalid rather than asked
 * again, which is what *refreshed* means for one that nobody on screen reads
 * yet, and the page that mounts it next asks. The preview has no `queryFn`, so
 * for it *refreshed* means *reset*: an invalid entry nothing can refetch keeps
 * its old answer on screen.
 */

const setSessionPreset = vi.fn();
const retryRendition = vi.fn();
const updateAccount = vi.fn();
const writeConfig = vi.fn();
const updateMe = vi.fn();

vi.mock('./api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.js')>();
  return {
    ...actual,
    setSessionPreset: (...a: unknown[]) => setSessionPreset(...a) as unknown,
    retryRendition: (...a: unknown[]) => retryRendition(...a) as unknown,
    api: { ...actual.api, updateMe: (...a: unknown[]) => updateMe(...a) as unknown },
    adminApi: {
      ...actual.adminApi,
      updateAccount: (...a: unknown[]) => updateAccount(...a) as unknown,
      writeConfig: (...a: unknown[]) => writeConfig(...a) as unknown,
    },
  };
});

const {
  previewKey,
  renditionsKey,
  useRetryRendition,
  useSetSessionPreset,
  useUpdateAccount,
  useUpdateMe,
  useWriteConfig,
} = await import('./queries.js');
const { ApiError } = await import('./api.js');

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function invalidated(key: readonly unknown[]): boolean | undefined {
  return client.getQueryState(key)?.isInvalidated;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['auth', 'state'], { setupRequired: false, account: { handle: 'ned' } });
  client.setQueryData(['me'], { account: { handle: 'ned' } });
  client.setQueryData(['admin', 'accounts'], { accounts: [] });
  setSessionPreset.mockResolvedValue({ session: { id: 's-1' } });
  updateAccount.mockResolvedValue({ account: { handle: 'ned' } });
  writeConfig.mockResolvedValue({ config: {}, pendingRestart: [] });
  updateMe.mockResolvedValue({ account: { handle: 'ned' } });
});

describe('the preview after the pack changes', () => {
  it('is reset, so the meter asks again rather than showing the old pack’s budget', async () => {
    client.setQueryData(previewKey('s-1'), { preview: { state: 'assembled' } });
    const { result } = renderHook(() => useSetSessionPreset('s-1'), { wrapper });

    await result.current.mutateAsync({ presetId: 'p-2' });

    expect(client.getQueryData(previewKey('s-1'))).toBeUndefined();
  });
});

describe('an admin editing an account', () => {
  it('refreshes their own state when the row is their own', async () => {
    const { result } = renderHook(() => useUpdateAccount(), { wrapper });

    await result.current.mutateAsync({
      handle: 'ned',
      patch: { capabilities: { scheduledBackups: true } },
    });

    expect(invalidated(['auth', 'state'])).toBe(true);
    expect(invalidated(['me'])).toBe(true);
    expect(invalidated(['admin', 'accounts'])).toBe(true);
  });

  it('leaves their own state alone for somebody else’s row', async () => {
    const { result } = renderHook(() => useUpdateAccount(), { wrapper });

    await result.current.mutateAsync({ handle: 'ada', patch: { enabled: false } });

    expect(invalidated(['auth', 'state'])).toBe(false);
    expect(invalidated(['admin', 'accounts'])).toBe(true);
  });

  it('does not ask the admin list again after demoting themselves', async () => {
    const { result } = renderHook(() => useUpdateAccount(), { wrapper });

    await result.current.mutateAsync({ handle: 'ned', patch: { role: 'user' } });

    expect(invalidated(['auth', 'state'])).toBe(true);
    expect(invalidated(['admin', 'accounts'])).toBe(false);
  });
});

describe('a settings save', () => {
  it('refreshes the auth state, which carries the live sign-in keys', async () => {
    const { result } = renderHook(() => useWriteConfig(), { wrapper });

    await result.current.mutateAsync({ config: {} });

    expect(invalidated(['auth', 'state'])).toBe(true);
  });
});

describe('a profile save', () => {
  it('refreshes an admin’s own row in the account list', async () => {
    const { result } = renderHook(() => useUpdateMe(), { wrapper });

    await result.current.mutateAsync({ displayName: 'Ned Carlson' });

    expect(invalidated(['admin', 'accounts'])).toBe(true);
  });
});

/**
 * ***A retry refused reads the pictures again*** (2026-09-30). A retry is
 * refused over pixels that are there (`409 has-pixels`), and what presses one
 * is a stale view — a second tab, a frame gone astray — which the set, read
 * again, corrects. It was read again only on success.
 */
describe('a retry the server refused', () => {
  it('reads the pictures again', async () => {
    retryRendition.mockRejectedValue(new ApiError(409, 'has-pixels', 'That picture is here.'));
    client.setQueryData(renditionsKey('s-1'), { renditions: [], selection: {} });
    const { result } = renderHook(() => useRetryRendition('s-1'), { wrapper });

    await expect(result.current.mutateAsync('r-1')).rejects.toThrow();

    expect(invalidated(renditionsKey('s-1'))).toBe(true);
  });
});
