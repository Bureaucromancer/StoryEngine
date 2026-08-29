// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ModelCall } from '@storyengine/shared';

import type { TurnPreview, TurnRecord } from '../api.js';

/**
 * Turn records for the workbench's tests — **test-only, and never promoted**.
 *
 * Hand-written against the shared shapes, modelled on the one real record the
 * repo has seen (a Scene turn against a local endpoint), then given the
 * properties the gate steps need that no real turn has yet produced: a
 * dropped block with its rule, a clickable actor source, two calls with
 * cross-call `fromBlocks`, a cancelled and a timed-out call, unknown cost,
 * skipped and failed steps, a refused and a superseding effect, and
 * not-filled slots. These are *view* fixtures: they exercise renderings, and
 * they must never land in `packages/server/src/providers/fixtures/` — that
 * corpus is for cassettes from real endpoints, is deliberately empty until
 * P2C produces them, and a hand-written record promoted there would be the
 * double defining the truth ([P3 §0]'s exact warning).
 */

export const SESSION_ID = '01a05000-0000-7000-8000-00000000000a';

export const ACTOR_ID = '01a05000-0000-7000-8000-0000000000ac';
export const PERSONA_ID = '01a05000-0000-7000-8000-0000000000ad';

/**
 * A call with the four [P3.0] fields present.
 *
 * They are optional on `ModelCall` because a record on disk may predate them
 * (see the type, and `legacyTurn()` below) — but every call *this* build
 * writes has them, and so does every fixture here except that one. Saying so
 * in the type is what lets the fixtures below read `base.blocks` without
 * either an assertion or a guard for a case they construct away.
 */
type RecordedCall = ModelCall &
  Required<Pick<ModelCall, 'blocks' | 'budget' | 'notFilled' | 'purpose'>>;

function proseCall(): RecordedCall {
  return {
    id: 'call-1',
    stepId: 'se.narrate',
    role: 'prose',
    purpose: 'prose',
    resolved: {
      connectionId: 'conn-1',
      modelId: 'C:\\Users\\Ned\\.lmstudio\\models\\vendor\\long-name\\gemma-4-31B-it-Q4_K_M.gguf',
    },
    blocks: [
      {
        id: 'se.instruction',
        source: { kind: 'preset', blockId: 'se.instruction' },
        reason: 'instruction',
        role: 'system',
        text: 'You are the narrator of a scene.',
        tokens: 58,
        included: true,
      },
      {
        id: 'se.persona',
        source: { kind: 'persona', actorId: PERSONA_ID, contentHash: 'sha256:persona-1' },
        reason: 'persona',
        role: 'system',
        text: 'Ned keeps the rain off other people.',
        tokens: 12,
        included: true,
      },
      {
        id: `se.actors.${ACTOR_ID}`,
        source: { kind: 'actor', actorId: ACTOR_ID, contentHash: 'sha256:vera-1' },
        reason: 'cast',
        role: 'system',
        text: 'Vera runs the night desk.',
        tokens: 9,
        included: true,
      },
      {
        id: 'se.history.t-9.output',
        source: { kind: 'history', turnId: 't-9', range: [0, 0], part: 'output' },
        reason: 'history',
        role: 'assistant',
        text: 'The rain had not stopped for three days.',
        tokens: 11,
        included: false,
        droppedBy: 'over budget — priority 20',
      },
      {
        id: 'se.guidance',
        source: { kind: 'guidance', producer: 'user' },
        reason: 'guidance',
        role: 'system',
        text: 'Keep it tense.',
        tokens: 4,
        included: true,
        advisory: true,
      },
      {
        id: 'se.input',
        source: { kind: 'input' },
        reason: 'input',
        role: 'user',
        text: 'look around',
        tokens: 3,
        included: true,
      },
    ],
    budget: {
      limit: { tokens: 6144, ceiling: 8192, source: 'user', share: 0.75 },
      reserved: 800,
      spent: 86,
      decisions: [
        { blockId: 'se.instruction', tokens: 58, included: true, rule: 'included — priority 90' },
        { blockId: 'se.persona', tokens: 12, included: true, rule: 'included — priority 85' },
        {
          blockId: `se.actors.${ACTOR_ID}`,
          tokens: 9,
          included: true,
          rule: 'included — priority 80',
        },
        {
          blockId: 'se.history.t-9.output',
          tokens: 11,
          included: false,
          rule: 'over budget — priority 20',
        },
        { blockId: 'se.guidance', tokens: 4, included: true, rule: 'included — priority 60' },
        { blockId: 'se.input', tokens: 3, included: true, rule: 'required' },
      ],
      nextToDrop: ['se.guidance'],
    },
    notFilled: [
      { blockId: 'se.lore', source: 'lore', reason: 'no-producer' },
      { blockId: 'se.setting', source: 'setting', reason: 'no-producer' },
      { blockId: 'se.examples', source: 'examples', reason: 'empty-source' },
    ],
    messages: [
      {
        role: 'system',
        content:
          'You are the narrator of a scene.\n\nNed keeps the rain off other people.\n\nVera runs the night desk.\n\nKeep it tense.',
        fromBlocks: ['se.instruction', 'se.persona', `se.actors.${ACTOR_ID}`, 'se.guidance'],
      },
      { role: 'user', content: 'look around', fromBlocks: ['se.input'] },
    ],
    params: { temperature: 0.85, maxTokens: 800 },
    usage: { promptTokens: 92, completionTokens: 785 },
    cost: null,
    wallMs: 59_029,
    finishReason: 'stop',
    outcome: 'ok',
    error: null,
    retries: 0,
  };
}

