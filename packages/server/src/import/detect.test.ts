// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyRoot, MARINARA_LIVE_MARKS, probeMarks } from './detect.js';
import { marinaraFixture } from './fixtures/test-marinara.js';
import { sillyTavernFixture } from './fixtures/test-sillytavern.js';
import { MARINARA_KNOWN_FORMAT } from './marinara/store-format.js';
import { MARINARA_TABLES } from './registries/marinara.js';
import { MemoryFileSource } from './memory-source.js';

/**
 * **A root is what it probes as, never what somebody typed** ([P4 §1.3]).
 *
 * The stakes are why this is tested before any converter exists: a wrong guess
 * converts a library through the wrong tables, and the review reports that it
 * went fine. Every case below is one a real directory can be in.
 */

function marinaraRoot(extra: Record<string, string> = {}): MemoryFileSource {
  return new MemoryFileSource({
    'storage/manifest.json': JSON.stringify({ version: 2, backend: 'file-native', tables: {} }),
    'storage/tables/characters.json': '[]',
    ...extra,
  });
}

function sillyTavernRoot(extra: Record<string, string> = {}): MemoryFileSource {
  return new MemoryFileSource({
    'settings.json': '{}',
    'characters/vera.png': 'not really a png',
    'worlds/rain-city.json': '{}',
    ...extra,
  });
}

describe('classifying a root', () => {
  it('knows a SillyTavern user directory by its settings file and its two library folders', async () => {
    expect(await classifyRoot(sillyTavernRoot())).toEqual({ ok: true, kind: 'sillytavern' });
  });

  it('knows a Marinara data root by its table store', async () => {
    expect(await classifyRoot(marinaraRoot())).toEqual({ ok: true, kind: 'marinara' });
  });

  it('knows a Marinara store whose manifest was lost, because the app would open it too', async () => {
    // Recovered from `.bak` or inferred from the tables — so requiring the
    // manifest would refuse a directory Marinara itself reads.
    const root = new MemoryFileSource({ 'storage/tables/characters.json': '[]' });

    expect(await classifyRoot(root)).toEqual({ ok: true, kind: 'marinara' });
  });

  it('classifies a folder of loose cards rather than refusing it', async () => {
    // No probe matching is not an error. This is the walker's plain mode, and
    // the folder of cards somebody assembled by hand is a real thing to have.
    //
    // ~~sweeps~~ **classifies**, renamed at the P4 audit ([P4 §7.8]). This case
    // has only ever asserted the verdict, and for three stages its old name was
    // the only thing claiming a loose folder converted — which it did not. The
    // behaviour now lives in `loose-files.test.ts`, and this says what it checks.
    const root = new MemoryFileSource({ 'vera.png': 'x', 'rain-city.json': '{}' });

    expect(await classifyRoot(root)).toEqual({ ok: true, kind: 'loose-files' });
  });

  it('refuses a root that probes as two things rather than picking one', async () => {
    const both = new MemoryFileSource({
      'settings.json': '{}',
      'characters/vera.png': 'x',
      'worlds/rain-city.json': '{}',
      'storage/tables/characters.json': '[]',
    });

    const verdict = await classifyRoot(both);

    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ refusal: 'ambiguous-root' });
  });

  it('refuses a live Marinara, because reading one produces a torn library quietly', async () => {
    expect(await classifyRoot(marinaraRoot({ 'storage/.writer-lease/owner.json': '{}' }))).toEqual({
      ok: false,
      refusal: 'live-install',
    });
  });

  /**
   * **Per table, which is where Marinara writes it.** ~~`storage/.migrating`~~
   * was the path this checked until 2026-09-22 ([P4 §7.18]), and no version of
   * Marinara has ever written it — so the refusal that exists to stop a torn read
   * could not fire. Both a table the reader converts and one it does not are
   * probed, because a migration in progress anywhere means the store as a whole
   * is mid-change.
   */
  it('refuses a store part-way through its shard migration, in any table', async () => {
    for (const table of ['characters', 'messages']) {
      expect(
        await classifyRoot(marinaraRoot({ [`storage/tables/${table}/.migrating`]: '' })),
        table,
      ).toEqual({ ok: false, refusal: 'live-install' });
    }
  });

  it('probes every registry table, and the writer lease', () => {
    expect(MARINARA_LIVE_MARKS).toHaveLength(MARINARA_TABLES.length + 1);
    expect(MARINARA_LIVE_MARKS).toContain('storage/.writer-lease');
    expect(MARINARA_LIVE_MARKS).not.toContain('storage/.migrating');
  });

  /**
   * The launcher's marker is not a live install: only the launcher removes it,
   * and an interrupted unshard followed by an ordinary restart leaves it for good
   * beside a perfectly readable store. It is a note on the review instead.
   */
  it('does not refuse over an unfinished offline unshard', async () => {
    expect(await classifyRoot(marinaraRoot({ 'storage/tables/.unshard-in-progress': '' }))).toEqual(
      { ok: true, kind: 'marinara' },
    );
  });

  it('refuses a storage format newer than this build knows', async () => {
    const future = marinaraRoot({
      'storage/manifest.json': JSON.stringify({ version: MARINARA_KNOWN_FORMAT + 1, tables: {} }),
    });

    expect(await classifyRoot(future)).toEqual({ ok: false, refusal: 'unknown-format' });
  });

  it('accepts the format it knows, and every older one', async () => {
    for (let version = 1; version <= MARINARA_KNOWN_FORMAT; version += 1) {
      const root = marinaraRoot({
        'storage/manifest.json': JSON.stringify({ version, tables: {} }),
      });

      expect(await classifyRoot(root), `format ${String(version)}`).toEqual({
        ok: true,
        kind: 'marinara',
      });
    }
  });

  /** The version a v2.4.x install actually writes, which is what started this. */
  it('accepts storage formats 5, 6 and 7', async () => {
    for (const version of [5, 6, 7]) {
      const root = marinaraRoot({ 'storage/manifest.json': JSON.stringify({ version }) });

      expect(await classifyRoot(root), `format ${String(version)}`).toEqual({
        ok: true,
        kind: 'marinara',
      });
    }
  });
});

