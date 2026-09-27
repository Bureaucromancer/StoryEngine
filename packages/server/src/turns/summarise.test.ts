// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StepCallResult, StepHost, StepInput, TranscriptTurn } from '@storyengine/sdk';

import { DEFAULT_SUMMARY_POLICY } from '../sessions/summary-chain.js';
import { listSummaries } from '../sessions/summaries.js';
import { Layout } from '../storage/layout.js';
import { summarise } from './summarise.js';

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
