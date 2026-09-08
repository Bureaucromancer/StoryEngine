// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  type TagEntry,
  LIBRARY_DIRECTORIES,
  type ImportPreview,
  type NearMissOffer,
  type Turn as TurnRecord,
  type TurnPreview,
} from '@storyengine/shared';

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

/**
 * What build the server is — the version string and the commit it was built
 * from ([P6A §1.5]). The name a person reads is derived from the string by
 * `versionName` in `@storyengine/shared`, never carried beside it.
 */
export interface BuildInfo {
  version: string;
  commit: string;
}

export interface AuthState {
  setupRequired: boolean;
  /**
   * Whether creating the first admin needs the token from the server console
   * (F10, [04 §5.1]).
   *
   * The client cannot work this out: it may be reaching a loopback server
   * directly or an exposed one through a proxy, and those look identical from
   * here. Required rather than optional for the same reason
   * `minPasswordLength` is — client and server ship together, and a `?? false`
   * at the use site would be a guess in the direction of *no token needed*,
   * which is the one that makes an exposed install look broken.
   */
  setupTokenRequired: boolean;
  account: Account | null;
  /**
   * The shortest password this install accepts where one is *set*.
   *
   * Required rather than optional: client and server ship together, and
   * `number | undefined` would force a `?? 8` at every use site — a second
   * hardcoded 8, which is the thing reading it from the server removes.
   */
  minPasswordLength: number;
  /**
   * What build the server is, or `null` for one nobody identified — every
   * development run ([P6A §1.5]). On the auth state rather than only on the
   * admin notices route because every page shows it, login and setup included.
   * Required rather than optional for the reason `minPasswordLength` is: client
   * and server ship together. The footer and the About block tolerate
   * `undefined` because the state may not have loaded yet, not because a server
   * might omit it.
   */
  build: BuildInfo | null;
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

/**
 * One row of the by-id index projection (docs/api.md, Library). `path` is
 * portable — root-relative, `/`-separated — and is the string the shadow
 * winner is decided by; `tombstonedAt` is epoch milliseconds while a deleted
 * row sits in its settling window, `null` for a live one.
 */
export interface IndexRow {
  path: string;
  source: 'user' | 'system';
  slug: string;
  name: string;
  schema: string;
  contentHash: string;
  shadowed: boolean;
  tombstonedAt: number | null;
}

export class ApiError extends Error {
  readonly status: number;
  /** The `error` field from the response body — `invalid-credentials`, `stale`, … */
  readonly code: string;
  /**
   * On a 412, the thing as it is *now* (docs/api.md). Carried so the UI can
   * offer reload-and-reapply or save-as-a-copy rather than guessing
   * ([04 §4.4](../../../docs/design/04-server-multiuser-deployment.md)).
   *
   * **Deliberately `unknown` rather than `LibraryObject`.** Three routes speak
   * this idiom now and they carry three different shapes — a library object, a
   * config document, an `AdminConnection` — so a type naming one of them is
   * wrong for the other two, and every caller was already casting past it. A
   * cast at the call site is at least visible; a lie in the type is not.
   */
  readonly current?: unknown;
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
    current?: unknown,
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

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
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
        ? payload['current']
        : undefined;
    const contentHash =
      typeof payload?.['contentHash'] === 'string' ? payload['contentHash'] : undefined;
    throw new ApiError(response.status, code, message, current, contentHash);
  }

  return payload as T;
}

/**
 * A multipart POST — the first non-JSON body this client sends.
 *
 * A sibling of `request` rather than a flag on it, for the reason
 * `test-server`'s `stream` is a sibling of its `request`: the JSON path sets a
 * content type and stringifies, and both are exactly wrong here. `FormData` sets
 * its own boundary, so the header must be left alone.
 */
async function requestForm<T>(url: string, body: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  const token = cookieValue(document.cookie, CSRF_COOKIE);
  if (token !== null) headers[CSRF_HEADER] = token;

  const response = await fetch(url, { method: 'POST', headers, body });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const code = typeof payload?.['error'] === 'string' ? payload['error'] : 'unknown';
    const message =
      typeof payload?.['message'] === 'string'
        ? payload['message']
        : `The server answered with status ${String(response.status)}.`;
    throw new ApiError(response.status, code, message);
  }
  return payload as T;
}

