// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

import {
  TagIdList,
  AssetRef,
  Compat,
  EmbeddedMedia,
  GeneratedMap,
  Id,
  ModeData,
  ModelHint,
  Openings,
  Provenance,
  Ref,
  SourceRect,
  VisualDescriptors,
  WritingSample,
} from './common.js';

/**
 * Actor — docs/design/10-schemas.md §4.
 *
 * One card type. Personas and NPCs are flags and tags, not separate types.
 */

export const ACTOR_SCHEMA = 'storyengine.actor/1';

/**
 * Genuinely open, and this is one of the two unions §8.2 singles out: *"in the
 * emitted JSON Schema it was a hard `enum`, which would have rejected a
 * perfectly good file from a newer build."* Known values are documented; the
 * type is a string.
 */
export const ActorRole = Type.String({
  title: 'ActorRole',
  description:
    'Advisory flag, not a type. Any actor may be chosen as persona; the flag ' +
    'controls what pickers offer first. Open — a newer build may write a value ' +
    'this one has not heard of, and that must round-trip rather than fail.',
  examples: ['persona', 'narrator'],
});
export type ActorRole = Static<typeof ActorRole>;

/**
 * Reserved section ids ([10 §4](../../../../docs/design/10-schemas.md)). "Conventional" is
 * enforced by the editor, by generation, and by the default preset — never by
 * this schema. Structurally nothing prevents a user deleting one, and missing
 * must mean empty rather than an error.
 */
export const CONVENTIONAL_SECTION_IDS = {
  /** The always-present core. Short by design. */
  summary: 'se.summary',
  /** Prose appearance, for the narrator. Distinct from `visual`. */
  appearance: 'se.appearance',
  /** Register, verbal tics, how they talk — not what they sound like. */
  voice: 'se.voice',
  /** History. */
  background: 'se.background',
} as const;

/** The `se.` section-id namespace is reserved ([work plan §2](../../../../docs/design/workplan/01-work-plan.md)). */
export const RESERVED_SECTION_PREFIX = 'se.';

export const Section = Type.Object(
  {
    /**
     * Stable. Presets and modes address blocks by this. Ids in the `se.`
     * namespace are reserved; author-defined sections must not use it.
     */
    id: Id,
    title: Type.String(),
    body: Type.String(),
    disposition: Type.Union([
      Type.Literal('always'),
      Type.Literal('on-demand'),
      Type.Literal('reference-only'),
    ]),
  },
  { title: 'Section' },
);
export type Section = Static<typeof Section>;

export const ActorProfile = Type.Object(
  {
    /**
     * Structured appearance, for image pipelines. A real field, not a section:
     * it is not prose and nothing renders it as a block.
     */
    visual: Type.Union([VisualDescriptors, Type.Null()]),
    traits: Type.Array(Type.String()),
    /** Everything prose. Includes the four conventional sections. */
    sections: Type.Array(Section),
  },
  { title: 'ActorProfile' },
);
export type ActorProfile = Static<typeof ActorProfile>;

export const Actor = Type.Object(
  {
    schema: Type.Literal(ACTOR_SCHEMA),
    id: Id,
    name: Type.String(),
    /** Also the default keyword set for lore matching. */
    aliases: Type.Array(Type.String()),
    /** Never inferred from the name. null means unknown, not "they". */
    pronouns: Type.Union([Type.String(), Type.Null()]),

    roles: Type.Array(ActorRole),
    /** "npc" lives here. Nothing in the engine branches on it. */
    tags: Type.Array(Type.String()),
    /** See {@link TagIdList} — the registry side of `tags`. */
    tagIds: Type.Optional(TagIdList),

    profile: ActorProfile,
    openings: Openings,
    /**
     * Prose written *as* this person, offered as an exemplar — §WritingSample.
     *
     * **Top-level rather than under `profile`, and beside `openings` on
     * purpose.** `profile` is what someone is like; a sample is a demonstration
     * of how they are written, which [14 §2.4] classes as production rather
     * than identity. `openings` is the existing field with exactly that
     * character — prose that shows rather than states — so the two belong
     * together.
     *
     * Optional because it is additive: a card written before this field existed
     * must still validate, which [10 §2] makes the price of not bumping to
     * `/2`. Absent and empty mean the same thing here, deliberately — there is
     * no "this character has declined to have samples" to express.
     */
    writingSamples: Type.Optional(Type.Array(WritingSample)),
    /** Linked lorebooks, not embedded. */
    lore: Type.Array(Ref),

    /** Travels inside the card. */
    media: Type.Array(EmbeddedMedia),
    /** Bulk, travels with the folder. */
    assets: Type.Array(AssetRef),
    /**
     * Crop applied to produce the card's own pixels. The source is retained in
     * `media` with role "portrait-source", so re-cropping is lossless.
     */
    portraitCrop: Type.Union([SourceRect, Type.Null()]),

    modelHint: Type.Union([ModelHint, Type.Null()]),
    modeData: ModeData,

    provenance: Provenance,
    generated: GeneratedMap,
    compat: Compat,
  },
  {
    $id: `https://storyengine.dev/schemas/${ACTOR_SCHEMA.replace('/', '.')}.json`,
    title: 'Actor',
    description:
      'A character. Deliberately absent: system_prompt, ' +
      'post_history_instructions, depth_prompt, talkativeness and scenario. ' +
      'Prompt assembly is owned by the preset and the mode, not by the ' +
      'description of a person. mes_example is no longer among them: it lands ' +
      'in writingSamples, which a preset slot still positions and budgets, so ' +
      'the rule holds and only the container changed. Per-session numbers live ' +
      'in channels and must never appear here.',
  },
);
export type Actor = Static<typeof Actor>;
