// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  MutationCache,
  QueryCache,
  QueryClient,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { TagEntry } from '@storyengine/shared';

import { endsTheSession, markSessionEnded } from './auth/session-ended.js';
import type { LiveTurn } from './play/reducer.js';
import {
  addSessionGoal,
  addSessionHook,
  adminApi,
  api,
  previewTurn,
  promoteSessionHook,
  PROMOTE_DIRECTORIES,
  readSession,
  readTranscript,
  readTurn,
  removeSessionHook,
  deleteSession,
  renameSession,
  readMemoryPanel,
  illustrateTurn,
  readRenditions,
  retryRendition,
  selectRendition,
  type Rendition,
  setChatSettings,
  setMemoryConfig,
  setSessionArchived,
  setSessionCast,
  setTurnHidden,
  type ChatPatch,
  setSessionLore,
  setSessionPreset,
  runSessionStep,
  writeSessionChannel,
  type Account,
  type AccountPatch,
  type AdminAccountList,
  type AdminConnection,
  type Binding,
  type BindingsState,
  type MyRoles,
  type TaskRoles,
  type ConnectionInput,
  type RoleRow,
  type ConfigView,
  type AuthState,
  type GalleryEntry,
  type Credentials,
  type IndexRow,
  type LibraryKind,
  type LibraryFileError,
  type LibraryObject,
  type ObjectAddress,
  type ObjectImportNotes,
  type ObjectVersion,
  type PendingInput,
  type HookRow,
  type PromoteTarget,
  type PromoteTargetKind,
  type MemoryConfig,
  type MemoryPanel,
  type SessionSummary,
  type SetupInput,
  type TurnPreview,
  type TurnRecord,
} from './api.js';

/**
 * Server state, through TanStack Query ([19 §6](../../../docs/design/19-tech-stack.md)):
 * nearly all client state *is* server state here, and these hooks are the whole
 * of the client's model layer.
 *
 * Library queries poll. Nothing pushes yet — SSE is P2 — and the watcher's
 * pick-up of a hand edit on disk is the storage thesis's demo
 * ([P1 §3](../../../docs/design/workplan/07-p1-implementation.md) step 8), so the browser has to
 * ask often enough for "without a restart" to read as "by itself".
 */

const LIBRARY_POLL_MS = 2000;