/** One row of the import review — the shared vocabulary, as the client sees it. */
export interface ImportItem {
  source: string;
  disposition: string;
  objectId?: string;
  notes: { key: string; params: Record<string, string | number>; level: string }[];
}

/**
 * What every import said about one object — [P5 §1.8].
 *
 * Per *object* rather than per job, because that is the question a person has
 * six months after an import: not *what did that sweep do* but *why is this
 * book like this*. One row per review item that named the object, so a book
 * imported twice carries both.
 */
export interface ObjectImportNotes {
  jobId: string;
  /** The file it came from, relative to the sweep root that produced it. */
  source: string;
  notes: ImportItem['notes'];
}

export interface ImportReport {
  jobId: string;
  source: string;
  items: ImportItem[];
  counts: Record<string, number>;
}

/**
 * One past import, as the list shows it ([P4 §7.4]).
 *
 * **Counts and not items.** A sweep of a real library is thousands of rows, and
 * a list that inlined them would be a page nobody could load in order to find
 * the one they wanted. `root` is the absolute path, which lives on this row and
 * nowhere else ([13 §4.1.1]) — the person who typed it can see it, and no
 * per-file row repeats it.
 */
export interface ImportJob {
  id: string;
  root: string;
  /** The source kind, or — when `status` is `refused` — why it was turned away. */
  source: string;
  status: 'finished' | 'refused';
  createdAt: number;
  finishedAt: number | null;
  counts: Record<string, number>;
}

export interface ImportFileResult {
  item: ImportItem;
  notes: ImportItem['notes'];
}

export interface Credentials {
  handle: string;
  password: string;
}

export interface SetupInput extends Credentials {
  displayName?: string;
  /** The console token, when `AuthState.setupTokenRequired` says one is needed. */
  setupToken?: string;
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

  /**
   * The tag registry — [25 §4](../../../docs/design/25-tagging.md).
   *
   * Every one of these answers with the **whole list**, not with the row it
   * touched, so a client lands on the truth rather than on its own guess about
   * what its write did. That is `patchPrefs`' reasoning one shelf along, and it
   * is what lets the manager render straight from the response.
   */
  readTags: (): Promise<{ tags: TagEntry[] }> => request('GET', '/api/tags'),

  createTag: (body: { name: string; swatch?: string | null }): Promise<{ tags: TagEntry[] }> =>
    request('POST', '/api/tags', body),

  patchTag: (
    id: string,
    patch: { swatch?: string | null; folder?: string; hidden?: boolean },
  ): Promise<{ tags: TagEntry[] }> =>
    request('PATCH', `/api/tags/${encodeURIComponent(id)}`, patch),

  /** The entry only. Objects carrying the tag are untouched ([25 §2]). */
  deleteTag: (id: string): Promise<{ tags: TagEntry[] }> =>
    request('DELETE', `/api/tags/${encodeURIComponent(id)}`),

  orderTags: (ids: string[]): Promise<{ tags: TagEntry[] }> =>
    request('PUT', '/api/tags/order', { ids }),

  /**
   * One registry write, and an answer about the lore gates naming the old
   * spelling — [25 §1](../../../docs/design/25-tagging.md). `rewriteGates` is
   * off unless asked, because both answers are defensible.
   */
  renameTag: (
    id: string,
    body: { to: string; rewriteGates?: boolean },
  ): Promise<{ tags: TagEntry[]; gatesFound: { book: string; entry: string }[] }> =>
    request('POST', `/api/tags/${encodeURIComponent(id)}/rename`, body),

  /** The one deliberate write across the library, after which renaming is free. */
  adoptTags: (): Promise<{
    tags: TagEntry[];
    adopted: unknown[];
    minted: string[];
    skipped: { name: string; reason: string }[];
  }> => request('POST', '/api/tags/adopt'),

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

  /**
   * The index rows behind an object (docs/api.md, Library) — best-effort by
   * decision ([P3 §7.4]): the shape restates the derived index and may
   * return less after an index schema bump. Paths are portable, never
   * native; the winner of a duplicated id is the first live row.
   */
  indexRows: (kind: LibraryKind, id: string): Promise<{ rows: IndexRow[] }> =>
    request('GET', `${objectUrl(kind, id)}/rows`),

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

