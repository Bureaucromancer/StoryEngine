// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listEntryNames } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import {
  type Connection,
  deleteConnection,
  findConnectionFiles,
  presentConnection,
  presentConnectionsForAdmin,
  presentForAdmin,
  presentMyConnections,
  presentUsableConnections,
  readSystemConnectionEntries,
  readSystemConnections,
  readUserConnectionEntries,
  resolveConnections,
  seesImages,
  writeConnection,
} from './connections.js';
import { bindingsFile, readBindings, readSystemBindings } from './bindings.js';
import { defaultBindings, resolveRole, ROLE_TIER_DEFAULTS } from './roles.js';
import { MODEL_ROLES } from './types.js';

/**
 * Connections and role bindings — [09 §4.5], [20 §5.1].
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

/**
 * A connection file written **by hand**, the way every fixture in this repo does
 * and the way anybody with a text editor still may ([P2B §2.3]).
 *
 * Named for what it is now that the store has a real writer beside it — and
 * note the filename: these are named for the provider, not for the id, which is
 * precisely why a delete cannot be a path join alone.
 */
async function seedConnectionFile(
  root: string,
  connection: Record<string, unknown>,
  filename?: string,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, filename ?? `${String(connection['id'])}.json`),
    JSON.stringify(connection),
  );
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
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    await seedConnectionFile(layout.userConnectionsRoot('ned'), MINE);

    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);

    // Personal first, because a personal binding wins over a system default —
    // visibly and switchably.
    expect(usable.map((connection) => connection.id)).toEqual(['mine-local', 'house-openai']);
    expect(usable.map((connection) => connection.scope)).toEqual(['user', 'system']);
  });

  it('survives one malformed file without losing the others', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
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
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    await seedConnectionFile(layout.userConnectionsRoot('ned'), MINE);

    const { usable, disabled } = await resolveConnections(layout, 'ned', REVOKED);

    expect(usable.map((connection) => connection.id)).toEqual(['house-openai']);
    // Returned rather than silently skipped: revoking disables, never deletes,
    // and the user is told rather than left wondering why a call started
    // failing.
    expect(disabled.map((connection) => connection.id)).toEqual(['mine-local']);
  });
});

/**
 * ***A personal file claiming a system connection's id*** — reported, and not
 * refused.
 *
 * The cross-account half of this collision lived in the provider memo and is
 * `factory.test.ts`'s to prove. What is left here is the author's own account,
 * where the personal file wins — P2B §1.5's *"at least the safe direction"* —
 * and where the resolver's job is to say it happened rather than to undo it.
 */
