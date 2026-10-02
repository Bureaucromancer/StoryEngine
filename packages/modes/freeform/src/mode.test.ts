// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { SE_DIFFICULTY, SE_DIRECTEDNESS, validate } from '@storyengine/sdk';

import { modes } from './index.js';
import { FREEFORM, FREEFORM_ID, FREEFORM_MODE, NARRATE } from './mode.js';
import { FREEFORM_PRESET } from './preset.js';

/**
 * Freeform, held to what it claims — [06 §1], [06 §9], [P7.9].
 *
 * ***These are the assertions a second mode makes that a first one cannot.***
 * Scene's file asks whether *a* mode can be data and ship a real preset; this
 * one asks whether the **contract generalised** — whether a mode written against
 * the SDK from its first line, by somebody with no access to `server`, could
 * declare what [06 §9] says an externally-authored mode must be able to declare.
 * Every failure here would be a hole in the contract rather than a bug in the
 * mode, which is the whole reason [19 §10] wanted a second package.
 */

describe('the manifest is data', () => {
  it('survives a round trip through JSON with nothing lost', () => {
    expect(JSON.parse(JSON.stringify(FREEFORM))).toEqual(FREEFORM);
  });

  it('carries no function on any field', () => {
    const walk = (value: unknown, path: string): void => {
      expect(typeof value, `${path} is a function`).not.toBe('function');
      if (Array.isArray(value)) {
        value.forEach((one, index) => {
          walk(one, `${path}[${String(index)}]`);
        });
      } else if (typeof value === 'object' && value !== null) {
        for (const [key, one] of Object.entries(value)) walk(one, `${path}.${key}`);
      }
    };
    walk(FREEFORM, 'FREEFORM');
  });

  it('is the package’s one exported mode', () => {
    expect(modes).toEqual([FREEFORM_MODE]);
  });
});

describe('the preset is a real portable object', () => {
  /**
   * *The same validator a user's write goes through*, which is what caught
   * `SlotSource` missing an arm at P2.6. This preset positions two slot kinds
   * that did not exist a stage ago, so it is the first thing that would have
   * caught them being unschemaed.
   */
  it('validates as a preset', () => {
    expect(validate(FREEFORM_PRESET).valid).toBe(true);
  });

  it('is written for this mode and carries its levels', () => {
    expect(FREEFORM_PRESET.modes).toEqual([FREEFORM_ID]);
    expect(FREEFORM_PRESET.difficultyLevels?.map((level) => level.id)).toEqual([
      'gentle',
      'even',
      'harsh',
    ]);
    expect(FREEFORM_PRESET.directednessLevels?.map((level) => level.id)).toEqual([
      'following',
      'steering',
    ]);
  });

  /**
   * ***[06 §7.3.1]'s floor, as the pack's own sentence.*** *"Obstruction must
   * not reach unreachability. Difficulty modulates the cost and the route, never
   * whether the goal can be attained at all."* Engine code cannot enforce a claim
   * about prose; a pack can make it, in a line somebody can find.
   */
  it('says at the hardest level that the route is never closed', () => {
    const harsh = FREEFORM_PRESET.difficultyLevels?.find((level) => level.id === 'harsh');
    const said = (harsh?.fragments ?? []).map((fragment) => fragment.text).join(' ');

    expect(said).toMatch(/never closed/i);
  });

  /**
   * ***[06 §7.3.2]'s two axes, and the test that would catch them merging.***
   * The prompt language for *push back* and for *assert your own plot* look
   * similar from the outside, which is exactly why a pack can write one twice
   * without noticing.
   */
  it('does not say the same thing on both axes', () => {
    const texts = (levels: typeof FREEFORM_PRESET.difficultyLevels): string[] =>
      (levels ?? []).flatMap((level) => level.fragments.map((fragment) => fragment.text));
    const resistance = texts(FREEFORM_PRESET.difficultyLevels);
    const steering = texts(FREEFORM_PRESET.directednessLevels);

    expect(resistance.some((text) => steering.includes(text))).toBe(false);
  });

  /**
   * ***[13 §8.3]'s promise, as a block list.*** *"A preset carries a different
   * instruction block per kind with no new machinery, which is the `appliesTo`
   * filter doing the job it was built for."* Four kinds, four input blocks and
   * four instruction blocks, and not a line of code between them.
   */
  it('carries an input block and an instruction block for every kind it declares', () => {
    for (const kind of FREEFORM.inputs) {
      const blocks = FREEFORM_PRESET.blocks.filter((block) => block.appliesTo.includes(kind));
      expect(blocks.map((block) => block.id).sort(), kind).toEqual([
        `se.input.${kind}`,
        `se.instruction.${kind}`,
      ]);
    }
  });

  /**
   * *A `think` must not be reacted to*, which is the whole content of the kind
   * and the one thing a pack could get wrong in a way nothing else would catch.
   */
  /** An impersonation asks for what this forbids (2026-09-27). */
  it('names who each persona and actor block is about, as Scene’s does', () => {
    const named = FREEFORM_PRESET.blocks.filter(
      (block) =>
        block.kind === 'slot' && (block.source.of === 'persona' || block.source.of === 'actor'),
    );

    expect(named).toHaveLength(6);
    for (const block of named) {
      if (block.kind !== 'slot') continue;
      const who = block.source.of === 'persona' ? '{{ user }}' : '{{ char }}';
      expect(block.wrapper, block.id).toContain(who);
      expect(block.wrapper, block.id).toContain('{{content}}');
    }
  });

  it('keeps the narrator instruction to narration', () => {
    const instruction = FREEFORM_PRESET.blocks.find((block) => block.id === 'se.instruction');
    expect(instruction?.appliesTo).toEqual(['narrate']);
  });

  it('tells the narrator that a thought was not heard', () => {
    const block = FREEFORM_PRESET.blocks.find((one) => one.id === 'se.instruction.think');
    expect(block?.kind === 'text' ? block.template : '').toMatch(/nobody in the scene heard/i);
  });
});