  /**
   * **Delete, which the server has been able to do since P1 and the client
   * could not reach** ([P4 §1.4]).
   *
   * The review's post-hoc posture — import commits and reports loudly rather
   * than staging — rests on a claim that a bad import is reversible. That was
   * only true on disk: the tombstone window and version history existed, and
   * nothing in the app could remove an object. This is the cost of the posture,
   * paid rather than hand-waved.
   *
   * Hash-checked like any write, because deleting something a second tab has
   * edited is the same mistake as overwriting it and rather more final.
   */
  deleteObject: (kind: LibraryKind, id: string, contentHash: string): Promise<undefined> =>
    request('DELETE', objectUrl(kind, id), undefined, { 'if-match': contentHash }),

  /**
   * What that file *would* become, with nothing written ([05 §5], as amended).
   *
   * The bytes are sent twice — once here and again to `importFile` on confirm —
   * because there is no staging area and the confirm has to re-derive from the
   * file rather than trust this answer. A preset is kilobytes.
   */
  importFilePreview: (file: File): Promise<{ preview: ImportPreview }> => {
    const body = new FormData();
    body.append('file', file);
    return requestForm('/api/import/file/preview', body);
  },

  /**
   * One file, converted and stored. `FormData` — the first non-JSON body here.
   *
   * **`onConflict` is appended before the file, and the order is load-bearing.**
   * The route reads it off the parts that arrived ahead of the file part, which
   * is where `request.file()` stops — a field appended after this one would be
   * accepted by `FormData`, sent by the browser, and silently never parsed.
   */
  importFile: (
    file: File,
    onConflict?: 'replace' | 'keep-both' | 'skip',
  ): Promise<ImportFileResult> => {
    const body = new FormData();
    if (onConflict !== undefined) body.append('onConflict', onConflict);
    body.append('file', file);
    return requestForm('/api/import/file', body);
  },

  /**
   * Point the server at a folder ([P4 §1.3]). Needs `fileAccess`.
   *
   * `suggestions` is advice about the folder that was named, not part of the
   * report — a loose-files sweep succeeds even when the wrong folder was picked,
   * and this is what says so.
   */
  importSweep: (
    root: string,
    onConflict?: 'replace' | 'keep-both' | 'skip',
  ): Promise<{ report: ImportReport; suggestions: NearMissOffer[] }> =>
    request('POST', '/api/import/sweep', { root, ...(onConflict ? { onConflict } : {}) }),

  /**
   * Past imports, and one of them in full ([P4 §7.4]).
   *
   * The review used to live in a `useState` and end with the page. These are
   * what make it a thing you can go back to — the half of §1.4's *post-hoc,
   * addressable, structured* that P4.4 cut.
   */
  importJobs: (): Promise<{ jobs: ImportJob[] }> => request('GET', '/api/import/jobs'),

  importJob: (id: string): Promise<{ report: ImportReport }> =>
    request('GET', `/api/import/jobs/${id}`),

  /** What the imports said about one object, for its own page ([P5 §1.8]). */
  objectImportNotes: (objectId: string): Promise<{ notes: ObjectImportNotes[] }> =>
    request('GET', `/api/import/objects/${objectId}/notes`),

  /**
   * What a folder is, without importing from it — the check behind the path box.
   *
   * Same permission and same refusals as the sweep, because it reads the same
   * way. It never lists a directory: the answer is what the folder *is* and, if
   * it is the wrong one, where to point instead.
   */
  importInspect: (root: string): Promise<{ verdict: string; suggestions: NearMissOffer[] }> =>
    request('POST', '/api/import/inspect', { root }),

  /**
   * What a picked folder is, from its names alone — before anything is uploaded.
   *
   * Needs no `fileAccess`: the browser opened the folder as the person, so what
   * travels is a list they chose to send rather than a read of the host's disk.
   */
  importDirectoryPlan: (
    entries: { path: string; bytes: number }[],
  ): Promise<{
    verdict: string;
    suggestions: NearMissOffer[];
    wanted: string[];
    declared: string[];
    wantedBytes: number;
  }> => request('POST', '/api/import/directory/plan', { entries }),

