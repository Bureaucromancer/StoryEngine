// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { StepCallRequest, StepCallResult, StepHost, StepInput } from '@storyengine/sdk';
import type { OutputMessage, SpeakerPick, Turn } from '@storyengine/shared';

import { randomOver } from '../rng/random.js';
import { Rng } from '../rng/rng.js';
import {
  keptSpeakers,
  readPick,
  SE_SPEAKERS_SMART,
  smartSpeakers,
  type SmartMember,
  type SmartSpeakersContext,
} from './smart-speakers.js';

/**
 * ***Smart order's call*** — `se.speakers.smart`, [P14 §1.3a], built at
 * [P14.1]. The rules that decide without it are `speakers.test.ts`'s; the
 * whole turn — who the later steps are handed, and that the rules really do
 * make no call — is `runner.test.ts`'s.
 *
 * **What this file holds the step to is §1.3a's four promises about the
 * call**: its own small prompt, a closed answer enforced a second time by the
 * reader, a fallback on every failure that says it was one, and a rewrite that
 * makes no call. The host is a double whose `call` answers what each test says,
 * because what is under test is what the step makes of an answer rather than
 * whether a provider produced one.
 */

const VERA: SmartMember = {
  id: 'id-vera',
  name: 'Vera',
  talkativeness: 0.5,
  summary: 'A harbour pilot who has seen the flood coming for a week.',
};
const LUND: SmartMember = { id: 'id-lund', name: 'Lund', talkativeness: 0.25, summary: '' };
const ABEL: SmartMember = {
  id: 'id-abel',
  name: 'Abel',
  talkativeness: 1,
  summary: 'The lighthouse keeper’s son.',
};
/** The rules' pick for every test here: what the tape drew before the call. */
const FALLBACK = [LUND.id];

function turn(id: string, over: Partial<Turn> = {}): Turn {
  return {
    id,
    sessionId: 's',
    parentTurnId: null,
    createdAt: '2026-09-29T00:00:00.000Z',
    status: 'complete',
    tape: [],
    effects: [],
    ...over,
  };
}

function said(...messages: [SmartMember | null, string][]): NonNullable<Turn['output']> {
  const list: OutputMessage[] = messages.map(([who, text]) => ({
    speaker: who === null ? null : { id: who.id, name: who.name },
    text,
  }));
  return { text: list.map((one) => one.text).join('\n\n'), messages: list };
}

function move(text: string): NonNullable<Turn['input']> {
  return { actorId: null, kind: 'say', text, raw: text };
}

/**
 * A host whose `call` answers with whatever the test says — or throws it —
 * and remembers what it was asked. The tape underneath is a real one, and the
 * step must not draw on it: the fallback was drawn before the step existed.
 */
function host(
  answer: Partial<StepCallResult> | Error = {},
  signal: AbortSignal = new AbortController().signal,
): StepHost & { asked: StepCallRequest[] } {
  const asked: StepCallRequest[] = [];
  return {
    asked,
    call: (request) => {
      asked.push(request);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({ callId: 'c1', text: '', usage: null, ...answer });
    },
    random: randomOver(new Rng()),
    signal,
  };
}

/** An answer as a structured endpoint returns it: the object, and its JSON as text. */
function answered(value: unknown): Partial<StepCallResult> {
  return { object: value, text: JSON.stringify(value) };
}

/**
 * An answer the schema refused — `performCall` withholds the object and hands
 * the step the text, which is what a name where an id belongs looks like.
 */
function inWords(text: string): Partial<StepCallResult> {
  return { text };
}

async function run(
  options: {
    answer?: Partial<StepCallResult> | Error;
    history?: Turn[];
    input?: StepInput['input'];
    hidden?: SmartSpeakersContext['hidden'];
    maxPerRound?: number;
    rewrite?: SmartSpeakersContext['rewrite'];
    signal?: AbortSignal;
  } = {},
): Promise<{
  reported: SpeakerPick[];
  asked: StepCallRequest[];
  thrown: unknown;
}> {
  const reported: SpeakerPick[] = [];
  const { run: step } = smartSpeakers({
    eligible: [VERA, LUND, ABEL],
    names: new Map([
      [VERA.id, VERA.name],
      [LUND.id, LUND.name],
      [ABEL.id, ABEL.name],
      ['id-mara', 'Mara'],
    ]),
    player: 'Ned',
    hidden: options.hidden ?? {},
    fallback: FALLBACK,
    maxPerRound: options.maxPerRound ?? 3,
    rewrite: options.rewrite ?? null,
    report: (pick) => {
      reported.push(pick);
    },
  });
  const double = host(options.answer, options.signal);
  let thrown: unknown;
  try {
    const result = await step(
      {
        turnId: 't-new',
        sessionId: 's',
        parentTurnId: null,
        channels: {},
        history: options.history ?? [],
        ...(options.input === undefined ? {} : { input: options.input }),
      },
      double,
    );
    // The answer never travels by the result: that door is what §1.3a point 6
    // keeps shut.
    expect(result).toEqual({});
  } catch (error) {
    thrown = error;
  }
  return { reported, asked: double.asked, thrown };
}

