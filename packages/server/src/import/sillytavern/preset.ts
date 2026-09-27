// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  newPreset,
  type ImportNote,
  type Preset,
  type PresetBlock,
  type SlotSource,
} from '@storyengine/shared';

import { convertMacros, macroNoteBudget, macroNotes, type MacroNoteBudget } from '../macros.js';
import { ownEntry, parsed, refused, type ParseOutcome } from '../parse.js';
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

/**
 * ~~ST's global and group-default pseudo character ids (§8.4.2).~~ ***Which
 * order SillyTavern sends, and which it only keeps*** (2026-09-27).
 *
 * The comment above had them the wrong way round, and so did §8.4.2 and
 * [P4 §1.1]: `100001` is not a group default. SillyTavern's chat-completion
 * prompt manager is built with `promptOrder: { strategy: 'global', dummyId:
 * 100001 }` (`openai.js`), and since 1.10.0 that is the order a generation
 * reads, the order the toggles write and the order a new prompt is inserted
 * into. `100000` is the class default that setting overrides — the order the
 * prompt manager used before 1.10.0, still carried in files that went through
 * it, and read by nothing. SillyTavern's own `Default.json` carries both, and
 * its `100000` has no persona slot: converting that one lost the persona, every
 * custom prompt and every toggle a person had set.
 */
const LIVE_ORDER_ID = 100001;
const LEGACY_ORDER_ID = 100000;

/**
 * ***SillyTavern's generation types, as calls here*** (2026-09-27).
 *
 * `injection_trigger` names SillyTavern's *generation types* — the Triggers
 * list in its prompt editor is exactly `normal`, `continue`, `impersonate`,
 * `swipe`, `regenerate` and `quiet` — and they were carried through verbatim
 * on [P4 §1.1]'s premise that an unmapped one would merely skip in a mode that
 * never makes such a call. The premise missed that `normal` **is** the ordinary
 * turn: a block triggered on it skipped on every turn of every mode. The three
 * with a call of their own here are translated. `swipe` and `regenerate` are
 * a redo, which is a narration here with the previous attempt beside it — so
 * mapping them would apply a block meant only for rerolls to every first
 * attempt too — and `quiet` is a background call with no equivalent; those
 * ride through verbatim, and a block left with nothing else is said to never
 * apply.
 */
const TRIGGERS: Readonly<Record<string, string>> = {
  normal: 'narrate',
  continue: 'continue',
  impersonate: 'impersonate',
};

/**
 * ***A preset from before the prompt manager*** (2026-09-27): SillyTavern's
 * three prompt fields before 1.9, which its own migration folds into the
 * prompts of its default set when such a preset is loaded.
 */
const LEGACY_PROMPT_FIELDS: Readonly<Record<string, string>> = {
  main_prompt: 'main',
  nsfw_prompt: 'nsfw',
  jailbreak_prompt: 'jailbreak',
};

/**
 * SillyTavern's own default order (`promptManagerDefaultPromptOrder`), which is
 * what it builds for a preset that carries none. `enhanceDefinitions` is left
 * out: it ships switched off, and its words are SillyTavern's, not the file's.
 */
