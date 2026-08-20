// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { LIBRARY_DIRECTORIES } from '@storyengine/shared';

/**
 * The client's side of docs/api.md — plain `fetch`, one wrapper.
 *
 * The server speaks folder names in URLs (`actors`, `lorebooks`, …) and schema
 * ids inside objects; both come from the shared registry, so the client never
 * maintains its own list of kinds. Adding a kind should not touch this file.
 *
 * CSRF is double-submit ([04 §4.1](../../../docs/design/04-server-multiuser-deployment.md)):
 * the `se_csrf` cookie is script-readable precisely so this file can echo it in
 * the `x-csrf-token` header on anything state-changing.
 */

export type LibraryKind = (typeof LIBRARY_DIRECTORIES)[keyof typeof LIBRARY_DIRECTORIES];

export const LIBRARY_KINDS: readonly LibraryKind[] = Object.values(LIBRARY_DIRECTORIES);

export function isLibraryKind(value: unknown): value is LibraryKind {
  return typeof value === 'string' && (LIBRARY_KINDS as readonly string[]).includes(value);
}

/** The folder a schema id's objects live in, or null for a kind this build does not know. */
export function kindOfSchema(schemaId: string): LibraryKind | null {
  return (LIBRARY_DIRECTORIES as Record<string, LibraryKind>)[schemaId] ?? null;
}

/** The public account shape from `GET /api/auth/state` — never hashes or salts. */
export interface Account {
  handle: string;
  displayName: string;
  role: string;
  enabled: boolean;
  locale: string | null;
  capabilities: {
    privateConnections: boolean;
    fileAccess: string;
    enableExtensions: boolean;
  };
  createdAt: number;
}

export interface AuthState {
  setupRequired: boolean;
  account: Account | null;
}

/** The object envelope every library read returns (docs/api.md). */
export interface LibraryObject {
  id: string;
  schema: string;
  name: string;
  slug: string;
  source: 'user' | 'system';
  contentHash: string;
  shadowed: boolean;
  object: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  /** The `error` field from the response body — `invalid-credentials`, `stale`, … */
  readonly code: string;
  /**
   * On a 412, the object as it is *now* (docs/api.md). Carried so the UI can
   * offer reload-and-reapply or save-as-a-copy rather than guessing
   * ([04 §4.4](../../../docs/design/04-server-multiuser-deployment.md)).
   */
  readonly current?: LibraryObject;
  /**
   * On a 412 from a route that offers one, the acknowledgement to present back
   * — *I have seen what is on disk* ([P2A §4] step 15).
   *
   * Lifted here beside `current` rather than left in the body, for the reason
   * `current` is: a caller that had to dig it out of an untyped body is a
   * caller that can read the wrong key, which is exactly the bug the config
   * form shipped with.
   */
  readonly contentHash?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    current?: LibraryObject,
    contentHash?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (current !== undefined) this.current = current;
    if (contentHash !== undefined) this.contentHash = contentHash;
  }
}

export const CSRF_COOKIE = 'se_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/**
 * Reads one cookie out of a `document.cookie`-shaped string.
 *
 * A hand-rolled parse rather than a dependency: the format here is the
 * *browser's* serialisation (name=value pairs joined by "; "), which is far
 * simpler than a Set-Cookie header.
 */
export function cookieValue(cookies: string, name: string): string | null {
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (STATE_CHANGING.has(method)) {
    const token = cookieValue(document.cookie, CSRF_COOKIE);
    if (token !== null) headers[CSRF_HEADER] = token;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? null : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const code = typeof payload?.['error'] === 'string' ? payload['error'] : 'unknown';
    const message =
      typeof payload?.['message'] === 'string'
        ? payload['message']
        : `The server answered with status ${String(response.status)}.`;
    const current =
      code === 'stale' && typeof payload?.['current'] === 'object' && payload['current'] !== null
        ? (payload['current'] as LibraryObject)
        : undefined;
    const contentHash =
      typeof payload?.['contentHash'] === 'string' ? payload['contentHash'] : undefined;
    throw new ApiError(response.status, code, message, current, contentHash);
  }

  return payload as T;
}

export interface Credentials {
  handle: string;
  password: string;
}

export interface SetupInput extends Credentials {
  displayName?: string;
}

/** One entry of an object's version history (docs/api.md). */
export interface ObjectVersion {
  id: string;
  digest: string;
  revision: number;
  authoredAt: string;
  recordedAt: string;
  source: { kind: string; [detail: string]: unknown };
  reason: string;
  authorVersion: string | null;
  pinned: boolean;
}

