// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

import {
  TagIdList,
  EmbeddedMedia,
  GeneratedMap,
  Id,
  LoreLink,
  Metadata,
  Openings,
  Provenance,
  Ref,
  WritingSample,
} from './common.js';
import { PlotHook } from './hook.js';

/**
 * Treatment — docs/design/10-schemas.md §6.
 *
 * Carries tone, framing and *links* — never world facts. The rule that makes it
 * work: a Treatment of Rain City does not describe Rain City. Locations are
 * lorebook entries; the cast links to real actors.
 *
 * **Named for what it holds, not for what it points at.** *Setting*, *World*
 * and *Scenario* all name the material; this object is the stance on material,
 * which is why every one of them invited the misreading the invariant above
 * exists to forbid. A lorebook is the world; a treatment is how it is handled
 * here. (`Setting` was also one case-fold away from the configuration surface.)
 *
 * **A Treatment owns no lorebook.** It only links, which is what allows many
 * treatments over one lorebook — a Rain City noir and a Rain City comedy
 * drawing on the same world. Ownership on delete also stops being a question
 * nobody wants to answer.
 */

export const TREATMENT_SCHEMA = 'storyengine.treatment/1';

export const CastEntry = Type.Object(
  {
    ref: Ref,
    billing: Type.Union([
      Type.Literal('persona-option'),
      Type.Literal('party-option'),
      Type.Literal('npc'),
      Type.Literal('narrator-option'),
    ]),
    /** How this character is used *in this treatment*. */
    note: Type.String(),
  },
  { title: 'CastEntry' },
);
export type CastEntry = Static<typeof CastEntry>;

export const TreatmentTone = Type.Object(
  {
    genres: Type.Array(Type.String()),
    moods: Type.Array(Type.String()),
    pov: Type.Union([Type.Literal('first'), Type.Literal('second'), Type.Literal('third')]),
    tense: Type.Union([Type.Literal('past'), Type.Literal('present')]),
    /**
     * **Advisory.** Authorial intent, not a promise about model behaviour
     * ([10 §6.2](../../../../docs/design/10-schemas.md)). Nothing in the engine gates on it:
     * no step refuses to run, no lorebook entry is withheld, no connection is
     * blocked — because enforcement here would be a promise that cannot be kept,
     * and making it badly is worse than not making it.
     *
     * `null` means *unspecified, ask the user*. Absent means the same, for
     * compatibility. **Neither means "sfw"** ([10 §2](../../../../docs/design/10-schemas.md)).
     */
    contentRating: Type.Union([Type.Literal('sfw'), Type.Literal('nsfw'), Type.Null()]),
    styleNotes: Type.String(),
  },
  { title: 'TreatmentTone' },
);
export type TreatmentTone = Static<typeof TreatmentTone>;

export const Treatment = Type.Object(
  {
    schema: Type.Literal(TREATMENT_SCHEMA),
    id: Id,
    name: Type.String(),

    /** Library-card preview text. Never injected anywhere. */
    blurb: Type.String(),
    /**
     * The short "how this world is used here" piece. Injected every turn, and
     * therefore budgeted like anything else.
     */
    framing: Type.String(),

    tone: TreatmentTone,
    /**
     * Prose from this world, offered as an exemplar — §WritingSample.
     *
     * **The demonstrative twin of `tone.styleNotes`**, and the reason both
     * exist: `styleNotes` says "terse, hardboiled, present tense", which a model
     * must interpret; a sample is a page of the thing itself, which it can
     * imitate. Neither replaces the other, and an author with only one of them
     * is not doing it wrong.
     *
     * This is also the field that keeps the §6 invariant honest under pressure.
     * A Treatment of Rain City still does not *describe* Rain City — a sample
     * demonstrates how Rain City is written, and world facts stay in the linked
     * lorebook where a second treatment can disagree with them.
     */
    writingSamples: Type.Optional(Type.Array(WritingSample)),

    /** Where the world content actually lives. */
    lore: Type.Array(LoreLink),
    cast: Type.Array(CastEntry),
    openings: Openings,
    hooks: Type.Array(PlotHook),

    /**
     * Advisory only. A treatment proposes a mode; it never configures production
     * settings ([00 §3.2](../../../../docs/design/00-stance.md)).
     */
    modeHints: Type.Object({
      modeId: Type.Optional(Type.String()),
      config: Type.Optional(Type.Unknown()),
    }),

    tags: Type.Array(Type.String()),
    /** See {@link TagIdList} — the registry side of `tags`. */
    tagIds: Type.Optional(TagIdList),
    media: Type.Array(EmbeddedMedia),
    provenance: Provenance,
    generated: GeneratedMap,
    metadata: Metadata,
  },
  {
    $id: `https://storyengine.dev/schemas/${TREATMENT_SCHEMA.replace('/', '.')}.json`,
    title: 'Treatment',
    description:
      'Deliberately absent: key locations, world description, NPC inline ' +
      'snapshots. A Treatment owns no lorebook — it only links.',
  },
);
export type Treatment = Static<typeof Treatment>;
