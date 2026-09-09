// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  newPreset,
  type ImportNote,
  type Preset,
  type PresetBlock,
  type SlotSource,
} from '@storyengine/shared';

import { convertMacros, type MacroOutcome } from '../macros.js';
import { parsed, refused, type ParseOutcome } from '../parse.js';
import { stripSensitiveFields } from './sensitive-fields.js';

/**
 * SillyTavern chat-completion presets → `Preset`
 * ([04 §8.4](../../../../../docs/design/04-schemas.md)).
 *
 * **The structural distance is small and most of this is renaming** (§8.1).
 * ST's prompt manager is a block assembler; what it does not have is a general
 * mechanism, so nine fixed fields collapse here into `wrapper` and `appliesTo`
 * (§8.4.3) and the result is strictly more capable than the thing it came from.
 *
 * Everything lossy is reported. Nothing is dropped silently, and the review's
 * notes are `{ key, params }` rather than sentences — the client composes the
 * prose ([P4 §1.4]).
 */

const note = (
  key: string,
  params: ImportNote['params'] = {},
  level: ImportNote['level'] = 'info',
): ImportNote => ({
  key,
  params,
  level,
});

/**
 * ST's marker identifiers → our slot sources (§8.4.1).
 *
 * *Two corrections to that table, both because the code moved after it was
 * written.* `dialogueExamples` maps to `samples`, not `examples` — the arm was
 * renamed when dialogue examples stopped being a `Section` ([04 §3.1]), and the
 * schema says so beside it. And `scenario` maps to `treatment`, which the marker
 * table always spelled correctly and the code only caught up with at P4.0.
 */
const MARKERS: Readonly<Record<string, SlotSource>> = {
  chatHistory: { of: 'history' },
  worldInfoBefore: { of: 'lore', phase: 'before' },
  worldInfoAfter: { of: 'lore', phase: 'after' },
  charDescription: { of: 'actor', sectionId: 'se.summary' },
  /**
   * **The row that has to agree with card import, and an earlier draft got it
   * wrong** (§8.4.1). It pointed at `se.voice`, which reads sensibly alone and
   * is broken in practice, because card import routes `personality` to `traits`
   * — so a preset and a card from the *same* install produced a slot resolving
   * to a section nothing ever wrote. Empty forever, hidden by `omitWhenEmpty`.
   * The fixture-pair gate exists because of this row.
   */
  charPersonality: { of: 'actor', field: 'traits' },
  personaDescription: { of: 'persona' },
  dialogueExamples: { of: 'samples' },
  scenario: { of: 'treatment', part: 'framing' },
};

/**
 * The nine fixed fields that become ordinary block properties (§8.4.3).
 *
 * **Nine, not eight.** The heading in §8.4.3 says eight and its own table has
 * nine rows; the table is right and the heading is corrected in this stage's
 * documentation commit.
 *
 * The first three become a `wrapper` on the slot they framed. The rest become
 * `TextBlock`s gated on a call kind, which is why they are worth converting
 * rather than dropping: `continue_nudge_prompt` is why *continue* works at all.
 */
const WRAPPER_FIELDS: Readonly<Record<string, string>> = {
  wi_format: 'lore',
  scenario_format: 'treatment',
  personality_format: 'charPersonality',
};

const CALL_KIND_FIELDS: Readonly<Record<string, string>> = {
  group_nudge_prompt: 'group-nudge',
  new_chat_prompt: 'session-start',
  new_group_chat_prompt: 'session-start',
  new_example_chat_prompt: 'example',
  continue_nudge_prompt: 'continue',
  impersonation_prompt: 'impersonate',
};

/** Sampler fields with a chat-API equivalent (§8.4.1). Everything else is `compat`. */
const PARAM_FIELDS: Readonly<Record<string, keyof Preset['params']>> = {
  temperature: 'temperature',
  top_p: 'topP',
  top_k: 'topK',
  top_a: 'topA',
  min_p: 'minP',
  frequency_penalty: 'frequencyPenalty',
  presence_penalty: 'presencePenalty',
  repetition_penalty: 'repetitionPenalty',
  seed: 'seed',
  n: 'n',
  openai_max_tokens: 'maxTokens',
};