describe('what this mode declares that Scene could not', () => {
  /**
   * ***[06 §9]'s *"define its own input kinds"*, which had no enforcement until
   * this phase.*** The declaration is what the turn route refuses against, so a
   * kind removed from here becomes a kind the server stops accepting.
   */
  it('accepts the four kinds [06 §1] names for it', () => {
    expect(FREEFORM.inputs).toEqual(['do', 'say', 'think', 'story']);
  });

  /**
   * *`choice` is deliberately absent.* A kind this mode declares is a kind a
   * player may submit at any time, and an unprompted *choice* with nothing to
   * choose between has no meaning.
   */
  it('does not accept a choice it has not offered', () => {
    expect(FREEFORM.inputs).not.toContain('choice');
  });

  /**
   * ***A party, which Scene's `select: 'fixed'` is the declaration against.***
   * [P7.3] made that arm mean *the cast cannot change as an outcome of a turn*,
   * and Freeform's whole shape is that it can.
   */
  it('selects speakers rather than seating one actor', () => {
    expect(FREEFORM.participants.select).toBe('natural');
    expect(FREEFORM.participants.maxActors).toBeGreaterThan(1);
  });

  /**
   * ***The dials, declared through the contract's builder*** — [04 §7]'s answer
   * arriving at its first real consumer. [P7.8] built the mechanism against a
   * fixture because *the mode that has a difficulty is Freeform*.
   */
  it('declares both dials, and declares them the way the SDK spells them', () => {
    const ids = FREEFORM.channels.map((channel) => channel.id);
    expect(ids).toContain(SE_DIFFICULTY);
    expect(ids).toContain(SE_DIRECTEDNESS);

    for (const channel of FREEFORM.channels) {
      if (channel.id !== SE_DIFFICULTY && channel.id !== SE_DIRECTEDNESS) continue;
      // Owned by the mode, which is the half that makes this its declaration
      // rather than the engine's.
      expect(channel.owner).toBe(FREEFORM_ID);
      expect(channel.update).toBe('user-only');
    }
  });

  /**
   * *The wizard step 9a is walked against* — *"a setup wizard for a mode the
   * engine has no knowledge of, rendered from its declaration alone"*. The
   * assertion a test can make is that the declaration is complete and that its
   * dial fields name level ids the pack actually ships, because that coupling is
   * the one the wizard's answers ride into `mode.config` on.
   */
  it('asks for what it needs before the first turn, in level ids the pack has', () => {
    expect(FREEFORM.setup.kind).toBe('declared');
    const fields = FREEFORM.setup.kind === 'declared' ? FREEFORM.setup.fields : [];
    expect(fields.map((field) => field.id)).toEqual(['premise', 'difficulty', 'directedness']);

    for (const axis of ['difficulty', 'directedness'] as const) {
      const field = fields.find((one) => one.id === axis);
      const offered = field?.widget.kind === 'choice' ? field.widget.options : [];
      const shipped = new Set(
        (axis === 'difficulty'
          ? FREEFORM_PRESET.difficultyLevels
          : FREEFORM_PRESET.directednessLevels
        )?.map((level) => level.id),
      );
      expect(offered.length, axis).toBeGreaterThan(0);
      for (const option of offered) expect(shipped.has(option.value), option.value).toBe(true);
    }
  });

  /**
   * ***The premise reaches the narrator*** (2026-09-30). The wizard requires
   * it and its hint promises *"The narrator opens from it"*; it was stored on
   * the session and slotted by nothing. And **every setup slot names a field
   * the wizard asks for**, so renaming a field cannot quietly leave a slot
   * reading an answer nobody gives.
   */
  it('slots the premise its wizard requires, and only answers it asks for', () => {
    const fields = FREEFORM.setup.kind === 'declared' ? FREEFORM.setup.fields : [];
    const slotted = FREEFORM_PRESET.blocks.flatMap((block) =>
      block.kind === 'slot' && block.source.of === 'setup' ? [block.source.field] : [],
    );

    expect(slotted).toEqual(['premise']);
    for (const field of slotted) {
      expect(
        fields.map((one) => one.id),
        field,
      ).toContain(field);
    }
  });

  /**
   * ***Declares no channel it cannot write*** — [25 C16], and the assertion is
   * written this way round on purpose.
   *
   * This mode wanted `se.freeform.input` — [06 §1]'s *world-state
   * classification* in its smallest true form — and could not have it: the
   * engine writes only two channels after the step loop and names both by id,
   * and `acceptEffect` refuses an `engine-computed` channel for a step. A
   * channel declared and never written is the placeholder shape
   * `ModeDefinition.channels` spent five stages demonstrating, so it was
   * withdrawn and the gap recorded. **This test is what would notice it coming
   * back before a writer does.**
   */
  it('declares nothing it has no way to write', () => {
    for (const channel of FREEFORM.channels) {
      expect(channel.update, channel.id).not.toBe('engine-computed');
    }
  });

  /**
   * ***The narration step is shaped exactly like Scene's, and that is the
   * finding.*** `contributes: 'messages'` with an empty `writes` is what yields
   * the `prose` purpose and admits the guidance block; one entry in `writes`
   * would abort every guidance-carrying turn ([06 §5.2]). A contract where the
   * second instance looks like the first is a contract that generalised.
   */
  it('narrates through a step that admits guidance', () => {
    expect(NARRATE.contributes).toBe('messages');
    expect(NARRATE.writes).toEqual([]);
    expect(NARRATE.role).toBe('prose');
  });

  /** Every step it declares has an implementation, which is what the loader checks. */
  it('implements every step it declares', () => {
    for (const step of FREEFORM.steps) {
      expect(typeof FREEFORM_MODE.run[step.id], step.id).toBe('function');
    }
  });
});

