// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Layout } from '../storage/layout.js';
import { type Connection, presentConnection, resolveConnections } from './connections.js';
import { bindingsFile, readBindings, readSystemBindings } from './bindings.js';
import { defaultBindings, resolveRole, ROLE_TIER_DEFAULTS } from './roles.js';
import { MODEL_ROLES } from './types.js';

/**
 * Connections and role bindings — [04 §4.5], [07 §5.1].
 *
 * The household case is what these two files exist for: an admin binds the two
 * defaults to system connections and everyone's calls resolve there — *"Dad
 * pays for the API"* — while anyone who wants their own key overrides a role
 * without the admin's involvement.
 */

let dataDir: string;
let layout: Layout;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-conn-'));
  layout = new Layout(dataDir);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function writeConnection(root: string, connection: Record<string, unknown>): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, `${String(connection['id'])}.json`), JSON.stringify(connection));
}

const HOUSE = {
  id: 'house-openai',
  label: 'The house key',
  provider: 'openai',
  apiKey: 'sk-do-not-leak',
  baseUrl: 'https://api.internal.example/v1',
  models: ['gpt-hi', 'gpt-lo'],
};

const MINE = {
  id: 'mine-local',
  label: 'My laptop',
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:11434/v1',
  models: ['llama-local'],
};

const ALLOWED = { privateConnections: true };
const REVOKED = { privateConnections: false };

describe('the merged list', () => {
  it('is the account’s own plus the system’s, personal first', async () => {
    await writeConnection(layout.systemConnectionsRoot, HOUSE);
    await writeConnection(layout.userConnectionsRoot('ned'), MINE);

    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);

    // Personal first, because a personal binding wins over a system default —
    // visibly and switchably.
    expect(usable.map((connection) => connection.id)).toEqual(['mine-local', 'house-openai']);
    expect(usable.map((connection) => connection.scope)).toEqual(['user', 'system']);
  });

  it('survives one malformed file without losing the others', async () => {
    await writeConnection(layout.systemConnectionsRoot, HOUSE);
    await mkdir(layout.userConnectionsRoot('ned'), { recursive: true });
    await writeFile(join(layout.userConnectionsRoot('ned'), 'broken.json'), '{ not json');

    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);

    // The failure a person actually has is a typo in one file. Taking every
    // other connection down with it is the wrong answer.
    expect(usable.map((connection) => connection.id)).toEqual(['house-openai']);
  });
});

describe('privateConnections', () => {
  it('is enforced at resolution, so dropping a file in is not a bypass', async () => {
    // A user with write file access can put a connection in their own
    // directory. A check in a route or the UI would be a trivial bypass, which
    // is why the loader is the thing that refuses.
    await writeConnection(layout.systemConnectionsRoot, HOUSE);
    await writeConnection(layout.userConnectionsRoot('ned'), MINE);

    const { usable, disabled } = await resolveConnections(layout, 'ned', REVOKED);

    expect(usable.map((connection) => connection.id)).toEqual(['house-openai']);
    // Returned rather than silently skipped: revoking disables, never deletes,
    // and the user is told rather than left wondering why a call started
    // failing.
    expect(disabled.map((connection) => connection.id)).toEqual(['mine-local']);
  });
});

describe('what leaves the server', () => {
  it('is a label, a provider and its models — never the key, never the URL', async () => {
    await writeConnection(layout.systemConnectionsRoot, HOUSE);
    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    const connection = usable[0]!;

    // The server knows both.
    expect(connection.apiKey).toBe('sk-do-not-leak');
    expect(connection.baseUrl).toBe('https://api.internal.example/v1');

    const shown = presentConnection(connection);
    const serialised = JSON.stringify(shown);

    expect(shown).toEqual({
      id: 'house-openai',
      label: 'The house key',
      provider: 'openai',
      scope: 'system',
      models: ['gpt-hi', 'gpt-lo'],
    });
    // Asserted on the serialised form as well, because that is the thing that
    // would actually reach a client. The URL matters as much as the key: it can
    // carry a token or name a private host.
    expect(serialised).not.toContain('sk-do-not-leak');
    expect(serialised).not.toContain('api.internal.example');
  });
});