export const queryClient: QueryClient = new QueryClient({
  /**
   * ***A 401 anywhere says the sign-in has ended*** (2026-09-27) — see
   * `auth/session-ended.ts`, which has the argument and the one code it means.
   * On the caches rather than in each hook, because the claim is about every
   * request this client makes and a hook that forgot would be the one page that
   * went on failing in silence.
   */
  queryCache: new QueryCache({
    onError: (failure) => {
      if (endsTheSession(failure)) markSessionEnded(queryClient);
    },
  }),
  mutationCache: new MutationCache({
    onError: (failure) => {
      if (endsTheSession(failure)) markSessionEnded(queryClient);
    },
  }),
  defaultOptions: {
    /**
     * ***`always` for writes too*** (2026-09-27), for the reason the queries'
     * comment below gives. A mutation's default is `online` as well, and it
     * does not refuse a write when the browser says it is offline: it *pauses*
     * it, silently, until the browser says otherwise. So a laptop with its
     * Wi-Fi off, talking to the box in the next room over a cable, pressed
     * Save and saw it spin forever — the write never sent, never failed, and
     * waiting for an event about the internet that has nothing to do with it.
     */
    mutations: {
      networkMode: 'always',
    },
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
       * ([09 §5.1](../../../docs/design/09-server-multiuser-deployment.md)), and
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
 * ***What the library holds and could not read*** (2026-09-28) — one query for
 * the panel over the list and for the page of an object whose file broke after
 * it was read, so the two cannot disagree about a file. Polled like the
 * library it describes: a file repaired in a text editor clears itself from
 * both, where the panel's own query waited for a refocus.
 */
export function useLibraryErrors(): UseQueryResult<{ errors: LibraryFileError[] }> {
  return useQuery({
    queryKey: ['library', 'errors'],
    queryFn: () => api.libraryErrors(),
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

/**
 * The index rows behind an object — the workbench's projection ([P3.3]).
 * Polled at the library cadence like every read beside it: gate step 7's
 * hand-edit-and-watch rides on the poll, and a copy appearing on disk shows
 * up here within it.
 */
export function useIndexRows(kind: LibraryKind, id: string): UseQueryResult<{ rows: IndexRow[] }> {
  return useQuery({
    queryKey: ['library', kind, id, 'rows'],
    queryFn: () => api.indexRows(kind, id),
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
  /** See `api.updateObject` — [10 §11.2c]'s history line, on the one save that has one. */
  importedFrom?: string;
}

export function useSaveObject(): UseMutationResult<
  { contentHash: string; object: Record<string, unknown> },
  Error,
  SaveInput
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveInput) =>
      api.updateObject(input.kind, input.id, input.object, input.contentHash, input.importedFrom),
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
  { kind: LibraryKind; object: Record<string, unknown>; copyOf?: string }
> {
  const client = useQueryClient();
  return useMutation({
    // Passed only when there is one, so a plain create is called exactly as it
    // always was.
    mutationFn: (input: { kind: LibraryKind; object: Record<string, unknown>; copyOf?: string }) =>
      input.copyOf === undefined
        ? api.createObject(input.kind, input.object)
        : api.createObject(input.kind, input.object, input.copyOf),
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
    // Same pair as a save — a restore is an ordinary write ([03 §11.1]), and
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
 * The account's own record — [10 §15.1](../../../docs/design/10-ui-surfaces.md).
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
  { displayName?: string; locale?: string | null; hiddenFromGallery?: boolean }
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

/**
 * What the imports said about one object ([P5 §1.8]).
 *
 * Unpolled, unlike the object beside it: a review row is written once when a
 * sweep finishes and never changes, so re-asking every two seconds would be
 * traffic for an answer that cannot move.
 */
export function useObjectImportNotes(objectId: string): UseQueryResult<{
  notes: ObjectImportNotes[];
}> {
  return useQuery({
    queryKey: ['import-notes', objectId],
    queryFn: () => api.objectImportNotes(objectId),
  });
}

/**
 * The sign-in gallery — [12 §6], [P10.4].
 *
 * ***Mounted only by the gallery screen***, which is the same absent-is-absent
 * mechanism the settings page uses: a browser arriving at a `form`-mode install
 * never asks, so the route's 404 is a thing nobody sees rather than a thing in a
 * console.
 *
 * *No refetch interval.* An arrival screen is looked at once; a poll on an
 * unauthenticated route would be this install talking to nobody, repeatedly.
 */
export function useGallery(): UseQueryResult<{ accounts: GalleryEntry[] }> {
  return useQuery({ queryKey: ['gallery'], queryFn: api.gallery, retry: false });
}

/**
 * Setting or clearing your own face — [12 §5.2].
 *
 * Both invalidate `auth/state` as well as the gallery, because the signed-in
 * surfaces render the same face and a save that only refreshed the sign-in
 * screen would leave the person looking at their old one.
 */
export function useUploadAvatar(): UseMutationResult<{ avatar: string }, Error, File> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.uploadAvatar,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['gallery'] });
      void client.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useRemoveAvatar(): UseMutationResult<undefined, Error, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.removeAvatar(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['gallery'] });
      void client.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function usePrefs(): UseQueryResult<{ prefs: Record<string, unknown> }> {
  return useQuery({ queryKey: ['prefs'], queryFn: api.readPrefs });
}

/**
 * The tag registry — [05 §4](../../../docs/design/05-tagging.md).
 *
 * One key, because there is one document: every write answers with the whole
 * list, so a mutation seeds the cache from its own response rather than
 * invalidating and refetching what the server has already sent.
 */
export function useTags(): UseQueryResult<{ tags: TagEntry[] }> {
  return useQuery({ queryKey: ['tags'], queryFn: api.readTags });
}

/**
 * Every registry write, behind one hook.
 *
 * A single mutation with a discriminated action rather than five hooks: they
 * differ only in which call they make, they all answer with the same shape, and
 * they all want the same `onSuccess`. Five copies of that would be five places
 * for the cache-seeding to drift.
 */
export type TagWrite =
  | { kind: 'create'; name: string; swatch?: string | null }
  | {
      kind: 'patch';
      id: string;
      patch: { swatch?: string | null; folder?: string; hidden?: boolean };
    }
  | { kind: 'delete'; id: string }
  | { kind: 'order'; ids: string[] }
  | { kind: 'rename'; id: string; to: string; rewriteGates: boolean; dryRun?: boolean }
  | { kind: 'adopt' };

/**
 * What a registry write answers with.
 *
 * The whole list always; `gatesFound` only from a rename, which is the one
 * operation with something else to report ([05 §1]). Optional rather than a
 * union per verb, because every caller reads `tags` and exactly one reads the
 * rest.
 */
export interface TagWriteResult {
  tags: TagEntry[];
  gatesFound?: { book: string; entry: string }[];
  /** A rename's: the actors it renames, and what it did to the gates when asked. */
  actorsRenamed?: number;
  booksRewritten?: string[];
  skipped?: { id: string; name: string; reason: string }[];
}

export function useWriteTags(): UseMutationResult<TagWriteResult, Error, TagWrite> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (write: TagWrite) => {
      if (write.kind === 'create') {
        return api.createTag({
          name: write.name,
          ...(write.swatch === undefined ? {} : { swatch: write.swatch }),
        });
      }
      if (write.kind === 'patch') return api.patchTag(write.id, write.patch);
      if (write.kind === 'delete') return api.deleteTag(write.id);
      if (write.kind === 'rename') {
        return api.renameTag(write.id, {
          to: write.to,
          rewriteGates: write.rewriteGates,
          ...(write.dryRun === true ? { dryRun: true } : {}),
        });
      }
      if (write.kind === 'adopt') return api.adoptTags();
      return api.orderTags(write.ids);
    },
    onSuccess: (result, write) => {
      // Seeded from the answer rather than invalidated: the server just sent
      // the whole document, so a refetch would ask for what is already here.
      client.setQueryData(['tags'], { tags: result.tags });
      /**
       * **The two writes that reach the library invalidate it.** A rename
       * changes what every carrier is *called* without touching any of them, so
       * nothing would refetch on its own and the shelf would go on showing the
       * old name until something else happened to reload it.
       */
      // A dry run changed nothing, so there is nothing to refetch.
      if ((write.kind === 'rename' && write.dryRun !== true) || write.kind === 'adopt') {
        void client.invalidateQueries({ queryKey: ['library'] });
      }
    },
  });
}

/**
 * **The one optimistic mutation in this codebase**, and the reasons are specific
 * enough to be worth writing down — [P2A §3](../../../docs/design/workplan/09-p2a-configuration-surface.md).
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
 * The play surface's reads, lifted out of `PlayPage` for the workbench —
 * [P3.1](../../../docs/design/workplan/15-p3-implementation.md).
 *
 * Play's queries were the one inline exception to this file being the model
 * layer, and that was fine while Play was their only mount. The workbench is a
 * second mount in a different subtree, and two components spelling the same
 * key by hand is how a cache splits: one of them drifts a segment and both
 * fetch, disagree, and refresh on different schedules. Lifted, the key has one
 * spelling — and the panel opening over Play issues **no new request**,
 * because it reads the entry PlayPage already holds, which is also what keeps
 * PlayPage's invalidate-on-finish refreshing both surfaces at once.
 */
export function useSession(
  sessionId: string,
): UseQueryResult<Awaited<ReturnType<typeof readSession>>> {
  return useQuery({ queryKey: ['session', sessionId], queryFn: () => readSession(sessionId) });
}

/**
 * Point a session at a treatment and a set of books — [P6B.0].
 *
 * **The three keys a head move refreshes, for the same reason it refreshes
 * them**: the session file changed, so the entry Play and the workbench both
 * read is stale, and the preview is an answer about a prompt whose contents
 * just moved. The preview is *reset* rather than invalidated because it has no
 * `queryFn` of its own ([P3.4]) — invalidating an entry nothing can refetch
 * leaves the old number on screen, which after attaching a book is a meter
 * confidently reporting a prompt that no longer exists.
 *
 * The transcript is deliberately not in the set: turns already taken are what
 * they were, and retrieval changes the *next* one.
 */
/**
 * The three session verbs that had routes and no controls — [P7B.2].
 *
 * All three invalidate `['sessions']` as well as the session's own entry: the
 * list is what carries a session's name, its archived state and its existence,
 * and a panel that changed one without telling the list would leave somebody
 * looking at a row that no longer describes anything.
 */
export function useSetSessionPreset(
  sessionId: string,
): UseMutationResult<
  { session: SessionSummary },
  Error,
  { presetId: string } | { preset: Record<string, unknown> },
  { previous: { session: SessionSummary } | undefined }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { presetId: string } | { preset: Record<string, unknown> }) =>
      setSessionPreset(sessionId, body),
    /**
     * ***The pack as written, at once*** (2026-09-27) — `usePatchPrefs`' pattern.
     *
     * Every write here sends the whole pack, built from the session in this
     * cache. The cache used to catch up only when the refetch after the write
     * landed, so a second write made before then — the maximum length changed
     * just after the temperature, or a block saved just after either — was
     * built from the pack as it was before the first, and put the first back.
     * The pack the person sent is the cache's until the server's answer
     * replaces it, and a write that fails puts the old one back.
     *
     * *Only for a pack sent whole.* Switching to a library preset is the
     * server's copy to make, and there is nothing to show until it has.
     */
    onMutate: async (body) => {
      if (!('preset' in body)) return { previous: undefined };
      await client.cancelQueries({ queryKey: ['session', sessionId] });
      const previous = client.getQueryData<{ session: SessionSummary }>(['session', sessionId]);
      client.setQueryData<{ session: SessionSummary }>(['session', sessionId], (held) =>
        held === undefined ? held : { ...held, session: { ...held.session, preset: body.preset } },
      );
      return { previous };
    },
    onError: (_failure, _body, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(['session', sessionId], context.previous);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['session', sessionId] });
      // The pack decides what the next turn assembles from, so a composed
      // preview built over the old one is stale the moment this lands.
      void client.invalidateQueries({ queryKey: ['preview', sessionId] });
    },
  });
}