/**
 * ***An Aventuras install is its database*** —
 * [P13.2](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * The probe asks for `aventura.db` and nothing else, which is only safe if no
 * other kind's root can carry that name and no Aventuras root can carry another
 * kind's marks. **Two probes matching refuses**, so a collision would not
 * misread anybody's library — it would refuse it, which is the failure these
 * tests exist to keep from shipping.
 */
describe('classifying an Aventuras root', () => {
  /** Every kind the probe table knows, which is what the ambiguity check walks. */
  const KINDS = ['sillytavern', 'marinara', 'charx', 'storyengine-backup', 'aventuras'] as const;

  /** A root of each kind, as its own fixture or its own minimal marks build it. */
  const ROOTS: Record<(typeof KINDS)[number], () => MemoryFileSource> = {
    sillytavern: () => new MemoryFileSource(sillyTavernFixture()),
    marinara: () => new MemoryFileSource(marinaraFixture()),
    charx: () => new MemoryFileSource({ 'card.json': '{}', 'assets/icon/images/main.png': 'png' }),
    'storyengine-backup': () => new MemoryFileSource({ 'backup.json': '{}' }),
    aventuras: () => new MemoryFileSource({ 'aventura.db': 'SQLite format 3\0' }),
  };

  it('knows a folder by its database alone', async () => {
    expect(await classifyRoot(ROOTS.aventuras())).toEqual({ ok: true, kind: 'aventuras' });
  });

  it('knows a backup, and a config directory with Aventuras still open in it', async () => {
    const backup = new MemoryFileSource({ 'aventura.db': 'x', 'metadata.json': '{}' });
    const running = new MemoryFileSource({
      'aventura.db': 'x',
      'aventura.db-wal': 'x',
      'aventura.db-shm': 'x',
    });

    expect(await classifyRoot(backup)).toEqual({ ok: true, kind: 'aventuras' });
    // A `-wal` is never a refusal (§1.2): every open app and every crash leaves one.
    expect(await classifyRoot(running)).toEqual({ ok: true, kind: 'aventuras' });
  });

  it('reads an old backup of `.avt` files and no database as loose files, which it is', async () => {
    const old = new MemoryFileSource({ 'stories/bell.avt': '{}', 'metadata.json': '{}' });

    expect(await classifyRoot(old)).toEqual({ ok: true, kind: 'loose-files' });
  });

  it.each(KINDS)('matches only its own probe for a %s root', async (kind) => {
    const root = ROOTS[kind]();
    const matched: string[] = [];
    for (const probe of KINDS) {
      if (await probeMarks(root, probe)) matched.push(probe);
    }

    expect(matched).toEqual([kind]);
    expect(await classifyRoot(root)).toMatchObject({ ok: true, kind });
  });

  it('walks every kind the probe table has, so the next probe cannot skip this check', () => {
    // Read off the table itself, the way the client's verdict test does: a
    // probe added without a root above would otherwise never be asked whether
    // it collides with this one.
    const source = readFileSync(join(import.meta.dirname, 'detect.ts'), 'utf8');
    const probed = [...source.matchAll(/\{ kind: '([a-z-]+)', requires:/g)].map((m) => m[1]);

    expect([...probed].sort()).toEqual([...KINDS].sort());
  });

  it('never reads the database to classify it — the folder plan has names and no bytes', async () => {
    // A declared path answers `exists` and reads `null`, which is exactly what
    // the directory plan hands the classifier.
    const named = new MemoryFileSource({}, ['aventura.db', 'metadata.json']);

    expect(await classifyRoot(named)).toEqual({ ok: true, kind: 'aventuras' });
  });
});

/**
 * ~~`readMarinaraFormat`~~ went at [P4 §7.18] (2026-09-22): the manifest is read
 * once, by `marinara/store.ts`'s `readMarinaraManifest`, which falls back to the
 * `.bak` as Marinara's own gate does, and whose absent, unparseable and
 * non-numeric cases are tested beside it. What is left to say here is the
 * pre-flight's half — that a manifest it cannot read is not a refusal, since the
 * application recovers one — which the old describe only implied.
 */
describe('a Marinara manifest the pre-flight cannot read', () => {
  it('is not a refusal when it will not parse, because Marinara recovers one', async () => {
    const torn = marinaraRoot({ 'storage/manifest.json': '{ broken' });

    expect(await classifyRoot(torn)).toEqual({ ok: true, kind: 'marinara' });
  });
});
