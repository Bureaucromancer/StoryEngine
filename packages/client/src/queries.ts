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
  adminApi,
  api,
  type Account,
  type AccountPatch,
  type AdminAccountList,
  type AdminConnection,
  type Binding,
  type BindingsState,
  type ConnectionInput,
  type RoleRow,
  type ConfigView,
  type AuthState,
  type Credentials,
  type LibraryKind,
  type LibraryObject,
  type ObjectAddress,
  type ObjectVersion,
  type SetupInput,
} from './api.js';

/**
 * Server state, through TanStack Query ([07 §6](../../../docs/design/07-tech-stack.md)):
 * nearly all client state *is* server state here, and these hooks are the whole
 * of the client's model layer.
 *
 * Library queries poll. Nothing pushes yet — SSE is P2 — and the watcher's
 * pick-up of a hand edit on disk is the storage thesis's demo
 * ([P1 §3](../../../docs/design/workplan/03-p1-implementation.md) step 8), so the browser has to
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
       * ([04 §5.1](../../../docs/design/04-server-multiuser-deployment.md)), and
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

/**
 * `at` is part of the key, and that is the whole point of it being here.
 *
 * Once one id is readable two ways, a single cache entry would serve the
 * winner under both addresses — and the poll below would then rewrite it under
 * whichever page happened to be mounted. The shadowed copy would look like it
 * opened and show the wrong object, which is the bug F19 exists to fix wearing
 * a different hat.
 */
export function useLibraryObject(
  kind: LibraryKind,
  id: string,
  at?: ObjectAddress,
): UseQueryResult<LibraryObject> {
  return useQuery({
    queryKey: ['library', kind, id, at ? `${at.source}:${at.slug}` : 'winner'],
    queryFn: () => api.readObject(kind, id, at),
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
    // The editor's base too — it sits outside the `['library']` prefix by
    // design, so without this the cached entry kept its pre-save contentHash
    // and the *next* visit to the editor raised the conflict dialog against
    // the user's own change. Invalidate rather than remove: the query is
    // active while the editor is open, and removing it would unmount the form.
    onSuccess: (_result, input) => {
      void client.invalidateQueries({ queryKey: ['library'] });
      void client.invalidateQueries({ queryKey: ['editor', input.kind, input.id] });
    },
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
    // Same pair as a save — a restore is an ordinary write ([02 §11.1]), and
    // it moves the contentHash just the same.
    onSuccess: (_result, input) => {
      void client.invalidateQueries({ queryKey: ['library'] });
      void client.invalidateQueries({ queryKey: ['editor', input.kind, input.id] });
    },
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

/**
 * The account's own record — [05 §15.1](../../../docs/design/05-ui-surfaces.md).
 *
 * Its own query rather than a read of `['auth', 'state']`, because that entry
 * answers a question about the *install* — is anyone signed in, does setup need
 * running — and a settings form invalidating it on every save would make each
 * keystroke re-answer that. Both are refreshed after a profile change, which is
 * the one place they genuinely have to agree: the shell renders the display name.
 */
export function useMe(): UseQueryResult<{ account: Account }> {
  return useQuery({ queryKey: ['me'], queryFn: api.readMe });
}

export function useUpdateMe(): UseMutationResult<
  { account: Account },
  Error,
  { displayName?: string; locale?: string | null }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.updateMe,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['me'] });
      // The shell reads the display name out of the auth state, so without this
      // the header keeps the old name until a reload — the exact "did that
      // work?" moment gate step 2 is written to catch.
      void client.invalidateQueries({ queryKey: ['auth', 'state'] });
    },
  });
}

export function useChangePassword(): UseMutationResult<
  undefined,
  Error,
  { currentPassword: string; newPassword: string }
> {
  // No invalidation: nothing the client caches changes. In particular the
  // session does not — sessions are signed stateless cookies with no denylist,
  // so a password change cannot end one held elsewhere, and the surface has to
  // say so rather than implying otherwise by logging you out here.
  return useMutation({ mutationFn: api.changePassword });
}

export function usePrefs(): UseQueryResult<{ prefs: Record<string, unknown> }> {
  return useQuery({ queryKey: ['prefs'], queryFn: api.readPrefs });
}

