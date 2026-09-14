// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dialChannel, SE_DIFFICULTY, SE_DIRECTEDNESS } from '@storyengine/sdk';
import type { Preset } from '@storyengine/shared';

import { registerMode } from '../mode-registry.js';
import { DIALS_MODE, DIALS_PRESET } from '../test-mode.js';
import { channelDefinition } from './channels.js';
import { levelFragments, packLevels, readDial, resolveLevel } from './dials.js';
import { SE_HOOK_PACING } from './hooks.js';

/**
 * Difficulty and directedness — [06 §7.3.1], [06 §7.3.2], [24 §5.4], built at
 * [P7.8].
 *
 * ***The tests are about the separation as much as about the resolution***,
 * because the failure [06 §7.3.2] names is not a bug in one function: it is two
 * dials quietly becoming one, which no single assertion about either can catch.
 */

beforeEach(() => {
  registerMode(DIALS_MODE);
});

describe('what a mode declares when it has a difficulty', () => {
  /**
   * ***`user-only`, and the alternative is the thing the dial is about.***
   * [06 §7.3.1] calls difficulty *"a dial on narrator sycophancy"*. A
   * `model-proposed` one would let the narrator vote on how hard it is being on
   * you, which is the sycophancy wired straight to its own control.
   */
  it('lets a person change it and nothing else', () => {
    for (const id of [SE_DIFFICULTY, SE_DIRECTEDNESS]) {
      expect(channelDefinition(id)?.update, id).toBe('user-only');
    }
  });

  /**
   * *A setting the player cannot see is [work plan §2.3]'s configuration with no
   * surface*, and the level's **name** is not hidden content the way the
   * fragments it selects are.
   */
  it('shows the level to the player', () => {
    for (const id of [SE_DIFFICULTY, SE_DIRECTEDNESS]) {
      expect(channelDefinition(id)?.visibility, id).toBe('player');
    }
  });

  /**
   * ***No enum, because the levels are the pack's.*** A build cannot know them:
   * a preset shipping five is as valid as one shipping three, and
   * [04 §8.2]'s *unions that must stay open* is the same argument one layer
   * down. What checks a value is {@link resolveLevel}, against the pack in play.
   */
  it('does not enumerate levels it cannot know', () => {
    for (const id of [SE_DIFFICULTY, SE_DIRECTEDNESS]) {
      expect(channelDefinition(id)?.schema, id).not.toHaveProperty('enum');
    }
  });

  /** The [P7.5] invariant: a channel has to be writable its own initial value. */
  it('can be written back to unset', () => {
    for (const id of [SE_DIFFICULTY, SE_DIRECTEDNESS]) {
      const schema = channelDefinition(id)?.schema as { type?: unknown };
      expect(schema.type, id).toContain('null');
    }
  });

  /**
   * ***A mode with no difficulty declares neither, which is the discrimination
   * [04 §7] says Setup could not express*** — *"Modelling it on Setup would
   * imply Messages and Scene have a difficulty, which they do not."*
   */
  it('is absent from the registry when no mode declares it', async () => {
    // **Loaded fresh, which is the only way to see an unregistered one** — the
    // registry is a module global and `beforeEach` above has already put this
    // fixture in it. Same device `mode-registry.test.ts` uses, and for the same
    // reason: *no mode declares a difficulty* is a real state a build has, and
    // it is the state Scene and Messages are permanently in.
    vi.resetModules();
    const channels = await import('./channels.js');

    expect(channels.channelDefinition(SE_DIFFICULTY)).toBeNull();
    expect(channels.channelDefinition(SE_DIRECTEDNESS)).toBeNull();
  });

  /**
   * ***[24 §5.4]'s constraint, as an assertion.*** *"A frequency dial stays a
   * separate channel from difficulty, because folding* how often *into* how hard
   * *rebuilds exactly the conflation 06 §7.3.2 exists to prevent."* Three ids,
   * three channels; the day somebody merges two of them this fails.
   */
  it('is three dials and not two', () => {
    expect(new Set([SE_DIFFICULTY, SE_DIRECTEDNESS, SE_HOOK_PACING]).size).toBe(3);
  });

  /** The builder is what keeps the policy from being restated per mode. */
  it('declares the same policy whoever declares it', () => {
    const mine = dialChannel('difficulty', 'somebody.else');
    expect(mine.id).toBe(SE_DIFFICULTY);
    expect(mine.owner).toBe('somebody.else');
    expect(mine.update).toBe('user-only');
  });
});

