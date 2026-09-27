// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelCall } from '@storyengine/shared';

import { Layout } from '../storage/layout.js';
import { fromModelCall, recordUsage, USAGE_SCHEMA, type UsageRecord } from './log.js';

/**
 * ***The receipt for a call that makes no turn*** —
 * [10 §11.4](../../../../docs/design/10-ui-surfaces.md).
 *
 * Three claims. **One line per call, appended**, so a spend view built later
 * reads what happened in the order it happened. **The provider's figures or
 * nothing** — a null stays a null, because [21 §1.4]'s *"never estimated"* is
 * the rule `ModelCall` already keeps and a receipt that invented a number would
 * be worse than no receipt. And **it never throws**, because by the time it runs
 * the person has paid and the answer is the thing worth protecting.
 */

let dataDir: string;
let layout: Layout;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-usage-'));
  layout = new Layout(dataDir);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function aRecord(over: Partial<UsageRecord> = {}): UsageRecord {
  return {
    schema: USAGE_SCHEMA,
    at: '2026-09-27T12:00:00.000Z',
    purpose: 'assist:profile.appearance',
    role: 'prose',
    resolved: { connectionId: 'c-1', modelId: 'fake-hi' },
    usage: { promptTokens: 12, completionTokens: 34 },
    cost: null,
    wallMs: 5,
    ...over,
  };
}

async function linesOf(handle: string): Promise<unknown[]> {
  const text = await readFile(layout.usageLogFile(handle), 'utf8');
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as unknown);
}

describe('the usage log', () => {
  it('appends one line per call, in order', async () => {
    await recordUsage(layout, 'ned', aRecord({ purpose: 'first' }));
    await recordUsage(layout, 'ned', aRecord({ purpose: 'second' }));

    const lines = await linesOf('ned');
    expect(lines).toHaveLength(2);
    expect(lines.map((one) => (one as UsageRecord).purpose)).toEqual(['first', 'second']);
  });

  /**
   * ***Concurrent calls each keep their line.*** Two assists pressed in quick
   * succession are the ordinary case, and a log that lost one would under-count
   * exactly the behaviour a spend view exists to show.
   */
  it('keeps every line when calls land together', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        recordUsage(layout, 'ned', aRecord({ purpose: `call-${String(index)}` })),
      ),
    );
    expect(await linesOf('ned')).toHaveLength(20);
  });

  it('keeps a null usage null rather than inventing one', async () => {
    await recordUsage(layout, 'ned', aRecord({ usage: null }));
    const [line] = await linesOf('ned');
    expect((line as UsageRecord).usage).toBeNull();
  });

  it('lives in the account’s own directory', async () => {
    await recordUsage(layout, 'ned', aRecord());
    expect(layout.usageLogFile('ned')).toBe(join(dataDir, 'users', 'ned', 'usage.jsonl'));
  });

  /**
   * ***A receipt that cannot be written does not cost the answer.*** A handle
   * that cannot be resolved stands in for any failure below the call: the
   * promise resolves, and nothing escapes to fail a request somebody has
   * already paid for.
   */
  it('never throws', async () => {
    await expect(recordUsage(layout, '../escape', aRecord())).resolves.toBeUndefined();
  });

  it('carries a model call’s measured fields across unchanged', () => {
    const call = {
      role: 'prose',
      resolved: { connectionId: 'c-1', modelId: 'answered-model' },
      usage: { promptTokens: 7, completionTokens: 9 },
      cost: { amount: 0.01, currency: 'USD' },
      wallMs: 42,
    } as ModelCall;

    const record = fromModelCall(call, 'impersonate', { sessionId: 's-1' });
    expect(record).toMatchObject({
      schema: USAGE_SCHEMA,
      purpose: 'impersonate',
      role: 'prose',
      resolved: { connectionId: 'c-1', modelId: 'answered-model' },
      usage: { promptTokens: 7, completionTokens: 9 },
      cost: { amount: 0.01, currency: 'USD' },
      wallMs: 42,
      sessionId: 's-1',
    });
  });
});