const DEFAULT_ORDER: readonly string[] = [
  'main',
  'worldInfoBefore',
  'personaDescription',
  'charDescription',
  'charPersonality',
  'scenario',
  'nsfw',
  'worldInfoAfter',
  'dialogueExamples',
  'chatHistory',
  'jailbreak',
];

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

  const notes: ImportNote[] = [];
  const body = fromBeforePromptManager(input, notes);
  if (!Array.isArray(body['prompts'])) return refused('missing-field', 'prompts');

  const { kept, removed } = stripSensitiveFields(body);

  if (removed.length > 0) {
    // Loudest note the converter emits, and the only one that is about somebody
    // else's safety rather than about fidelity.
    notes.push(note('import.preset.credentialsRemoved', { fields: removed.join(', ') }, 'warn'));
  }

  const preset = newPreset(name);
  /**
   * ***The first definition of an identifier, as SillyTavern finds it***
   * (2026-09-27). `getPromptById` is a `find`, so a file defining one twice is
   * read by its first; a map filled in order kept the last. A prompt with no
   * identifier cannot be in any order — SillyTavern gives it a fresh one on
   * load — so it gets a name from its place in the file, and is kept below as
   * a prompt the preset holds and does not use.
   */
  const prompts = new Map<string, StPrompt>();
  const duplicates = new Set<string>();
  let unnamed = 0;
  for (const entry of body['prompts'] as unknown[]) {
    if (!isRecord(entry)) continue;
    const identifier =
      typeof entry['identifier'] === 'string'
        ? entry['identifier']
        : `unnamed.${String(unnamed++)}`;
    if (prompts.has(identifier)) {
      duplicates.add(identifier);
      continue;
    }
    prompts.set(identifier, readPrompt(entry, identifier, notes));
  }

  const { order, orderNotes } = resolveOrder(kept['prompt_order'], prompts);
  notes.push(...orderNotes);

  // One budget for every block's macros: a limit per block is beaten by having
  // many blocks (`macros.ts`).
  const budget = macroNoteBudget();
  preset.blocks = order
    .map((entry) => blockFor(entry, prompts, kept, notes, budget))
    .filter((block): block is PresetBlock => block !== null);

  /**
   * ***The prompts a preset holds and does not use*** (2026-09-27). Only the
   * chosen order became blocks, so a prompt somebody wrote and took out of the
   * order — which SillyTavern keeps, offers to add back, and never sends — was
   * lost here, and `prompts` was consumed so nothing kept it. Each one with
   * words in it comes along **switched off**, after the rest: the same state
   * it was in, and a toggle away from being used. A marker left out of the
   * order is only a position, with nothing written in it, and stays out.
   */
  const used = new Set(order.map((entry) => entry.identifier));
  const detached = [...prompts.values()].filter(
    (prompt) =>
      !used.has(prompt.identifier) &&
      prompt.marker !== true &&
      ownEntry(MARKERS, prompt.identifier) === undefined &&
      (prompt.content ?? '').trim().length > 0,
  );
  for (const prompt of detached) {
    const block = blockFor(
      { identifier: prompt.identifier, enabled: false },
      prompts,
      kept,
      notes,
      budget,
    );
    if (block !== null) preset.blocks.push(block);
  }
  if (detached.length > 0) {
    notes.push(
      note('import.preset.unusedPromptsKept', {
        count: detached.length,
        names: detached.map((prompt) => prompt.name ?? prompt.identifier).join(', '),
      }),
    );
  }

  preset.blocks.push(...callKindBlocks(kept, notes, budget));
  preset.blocks = firstOfEach(preset.blocks, duplicates);
  if (duplicates.size > 0) {
    notes.push(
      note('import.preset.duplicatesDropped', { identifiers: [...duplicates].join(', ') }, 'warn'),
    );
  }
  if (budget.unlisted > 0) {
    notes.push(note('import.macro.unlisted', { count: budget.unlisted }, 'warn'));
  }
  applyParams(kept, preset, notes);
  applyBudget(kept, preset, notes);
  applyModelHint(kept, preset);

  // [04 §2]'s preservation rule: everything unrecognised is kept verbatim, so
  // nothing is lost even where nothing reads it. The credentials above are the
  // one named exception and are already gone by here.
  preset.compat = compatOf(kept);

  return parsed({ preset, notes });
}

/**
 * ***A prompt's fields as the types they have to be*** (2026-09-27).
 *
 * The prompt was stored as whatever the file said, behind `as StPrompt`, and
 * its fields were then used as the types the interface claims. SillyTavern
 * never writes anything else, and a file is not SillyTavern: a `content` of
 * `5` reached `String.prototype.replace` as a number and threw — out of the
 * converter, out of the sweep, and out of the folder import, after the files
 * before it were written and with no job row to say so. A `name` of `5`, a
 * trigger that is a string, or a negative depth made a block the schema
 * refuses, and the whole preset went with it. A field of the wrong type is now
 * treated as absent, and the review names it.
 */
