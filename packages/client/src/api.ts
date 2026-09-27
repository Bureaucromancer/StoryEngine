// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  type TagEntry,
  LIBRARY_DIRECTORIES,
  LOREBOOK_SCHEMA,
  SETUP_SCHEMA,
  TREATMENT_SCHEMA,
  type ImportDestination,
  type ImportPreview,
  type NearMissOffer,
  type Turn as TurnRecord,
  type TurnPreview,
} from '@storyengine/shared';

import type { NotificationList } from './notifications/types.js';

/**
 * The client's side of docs/api.md — plain `fetch`, one wrapper.
 *
 * The server speaks folder names in URLs (`actors`, `lorebooks`, …) and schema
 * ids inside objects; both come from the shared registry, so the client never
 * maintains its own list of kinds. Adding a kind should not touch this file.
 *
 * CSRF is double-submit ([09 §4.1](../../../docs/design/09-server-multiuser-deployment.md)):
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
/**
 * One tile on the sign-in screen — [12 §6](../../../docs/design/12-account-gallery.md).
 *
 * ***Three fields, and the narrowness is the contract.*** The server's
 * projection picks exactly these; a field added to `Account` reaches this socket
 * only when a line of code picks it, which is what keeps an unauthenticated
 * listing from growing a role or a capability by accident.
 */
export interface GalleryEntry {
  handle: string;
  displayName: string;
  /** A content-hash token, or null — in which case the client draws the tile. */
  avatar: string | null;
}

export interface Account {
  handle: string;
  displayName: string;
  role: string;
  enabled: boolean;
  locale: string | null;
  /** Absent means listed on the sign-in screen — [12 §4]. Only objectors carry it. */
  hiddenFromGallery?: boolean;
  capabilities: {
    privateConnections: boolean;
    fileAccess: string;
    enableExtensions: boolean;
    /** May have the server take their backups on a timer — [P12.4]. */
    scheduledBackups: boolean;
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
  /**
   * Where this build's source is — AGPL §13, [09 §7], [P10.5].
   *
   * *Optional, because a build can honestly not know*: a clone with no remote,
   * an export, a tarball. Absent shows no link rather than pointing somebody at
   * somebody else's repository.
   */
  source?: string;
}

export interface AuthState {
  setupRequired: boolean;
  /**
   * Whether creating the first admin needs the token from the server console
   * (F10, [09 §5.1]).
   *
   * The client cannot work this out: it may be reaching a loopback server
   * directly or an exposed one through a proxy, and those look identical from
   * here. Required rather than optional for the same reason
   * `minPasswordLength` is — client and server ship together, and a `?? false`
   * at the use site would be a guess in the direction of *no token needed*,
   * which is the one that makes an exposed install look broken.
   */
  setupTokenRequired: boolean;
  /**
   * Which of the two front doors this install shows — [12 §1.2].
   *
   * **Required rather than optional**, for `setupTokenRequired`'s reason one
   * field up: client and server ship together, and a `?? 'form'` at the use site
   * would be a guess — here a benign one, which is exactly how it would stop
   * being noticed when the server stopped sending it.
   */
  loginScreen: 'form' | 'gallery';
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
/** One file the library holds and cannot read — `library.ts`'s `LibraryFileError`. */
export interface LibraryFileError {
  /** Portable, never native: which folder, not where the server keeps its disk. */
  path: string;
  source: 'user' | 'system';
  /** The `schema` the file claims, which may be why it was refused. */
  kind: string;
  slug: string;
  reason: string;
  detail: string | null;
  seenAt: number;
}

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
   * ([09 §4.4](../../../docs/design/09-server-multiuser-deployment.md)).
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
  /**
   * What was wrong, field by field, from a route that says — [P7.4].
   *
   * **Lifted here for the reason `current` and `contentHash` are**: a caller
   * digging it out of an untyped body is a caller that can read the wrong key.
   * `POST /api/sessions` is the first to send it, for a wizard the engine
   * generated: a refusal reading only *that is not what this mode asked for*
   * leaves somebody guessing which field on a form they did not design.
   */
  readonly issues?: string[];
  /**
   * What a person could do about a provider failure — a `FailureRemedy`, from
   * a route that says (2026-09-27).
   *
   * **A string rather than the union**, because a newer server may send a
   * remedy this build has never heard of, and `remedySentence` already answers
   * that with nothing rather than a guess. Lifted here for `issues`' reason.
   */
  readonly remedy?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    current?: unknown,
    contentHash?: string,
    issues?: string[],
    remedy?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (current !== undefined) this.current = current;
    if (contentHash !== undefined) this.contentHash = contentHash;
    if (issues !== undefined) this.issues = issues;
    if (remedy !== undefined) this.remedy = remedy;
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
    // Every element checked, not just the array: this reaches the screen, and a
    // body carrying `issues: [{...}]` would render `[object Object]` at somebody
    // who is already being told they got something wrong.
    const issues =
      Array.isArray(payload?.['issues']) &&
      payload['issues'].every((one) => typeof one === 'string')
        ? payload['issues']
        : undefined;
    const remedy = typeof payload?.['remedy'] === 'string' ? payload['remedy'] : undefined;
    throw new ApiError(response.status, code, message, current, contentHash, issues, remedy);
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
 * nowhere else ([21 §4.1.1]) — the person who typed it can see it, and no
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

  // The user half of the settings surface ([10 §15.1]). `readMe` is deliberately
  // separate from `authState`: that call answers *is anyone signed in and does
  // setup need running*, and a settings form refetching it would make every save
  // re-answer a question about the whole install.
  readMe: (): Promise<{ account: Account }> => request('GET', '/api/me'),

  updateMe: (patch: {
    displayName?: string;
    locale?: string | null;
    /** *Shown on the sign-in screen* — [12 §4]. */
    hiddenFromGallery?: boolean;
  }): Promise<{
    account: Account;
  }> => request('PATCH', '/api/me', patch),

  changePassword: (input: { currentPassword: string; newPassword: string }): Promise<undefined> =>
    request('POST', '/api/me/password', input),

  /**
   * The tag registry — [05 §4](../../../docs/design/05-tagging.md).
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

  /** The entry only. Objects carrying the tag are untouched ([05 §2]). */
  deleteTag: (id: string): Promise<{ tags: TagEntry[] }> =>
    request('DELETE', `/api/tags/${encodeURIComponent(id)}`),

  orderTags: (ids: string[]): Promise<{ tags: TagEntry[] }> =>
    request('PUT', '/api/tags/order', { ids }),

  /**
   * One registry write, and an answer about the lore gates naming the old
   * spelling — [05 §1](../../../docs/design/05-tagging.md). `rewriteGates` is
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

  /**
   * What this person has been told — [09 §3.1], [P10.1], [P10.2].
   *
   * **One call for the list and the count**, because a badge and a list rendered
   * from two round trips are a badge and a list assembled from two different
   * moments — `/me/roles`' reasoning, on a smaller pane.
   */
  readNotifications: (options: { unread?: boolean } = {}): Promise<NotificationList> =>
    request(
      'GET',
      // Two whole literals rather than one interpolated address, which is what
      // `route-callers.test.ts` can read: its scan matches a quoted `/api/…`
      // with no whitespace in it, so a `${cond ? a : b}` inside the template is
      // an address no check can see. Measured — this arrived as one template
      // and the route reported as having no caller.
      options.unread === true ? '/api/me/notifications?unread=true' : '/api/me/notifications',
    ),

  /** Empty `ids` means all of them — the **Mark all read** affordance, in one request. */
  markNotificationsRead: (ids: string[] = []): Promise<{ read: number; unread: number }> =>
    request('POST', '/api/me/notifications/read', { ids }),

  /**
   * ***Your* connections — [10 §15.1], [19 §5.1], [P10.3].**
   *
   * The admin twins live on `adminApi` and the shapes are identical, because
   * they are the same thing in two directories: `AdminConnection` is what both
   * scopes present and `scope: 'user' | 'system'` is the field that says which.
   * A second response type would have been two names for one record.
   */
  /**
   * The sign-in gallery — [12 §6](../../../docs/design/12-account-gallery.md).
   *
   * **Unauthenticated, and it answers 404 in form mode**, which is the whole of
   * the family's scoping: a default install's unauthenticated surface is
   * byte-for-byte what it has always been.
   */
  gallery: (): Promise<{ accounts: GalleryEntry[] }> => request('GET', '/api/auth/gallery'),