describe('a personal file claiming a system id', () => {
  const PLANTED = { ...MINE, id: HOUSE.id, label: 'Not the house key' };

  it('still wins for its author, and is reported as shadowing', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    await seedConnectionFile(layout.userConnectionsRoot('ned'), PLANTED, 'planted.json');

    const { usable, shadowing } = await resolveConnections(layout, 'ned', ALLOWED);

    // Personal first is unchanged, so a role naming the id reaches the
    // author's own endpoint on the author's own key. Refusing the file instead
    // would move them onto the install's key without a word.
    expect(usable.map((connection) => connection.scope)).toEqual(['user', 'system']);
    const role = resolveRole({
      role: 'prose',
      bindings: { prose: { connectionId: HOUSE.id, modelId: 'llama-local' } },
      usable,
    });
    expect(role.ok && role.connection.scope).toBe('user');

    expect(shadowing.map((connection) => [connection.id, connection.scope])).toEqual([
      [HOUSE.id, 'user'],
    ]);
  });

  /**
   * **Two personal files claiming one system id: one of them wins, so one is
   * reported.** The runner's line says the files it counts *win for this
   * account*, and only the first per id in the resolver's order does — the
   * other loses to it inside the personal scope, which is a collision the list
   * already shows. The filenames run against the labels on purpose, so a
   * report that followed the directory's order instead of `resolveRole`'s
   * would name the wrong file.
   */
  it('reports only the claimant that wins, when two personal files claim one id', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    const root = layout.userConnectionsRoot('ned');
    await seedConnectionFile(root, { ...PLANTED, label: 'Zed, planted second' }, 'a.json');
    await seedConnectionFile(root, { ...PLANTED, label: 'Amy, planted first' }, 'z.json');

    const { usable, shadowing } = await resolveConnections(layout, 'ned', ALLOWED);

    const role = resolveRole({
      role: 'prose',
      bindings: { prose: { connectionId: HOUSE.id, modelId: 'llama-local' } },
      usable,
    });
    expect(role.ok && role.connection.label).toBe('Amy, planted first');
    expect(shadowing.map((connection) => connection.label)).toEqual(['Amy, planted first']);

    // And the one left out is not unreported: *Your connections* presents
    // the personal scope through the same presenter, which marks it.
    const listed = presentConnectionsForAdmin(await readUserConnectionEntries(layout, 'ned'));
    expect(listed.map((row) => [row.label, row.shadowed])).toEqual([
      ['Amy, planted first', false],
      ['Zed, planted second', true],
    ]);
  });

  it('reports nothing when the ids differ', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    await seedConnectionFile(layout.userConnectionsRoot('ned'), MINE);

    const { shadowing } = await resolveConnections(layout, 'ned', ALLOWED);

    expect(shadowing).toEqual([]);
  });

  it('reports nothing when the account may not use its own', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    await seedConnectionFile(layout.userConnectionsRoot('ned'), PLANTED, 'planted.json');

    const { usable, disabled, shadowing } = await resolveConnections(layout, 'ned', REVOKED);

    // Nothing personal resolves, so nothing shadows: the file is `disabled`,
    // which is the one report it earns.
    expect(usable.map((connection) => connection.scope)).toEqual(['system']);
    expect(disabled).toHaveLength(1);
    expect(shadowing).toEqual([]);
  });
});

/**
 * ***What each row says it hides*** — [polish §26](../../../../docs/design/workplan/06-polish.md),
 * 2026-10-04, and the on-screen half of the block above, which until then was
 * a count in the log.
 *
 * Two presenters, one per surface, and both read the pairing from
 * `shadowsAcrossScopes` so neither decides a winner of its own: *Your
 * connections* marks the personal file with the install connection it stands
 * in for (`shadows`), and the role pane marks the install connection with the
 * personal file that answers in its place (`shadowedBy`). **A label each, and
 * nothing else of the other connection** — the system one's key and address
 * stay where `presentConnection` keeps them.
 */
