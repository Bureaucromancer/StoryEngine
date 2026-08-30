// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { classifyRoot, MARINARA_KNOWN_FORMAT, readMarinaraFormat } from './detect.js';
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

  it('sweeps a folder of loose cards rather than refusing it', async () => {
    // No probe matching is not an error. This is the walker's plain mode, and
    // the folder of cards somebody assembled by hand is a real thing to have.
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
    expect(await classifyRoot(marinaraRoot({ 'storage/.writer-lease': 'held' }))).toEqual({
      ok: false,
      refusal: 'live-install',
    });
  });

  it('refuses a store part-way through its shard migration', async () => {
    expect(await classifyRoot(marinaraRoot({ 'storage/.migrating': '' }))).toEqual({
      ok: false,
      refusal: 'live-install',
    });
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
});

describe('reading the declared storage format', () => {
  it('is null when there is no manifest, and null when it is damaged', async () => {
    expect(await readMarinaraFormat(new MemoryFileSource({}))).toBeNull();
    expect(
      await readMarinaraFormat(new MemoryFileSource({ 'storage/manifest.json': '{ broken' })),
    ).toBeNull();
    expect(
      await readMarinaraFormat(
        new MemoryFileSource({ 'storage/manifest.json': '{"version":"4"}' }),
      ),
    ).toBeNull();
  });
});
