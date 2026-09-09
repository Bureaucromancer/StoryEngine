// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportDisposition, ImportItemReport, ImportNote } from '@storyengine/shared';

import { marinaraPreflight } from '../detect.js';
import { MARINARA_DISPOSITIONS } from '../registries/marinara.js';
import type {
  FileSource,
  ImportCandidate,
  SourceItem,
  SourceReader,
  SourceSurvey,
} from '../source.js';

/**
 * A Marinara data root, read as candidates
 * ([P4 §1.3](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **This is the reader the seam exists for.** SillyTavern's walker is one file,
 * one candidate; here one *file* holds every character at once and one *object*
 * is a join across four tables plus an image on disk. A sweep engine written as
 * a file walker — which is what the plan said before the amendment — could not
 * have expressed this without a second, unlike path bolted on beside it.
 *
 * Two layouts, and which one a table is in is a question for the filesystem
 * rather than for the manifest: at storage format 4 sixteen tables shard into
 * `storage/tables/<table>/<key>.json` while the rest stay a single file, and a
 * crash between the migration and its first flush leaves sharded data under a
 * version-2 manifest. Marinara's own code says so.
 */

const TABLES = 'storage/tables/';

export class MarinaraReader implements SourceReader {
  readonly kind = 'marinara' as const;

  readonly #files: FileSource;
  /** Table name → its rows, loaded once. */
  readonly #tables = new Map<string, Record<string, unknown>[]>();

  constructor(files: FileSource) {
    this.#files = files;
  }

  async survey(): Promise<SourceSurvey> {
    const refusal = await marinaraPreflight(this.#files);
    if (refusal !== null) return { ok: false, refusal, notes: [] };
    return { ok: true, kind: this.kind, notes: [] as ImportNote[] };
  }

  async *items(): AsyncIterable<SourceItem> {
    yield* this.#reportUnreadPaths();

    yield* this.#lorebooks();
    yield* this.#presets();
    yield* this.#actors('characters', 'marinara.character');
    yield* this.#actors('personas', 'marinara.persona');
  }

  /**
   * Everything the sweep saw and is not converting, one row each.
   *
   * The disposition comes from §1.8's vendored registry, so a table Marinara
   * adds is `unrecognised` and counted rather than passed over — which is what
   * makes *nothing is silently dropped* checkable rather than promised.
   */
  async *#reportUnreadPaths(): AsyncIterable<SourceItem> {
    const converted = new Set<string>();
    for (const [table, disposition] of Object.entries(MARINARA_DISPOSITIONS)) {
      if (disposition === 'converted') converted.add(table);
    }

    for await (const path of this.#files.list()) {
      // A `.bak` holds the same rows rather than more of them. Reading one
      // doubles the library, and does it in the way hardest to notice, because
      // both copies are valid.
      if (path.endsWith('.bak')) {
        yield observed(path, 'skipped');
        continue;
      }
      if (path === '.encryption-key') {
        yield observed(path, 'credential');
        continue;
      }
      if (path === 'storage/manifest.json') continue;

      if (path.startsWith(TABLES)) {
        const table = tableNameOf(path);
        // Converted tables are reported by the objects they produce, not by the
        // file they came out of — otherwise `characters.json` would appear as
        // one row beside the four characters it yielded.
        if (converted.has(table)) continue;
        yield observed(path, MARINARA_DISPOSITIONS[table] ?? 'unrecognised');
        continue;
      }

      yield observed(path, assetDisposition(path));
    }
  }

  /** A table's rows, from either layout, loaded once and cached. */
  async #rows(table: string): Promise<Record<string, unknown>[]> {
    const held = this.#tables.get(table);
    if (held !== undefined) return held;

    const rows: Record<string, unknown>[] = [];
    const flat = await this.#files.read(`${TABLES}${table}.json`);
    if (flat !== null) {
      rows.push(...parseRows(flat));
    } else {
      // Sharded: every file under the table's directory is a slice of the same
      // table, and `orphaned-rows.json` is one of them.
      for await (const path of this.#files.list()) {
        if (!path.startsWith(`${TABLES}${table}/`)) continue;
        const bytes = await this.#files.read(path);
        if (bytes !== null) rows.push(...parseRows(bytes));
      }
    }

