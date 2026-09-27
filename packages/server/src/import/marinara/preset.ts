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
 *
 * *(2026-09-27: `types/prompt.ts` is the API's shape. A store, and the preset
 * export, hold `server/src/db/schema/prompts.ts`'s — JSON in text columns and
 * booleans as strings — and this is read either way now; see `json`.)*
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
  groups: readonly unknown[] = [],
): ParseOutcome<ConvertedPreset> {
  if (!isRecord(presetRow)) return refused('wrong-shape');
  if (typeof presetRow['name'] !== 'string') return refused('missing-field', 'name');

  const notes: ImportNote[] = [];
  const preset = newPreset(presetRow['name']);
  preset.blurb = str(presetRow['description']);

  /**
   * ***The order as Marinara stores it*** (2026-09-27). `sectionOrder` is a
   * text column holding a JSON array — Marinara's own schema says so, and its
   * storage writes it with `JSON.stringify` and its assembler reads it with
   * `JSON.parse` — and this read it as an array, found a string, and fell back
   * to table order, which is the order the store happened to write. The
   * fixture had been written in the API's shape, so nothing noticed. Read
   * either way now, and an order that will not parse is said, not guessed at.
   */
  const rows = sections.filter(isRecord);
  const byId = new Map(rows.map((row) => [str(row['id']), row]));
  const order = strings(json(presetRow['sectionOrder']));
  if (unreadable(presetRow['sectionOrder'])) {
    notes.push(note('import.preset.sectionOrderUnreadable', {}, 'warn'));
  }
  const ordered = order.length > 0 ? order.map((id) => byId.get(id)).filter(isRecord) : rows;

  /**
   * ***A group switched off switches its sections off*** — Marinara's
   * assembler skips every section whose group is disabled, so they arrive
   * here switched off rather than on, words kept. A group also wraps its
   * sections a second time, in its own name, which a block cannot do across
   * blocks: the review says so, once.
   */
  const groupRows = groups.filter(isRecord);
  const groupOn = new Map(groupRows.map((row) => [str(row['id']), truthy(row['enabled'], true)]));
  const wrapFormat = str(presetRow['wrapFormat']) || 'xml';

  // One budget for every section's macros (`macros.ts`).
  const budget = macroNoteBudget();
  const dropped = new Set<string>();
  preset.blocks = firstOfEach(
    ordered
      .map((row) => blockFor(row, wrapFormat, groupOn, notes, budget))
      .filter((block): block is PresetBlock => block !== null),
    dropped,
  );
  if (dropped.size > 0) {
    notes.push(
      note('import.preset.duplicatesDropped', { identifiers: [...dropped].join(', ') }, 'warn'),
    );
  }
  const wrappedGroups = groupRows.filter((row) =>
    ordered.some((section) => str(section['groupId']) === str(row['id'])),
  );
  if (wrapFormat !== 'none' && wrappedGroups.length > 0) {
    notes.push(
      note('import.preset.groupWrappersDropped', {
        groups: wrappedGroups.map((row) => str(row['name'])).join(', '),
      }),
    );
  }

  applyConversationPrompt(presetRow, preset, notes, budget);
  if (budget.unlisted > 0) {
    notes.push(note('import.macro.unlisted', { count: budget.unlisted }, 'warn'));
  }
  applyVariables(presetRow, choiceBlocks, preset, notes);
  const parameters = applyParameters(presetRow, preset);

  // [04 §2]'s preservation rule. `groupOrder`, `wrapFormat` and the rest ride
  // verbatim rather than being dropped, and `parameters` as the object it is,
  // less the settings that became ours.
  preset.compat = Object.fromEntries(
    Object.entries(presetRow)
      .filter(
        ([key]) =>
          !['name', 'description', 'sectionOrder', 'conversationPrompt', 'parameters'].includes(
            key,
          ),
      )
      .concat(parameters === undefined ? [] : [['parameters', parameters]]),
  );

  return parsed({ preset, notes });
}

