// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportPreview } from '@storyengine/shared';

/**
 * ***What a picked file is, from its first bytes, before anything is sent*** —
 * [P13.8](../../../../docs/design/workplan/30-p13-aventuras-import.md)'s client
 * half, and an amendment to [P4](../../../../docs/design/workplan/16-p4-implementation.md)'s
 * *a look, then a word*.
 *
 * The look has always been a round trip: the file goes to
 * `/import/file/preview`, the converter says what it would become, and the
 * bytes go again on the word. For a preset that is kilobytes twice. For an
 * archive the server's answer never said more than *this is a folder in a
 * file* — a zip is a root, and previewing a root would be a dry run of a whole
 * sweep, which the preview route declines — and since [P13.8] an archive can
 * be somebody's whole Aventuras install, a gigabyte sent to be told what its
 * first four bytes already said, and then sent again. The preview door buffers
 * under the ordinary upload limit besides, so a large one would be refused
 * there before the import door, which takes it, was ever asked.
 *
 * So the same two signatures the server sniffs are sniffed here — a zip's
 * local header, SQLite's sixteen-byte header — and a file that has either is
 * given the answer the server would have given, **without being sent**. What
 * is lost is small and said: an archive too broken to open is no longer
 * refused at the look but at the word, where the review says so in the same
 * words.
 */

/** A zip's local-file-header signature, as `storage/zip.ts` checks it. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** SQLite's header, as `storage/sqlite-snapshot.ts` checks it. */
const SQLITE_MAGIC = [...new TextEncoder().encode('SQLite format 3\0')];

/** The two formats the server lands rather than buffers. */
export type LandedKind = 'zip' | 'sqlite';

/** Which of the two a file is, by its bytes and never its name; `null` for anything else. */
export async function sniffImportFile(file: Blob): Promise<LandedKind | null> {
  const head = new Uint8Array(await readSlice(file.slice(0, SQLITE_MAGIC.length)));
  if (startsWith(head, ZIP_MAGIC)) return 'zip';
  if (startsWith(head, SQLITE_MAGIC)) return 'sqlite';
  return null;
}

/**
 * ***The preview the server would have answered***, made here: the
 * `import.file.importsAsFolder` note and a `sweep` object, exactly as
 * `routes/import.ts`'s `previewUpload` answers an archive — so the panel
 * renders it with the renderer it already has, and a person sees the same
 * look whichever side made it.
 */
export function landedPreview(file: File): ImportPreview {
  return {
    source: file.name,
    disposition: 'converted',
    notes: [{ key: 'import.file.importsAsFolder', params: { file: file.name }, level: 'info' }],
    advisories: [],
    object: { kind: 'sweep' },
    reimport: 'unknown',
  };
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return bytes.length >= magic.length && magic.every((byte, at) => bytes[at] === byte);
}

/**
 * A slice's bytes. `Blob.arrayBuffer` where the environment has it, which is
 * every browser this ships to; `FileReader` otherwise, which is the test
 * environment's DOM on some versions.
 */
function readSlice(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as ArrayBuffer);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('The file could not be read.'));
    };
    reader.readAsArrayBuffer(blob);
  });
}