/** The model-naming fields, all of which are a wish rather than a binding. */
const MODEL_FIELDS = [
  'openai_model',
  'claude_model',
  'google_model',
  'mistralai_model',
  'cohere_model',
  'custom_model',
];

/**
 * `system_prompt: true` means *"came from the built-in set"*, not *"has the
 * system role"* — a genuinely misleading field name that carries no meaning
 * here — and `forbid_overrides` governs whether a card may override a prompt,
 * which cards cannot do at all. Both drop, and neither is worth a review note:
 * a note per preset per meaningless field is how a review stops being read.
 */
const MEANINGLESS_PROMPT_FIELDS = new Set(['system_prompt', 'forbid_overrides', 'marker']);

/** ST's global and group-default pseudo character ids (§8.4.2). */
const GLOBAL_ORDER_ID = 100000;
const GROUP_ORDER_ID = 100001;

/**
 * The flat priority every converted block gets.
 *
 * **Ours, and the review says so** ([P4 §1.1]). [00 §2.6] requires every block
 * budgeted and ST presets carry no priorities, so inventing a ladder would imply
 * a fidelity the source file does not contain. 50 is what the assembler already
 * assumes for an undeclared candidate, which makes this the one value that
 * changes nothing.
 */
const DEFAULT_PRIORITY = 50;

export interface ConvertedPreset {
  preset: Preset;
  notes: ImportNote[];
}

interface StPrompt {
  identifier: string;
  name?: string;
  content?: string;
  role?: string;
  marker?: boolean;
  injection_position?: number;
  injection_depth?: number;
  injection_order?: number;
  injection_trigger?: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** ST's `INJECTION_POSITION`: `RELATIVE: 0`, `ABSOLUTE: 1` (PromptManager.js:37). */
const ABSOLUTE = 1;

export function convertChatCompletionPreset(
  input: unknown,
  name: string,
): ParseOutcome<ConvertedPreset> {
  if (!isRecord(input)) return refused('wrong-shape');
  if (!Array.isArray(input['prompts'])) return refused('missing-field', 'prompts');

  const notes: ImportNote[] = [];
  const { kept, removed } = stripSensitiveFields(input);

  if (removed.length > 0) {
    // Loudest note the converter emits, and the only one that is about somebody
    // else's safety rather than about fidelity.
    notes.push(note('import.preset.credentialsRemoved', { fields: removed.join(', ') }, 'warn'));
  }

  const preset = newPreset(name);
  const prompts = new Map<string, StPrompt>();
  for (const entry of input['prompts']) {
    if (isRecord(entry) && typeof entry['identifier'] === 'string') {
      prompts.set(entry['identifier'], entry as unknown as StPrompt);
    }
  }

  const { order, orderNote } = resolveOrder(kept['prompt_order'], prompts);
  if (orderNote) notes.push(orderNote);

  preset.blocks = order
    .map((entry) => blockFor(entry, prompts, kept, notes))
    .filter((block): block is PresetBlock => block !== null);

  preset.blocks.push(...callKindBlocks(kept, notes));
  applyParams(kept, preset, notes);
  applyBudget(kept, preset, notes);
  applyModelHint(kept, preset);

  // [04 §2]'s preservation rule: everything unrecognised is kept verbatim, so
  // nothing is lost even where nothing reads it. The credentials above are the
  // one named exception and are already gone by here.
  preset.compat = compatOf(kept);

  return parsed({ preset, notes });
}

interface OrderEntry {
  identifier: string;
  enabled: boolean;
}

/**
 * Which ordering to convert.
 *
 * ST keys orderings by `character_id`, with `100000` and `100001` as dummy ids
 * for the global and group defaults. Only the global order converts; a preset
 * carrying genuinely per-character orders gets **one preset plus a warning
 * naming the characters** (§8.4.2), rather than a silent choice among them.
 *
 * *The half §8.4.2 left unstated, decided at [P4 §1.1]:* when there is no global
 * order the group default converts in its place with a note, and when both exist
 * the group default drops with a note.
 */
function resolveOrder(
  raw: unknown,
  prompts: ReadonlyMap<string, StPrompt>,
): { order: OrderEntry[]; orderNote: ImportNote | null } {
  const orders = new Map<number, OrderEntry[]>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isRecord(entry) || !Array.isArray(entry['order'])) continue;
      const id = typeof entry['character_id'] === 'number' ? entry['character_id'] : null;
      if (id === null) continue;
      orders.set(
        id,
        entry['order']
          .filter(isRecord)
          .filter((row): row is Record<string, unknown> => typeof row['identifier'] === 'string')
          .map((row) => ({
            identifier: row['identifier'] as string,
            enabled: row['enabled'] !== false,
          })),
      );
    }
  }

  const perCharacter = [...orders.keys()].filter(
    (id) => id !== GLOBAL_ORDER_ID && id !== GROUP_ORDER_ID,
  );

  const global = orders.get(GLOBAL_ORDER_ID);
  const group = orders.get(GROUP_ORDER_ID);

  let order = global ?? group ?? null;
  let orderNote: ImportNote | null = null;

  if (global === undefined && group !== undefined) {
    orderNote = note('import.preset.groupOrderUsed');
  } else if (global !== undefined && group !== undefined) {
    orderNote = note('import.preset.groupOrderDropped');
  }

  if (perCharacter.length > 0) {
    orderNote = note(
      'import.preset.perCharacterOrdersDropped',
      { characters: perCharacter.join(', '), count: perCharacter.length },
      'warn',
    );
  }

  // No order at all: take the prompts in the order the file lists them, which is
  // what ST's own UI falls back to.
  order ??= [...prompts.keys()].map((identifier) => ({ identifier, enabled: true }));

  return { order, orderNote };
}