/**
 * **The one optimistic mutation in this codebase**, and the reasons are specific
 * enough to be worth writing down — [P2A §3](../../../docs/design/workplan/13-p2a-configuration-surface.md).
 *
 * Everywhere else this client waits for the server, and the editor goes further:
 * its base is *deliberately unpolled*, so a save presents the hash it read and
 * finds out whether the world moved. Optimism there would mean showing somebody
 * their own change as saved when it was about to be refused.
 *
 * A preference toggle is the inverse of that on all three counts.
 *
 * - **It must feel instant.** A checkbox that waits for a round trip before
 *   moving reads as broken, and the person clicks it again.
 * - **The value is trivially reversible.** There is no merge to redo and nothing
 *   downstream computed from it — `onError` puts the old map back and the worst
 *   outcome is a switch that flicks and flicks back.
 * - **There is no hash to be stale against.** The patch is a shallow merge of
 *   named keys, so a concurrent write from another tab touching a *different*
 *   key is not a conflict at all; it is the design.
 *
 * `onMutate` cancels in-flight reads first, because a `GET` that started before
 * the toggle would otherwise land afterwards and overwrite the optimistic value
 * with the pre-toggle one — a flicker that looks exactly like a failed save.
 * The server's answer is the whole document, so `onSuccess` lands on the truth
 * rather than on the client's guess.
 */
export function usePatchPrefs(): UseMutationResult<
  { prefs: Record<string, unknown> },
  Error,
  Record<string, unknown>,
  { previous: { prefs: Record<string, unknown> } | undefined }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.patchPrefs,
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: ['prefs'] });
      const previous = client.getQueryData<{ prefs: Record<string, unknown> }>(['prefs']);
      client.setQueryData<{ prefs: Record<string, unknown> }>(['prefs'], (current) => ({
        // The same merge the server does, including `null` deleting — otherwise
        // the optimistic view and the answer disagree about a cleared key, and
        // the switch moves twice.
        prefs: Object.fromEntries(
          Object.entries({ ...(current?.prefs ?? {}), ...patch }).filter(
            ([, value]) => value !== null,
          ),
        ),
      }));
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) client.setQueryData(['prefs'], context.previous);
    },
    onSuccess: (result) => {
      client.setQueryData(['prefs'], result);
    },
  });
}

/**
 * The admin half's queries — [05 §15.2](../../../docs/design/05-ui-surfaces.md).
 *
 * **These hooks are the mechanism behind "absent, not disabled"** ([P2A §2.6]).
 * The admin sections are not rendered for a non-admin, so these never mount, so
 * that browser issues no request to `/api/admin/*` at all. A disabled control
 * whose hook still ran would fetch, be refused, and put a 403 in the console of
 * somebody who has done nothing wrong — which is how a UI teaches people that
 * errors are normal.
 */
export function useAdminAccounts(): UseQueryResult<AdminAccountList> {
  return useQuery({ queryKey: ['admin', 'accounts'], queryFn: adminApi.listAccounts });
}

export function useCreateAccount(): UseMutationResult<
  { account: Account },
  Error,
  Parameters<typeof adminApi.createAccount>[0]
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createAccount,
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'accounts'] }),
  });
}

export function useUpdateAccount(): UseMutationResult<
  { account: Account },
  Error,
  { handle: string; patch: AccountPatch }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { handle: string; patch: AccountPatch }) =>
      adminApi.updateAccount(input.handle, input.patch),
    // Not optimistic, deliberately — unlike a preference. A capability change
    // can be refused (the last-admin guard), and showing it as taken while the
    // server is about to say no is the failure the editor's unpolled base
    // exists to avoid.
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'accounts'] }),
  });
}

export function useRemoveAccount(): UseMutationResult<undefined, Error, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminApi.removeAccount,
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'accounts'] }),
  });
}

/**
 * The system connections, the install bindings, and what every role will do —
 * [P2B §3](../../../docs/design/workplan/14-p2b-provider-configuration.md) stage P2B.3.
 *
 * **`['admin', 'roles']` is invalidated by every write on this surface**, and
 * that is the point of putting them in one place. A role resolves through the
 * connections *and* the bindings, so a deleted connection changes the table
 * without anything having touched a binding — which is exactly the `dangling`
 * state the table exists to show. A cache that only refreshed on a bindings
 * write would go on reporting a model that is gone.
 */
export function useConnections(): UseQueryResult<{ connections: AdminConnection[] }> {
  return useQuery({ queryKey: ['admin', 'connections'], queryFn: adminApi.listConnections });
}

export function useRoles(): UseQueryResult<{ roles: RoleRow[] }> {
  return useQuery({ queryKey: ['admin', 'roles'], queryFn: adminApi.readRoles });
}

