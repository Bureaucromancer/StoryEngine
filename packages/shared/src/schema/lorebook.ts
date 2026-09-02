// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

import { banner } from './banners.js';

import {
  AssetRef,
  EmbeddedMedia,
  GeneratedMap,
  Id,
  Metadata,
  Provenance,
  WritingSample,
} from './common.js';
import { PlotHook } from './hook.js';

/**
 * Lorebook — docs/design/10-schemas.md §5.
 *
 * Entry activation is taken from Marinara close to unchanged, because it is a
 * decade of empirical tuning and it is the interchange format. The changes are
 * five, all scoped: the collapsed scope union, folders, the extension
 * activation hook, `stateSchema`, and images (§5.1).
 *
 * **The comment banners over `LoreEntry`'s field groups are annotations now**,
 * not comments — see [banners.ts](./banners.ts). [05 §11.2d] builds the entry
 * editor's disclosures from them and [05 §5.3] renders the same groups in the
 * book page's read-only fold, and a comment cannot be read at runtime, so the
 * grouping would otherwise have had to be written down a second time. The
 * banner sits on the field that opens each group, which is where the comment
 * sat, so a field added under one joins it with no second edit.
 *
 * Images are the one addition that is new territory rather than a port —
 * Marinara carries a single `imagePath` per book and SillyTavern's World Info
 * has none — which is why the rule that they *do not activate* is stated on the
 * field itself rather than left to this header.
 */

export const LOREBOOK_SCHEMA = 'storyengine.lorebook/1';

/**
 * One mechanism, three behaviours, mutual exclusion by construction. Replaces
 * `characterId` + `characterIds` + `personaId` + `personaIds` + `chatId` +
 * `isGlobal` + `scope`, and the save-time rule that kept them consistent.
 *
 * **Session scoping is deliberately not here.** Session ids are install-local,
 * so a shared lorebook carrying them exports identifiers that are meaningless
 * everywhere else — noise on import at best, and a false resolution against an
 * unrelated local session at worst. "This lorebook applies to this session" is a
 * fact about the *session*, so it lives on the session's own lore links.
 *
 * **Nothing reads this field, and that is the current decision rather than an
 * omission.** [P5.7] made it decide which books a session scanned; the
 * behaviour was reversed immediately after, because `global` is this factory's
 * default *and* the SillyTavern importer's fallback, so every book a person had
 * ever created or imported was in every session's prompt. The rule now is that
 * **no lorebook is active that has not been selected for the session** —
 * `session.lore`, or the treatment the session names. A field cannot volunteer.
 *
 * The union stays because it is what the format carries and what an import has
 * to preserve; a book that says *global* keeps saying it, and a person who
 * exports one gets back what they put in. What it does not do is select. If
 * something above the session ever contributes books — a Worlds concept, with
 * inheritance — that is the shape that would give this field a consumer again,
 * and it should be designed rather than inferred from the union's wording.
 */
export const LoreScope = Type.Union(
  [
    Type.Object({ kind: Type.Literal('global') }),
    /** Personas are actors, so this is one list rather than two. */
    Type.Object({ kind: Type.Literal('linked'), actorIds: Type.Array(Type.String()) }),
  ],
  { title: 'LoreScope' },
);
export type LoreScope = Static<typeof LoreScope>;

export const LoreFolder = Type.Object(
  {
    id: Id,
    name: Type.String(),
    parentFolderId: Type.Union([Type.String(), Type.Null()]),
    /**
     * A gate: when false every entry inside is inactive regardless of its own
     * `enabled`, which is preserved rather than mutated.
     */
    enabled: Type.Boolean(),
    order: Type.Number(),
  },
  { title: 'LoreFolder' },
);
export type LoreFolder = Static<typeof LoreFolder>;

export const LoreFilter = Type.Object(
  {
    mode: Type.Union([Type.Literal('any'), Type.Literal('include'), Type.Literal('exclude')]),
    values: Type.Array(Type.String()),
  },
  { title: 'LoreFilter' },
);
export type LoreFilter = Static<typeof LoreFilter>;

