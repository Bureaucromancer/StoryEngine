// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '../config.js';
import { TEST_MODE } from '../test-mode.js';
import { pictureTexts } from '../assembly/pictures.js';
import { capabilitiesFor } from '../providers/capabilities.js';
import type { Connection } from '../providers/connections.js';
import { FakeProvider } from '../providers/fake.js';
import type { Provider, RenderedMessage } from '../providers/types.js';
import type { Candidate, CandidateImage } from '../assembly/types.js';
import {
  performCall,
  planCall,
  RoleUnresolved,
  WindowTooSmall,
  type CallContext,
  type PlanContext,
} from './calls.js';

/**
 * The seam a preview stops at — [P3.4], [P3 §1.6].
 *
 * `performCall` used to be one function from *resolve the role* to *return the
 * outcome*, with the id minted and the provisional checkpointed in the middle
 * of it. [P3 §1.6] said the preview would be *an early exit at a seam where a
 * cancellation is already thrown*; this file pins the seam itself, because
 * everything downstream of it is covered by `runner.test.ts` driving the whole
 * loop and nothing there can tell where the split fell.
 *
 * Both throws are asserted deliberately. They are not failure modes the
 * preview works around — they are the two answers it forwards: no denominator
 * to measure against, and [06 §5.2]'s structural refusal.
 */

const CONNECTION: Connection = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a03',
  label: 'The double',
  provider: 'openai-compatible',
  scope: 'user',
  models: ['fake-hi'],
};

function providerFor(): Provider {
  return {
    capabilities: capabilitiesFor('openai-compatible', {}),
    generate: () => {
      throw new Error('planCall must not dispatch.');
    },
    stream: () => {
      throw new Error('planCall must not dispatch.');
    },
  } as unknown as Provider;
}

function context(over: Partial<PlanContext> = {}): PlanContext {
  const narrate = TEST_MODE.definition.steps[0];
  if (narrate === undefined) throw new Error('Scene declares no steps.');
  return {
    definition: narrate,
    bindings: { prose: { connectionId: CONNECTION.id, modelId: 'fake-hi' } },
    usable: [CONNECTION],
    providers: providerFor,
    config: DEFAULT_CONFIG,
    notFilled: [],
    ...over,
  };
}

const CANDIDATES: readonly Candidate[] = [
  {
    id: 'se.instruction',
    source: { kind: 'preset', blockId: 'se.instruction' },
    reason: 'instruction',
    role: 'system',
    text: 'You are the narrator of a scene.',
  },
  {
    id: 'se.input',
    source: { kind: 'input' },
    reason: 'input',
    role: 'user',
    text: 'She opened the door.',
    required: true,
  },
];

