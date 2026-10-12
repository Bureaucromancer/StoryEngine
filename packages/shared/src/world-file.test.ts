// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  firstLocalEntry,
  readWorldFileManifest,
  WORLD_FILE_SCHEMA,
  type WorldFileManifest,
  worldFileName,
} from './world-file.js';

/**
 * ***The World file's two shared readers*** —
 * [16 §5.1](../../../docs/design/16-publish.md), [P16.3c].
 *
 * Both run before anything else about a file is known: the head parser on the
 * first bytes a person picked (P16.3f slices the manifest with it), the
 * manifest reader on what that slice parses to. So each is tested against the
 * shapes it will actually be handed — another zip's first member, a streamed
 * entry, a cut-off head, a manifest from a build that does not exist yet.
 */

const encoder = new TextEncoder();

/**
 * One local header and its data, as a writer other than ours would put it —
 * built by hand, so the parser is not proved against the writer it serves.
 */
function local(
  name: string,
  data: Uint8Array,
  options: { method?: number; flags?: number; extra?: number; size?: number } = {},
): Uint8Array {
  const encoded = encoder.encode(name);
  const extra = options.extra ?? 0;
  const out = new Uint8Array(30 + encoded.length + extra + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, options.flags ?? 0x0800, true);
  view.setUint16(8, options.method ?? 0, true);
  view.setUint32(18, options.size ?? data.length, true);
  view.setUint32(22, options.size ?? data.length, true);
  view.setUint16(26, encoded.length, true);
  view.setUint16(28, extra, true);
  out.set(encoded, 30);
  out.set(data, 30 + encoded.length + extra);
  return out;
}

describe('firstLocalEntry', () => {
  it('reads a stored first member, and its size slices exactly its bytes', () => {
    const data = encoder.encode('{"schema":"storyengine.world-file/1"}');
    const head = local('storyengine-world.json', data, { extra: 4 });
    const entry = firstLocalEntry(head);
    expect(entry).toEqual({
      name: 'storyengine-world.json',
      method: 0,
      flags: 0x0800,
      // The extra field is skipped, from the local header's own length.
      dataStart: 30 + 'storyengine-world.json'.length + 4,
      size: data.length,
    });
    expect(head.subarray(entry!.dataStart, entry!.dataStart + entry!.size)).toEqual(data);
  });

  it('reports a deflated member as deflated, for the caller to refuse', () => {
    const entry = firstLocalEntry(
      local('storyengine-world.json', new Uint8Array(8), { method: 8 }),
    );
    expect(entry?.method).toBe(8);
  });

  it('reports bit 3 as set, with the size the header wrote rather than a real one', () => {
    // A streaming writer leaves the local sizes zero and puts the real ones
    // after the data; the flag is the caller's only warning.
    const entry = firstLocalEntry(
      local('storyengine-world.json', new Uint8Array(40), { flags: 0x0808, size: 0 }),
    );
    expect(entry).toMatchObject({ flags: 0x0808, size: 0 });
    expect((entry!.flags & 0x0008) !== 0).toBe(true);
  });

  it('is null for a head cut inside the header or the name', () => {
    const whole = local('storyengine-world.json', encoder.encode('{}'));
    expect(firstLocalEntry(whole.subarray(0, 29))).toBeNull();
    expect(firstLocalEntry(whole.subarray(0, 30 + 5))).toBeNull();
    // Cut inside the data is not the header's business: the caller compares
    // `dataStart + size` with what it holds.
    expect(firstLocalEntry(whole.subarray(0, 30 + 22))?.name).toBe('storyengine-world.json');
  });

  it('is null for what is not a zip, and reads another zip’s first member as itself', () => {
    expect(firstLocalEntry(encoder.encode('{"schema":"storyengine.world-file/1"}'))).toBeNull();
    expect(firstLocalEntry(new Uint8Array(0))).toBeNull();
    expect(firstLocalEntry(local('manifest.json', encoder.encode('{}')))?.name).toBe(
      'manifest.json',
    );
  });

  it('reads a view into a larger buffer at its own offset', () => {
    const header = local('storyengine-world.json', encoder.encode('{}'));
    const padded = new Uint8Array(header.length + 7);
    padded.set(header, 7);
    expect(firstLocalEntry(padded.subarray(7))?.name).toBe('storyengine-world.json');
  });
});

function manifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  const document: WorldFileManifest = {
    schema: WORLD_FILE_SCHEMA,
    exportedBy: { version: '1.0.0-alpha.7', at: '2026-10-10T12:00:00.000Z' },
    origin: 'world',
    world: {
      schema: 'storyengine.world/1',
      id: 'w-1',
      name: 'Rain City',
      folder: 'library/worlds/rain-city',
      file: 'library/worlds/rain-city/world.json',
      contentHash: 'sha256:00',
      member: false,
      description: '',
    },
    objects: [
      {
        schema: 'storyengine.actor/1',
        id: 'a-1',
        name: 'Vera',
        folder: 'library/actors/vera',
        file: 'library/actors/vera/card.png',
        contentHash: 'sha256:11',
        member: true,
      },
    ],
    sessions: [
      {
        id: 's-1',
        name: 'Night one',
        folder: 'sessions/s-1',
        turns: 3,
        headTurnId: 't-3',
        pictures: 1,
        attachments: 0,
        mode: 'scene',
      },
    ],
    leftBehind: [],
    requires: { modes: [], extensions: [], capabilities: [] },
    history: false,
    omitted: [],
  };
  return { ...document, ...over };
}

describe('readWorldFileManifest', () => {
  it('reads a manifest this build wrote', () => {
    const read = readWorldFileManifest(manifest());
    expect('refusal' in read).toBe(false);
  });

  it('refuses a wrong schema, and the next version of this one', () => {
    expect(readWorldFileManifest(manifest({ schema: 'storyengine.package-export/1' }))).toEqual({
      refusal: 'wrong-schema',
    });
    expect(readWorldFileManifest(manifest({ schema: 'storyengine.world-file/2' }))).toEqual({
      refusal: 'wrong-schema',
    });
    expect(readWorldFileManifest(manifest({ schema: undefined }))).toEqual({
      refusal: 'wrong-schema',
    });
  });

  it('keeps fields it has never heard of, at every level', () => {
    const document = manifest({ addedLater: { deep: [1] } });
    (document['objects'] as Record<string, unknown>[])[0]!['alsoLater'] = true;
    const read = readWorldFileManifest(document);
    expect(read).toEqual(document);
    expect((read as unknown as Record<string, unknown>)['addedLater']).toEqual({ deep: [1] });
  });

  it('reads a file with no World — one object, or a snapshot', () => {
    expect('refusal' in readWorldFileManifest(manifest({ world: null, origin: 'object' }))).toBe(
      false,
    );
  });

  it.each([
    ['not an object', null],
    ['an array', []],
    ['no exportedBy', manifest({ exportedBy: undefined })],
    ['a numeric version', manifest({ exportedBy: { version: 7, at: 'now' } })],
    ['an unknown origin', manifest({ origin: 'package' })],
    [
      'a World with no description',
      manifest({ world: { ...manifest()['world']!, description: 1 } }),
    ],
    ['objects that are not a list', manifest({ objects: {} })],
    ['an object with no contentHash', manifest({ objects: [{ schema: 'x', id: 'a' }] })],
    ['a session with no folder', manifest({ sessions: [{ id: 's', name: 'n' }] })],
    ['no leftBehind', manifest({ leftBehind: undefined })],
    ['no omitted', manifest({ omitted: undefined })],
    ['a history that is not a boolean', manifest({ history: 'yes' })],
    ['requires with no capabilities', manifest({ requires: { modes: [], extensions: [] } })],
  ])('refuses %s as unreadable', (_, document) => {
    expect(readWorldFileManifest(document)).toEqual({ refusal: 'unreadable' });
  });
});

describe('worldFileName', () => {
  it.each([
    ['Rain City', 'Rain-City.seworld'],
    ['Ciudad de la lluvia — v2', 'Ciudad-de-la-lluvia-v2.seworld'],
    // The curly apostrophe is not ASCII, so it goes before the hyphens are made.
    ['Verá’s harbour', 'Veras-harbour.seworld'],
    ['灯台', 'world.seworld'],
    ['', 'world.seworld'],
    ['a'.repeat(59) + ' b', `${'a'.repeat(59)}.seworld`],
  ])('names %j as %j', (name, expected) => {
    expect(worldFileName(name)).toBe(expected);
  });
});