describe('the two-model default', () => {
  const hi = { connectionId: 'house-openai', modelId: 'gpt-hi' };
  const lo = { connectionId: 'house-openai', modelId: 'gpt-lo' };

  it('spreads two answers across the roles that have a text fallback', () => {
    const bindings = defaultBindings(hi, lo);

    // The policy: the expensive model writes, everything else uses the cheap
    // one. Several `fast` consumers run every turn.
    expect(bindings.prose).toEqual(hi);
    expect(bindings.reasoning).toEqual(hi);
    expect(bindings.fast).toEqual(lo);
    expect(bindings.vision).toEqual(lo);
    expect(bindings.embedding).toEqual(lo);
  });

  it('leaves image, video and speech unbound rather than pointing them at text', () => {
    const bindings = defaultBindings(hi, lo);

    // There is no sensible text-model fallback for an image, and a binding that
    // resolved to one would fail at the call rather than at the setup.
    expect(bindings.image).toBeUndefined();
    expect(bindings.video).toBeUndefined();
    expect(bindings.speech).toBeUndefined();
  });

  it('has an answer for every role, so a new role cannot be forgotten', () => {
    // The tier table is exhaustive by construction; this is what makes adding a
    // ninth role a compile error rather than a silent `undefined`.
    for (const role of MODEL_ROLES) {
      expect(ROLE_TIER_DEFAULTS[role]).toBeDefined();
    }
  });
});

describe('resolving a role', () => {
  const house: Connection = {
    id: 'house-openai',
    label: 'The house key',
    provider: 'openai',
    scope: 'system',
    models: ['gpt-hi', 'gpt-lo'],
  };
  const mine: Connection = {
    id: 'mine-local',
    label: 'My laptop',
    provider: 'openai-compatible',
    scope: 'user',
    models: ['llama-local'],
  };
  const bindings = defaultBindings(
    { connectionId: 'house-openai', modelId: 'gpt-hi' },
    { connectionId: 'house-openai', modelId: 'gpt-lo' },
  );

  it('takes the binding, and says so', () => {
    const result = resolveRole({ role: 'prose', bindings, usable: [house] });

    expect(result.ok && result.modelId).toBe('gpt-hi');
    expect(result.ok && result.via).toBe('binding');
  });

  it('lets a step override beat a session override beat the binding', () => {
    // The fixed order from §5.1: install default → role binding → session
    // override → step override → actor hint.
    const session = { connectionId: 'mine-local', modelId: 'llama-local' };
    const step = { connectionId: 'house-openai', modelId: 'gpt-lo' };

    const sessionWins = resolveRole({
      role: 'prose',
      bindings,
      usable: [house, mine],
      sessionOverride: session,
    });
    expect(sessionWins.ok && sessionWins.modelId).toBe('llama-local');

    const stepWins = resolveRole({
      role: 'prose',
      bindings,
      usable: [house, mine],
      sessionOverride: session,
      stepOverride: step,
    });
    expect(stepWins.ok && stepWins.via).toBe('step');
    expect(stepWins.ok && stepWins.modelId).toBe('gpt-lo');
  });

  it('lets a hint pick among the models the connection offers', () => {
    const result = resolveRole({
      role: 'prose',
      bindings,
      usable: [house],
      hint: { preferredModelIds: ['gpt-lo'] },
    });

    expect(result.ok && result.modelId).toBe('gpt-lo');
    expect(result.ok && result.via).toBe('hint');
  });

  it('will not let a hint repoint the connection, and records that it went unmet', () => {
    // An imported card may express what it wants; it can never repoint anyone's
    // provider. `llama-local` is a real model on a real connection — just not
    // on the one this role is bound to.
    const result = resolveRole({
      role: 'prose',
      bindings,
      usable: [house, mine],
      hint: { preferredModelIds: ['llama-local'] },
    });

    expect(result.ok && result.connection.id).toBe('house-openai');
    expect(result.ok && result.modelId).toBe('gpt-hi');
    expect(result.ok && result.hintUnmet).toBe(true);
  });

  it('tells an unbound role apart from a dangling one', () => {
    // Different remedies: the first is setup, the second is an admin having
    // removed a system connection out from under a binding.
    const unbound = resolveRole({ role: 'image', bindings, usable: [house] });
    expect(unbound.ok).toBe(false);
    expect(!unbound.ok && unbound.reason).toBe('unbound');

    const dangling = resolveRole({ role: 'prose', bindings, usable: [mine] });
    expect(!dangling.ok && dangling.reason).toBe('dangling');
    expect(!dangling.ok && dangling.connectionId).toBe('house-openai');
  });
});