describe('what each row says it hides', () => {
  const PLANTED = { ...MINE, id: HOUSE.id, label: 'Not the house key' };

  async function myRows() {
    return presentMyConnections(
      await readUserConnectionEntries(layout, 'ned'),
      await readSystemConnections(layout),
    );
  }

  it('names the install connection a personal file stands in for, and nothing else of it', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    await seedConnectionFile(layout.userConnectionsRoot('ned'), PLANTED, 'planted.json');
    await seedConnectionFile(layout.userConnectionsRoot('ned'), MINE);

    const rows = await myRows();

    expect(rows.map((row) => [row.label, row.shadowed, row.shadows])).toEqual([
      ['My laptop', false, undefined],
      // `shadowed` stays false: it means *nothing resolves to this file*, and
      // this is the file that does. The two fields say opposite things.
      ['Not the house key', false, { label: 'The house key' }],
    ]);
    // Absent rather than empty on a row that hides nothing, so the wire says
    // nothing about a collision that is not there.
    expect('shadows' in (rows[0] ?? {})).toBe(false);
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain(HOUSE.apiKey);
    expect(serialised).not.toContain('api.internal.example');
  });

  /**
   * **On the winner only.** The second personal claimant is already marked
   * `shadowed` inside its own scope, has no controls, and hides nothing — so a
   * second sentence there would tell somebody that a file nothing reads is
   * standing in for the install's. Filenames against labels, as above.
   */
  it('says it on the file that wins the id, when two personal files claim it', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    const root = layout.userConnectionsRoot('ned');
    await seedConnectionFile(root, { ...PLANTED, label: 'Zed, planted second' }, 'a.json');
    await seedConnectionFile(root, { ...PLANTED, label: 'Amy, planted first' }, 'z.json');

    expect((await myRows()).map((row) => [row.label, row.shadowed, row.shadows])).toEqual([
      ['Amy, planted first', false, { label: 'The house key' }],
      ['Zed, planted second', true, undefined],
    ]);
  });

  /**
   * **The install connection a turn would otherwise reach**, which is the first
   * system claimant by label — the one `resolveRole` would find were the
   * personal file gone. Naming the other would point the person at a file
   * nobody's turns read.
   */
  it('names the install connection resolution would fall back to, when two system files claim the id', async () => {
    await seedConnectionFile(
      layout.systemConnectionsRoot,
      { ...HOUSE, label: 'Zulu house' },
      'a.json',
    );
    await seedConnectionFile(
      layout.systemConnectionsRoot,
      { ...HOUSE, label: 'Alpha house' },
      'z.json',
    );
    await seedConnectionFile(layout.userConnectionsRoot('ned'), PLANTED, 'planted.json');

    expect((await myRows()).map((row) => row.shadows)).toEqual([{ label: 'Alpha house' }]);
  });

  it('marks the install connection a personal file hides, with the personal label', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    await seedConnectionFile(layout.systemConnectionsRoot, {
      ...HOUSE,
      id: 'house-other',
      label: 'Another house key',
    });
    await seedConnectionFile(layout.userConnectionsRoot('ned'), PLANTED, 'planted.json');

    const offered = presentUsableConnections(await resolveConnections(layout, 'ned', ALLOWED));

    expect(offered.map((one) => [one.scope, one.label, one.shadowedBy])).toEqual([
      // The personal file is the one that answers, so it is never marked —
      // marking it with its own label would hide the one choice that works.
      ['user', 'Not the house key', undefined],
      ['system', 'Another house key', undefined],
      ['system', 'The house key', { label: 'Not the house key' }],
    ]);
    const serialised = JSON.stringify(offered);
    expect(serialised).not.toContain(HOUSE.apiKey);
    expect(serialised).not.toContain('api.internal.example');
  });

  /**
   * **Every system claimant of the id, not only the first.** For this account
   * the personal file wins the id, so the install's second file claiming it is
   * no more reachable than its first, and a picker offering its models would
   * offer choices that reach the personal file.
   */
  it('marks every install file claiming a shadowed id', async () => {
    await seedConnectionFile(
      layout.systemConnectionsRoot,
      { ...HOUSE, label: 'Zulu house' },
      'a.json',
    );
    await seedConnectionFile(
      layout.systemConnectionsRoot,
      { ...HOUSE, label: 'Alpha house' },
      'z.json',
    );
    await seedConnectionFile(layout.userConnectionsRoot('ned'), PLANTED, 'planted.json');

    const offered = presentUsableConnections(await resolveConnections(layout, 'ned', ALLOWED));

    expect(offered.map((one) => [one.label, one.shadowedBy?.label])).toEqual([
      ['Not the house key', undefined],
      ['Alpha house', 'Not the house key'],
      ['Zulu house', 'Not the house key'],
    ]);
  });

  it('marks nothing when the account may not use its own', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    await seedConnectionFile(layout.userConnectionsRoot('ned'), PLANTED, 'planted.json');

    const offered = presentUsableConnections(await resolveConnections(layout, 'ned', REVOKED));

    // The personal file does not resolve, so the install's is what a turn
    // reaches — offering it is right, and saying it is hidden would be false.
    expect(offered.map((one) => [one.label, 'shadowedBy' in one])).toEqual([
      ['The house key', false],
    ]);
  });
});