function textOf(request: StepCallRequest | undefined, id: string): string {
  const found = request?.candidates?.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no candidate ${id}`);
  return found.text;
}

describe('the step', () => {
  it('is an engine pre step that warns rather than aborting, on the prose role', () => {
    const { definition } = smartSpeakers({
      eligible: [VERA, LUND],
      names: new Map(),
      player: null,
      hidden: {},
      fallback: [],
      maxPerRound: 3,
      rewrite: null,
      report: () => undefined,
    });
    expect(definition).toMatchObject({
      id: SE_SPEAKERS_SMART,
      stage: 'pre',
      failure: 'warn',
      role: 'prose',
      reads: ['history'],
      writes: [],
    });
    // Contributes nothing: who speaks goes through the runner's cell.
    expect(definition.contributes).toBeUndefined();
  });
});

/**
 * **Its own candidates, which is what makes it cheap** — §1.3a point 2. The
 * preset and the retriever never run for a call that brings its own, so these
 * three blocks are the whole prompt.
 */
describe('the call', () => {
  it('asks once, with its own prompt, a closed schema and temperature 0.2', async () => {
    const { asked } = await run({ answer: answered({ speakers: [{ id: VERA.id }] }) });

    expect(asked).toHaveLength(1);
    const [request] = asked;
    expect(request?.candidates?.map((candidate) => candidate.id)).toEqual([
      'se.speakers.smart.task',
      'se.speakers.smart.roster',
      'se.speakers.smart.recent',
    ]);
    expect(request?.params).toEqual({ temperature: 0.2 });
    expect(request?.stream).toBeUndefined();
    expect(request?.schema).toEqual({
      type: 'object',
      properties: {
        speakers: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', enum: [VERA.id, LUND.id, ABEL.id] },
              because: { type: 'string' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      required: ['speakers'],
      additionalProperties: false,
    });
  });

  it('caps the schema at the session’s maxPerRound, and says the same in words', async () => {
    const { asked } = await run({
      answer: answered({ speakers: [{ id: VERA.id }] }),
      maxPerRound: 2,
    });
    expect(asked[0]?.schema).toMatchObject({ properties: { speakers: { maxItems: 2 } } });
    expect(textOf(asked[0], 'se.speakers.smart.task')).toContain('Name at most 2.');
  });

  it('never allows more answers than there are people to name', async () => {
    const { asked } = await run({
      answer: answered({ speakers: [{ id: VERA.id }] }),
      maxPerRound: 8,
    });
    expect(asked[0]?.schema).toMatchObject({ properties: { speakers: { maxItems: 3 } } });
  });

  it('gives the roster: id, name, talkativeness, the start of the summary, and when they last spoke', async () => {
    const long = { ...VERA, summary: 'x'.repeat(400) };
    const reported: SpeakerPick[] = [];
    const { run: step } = smartSpeakers({
      eligible: [long, LUND, ABEL],
      names: new Map(),
      player: null,
      hidden: {},
      fallback: FALLBACK,
      maxPerRound: 3,
      rewrite: null,
      report: (pick) => {
        reported.push(pick);
      },
    });
    const double = host(answered({ speakers: [{ id: VERA.id }] }));
    await step(
      {
        turnId: 't-new',
        sessionId: 's',
        parentTurnId: null,
        channels: {},
        history: [
          turn('t1', { input: move('Well?'), output: said([LUND, 'No.']) }),
          // Bookkeeping — a HUD edit — is not a round nobody spoke in.
          turn('t2'),
          turn('t3', { input: move('And you?'), output: said([ABEL, 'Maybe.']) }),
        ],
      },
      double,
    );
    const roster = textOf(double.asked[0], 'se.speakers.smart.roster');

    expect(roster).toContain('id-vera: Vera — talkativeness 0.5; has not spoken yet');
    expect(roster).toContain('id-lund: Lund — talkativeness 0.25; last spoke 2 rounds ago');
    expect(roster).toContain('id-abel: Abel — talkativeness 1; last spoke 1 round ago');
    // ~300 characters of summary: cut, with the cut marked.
    expect(roster).toContain(`${'x'.repeat(299)}…`);
    expect(roster).not.toContain('x'.repeat(300));
    // Somebody with no summary gets no empty line pretending to be one.
    expect(roster).toContain('last spoke 2 rounds ago\n\nid-abel');
  });

  it('shows the last six messages, named, oldest first, ending on the move being answered', async () => {
    const history = [
      turn('t1', { input: move('One.'), output: said([VERA, 'Two.'], [LUND, 'Three.']) }),
      turn('t2', { input: move('Four.'), output: said([null, 'Five, the narrator.']) }),
      turn('t3', { input: move('Six.'), output: said([ABEL, 'Seven.']) }),
    ];
    const { asked } = await run({
      answer: answered({ speakers: [{ id: VERA.id }] }),
      history,
      input: move('Eight.'),
    });
    const recent = textOf(asked[0], 'se.speakers.smart.recent');

    expect(recent.split('\n').slice(2)).toEqual([
      'Lund: Three.',
      'Ned (the player): Four.',
      'Narrator: Five, the narrator.',
      'Ned (the player): Six.',
      'Abel: Seven.',
      'Ned (the player): Eight.',
    ]);
  });

  it('cuts a long message to about 600 characters', async () => {
    const { asked } = await run({
      answer: answered({ speakers: [{ id: VERA.id }] }),
      history: [turn('t1', { output: said([VERA, `${'word '.repeat(200)}end`]) })],
    });
    const line = textOf(asked[0], 'se.speakers.smart.recent').split('\n').at(-1) ?? '';
    expect(line.startsWith('Vera: word word')).toBe(true);
    expect(line.endsWith('…')).toBe(true);
    expect(line.length).toBe('Vera: '.length + 600);
  });

  /**
   * ***Hidden lines are left out*** — *"the orchestrator sees what the
   * characters see"*. A whole turn, input and all, and a single message of
   * another; and a hidden message is not *speaking*, for the roster either.
   */
  it('leaves out hidden lines, keyed as the session keys them', async () => {
    const history = [
      turn('t1', { input: move('A secret.'), output: said([VERA, 'Hidden reply.']) }),
      turn('t2', {
        input: move('Out loud.'),
        output: said([LUND, 'Kept.'], [ABEL, 'Hidden aside.']),
      }),
    ];
    const { asked } = await run({
      answer: answered({ speakers: [{ id: VERA.id }] }),
      history,
      hidden: { t1: true, t2: [1] },
    });
    const recent = textOf(asked[0], 'se.speakers.smart.recent');
    const roster = textOf(asked[0], 'se.speakers.smart.roster');

    expect(recent).toContain('Ned (the player): Out loud.');
    expect(recent).toContain('Lund: Kept.');
    expect(recent).not.toContain('secret');
    expect(recent).not.toContain('Hidden');
    expect(roster).toContain('Vera — talkativeness 0.5; has not spoken yet');
    expect(roster).toContain('Abel — talkativeness 1; has not spoken yet');
  });

  it('names a speaker by the cast’s name, and a stranger by the name their message carries', async () => {
    const stranger = { id: 'id-gone', name: 'Old Tom', talkativeness: 0, summary: '' };
    const { asked } = await run({
      answer: answered({ speakers: [{ id: VERA.id }] }),
      history: [
        turn('t1', { output: said([{ ...VERA, name: 'Vee' }, 'Hi.'], [stranger, 'Bye.']) }),
      ],
    });
    const recent = textOf(asked[0], 'se.speakers.smart.recent');
    expect(recent).toContain('Vera: Hi.');
    expect(recent).toContain('Old Tom: Bye.');
  });

  it('says so when nothing has been said yet', async () => {
    const { asked } = await run({ answer: answered({ speakers: [{ id: VERA.id }] }) });
    expect(textOf(asked[0], 'se.speakers.smart.recent')).toBe('Nothing has been said yet.');
  });
});

describe('a usable answer', () => {
  it('is reported as the model’s pick, in its order, with each because', async () => {
    const { reported, thrown } = await run({
      answer: answered({
        speakers: [{ id: ABEL.id, because: 'He was asked outright.' }, { id: VERA.id }],
      }),
    });
    expect(thrown).toBeUndefined();
    expect(reported).toEqual([
      {
        by: 'model',
        picked: [
          { id: ABEL.id, name: 'Abel', because: 'He was asked outright.' },
          { id: VERA.id, name: 'Vera' },
        ],
      },
    ]);
  });

  it('keeps one line of a because, cut to a length a panel can hold', async () => {
    const { reported } = await run({
      answer: answered({
        speakers: [{ id: ABEL.id, because: `${'y'.repeat(300)}\nand a second line` }],
      }),
    });
    const because = reported[0]?.picked[0]?.because ?? '';
    expect(because).toHaveLength(200);
    expect(because.endsWith('…')).toBe(true);
    expect(because).not.toContain('second line');
  });

  /**
   * ***A name, when it names exactly one eligible member*** — §1.3a point 3,
   * *"because Marinara found models do that"*. It fails the enum, so it arrives
   * as text; the reader is what lets it through.
   */
  it('accepts a name that matches exactly one eligible member', async () => {
    const { reported, thrown } = await run({
      answer: inWords('{"speakers":[{"id":"abel","because":"Named."}]}'),
    });
    expect(thrown).toBeUndefined();
    expect(reported).toEqual([
      { by: 'model', picked: [{ id: ABEL.id, name: 'Abel', because: 'Named.' }] },
    ]);
  });

  it('drops an ineligible id beside eligible ones, rather than refusing the answer', async () => {
    const { reported } = await run({
      answer: inWords('{"speakers":[{"id":"id-mara"},{"id":"id-vera"}]}'),
    });
    expect(reported[0]).toMatchObject({ by: 'model', picked: [{ id: VERA.id }] });
  });
});

/**
 * **Every failure lands on the fallback, and says so** — §1.3a point 4. The
 * fallback is reported *and* the step throws, which is what makes the runner
 * record a warned outcome carrying both who spoke instead and why.
 */
describe('an unusable answer', () => {
  const cases: [string, Partial<StepCallResult>, string][] = [
    [
      'an id nobody here may choose',
      inWords('{"speakers":[{"id":"id-mara"}]}'),
      'named nobody who can reply here',
    ],
    [
      'the name of somebody who is not eligible',
      inWords('{"speakers":[{"id":"Mara"}]}'),
      'named nobody who can reply here',
    ],
    ['an empty list', answered({ speakers: [] }), 'named nobody to reply'],
    ['prose', inWords('I think Vera should answer.'), 'could not be read'],
    ['an object of some other shape', answered({ who: VERA.id }), 'could not be read'],
  ];

  for (const [what, answer, says] of cases) {
    it(`lands on the fallback for ${what}, and throws to say so`, async () => {
      const { reported, thrown } = await run({ answer });
      expect(reported).toEqual([{ by: 'fallback', picked: [{ id: LUND.id, name: 'Lund' }] }]);
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain(says);
      expect((thrown as Error).message).toContain('rule-based pick played');
    });
  }

  it('does not accept a name two eligible members share', () => {
    const twins = [
      { ...VERA, id: 'id-mara-1', name: 'Mara' },
      { ...LUND, id: 'id-mara-2', name: 'Mara' },
    ];
    expect(readPick(['Mara'], twins, 3)).toEqual({ ok: false, why: 'ineligible' });
  });

  it('lands on the fallback when the call throws, and rethrows it for the runner to classify', async () => {
    const failure = new Error('The endpoint went quiet.');
    const { reported, thrown } = await run({ answer: failure });
    expect(reported).toEqual([{ by: 'fallback', picked: [{ id: LUND.id, name: 'Lund' }] }]);
    expect(thrown).toBe(failure);
  });

  /**
   * *Not on a Stop*: a cancelled turn played nobody, and an outcome saying the
   * rules' pick played would be a claim about a turn that did not run.
   */
  it('reports nothing when the turn was stopped', async () => {
    const stop = new AbortController();
    stop.abort();
    const { reported, thrown } = await run({
      answer: new Error('The request was aborted.'),
      signal: stop.signal,
    });
    expect(reported).toEqual([]);
    expect(thrown).toBeInstanceOf(Error);
  });
});

/**
 * **Lenient about the wrapping, strict about the content** — the reader's
 * docstring. What a model asked in words writes, read; what it names, held to
 * the eligible list.
 */
describe('the reader', () => {
  const ALL = [VERA, LUND, ABEL];

  it('reads a bare array of ids, and one fenced in markdown after a sentence', () => {
    expect(readPick([ABEL.id], ALL, 3)).toEqual({
      ok: true,
      picked: [{ id: ABEL.id, name: 'Abel' }],
    });
    expect(readPick('Here you go:\n```json\n{"speakers":[{"id":"id-lund"}]}\n```', ALL, 3)).toEqual(
      { ok: true, picked: [{ id: LUND.id, name: 'Lund' }] },
    );
  });

  it('keeps the first mention of anybody named twice, and stops at the cap', () => {
    const reading = readPick(
      { speakers: [{ id: VERA.id }, { id: 'Vera' }, { id: ABEL.id }, { id: LUND.id }] },
      ALL,
      2,
    );
    expect(reading).toEqual({
      ok: true,
      picked: [
        { id: VERA.id, name: 'Vera' },
        { id: ABEL.id, name: 'Abel' },
      ],
    });
  });

  it('matches a name across case, spacing and composition', () => {
    const zoe = { ...VERA, id: 'id-zoe', name: 'Zoë Hart' };
    expect(readPick(['  zoë   HART '], [zoe, LUND], 3)).toEqual({
      ok: true,
      picked: [{ id: 'id-zoe', name: 'Zoë Hart' }],
    });
  });

  it('says which of the three ways an answer failed', () => {
    expect(readPick(undefined, ALL, 3)).toEqual({ ok: false, why: 'unreadable' });
    expect(readPick('{"speakers": [', ALL, 3)).toEqual({ ok: false, why: 'unreadable' });
    expect(readPick({ speakers: [] }, ALL, 3)).toEqual({ ok: false, why: 'empty' });
    expect(readPick({ speakers: [42, { because: 'no id' }] }, ALL, 3)).toEqual({
      ok: false,
      why: 'ineligible',
    });
  });
});

/**
 * ***Rewrite keeps the speakers, and makes no call*** — §1.3a point 7.
 */
describe('a rewrite', () => {
  it('writes the redone turn’s speakers and asks nobody', async () => {
    const { reported, asked, thrown } = await run({
      answer: new Error('must not be called'),
      rewrite: { kept: [ABEL.id, VERA.id] },
    });
    expect(asked).toEqual([]);
    expect(thrown).toBeUndefined();
    expect(reported).toEqual([
      {
        by: 'rewrite',
        picked: [
          { id: ABEL.id, name: 'Abel' },
          { id: VERA.id, name: 'Vera' },
        ],
      },
    ]);
  });

  it('keeps only who may still be chosen, and replays the tape’s pick when that is nobody', async () => {
    const some = await run({ rewrite: { kept: ['id-mara', VERA.id, VERA.id] } });
    expect(some.reported[0]?.picked.map((one) => one.id)).toEqual([VERA.id]);

    const none = await run({ rewrite: { kept: ['id-mara'] } });
    expect(none.asked).toEqual([]);
    expect(none.reported).toEqual([{ by: 'rewrite', picked: [{ id: LUND.id, name: 'Lund' }] }]);
  });
});

describe('the speakers a rewrite keeps', () => {
  it('are the redone turn’s messages’ speakers, in order, once each', () => {
    const redone = turn('t1', {
      output: said([VERA, 'One.'], [null, 'The narrator.'], [ABEL, 'Two.'], [VERA, 'Three.']),
    });
    expect(keptSpeakers(redone)).toEqual([VERA.id, ABEL.id]);
  });

  it('fall back to the turn’s own smart pick when no message names anybody', () => {
    const redone = turn('t1', {
      output: { text: 'One narrated reply.' },
      steps: [
        {
          stepId: SE_SPEAKERS_SMART,
          stage: 'pre',
          state: 'ok',
          contributed: { blocks: 0, effects: 0 },
          wallMs: 1,
          speakers: { by: 'model', picked: [{ id: LUND.id, name: 'Lund', because: 'Asked.' }] },
        },
      ],
    });
    expect(keptSpeakers(redone)).toEqual([LUND.id]);
  });

  it('are nobody when neither says, which the step reads as replaying the tape', () => {
    expect(keptSpeakers(turn('t1', { output: { text: 'Narrated.' } }))).toEqual([]);
    expect(keptSpeakers(turn('t1'))).toEqual([]);
  });
});
