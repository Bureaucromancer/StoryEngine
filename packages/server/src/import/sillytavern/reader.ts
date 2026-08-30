// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportDisposition, ImportItemReport, ImportNote } from '@storyengine/shared';

import { codecFor } from '../../storage/card/index.js';
import type {
  FileSource,
  ImportCandidate,
  SourceItem,
  SourceReader,
  SourceSurvey,
} from '../source.js';
import { SILLYTAVERN_DISPOSITIONS } from '../registries/sillytavern.js';

/**
 * The SillyTavern tree, read as candidates
 * ([P4 §1.3](../../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * **The degenerate case, and that is the point.** One file yields zero or one
 * candidate here, which is what a directory of files means — and it is the
 * standing check on the seam: if this walker ever grows complexity in order to
 * accommodate Marinara's relational store, the abstraction is in the wrong
 * place.
 *
 * Every path it sees is accounted for. A file under a directory the registry has
 * a disposition for gets that disposition; anything else is `unrecognised` and
 * counted, never passed over.
 */

/** ST's persona metadata lives in the settings file, not beside the images. */
interface Personas {
  names: Record<string, string>;
  descriptions: Record<string, { description?: unknown }>;
}

export class SillyTavernReader implements SourceReader {
  readonly kind = 'sillytavern' as const;

  readonly #files: FileSource;

  constructor(files: FileSource) {
    this.#files = files;
  }

  survey(): Promise<SourceSurvey> {
    // Nothing to refuse: a SillyTavern tree has no writer lease, no storage
    // format and no shard layout. The pre-flight exists for stores that can be
    // caught mid-write, and a folder of files cannot be.
    return Promise.resolve({ ok: true, kind: this.kind, notes: [] as ImportNote[] });
  }

  async *items(): AsyncIterable<SourceItem> {
    const personas = await this.#readPersonas();

    for await (const path of this.#files.list()) {
      const item = await this.#read(path, personas);
      if (item !== null) yield item;
    }
  }

  /**
   * `settings.json`, read once and up front.
   *
   * **The tree's one irregular case** ([P4 §1.8]): a persona is an image in
   * `User Avatars/` whose name and description live under `power_user.personas`
   * in the settings file — so the settings file is an import *input* rather than
   * a skipped one, and the images cannot be read until it has been.
   */
  async #readPersonas(): Promise<Personas> {
    const bytes = await this.#files.read('settings.json');
    if (bytes === null) return { names: {}, descriptions: {} };
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      const power = (parsed as { power_user?: unknown }).power_user;
      if (typeof power !== 'object' || power === null) return { names: {}, descriptions: {} };
      const record = power as { personas?: unknown; persona_descriptions?: unknown };
      return {
        names: (record.personas ?? {}) as Record<string, string>,
        descriptions: (record.persona_descriptions ?? {}) as Personas['descriptions'],
      };
    } catch {
      // A broken settings file costs the personas and nothing else. One poisoned
      // file never aborts a sweep ([13 §4.1.1]).
      return { names: {}, descriptions: {} };
    }
  }

  async #read(path: string, personas: Personas): Promise<SourceItem | null> {
    const top = path.includes('/') ? (path.split('/')[0] ?? path) : path;

    // Consumed above rather than reported: it is an input, and reporting it as
    // an item would invite somebody to give it a disposition it does not have.
    if (path === 'settings.json') return null;

    switch (top) {
      case 'characters':
        return this.#card(path);
      case 'worlds':
        return await this.#json(path, 'sillytavern.lorebook');
      case 'OpenAI Settings':
        return await this.#json(path, 'sillytavern.preset.chat');
      case 'TextGen Settings':
        return await this.#json(path, 'sillytavern.preset.text');
      case 'sysprompt':
        return await this.#json(path, 'sillytavern.preset.sysprompt');
      case 'User Avatars':
        return this.#persona(path, personas);
      default:
        return observed(path, SILLYTAVERN_DISPOSITIONS[top] ?? 'unrecognised');
    }
  }

  /**
   * A card, which is a picture with a payload in it.
   *
   * A file here that is not a card is a `warn` row and the sweep completes
   * around it — the poisoned-file rule, which the fixture corpus carries a case
   * for precisely so this path is exercised rather than assumed.
   */
  async #card(path: string): Promise<SourceItem> {
    const bytes = await this.#files.read(path);
    if (bytes === null) return observed(path, 'unrecognised');

    const codec = codecFor(bytes);
    if (codec === null) {
      return observed(path, 'unrecognised', [
        { key: 'import.file.notACard', params: { file: path }, level: 'warn' },
      ]);
    }

    try {
      const legacy = codec.read(bytes).legacy;
      if (legacy === null) {
        return observed(path, 'unrecognised', [
          { key: 'import.file.pictureWithoutACard', params: { file: path }, level: 'warn' },
        ]);
      }
      return candidate({
        source: path,
        format: 'sillytavern.card',
        payload: legacy.data,
        // The pixels travel with it: the imported actor keeps the card it
        // arrived on ([P4 §1.3]).
        assets: [path],
      });
    } catch {
      return observed(path, 'unrecognised', [
        { key: 'import.file.notACard', params: { file: path }, level: 'warn' },
      ]);
    }
  }

  async #json(path: string, format: string): Promise<SourceItem> {
    const bytes = await this.#files.read(path);
    if (bytes === null) return observed(path, 'unrecognised');
    try {
      return candidate({
        source: path,
        format,
        payload: JSON.parse(new TextDecoder().decode(bytes)),
      });
    } catch {
      return observed(path, 'unrecognised', [
        { key: 'import.file.notJson', params: { file: path }, level: 'warn' },
      ]);
    }
  }

  #persona(path: string, personas: Personas): SourceItem {
    const file = path.slice('User Avatars/'.length);
    const name = personas.names[file];
    if (typeof name !== 'string') {
      // An avatar with no entry in the settings file is a leftover image, not a
      // persona. Counted rather than converted into a nameless actor.
      return observed(path, 'skipped');
    }
    const description = personas.descriptions[file]?.description;
    return candidate({
      source: path,
      format: 'sillytavern.persona',
      payload: { name, description: typeof description === 'string' ? description : '' },
      assets: [path],
    });
  }
}

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
