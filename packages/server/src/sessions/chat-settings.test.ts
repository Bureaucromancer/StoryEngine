// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeAll, describe, expect, it } from 'vitest';

import type { ModeDefinition } from '@storyengine/sdk';

import { installBuiltIns } from '../mode-loader.js';
import { DEFAULT_MODE_ID, modeById } from '../mode-registry.js';
import { TEST_MODE_DEFINITION } from '../test-mode.js';
import {
  chatSettingsAtCreation,
  chatSettingsOf,
  noteDue,
  SPEAKER_DEFAULTS,
} from './chat-settings.js';

/**
 * ***What a session plays as, and what a session from before P14.0 still
 * plays as*** —
 * [P14 §1.2](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [P14.0].
 *
 * The case that costs somebody their story is the second: a mode whose
 * declared values moved, and a session written before they did. So the fixture
 * mode below has **already moved** — it declares P14's Scene values and
 * carries the old ones as `legacy` — which is the only arrangement in which
 * reading the wrong one shows up as a wrong answer rather than the same one.
 */

/** A mode whose declared values have moved on from what it used to be played as. */
const MOVED: ModeDefinition = {
  ...TEST_MODE_DEFINITION,
  voice: 'embodied',
  dispatch: 'per-actor',
  participants: { select: 'natural', maxActors: 32 },
  legacy: { voice: 'narrator', dispatch: 'merged', select: 'fixed' },
};

/** The same mode, never having declared what it used to be. */
const UNMARKED: ModeDefinition = { ...MOVED };
delete UNMARKED.legacy;

const DEFAULT_SPEAKERS = { ...SPEAKER_DEFAULTS };

describe('which values a session reads', () => {
  it('takes a field the session carries over anything the mode says', () => {
    const settings = chatSettingsOf(
      {
        voice: 'narrator',
        dispatch: 'merged',
        speakers: {
          policy: 'list',
          allowSelfResponses: true,
          namesInHistory: 'always',
          maxPerRound: 5,
        },
      },
      MOVED,
    );

    expect(settings.voice).toBe('narrator');
    expect(settings.dispatch).toBe('merged');
    expect(settings.speakers).toEqual({
      policy: 'list',
      allowSelfResponses: true,
      namesInHistory: 'always',
      maxPerRound: 5,
    });
  });

  /**
   * ***The one that re-voices somebody's saved game if it is wrong.*** None of
   * the three is present, which is every session written before creation began
   * writing them — so it reads what the mode used to declare.
   */
  it('reads a session with none of the three as the mode’s legacy values', () => {
    const settings = chatSettingsOf({ id: 's-1', name: 'Rain City' }, MOVED);

    expect(settings.voice).toBe('narrator');
    expect(settings.dispatch).toBe('merged');
    expect(settings.speakers).toEqual({ policy: 'fixed', ...DEFAULT_SPEAKERS });
  });

  it('reads the declared values when the mode never said what it used to be', () => {
    const settings = chatSettingsOf({ id: 's-1' }, UNMARKED);

    expect(settings.voice).toBe('embodied');
    expect(settings.dispatch).toBe('per-actor');
    expect(settings.speakers.policy).toBe('natural');
  });

  /**
   * *One field present makes the session a modern one*, and the other two fall
   * to the **declared** values rather than the legacy ones — the era is a fact
   * about the file, and a file with any of these keys was written since.
   */
  it('reads the rest from the declared values once any of the three is present', () => {
    const settings = chatSettingsOf({ voice: 'narrator' }, MOVED);

    expect(settings.voice).toBe('narrator');
    expect(settings.dispatch).toBe('per-actor');
    expect(settings.speakers.policy).toBe('natural');
  });

  /**
   * ***The Scene that ships, and the other half of P14.0's *Ends at*.*** Read
   * through the registry rather than a fixture, so it is the mode a real
   * session resolves.
   */
  describe('a Scene session from before P14.0', () => {
    beforeAll(async () => {
      await installBuiltIns();
    });

    it('reads as narrator, merged, fixed', () => {
      const scene = modeById(DEFAULT_MODE_ID);
      if (scene === null) throw new Error('Scene is not registered');

      const settings = chatSettingsOf({ id: 's-1', name: 'Before' }, scene.definition);

      expect([settings.voice, settings.dispatch, settings.speakers.policy]).toEqual([
        'narrator',
        'merged',
        'fixed',
      ]);
    });

    /**
     * ***Now that the values moved*** — [P14.3] flipped Scene to an embodied,
     * per-actor, natural chat, and this is the flip's whole safety argument
     * run against the mode that ships: an old file is still narrated, a file
     * made between P14.0 and the flip keeps the narrator values creation wrote
     * into it, and only a session made from now on is a chat.
     */
    it('keeps every earlier session narrated after Scene became a chat', () => {
      const scene = modeById(DEFAULT_MODE_ID);
      if (scene === null) throw new Error('Scene is not registered');
      expect(scene.definition.voice).toBe('embodied');

      const between = {
        id: 's-2',
        voice: 'narrator',
        dispatch: 'merged',
        speakers: { policy: 'fixed', ...DEFAULT_SPEAKERS },
      };
      const now = { id: 's-3', ...chatSettingsAtCreation(scene.definition) };
      const read = (file: unknown) => {
        const settings = chatSettingsOf(file, scene.definition);
        return [settings.voice, settings.dispatch, settings.speakers.policy];
      };

      expect(read({ id: 's-1' })).toEqual(['narrator', 'merged', 'fixed']);
      expect(read(between)).toEqual(['narrator', 'merged', 'fixed']);
      expect(read(now)).toEqual(['embodied', 'per-actor', 'natural']);
    });
  });
});