  /**
   * The folder itself: every name, and the bytes of the files the plan asked
   * for.
   *
   * The relative path travels as each part's **field name**, because a multipart
   * filename cannot carry a directory and survive sanitising — and the manifest
   * goes with it, so the review can account for what was named and not sent.
   */
  importDirectory: (
    manifest: string[],
    carried: { path: string; file: File }[],
    onConflict?: 'replace' | 'keep-both' | 'skip',
  ): Promise<{ report: ImportReport }> => {
    const body = new FormData();
    body.append('manifest', JSON.stringify(manifest));
    if (onConflict !== undefined) body.append('onConflict', onConflict);
    for (const { path, file } of carried) body.append(path, file, file.name);
    return requestForm('/api/import/directory', body);
  },

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
 * **The turn record is the real shape now** — [P3.0] paid the debt this
 * section used to carry: `TurnRecord` was six fields plus an index signature,
 * re-declared here because the client may not depend on the server, and every
 * field the workbench renders arrived through `unknown`. The shapes live in
 * `@storyengine/shared` (`turn.ts`, internal tier — the module carries the
 * argument), and the alias keeps this file the client's one vocabulary for
 * them.
 *
 * `SessionSummary` and `ActiveJob` stay local projections on purpose: the
 * routes serve more than these name (the job row in particular is wider on
 * the wire), and widening the client's claim is its own decision for the
 * surface that needs it — not a side effect of the record move.
 */
export type { Turn as TurnRecord } from '@storyengine/shared';

/**
 * The preview's answer, re-exported for the same reason: the meter and the
 * panel both render it, and neither should reach past this module for a shape
 * the API defines ([P3.4]).
 */
export type {
  AssembledPreview,
  TurnPreview,
  UnmeasurablePreview,
  UnmeasurableReason,
} from '@storyengine/shared';

export interface SessionSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  headTurnId: string | null;
  archivedAt?: string;
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

/**
 * The path from the head, and which of its nodes have siblings — [P6.3].
 *
 * `siblings` maps a turn on the path to every child of its parent, in creation
 * order, and only for nodes that have more than one. History shows the selected
 * path only ([09 §6]), so this is how an alternative is reachable at all.
 */
export function readTranscript(
  sessionId: string,
): Promise<{ turns: TurnRecord[]; siblings?: Record<string, string[]> }> {
  return request('GET', `/api/sessions/${sessionId}/turns`);
}

/**
 * Name a node — [09 §6]'s *promote*. A name and nothing more: no turn moves,
 * and deleting one later deletes a name.
 */
export function createBranchRef(
  sessionId: string,
  name: string,
  turnId: string,
): Promise<{ session: SessionSummary }> {
  return request('POST', `/api/sessions/${encodeURIComponent(sessionId)}/refs`, { name, turnId });
}

/**
 * Undo a turn's effects — [§1.4]. Refused, with the branch offered, when
 * something has written the same channels since.
 */
export function undoTurn(sessionId: string, turnId: string): Promise<{ session: SessionSummary }> {
  return request(
    'POST',
    `/api/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/undo`,
  );
}

/**
 * One turn, without the transcript riding along — [P3.0]. Encoded, unlike
 * this section's other paths: the library half of this file encodes every id
 * it puts in a URL and that is the better precedent — an id is user-adjacent
 * input even when this client only ever mints UUIDs.
 */
export function readTurn(sessionId: string, turnId: string): Promise<{ turn: TurnRecord }> {
  return request(
    'GET',
    `/api/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}`,
  );
}

export interface SubmitTurn {
  sessionId: string;
  idempotencyKey: string;
  headTurnId: string | null;
  text: string;
  /** Its own field, never folded into the action — [03 §5.1]. */
  guidance?: string;
  /**
   * Attach this turn to a node other than the head — [P6.0c].
   *
   * **Absent and `null` are different requests.** Absent means *the head*, and
   * a head that has moved is refused; `null` means *the root*, which is what
   * redoing the first turn of a session asks for.
   */
  parentTurnId?: string | null;
  /**
   * Replay this turn's draws — **rewrite** rather than reroll, [07 §14.5].
   *
   * A turn id, not a tape: the server reads the draws from its own record.
   */
  rewriteOf?: string;
  /**
   * Show this turn's words to the model as the previous attempt — the other
   * half of a redo, [03 §5.1]. A turn id, not the text: the server reads the
   * words from its own record. Sent with `guidance` or not at all, which is
   * the play surface's rule rather than the server's.
   */
  redoOf?: string;
}

export function submitTurn(submission: SubmitTurn): Promise<{ jobId: string; cursor: string }> {
  return request('POST', `/api/sessions/${submission.sessionId}/turns`, {
    idempotencyKey: submission.idempotencyKey,
    headTurnId: submission.headTurnId,
    input: { text: submission.text },
    ...(submission.guidance === undefined || submission.guidance.length === 0
      ? {}
      : { guidance: submission.guidance }),
    // Spread rather than passed, because absent and null are different
    // requests — see `SubmitTurn.parentTurnId`.
    ...('parentTurnId' in submission ? { parentTurnId: submission.parentTurnId } : {}),
    ...(submission.rewriteOf === undefined ? {} : { rewriteOf: submission.rewriteOf }),
    ...(submission.redoOf === undefined ? {} : { redoOf: submission.redoOf }),
  });
}

/**
 * Where you are in the tree — [09 §3], [P6.1].
 *
 * Moving the head moves no turn data: it is the selection, and the transcript
 * is the path to it. `resume` follows what was last selected forward, which is
 * how *back* and then *forward* returns where you were instead of guessing.
 */
export function moveHead(
  sessionId: string,
  turnId: string,
  resume?: boolean,
): Promise<{ session: SessionSummary }> {
  return request('PUT', `/api/sessions/${encodeURIComponent(sessionId)}/head`, {
    turnId,
    ...(resume === undefined ? {} : { resume }),
  });
}

export function cancelTurn(sessionId: string, jobId: string): Promise<{ jobId: string }> {
  return request('POST', `/api/sessions/${sessionId}/jobs/${jobId}/cancel`);
}

/** What the composer holds — the two fields a preview is asked about. */
export interface PendingInput {
  text: string;
  guidance: string;
}

/**
 * What this turn *would* assemble to (docs/api.md, Sessions) — [P3.4].
 *
 * **A POST that writes nothing**, in `adminApi.fetchModels`' shape: the body
 * carries up to a hundred thousand characters of somebody's prose, which does
 * not belong in a URL. Empty strings are omitted rather than sent, so *nothing
 * typed yet* reaches the collector as the absent `input?` it models rather
 * than as an empty block.
 */
export function previewTurn(
  sessionId: string,
  pending: PendingInput,
): Promise<{ preview: TurnPreview }> {
  return request('POST', `/api/sessions/${encodeURIComponent(sessionId)}/preview`, {
    ...(pending.text === '' ? {} : { input: { text: pending.text } }),
    ...(pending.guidance === '' ? {} : { guidance: pending.guidance }),
  });
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
  /**
   * What each numeric key will accept, derived from the server's schema.
   *
   * Data rather than a copy, for the same reason `tiers` is: a hand-written
   * range table here would be wrong the first time somebody widens one.
   */
  bounds: Record<string, { minimum?: number; maximum?: number }>;
  /** Permitted values, for the keys that are a closed union. */
  choices: Record<string, string[]>;
  pendingRestart: string[];
  /** The file as this read saw it, presented back on a save ([P2A §4] step 15). */
  contentHash: string;
}

/**
 * A system connection as an admin may see it — [P2B §2.2].
 *
 * **The key is not here and there is nowhere to put it.** `hasKey` is the whole
 * of what a client learns about it, because *a key is set* and *no key, this is
 * a local endpoint* are different states an empty password box cannot tell
 * apart. `baseUrl` is admin-visible and user-invisible: [04 §4.5]'s *"an admin
 * may opt to show it"* read as narrowly as it goes.
 */
export interface AdminConnection {
  id: string;
  label: string;
  provider: string;
  scope: 'system' | 'user';
  models: string[];
  baseUrl?: string;
  /**
   * What this endpoint can do, where the install disagrees with the defaults.
   *
   * Only the two an operator has a reason to set are surfaced — see
   * {@link ConnectionInput}. The rest of the shape travels untouched so an
   * override written by hand is not lost by a save that does not know about it.
   */
  capabilities?: ConnectionCapabilities;
  hasKey: boolean;
  /** An earlier file already claims this id, so nothing resolves to this one. */
  shadowed: boolean;
  /** Presented back on an edit — *I have seen what is on disk*. */
  contentHash: string;
}

/**
 * Per-connection overrides for what an endpoint can do.
 *
 * **Two of them are surfaced and the rest are not, deliberately.** The
 * conservative defaults are right for a provider nobody has told us about, and
 * these two are the ones an operator has a reason to correct because only they
 * know what they are running: a local model's real context window, and whether
 * their endpoint counts tokens.
 *
 * Open-ended because the server's shape is, and because a save must not lose an
 * override somebody wrote by hand for a capability this form does not know
 * about.
 */
export interface ConnectionCapabilities {
  /** The real context window, when the conservative default is wrong. */
  maxContextTokens?: number;
  /** Whether this endpoint reports token usage. */
  reportsUsage?: boolean;
  [capability: string]: unknown;
}

export interface ConnectionInput {
  label: string;
  provider: string;
  /** Omitted keeps what is stored; an empty string clears it. */
  apiKey?: string;
  baseUrl?: string;
  models: string[];
  /** Omitted keeps what is stored, on the same terms as the key. */
  capabilities?: ConnectionCapabilities;
}

/** What one role will do, resolved by the server rather than worked out here. */
export interface RoleRow {
  role: string;
  /**
   * Whether this role has a text fallback at all.
   *
   * `unset` is policy, not a fault: there is no sensible text model for an
   * image, so `image`, `video` and `speech` stay unbound until something can
   * actually serve them ([07 §5.1]).
   */
  tier: 'hi' | 'lo' | 'unset';
  ok: boolean;
  /** Which layer won — the answer to *why did this turn use that model*. */
  via?: 'step' | 'session' | 'binding' | 'default' | 'hint';
  connectionId?: string;
  connectionLabel?: string;
  modelId?: string;
  reason?: 'unbound' | 'dangling';
}

export interface Binding {
  connectionId: string;
  modelId: string;
}

export interface BindingsState {
  bindings: Record<string, Binding>;
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