/** The second call: an extractor that timed out — the fourth failure shape. */
function stalledCall(): RecordedCall {
  const base = proseCall();
  return {
    ...base,
    id: 'call-2',
    stepId: 'se.extract',
    purpose: 'effects',
    blocks: base.blocks
      .filter((block) => block.advisory !== true)
      .map((block) => (block.id === 'se.input' ? { ...block, tokens: 5 } : block)),
    budget: { ...base.budget, spent: 82 },
    notFilled: [],
    messages: [{ role: 'user', content: 'look around', fromBlocks: ['se.input'] }],
    usage: null,
    wallMs: 30_000,
    finishReason: null,
    outcome: 'error',
    error: { class: 'terminal', message: 'The endpoint sent nothing for 30000ms.' },
    retries: 0,
  };
}

/** Two calls, a dropped block, every list populated — the kitchen-sink view fixture. */
export function richTurn(): TurnRecord {
  return {
    id: 't-10',
    sessionId: SESSION_ID,
    parentTurnId: 't-9',
    createdAt: '2026-08-27T10:00:00.000Z',
    status: 'complete',
    input: { actorId: null, kind: 'do', text: 'look around', raw: 'look around' },
    output: { text: 'The air was thick with the scent of damp stone.' },
    request: { calls: [proseCall(), stalledCall()] },
    cost: {
      promptTokens: 92,
      completionTokens: 785,
      wallMs: 89_029,
      model: proseCall().resolved.modelId,
    },
    steps: [
      {
        stepId: 'se.narrate',
        stage: 'generate',
        state: 'ok',
        contributed: { blocks: 2, effects: 0 },
        wallMs: 59_035,
      },
      {
        stepId: 'se.extract',
        stage: 'extract',
        state: 'failed',
        failure: 'warn',
        error: { reason: 'terminal', message: 'The endpoint sent nothing for 30000ms.' },
        contributed: { blocks: 0, effects: 0 },
        wallMs: 30_002,
      },
      {
        stepId: 'se.recap',
        stage: 'post',
        state: 'skipped',
        skipReason: 'cadence',
        contributed: { blocks: 0, effects: 0 },
        wallMs: 0,
      },
    ],
    effects: [
      {
        id: 'fx-1',
        turnId: 't-10',
        channelId: 'se.clock',
        scopeKey: null,
        op: { type: 'set', path: '/' },
        before: { day: 1, hour: 8, minute: 0 },
        after: { day: 1, hour: 8, minute: 0 },
        proposedBy: { kind: 'step', stepId: 'se.extract' },
        applied: false,
        rejectedReason: 'engine-computed',
        supersedes: null,
        channelVersion: 1,
        scope: 'session',
      },
      {
        id: 'fx-2',
        turnId: 't-10',
        channelId: 'se.clock',
        scopeKey: null,
        op: { type: 'set', path: '/' },
        before: { day: 1, hour: 8, minute: 0 },
        after: { day: 1, hour: 8, minute: 5 },
        proposedBy: { kind: 'engine' },
        applied: true,
        rejectedReason: null,
        supersedes: 'fx-1',
        channelVersion: 1,
        scope: 'session',
      },
    ],
    tape: [],
  };
}