function readPrompt(
  entry: Readonly<Record<string, unknown>>,
  identifier: string,
  notes: ImportNote[],
): StPrompt {
  const ignored: string[] = [];
  const typed = <T>(field: string, accept: (value: unknown) => value is T): T | undefined => {
    const value = entry[field];
    if (value === undefined || value === null) return undefined;
    if (accept(value)) return value;
    ignored.push(field);
    return undefined;
  };
  const isString = (value: unknown): value is string => typeof value === 'string';
  const isNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  const isDepth = (value: unknown): value is number => isNumber(value) && value >= 0;
  const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
  const isTriggers = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(isString);

  const prompt: StPrompt = {
    identifier,
    ...optional('name', typed('name', isString)),
    ...optional('content', typed('content', isString)),
    ...optional('role', typed('role', isString)),
    ...optional('marker', typed('marker', isBoolean)),
    ...optional('injection_position', typed('injection_position', isNumber)),
    ...optional('injection_depth', typed('injection_depth', isDepth)),
    ...optional('injection_order', typed('injection_order', isNumber)),
    ...optional('injection_trigger', typed('injection_trigger', isTriggers)),
  };
  if (ignored.length > 0) {
    notes.push(
      note('import.preset.promptFieldsIgnored', { identifier, fields: ignored.join(', ') }, 'warn'),
    );
  }
  return prompt;
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

interface OrderEntry {
  identifier: string;
  enabled: boolean;
}

/**
 * Which ordering to convert.
 *
 * ST keys orderings by `character_id`, with ~~`100000` and `100001` as dummy
 * ids for the global and group defaults~~ **`100001` as the order it sends and
 * `100000` as the one it used before 1.10.0** (see `LIVE_ORDER_ID`). A preset
 * carrying genuinely per-character orders gets **one preset plus a warning
 * naming the characters** (§8.4.2), rather than a silent choice among them.
 *
 * ~~*The half §8.4.2 left unstated, decided at [P4 §1.1]:* when there is no
 * global order the group default converts in its place with a note, and when
 * both exist the group default drops with a note.~~ ***Corrected 2026-09-27***:
 * the live order converts; a file that only went through an older SillyTavern
 * has only the legacy one, which converts in its place with a note, because
 * that was the order its author arranged. When both exist the legacy one is
 * what SillyTavern ignores too, so it goes without a word.
 *
 * `enabled` is read the way SillyTavern reads it, as a truthy test
 * (`entry.enabled && …`): an entry that does not say it is on is off. `!==
 * false` turned every entry that said nothing into an enabled block.
 */
function resolveOrder(
  raw: unknown,
  prompts: ReadonlyMap<string, StPrompt>,
): { order: OrderEntry[]; orderNotes: ImportNote[] } {
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
            enabled: Boolean(row['enabled']),
          })),
      );
    }
  }

  const perCharacter = [...orders.keys()].filter(
    (id) => id !== LIVE_ORDER_ID && id !== LEGACY_ORDER_ID,
  );

  const live = orders.get(LIVE_ORDER_ID);
  const legacy = orders.get(LEGACY_ORDER_ID);
  const orderNotes: ImportNote[] = [];

  if (live === undefined && legacy !== undefined) {
    orderNotes.push(note('import.preset.legacyOrderUsed'));
  }
  if (perCharacter.length > 0) {
    orderNotes.push(
      note(
        'import.preset.perCharacterOrdersDropped',
        { characters: perCharacter.join(', '), count: perCharacter.length },
        'warn',
      ),
    );
  }

  /**
   * ~~No order at all: take the prompts in the order the file lists them, which
   * is what ST's own UI falls back to.~~ **It is not** (2026-09-27): a preset
   * with no order is given SillyTavern's own default one, and that is what it
   * converts to here — the default prompts this file defines, and the
   * default markers, which are positions and need no definition. Anything else
   * the file holds is kept switched off, as a prompt SillyTavern would have
   * held and not sent.
   */
  const order =
    live ??
    legacy ??
    DEFAULT_ORDER.filter(
      (identifier) => prompts.has(identifier) || ownEntry(MARKERS, identifier) !== undefined,
    ).map((identifier) => ({ identifier, enabled: true }));

  return { order, orderNotes };
}

