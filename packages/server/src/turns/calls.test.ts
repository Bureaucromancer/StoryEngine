// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '../config.js';
import { TEST_MODE } from '../test-mode.js';
import { capabilitiesFor } from '../providers/capabilities.js';
import type { Connection } from '../providers/connections.js';
import type { Provider } from '../providers/types.js';
import type { Candidate } from '../assembly/types.js';
import { planCall, RoleUnresolved, type PlanContext } from './calls.js';

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
