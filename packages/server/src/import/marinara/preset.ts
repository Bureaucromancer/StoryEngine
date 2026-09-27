// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  newPreset,
  type ImportNote,
  type Preset,
  type PresetBlock,
  type SlotSource,
} from '@storyengine/shared';

import { convertMacros, macroNoteBudget, type MacroNoteBudget } from '../macros.js';
import { ownEntry, parsed, refused, type ParseOutcome } from '../parse.js';

/**
 * Marinara prompt presets → `Preset`
 * ([P4 §1.5](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **The plan called this format undocumented and it is not** — it is typed in
 * `Marinara-Engine/packages/shared/src/types/prompt.ts`, and it is the closest
 * thing to our block model any source has. `PromptSection` carries `content`,
 * `role`, `enabled`, `isMarker` with a `markerConfig`, an `injectionPosition` of
 * `ordered` or `depth`, an `injectionDepth` counted from the last message, and
 * an `injectionOrder` for ties. Those are our text block, slot block,
 * `in-sequence` and `in-history` placement, `fromEnd` and `tiebreak`, one for
 * one — unsurprising, because Marinara's prompt manager and SillyTavern's are
 * the same lineage that [04 §8.4] was written against.
 *
 * So this is a redirection rather than a second conversion, which is what §1.5
 * predicted and why Marinara presets stopped being survey-dependent.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `MarkerType` → our slot sources.
 *
 * ~~Ten values. Seven map.~~ ***Ten values. Eight map*** — [P8.1], 2026-09-16.
 * `id_macro_cards` and `agent_data` have no home at all, each recorded with the
 * review class that says *when*, which is the whole difference between "not yet"
 * and "never" ([P4 §1.4], collected into
 * [P7 §1.10](../../../../../docs/design/workplan/23-p7-implementation.md)).
 *
 * ***`chat_summary` was the one deferral with a phase named on it, and the phase
 * arrived.*** [P8 §1.8] deferred it here in as many words — *"this one has no
 * home until the summary chain exists"* — and said what the revisit owed: **one
 * line rather than a stage.** *"When the chain exists, the marker becomes a slot
 * source and the block converts — or it does not, and the review's answer stops
 * being 'not yet' and becomes 'not converted'. Either is fine; leaving it saying
 * 'not yet' after this phase ships is not."* It converts, because
 * `{ of: 'summary' }` is the same thing Marinara's marker names: the story above
 * the window, positioned by the pack.
 */
const MARKERS: Readonly<Record<string, SlotSource>> = {
  character: { of: 'actor', sectionId: 'se.summary' },
  persona: { of: 'persona' },
  chat_history: { of: 'history' },
  chat_summary: { of: 'summary' },
  lorebook: { of: 'lore', phase: 'before' },
  world_info_before: { of: 'lore', phase: 'before' },
  world_info_after: { of: 'lore', phase: 'after' },
  dialogue_examples: { of: 'samples' },
};

/** Markers we recognise and cannot place, with the phase that would give them one. */
const DEFERRED_MARKERS: Readonly<Record<string, string>> = {
  id_macro_cards: 'never',
  agent_data: 'never',
};

export interface ConvertedPreset {
  preset: Preset;
  notes: ImportNote[];
}

const note = (
  key: string,
  params: ImportNote['params'],
  level: ImportNote['level'] = 'info',
): ImportNote => ({ key, params, level });

/**
 * A preset row plus the section rows that point at it.
 *
 * `sectionOrder` on the preset is the authority when present — the sections
 * table carries no ordering of its own, so a converter that took the rows in
 * table order would produce a prompt in whatever order the store happened to
 * write them.
 */
export function convertPreset(
  presetRow: unknown,
  sections: readonly unknown[],
  choiceBlocks: readonly unknown[] = [],
): ParseOutcome<ConvertedPreset> {
  if (!isRecord(presetRow)) return refused('wrong-shape');
  if (typeof presetRow['name'] !== 'string') return refused('missing-field', 'name');

  const notes: ImportNote[] = [];
  const preset = newPreset(presetRow['name']);
  preset.blurb = str(presetRow['description']);

  const rows = sections.filter(isRecord);
  const byId = new Map(rows.map((row) => [str(row['id']), row]));
  const order = strings(presetRow['sectionOrder']);
  const ordered = order.length > 0 ? order.map((id) => byId.get(id)).filter(isRecord) : rows;

  // One budget for every section's macros (`macros.ts`).
  const budget = macroNoteBudget();
  preset.blocks = ordered
    .map((row) => blockFor(row, presetRow, notes, budget))
    .filter((block): block is PresetBlock => block !== null);

  applyConversationPrompt(presetRow, preset, notes, budget);
  if (budget.unlisted > 0) {
    notes.push(note('import.macro.unlisted', { count: budget.unlisted }, 'warn'));
  }
  applyVariables(presetRow, choiceBlocks, preset, notes);

  // [04 §2]'s preservation rule. `parameters`, `groupOrder`, `wrapFormat` and
  // the rest ride verbatim rather than being dropped.
  preset.compat = Object.fromEntries(
    Object.entries(presetRow).filter(
      ([key]) => !['name', 'description', 'sectionOrder', 'conversationPrompt'].includes(key),
    ),
  );

  return parsed({ preset, notes });
}