  /** Your own face. Multipart, because it is bytes — [12 §5.2]. */
  uploadAvatar: (file: File): Promise<{ avatar: string }> => {
    const form = new FormData();
    form.append('file', file);
    return requestForm('/api/me/avatar', form);
  },

  removeAvatar: (): Promise<undefined> => request('DELETE', '/api/me/avatar'),

  listMyConnections: (): Promise<{ connections: AdminConnection[] }> =>
    request('GET', '/api/me/connections'),

  createMyConnection: (body: ConnectionInput): Promise<{ connection: AdminConnection }> =>
    request('POST', '/api/me/connections', body),

  updateMyConnection: (
    id: string,
    body: ConnectionInput & { contentHash: string },
  ): Promise<{ connection: AdminConnection }> =>
    request('PUT', `/api/me/connections/${encodeURIComponent(id)}`, body),

  deleteMyConnection: (id: string): Promise<undefined> =>
    request('DELETE', `/api/me/connections/${encodeURIComponent(id)}`),

  fetchMyModels: (body: { baseUrl?: string; apiKey?: string }): Promise<{ models: string[] }> =>
    request('POST', '/api/me/connections/models', body),

  readPrefs: (): Promise<{ prefs: Record<string, unknown> }> => request('GET', '/api/me/prefs'),

  /** A shallow merge; `null` deletes. The response is the whole document. */
  patchPrefs: (patch: Record<string, unknown>): Promise<{ prefs: Record<string, unknown> }> =>
    request('PATCH', '/api/me/prefs', patch),

  /**
   * **What *your* turns will do, and the document behind it** — [10 §15.1],
   * [P7.3]. The sibling of `adminApi.readRoles`, which answers the same row
   * shape for the install rather than for you.
   *
   * One call for the whole pane, because it is one pane: the resolved table is
   * what happens now, `bindings` is what a control edits, `contentHash` is what
   * makes the write safe, and `connections` is what a binding may be pointed at.
   * Four requests would be four chances to render a pane assembled out of two
   * different moments.
   */
  readMyRoles: (): Promise<MyRoles> => request('GET', '/api/me/roles'),

  /**
   * The whole document, under the hash it was read at — a `412` carries
   * `current`, so a client can offer *load what is on disk* rather than only
   * being told no. That matters here more than for the system file: hand-editing
   * this one is a supported way to work ([10 §4]).
   */
  writeMyBindings: (
    bindings: Record<string, Binding>,
    contentHash: string,
  ): Promise<BindingsState> => request('PUT', '/api/me/bindings', { bindings, contentHash }),

  /**
   * ***Bytes beside an object*** — [10 §11.2b], [P11].
   *
   * **Multipart rather than a JSON body with base64 in it**, which is the same
   * choice the library's own import takes: a picture is a file, `FormData` is
   * what a browser sends one with, and base64 is a third more bytes on the wire
   * for the privilege of not using it.
   *
   * The answer is the manifest row's four computed fields — `ref`, `digest`,
   * `bytes` and `mime` — so a caller writes an `EmbeddedMedia` without deriving
   * any of them. The row itself travels in the ordinary save.
   */
  uploadAsset: (
    kind: LibraryKind,
    id: string,
    blob: Blob,
    filename: string,
  ): Promise<{ asset: { ref: string; digest: string; bytes: number; mime: string } }> => {
    const form = new FormData();
    form.append('file', blob, filename);
    return requestForm(`/api/library/${kind}/${id}/assets`, form);
  },

  listLibrary: (kind?: LibraryKind): Promise<{ objects: LibraryObject[] }> =>
    request('GET', kind === undefined ? '/api/library' : `/api/library/${kind}`),