export function useSetSessionArchived(
  sessionId: string,
): UseMutationResult<{ session: SessionSummary }, Error, boolean> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (archived: boolean) => setSessionArchived(sessionId, archived),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['session', sessionId] });
      void client.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

/**
 * ***The memory panel*** — [08 §7], [P8.4].
 *
 * **Its own key, and fetched only while the panel is open.** The read walks
 * every session file the account owns; `enabled` keeps that off the page's
 * first paint and off every turn, which is the same trade the route makes for
 * the same reason.
 */
export function useMemoryPanel(sessionId: string, open: boolean): UseQueryResult<MemoryPanel> {
  return useQuery({
    queryKey: ['session-memory', sessionId],
    queryFn: () => readMemoryPanel(sessionId),
    enabled: open,
  });
}

/**
 * Every rendition a session holds, keyed by id — [P9.4].
 *
 * ***A map rather than a list***, because that is how a live `rendition` frame
 * is applied: an upsert into the same map. Two shapes for one thing is how a
 * page and a socket come to disagree about whether a picture has arrived.
 *
 * *Its own key rather than folding into `['transcript']`*, for the reason the
 * memory panel has its own: a rendition's state changes **after** its turn is
 * written, so two reads cached together would have to be invalidated together
 * and the transcript would refetch every time a picture landed.
 */
export interface RenditionSet {
  byId: Map<string, Rendition>;
  /**
   * Which sibling each turn shows, keyed by turn id — [06 §10.7].
   *
   * Carried here rather than read off the session because it is answered by the
   * same route: the set and the choice on two cache entries would expire
   * independently, and the reader would watch a picture they did not choose for
   * as long as the stale half survived.
   */
  selection: Readonly<Record<string, string>>;
}

