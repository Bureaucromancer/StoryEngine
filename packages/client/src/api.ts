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
 * CSRF is double-submit ([04 §4.1](docs/design/04-server-multiuser-deployment.md)):
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

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
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
    throw new ApiError(response.status, code, message);
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

export const api = {
  authState: (): Promise<AuthState> => request('GET', '/api/auth/state'),

  setup: (input: SetupInput): Promise<{ account: Account }> =>
    request('POST', '/api/auth/setup', input),

  login: (input: Credentials): Promise<{ account: Account }> =>
    request('POST', '/api/auth/login', input),

  logout: (): Promise<undefined> => request('POST', '/api/auth/logout'),

  listLibrary: (kind?: LibraryKind): Promise<{ objects: LibraryObject[] }> =>
    request('GET', kind === undefined ? '/api/library' : `/api/library/${kind}`),

  readObject: (kind: LibraryKind, id: string): Promise<LibraryObject> =>
    request('GET', `/api/library/${kind}/${encodeURIComponent(id)}`),
};
