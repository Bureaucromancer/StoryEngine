// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeTestServer, routesUnder, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * System connections and the install defaults, through the API —
 * [05 §15.3](../../../../docs/design/05-ui-surfaces.md),
 * [P2B §3](../../../../docs/design/workplan/14-p2b-provider-configuration.md) stage P2B.2.
 *
 * These are the routes that let an admin act on what P2A's account list tells
 * them, which is [05 §15.4]'s test for whether either panel belongs at all.
 */

let server: TestServer;
let fetched: { url: string; init?: RequestInit }[];
let fetchResult: Response | Error;

beforeEach(async () => {
  fetched = [];
  fetchResult = Response.json({ data: [{ id: 'gpt-hi' }, { id: 'gpt-lo' }] });

  server = await makeTestServer({
    // The one place the server talks to a host somebody typed in. A seam, so a
    // test about *what happens when an endpoint has no /models* is not a test
    // that makes a network request.
    fetch: ((url: string, init?: RequestInit) => {
      fetched.push({ url, ...(init === undefined ? {} : { init }) });
      return fetchResult instanceof Error
        ? Promise.reject(fetchResult)
        : Promise.resolve(fetchResult);
    }) as unknown as typeof globalThis.fetch,
  });
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

const CONNECTION = {
  label: 'The house key',
  provider: 'openai-compatible',
  apiKey: 'sk-must-never-come-back',
  baseUrl: 'https://api.internal.example/v1',
  models: ['gpt-hi', 'gpt-lo'],
};

/**
 * A connection, and the acknowledgement an edit of it has to present.
 *
 * Both, because `PUT` grew a required `contentHash` at [P2B §6]'s settling —
 * *yes, this wants the stale-check idiom* — and a helper that returned only the
 * id would make every edit test spell the extra read itself.
 */
async function created(over: Record<string, unknown> = {}): Promise<{
  id: string;
  contentHash: string;
}> {
  const response = await server.request({
    method: 'POST',
    url: '/api/admin/connections',
    payload: { ...CONNECTION, ...over },
  });
  if (response.status !== 201) {
    throw new Error(`create failed: ${String(response.status)} ${JSON.stringify(response.body)}`);
  }
  return {
    id: response.body.connection.id as string,
    contentHash: response.body.connection.contentHash as string,
  };
}

async function create(over: Record<string, unknown> = {}): Promise<string> {
  return (await created(over)).id;
}

describe('connections', () => {
  it('round-trips without the key ever coming back', async () => {
    const id = await create();

    const listed = await server.request({ method: 'GET', url: '/api/admin/connections' });

    expect(listed.body.connections).toHaveLength(1);
    expect(listed.body.connections[0]).toMatchObject({
      id,
      label: 'The house key',
      scope: 'system',
      baseUrl: 'https://api.internal.example/v1',
      hasKey: true,
    });
    expect(JSON.stringify(listed.body)).not.toContain('sk-must-never-come-back');
  });

  it('refuses a provider this build cannot construct, naming it', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/admin/connections',
      payload: { ...CONNECTION, provider: 'anthropic' },
    });

    // At save rather than at the next turn, which is the worst place to find out.
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('unbuildable');
    expect(response.body.message).toContain('anthropic');
  });

  it('edits a label without being told the key again', async () => {
    const { id, contentHash } = await created();

    const edited = await server.request({
      method: 'PUT',
      url: `/api/admin/connections/${id}`,
      payload: {
        label: 'Renamed',
        provider: 'openai-compatible',
        models: ['gpt-hi'],
        contentHash,
      },
    });

    expect(edited.status).toBe(200);
    expect(edited.body.connection).toMatchObject({ label: 'Renamed', hasKey: true });
    // The hash moves with the file, so the *next* edit presents the new one —
    // which is what stops a form saving twice from its first read.
    expect(edited.body.connection.contentHash).not.toBe(contentHash);
  });

  it('deletes, and says so for an id that is not there', async () => {
    const id = await create();

    expect(
      (await server.request({ method: 'DELETE', url: `/api/admin/connections/${id}` })).status,
    ).toBe(204);
    expect(
      (await server.request({ method: 'GET', url: '/api/admin/connections' })).body.connections,
    ).toEqual([]);

    const missing = await server.request({ method: 'DELETE', url: `/api/admin/connections/${id}` });
    expect(missing.status).toBe(404);
  });

  it('refuses a field it does not know rather than ignoring it', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/admin/connections',
      payload: { ...CONNECTION, organisationId: 'invented' },
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('organisationId');
  });
});

