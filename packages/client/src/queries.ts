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
  type ObjectVersion,
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
    queries: {
      retry: 1,
      /**
       * **`always`, not the default `online`.**
       *
       * TanStack's default refuses to fetch whenever the browser reports
       * itself offline, and a query that never fetches stays `pending`
       * forever — so the UI sits on a loading state rather than reporting
       * anything. For an app on the public web that is the right trade.
       *
       * Here it is simply wrong. This server is on loopback or on the LAN
       * ([04 §5.1](docs/design/04-server-multiuser-deployment.md)), and
       * `navigator.onLine` describes the *internet*, which has no bearing on
       * whether a box in the next room is reachable. A laptop with its Wi-Fi
       * off can still reach `127.0.0.1:8080` perfectly well.
       *
       * With `always`, an unreachable server is a failed request like any
       * other: it retries, gives up, and the UI says so.
       */
      networkMode: 'always',
    },
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

/**
 * The editor's base object. Deliberately **not** polled and outside the
 * `['library']` invalidation prefix: the object under an open editor must not
 * shift beneath the form. The designed mechanism for concurrent change is the
 * stale-hash rejection on save (docs/api.md, the 412), not a silently moving
 * base.
 */
export function useEditorBase(kind: LibraryKind, id: string): UseQueryResult<LibraryObject> {
  return useQuery({
    queryKey: ['editor', kind, id],
    queryFn: () => api.readObject(kind, id),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useObjectHistory(
  kind: LibraryKind,
  id: string,
): UseQueryResult<{ versions: ObjectVersion[] }> {
  return useQuery({
    queryKey: ['library', kind, id, 'history'],
    queryFn: () => api.history(kind, id),
    refetchInterval: LIBRARY_POLL_MS,
  });
}

export function useVersionPayload(
  kind: LibraryKind,
  id: string,
  versionId: string | null,
): UseQueryResult<{ version: ObjectVersion; object: Record<string, unknown> }> {
  return useQuery({
    queryKey: ['library', kind, id, 'version', versionId],
    // `enabled` below keeps this from running with a null id; the throw is the
    // honest spelling of that contract rather than an assertion.
    queryFn: () => {
      if (versionId === null) throw new Error('The version query ran while disabled.');
      return api.version(kind, id, versionId);
    },
    enabled: versionId !== null,
    staleTime: Infinity,
  });
}

interface SaveInput {
  kind: LibraryKind;
  id: string;
  object: Record<string, unknown>;
  contentHash: string;
}

export function useSaveObject(): UseMutationResult<
  { contentHash: string; object: Record<string, unknown> },
  Error,
  SaveInput
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveInput) =>
      api.updateObject(input.kind, input.id, input.object, input.contentHash),
    onSuccess: () => client.invalidateQueries({ queryKey: ['library'] }),
  });
}

export function useCreateObject(): UseMutationResult<
  { id: string; slug: string; contentHash: string },
  Error,
  { kind: LibraryKind; object: Record<string, unknown> }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: LibraryKind; object: Record<string, unknown> }) =>
      api.createObject(input.kind, input.object),
    onSuccess: () => client.invalidateQueries({ queryKey: ['library'] }),
  });
}

export function useRestoreVersion(): UseMutationResult<
  { contentHash: string; object: Record<string, unknown> },
  Error,
  { kind: LibraryKind; id: string; versionId: string; contentHash: string }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      kind: LibraryKind;
      id: string;
      versionId: string;
      contentHash: string;
    }) => api.restoreVersion(input.kind, input.id, input.versionId, input.contentHash),
    onSuccess: () => client.invalidateQueries({ queryKey: ['library'] }),
  });
}

export function useAmendVersion(): UseMutationResult<
  { version: ObjectVersion },
  Error,
  { kind: LibraryKind; id: string; versionId: string; patch: { reason?: string; pinned?: boolean } }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      kind: LibraryKind;
      id: string;
      versionId: string;
      patch: { reason?: string; pinned?: boolean };
    }) => api.amendVersion(input.kind, input.id, input.versionId, input.patch),
    onSuccess: () => client.invalidateQueries({ queryKey: ['library'] }),
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