/**
 * Which copy of a duplicated id to read — the shadowed one, by where it lives.
 *
 * Two files can hold the same id; the list shows both and flags the loser.
 * Without this the loser's link opened the winner while the page claimed
 * otherwise. Read-only: writes stay id-only and resolve to the winner.
 */
export interface ObjectAddress {
  source: 'user' | 'system';
  slug: string;
}

function objectUrl(kind: LibraryKind, id: string): string {
  return `/api/library/${kind}/${encodeURIComponent(id)}`;
}

function versionUrl(kind: LibraryKind, id: string, versionId: string): string {
  return `${objectUrl(kind, id)}/history/${encodeURIComponent(versionId)}`;
}

export const api = {
  authState: (): Promise<AuthState> => request('GET', '/api/auth/state'),

  setup: (input: SetupInput): Promise<{ account: Account }> =>
    request('POST', '/api/auth/setup', input),

  login: (input: Credentials): Promise<{ account: Account }> =>
    request('POST', '/api/auth/login', input),

  logout: (): Promise<undefined> => request('POST', '/api/auth/logout'),

  // The user half of the settings surface ([05 §15.1]). `readMe` is deliberately
  // separate from `authState`: that call answers *is anyone signed in and does
  // setup need running*, and a settings form refetching it would make every save
  // re-answer a question about the whole install.
  readMe: (): Promise<{ account: Account }> => request('GET', '/api/me'),

  updateMe: (patch: {
    displayName?: string;
    locale?: string | null;
  }): Promise<{
    account: Account;
  }> => request('PATCH', '/api/me', patch),

  changePassword: (input: { currentPassword: string; newPassword: string }): Promise<undefined> =>
    request('POST', '/api/me/password', input),

  readPrefs: (): Promise<{ prefs: Record<string, unknown> }> => request('GET', '/api/me/prefs'),

  /** A shallow merge; `null` deletes. The response is the whole document. */
  patchPrefs: (patch: Record<string, unknown>): Promise<{ prefs: Record<string, unknown> }> =>
    request('PATCH', '/api/me/prefs', patch),

  listLibrary: (kind?: LibraryKind): Promise<{ objects: LibraryObject[] }> =>
    request('GET', kind === undefined ? '/api/library' : `/api/library/${kind}`),

  /**
   * `at` reads one *specific* copy of a duplicated id (docs/api.md, Library).
   *
   * Deliberately a parameter on this call rather than something `objectUrl`
   * appends: that helper is the base for every write, every history call and
   * every restore, and sending the discriminator on those would look like it
   * worked while the server ignored it. A shadowed copy is readable and
   * nothing else.
   */
  readObject: (kind: LibraryKind, id: string, at?: ObjectAddress): Promise<LibraryObject> =>
    request(
      'GET',
      at === undefined
        ? objectUrl(kind, id)
        : `${objectUrl(kind, id)}?source=${at.source}&slug=${encodeURIComponent(at.slug)}`,
    ),

  createObject: (
    kind: LibraryKind,
    object: Record<string, unknown>,
  ): Promise<{ id: string; slug: string; contentHash: string }> =>
    request('POST', `/api/library/${kind}`, { object }),

  /** The hash rides in the body — the second spelling docs/api.md allows. */
  updateObject: (
    kind: LibraryKind,
    id: string,
    object: Record<string, unknown>,
    contentHash: string,
  ): Promise<{ contentHash: string; object: Record<string, unknown> }> =>
    request('PUT', objectUrl(kind, id), { object, contentHash }),

  history: (kind: LibraryKind, id: string): Promise<{ versions: ObjectVersion[] }> =>
    request('GET', `${objectUrl(kind, id)}/history`),

  version: (
    kind: LibraryKind,
    id: string,
    versionId: string,
  ): Promise<{ version: ObjectVersion; object: Record<string, unknown> }> =>
    request('GET', versionUrl(kind, id, versionId)),

  restoreVersion: (
    kind: LibraryKind,
    id: string,
    versionId: string,
    contentHash: string,
  ): Promise<{ contentHash: string; object: Record<string, unknown> }> =>
    request('POST', `${versionUrl(kind, id, versionId)}/restore`, { contentHash }),

  amendVersion: (
    kind: LibraryKind,
    id: string,
    versionId: string,
    patch: { reason?: string; pinned?: boolean },
  ): Promise<{ version: ObjectVersion }> =>
    request('PATCH', versionUrl(kind, id, versionId), patch),

  avatarUrl: (id: string, contentHash: string): string =>
    `/api/library/actors/${encodeURIComponent(id)}/avatar?v=${encodeURIComponent(contentHash)}`,
};