/**
 * **The writer owns the invalidation** — [P2B §2.4], and the gate's step 3.
 *
 * The memo keys on `connection.id` and had no invalidation, because until this
 * phase nothing could change a connection while the server ran. The analogue of
 * what P2A found in `applyLiveConfig`: a cache whose staleness was unreachable
 * while the surface that writes it did not exist.
 */
describe('the provider memo', () => {
  it('is dropped for the connection a write touched', async () => {
    const invalidate = vi.fn();
    server.services.providers.invalidate = invalidate;

    const id = await create();
    expect(invalidate).toHaveBeenCalledWith(id);

    invalidate.mockClear();
    const read = await server.request({ method: 'GET', url: '/api/admin/connections' });
    await server.request({
      method: 'PUT',
      url: `/api/admin/connections/${id}`,
      payload: {
        label: 'Renamed',
        provider: 'openai-compatible',
        models: ['gpt-hi'],
        contentHash: read.body.connections[0].contentHash,
      },
    });
    expect(invalidate).toHaveBeenCalledWith(id);

    invalidate.mockClear();
    await server.request({ method: 'DELETE', url: `/api/admin/connections/${id}` });
    expect(invalidate).toHaveBeenCalledWith(id);
  });
});

describe('the install default bindings', () => {
  it('round-trips, and resolves on the next turn', async () => {
    const id = await create();
    const read = await server.request({ method: 'GET', url: '/api/admin/bindings' });
    expect(read.body.bindings).toEqual({});

    const written = await server.request({
      method: 'PUT',
      url: '/api/admin/bindings',
      payload: {
        bindings: { prose: { connectionId: id, modelId: 'gpt-hi' } },
        contentHash: read.body.contentHash,
      },
    });

    expect(written.status).toBe(200);
    expect(written.body.bindings).toEqual({ prose: { connectionId: id, modelId: 'gpt-hi' } });
    // A fresh hash, so the next save from this page is not immediately stale.
    expect(written.body.contentHash).not.toBe(read.body.contentHash);
  });

  /**
   * **The stale check** — [P2B §6]. A hash rather than config's document
   * comparison, because nothing holds a prior read of this file: every request
   * reads it fresh, so the guard has to be something the client presents.
   *
   * And the writer it defends against is a **text editor**, not a second admin.
   * `bindings.json` is hand-written today and stays hand-writable by design.
   */
  it('refuses a save the file has moved under, offering what is there', async () => {
    const read = await server.request({ method: 'GET', url: '/api/admin/bindings' });
    await mkdir(server.services.layout.systemRoot, { recursive: true });
    await writeFile(
      server.services.layout.systemBindingsFile,
      JSON.stringify({ fast: { connectionId: 'by-hand', modelId: 'edited' } }),
    );

    const response = await server.request({
      method: 'PUT',
      url: '/api/admin/bindings',
      payload: {
        bindings: { prose: { connectionId: 'x', modelId: 'y' } },
        contentHash: read.body.contentHash,
      },
    });

    expect(response.status).toBe(412);
    expect(response.body.error).toBe('stale');
    expect(response.body.current).toEqual({ fast: { connectionId: 'by-hand', modelId: 'edited' } });
  });

  it('takes a second save, having handed back a fresh hash', async () => {
    const read = await server.request({ method: 'GET', url: '/api/admin/bindings' });
    const first = await server.request({
      method: 'PUT',
      url: '/api/admin/bindings',
      payload: { bindings: {}, contentHash: read.body.contentHash },
    });

    const second = await server.request({
      method: 'PUT',
      url: '/api/admin/bindings',
      payload: {
        bindings: { prose: { connectionId: 'a', modelId: 'b' } },
        contentHash: first.body.contentHash,
      },
    });

    expect(second.status).toBe(200);
  });

  it('drops a role it does not know, and a binding of the wrong shape', async () => {
    const read = await server.request({ method: 'GET', url: '/api/admin/bindings' });

    const written = await server.request({
      method: 'PUT',
      url: '/api/admin/bindings',
      payload: {
        bindings: {
          prose: { connectionId: 'a', modelId: 'b' },
          invented: { connectionId: 'c', modelId: 'd' },
          fast: { connectionId: 'e' },
        },
        contentHash: read.body.contentHash,
      },
    });

    // Picked rather than trusted, the same posture the config write takes: a
    // role the caller invents does not reach disk, and neither does a binding
    // missing half of itself, which would resolve as `dangling` forever.
    expect(written.body.bindings).toEqual({ prose: { connectionId: 'a', modelId: 'b' } });
  });
});

