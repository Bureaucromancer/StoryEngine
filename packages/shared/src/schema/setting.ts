// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

import {
  EmbeddedMedia,
  GeneratedMap,
  Id,
  LoreLink,
  Metadata,
  Openings,
  Provenance,
  Ref,
} from './common.js';
import { PlotHook } from './hook.js';

/**
 * Setting — docs/design/13-schemas.md §6.
 *
 * Carries tone, framing and *links* — never world facts. The rule that makes it
 * work: a Setting for Rain City does not describe Rain City. Locations are
 * lorebook entries; the cast links to real actors.
 *
 * **A Setting owns no lorebook.** It only links, which is what allows many
 * settings over one lorebook — a Rain City noir setting and a Rain City comedy
 * setting drawing on the same world. Ownership on delete also stops being a
 * question nobody wants to answer.
 */

export const SETTING_SCHEMA = 'storyengine.setting/1';

export const CastEntry = Type.Object(
  {
    ref: Ref,
    billing: Type.Union([
      Type.Literal('persona-option'),
      Type.Literal('party-option'),
      Type.Literal('npc'),
      Type.Literal('narrator-option'),
    ]),
    /** How this character is used *in this setting*. */
    note: Type.String(),
  },
  { title: 'CastEntry' },
);
export type CastEntry = Static<typeof CastEntry>;

export const SettingTone = Type.Object(
  {
    genres: Type.Array(Type.String()),
    moods: Type.Array(Type.String()),
    pov: Type.Union([Type.Literal('first'), Type.Literal('second'), Type.Literal('third')]),
    tense: Type.Union([Type.Literal('past'), Type.Literal('present')]),
    /**
     * **Advisory.** Authorial intent, not a promise about model behaviour
     * ([13 §6.2](docs/design/13-schemas.md)). Nothing in the engine gates on it:
     * no step refuses to run, no lorebook entry is withheld, no connection is
     * blocked — because enforcement here would be a promise that cannot be kept,
     * and making it badly is worse than not making it.
     *
     * `null` means *unspecified, ask the user*. Absent means the same, for
     * compatibility. **Neither means "sfw"** ([13 §2](docs/design/13-schemas.md)).
     */
    contentRating: Type.Union([Type.Literal('sfw'), Type.Literal('nsfw'), Type.Null()]),
    styleNotes: Type.String(),
  },
  { title: 'SettingTone' },
);
export type SettingTone = Static<typeof SettingTone>;

export const Setting = Type.Object(
  {
    schema: Type.Literal(SETTING_SCHEMA),
    id: Id,
    name: Type.String(),

    /** Library-card preview text. Never injected anywhere. */
    blurb: Type.String(),
    /**
     * The short "how this world is used here" piece. Injected every turn, and
     * therefore budgeted like anything else.
     */
    framing: Type.String(),

    tone: SettingTone,

    /** Where the world content actually lives. */
    lore: Type.Array(LoreLink),
    cast: Type.Array(CastEntry),
    openings: Openings,
    hooks: Type.Array(PlotHook),

    /**
     * Advisory only. A setting proposes a mode; it never configures production
     * settings ([00 §3.2](docs/design/00-stance.md)).
     */
    modeHints: Type.Object({
      modeId: Type.Optional(Type.String()),
      config: Type.Optional(Type.Unknown()),
    }),

    tags: Type.Array(Type.String()),
    media: Type.Array(EmbeddedMedia),
    provenance: Provenance,
    generated: GeneratedMap,
    metadata: Metadata,
  },
  {
    $id: `https://storyengine.dev/schemas/${SETTING_SCHEMA}.json`,
    title: 'Setting',
    description:
      'Deliberately absent: key locations, world description, NPC inline ' +
      'snapshots. A Setting owns no lorebook — it only links.',
  },
);
export type Setting = Static<typeof Setting>;