function blockFor(
  entry: OrderEntry,
  prompts: ReadonlyMap<string, StPrompt>,
  body: Readonly<Record<string, unknown>>,
  notes: ImportNote[],
): PresetBlock | null {
  const prompt = prompts.get(entry.identifier);
  if (prompt === undefined) return null;

  const common = {
    id: `st.${entry.identifier}`,
    label: prompt.name ?? entry.identifier,
    role: roleOf(prompt.role),
    enabled: entry.enabled,
    placement: placementOf(prompt),
    priority: DEFAULT_PRIORITY,
    // `CallKind` is an open string by rule ([04 §8.2]), so an unmapped trigger
    // rides through and renders as a `not-applicable` skip in a mode that never
    // makes such a call — visible in `notFilled` rather than lost.
    appliesTo: prompt.injection_trigger ?? [],
    // Nothing in ST's preset format is guidance-shaped, and an advisory block
    // reaching an effects-purpose call aborts the turn ([P4 §1.1]). The
    // converter never sets the flag.
    advisory: false,
    omitWhenEmpty: true,
  };

  const source = MARKERS[entry.identifier];
  if (source !== undefined) {
    const wrapper = wrapperFor(entry.identifier, source, body);
    return { ...common, kind: 'slot', source, ...(wrapper === null ? {} : { wrapper }) };
  }

  if (prompt.marker === true) {
    // A marker this build does not know. Dropping it silently would leave a hole
    // in the prompt that nothing explains.
    notes.push(note('import.preset.unknownMarker', { identifier: entry.identifier }, 'warn'));
    return null;
  }

  const { template, seen } = convertMacros(prompt.content ?? '');
  reportMacros(entry.identifier, seen, notes);
  return { ...common, kind: 'text', template };
}

/** ST's format strings are `{{...}}`-shaped; ours is one fixed `{{content}}`. */
function wrapperFor(
  identifier: string,
  source: SlotSource,
  body: Readonly<Record<string, unknown>>,
): string | null {
  for (const [field, target] of Object.entries(WRAPPER_FIELDS)) {
    const applies = target === identifier || target === source.of;
    if (!applies) continue;
    const format = body[field];
    if (typeof format !== 'string' || format.length === 0) continue;
    // ST writes `{0}` in `wi_format` and `{{scenario}}` in `scenario_format`;
    // both mean *the filled value goes here*, which is our one placeholder.
    return format.replace(/\{0\}|\{\{[a-zA-Z_]+\}\}/g, '{{content}}');
  }
  return null;
}