/**
 * **How many bindings point at a connection** — [P2B §2.8], gate step 4.
 *
 * Warns and proceeds rather than refusing: an admin revoking a leaked key must
 * not be blocked by the fact that people were using it.
 */
describe('the delete-time binding count', () => {
  it('counts across every account and the install, and names nobody', async () => {
    const id = await create();
    const read = await server.request({ method: 'GET', url: '/api/admin/bindings' });
    await server.request({
      method: 'PUT',
      url: '/api/admin/bindings',
      payload: {
        bindings: { prose: { connectionId: id, modelId: 'gpt-hi' } },
        contentHash: read.body.contentHash,
      },
    });

    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });
    await mkdir(server.services.layout.userRoot('mara'), { recursive: true });
    await writeFile(
      join(server.services.layout.userRoot('mara'), 'bindings.json'),
      JSON.stringify({ fast: { connectionId: id, modelId: 'gpt-lo' } }),
    );

    const counted = await server.request({
      method: 'GET',
      url: `/api/admin/connections/${id}/bindings`,
    });

    // One from the install, one from mara. **Counts, never contents** — a list
    // of who binds what to which key is a different feature with a different
    // justification, and nobody has asked for it.
    expect(counted.body).toEqual({ bindings: 2 });
    expect(JSON.stringify(counted.body)).not.toContain('mara');
  });

  it('is zero for a connection nothing points at', async () => {
    const id = await create();

    expect(
      (await server.request({ method: 'GET', url: `/api/admin/connections/${id}/bindings` })).body,
    ).toEqual({ bindings: 0 });
  });
});

describe('fetching a model list', () => {
  it('asks the endpoint and fills a picker from its answer', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/admin/connections/models',
      payload: { baseUrl: 'https://api.internal.example/v1', apiKey: 'sk-probe' },
    });

    expect(response.body.models).toEqual(['gpt-hi', 'gpt-lo']);
    expect(fetched[0]?.url).toBe('https://api.internal.example/v1/models');
  });

  it('defaults an empty base URL to OpenAI, which the adapter does too', async () => {
    await server.request({ method: 'POST', url: '/api/admin/connections/models', payload: {} });

    // So the common cases are a key with no URL and a URL with no key, and the
    // form can say which is which.
    expect(fetched[0]?.url).toBe('https://api.openai.com/v1/models');
  });

  /**
   * **An assist, not the path** — [05 §6], [P2B §2.6].
   *
   * `/models` is optional in practice, and several local runtimes answer it with
   * one entry called `gpt-3.5-turbo` regardless of what is loaded. A failed
   * fetch is a notice; the field stays free text and the save still works.
   */
  it('answers a class, not the endpoint the fetch was reaching for', async () => {
    fetchResult = new TypeError('connect ECONNREFUSED 10.0.0.5:11434');

    const response = await server.request({
      method: 'POST',
      url: '/api/admin/connections/models',
      payload: { baseUrl: 'http://10.0.0.5:11434/v1' },
    });

    expect(response.status).toBe(502);
    expect(response.body.error).toBe('unreachable');
    // The message can carry the URL, and a URL can carry a token — so a class
    // rather than the fetch own words.
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.5');
  });

  /**
   * **The literal case the gate names**: an endpoint that *does not implement*
   * `/models` answers 404, not a transport failure. That branch had no test —
   * the three above cover ok-with-good-json, ok-with-a-shape-we-do-not-know,
   * and a thrown fetch.
   */
  it('treats a 404 from the endpoint as unreachable rather than as a crash', async () => {
    /**
     * **A JSON body, because that is what makes the status check load-bearing.**
     *
     * A 404 carrying plain text throws in `response.json()` and lands in the
     * same 502 by the other route, so a plain-text fixture cannot tell whether
     * the status was ever looked at — and the first version of this test used
     * one. Endpoints answer errors as JSON all the time; without the `ok` check
     * this parses `{ error: … }`, finds no `data`, and answers **200 with an
     * empty model list**, which reads to an admin as *this endpoint offers
     * nothing* rather than *this endpoint said no*.
     */
    fetchResult = Response.json({ error: { message: 'no such route' } }, { status: 404 });

    const response = await server.request({
      method: 'POST',
      url: '/api/admin/connections/models',
      payload: { baseUrl: 'http://10.0.0.5:11434/v1' },
    });

    expect(response.status).toBe(502);
    expect(response.body.error).toBe('unreachable');
    expect(response.body.models).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.5');
  });

  it('treats a shape it does not recognise as no models offered', async () => {
    fetchResult = Response.json({ models: ['not-where-openai-puts-them'] });

    const response = await server.request({
      method: 'POST',
      url: '/api/admin/connections/models',
      payload: { baseUrl: 'https://api.internal.example/v1' },
    });

    // Not an error: the admin types what they were going to type anyway.
    expect(response.status).toBe(200);
    expect(response.body.models).toEqual([]);
  });
});

