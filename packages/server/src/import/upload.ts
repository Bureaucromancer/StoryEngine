// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  schemaIdOf,
  type ImportDisposition,
  type ImportItemReport,
  type ImportNote,
} from '@storyengine/shared';

import { codecFor, type CardContents } from '../storage/card/index.js';

import { AVT_FORMAT, readAvt } from './aventuras/avt.js';
import { isAventurasLorebook, isVaultCharacter, isVaultScenario } from './aventuras/shapes.js';
import { SILLYTAVERN_CHAT_FORMAT } from './sillytavern/chat.js';
import type { ImportCandidate, SourceItem } from './source.js';

/**
 * One uploaded file, read as an import candidate
 * ([P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md),
 * [§7.1](../../../../docs/design/workplan/16-p4-implementation.md)).
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

/** The three prompt fields a chat preset kept before SillyTavern's prompt manager. */
const LEGACY_CHAT_FIELDS = ['main_prompt', 'nsfw_prompt', 'jailbreak_prompt'] as const;

/**
 * The three SillyTavern template kinds this build recognises and will never
 * convert.
 *
 * **Recognising is not converting, and the distinction is the whole of this
 * table.** [04 §8.4.5](../../../../docs/design/04-schemas.md) says the block
 * model is deliberately narrower than ST's in three places — *no character
 * offsets, no instruct templates, no raw completion* — and the sweep's own
 * registry has said `by-position` about the `instruct/` and `context/`
 * directories since P4.1. None of that is reopened here.
 *
 * What was wrong is the *answer a person got*. A hand-picked instruct template
 * fell off the end of `probe()` and came back `unrecognised` — *"Nothing here
 * recognised this file"* — which is a confident wrong statement about a valid
 * file this build knows perfectly well by position, one code path over. That is
 * the same defect [P4 §7.1] was written about: a file the sweep reads and the
 * upload refuses, differing only in how it arrived.
 *
 * Dispositions **match `SILLYTAVERN_DISPOSITIONS`** rather than being chosen
 * again here — `by-position` for instruct and context, `skipped` for reasoning.
 * `directory` is what makes that checkable rather than merely intended: it names
 * the row in the sweep's registry that this arm has to agree with, and
 * `registries.test.ts` holds the two together. Without it the same question —
 * *what becomes of a reasoning template* — would be answered in two places, and
 * the two places already disagreed once: the registry says `skipped`, and
 * [04 §8.4.2] says these *"go to `compat`"*, which cannot be true of a kind that
 * produces no `Preset` to be `compat` on. The doc is corrected in this stage.
 *
 * Field shapes vendored from a real install, on the mechanism §1.1 settled for
 * credentials:
 *   source  SillyTavern/default/content/presets/{instruct,context,reasoning}/
 *   commit  06bde939fb1e9c4c8d8641d810f0a916b5bce127 (1.19.0, 2026-09-14)
 *   taken   2026-09-22
 *   was     8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8 (1.18.0+1, 2026-07-07),
 *           byte-identical: those three preset directories are not in the
 *           1.18.0-to-1.19.0 diff at all
 */
export const NOT_CONVERTIBLE: Readonly<
  Record<string, { disposition: ImportDisposition; key: string; directory: string }>
