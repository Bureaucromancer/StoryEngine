// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  StepCallRequest,
  StepCallResult,
  StepHost,
  StepInput,
  TranscriptTurn,
} from '@storyengine/sdk';

import { DEFAULT_SUMMARY_POLICY } from '../sessions/summary-chain.js';
import { listSummaries } from '../sessions/summaries.js';
import { Layout } from '../storage/layout.js';
import type { Turn } from '../sessions/types.js';
import type { AssemblyInputs } from './gather.js';
import { summarise, summaryPlanFor, type SummariseReport } from './summarise.js';

/**
 * ***Only a finished summary is kept*** (2026-09-27).
 *
 * A link is written under a content key, served from then on without being
 * asked for again, and handed to the next link as `previous`. The summariser
 * kept whatever the call returned, and a step could not see how a call ended,
 * so a reply cut off at its length limit was the story above the window for
 * the rest of the session, and a filtered reply that came back empty quietly
 * removed it. These drive the step with a host that says how each call ended,
 * which is what `StepCallResult.outcome` now carries.
 */

let dataDir: string;
let layout: Layout;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-summarise-'));
  layout = new Layout(dataDir);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** Forty-five turns, so the chain has two links to derive above the window. */
const TRANSCRIPT: TranscriptTurn[] = Array.from({ length: 45 }, (_, at) => ({
  turnId: `t-${String(at)}`,
  input: { actorId: null, kind: 'do', text: `She walked on, ${String(at)} days out.` },
  output: { text: `The road went on, and on day ${String(at)} it turned.` },
}));

/** A host whose every call ends the way `answer` says. */
function host(answer: Pick<StepCallResult, 'text'> & Partial<StepCallResult>): StepHost {
  let calls = 0;
  return {
    call: () => {
      calls += 1;
      return Promise.resolve({ callId: `call-${String(calls)}`, usage: null, ...answer });
    },
    random: {} as StepHost['random'],
    signal: new AbortController().signal,
  };
}

async function run(answer: Pick<StepCallResult, 'text'> & Partial<StepCallResult>) {
  const step = summarise({
    layout,
    handle: 'ned',
    sessionId: 's-1',
    policy: DEFAULT_SUMMARY_POLICY,
    key: 'summariser-1',
    report: () => undefined,
  });
  const input: StepInput = {
    turnId: 't-now',
    sessionId: 's-1',
    parentTurnId: 't-44',
    channels: {},
    transcript: TRANSCRIPT,
  };
  return step.run(input, host(answer));
}

const held = async (): Promise<number> => (await listSummaries(layout, 'ned', 's-1')).size;

describe('what the summariser keeps', () => {
  it('keeps nothing from a reply cut off at its limit, and asks again next time', async () => {
    await expect(
      run({ text: 'They had been walking north for so', outcome: 'truncated' }),
    ).rejects.toThrow(/cut off/);
    expect(await held()).toBe(0);

    await run({ text: 'They had been walking north for some time.', outcome: 'ok' });
    expect(await held()).toBe(2);
  });

  it('keeps nothing from a refused reply or an empty one', async () => {
    await expect(run({ text: '', outcome: 'refused' })).rejects.toThrow(/refused/);
    await expect(run({ text: '   \n', outcome: 'ok' })).rejects.toThrow(/empty/);
    expect(await held()).toBe(0);
  });

  it('keeps a reply with words when the endpoint never said why it stopped', async () => {
    // Some local endpoints never report a finish reason, and refusing those
    // would refuse every summary they write.
    await run({ text: 'They had been walking north for some time.', outcome: 'incomplete' });
    expect(await held()).toBe(2);
  });

  it('keeps a reply from a host that does not say how it ended', async () => {
    // A host written before `outcome` existed reports nothing, and is read as
    // having nothing to report rather than as a refusal.
    await run({ text: 'They had been walking north for some time.' });
    expect(await held()).toBe(2);
  });
});

/**
 * ***A link is its own stretch*** (2026-09-27).
 *
 * The collector puts every link in the prompt as its own block, oldest first,
 * and the prompt asked each one for everything so far: the story went into the
 * prompt once per link, and a model that grew its links met the reply's limit
 * a couple of hundred turns in, after which no link was ever written again. So
 * a link is asked for its own turns, with the one before it as context only;
 * and when one cannot be written, the links already held still reach the turn.
 */
