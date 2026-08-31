// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportDisposition, ImportItemReport, ImportNote } from '@storyengine/shared';

import { codecFor } from '../storage/card/index.js';

import type { ImportCandidate, SourceItem } from './source.js';

/**
 * One uploaded file, read as an import candidate
 * ([P4 §1.3](../../../../docs/design/workplan/06-p4-implementation.md),
 * [§7.1](../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * **This is the third reader §1.3 promised and P4 never wrote.** The section
 * named three — an ST directory walker, a Marinara store reader, and *an
 * uploaded batch* — over two transports. The first two were built; the upload
 * route grew its own half-implementation at P4.1 instead, when presets were all
 * that converted, and then stayed there while P4.2 and P4.3 taught the sweep
 * cards, lorebooks and Marinara's whole store.
 *
 * The P4 completeness audit found what that cost: a card PNG uploaded on its own
 * came back `recorded` with a note saying *this build cannot convert it yet* —
 * true at P4.1, false since P4.2 — and a lorebook came back `unrecognised`,
 * which is a confident wrong answer about a file the sweep reads perfectly well
 * one code path over. Both convert here now, through the same converters, for
 * the same reason the seam was drawn: there is one conversion path, and this is
 * a way of reaching it rather than a second one.
 *
 * **The probe is by content, never by extension**, which is the posture root
 * detection already takes. A single upload has no folder to go on — the
 * directory walker classifies by top-level directory (`characters/`, `worlds/`,
 * `OpenAI Settings/`) and none of that survives a file arriving alone — so the
 * shape in the bytes is all there is. That is not a weaker signal: a `.json` in
 * `OpenAI Settings/` is a chat-completion preset because it has `prompts`, and
 * this asks the same question directly.
 */

/**
 * What the probes look for, in the order they are asked.
 *
 * **`description` and `scenario` are deliberately not here**, and that is a
 * correction rather than an oversight: the first version of this list had them,
 * and an adversarial review pointed out that `name` plus `description` is the
 * shape of half the JSON on a developer's disk — `package.json` among them. A
 * config file uploaded by mistake would have become a character.
 *
 * What is left is the fields nothing but a card has: a greeting, an example
 * exchange, a personality. The V2 spec requires `first_mes` and `mes_example`,
 * so a real card always matches; the cost is a hand-written minimal card with
 * only a description, which is now `unrecognised` — an honest refusal, and a far
 * better failure than silently importing somebody's build config as an actor.
 */
const CARDISH = [
  'first_mes',
  'mes_example',
  'personality',
  'char_greeting',
  'alternate_greetings',
] as const;

/** `chara_card_v2` / `chara_card_v3` — a card that says outright what it is. */
const CARD_SPEC = /^chara_card_v\d/;
const SAMPLERISH = ['temp', 'temperature', 'top_p', 'rep_pen', 'max_length'] as const;

export type ProbeConfidence =
  /**
   * Everything the probe can recognise. Correct for a **single upload**: a
   * person picked this file out of a file dialog and pressed a button, so a
   * generous reading serves them and a wrong guess is one row they can see.
   */
  | 'any'
  /**
   * Only formats that identify themselves. Correct for a **folder sweep**: the
   * files were not vetted one by one, and two of the probes below key on shapes
   * — an object with a `content` string, an object with a `temperature` number —
   * that ordinary JSON has by the dozen.
   *
   * Added at [P4 §7.8], after a review of that change swept a folder of build
   * config and got `appsettings.json` imported as a preset whose system prompt
   * was the string it happened to have under `content`. On one upload that is a
   * forgivable guess; across a Downloads folder it is a library full of rubbish
   * somebody now has to delete by hand.
   */
  | 'high';

/**
 * Reads one uploaded file, yielding exactly what a directory walk yields.
 *
 * The return type is `SourceItem` and not something upload-shaped on purpose:
 * an observation and a candidate are the two things any reader produces, and
 * making a single file a one-item stream is what lets the engine stay unaware of
 * how bytes arrived.
 *
 * Marinara's export envelopes are deliberately **not** handled here. One of them
 * can carry an entire profile — every table, inline — so it is a whole source
 * rather than one item, and it is read as one by the route that already turns it
 * into a `FileSource`. Splitting that here would have given a profile two ways
 * in, which is how two ways in start disagreeing.
 */
export function readUpload(
  filename: string,
  bytes: Uint8Array,
  confidence: ProbeConfidence = 'any',
): SourceItem {
  // A container with a card payload in it is self-identifying at any
  // confidence: the magic number and the chunk are not shapes anything else has.
  const codec = codecFor(bytes);
  if (codec !== null) return readCard(filename, bytes, codec);

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // Not a card container and not JSON. `unrecognised` is the honest class:
    // this build did not identify it, which is different from *this build is
    // unfinished* — the note it used to get, and which stopped being true when
    // P4.2 landed the card converter.
    return observed(filename, 'unrecognised', [
      { key: 'import.file.unrecognised', params: { file: filename }, level: 'warn' },
    ]);
  }

  if (!isRecord(parsed)) {
    return observed(filename, 'unrecognised', [
      { key: 'import.file.unrecognised', params: { file: filename }, level: 'warn' },
    ]);
  }

  const format = probe(parsed, confidence);
  if (format === null) {
    return observed(filename, 'unrecognised', [
      { key: 'import.file.unrecognised', params: { file: filename }, level: 'warn' },
    ]);
  }

  return candidate({ source: filename, format, payload: parsed });
}