export function useBindings(): UseQueryResult<BindingsState> {
  return useQuery({ queryKey: ['admin', 'bindings'], queryFn: adminApi.readBindings });
}

/** Everything a write to this surface makes stale. */
function invalidateProviderSurface(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ['admin', 'connections'] });
  void client.invalidateQueries({ queryKey: ['admin', 'bindings'] });
  void client.invalidateQueries({ queryKey: ['admin', 'roles'] });
  // The dead-end count asks whether `prose` resolves, so it moves when either
  // of the other two does — which is the whole of P2B.4's ending clause.
  void client.invalidateQueries({ queryKey: ['admin', 'accounts'] });
}

export function useSaveConnection(): UseMutationResult<
  { connection: AdminConnection },
  Error,
  ConnectionInput & { id?: string; contentHash?: string }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectionInput & { id?: string; contentHash?: string }) => {
      const { id, contentHash, ...rest } = input;
      /**
       * **A create and an edit are one mutation because the form is one form**,
       * and they differ on the wire by exactly what the server requires: an
       * edit presents the hash it read, a create has nothing to be stale
       * against.
       */
      return id === undefined || contentHash === undefined
        ? adminApi.createConnection(rest)
        : adminApi.updateConnection(id, { ...rest, contentHash });
    },
    onSuccess: () => {
      invalidateProviderSurface(client);
    },
  });
}

export function useDeleteConnection(): UseMutationResult<undefined, Error, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminApi.deleteConnection,
    onSuccess: () => {
      invalidateProviderSurface(client);
    },
  });
}

export function useWriteBindings(): UseMutationResult<
  BindingsState,
  Error,
  { bindings: Record<string, Binding>; contentHash: string }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { bindings: Record<string, Binding>; contentHash: string }) =>
      adminApi.writeBindings(input.bindings, input.contentHash),
    onSuccess: () => {
      invalidateProviderSurface(client);
    },
  });
}

export function useWriteDefaultBindings(): UseMutationResult<
  BindingsState,
  Error,
  { hi: Binding; lo: Binding; contentHash: string }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: adminApi.writeDefaultBindings,
    onSuccess: () => {
      invalidateProviderSurface(client);
    },
  });
}

/**
 * How many bindings point at a connection, asked only while a delete is being
 * confirmed — [P2B §2.8]'s *warn and proceed*.
 *
 * `enabled` rather than an imperative fetch, because the dialog mounting is the
 * event: an admin who opens it, reads the number and cancels has made one
 * request and left no state behind.
 */
export function useConnectionBindings(id: string | null): UseQueryResult<{ bindings: number }> {
  return useQuery({
    queryKey: ['admin', 'connections', id, 'bindings'],
    queryFn: () => adminApi.connectionBindings(id ?? ''),
    enabled: id !== null,
  });
}

/**
 * Asking an endpoint what it offers — a mutation rather than a query, because
 * it is an action somebody takes rather than state a page has.
 *
 * It is also a `POST` that writes nothing, which is a shape worth naming: it
 * carries a key in the body, and a key does not belong in a URL.
 */
export function useFetchModels(): UseMutationResult<
  { models: string[] },
  Error,
  { baseUrl?: string; apiKey?: string }
> {
  return useMutation({ mutationFn: adminApi.fetchModels });
}

export function useAdminConfig(): UseQueryResult<ConfigView> {
  return useQuery({ queryKey: ['admin', 'config'], queryFn: adminApi.readConfig });
}

export function useWriteConfig(): UseMutationResult<
  { config: Record<string, unknown>; pendingRestart: string[] },
  Error,
  { config: Record<string, unknown>; contentHash?: string }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { config: Record<string, unknown>; contentHash?: string }) =>
      adminApi.writeConfig(input.config, input.contentHash),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'config'] });
      // The banner is above the outlet on every page, so it has to hear about
      // this without the settings page telling it directly.
      void client.invalidateQueries({ queryKey: ['admin', 'notices'] });
    },
  });
}

/**
 * The restart banner's data.
 *
 * Polled rather than fetched once, because [04 §6.3] wants *every* admin to see
 * the pending list — including one who was already looking at another page when
 * a colleague saved. The interval is generous: this is a banner, not a stream.
 */
export function useNotices(enabled: boolean): UseQueryResult<{
  pendingRestart: string[];
  canRestart: boolean;
}> {
  return useQuery({
    queryKey: ['admin', 'notices'],
    queryFn: adminApi.notices,
    enabled,
    refetchInterval: 30_000,
  });
}
