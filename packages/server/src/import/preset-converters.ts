// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ParseOutcome } from './parse.js';
import type { ConvertedPreset } from './sillytavern/preset.js';
import { convertChatCompletionPreset } from './sillytavern/preset.js';
import { convertSyspromptPreset } from './sillytavern/sysprompt.js';
import { convertTextCompletionPreset } from './sillytavern/text-completion.js';

/**
 * Which converter a preset format belongs to. One table, two readers.
 *
 * **Extracted so the dispatch exists once**, which is the claim `sweep.ts`
 * already makes about `convertOne` — *"there is one conversion path, and the
 * upload route is a way of reaching it rather than a second one"*. The preview
 * needs the same three-way choice and must not write, so it cannot go through
 * `Writer.write`, every arm of which ends in a store. Copying the three lines
 * into it would have made this the third place that knows a sysprompt preset is
 * converted by `convertSyspromptPreset`, and the second place that could be
 * forgotten when a fourth preset format arrives.
 *
 * Deliberately only the **preset** formats. Cards and lorebooks have converters
 * of the same shape and are not here, because `Writer`'s arms for them do more
 * than convert-and-store — a card can produce an actor, a lorebook and a
 * treatment — and a table that pretended those were interchangeable would be a
 * worse lie than three case labels.
 */
export type PresetConverter = (input: unknown, name: string) => ParseOutcome<ConvertedPreset>;

export const PRESET_CONVERTERS: Readonly<Record<string, PresetConverter>> = {
  'sillytavern.preset.chat': convertChatCompletionPreset,
  'sillytavern.preset.sysprompt': convertSyspromptPreset,
  'sillytavern.preset.text': convertTextCompletionPreset,
};

/**
 * The name a converted object takes: the file's own stem.
 *
 * Lives here rather than in `sweep.ts` because the preview has to answer *what
 * would this be called* without a `Writer` in reach, and a second implementation
 * of that is a preview that promises a name the import does not use. The
 * fallback matters more than it looks — a file called `.json` has an empty stem,
 * and an object with an empty name is one nothing can find again.
 */
export function nameOf(source: string): string {
  const base = source.split('/').pop() ?? source;
  return base.replace(/\.[^.]+$/, '') || 'Imported';
}
