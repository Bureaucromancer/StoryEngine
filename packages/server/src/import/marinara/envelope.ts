// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { MemoryFileSource } from '../memory-source.js';
import type { FileSource, ImportSourceKind } from '../source.js';

/**
 * Marinara's single-file export formats
 * ([survey §1](../../../../../docs/design/01-source-survey.md),
 * [P4 §1.3](../../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * An `ExportEnvelope` is `{ type, version, exportedAt, data }` over eight
 * `ExportType` values. Two of them matter here and the rest are named so the
 * review can say what it saw.
 *
 * **The profile arm is the interesting one, and it costs almost nothing.** A
 * native profile export carries every table *inline* — `ProfileStorageSnapshot`
 * is `{ version, tables: Record<string, rows[]>, files }` — so it becomes a
 * `FileSource` over those tables and the store reader reads it unchanged. That
 * is §1.3's claim about the seam paying out literally: *an archive is a root
 * read through a different file source*, and no second reader was needed to
 * prove it.
 */

/** `ExportType`, from `Marinara-Engine/packages/shared/src/types/export.ts:8`. */
export type MarinaraExportType =
  | 'marinara_character'
  | 'marinara_persona'
  | 'marinara_lorebook'
  | 'marinara_preset'
  | 'marinara_chat_preset'
  | 'marinara_chat_settings_profile'
  | 'marinara_memory_recall'
  | 'marinara_profile';

export interface MarinaraEnvelope {
  type: MarinaraExportType;
  data: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Is this one of Marinara's envelopes? Shape, not filename. */
export function readEnvelope(parsed: unknown): MarinaraEnvelope | null {
  if (!isRecord(parsed)) return null;
  const type = parsed['type'];
  if (typeof type !== 'string' || !type.startsWith('marinara_')) return null;
  return { type: type as MarinaraExportType, data: parsed['data'] };
}

/**
 * A profile envelope, as a file source the store reader can read.
 *
 * The tables are written to the paths a real data root would have them at, so
 * nothing downstream learns that this arrived as one file. `files` — the asset
 * manifest — is not materialised: a native export carries paths and sizes rather
 * than bytes, so the portraits are simply absent, which the actor converter
 * already survives.
 */
export function profileAsFileSource(data: unknown): FileSource | null {
  if (!isRecord(data)) return null;
  const tables = data['tables'];
  if (!isRecord(tables)) return null;

  const files: Record<string, string> = {
    'storage/manifest.json': JSON.stringify({
      version: 2,
      backend: 'file-native',
      tables: Object.fromEntries(
        Object.entries(tables).map(([name, rows]) => [name, Array.isArray(rows) ? rows.length : 0]),
      ),
    }),
  };

  for (const [name, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) continue;
    files[`storage/tables/${name}.json`] = JSON.stringify(rows);
  }

  return new MemoryFileSource(files);
}

/**
 * What a single-object envelope becomes, in the store reader's own row shapes.
 *
 * Deliberately expressed as **tables with one row in them** rather than as a
 * separate conversion path: a character exported on its own is the same row it
 * was in the table, and giving it a second route to the converter is how the two
 * routes drift apart.
 */
export function singleObjectAsFileSource(envelope: MarinaraEnvelope): FileSource | null {
  const rows = (name: string, value: unknown): Record<string, string> => ({
    [`storage/tables/${name}.json`]: JSON.stringify(Array.isArray(value) ? value : [value]),
  });

  switch (envelope.type) {
    case 'marinara_character':
      return new MemoryFileSource(rows('characters', envelope.data));
    case 'marinara_persona':
      return new MemoryFileSource(rows('personas', envelope.data));
    case 'marinara_lorebook': {
      if (!isRecord(envelope.data)) return null;
      // The export nests its entries; the store keeps them in a second table.
      const { entries, folders, ...book } = envelope.data;
      return new MemoryFileSource({
        ...rows('lorebooks', book),
        ...rows('lorebook_entries', entries ?? []),
        ...rows('lorebook_folders', folders ?? []),
      });
    }
    case 'marinara_preset': {
      if (!isRecord(envelope.data)) return null;
      const { sections, choiceBlocks, ...preset } = envelope.data;
      return new MemoryFileSource({
        ...rows('prompt_presets', preset),
        ...rows('prompt_sections', sections ?? []),
        ...rows('choice_blocks', choiceBlocks ?? []),
      });
    }
    default:
      // `marinara_chat_preset`, `marinara_chat_settings_profile` and
      // `marinara_memory_recall` are session- and memory-shaped: recorded by the
      // caller with the class that says when, not converted here.
      return null;
  }
}

/** Which source kind an envelope reads as, for the review's `source` field. */
export function envelopeKind(envelope: MarinaraEnvelope): ImportSourceKind {
  return envelope.type === 'marinara_profile' ? 'marinara' : 'marinara-envelope';
}
