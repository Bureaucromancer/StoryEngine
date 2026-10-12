// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from '@storyengine/shared';

import { labels } from '../../i18n/catalogue.js';
import { fill, NOTE_LABELS } from '../note-labels.js';

/**
 * ***The notes only the publish review says*** —
 * [P16.3g](../../../../../docs/design/workplan/34-p16-world.md), owed since
 * [P16.3d]: `publish.closure.*` and `publish.session.*`, which `fileSet` (in
 * `shared/src/publish.ts`) writes as the person ticks, and
 * `publish.requires.modeNotHere`, which the confirm sends in its notes header.
 *
 * **In the review's chunk, not in `note-labels.ts`, and that is the one
 * difference from every other note class.** Nothing on the entry ever renders
 * these: the closure's notes exist only inside the review (the confirm does
 * not send them, and the World file's manifest does not carry them), so a
 * sentence for each on the entry would be bytes every first load pays for a
 * surface it has not opened — and the entry has two kilobytes left
 * (`tools/entry-budget.test.ts`). The `publish.file.*` half is on the entry,
 * in `note-labels.ts`, because the import review reads it too.
 *
 * **Held by the same three checks as the rest of the vocabulary**:
 * `note-labels.test.ts` reads this file beside `note-labels.ts`, so a class
 * the server or `fileSet` emits with no sentence here fails it, a sentence
 * here for a class nothing emits fails it, and a placeholder no emitter sends
 * fails it. `notes.test.ts` then drives `fileSet` itself over closures that
 * produce every one of these and renders each, which is the stronger form of
 * the third check for the notes `fileSet` writes.
 *
 * *Worded as the review's own voice*, a person reading about their own
 * library: *left out*, *stays home*, never *the file does not carry*, which is
 * the World file's notes' voice because those are read from both sides.
 */
export const PUBLISH_NOTE_LABELS: Readonly<Record<string, string>> = labels('publish.note', {
  'publish.closure.excluded':
    '“{name}” stays home: a world inside a world, or a kind this build does not know ({schema}), never travels.',
  'publish.closure.missing':
    '“{name}” is named and is not in your library, so the file says it is missing.',
  // A starting point that is gone — a member deleted since, a chosen id — is
  // neither held nor named by the file (2026-10-11, the P16.3g review).
  'publish.closure.missingStart':
    '“{name}” is not in your library any more, so the file will not hold it or name it.',
  'publish.closure.leftOut': '“{name}” is left out, though “{fromName}” names it.',
  'publish.closure.requiredLeftOut':
    '“{name}” is left out, and “{fromName}” marks it required: whoever opens the file will be missing the world, not a nice extra.',
  'publish.closure.requiredMissing':
    '“{name}” is not in your library, and “{fromName}” marks it required: whoever opens the file will be missing the world, not a nice extra.',
  'publish.closure.writtenByPlay':
    '“{name}” stays home whatever is ticked: play wrote it, and its entries are what sessions said.',
  'publish.closure.orphan': 'Nothing left in the file names “{name}” — it came with “{cameWith}”.',
  'publish.closure.justTheObject': 'Only “{name}” would leave: nothing else would be in the file.',
  'publish.session.bindingsStayBehind':
    'The connections “{name}” was set to play with stay here: a file never carries a connection.',
  'publish.requires.modeNotHere':
    'The file says it needs the {mode} mode, which this install does not have, so whoever opens it is told.',
});

/**
 * ***A publish note, said*** — this table first, then the vocabulary's, by the
 * same substitution (`fill`).
 *
 * **A missing reference may have no name**, only the id it was written with —
 * a selection id that resolves to nothing, a link by id alone — and `fileSet`
 * sends its `name` empty. An empty quotation reads as a slip, so the id stands
 * in for it: raw, which the library is ([10 §2.1]), and true.
 */
export function publishSentence(note: Pick<ImportNote, 'key' | 'params'>): string {
  const params =
    note.params['name'] === '' && typeof note.params['id'] === 'string'
      ? { ...note.params, name: note.params['id'] }
      : note.params;
  return fill(PUBLISH_NOTE_LABELS[note.key] ?? NOTE_LABELS[note.key], { key: note.key, params });
}