export function useRenditions(sessionId: string): UseQueryResult<RenditionSet> {
  return useQuery({
    queryKey: renditionsKey(sessionId),
    queryFn: async () => {
      const { renditions, selection } = await readRenditions(sessionId);
      return { byId: new Map(renditions.map((one) => [one.id, one])), selection };
    },
  });
}

/**
 * The key two subtrees spell, so it is a function.
 *
 * `previewKey` and `liveKey` are functions for the reason this one is: *"two
 * components spelling the same key by hand is how a cache splits."* The stream
 * reducer upserts into this cache and the transcript reads it.
 */
export function renditionsKey(sessionId: string): readonly unknown[] {
  return ['session-renditions', sessionId];
}

export function useRetryRendition(
  sessionId: string,
): UseMutationResult<{ rendition: Rendition }, Error, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (renditionId: string) => retryRendition(sessionId, renditionId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: renditionsKey(sessionId) });
    },
  });
}

/**
 * **Illustrate** / **Set the scene** — [06 §10.6], [P9.4].
 *
 * *One mutation for both*, because they are one route and one act; the purpose
 * is the argument. Invalidating the set is what puts the `pending` record on the
 * screen — the pixels arrive on the stream afterwards and need no second read.
 */
export function useIllustrateTurn(
  sessionId: string,
): UseMutationResult<
  Awaited<ReturnType<typeof illustrateTurn>>,
  Error,
  { turnId: string; purpose: 'illustration' | 'background' }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ turnId, purpose }: { turnId: string; purpose: 'illustration' | 'background' }) =>
      illustrateTurn(sessionId, turnId, purpose),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: renditionsKey(sessionId) });
    },
  });
}

export function useSelectRendition(
  sessionId: string,
): UseMutationResult<{ selected: string }, Error, { turnId: string; renditionId: string }> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ turnId, renditionId }: { turnId: string; renditionId: string }) =>
      selectRendition(sessionId, turnId, renditionId),
    onSuccess: () => {
      // The selection travels with the set, so this is the one key to refresh —
      // the pictures did not change, only which of them is showing.
      void client.invalidateQueries({ queryKey: renditionsKey(sessionId) });
    },
  });
}

export function useSetMemoryConfig(
  sessionId: string,
): UseMutationResult<{ memory: MemoryConfig }, Error, MemoryConfig> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (config: MemoryConfig) => setMemoryConfig(sessionId, config),
    onSuccess: (answer) => {
      /**
       * ***The switches read the answer before they are live again***
       * (2026-09-27). This settles, and the switches re-enable, as soon as the
       * write lands — and the next write is built whole from this cache entry,
       * so while it still held the config from before, a second switch sent the
       * first one straight back: *Share memories* turned on and then, one click
       * later, off again with nothing on screen saying so.
       *
       * The config and each row's association come from the answer. `effective`
       * and the books are left for the refetch: they are derived on the server,
       * and deriving them here is what `panel.ts` warns against. An entry this
       * cache does not hold stays absent, which covers *Start isolated*, whose
       * page has no panel.
       */
      client.setQueryData<MemoryPanel>(['session-memory', sessionId], (held) =>
        held === undefined
          ? held
          : {
              ...held,
              config: answer.memory,
              others: held.others.map((row) => ({
                ...row,
                association: answer.memory.associations[row.sessionId] ?? 'auto',
              })),
            },
      );
      // The panel, because `effective` is derived from what just changed; and
      // the session, because the file did.
      void client.invalidateQueries({ queryKey: ['session-memory', sessionId] });
      void client.invalidateQueries({ queryKey: ['session', sessionId] });
    },
  });
}

export function useDeleteSession(sessionId: string): UseMutationResult<void, Error, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => deleteSession(sessionId),
    onSuccess: () => client.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

export function useSetSessionLore(
  sessionId: string,
): UseMutationResult<
  { session: SessionSummary },
  Error,
  { treatment: string | null; lore: string[] }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (selection: { treatment: string | null; lore: string[] }) =>
      setSessionLore(sessionId, selection),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['session', sessionId] });
      void client.resetQueries({ queryKey: previewKey(sessionId) });
    },
  });
}

/**
 * ***A chat's settings, its roster and its hide map*** — [P14 §1.8], [P14.5].
 *
 * Three writes to the session file, and each refreshes what `useWriteChannel`
 * refreshes and for its reason: the entry Play and the workbench read is
 * stale, and a preview assembled over the old settings is an answer about a
 * prompt that no longer exists. *The transcript is refreshed by a hide too* —
 * the ghost is drawn from the session's map, but the siblings a hide rides
 * onto are the transcript's.
 */
export function useSetChatSettings(
  sessionId: string,
): UseMutationResult<Awaited<ReturnType<typeof setChatSettings>>, Error, ChatPatch> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: ChatPatch) => setChatSettings(sessionId, patch),
    /**
     * ***Pending until the refetched settings are in the cache.*** A card's
     * prompt switch sends the member's whole entry computed from the cached
     * `chat`, so a second toggle made before the refetch lands would be computed
     * from the stale one and undo the first. Returning the invalidation keeps
     * `isPending` — and the controls it disables — true until it has.
     */
    onSuccess: () => {
      void client.resetQueries({ queryKey: previewKey(sessionId) });
      return client.invalidateQueries({ queryKey: ['session', sessionId] });
    },
  });
}

