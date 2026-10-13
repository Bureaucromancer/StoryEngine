// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  firstLocalEntry,
  WORLD_FILE_MANIFEST,
  WORLD_FILE_MANIFEST_MAX_BYTES,
} from '@storyengine/shared';

import { landedPreview, sniffImportFile } from './import-sniff.js';
import { MANIFEST_MAX_BYTES, MANIFEST_NAME, worldHeadOf } from './world-head.js';

/**
 * ***The look an archive gets without being sent*** —
 * [P13.8](../../../../docs/design/workplan/30-p13-aventuras-import.md)'s
 * amendment to P4's *a look, then a word*. The sniff must agree with the
 * server's about which files it lands, by bytes and never by name; the
 * preview must be the one the server would have sent.
 */

const bytes = (...parts: (string | number[])[]): Blob =>
  new Blob(
    parts.map((part) =>
      typeof part === 'string' ? new TextEncoder().encode(part) : new Uint8Array(part),
    ),
  );

describe('sniffing a picked file', () => {
  it('knows a zip by its first four bytes, whatever it is called', async () => {
    expect(await sniffImportFile(bytes([0x50, 0x4b, 0x03, 0x04], 'and the rest'))).toBe('zip');
  });

  it('knows a SQLite database by its sixteen-byte header', async () => {
    expect(await sniffImportFile(bytes('SQLite format 3', [0], 'pages'))).toBe('sqlite');
  });

  it('knows neither in anything else, or in a file shorter than a header', async () => {
    expect(await sniffImportFile(bytes('{"name":"Harbour"}'))).toBeNull();
    expect(await sniffImportFile(bytes([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(await sniffImportFile(bytes('SQLite format'))).toBeNull();
    expect(await sniffImportFile(bytes([0x50, 0x4b]))).toBeNull();
  });
});

describe('the preview made here', () => {
  it('is the one the server answers an archive with', () => {
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'aventura-backup.zip');
    expect(landedPreview(file)).toEqual({
      source: 'aventura-backup.zip',
      disposition: 'converted',
      notes: [
        {
          key: 'import.file.importsAsFolder',
          params: { file: 'aventura-backup.zip' },
          level: 'info',
        },
      ],
      advisories: [],
      object: { kind: 'sweep' },
      reimport: 'unknown',
    });
  });
});

/**
 * ***A zip, by hand*** — local headers, a central directory, the end record:
 * the three parts `worldHeadOf` reads, and nothing it does not (CRCs are
 * zero; nothing here checks one). Each entry may lie about its method, its
 * flags or its size, which is how the refusals are reached. `bytes` is the
 * data as the archive holds it — compressed, for a deflated entry, whose
 * `size` is then the size it inflates to; `localSizes: false` writes the
 * local header's sizes as zero, as a data descriptor's writer does, and
 * `centralMethod` lets the directory disagree with the header.
 */
function zipOf(
  entries: {
    name: string;
    bytes: Uint8Array;
    method?: number;
    centralMethod?: number;
    flags?: number;
    size?: number;
    compressed?: number;
    localSizes?: boolean;
  }[],
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const compressed = entry.compressed ?? entry.bytes.length;
    const size = entry.size ?? entry.bytes.length;
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(6, entry.flags ?? 0, true);
    view.setUint16(8, entry.method ?? 0, true);
    if (entry.localSizes !== false) {
      view.setUint32(18, compressed, true);
      view.setUint32(22, size, true);
    }
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    const record = new Uint8Array(46 + name.length);
    const at = new DataView(record.buffer);
    at.setUint32(0, 0x02014b50, true);
    at.setUint16(10, entry.centralMethod ?? entry.method ?? 0, true);
    at.setUint32(20, compressed, true);
    at.setUint32(24, size, true);
    at.setUint16(28, name.length, true);
    at.setUint32(42, offset, true);
    record.set(name, 46);
    parts.push(local, entry.bytes);
    central.push(record);
    offset += local.length + entry.bytes.length;
  }
  const directorySize = central.reduce((sum, one) => sum + one.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, directorySize, true);
  view.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((sum, one) => sum + one.length, 0));
  let at = 0;
  for (const one of all) {
    out.set(one, at);
    at += one.length;
  }
  return out;
}

const manifest = new TextEncoder().encode('{"schema":"storyengine.world-file/1"}');

/** Raw deflate both ways, by the platform's own streams — what a browser has. */
async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const card = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const bytesOf = async (blob: Blob | null): Promise<Uint8Array> =>
  new Uint8Array(await blob!.arrayBuffer());

describe('the head of a World’s file', () => {
  it('names the manifest and its ceiling as shared does — the slicer imports nothing', () => {
    expect(MANIFEST_NAME).toBe(WORLD_FILE_MANIFEST);
    expect(MANIFEST_MAX_BYTES).toBe(WORLD_FILE_MANIFEST_MAX_BYTES);
  });

  it('slices a stored manifest at the head: its local header and its bytes, and nothing after', async () => {
    const zip = zipOf([
      { name: WORLD_FILE_MANIFEST, bytes: manifest },
      { name: 'library/actors/vera/card.png', bytes: card },
    ]);

    const head = await bytesOf(await worldHeadOf(new Blob([zip])));

    expect(head.length).toBe(30 + WORLD_FILE_MANIFEST.length + manifest.length);
    expect(head).toEqual(zip.subarray(0, head.length));
    const entry = firstLocalEntry(head);
    expect(entry?.name).toBe(WORLD_FILE_MANIFEST);
    expect(head.subarray(entry!.dataStart)).toEqual(manifest);
  });

  it('finds a manifest that is not first by the archive’s directory, and slices from its header', async () => {
    const zip = zipOf([
      { name: 'library/actors/vera/card.png', bytes: card },
      { name: WORLD_FILE_MANIFEST, bytes: manifest },
    ]);
    const at = 30 + 'library/actors/vera/card.png'.length + card.length;

    const head = await bytesOf(await worldHeadOf(new Blob([zip])));

    expect(head).toEqual(zip.subarray(at, at + 30 + WORLD_FILE_MANIFEST.length + manifest.length));
    expect(firstLocalEntry(head)?.name).toBe(WORLD_FILE_MANIFEST);
  });

  /**
   * ***Zipped again by a tool*** (2026-10-11, the P16.3f review): deflated,
   * sorted so the manifest is last, and — from a library writing to a stream —
   * its sizes in a data descriptor, so only the directory has them. The slice
   * is the header and the **compressed** bytes, which the server inflates.
   */
  it('slices a deflated manifest — first, last, or with its sizes after its data', async () => {
    const deflated = await deflateRaw(manifest);
    const header = 30 + WORLD_FILE_MANIFEST.length;
    const member = { name: WORLD_FILE_MANIFEST, bytes: deflated, method: 8, size: manifest.length };
    const cardMember = { name: 'library/actors/vera/card.png', bytes: card };
    const cardBytes = 30 + cardMember.name.length + card.length;
    const cases: [string, Uint8Array<ArrayBuffer>, number][] = [
      ['first', zipOf([member, cardMember]), 0],
      ['last', zipOf([cardMember, member]), cardBytes],
      [
        'first, sizes after',
        zipOf([{ ...member, flags: 0x0008, localSizes: false }, cardMember]),
        0,
      ],
      [
        'last, sizes after',
        zipOf([cardMember, { ...member, flags: 0x0008, localSizes: false }]),
        cardBytes,
      ],
    ];
    for (const [what, zip, at] of cases) {
      const head = await bytesOf(await worldHeadOf(new Blob([zip])));
      expect(head, what).toEqual(zip.subarray(at, at + header + deflated.length));
      expect(firstLocalEntry(head), what).toMatchObject({ name: WORLD_FILE_MANIFEST, method: 8 });
      expect(await inflateRaw(head.subarray(header)), what).toEqual(manifest);
    }
  });

  it('is null for another method, sizes it cannot know, one past its ceiling, or none', async () => {
    const deflated = await deflateRaw(manifest);
    const cases: [string, Uint8Array<ArrayBuffer>][] = [
      [
        'bzip2',
        zipOf([{ name: WORLD_FILE_MANIFEST, bytes: manifest, method: 12, centralMethod: 12 }]),
      ],
      [
        'a directory that disagrees about the method',
        zipOf([
          { name: 'card.png', bytes: card },
          { name: WORLD_FILE_MANIFEST, bytes: deflated, method: 8, centralMethod: 0 },
        ]),
      ],
      [
        'bit 3, and no directory to ask',
        zipOf([
          { name: WORLD_FILE_MANIFEST, bytes: manifest, flags: 0x0008, localSizes: false },
        ]).subarray(0, 30 + WORLD_FILE_MANIFEST.length + manifest.length),
      ],
      [
        'oversize',
        zipOf([
          { name: WORLD_FILE_MANIFEST, bytes: manifest, size: WORLD_FILE_MANIFEST_MAX_BYTES + 1 },
        ]),
      ],
      [
        'inflating past the ceiling',
        zipOf([
          {
            name: WORLD_FILE_MANIFEST,
            bytes: deflated,
            method: 8,
            size: WORLD_FILE_MANIFEST_MAX_BYTES + 1,
          },
        ]),
      ],
      ['another member, and no manifest', zipOf([{ name: 'card.png', bytes: card }])],
      [
        'named twice',
        zipOf([
          { name: 'card.png', bytes: card },
          { name: WORLD_FILE_MANIFEST, bytes: manifest },
          { name: WORLD_FILE_MANIFEST, bytes: manifest },
        ]),
      ],
      ['not a zip', new TextEncoder().encode('{"name":"Harbour"}')],
    ];
    for (const [what, zip] of cases) {
      expect(await worldHeadOf(new Blob([zip])), what).toBeNull();
    }
  });
});
