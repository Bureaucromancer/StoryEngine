// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { createValidator } from '@storyengine/sdk';
import type {
  StepCallRequest,
  StepCallResult,
  StepHost,
  StepInput,
  OutputMessage,
} from '@storyengine/sdk';

import {
  CONTINUITY_APPLY,
  CONTINUITY_ON,
  EDIT_CHANNELS,
  EDIT_STEP,
  EDIT_SURFACES,
  HOLD,
  STYLE,
  STYLE_ON,
  edit,
} from './edit.js';
import { SCENE_ID } from './mode.js';

/**
 * ***The editor, held to [P13 §1.9.4]*** — [P13.5c].
 *
 * The step's claims, each with the mutation that falsifies it: **off costs
 * nothing**; **one call per message, carried lines skipped**; **an edit is a
 * revision, `changes` beside it**; **no edit needed is no revision**;
 * **continuity reports under `notice` and is folded in under `apply`**; **a
 * finding's fix is kept only when its words are in the text the message will
 * carry**; **a malformed answer fails the step**. The engine half — the text
 * replaced before commit, `original`, the hold — is the server's
 * (`routes/editor.test.ts`).
 */

type Answer = object | Error;

function host(answers: readonly Answer[]): StepHost & { asked: StepCallRequest[] } {
  const asked: StepCallRequest[] = [];
  const call = (request: StepCallRequest): Promise<StepCallResult> => {
    const answer = answers[asked.length];
    asked.push(request);
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({
      callId: `c-edit-${String(asked.length)}`,
      text: JSON.stringify(answer),
      usage: null,
      ...(answer === undefined ? {} : { object: answer }),
    });
  };
  return { asked, call, signal: { aborted: false } } as unknown as StepHost & {
    asked: StepCallRequest[];
  };
}

type Channels = StepInput['channels'];

function state(value: unknown): Channels[string] {
  return { value } as Channels[string];
}

function input(channels: Channels, messages?: OutputMessage[]): StepInput {
  return {
    turnId: 't-new',
    sessionId: 's',
    parentTurnId: null,
    channels,
    cast: [],
    output: {
      text:
        messages === undefined
          ? 'The air smelled of ozone.'
          : messages.map((m) => m.text).join('\n\n'),
      ...(messages === undefined ? {} : { messages }),
    },
    transcript: [{ turnId: 't-0', output: { text: 'The lamp went dark.' } }],
  };
}

const STYLED = { [STYLE_ON.id]: state(true) };
const NO_EDIT = { editNeeded: false, editedText: '', changes: [] };

describe('what is declared', () => {
  it('is five session settings owned by Scene, every switch off but the hold', () => {
    const validator = createValidator();
    for (const channel of EDIT_CHANNELS) {
      expect(channel.owner).toBe(SCENE_ID);
      expect(channel.update).toBe('user-only');
      if (channel.init.kind !== 'literal') throw new Error(channel.id);
      expect(validator.validate(channel.schema, channel.init.value), channel.id).toBe(true);
    }
    for (const toggle of [STYLE_ON, CONTINUITY_ON, CONTINUITY_APPLY]) {
      expect(toggle.init).toEqual({ kind: 'literal', value: false });
    }
    // Marinara's hold defaults on — anything but an explicit false.
    expect(HOLD.init).toEqual({ kind: 'literal', value: true });
    expect(CONTINUITY_APPLY.enabledBy).toBe(CONTINUITY_ON.id);
    expect(STYLE.enabledBy).toBe(STYLE_ON.id);
    // Every one of them is under Agents in settings.
    expect(new Set(EDIT_SURFACES.map((one) => `${one.region}/${one.group ?? ''}`))).toEqual(
      new Set(['settings/Agents']),
    );
  });

  it('is a post step that revises, writes nothing, and holds on its own switch', () => {
    expect(EDIT_STEP).toMatchObject({
      id: 'se.scene.edit',
      stage: 'post',
      writes: [],
      failure: 'warn',
      revises: { enabledBy: [STYLE_ON.id, CONTINUITY_ON.id], hold: HOLD.id },
    });
    // No `contributes`: its purpose is not prose, so it is offered no guidance.
    expect(EDIT_STEP.contributes).toBeUndefined();
  });
});