export function useSetCast(
  sessionId: string,
): UseMutationResult<
  Awaited<ReturnType<typeof setSessionCast>>,
  Error,
  { persona: string | null; actors: string[] }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (cast: { persona: string | null; actors: string[] }) =>
      setSessionCast(sessionId, cast),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['session', sessionId] });
      void client.resetQueries({ queryKey: previewKey(sessionId) });
    },
  });
}

export function useSetHidden(
  sessionId: string,
): UseMutationResult<
  Awaited<ReturnType<typeof setTurnHidden>>,
  Error,
  { turnId: string; hidden: boolean | number[] }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (write: { turnId: string; hidden: boolean | number[] }) =>
      setTurnHidden(sessionId, write.turnId, write.hidden),
    /**
     * ***Pending until the refetched hide entries are in the cache***, for
     * `useSetChatSettings`' reason: a hide sends the turn's whole entry
     * (`hideSent`) computed from the cached session, so two quick hides on one
     * turn would otherwise each write their own index and the second erase the
     * first.
     */
    onSuccess: () => {
      void client.resetQueries({ queryKey: previewKey(sessionId) });
      return client.invalidateQueries({ queryKey: ['session', sessionId] });
    },
  });
}

/**
 * Recovering one degraded channel — [06 §4.2], [P7.1].
 *
 * **Invalidates the session and resets the preview**, the same two keys
 * `useSetSessionLore` touches and for the same reason: a channel write advances
 * the head, so the session file changed and any assembled preview built over the
 * old state is stale.
 *
 * *No `onError` special-casing, because a refusal is not an error*: the route
 * answers 200 with an unapplied effect, and the caller decides what to say.
 */
/**
 * ***Update trackers*** — a declared on-demand step, run between turns
 * ([P14.5a]). It writes an engine turn under the head — the shape a channel
 * write writes, and no transcript row — so it refreshes what a channel write
 * refreshes. *Pending until the refetch lands*, as the chat settings' write
 * is: the button stays disabled until the cards show what it wrote.
 */
export function useRunStep(
  sessionId: string,
): UseMutationResult<Awaited<ReturnType<typeof runSessionStep>>, Error, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (stepId: string) => runSessionStep(sessionId, stepId),
    onSuccess: () => {
      void client.resetQueries({ queryKey: previewKey(sessionId) });
      return client.invalidateQueries({ queryKey: ['session', sessionId] });
    },
  });
}

export function useWriteChannel(
  sessionId: string,
): UseMutationResult<
  Awaited<ReturnType<typeof writeSessionChannel>>,
  Error,
  { key: string; value: unknown }
> {
  const client = useQueryClient();
  return useMutation({
    mutationKey: channelWriteKey(sessionId),
    mutationFn: (write: { key: string; value: unknown }) =>
      writeSessionChannel(sessionId, write.key, write.value),
    /**
     * ***The refetch is part of the write*** (2026-09-29, the [P14.5a] review):
     * returned, so `isPending` — and `useIsMutating` over
     * {@link channelWriteKey} — lasts until the session read holds the value
     * just written. A control that re-enabled before that would build its next
     * write from the value the person saw *before* this one, and the second
     * write would quietly undo the first: a lock toggled twice fast, or a Save
     * over a tracker the model updated meanwhile.
     */
    onSuccess: () => {
      void client.resetQueries({ queryKey: previewKey(sessionId) });
      return client.invalidateQueries({ queryKey: ['session', sessionId] });
    },
  });
}

/**
 * The key every channel write for a session shares, so a card can wait for
 * any of them — a lock set is one value that several cards write.
 */
export function channelWriteKey(sessionId: string): readonly unknown[] {
  return ['channel-write', sessionId];
}

/**
 * Adding a hook to a running session, or taking one out — [03 §4.1], [P7.5].
 *
 * **One mutation for both**, because they are the same act from the panel's side
 * — the pool is what changes — and because a caller holding two hooks that
 * invalidate the same key is the shape that drifts.
 *
 * *It invalidates the session rather than the transcript*: [03 §4.1] calls
 * adding a hook *"an authoring act, not a story event"*, so there is no turn to
 * refetch and the pool the panel reads lives on the session.
 */
export function useSessionHooks(
  sessionId: string,
): UseMutationResult<
  { session: SessionSummary },
  Error,
  { add: Record<string, unknown> } | { remove: string; from?: HookRow['source'] }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      change: { add: Record<string, unknown> } | { remove: string; from?: HookRow['source'] },
    ) =>
      'add' in change
        ? addSessionHook(sessionId, change.add)
        : change.from === undefined
          ? removeSessionHook(sessionId, change.remove)
          : removeSessionHook(sessionId, change.remove, change.from),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['session', sessionId] });
    },
  });
}

/**
 * A goal written at a completion — [06 §7.3.4], [P7.6].
 *
 * *It invalidates the session rather than the transcript*, like the hook
 * mutation beside it: adding a goal to the chain is an authoring act and there is
 * no turn to refetch.
 */
export function useAddGoal(
  sessionId: string,
): UseMutationResult<{ session: SessionSummary }, Error, Record<string, unknown>> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (goal: Record<string, unknown>) => addSessionGoal(sessionId, goal),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['session', sessionId] });
    },
  });
}

