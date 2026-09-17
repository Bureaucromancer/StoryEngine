// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { GateReason } from '@storyengine/shared';

import { labels } from '../i18n/catalogue.js';

/**
 * ***§5.3's three ways off, in the design's own words*** —
 * [10 §5.3](../../../../docs/design/10-ui-surfaces.md),
 * [P11.8](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * ***One table, because the sweep found two.*** This map existed twice —
 * character for character, docstring and all — in `LorebookView.tsx` and in
 * `LorebookEditorPage.tsx`, which is the shape a copied table takes when two
 * surfaces render the same classes and neither knows about the other. Nothing
 * was wrong with it while there was one language: both copies said the same
 * thing, and a reader of either found the words beside the code.
 *
 * **The catalogue is what makes the duplication cost something**, and that is
 * the argument for hoisting rather than declaring `lore.gate` twice. Two
 * declarations of one namespace would mean one translator entry and two English
 * sources, so an English copy-edit in one file would leave the other quietly
 * disagreeing with the catalogue — *and disagreeing only in English*, because
 * the translation would follow the namespace. `catalogue.test.ts` refuses a
 * namespace declared twice for exactly that reason, and this file is the answer
 * it wants rather than a special case it tolerates.
 */
export const OFF_LABELS: Record<GateReason['kind'], string> = labels('lore.gate', {
  'entry-off': 'off',
  'folder-off': 'off: its folder is off',
  'book-off': 'off: the book is off',
});