describe('what a link is asked for, and what survives one that fails', () => {
  /** A host that records what it was asked and answers each call in turn. */
  function recording(answers: Partial<StepCallResult>[]): StepHost & {
    asked: StepCallRequest[];
  } {
    const asked: StepCallRequest[] = [];
    return {
      asked,
      call: (request) => {
        asked.push(request);
        const answer = answers[Math.min(asked.length - 1, answers.length - 1)] ?? {};
        return Promise.resolve({
          callId: `call-${String(asked.length)}`,
          text: `Stretch ${String(asked.length)} of the road.`,
          usage: null,
          ...answer,
        });
      },
      random: {} as StepHost['random'],
      signal: new AbortController().signal,
    };
  }

  function step(reports: SummariseReport[]) {
    return summarise({
      layout,
      handle: 'ned',
      sessionId: 's-1',
      policy: DEFAULT_SUMMARY_POLICY,
      key: 'summariser-1',
      report: (report) => {
        reports.push(report);
      },
    });
  }

  function inputOf(turns: number): StepInput {
    return {
      turnId: 't-now',
      sessionId: 's-1',
      parentTurnId: `t-${String(turns - 1)}`,
      channels: {},
      transcript: TRANSCRIPT.concat(
        Array.from({ length: Math.max(0, turns - TRANSCRIPT.length) }, (_, at) => ({
          turnId: `t-${String(TRANSCRIPT.length + at)}`,
          output: { text: `Day ${String(TRANSCRIPT.length + at)}, and still the road.` },
        })),
      ).slice(0, turns),
    };
  }

  function textOf(request: StepCallRequest | undefined, id: string): string {
    return request?.candidates?.find((one) => one.id === id)?.text ?? '';
  }

  it('asks for the turns since, and hands the earlier summary over as context only', async () => {
    const host = recording([{}]);
    await step([]).run(inputOf(45), host);

    // Two links above a window of twenty: turns 0–19, then 20–24.
    expect(host.asked).toHaveLength(2);
    const [first, second] = host.asked;
    const task = textOf(first, 'se.summary.task');
    expect(task).toMatch(/do not repeat it/i);
    expect(task).not.toMatch(/so far|covering both|per twenty turns/i);

    // The second is handed the first as context, and only its own turns.
    expect(textOf(second, 'se.summary.previous')).toBe('Stretch 1 of the road.');
    const turns = textOf(second, 'se.summary.turns');
    expect(turns).toContain('on day 20 it turned');
    expect(turns).toContain('on day 24 it turned');
    expect(turns).not.toContain('on day 19 it turned');
  });

  it('reports the links it holds when the next one is cut off', async () => {
    await step([]).run(inputOf(45), recording([{}]));

    // One turn later the trailing link re-keys and is asked for again, and
    // this time the reply runs into its limit.
    const reports: SummariseReport[] = [];
    await expect(
      step(reports).run(inputOf(46), recording([{ outcome: 'truncated' }])),
    ).rejects.toThrow(/cut off/);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.links.map((link) => [link.from, link.to])).toEqual([[0, 19]]);
  });

  it('reports nothing when nothing is held, so the slot reads as unwritten', async () => {
    const reports: SummariseReport[] = [];
    await expect(
      step(reports).run(inputOf(45), recording([{ outcome: 'truncated' }])),
    ).rejects.toThrow(/cut off/);

    expect(reports).toEqual([]);
  });
});

/**
 * ***Whether a turn has a chain, asked once for the turn and the preview***
 * (2026-09-27). *Longer than the window* is counted in story turns, the way the
 * window is: a path of twenty turns of story and five edits has nothing above
 * a twenty-turn window, and a summariser that ran for it planned a chain over
 * turns the window already held.
 */
describe('whether a turn has a chain', () => {
  function turnOf(at: number, told: boolean): Turn {
    return {
      id: `t-${String(at)}`,
      sessionId: 's-1',
      parentTurnId: null,
      createdAt: '2026-09-27T00:00:00.000Z',
      status: 'complete',
      effects: [],
      tape: [],
      ...(told ? { output: { text: `Day ${String(at)} on the road.` } } : {}),
    };
  }

  function inputsWith(over: {
    story: number;
    edits?: number;
    slot?: boolean;
    bound?: boolean;
  }): AssemblyInputs {
    const history = [
      ...Array.from({ length: over.story }, (_, at) => turnOf(at, true)),
      ...Array.from({ length: over.edits ?? 0 }, (_, at) => turnOf(1000 + at, false)),
    ];
    return {
      session: null,
      history,
      mode: { definition: { assembly: { historyWindow: 20 } } },
      preset: {
        params: {},
        blocks:
          over.slot === false
            ? []
            : [{ id: 'se.summary', enabled: true, kind: 'slot', source: { of: 'summary' } }],
      },
      bindings: over.bound === false ? {} : { prose: { connectionId: 'c-1', modelId: 'm-1' } },
      defaults: {},
      usable: [
        {
          id: 'c-1',
          label: 'The double',
          provider: 'openai-compatible',
          scope: 'user',
          models: ['m-1'],
        },
      ],
      cast: { persona: null, actors: [] },
    } as unknown as AssemblyInputs;
  }

  it('has one when the story is longer than the window', () => {
    const plan = summaryPlanFor(inputsWith({ story: 25 }));
    expect(plan?.policy).toEqual({ ...DEFAULT_SUMMARY_POLICY, window: 20 });
    expect(plan?.key).toMatch(/\S/);
  });

  it('counts the story, not the edits between its turns', () => {
    expect(summaryPlanFor(inputsWith({ story: 20, edits: 5 }))).toBeNull();
  });

  it('has none without a slot to fill or a model to ask', () => {
    expect(summaryPlanFor(inputsWith({ story: 25, slot: false }))).toBeNull();
    expect(summaryPlanFor(inputsWith({ story: 25, bound: false }))).toBeNull();
  });
});
