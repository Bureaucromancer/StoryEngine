// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newPreset, type ImportNote, type Preset } from '@storyengine/shared';

import { parsed, refused, type ParseOutcome } from '../parse.js';
import type { ConvertedPreset } from './preset.js';
import { stripSensitiveFields } from './sensitive-fields.js';

/**
 * SillyTavern text-completion presets — params, and a number
 * ([04 §8.4.2](../../../../../docs/design/04-schemas.md)).
 *
 * These carry no prompt structure at all: they are a backend's sampler panel
 * saved to a file. Most of their fields — `dry_*`, `smoothing_*`, `mirostat_*`,
 * `xtc_*`, `tfs`, `eta_cutoff`, `epsilon_cutoff`, `num_beams` and the rest — are
 * local-backend controls with no chat-API equivalent.
 *
 * **They land in `compat`, not the floor**, and that is a correction §8.4.2 owed:
 * it said they "drop", while `GenerationParams`' own comment says they "land in
 * `compat`". The code comment wins, because it is the reading consistent with
 * [04 §2]'s preservation rule and [00 §2.4]'s *nothing is lost and re-export is
 * possible*. §8.4.2 is amended in this stage's documentation commit.
 *
 * **The review states the ratio, in as many words** (§8.4.2): *"this preset was
 * mostly sampler settings for a local backend; 6 of 41 fields carried over."*
 * Without it, importing one of these looks like it worked — the object exists,
 * it validates, and almost nothing about it survived.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The sampler fields an OpenAI-compatible chat endpoint understands
 * ([19 §5.5]). Everything else about a text-completion preset is `compat`.
 */
const PARAM_FIELDS: Readonly<Record<string, keyof Preset['params']>> = {
  temp: 'temperature',
  temperature: 'temperature',
  top_p: 'topP',
  top_k: 'topK',
  top_a: 'topA',
  min_p: 'minP',
  freq_pen: 'frequencyPenalty',
  presence_pen: 'presencePenalty',
  rep_pen: 'repetitionPenalty',
  seed: 'seed',
  n: 'n',
  // ~~`max_length: 'maxTokens'`~~ — see `applyLengths`, which is where it went.
  genamt: 'maxTokens',
};