> = {
  'sillytavern.template.instruct': {
    disposition: 'by-position',
    key: 'import.template.instruct',
    directory: 'instruct',
  },
  'sillytavern.template.context': {
    disposition: 'by-position',
    key: 'import.template.context',
    directory: 'context',
  },
  'sillytavern.template.reasoning': {
    disposition: 'skipped',
    key: 'import.template.reasoning',
    directory: 'reasoning',
  },
};

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

  /**
   * ***An Aventuras story file, before anything parses the bytes whole*** —
   * [P13.15](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * **First among the JSON shapes, for two reasons.** It has `entries`, so the
   * probe below would take it for a SillyTavern world and convert its story
   * entries as lore — which it did until this stage, making a lorebook of
   * somebody's story. And it is the one JSON here that can be as large as the
   * transport allows, most of it pictures: `JSON.parse` below would hold it
   * three times over, where `readAvt` reads the one copy there is and leaves
   * every picture in it until the Writer carries it (`aventuras/avt.ts`).
   *
   * Not gated on `confidence`: `story` as an object beside `entries` as an
   * array is Aventuras' own required shape, and self-identifying — a folder
   * sweep can be trusted with it as with a card's chunk.
   */
  const avt = readAvtUpload(filename, bytes);
  if (avt !== null) return avt;

  const text = new TextDecoder().decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    /**
     * ***Not one JSON document — and possibly one per line*** — [P14.8].
     * SillyTavern's chat file, and Marinara's per-chat export of the same
     * format, is JSON Lines: `JSON.parse` refuses the whole and every line
     * parses on its own. Asked here, below the document parse, because a
     * one-line chat *is* a JSON document and is answered below instead.
     */
    if (looksLikeChat(text, confidence)) return chat(filename);
    // Not a card container and not JSON. `unrecognised` is the honest class:
    // this build did not identify it, which is different from *this build is
    // unfinished* — the note it used to get, and which stopped being true when
    // P4.2 landed the card converter.
    return observed(filename, 'unrecognised', [
      { key: 'import.file.unrecognised', params: { file: filename }, level: 'warn' },
    ]);
  }

  /**
   * **A top-level array, which until now could not even reach the probe.**
   *
   * The guard below is right for every shape this build knew: a JSON document
   * that is not an object is not one of ST's or Marinara's formats, and letting
   * an array into `probe()` would mean every row of that table having to say so
   * again. Aventuras' own lorebook export is a bare `Entry[]`
   * (`exportToAventura`, `JSON.stringify(entries, null, 2)`), so the one format
   * that is an array is answered here, above the guard, rather than by widening
   * the guard and re-arguing the table.
   *
   * It is deliberately **not** gated on `confidence`. The shape test is four
   * co-occurring field names on the first element including a nested
   * `injection.mode`, which is on the `prompts`-array side of the line the gate
   * exists to draw — a folder sweep can be trusted with a shape this specific.
   */
  if (isAventurasLorebook(parsed)) {
    return candidate({ source: filename, format: 'aventuras.lorebook', payload: parsed });
  }

  if (!isRecord(parsed)) {
    return observed(filename, 'unrecognised', [
      { key: 'import.file.unrecognised', params: { file: filename }, level: 'warn' },
    ]);
  }

  /**
   * *A chat that is only its header* — one line, so one JSON document. It
   * says what it is (`chat_metadata` is `getGroupChat`'s own test for a
   * header, `group-chats.js:268`), and the parser then refuses it for having
   * no messages, which is the true thing to say about it.
   */
  if (isRecord(parsed['chat_metadata'])) return chat(filename);

  /**
   * *A chat that is only one message* — also one JSON document, and with no
   * header to say so. A group chat written before `chat_metadata` reached
   * groups has none, so one holding nothing but its greeting is a single line
   * of `mes` and `is_user`, which the parser reads as a group. Taken at `any`
   * only: a person picked this file, and across a folder nobody vetted, one
   * object with a text field is a shape rather than a claim.
   */
  if (
    confidence === 'any' &&
    typeof parsed['mes'] === 'string' &&
    typeof parsed['is_user'] === 'boolean'
  ) {
    return chat(filename);
  }

  const format = probe(parsed, confidence);
  if (format === null) {
    return observed(filename, 'unrecognised', [
      { key: 'import.file.unrecognised', params: { file: filename }, level: 'warn' },
    ]);
  }

  /**
   * A format with no converter is an **observation**, not a candidate.
   *
   * `source.ts` defines a candidate as one thing a converter can act on, so
   * wrapping one of these as a candidate would mean an arm in `Writer`'s switch
   * that exists to return nothing. Answering here keeps that switch a statement
   * about what converts, and `level: 'info'` rather than `warn` because nothing
   * went wrong — the answer is *this is a thing, and it is not one of ours*.
   *
   * The note names no file: the row it renders on already carries `source`, and
   * the sentence is about the kind rather than about this copy of it.
   */
  const known = NOT_CONVERTIBLE[format];
  if (known !== undefined) {
    return observed(filename, known.disposition, [{ key: known.key, params: {}, level: 'info' }]);
  }

  return candidate({ source: filename, format, payload: parsed });
}

