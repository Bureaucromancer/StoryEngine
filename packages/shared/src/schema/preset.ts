// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

import { Compat, GeneratedMap, Id, Metadata, ModelHint, Provenance } from './common.js';

/**
 * Preset — docs/design/13-schemas.md §8. **The prompt pack.**
 *
 * At `/0`, and that is the honest number: §8.5 lists four things still
 * genuinely unsettled, and three of them are in this file. What `/0` buys over
 * leaving it undefined is the round-trip guarantee, the `metadata` escape hatch
 * and the unknown-field preservation rule — a preset is the object this
 * ecosystem trades most, so the alternative was leaving the most-shared portable
 * kind as the only one with no schema at all.
 *
 * The structural decision is §8.1's: **blocks are of two kinds.** A slot
 * positions content the *engine* supplies; a text block is prose the *preset
 * author* wrote. SillyTavern discovered the same split and did not name it —
 * its `prompts[]` array distinguishes them with `marker: true` — which is strong
 * independent evidence for the shape.
 */

export const PRESET_SCHEMA = 'storyengine.preset/0';

/**
 * Open, and this is the second of the two unions §8.2 singles out. A preset
 * written for a mode you do not have must still round-trip rather than failing
 * validation on a string this build has not heard of.
 */
export const CallKind = Type.String({
  title: 'CallKind',
  description: 'Which kind of call a block applies to. Open — modes declare their own kinds.',
  examples: [
    'narrate',
    'impersonate',
    'continue',
    'group-nudge',
    'session-start',
    'example',
    'utility',
  ],
});
export type CallKind = Static<typeof CallKind>;

/**
 * Ordering constraints, never character offsets.
 *
 * `in-history` is the expensive one and worth paying for: it forces history to
 * be a *splittable* source rather than an atomic block. It is not what
 * [00 §2.1](docs/design/00-stance.md) rejects — that objection is to character
 * offsets into an assembled string, which are unrepresentable and break whenever
 * anything upstream changes length. "After the Nth-newest message" is a
 * structural position over a list the engine owns, and it survives edits,
 * branching and re-rendering.
 *
 * Refusing it would drop most real presets on the floor: depth injection is how
 * nearly every modern SillyTavern style directive works.
 */
export const Placement = Type.Union(
  [
    /** Ordinary: position in `blocks`. */
    Type.Object({ at: Type.Literal('sequence') }),
    Type.Object({
      at: Type.Literal('in-history'),
      /** Counted from the newest message. */
      fromEnd: Type.Number({ minimum: 0 }),
      /**
       * Exists only because SillyTavern has it (`injection_order`, default 100)
       * and two blocks can land at the same depth. Ours could have used sequence
       * order; ST's files carry an explicit number, so preserving it is free and
       * dropping it would reorder someone's prompt silently.
       */
      tiebreak: Type.Optional(Type.Number()),
    }),
  ],
  { title: 'Placement' },
);
export type Placement = Static<typeof Placement>;

/**
 * What fills a slot. Closed for now, and expected to grow as modes declare
 * channels — which is one of the four reasons this schema is `/0` (§8.5).
 *
 * This is `BlockSource` ([18 §1.1](docs/design/18-internal-contracts.md)) minus
 * its two assembler-only origins: `preset`, because a preset's own prose *is* a
 * TextBlock rather than a reference to one, and `step`, because a step's
 * contribution did not exist when the preset was authored.
 */
export const SlotSource = Type.Union(
  [
    Type.Object({ of: Type.Literal('persona') }),
    /** "se.summary", "se.appearance", … */
    Type.Object({ of: Type.Literal('actor'), sectionId: Type.String() }),
    /**
     * Non-prose actor fields. `traits` is a real field rather than a Section, so
     * a slot cannot reach it through `sectionId` — and card import puts a legacy
     * `personality` here, which makes this the slot ST's `charPersonality`
     * converts to (§8.4.1).
     */
    Type.Object({
      of: Type.Literal('actor'),
      field: Type.Union([Type.Literal('traits'), Type.Literal('visual')]),
    }),
    Type.Object({
      of: Type.Literal('lore'),
      phase: Type.Union([Type.Literal('before'), Type.Literal('after')]),
    }),
    Type.Object({ of: Type.Literal('history') }),
    Type.Object({ of: Type.Literal('examples') }),
    Type.Object({ of: Type.Literal('channel'), channelId: Type.String() }),
    Type.Object({
      of: Type.Literal('setting'),
      part: Type.Union([Type.Literal('framing'), Type.Literal('tone')]),
    }),
    Type.Object({ of: Type.Literal('goal') }),
  ],
  { title: 'SlotSource' },
);
export type SlotSource = Static<typeof SlotSource>;