/**
 * A `POST /bindings/defaults` that will land, given a connection id.
 *
 * Reads the current hash rather than taking one, because this is used inside
 * the opacity sweep where the point is a **successful** response and a 412
 * would prove nothing about what a body carries.
 */
async function defaultsWrite(connectionId: string): ReturnType<TestServer['request']> {
  const state = await server.request({ method: 'GET', url: '/api/admin/bindings' });
  return server.request({
    method: 'POST',
    url: '/api/admin/bindings/defaults',
    payload: {
      hi: { connectionId, modelId: 'gpt-hi' },
      lo: { connectionId, modelId: 'gpt-lo' },
      contentHash: state.body.contentHash as string,
    },
  });
}

/**
 * **The stale check on a connection** — [P2B §6] settled this as *yes*, and the
 * reason moved while it did: not a second admin, who is rare at this scale, but
 * **the person with the file open in a text editor**. A connections directory
 * is hand-editable by design ([P2B §2.3]).
 */
describe('editing a connection somebody else has changed', () => {
  it('refuses, and hands back what is on disk so the form can offer both ways out', async () => {
    const { id, contentHash } = await created();

    // Somebody edits the file. The form still holds the hash it read.
    const listed = await server.request({ method: 'GET', url: '/api/admin/connections' });
    await server.request({
      method: 'PUT',
      url: `/api/admin/connections/${id}`,
      payload: {
        label: 'Changed on disk',
        provider: 'openai-compatible',
        models: ['gpt-hi'],
        contentHash: listed.body.connections[0].contentHash as string,
      },
    });

    const stale = await server.request({
      method: 'PUT',
      url: `/api/admin/connections/${id}`,
      payload: {
        label: 'Changed in the form',
        provider: 'openai-compatible',
        models: ['gpt-hi'],
        contentHash,
      },
    });

    expect(stale.status).toBe(412);
    expect(stale.body.error).toBe('stale');
    // Carrying the current object *and* its hash is what makes *load what is on
    // disk* and *overwrite with mine* both reachable, rather than the form
    // being told no and having nowhere to go — the wedge P2A's gate found.
    expect(stale.body.current).toMatchObject({ label: 'Changed on disk' });
    expect(stale.body.contentHash).toBe(stale.body.current.contentHash);

    // And presenting what the refusal handed back gets through.
    const retried = await server.request({
      method: 'PUT',
      url: `/api/admin/connections/${id}`,
      payload: {
        label: 'Changed in the form',
        provider: 'openai-compatible',
        models: ['gpt-hi'],
        contentHash: stale.body.contentHash as string,
      },
    });
    expect(retried.status).toBe(200);
  });

  it('says not-found rather than stale for an id nothing claims', async () => {
    const response = await server.request({
      method: 'PUT',
      url: '/api/admin/connections/never-existed',
      payload: {
        label: 'Whatever',
        provider: 'openai-compatible',
        models: ['gpt-hi'],
        contentHash: 'sha256:invented',
      },
    });

    // Two different facts. A 412 here would send a form looking for an object
    // to reload that is not there.
    expect(response.status).toBe(404);
  });
});