const NullableFilter = Type.Union([LoreFilter, Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);

export const LoreEntry = Type.Object(
  {
    id: Id,
    name: Type.String(),
    content: Type.String(),
    /**
     * Read only by a knowledge-router step to judge relevance. Never injected as
     * content.
     */
    description: Type.String(),

    keys: Type.Array(Type.String(), banner('Matching')),
    secondaryKeys: Type.Array(Type.String()),
    selectiveLogic: Type.Union([
      Type.Literal('and_any'),
      Type.Literal('and_all'),
      Type.Literal('not_any'),
      Type.Literal('not_all'),
    ]),
    selective: Type.Boolean(),
    matchWholeWords: Type.Boolean(),
    caseSensitive: Type.Boolean(),
    /** Patterns run under a hard execution timeout ([triage §5.1](../../../../docs/design/workplan/02-triage.md)). */
    useRegex: Type.Boolean(),
    /** null = inherit from the book. */
    scanDepth: NullableNumber,

    enabled: Type.Boolean(banner('Firing')),
    /** Fires whenever the book is active. */
    constant: Type.Boolean(),
    /** 0..100; null = always. */
    probability: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),

    /**
     * Stay active N messages after firing.
     *
     * Spelled out where its three siblings share `NullableNumber`, because the
     * banner hangs on the field that opens the group and a shared constant
     * would carry it onto every field that borrowed it.
     */
    sticky: Type.Union(
      [Type.Number(), Type.Null()],
      banner('Timing', 'Four distinct behaviours, not four takes on one.'),
    ),
    /** Wait N messages between firings. */
    cooldown: NullableNumber,
    /** Do not fire until N messages in. */
    delay: NullableNumber,
    /** Auto-disable after N firings. */
    ephemeral: NullableNumber,

    position: Type.Union(
      [
        Type.Literal('before_char'),
        Type.Literal('after_char'),
        Type.Literal('at_depth'),
        Type.Literal('outlet'),
      ],
      banner('Placement'),
    ),
    /**
     * Exact, case-sensitive, for `{{outlet::name}}`. Decouples "this activated"
     * from "this gets pasted here".
     */
    outletName: Type.Union([Type.String(), Type.Null()]),
    depth: Type.Number(),
    /** Lower = earlier. */
    order: Type.Number(),
    role: Type.Union([Type.Literal('system'), Type.Literal('user'), Type.Literal('assistant')]),

    /** Only one of a group fires. */
    group: Type.Union([Type.String(), Type.Null()], banner('Grouping and gating')),
    groupWeight: NullableNumber,
    folderId: Type.Union([Type.String(), Type.Null()]),
    actorFilter: NullableFilter,
    actorTagFilter: NullableFilter,
    generationTriggerFilter: NullableFilter,
    /**
     * Scan places other than recent messages — a card's description, a persona's
     * tags, and so on.
     */
    additionalMatchingSources: Type.Array(Type.String()),

    /** My content triggers nothing further. */
    preventRecursion: Type.Boolean(banner('Recursion', 'Three flags, all earning their place.')),
    /** I cannot be triggered recursively. */
    excludeRecursion: Type.Boolean(),
    /** I fire only during recursion. */
    delayUntilRecursion: Type.Boolean(),

    /**
     * Where a retriever contributed by an extension attaches. Everything built
     * in stays a flat field above.
     *
     * **The one addition** to a schema that is otherwise a port. That used to be
     * a banner standing over this field and its neighbour, and it is a fact
     * about *this field* rather than a name a reader could be shown as a
     * heading — so it is said here, and the group it stood over is named for
     * what the group is.
     */
    extensionActivations: Type.Optional(
      Type.Array(
        Type.Object({ by: Type.String(), config: Type.Unknown() }),
        banner(
          'The entry itself',
          'Everything above is about when an entry fires. Nothing here is.',
        ),
      ),
    ),

    /**
     * If this entry tracks state, its shape — as JSON Schema. The *values* live
     * in a session channel keyed by entry id, never here, because an exported
     * lorebook must not carry somebody's playthrough.
     */
    stateSchema: Type.Optional(Type.Unknown()),

    /**
     * Free string with a suggested vocabulary ("location", "item", "quest"), not
     * a closed union.
     */
    tag: Type.Union([Type.String(), Type.Null()]),

    /**
     * Pictures of the thing this entry describes
     * ([10 §5.1](../../../../docs/design/10-schemas.md)).
     *
     * ⚠ **MEDIA DOES NOT ACTIVATE.** An entry firing on a keyword contributes
     * its *text*. Its images are not retrieved, not budgeted and not sent — at
     * 1.0 nothing outside the editor reads this field at all.
     *
     * The assumption that activation carries the whole entry is the natural one
     * and it is wrong. It also fails quietly and expensively: twelve pictures
     * on a `constant: true` entry would otherwise become a per-turn cost nobody
     * chose, discovered on a bill.
     */
    media: Type.Array(EmbeddedMedia),

    /** Locked against automatic modification by agents. */
    locked: Type.Boolean(),
    metadata: Metadata,
  },
  {
    title: 'LoreEntry',
    description:
      'Deliberately absent: `embedding` (derived — belongs in the index, and ' +
      'would otherwise put megabytes of one install’s vector arithmetic into ' +
      'every shared lorebook), `dynamicState`, quest structures, ' +
      '`relationships`, `activationConditions` and `schedule`.',
  },
);
export type LoreEntry = Static<typeof LoreEntry>;