describe('planning a call', () => {
  it('assembles and renders without minting an id or checkpointing', () => {
    // The whole property the preview rests on. `PlanContext` is `CallContext`
    // minus `signal`, `onCallAssembled` and `onProgress`, so a plan that
    // checkpointed could not typecheck — and the assertion below is the
    // behavioural half: what comes back is a call with no identity and no
    // clock reading. The falsifying mutation is moving `uuidv7()` and
    // `Date.now()` back above the split.
    const { call, connection } = planCall(context(), {}, CANDIDATES);

    expect(call).not.toHaveProperty('id');
    expect(call).not.toHaveProperty('startedAt');
    expect(call.stepId).toBe(TEST_MODE.definition.steps[0]?.id);
    expect(call.purpose).toBe('prose');
    expect(call.blocks.map((block) => block.id)).toEqual(['se.instruction', 'se.input']);
    expect(call.budget.limit.tokens).toBeGreaterThan(0);
    expect(call.messages.length).toBeGreaterThan(0);
    // The connection travels beside the record rather than inside it: it holds
    // `apiKey` and `baseUrl` ([21 §1.4]).
    expect(connection.id).toBe(CONNECTION.id);
    expect(call.resolved.connectionId).toBe(CONNECTION.id);
    expect(call).not.toHaveProperty('connection');
  });

  it('refuses to plan when nothing is bound to the role, and says which way', () => {
    // The preview's honest "there is no denominator" — forwarded as a class,
    // not as prose. The falsifying mutation is answering `null` instead of
    // throwing, which would make an unbound install look like an empty prompt.
    expect(() => planCall(context({ bindings: {} }), {}, CANDIDATES)).toThrow(RoleUnresolved);

    try {
      planCall(context({ bindings: {} }), {}, CANDIDATES);
      expect.unreachable('planning without a binding must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RoleUnresolved);
      expect((error as RoleUnresolved).reason).toBe('unbound');
    }
  });

  it('distinguishes a binding whose connection is gone', () => {
    const dangling = context({
      bindings: { prose: { connectionId: 'gone', modelId: 'fake-hi' } },
    });

    try {
      planCall(dangling, {}, CANDIDATES);
      expect.unreachable('a dangling binding must throw');
    } catch (error) {
      expect((error as RoleUnresolved).reason).toBe('dangling');
    }
  });

  /**
   * ***Refused, not emptied*** (2026-09-27). Assembly spends the window less
   * the room kept for the reply, and at zero or below it dropped every block
   * that was not required and sent the call anyway: the model continued a
   * story it could not see, and nothing said why.
   */
  it('refuses a window no larger than the room kept for the reply', () => {
    const cramped = (maxContextTokens: number) =>
      context({
        preset: {
          params: {},
          budget: { contextShare: 1, maxContextTokens, reserveOutputTokens: 800 },
        },
      });

    try {
      planCall(cramped(800), {}, CANDIDATES);
      expect.unreachable('a window with no room beside the reply must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WindowTooSmall);
      expect(error).toMatchObject({ window: 800, reserved: 800 });
      // Both numbers, because one of them is the setting to change.
      expect((error as Error).message).toContain('800');
    }
    // One token of room is room: the boundary is the reserve itself.
    expect(() => planCall(cramped(801), {}, CANDIDATES)).not.toThrow();
  });

  it('honours a step’s own candidates by emptying the not-filled list', () => {
    // [P3.0] §7.5: a step that supplied its own candidates never consulted the
    // preset, so describing that collection would be a record of a collection
    // this call did not use.
    const supplied = planCall(
      context({ notFilled: [{ blockId: 'se.lore', source: 'lore', reason: 'no-producer' }] }),
      { candidates: CANDIDATES },
      [],
    );
    expect(supplied.call.notFilled).toEqual([]);

    const fromPreset = planCall(
      context({ notFilled: [{ blockId: 'se.lore', source: 'lore', reason: 'no-producer' }] }),
      {},
      CANDIDATES,
    );
    expect(fromPreset.call.notFilled).toHaveLength(1);
  });

  /**
   * The same rule, one field over — [P5.6]. A producer's refusals belong in the
   * verdict ([P5 §1.3]), and belong there for the same reason and under the same
   * condition as `notFilled` above: a step that brought its own candidates never
   * ran the preset's producers, so reporting what they refused would be a record
   * of a collection this call did not use.
   */
  it("carries a producer's refusals into the verdict, and only for a preset call", () => {
    const refused = [{ blockId: 'lore.a.1', tokens: 40, rule: "over the book's token budget" }];

    const fromPreset = planCall(context({ refused }), {}, CANDIDATES);
    expect(fromPreset.call.budget.decisions.find((one) => one.blockId === 'lore.a.1')).toEqual({
      blockId: 'lore.a.1',
      tokens: 40,
      included: false,
      rule: "over the book's token budget",
    });

    const supplied = planCall(context({ refused }), { candidates: CANDIDATES }, []);
    expect(
      supplied.call.budget.decisions.find((one) => one.blockId === 'lore.a.1'),
    ).toBeUndefined();
  });

  it('never dispatches', () => {
    // Belt and braces on the seam: the provider this context hands back throws
    // from both of its call paths, so a plan that dispatched would fail here
    // rather than in a place that looks like a network problem.
    const generate = vi.fn();
    expect(() => planCall(context(), {}, CANDIDATES)).not.toThrow();
    expect(generate).not.toHaveBeenCalled();
  });
});

/**
 * **[19 §5.1]'s override layers, passed at last** — [P7 §1.9], [P7.3].
 *
 * `resolveRole` has implemented five layers since P2B and three of the four
 * built ones had **no production caller**: session, step and the actor hint.
 * 19 §5.1's table exists precisely so *"the order above is not read as a
 * description of what runs"* — and for two of those layers it described a
 * function nobody called. These are the tests that make the description true.
 *
 * *A second connection is the whole fixture: an override that pointed at the
 * same connection as the binding would pass whether or not it was consulted.*
 */
describe('a session overriding a model', () => {
  const OTHER: Connection = {
    ...CONNECTION,
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a99',
    label: 'The cheap one',
    models: ['fake-lo'],
  };

  it('uses the session override in place of the role binding', () => {
    const plan = planCall(
      context({
        usable: [CONNECTION, OTHER],
        sessionRoles: { prose: { connectionId: OTHER.id, modelId: 'fake-lo' } },
      }),
      {},
      [],
    );

    expect(plan.call.resolved.modelId).toBe('fake-lo');
    expect(plan.connection.id).toBe(OTHER.id);
  });

  it('lets a step override beat the session override, which is the documented order', () => {
    // *"install default → role binding → session override → step override →
    // actor hint."* A step override that lost to the session one would make the
    // *cheap model for one noisy step* case unreachable.
    const narrate = TEST_MODE.definition.steps[0];
    if (narrate === undefined) throw new Error('the test mode declares no steps');

    const plan = planCall(
      context({
        usable: [CONNECTION, OTHER],
        sessionRoles: { prose: { connectionId: CONNECTION.id, modelId: 'fake-hi' } },
        stepRoles: { [narrate.id]: { connectionId: OTHER.id, modelId: 'fake-lo' } },
      }),
      {},
      [],
    );

    expect(plan.call.resolved.modelId).toBe('fake-lo');
  });

  it('ignores a step override meant for a different step', () => {
    // Keyed by step id, so *one noisy step* means one — and an override keyed
    // wrongly must not quietly apply to everything.
    const plan = planCall(
      context({
        usable: [CONNECTION, OTHER],
        stepRoles: { 'some.other.step': { connectionId: OTHER.id, modelId: 'fake-lo' } },
      }),
      {},
      [],
    );

    expect(plan.call.resolved.modelId).toBe('fake-hi');
  });

  it('falls back to the binding when the session names no override for that role', () => {
    const plan = planCall(context({ usable: [CONNECTION, OTHER], sessionRoles: {} }), {}, []);

    expect(plan.call.resolved.modelId).toBe('fake-hi');
  });
});

/**
 * **[19 §5.1]'s last and weakest layer, reached at last** — [P7 §1.9], [P7.3].
 *
 * §1.9 found the actor hint in the same state as the session and step layers —
 * *"never passed either"* — and named the reason: *"today one turn makes one
 * merged call and an actor is not in the resolution at all."* The fix is putting
 * the actor into it: a step says who it speaks for, and the engine finds the
 * card.
 *
 * **The two properties that matter are what it may and may not do.** [04 §3]
 * calls a `ModelHint` *"a preference, never a binding — an imported card may
 * express what it wants; it can never repoint anyone's provider"*, and
 * `resolveRole` enforces that by applying it last and weakest. Both halves are
 * asserted, because a hint that could change the connection would make importing
 * somebody else's card a way to redirect your own API calls.
 */
describe('an actor’s model hint', () => {
  const TWO_MODELS: Connection = { ...CONNECTION, models: ['fake-hi', 'fake-alt'] };
  const OTHER: Connection = {
    ...CONNECTION,
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a99',
    label: 'Somebody else’s',
    models: ['fake-lo'],
  };

  function withHint(hint: unknown): NonNullable<PlanContext['cast']> {
    return {
      persona: null,
      actors: [
        {
          actor: { id: 'actor-vera', modelHint: hint } as never,
          contentHash: 'sha256:x',
        },
      ],
    };
  }

  it('picks among the models the resolved connection already offers', () => {
    const plan = planCall(
      context({
        usable: [TWO_MODELS],
        bindings: { prose: { connectionId: TWO_MODELS.id, modelId: 'fake-hi' } },
        cast: withHint({ role: 'prose', preferredModelIds: ['fake-alt'] }),
      }),
      { actorId: 'actor-vera' },
      [],
    );

    expect(plan.call.resolved.modelId).toBe('fake-alt');
  });

  it('never changes the connection, which is what stops a card repointing a provider', () => {
    // An imported card asking for a model on somebody else's connection gets
    // the binding's connection and the binding's model. The preference is
    // unmet, not obeyed.
    const plan = planCall(
      context({
        usable: [TWO_MODELS, OTHER],
        bindings: { prose: { connectionId: TWO_MODELS.id, modelId: 'fake-hi' } },
        cast: withHint({ role: 'prose', preferredModelIds: ['fake-lo'] }),
      }),
      { actorId: 'actor-vera' },
      [],
    );

    expect(plan.connection.id).toBe(TWO_MODELS.id);
    expect(plan.call.resolved.modelId).toBe('fake-hi');
  });

  it('ignores a hint for a different role', () => {
    // **The half easiest to drop.** `ModelHint` carries a `role`, so a card
    // preferring a particular `reasoning` model is saying nothing about which
    // model narrates — and applying it anyway would leak a preference into every
    // call it was never about.
    const plan = planCall(
      context({
        usable: [TWO_MODELS],
        bindings: { prose: { connectionId: TWO_MODELS.id, modelId: 'fake-hi' } },
        cast: withHint({ role: 'reasoning', preferredModelIds: ['fake-alt'] }),
      }),
      { actorId: 'actor-vera' },
      [],
    );

    expect(plan.call.resolved.modelId).toBe('fake-hi');
  });

  it('applies nothing when the call names no actor, which is a merged call', () => {
    // `dispatch: 'merged'` is one reply for the scene, spoken by nobody in
    // particular — and every shipped step makes one.
    const plan = planCall(
      context({
        usable: [TWO_MODELS],
        bindings: { prose: { connectionId: TWO_MODELS.id, modelId: 'fake-hi' } },
        cast: withHint({ role: 'prose', preferredModelIds: ['fake-alt'] }),
      }),
      {},
      [],
    );

    expect(plan.call.resolved.modelId).toBe('fake-hi');
  });

  it('applies nothing for an actor who is not in the cast', () => {
    const plan = planCall(
      context({
        usable: [TWO_MODELS],
        bindings: { prose: { connectionId: TWO_MODELS.id, modelId: 'fake-hi' } },
        cast: withHint({ role: 'prose', preferredModelIds: ['fake-alt'] }),
      }),
      { actorId: 'actor-nobody' },
      [],
    );

    expect(plan.call.resolved.modelId).toBe('fake-hi');
  });
});

/**
 * The degrade, decided in the plan — [P7.4].
 *
 * `GenerationRequest.schema` says the choice belongs to the caller *"with the
 * capabilities in hand"* rather than inside the adapter, and this is that
 * caller. For a self-hosted install it is the ordinary path rather than a
 * fallback: `openai-compatible` declares `supportsStructuredOutput: false`
 * because the endpoint behind it could be anything, so out of the box the SDK
 * drops the schema and asks for bare JSON.
 */
describe('asking for a shape in words', () => {
  const SCHEMA = {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  };

  function planWith(supportsStructuredOutput: boolean) {
    const provider = {
      capabilities: capabilitiesFor('openai-compatible', { supportsStructuredOutput }),
      generate: () => {
        throw new Error('planCall must not dispatch.');
      },
    } as unknown as Provider;

    return planCall(context({ providers: () => provider }), { schema: SCHEMA }, CANDIDATES);
  }

  it('adds the instruction when the endpoint cannot be handed a schema', () => {
    const { call } = planWith(false);

    expect(call.blocks.map((block) => block.id)).toEqual([
      'se.instruction',
      'se.input',
      'se.schema',
    ]);
    // Last, because an instruction about the reply's form belongs after the
    // material it is about — which is also where an endpoint's own JSON mode
    // puts it.
    expect(call.blocks.at(-1)?.source).toEqual({ kind: 'schema' });
  });

  it('leaves it out when the wire is going to carry the schema itself', () => {
    const { call } = planWith(true);

    expect(call.blocks.map((block) => block.id)).toEqual(['se.instruction', 'se.input']);
  });

  it('adds nothing at all to a call that asked for no shape', () => {
    const { call } = planCall(context(), {}, CANDIDATES);

    expect(call.blocks.map((block) => block.id)).toEqual(['se.instruction', 'se.input']);
  });

  /**
   * **The reason it is a block and not a spliced-in message.**
   * `RenderedMessage.fromBlocks` is non-empty always, so every message the
   * record shows is accounted for by a block — and the workbench's account of a
   * prompt would otherwise be quietly incomplete on precisely the calls whose
   * output is hardest to debug.
   */
  it('is accounted for in the messages the record carries', () => {
    const { call } = planWith(false);

    const named = new Set(call.messages.flatMap((message) => message.fromBlocks));
    expect(named.has('se.schema')).toBe(true);
    for (const message of call.messages) {
      expect(message.fromBlocks.length).toBeGreaterThan(0);
    }
    // And the text reached the prompt rather than only the block table.
    expect(call.messages.map((message) => message.content).join('\n')).toContain(
      JSON.stringify(SCHEMA),
    );
  });

  it('survives the budgeter, because a call without it is meaningless', () => {
    const { call } = planWith(false);

    expect(call.blocks.find((block) => block.id === 'se.schema')?.included).toBe(true);
  });
});

/**
 * ***Pixels or words, decided per call*** — [25 E15], R1's send rule.
 *
 * `planCall` holds the model the call resolved to, and is the only place that
 * does, so it is the only place the rule can be decided without tying a session
 * to a model that sees. Each test below pins one arm of `withheldBecause`, the
 * precedence between them, or one of the two things decided *around* it: the
 * re-plan when bytes vanish between the presence check and the read, and the
 * budget that can still drop a picture the rule said to send.
 *
 * *One connection serves a model that sees and one that does not*, which is the
 * case the per-model `imageModels` exists for — and the only fixture in which a
 * test can tell *the resolved model* from *the connection* or *the binding*.
 */
describe('a picture on the move, sent or held', () => {
  const DIGEST = `sha256:${'c'.repeat(64)}`;
  const PIXELS = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
  const PICTURE_ID = 'se.input.attachment.0';
  /** Derived, not spelled, so a change to the words is `pictures.test.ts`'s to catch. */
  const TEXTS = pictureTexts({ caption: 'a lantern' });
  const SEEING: Connection = {
    ...CONNECTION,
    models: ['fake-hi', 'fake-text'],
    imageModels: ['fake-hi'],
  };

  /**
   * The collector's shape for a picture on the move being made — `emitPicture`
   * in `assembly/collect.ts`: required, user-role, current, its text the held
   * words and its `sentText` the words that accompany the pixels.
   */
  function picture(over: Partial<Candidate> = {}, image: Partial<CandidateImage> = {}): Candidate {
    return {
      id: PICTURE_ID,
      source: { kind: 'input', part: 'attachment', attachmentId: '0' },
      reason: 'input',
      role: 'user',
      text: TEXTS.held,
      required: true,
      image: {
        attachmentId: '0',
        kind: 'image',
        digest: DIGEST,
        mime: 'image/png',
        sentText: TEXTS.sent,
        current: true,
        ...image,
      },
      ...over,
    };
  }

  /** A context whose narrator is bound to `modelId` on the connection that serves both. */
  function seeing(modelId: 'fake-hi' | 'fake-text', over: Partial<PlanContext> = {}): PlanContext {
    return context({
      usable: [SEEING],
      bindings: { prose: { connectionId: SEEING.id, modelId } },
      picturesPresent: new Set([DIGEST]),
      ...over,
    });
  }

  function calling(fake: FakeProvider, over: Partial<CallContext> = {}): CallContext {
    return {
      ...seeing('fake-hi', { providers: () => fake }),
      signal: new AbortController().signal,
      onCallAssembled: () => undefined,
      onProgress: () => undefined,
      ...over,
    };
  }

  /**
   * A loader that answers `answer` — and **fails loudly on the fourth ask**.
   *
   * `planWithPictures` loops until every wanted picture loaded, and each turn
   * of that loop awaits only an already-settled promise. A regression that
   * re-planned without forgetting the missing digest would therefore spin in
   * microtasks forever, starving the timer that would have timed the test out,
   * and hang the worker rather than fail. Rejecting after a few asks turns that
   * hang into an ordinary failed call.
   */
  function loader(answer: { bytes: Uint8Array; mime: string } | null) {
    let asked = 0;
    return vi.fn((digest: string): Promise<{ bytes: Uint8Array; mime: string } | null> => {
      asked += 1;
      if (asked > 3) {
        return Promise.reject(new Error(`asked for ${digest} ${String(asked)} times`));
      }
      return Promise.resolve(answer);
    });
  }

  function blockOf<T extends { id: string }>(blocks: readonly T[] | undefined): T | undefined {
    return blocks?.find((block) => block.id === PICTURE_ID);
  }

  function hasParts(messages: readonly RenderedMessage[]): boolean {
    return messages.some((message) => message.parts !== undefined);
  }

  /**
   * ***Bytes that vanish between the check and the read are words, not a
   * failed turn.*** The presence set says the picture is here and the model
   * sees, so the first plan sends it; the read answers null (a sweep, a hand
   * edit, a file the runner could not open), and the plan is asked again
   * without that digest.
   *
   * Falsified by: failing the call instead of re-planning; re-planning with the
   * same `present` set (the loop — caught by the loader, see {@link loader});
   * sending the first plan's messages with no bytes behind them (the request
   * would carry `parts` and the record would say `sent`); or re-reading the
   * picture once the re-plan no longer wants it (called twice).
   */
  it('re-plans a picture whose bytes could not be read, and sends its words', async () => {
    const fake = new FakeProvider();
    const loadPicture = loader(null);

    const outcome = await performCall(calling(fake, { loadPicture }), {}, [
      ...CANDIDATES,
      picture(),
    ]);

    expect(blockOf(outcome.call.blocks)).toMatchObject({
      included: true,
      text: TEXTS.held,
      image: {
        attachmentId: '0',
        digest: DIGEST,
        mime: 'image/png',
        sent: false,
        withheld: 'missing-bytes',
      },
    });
    const sent = fake.requests.at(-1);
    expect(sent?.images).toEqual([]);
    expect(hasParts(sent?.messages ?? [])).toBe(false);
    const words = (sent?.messages ?? []).map((message) => message.content).join('\n');
    expect(words).toContain(TEXTS.held);
    expect(words).not.toContain(TEXTS.sent);
    // The record is the re-plan, not the first plan: what it says was sent is
    // what the provider was handed.
    expect(outcome.call.messages).toEqual(sent?.messages);

    expect(loadPicture).toHaveBeenCalledTimes(1);
    expect(loadPicture).toHaveBeenCalledWith(DIGEST);
  });

  /**
   * The ordinary path, and the other half of the re-plan above: a picture on
   * the move, a model that sees, bytes that load. The block says `sent`, its
   * text becomes the words that go *beside* the pixels, the rendered message
   * grows parts with the picture after the words that introduce it, and the
   * provider is handed the bytes by digest.
   *
   * Falsified by: keeping the held words on a sent picture (`not shown` beside
   * a picture that is shown); not handing `images` to the provider; or the
   * budget rewrite firing on an included block.
   */
  it('sends a picture on the move to a model that sees, with the words beside it', async () => {
    const fake = new FakeProvider();
    const loadPicture = loader({ bytes: PIXELS, mime: 'image/png' });

    const outcome = await performCall(calling(fake, { loadPicture }), {}, [
      ...CANDIDATES,
      picture(),
    ]);

    const block = blockOf(outcome.call.blocks);
    expect(block).toMatchObject({ included: true, text: TEXTS.sent });
    expect(block).toHaveProperty('image', {
      attachmentId: '0',
      digest: DIGEST,
      mime: 'image/png',
      sent: true,
    });

    const sent = fake.requests.at(-1);
    expect(sent?.images).toEqual([DIGEST]);
    const user = sent?.messages.find((message) => message.role === 'user');
    expect(user?.parts).toEqual([
      { kind: 'text', text: `She opened the door.\n\n${TEXTS.sent}` },
      { kind: 'image', blockId: PICTURE_ID, digest: DIGEST, mime: 'image/png' },
    ]);
    // `content` stays the whole text rendering, which the frozen contract
    // promises whether or not parts exist.
    expect(user?.content).toBe(`She opened the door.\n\n${TEXTS.sent}`);
    expect(loadPicture).toHaveBeenCalledTimes(1);
  });

  /**
   * ***Only a user message can carry a picture.*** A system or assistant block
   * that stands for one goes as its words, even on a model that sees with the
   * bytes in hand — `render` does not look at roles, so without this arm a
   * system message would grow `parts`, and the adapter would then drop the
   * picture in silence (it builds array content for user messages only) while
   * the record said *sent*.
   *
   * Falsified by: removing the role check, or moving it after the model check
   * (a model that sees would then send).
   */
  it.each(['system', 'assistant'] as const)(
    'holds a picture in the %s role, whatever the model',
    (role) => {
      const { call } = planCall(seeing('fake-hi'), {}, [...CANDIDATES, picture({ role })]);

      const block = blockOf(call.blocks);
      expect(block).toMatchObject({
        text: TEXTS.held,
        image: { sent: false, withheld: 'not-user-role' },
      });
      expect(hasParts(call.messages)).toBe(false);
    },
  );

  /**
   * ***A kind this build does not send is words*** — and a step can hand one
   * over through its own candidates, which is the path this uses: the collector
   * only ever emits what the store accepted, but `request.candidates` is a
   * published contract any step may fill.
   *
   * Falsified by: dropping the kind check, so a `video` attachment would be
   * rendered as an image part and handed to an endpoint as `image_url`.
   */
  it('holds a picture of a kind it does not send', () => {
    const { call } = planCall(
      seeing('fake-hi'),
      { candidates: [...CANDIDATES, picture({}, { kind: 'video' })] },
      [],
    );

    expect(blockOf(call.blocks)).toMatchObject({
      text: TEXTS.held,
      image: { sent: false, withheld: 'unknown-kind' },
    });
    expect(hasParts(call.messages)).toBe(false);
  });

  /**
   * ***The model is the last reason, never the first*** — `withheldBecause`'s
   * docstring and [21]'s `ImageWithheld`. On a text-only model every one of
   * these is *also* true of the model, and the record must name the reason
   * that choosing another model would not fix; *this model is not marked as
   * seeing pictures* is the one a person answers in settings, and it is only
   * the whole answer when nothing else is in the way.
   *
   * Falsified by: moving the `seesImages` check earlier than any of the four —
   * the row for the reason it overtook then reads `model-text-only`.
   */
  it.each([
    {
      reason: 'unknown-kind',
      candidate: picture({}, { kind: 'video' }),
      present: new Set([DIGEST]),
    },
    {
      reason: 'outside-window',
      candidate: picture({ required: false }, { current: false }),
      present: new Set([DIGEST]),
    },
    {
      reason: 'not-user-role',
      candidate: picture({ role: 'system' }),
      present: new Set([DIGEST]),
    },
    { reason: 'missing-bytes', candidate: picture(), present: new Set<string>() },
  ])(
    'names $reason before the model on a model that does not see',
    ({ reason, candidate, present }) => {
      const { call } = planCall(seeing('fake-text', { picturesPresent: present }), {}, [
        ...CANDIDATES,
        candidate,
      ]);

      expect(blockOf(call.blocks)?.image).toMatchObject({ sent: false, withheld: reason });
    },
  );

  /**
   * ***The model that decides is the one the call resolved to***, after every
   * layer — [19 §5.1]'s session and step overrides included. That is the
   * property that keeps a session from being tied to a model that sees: the
   * binding says *sees*, the session's override says *does not*, and the call
   * goes as words; the other way round, it goes as pixels.
   *
   * Falsified by: reading `seesImages` against the account binding's model, or
   * against the connection as a whole (it serves a model that sees, so a
   * connection-wide answer would send to `fake-text`).
   */
  it('asks the model the overrides resolved to, not the binding under them', () => {
    const narrate = TEST_MODE.definition.steps[0];
    if (narrate === undefined) throw new Error('the test mode declares no steps');
    const textOnly = { connectionId: SEEING.id, modelId: 'fake-text' };
    const sees = { connectionId: SEEING.id, modelId: 'fake-hi' };

    const bySession = planCall(seeing('fake-hi', { sessionRoles: { prose: textOnly } }), {}, [
      ...CANDIDATES,
      picture(),
    ]);
    expect(bySession.call.resolved.modelId).toBe('fake-text');
    expect(blockOf(bySession.call.blocks)?.image).toMatchObject({
      sent: false,
      withheld: 'model-text-only',
    });

    const byStep = planCall(seeing('fake-hi', { stepRoles: { [narrate.id]: textOnly } }), {}, [
      ...CANDIDATES,
      picture(),
    ]);
    expect(blockOf(byStep.call.blocks)?.image).toMatchObject({
      sent: false,
      withheld: 'model-text-only',
    });

    const upward = planCall(seeing('fake-text', { sessionRoles: { prose: sees } }), {}, [
      ...CANDIDATES,
      picture(),
    ]);
    expect(blockOf(upward.call.blocks)?.image).toEqual({
      attachmentId: '0',
      digest: DIGEST,
      mime: 'image/png',
      sent: true,
    });
  });

  /**
   * ***A picture the budget dropped was not sent*** — decided before the
   * budget ran, so said again after it. A step's own picture candidate need not
   * be required, and a window with one token beside the reply cannot fit it:
   * the send rule said *send*, the budgeter said *no room*, and the record
   * must say `budget` rather than *Picture sent* over a block that never left.
   *
   * The contrast is the collector's own picture on the move, which is required
   * and so never meets this reason under the same window.
   *
   * Falsified by: removing the post-assembly rewrite (`sent: true` on an
   * excluded block); or loading bytes for a picture no message carries.
   */
  it('says a picture the budget dropped was not sent, and never loads it', async () => {
    const fake = new FakeProvider();
    const loadPicture = loader({ bytes: PIXELS, mime: 'image/png' });
    const cramped = {
      preset: {
        params: {},
        budget: { contextShare: 1, maxContextTokens: 801, reserveOutputTokens: 800 },
      },
    };

    const outcome = await performCall(
      calling(fake, { ...cramped, loadPicture }),
      { candidates: [...CANDIDATES, picture({ required: false })] },
      [],
    );

    const block = blockOf(outcome.call.blocks);
    expect(block?.included).toBe(false);
    expect(block?.image).toEqual({
      attachmentId: '0',
      digest: DIGEST,
      mime: 'image/png',
      sent: false,
      withheld: 'budget',
    });
    expect(fake.requests.at(-1)?.images).toEqual([]);
    expect(hasParts(fake.requests.at(-1)?.messages ?? [])).toBe(false);
    expect(loadPicture).not.toHaveBeenCalled();

    const required = planCall(seeing('fake-hi', cramped), {}, [...CANDIDATES, picture()]);
    expect(blockOf(required.call.blocks)).toMatchObject({
      included: true,
      image: { sent: true },
    });
  });
});
