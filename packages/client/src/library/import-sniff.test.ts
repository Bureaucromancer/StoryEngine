// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { landedPreview, sniffImportFile } from './import-sniff.js';

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
