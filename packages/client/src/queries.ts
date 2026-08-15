// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  api,
  type Account,
  type AuthState,
  type Credentials,
  type LibraryKind,
  type LibraryObject,
  type SetupInput,
} from './api.js';

/**
 * Server state, through TanStack Query ([07 §6](docs/design/07-tech-stack.md)):
 * nearly all client state *is* server state here, and these hooks are the whole
 * of the client's model layer.
 *
 * Library queries poll. Nothing pushes yet — SSE is P2 — and the watcher's
 * pick-up of a hand edit on disk is the storage thesis's demo
 * ([19 §3](docs/design/19-p1-implementation.md) step 8), so the browser has to
 * ask often enough for "without a restart" to read as "by itself".
 */

const LIBRARY_POLL_MS = 2000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
  },
});

export function useAuthState(): UseQueryResult<AuthState> {
  return useQuery({ queryKey: ['auth', 'state'], queryFn: api.authState });
}

export function useLibrary(kind?: LibraryKind): UseQueryResult<{ objects: LibraryObject[] }> {
  return useQuery({
    queryKey: ['library', kind ?? 'all'],
    queryFn: () => api.listLibrary(kind),
    refetchInterval: LIBRARY_POLL_MS,
  });
}

export function useLibraryObject(kind: LibraryKind, id: string): UseQueryResult<LibraryObject> {
  return useQuery({
    queryKey: ['library', kind, id],
    queryFn: () => api.readObject(kind, id),
    refetchInterval: LIBRARY_POLL_MS,
  });
}

/** Sign-in and setup change what every other query is allowed to see. */
function useAuthMutation<TInput extends Credentials>(
  mutationFn: (input: TInput) => Promise<{ account: Account }>,
): UseMutationResult<{ account: Account }, Error, TInput> {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useSetup(): UseMutationResult<{ account: Account }, Error, SetupInput> {
  return useAuthMutation(api.setup);
}

export function useLogin(): UseMutationResult<{ account: Account }, Error, Credentials> {
  return useAuthMutation(api.login);
}

export function useLogout(): UseMutationResult<undefined, Error, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    // Everything cached belongs to the account that just left. `resetQueries`
    // rather than `clear()`: clear() detaches the entries without telling the
    // components still watching them, so the page keeps rendering the old
    // account's data until something else forces a render.
    onSuccess: () => client.resetQueries(),
  });
}