export function convertTextCompletionPreset(
  input: unknown,
  name: string,
): ParseOutcome<ConvertedPreset> {
  if (!isRecord(input)) return refused('wrong-shape');

  const fields = Object.keys(input);
  if (fields.length === 0) return refused('missing-field', 'temp');

  const preset = newPreset(name);
  const carried = new Set<string>();
  const notes: ImportNote[] = [];

  /**
   * **The credential rule is unconditional, and this converter was not applying
   * it.**
   *
   * [04 §8.4.4] says the importer drops ST's `sensitiveFields` from every preset
   * and that there is no *"import as-is"* affordance anywhere. Only
   * `convertChatCompletionPreset` was doing it. This one and the sysprompt
   * converter copied every unconsumed field into `compat` verbatim, so a JSON
   * that probes as a sampler panel — `{ "temperature": 0.7, "proxy_password":
   * "…" }` is enough, per `upload.ts`'s `SAMPLERISH` arm — imported with the
   * password in it, against [P4 gate step 3]'s *"credential gone, from the
   * object **and** from `compat`"*.
   *
   * `invariants.test.ts` could not have caught it: that test walks schema
   * declarations, and `compat` is `Record<string, unknown>`, so there is no
   * declared property for it to deny.
   *
   * Everything below reads `kept` rather than `input` from here on, which is
   * what makes *the credential does not travel past this line* a property of the
   * code rather than of remembering.
   */
  const { kept, removed } = stripSensitiveFields(input);
  if (removed.length > 0) {
    notes.push({
      key: 'import.preset.credentialsRemoved',
      params: { fields: removed.join(', ') },
      level: 'warn',
    });
  }

  for (const [field, target] of Object.entries(PARAM_FIELDS)) {
    const value = kept[field];
    if (typeof value !== 'number') continue;
    // `-1` is SillyTavern's *random*, and it sends no seed below zero; absent
    // is ours (2026-09-27, and `preset.ts` says the rest).
    if (field === 'seed' && value < 0) continue;
    // Two source names can map to one of ours — `temp` and `temperature` — so
    // the count is of *our* fields filled, not of theirs read. Counting theirs
    // would report seven carried from a file that set the same thing twice.
    (preset.params as Record<string, unknown>)[target] = value;
    carried.add(target);
  }
  const lengths = applyLengths(kept, preset, notes, carried);

  preset.compat = Object.fromEntries(
    // Own entries: a field called `constructor` found `Object` and was dropped.
    Object.entries(kept).filter(
      ([key]) => !Object.hasOwn(PARAM_FIELDS, key) && !lengths.includes(key),
    ),
  );

  /**
   * `fields` counts the file, credentials included, because they *were* in it
   * and they did not carry. The removal has its own louder note above saying
   * which ones and why, so the ratio does not need to explain itself — and a
   * denominator that quietly shrank would make a credential-carrying preset
   * report a better score than the same file without one.
   *
   * The prose sits above the push rather than inside it because
   * `note-labels.test.ts` reads the emitted params out of the three hundred
   * characters that follow the key, so a comment between the two hides the
   * params from the gate and the label's `{carried}` reads as unsent.
   */
  notes.push({
    key: 'import.preset.samplerRatio',
    params: { carried: carried.size, total: fields.length },
    // `warn`, not `info`: the object will look fine and almost nothing about
    // it survived, which is the case a person most needs pointed out.
    level: carried.size * 4 < fields.length ? 'warn' : 'info',
  });

  if (preset.blocks.length === 0) {
    // Said out loud because an empty block list is the honest result and looks
    // like a bug: these presets contain no prompt structure to convert.
    notes.push({ key: 'import.preset.noBlocksInSamplerPreset', params: {}, level: 'info' });
  }

  return parsed({ preset, notes });
}

/**
 * ***`max_length` is whichever length the backend means by it*** (2026-09-27).
 *
 * It was read as the reply length, beside `genamt`. SillyTavern saves a
 * text-generation or KoboldAI panel with `genamt` for the reply and
 * `max_length` for the **context**, so `{ genamt: 350, max_length: 16384 }`
 * became a 350-token reply and the context size went nowhere — not the budget,
 * not `compat`, not a note. NovelAI's panels mean the opposite: `max_length` is
 * the reply and `max_context` the context. So the neighbours decide:
 *
 * - `genamt` beside it: it is the context, and becomes the budget's ceiling;
 * - `max_context` beside it: it is the reply, and `max_context` the ceiling;
 * - neither: nothing says which, so it stays in `compat` and the review says
 *   so, rather than guessing a reply length that could be a whole context.
 *
 * A ceiling only ever narrows the window, and the review says the number was
 * absolute, as the chat converter's does. Returns the fields it used.
 */
function applyLengths(
  body: Readonly<Record<string, unknown>>,
  preset: Preset,
  notes: ImportNote[],
  carried: Set<string>,
): string[] {
  const maxLength = body['max_length'];
  if (typeof maxLength !== 'number' || maxLength <= 0) return [];

  const ceiling = (tokens: number): void => {
    preset.budget.maxContextTokens = Math.floor(tokens);
    notes.push({
      key: 'import.preset.contextCeilingWasAbsolute',
      params: { tokens: Math.floor(tokens) },
      level: 'info',
    });
  };

  if (typeof body['genamt'] === 'number') {
    ceiling(maxLength);
    return ['max_length'];
  }
  const maxContext = body['max_context'];
  if (typeof maxContext === 'number' && maxContext > 0) {
    preset.params.maxTokens = Math.floor(maxLength);
    carried.add('maxTokens');
    ceiling(maxContext);
    return ['max_length', 'max_context'];
  }
  notes.push({
    key: 'import.preset.maxLengthUnclear',
    params: { tokens: Math.floor(maxLength) },
    level: 'info',
  });
  return [];
}
