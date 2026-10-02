// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { skipToken, useQuery, type QueryClient } from '@tanstack/react-query';

import { ApiError } from '../api.js';

/**
 * ***A sign-in that ended under an open page*** (2026-09-27).
 *
 * A session ends while a page is open in more ways than one: it expires, an
 * admin disables the account, somebody signs out in another tab, the key that
 * signs cookies changes. Every request after that answers `401
 * unauthenticated`, and until this, nothing listened: each query showed its own
 * error, each mutation failed where it was pressed, and the page carried on as
 * if signed in, one broken panel at a time, until something happened to refetch
 * the auth state.
 *
 * ***What it does now is say so, and nothing more.*** A 401 anywhere — a query,
 * a mutation, a stream refused on reconnect — raises one flag, and the shell
 * shows it as a banner whose button asks the server who is signed in. **The
 * page is not torn down on the 401 itself**, because the moment a sign-in ends
 * is exactly the moment somebody may have a paragraph in an unsaved form: the
 * banner says to copy it first, and the person decides when to leave.
 *
 * *Only `unauthenticated`.* A wrong password answers 401 too
 * (`invalid-credentials`, from sign-in and the password form), and so does a
 * provider refusing a key under test (`unauthorized`): neither is a session
 * ending, and a banner saying so over a mistyped password would be a lie at the
 * worst moment.
 *
 * *Cached rather than held in React state*, so every source can raise it without
 * a component to hand, and under a key outside `['auth']`: the reset that runs
 * when the signed-in account changes (`App.tsx`) clears it with everything else
 * that belonged to the account that left.
 */
export const SESSION_ENDED_KEY = ['session-ended'] as const;

/** Whether this failure is the server saying the session is gone. */
export function endsTheSession(failure: unknown): boolean {
  return (
    failure instanceof ApiError && failure.status === 401 && failure.code === 'unauthenticated'
  );
}

export function markSessionEnded(client: QueryClient): void {
  client.setQueryData(SESSION_ENDED_KEY, true);
}

/** True once any request has been refused as signed out, until the account changes. */
export function useSessionEnded(): boolean {
  const flag = useQuery({ queryKey: SESSION_ENDED_KEY, queryFn: skipToken, staleTime: Infinity });
  return flag.data === true;
}