describe('what leaves the server', () => {
  it('is a label, a provider and its models — never the key, never the URL', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
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
 * **The install default layer** — [P2B §2.1](../../../../docs/design/workplan/10-p2b-provider-configuration.md),
 * [20 §5.1](../../../../docs/design/20-tech-stack.md)'s weakest layer, finally present.
 *
 * Three documents described a layer of bindings belonging to the install rather
 * than to a person, and [09 §4.5](../../../../docs/design/09-server-multiuser-deployment.md) said a
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
    // [10 §15.1] asks the surface to show.
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
   * **`dangling` becomes recoverable**, which is what [09 §4.5] promised all
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

    // The path is the owner ([09 §4.3]): one lives under `system/`, one under
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

/**
 * The writer — [P2B §3](../../../../docs/design/workplan/10-p2b-provider-configuration.md) stage
 * P2B.1.
 *
 * Until this stage a connection could only be hand-written, which is why a
 * fresh install could not run a single turn: the only worked example of the
 * file lived in a test.
 */
describe('writing a connection', () => {
  const input = {
    label: 'The house key',
    provider: 'openai-compatible',
    apiKey: 'sk-secret',
    baseUrl: 'https://api.example.invalid/v1',
    models: ['gpt-hi', 'gpt-lo'],
  };

  it('mints a uuid rather than taking one from the caller', async () => {
    const written = await writeConnection(layout, layout.systemConnectionsRoot, input);

    // Server-side ids close the shadowing hole [P2B §1.5] found — a personal
    // file reusing a system connection's id silently shadows it — for anything
    // created through the UI, without outlawing the hand-written file that
    // already works. (2026-10-03: no longer silent in the log —
    // `resolveConnections` reports it as `shadowing` and the runner logs a
    // count as `connections.shadowing`; ~~still shown by nothing on screen, a
    // known follow-up under P2B §1.5~~ — 2026-10-04: on screen too, since
    // [polish §26]; see 'what each row says it hides' above.)
    expect(written.connection.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);

    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    expect(usable.map((connection) => connection.id)).toEqual([written.connection.id]);
  });

  it('names the file from the id', async () => {
    const written = await writeConnection(layout, layout.systemConnectionsRoot, input);

    const names = await listEntryNames(layout.systemConnectionsRoot);
    expect(names).toEqual([`${written.connection.id}.json`]);
  });

  it('refuses a provider this build cannot construct, at save rather than at the turn', async () => {
    await expect(
      writeConnection(layout, layout.systemConnectionsRoot, { ...input, provider: 'anthropic' }),
    ).rejects.toMatchObject({ code: 'unbuildable' });

    // And nothing landed — a refused save must not leave a connection that
    // fails at call time, which is the worst place to find out.
    expect(await listEntryNames(layout.systemConnectionsRoot)).toEqual([]);
  });

  it('refuses a connection with no label', async () => {
    await expect(
      writeConnection(layout, layout.systemConnectionsRoot, { ...input, label: '   ' }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  /**
   * **A key is kept when the caller sends none**, which is what makes
   * `hasKey` workable as a form affordance: an empty password box cannot
   * distinguish *no key* from *unchanged*, so the form leaves it blank to keep
   * what is stored — and the write has to honour that, or editing a label
   * silently deletes the credential.
   */
  it('keeps the stored key through an edit that does not mention it', async () => {
    const written = await writeConnection(layout, layout.systemConnectionsRoot, input);

    await writeConnection(layout, layout.systemConnectionsRoot, {
      id: written.connection.id,
      label: 'Renamed',
      provider: 'openai-compatible',
      models: ['gpt-hi'],
    });

    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    expect(usable[0]?.label).toBe('Renamed');
    expect(usable[0]?.apiKey).toBe('sk-secret');
  });

  it('replaces the key when the caller does send one', async () => {
    const written = await writeConnection(layout, layout.systemConnectionsRoot, input);

    await writeConnection(layout, layout.systemConnectionsRoot, {
      ...input,
      id: written.connection.id,
      apiKey: 'sk-rotated',
    });

    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    expect(usable[0]?.apiKey).toBe('sk-rotated');
  });

  it('writes into a system directory that does not exist yet', async () => {
    // A fresh install has no `data/system/` at all — nothing creates it — so
    // the very first connection an admin saves lands in a directory the atomic
    // writer has to make on the way past.
    expect(await listEntryNames(layout.systemConnectionsRoot)).toEqual([]);

    const written = await writeConnection(layout, layout.systemConnectionsRoot, input);

    expect(written.connection.scope).toBe('system');
  });
});

describe('deleting a connection', () => {
  it('finds the file this store wrote, by its derived name', async () => {
    const written = await writeConnection(layout, layout.systemConnectionsRoot, {
      label: 'The house key',
      provider: 'openai-compatible',
      models: ['gpt-hi'],
    });

    await deleteConnection(layout, layout.systemConnectionsRoot, written.connection.id);

    expect(await listEntryNames(layout.systemConnectionsRoot)).toEqual([]);
  });

  /**
   * **And a file somebody named themselves**, which is not an edge case.
   *
   * `<id>.json` is this phase's convention, not a guarantee about what is on
   * disk. Every connection fixture this repository has ever written by hand is
   * named for its provider — `fake.json`, `house.json`, `mine.json` — and
   * [P2B §2.3] promises a hand-renamed file keeps working, because the path is a
   * convenience and the id is identity.
   *
   * A delete implemented as a path join alone passes its own new tests and
   * fails against every file anybody actually has, leaving a connection an
   * admin has just been told is gone.
   */
  it('finds a hand-named file by scanning for the id inside it', async () => {
    // **The filename must not be the id**, or this tests the derived path
    // twice — which the first draft did, because this file's own fixture
    // happened to name by id while every other test file in the repo names by
    // provider. `fake.json` holding a uuid is the shape on disk everywhere else.
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE, 'the-house.json');
    expect(await listEntryNames(layout.systemConnectionsRoot)).toEqual(['the-house.json']);

    await deleteConnection(layout, layout.systemConnectionsRoot, 'house-openai');

    expect(await listEntryNames(layout.systemConnectionsRoot)).toEqual([]);
  });

  it('leaves every other connection alone', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    await seedConnectionFile(layout.systemConnectionsRoot, { ...MINE, id: 'second' });

    await deleteConnection(layout, layout.systemConnectionsRoot, 'house-openai');

    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    expect(usable.map((connection) => connection.id)).toEqual(['second']);
  });

  it('says so rather than silently succeeding on an id that is not there', async () => {
    await expect(
      deleteConnection(layout, layout.systemConnectionsRoot, 'never-existed'),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('does not reach into the other scope', async () => {
    await seedConnectionFile(layout.userConnectionsRoot('ned'), MINE);

    // The system root is the one being deleted from, and the id lives in the
    // user's. Scope is the path ([09 §4.3]), so this is a miss rather than a
    // cross-scope delete.
    await expect(
      deleteConnection(layout, layout.systemConnectionsRoot, 'mine-local'),
    ).rejects.toMatchObject({ code: 'not-found' });

    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    expect(usable.map((connection) => connection.id)).toEqual(['mine-local']);
  });

  it('finds nothing for an id no file claims', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);

    expect(await findConnectionFiles(layout, layout.systemConnectionsRoot, 'other')).toEqual([]);
  });
});

/**
 * **Two shapes, and the boundary between them is the key alone** — [P2B §2.2].
 */
describe('what an admin sees', () => {
  it('carries the base URL and whether a key is set, never the key', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);

    const shown = presentForAdmin(usable[0]!, 'sha256:whatever');

    expect(shown).toEqual({
      id: 'house-openai',
      label: 'The house key',
      provider: 'openai',
      scope: 'system',
      models: ['gpt-hi', 'gpt-lo'],
      baseUrl: 'https://api.internal.example/v1',
      hasKey: true,
      shadowed: false,
      contentHash: 'sha256:whatever',
    });
    // The URL is admin-visible and user-invisible — [09 §4.5]'s *"an admin may
    // opt to show it"* read as narrowly as it goes. The key is neither.
    expect(JSON.stringify(shown)).not.toContain('sk-do-not-leak');
  });

  it('tells a keyless local endpoint apart from one whose key is set', async () => {
    await seedConnectionFile(layout.userConnectionsRoot('ned'), MINE);
    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);

    // The two states an empty password box cannot distinguish, which is the
    // whole reason `hasKey` exists rather than a masked value.
    expect(presentForAdmin(usable[0]!, 'sha256:whatever').hasKey).toBe(false);
  });

  it('is built by picking, so a new field on Connection does not leak by default', () => {
    /**
     * Constructed directly rather than read from disk, because `parseConnection`
     * builds a fixed object and would drop the extra field before
     * `presentForAdmin` ever saw it — so a round trip cannot fail this test no
     * matter how the presenter is written. The first draft did exactly that.
     *
     * What this stands in for is the real case: somebody adds a field to
     * `Connection` and to the parser, and forgets this function.
     * `Omit<Connection, 'apiKey'>` would put it on the wire with only a
     * reviewer between it and a leak, which is the argument `toPublic()` makes
     * in the other direction.
     */
    const future = {
      id: 'house-openai',
      label: 'The house key',
      provider: 'openai',
      scope: 'system' as const,
      models: ['gpt-hi'],
      apiKey: 'sk-do-not-leak',
      organisationId: 'must not appear',
    } as unknown as Connection;

    expect(JSON.stringify(presentForAdmin(future, 'sha256:whatever'))).not.toContain(
      'must not appear',
    );
  });
});

/**
 * **Shadowing is a property of the list**, so it is computed where the list is
 * — [P2B §4](../../../../docs/design/workplan/10-p2b-provider-configuration.md) step 10.
 */
describe('two files claiming one id', () => {
  it('are both read, and the one that loses is the one nothing resolves to', async () => {
    await seedConnectionFile(
      layout.systemConnectionsRoot,
      { ...HOUSE, label: 'A first by label' },
      'one.json',
    );
    await seedConnectionFile(
      layout.systemConnectionsRoot,
      { ...HOUSE, label: 'Z last by label' },
      'two.json',
    );

    const entries = await readSystemConnectionEntries(layout);
    const shown = presentConnectionsForAdmin(entries);

    expect(shown.map((row) => [row.label, row.shadowed])).toEqual([
      ['A first by label', false],
      ['Z last by label', true],
    ]);

    /**
     * **And the flag agrees with the resolver**, which is the claim rather than
     * the ordering itself. `resolveRole` takes `usable.find(…)`, so asserting
     * against it is what makes `shadowed` true instead of plausible — a second
     * implementation of *which one wins* would drift the first time either
     * changed.
     */
    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    const resolved = resolveRole({
      role: 'prose',
      bindings: { prose: { connectionId: HOUSE.id, modelId: 'gpt-hi' } },
      usable,
    });
    expect(resolved.ok && resolved.connection.label).toBe(
      shown.find((row) => !row.shadowed)?.label,
    );
  });

  it('are all found by the delete, so revoking a key actually revokes it', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE, 'one.json');
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE, 'two.json');

    expect(await findConnectionFiles(layout, layout.systemConnectionsRoot, HOUSE.id)).toHaveLength(
      2,
    );
    expect(await deleteConnection(layout, layout.systemConnectionsRoot, HOUSE.id)).toBe(2);

    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    expect(usable).toEqual([]);
  });

  /**
   * **The derived name is tried first and not counted twice.** A file this
   * store wrote is at `<id>.json`, which the scan below would reach as well —
   * so without the dedupe a delete would unlink it and then try again.
   */
  it('does not count the derived path twice when that is where the file is', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);

    expect(await findConnectionFiles(layout, layout.systemConnectionsRoot, HOUSE.id)).toHaveLength(
      1,
    );
  });
});

