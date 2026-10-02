// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { AVT_FORMAT } from './aventuras/avt.js';
import { SILLYTAVERN_CHAT_FORMAT } from './sillytavern/chat.js';
import { readUpload, type ProbeConfidence } from './upload.js';

/**
 * What one uploaded file is, decided by its content
 * ([P4 §7.1](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **The probe had no test file of its own until this one**, which is how the
 * ordering claims in its comment stayed claims. It was exercised incidentally
 * through `routes/import.test.ts` and `loose-files.test.ts`, both of which ask
 * about a whole route or a whole walk — so *"order is load-bearing and the
 * reason is collisions on `name`"* was true and unchecked, and the three
 * template arms added beside it would have been three more of the same.
 *
 * The fixtures are the real thing rather than plausible ones:
 *   source  SillyTavern/default/content/presets/{instruct,context,reasoning}/
 *   commit  06bde939fb1e9c4c8d8641d810f0a916b5bce127 (1.19.0, 2026-09-14)
 *   taken   2026-09-01
 * — the same snapshot commit `registries/sillytavern.ts` and
 * `sensitive-fields.ts` already vendor from, which is worth keeping true.
 */

function read(body: unknown, confidence: ProbeConfidence = 'any') {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return readUpload('Whatever.json', bytes, confidence);
}

/** `presets/instruct/ChatML.json`, trimmed to the fields that matter here. */
const INSTRUCT = {
  input_sequence: '<|im_start|>user\n',
  output_sequence: '<|im_start|>assistant\n',
  last_output_sequence: '',
  system_sequence: '<|im_start|>system\n',
  stop_sequence: '<|im_end|>',
  input_suffix: '<|im_end|>\n',
  output_suffix: '<|im_end|>\n',
  system_suffix: '<|im_end|>\n',
  wrap: false,
  macro: true,
  names_behavior: 'always',
  activation_regex: '',
  system_same_as_user: false,
  // The two that sit closest to the context template's own mark, and the reason
  // the context probe asks for `story_string` exactly.
  story_string_prefix: '',
  story_string_suffix: '',
  name: 'ChatML',
};

/** `presets/context/ChatML.json`. */
const CONTEXT = {
  story_string:
    '<|im_start|>system\n{{#if system}}{{system}}\n{{/if}}{{#if description}}{{description}}\n{{/if}}<|im_end|>',
  example_separator: '',
  chat_start: '',
  use_stop_strings: false,
  names_as_stop_strings: true,
  story_string_position: 0,
  story_string_depth: 1,
  story_string_role: 0,
  always_force_name2: true,
  trim_sentences: false,
  single_line: false,
  name: 'ChatML',
};

/** `presets/reasoning/DeepSeek.json` — the whole format, all four fields. */
const REASONING = {
  name: 'DeepSeek',
  prefix: '<think>\n',
  suffix: '\n</think>',
  separator: '\n\n',
};

describe('a SillyTavern template, uploaded on its own', () => {
  const cases = [
    {
      label: 'an instruct template',
      body: INSTRUCT,
      disposition: 'by-position',
      key: 'import.template.instruct',
    },
    {
      label: 'a context template',
      body: CONTEXT,
      disposition: 'by-position',
      key: 'import.template.context',
    },
    {
      label: 'a reasoning template',
      body: REASONING,
      disposition: 'skipped',
      key: 'import.template.reasoning',
    },
  ] as const;

  for (const { label, body, disposition, key } of cases) {
    /**
     * The defect this closes: each of these came back `unrecognised` — *"Nothing
     * here recognised this file"* — about a file the sweep reads by position one
     * code path over.
     */
    it(`${label} is named rather than shrugged at`, () => {
      const result = read(body);

      expect(result.outcome).toBe('observed');
      if (result.outcome !== 'observed') throw new Error('unreachable');
      expect(result.report.disposition).toBe(disposition);
      expect(result.report.notes.map((n) => n.key)).toEqual([key]);
      expect(result.report.notes[0]?.level).toBe('info');
    });

    it(`${label} is never a candidate, because nothing converts one`, () => {
      // A candidate is *one thing a converter can act on*. Wrapping these would
      // mean an arm in `Writer`'s switch that exists to return nothing.
      expect(read(body).outcome).toBe('observed');
      expect(read(body, 'high').outcome).toBe('observed');
    });

    it(`${label} reads the same way in a folder sweep`, () => {
      // Above the confidence gate on purpose: each probe demands two or three
      // co-occurring names only SillyTavern uses, so a sweep may trust them.
      const swept = read(body, 'high');
      if (swept.outcome !== 'observed') throw new Error('unreachable');
      expect(swept.report.disposition).toBe(disposition);
    });
  }
});