/**
 * **The install default layer** — [P2B §2.1](../../../../docs/design/workplan/14-p2b-provider-configuration.md),
 * [07 §5.1](../../../../docs/design/07-tech-stack.md)'s weakest layer, finally present.
 *
 * Three documents described a layer of bindings belonging to the install rather
 * than to a person, and [04 §4.5](../../../../docs/design/04-server-multiuser-deployment.md) said a
 * dangling binding *"falls back to system bindings — the existing non-blocking
 * behaviour, **no new mechanism**"*. There was no second layer, so the fallback
 * that sentence promised could not happen. That is the sentence that hid the
 * work.
 */
describe('the install defaults', () => {
  const house: Connection = {
    id: 'house-openai',
    label: 'The house key',
    provider: 'openai',
    scope: 'system',
    models: ['gpt-hi', 'gpt-lo'],
  };
  const mine: Connection = {
    id: 'mine-local',
    label: 'My laptop',
    provider: 'openai-compatible',
    scope: 'user',
    models: ['llama-local'],
  };

  const installDefaults = defaultBindings(
    { connectionId: 'house-openai', modelId: 'gpt-hi' },
    { connectionId: 'house-openai', modelId: 'gpt-lo' },
  );

  it('resolves a role nobody has bound personally, and says which layer won', () => {
    const result = resolveRole({
      role: 'prose',
      bindings: {},
      defaults: installDefaults,
      usable: [house],
    });

    expect(result.ok && result.modelId).toBe('gpt-hi');
    // `default`, not `binding`. The distinction is the whole reason the two maps
    // are not merged before resolution: a merged map answers every resolvable
    // role correctly and cannot say *inherited* against *yours*, which is what
    // [05 §15.1] asks the surface to show.
    expect(result.ok && result.via).toBe('default');
  });

  it('loses to a binding the account set for itself, per role', () => {
    const result = resolveRole({
      role: 'prose',
      bindings: { prose: { connectionId: 'mine-local', modelId: 'llama-local' } },
      defaults: installDefaults,
      usable: [house, mine],
    });

    expect(result.ok && result.modelId).toBe('llama-local');
    expect(result.ok && result.via).toBe('binding');

    // And only that role — the others still come from the install. `fast` is a
    // `lo`-tier role, so it is one `defaultBindings` actually populates; the
    // three `unset` ones (`image`, `video`, `speech`) are deliberately not
    // bound, because there is no sensible text fallback for an image.
    const other = resolveRole({
      role: 'fast',
      bindings: { prose: { connectionId: 'mine-local', modelId: 'llama-local' } },
      defaults: installDefaults,
      usable: [house, mine],
    });
    expect(other.ok && other.via).toBe('default');
    expect(other.ok && other.modelId).toBe('gpt-lo');
  });

  /**
   * **`dangling` becomes recoverable**, which is what [04 §4.5] promised all
   * along: an admin removes a connection somebody had bound, and the turn keeps
   * working rather than failing.
   *
   * The resolver takes the first layer that *resolves*, not the first that
   * exists — which is the behaviour change, and it is the reason the loop
   * replaced a `find` on definedness.
   */
  it('catches a personal binding whose connection is gone', () => {
    const result = resolveRole({
      role: 'prose',
      bindings: { prose: { connectionId: 'deleted-yesterday', modelId: 'gone' } },
      defaults: installDefaults,
      usable: [house],
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.via).toBe('default');
    expect(result.ok && result.modelId).toBe('gpt-hi');
  });

  /**
   * **And `dangling` survives as the honest remainder** — when every layer that
   * bound something failed. Both states are reachable and they are different,
   * which is the whole reason `resolveRole` tells them apart.
   */
  it('reports dangling only when nothing resolves at any layer', () => {
    const result = resolveRole({
      role: 'prose',
      bindings: { prose: { connectionId: 'deleted-yesterday', modelId: 'gone' } },
      defaults: { prose: { connectionId: 'also-deleted', modelId: 'gone' } },
      usable: [house],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('dangling');
    // The *strongest* layer's connection id, because that is the binding whose
    // owner can fix it — telling somebody about the install default they do not
    // control would be the less useful half of the truth.
    expect(!result.ok && result.connectionId).toBe('deleted-yesterday');
  });

  it('still reports unbound when no layer bound anything', () => {
    const result = resolveRole({ role: 'prose', bindings: {}, defaults: {}, usable: [house] });

    // A different fact with a different remedy: the first is setup, the second
    // is an administrator having removed something.
    expect(!result.ok && result.reason).toBe('unbound');
  });

  it('is absent-by-default, so an install without the file behaves as before', () => {
    const result = resolveRole({ role: 'prose', bindings: {}, usable: [house] });

    expect(!result.ok && result.reason).toBe('unbound');
  });
});

/**
 * The reader, both layers — [P2B §2.1].
 *
 * Deliberately **one reader over two paths** rather than two readers: the files
 * are the same shape, and a second parser is a second set of decisions about a
 * malformed one.
 */
describe('reading bindings from disk', () => {
  const binding = { prose: { connectionId: 'house-openai', modelId: 'gpt-hi' } };

  it('reads the install defaults from system/bindings.json', async () => {
    await mkdir(layout.systemRoot, { recursive: true });
    await writeFile(layout.systemBindingsFile, JSON.stringify(binding));

    expect(await readSystemBindings(layout)).toEqual(binding);
  });

  it('reads a user file from their own directory, and the two do not collide', async () => {
    await mkdir(layout.systemRoot, { recursive: true });
    await writeFile(layout.systemBindingsFile, JSON.stringify(binding));
    await mkdir(layout.userRoot('ned'), { recursive: true });
    await writeFile(
      bindingsFile(layout, 'ned'),
      JSON.stringify({ prose: { connectionId: 'mine-local', modelId: 'llama-local' } }),
    );

    // The path is the owner ([04 §4.3]): one lives under `system/`, one under
    // `users/ned/`, and reading either does not reach the other.
    expect((await readSystemBindings(layout)).prose?.connectionId).toBe('house-openai');
    expect((await readBindings(layout, 'ned')).prose?.connectionId).toBe('mine-local');
  });

  it('reads an absent or mangled system file as no defaults at all', async () => {
    expect(await readSystemBindings(layout)).toEqual({});

    await mkdir(layout.systemRoot, { recursive: true });
    await writeFile(layout.systemBindingsFile, '{ not json');

    // The same posture the user file has had since P2.5, and for the same
    // reason: a turn then fails with `unbound`, naming the role, which tells
    // somebody what to do. A startup error over a missing optional file would
    // not — and this file is optional on every install that has never had an
    // administrator open the settings page.
    expect(await readSystemBindings(layout)).toEqual({});
  });
});
