// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { StepCallRequest, StepCallResult, StepHost, StepInput } from '@storyengine/sdk';
import type { Direction, Turn } from '@storyengine/shared';

import { evaluateCondition } from './steps.js';
import { DIRECT_STEP, direct, PUSH_FLAG, type DirectContext } from './direct.js';

/**
 * ***The director's push, held to its own claims*** — [P13 §1.9.3], [P13.5b].
 *
 * **Armed, never on a cadence** — the first producer `StepCondition.armed` has
 * had; **its own candidates**, the recent lines and the secret; **every
 * failure lands on the pack's text and says so**, including an answer with
 * nothing in it; **a pack with no text leaves the turn undirected**, on the
 * record; and **a Stop reports nothing**. The engine half — the slot, the
 * outcome, the rewrite — is `routes/director.test.ts`.
 */

function host(answer: string | Error, aborted = false): StepHost & { asked: StepCallRequest[] } {
  const asked: StepCallRequest[] = [];
  const controller = new AbortController();
  if (aborted) controller.abort();
  const call = (request: StepCallRequest): Promise<StepCallResult> => {
    asked.push(request);
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({ callId: 'c-direct', text: answer, usage: null });
  };
  return { asked, call, signal: controller.signal } as unknown as StepHost & {
    asked: StepCallRequest[];
  };
}

function turn(id: string, input: string, reply: string): Turn {
  return {
    id,
    sessionId: 's',
    parentTurnId: null,
    createdAt: '2026-09-29T00:00:00.000Z',
    status: 'complete',
    input: { actorId: null, kind: 'do', text: input, raw: input },
    output: {
      text: reply,
      messages: [{ speaker: { id: 'a-vera', name: 'Vera' }, text: reply }],
    },
    effects: [],
    tape: [],
  };
}

function input(history: Turn[] = []): StepInput {
  return {
    turnId: 't-new',
    sessionId: 's',
    parentTurnId: null,
    channels: {},
    history,
    input: { actorId: null, kind: 'do', text: 'I wait.', raw: 'I wait.' },
  };
}

function context(over: Partial<DirectContext> = {}): DirectContext & { reports: Direction[] } {
  const reports: Direction[] = [];
  return {
    push: 'natural',
    fallback: 'The pack says: move on.',
    secrets: () => [],
    player: 'Ned',
    names: new Map([['a-vera', 'Vera']]),
    hidden: {},
    report: (one) => reports.push(one),
    reports,
    ...over,
  };
}

describe('the director', () => {
  it('runs only when a push armed it', () => {
    const at = (armed: string[]) =>
      evaluateCondition(DIRECT_STEP.when, {
        turnsOnPath: 3,
        stages: new Set(),
        armed: new Set(armed),
      });
    expect(at([])).toEqual({ ok: false, reason: 'not-armed' });
    expect(at([PUSH_FLAG])).toEqual({ ok: true });
    expect(DIRECT_STEP).toMatchObject({ stage: 'pre', failure: 'warn', writes: [] });
  });

  it('asks over its own candidates — the recent lines, the move and the secret — and reports the answer', async () => {
    const ctx = context({ push: 'random', secrets: () => ['The harbourmaster smuggles.'] });
    const calls = host('  A fire starts\non the quay.  ');
    const result = await direct(ctx).run(
      input([turn('t-1', 'Hello.', 'Vera nods.'), turn('t-2', 'Secret.', 'Hidden reply.')]),
      calls,
    );
    expect(result).toEqual({});
    const sent = calls.asked[0]?.candidates?.map((one) => one.text).join('\n') ?? '';
    expect(sent).toContain('random but plausible');
    expect(sent).toContain('The harbourmaster smuggles.');
    expect(sent).toContain('Vera: Vera nods.');
    expect(sent).toContain('Ned (the player): I wait.');
    expect(ctx.reports).toEqual([
      { push: 'random', by: 'model', text: 'A fire starts on the quay.' },
    ]);
  });

  it('leaves hidden lines out, as the characters would', async () => {
    const calls = host('Something.');
    await direct(context({ hidden: { 't-2': true } })).run(
      input([turn('t-1', 'Hello.', 'Vera nods.'), turn('t-2', 'Secret.', 'Hidden reply.')]),
      calls,
    );
    const sent = calls.asked[0]?.candidates?.map((one) => one.text).join('\n') ?? '';
    expect(sent).not.toContain('Hidden reply.');
  });

  it('falls back to the pack’s text when the call fails, and fails the step', async () => {
    const ctx = context();
    await expect(direct(ctx).run(input(), host(new Error('timeout')))).rejects.toThrow('timeout');
    expect(ctx.reports).toEqual([
      { push: 'natural', by: 'fallback', text: 'The pack says: move on.' },
    ]);
  });

  it('treats an empty answer as a failure, not a direction', async () => {
    const ctx = context();
    await expect(direct(ctx).run(input(), host('   '))).rejects.toThrow(/nothing/u);
    expect(ctx.reports[0]?.by).toBe('fallback');
  });

  it('records a push with nothing to stand in when the pack ships no text', async () => {
    const ctx = context({ fallback: null });
    await expect(direct(ctx).run(input(), host(new Error('x')))).rejects.toThrow();
    expect(ctx.reports).toEqual([{ push: 'natural', by: 'fallback' }]);
  });

  it('reports nothing on a Stop', async () => {
    const ctx = context();
    await expect(direct(ctx).run(input(), host(new Error('cancelled'), true))).rejects.toThrow();
    expect(ctx.reports).toEqual([]);
  });
});
