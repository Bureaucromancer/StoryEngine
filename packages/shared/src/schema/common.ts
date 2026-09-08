// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

/**
 * The shared substructures, from docs/design/10-schemas.md §3.
 *
 * "Getting these right matters more than any individual entity, because a flaw
 * here appears everywhere."
 *
 * Two conventions hold across every schema in this directory, and both are
 * load-bearing rather than stylistic:
 *
 * **`additionalProperties` is never set.** JSON Schema's default is permissive,
 * and that default is the point — a reader must preserve fields written by a
 * newer version rather than reject or drop them (§2). Setting it to `false`
 * anywhere would strand people, and would do it invisibly until somebody
 * downgraded.
 *
 * **Closed unions are `enum`s; open ones are `string`.** §8.2 draws the line:
 * *a portable enum is a `string` with known values documented, not an `enum`,
 * unless the engine truly cannot proceed without understanding it.* Where a
 * union is left open here, the known values are in `examples` so tooling can
 * still offer them.
 */

/** ISO 8601. Never epoch milliseconds — §3. */
const Timestamp = Type.String({
  format: 'date-time',
  description: 'ISO 8601 timestamp. Never epoch milliseconds.',
});

/**
 * Ids are not pattern-constrained, deliberately.
 *
 * Ours are uuidv7, but an imported object arrives with whatever its source
 * minted and a `Ref` may point at one. Rejecting those would strand exactly the
 * data the import path exists to rescue ([00 §3.3](../../../../docs/design/00-stance.md)).
 */
const Id = Type.String({ minLength: 1 });

export const Ref = Type.Object(
  {
    id: Id,
    /** For display, and for name-fallback resolution when the id is unknown. */
    name: Type.String(),
    /**
     * Content hash at link time. Lets the UI say "this has changed since"
     * without blocking anything. Optional; absence is not an error.
     */
    fingerprint: Type.Optional(Type.String()),
  },
  {
    title: 'Ref',
    description:
      'A link to another object. Resolution order is always: exact id, then ' +
      'case-insensitive name, then show as missing and continue. Never blocks.',
  },
);
export type Ref = Static<typeof Ref>;

export const LoreLink = Type.Object(
  {
    ref: Ref,
    /**
     * When true, a consumer warns loudly if the lorebook cannot be resolved.
     * Still never blocks — the difference between "missing a nice extra" and
     * "missing its world" is worth saying out loud, and that is all this does.
     */
    required: Type.Boolean({ default: false }),
  },
  {
    title: 'LoreLink',
    description: 'A link to a lorebook, with a strength.',
  },
);
export type LoreLink = Static<typeof LoreLink>;

/**
 * The registry entries an object's tags point at — [25 §3](../../../../docs/design/25-tagging.md).
 *
 * **`tags` stays the readable copy and this is what identity runs on.** Both
 * exist because tag *names* are load-bearing in the engine: an entry's
 * `actorTagFilter` compares them exactly, and retrieval folds them into the text
 * lore keys are matched against. Replacing them with identifiers would stop
 * every imported gate matching, silently. So the file carries names for the
 * engine and for anybody reading it, and ids so a rename is one write rather
 * than a rewrite of everything the tag is on.
 *
 * **Used as `Type.Optional(TagIdList)`, and the absence means something `tags`
 * cannot say.** Elsewhere here an absent list and an empty one are deliberately
 * the same thing — see `EmbeddedMedia.tags` — but these differ: **absent means
 * this object predates the registry and has not been adopted**, empty means it
 * has no tags. Adoption happens on write, so an object nobody has saved since
 * the registry arrived goes on working from its names.
 *
 * Optional also keeps the addition additive: an older build ignores the field
 * and still reads correct tags, which is what makes it safe to add without a
 * version bump on five published schemas.
 */
export const TagIdList = Type.Array(Type.String({ minLength: 1 }));

