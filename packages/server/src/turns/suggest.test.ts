// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { StepCallRequest, StepCallResult, StepHost, StepInput } from '@storyengine/sdk';

import { randomOver } from '../rng/random.js';
import { Rng } from '../rng/rng.js';
import { suggest, SUGGEST_COUNT, type SuggestReport } from './suggest.js';

/**
 * ***The suggester, asked the way its schema answers*** (2026-09-27).
 *
 * Its task asked for *one per line, no numbering* while the same call's
 * schema asks for an object with an `actions` list, and the schema is sent in
 * words after the task on every endpoint that cannot take it as a parameter —
 * the ordinary self-hosted case. A model that followed the first format it
 * read answered three plain lines, the reply did not parse, and the retry
 * ladder asked twice more with the same messages: three calls a turn and no
 * suggestions. What is pinned is the sentence and the reading together.
 */

function host(answer: Partial<StepCallResult>): StepHost & { asked: StepCallRequest[] } {
  const asked: StepCallRequest[] = [];
  return {
    asked,
    call: (request) => {
      asked.push(request);
      return Promise.resolve({ callId: 'c1', text: '', usage: null, ...answer });
    },
    random: randomOver(new Rng()),
    signal: new AbortController().signal,
  };
}

function input(prose: string): StepInput {
  return {
    turnId: 't-new',
    sessionId: 's',
    parentTurnId: null,
    channels: {},
    history: [],
    output: { text: prose },
  };
}

async function run(answer: Partial<StepCallResult>): Promise<{
  asked: StepCallRequest[];
  report: SuggestReport | null;
}> {
  const held: { report: SuggestReport | null } = { report: null };
  const step = suggest({
    enabled: true,
    report: (report) => {
      held.report = report;
    },
  });
  const capabilities = host(answer);
  await step.run(input('The door creaked open on an empty hall.'), capabilities);
  return { asked: capabilities.asked, report: held.report };
}

describe('what the suggester asks for', () => {
  it('asks for the list its schema reads, and not for lines', async () => {
    const { asked } = await run({ object: { actions: ['Look around.'] } });

    const task = asked[0]?.candidates?.find((one) => one.id === 'se.suggest.task')?.text ?? '';
    expect(task).toContain(`exactly ${String(SUGGEST_COUNT)} short actions`);
    expect(task).toContain('"actions"');
    expect(task).not.toMatch(/one per line|numbering/i);
    // The schema it reads is the one it names.
    expect(JSON.stringify(asked[0]?.schema)).toContain('"actions"');
  });

  it('reads the list it asked for', async () => {
    const { report } = await run({
      object: { actions: ['Look around.', ' Look around. ', 'Call out.', 'Leave.', 'Wait.'] },
    });

    // Trimmed, de-duplicated, and no more than it asked for.
    expect(report?.actions).toEqual(['Look around.', 'Call out.', 'Leave.']);
  });
});