/**
 * **What a hand-written file can contain**, found by a P2B adversarial review
 * probing values the parse accepts and the resolver did not.
 *
 * Both files here are hand-written by design ([10 §4]) — the per-user
 * `bindings.json` has no writer at all — so "well-formed JSON that means
 * nothing" is not an exotic input. It is the ordinary typo.
 */
describe('nonsense a person can type', () => {
  it('does not let one null binding throw', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    await mkdir(layout.userRoot('ned'), { recursive: true });
    await writeFile(bindingsFile(layout, 'ned'), JSON.stringify({ prose: null, fast: 'nonsense' }));

    const bindings = await readBindings(layout, 'ned');
    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);

    // `{"prose": null}` is well-formed JSON. It used to clear `resolveRole`'s
    // `undefined` check and throw on the property access — a 500 on the admin
    // account list, from one person's file.
    expect(resolveRole({ role: 'prose', bindings, usable })).toMatchObject({
      ok: false,
      reason: 'unbound',
    });
    expect(resolveRole({ role: 'fast', bindings, usable })).toMatchObject({ ok: false });
  });

  it('drops a binding missing half its fields and keeps its neighbours', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    await mkdir(layout.userRoot('ned'), { recursive: true });
    await writeFile(
      bindingsFile(layout, 'ned'),
      JSON.stringify({
        prose: { connectionId: HOUSE.id, modelId: 'gpt-hi' },
        fast: { connectionId: HOUSE.id },
        vision: { modelId: 'gpt-lo' },
      }),
    );

    // One typo takes out one role, the same posture a bad connection file gets.
    expect(Object.keys(await readBindings(layout, 'ned'))).toEqual(['prose']);
  });

  it('survives a directory somebody named like a connection file', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, HOUSE);
    await mkdir(join(layout.systemConnectionsRoot, 'notes.json'), { recursive: true });

    // `assertReal` and a read of a directory both throw, and both used to
    // escape a function whose comment promises one bad entry is survivable —
    // which became a 500 on the account list the moment P2B.4 read this per
    // account.
    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    expect(usable.map((connection) => connection.id)).toEqual([HOUSE.id]);
  });

  it('deletes a connection whose id is not a legal file name', async () => {
    // `..` rather than a slash: `resolveWithin` resolves `a/b.json` happily
    // enough, and a probe that does not throw proves nothing about a probe that
    // does. This is the id somebody actually gets by pasting a path.
    await seedConnectionFile(
      layout.systemConnectionsRoot,
      { ...HOUSE, id: '../escape' },
      'odd.json',
    );

    // `connectionFile` runs the id through `resolveWithin`, which throws — so
    // the derived-path probe made this connection listable, editable and
    // undeletable, answering 500. `parseConnection` accepts any string id.
    expect(await deleteConnection(layout, layout.systemConnectionsRoot, '../escape')).toBe(1);
    expect(await listEntryNames(layout.systemConnectionsRoot)).toEqual([]);
  });
});