function blockFor(
  row: Record<string, unknown>,
  wrapFormat: string,
  groupOn: ReadonlyMap<string, boolean>,
  notes: ImportNote[],
  budget: MacroNoteBudget,
): PresetBlock | null {
  const label = str(row['name']) || str(row['identifier']) || 'Block';

  // Marinara stores these as the *strings* "true" and "false" in its table rows,
  // not as booleans — a row read with `=== true` silently disables every block.
  const enabled = truthy(row['enabled'], true) && (groupOn.get(str(row['groupId'])) ?? true);
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
    // A text column holding JSON, like `sectionOrder` (2026-09-27): read as an
    // object it was never one, so every marker was *not one this understands*.
    const config = json(row['markerConfig']);
    const type = isRecord(config) ? str(config['type']) : '';
    const source = ownEntry(MARKERS, type);
    if (source !== undefined) {
      // The history is its own messages in Marinara, never wrapped.
      const wrapper = type === 'chat_history' ? null : wrapperFor(str(row['name']), wrapFormat);
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
  const wrapper = wrapperFor(str(row['name']), wrapFormat);
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
 * Marinara's wrapping, which is ours by another name.
 *
 * ~~A section can ask to be wrapped in a named tag, and the preset carries a
 * default format for all of them.~~ ***Every section is wrapped, in the
 * preset's format*** (2026-09-27). `wrapInXml` and `xmlTagName` are columns
 * Marinara's own schema calls *legacy, kept for backward compat, no longer
 * used by assembler*; its assembler wraps each section in the preset's
 * `wrapFormat` — `xml` (the default), `markdown` or `none` — named from the
 * section's name, with the rules below copied from its format engine. This
 * read the legacy flag, which a current preset leaves false, so a Marinara
 * preset arrived with none of the tags its prompts were written around.
 * Marinara also indents the content inside a tag, which a wrapper cannot do
 * to a slot's content; the tags are what a model reads.
 */
function wrapperFor(name: string, wrapFormat: string): string | null {
  if (wrapFormat === 'none') return null;
  if (wrapFormat === 'markdown') {
    const heading = name
      .replace(/[^a-zA-Z0-9\s_-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return heading.length === 0 ? null : `## ${heading}\n{{content}}`;
  }
  const tag = name
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');
  return tag.length === 0 ? null : `<${tag}>\n{{content}}\n</${tag}>`;
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
  if (blocks.length === 0 && !Array.isArray(json(presetRow['variableGroups']))) return;

  preset.variables = blocks.map((row) => ({
    // The macro name is the id, because that is what `{{POV}}` in a template
    // resolves against — our `PresetVariable` has no separate name field, and
    // putting the question there instead would break every template using it.
    id: str(row['variableName']) || str(row['id']),
    label: str(row['question']) || str(row['variableName']),
    help: '',
    type: 'enum' as const,
    // Stored as a JSON string like the rest (2026-09-27): every choice arrived
    // with no options at all.
    options: (Array.isArray(json(row['options'])) ? (json(row['options']) as unknown[]) : [])
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

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * ***A column that holds JSON, read either way*** (2026-09-27). Marinara's
 * tables keep arrays and objects as JSON **text** — `sectionOrder`,
 * `markerConfig`, a choice's `options`, `parameters` — which its storage
 * writes with `JSON.stringify` and its assembler parses on use, and the preset
 * export carries the rows as stored. A value already parsed (the API's shape,
 * and what a hand-written file has) passes through; text that will not parse
 * is `undefined`, the same as absent.
 */
function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/** Text that was meant to be JSON and is not — worth a word in the review. */
function unreadable(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && json(value) === undefined;
}

/**
 * One block per id, the first — the rule SillyTavern's converter keeps, and
 * for the same reason: the assembler keys a candidate by id, so two sections
 * sharing an identifier replaced each other in every prompt.
 */
function firstOfEach(blocks: readonly PresetBlock[], dropped: Set<string>): PresetBlock[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    if (!seen.has(block.id)) {
      seen.add(block.id);
      return true;
    }
    dropped.add(block.id.replace(/^mari\./, ''));
    return false;
  });
}

/** Marinara's generation settings with an equivalent here (`GenerationParameters`). */
const PARAMETERS: Readonly<Record<string, keyof Preset['params']>> = {
  temperature: 'temperature',
  topP: 'topP',
  topK: 'topK',
  minP: 'minP',
  frequencyPenalty: 'frequencyPenalty',
  presencePenalty: 'presencePenalty',
  maxTokens: 'maxTokens',
};

/**
 * ***The generation settings, split as [P4 §1.5] said they would be***
 * (2026-09-27). §1.5 has them split between `GenerationParams` and `compat`;
 * the converter kept the whole column in `compat`, and on a real store that
 * column is JSON text, so not even a person reading `compat` saw an object.
 * The settings with an equivalent become ours; everything else — reasoning
 * effort, prefills, thinking tags, `maxContext`, which Marinara applies only
 * when `useMaxContext` says to — stays in `compat`, parsed. Returns what
 * stays.
 */
function applyParameters(presetRow: Readonly<Record<string, unknown>>, preset: Preset): unknown {
  const raw = presetRow['parameters'];
  const parameters = json(raw);
  // Absent, or text that will not parse: kept exactly as it came.
  if (!isRecord(parameters)) return raw;

  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    const ours = ownEntry(PARAMETERS, key);
    if (ours !== undefined && typeof value === 'number' && Number.isFinite(value)) {
      (preset.params as Record<string, unknown>)[ours] = value;
      continue;
    }
    if (key === 'stopSequences' && Array.isArray(value) && value.length > 0) {
      preset.params.stop = value.filter((one): one is string => typeof one === 'string');
      continue;
    }
    rest[key] = value;
  }
  return rest;
}