export const Provenance = Type.Object(
  {
    source: Type.Union(
      [
        Type.Literal('manual'),
        Type.Literal('import'),
        Type.Literal('generated'),
        Type.Literal('package'),
        Type.Literal('session'),
      ],
      { default: 'manual' },
    ),
    creator: Type.Union([Type.String(), Type.Null()]),
    /** The author's own version string. Free text; not our schema version. */
    version: Type.Union([Type.String(), Type.Null()]),
    /**
     * The licence the *author* places on this content. Never inherited from the
     * application's licence — content is not a derivative work
     * ([triage §1.2](../../../../docs/design/workplan/02-triage.md)).
     */
    license: Type.Union([Type.String(), Type.Null()]),
    originalFilename: Type.Union([Type.String(), Type.Null()]),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  {
    title: 'Provenance',
    description: 'Where an object came from and who made it.',
  },
);
export type Provenance = Static<typeof Provenance>;

export const GeneratedFieldProvenance = Type.Object(
  {
    /** The generated value. JSON-encoded for non-string fields. */
    original: Type.String(),
    at: Timestamp,
    model: Type.Union([Type.String(), Type.Null()]),
    /** The input the generation ran from. */
    seed: Type.Union([Type.String(), Type.Null()]),
    /** False once a human has reviewed or edited it. */
    unreviewed: Type.Boolean(),
  },
  {
    title: 'GeneratedFieldProvenance',
    description:
      'Retained generated value for one field, so an edit can be reverted and ' +
      'the source disclosed. Keyed by dotted path in `generated`.',
  },
);
export type GeneratedFieldProvenance = Static<typeof GeneratedFieldProvenance>;

/** Per-field generation provenance, keyed by dotted path ("profile.appearance"). */
export const GeneratedMap = Type.Union([
  Type.Record(Type.String(), GeneratedFieldProvenance),
  Type.Null(),
]);

export const Opening = Type.Object(
  {
    id: Id,
    label: Type.String(),
    text: Type.String(),
    /** Author guidance. For a seed, this steers the expansion. */
    note: Type.Optional(Type.String()),
    /**
     * Set when this written opening was promoted from an expanded seed, so the
     * lineage is visible.
     */
    fromSeedId: Type.Optional(Type.String()),
  },
  { title: 'Opening' },
);
export type Opening = Static<typeof Opening>;

export const Openings = Type.Object(
  {
    written: Type.Array(Opening),
    seeds: Type.Array(Opening),
    /**
     * An ordered list plus a designated primary — not a `primary` field and an
     * `alternates` array. Reordering is then free and the first element is not
     * special.
     */
    primaryWrittenId: Type.Union([Type.String(), Type.Null()]),
    primarySeedId: Type.Union([Type.String(), Type.Null()]),
  },
  {
    title: 'Openings',
    description:
      'Two genuinely different things, so two lists rather than one with a ' +
      'flag: a written opening is content, a seed is an instruction.',
  },
);
export type Openings = Static<typeof Openings>;

/**
 * A piece of prose offered as an exemplar — *show, do not tell*.
 *
 * Everything else in these schemas that touches style **describes** it.
 * `Treatment.tone.styleNotes` says "terse, hardboiled"; `se.voice` is register
 * and verbal tics and is precise that it is not what a person sounds like
 * ([10 §4](../../../../docs/design/10-schemas.md)). A writing sample is the
 * other half: a short story from the setting, a page of a character's
 * narration, pasted whole and meant to be read as *this is the register*.
 *
 * The precedent is already in the corpus for pictures. [14 §2.4] separates a
 * style exemplar from a likeness because "style is a property of the
 * *production*, not the person" — the same character in ink wash and in
 * photoreal is still that character. This is that argument applied to prose,
 * which is why the three kinds that can carry one are the three that describe
 * production: the person, the world, and the stance on the world.
 *
 * **Not a Section, and this supersedes a standing decision.**
 * [02 §2.7] and [10 §4] route ST's `mes_example` to a `Section` with
 * `disposition: "on-demand"`, on the reasoning that the card is not a prompt
 * configuration file. That reasoning survives untouched — a sample is still
 * positioned and budgeted by a *slot*, never by the card. What did not survive
 * is the container: a Section has no priority, and [00 §2.6] requires every
 * block to be budgeted, with "never trim this" expressed as a priority value
 * rather than as the absence of a budget. A sample that could not carry its own
 * priority could not participate in the one rule the budgeter is built on.
 */
export const WritingSample = Type.Object(
  {
    id: Id,
    /** Names it for the author, in the editor and the block table. Never injected. */
    title: Type.String(),
    /** The prose itself. This is the only field that reaches a model. */
    body: Type.String(),
    /**
     * Off keeps a sample in the object without spending a turn on it. A deleted
     * sample is gone; a disabled one is a draft the author is still deciding
     * about, and conflating the two costs somebody their writing.
     */
    enabled: Type.Boolean(),
    /**
     * Budget priority, in the preset's own vocabulary ([10 §8.2]).
     *
     * Absent means *inherit the slot block's priority*, which is how every
     * other candidate already behaves — so the common case needs no number and
     * the author reaches for one only to rank samples against each other.
     */
    priority: Type.Optional(Type.Number()),
    /** Why this sample is here, for a person reading the object. Never injected. */
    note: Type.String(),
  },
  {
    title: 'WritingSample',
    description:
      'Prose offered as an exemplar of tone rather than a description of it. ' +
      'Carried by Actor, Treatment and Lorebook; positioned and budgeted by a ' +
      'preset slot, never injected merely by existing.',
  },
);
export type WritingSample = Static<typeof WritingSample>;

export const SourceRect = Type.Object(
  {
    x: Type.Number({ minimum: 0, maximum: 1 }),
    y: Type.Number({ minimum: 0, maximum: 1 }),
    width: Type.Number({ minimum: 0, maximum: 1 }),
    height: Type.Number({ minimum: 0, maximum: 1 }),
  },
  {
    title: 'SourceRect',
    description:
      'Normalised 0..1 rectangle of a source image. Normalised rather than ' +
      'pixels so it survives the source being resized or re-encoded.',
  },
);
export type SourceRect = Static<typeof SourceRect>;

export const VisualDescriptors = Type.Object(
  {
    face: Type.Optional(Type.String()),
    hair: Type.Optional(Type.String()),
    eyes: Type.Optional(Type.String()),
    build: Type.Optional(Type.String()),
    clothing: Type.Optional(Type.String()),
    accessories: Type.Optional(Type.String()),
    distinguishing: Type.Optional(Type.String()),
  },
  {
    title: 'VisualDescriptors',
    description:
      'Structured appearance for image and video pipelines. Prose `appearance` ' +
      'is for the narrator; this is for machines.',
  },
);
export type VisualDescriptors = Static<typeof VisualDescriptors>;

/**
 * Roles are typed from the start. A flat image list forecloses everything
 * downstream — an image pipeline must know which picture is the canonical
 * likeness.
 *
 * **One vocabulary, not one per kind.** `reference` means the same thing on a
 * lorebook entry as on an actor — *this is what it looks like*, suitable for
 * conditioning generation — which is what lets a later feature treat a
 * location's reference image the way it already treats an actor's
 * ([14 §3](../../../../docs/design/14-roadmap.md)). `map` is the only addition lore needed,
 * because a diagram is genuinely not a likeness. `illustration` was considered
 * and rejected as a synonym for `reference` that would leave authors guessing.
 */
export const MediaRole = Type.Union(
  [
    /** The uncropped original behind the card's own pixels. */
    Type.Literal('portrait-source'),
    /** Canonical likeness — of a person, or of a place. */
    Type.Literal('reference'),
    Type.Literal('expression'),
    Type.Literal('pose'),
    /** Style exemplar, not likeness. */
    Type.Literal('style'),
    /** A diagram rather than a likeness. Lore, mostly. */
    Type.Literal('map'),
    Type.Literal('gallery'),
  ],
  { title: 'MediaRole' },
);
export type MediaRole = Static<typeof MediaRole>;

export const EmbeddedMedia = Type.Object(
  {
    id: Id,
    role: MediaRole,
    mime: Type.String(),
    /**
     * Content hash of the bytes — `sha256:<hex>`. The identity of the blob, and
     * what makes duplicate media across a package store once.
     */
    digest: Type.String(),
    bytes: Type.Integer({ minimum: 0 }),
    /**
     * Where the container keeps it: a PNG chunk blob index, a zip entry path, or
     * a path relative to the object's folder. The container decides, and the
     * reader resolves it through the same envelope interface.
     */
    ref: Type.String(),
    label: Type.Optional(Type.String()),
    /**
     * Arbitrary, author-defined: "winter", "aerial", "concept art", "before the
     * fire", "by Mireille". The counterpart to `role`, and the division of
     * labour is the same one `ActorRole` and `Actor.tags` already make:
     *
     *     role — closed union. The engine reads it and acts on it.
     *     tags — open. Nothing in the engine branches on them.
     *
     * That split is what keeps the union small without costing authors
     * precision. A gallery of forty images needs finer notation than six roles
     * can carry, and every attempt to express that *through* the roles ends
     * with a union nobody can choose from.
     *
     * Required rather than optional, like `Actor.tags` and `Lorebook.tags`: an
     * absent list and an empty one would mean the same thing, and offering both
     * spellings of "none" is how writers and readers drift apart.
     */
    tags: Type.Array(Type.String()),
    width: Type.Optional(Type.Integer({ minimum: 0 })),
    height: Type.Optional(Type.Integer({ minimum: 0 })),
    crop: Type.Optional(SourceRect),
    generated: Type.Optional(GeneratedFieldProvenance),
  },
  {
    title: 'EmbeddedMedia',
    description:
      'A *reference* to bytes carried by the container, never the bytes ' +
      'themselves. The manifest form works in every container: a PNG private ' +
      'chunk, a zip entry, or a folder.',
  },
);
export type EmbeddedMedia = Static<typeof EmbeddedMedia>;

export const AssetRef = Type.Object(
  {
    path: Type.String(),
    role: MediaRole,
    label: Type.Optional(Type.String()),
  },
  {
    title: 'AssetRef',
    description:
      'Bulk asset, stored in the object’s folder. Always a relative path ' +
      'inside that folder — never absolute, never escaping it.',
  },
);
export type AssetRef = Static<typeof AssetRef>;

export const ModelHint = Type.Object(
  {
    role: Type.Union([
      Type.Literal('prose'),
      Type.Literal('fast'),
      Type.Literal('reasoning'),
      Type.Literal('vision'),
    ]),
    preferredModelIds: Type.Optional(Type.Array(Type.String())),
    note: Type.Optional(Type.String()),
  },
  {
    title: 'ModelHint',
    description:
      'A preference, never a binding. An imported card may express what it ' +
      'wants; it can never repoint anyone’s provider. Resolution is local.',
  },
);
export type ModelHint = Static<typeof ModelHint>;

/**
 * Namespaced by owning mode or extension. A mode may only read its own key;
 * unknown keys survive round trips untouched.
 */
export const ModeData = Type.Record(Type.String(), Type.Unknown());

/**
 * Unrecognised fields from an import, preserved verbatim so nothing is lost and
 * re-export is possible.
 */
export const Compat = Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]);

/** The general escape hatch that makes unknown-field preservation survivable. */
export const Metadata = Type.Record(Type.String(), Type.Unknown());

export { Id, Timestamp };