/**
 * ***An Aventuras `.avt`, as one item — or `null` for a file that is not
 * one***, which leaves the other probes to it.
 *
 * Exported for the file door, which asks this before it parses a file whole
 * to look for a Marinara envelope, for the size reason above; a candidate
 * here is one story, and a refusal is the `unrecognised` row that says which
 * version was refused.
 */
export function readAvtUpload(filename: string, bytes: Uint8Array): SourceItem | null {
  const read = readAvt(bytes, { file: filename });
  if (read.kind === 'not-avt') return null;
  if (read.kind === 'refused') return observed(filename, 'unrecognised', read.notes);
  return candidate({ source: filename, format: AVT_FORMAT, payload: read.story });
}

/**
 * The object a card of ours carries, or null for a card that is not one of ours
 * — **the envelope's payload, when it names one of our schemas.** Shared by the
 * upload door and the SillyTavern reader's card arm (2026-09-28), which meet the
 * same file: a downloaded card dropped into a `characters/` folder is as much
 * one of ours as one uploaded.
 */
export function ourCardPayload(contents: CardContents): unknown {
  const payload = contents.envelope?.payload;
  return schemaIdOf(payload)?.startsWith('storyengine.') === true ? payload : null;
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
    const contents = codec.read(bytes);
    /**
     * ***One of ours comes back as ours*** (2026-09-28). An actor downloads as
     * its card now, and that card carries our envelope and no SillyTavern
     * chunk — so it read as *a picture without a card*, and the download could
     * not be brought back at all. Read first, because a card of ours may carry
     * a legacy chunk too, and ours is the object as it was.
     */
    const ours = ourCardPayload(contents);
    if (ours !== null) {
      return candidate({
        source: filename,
        format: 'storyengine.object',
        payload: ours,
        assets: [filename],
      });
    }
    const legacy = contents.legacy;
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
  /**
   * ***Our own files first, by what they say they are*** (2026-09-27).
   *
   * A lorebook this build wrote, downloaded or entry-exported, has `entries`,
   * and the next line claimed it for SillyTavern. The ST converter reads ST's
   * spellings: `disable` for off, a number for position, `keysecondary`. Every
   * entry its author had switched off came back on, depth and outlet entries
   * moved to before the character, and secondary keys, folders and the book's
   * scope were dropped, with no note. Any other kind came back as *nothing here
   * recognised this file*, which is a confident wrong answer about a file this
   * build wrote. The whole `storyengine.` namespace is claimed, so a newer or
   * unknown one of ours is refused as ours rather than guessed at as ST's.
   */
  if (schemaIdOf(body)?.startsWith('storyengine.') === true) return 'storyengine.object';
  if (Array.isArray(body['prompts'])) return 'sillytavern.preset.chat';
  if (body['entries'] !== undefined && body['entries'] !== null) return 'sillytavern.lorebook';

  /**
   * **Aventuras' two vault records, above the card probe on purpose.**
   *
   * Both carry a `name`, which is the collision this table's order exists to
   * survive, and neither carries a `CARDISH` field — `alternateGreetings` is
   * camelCase where the card spec's is `alternate_greetings`, so `looksLikeCard`
   * would not in fact claim either of them today. They sit above it anyway,
   * because *would not, today* is the kind of thing that stops being true when
   * somebody adds a spelling to `CARDISH`, and the cost of the stronger order is
   * nothing: each test demands two co-occurring fields no card has.
   *
   * [P4 §1.5] surveyed both shapes and named a converter for them *"the honest
   * remaining work"*; the guards are in `aventuras/shapes.ts` so that the probe
   * and the converter cannot disagree about what they recognise.
   */
  if (isVaultScenario(body)) return 'aventuras.scenario';
  if (isVaultCharacter(body)) return 'aventuras.character';

  if (looksLikeCard(body)) return 'sillytavern.card';

  /**
   * **The three template kinds — recognised, never converted** (`NOT_CONVERTIBLE`).
   *
   * Placed here, below the three that convert and **above** the confidence gate,
   * and each half of that is a claim worth stating.
   *
   * *They cannot swallow anything above them.* No template carries `prompts`,
   * carries `entries`, or is `name` plus a `CARDISH` field — so inserting them
   * here leaves the existing "most distinctive shape first" order intact rather
   * than re-arguing it.
   *
   * *They belong above the gate.* The gate exists because `{content: "…"}` and
   * `{temperature: 0.7}` are shapes half the JSON in the world has, and a folder
   * sweep must not guess on those. Each probe below demands two or three
   * co-occurring field names that only SillyTavern uses, which puts them on the
   * `prompts`-array side of that line. The consequence is deliberate: a loose
   * folder now names its instruct templates instead of counting them as
   * unrecognised, and since none of them converts, a wrong guess cannot cost
   * anybody an object they have to delete.
   *
   * `story_string` is unique to the context template and is enough alone.
   * Instruct needs the `input_sequence`/`output_sequence` pair, because ST's own
   * instruct files carry `story_string_prefix` and `story_string_suffix` — near
   * enough to the context probe to be worth keeping the two apart on purpose.
   * Reasoning is the thinnest of the three, `{name, prefix, suffix, separator}`
   * being the whole of the format, so all three of the triple are required.
   */
  if (typeof body['story_string'] === 'string') return 'sillytavern.template.context';
  if (typeof body['input_sequence'] === 'string' && typeof body['output_sequence'] === 'string') {
    return 'sillytavern.template.instruct';
  }
  if (
    typeof body['prefix'] === 'string' &&
    typeof body['suffix'] === 'string' &&
    typeof body['separator'] === 'string'
  ) {
    return 'sillytavern.template.reasoning';
  }

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
  /**
   * ***A chat preset from before the prompt manager*** (2026-09-27), above the
   * sampler arm because it has sampler fields too. It keeps its prompts in
   * `main_prompt`, `nsfw_prompt` and `jailbreak_prompt` rather than `prompts`,
   * so the arm above never saw it, and this one below took it for a sampler
   * panel: no blocks, and a note about sampler settings. The chat converter
   * migrates it the way SillyTavern does. Below the gate, with the other
   * guesses, because it keys on field names.
   */
  if (LEGACY_CHAT_FIELDS.some((field) => typeof body[field] === 'string')) {
    return 'sillytavern.preset.chat';
  }
  if (SAMPLERISH.some((field) => typeof body[field] === 'number')) {
    return 'sillytavern.preset.text';
  }
  return null;
}

