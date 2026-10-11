// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  LOREBOOK_SCHEMA,
  newLorebook,
  newWorld,
  uuidv7,
  WORLD_SCHEMA,
  type World,
} from '@storyengine/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { create, read } from '../../library.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import { landWorld, type WorldLanding, type WorldStore } from './landing.js';

/**
 * ***`landWorld` names what is here, not what was planned*** —
 * [P16.3e](../../../../../docs/design/workplan/35-p16-world.md),
 * [16 §5.1](../../../../../docs/design/16-publish.md).
 *
 * The reader already marks a member it refused itself (`landedId: null`), so
 * through `sweep()` that arm hides the other: a member the plan expected to
 * land and the **library** refused — a create conflict from a race, no room,
 * a disk error — reaches the landing with a planned id that names nothing
 * this account has. The P16.3e review found no test where the landing's own
 * check decided; this asks it directly, with a store that writes what it is
 * handed and nothing else.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'amy');
});

afterEach(async () => {
  await server.dispose();
});

/** The Writer's door, by shape: the World it is handed is created, as `store` would. */
function storeOf(): WorldStore & { written: World[] } {
  const written: World[] = [];
  return {
    written,
    async store(object, schemaId) {
      written.push(object as unknown as World);
      await create(server.services.library, 'amy', object, schemaId);
      return 'created';
    },
  };
}

describe('the World’s contents', () => {
  it('leaves out a member whose planned id the library never took, and says so', async () => {
    const library = server.services.library;
    const landed = newLorebook('Harbour');
    await create(library, 'amy', landed, LOREBOOK_SCHEMA);
    // Planned to land under this id; the library refused it, so nothing is here.
    const refusedByLibrary = uuidv7();
    const world: World = { ...newWorld('Rain City'), contents: [] };
    const payload: WorldLanding = {
      source: 'library/worlds/rain-city/world.json',
      fileId: world.id,
      body: world,
      arrival: { landedId: world.id, decision: 'new', keptBoth: false, local: null },
      entries: [
        { fileId: landed.id, schema: LOREBOOK_SCHEMA, name: 'Harbour', landedId: landed.id },
        {
          fileId: uuidv7(),
          schema: LOREBOOK_SCHEMA,
          name: 'Lanterns',
          landedId: refusedByLibrary,
        },
      ],
      requires: { modes: [], extensions: [], capabilities: [] },
      omitted: [],
    };
    const writer = storeOf();

    const { row } = await landWorld(
      writer,
      { library, handle: 'amy', policy: 'replace' },
      payload,
      new Map(),
    );

    const stored = read(library, 'amy', world.id, WORLD_SCHEMA).body as World;
    expect(stored.contents.map((entry) => entry.id)).toEqual([landed.id]);
    expect(stored.contents.map((entry) => entry.id)).not.toContain(refusedByLibrary);
    expect(row.notes).toContainEqual({
      key: 'import.world.memberNotLanded',
      params: { member: 'Lanterns' },
      level: 'warn',
    });
    expect(row.notes[0]).toEqual({
      key: 'import.world.landed',
      params: { world: 'Rain City', members: 1, sessions: 0 },
      level: 'info',
    });
  });
});