  /**
   * What the library could not load — [P7B.8].
   *
   * ***The route has existed since P2 and nothing called it.***
   * [manual gate §3.5](../../../docs/design/workplan/11-p2-manual-gate.md) has
   * said *"No client code calls it"* for six phases, and its gate step has
   * failed the whole time: *"Break an actor by hand and the app is silent:
   * stale content presented as current, edited, then refused by a conflict
   * dialog blaming a concurrent editor."* A quarantine nobody can look into is
   * a deletion with extra steps.
   */
  libraryErrors: (): Promise<{ errors: LibraryFileError[] }> =>
    request('GET', '/api/library/errors'),

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
  /**
   * `importedFrom` is [10 §11.2c]'s *"the book's history is the record of the
   * import"* — the file a merge came from, which makes the save's history line
   * read `import` rather than `manual`. Absent on every other save, which is
   * every save but one.
   */
  updateObject: (
    kind: LibraryKind,
    id: string,
    object: Record<string, unknown>,
    contentHash: string,
    importedFrom?: string,
  ): Promise<{ contentHash: string; object: Record<string, unknown> }> =>
    request('PUT', objectUrl(kind, id), {
      object,
      contentHash,
      ...(importedFrom === undefined ? {} : { importedFrom }),
    }),

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
   * What that file *would* become, with nothing written ([10 §5], as amended).
   *
   * The bytes are sent twice — once here and again to `importFile` on confirm —
   * because there is no staging area and the confirm has to re-derive from the
   * file rather than trust this answer. A preset is kilobytes.
   */
  importFilePreview: (
    file: File,
    destination?: ImportDestination,
  ): Promise<{ preview: ImportPreview }> => {
    const body = new FormData();
    // Before the file, on the ordering rule `importFile` states below — and it
    // matters more here than there, because re-previewing under the other
    // destination is the *only* thing this argument is for.
    if (destination !== undefined) body.append('destination', destination);
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
    destination?: ImportDestination,
  ): Promise<ImportFileResult> => {
    const body = new FormData();
    if (onConflict !== undefined) body.append('onConflict', onConflict);
    // Same rule, same reason: appended before the file so the route sees it.
    if (destination !== undefined) body.append('destination', destination);
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

  /**
   * One embedded media entry's bytes — [P7.10].
   *
   * *Cache-busted by the media's own `digest` rather than by the object's
   * content hash*, which is the same decision the route's etag makes: editing a
   * line of a character's description must not re-fetch their whole expression
   * set.
   */
  mediaUrl: (kind: string, id: string, mediaId: string, digest: string): string =>
    `/api/library/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/media/` +
    `${encodeURIComponent(mediaId)}?v=${encodeURIComponent(digest)}`,
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
export type { Turn as TurnRecord, Rendition as RenditionRecord } from '@storyengine/shared';

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
  /**
   * What this session retrieves from — [P6B.0].
   *
   * Widened here rather than left to the route, which is the decision the note
   * above says belongs to the surface that needs one: the lore panel needs to
   * show what is attached before it can change it, and the read route has been
   * returning the whole session file all along. Optional because a session
   * made before either field existed has neither, and `treatment` is nullable
   * because clearing it is a value rather than an absence.
   *
   * **`preset` is deliberately not claimed.** The create route takes a preset
   * *id* and stores a structural copy ([P4 §1.9]), so what comes back is not
   * what went out, and a field that changed shape between write and read is
   * the kind of thing a surface should be made to ask for explicitly.
   */
  treatment?: string | null;
  lore?: string[];
  /**
   * **An object, and it was typed as a string until Play's mode bar read it.**
   * The list route returns the whole `session.json`, where a mode is
   * `{ id, config }`; nothing on the client had ever looked, so the wrong type
   * cost nothing until something did. `config` is the mode's own and stays
   * unclaimed here. Absent on a session made before modes existed, which the
   * server reads as its default mode — and so must anything filtering by it.
   */
  mode?: { id: string };
  /**
   * The session's own copy of its prompt pack — [03 §8], claimed at [P7B.2].
   *
   * ***On the wire since P2 and undeclared here until now.*** `GET
   * /api/sessions/:id` sends the whole session file, so this has always
   * arrived; nothing on the client had a use for it, because until this phase
   * nothing could change or even display which pack a session runs. The type
   * was not wrong, it was incomplete — which is the same shape as everything
   * else [P7B §0.5] collects, one layer up from a route with no caller.
   *
   * **`Record<string, unknown>` rather than `Preset`**, on the terms `treatment`
   * and `lore` above set: a session's pack is a *structural copy* made at
   * creation and possibly written by a later build, so a client naming its
   * shape would be claiming to know more than it does. The panel reads `name`
   * and `params` and passes the rest through untouched.
   */
  preset?: Record<string, unknown>;
  /**
   * The goal chain, for the one caller that needs it back from a write —
   * [06 §7.3.4], [P7.6].
   *
   * **Claimed for the same reason `lore` was and on the same terms**: setting a
   * goal at a completion is two acts, and the second one needs the **id the
   * server minted** for the first. Reading it off the response is what makes
   * that a fact rather than a guess. *Only the fields a client has a use for*:
   * the chain is `Goal` objects and this names the two the panel reads.
   */
  goals?: { id: string; statement: string }[];
  /**
   * The **Setup** this session was created from — the id, and only the id.
   *
   * ***On the wire since P7.4 and undeclared here until the promote control
   * needed it***, which is the same shape `preset` above records: `GET
   * /api/sessions/:id` sends the whole session file, and `SessionFile.setup` is
   * a **copy of the Setup** carrying its library id — the same id `poolFor`
   * stamps into a pooled hook's `source`. Nothing on the client had a use for
   * it, so nothing claimed it, and a docstring one package over went on saying
   * *`SessionSummary` has never carried a `setup` field* as though that were a
   * fact about the route.
   *
   * *Only the field a client has a use for*, on the terms this interface sets
   * for `treatment`, `lore` and `goals`. ~~The Setup's cast, openings, goals and
   * hooks are all on the wire too and all of them are a copy of an object the
   * library can be asked for;~~ what cannot be got any other way is **which
   * object it was a copy of**. *Corrected 2026-09-27: the copy is no longer on
   * the wire.* A reply carries the Setup as its id and name, since its goals and
   * hooks are the spoilers the play surface exists not to show
   * (`presentSession` on the server).
   */
  setup?: { id: string };
}

/**
 * What a new session may be given — [P6B.0], and every field of it has been
 * accepted by `POST /api/sessions` since P5.6 while the client sent `name`
 * alone. That gap is why no session ever resolved a lorebook and why PLAYABLE
 * could not run ([P6B §0.1]).
 *
 * `preset` is an id here: the route copies it at creation, and the copy is what
 * the session then owns.
 */
export interface NewSession {
  /**
   * Optional, because Start no longer demands one — [03 §8].
   *
   * A session is id-addressed and nothing resolves one by name, so starting
   * unnamed freezes nothing and the name can arrive whenever its owner knows
   * what it is. `sessionLabel` is what renders the gap in the meantime.
   */
  name?: string;
  treatment?: string;
  lore?: string[];
  preset?: string;
  /**
   * Who the player is — [P7 §0.2]'s cold list item 5, narrowed to the half that
   * survives this phase.
   *
   * **The persona, and deliberately not `cast.actors`.** [06 §8](../../../docs/design/06-modes-and-turn-pipeline.md)
   * says the persona *"is the one part that can stay a plain session field,
   * because it is chosen at setup and changing it mid-session is an explicit
   * act rather than an outcome of play"* — and
   * [P7 §1.6](../../../docs/design/workplan/23-p7-implementation.md) confirms it
   * against the phase that moves everything else: `cast.actors` becomes channel
   * state, `cast.persona` does not. So a control for this one is permanent
   * surface, and a control for the other would be built against a shape P7
   * replaces. `SessionsPage` and `LorePanel` both say so.
   */
  persona?: string;
  /**
   * Which mode to play — [P7.4].
   *
   * **The form had no control for this until the wizard needed one**, and the
   * absence was not a deferral so much as an impossibility: nothing told a
   * client which modes exist. `GET /api/modes` does now, so choosing one is
   * possible and choosing one is what decides which wizard renders.
   */
  mode?: string;
  /**
   * ***Who is in it*** — [P11.3], and it is deliberately not the control the
   * `persona` docstring above refuses.
   *
   * That paragraph argues against a *surface* for `cast.actors`, because it
   * becomes channel state at P7 and a form built against the old shape would be
   * built twice. This is not a form: it is how the assistant panel puts the
   * shipped assistant card into the session it creates, with no person choosing
   * anything. The route has taken the field since P2; the client type had no
   * caller until there was one.
   */
  cast?: { persona: string | null; actors: string[] };
  /**
   * The mode's wizard, answered — [06 §7.3], [P7.4].
   *
   * Keyed by the field ids the mode declares. The server checks it against a
   * schema derived from that declaration, so what a client must not do is
   * invent a key: an unknown one is a `422`, not a silently dropped field.
   *
   * *`modeConfig` and not `setup`, because `setup` is the **Setup** object —
   * two different things one word apart, and the session file has kept this
   * value at `mode.config` since P2.3.*
   */
  modeConfig?: Record<string, unknown>;
}

/**
 * A mode as `GET /api/modes` presents it — [10 §8], [P7.4].
 *
 * **What is not here is the point.** A session copies its preset at creation, so
 * the prompt pack is not the client's to see or change; `steps` and `channels`
 * are what the engine runs and registers, and a channel reaches a browser as a
 * rendered entry in a session's `hud` rather than as a declaration.
 */
export interface PublicMode {
  id: string;
  displayName: string;
  voice: 'narrator' | 'embodied';
  dispatch: 'merged' | 'per-actor';
  participants: { select: string; maxActors: number };
  inputs: string[];
  presetIds: string[];
  setup: ModeSetup;
  surfaces: { region: string }[];
}

/**
 * What a mode asks for before the first turn — declared, never coded.
 *
 * **The client renders the form from this and from nothing else**, which is what
 * lets a mode the engine has no knowledge of have a wizard ([06 §2] refuses the
 * back door a mode-specific screen would be). There is deliberately no way for a
 * mode to ship UI and deliberately no `html` field in the vocabulary
 * ([10 §8](../../../docs/design/10-ui-surfaces.md) names that absence as the one
 * that must hold).
 *
 * **Typed open at `kind`**, for the reason the workbench's `SOURCE_LABELS` is:
 * a newer build can declare a widget this one has never heard of, and the honest
 * answer is to say so rather than to crash or to render a blank.
 */
export type ModeSetup =
  | { kind: 'none' }
  | { kind: 'declared'; fields: SetupField[] }
  // A `kind` from a newer build. Named so the union is exhaustive here rather
  // than at every reader.
  | { kind: string };

export interface SetupField {
  id: string;
  required?: boolean;
  widget: FieldWidget;
}

export type FieldWidget =
  | { kind: 'text'; label: string; hint?: string; lines?: number }
  | { kind: 'choice'; label: string; hint?: string; options: { value: string; label: string }[] }
  | { kind: 'toggle'; label: string; hint?: string }
  | { kind: string; label: string; hint?: string };

/**
 * `defaultModeId` is what `POST /api/sessions` plays when `mode` is absent.
 *
 * **Sent rather than assumed**: a form falling back to the first mode in the
 * list would render one mode's wizard and create a session on another the moment
 * registration order stopped matching.
 */
export function listModes(): Promise<{ modes: PublicMode[]; defaultModeId: string }> {
  return request('GET', '/api/modes');
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

export function createSession(input: NewSession): Promise<{
  session: SessionSummary;
  /**
   * ***Other sessions already played under this treatment*** — [08 §6], [P8.5].
   *
   * Absent when there are none, which is the ordinary case. Present means
   * *replaying a story you have played*, which 08 §6 names as the sharp failure:
   * intake will happily import what happened last time, twists included.
   */
  sharesTreatmentWith?: { sessionId: string; name: string }[];
}> {
  // Only what was chosen: the route's optional fields mean *unset*, and sending
  // an empty list would be a session that has decided to retrieve nothing,
  // which is a different claim from one that was never asked.
  return request('POST', '/api/sessions', {
    // A name that is absent and one that is blank mean the same thing, so only
    // one of them is sent. The route would store `''` for either — this keeps
    // the wire honest about the fact that nothing was chosen.
    ...(input.name === undefined || input.name.trim() === '' ? {} : { name: input.name }),
    ...(input.treatment === undefined ? {} : { treatment: input.treatment }),
    ...(input.lore === undefined || input.lore.length === 0 ? {} : { lore: input.lore }),
    ...(input.preset === undefined ? {} : { preset: input.preset }),
    /**
     * **`actors: []` because the route's `CastBody` requires both members**, not
     * because an empty cast is being asserted — and the two are the same value
     * here, since a session created in a browser has never had actors and the
     * surface that gives it one is [P7.2]'s.
     */
    ...(input.persona === undefined || input.persona === ''
      ? {}
      : { cast: { persona: input.persona, actors: [] } }),
    ...(input.mode === undefined || input.mode === '' ? {} : { mode: input.mode }),
    /**
     * **Omitted when empty**, like every other field here: a mode with no
     * wizard accepts exactly `{}` and a session for one carries no `setup` key
     * at all, so sending an empty object would be the client asserting that a
     * wizard ran and collected nothing.
     */
    ...(input.modeConfig === undefined || Object.keys(input.modeConfig).length === 0
      ? {}
      : { modeConfig: input.modeConfig }),
  });
}

/**
 * Renames a session — [03 §8].
 *
 * The same `PATCH` that archives, because a session name is an ordinary
 * property: nothing resolves a session by it, so this is one JSON write and one
 * index row, with no report to read and no second question to answer. Compare
 * `renameTag`, which is a `POST` to a verb precisely because it is not that.
 *
 * An empty name is a legitimate value — it is the state a session may have
 * started in — so this does not refuse one.
 */
/**
 * Which pack this session is assembled from — [P7B.2].
 *
 * **One of the two, never both.** `presetId` switches to a library preset the
 * server clones ([03 §8]'s *copy, never link*), or the literal `default` for
 * whatever the mode ships; `preset` is the session's own pack sent whole, which
 * is how the panel edits one in place. [P7B §1.1] records that those are the
 * same operation with a pack of one.
 */
export function setSessionPreset(
  sessionId: string,
  body: { presetId: string } | { preset: Record<string, unknown> },
): Promise<{ session: SessionSummary }> {
  return request('PUT', `/api/sessions/${encodeURIComponent(sessionId)}/preset`, body);
}

/**
 * Archive or restore — [03 §10.3], [P7B.2].
 *
 * ***One field on a `PATCH` this client has been sending since P2.*** The route
 * has accepted `{ archived }` the whole time and `renameSession` below has been
 * calling it with `{ name }`; nothing ever sent the other half. That is the
 * sharpest instance of the shape [P7B §0.5] is about — not a missing route, a
 * missing *field* on a request already being made.
 */
export function setSessionArchived(
  sessionId: string,
  archived: boolean,
): Promise<{ session: SessionSummary }> {
  return request('PATCH', `/api/sessions/${encodeURIComponent(sessionId)}`, { archived });
}

/** To trash, never erased — [03 §10.2], [03 §10.3]. */
export function deleteSession(sessionId: string): Promise<void> {
  return request('DELETE', `/api/sessions/${encodeURIComponent(sessionId)}`);
}

export function renameSession(
  sessionId: string,
  name: string,
): Promise<{ session: SessionSummary }> {
  return request('PATCH', `/api/sessions/${encodeURIComponent(sessionId)}`, { name });
}

/**
 * Point a session at a treatment and a set of books — [P6B.0].
 *
 * **Both fields replace rather than merge**, which is the route's shape
 * (`LoreBody`) and the right one for a control that shows what is attached: a
 * panel that submits what it displays cannot drift from what is stored. Ids are
 * not validated server-side, deliberately, so a book deleted out from under a
 * session dangles rather than blocking it.
 */
export function setSessionLore(
  sessionId: string,
  selection: { treatment: string | null; lore: string[] },
): Promise<{ session: SessionSummary }> {
  return request('PUT', `/api/sessions/${encodeURIComponent(sessionId)}/lore`, selection);
}

/**
 * A hook added to a running session, or taken out of one — [03 §4.1], [P7.5].
 *
 * *The primary path*, in that section's words: creation copies hooks from a
 * treatment, a setup and the lorebooks, and *"a session may add its own while
 * running"*. **An authoring act, not a story event** — it lands on the session
 * file rather than as a channel effect, so a hook added at turn forty is in the
 * pool at turn one and a rewind does not un-add it.
 *
 * *The body is open on purpose*, matching the route: a hook the schema would
 * refuse is an authoring mistake to show rather than a request to reject, and
 * the selector's filter is where a broken one stops being eligible with a reason
 * the panel can say.
 */
export function addSessionHook(
  sessionId: string,
  hook: Record<string, unknown>,
): Promise<{ session: SessionSummary }> {
  return request('POST', `/api/sessions/${encodeURIComponent(sessionId)}/hooks`, { hook });
}

/** And back out — any of them, whichever source put it there ([00 §3.1]). */
export function removeSessionHook(
  sessionId: string,
  hookId: string,
): Promise<{ session: SessionSummary }> {
  return request(
    'DELETE',
    `/api/sessions/${encodeURIComponent(sessionId)}/hooks/${encodeURIComponent(hookId)}`,
  );
}

/**
 * ***Which of [03 §4.1]'s three carriers a hook is being saved onto.***
 *
 * `lore` is a **lorebook**, spelled the way the pool already spells it:
 * `HookRow.source` calls that arm `lore` and the session's own field is `lore`,
 * so a target that said `lorebook` would be a third name for one thing in a
 * feature whose whole job is to line targets up against sources by eye.
 * `session` is deliberately not one of them — promoting a hook onto the session
 * it is already in is not an act.
 */
export type PromoteTargetKind = 'treatment' | 'setup' | 'lore';

export interface PromoteTarget {
  kind: PromoteTargetKind;
  id: string;
}

/**
 * The library folder each target kind lives in, **read off the registry rather
 * than spelled out here**.
 *
 * Two vocabularies meet at exactly this point: a carrier is named by 03 §4.1's
 * word for it (`lore`) and the library is addressed by folder (`lorebooks`).
 * This file's opening rule — *the client never maintains its own list of kinds*
 * — is why the bridge is three lookups instead of three string literals, which
 * would be free to drift the day a folder is renamed and would drift silently,
 * because a query key that matches nothing invalidates nothing and reports no
 * error while doing it.
 */
export const PROMOTE_DIRECTORIES: Record<PromoteTargetKind, LibraryKind> = {
  treatment: LIBRARY_DIRECTORIES[TREATMENT_SCHEMA],
  setup: LIBRARY_DIRECTORIES[SETUP_SCHEMA],
  lore: LIBRARY_DIRECTORIES[LOREBOOK_SCHEMA],
};

/**
 * ***And the other way — one of a session's hooks saved back out onto a library
 * object*** — [03 §4.1], [06 §6.1], [15 §5.1].
 *
 * **The pair above only ran one way.** A session copies hooks *in* at creation
 * from all four of 03 §4.1's sources and may gain its own while playing, and
 * until this route there was no way back out of one: a hook realised mid-play —
 * which [06 §6.1] calls *most of why the feature earns its place* — died with
 * the session it was realised in.
 *
 * ***Two ids cross and nothing else, which is the design rather than an
 * economy.*** `HookRow` is a redaction of the pool: an unfired premise never
 * reaches this package and entrances arrive by label, so a read-modify-write
 * here would be promoting a hook the client has never been shown — and the only
 * way to make one possible would be to send the premise down, which [08 §6] and
 * [10 §10.1] forbid by name. The client says *which hook* and *which object*;
 * the server is the only party that ever holds the hook itself.
 *
 * **What comes back is the object and not the session**, because nothing about
 * the session changed — a response carrying one would invite a caller to
 * believe otherwise, and the asymmetry is the whole point of the act. `name` is
 * there to be said back: the row looks exactly as it did afterwards, so the
 * confirmation naming where it went is the only evidence anything happened.
 *
 * ***`from` is the row's own source, and it is what makes *which hook* an
 * answerable question.*** The pool does not de-duplicate by id on purpose — the
 * same hook can reach a session from a treatment and from one of its own
 * lorebooks — so two rows can share an id and carry different content, and an id
 * alone names the first of them rather than the one somebody pressed. Sending
 * the attribution the row was drawn with costs nothing (it is a kind and an id
 * the server already holds, never hook content) and is the difference between
 * copying the hook that was shown and copying a different one.
 *
 * *The refusals are `already-there` (409, the target carries this id already —
 * never a second copy and never a fresh id, [15 §5.1]), `no-session`,
 * `no-such-hook` and `no-such-object`, three 404s that are three different
 * claims and send a person to three different places, and `target-moved` (409,
 * the object changed underneath the write — deliberately **not** the library's
 * 412, whose body would carry the whole object and with it every unfired
 * premise on it).*
 */
export function promoteSessionHook(
  sessionId: string,
  hookId: string,
  target: PromoteTarget,
  from?: HookRow['source'],
): Promise<{ object: { id: string; name: string; kind: PromoteTargetKind } }> {
  return request(
    'POST',
    `/api/sessions/${encodeURIComponent(sessionId)}/hooks/${encodeURIComponent(hookId)}/promote`,
    from === undefined ? { target } : { target, from },
  );
}

/**
 * One row of the goal panel — [06 §7.3.4], [04 §7.1], [P7.6].
 *
 * **The statement travels and `detail` does not**, which is the trade [04 §7.1]
 * makes on the schema: `statement` is *"short, always injected"* and `detail` is
 * *"available to steps; not injected by default"*. A panel row is the sentence a
 * person is playing toward.
 *
 * `visibility` is the **player's** view — [04 §7.1]'s *hidden is the GM's arc* —
 * and is a different field from the channel visibility that governs prompts. A
 * hidden goal is still narrated toward; it is the reader who is not told.
 */
/**
 * What a dial control needs: the level in play, and the vocabulary it may write.
 *
 * **The levels travel rather than being hard-coded** — [06 §7.3.1] makes them
 * the prompt pack's, so a client with its own list would be a control that
 * produces recorded refusals the day a pack ships a fourth.
 */
/**
 * One thing a mode asked to have shown, already rendered — [06 §9], [P7.11].
 *
 * `kind` is the widget arm and `region` is where it goes. Both are open strings
 * on this side for the reason `ChannelSurface.kind` is: a session opened
 * against a newer build should render what it understands and skip the rest,
 * not break.
 */
export interface ModeSurface {
  region: string;
  key: string;
  channelId: string;
  scopeKey: string | null;
  kind: string;
  label: string;
  text?: string;
  image?: { url: string; alt: string };
  on?: boolean;
}

export interface DialAxes {
  difficulty?: { levelId: string | null; levels: { id: string; label: string }[] };
  directedness?: { levelId: string | null; levels: { id: string; label: string }[] };
}

export interface GoalRow {
  goalId: string;
  statement: string;
  visibility: 'player' | 'hidden';
  completion: 'narrative' | 'manual';
  /** Whether play is on this one. Exactly one row, or none. */
  current: boolean;
  achieved: boolean;
  /**
   * The narrator judged this met and it is waiting on a person ([25 C12]).
   * Never true at the same time as `achieved`.
   */
  proposed: boolean;
  /** The turn it was completed on. */
  achievedOn?: string;
  /** The authored successor, if the chain names one. */
  next: string | null;
  /** What *seeds the offer; it does not decide it* ([06 §7.3.4]). */
  thenDefault: 'continue-open' | 'advance' | 'end';
}

/**
 * A goal written at a completion — [06 §7.3.4]'s *"or one written now"*, [P7.6].
 *
 * *An authoring act rather than a story event*: it lands on the session's chain
 * and appends no turn. **Moving play onto it is the channel write**, which is a
 * turn — two acts, because that section is emphatic that `thenDefault` seeds the
 * offer and does not decide it.
 */
export function addSessionGoal(
  sessionId: string,
  goal: Record<string, unknown>,
): Promise<{ session: SessionSummary }> {
  return request('POST', `/api/sessions/${encodeURIComponent(sessionId)}/goals`, { goal });
}

export function readSession(sessionId: string): Promise<{
  session: SessionSummary;
  activeJob: ActiveJob | null;
  health: DegradedChannel[];
  hud: ChannelSurface[];
  cast: CastRow[];
  /**
   * The hook panel's rows and the dial above them — [10 §10.1].
   *
   * *The dial travels with the rows rather than in `hud`*, because 10 §10.1 puts
   * it **in the panel**: it is the control that explains an empty one, and the
   * strip above the transcript is a different place making a different claim.
   */
  hooks: { pacing: 'sparse' | 'normal' | 'aggressive' | 'manual-only'; rows: HookRow[] };
  /**
   * What this session is trying to do — [06 §7.3.3], [06 §7.3.4], [P7.6].
   *
   * *The three offers are derived on the screen rather than sent*: they are the
   * same three every time, and what decides whether to raise them is `achieved`
   * plus `next`, both of which travel.
   */
  goals: { rows: GoalRow[]; concluded: boolean };
  /**
   * The two dials, for a mode that declares them ([06 §7.3.1], [06 §7.3.2]).
   *
   * **Absent for a mode with no difficulty**, which is [04 §7]'s explicit case:
   * Scene and Messages declare neither channel, so there is nothing to send and
   * nothing to render. An axis is present only when the pack also ships levels
   * for it.
   */
  dials?: DialAxes;
  /**
   * The input kinds this session's mode accepts ([06 §1], [P7.9]). One kind
   * means the player has no choice to make and no selector is shown.
   */
  inputs?: string[];
  /** Whether this session asks for suggested actions ([R11]). */
  suggesting?: boolean;
  /**
   * Whether this session makes pictures — [06 §10.6], [P9.4].
   *
   * `backdrop` is absent for a mode that declares no backdrop channel, which is
   * `dials`' rule for a mode with no difficulty: nothing to render rather than a
   * control that does nothing.
   */
  renditions?: { illustration: IllustrationMode; backdrop?: boolean };
  /**
   * What this session's mode put where — [06 §9], [P7.11].
   *
   * Rendered by the server down to the value, like `hud` beside it: what
   * crosses is a region, a label and something to show. A `kind` this build
   * does not know is skipped, which is what keeps the vocabulary additive.
   */
  surfaces?: ModeSurface[];
}> {
  return request('GET', `/api/sessions/${sessionId}`);
}

/**
 * One row of the hook panel — [10 §10.1], [06 §6.1], [P7.5].
 *
 * *"Which hooks have fired and when, which are eligible right now, and which are
 * blocked **with the clause that blocked them**."*
 *
 * ***The content is not here, and that is the panel's defining constraint.***
 * [08 §6] makes an unfired hook's premise hidden content and [10 §10.1] says it
 * of entrances twice — *"a panel that spoils the arrival to the person about to
 * read it defeats the feature"*. So a row is named by its `title`, which
 * [04 §6.1] calls *"for the author's list. Never injected."*; `premise` arrives
 * only once the hook has gone, and entrance **text** never arrives at all,
 * because the workbench's block list already shows a fired hook's exact words.
 */
export interface HookRow {
  hookId: string;
  title: string;
  /** Which object owns it, so editing can navigate there — [03 §4.1]. */
  source: { kind: 'treatment' | 'setup' | 'lore' | 'session'; id?: string };
  /** `null` is *in the pool*. */
  state: 'fired' | 'provisional' | 'committed' | 'forced' | null;
  /** `null` when it is eligible right now. */
  refusal: HookRefusal | null;
  /** Present when a person's Commit is carrying it, with the clause it skipped. */
  committed?: { overrode: HookRefusal | null };
  /**
   * Present when a person has **force-fired** it — [06 §6.1]'s other hand
   * control, and the workbench's rather than the panel's.
   *
   * *A field of its own rather than a `kind` on the one above*: a commitment
   * says *make this happen, not necessarily now* and keeps asking where until
   * its patience runs out; a force says *deliver it on the next turn with no
   * judgement call at all*. They share a shape and nothing else.
   */
  forced?: { overrode: HookRefusal | null };
  /** The turn it fired on. */
  firedOn?: string;
  /** Only once it has gone. */
  premise?: string;
  /** **Labels, never text.** Empty for a hook that is an event rather than an arrival. */
  entrances: { id: string; label: string }[];
}

/**
 * Why a hook is not eligible — a class, not prose, and the panel maps it to a
 * sentence ([06 §6.1]: an author must see *which are blocked and by what*).
 *
 * **A string union rather than a copy of the engine's type**: this package does
 * not import `@storyengine/shared`'s record types, and a wire shape is a wire
 * shape. A value this build does not know reads as a class the panel has no
 * sentence for, which `hookWords` answers rather than throwing.
 */
export type HookRefusal =
  | 'fired'
  | 'pending'
  | 'book-inactive'
  | 'blocked'
  | 'too-early'
  | 'cast-gone'
  | 'subject-gone'
  | 'subject-met'
  | 'subject-unavailable'
  /** Not a hook the engine can read (2026-09-27). */
  | 'malformed';

/**
 * One row of the cast panel — [10 §13.2], [P7.2].
 *
 * **Both axes, and the badge is derived here rather than sent.** 10 §13.2:
 * *"the UI still shows one badge, derived from both axes, because a two-axis
 * matrix is the wrong thing to put in a sidebar. The split is in the data, not
 * on the screen."* A pre-derived badge on the wire would also leave the panel
 * unable to offer *correct presence and status directly*, which is what makes it
 * a repair surface rather than a read-only complaint.
 */
export interface CastRow {
  actorId: string;
  presence: boolean;
  status: string;
  /** A terminal status the model proposed and the engine refused, unanswered. */
  pending: string | null;
  introduced: boolean;
  /**
   * Who authors them, when they are travelling with you — [06 §8], [P7.3].
   * `null` is *in the story and not in the party*, which is most of the cast
   * most of the time.
   */
  party: 'player' | 'companion' | 'auto' | null;
}

/**
 * One channel as the HUD shows it — [10 §8], [P7.1].
 *
 * **Rendered by the server**, which is what 10 §8's decision costs and buys: an
 * extension declares a widget from a versioned vocabulary and the host renders
 * it, so what reaches the browser is a label and a string rather than anything
 * an extension author wrote. A client composing this would need the registry,
 * the declarations and a template engine.
 *
 * `kind` is the vocabulary's arm. One today — text — and a client meeting a
 * `kind` it does not know should ignore that widget rather than break, which is
 * what makes widening the vocabulary additive.
 */
export interface ChannelSurface {
  key: string;
  channelId: string;
  scopeKey: string | null;
  kind: string;
  label: string;
  text: string;
}

/**
 * One channel this session could not load — [06 §4.2]'s health record, [P7.1].
 *
 * **Composed by the server, not derived here**, which is the difference between
 * one shape and two: a client walking `session.channels` itself would have to
 * split composite keys (`se.lore.timing#<entryId>`) and know the registry, and a
 * second copy of that logic in a React component is exactly the drift the
 * server's own modules keep refusing.
 */
export interface DegradedChannel {
  /** The map key, which is what a recovery write addresses. */
  key: string;
  channelId: string;
  scopeKey: string | null;
  version: number;
  reason: string;
  /** The value that stopped fitting. What *retry* sends back. */
  raw: unknown;
  /** What is standing in its place. What *accept the reset* sends back. */
  value: unknown;
}

/**
 * A person writes one value to one channel — [06 §4.2]'s recovery, [P7.1].
 *
 * **One call for all three offers.** That section offers *"retry the migration
 * once the author ships a fix, edit the quarantined value by hand, or accept the
 * reset"*: retry sends `raw` back, edit sends whatever was typed, and accept
 * sends the value already standing — which clears the marker, because a degraded
 * state is only ever written by an effect carrying a reason.
 *
 * **A refusal comes back as a 200 with `effect.applied === false`**, not as a
 * thrown `ApiError`. A retry that still does not fit is a *recorded* refusal,
 * which is the whole reason recovery is safe to offer, and a status code would
 * throw away the record the workbench is meant to show. Callers read the effect.
 */
export function writeSessionChannel(
  sessionId: string,
  key: string,
  value: unknown,
): Promise<{
  session: SessionSummary;
  effect: { applied: boolean; rejectedReason: string | null };
  health: DegradedChannel[];
}> {
  return request(
    'PUT',
    `/api/sessions/${encodeURIComponent(sessionId)}/channels/${encodeURIComponent(key)}`,
    { value },
  );
}

/**
 * The path from the head, and which of its nodes have siblings — [P6.3].
 *
 * `siblings` maps a turn on the path to every child of its parent, in creation
 * order, and only for nodes that have more than one. History shows the selected
 * path only ([07 §6]), so this is how an alternative is reachable at all.
 */
export function readTranscript(
  sessionId: string,
  options: { limit?: number; from?: string } = {},
): Promise<{ turns: TurnRecord[]; siblings?: Record<string, string[]> }> {
  /**
   * ***`from` walks to a node that is not the head*** — [10 §12.1], [P11.1].
   *
   * The reading view's *"any node, not just the head"*, asking the transcript's
   * own route rather than a second one: what differs between the two surfaces
   * is what they render, and a second fetch path would be a second place for
   * the walk and the sibling map to drift.
   */
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.from !== undefined) query.set('from', options.from);
  const suffix = query.size === 0 ? '' : `?${query.toString()}`;
  return request('GET', `/api/sessions/${sessionId}/turns${suffix}`);
}

/**
 * Name a node — [07 §6]'s *promote*. A name and nothing more: no turn moves,
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
/**
 * The two switches, the widening and the tri-state list — [08 §4], [08 §7].
 *
 * **`auto` is the absence of a choice and is sent as an absence**: the map holds
 * only the sessions somebody has forced on or off, which is what makes *absent
 * means governed by `intake`* the same statement on both sides of the wire.
 */
export interface MemoryConfig {
  share: boolean;
  intake: boolean;
  acrossPersonas: boolean;
  associations: Record<string, 'always' | 'never'>;
}

export interface MemoryBookLink {
  actorId: string;
  actorName: string;
  /** Null until the first memory is written — books are created lazily. */
  bookId: string | null;
  entries: number;
}

export interface MemoryAssociationRow {
  sessionId: string;
  name: string;
  association: 'auto' | 'always' | 'never';
  /** What it comes to with `intake` applied — 08 §7's *visible rather than inferred*. */
  effective: boolean;
  shared: string[];
}

export interface MemoryPanel {
  config: MemoryConfig;
  books: MemoryBookLink[];
  others: MemoryAssociationRow[];
}

export function readMemoryPanel(sessionId: string): Promise<MemoryPanel> {
  return request('GET', `/api/sessions/${encodeURIComponent(sessionId)}/memory`);
}

export function setMemoryConfig(
  sessionId: string,
  config: MemoryConfig,
): Promise<{ memory: MemoryConfig }> {
  return request('PUT', `/api/sessions/${encodeURIComponent(sessionId)}/memory`, config);
}

/**
 * Renditions — [06 §10](../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P9.4].
 *
 * `Rendition` is re-exported from `@storyengine/shared` rather than redeclared,
 * which is the rule this file already follows for `Turn`: a record the server
 * writes and the client reads is one shape, and two declarations of it drift on
 * the first field somebody adds.
 */
export type { Rendition, IllustrationMode } from '@storyengine/shared';
import type { IllustrationMode, Rendition as RenditionRecord } from '@storyengine/shared';

export function readRenditions(
  sessionId: string,
): Promise<{ renditions: RenditionRecord[]; selection: Record<string, string> }> {
  return request('GET', `/api/sessions/${encodeURIComponent(sessionId)}/renditions`);
}

/**
 * Where a rendition's pixels are.
 *
 * ***`?v=<digest>` is the cache-buster***, which is `avatarUrl`'s and
 * `mediaUrl`'s convention: the bytes are immutable under an id and the digest is
 * what changes when a retry produces different ones. `route-callers.test.ts`
 * strips the query string, so this helper is what credits the route.
 */
export function renditionAssetUrl(sessionId: string, renditionId: string, digest: string): string {
  return (
    `/api/sessions/${encodeURIComponent(sessionId)}` +
    `/renditions/${encodeURIComponent(renditionId)}/asset?v=${encodeURIComponent(digest)}`
  );
}

/** Runs a recipe again — the retry, and the re-creation of an evicted picture. */
export function retryRendition(
  sessionId: string,
  renditionId: string,
): Promise<{ rendition: RenditionRecord }> {
  return request(
    'POST',
    `/api/sessions/${encodeURIComponent(sessionId)}/renditions/${encodeURIComponent(renditionId)}/retry`,
  );
}

/**
 * ***Illustrate*** this turn, or ***Set the scene*** for it — [06 §10.6].
 *
 * One call and two verbs, because they are one act under two purposes. A
 * refusal comes back as `{ held }` with a 200: **nothing is bound to the image
 * role** is the ordinary state of an install, not a failed request.
 */
export function illustrateTurn(
  sessionId: string,
  turnId: string,
  purpose: 'illustration' | 'background',
): Promise<{ rendition?: RenditionRecord; held?: 'no-binding' | 'no-moment' }> {
  return request(
    'POST',
    `/api/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/illustrate`,
    { purpose },
  );
}

/** Chooses which of a turn's renditions is shown — [06 §10.7]. */
export function selectRendition(
  sessionId: string,
  turnId: string,
  renditionId: string,
): Promise<{ selected: string }> {
  return request(
    'PUT',
    `/api/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/rendition`,
    { renditionId },
  );
}

/**
 * ***Remember this*** — [08 §2.1], [P8.3]'s cut form.
 *
 * Every field is sent rather than derived server-side, which is the affordance:
 * the text is whatever the person left in the box, and the keywords are what
 * they decided the memory should fire on. The route checks the actor against the
 * session's cast and the turn against the session, so what a client can get
 * wrong is refused rather than trusted.
 */
export function rememberThis(
  sessionId: string,
  memory: { turnId: string; actorId: string; text: string; keys: string[] },
): Promise<{ bookId: string; entryId: string }> {
  return request('POST', `/api/sessions/${encodeURIComponent(sessionId)}/remember`, memory);
}

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
  /**
   * What kind of thing this is — one of the mode's declared `inputs`
   * ([06 §1], [P7.9]). Absent lets the server apply the mode's default.
   */
  kind?: string;
  /** Its own field, never folded into the action — [06 §5.1]. */
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
   * Replay this turn's draws — **rewrite** rather than reroll, [19 §14.5].
   *
   * A turn id, not a tape: the server reads the draws from its own record.
   */
  rewriteOf?: string;
  /**
   * Show this turn's words to the model as the previous attempt — the other
   * half of a redo, [06 §5.1]. A turn id, not the text: the server reads the
   * words from its own record. Sent with `guidance` or not at all, which is
   * the play surface's rule rather than the server's.
   */
  redoOf?: string;
}

export function submitTurn(submission: SubmitTurn): Promise<{ jobId: string; cursor: string }> {
  return request('POST', `/api/sessions/${submission.sessionId}/turns`, {
    idempotencyKey: submission.idempotencyKey,
    headTurnId: submission.headTurnId,
    /**
     * `kind` only when the selector chose one — [06 §1], [13 §8.3], [P7.9].
     *
     * **Omitted rather than defaulted to `do`**, because the route defaults it
     * and a mode that does not declare `do` would then be sent a kind it
     * refuses. The wire says *the player did not pick*; the server says what
     * that means for this mode.
     */
    input: {
      text: submission.text,
      ...(submission.kind === undefined ? {} : { kind: submission.kind }),
    },
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
 * Where you are in the tree — [07 §3], [P6.1].
 *
 * Moving the head moves no turn data: it is the selection, and the transcript
 * is the path to it. `resume` follows what was last selected forward, which is
 * how *back* and then *forward* returns where you were instead of guessing.
 */
/**
 * What moving the head leaves behind — [07 §7]'s honesty banner, [P6.3],
 * [P8.3].
 *
 * ***The route has sent this since P6.3 and this file typed it away***, which is
 * [P8 §3.1]'s *inverse instance* of the standing line: not configuration with no
 * surface, but **a record with no surface**. It was harmless while nothing could
 * write an escaped effect — `acceptEffect` hard-coded `'session'`, so the count
 * was structurally zero — and it is P8's to close because P8 is what makes the
 * count non-zero.
 *
 * `turns` is how many nodes the old line had that the new one does not;
 * `escapedEffects` is how many of the things on them cannot be un-written. The
 * second is the one worth a sentence, and [07 §7] says which sentence: *"a small
 * honesty feature that avoids a confusing class of bug reports"* — the report
 * being *"I abandoned that line and Vera still remembers it."*
 */
export interface Abandoned {
  turns: number;
  escapedEffects: number;
}

export function moveHead(
  sessionId: string,
  turnId: string,
  resume?: boolean,
): Promise<{ session: SessionSummary; abandoned: Abandoned }> {
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
  /** Beside `enabled` and **not** inside `capabilities` — [12 §4]. */
  hiddenFromGallery?: boolean;
}

/** The tier table and the appliers, sent as data rather than duplicated ([21 §4]). */
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
 * apart. `baseUrl` is admin-visible and user-invisible: [09 §4.5]'s *"an admin
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
   * actually serve them ([19 §5.1]).
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

/**
 * A connection as anyone may see it — a label, a kind, and the models a binding
 * picks from. **No key and no base URL**, which is not a courtesy: it is the
 * property that lets `GET /api/me/roles` live outside `/api/admin` at all, and
 * `routes/connections.test.ts` holds the route to it.
 */
export interface UsableConnection {
  id: string;
  label: string;
  provider: string;
  scope: 'system' | 'user';
  models: string[];
}

/** Everything the role-binding editor needs, from the one request that answers it. */
export interface MyRoles extends BindingsState {
  roles: RoleRow[];
  connections: UsableConnection[];
  /**
   * Personal connections on disk that were ignored for want of
   * `privateConnections` — [09 §4.5] wants the user *told* rather than left
   * wondering why a model call started failing, and this is where that lands.
   */
  disabled: UsableConnection[];
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

  /**
   * An administrator setting somebody else's password — [P7B.5].
   *
   * **The route has shipped since P2A and nothing called it**, which is the
   * class [P7B §0.5](../../../docs/design/workplan/24-p7b-presets-and-prompts.md)
   * is about and the one item the route-caller check found that was cheap
   * enough to answer in the sweep that found it. Without a caller the only way
   * to restore access to an account whose password is lost is to delete it and
   * make a new one, which discards that person's library — a repair that costs
   * more than the thing it repairs.
   *
   * *`newPassword` and not `password`, matching the route's body: the field is
   * named for what it is rather than for the account it belongs to, because the
   * one thing this call must not be confused with is `changePassword`, which
   * takes the current one as well.*
   */
  setAccountPassword: (handle: string, newPassword: string): Promise<undefined> =>
    request('POST', `/api/admin/accounts/${encodeURIComponent(handle)}/password`, { newPassword }),

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

  /** How many bindings point at a connection. Counts, never contents ([09 §4.5]). */
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
   * ([19 §5.1]: the expensive model writes, everything else uses the cheap one)
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
    /** How `canRestart` was decided, so the surface can say why not. */
    supervision: 'systemd' | 'declared' | 'none';
    /** What a restart would interrupt. **Counts, never contents** — [09 §4.5]. */
    interrupts: { mine: number; others: number };
    /** True while a restart is draining. */
    draining: boolean;
    /** A restore is waiting for the next start, or has been refused one. */
    restorePending: boolean;
    /**
     * The daily update check, and the connectivity signal it pays for —
     * [09 §6.5]. Read from the server's cache; nothing here triggers one.
     */
    updates: {
      state: 'disabled' | 'unknown' | 'current' | 'behind' | 'unreachable';
      latest: string | null;
      checkedAt: number | null;
      online: boolean | null;
      /** Whether any connection points somewhere the internet is needed for. */
      needsInternet: boolean;
    };
    /** The same build the auth state carries — the admin shell's copy of it. */
    build: BuildInfo | null;
  }> => request('GET', '/api/admin/notices'),

  /**
   * *Restart now* — [09 §6.4], [P10.3].
   *
   * **202, and it is the last thing this process says.** The drain runs behind
   * the response and then the process exits; the client's own reconnection is
   * what makes the result a brief *reconnecting* rather than a manual refresh.
   */
  restart: (): Promise<{ draining: boolean }> => request('POST', '/api/admin/restart'),
};

/**
 * ***One query, three kinds of hit*** —
 * [10 §14.5](../../../docs/design/10-ui-surfaces.md),
 * [P11.1](../../../docs/design/workplan/28-p11-implementation.md).
 *
 * The route has served this since P2 and nothing called it, which is the entry
 * `route-callers.test.ts` has carried in its `OWED` map. This is the call, and
 * the shape is the route's response verbatim rather than a narrowing: a turn hit
 * carries `onPath` and `headTurnId` because [07 §7] requires a branch hit to say
 * where it lives, and dropping either here would make that impossible on the
 * surface rather than merely absent.
 */
export interface SearchResults {
  objects: { id: string; schema: string; name: string; slug: string; source: string }[];
  turns: {
    turnId: string;
    sessionId: string;
    sessionName: string;
    snippet: string;
    onPath: boolean;
    headTurnId: string | null;
  }[];
  entries: {
    entryId: string;
    entryName: string | null;
    objectId: string;
    objectName: string;
    slug: string;
    source: string;
    snippet: string;
  }[];
}

export function searchEverything(query: string): Promise<SearchResults> {
  return request('GET', `/api/search?q=${encodeURIComponent(query)}`);
}

/**
 * ***A draft of your own next message*** —
 * [06 §3.1](../../../docs/design/06-modes-and-turn-pipeline.md), [P11.4].
 *
 * `POST` for something that commits nothing, because it dispatches a model call:
 * it costs money and time, and must not be replayable by a browser deciding to
 * prefetch a link.
 *
 * *`actorId` is optional and absent means the persona*, which is §3.1's case;
 * naming another member is [06 §8]'s *"more than one member may be `control:
 * 'player'`"* followed through.
 */
export function impersonateAs(sessionId: string, actorId?: string): Promise<{ text: string }> {
  return request(
    'POST',
    `/api/sessions/${encodeURIComponent(sessionId)}/impersonate`,
    actorId === undefined ? {} : { actorId },
  );
}

/**
 * ***Who points at this object*** —
 * [03 §10.1](../../../docs/design/03-data-model.md),
 * [10 §5.2](../../../docs/design/10-ui-surfaces.md), [P11.7].
 *
 * One call for the *Used by* panel and for the delete confirmation's counts,
 * which [P4 §6.6] recorded as one debt: separate answers could disagree about
 * what a reference is.
 */
export interface Usage {
  fromKind: string;
  fromId: string;
  fromName: string;
}

export function readUsedBy(kind: string, id: string): Promise<{ usedBy: Usage[] }> {
  return request('GET', `/api/library/${kind}/${encodeURIComponent(id)}/links`);
}

/**
 * ***What is in your trash*** — [03 §10.2], [P11.7]. Delete has been a move
 * since P4.4 and nothing could look in the drawer until this stage.
 */
export interface TrashEntry {
  id: string;
  kind: string;
  name: string;
  deletedAt: number;
  expiresAt: number | null;
}

export function readTrash(): Promise<{ entries: TrashEntry[]; retentionDays: number }> {
  return request('GET', '/api/me/trash');
}

export function restoreFromTrash(id: string): Promise<{ restored: boolean }> {
  return request('POST', '/api/me/trash/restore', { id });
}

/**
 * ***An archive of your work, or of the whole install*** —
 * [P12.6](../../../docs/design/workplan/29-p12-implementation.md).
 *
 * **Every address is written out whole**, which is a rule about
 * `route-callers.test.ts` rather than about style: that check scans this
 * package for `/api/...` string literals to prove no route is unreachable, and
 * it resolves helper *functions* rather than local constants. A stem factored
 * out of these would read as several orphaned routes.
 *
 * **There is no download function**, deliberately. A download is a plain
 * `<a download>` at the route — a `fetch` would have to rebuild what the
 * browser already does, and the route sends a `content-disposition`. The
 * address still appears in the component, so the scan reaches it.
 */
export interface BackupRecord {
  id: string;
  scope: 'install' | 'account';
  handle: string | null;
  contents: 'full' | 'redacted';
  takenAt: number;
  bytes: number;
}

export interface BackupListing {
  backups: BackupRecord[];
  /** What the stored archives weigh together — the number before the action. */
  totalBytes: number;
}

export interface BackupSettings {
  frequency: 'off' | 'daily' | 'weekly';
  onStart: boolean;
  contents: 'full' | 'redacted';
}

/**
 * ***What an archive says about itself*** —
 * [04 §9.2](../../../docs/design/04-schemas.md),
 * [P12.10](../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***Declared here rather than imported from `shared`***, which is what every
 * other wire shape in this file does and for the same reason: this file is *the
 * client's side of `docs/api.md`*, and a type imported from the server's
 * vocabulary would make a field disappearing from a response a compile error in
 * the wrong package. The fields are the manifest's, minus the ones no surface
 * reads.
 */
export interface BackupManifest {
  scope: 'install' | 'account';
  handle: string | null;
  contents: 'full' | 'redacted';
  takenBy: { version: string | null; at: string };
  reason: 'manual' | 'schedule' | 'start';
  /** Members, excluding the manifest itself. */
  files: number;
  /** Their uncompressed total — the number a restore has to find room for. */
  unpackedBytes: number;
  /** The accounts in it, which is what the import's handle control offers. */
  handles: string[];
  /** What it does not carry, in the shared note vocabulary rather than prose. */
  omitted: ImportItem['notes'];
}

/** Each off by default, and each reported whether taken or not. */
export interface BackupImportOptions {
  connections?: boolean;
  prefs?: boolean;
  /** Install scope and administrator only; refused elsewhere. */
  config?: boolean;
}

export interface BackupImportRequest {
  id: string;
  handle?: string;
  onConflict?: 'skip' | 'replace' | 'keep-both';
  options?: BackupImportOptions;
}

/**
 * What one import did, in four parts because they are four different things.
 *
 * The library half is an `ImportReport` — the same shape, the same review
 * surface and the same ledger as a SillyTavern sweep, which is the whole return
 * on routing a backup through `sweep`. Sessions and tags are counted rather
 * than listed: neither is a library object, and a row per turn file is not a
 * thing anybody reads. `notes` is what the **optional** groups did, including
 * the ones that were not asked for.
 */
export interface BackupImportResult {
  report: ImportReport;
  sessions: { imported: number; skipped: number };
  tags: { added: number; kept: number };
  notes: ImportItem['notes'];
}

export const backupApi = {
  readMine: (): Promise<BackupListing> => request('GET', '/api/me/backups'),
  takeMine: (contents: 'full' | 'redacted'): Promise<{ backup: BackupRecord }> =>
    request('POST', '/api/me/backups', { contents }),
  deleteMine: (id: string): Promise<void> => request('DELETE', `/api/me/backups/${id}`),
  readMineManifest: (id: string): Promise<{ manifest: BackupManifest }> =>
    request('GET', `/api/me/backups/${id}/manifest`),
  importMine: (body: BackupImportRequest): Promise<BackupImportResult> =>
    request('POST', '/api/me/backups/import', body),
  readSettings: (): Promise<{ settings: BackupSettings }> =>
    request('GET', '/api/me/backups/settings'),
  writeSettings: (settings: BackupSettings): Promise<{ settings: BackupSettings }> =>
    request('PUT', '/api/me/backups/settings', settings),

  readInstall: (): Promise<BackupListing> => request('GET', '/api/admin/backups'),
  takeInstall: (contents: 'full' | 'redacted'): Promise<{ backup: BackupRecord }> =>
    request('POST', '/api/admin/backups', { contents }),
  deleteInstall: (id: string): Promise<void> => request('DELETE', `/api/admin/backups/${id}`),
  readInstallManifest: (id: string): Promise<{ manifest: BackupManifest }> =>
    request('GET', `/api/admin/backups/${id}/manifest`),
  importInstall: (body: BackupImportRequest): Promise<BackupImportResult> =>
    request('POST', '/api/admin/backups/import', body),

  /**
   * ***Restore, which is not import*** —
   * [P12.13](../../../docs/design/workplan/29-p12-implementation.md).
   *
   * **No `onSuccess` invalidation anywhere it is used**, for `useRestart`'s
   * reason: the answer is the last thing this process sends. The drain runs
   * behind it, the process exits, and the swap happens on the next boot — so
   * there is no cache here that will still be asked a question.
   */
  restoreInstall: (id: string, acceptRedacted: boolean): Promise<{ draining: boolean }> =>
    request('POST', '/api/admin/restore', { id, acceptRedacted }),
  /** Clears a marker the next boot would act on, or has refused to. */
  cancelRestore: (): Promise<void> => request('DELETE', '/api/admin/restore'),
};

/**
 * ***Write this field for me*** —
 * [10 §11.1](../../../docs/design/10-ui-surfaces.md), [P11.2].
 *
 * One call for every field of every editor, which is §11's *"a primitive the
 * editors are built from"* on the wire. `guidance` absent is **generate**;
 * present is **refine**, and §11.1 says why the difference matters — *"'make it
 * darker' is the whole interaction, and without it the only recourse is
 * regenerate-and-hope"*.
 *
 * `draft` is the **working** object rather than the saved one, deliberately: an
 * assist blind to the three fields somebody just typed is the *generic slop*
 * §11.1 warns the whole feature dies of.
 */
export interface AssistFieldRequest {
  subject: string;
  path: string;
  label: string;
  draft: unknown;
  guidance?: string;
  current?: string;
}

export interface AssistFieldResult {
  text: string;
  model: string;
  seed: string;
}

export function assistField(body: AssistFieldRequest): Promise<AssistFieldResult> {
  return request('POST', '/api/library/assist', body);
}

/**
 * ***A session somebody else exported*** — [18 §3], [P11 §3]'s row 10, [P11.10].
 *
 * The document goes in a body rather than a multipart upload, unlike the
 * library's import: a session export is one JSON document the client already
 * holds as a file, and streaming buys nothing at this size.
 */
export function importSessionDocument(document: unknown): Promise<{
  sessionId: string;
  turns: number;
  renditions: number;
}> {
  return request('POST', '/api/sessions/import', document);
}