describe('the probe order, adversarially', () => {
  /**
   * The three arms above the templates must stay unreachable from below. Each
   * case here is a file that matches a template mark *and* something more
   * distinctive, and the more distinctive answer has to win.
   */
  it('a chat preset that also carries story_string is still a preset', () => {
    const result = read({ prompts: [{ identifier: 'main', content: 'x' }], story_string: 'x' });

    if (result.outcome !== 'candidate') throw new Error('expected a candidate');
    expect(result.candidate.format).toBe('sillytavern.preset.chat');
  });

  it('a lorebook that also carries the instruct pair is still a lorebook', () => {
    const result = read({ entries: {}, input_sequence: 'a', output_sequence: 'b' });

    if (result.outcome !== 'candidate') throw new Error('expected a candidate');
    expect(result.candidate.format).toBe('sillytavern.lorebook');
  });

  it('a card that also carries the reasoning triple is still a card', () => {
    const result = read({
      name: 'Vera',
      first_mes: 'Hello.',
      prefix: 'a',
      suffix: 'b',
      separator: 'c',
    });

    if (result.outcome !== 'candidate') throw new Error('expected a candidate');
    expect(result.candidate.format).toBe('sillytavern.card');
  });

  it('an instruct template is not read as a context one', () => {
    // `story_string_prefix` is a real instruct field and the near miss the
    // context probe is written narrowly to avoid.
    const result = read(INSTRUCT);
    if (result.outcome !== 'observed') throw new Error('unreachable');
    expect(result.report.notes[0]?.key).toBe('import.template.instruct');
  });

  it('a sysprompt preset still wins over nothing, and only below the gate', () => {
    // Unchanged behaviour, asserted because the new arms sit directly above it.
    const loose = read({ name: 'Harbour', content: 'You are a narrator.' });
    if (loose.outcome !== 'candidate') throw new Error('expected a candidate');
    expect(loose.candidate.format).toBe('sillytavern.preset.sysprompt');

    expect(read({ name: 'Harbour', content: 'You are a narrator.' }, 'high').outcome).toBe(
      'observed',
    );
  });
});

describe('a chat preset from before the prompt manager', () => {
  /**
   * *(2026-09-27)* Its prompts are in three fields of its own and it carries
   * sampler settings, so it read as a sampler panel: no blocks, and a note
   * about sampler settings. It is a chat preset, and the converter migrates it.
   */
  it('is read as a chat preset, not as a sampler panel', () => {
    const result = read({ main_prompt: 'You are the narrator.', temperature: 0.9, top_p: 1 });

    if (result.outcome !== 'candidate') throw new Error('expected a candidate');
    expect(result.candidate.format).toBe('sillytavern.preset.chat');
  });
});

describe('the probe is not over-eager', () => {
  it('refuses a partial reasoning triple', () => {
    const result = read({ prefix: 'a', suffix: 'b' });

    if (result.outcome !== 'observed') throw new Error('unreachable');
    expect(result.report.notes[0]?.key).toBe('import.file.unrecognised');
  });

  it('refuses half the instruct pair', () => {
    const result = read({ input_sequence: 'x', name: 'Half' });

    if (result.outcome !== 'observed') throw new Error('unreachable');
    expect(result.report.notes[0]?.key).toBe('import.file.unrecognised');
  });

  it('refuses a non-string mark', () => {
    // `story_string: true` is not a context template, and a truthiness check
    // here would have said it was.
    const result = read({ story_string: true, name: 'Nope' });

    if (result.outcome !== 'observed') throw new Error('unreachable');
    expect(result.report.notes[0]?.key).toBe('import.file.unrecognised');
  });

  it('still refuses the config file that started all this', () => {
    // `appsettings.json` matched the `content` arm in review and was imported as
    // a preset. It has no template mark either, and must not gain one.
    const result = read({ name: 'my-app', version: '1.0.0', description: 'A thing.' }, 'high');

    if (result.outcome !== 'observed') throw new Error('unreachable');
    expect(result.report.disposition).toBe('unrecognised');
  });
});

/**
 * ***A chat file, known by its lines*** —
 * [P14.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * SillyTavern's chat is JSON Lines, so it fails the document parse this file
 * starts with, and until this stage it came back *nothing here recognised
 * this*. Recognised by content, never by `.jsonl` — the name below is
 * deliberately wrong to prove it.
 */