/**
 * ***When the author's note is placed*** — `noteDue`, [P14.3], transcribed
 * from SillyTavern's `setFloatingPrompt` (`authors-note.js:324-392`): the count
 * is the player's messages including the one being answered.
 */
describe('the author’s note, by interval', () => {
  const note = (every: number) => ({ text: 'Keep it tense.', depth: 2, every });

  it('places an interval of 1 on every input, the first included', () => {
    for (const inputs of [0, 1, 2, 7]) {
      expect(noteDue(note(1), inputs), String(inputs)).toEqual({
        text: 'Keep it tense.',
        depth: 2,
      });
    }
  });

  it('places an interval of 3 on the 3rd, 6th and 9th input only', () => {
    const placed = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => noteDue(note(3), n) !== null);
    expect(placed).toEqual([3, 6, 9]);
  });

  it('places nothing for a note switched off, or for no note', () => {
    expect(noteDue(note(0), 3)).toBeNull();
    expect(noteDue(null, 3)).toBeNull();
  });
});

describe('a session made now', () => {
  /**
   * *The declared values, never the legacy ones*: those describe old files, and
   * a session made today is not one. Written explicitly, which is what makes
   * *none of the three* mean *made before P14.0*.
   */
  it('is created with the mode’s declared values, all three written down', () => {
    expect(chatSettingsAtCreation(MOVED)).toEqual({
      voice: 'embodied',
      dispatch: 'per-actor',
      speakers: { policy: 'natural', ...DEFAULT_SPEAKERS },
    });
  });

  it('keeps those values when the mode’s declaration moves afterwards', () => {
    const made = chatSettingsAtCreation(UNMARKED);
    const later: ModeDefinition = {
      ...UNMARKED,
      voice: 'narrator',
      dispatch: 'merged',
      participants: { select: 'list', maxActors: 32 },
      legacy: { voice: 'narrator', dispatch: 'merged', select: 'fixed' },
    };

    const settings = chatSettingsOf(made, later);
    expect([settings.voice, settings.dispatch, settings.speakers.policy]).toEqual([
      'embodied',
      'per-actor',
      'natural',
    ]);
  });
});

/**
 * ***A malformed field falls to its default*** — `readMemoryConfig`'s posture,
 * because `session.json` is hand-editable by design and a session somebody
 * mistyped must still open.
 */
