// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { makeZip } from './test-zip.js';
import { DEFAULT_ZIP_LIMITS, looksLikeZip, readZipDirectory, readZipEntry } from './zip.js';

/**
 * The archive reader, and mostly its refusals
 * ([P4 §7.5](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * The happy path is four assertions and the rest of this file is everything the
 * reader is supposed to decline, which is the right proportion: reading a zip is
 * a solved problem and the reason to write one rather than depend on one is that
 * a dependency's job is to *succeed*. What earns this code its place is the
 * archives it will not open.
 */

const text = (bytes: Uint8Array | null): string | null =>
  bytes === null ? null : new TextDecoder().decode(bytes);

describe('reading an archive', () => {
  it('finds stored and deflated entries alike', () => {
    const zip = makeZip([
      { name: 'card.json', body: '{"name":"Vera"}' },
      { name: 'assets/portrait.png', body: 'PNGDATA', deflate: true },
    ]);

    expect(looksLikeZip(zip)).toBe(true);
    const directory = readZipDirectory(zip);
    expect(directory.ok).toBe(true);
    if (!directory.ok) return;

    expect(directory.entries.map((entry) => entry.name)).toEqual([
      'card.json',
      'assets/portrait.png',
    ]);
    expect(text(readZipEntry(zip, directory.entries[0]!))).toBe('{"name":"Vera"}');
    expect(text(readZipEntry(zip, directory.entries[1]!))).toBe('PNGDATA');
  });

  it('does not mistake something else for an archive', () => {
    expect(looksLikeZip(new TextEncoder().encode('{"not":"a zip"}'))).toBe(false);
    expect(looksLikeZip(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(looksLikeZip(new Uint8Array(2))).toBe(false);
  });

  it('refuses bytes with no central directory', () => {
    const truncated = makeZip([{ name: 'a.json', body: '{}' }]).slice(0, 20);
    expect(readZipDirectory(truncated)).toEqual({ ok: false, refusal: 'not-a-zip' });
  });
});

describe('what it declines', () => {
  it('refuses an entry name that would escape', () => {
    // Refused, not sanitised: rewriting `../../x` to `x` imports a file the
    // archive did not describe under a name nobody chose.
    for (const name of ['../escape.json', 'a/../../escape.json', '/etc/passwd', 'C:/windows/x']) {
      const zip = makeZip([{ name, body: '{}' }]);
      expect(readZipDirectory(zip), name).toEqual({ ok: false, refusal: 'unsafe-path' });
    }
  });

  it('refuses a backslash path that hides a traversal', () => {
    // Normalised before the check, because a reader that splits on '/' alone
    // sees `..\..\x` as one harmless segment.
    const zip = makeZip([{ name: '..\\..\\escape.json', body: '{}' }]);
    expect(readZipDirectory(zip)).toEqual({ ok: false, refusal: 'unsafe-path' });
  });

  it('refuses more entries than the bound allows', () => {
    const many = Array.from({ length: 40 }, (unused, i) => ({
      name: `f${String(i)}.json`,
      body: '{}',
    }));
    expect(readZipDirectory(makeZip(many), { ...DEFAULT_ZIP_LIMITS, maxEntries: 10 })).toEqual({
      ok: false,
      refusal: 'too-large',
    });
  });

  it('refuses a single entry bigger than the bound', () => {
    const zip = makeZip([{ name: 'big.bin', body: 'x'.repeat(4096) }]);
    expect(readZipDirectory(zip, { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 100 })).toEqual({
      ok: false,
      refusal: 'too-large',
    });
  });

  it('refuses on the total, which is the bomb', () => {
    /**
     * The case the per-entry bound cannot catch and the one that matters:
     * 42.zip is 42 KB of archive and 4.5 PB of content, and every entry in it is
     * individually unremarkable. The total is summed **from the central
     * directory, before anything is inflated**, which is the only place the
     * check is worth making.
     */
    const many = Array.from({ length: 20 }, (unused, i) => ({
      name: `f${String(i)}.bin`,
      body: 'x'.repeat(500),
      deflate: true,
    }));
    const zip = makeZip(many);

    // Each entry is well under the per-entry bound; together they are not.
    expect(
      readZipDirectory(zip, { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 1000, maxTotalBytes: 2000 }),
    ).toEqual({ ok: false, refusal: 'too-large' });
    expect(readZipDirectory(zip, { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 1000 }).ok).toBe(true);
  });

  it('refuses a compression method it does not implement', () => {
    const zip = makeZip([{ name: 'a.json', body: '{}' }]);
    // Method 12 is bzip2 — legal in the format, absent here.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const central = zip.length - 22 - (46 + 'a.json'.length);
    view.setUint16(central + 10, 12, true);
    expect(readZipDirectory(zip)).toEqual({ ok: false, refusal: 'unsupported-compression' });
  });

  it('refuses zip64 rather than guessing at its offsets', () => {
    const zip = makeZip([{ name: 'a.json', body: '{}' }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    // The sentinel that says "the real central-directory offset is elsewhere".
    view.setUint32(zip.length - 22 + 16, 0xffffffff, true);
    expect(readZipDirectory(zip)).toEqual({ ok: false, refusal: 'unsupported' });
  });

  it('returns null for an entry whose bytes are not where it said', () => {
    const zip = makeZip([{ name: 'a.json', body: '{}' }]);
    const directory = readZipDirectory(zip);
    if (!directory.ok) throw new Error('expected a directory');

    const lying = { ...directory.entries[0]!, offset: zip.length - 4 };
    expect(readZipEntry(zip, lying)).toBeNull();
  });

  it('returns null for a stored entry whose size does not match its bytes', () => {
    const zip = makeZip([{ name: 'a.json', body: '{}' }]);
    const directory = readZipDirectory(zip);
    if (!directory.ok) throw new Error('expected a directory');

    const lying = { ...directory.entries[0]!, compressedSize: 1, uncompressedSize: 999 };
    expect(readZipEntry(zip, lying)).toBeNull();
  });

  it('inflates an entry to what it declared, and no further', () => {
    /**
     * ***The ceiling is the declared size*** (2026-09-27). The total bound adds
     * up declared sizes, and many central entries may point at one local
     * header, so thousands of one-byte declarations over one stream that
     * inflates to the per-entry maximum passed every bound: about 256 GB of
     * synchronous inflation from a 300 KB upload. An entry that inflates to
     * anything but what it declared is refused, which makes the declared total
     * the real one.
     */
    const zip = makeZip([
      { name: 'big.bin', body: 'x'.repeat(8192), deflate: true },
      { name: 'empty.txt', body: '', deflate: true },
    ]);
    const directory = readZipDirectory(zip);
    if (!directory.ok) throw new Error('expected a directory');
    const [big, empty] = directory.entries;

    expect(readZipEntry(zip, big!)?.byteLength).toBe(8192);
    expect(readZipEntry(zip, { ...big!, uncompressedSize: 1 })).toBeNull();
    expect(readZipEntry(zip, { ...big!, uncompressedSize: 9000 })).toBeNull();
    // An empty deflated entry is legitimate, and Node refuses a zero ceiling.
    expect(readZipEntry(zip, empty!)?.byteLength).toBe(0);
  });

  it('bounds the inflate itself, not only the declared size', () => {
    // The declared size is checked in the directory; a crafted archive can
    // declare a small one and inflate to something else entirely, so the
    // decompressor gets its own ceiling.
    const zip = makeZip([{ name: 'big.bin', body: 'x'.repeat(8192), deflate: true }]);
    const directory = readZipDirectory(zip);
    if (!directory.ok) throw new Error('expected a directory');

    expect(
      readZipEntry(zip, directory.entries[0]!, { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 100 }),
    ).toBeNull();
  });
});