function blockFor(
  entry: OrderEntry,
  prompts: ReadonlyMap<string, StPrompt>,
  body: Readonly<Record<string, unknown>>,
  notes: ImportNote[],
  budget: MacroNoteBudget,
): PresetBlock | null {
  /**
   * A default marker the file does not define is still a position: SillyTavern
   * puts its own definition back on load (`checkForMissingPrompts`) and sends
   * it. Any other identifier with no definition is pruned, there and here.
   */
  const prompt =
    prompts.get(entry.identifier) ??
    (ownEntry(MARKERS, entry.identifier) === undefined
      ? undefined
      : { identifier: entry.identifier, marker: true });
  if (prompt === undefined) return null;

  const common = {
    id: `st.${entry.identifier}`,
    label: prompt.name ?? entry.identifier,
    role: roleOf(prompt.role),
    enabled: entry.enabled,
    placement: placementOf(prompt),
    priority: DEFAULT_PRIORITY,
    // `CallKind` is an open string by rule ([04 §8.2]), so a trigger with no
    // call here rides through and renders as a `not-applicable` skip — visible
    // in `notFilled` rather than lost. The ones that do have one are translated
    // (`TRIGGERS`), and `normal` above all, which is every ordinary turn.
    appliesTo: appliesToOf(entry.identifier, prompt.injection_trigger ?? [], notes),
    // Nothing in ST's preset format is guidance-shaped, and an advisory block
    // reaching an effects-purpose call aborts the turn ([P4 §1.1]). The
    // converter never sets the flag.
    advisory: false,
    omitWhenEmpty: true,
  };

  const source = ownEntry(MARKERS, entry.identifier);
  if (source !== undefined) {
    const wrapper = wrapperFor(entry.identifier, source, body, notes, budget);
    return { ...common, kind: 'slot', source, ...(wrapper === null ? {} : { wrapper }) };
  }

  if (prompt.marker === true) {
    // A marker this build does not know. Dropping it silently would leave a hole
    // in the prompt that nothing explains.
    notes.push(note('import.preset.unknownMarker', { identifier: entry.identifier }, 'warn'));
    return null;
  }

  const { template, seen } = convertMacros(prompt.content ?? '', budget, { angles: true });
  notes.push(...macroNotes(seen, entry.identifier));
  return { ...common, kind: 'text', template };
}

/**
 * A prompt's triggers as calls here: the three SillyTavern generation types
 * with an equivalent translated, the rest carried as written. A block whose
 * triggers are all of the rest can never apply, and the review says so.
 */
function appliesToOf(
  identifier: string,
  triggers: readonly string[],
  notes: ImportNote[],
): string[] {
  const kinds = [
    ...new Set(triggers.map((trigger) => ownEntry(TRIGGERS, trigger.toLowerCase()) ?? trigger)),
  ];
  const called = new Set(Object.values(TRIGGERS));
  if (kinds.length > 0 && !kinds.some((kind) => called.has(kind))) {
    notes.push(
      note('import.preset.triggerHasNoCall', { identifier, triggers: triggers.join(', ') }),
    );
  }
  return kinds;
}

/**
 * ***One block per id, the first*** (2026-09-27). The assembler keys a
 * candidate by id, so two blocks sharing one — an identifier listed twice in
 * an order, or a prompt whose identifier is one of the nine fixed fields' —
 * meant one silently replaced the other in every prompt, and the editor moved
 * and patched both as one. The first is SillyTavern's reading (it finds by
 * identifier); the others go, and are named.
 */
function firstOfEach(blocks: readonly PresetBlock[], dropped: Set<string>): PresetBlock[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    if (!seen.has(block.id)) {
      seen.add(block.id);
      return true;
    }
    dropped.add(block.id.replace(/^st\./, ''));
    return false;
  });
}

/**
 * ***A preset from before the prompt manager, read as SillyTavern reads it***
 * (2026-09-27).
 *
 * Before 1.9 a chat-completion preset kept its prompts in three fields —
 * `main_prompt`, `nsfw_prompt` and `jailbreak_prompt` — and had no `prompts`
 * at all. SillyTavern still loads one: its migration puts the three into the
 * prompts of its default set and lets the default order place them. Here it
 * was refused for having no `prompts` in a folder, and uploaded on its own it
 * was taken for a sampler panel and came out with no blocks and a sentence
 * about sampler settings. The same migration now runs first: the three become
 * prompts, and with no order of its own the preset takes the default one.
 */
