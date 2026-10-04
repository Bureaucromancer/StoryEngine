// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { validate, type StepCallResult, type StepHost, type StepInput } from '@storyengine/sdk';

import { modes } from './index.js';
import { ASSISTANT, ASSISTANT_CONTEXT, ASSISTANT_ID, ASSISTANT_MODE } from './mode.js';
import { ASSISTANT_PRESET } from './preset.js';
import { propose, PROPOSE_STEP } from './propose.js';

/**
 * ***The assistant, as a mode*** —
 * [06 §7.4](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P11.3](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §7.4's design is *"a session, in a mode, with an actor card"*, and the claims
 * worth asserting here are the ones a reader of the file could get wrong rather
 * than the ones the type checker already holds.
 */

/**
 * A host that records what it was asked and answers with whatever the test says.
 *
 * ***Two of `StepHost`'s three members are stubbed by omission***, which is
 * `staging.test.ts`'s arrangement one mode over and a fact about the package
 * rather than laziness: this step draws nothing and does no I/O, and `signal` is
 * an `AbortSignal` — a host global the SDK's tsconfig declares with
 * `types: ["node"]` and this package's deliberately does not. Adding
 * `@types/node` so a test could construct an `AbortController` would be a second
 * dependency bought to fake a field nothing reads, against
 * [20 §10](../../../../docs/design/20-tech-stack.md)'s whole claim.
 */
function host(answer: Partial<StepCallResult> = {}): StepHost & { asked: unknown[] } {
  const asked: unknown[] = [];
  const call = (request: unknown): Promise<StepCallResult> => {
    asked.push(request);
    return Promise.resolve({ callId: 'c1', text: '', usage: null, ...answer });
  };
  return { asked, call } as unknown as StepHost & { asked: unknown[] };
}

function input(over: Partial<StepInput> = {}): StepInput {
  return {
    turnId: 't1',
    sessionId: 's1',
    parentTurnId: null,
    channels: {},
    history: [],
    ...over,
  };
}

describe('the declaration', () => {
  it('ships a pack the same validator a user’s write goes through accepts', () => {
    expect(validate(ASSISTANT_PRESET)).toEqual({ valid: true });
  });

  it('exports the modes it ships, under the key the host reads', () => {
    expect(modes).toEqual([ASSISTANT_MODE]);
  });

  /**
   * ***The first `embodied` mode in the build.*** [06 §3]'s axis is about whose
   * voice the output is in, and the assistant answers as itself — there is no
   * scene it is describing. Both story modes are `narrator`, so this is the
   * first declaration that differs and the first evidence the field is a
   * declaration rather than a constant.
   */
  it('speaks as itself rather than as a narrator', () => {
    expect(ASSISTANT.voice).toBe('embodied');
  });

  /**
   * ***The disclosure is a channel with a budget***, which is the whole of how
   * §7.4's *"visible in the turn record like any other block"* is satisfied
   * without new machinery. **`budget: null` would be the unsettling version** —
   * an assistant that knew what was on your screen and never said so — and it
   * would look like a smaller declaration rather than a different feature.
   */
  it('gives the ambient context a budget, so it renders as a block', () => {
    expect(ASSISTANT_CONTEXT.budget).not.toBeNull();
    expect(ASSISTANT_CONTEXT.update).toBe('user-only');
    const slot = ASSISTANT_PRESET.blocks.find((block) => block.id === ASSISTANT_CONTEXT.id);
    expect(slot, 'the pack positions the context').toBeDefined();
    // ***And words for it*** (2026-09-30): a budget with no template renders
    // the same nothing as no budget, which is how this test stayed green over
    // a block that was empty on every turn. What the words say is asserted
    // where they are rendered (the server's `collect.test.ts`).
    expect(ASSISTANT_CONTEXT.render, 'the context has words').toEqual(expect.any(String));
  });

  /**
   * ***A guided redo is shown the answer it replaces*** (2026-09-30) —
   * Scene's `se.attempt`, and the same two claims its test pins: straight
   * after the guidance, so the wrapper is the seam between the instruction and
   * the prose it is about; and advisory, as the collector will force anyway.
   */
  it('shows a guided redo the answer it is replacing, after the guidance', () => {
    const ids = ASSISTANT_PRESET.blocks.map((block) => block.id);
    const attempt = ASSISTANT_PRESET.blocks.find((block) => block.id === 'se.attempt');

    expect(ids.indexOf('se.attempt')).toBe(ids.indexOf('se.guidance') + 1);
    expect(attempt?.advisory).toBe(true);
    expect(attempt?.kind === 'slot' ? attempt.source : null).toEqual({ of: 'attempt' });
  });

  /** The card carries the voice, so nothing here may — §7.4's own split. */
  it('says nothing about how the assistant talks', () => {
    const instruction = ASSISTANT_PRESET.blocks.find((block) => block.id === 'se.instruction');
    const text = instruction?.kind === 'text' ? instruction.template : '';
    expect(text.length).toBeGreaterThan(100);
    for (const word of ['friendly', 'cheerful', 'witty', 'personality', 'tone']) {
      expect(text.toLowerCase(), word).not.toContain(word);
    }
  });
});