/**
 * ***Whether text is a chat file*** — [P14.8], by content and never by the
 * `.jsonl` on its name, which is this file's rule for everything.
 *
 * **Two lines that are each a JSON object**, or one that is a header carrying
 * `chat_metadata` — among the first three non-blank lines, since a chat is
 * judged by how it opens and a long one should not be parsed twice to be
 * recognised.
 * That is the whole of JSON Lines' shape, and at `any` confidence it is enough:
 * a person picked this file, and the parser that reads it next refuses a file
 * with no messages in it, by name, rather than importing nothing quietly.
 *
 * ***A folder sweep asks for more***, on the reasoning {@link ProbeConfidence}
 * gives for the preset guesses: JSON Lines is what half the log files on a disk
 * are written in, so across a folder nobody vetted, two objects in a row is a
 * shape and not a claim. There the opening must say *chat* — a header with
 * `chat_metadata`, or a line with SillyTavern's `mes` text — which a log file
 * does not.
 */
function looksLikeChat(text: string, confidence: ProbeConfidence): boolean {
  const lines: Record<string, unknown>[] = [];
  let read = 0;
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    read += 1;
    let value: unknown;
    let parses = true;
    try {
      value = JSON.parse(raw);
    } catch {
      parses = false;
    }
    /**
     * *A line that will not parse costs itself, the first one included.* The
     * parser reads a chat from the first line that parses, so a header a
     * crashed write left half-finished is one lost line and a chat after it;
     * refusing the file for it here refused, at this door only, a chat that
     * imports from a swept tree. A first line that parses to something other
     * than an object is still a no: that is JSON, and not a chat's.
     */
    if (isRecord(value)) lines.push(value);
    else if (read === 1 && parses) return false;
    if (lines.length === 2 || read === 3) break;
  }
  const first = lines[0];
  if (first === undefined) return false;
  const header = isRecord(first['chat_metadata']);
  if (!header && lines.length < 2) return false;
  if (confidence === 'any') return true;
  return header || lines.some((line) => typeof line['mes'] === 'string');
}

function chat(filename: string): SourceItem {
  return candidate({ source: filename, format: SILLYTAVERN_CHAT_FORMAT, payload: null });
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