/**
 * ***The pacing dial has words at every setting*** —
 * [06 §6.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P11.5](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §6.1 splits the dial in two — *"Level → cadence, cooldown and patience is
 * engine code; the level's prose is the prompt pack's"* — and for four phases
 * only the engine half existed. **A pack missing a level is the failure that
 * looks like nothing**: `pacingLevel` returns null, the selector omits the
 * block, and the setting silently goes back to meaning only a cadence. There is
 * no screen on which that is visible, which is why it is a test.
 */
describe('the pacing prose this pack ships', () => {
  const ids = (FREEFORM_PRESET.pacingLevels ?? []).map((level) => level.id);

  it('has a level for every setting the dial offers', () => {
    expect(ids.sort()).toEqual(['aggressive', 'manual-only', 'normal', 'sparse']);
  });

  it('says something at each of them', () => {
    for (const level of FREEFORM_PRESET.pacingLevels ?? []) {
      expect(level.fragments.length, level.id).toBeGreaterThan(0);
      for (const fragment of level.fragments)
        expect(fragment.text.length, level.id).toBeGreaterThan(20);
    }
  });

  /**
   * ***`aggressive` must not reach railroading***, which is §6.1's own sentence
   * and the one way this prose can do real harm: *"The dial changes how often a
   * hook is **considered**. Guidance stays advisory at every setting and none of
   * them makes the narrator comply — otherwise the top of the dial is not brisk
   * pacing, it is the directedness [§7.3.2] spends a section refusing."*
   *
   * *A word list is a crude check and is the honest one available.* It cannot
   * read prose, so it watches for the vocabulary somebody reaches for when they
   * are writing an instruction rather than a disposition — and it is here
   * because the top of this dial is precisely where a later edit will be
   * tempted.
   */
  it('never tells the narrator to comply, at the top of the dial', () => {
    const brisk = (FREEFORM_PRESET.pacingLevels ?? []).find((level) => level.id === 'aggressive');
    const text = (brisk?.fragments ?? []).map((fragment) => fragment.text).join(' ');
    expect(text.length).toBeGreaterThan(0);
    for (const word of ['must ', 'always ', 'insist', 'ignore the player', 'regardless']) {
      expect(text.toLowerCase(), word).not.toContain(word);
    }
    // And the refusal it *should* carry: the player is still mid-something.
    expect(text.toLowerCase()).toContain('player');
  });
});