const BlockCommon = {
  /**
   * Stable, and addressable by modes, the workbench and later versions of this
   * preset. Reordering must never break a reference.
   */
  id: Id,
  /** Author-facing. Never injected. */
  label: Type.String(),
  role: Type.Union([Type.Literal('system'), Type.Literal('user'), Type.Literal('assistant')]),

  /**
   * Present but off. Worth having as a real state: a disabled block is an
   * author's note to themselves, and deleting it to try without it loses their
   * work.
   */
  enabled: Type.Boolean(),

  placement: Placement,

  /**
   * Budget priority. "Never trim" is a value here, never the absence of a budget
   * ([00 §2.6](docs/design/00-stance.md)).
   */
  priority: Type.Number(),
  /**
   * Which kinds of call this block applies to. Empty = all. This is what
   * dissolves ST's eight special-cased template fields (§8.4.3).
   */
  appliesTo: Type.Array(CallKind),
  /**
   * Guidance-class blocks are refused by effect-producing calls
   * ([03 §5.2](docs/design/03-modes-and-turn-pipeline.md)).
   */
  advisory: Type.Boolean(),
  /** Drop the block rather than emit a heading with nothing under it. */
  omitWhenEmpty: Type.Boolean(),
};

export const SlotBlock = Type.Object(
  {
    ...BlockCommon,
    kind: Type.Literal('slot'),
    source: SlotSource,
    /**
     * Optional wrapper, with `{{content}}` standing for the filled value.
     * "Scenario: {{content}}" — exactly ST's `scenario_format` and `wi_format`,
     * generalised from eight fixed fields to a property of any slot. Absent =
     * emit the content bare.
     */
    wrapper: Type.Optional(Type.String()),
  },
  {
    title: 'SlotBlock',
    description:
      'Positions engine-supplied content. The preset chooses where and how it ' +
      'is framed; it never authors what goes in.',
  },
);
export type SlotBlock = Static<typeof SlotBlock>;

export const TextBlock = Type.Object(
  {
    ...BlockCommon,
    kind: Type.Literal('text'),
    /** Liquid, rendered within the block — never across blocks. */
    template: Type.String(),
  },
  { title: 'TextBlock', description: 'Prose the preset author wrote.' },
);
export type TextBlock = Static<typeof TextBlock>;

export const PresetBlock = Type.Union([SlotBlock, TextBlock], { title: 'PresetBlock' });
export type PresetBlock = Static<typeof PresetBlock>;

/**
 * **Provisional, and one of the four reasons this schema is `/0`** (§8.5). The
 * vocabulary wants the assembler to exist before it can be settled.
 *
 * What is not provisional is the shape of the problem §8.3 names: a preset
 * written against a 4k window must not silently misbehave at 200k, and ST's
 * `openai_max_context: 4095` sitting in a preset shared in 2026 is the concrete
 * form of it. So the policy is expressed as **shares and floors against the
 * resolved window**, with absolute values available where an author means them.
 */