export const Lorebook = Type.Object(
  {
    schema: Type.Literal(LOREBOOK_SCHEMA),
    id: Id,
    name: Type.String(),
    description: Type.String(),

    scope: LoreScope,
    enabled: Type.Boolean(),

    /** 0 = whole session. */
    scanDepth: Type.Number({ default: 2 }),
    /** 0 = unlimited. */
    tokenBudget: Type.Number({ default: 2048 }),
    entryLimit: Type.Number({ minimum: 1, maximum: 1000, default: 100 }),
    recursiveScanning: Type.Boolean({ default: false }),
    maxRecursionDepth: Type.Number({ default: 3 }),

    folders: Type.Array(LoreFolder),
    /**
     * Optional. Hooks genuinely inseparable from this lore — eligible only while
     * this lorebook is active. Treatments remain the primary home.
     */
    hooks: Type.Optional(Type.Array(PlotHook)),
    entries: Type.Array(LoreEntry),
    /**
     * Prose from this world, offered as an exemplar — §WritingSample.
     *
     * **This field overrides a standing refusal, and the override is recorded
     * rather than quietly taken.** [16 §4](../../../../docs/design/16-lorebooks-as-a-format.md)
     * refuses new lorebook fields by name, and the argument was a count: eleven
     * activation fields already ship, validate and round-trip while nothing
     * reads them as the field they are, so adding a twelfth would be "buying
     * machinery to avoid building a surface".
     *
     * That argument is sound and is not being disputed on its merits. It is
     * being overridden because this field is not the kind it was aimed at: a
     * writing sample **has a reader on the day it lands** — the assembler fills
     * a slot from it and the block table shows what it cost — so it does not
     * join the unread eleven, it is the first new field in a while that does
     * not. §4's own instruction is that refusals be recorded with their reasons
     * "so that they get re-checked rather than re-argued"; this is that
     * re-check, and it went the other way.
     *
     * **Book-scoped, not entry-scoped, and that is the load-bearing part.** An
     * entry-level sample would have to activate, which means keys, scan depth
     * and the whole matching apparatus — and a tone exemplar that appears only
     * when somebody says a magic word is not a tone exemplar. Samples here
     * belong to the book the way `media` does.
     *
     * The portability rule in §4.2 holds: this is a fact about the *book* —
     * how this world reads — not a fact about how one person likes to play it,
     * so it travels with an export the way `description` does.
     */
    writingSamples: Type.Optional(Type.Array(WritingSample)),

    /**
     * Organisational, and the only such axis — a closed `category` union was
     * removed rather than renamed ([02 §3.4](../../../../docs/design/02-data-model.md)).
     * Free text, per the same argument that keeps `LoreEntry.tag` open.
     */
    tags: Type.Array(Type.String()),
    /**
     * The book's gallery — maps, establishing shots, style references for the
     * world as a whole ([10 §5.1](../../../../docs/design/10-schemas.md)).
     */
    media: Type.Array(EmbeddedMedia),
    /**
     * Which of `media` is the library card's picture.
     *
     * Ordered-list-plus-primary, as `Openings` does it, rather than a separate
     * `cover` field — reordering stays free and the first element is not
     * special. Deliberately not cross-validated against `media`: `Openings`
     * does not either, and a dangling id here degrades to "no cover picture"
     * rather than to an error.
     */
    primaryMediaId: Type.Union([Type.String(), Type.Null()]),
    /**
     * Bulk, in the folder rather than the manifest. Parity with Actor, and the
     * schema catching up to a layout that already listed
     * `lorebooks/<slug>/lorebook.json + assets/`
     * ([02 §5.1](../../../../docs/design/02-data-model.md)).
     */
    assets: Type.Array(AssetRef),
    provenance: Provenance,
    generated: GeneratedMap,
    metadata: Metadata,
  },
  {
    $id: `https://storyengine.dev/schemas/${LOREBOOK_SCHEMA.replace('/', '.')}.json`,
    title: 'Lorebook',
  },
);
export type Lorebook = Static<typeof Lorebook>;