function blockFor(
  row: Record<string, unknown>,
  presetRow: Readonly<Record<string, unknown>>,
  notes: ImportNote[],
  budget: MacroNoteBudget,
): PresetBlock | null {
  const label = str(row['name']) || str(row['identifier']) || 'Block';

  // Marinara stores these as the *strings* "true" and "false" in its table rows,
  // not as booleans — a row read with `=== true` silently disables every block.
  const enabled = truthy(row['enabled'], true);
  const isMarker = truthy(row['isMarker'], false);

  const common = {
    id: `mari.${str(row['identifier']) || str(row['id'])}`,
    label,
    role: roleOf(row['role']),
    enabled,
    placement: placementOf(row),
    priority: 50,
    appliesTo: [],
    advisory: false,
    omitWhenEmpty: true,
  };

  if (isMarker) {
    const config = row['markerConfig'];
    const type = isRecord(config) ? str(config['type']) : '';
    const source = ownEntry(MARKERS, type);
    if (source !== undefined) {
      const wrapper = wrapperFor(row, presetRow);
      return { ...common, kind: 'slot', source, ...(wrapper === null ? {} : { wrapper }) };
    }

    const when = ownEntry(DEFERRED_MARKERS, type);
    notes.push(
      when === undefined
        ? note('import.preset.unknownMarker', { identifier: type || label }, 'warn')
        : note('import.preset.markerNeedsLaterMachinery', { marker: type, when }),
    );
    return null;
  }

  const { template, seen } = convertMacros(str(row['content']), budget);
  for (const [macro, outcome] of seen) {
    if (outcome.kind === 'unknown') {
      notes.push(note('import.macro.unrecognised', { macro, block: label }, 'warn'));
    }
  }
  const wrapper = wrapperFor(row, presetRow);
  return {
    ...common,
    kind: 'text',
    // A function, so the section's own `$&`, `$$` or `$'` are text rather than
    // replacement patterns — the defect `collect.ts` was fixed for, one module
    // over (2026-09-27).
    template: wrapper === null ? template : wrapper.replaceAll('{{content}}', () => template),
  };
}

/**
 * Marinara's XML wrapping, which is ours by another name.
 *
 * A section can ask to be wrapped in a named tag, and the preset carries a
 * default format for all of them. Both become our one `wrapper` string, which is
 * the same collapse [04 §8.4.3] describes for SillyTavern's nine fixed fields —
 * arrived at independently by a second source, which is worth noticing.
 */
function wrapperFor(
  row: Record<string, unknown>,
  presetRow: Readonly<Record<string, unknown>>,
): string | null {
  if (!truthy(row['wrapInXml'], false)) return null;
  const tag = str(row['xmlTagName']) || snake(str(row['name']));
  if (tag.length === 0) return null;
  if (str(presetRow['wrapFormat']) === 'markdown') return `## ${str(row['name'])}\n{{content}}`;
  return `<${tag}>\n{{content}}\n</${tag}>`;
}

function placementOf(row: Record<string, unknown>): PresetBlock['placement'] {
  if (str(row['injectionPosition']) !== 'depth') return { at: 'sequence' };
  return {
    at: 'in-history',
    // Counted from the last message in both models, so this is a copy rather
    // than a conversion — the same reason ST's depths carry 1:1.
    fromEnd: num(row['injectionDepth']) ?? 0,
    ...(num(row['injectionOrder']) === null ? {} : { tiebreak: num(row['injectionOrder']) ?? 0 }),
  };
}

/**
 * `conversationPrompt` is a mode-specific system prompt, and there is no
 * conversation mode here.
 *
 * Converted as an ordinary text block at the top rather than dropped: it is
 * authored prose, and the mode it was written for not existing is a reason to
 * report it, not to discard it.
 */
function applyConversationPrompt(
  presetRow: Readonly<Record<string, unknown>>,
  preset: Preset,
  notes: ImportNote[],
  budget: MacroNoteBudget,
): void {
  const prompt = str(presetRow['conversationPrompt']);
  if (prompt.length === 0) return;

  const { template } = convertMacros(prompt, budget);
  preset.blocks.unshift({
    id: 'mari.conversationPrompt',
    label: 'Conversation prompt',
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
  notes.push(note('import.preset.modePromptConverted', { field: 'conversationPrompt' }));
}

/**
 * `ChoiceBlock` and the variable groups are the shape `PresetVariable` was
 * adopted from, so they carry across — and **stay inert**, which the review says
 * rather than implies ([P4 §1.5]). Nothing reads preset variables yet.
 */
function applyVariables(
  presetRow: Readonly<Record<string, unknown>>,
  choiceBlocks: readonly unknown[],
  preset: Preset,
  notes: ImportNote[],
): void {
  const blocks = choiceBlocks.filter(isRecord);
  if (blocks.length === 0 && !Array.isArray(presetRow['variableGroups'])) return;

  preset.variables = blocks.map((row) => ({
    // The macro name is the id, because that is what `{{POV}}` in a template
    // resolves against — our `PresetVariable` has no separate name field, and
    // putting the question there instead would break every template using it.
    id: str(row['variableName']) || str(row['id']),
    label: str(row['question']) || str(row['variableName']),
    help: '',
    type: 'enum' as const,
    options: (Array.isArray(row['options']) ? row['options'] : [])
      .filter(isRecord)
      .map((option) => ({
        value: str(option['value']),
        label: str(option['label']) || str(option['value']),
      })),
    default: null,
    required: false,
    order: 0,
  }));

  notes.push(note('import.preset.variablesInert', { count: preset.variables.length }));
}

/**
 * Marinara writes booleans as the strings `"true"` and `"false"` in its stored
 * rows — a JSON table's idea of a boolean column.
 *
 * Reading one with `=== true` disables every block in the preset, and the result
 * imports and validates. This is the same class of trap as SillyTavern's
 * inverted `disable` flag, arriving from the other direction.
 */
function truthy(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function roleOf(value: unknown): 'system' | 'user' | 'assistant' {
  return value === 'user' || value === 'assistant' ? value : 'system';
}

const snake = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