/**
 * A hook saved out of a session onto one of [03 §4.1]'s carriers — [06 §6.1],
 * [15 §5.1].
 *
 * ***It invalidates the library and not the session, and that asymmetry is the
 * whole of what promotion means.*** Every other mutation in this file that a
 * play surface calls refreshes `['session', id]`, because the thing it changed
 * is the session. This one changes a **library object** — a treatment, a Setup,
 * a lorebook — and leaves the running game exactly as it was, by design and not
 * by omission: the pool entry keeps its own `source`, the row on the panel
 * still reads *added to this session*, and the hook goes on being eligible in
 * the session somebody wrote it in. Refetching the session here would be this
 * hook's own claim about itself, and it would be false.
 *
 * *The one kind rather than the whole prefix*, because `['library']` is every
 * listing in the client and a promotion touched one folder. Prefix matching
 * carries the rest: `['library', kind]` also covers `useLibraryObject` and
 * `useObjectHistory` for that kind, which is right — the object gained a hook
 * and its history gained the version that says where the hook came from.
 *
 * **`useEditorBase` is outside the prefix and stays outside it.** Its docstring
 * is emphatic that the object under an open editor must not shift beneath the
 * form, and a promotion is exactly the concurrent change the 412 exists to
 * answer. Somebody who has that treatment open in another tab is told when they
 * save, which is the designed mechanism, rather than having the list they are
 * editing rewritten underneath them.
 */
export function usePromoteHook(
  sessionId: string,
): UseMutationResult<
  { object: { id: string; name: string; kind: PromoteTargetKind } },
  Error,
  { hookId: string; target: PromoteTarget; from?: HookRow['source'] }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (what: { hookId: string; target: PromoteTarget; from?: HookRow['source'] }) =>
      promoteSessionHook(sessionId, what.hookId, what.target, what.from),
    onSuccess: (result) => {
      void client.invalidateQueries({
        queryKey: ['library', PROMOTE_DIRECTORIES[result.object.kind]],
      });
    },
  });
}

/**
 * Renaming a session — [03 §8].
 *
 * A hook rather than two inline mutations for the reason `useSession`'s own
 * docstring gives: two components spelling the same cache key by hand is how a
 * cache splits, and this one has two callers from the day it lands — the list,
 * and the play heading.
 *
 * **`previewKey` is deliberately not reset.** A session name reaches no
 * assembled prompt, so unlike `useSetSessionLore` there is nothing here that
 * could change what the next turn would send. Both list and detail are
 * invalidated, because the name is denormalised into the list rows.
 */
export function useRenameSession(
  sessionId: string,
): UseMutationResult<{ session: SessionSummary }, Error, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => renameSession(sessionId, name),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['session', sessionId] });
      void client.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useTranscript(
  sessionId: string,
): UseQueryResult<Awaited<ReturnType<typeof readTranscript>>> {
  return useQuery({
    queryKey: ['transcript', sessionId],
    queryFn: () => readTranscript(sessionId),
  });
}

/**
 * One turn by id — [P3.0]'s route, for the surfaces that address a turn
 * rather than a path: compare (P3.6), and any panel over a turn the head has
 * passed. Default staleTime, with the reason written down: a `complete` turn
 * is immutable and `Infinity` would be true for it, but a `suspended` one
 * will finish, and gating the staleness on status is complexity nothing
 * needs yet.
 */
export function useTurn(sessionId: string, turnId: string): UseQueryResult<{ turn: TurnRecord }> {
  return useQuery({
    queryKey: ['turn', sessionId, turnId],
    queryFn: () => readTurn(sessionId, turnId),
  });
}

export function previewKey(sessionId: string): readonly unknown[] {
  return ['preview', sessionId];
}

export function liveKey(sessionId: string): readonly unknown[] {
  return ['live', sessionId];
}

/**
 * The turn being taken, read from one cache entry nobody fetches — [P3.5].
 *
 * The same shape as {@link usePreview} and for the same reason: the panel is a
 * sibling of the play surface in the shell's tree, so the only thing the two
 * share is this cache. `skipToken` is again the mechanism — the panel cannot
 * ask for a turn's progress, it can only read what the surface watching the
 * stream has already been told, which keeps the reader a reader.
 *
 * **The stream is the writer, and it is the only one.** `PlayPage` mirrors its
 * reducer's `live` here as frames arrive; the entry is cleared when the
 * surface unmounts, because a turn's progress is not a fact about a session
 * you are no longer watching.
 */
export function useLiveTurn(sessionId: string): UseQueryResult<{ live: LiveTurn | null }> {
  return useQuery<{ live: LiveTurn | null }>({
    queryKey: liveKey(sessionId),
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: 0,
  });
}

/**
 * The pending assemble, read from one cache entry that **nobody fetches** —
 * [P3.4].
 *
 * `queryFn: skipToken` is the mechanism and the guarantee at once: this hook
 * *cannot* issue a request, so the meter and the workbench cannot end up
 * asking separately and showing different numbers. There is one answer, at an
 * address the route names, written by the composer through
 * {@link useRefreshPreview} — which is what lets the panel render a pending
 * turn while staying the reader [10 §2] says it must be. Its subject still
 * comes from the route and the cache; nothing about the composer is
 * remembered anywhere the panel can reach.
 *
 * `gcTime: 0` is [P3 §1.6] made mechanical — *the meter's numerator does not
 * exist at rest*. Leave Play and the entry goes with the last observer,
 * instead of lingering to be shown as fact on the way back.
 *
 * **Deliberately not polled.** Every other session-scoped read here either
 * polls or is invalidated on the turn's finish; this one is driven by typing,
 * and a `refetchInterval` would re-read every segment on disk on a timer for
 * a surface nobody is touching.
 */