/**
 * **Two files, one id** — [P2B §4] step 10, and
 * [P1 §1.2](../../../../docs/design/workplan/03-p1-implementation.md)'s posture: both are listed,
 * the one that loses says so, and nothing is blocked.
 */
describe('a duplicated id', () => {
  async function seedDuplicate(id: string, label: string, filename: string): Promise<void> {
    const root = server.services.layout.systemConnectionsRoot;
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, filename),
      JSON.stringify({
        id,
        label,
        provider: 'openai-compatible',
        models: ['gpt-hi'],
        apiKey: 'sk-must-never-come-back',
      }),
    );
  }

  it('lists both, and flags the one nothing will ever resolve to', async () => {
    const id = await create({ label: 'A first by label' });
    await seedDuplicate(id, 'Z last by label', 'shadow.json');

    const listed = await server.request({ method: 'GET', url: '/api/admin/connections' });

    expect(listed.body.connections).toHaveLength(2);
    // The order is the resolver's — `readEntriesIn` sorts by label and
    // `resolveRole` takes the first match — so the flag is true rather than
    // merely plausible.
    expect(
      (listed.body.connections as { label: string; shadowed: boolean }[]).map((row) => [
        row.label,
        row.shadowed,
      ]),
    ).toEqual([
      ['A first by label', false],
      ['Z last by label', true],
    ]);
  });

  /**
   * **The delete has to reach both**, and this is the one that was wrong.
   *
   * `findConnectionFile` returned the *first* file claiming an id, so a delete
   * answered `204` while the connection went on resolving from the second.
   * [P2B §2.8] names the case: *an admin revoking a leaked key*. Being told
   * **gone** while it still works is the worst answer available there.
   */
  it('is gone after one delete, not half gone', async () => {
    const id = await create({ label: 'A first by label' });
    await seedDuplicate(id, 'Z last by label', 'shadow.json');

    const removed = await server.request({
      method: 'DELETE',
      url: `/api/admin/connections/${id}`,
    });

    expect(removed.status).toBe(204);
    expect(
      (await server.request({ method: 'GET', url: '/api/admin/connections' })).body.connections,
    ).toEqual([]);
  });

  /**
   * **And an edit writes back to the file it came from.**
   *
   * The write used to derive its path from the id unconditionally, so editing a
   * hand-named `house.json` created a *second* file at `<id>.json` — and read
   * `existing` from that same absent path, so the stored key went with it.
   * Renaming a connection deleted its credential and manufactured this whole
   * describe block's situation, in one save.
   */
  it('is not created by editing a hand-named file', async () => {
    await seedDuplicate('house-openai', 'The house key', 'house.json');
    const listed = await server.request({ method: 'GET', url: '/api/admin/connections' });

    const edited = await server.request({
      method: 'PUT',
      url: '/api/admin/connections/house-openai',
      payload: {
        label: 'Renamed',
        provider: 'openai-compatible',
        models: ['gpt-hi'],
        contentHash: listed.body.connections[0].contentHash as string,
      },
    });

    expect(edited.status).toBe(200);
    const after = await server.request({ method: 'GET', url: '/api/admin/connections' });
    expect(after.body.connections).toHaveLength(1);
    expect(after.body.connections[0]).toMatchObject({
      label: 'Renamed',
      shadowed: false,
      // The key survived, which it did not before: `existing` was read from the
      // derived path, found nothing, and wrote a keyless file.
      hasKey: true,
    });
  });
});

/**
 * **The role table's route** — [P2B §3] stage P2B.3, and the thing that was
 * missing when the gate was walked: `via` is a local in `resolveRole`, absent
 * from the turn record by design ([13 §1.4]), and returned by nothing. A table
 * showing it would have had to reimplement [07 §5.1] in the browser.
 */