/**
 * Sessions and turns — the play surface's half of the API.
 *
 * The shapes are re-declared here rather than imported from the server, because
 * the client may not depend on it. That is a real seam with a real cost: a
 * rename on the server side becomes a silent mismatch here, which is why the
 * server asserts its own frame shape ([routes/sessions.test.ts]). A shared
 * package for these is the proper fix and belongs with the workbench, which is
 * the first surface that needs more of them than this one does.
 */

export interface SessionSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  headTurnId: string | null;
  archivedAt?: string;
}

export interface TurnRecord {
  id: string;
  parentTurnId: string | null;
  createdAt: string;
  status: 'complete' | 'failed' | 'suspended';
  input?: { text: string; kind: string };
  output?: { text: string };
  [key: string]: unknown;
}

export interface ActiveJob {
  id: string;
  status: string;
  turnId: string;
  commitStep: number;
}

export function listSessions(): Promise<{ sessions: SessionSummary[] }> {
  return request('GET', '/api/sessions');
}

export function createSession(name: string): Promise<{ session: SessionSummary }> {
  return request('POST', '/api/sessions', { name });
}

export function readSession(
  sessionId: string,
): Promise<{ session: SessionSummary; activeJob: ActiveJob | null }> {
  return request('GET', `/api/sessions/${sessionId}`);
}

export function readTranscript(sessionId: string): Promise<{ turns: TurnRecord[] }> {
  return request('GET', `/api/sessions/${sessionId}/turns`);
}

export interface SubmitTurn {
  sessionId: string;
  idempotencyKey: string;
  headTurnId: string | null;
  text: string;
  /** Its own field, never folded into the action — [03 §5.1]. */
  guidance?: string;
}

export function submitTurn(submission: SubmitTurn): Promise<{ jobId: string; cursor: string }> {
  return request('POST', `/api/sessions/${submission.sessionId}/turns`, {
    idempotencyKey: submission.idempotencyKey,
    headTurnId: submission.headTurnId,
    input: { text: submission.text },
    ...(submission.guidance === undefined || submission.guidance.length === 0
      ? {}
      : { guidance: submission.guidance }),
  });
}

export function cancelTurn(sessionId: string, jobId: string): Promise<{ jobId: string }> {
  return request('POST', `/api/sessions/${sessionId}/jobs/${jobId}/cancel`);
}

/** An account as the admin list reports it, plus the dead-end flag. */
export interface AdminAccount extends Account {
  hasUsableConnection: boolean;
}

export interface AdminAccountList {
  accounts: AdminAccount[];
  withoutUsableConnection: number;
  systemConnectionCount: number;
}

export interface AccountPatch {
  displayName?: string;
  locale?: string | null;
  role?: 'admin' | 'user';
  enabled?: boolean;
  capabilities?: Partial<Account['capabilities']>;
}

/** The tier table and the appliers, sent as data rather than duplicated ([13 §4]). */
export interface ConfigView {
  config: Record<string, unknown>;
  path: string;
  tiers: Record<string, 'live' | 'reconnect' | 'restart'>;
  appliers: Record<string, 'applied' | 'unread'>;
  pendingRestart: string[];
  /** The file as this read saw it, presented back on a save ([P2A §4] step 15). */
  contentHash: string;
}

export const adminApi = {
  listAccounts: (): Promise<AdminAccountList> => request('GET', '/api/admin/accounts'),

  createAccount: (input: {
    handle: string;
    password: string;
    role: 'admin' | 'user';
    capabilities?: Partial<Account['capabilities']>;
  }): Promise<{ account: Account }> => request('POST', '/api/admin/accounts', input),

  updateAccount: (handle: string, patch: AccountPatch): Promise<{ account: Account }> =>
    request('PATCH', `/api/admin/accounts/${handle}`, patch),

  removeAccount: (handle: string): Promise<undefined> =>
    request('DELETE', `/api/admin/accounts/${handle}`),

  readConfig: (): Promise<ConfigView> => request('GET', '/api/admin/config'),

  /**
   * `contentHash` is the form saying *I have seen what is on disk* — sent by
   * both offers a 412 makes, and by neither a plain re-save ([P2A §4] step 15).
   */
  writeConfig: (
    config: Record<string, unknown>,
    contentHash?: string,
  ): Promise<{
    config: Record<string, unknown>;
    pendingRestart: string[];
  }> =>
    request('PUT', '/api/admin/config', {
      config,
      ...(contentHash === undefined ? {} : { contentHash }),
    }),

  notices: (): Promise<{ pendingRestart: string[]; canRestart: boolean }> =>
    request('GET', '/api/admin/notices'),
};
