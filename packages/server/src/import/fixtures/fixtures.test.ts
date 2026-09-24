// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { classifyRoot } from '../detect.js';
import { MemoryFileSource } from '../memory-source.js';
import { MARINARA_DISPOSITIONS } from '../registries/marinara.js';
import { SILLYTAVERN_DISPOSITIONS } from '../registries/sillytavern.js';
import { classifyTablePath } from '../marinara/store-format.js';
import { marinaraFixture, marinaraShardedFixture } from './test-marinara.js';
import { sillyTavernFixture } from './test-sillytavern.js';

/**
 * **A fixture nobody has checked is a fixture that stops being one.**
 *
 * These roots are the whole corpus P4 gets ([P4 §1.2]), and they are synthesised
 * — so nothing but a test stops one drifting into a shape no real install has.
 * The assertions here are deliberately about *realism* rather than about
 * conversion: that each root is still recognisable as what it claims to be, and
 * that it still contains the awkward cases it was built to carry. The converters
 * that read them do not exist yet.
 */

describe('the SillyTavern fixture', () => {
  const tree = sillyTavernFixture();

  it('is recognised as a SillyTavern user directory', async () => {
    expect(await classifyRoot(new MemoryFileSource(tree))).toEqual({
      ok: true,
      kind: 'sillytavern',
    });
  });

  it('puts every file under a directory the registry has a disposition for', () => {
    // The fixture and the registry have to agree, or the corpus is exercising
    // paths the sweep has no answer for and the coverage test is answering
    // about somewhere else.
    const unknown = Object.keys(tree)
      .filter((path) => path.includes('/'))
      .map((path) => path.slice(0, path.lastIndexOf('/')))
      .filter((directory) => {
        // `chats/Vera Solano` sits under `chats`, and `worlds` has no nesting.
        const top = directory.split('/')[0] ?? directory;
        return (
          SILLYTAVERN_DISPOSITIONS[directory] === undefined &&
          SILLYTAVERN_DISPOSITIONS[top] === undefined
        );
      });

    expect(unknown, `no disposition covers: ${[...new Set(unknown)].join(', ')}`).toEqual([]);
  });

  it('carries the awkward cases it exists for', () => {
    const paths = Object.keys(tree);

    // A directory with a space, which is where a path bug shows first.
    expect(paths).toContain('OpenAI Settings/Harbour.json');
    // Personas, whose text lives in the settings file rather than beside them.
    expect(paths).toContain('User Avatars/inspector.png');
    // One poisoned file, so gate step 8 has something to survive.
    expect(paths).toContain('characters/broken.png');
  });

  it('contains a credential, because the gate tests for its absence afterwards', () => {
    // A corpus with no secret in it cannot fail a test that looks for one, and
    // a passing test over an empty premise is the failure mode gate step 3 is
    // most exposed to.
    const preset = new TextDecoder().decode(
      typeof tree['OpenAI Settings/Harbour.json'] === 'string'
        ? new TextEncoder().encode(tree['OpenAI Settings/Harbour.json'])
        : (tree['OpenAI Settings/Harbour.json'] ?? new Uint8Array()),
    );

    expect(preset).toContain('proxy_password');
  });
});

describe('the sharded Marinara fixture', () => {
  const tree = marinaraShardedFixture();

  it('is recognised as a Marinara data root', async () => {
    expect(await classifyRoot(new MemoryFileSource(tree))).toEqual({ ok: true, kind: 'marinara' });
  });

  /**
   * **The encoded names, spelled out.** The fixture builds them with the
   * production encoder, so a test that only asked the encoder would agree with
   * it by construction; these literals are what upstream writes for these ids,
   * and they pin the fixture to that rather than to our port of it.
   */
  it('names its shards the way Marinara names them', () => {
    const paths = Object.keys(tree);

    expect(paths).toContain('storage/tables/characters/char%5Fvera.json');
    expect(paths).toContain('storage/tables/lorebooks/book%5Frain%5Fcity.json.bak');
    expect(paths).not.toContain('storage/tables/lorebooks/book%5Frain%5Fcity.json');
  });

  it('holds nothing under storage/tables that the classifier does not recognise', () => {
    const unknown = Object.keys(tree)
      .filter((path) => path.startsWith('storage/tables/'))
      .filter((path) => classifyTablePath(path).role === 'unknown');

    expect(unknown).toEqual([]);
  });
});

describe('the Marinara fixture', () => {
  const tree = marinaraFixture();

  it('is recognised as a Marinara data root', async () => {
    expect(await classifyRoot(new MemoryFileSource(tree))).toEqual({ ok: true, kind: 'marinara' });
  });

  it('names only tables the registry has a disposition for', () => {
    // Asked of the same classifier the reader uses, rather than a second copy of
    // its rules — this file used to carry its own, which is how two answers to
    // "what table is this path" come to disagree.
    const tables = Object.keys(tree)
      .filter((path) => path.startsWith('storage/tables/'))
      .map((path) => classifyTablePath(path))
      .filter((found) => found.role === 'data')
      .map((found) => found.table ?? '');

    // `Object.hasOwn`, because a bare lookup answers `constructor` with a function.
    const unknown = tables.filter((table) => !Object.hasOwn(MARINARA_DISPOSITIONS, table));

    expect(unknown, `no disposition covers: ${[...new Set(unknown)].join(', ')}`).toEqual([]);
  });

  it('holds one table in the sharded layout and the rest flat', () => {
    const paths = Object.keys(tree);

    expect(paths).toContain('storage/tables/messages/chat_1.json');
    expect(paths).toContain('storage/tables/messages/orphaned-rows.json');
    expect(paths).toContain('storage/tables/characters.json');
  });

  it('declares a manifest version that disagrees with its own layout, on purpose', () => {
    // Marinara's own comment records that a crash between the shard migration
    // and its first flush leaves sharded data under a version-2 manifest. A
    // reader that trusts the manifest for the layout reads this install wrong.
    // ~~This fixture is the case that catches it.~~ *Corrected 2026-09-22
    // ([P4 §7.18]).* It never was: `messages` is recorded, not read, so no
    // reader ever opened the sharded table here. The case that catches it is
    // `marinaraShardedFixture({ version: 2 })`, swept in `marinara.test.ts`.
    const manifest = JSON.parse(String(tree['storage/manifest.json'])) as { version: number };

    expect(manifest.version).toBe(2);
    expect(Object.keys(tree)).toContain('storage/tables/messages/chat_1.json');
  });

  it('carries a `.bak` beside a table, which must not double the library', () => {
    expect(Object.keys(tree)).toContain('storage/tables/characters.json.bak');
  });

  it('stores its card double-encoded, which is the first thing a converter gets wrong', () => {
    const rows = JSON.parse(String(tree['storage/tables/characters.json'])) as { data: string }[];

    expect(typeof rows[0]?.data).toBe('string');
    expect(JSON.parse(rows[0]?.data ?? '{}')).toMatchObject({ name: 'Vera Solano' });
  });

  it('contains the credentials the gate tests for the absence of', () => {
    expect(Object.keys(tree)).toContain('storage/tables/api_connections.json');
    expect(Object.keys(tree)).toContain('.encryption-key');
  });
});