/** The six fields that become a `TextBlock` gated on a call kind (§8.4.3). */
function callKindBlocks(
  body: Readonly<Record<string, unknown>>,
  notes: ImportNote[],
): PresetBlock[] {
  const blocks: PresetBlock[] = [];
  for (const [field, callKind] of Object.entries(CALL_KIND_FIELDS)) {
    const content = body[field];
    if (typeof content !== 'string' || content.length === 0) continue;

    const { template, seen } = convertMacros(content);
    reportMacros(field, seen, notes);
    blocks.push({
      id: `st.${field}`,
      label: field,
      role: 'system',
      enabled: true,
      placement: { at: 'sequence' },
      priority: DEFAULT_PRIORITY,
      appliesTo: [callKind],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'text',
      template,
    });
  }
  return blocks;
}

function placementOf(prompt: StPrompt): PresetBlock['placement'] {
  if (prompt.injection_position !== ABSOLUTE) return { at: 'sequence' };
  return {
    at: 'in-history',
    // Depths carry through 1:1. ST counts **messages** and so does ours; any
    // table converting turns to messages would reintroduce the doubled-depth
    // bug F36 fixed ([P4 §1.1]).
    fromEnd: typeof prompt.injection_depth === 'number' ? prompt.injection_depth : 0,
    ...(typeof prompt.injection_order === 'number' ? { tiebreak: prompt.injection_order } : {}),
  };
}

function roleOf(role: unknown): 'system' | 'user' | 'assistant' {
  return role === 'user' || role === 'assistant' ? role : 'system';
}

function applyParams(
  body: Readonly<Record<string, unknown>>,
  preset: Preset,
  notes: ImportNote[],
): void {
  let carried = 0;
  for (const [field, target] of Object.entries(PARAM_FIELDS)) {
    const value = body[field];
    if (typeof value !== 'number') continue;
    (preset.params as Record<string, unknown>)[target] = value;
    carried += 1;
  }
  if (carried > 0) notes.push(note('import.preset.paramsCarried', { count: carried }));
}

function applyBudget(
  body: Readonly<Record<string, unknown>>,
  preset: Preset,
  notes: ImportNote[],
): void {
  const max = body['openai_max_context'];
  if (typeof max !== 'number' || max <= 0) return;
  preset.budget.maxContextTokens = Math.floor(max);
  // It can only *narrow* the resolved window, never substitute for it — so the
  // review says the source value was absolute, because a person reading "8192"
  // will otherwise assume it is the window.
  notes.push(note('import.preset.contextCeilingWasAbsolute', { tokens: Math.floor(max) }));
}

function applyModelHint(body: Readonly<Record<string, unknown>>, preset: Preset): void {
  const ids = MODEL_FIELDS.map((field) => body[field]).filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (ids.length === 0) return;
  // `role: 'prose'` because that is what a chat-completion preset is for, and
  // the field is required. The ids are the wish; resolution stays local, so a
  // preset can never repoint anybody's provider ([04 §3]).
  preset.modelHint = { role: 'prose', preferredModelIds: [...new Set(ids)] };
}

function compatOf(body: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const compat: Record<string, unknown> = {};
  const consumed = new Set<string>([
    'prompts',
    'prompt_order',
    ...Object.keys(WRAPPER_FIELDS),
    ...Object.keys(CALL_KIND_FIELDS),
    ...Object.keys(PARAM_FIELDS),
    ...MODEL_FIELDS,
    'openai_max_context',
  ]);
  for (const [key, value] of Object.entries(body)) {
    if (consumed.has(key) || MEANINGLESS_PROMPT_FIELDS.has(key)) continue;
    compat[key] = value;
  }
  return compat;
}

/** One note per distinct macro that needs a person, never one per occurrence. */
function reportMacros(
  where: string,
  seen: ReadonlyMap<string, MacroOutcome>,
  notes: ImportNote[],
): void {
  for (const [macro, outcome] of seen) {
    if (outcome.kind === 'unknown') {
      notes.push(note('import.macro.unrecognised', { macro, block: where }, 'warn'));
    } else if (outcome.kind === 'refused') {
      notes.push(note('import.macro.refused', { macro, block: where, because: outcome.because }));
    }
  }
}
