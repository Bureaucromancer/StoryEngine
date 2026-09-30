// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  adminApi,
  api,
  ApiError,
  cookieValue,
  createSession,
  isLibraryKind,
  kindOfSchema,
  LIBRARY_KINDS,
  listSessions,
  removeSessionHook,
  renameSession,
  setSessionLore,
  uploadFailure,
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

  /**
   * ***The remedy a provider failure comes with*** (2026-09-27). A draft the
   * endpoint refused answers with the remedy a failed turn gets, and the play
   * surface words it; lifted here so no caller reads the body for it.
   */
  it('carries `remedy`, and leaves it unset when the route sent none', async () => {
    answer(
      502,
      JSON.stringify({ error: 'provider-failed', message: 'no', remedy: 'endpoint-refused' }),
    );
    const refused = await api.readObject('actors', 'a1').catch((error: unknown) => error);
    expect((refused as ApiError).remedy).toBe('endpoint-refused');

    answer(500, JSON.stringify({ error: 'internal', message: 'no' }));
    const plain = await api.readObject('actors', 'a1').catch((error: unknown) => error);
    expect((plain as ApiError).remedy).toBeUndefined();
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

  /**
   * ***A cast given whole goes on the wire whole*** (2026-09-27). The assistant
   * panel passes the shipped card as its session's one actor, and the field
   * was declared on the input and read by nothing — every assistant session was
   * made with nobody in it.
   */
  it('sends a cast given whole, actors and all', async () => {
    const seen = capture();

    await createSession({
      mode: 'storyengine.assistant',
      cast: { persona: null, actors: ['the-card'] },
    });

    expect(seen[0]?.body).toEqual({
      mode: 'storyengine.assistant',
      cast: { persona: null, actors: ['the-card'] },
    });
  });
});

/**
 * ***An id is escaped wherever it is a path segment*** (2026-09-27). The admin
 * connection calls put it in raw, where their personal twins encoded it; an id
 * is whatever a hand-written file says, and `lab/gpu` reached a different
 * route. The three import and asset calls beside them had the same omission.
 */
describe('ids in addresses', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function urls(): string[] {
    const seen: string[] = [];
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', (url: string) => {
      seen.push(url);
      return Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    });
    return seen;
  }

  it('escapes a system connection id in every call that names one', async () => {
    const seen = urls();

    await adminApi.updateConnection('lab/gpu', {
      label: 'GPU',
      provider: 'openai-compatible',
      models: [],
      contentHash: 'sha256:x',
    });
    await adminApi.deleteConnection('../escape');
    await adminApi.connectionBindings('house#2');

    expect(seen).toEqual([
      '/api/admin/connections/lab%2Fgpu',
      '/api/admin/connections/..%2Fescape',
      '/api/admin/connections/house%232/bindings',
    ]);
  });

  /**
   * ***A hook row is removed by its source*** (2026-09-28): the kind as it is
   * and the carrier's id escaped, nothing for the session's own, and the bare
   * address when no row is named — which still means every row under the id.
   */
  it('names the pooled row a hook removal means, escaped', async () => {
    const seen = urls();

    await removeSessionHook('s1', 'hook-war');
    await removeSessionHook('s1', 'hook-war', { kind: 'session' });
    await removeSessionHook('s1', 'hook-war', { kind: 'lore', id: 'book/rain' });

    expect(seen).toEqual([
      '/api/sessions/s1/hooks/hook-war',
      '/api/sessions/s1/hooks/hook-war?from=session',
      '/api/sessions/s1/hooks/hook-war?from=lore&fromId=book%2Frain',
    ]);
  });

  it('escapes the ids in the import and picture calls', async () => {
    const seen = urls();

    await api.importJob('a/b');
    await api.objectImportNotes('c#d');
    await api.uploadAsset('lorebooks', 'e?f', new Blob(['x']), 'x.png');

    expect(seen).toEqual([
      '/api/import/jobs/a%2Fb',
      '/api/import/objects/c%23d/notes',
      '/api/library/lorebooks/e%3Ff/assets',
    ]);
  });
});

/**
 * ***The archived sessions, asked for*** (2026-09-27). The route has answered
 * `?archived=true` since sessions could be archived, and no call sent it — so
 * an archived session could not be listed, and a memory from one read as
 * deleted. The live list stays the bare address, which is the key every
 * existing caller's cache is under.
 */
describe('the session list', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for the archived ones only when told to', async () => {
    const seen: string[] = [];
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', (url: string) => {
      seen.push(url);
      return Promise.resolve(
        new Response('{"sessions":[]}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    await listSessions();
    await listSessions({ archived: false });
    await listSessions({ archived: true });

    expect(seen).toEqual(['/api/sessions', '/api/sessions', '/api/sessions?archived=true']);
  });
});

/**
 * ***What a folder upload carries besides its files*** (2026-09-28): the
 * picked folder's name, which the recorded import is listed under, and the
 * plan's `overLimit`, which the review names. The panel's own tests stop at
 * this call, so the form it builds is checked here.
 */
describe('a folder upload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the folder’s name and what the limit left out', async () => {
    let sent: FormData | undefined;
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', (_url: string, init: { body?: unknown }) => {
      sent = init.body as FormData;
      return Promise.resolve(
        new Response('{"report":{}}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    await api.importDirectory(
      ['a.json', 'big.png'],
      [],
      undefined,
      undefined,
      undefined,
      ['big.png'],
      'default-user',
    );

    expect(sent?.get('folder')).toBe('default-user');
    expect(sent?.get('overLimit')).toBe(JSON.stringify(['big.png']));
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
    // A server's string, never read through the prototype (2026-09-27): this
    // was the `Object` constructor rather than nothing.
    expect(kindOfSchema('constructor')).toBeNull();
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

/**
 * ***A failed upload, said*** — [P13.8](../../../docs/design/workplan/30-p13-aventuras-import.md).
 * The two failures a large upload usually meets carry no word from
 * StoryEngine, and each gets a sentence; one that does carry ours keeps it.
 */
describe('an upload that failed', () => {
  it('keeps the server’s own code and message when it sent them', () => {
    const failure = uploadFailure(413, {
      error: 'too-large',
      message: 'That file is larger than the 1024 MB import upload limit.',
    });
    expect(failure.code).toBe('too-large');
    expect(failure.message).toContain('1024 MB');
  });

  it('says a dropped connection may have been a refusal, not a broken file', () => {
    const failure = uploadFailure(0, null);
    expect(failure.code).toBe('connection-lost');
    expect(failure.message).toMatch(/connection was lost/);
    expect(failure.message).toMatch(/proxy/);
  });

  it('says a 413 with no word of ours in it came from something in front of the server', () => {
    const failure = uploadFailure(413, null);
    expect(failure.status).toBe(413);
    expect(failure.code).toBe('proxy-too-large');
    expect(failure.message).toMatch(/reverse proxy/);
  });

  it('falls back to the status for anything else', () => {
    expect(uploadFailure(502, null).message).toBe('The server answered with status 502.');
  });
});
