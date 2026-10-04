// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { newSetup } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { Layout } from '../storage/layout.js';
import { TEST_MODE } from '../test-mode.js';
import { makeTestServer, setUpAdmin } from '../test-server.js';
import type { Mode } from '@storyengine/sdk';
import type { StepDefinition } from './steps.js';
import { previewAssembly, previewStepFor } from './preview.js';

/**
 * Which call a preview is about — [P3.4], pinned against a **synthetic** mode.
 *
 * The route tests cannot hold this claim: Scene ships exactly one step and it
 * is the prose one, so `steps[0]` and *the first prose step* are the same
 * answer there, and a test written over the real mode passes under either. The
 * distinction is real all the same — [06 §5.2] admits guidance only to a call
 * whose purpose is prose, so the prose call is the only one the guidance box
 * can change, and previewing anything else would measure a prompt the person
 * on the input bar cannot affect. A mode with a pre-step arrives with P7 at
 * the latest; this is what stops it arriving as a silent wrong answer.
 */

function step(over: Partial<StepDefinition> & Pick<StepDefinition, 'id'>): StepDefinition {
  const narrate = TEST_MODE.definition.steps[0];
  if (narrate === undefined) throw new Error('Scene declares no steps.');
  return { ...narrate, ...over };
}

function modeOf(steps: StepDefinition[]): Mode {
  return {
    ...TEST_MODE,
    definition: { ...TEST_MODE.definition, steps },
  };
}

describe('the step a preview is about', () => {
  it('is the prose step, not merely the first one', () => {
    // The falsifying mutation is `steps[0]`, which is indistinguishable from
    // the right answer against every mode this repo currently ships.
    const mode = modeOf([
      step({ id: 'se.retrieve', role: 'fast', callKind: 'retrieve' }),
      step({ id: 'se.narrate', role: 'prose', callKind: 'narrate' }),
    ]);

    expect(previewStepFor(mode)?.id).toBe('se.narrate');
  });

  it('is the first prose step when a mode declares several', () => {
    const mode = modeOf([
      step({ id: 'se.narrate', role: 'prose', callKind: 'narrate' }),
      step({ id: 'se.embellish', role: 'prose', callKind: 'narrate' }),
    ]);

    expect(previewStepFor(mode)?.id).toBe('se.narrate');
  });

  it('is nothing at all when a mode asks no prose of anyone', () => {
    // Answered as `no-prose-step` by the caller rather than as an empty
    // prompt: a mode that never narrates has no context fill to report, and
    // reporting zero would be a measurement nobody made.
    const mode = modeOf([step({ id: 'se.extract', role: 'fast', callKind: 'extract' })]);

    expect(previewStepFor(mode)).toBeNull();
  });

  it('is the step that writes the messages, not a prose-role pass declared ahead of it', () => {
    // [P14.5b]: Scene's secret-plot pass is `pre`, asks `prose` and writes an
    // effect; the meter measures the narrator's call behind it.
    const mode = modeOf([
      step({ id: 'se.scene.plot', role: 'prose', callKind: 'plot', contributes: 'effects' }),
      step({ id: 'se.narrate', role: 'prose', callKind: 'narrate' }),
    ]);

    expect(previewStepFor(mode)?.id).toBe('se.narrate');
  });

  it('finds Scene’s narrate step, which is the one the meter measures today', () => {
    expect(previewStepFor(TEST_MODE)?.id).toBe('se.narrate');
  });
});

/**
 * ***The story so far, in a preview as in a turn*** —
 * [P15.2](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md).
 *
 * A session started from a Setup with a story so far shows the model that
 * story on every call, from turn one — it costs no call, so a turn well inside
 * its window carries it exactly as one past the window does. The preview
 * measures the prompt a person is about to send, so it has to carry it too:
 * a meter that left it out would under-read by the whole story so far, and the
 * workbench would show a prompt without the block the turn sends.
 *
 * *Through `collectFor`*, which fills it for every assembler at once since the
 * merge (2026-10-03) folded the branch's three per-caller copies into it.
 * Falsified by taking it back out of `collectFor`: the block is gone from the
 * preview, though the gather still reads it.
 */
describe('a preview of a session started from a story so far', () => {
  it('carries the story so far as its own block, before any chain exists', async () => {
    const provider = new FakeProvider({ script: [] });
    const server = await makeTestServer({ providers: () => provider });
    try {
      await setUpAdmin(server, 'ned');
      const connections = new Layout(server.dataDir).userConnectionsRoot('ned');
      await mkdir(connections, { recursive: true });
      const connection = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a32';
      await writeFile(
        join(connections, 'fake.json'),
        JSON.stringify({
          id: connection,
          label: 'The double',
          provider: 'openai-compatible',
          models: ['fake-hi'],
        }),
      );
      await writeFile(
        join(server.dataDir, 'users', 'ned', 'bindings.json'),
        JSON.stringify({ prose: { connectionId: connection, modelId: 'fake-hi' } }),
      );
      const setup = await server.request({
        method: 'POST',
        url: '/api/library/setups',
        payload: {
          ...newSetup('From the docks'),
          storySoFar: 'Before any of this, the ledger was lost.',
        },
      });
      const created = await server.request({
        method: 'POST',
        url: '/api/sessions',
        payload: { setup: setup.body.object.id as string },
      });
      expect(created.status).toBe(201);

      const preview = await previewAssembly(
        {
          sessions: server.services.sessions,
          accounts: server.services.accounts,
          providers: server.services.providers,
          config: server.services.config,
        },
        {
          account: 'ned',
          sessionId: created.body.session.id as string,
          parentTurnId: (created.body.session.headTurnId as string | null) ?? null,
          input: { text: 'I look for the ledger.' },
        },
      );

      if (preview.state !== 'assembled') throw new Error(`not assembled: ${preview.state}`);
      const root = preview.blocks.filter((block) => block.source.kind === 'story-so-far');
      expect(root.map((block) => [block.text, block.included])).toEqual([
        ['Before any of this, the ledger was lost.', true],
      ]);
      expect(root[0]?.source).toEqual({
        kind: 'story-so-far',
        setupId: setup.body.object.id as string,
      });
    } finally {
      await server.dispose();
    }
  });
});