export function usePreview(sessionId: string): UseQueryResult<{ preview: TurnPreview }> {
  // The type argument is explicit because `skipToken` gives the inference
  // nothing to work from — there is no `queryFn` whose return it could read.
  return useQuery<{ preview: TurnPreview }>({
    queryKey: previewKey(sessionId),
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: 0,
  });
}

/**
 * The composer's writer: a POST that writes nothing, landing in the cache.
 *
 * Two existing patterns composed rather than a new one — `useFetchModels`
 * blesses the POST-shaped read, and `usePatchPrefs` blesses a hook writing the
 * cache directly.
 *
 * **Out-of-order answers need no guard here, and that is a finding rather than
 * an assumption.** Two previews are in flight whenever the endpoint is slower
 * than the debounce, which is exactly the install somebody is debugging when
 * they look at the meter — so a stale answer landing last would settle the
 * meter on a keystroke already typed past. A sequence number was written to
 * prevent it and then removed: this observer does not run a superseded
 * mutation's `onSuccess` at all, so the guard could not be made to fail. The
 * behaviour is pinned by *the last answer wins when two are in flight* in
 * `PlayPage.test.tsx`, which holds whoever provides it; if a future version
 * changes that, the test reddens and the guard comes back with a reason.
 */
export function useRefreshPreview(
  sessionId: string,
): UseMutationResult<{ preview: TurnPreview }, Error, PendingInput> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (pending: PendingInput) => previewTurn(sessionId, pending),
    onSuccess: (answer) => {
      client.setQueryData(previewKey(sessionId), answer);
    },
  });
}

/**
 * The admin half's queries — [10 §15.2](../../../docs/design/10-ui-surfaces.md).
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

/**
 * An administrator setting somebody else's password — [P7B.5].
 *
 * **No invalidation, for `useChangePassword`'s reason and one more.** Nothing
 * the client caches changes: a password is not in `AdminAccountList`, and a
 * session is a signed stateless cookie with no denylist, so this cannot end one
 * held elsewhere — including the target's. The surface has to say that rather
 * than imply otherwise by refreshing something.
 */
export function useSetAccountPassword(): UseMutationResult<
  undefined,
  Error,
  { handle: string; newPassword: string }
> {
  return useMutation({
    mutationFn: (input: { handle: string; newPassword: string }) =>
      adminApi.setAccountPassword(input.handle, input.newPassword),
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
 * [P2B §3](../../../docs/design/workplan/10-p2b-provider-configuration.md) stage P2B.3.
 *
 * **`['admin', 'roles']` is invalidated by every write on this surface**, and
 * that is the point of putting them in one place. A role resolves through the
 * connections *and* the bindings, so a deleted connection changes the table
 * without anything having touched a binding — which is exactly the `dangling`
 * state the table exists to show. A cache that only refreshed on a bindings
 * write would go on reporting a model that is gone.
 */
/**
 * Which directory a connection surface is about — [10 §15.1], [P10.3].
 *
 * ***A parameter rather than a second set of hooks***, and the reason is the
 * one `routes/connections.ts` gives for keeping both registrars in one module:
 * the two scopes share a record shape, a stale check and an error vocabulary, so
 * the easy mistake was never a second copy — it was one of them quietly reading
 * the other's list. A parameter makes the scope appear at every call site.
 */
export type ConnectionScope = 'system' | 'mine';

/** The cache key, which must differ or one list would answer for both. */
function connectionsKey(scope: ConnectionScope): readonly string[] {
  return scope === 'system' ? ['admin', 'connections'] : ['me', 'connections'];
}

export function useConnections(
  scope: ConnectionScope = 'system',
): UseQueryResult<{ connections: AdminConnection[] }> {
  return useQuery({
    queryKey: connectionsKey(scope),
    queryFn: scope === 'system' ? adminApi.listConnections : api.listMyConnections,
  });
}

export function useRoles(): UseQueryResult<{ roles: RoleRow[] }> {
  return useQuery({ queryKey: ['admin', 'roles'], queryFn: adminApi.readRoles });
}

export function useBindings(): UseQueryResult<BindingsState> {
  return useQuery({ queryKey: ['admin', 'bindings'], queryFn: adminApi.readBindings });
}

/** Everything a write to this surface makes stale. */
function invalidateProviderSurface(client: QueryClient, scope: ConnectionScope = 'system'): void {
  void client.invalidateQueries({ queryKey: connectionsKey(scope) });
  void client.invalidateQueries({ queryKey: ['admin', 'bindings'] });
  void client.invalidateQueries({ queryKey: ['admin', 'roles'] });
  // The dead-end count asks whether `prose` resolves, so it moves when either
  // of the other two does — which is the whole of P2B.4's ending clause.
  void client.invalidateQueries({ queryKey: ['admin', 'accounts'] });
  /**
   * **And the caller's own table, which is not an admin key** — [P7.3].
   *
   * A user's resolution layers over the install's, so removing a system
   * connection or repointing a default changes what *their* pane should say.
   * Leaving it out would be a stale answer on the one screen whose whole job is
   * to be the current one — and an admin editing their own install is exactly
   * the person who would have both open.
   */
  void client.invalidateQueries({ queryKey: ['me', 'roles'] });
}

/**
 * The caller's own role table, the document behind it, and what may be picked —
 * [10 §15.1], [P7.3].
 *
 * **Keyed under `me` rather than `admin`, which is the point of the route.**
 * `SettingsPage` renders the admin sections only for an admin, so an
 * `admin`-keyed query would make this pane unmountable for the people
 * [19 §5.1] wrote it for: *"anyone who wants their own key overrides a role
 * without the admin's involvement"*.
 */
export function useMyRoles(): UseQueryResult<MyRoles> {
  return useQuery({ queryKey: ['me', 'roles'], queryFn: api.readMyRoles });
}

/**
 * Writing your own bindings.
 *
 * **Not optimistic, unlike `usePatchPrefs`.** A preference's whole feedback is
 * the page changing, so a lag reads as a broken control; a binding's feedback is
 * a *resolution* the server computes, and guessing at it here would mean
 * reimplementing [19 §5.1]'s layering in the browser — the second copy
 * `GET /api/me/roles` exists to avoid. So the answer is awaited and the table
 * re-read.
 */
/**
 * Choosing which role field assist asks for — awaited and re-read, for
 * `useWriteMyBindings`'s reason: the row it points at is a resolution the
 * server computes.
 */
export function useWriteMyTaskRoles(): UseMutationResult<{ tasks: TaskRoles }, Error, TaskRoles> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (tasks: TaskRoles) => api.writeMyTaskRoles(tasks),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['me', 'roles'] });
    },
  });
}

