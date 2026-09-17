// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { ACTOR_SCHEMA, CONVENTIONAL_SECTION_IDS, type Actor } from '@storyengine/shared';

/**
 * ***The default assistant card*** —
 * [06 §7.4](../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P11.3](../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §7.4: *"The default assistant card ships as an ordinary actor in the library,
 * editable and replaceable like any other."*
 *
 * ***It ships from here rather than from the mode package, and the split is
 * §7.4's own.*** *"Capabilities belong to the mode, personality to the card…
 * Swapping the assistant's card changes how it talks and nothing else."* A
 * personality shipped **inside** the mode would be the two halves back in one
 * file, which is the arrangement that makes swapping the card a code change.
 *
 * ***And nothing on it names the assistant mode.*** That is the test of whether
 * the split is real: this is an ordinary actor, it is in the shelf beside every
 * other one, and pointing a story session at it produces a strange but working
 * character. §7.4 says so explicitly — *"point it at a roleplay character for
 * fun and it still works"* — and the same sentence read backwards is that this
 * card must work in the other direction too.
 *
 * ***A fixed id, for `materialiseModePresets`' first rule.*** *"The id is the
 * mode's and is stable across restarts… an object whose id moved would orphan"*
 * every session that named it — here, every assistant session anybody has ever
 * opened.
 *
 * *The sections are the conventional four, three of them empty.* An assistant
 * has a summary and no appearance, and writing something into the other three
 * for symmetry would be putting words in a prompt to make a file look tidy.
 */

/** Fixed, so a restart writes the same bytes and the no-op rule holds. */
const STAMP = '2026-01-01T00:00:00.000Z';

export const ASSISTANT_CARD_ID = '0199c000-0000-7000-8000-00000000a552';

export const ASSISTANT_CARD: Actor = {
  schema: ACTOR_SCHEMA,
  id: ASSISTANT_CARD_ID,
  name: 'Assistant',
  aliases: [],
  pronouns: 'they/them',
  roles: [],
  tags: [],
  profile: {
    visual: null,
    traits: [],
    sections: [
      {
        id: CONVENTIONAL_SECTION_IDS.summary,
        title: 'Summary',
        body: [
          'Practical, direct, and honest about the edges of what it knows. It answers',
          'the question that was asked rather than the one it would rather answer, and',
          'says plainly when something is not possible in this build instead of',
          'describing a setting that does not exist.',
          '',
          'It writes in short paragraphs. When a change is worth making it says what to',
          'change and why, in one or two sentences, rather than producing a wall of',
          'options.',
        ].join('\n'),
        disposition: 'always',
      },
      {
        id: CONVENTIONAL_SECTION_IDS.appearance,
        title: 'Appearance',
        body: '',
        disposition: 'always',
      },
      { id: CONVENTIONAL_SECTION_IDS.voice, title: 'Voice', body: '', disposition: 'always' },
      {
        id: CONVENTIONAL_SECTION_IDS.background,
        title: 'Background',
        body: '',
        disposition: 'on-demand',
      },
    ],
  },
  openings: { written: [], seeds: [], primaryWrittenId: null, primarySeedId: null },
  writingSamples: [],
  lore: [],
  media: [],
  assets: [],
  portraitCrop: null,
  modelHint: null,
  modeData: {},
  provenance: {
    source: 'manual',
    creator: null,
    version: null,
    license: null,
    originalFilename: null,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  generated: null,
  compat: null,
};
