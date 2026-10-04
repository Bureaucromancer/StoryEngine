// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type {
  StepCastMember,
  StepCallRequest,
  StepCallResult,
  StepHost,
  StepInput,
} from '@storyengine/sdk';

import { EXPRESSION_CHANNEL, LOCATION_CHANNEL, STAGING_CHANNEL } from './mode.js';
import { STAGE_STEP, stage } from './staging.js';

/**
 * ***What a scene looks like, decided by a step in the mode that owns it*** —
 * [06 §7.2], [P7.12].
 *
 * **The three gates are what most of this asserts**, and the reason is cost
 * rather than correctness: a `post` step that made a model call on every turn of
 * every Scene session would roughly double the wait on a self-hosted build, for
 * a feature that is off by default and that most imported characters cannot use
 * at all. *Free* is a property that has to be tested, because nothing else
 * fails when it stops being true.
 *
 * **The fourth claim is the attribution.** `se.expression` is `model-proposed`,
 * which is the policy that lets a step write it — and the effect has to carry
 * `{ kind: 'model', callId }` for that to mean anything. A step stamping
 * `{ kind: 'step' }` would be refused by `refuse()`, so this is also the
 * assertion that would catch the write silently stopping.
 */

/** Somebody with faces to choose from. */
function member(over: Partial<StepCastMember> = {}): StepCastMember {
  return {
    actorId: 'a-vera',
    name: 'Vera',
    kind: 'actors',
    media: [
      { id: 'm-neutral', role: 'expression', label: 'neutral' },
      { id: 'm-angry', role: 'expression', label: 'angry' },
    ],
    ...over,
  };
}

/**
 * A host that records what it was asked and answers with whatever the test says.
 *
 * ***Two of `StepHost`'s three members are stubbed by omission, and that is a
 * fact about the package rather than laziness.*** This step draws nothing and
 * does no I/O, so `random` and `signal` are never read — and `signal` is an
 * `AbortSignal`, a **host global** that `@storyengine/sdk`'s own tsconfig
 * declares with `types: ["node"]` and this package's deliberately does not. Its
 * one dependency is the SDK, which is [20 §10]'s whole claim; adding
 * `@types/node` so a test could construct an `AbortController` would be a second
 * one, bought to fake a field nothing reads. So the cast is stated here instead.
 *
 * `call` keeps its annotation, so the half that matters is still typechecked.
 */
function host(answer: Partial<StepCallResult> = {}): StepHost & { asked: StepCallRequest[] } {
  const asked: StepCallRequest[] = [];
  const call = (request: StepCallRequest): Promise<StepCallResult> => {
    asked.push(request);
    return Promise.resolve({ callId: 'c-stage', text: '', usage: null, ...answer });
  };
  return { asked, call } as unknown as StepHost & { asked: StepCallRequest[] };
}

function input(over: Partial<StepInput> = {}): StepInput {
  return {
    turnId: 't-new',
    sessionId: 's',
    parentTurnId: null,
    channels: { 'se.staging': { value: true } as StepInput['channels'][string] },
    output: { text: 'Vera slammed the ledger shut and did not look up.' },
    cast: [member()],
    ...over,
  };
}

describe('what the stager declares', () => {
  /**
   * *The toggle is a declared read, which is what makes the gate legible from
   * the definition* — a step that gated on a channel it had not declared would
   * be handed an empty map by `filterReads` and quietly behave as though staging
   * were always off.
   */
  it('reads its own toggles, the prose and the cast, and writes the two channels', () => {
    expect(STAGE_STEP.reads).toEqual(['output', 'cast', 'se.staging', 'se.backdrop.on']);
    expect(STAGE_STEP.writes).toEqual([EXPRESSION_CHANNEL.id, LOCATION_CHANNEL.id]);
    // Not `se.backdrop`: that one is `engine-computed` and [P9] fills it, which
    // is why §7.2 reads like it forces [26 C16] and does not.
    expect(STAGE_STEP.writes).not.toContain('se.backdrop');
  });

  /**
   * **`warn`, never `abort`.** The prose exists by the time a `post` step runs,
   * and a turn thrown away because a picture could not be chosen would be the
   * scenery deciding whether the scene happened.
   */
  it('never costs the turn', () => {
    expect(STAGE_STEP.stage).toBe('post');
    expect(STAGE_STEP.failure).toBe('warn');
  });
});

/**
 * ~~The three gates, none of which costs a call~~ — two now: text-only and no
 * prose (2026-09-30). The third, *nobody has a face*, stood in front of the
 * place as well, and the place is asked on its own since.
 */
