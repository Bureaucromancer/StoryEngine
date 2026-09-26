// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  api,
  ApiError,
  cookieValue,
  createSession,
  isLibraryKind,
  kindOfSchema,
  LIBRARY_KINDS,
  renameSession,
  setSessionLore,
} from './api.js';
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

/**
 * What a session is told to retrieve from, on the wire — [P6B.0].
 *
 * **The component tests cannot see this.** They mock these two functions and
 * assert what the page *passes*, which proves the form collects a selection and
 * proves nothing about the body: a `createSession` that quietly sent `{ name }`
 * would leave both pages green and every session empty again, which is the
 * shape of the defect this stage exists to fix. So the body is asserted here,
 * where the request is real and only `fetch` is not.
 *
 * `document` is stubbed because `request` reads a CSRF cookie on every
 * state-changing method and this project has no DOM — which is why the block
 * above uses a GET path and this one cannot.
 */
describe('the session write bodies', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function capture(): { url: string; body: unknown }[] {
    const seen: { url: string; body: unknown }[] = [];
    vi.stubGlobal('document', { cookie: '' });
    // Typed as what `request` actually sends rather than as `RequestInit`,
    // whose `body` is a union wide enough that stringifying it is a lint error
    // — and the stub knows better: every state-changing call here is JSON.
    vi.stubGlobal('fetch', (url: string, init: { body?: string | null }) => {
      seen.push({ url, body: JSON.parse(init.body ?? 'null') as unknown });
      return Promise.resolve(
        new Response(JSON.stringify({ session: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    return seen;
  }

  it('sends the name alone when nothing else was chosen', async () => {
    const seen = capture();

    await createSession({ name: 'A wet week' });

    // Absent rather than null or empty: the route's optional fields mean
    // *unset*, and a session that has decided to retrieve nothing is a
    // different claim from one that was never asked.
    expect(seen[0]?.body).toEqual({ name: 'A wet week' });
  });

  /**
   * A session need not be named — [03 §8].
   *
   * Absent and blank mean the same thing, so only one spelling reaches the
   * wire. The route would store `''` for either; this is about not putting an
   * empty string on the wire as though somebody had chosen it.
   */
  it('sends no name at all when there is none', async () => {
    const seen = capture();

    await createSession({});
    await createSession({ name: '' });
    await createSession({ name: '   ' });

    expect(seen.map((each) => each.body)).toEqual([{}, {}, {}]);
  });

  /**
   * **The persona reaches the route as a `cast`, and the route requires both
   * members** — [P7 §0.2] item 5.
   *
   * The component test asserts what the page passes to `createSession`; this is
   * the one that would catch a `persona` field going to the wire under its own
   * name, which the route does not accept and which would fail validation on a
   * real server while both pages stayed green.
   */
  it('wraps a chosen persona in a cast, with the empty actors the route demands', async () => {
    const seen = capture();

    await createSession({ persona: 'actor-vera' });

    expect(seen[0]?.body).toEqual({ cast: { persona: 'actor-vera', actors: [] } });
  });

  it('sends no cast when no persona was chosen', async () => {
    // Same rule as every other optional field here: absent means unset, and
    // `{persona: null, actors: []}` would be a session asserting an empty cast
    // rather than one that was never asked.
    const seen = capture();

    await createSession({});
    await createSession({ persona: '' });

    expect(seen.map((each) => each.body)).toEqual([{}, {}]);
  });

  /**
   * ***A Setup, and which opening*** — [P13.4]. `null` is *start cold* and
   * has to reach the route as itself; absent is *the primary*, so the two may
   * not collapse into one spelling on the wire.
   */
  it('sends the Setup it starts from, and an opening only when one was chosen', async () => {
    const seen = capture();

    await createSession({ setup: 'setup-1' });
    await createSession({ setup: 'setup-1', opening: 'o-docks' });
    await createSession({ setup: 'setup-1', opening: null });
    await createSession({ setup: '' });

    expect(seen.map((each) => each.body)).toEqual([
      { setup: 'setup-1' },
      { setup: 'setup-1', opening: 'o-docks' },
      { setup: 'setup-1', opening: null },
      {},
    ]);
  });

  it('renames a session through the patch that archives, with the id escaped', async () => {
    const seen = capture();

    await renameSession('a b', 'Rain City, after the fire');

    expect(seen[0]?.url).toBe('/api/sessions/a%20b');
    expect(seen[0]?.body).toEqual({ name: 'Rain City, after the fire' });
  });

  /**
   * Clearing a name is a legitimate edit — it puts a session back in the state
   * it may have started in — so unlike `createSession` this one does send the
   * empty string. The difference is that here it is an instruction rather than
   * the absence of one.
   */
  it('sends an empty name when a rename is a clearing', async () => {
    const seen = capture();

    await renameSession('s-1', '');

    expect(seen[0]?.body).toEqual({ name: '' });
  });

  it('carries the treatment, the books and the preset when they were chosen', async () => {
    const seen = capture();

    await createSession({
      name: 'A wet week',
      treatment: 'treat-wet',
      lore: ['book-rain'],
      preset: 'preset-noir',
    });

    expect(seen[0]?.body).toEqual({
      name: 'A wet week',
      treatment: 'treat-wet',
      lore: ['book-rain'],
      preset: 'preset-noir',
    });
  });

  it('reads an empty book list as a choice nobody made', async () => {
    const seen = capture();

    await createSession({ name: 'A wet week', lore: [] });

    expect(seen[0]?.body).toEqual({ name: 'A wet week' });
  });

  it('replaces both fields on the lore route, and encodes the id', async () => {
    const seen = capture();

    await setSessionLore('a b', { treatment: null, lore: ['book-rain'] });

    expect(seen[0]?.url).toBe('/api/sessions/a%20b/lore');
    // Both, always: the route replaces rather than merges, so a caller that
    // sent one field would silently clear the other.
    expect(seen[0]?.body).toEqual({ treatment: null, lore: ['book-rain'] });
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
      'setups',
      'treatments',
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