/**
 * A picture with a payload in it, or a picture.
 *
 * The three outcomes are the walker's three, in its own note vocabulary
 * (`reader.ts` `#card`), because a card that fails to read should say the same
 * thing whether it arrived alone or in a folder. Duplicating the *words* would
 * have been the bug; duplicating four lines of control flow is the cost of the
 * two readers having genuinely different inputs — one has a path and a
 * directory listing, the other has a filename and some bytes.
 */
function readCard(
  filename: string,
  bytes: Uint8Array,
  codec: NonNullable<ReturnType<typeof codecFor>>,
): SourceItem {
  try {
    const legacy = codec.read(bytes).legacy;
    if (legacy === null) {
      return observed(filename, 'unrecognised', [
        { key: 'import.file.pictureWithoutACard', params: { file: filename }, level: 'warn' },
      ]);
    }
    return candidate({
      source: filename,
      format: 'sillytavern.card',
      payload: legacy.data,
      // The pixels travel with it, exactly as they do in a sweep: the actor
      // keeps the card it arrived on. `assets` is source-relative and the
      // upload's source is one file, so the file names itself.
      assets: [filename],
    });
  } catch {
    return observed(filename, 'unrecognised', [
      { key: 'import.file.notACard', params: { file: filename }, level: 'warn' },
    ]);
  }
}

/**
 * Which converter this JSON belongs to, most distinctive shape first.
 *
 * **Order is load-bearing and the reason is collisions on `name`.** Cards,
 * presets and lorebooks all commonly carry one, so `name` proves nothing; each
 * probe below is written to key on something only its own format has.
 *
 * - `prompts` as an array is the chat-completion preset's prompt manager, and
 *   nothing else in the ecosystem has it.
 * - `entries` is a world file. A card's book is nested at `data.character_book`,
 *   never at the top level, so this cannot swallow a card.
 * - A card is `name` **plus at least one card field**. The extra requirement is
 *   what stops a sysprompt preset — `{ name, content }` — from reading as a
 *   character with no description.
 * - The sampler panel is last because it is the least distinctive of the three
 *   preset shapes: any object with a temperature in it.
 */
function probe(body: Record<string, unknown>, confidence: ProbeConfidence): string | null {
  if (Array.isArray(body['prompts'])) return 'sillytavern.preset.chat';
  if (body['entries'] !== undefined && body['entries'] !== null) return 'sillytavern.lorebook';
  if (looksLikeCard(body)) return 'sillytavern.card';

  /**
   * **The last two are guesses, and a sweep does not get to guess.**
   *
   * `{ content: "…" }` and `{ temperature: 0.7 }` are shapes half the JSON in
   * the world has — a .NET `appsettings.json` matched the first one in review
   * and was imported as a preset. The three probes above key on something only
   * their own format carries; these two key on a field name. That is a fine
   * trade when a person hands over one file and can see what became of it, and a
   * bad one across a folder nobody read.
   *
   * The cost, named: a loose folder of exported sysprompt and sampler presets
   * imports nothing. That is the right way round — a real SillyTavern tree still
   * takes both, by position, which is the signal that actually means *this is a
   * preset* — and the person who wants one anyway can upload it.
   */
  if (confidence === 'high') return null;

  if (typeof body['content'] === 'string' || typeof body['post_history'] === 'string') {
    return 'sillytavern.preset.sysprompt';
  }
  if (SAMPLERISH.some((field) => typeof body[field] === 'number')) {
    return 'sillytavern.preset.text';
  }
  return null;
}

/**
 * A JSON character card, in either of the two shapes `convertCard` accepts.
 *
 * **A JSON card needs no conversion code at all**, which is worth saying because
 * it is why this arm was cheap: `card.ts`'s `unwrap` already takes the V2/V3
 * envelope *or* a bare object, since plenty of tools write the inner object
 * straight into the PNG chunk. The upload arm was never missing a converter — it
 * was missing the two lines that hand the file to one.
 */
export function looksLikeCard(value: unknown): boolean {
  if (!isRecord(value)) return false;

  // A declared card is a card, whatever fields it went on to fill. This is the
  // only branch that accepts on a name alone, and it is safe because nothing
  // that is not a card writes `chara_card_v2` into a `spec` field.
  const spec = value['spec'];
  if (typeof spec === 'string' && CARD_SPEC.test(spec)) return true;

  const data = value['data'];
  const inner = isRecord(data) ? data : value;
  if (typeof inner['name'] !== 'string' || inner['name'].length === 0) return false;
  return CARDISH.some((field) => inner[field] !== undefined && inner[field] !== null);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function candidate(value: ImportCandidate): SourceItem {
  return { outcome: 'candidate', candidate: value };
}

function observed(
  source: string,
  disposition: ImportDisposition,
  notes: ImportNote[] = [],
): SourceItem {
  const report: ImportItemReport = { source, disposition, notes };
  return { outcome: 'observed', report };
}