describe('what every role will do', () => {
  it('answers unbound for all eight on a fresh install, and marks the three unset by design', async () => {
    const response = await server.request({ method: 'GET', url: '/api/admin/roles' });

    const rows = response.body.roles as { role: string; tier: string; ok: boolean }[];
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => !row.ok)).toBe(true);
    // The distinction the table needs and the resolution cannot supply:
    // `image` unbound is policy working, `prose` unbound is an install nobody
    // can play on. Same resolution, opposite meanings.
    expect(
      rows
        .filter((row) => row.tier === 'unset')
        .map((row) => row.role)
        .sort(),
    ).toEqual(['image', 'speech', 'video']);
  });

  it('names the connection, the model and the layer that won', async () => {
    const id = await create({ label: 'The house key' });
    await defaultsWrite(id);

    const response = await server.request({ method: 'GET', url: '/api/admin/roles' });
    const rows = response.body.roles as Record<string, unknown>[];

    expect(rows.find((row) => row['role'] === 'prose')).toMatchObject({
      ok: true,
      via: 'default',
      connectionId: id,
      connectionLabel: 'The house key',
      modelId: 'gpt-hi',
    });
    // Five resolve and three stay unset, which is [P2B §4] step 6's arithmetic
    // — and the reason that step said *seven* and was wrong.
    expect(rows.filter((row) => row['ok'] === true)).toHaveLength(5);
  });

  it('tells a dangling default apart from an unbound role', async () => {
    const id = await create();
    await defaultsWrite(id);
    await server.request({ method: 'DELETE', url: `/api/admin/connections/${id}` });

    const response = await server.request({ method: 'GET', url: '/api/admin/roles' });
    const rows = response.body.roles as Record<string, unknown>[];

    // The remedies differ — dangling is an admin having removed a connection
    // out from under a binding — so the answers do ([00 §3.3]).
    expect(rows.find((row) => row['role'] === 'prose')).toMatchObject({
      ok: false,
      reason: 'dangling',
      connectionId: id,
    });
    expect(rows.find((row) => row['role'] === 'image')).toMatchObject({
      ok: false,
      reason: 'unbound',
    });
  });
});

/**
 * **The first run's two answers** — [P2B §3] stage P2B.4, and
 * `defaultBindings`'s first production caller.
 */
describe('spreading two models across the roles', () => {
  it('writes the five with a text fallback and leaves the other three alone', async () => {
    const id = await create();

    const written = await defaultsWrite(id);

    expect(written.status).toBe(200);
    expect(Object.keys(written.body.bindings as object).sort()).toEqual([
      'embedding',
      'fast',
      'prose',
      'reasoning',
      'vision',
    ]);
    // The policy, asserted rather than the count: the expensive model writes.
    expect(written.body.bindings.prose).toEqual({ connectionId: id, modelId: 'gpt-hi' });
    expect(written.body.bindings.fast).toEqual({ connectionId: id, modelId: 'gpt-lo' });
  });

  it('refuses when the file moved under it, the same way the whole-document write does', async () => {
    const id = await create();
    await defaultsWrite(id);

    const stale = await server.request({
      method: 'POST',
      url: '/api/admin/bindings/defaults',
      payload: {
        hi: { connectionId: id, modelId: 'gpt-hi' },
        lo: { connectionId: id, modelId: 'gpt-lo' },
        contentHash: 'sha256:what-the-page-read-before',
      },
    });

    expect(stale.status).toBe(412);
    expect(stale.body.error).toBe('stale');
  });
});

/**
 * **The opacity test** — this phase's CI contribution, and
 * [P2B §2.2](../../../../docs/design/workplan/14-p2b-provider-configuration.md)'s boundary
 * asserted rather than the discipline that maintains it.
 *
 * **Coverage is enumerated; bodies are not.** The guard sweep in
 * `admin.test.ts` asserts a status code, so it can hit every route with a
 * nonsense parameter and expect 403. Opacity is a claim about a *successful*
 * response, and a route answering 400 contains no key trivially — so the route
 * table says *what to cover*, and each entry still needs a body that works.
 * [P2B §6.1] is where that correction came from: the plan first claimed the
 * whole test could be shaped like the sweep.
 *
 * The list below is therefore checked *against* the route table, so a route
 * added without a case here fails rather than quietly widening the gap.
 */