describe('a change the assistant proposes', () => {
  const CONTEXT: StepInput['channels'] = {
    'se.assistant.context': {
      // `version` is part of `ChannelState` and a fixture short of it is a
      // fixture the reader has never actually been handed.
      version: 1,
      value: { kind: 'actors', id: 'actor-1', name: 'Vera' },
    },
  };

  it('is a channel effect and nothing else', async () => {
    const result = await propose(
      input({
        output: { text: 'Try giving her a shorter summary.' },
        channels: CONTEXT,
      }),
      host({ object: { change: { kind: 'actors', id: 'actor-1', changes: { name: 'Vera K' } } } }),
    );

    expect(result.effects).toHaveLength(1);
    expect(result.effects?.[0]?.channelId).toBe('se.assistant.proposal');
    // No message, no candidates: this step reads a turn and writes state.
    expect(result.message).toBeUndefined();
    expect(result.candidates).toBeUndefined();
  });

  /**
   * ***The object is the one the person had open, not the one the model
   * named.*** A model free to nominate an id would be a model choosing which of
   * your files gets a diff put in front of you — and the diff is the thing a
   * person approves in one click.
   */
  it('proposes against what the client disclosed, never what the model named', async () => {
    const result = await propose(
      input({
        output: { text: 'Change the other one.' },
        channels: CONTEXT,
      }),
      host({
        object: { change: { kind: 'lorebooks', id: 'somebody-elses', changes: { name: 'No' } } },
      }),
    );

    const after = result.effects?.[0]?.after as { kind: string; id: string };
    expect(after.kind).toBe('actors');
    expect(after.id).toBe('actor-1');
  });

  /**
   * *A proposal that changes nothing is not a proposal*, and neither is one
   * about nothing. [P7.4] measured that the adapter does not validate what comes
   * back, so a well-formed reply against the wrong shape is the ordinary case.
   */
  it('writes nothing for an answer that proposes nothing', async () => {
    for (const object of [
      { change: null },
      { change: { kind: 'actors', id: 'actor-1', changes: {} } },
      {},
      null,
    ]) {
      const result = await propose(
        input({ output: { text: 'Here is why.' }, channels: CONTEXT }),
        host({ object }),
      );
      expect(result.effects, JSON.stringify(object)).toBeUndefined();
    }
  });

  /**
   * ***An answer that proposes nothing withdraws the last offer*** (2026-09-30)
   * — so the panel, which shows the newest proposal on the path, is not still
   * offering one made three questions ago. Nothing stood, nothing is written.
   */
  it('withdraws a standing offer when the answer proposes nothing', async () => {
    const standing = {
      ...CONTEXT,
      'se.assistant.proposal': {
        version: 1,
        value: { kind: 'actors', id: 'actor-1', changes: { name: 'Vera K' } },
      },
    };

    const withdrawn = await propose(
      input({ output: { text: 'Here is why.' }, channels: standing }),
      host({ object: { change: null } }),
    );
    const quiet = await propose(
      input({ output: { text: 'Here is why.' }, channels: CONTEXT }),
      host({ object: { change: null } }),
    );

    expect(withdrawn.effects).toEqual([
      {
        channelId: 'se.assistant.proposal',
        op: { type: 'set', path: '/' },
        after: null,
        proposedBy: { kind: 'model', callId: 'c1' },
      },
    ]);
    expect(quiet.effects).toBeUndefined();
    // And it may read what stands, which is what lets it know.
    expect(PROPOSE_STEP.reads).toContain('se.assistant.proposal');
  });

  /**
   * ***A session on screen is no target*** (2026-09-30). Open over a play
   * session, the panel discloses the session, and a proposal addressed to it
   * is one no library route writes and the panel never shows. Anything but a
   * library object is no context, as a session that disclosed nothing is.
   */
  it('takes a session on screen as no object, never as the target', async () => {
    const inSession = {
      'se.assistant.context': { version: 1, value: { kind: 'session', id: 's-1' } },
    };

    const named = await propose(
      input({ output: { text: 'Change her name.' }, channels: inSession }),
      host({ object: { change: { kind: 'actors', id: 'actor-1', changes: { name: 'Vera K' } } } }),
    );
    const unnamed = await propose(
      input({ output: { text: 'Change it.' }, channels: inSession }),
      host({ object: { change: { kind: 'session', id: 's-1', changes: { name: 'No' } } } }),
    );

    expect(named.effects?.[0]?.after).toMatchObject({ kind: 'actors', id: 'actor-1' });
    expect(unnamed.effects).toBeUndefined();
  });

  /** No answer, no call — the same gate `staging.ts` puts in front of its own. */
  it('asks nobody when the turn produced no prose', async () => {
    const capabilities = host();
    await propose(input({ output: { text: '   ' } }), capabilities);
    expect(capabilities.asked).toHaveLength(0);
  });

  /** `warn`, never `abort`: the answer exists and is what the person asked for. */
  it('never costs the turn it is a footnote to', () => {
    expect(PROPOSE_STEP.failure).toBe('warn');
    expect(PROPOSE_STEP.stage).toBe('post');
  });
});

describe('the mode id', () => {
  it('is the one the client summons and the loader loads', () => {
    expect(ASSISTANT_ID).toBe('storyengine.assistant');
    expect(ASSISTANT.id).toBe(ASSISTANT_ID);
  });
});