/**
 * **The capability overrides survive an edit, for the key's own reason.**
 *
 * Found by a readiness survey ahead of P2C rather than by a failure. The form
 * has no field for `capabilities` — [20 §5.3] makes them the operator saying
 * something about their own endpoint — so it sends none, and a write that took
 * `input.capabilities` alone deleted what was on disk on every rename.
 *
 * `capabilities` is where `maxContextTokens` and `reportsUsage` live, which are
 * exactly the two an operator hand-writes because their local runtime does not
 * match the conservative baseline. A rename turned a working install into one
 * that truncates at 8192 and reports no usage.
 */
describe('an edit that mentions no capabilities', () => {
  it('keeps the ones on disk, the same way it keeps the key', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, {
      ...HOUSE,
      capabilities: { maxContextTokens: 32768, reportsUsage: true },
    });

    await writeConnection(layout, layout.systemConnectionsRoot, {
      id: HOUSE.id,
      label: 'Renamed',
      provider: 'openai-compatible',
      models: ['gpt-hi'],
    });

    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    expect(usable[0]?.label).toBe('Renamed');
    expect(usable[0]?.capabilities).toEqual({ maxContextTokens: 32768, reportsUsage: true });
    // And the key is still there, so the two are preserved by one rule rather
    // than by two that can drift.
    expect(usable[0]?.apiKey).toBe('sk-do-not-leak');
  });

  it('replaces them when the caller does send some', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, {
      ...HOUSE,
      capabilities: { maxContextTokens: 32768 },
    });

    await writeConnection(layout, layout.systemConnectionsRoot, {
      id: HOUSE.id,
      label: 'The house key',
      provider: 'openai-compatible',
      models: ['gpt-hi'],
      capabilities: { maxContextTokens: 8192 },
    });

    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    expect(usable[0]?.capabilities).toEqual({ maxContextTokens: 8192 });
  });
});

