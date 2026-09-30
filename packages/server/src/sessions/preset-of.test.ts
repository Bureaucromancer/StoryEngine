// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import { uuidv7, type Preset } from '@storyengine/shared';
import type { Mode } from '@storyengine/sdk';

import { installBuiltIns } from '../mode-loader.js';
import { DEFAULT_MODE_ID, modeById } from '../mode-registry.js';
import { presetOf } from './preset-of.js';

/**
 * ***A copy of the mode's own pack, read against what the mode ships now***
 * (2026-09-27).
 *
 * Against the real shipped packs rather than a fixture, because the claim is
 * about them: a session begun before a block existed gains that block where
 * the mode puts it. Each copy below is the shipped pack with something taken
 * out, which is exactly what a session copied before that something shipped
 * holds on disk.
 */

beforeEach(async () => {
  await installBuiltIns();
});

function mode(id = DEFAULT_MODE_ID): Mode {
  const found = modeById(id);
  if (found === null) throw new Error(`${id} is a built-in`);
  return found;
}

function shipped(id = DEFAULT_MODE_ID): Preset {
  return mode(id).definition.assembly.defaultPreset;
}

/** The shipped pack as a session copied before `ids` shipped would hold it. */
function copiedWithout(ids: string[], id = DEFAULT_MODE_ID): Preset {
  const copy = structuredClone(shipped(id));
  copy.blocks = copy.blocks.filter((block) => !ids.includes(block.id));
  return copy;
}

const ids = (pack: Preset): string[] => pack.blocks.map((block) => block.id);

describe('a copy of the mode’s own pack', () => {
  it('gains a block shipped after it was copied, where the mode ships it', () => {
    // The summary slot, which is what a session begun on the first alpha lacks
    // and what the summariser's plan asks for before it runs at all.
    expect(ids(presetOf(copiedWithout(['se.summary']), mode()))).toEqual(ids(shipped()));
  });

  it('gains several, each in its place, when a run of them is missing', () => {
    // Three of the four the audit found missing from an alpha.1 copy, two of
    // them adjacent in the shipped order.
    const read = presetOf(copiedWithout(['se.lore.after', 'se.samples', 'se.goal']), mode());
    expect(ids(read)).toEqual(ids(shipped()));
  });

  /**
   * ***The time and the place*** (2026-09-30), which every Scene session made
   * before they shipped lacks — and which it gains where the pack puts them,
   * so an existing story's narrator is told them from its next turn.
   */
  it('gains the clock and the place slots a session was copied without', () => {
    const read = presetOf(copiedWithout(['se.clock', 'se.location']), mode());
    expect(ids(read)).toEqual(ids(shipped()));
    expect(ids(read)).toContain('se.location');
  });

  /**
   * ***The assistant's attempt slot*** (2026-09-30), which every assistant
   * conversation begun before it lacks — gained straight after the guidance,
   * which is the place the pack's own note argues for.
   */
  it('gains the assistant’s attempt slot after the guidance', () => {
    const assistant = 'storyengine.assistant';
    const read = presetOf(copiedWithout(['se.attempt'], assistant), mode(assistant));

    expect(ids(read)).toEqual(ids(shipped(assistant)));
    expect(ids(read).indexOf('se.attempt')).toBe(ids(read).indexOf('se.guidance') + 1);
  });

  it('gains a block even when none of those before it survived', () => {
    // The nearest earlier block is the anchor; with none, the start is.
    const read = presetOf(copiedWithout(['se.instruction']), mode());
    expect(ids(read)).toEqual(ids(shipped()));
  });

  it('gains the pacing levels it was copied without', () => {
    const copy = structuredClone(shipped());
    delete copy.pacingLevels;

    expect(presetOf(copy, mode()).pacingLevels).toEqual(shipped().pacingLevels);
  });

  it('gains a Freeform dial’s levels the same way', () => {
    const freeform = 'storyengine.freeform';
    const copy = structuredClone(shipped(freeform));
    delete copy.difficultyLevels;

    expect(presetOf(copy, mode(freeform)).difficultyLevels).toEqual(
      shipped(freeform).difficultyLevels,
    );
  });

  it('keeps what it says about the blocks it has, and its own levels', () => {
    const copy = copiedWithout(['se.summary']);
    const goal = copy.blocks.find((block) => block.id === 'se.goal');
    const instruction = copy.blocks.find((block) => block.id === 'se.instruction');
    if (goal === undefined || instruction?.kind !== 'text') throw new Error('shipped blocks');
    goal.enabled = false;
    instruction.template = 'Write it as a ballad.';
    copy.pacingLevels = [];

    const read = presetOf(copy, mode());

    // Presence is the test, never state: switched off stays off, an edit is
    // kept, and an empty list is a list somebody has.
    expect(read.blocks.find((block) => block.id === 'se.goal')?.enabled).toBe(false);
    expect(read.blocks.find((block) => block.id === 'se.instruction')).toMatchObject({
      template: 'Write it as a ballad.',
    });
    expect(read.pacingLevels).toEqual([]);
    expect(ids(read)).toContain('se.summary');
  });

  it('is the copy itself when nothing is missing', () => {
    const copy = structuredClone(shipped());
    expect(presetOf(copy, mode())).toBe(copy);
  });

  it('never hands a copy the shipped block itself', () => {
    const read = presetOf(copiedWithout(['se.summary']), mode());
    const gained = read.blocks.find((block) => block.id === 'se.summary');
    const original = shipped().blocks.find((block) => block.id === 'se.summary');

    // A panel edit to the gained block must not rewrite the mode's pack for
    // every session on the install.
    expect(gained).toEqual(original);
    expect(gained).not.toBe(original);
  });
});

describe('what does not follow the mode', () => {
  it('leaves a library preset alone, however much of the mode’s it lacks', () => {
    const library = { ...copiedWithout(['se.summary', 'se.goal']), id: uuidv7() };
    delete library.pacingLevels;

    expect(presetOf(library, mode())).toBe(library);
  });

  it('is the mode’s own pack for a session with no copy at all', () => {
    expect(presetOf(undefined, mode())).toBe(shipped());
  });
});