describe('which level a session is on', () => {
  const channels = (value: unknown): Record<string, { value: unknown }> => ({
    [SE_DIFFICULTY]: { value },
  });

  /**
   * ***Three rungs, and the middle one is [04 §7]'s answer.*** `mode.config`
   * keeps the wizard's answer — which is what *"opaque to the host"* was
   * protecting — and the channel carries the live value, so changing it
   * mid-session is an ordinary effect.
   */
  it('takes the channel over the wizard’s answer', () => {
    expect(readDial('difficulty', channels('harsh'), { difficulty: 'gentle' })).toBe('harsh');
  });

  it('falls back to the wizard’s answer when nothing has been changed', () => {
    expect(readDial('difficulty', {}, { difficulty: 'gentle' })).toBe('gentle');
  });

  it('reads nothing from a config that is not an object', () => {
    expect(readDial('difficulty', {}, 'harsh')).toBeNull();
    expect(readDial('difficulty', {}, null)).toBeNull();
  });

  /**
   * *A value this pack does not know reads as unset rather than as itself*,
   * which is `readPacing`'s posture and the only one that survives an author
   * swapping packs mid-session — the resolution below is where that happens.
   */
  it('falls to the pack’s lowest rank for a level it has never heard of', () => {
    expect(resolveLevel(DIALS_PRESET, 'difficulty', 'impossible')?.id).toBe('gentle');
  });

  /**
   * ***The floor is the pack's lowest entry rather than a constant***, because a
   * constant would be engine code deciding what *easy* means — the one thing
   * [06 §7.3.1] forbids. Proved by reordering the list: `rank` decides, position
   * does not.
   */
  it('takes the lowest rank and not the first entry', () => {
    const reversed: Preset = {
      ...DIALS_PRESET,
      difficultyLevels: [...(DIALS_PRESET.difficultyLevels ?? [])].reverse(),
    };
    expect(resolveLevel(reversed, 'difficulty', null)?.id).toBe('gentle');
  });

  /** A pack with no levels for an axis has no dial, which is not an error. */
  it('answers nothing when the pack ships no levels', () => {
    const bare: Preset = { ...DIALS_PRESET, difficultyLevels: [] };
    expect(resolveLevel(bare, 'difficulty', 'harsh')).toBeNull();
    expect(packLevels(bare, 'difficulty')).toEqual([]);
  });
});

describe('the fragments a level contributes', () => {
  /**
   * **Highest priority first**, because [20 §5.3]'s cap drops from the end of
   * what it is given and {@link DifficultyLevel} documents `priority` as *lower
   * is dropped first*. Array order would have made the ranking depend on how the
   * author happened to type the list.
   */
  it('ranks them so the cap drops the least important', () => {
    const harsh = resolveLevel(DIALS_PRESET, 'difficulty', 'harsh');
    const priorities = levelFragments(harsh!).map((fragment) => fragment.priority);

    expect(priorities).toEqual([...priorities].sort((left, right) => right - left));
  });

  /**
   * *The index is the position in the file*, taken before the sort, because that
   * is what an author reading the pack would count to — and it is what the
   * emitted block records so a reader can get back to the fragment that caused a
   * sentence.
   */
  it('carries the fragment’s place in the level, not its place after sorting', () => {
    const harsh = resolveLevel(DIALS_PRESET, 'difficulty', 'harsh');
    const lowest = levelFragments(harsh!).at(-1);

    expect(lowest?.priority).toBe(30);
    expect(lowest?.index).toBe(2);
  });

  /**
   * ***The two axes say different things, and this is the test that would catch
   * them merging.*** [06 §7.3.2]: the prompt language for *push back* and for
   * *assert your own plot* look similar from the outside, and a pack that wrote
   * one twice has built railroading and labelled half of it difficulty. Nothing
   * mechanical can judge prose — what it can do is refuse the identical case.
   */
  it('is not the same prose on both axes', () => {
    const resistance = resolveLevel(DIALS_PRESET, 'difficulty', 'harsh');
    const steering = resolveLevel(DIALS_PRESET, 'directedness', 'steering');
    const texts = (level: typeof resistance): string[] =>
      level === null ? [] : level.fragments.map((fragment) => fragment.text);

    expect(texts(resistance).some((text) => texts(steering).includes(text))).toBe(false);
  });

  /**
   * ***[06 §7.3.1]'s floor, held where it can be held.*** *"Obstruction must not
   * reach unreachability. Difficulty modulates the cost and the route, never
   * whether the goal can be attained at all."* Engine code cannot enforce a
   * claim about prose — what it can do is fail when the **shipped pack** stops
   * saying it, which is the fixture this build's own tests read.
   */
  it('says out loud, at the top level, that the goal stays reachable', () => {
    const harsh = resolveLevel(DIALS_PRESET, 'difficulty', 'harsh');
    const said = (harsh?.fragments ?? []).map((fragment) => fragment.text).join(' ');

    expect(said).toMatch(/never closed|still reachable|never unreachable/i);
  });
});
