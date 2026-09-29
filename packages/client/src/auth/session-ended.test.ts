// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api.js';
import { queryClient } from '../queries.js';
import { SESSION_ENDED_KEY } from './session-ended.js';

/**
 * ***The app's own query client, as every page gets it*** (2026-09-27).
 *
 * Two claims about defaults rather than about any one hook, so they are made
 * against the client `queries.ts` exports: a request refused as signed out
 * raises the flag the shell shows (`auth/session-ended.ts`), whichever query or
 * mutation it was; and a write is sent when the browser says it is offline.
 */

beforeEach(() => {
  queryClient.clear();
});

afterEach(() => {
  onlineManager.setOnline(true);
});

const refused = (code: string): ApiError => new ApiError(401, code, 'Sign in first.');

async function failQuery(failure: Error): Promise<void> {
  await queryClient
    .fetchQuery({ queryKey: ['probe'], queryFn: () => Promise.reject(failure), retry: false })
    .catch(() => undefined);
}

function mutation(mutationFn: () => Promise<unknown>): Promise<unknown> {
  return queryClient
    .getMutationCache()
    .build(queryClient, queryClient.defaultMutationOptions({ mutationFn }))
    .execute(undefined);
}

describe('a request refused as signed out', () => {
  it('raises the flag from a query', async () => {
    await failQuery(refused('unauthenticated'));
    expect(queryClient.getQueryData(SESSION_ENDED_KEY)).toBe(true);
  });

  it('raises the flag from a mutation', async () => {
    await mutation(() => Promise.reject(refused('unauthenticated'))).catch(() => undefined);
    expect(queryClient.getQueryData(SESSION_ENDED_KEY)).toBe(true);
  });

  /**
   * *Only a session that is gone.* A wrong password and a provider refusing a
   * key both answer 401 as well, and a banner saying the sign-in had ended over
   * a mistyped password would be wrong at the worst moment.
   */
  it('leaves it down for a wrong password, a refused key, or any other failure', async () => {
    await failQuery(refused('invalid-credentials'));
    await mutation(() => Promise.reject(refused('unauthorized'))).catch(() => undefined);
    await failQuery(new TypeError('Failed to fetch'));
    expect(queryClient.getQueryData(SESSION_ENDED_KEY)).toBeUndefined();
  });
});

describe('a write while the browser says it is offline', () => {
  /**
   * `online`, the default, *pauses* the write until the browser says it is back —
   * and on a LAN install the browser's idea of *online* is about the internet,
   * not about the box in the next room. So the write is raced against a moment:
   * paused, it never settles.
   */
  it('is sent', async () => {
    onlineManager.setOnline(false);
    const sent = vi.fn().mockResolvedValue('written');

    const outcome = await Promise.race([
      mutation(sent),
      new Promise((resolve) => {
        setTimeout(() => {
          resolve('paused');
        }, 50);
      }),
    ]);

    expect(outcome).toBe('written');
    expect(sent).toHaveBeenCalledTimes(1);
  });
});