describe('the gates, and the question each one leaves', () => {
  it('does nothing at all when the session is text-only', async () => {
    const talking = host();
    const result = await stage(
      input({ channels: { 'se.staging': { value: false } as StepInput['channels'][string] } }),
      talking,
    );

    expect(talking.asked).toEqual([]);
    expect(result).toEqual({});
  });

  /**
   * *Absent reads as off*, which restates the channel's `init` — and is the
   * behaviour a session written before this channel existed gets, since nothing
   * backfills a channel onto an old `session.json`.
   */
  it('treats a channel that was never written as off', async () => {
    const talking = host();
    await stage(input({ channels: {} }), talking);

    expect(talking.asked).toEqual([]);
    expect(STAGING_CHANNEL.init).toEqual({ kind: 'literal', value: false });
  });

  it('does not ask about prose that is not there', async () => {
    const talking = host();
    await stage(input({ output: { text: '   ' } }), talking);

    expect(talking.asked).toEqual([]);
  });

  /**
   * ~~***The gate that will fire most often in practice.*** A character imported
   * from a card with one portrait and no `sprites/` directory has nothing to
   * choose between, and a session of such characters is the common case — so a
   * step that asked anyway would spend a call per turn to be told nothing.~~
   *
   * ***Nobody with a face is still a question about the place*** (2026-09-30).
   * The gate stood in front of both questions, and this step is the place's
   * only writer, so in the common case the place was never written and the
   * backdrop was drawn from the tone alone, once a session. It asks where the
   * scene is and nothing about people — no roster, no faces in the schema.
   */
  it.each([
    ['nobody in the scene has a face', [member({ media: [{ id: 'm-card', role: 'portrait' }] })]],
    ['there is nobody in the scene', []],
    ['the one with faces is muted', [member({ present: false })]],
  ])('asks only where the scene is when %s', async (_why, cast) => {
    const talking = host({ object: { place: 'the harbourmaster’s office' } });
    const result = await stage(input({ cast }), talking);

    expect(talking.asked).toHaveLength(1);
    const asked = talking.asked[0];
    expect((asked?.candidates ?? []).map((one) => one.id)).toEqual([
      'se.scene.stage.task',
      'se.scene.stage.turn',
    ]);
    expect(Object.keys((asked?.schema as { properties: object }).properties)).toEqual(['place']);
    expect(result.effects?.map((one) => one.channelId)).toEqual(['se.location']);
  });

  /**
   * ***And *Stage a backdrop* on its own asks for the place*** (2026-09-30):
   * the backdrop is drawn from it. Not for faces, which are staging's.
   */
  it('asks where the scene is for a backdrop, and nothing about faces', async () => {
    const talking = host({ object: { place: 'the quay' } });
    const result = await stage(
      input({
        channels: {
          'se.staging': { value: false } as StepInput['channels'][string],
          'se.backdrop.on': { value: true } as StepInput['channels'][string],
        },
      }),
      talking,
    );

    const schema = talking.asked[0]?.schema as { properties: object };
    expect(Object.keys(schema.properties)).toEqual(['place']);
    expect(result.effects?.find((one) => one.channelId === 'se.location')?.after).toBe('the quay');
  });
});