describe('a chat file', () => {
  const HEADER = {
    user_name: 'unused',
    character_name: 'unused',
    chat_metadata: { tainted: true },
  };
  const LINE = { name: 'Vera', is_user: false, mes: 'Hm.', send_date: '2026-01-01T10:00:00Z' };
  const lines = (...rows: unknown[]): Uint8Array =>
    new TextEncoder().encode(rows.map((row) => JSON.stringify(row)).join('\n'));
  const format = (item: ReturnType<typeof readUpload>): string | null =>
    item.outcome === 'candidate' ? item.candidate.format : null;

  it('is two objects on two lines, and becomes a chat candidate for the session pass', () => {
    const item = readUpload('notes.txt', lines(HEADER, LINE));

    expect(format(item)).toBe('sillytavern.chat');
  });

  it('is a header alone, which is one JSON document, and still a chat', () => {
    // The parser then refuses it for having no messages, which is the true
    // thing to say about it; the probe's job is only to know what it is.
    expect(format(readUpload('Vera.jsonl', lines(HEADER)))).toBe('sillytavern.chat');
  });

  it('is a chat whose second line a crashed write left half-finished', () => {
    const bytes = new TextEncoder().encode(`${JSON.stringify(HEADER)}\n{"name":"Vera","mes":"H`);

    expect(format(readUpload('Vera.jsonl', bytes))).toBe('sillytavern.chat');
  });

  it('is one message and no header, which an old group chat with only its greeting is', () => {
    // Headerless, as a group chat written before `chat_metadata` reached
    // groups is, and one line long, so one JSON document. The parser reads
    // it as a group; refusing it here refused it at this door only.
    const greeting = { ...LINE, original_avatar: 'Vera.png' };

    expect(format(readUpload('Vera.jsonl', lines(greeting)))).toBe('sillytavern.chat');
    // A folder sweep does not take one object with a text field on its word.
    expect(readUpload('Vera.jsonl', lines(greeting), 'high').outcome).toBe('observed');
  });

  it('is a chat whose first line a crashed write left half-finished', () => {
    // The parser reads from the first line that parses, so it costs one line.
    const bytes = new TextEncoder().encode(
      `{"chat_metadata":{"tai\n${JSON.stringify(LINE)}\n${JSON.stringify(LINE)}`,
    );

    expect(format(readUpload('Vera.jsonl', bytes))).toBe('sillytavern.chat');
    expect(format(readUpload('Vera.jsonl', bytes, 'high'))).toBe('sillytavern.chat');
  });

  it('is not a first line that is not an object', () => {
    const bytes = new TextEncoder().encode(`[1, 2]\n${JSON.stringify(LINE)}`);

    expect(readUpload('Vera.jsonl', bytes).outcome).toBe('observed');
  });

  it('asks a folder sweep for a chat’s own marks, not just the shape of JSON Lines', () => {
    // A log file is JSON Lines too. Across a folder nobody vetted, two objects
    // in a row is a shape and not a claim.
    const log = lines({ level: 'info', msg: 'started' }, { level: 'info', msg: 'ready' });

    expect(readUpload('server.log', log, 'any').outcome).toBe('candidate');
    expect(readUpload('server.log', log, 'high').outcome).toBe('observed');
    expect(format(readUpload('Vera.jsonl', lines(LINE, LINE), 'high'))).toBe('sillytavern.chat');
  });
});

/**
 * ***The probe's order, where two branches each put a probe first*** — the
 * merge of [P13.15](../../../../docs/design/workplan/30-p13-aventuras-import.md)
 * and [P14.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * P13.15 put the Aventuras story-file probe ahead of every JSON shape, because
 * a `.avt` has `entries` and the SillyTavern world probe took it for a
 * lorebook. P14.8 put the chat probes where JSON Lines fail the document
 * parse, and a one-line chat where the document parse succeeds. Each branch
 * tested its own half; this holds the two together, so a later reordering
 * that lets one take the other's file is a red test rather than a story
 * imported as lore, or a chat imported as a story.
 */
describe('a story file and a chat, read by one probe', () => {
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
  const format = (item: ReturnType<typeof readUpload>): string | null =>
    item.outcome === 'candidate' ? item.candidate.format : null;

  /** The least a `.avt` is: a 1.x version, a `story` with an id, and `entries`. */
  const AVT = JSON.stringify({
    version: '1.10.0',
    story: { id: 'story-1', title: 'The Lantern Fork' },
    entries: [],
  });
  const HEADER = { user_name: 'You', character_name: 'Vera', chat_metadata: {} };
  const LINE = { name: 'Vera', is_user: false, mes: 'Hm.', send_date: '2026-01-01T10:00:00Z' };

  it('reads a story file as a story, at either confidence, whatever it is called', () => {
    expect(format(readUpload('The Lantern Fork.avt', encode(AVT)))).toBe(AVT_FORMAT);
    expect(format(readUpload('worlds.json', encode(AVT), 'high'))).toBe(AVT_FORMAT);
    expect(format(readUpload('chat.jsonl', encode(AVT)))).toBe(AVT_FORMAT);
  });

  it('leaves a chat to the chat probes, even one whose lines say story and entries', () => {
    // The two keys a story file is recognised by, inside a chat's line: the
    // story probe's first look (`mayBeAvt`) finds them, and its parse then
    // finds more than one document and lets the chat probes have it.
    const talk = { ...LINE, mes: 'The story so far.', extra: { story: {}, entries: [] } };
    const chat = [HEADER, LINE, talk].map((row) => JSON.stringify(row)).join('\n');

    expect(format(readUpload('Vera.jsonl', encode(chat)))).toBe(SILLYTAVERN_CHAT_FORMAT);
    expect(format(readUpload('Vera.jsonl', encode(chat), 'high'))).toBe(SILLYTAVERN_CHAT_FORMAT);
    // A header alone is one JSON document, and still not a story file.
    expect(format(readUpload('Vera.jsonl', encode(JSON.stringify(HEADER))))).toBe(
      SILLYTAVERN_CHAT_FORMAT,
    );
  });
});
