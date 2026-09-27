// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { MemoryFileSource } from '../memory-source.js';
import type { FileSource, ImportSourceKind } from '../source.js';

/**
 * Marinara's single-file export formats
 * ([survey §1](../../../../../docs/design/01-source-survey.md),
 * [P4 §1.3](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * An `ExportEnvelope` is `{ type, version, exportedAt, data }` over eight
 * `ExportType` values. Two of them matter here and the rest are named so the
 * review can say what it saw.
 *
 * **The profile arm is the interesting one, and it costs almost nothing.** A
 * native profile export carries every table *inline* — `ProfileStorageSnapshot`
 * is `{ version, tables: Record<string, rows[]>, files }`, ***under
 * `data.fileStorage`*** (2026-09-27; it was read at `data`, where it never is) —
 * so it becomes a `FileSource` over those tables and the store reader reads it
 * unchanged. That
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
  const tables = profileTables(data);
  if (tables === null) return null;

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
 * ***Where a profile export keeps its tables*** (2026-09-27).
 *
 * This read `data.tables`, and no profile Marinara writes has one. A JSON
 * profile export is `{ characters, personas, lorebooks, presets, agents,
 * themes, fileStorage }`, with the whole store snapshot — `{ version: 1,
 * tables, files }`, every table's rows as stored — under `fileStorage`; so
 * every real profile export imported nothing, and the review called it a
 * format with *nowhere to put it yet*. The snapshot is read when it is there;
 * without it (an export asked not to carry it) the per-kind lists beside it are
 * laid out as the tables they came from. A **version-2** snapshot is the
 * manifest of a profile archive: its rows are files in the `.zip` beside it,
 * not in this file, so there is nothing here to read.
 */
function profileTables(data: Record<string, unknown>): Record<string, unknown> | null {
  const storage = data['fileStorage'];
  if (isRecord(storage)) {
    const tables = storage['tables'];
    return storage['version'] === 1 && isRecord(tables) ? tables : null;
  }
  if (isRecord(data['tables'])) return data['tables'];

  const list = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.filter(isRecord) : [];
  const tables: Record<string, Record<string, unknown>[]> = {
    characters: list(data['characters']),
    personas: list(data['personas']),
    lorebooks: [],
    lorebook_entries: [],
    lorebook_folders: [],
    prompt_presets: [],
    prompt_sections: [],
    prompt_groups: [],
    choice_blocks: [],
  };
  for (const book of list(data['lorebooks'])) {
    const { entries, folders, ...row } = book;
    tables['lorebooks']?.push(row);
    tables['lorebook_entries']?.push(...list(entries));
    tables['lorebook_folders']?.push(...list(folders));
  }
  for (const preset of list(data['presets'])) {
    const { sections, groups, choices, ...row } = preset;
    tables['prompt_presets']?.push(row);
    tables['prompt_sections']?.push(...list(sections));
    tables['prompt_groups']?.push(...list(groups));
    tables['choice_blocks']?.push(...list(choices));
  }
  const any = Object.values(tables).some((rows) => rows.length > 0);
  return any ? tables : null;
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
    /**
     * ***The book is under `lorebook`, and the preset under `preset`***
     * (2026-09-27). Marinara exports a lorebook as `{ lorebook, entries,
     * folders }` and a preset as `{ preset, sections, groups, choiceBlocks }`
     * — its own importers require `data.lorebook` and `data.preset` — and
     * both were read as though the object were spread flat beside its rows,
     * so a real export was refused for having no name. The flat shape is
     * still read, because a hand-made file might be one.
     */
    case 'marinara_lorebook': {
      if (!isRecord(envelope.data)) return null;
      // The export nests its entries; the store keeps them in a second table.
      const { entries, folders, lorebook, ...flat } = envelope.data;
      return new MemoryFileSource({
        ...rows('lorebooks', isRecord(lorebook) ? lorebook : flat),
        ...rows('lorebook_entries', entries ?? []),
        ...rows('lorebook_folders', folders ?? []),
      });
    }
    case 'marinara_preset': {
      if (!isRecord(envelope.data)) return null;
      const { sections, choiceBlocks, groups, preset, ...flat } = envelope.data;
      return new MemoryFileSource({
        ...rows('prompt_presets', isRecord(preset) ? preset : flat),
        ...rows('prompt_sections', sections ?? []),
        ...rows('prompt_groups', groups ?? []),
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