describe('opacity', () => {
  it('covers every route under the connections surface', () => {
    const surface = routesUnder(server.app, '/api/admin/connections')
      .concat(routesUnder(server.app, '/api/admin/bindings'))
      .concat(routesUnder(server.app, '/api/admin/roles'))
      .map((route) => `${route.method} ${route.url}`);

    expect(surface.sort()).toEqual(
      [
        'GET /api/admin/bindings',
        'PUT /api/admin/bindings',
        'POST /api/admin/bindings/defaults',
        'GET /api/admin/connections',
        'POST /api/admin/connections',
        'POST /api/admin/connections/models',
        'GET /api/admin/connections/:id/bindings',
        'PUT /api/admin/connections/:id',
        'DELETE /api/admin/connections/:id',
        'GET /api/admin/roles',
      ].sort(),
    );
  });
});

describe('a key', () => {
  it('never comes back from any of them, on success or on refusal', async () => {
    const { id, contentHash: hash } = await created();
    const read = await server.request({ method: 'GET', url: '/api/admin/bindings' });

    const responses = [
      await server.request({ method: 'GET', url: '/api/admin/connections' }),
      await server.request({ method: 'POST', url: '/api/admin/connections', payload: CONNECTION }),
      await server.request({
        method: 'PUT',
        url: `/api/admin/connections/${id}`,
        payload: { ...CONNECTION, label: 'Edited', contentHash: hash },
      }),
      await server.request({ method: 'GET', url: `/api/admin/connections/${id}/bindings` }),
      await server.request({
        method: 'POST',
        url: '/api/admin/connections/models',
        payload: { baseUrl: 'https://api.internal.example/v1', apiKey: 'sk-must-never-come-back' },
      }),
      await server.request({ method: 'GET', url: '/api/admin/bindings' }),
      await server.request({
        method: 'PUT',
        url: '/api/admin/bindings',
        payload: {
          bindings: { prose: { connectionId: id, modelId: 'gpt-hi' } },
          contentHash: read.body.contentHash,
        },
      }),
      // The role table, which carries a connection's *label* by design and must
      // still carry nothing else of it.
      await server.request({ method: 'GET', url: '/api/admin/roles' }),
      // Refusals too: an error body is a response like any other, and the one
      // most likely to echo back what it was handed.
      await server.request({ method: 'DELETE', url: '/api/admin/connections/not-there' }),
      await server.request({
        method: 'POST',
        url: '/api/admin/connections',
        payload: { ...CONNECTION, provider: 'anthropic' },
      }),
      await defaultsWrite(id),
      // **And a delete that succeeds**, last so the id it removes is not needed
      // above. Without it DELETE appeared here only as a 404, which is a
      // refusal — the exact thing [P2B §6.1] says proves nothing about what a
      // response body carries.
      await server.request({ method: 'DELETE', url: `/api/admin/connections/${id}` }),
    ];

    for (const response of responses) {
      expect(JSON.stringify(response.body ?? null)).not.toContain('sk-must-never-come-back');
    }
    // **And ten of them succeeded**, which is every route on the surface.
    // Without this the loop is a sweep of refusals, which contain no key for
    // the least interesting reason there is.
    expect(responses.filter((response) => response.status < 400)).toHaveLength(10);
  });

  /**
   * **`baseUrl` is admin-visible and user-invisible** — [04 §4.5]'s *"an admin
   * may opt to show it"* read as narrowly as it goes.
   *
   * The strongest form of that claim is structural: there is no non-admin
   * connections route at all, so the only surface carrying a URL is behind the
   * prefix guard. This walks the table to say so, which also means a route added
   * outside the guard would fail here.
   */
  it('is not reachable at all by a non-admin', async () => {
    await create();
    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'mara', password: 'another long password' },
    });

    for (const route of routesUnder(server.app, '/api/admin')) {
      const response = await server.request({
        method: route.method,
        url: route.url.replace(':id', 'anything').replace(':handle', 'ned'),
      });
      expect(response.status, `${route.method} ${route.url}`).toBe(403);
      expect(JSON.stringify(response.body ?? null)).not.toContain('api.internal.example');
    }
  });
});
