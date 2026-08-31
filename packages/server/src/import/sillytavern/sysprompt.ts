// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newPreset, type ImportNote, type PresetBlock } from '@storyengine/shared';

import { convertMacros } from '../macros.js';
import { parsed, refused, type ParseOutcome } from '../parse.js';
import type { ConvertedPreset } from './preset.js';

/**
 * SillyTavern `sysprompt` presets — *"the easy case"* ([10 §8.4.2]).
 *
 * Two fields: `content` becomes a text block at the top, `post_history` a text
 * block after the history slot.
 *
 * **And "after history" is a fixed position, not depth zero** ([P4 §1.1]). The
 * obvious conversion is `in-history` with `fromEnd: 0`, which reads the same in
 * English and is wrong: that puts the block *inside* the history run, where it
 * moves as the window slides and comes under trimming with the messages around
 * it. ST's post-history instruction is pinned after the conversation, which is
 * `at: 'sequence'` following the history block — so the ordering does the work
 * rather than the depth arithmetic.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const block = (id: string, label: string, template: string): PresetBlock => ({
  id,
  label,
  role: 'system',
  enabled: true,
  placement: { at: 'sequence' },
  priority: 50,
  appliesTo: [],
  advisory: false,
  omitWhenEmpty: true,
  kind: 'text',
  template,
});

export function convertSyspromptPreset(
  input: unknown,
  name: string,
): ParseOutcome<ConvertedPreset> {
  if (!isRecord(input)) return refused('wrong-shape');

  const content = input['content'];
  const postHistory = input['post_history'];
  if (typeof content !== 'string' && typeof postHistory !== 'string') {
    return refused('missing-field', 'content');
  }

  const notes: ImportNote[] = [];
  const preset = newPreset(name);
  const blocks: PresetBlock[] = [];

  if (typeof content === 'string' && content.length > 0) {
    const converted = convertMacros(content);
    blocks.push(block('st.sysprompt.content', 'System prompt', converted.template));
    reportMacros('st.sysprompt.content', converted.seen, notes);
  }

  // The history slot itself, so *after history* has something to be after. A
  // sysprompt preset carries no prompt list, so without this the second block
  // would be after nothing.
  blocks.push({
    id: 'st.sysprompt.history',
    label: 'History',
    role: 'system',
    enabled: true,
    placement: { at: 'sequence' },
    priority: 50,
    appliesTo: [],
    advisory: false,
    omitWhenEmpty: true,
    kind: 'slot',
    source: { of: 'history' },
  });

  if (typeof postHistory === 'string' && postHistory.length > 0) {
    const converted = convertMacros(postHistory);
    blocks.push(block('st.sysprompt.postHistory', 'Post-history instructions', converted.template));
    reportMacros('st.sysprompt.postHistory', converted.seen, notes);
    notes.push({
      key: 'import.preset.postHistoryIsAfterNotAtDepth',
      params: {},
      level: 'info',
    });
  }

  preset.blocks = blocks;
  preset.compat = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== 'content' && key !== 'post_history'),
  );

  return parsed({ preset, notes });
}

function reportMacros(
  where: string,
  seen: ReadonlyMap<string, { kind: string }>,
  notes: ImportNote[],
): void {
  for (const [macro, outcome] of seen) {
    if (outcome.kind === 'unknown') {
      notes.push({
        key: 'import.macro.unrecognised',
        params: { macro, block: where },
        level: 'warn',
      });
    }
  }
}
