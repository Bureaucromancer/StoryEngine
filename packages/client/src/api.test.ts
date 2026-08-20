// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError, cookieValue, isLibraryKind, kindOfSchema, LIBRARY_KINDS } from './api.js';
import { formatTimestamp, timestampsOf } from './format.js';

describe('the 412 parse', () => {
  // Through a stubbed fetch on a GET path — request() reads document.cookie
  // for state-changing methods, and this environment has no document.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answer(status: number, body: string): void {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(body, { status, headers: { 'content-type': 'text/plain' } })),
    );
  }

  it('carries `current` when the body is a stale rejection', async () => {
    const current = { id: 'a1', object: { name: 'Vera' }, contentHash: 'sha256:ff' };
    answer(412, JSON.stringify({ error: 'stale', message: 'moved on', current }));

    const failure = await api.readObject('actors', 'a1').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(412);
    expect((failure as ApiError).code).toBe('stale');
    expect((failure as ApiError).current).toEqual(current);
  });

  it('leaves `current` unset when the server sent null — the dialog must not open on it', async () => {
    // The server legitimately sends `current: null` when it cannot present
    // the object. The editor's dialog requires `current`; this is the branch
    // that decides whether the failure surfaces in the banner instead.
    answer(412, JSON.stringify({ error: 'stale', message: 'moved on', current: null }));

    const failure = await api.readObject('actors', 'a1').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).current).toBeUndefined();
  });

  /**
   * **And the acknowledgement** — [P2A §4] step 15.
   *
   * Lifted beside `current` for the same reason: a caller digging it out of an
   * untyped body is a caller that can read the wrong key, which is exactly the
   * bug the config form shipped with. The settings tests construct `ApiError`
   * directly, so this is the only place the *lifting* is exercised.
   */
  it('carries `contentHash`, so the form can say it has seen the file', async () => {
    answer(412, JSON.stringify({ error: 'stale', message: 'moved on', contentHash: 'sha256:aa' }));

    const failure = await api.readObject('actors', 'a1').catch((error: unknown) => error);
    expect((failure as ApiError).contentHash).toBe('sha256:aa');
  });

  it('leaves `contentHash` unset when the route does not offer one', async () => {
    answer(412, JSON.stringify({ error: 'stale', message: 'moved on', current: null }));

    // The library's 412 has no acknowledgement — it uses the object's own hash
    // — so absent has to stay absent rather than becoming an empty string a
    // caller would then present as if it meant something.
    const failure = await api.readObject('actors', 'a1').catch((error: unknown) => error);
    expect((failure as ApiError).contentHash).toBeUndefined();
  });

  it('survives a body that is not JSON at all', async () => {
    answer(412, 'a proxy wrote this');

    const failure = await api.readObject('actors', 'a1').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe('unknown');
    expect((failure as ApiError).current).toBeUndefined();
    expect((failure as ApiError).message.length).toBeGreaterThan(0);
  });
});

describe('cookieValue', () => {
  it('finds a cookie among several', () => {
    expect(cookieValue('se_session=abc; se_csrf=deadbeef; other=1', 'se_csrf')).toBe('deadbeef');
  });

  it('does not match a cookie whose name merely ends the same way', () => {
    expect(cookieValue('xse_csrf=wrong; se_csrf=right', 'se_csrf')).toBe('right');
  });

  it('decodes a percent-encoded value', () => {
    expect(cookieValue('token=a%3Db', 'token')).toBe('a=b');
  });

  it('returns null when absent', () => {
    expect(cookieValue('se_session=abc', 'se_csrf')).toBeNull();
    expect(cookieValue('', 'se_csrf')).toBeNull();
  });
});

describe('library kinds', () => {
  it('carries all six kinds, from the shared registry', () => {
    expect([...LIBRARY_KINDS].sort()).toEqual([
      'actors',
      'lorebooks',
      'packages',
      'presets',
      'settings',
      'setups',
    ]);
  });

  it('guards URL input', () => {
    expect(isLibraryKind('actors')).toBe(true);
    expect(isLibraryKind('turns')).toBe(false);
    expect(isLibraryKind(undefined)).toBe(false);
  });

  it('maps a schema id to its folder', () => {
    expect(kindOfSchema('storyengine.actor/1')).toBe('actors');
    expect(kindOfSchema('storyengine.mystery/9')).toBeNull();
  });
});

describe('timestampsOf', () => {
  it('reads provenance timestamps when present', () => {
    const stamps = timestampsOf({
      provenance: { createdAt: '2026-08-01T12:00:00Z', updatedAt: '2026-08-02T12:00:00Z' },
    });
    expect(stamps).toEqual({
      createdAt: '2026-08-01T12:00:00Z',
      updatedAt: '2026-08-02T12:00:00Z',
    });
  });

  it('is null-safe for objects with no provenance', () => {
    expect(timestampsOf({})).toEqual({ createdAt: null, updatedAt: null });
    expect(timestampsOf({ provenance: null })).toEqual({ createdAt: null, updatedAt: null });
    expect(timestampsOf({ provenance: 'not-an-object' })).toEqual({
      createdAt: null,
      updatedAt: null,
    });
  });
});

describe('formatTimestamp', () => {
  it('formats through Intl for a fixed locale', () => {
    expect(formatTimestamp('2026-08-01T12:00:00Z', 'en-GB')).toContain('2026');
  });

  it('returns an unparsable value unchanged rather than hiding it', () => {
    expect(formatTimestamp('yesterday', 'en-GB')).toBe('yesterday');
  });
});
