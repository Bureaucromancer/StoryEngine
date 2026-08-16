// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import {
  ACTOR_SCHEMA,
  type Actor,
  type Lorebook,
  newActor,
  type PortableSchemaId,
} from '@storyengine/shared';

import {
  selfWrites,
  writeAtomic,
  writeJsonAtomic,
  type SelfWriteRegistry,
} from '../storage/atomic.js';
import { envelope, pngCardCodec } from '../storage/card/index.js';
import { makePng } from '../storage/card/test-png.js';
import { Layout, type LibraryScope, userScope } from '../storage/layout.js';
import { ingestFile } from './ingest.js';
import { openIndex, type OpenedIndex } from './open.js';

/**
 * A real data directory on disk, for the index tests.
 *
 * **The filesystem is not mocked** ([testing §8](../../../../docs/design/workplan/10-testing.md)): the
 * storage layer *is* the thing under test, so these use temporary directories.
 * A mock would let the index agree with a fiction.
 */

export interface TestLibrary {
  layout: Layout;
  index: OpenedIndex;
  db: DatabaseSync;
  scope: LibraryScope;
  /** Writes an object to disk *without* telling the index — a foreign write. */
  writeObject: (object: Actor | Lorebook, slug: string, scope?: LibraryScope) => Promise<string>;
  /** Writes and indexes, the way a route does — synchronous, read-after-write. */
  saveObject: (object: Actor | Lorebook, slug: string, scope?: LibraryScope) => Promise<string>;
  dispose: () => Promise<void>;
}

export async function makeTestLibrary(
  options: { registry?: SelfWriteRegistry; indexPath?: string } = {},
): Promise<TestLibrary> {
  const root = await mkdtemp(join(tmpdir(), 'se-index-'));
  const layout = new Layout(root);
  const scope = userScope('ned');
  const index = await openIndex({ path: options.indexPath ?? layout.indexFile });
  // Resolved once rather than passed through as `registry: undefined`, which
  // `exactOptionalPropertyTypes` correctly refuses.
  const registry = options.registry ?? selfWrites;

  async function writeObject(
    object: Actor | Lorebook,
    slug: string,
    at: LibraryScope = scope,
  ): Promise<string> {
    const schemaId = object.schema as PortableSchemaId;
    const path = layout.objectFile(at, schemaId, slug);

    if (schemaId === ACTOR_SCHEMA) {
      // Through the real codec, so the index is reading a genuine card rather
      // than a stand-in that happens to parse.
      const png = pngCardCodec.write(makePng(), envelope(object));
      await writeAtomic(path, png, { registry, suppressWatcher: false });
    } else {
      await writeJsonAtomic(path, object, { registry, suppressWatcher: false });
    }

    return path;
  }

  async function saveObject(
    object: Actor | Lorebook,
    slug: string,
    at: LibraryScope = scope,
  ): Promise<string> {
    const schemaId = object.schema as PortableSchemaId;
    const path = layout.objectFile(at, schemaId, slug);

    if (schemaId === ACTOR_SCHEMA) {
      const png = pngCardCodec.write(makePng(), envelope(object));
      await writeAtomic(path, png, { registry });
    } else {
      await writeJsonAtomic(path, object, { registry });
    }

    await ingestFile(index.db, layout, path);
    return path;
  }

  return {
    layout,
    index,
    db: index.db,
    scope,
    writeObject,
    saveObject,
    dispose: async () => {
      index.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** An actor with a fixed id, so a test can put the same uuid in two places. */
export function actorWithId(name: string, id: string): Actor {
  return { ...newActor(name), id };
}
