// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportDisposition, ImportItemReport, ImportNote } from '@storyengine/shared';

import type {
  FileSource,
  ImportCandidate,
  SourceItem,
  SourceReader,
  SourceSurvey,
} from '../source.js';

/**
 * CHARX, the V3 character-card container
 * ([P4 §1.10](../../../../../docs/design/workplan/16-p4-implementation.md),
 * [§7.5](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **Named in two sections since the phase plan was written, and built at the
 * audit.** §1.3 listed it among what a unit of import is and §1.10 said the card
 * converter covered it; neither was true, and nothing said so — the failure
 * §7.5 records. It is the only one of that list this phase actually owed:
 * `.seactor` is *our* format, which [§4] puts out of scope in as many words.
 *
 * **The whole reader is thirty lines because the card converter already exists.**
 * A CHARX is a V3 card in a file rather than in a PNG chunk, so `card.json`'s
 * bytes go to the same `convertCard` a `chara` chunk's do, through the same
 * `sillytavern.card` format — which is why this yields a candidate rather than
 * converting anything. The archive's other entries ride along as assets, exactly
 * as a card PNG's pixels do.
 */
export class CharxReader implements SourceReader {
  readonly kind = 'charx' as const;

  readonly #files: FileSource;

  constructor(files: FileSource) {
    this.#files = files;
  }

  survey(): Promise<SourceSurvey> {
    // Nothing to refuse here. An archive's own refusals — a bomb, a traversing
    // entry name, zip64 — are spent opening it, before this exists at all, which
    // is the earliest any of them can be caught ([§1.3]'s *refused before
    // anything is written*).
    return Promise.resolve({ ok: true, kind: this.kind, notes: [] as ImportNote[] });
  }

  async *items(): AsyncIterable<SourceItem> {
    const bytes = await this.#files.read('card.json');
    if (bytes === null) {
      yield observed('card.json', 'unrecognised', [
        { key: 'import.file.unreadable', params: { file: 'card.json' }, level: 'warn' },
      ]);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      yield observed('card.json', 'unrecognised', [
        { key: 'import.file.notJson', params: { file: 'card.json' }, level: 'warn' },
      ]);
      return;
    }

    /**
     * **Every other entry is an asset, and the first image is the portrait.**
     *
     * The spec puts attachments under `assets/` and addresses them from the card
     * body by URI. Carrying the whole list rather than only `assets/` is
     * deliberate: archives in the wild put the avatar at the root as often as
     * not, and an entry we carry and never reference costs a file, while one we
     * drop costs the picture.
     *
     * `#createActor` takes `assets[0]` as the portrait, so the ordering here is
     * load-bearing: images first, and among them anything that names itself the
     * avatar before anything that does not.
     */
    const assets: string[] = [];
    for await (const path of this.#files.list()) {
      if (path !== 'card.json') assets.push(path);
    }
    assets.sort(portraitFirst);

    yield {
      outcome: 'candidate',
      candidate: {
        source: 'card.json',
        format: 'sillytavern.card',
        payload: parsed,
        assets,
      } satisfies ImportCandidate,
    };
  }
}

const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;

/** Images before anything else; a file that says it is the avatar before those. */
function portraitFirst(a: string, b: string): number {
  const rank = (name: string): number => {
    if (!IMAGE.test(name)) return 2;
    return /(^|\/)(avatar|portrait|main|card)\./i.test(name) ? 0 : 1;
  };
  const difference = rank(a) - rank(b);
  return difference !== 0 ? difference : a.localeCompare(b);
}

function observed(
  source: string,
  disposition: ImportDisposition,
  notes: ImportNote[] = [],
): SourceItem {
  const report: ImportItemReport = { source, disposition, notes };
  return { outcome: 'observed', report };
}