function fromBeforePromptManager(
  input: Readonly<Record<string, unknown>>,
  notes: ImportNote[],
): Record<string, unknown> {
  if (Array.isArray(input['prompts'])) return { ...input };
  const legacy = Object.entries(LEGACY_PROMPT_FIELDS).filter(
    ([field]) => typeof input[field] === 'string',
  );
  if (legacy.length === 0) return { ...input };

  // The three fields are consumed, so they do not also land in `compat`.
  const out = Object.fromEntries(
    Object.entries(input).filter(([field]) => !Object.hasOwn(LEGACY_PROMPT_FIELDS, field)),
  );
  out['prompts'] = legacy.map(([field, identifier]) => ({
    identifier,
    name: identifier,
    role: 'system',
    content: input[field],
  }));
  notes.push(note('import.preset.fromBeforePromptManager'));
  return out;
}

/**
 * ST's format strings are `{{...}}`-shaped; ours is one fixed `{{content}}`.
 *
 * ***Only the field's own placeholder is the content*** (2026-09-27). Every
 * `{{…}}` in a format string was taken for it, so SillyTavern's own
 * `personality_format` of 1.11 and 1.12, `[{{char}}'s personality:
 * {{personality}}]`, became `[{{content}}'s personality: {{content}}]` and sent
 * the traits twice with no name. The field's own placeholder — `{0}` in
 * `wi_format`, `{{scenario}}` and `{{personality}}` in the other two — is the
 * content, and the rest goes through the macro table like any template: a
 * wrapper renders `char` and `user` since the persona and actor blocks learned
 * to say whose they are, so `{{char}}` becomes the name it always meant.
 */
function wrapperFor(
  identifier: string,
  source: SlotSource,
  body: Readonly<Record<string, unknown>>,
  notes: ImportNote[],
  budget: MacroNoteBudget,
): string | null {
  for (const [field, target] of Object.entries(WRAPPER_FIELDS)) {
    const applies = target === identifier || target === source.of;
    if (!applies) continue;
    const format = body[field];
    if (typeof format !== 'string' || format.length === 0) continue;
    const own = ownEntry(OWN_PLACEHOLDERS, field);
    if (own === undefined) continue;
    const marked = format.replace(own, PLACED);
    const { template, seen } = convertMacros(marked, budget, { angles: true });
    notes.push(...macroNotes(seen, field));
    return template.replaceAll(PLACED, '{{content}}');
  }
  return null;
}

/** Each format field's own placeholder: what SillyTavern puts the value in. */
const OWN_PLACEHOLDERS: Readonly<Record<string, RegExp>> = {
  wi_format: /\{0\}/g,
  scenario_format: /\{\{scenario\}\}/gi,
  personality_format: /\{\{personality\}\}/gi,
};

/** The content's place while the rest of a format string is converted. */
const PLACED = '\u0000content\u0000';

/** The six fields that become a `TextBlock` gated on a call kind (§8.4.3). */
function callKindBlocks(
  body: Readonly<Record<string, unknown>>,
  notes: ImportNote[],
  budget: MacroNoteBudget,
): PresetBlock[] {
  const blocks: PresetBlock[] = [];
  for (const [field, callKind] of Object.entries(CALL_KIND_FIELDS)) {
    const content = body[field];
    if (typeof content !== 'string' || content.length === 0) continue;

    const { template, seen } = convertMacros(content, budget, { angles: true });
    notes.push(...macroNotes(seen, field));
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
    // SillyTavern's `seed: -1` means *pick one at random*, and it sends no seed
    // at all below zero (2026-09-27). Carried, it went to every endpoint as a
    // fixed `-1`: the same reply on a server that honours it, a refusal from
    // one that wants an unsigned seed. Absent is our spelling of *random*.
    if (field === 'seed' && value < 0) continue;
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