/** A Stop mid-call: the model that was asked, and nothing counted — unknown ≠ free. */
export function cancelledTurn(): TurnRecord {
  const call: ModelCall = {
    ...proseCall(),
    usage: null,
    wallMs: 2_412,
    finishReason: null,
    outcome: 'cancelled',
    error: null,
  };
  return {
    id: 't-11',
    sessionId: SESSION_ID,
    parentTurnId: 't-10',
    createdAt: '2026-08-27T10:05:00.000Z',
    status: 'failed',
    input: { actorId: null, kind: 'do', text: 'look closer', raw: 'look closer' },
    request: { calls: [call] },
    cost: { promptTokens: null, completionTokens: null, wallMs: 2_412, model: null },
    steps: [
      {
        stepId: 'se.narrate',
        stage: 'generate',
        state: 'failed',
        failure: 'abort',
        error: { reason: 'cancelled', message: 'The turn was cancelled.' },
        contributed: { blocks: 2, effects: 0 },
        wallMs: 2_412,
      },
    ],
    effects: [],
    tape: [],
  };
}

/** A hand-edit divergence turn: no request at all — absent, not empty. */
export function divergenceTurn(): TurnRecord {
  return {
    id: 't-12',
    sessionId: SESSION_ID,
    parentTurnId: 't-11',
    createdAt: '2026-08-27T10:10:00.000Z',
    status: 'complete',
    effects: [
      {
        id: 'fx-3',
        turnId: 't-12',
        channelId: 'se.clock',
        scopeKey: null,
        op: { type: 'set', path: '/' },
        before: { day: 1, hour: 8, minute: 5 },
        after: { day: 2, hour: 9, minute: 0 },
        proposedBy: { kind: 'user' },
        applied: true,
        rejectedReason: null,
        supersedes: null,
        channelVersion: 1,
        scope: 'session',
      },
    ],
    tape: [],
  };
}

/**
 * A pending assembly — what the meter is showing and what the panel opens on
 * ([P3.4]). Not a record: no id, no call, nothing has been sent.
 */
export function pendingPreview(): TurnPreview {
  const call = proseCall();
  return {
    state: 'assembled',
    headTurnId: 't-10',
    pendingInput: true,
    stepId: 'se.narrate',
    callKind: 'narrate',
    purpose: 'prose',
    resolved: call.resolved,
    blocks: call.blocks,
    budget: call.budget,
    notFilled: call.notFilled,
  };
}

/** The same, before anything is typed — the at-rest reading. */
export function restingPreview(): TurnPreview {
  return { ...pendingPreview(), pendingInput: false };
}

/** An install with no model bound: no denominator, and it says why. */
export function unmeasurablePreview(): TurnPreview {
  return {
    state: 'unmeasurable',
    headTurnId: 't-10',
    pendingInput: true,
    reason: 'role-unbound',
    notFilled: proseCall().notFilled,
  };
}

/**
 * A turn as **P2 wrote them** — the shape sitting in real data directories
 * today, and the one the workbench crashed on.
 *
 * `blocks`, `budget`, `notFilled` and `purpose` all arrived with [P3.0]'s
 * repair of the record. Turns taken before it carry a `ModelCall` without
 * them, they are on disk in every install that ran P2, and the panel is a
 * reader over what is *on disk* rather than over what this build would write.
 * Two of the three sessions in this repo's own data directory are this shape.
 *
 * Test-only and never promoted, like everything else here — but unlike the
 * others this fixture is a transcription rather than an invention: it is
 * `proseCall()` with exactly the four fields P3.0 added removed.
 */
export function legacyTurn(): TurnRecord {
  const { blocks, budget, notFilled, purpose, ...call } = proseCall();
  void blocks;
  void budget;
  void notFilled;
  void purpose;
  return {
    ...richTurn(),
    id: 't-13',
    parentTurnId: 't-12',
    request: { calls: [call] },
    // P2 wrote steps; the absence here is only to keep the fixture small.
  };
}