  listConnections: (): Promise<{ connections: AdminConnection[] }> =>
    request('GET', '/api/admin/connections'),

  createConnection: (input: ConnectionInput): Promise<{ connection: AdminConnection }> =>
    request('POST', '/api/admin/connections', input),

  /**
   * `contentHash` is required, not optional — [P2B §6].
   *
   * An optional guard is not one: a form that could omit it would get the
   * behaviour the check exists to stop, which is silently reverting whatever
   * somebody changed in the file since the page loaded.
   */
  updateConnection: (
    id: string,
    input: ConnectionInput & { contentHash: string },
  ): Promise<{ connection: AdminConnection }> =>
    request('PUT', `/api/admin/connections/${id}`, input),

  deleteConnection: (id: string): Promise<undefined> =>
    request('DELETE', `/api/admin/connections/${id}`),

  /** How many bindings point at a connection. Counts, never contents ([04 §4.5]). */
  connectionBindings: (id: string): Promise<{ bindings: number }> =>
    request('GET', `/api/admin/connections/${id}/bindings`),

  /**
   * Asks an endpoint what it offers — an assist, never the path ([P2B §2.6]).
   *
   * A failure here is a notice rather than a blocked save: `/models` is optional
   * in practice, and the model field stays free text so the admin types what
   * they were going to type anyway.
   */
  fetchModels: (input: { baseUrl?: string; apiKey?: string }): Promise<{ models: string[] }> =>
    request('POST', '/api/admin/connections/models', input),

  readBindings: (): Promise<BindingsState> => request('GET', '/api/admin/bindings'),

  writeBindings: (bindings: Record<string, Binding>, contentHash: string): Promise<BindingsState> =>
    request('PUT', '/api/admin/bindings', { bindings, contentHash }),

  /**
   * The first run's two answers, spread across the roles by the *server*.
   *
   * Two bindings rather than eight, because which role gets which is policy
   * ([07 §5.1]: the expensive model writes, everything else uses the cheap one)
   * and a client free to spread them differently is an install that can end up
   * with `prose` on the cheap model without anybody having chosen that.
   */
  writeDefaultBindings: (input: {
    hi: Binding;
    lo: Binding;
    contentHash: string;
  }): Promise<BindingsState> => request('POST', '/api/admin/bindings/defaults', input),

  readRoles: (): Promise<{ roles: RoleRow[] }> => request('GET', '/api/admin/roles'),

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

  notices: (): Promise<{
    pendingRestart: string[];
    canRestart: boolean;
    /** The same build the auth state carries — the admin shell's copy of it. */
    build: BuildInfo | null;
  }> => request('GET', '/api/admin/notices'),
};