export const BudgetShare = Type.Object(
  {
    /** A block id, or a slot source kind ("history", "lore"). */
    target: Type.String(),
    /** Fraction of the assembled budget, 0..1. */
    share: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    /** Floor. Never trim below this, even under pressure. */
    minTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    maxTokens: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { title: 'BudgetShare' },
);
export type BudgetShare = Static<typeof BudgetShare>;

export const BudgetPolicy = Type.Object(
  {
    /** Fraction of the *resolved* window to fill. This is the portable number. */
    contextShare: Type.Number({ minimum: 0, maximum: 1, default: 0.75 }),
    /**
     * An absolute ceiling, when the author means one. `null` = none, and null is
     * the right default: this is where an imported `openai_max_context` lands,
     * and it arrives with a review note saying it was absolute.
     */
    maxContextTokens: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    /** Held back for the response rather than spent on context. */
    reserveOutputTokens: Type.Integer({ minimum: 0, default: 1024 }),
    sources: Type.Array(BudgetShare),
  },
  { title: 'BudgetPolicy' },
);
export type BudgetPolicy = Static<typeof BudgetPolicy>;

/**
 * **Sampling only. Never a model id, never a connection**
 * ([00 §3.2](docs/design/00-stance.md)).
 *
 * The portable subset — the parameters an OpenAI-compatible chat endpoint
 * understands ([07 §5.5](docs/design/07-tech-stack.md)). Backend-specific
 * sampler controls (`dry_*`, `mirostat_*`, `xtc_*`, `tfs`, and the rest of the
 * text-completion family) have no chat-API equivalent and land in `compat` with
 * a named loss in the import review, never here.
 *
 * Whether this subset holds or needs a provider-specific escape hatch is the
 * third of §8.5's four open questions.
 */
export const GenerationParams = Type.Object(
  {
    temperature: Type.Optional(Type.Number()),
    topP: Type.Optional(Type.Number()),
    topK: Type.Optional(Type.Number()),
    topA: Type.Optional(Type.Number()),
    minP: Type.Optional(Type.Number()),
    frequencyPenalty: Type.Optional(Type.Number()),
    presencePenalty: Type.Optional(Type.Number()),
    repetitionPenalty: Type.Optional(Type.Number()),
    /** null = leave it to the provider. Not the RNG service's business. */
    seed: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
    n: Type.Optional(Type.Integer({ minimum: 1 })),
    maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    stop: Type.Optional(Type.Array(Type.String())),
  },
  { title: 'GenerationParams' },
);
export type GenerationParams = Static<typeof GenerationParams>;

/**
 * Author-declared variables the templates interpolate, with defaults and help
 * text. The Aventuras `CustomVariable` shape
 * ([05 §6](docs/design/05-ui-surfaces.md)) — typed, enum options, required flag,
 * defaults, sort order, help text — which is a working precedent rather than a
 * guess.
 */
export const PresetVariable = Type.Object(
  {
    id: Id,
    label: Type.String(),
    type: Type.Union([
      Type.Literal('string'),
      Type.Literal('text'),
      Type.Literal('number'),
      Type.Literal('boolean'),
      Type.Literal('enum'),
    ]),
    /** For `enum`. Ignored otherwise. */
    options: Type.Optional(Type.Array(Type.Object({ value: Type.String(), label: Type.String() }))),
    default: Type.Optional(Type.Unknown()),
    required: Type.Boolean({ default: false }),
    /** Shown beside the field. Author-facing; never injected. */
    help: Type.Optional(Type.String()),
    order: Type.Number({ default: 0 }),
  },
  { title: 'PresetVariable' },
);
export type PresetVariable = Static<typeof PresetVariable>;

/**
 * Named levels the mode's difficulty setting resolves against
 * ([03 §7.3.1](docs/design/03-modes-and-turn-pipeline.md)).
 *
 * **The levels live in the prompt pack, not in engine code**, which is the
 * whole point: "hard" meaning something different in one prompt pack than
 * another is a feature, and its effect is visible in the turn record as a block
 * with a source rather than buried in a conditional.
 *
 * Fragments are *ranked* rather than a single string, so the prompt-cap
 * machinery ([07 §5.3](docs/design/07-tech-stack.md)) can drop the lowest-ranked
 * rather than cutting mid-sentence.
 */
export const DifficultyLevel = Type.Object(
  {
    id: Id,
    label: Type.String(),
    /** Ordering among levels, low to high. */
    rank: Type.Number(),
    /** Ranked prompt fragments. Lower `priority` is dropped first. */
    fragments: Type.Array(Type.Object({ text: Type.String(), priority: Type.Number() })),
    /**
     * For modes that consume the mechanical half — target numbers, resource
     * pressure, enemy competence. Opaque here; the mode reads it.
     */
    parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { title: 'DifficultyLevel' },
);
export type DifficultyLevel = Static<typeof DifficultyLevel>;

export const Preset = Type.Object(
  {
    schema: Type.Literal(PRESET_SCHEMA),
    id: Id,
    name: Type.String(),
    blurb: Type.String(),

    /**
     * Which modes this is written for. Empty = mode-agnostic. Advisory: a preset
     * for a mode you do not have still imports and still shows.
     */
    modes: Type.Array(Type.String()),

    /**
     * Ordered. The unit the assembler consumes and the workbench displays — one
     * entry here, one line in the block list.
     */
    blocks: Type.Array(PresetBlock),

    budget: BudgetPolicy,
    params: GenerationParams,

    /**
     * Advisory model preference, resolved locally exactly as an actor's is. This
     * is where an imported preset's `openai_model` lands: expressible as a wish,
     * never as a binding.
     */
    modelHint: Type.Union([ModelHint, Type.Null()]),

    /** Omitted = the built-in pack. Supplied = this preset owns the meaning of "hard". */
    difficultyLevels: Type.Optional(Type.Array(DifficultyLevel)),

    variables: Type.Array(PresetVariable),

    tags: Type.Array(Type.String()),
    provenance: Provenance,
    generated: GeneratedMap,
    /** Unrecognised fields from an import, verbatim. */
    compat: Compat,
    metadata: Metadata,
  },
  {
    $id: `https://storyengine.dev/schemas/${PRESET_SCHEMA}.json`,
    title: 'Preset',
    description:
      'The prompt pack. Carries no connection settings and has nowhere to put ' +
      'them — SillyTavern’s `reverse_proxy`, `proxy_password`, `custom_url` and ' +
      'the rest of its `sensitiveFields` list are dropped unconditionally on ' +
      'import and named in the review. That is the type refusing, not a check ' +
      'that could be forgotten (§8.4.4).',
  },
);
export type Preset = Static<typeof Preset>;