/**
 * ***Which models see pictures survives an edit on the same terms, and is
 * narrowed to the models being written*** — [26 E15], R1.
 *
 * `imageModels` sits beside `models` rather than inside `capabilities`, and the
 * reason is this describe block: the form writes `models` fresh on every save
 * and keeps what it does not send, so a list inside `capabilities` would go on
 * naming models the connection no longer has. Two rules, then, and each has a
 * failure that looks like nothing at all until a picture is attached:
 *
 * - **absent means keep**, the capabilities' rule and the key's. A form that
 *   predates the field sends none, and a write that took the input alone
 *   would quietly turn every vision model on the connection into one that
 *   does not see the moment somebody renamed it;
 * - **the list is always a subset of `models`**. A model removed from the
 *   connection cannot stay marked as one that sees: nothing resolves to it, and
 *   a list that kept it would be a claim about nothing — until a model of the
 *   same name came back with different eyes.
 */
describe('an edit that mentions no image models', () => {
  const SEEING = { ...HOUSE, imageModels: ['gpt-hi'] };

  it('keeps the list on disk, the same way it keeps the capabilities', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, SEEING);

    await writeConnection(layout, layout.systemConnectionsRoot, {
      id: HOUSE.id,
      label: 'Renamed',
      provider: 'openai-compatible',
      models: ['gpt-hi', 'gpt-lo'],
    });

    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    expect(usable[0]?.label).toBe('Renamed');
    expect(usable[0]?.imageModels).toEqual(['gpt-hi']);
    // Per model, which is the field's whole reason: the other model on the same
    // connection still does not see. A connection-wide reading of the list
    // would send pixels to it the moment the narrator was rebound.
    expect(seesImages(usable[0]!, 'gpt-hi')).toBe(true);
    expect(seesImages(usable[0]!, 'gpt-lo')).toBe(false);
  });

  /**
   * ***Kept, and narrowed to what is being written.*** The one model that saw
   * is taken off the connection by an edit that mentions no image models; what
   * is left is the empty list, and the model that remains does not see. The
   * mutation is a kept list that is not filtered — `input.imageModels ??
   * existing?.imageModels` alone — which leaves `gpt-hi` marked on a connection
   * that no longer offers it.
   */
  it('narrows the kept list to the models being written', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, SEEING);

    await writeConnection(layout, layout.systemConnectionsRoot, {
      id: HOUSE.id,
      label: 'The house key',
      provider: 'openai-compatible',
      models: ['gpt-lo'],
    });

    // Read off disk as well as through the resolver, because the resolver
    // narrows on the way in (below) and would hide a writer that did not.
    const [file] = await listEntryNames(layout.systemConnectionsRoot);
    const onDisk = JSON.parse(
      await readFile(join(layout.systemConnectionsRoot, String(file)), 'utf8'),
    ) as { imageModels?: string[] };
    expect(onDisk.imageModels).toEqual([]);
    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    expect(usable[0]?.imageModels).toEqual([]);
    expect(seesImages(usable[0]!, 'gpt-lo')).toBe(false);
  });

  /**
   * ***A list the caller does send is narrowed too***, and replaces what is
   * stored rather than merging with it — the empty list is how a form says
   * *none of these see*, and it has to be able to say it.
   */
  it('drops a model the connection does not offer, and takes an empty list as none', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, SEEING);

    await writeConnection(layout, layout.systemConnectionsRoot, {
      id: HOUSE.id,
      label: 'The house key',
      provider: 'openai-compatible',
      models: ['gpt-hi', 'gpt-lo'],
      imageModels: ['gpt-lo', 'gpt-vision-preview'],
    });
    let { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    expect(usable[0]?.imageModels).toEqual(['gpt-lo']);

    await writeConnection(layout, layout.systemConnectionsRoot, {
      id: HOUSE.id,
      label: 'The house key',
      provider: 'openai-compatible',
      models: ['gpt-hi', 'gpt-lo'],
      imageModels: [],
    });
    ({ usable } = await resolveConnections(layout, 'ned', ALLOWED));
    expect(usable[0]?.imageModels).toEqual([]);
  });

  /**
   * ***A hand-written file is read on the same terms***, because nothing
   * stops a person typing a model the connection does not offer, or a number:
   * the reader keeps the strings that name one of `models` and nothing else.
   * And the list reaches both shapes that leave the server — it is what a
   * person choosing a binding wants to know, and safe to show for `models`'
   * own reason.
   */
  it('reads a hand-written list as a subset of the models, and shows it', async () => {
    await seedConnectionFile(layout.systemConnectionsRoot, {
      ...HOUSE,
      imageModels: ['gpt-lo', 'retired-model', 7],
    });

    const { usable } = await resolveConnections(layout, 'ned', ALLOWED);
    const connection = usable[0]!;
    expect(connection.imageModels).toEqual(['gpt-lo']);
    expect(presentConnection(connection).imageModels).toEqual(['gpt-lo']);
    expect(presentForAdmin(connection, 'sha256:whatever').imageModels).toEqual(['gpt-lo']);
  });
});