describe('a file somebody edited by hand', () => {
  it('falls back field by field, and never throws', () => {
    const settings = chatSettingsOf(
      {
        voice: 'Embodied',
        dispatch: 7,
        speakers: {
          policy: 'loudest',
          allowSelfResponses: 'yes',
          namesInHistory: 'sometimes',
          maxPerRound: 2.5,
        },
        note: { text: 42, depth: 1, every: 1 },
        hidden: 'all of it',
        prompts: ['instruction'],
      },
      MOVED,
    );

    expect(settings).toEqual({
      voice: 'embodied',
      dispatch: 'per-actor',
      speakers: { policy: 'natural', ...DEFAULT_SPEAKERS },
      note: null,
      hidden: {},
      prompts: { instruction: true, cards: {} },
    });
  });

  it('fills a partial speakers object from the defaults, keeping what it says', () => {
    expect(chatSettingsOf({ speakers: { policy: 'pooled' } }, MOVED).speakers).toEqual({
      policy: 'pooled',
      ...DEFAULT_SPEAKERS,
    });
    expect(chatSettingsOf({ speakers: { allowSelfResponses: true } }, MOVED).speakers).toEqual({
      ...DEFAULT_SPEAKERS,
      policy: 'natural',
      allowSelfResponses: true,
    });
  });

  /**
   * ***`smart` is a policy a session may hold since [P14.1]***, which built
   * its arm — before that a file naming it fell to the default, because a
   * vocabulary with no implementation behind it would have been a promise the
   * record could not keep. `fixed` stays readable beside it: a pre-P14 Scene
   * session reads as `fixed`, and one written down says so.
   */
  it('reads smart order, and still reads fixed', () => {
    expect(chatSettingsOf({ speakers: { policy: 'smart' } }, MOVED).speakers.policy).toBe('smart');
    expect(chatSettingsOf({ speakers: { policy: 'fixed' } }, MOVED).speakers.policy).toBe('fixed');
    expect(chatSettingsOf({ speakers: { policy: 'clever' } }, MOVED).speakers.policy).toBe(
      'natural',
    );
  });

  it('keeps a note’s text when its depth or interval is unusable', () => {
    expect(chatSettingsOf({ note: { text: 'Keep it tense.', depth: -1 } }, MOVED).note).toEqual({
      text: 'Keep it tense.',
      depth: 4,
      every: 1,
    });
    expect(
      chatSettingsOf({ note: { text: 'Keep it tense.', depth: 0, every: 3 } }, MOVED).note,
    ).toEqual({ text: 'Keep it tense.', depth: 0, every: 3 });
    expect(
      chatSettingsOf({ note: { text: 'Keep it tense.', every: 2.5 } }, MOVED).note?.every,
    ).toBe(1);
  });

  /**
   * ***An interval of 0 or less is SillyTavern's "disabled"*** —
   * `note_interval <= 0`, *"0 = Disable, 1 = Always"* — and [P14 §2.6] copies
   * it across as it is. The falsifying mutation is the old reading, which took
   * it for malformed and put the note on every input: the opposite of what it
   * says. Switched off, not dropped: the text is still there to switch back on.
   */
  it('reads an interval of 0 or less as a note switched off, text kept', () => {
    for (const every of [0, -2]) {
      expect(chatSettingsOf({ note: { text: 'x', every } }, MOVED).note, String(every)).toEqual({
        text: 'x',
        depth: 4,
        every: 0,
      });
    }
    // And a missing one is still every input, not off.
    expect(chatSettingsOf({ note: { text: 'x' } }, MOVED).note?.every).toBe(1);
  });

  /**
   * *Entry by entry*: one broken entry has not unhidden the rest, and an index
   * that is not one is dropped rather than taken as the whole turn.
   */
  it('keeps every usable hidden entry and drops the rest', () => {
    expect(
      chatSettingsOf(
        {
          hidden: {
            'turn-a': true,
            'turn-b': [0, 2],
            'turn-c': [1, -1, 'two', 1.5],
            'turn-d': 'yes',
            'turn-e': [],
          },
        },
        MOVED,
      ).hidden,
    ).toEqual({ 'turn-a': true, 'turn-b': [0, 2], 'turn-c': [1] });
  });

  it('switches off only what says false, and only the card parts it knows', () => {
    expect(
      chatSettingsOf(
        {
          prompts: {
            instruction: false,
            cards: {
              'actor-a': false,
              'actor-b': ['system', 'lorebook', 'depth'],
              'actor-c': true,
              'actor-d': ['nothing-known'],
            },
          },
        },
        MOVED,
      ).prompts,
    ).toEqual({
      instruction: false,
      cards: { 'actor-a': false, 'actor-b': ['system', 'depth'] },
    });
    // Anything but `false` is the instruction left on.
    expect(chatSettingsOf({ prompts: { instruction: 'no' } }, MOVED).prompts.instruction).toBe(
      true,
    );
  });

  it('reads something that is not a session at all as a session that says nothing', () => {
    expect(chatSettingsOf(null, MOVED)).toEqual(chatSettingsOf({}, MOVED));
    expect(chatSettingsOf({}, MOVED)).toMatchObject({ voice: 'narrator', note: null });
  });
});
