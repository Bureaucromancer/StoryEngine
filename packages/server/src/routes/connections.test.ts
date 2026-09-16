// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeTestServer, routesUnder, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * System connections and the install defaults, through the API —
 * [10 §15.3](../../../../docs/design/10-ui-surfaces.md),
 * [P2B §3](../../../../docs/design/workplan/10-p2b-provider-configuration.md) stage P2B.2.
 *
 * These are the routes that let an admin act on what P2A's account list tells
 * them, which is [10 §15.4]'s test for whether either panel belongs at all.
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

    /**
     * **And the hash of what is there now**, which `docs/api.md` states as a
     * property of every 412 here: *a 412 always carries a hash different from
     * the one you sent*. Without it a form has nothing to present on *overwrite
     * with mine* and can only re-send the hash it was just refused for, which is
     * a wedge rather than a refusal — the shape P2A's gate found in the config
     * form and fixed there.
     *
     * Asserted as *usable* rather than merely *present*: the retry below sends
     * it back and has to succeed, which is the property the client depends on
     * and the one a hash of the wrong bytes would fail.
     */
    expect(response.body.contentHash).toBeTypeOf('string');
    expect(response.body.contentHash).not.toBe(read.body.contentHash);

    const retry = await server.request({
      method: 'PUT',
      url: '/api/admin/bindings',
      payload: {
        bindings: { prose: { connectionId: 'x', modelId: 'y' } },
        contentHash: response.body.contentHash,
      },
    });
    expect(retry.status).toBe(200);
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
   * **An assist, not the path** — [10 §6], [P2B §2.6].
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

  /**
   * **A refused key is not an unreachable endpoint** — finding 5 in
   * [P2C log](../../../../docs/design/workplan/14-p2c-log.md). A 401 and a dead
   * socket both answered `502 unreachable`, and the remedies point in opposite
   * directions: *unreachable* sends an admin to the URL and the network, and
   * the key field is the one thing that answer cannot name. Adding a
   * connection is a stranger's third step, so this was the first wrong turn
   * the app offered.
   */
  it('says a refused key was refused, not that the endpoint is gone', async () => {
    fetchResult = Response.json(
      { error: { message: 'Incorrect API key provided: sk-nope' } },
      { status: 401 },
    );

    const response = await server.request({
      method: 'POST',
      url: '/api/admin/connections/models',
      payload: { baseUrl: 'https://api.internal.example/v1', apiKey: 'sk-nope' },
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('unauthorized');
    // Still a class and never the endpoint's own words — the body above echoes
    // the very key it is refusing, which is exactly what must not be repeated.
    expect(JSON.stringify(response.body)).not.toContain('sk-nope');
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
 * [P1 §1.2](../../../../docs/design/workplan/07-p1-implementation.md)'s posture: both are listed,
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
   * **An edit can change which file wins**, and the response has to say so.
   *
   * `shadowed` is decided by label order, so renaming the winner from `A` to `Z`
   * hands the win to the other file — a different endpoint, a different key, and
   * the role silently repointed. The `200` used to report `shadowed: false`
   * about the connection the same write had just killed, which is the one moment
   * the admin has any signal at all. Found by a P2B adversarial review.
   */
  it('says so in the response when an edit hands the win to the other file', async () => {
    const id = await create({ label: 'A first by label' });
    await seedDuplicate(id, 'M in the middle', 'shadow.json');

    const listed = await server.request({ method: 'GET', url: '/api/admin/connections' });
    const edited = await server.request({
      method: 'PUT',
      url: `/api/admin/connections/${id}`,
      payload: {
        label: 'Z last by label',
        provider: 'openai-compatible',
        models: ['gpt-hi'],
        contentHash: listed.body.connections[0].contentHash as string,
      },
    });

    expect(edited.status).toBe(200);
    expect(edited.body.connection).toMatchObject({ label: 'Z last by label', shadowed: true });
    // And the list agrees, because both come from the same computation.
    const after = await server.request({ method: 'GET', url: '/api/admin/connections' });
    expect(
      (after.body.connections as { label: string; shadowed: boolean }[]).map((row) => [
        row.label,
        row.shadowed,
      ]),
    ).toEqual([
      ['M in the middle', false],
      ['Z last by label', true],
    ]);
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
 * from the turn record by design ([21 §1.4]), and returned by nothing. A table
 * showing it would have had to reimplement [19 §5.1] in the browser.
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

  /**
   * **"Leaves the other three alone" was a check that could not fail.** The
   * test above starts from an empty bindings file, so it asserts that roles
   * nobody bound stay absent — which a write that destroyed them would also
   * satisfy. And the write did destroy them: `defaultBindings` builds a fresh
   * document of exactly the five `hi`/`lo` roles, and the route wrote it
   * verbatim, so a hand-written `image` binding was gone after the first-run
   * offer. Hand-editing `bindings.json` is a first-class gesture here, and the
   * offer appears right after a first connection is saved — precisely when the
   * person who wrote the file a minute ago is looking at it.
   */
  it('preserves a hand-written binding for a role it does not speak for', async () => {
    const id = await create();
    await mkdir(server.services.layout.systemRoot, { recursive: true });
    await writeFile(
      server.services.layout.systemBindingsFile,
      JSON.stringify({ image: { connectionId: 'by-hand', modelId: 'sdxl-local' } }),
    );

    const written = await defaultsWrite(id);

    expect(written.status).toBe(200);
    // The five take the new answer; the one the button does not speak for
    // survives with the hand-written value, not a default and not absence.
    expect(written.body.bindings.image).toEqual({ connectionId: 'by-hand', modelId: 'sdxl-local' });
    expect(written.body.bindings.prose).toEqual({ connectionId: id, modelId: 'gpt-hi' });
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
 * [P2B §2.2](../../../../docs/design/workplan/10-p2b-provider-configuration.md)'s boundary
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
   * **`baseUrl` is admin-visible and user-invisible** — [09 §4.5]'s *"an admin
   * may opt to show it"* read as narrowly as it goes.
   *
   * The strongest form of that claim is structural: there is no non-admin
   * connections route at all, so the only surface carrying a URL is behind the
   * prefix guard. This walks the table to say so.
   *
   * **It speaks for one half of that, and the test below speaks for the other.**
   * `routesUnder` filters by prefix, so a connections route registered *outside*
   * `/api/admin` is invisible to this loop — the comment here used to claim it
   * would fail, and a P2B review demonstrated it could not. What this loop
   * proves is that everything under the prefix is genuinely behind the hook,
   * which is worth proving on its own: a route can be added under `/api/admin`
   * and outside the plugin's encapsulation.
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

  /**
   * **And the other half: nothing on this surface is registered outside the
   * prefix.**
   *
   * The whole `/api` table rather than a prefix-filtered slice, because a route
   * outside the guard is exactly the thing a prefix-filtered walk cannot see.
   * `routes/connections.ts` rests its no-per-handler-check position on *"the
   * route-table test covers these the moment they register"* — that sentence is
   * true of a route inside the plugin and was true of nothing else until this.
   *
   * Written as a name match rather than as a list, so a fifth route on this
   * surface is covered by existing, not by somebody remembering.
   */
  /**
   * **Exempt, by name and with a reason** — [P7.3], 2026-09-11.
   *
   * `PUT /api/sessions/:sessionId/roles` writes [19 §5.1](../../../../docs/design/19-tech-stack.md)'s
   * *session override* layer, and the noun collides honestly: it is the same
   * concept as a role binding at a different scope. It is **not** on the
   * credential surface this test guards, and it must not be admin-only, because
   * 19 §5.1 is explicit that *"anyone who wants their own key overrides a role
   * without the admin's involvement"*.
   *
   * **What makes it safe is not its name but `usable`.** `resolveRole` looks an
   * override's `connectionId` up in the capability-filtered `usable` list, so a
   * binding naming a connection the account may not use cannot be access — the
   * same filter every other layer goes through. And the route reads and writes
   * ids only: no `apiKey`, no `baseUrl`.
   *
   * *Said as `resolves as \`dangling\`` when this was written; measured at
   * [P7.3] and corrected, because the resolver is better than that. [P2B §1.2]
   * made it take **the first layer that resolves, not the first that exists**,
   * so an unusable override drops through to the layer below and `dangling` is
   * what is left when nothing bound anything usable. The safety claim is
   * unchanged and its mechanism is `usable`; only the consequence was
   * overstated.*
   *
   * **A named exception rather than a narrowed regex**, deliberately. The match
   * above is default-deny and the docstring says why — *"a fifth route on this
   * surface is covered by existing, not by somebody remembering"*. Loosening the
   * pattern would un-cover routes nobody has written yet; an exception list
   * leaves the default intact and makes each departure from it argue for itself,
   * which is how `eslint.config.js` handles the filesystem and randomness rules.
   */
  /**
   * ***Two more at [P7.3], and the probe generalised with them — 2026-09-12.***
   * `GET /api/me/roles` and `PUT /api/me/bindings` are [10 §15.1]'s *role
   * bindings* bullet, the personal half of a file whose reader has existed since
   * P2.5. They rest on the same argument and must be held to it the same way, so
   * the exemption stopped being a bare set and became a table: each entry says
   * how it is probed, and every entry is probed. A fourth exemption that named
   * no probe would not compile.
   *
   * **A write is probed by what it refuses; a read by what it returns.** Those
   * are different risks and the earlier single probe only covered the first —
   * which was right when the only exemption was a write, and would have been a
   * hole the moment a readable one was added.
   */
  /**
   * ***Four more at [P10.3], and they are the first exemptions that **do**
   * carry a key — 2026-09-16.***
   *
   * `/api/me/connections` is [10 §15.1](../../../../docs/design/10-ui-surfaces.md)'s
   * *your connections*, which [P2B §2.7] sent to *"the phase after, or at P10
   * with the rest of §15.1"*. Every exemption before it rested on the same
   * argument — *this route handles ids, never credentials* — and that argument
   * is unavailable here: a personal connection is a label, a base URL and a key,
   * which is the whole of what makes it worth having.
   *
   * ***So the exemption rests on a different claim and needs a different
   * probe.*** What makes these safe is not that they carry no secret but that
   * they can only write **into the caller's own directory**, and only when the
   * caller holds `privateConnections`. So the probe is the capability: an
   * account without it is refused on every one of them, and the refusal is the
   * class rather than a 404, because [09 §4.5] is explicit that the UI-level
   * check is not the boundary — the loader is — and a person told *ask an
   * administrator* should be able to tell that from a mistyped URL.
   *
   * **A third probe kind rather than a bare set**, which is [P7.3]'s rule
   * arriving at its third case: each entry says how it is probed and every entry
   * is probed, so an exemption that named no probe would not compile.
   */
  const EXEMPT: {
    // The request helper's own union rather than `string`, so an entry is
    // callable without a cast — vitest would have run either way and `tsc` is
    // what said so.
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    probe:
      | { kind: 'refuses-a-key'; payload: unknown }
      | { kind: 'returns-no-secret'; at: string }
      | { kind: 'needs-the-capability'; payload?: unknown };
  }[] = [
    {
      method: 'PUT',
      url: '/api/sessions/:sessionId/roles',
      probe: {
        kind: 'refuses-a-key',
        payload: { roles: { prose: { connectionId: 'c1', modelId: 'm1', apiKey: 'sk-nope' } } },
      },
    },
    {
      method: 'PUT',
      url: '/api/me/bindings',
      probe: {
        kind: 'refuses-a-key',
        payload: {
          bindings: { prose: { connectionId: 'c1', modelId: 'm1', apiKey: 'sk-nope' } },
          contentHash: 'whatever',
        },
      },
    },
    {
      method: 'GET',
      url: '/api/me/roles',
      probe: { kind: 'returns-no-secret', at: '/api/me/roles' },
    },
    { method: 'GET', url: '/api/me/connections', probe: { kind: 'needs-the-capability' } },
    {
      method: 'POST',
      url: '/api/me/connections',
      probe: {
        kind: 'needs-the-capability',
        payload: { label: 'Mine', provider: 'openai-compatible', models: ['m1'] },
      },
    },
    {
      method: 'PUT',
      url: '/api/me/connections/:id',
      probe: {
        kind: 'needs-the-capability',
        payload: {
          label: 'Mine',
          provider: 'openai-compatible',
          models: ['m1'],
          contentHash: 'whatever',
        },
      },
    },
    { method: 'DELETE', url: '/api/me/connections/:id', probe: { kind: 'needs-the-capability' } },
    {
      method: 'POST',
      url: '/api/me/connections/models',
      probe: { kind: 'needs-the-capability', payload: {} },
    },
  ];

  it('has no route outside the admin prefix', () => {
    const surface = routesUnder(server.app, '/api').filter((route) =>
      /\/(connections|bindings|roles)(\/|$)/.test(route.url),
    );
    const exempt = new Set(EXEMPT.map((one) => `${one.method} ${one.url}`));

    // The sweep would be vacuous over an empty list, so the count is asserted
    // first — a regex that matched nothing would otherwise pass.
    expect(surface.length).toBeGreaterThanOrEqual(10);
    for (const route of surface) {
      if (exempt.has(`${route.method} ${route.url}`)) continue;
      expect(route.url.startsWith('/api/admin/'), `${route.method} ${route.url}`).toBe(true);
    }
  });

  it('keeps every exempt route on the surface, so an exemption cannot go stale', () => {
    // An exemption for a route that no longer exists is a hole waiting for
    // somebody to register that path again. The table is checked against the
    // route table rather than trusted.
    const urls = new Set(
      routesUnder(server.app, '/api').map((route) => `${route.method} ${route.url}`),
    );

    for (const one of EXEMPT) {
      expect(urls, `${one.method} ${one.url}`).toContain(`${one.method} ${one.url}`);
    }
  });

  it('lets every exempt write carry ids and refuses anything else', async () => {
    // **What the exemptions actually rest on**, asserted as behaviour rather
    // than as a declaration: a route that grew an `apiKey` or a `baseUrl` field
    // would still be exempt by name, and this is what would notice.
    //
    // Fastify validates the body before the handler runs, so neither the session
    // nor the hash need be real for this to be the schema's answer — which is
    // also why it is a 400 and not a 404 or a 412.
    const writes = EXEMPT.filter((one) => one.probe.kind === 'refuses-a-key');
    expect(writes.length).toBeGreaterThan(0);

    for (const one of writes) {
      const refused = await server.request({
        method: one.method,
        url: one.url.replace(':sessionId', 'whatever'),
        payload: one.probe.kind === 'refuses-a-key' ? one.probe.payload : undefined,
      });

      expect(refused.status, `${one.method} ${one.url}`).toBe(400);
      expect(JSON.stringify(refused.body ?? null)).not.toContain('sk-nope');
    }
  });

  it('lets every exempt read carry a label and nothing else of a connection', async () => {
    // The other half, and the one the single probe did not cover: a read route
    // outside the prefix that resolved against real connections could carry a
    // key or a base URL out with the answer. `presentConnection` is what stops
    // it, and this is what holds `presentConnection` to it.
    await create();

    const reads = EXEMPT.filter((one) => one.probe.kind === 'returns-no-secret');
    expect(reads.length).toBeGreaterThan(0);

    for (const one of reads) {
      const response = await server.request({
        method: one.method,
        url: one.probe.kind === 'returns-no-secret' ? one.probe.at : one.url,
      });

      // Succeeded, so the sweep is over an answer rather than over a refusal —
      // [P2B §6.1]'s point about a body that carries nothing for the least
      // interesting reason there is.
      expect(response.status, `${one.method} ${one.url}`).toBeLessThan(400);
      const body = JSON.stringify(response.body ?? null);
      expect(body).not.toContain('sk-must-never-come-back');
      expect(body).not.toContain('api.internal.example');
      // And the label *is* carried, so the two assertions above are not passing
      // because the route answered with nothing.
      expect(body).toContain('The house key');
    }
  });

  /**
   * ***The capability is what the personal routes are exempt on, so it is what
   * they are probed on*** — [P10.3].
   *
   * **Refused, and refused as `forbidden`.** An account whose
   * `privateConnections` is off gets the same class `adminOnly` sends, on every
   * verb, before any body is read — so a withdrawn capability is not a form that
   * saves into a directory the resolver will then ignore.
   *
   * *This is not the security boundary and does not claim to be.* [09 §4.5]
   * puts that in the loader, where `resolveConnections` has enforced it since
   * P3: a file written by hand into that directory stops resolving the moment
   * the capability goes. This is the surface agreeing with the loader.
   */
  it('refuses every personal connection route without the capability', async () => {
    const refused = EXEMPT.filter((one) => one.probe.kind === 'needs-the-capability');
    // The sweep would be vacuous over an empty list.
    expect(refused.length).toBeGreaterThanOrEqual(5);

    await server.services.accounts.update('ned', {
      capabilities: { privateConnections: false, fileAccess: 'none', enableExtensions: false },
    });

    for (const one of refused) {
      const response = await server.request({
        method: one.method,
        url: one.url.replace(':id', 'whatever'),
        payload: one.probe.kind === 'needs-the-capability' ? one.probe.payload : undefined,
      });

      expect(response.status, `${one.method} ${one.url}`).toBe(403);
      expect(response.body.error, `${one.method} ${one.url}`).toBe('forbidden');
    }
  });
});