export function useWriteMyBindings(): UseMutationResult<
  BindingsState,
  Error,
  { bindings: Record<string, Binding>; contentHash: string }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { bindings: Record<string, Binding>; contentHash: string }) =>
      api.writeMyBindings(input.bindings, input.contentHash),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['me', 'roles'] });
    },
  });
}

export function useSaveConnection(
  scope: ConnectionScope = 'system',
): UseMutationResult<
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
      if (id === undefined || contentHash === undefined) {
        return scope === 'system' ? adminApi.createConnection(rest) : api.createMyConnection(rest);
      }
      return scope === 'system'
        ? adminApi.updateConnection(id, { ...rest, contentHash })
        : api.updateMyConnection(id, { ...rest, contentHash });
    },
    onSuccess: () => {
      invalidateProviderSurface(client, scope);
    },
  });
}

export function useDeleteConnection(
  scope: ConnectionScope = 'system',
): UseMutationResult<undefined, Error, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: scope === 'system' ? adminApi.deleteConnection : api.deleteMyConnection,
    onSuccess: () => {
      invalidateProviderSurface(client, scope);
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
export function useConnectionBindings(
  id: string | null,
  /**
   * ***Off for the personal scope, and the query is absent rather than
   * disabled*** — [P10.3], `SettingsPage`'s *absent is absent*. There is no
   * personal route for this count and deliberately so: [P2B §2.8]'s warning is
   * about breaking **other people's** turns, which deleting your own does not
   * do. A query left enabled would ask `/api/admin/…` from a non-admin's browser
   * and be told 403 for a question nobody asked.
   */
  enabled = true,
): UseQueryResult<{ bindings: number }> {
  return useQuery({
    queryKey: ['admin', 'connections', id, 'bindings'],
    queryFn: () => adminApi.connectionBindings(id ?? ''),
    enabled: enabled && id !== null,
  });
}

/**
 * Asking an endpoint what it offers — a mutation rather than a query, because
 * it is an action somebody takes rather than state a page has.
 *
 * It is also a `POST` that writes nothing, which is a shape worth naming: it
 * carries a key in the body, and a key does not belong in a URL.
 */
export function useFetchModels(
  scope: ConnectionScope = 'system',
): UseMutationResult<{ models: string[] }, Error, { baseUrl?: string; apiKey?: string }> {
  return useMutation({
    mutationFn: scope === 'system' ? adminApi.fetchModels : api.fetchMyModels,
  });
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
 * Polled rather than fetched once, because [09 §6.3] wants *every* admin to see
 * the pending list — including one who was already looking at another page when
 * a colleague saved. The interval is generous: this is a banner, not a stream.
 */
export function useNotices(enabled: boolean): UseQueryResult<{
  pendingRestart: string[];
  canRestart: boolean;
  supervision: 'systemd' | 'declared' | 'none';
  interrupts: { mine: number; others: number };
  draining: boolean;
  restorePending: boolean;
  updates: {
    state: 'disabled' | 'unknown' | 'current' | 'behind' | 'unreachable';
    latest: string | null;
    checkedAt: number | null;
    online: boolean | null;
    needsInternet: boolean;
  };
}> {
  return useQuery({
    queryKey: ['admin', 'notices'],
    queryFn: adminApi.notices,
    enabled,
    refetchInterval: 30_000,
  });
}

/**
 * Asks the server to restart itself — [09 §6.4], [P10.3].
 *
 * ***No `onSuccess` invalidation, and that is not an omission.*** The answer is
 * the last thing this process sends: the drain runs behind it and then the
 * process exits, so a refetch would race a socket that is closing. What updates
 * the surface is the reconnection — the page comes back and asks again.
 *
 * *And what it asks has to outrank this answer* (2026-09-28). The notices
 * came back and the mutation's success did not go anywhere, so the banner
 * went on reading it; `RestartBanner` now takes it as *draining* only until
 * the notices have been answered since it was sent.
 */
export function useRestart(): UseMutationResult<{ draining: boolean }, Error, void> {
  return useMutation({ mutationFn: () => adminApi.restart() });
}