describe('the pass', () => {
  it('costs nothing while both switches are off', async () => {
    const calls = host([]);
    expect(await edit(input({}), calls)).toEqual({});
    expect(calls.asked).toHaveLength(0);
  });

  it('revises a message with a banned word, the changes beside it', async () => {
    const calls = host([
      {
        editNeeded: true,
        editedText: 'The air smelled of rain.',
        changes: [{ description: 'Removed “ozone”.' }],
      },
    ]);
    const result = await edit(input(STYLED), calls);
    expect(result).toEqual({
      revisions: [{ index: 0, text: 'The air smelled of rain.', changes: ['Removed “ozone”.'] }],
    });
    // The declared rules reach the call, the banned word among them.
    const texts = (calls.asked[0]?.candidates ?? []).map((one) => one.text).join('\n');
    expect(texts).toContain('Banned words and phrases: ozone');
    expect(texts).toContain('The air smelled of ozone.');
  });

  it('answers nothing when no edit is needed, or the "edit" is the same text', async () => {
    expect(await edit(input(STYLED), host([NO_EDIT]))).toEqual({});
    expect(
      await edit(
        input(STYLED),
        host([{ editNeeded: true, editedText: ' The air smelled of ozone. ', changes: [] }]),
      ),
    ).toEqual({});
  });

  it('edits each message of a round on its own, and leaves a carried one alone', async () => {
    const vera = { id: 'a-vera', name: 'Vera' };
    const marlow = { id: 'a-marlow', name: 'Marlow' };
    const calls = host([{ editNeeded: true, editedText: '"Rain," said Marlow.', changes: [] }]);
    const result = await edit(
      input(STYLED, [
        { speaker: vera, text: '"Ozone," said Vera.', carried: true },
        { speaker: marlow, text: '"Ozone," said Marlow.' },
      ]),
      calls,
    );
    expect(calls.asked).toHaveLength(1);
    expect(calls.asked[0]?.candidates?.at(-1)?.text).toContain('written as Marlow');
    expect(result.revisions).toEqual([{ index: 1, text: '"Rain," said Marlow.' }]);
  });

  it('lists continuity findings under notice, with the fix only when its words are there', async () => {
    const calls = host([
      {
        editNeeded: false,
        editedText: '',
        changes: [],
        issues: [
          { issue: 'The lamp went dark last turn.', quote: 'lit lamp', fix: 'dark lamp' },
          { issue: 'A quote the reply does not hold.', quote: 'no such words', fix: 'x' },
        ],
      },
    ]);
    const result = await edit(
      {
        ...input({ [CONTINUITY_ON.id]: state(true) }),
        output: { text: 'She read by the lit lamp.' },
      },
      calls,
    );
    expect(result.revisions).toEqual([
      {
        index: 0,
        notices: [
          { issue: 'The lamp went dark last turn.', quote: 'lit lamp', fix: 'dark lamp' },
          { issue: 'A quote the reply does not hold.' },
        ],
      },
    ]);
    // Continuity reads what the story established; style's rules are not sent.
    const texts = (calls.asked[0]?.candidates ?? []).map((one) => one.text).join('\n');
    expect(texts).toContain('The lamp went dark.');
    expect(texts).not.toContain('Banned words');
  });

  it('never rewrites under notice alone, whatever the model answers', async () => {
    const calls = host([
      {
        editNeeded: true,
        editedText: 'She read by the dark lamp.',
        changes: [{ description: 'The lamp is dark.' }],
        issues: [{ issue: 'The lamp went dark last turn.', quote: 'lit lamp', fix: 'dark lamp' }],
      },
    ]);
    const result = await edit(
      {
        ...input({ [CONTINUITY_ON.id]: state(true) }),
        output: { text: 'She read by the lit lamp.' },
      },
      calls,
    );
    // Notices only, their quote matched against the unedited text.
    expect(result.revisions).toEqual([
      {
        index: 0,
        notices: [{ issue: 'The lamp went dark last turn.', quote: 'lit lamp', fix: 'dark lamp' }],
      },
    ]);
    const task = calls.asked[0]?.candidates?.[0]?.text ?? '';
    expect(task).not.toContain('"editNeeded": true');
    expect(task).toContain('Do not rewrite the reply.');
  });

  it('folds continuity into the edit under apply, and lists nothing', async () => {
    const calls = host([
      {
        editNeeded: true,
        editedText: 'She read by the dark lamp.',
        changes: [{ description: 'The lamp is dark.' }],
        issues: [{ issue: 'ignored under apply' }],
      },
    ]);
    const result = await edit(
      {
        ...input({ [CONTINUITY_ON.id]: state(true), [CONTINUITY_APPLY.id]: state(true) }),
        output: { text: 'She read by the lit lamp.' },
      },
      calls,
    );
    expect(result.revisions).toEqual([
      { index: 0, text: 'She read by the dark lamp.', changes: ['The lamp is dark.'] },
    ]);
    expect(calls.asked[0]?.candidates?.[0]?.text).toContain('fix, in the reply');
  });

  it('fails on an answer that does not say whether an edit was needed', async () => {
    await expect(edit(input(STYLED), host([{ editedText: 'x' }]))).rejects.toThrow(/edit/);
    await expect(edit(input(STYLED), host([new Error('down')]))).rejects.toThrow('down');
  });
});