    this.#tables.set(table, rows);
    return rows;
  }

  async *#lorebooks(): AsyncIterable<SourceItem> {
    const books = await this.#rows('lorebooks');
    if (books.length === 0) return;

    const entries = await this.#rows('lorebook_entries');
    const folders = await this.#rows('lorebook_folders');
    const links = await this.#rows('lorebook_character_links');

    for (const book of books) {
      const id = str(book['id']);
      yield candidate({
        source: `${TABLES}lorebooks.json#${id}`,
        format: 'marinara.lorebook',
        payload: {
          book,
          entries: entries.filter((row) => str(row['lorebookId']) === id),
          folders: folders.filter((row) => str(row['lorebookId']) === id),
          actorIds: links
            .filter((row) => str(row['lorebookId']) === id)
            .map((row) => str(row['characterId'])),
        },
      });
    }
  }

  async *#presets(): AsyncIterable<SourceItem> {
    const presets = await this.#rows('prompt_presets');
    if (presets.length === 0) return;

    const sections = await this.#rows('prompt_sections');
    const choices = await this.#rows('choice_blocks');

    for (const preset of presets) {
      const id = str(preset['id']);
      yield candidate({
        source: `${TABLES}prompt_presets.json#${id}`,
        format: 'marinara.preset',
        payload: {
          preset,
          sections: sections.filter((row) => str(row['presetId']) === id),
          choiceBlocks: choices.filter((row) => str(row['presetId']) === id),
        },
      });
    }
  }

  /**
   * Characters and personas, which are the same table shape twice.
   *
   * **The card is a JSON string inside the JSON row** — double-encoded, and the
   * first thing a converter written against the table shape gets wrong. A row
   * whose inner parse fails is one `warn` line and the table converts around it:
   * one poisoned *row* never aborts a table, which is the row-level sibling of
   * the rule F22 already paid for ([21 §4.1.1]).
   */
  async *#actors(table: string, format: string): AsyncIterable<SourceItem> {
    const rows = await this.#rows(table);
    const images = await this.#rows(table === 'characters' ? 'character_images' : 'persona_images');

    for (const row of rows) {
      const id = str(row['id']);
      const source = `${TABLES}${table}.json#${id}`;

      let card: unknown;
      try {
        const raw = row['data'];
        card = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        yield observed(source, 'unrecognised', [
          { key: 'import.row.unreadable', params: { row: id, table }, level: 'warn' },
        ]);
        continue;
      }

      const avatar = str(row['avatarPath']) || `avatars/${id}.png`;
      const held = images.filter((image) => str(image['characterId']) === id).length;

      yield candidate({
        source,
        format,
        payload: card,
        assets: (await this.#files.exists(avatar)) ? [avatar] : [],
        ...(held > 0 ? {} : {}),
      });
    }
  }
}

/** `storage/tables/foo.json` and `storage/tables/foo/bar.json` are both `foo`. */
function tableNameOf(path: string): string {
  const rest = path.slice(TABLES.length);
  return rest.includes('/') ? (rest.split('/')[0] ?? rest) : rest.replace(/\.json$/, '');
}

/**
 * The seventeen asset directories beside `storage/`.
 *
 * The four that feed a converted object travel with it; the rest — game assets,
 * fonts, notification sounds, the video directories — are counted and skipped.
 */
function assetDisposition(path: string): ImportDisposition {
  const carried = ['avatars/', 'sprites/', 'lorebooks/images/', 'prompts/images/'];
  return carried.some((prefix) => path.startsWith(prefix)) ? 'converted' : 'skipped';
}

function parseRows(bytes: Uint8Array): Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is Record<string, unknown> =>
        typeof row === 'object' && row !== null && !Array.isArray(row),
    );
  } catch {
    // A table that will not parse costs that table and nothing else.
    return [];
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function candidate(value: ImportCandidate): SourceItem {
  return { outcome: 'candidate', candidate: value };
}

function observed(
  source: string,
  disposition: ImportDisposition,
  notes: ImportNote[] = [],
): SourceItem {
  const report: ImportItemReport = { source, disposition, notes };
  return { outcome: 'observed', report };
}