describe('what it proposes when it does run', () => {
  it('sets each actor’s face on that actor’s own scope, judged by the model', async () => {
    const result = await stage(
      input(),
      host({ object: { faces: { '1': 'angry' }, place: 'the harbourmaster’s office' } }),
    );

    const face = result.effects?.find((one) => one.channelId === 'se.expression');
    expect(face?.scopeKey).toBe('a-vera');
    // Resolved from label to media id here rather than in the prompt: a model
    // asked to return an id would be asked to copy a uuid.
    expect(face?.after).toEqual({
      from: 'authored',
      kind: 'actors',
      objectId: 'a-vera',
      mediaId: 'm-angry',
    });
    /**
     * ***The attribution is the point of the policy.*** `model-proposed` admits
     * a step because `refuse()` has no branch for it — and what makes that
     * honest is the effect saying a *model* judged it, with the call it was
     * judged in. A `{ kind: 'step' }` stamp here would be refused.
     */
    expect(face?.proposedBy).toEqual({ kind: 'model', callId: 'c-stage' });
  });

  it('sets the place on the session, with the same call behind it', async () => {
    const result = await stage(
      input(),
      host({ object: { faces: {}, place: 'the harbourmaster’s office' } }),
    );

    const place = result.effects?.find((one) => one.channelId === 'se.location');
    expect(place?.after).toBe('the harbourmaster’s office');
    expect(place?.scopeKey).toBeUndefined();
    expect(place?.proposedBy).toEqual({ kind: 'model', callId: 'c-stage' });
  });

  /**
   * **Each person's expression is an enum of their own labels**, which is what
   * makes *only from the list offered* structural rather than an instruction: a
   * model that names a face somebody does not have fails the schema rather than
   * writing a channel value nothing can resolve.
   */
  it('offers each person only their own faces', async () => {
    const talking = host({ object: { faces: {}, place: null } });
    await stage(
      input({
        cast: [
          member(),
          member({
            actorId: 'a-lund',
            name: 'Lund',
            media: [{ id: 'm-tired', role: 'expression', label: 'tired' }],
          }),
        ],
      }),
      talking,
    );

    const schema = talking.asked[0]?.schema as {
      properties: { faces: { properties: Record<string, { enum: string[] }> } };
    };
    expect(schema.properties.faces.properties['1']?.enum).toEqual(['neutral', 'angry']);
    expect(schema.properties.faces.properties['2']?.enum).toEqual(['tired']);
  });

  /**
   * ***By number, which the prompt ties to a name*** (2026-09-30). The schema
   * keyed faces by actor id and the roster named people, so two members with
   * the standard expression pack could have their faces swapped and pass. Two
   * people, one set of labels, and each face lands on its own person.
   */
  it('keeps two people with the same faces apart', async () => {
    const talking = host({ object: { faces: { '1': 'angry', '2': 'neutral' } } });
    const result = await stage(
      input({ cast: [member(), member({ actorId: 'a-lund', name: 'Lund' })] }),
      talking,
    );

    const roster = (talking.asked[0]?.candidates ?? []).find(
      (one) => one.id === 'se.scene.stage.cast',
    );
    expect(roster?.text).toBe('1. Vera: neutral, angry\n2. Lund: neutral, angry');
    const faces = (result.effects ?? [])
      .filter((one) => one.channelId === 'se.expression')
      .map((one) => [one.scopeKey, (one.after as { mediaId: string }).mediaId]);
    expect(faces).toEqual([
      ['a-vera', 'm-angry'],
      ['a-lund', 'm-neutral'],
    ]);
  });

  /**
   * ***One bad half no longer sinks the other*** (2026-09-30). A reply keyed by
   * name failed the schema whole, was asked for twice more and then dropped,
   * place and all. Keys nobody asked for are allowed now, so what reaches the
   * step is the answer, and the place in it stands.
   */
  it('keeps the place when the faces come back keyed by name', async () => {
    const talking = host({ object: { faces: { Vera: 'angry' }, place: 'the office' } });
    const result = await stage(input(), talking);

    const schema = talking.asked[0]?.schema as {
      additionalProperties?: unknown;
      properties: { faces: { additionalProperties?: unknown }; place: { type: unknown } };
    };
    expect(schema.additionalProperties).toBeUndefined();
    expect(schema.properties.faces.additionalProperties).toBeUndefined();
    expect(schema.properties.place.type).toEqual(['string', 'null']);
    expect(result.effects?.map((one) => one.channelId)).toEqual(['se.location']);
  });

  /**
   * *A refusal is a normal answer.* The step is `warn`, the session has a
   * text-only configuration to fall back to, and a malformed answer must cost a
   * picture rather than a turn — so every one of these returns nothing and
   * throws nothing.
   */
  it.each([
    ['nothing at all', undefined],
    ['a string where an object belongs', 'angry'],
    ['a face that person does not have', { faces: { 'a-vera': 'radiant' }, place: null }],
    [
      'a face belonging to somebody who is not here',
      { faces: { 'a-ghost': 'angry' }, place: null },
    ],
    ['a place that is only whitespace', { faces: {}, place: '   ' }],
  ])('proposes nothing when the model answers with %s', async (_what, object) => {
    const result = await stage(input(), host({ object }));

    expect(result).toEqual({});
  });

  /**
   * **Text is what it reads and text is all it reads.** The cast block carries
   * names and labels — never a media id, never a byte. [04 §3] makes
   * `EmbeddedMedia` *"a reference to bytes carried by the container"*, and a
   * prompt naming one would be handing a model a handle it cannot use and a
   * token budget it did not need to spend.
   */
  it('puts no media ids in the prompt', async () => {
    const talking = host({ object: { faces: {}, place: null } });
    await stage(input(), talking);

    const text = (talking.asked[0]?.candidates ?? []).map((one) => one.text).join('\n');
    expect(text).toContain('Vera');
    expect(text).toContain('neutral');
    expect(text).not.toContain('m-neutral');
  });
});
