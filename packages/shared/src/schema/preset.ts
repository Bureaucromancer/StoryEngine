// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';

import { TagIdList, Compat, GeneratedMap, Id, Metadata, ModelHint, Provenance } from './common.js';

/**
 * Preset — docs/design/04-schemas.md §8. **The prompt pack.**
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
 * [00 §2.1](../../../../docs/design/00-stance.md) rejects — that objection is to character
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
 * ***Whose cards an actor-sourced block takes, on a call that speaks for
 * somebody*** — [P14 §1.4](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * added at [P14.2].
 *
 * **Absent is everyone, which is what every preset written before this
 * means**, and it is also what [00 §2.10](../../../../docs/design/00-stance.md)
 * asks of a scene with several people in it: *"the assembler is multi-actor
 * from the start"*, so every present card stays in the prompt of every call,
 * the speaker's first. That is SillyTavern's `APPEND` group mode without its
 * string-joining (and without its member order, which puts the speaker
 * wherever they fall). A pack that wants ST's `SWAP` — only the one who is
 * talking — says so on the blocks that should narrow, with `speaker`; a block
 * that wants the rest of the room under its own heading says `others`.
 *
 * ***The two scopes partition the cast on every call, speaking or not***,
 * and that is the rule a pack author can hold in their head. `speaker` is the
 * member the call speaks for and nobody else, so on a call that speaks for
 * nobody — a narrator's merged call — it is **nobody**; `others` is everyone
 * but that member, so on the same call it is **everyone**. A pack with one
 * block of each therefore sends every card exactly once whichever way the
 * session is voiced. The alternative considered — a scope that is inert on a
 * call with no speaker — would send such a pack's cards twice to a narrator.
 *
 * ***A third, `voiced`, at [P14.3] — whoever this call writes as***
 * ([P14 §1.5](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)).
 * Under `per-actor` dispatch that is the speaker; under `merged` — one call
 * writing for the whole room, embodied or narrated — it is everyone present.
 * §1.5 asks exactly this of a card's own prompts (*"each call carries the
 * speaker's card prompts only"* under `per-actor`, *"every present card's
 * prompts are stacked"* under `merged`), and of example dialogue, and neither
 * `speaker` nor unscoped says it: `speaker` would give a merged call one card's
 * system prompt and a narrator's call none of anybody's samples, and unscoped
 * would hand a per-actor call every other member's *"You are…"*. *It is not a
 * partition with the other two*, and does not claim to be: it answers a
 * different question — *whose voice is this call* — rather than *who is not the
 * speaker*.
 *
 * **Optional and additive, so the file format does not move**: a preset
 * without it is the preset it was, and an older build ignores the field as the
 * unknown-field rule says it must.
 */
export const ActorScope = Type.Union(
  [Type.Literal('speaker'), Type.Literal('others'), Type.Literal('voiced')],
  {
    title: 'ActorScope',
    description:
      "Whose cards the block takes on a speaking call: the speaker's only, everyone but " +
      'the speaker, or whoever the call writes as (the speaker under per-actor dispatch, ' +
      'everyone present under merged). Absent is everyone.',
  },
);
export type ActorScope = Static<typeof ActorScope>;

/**
 * What fills a slot. Closed for now, and expected to grow as modes declare
 * channels — which is one of the four reasons this schema is `/0` (§8.5).
 *
 * This is `BlockSource` ([21 §1.1](../../../../docs/design/21-internal-contracts.md)) minus
 * its ~~two~~ assembler-only origins: `preset`, because a preset's own prose *is* a
 * TextBlock rather than a reference to one, and `step`, because a step's
 * contribution did not exist when the preset was authored — ***and since P14,
 * `round`, `note` and `continue`***, five in all, which is what the server's
 * `assembly/types.ts` derives (2026-10-01). By meaning rather than by shape: an
 * `{ of }` here is what its block records as `{ kind }`, except that the two
 * dial arms record one `difficulty` source, and `schema` is recorded by no slot —
 * ***and (2026-10-03, at the P15 merge) the `summary` slot records two kinds***:
 * the chain's root, a Setup's story so far, as `story-so-far`, and its links as
 * `summary` ([04 §7.2](../../../../docs/design/04-schemas.md)).
 */
export const SlotSource = Type.Union(
  [
    Type.Object({ of: Type.Literal('persona') }),
    /**
     * "se.summary", "se.appearance", … — and since [P14.2] an optional
     * {@link ActorScope}, on this arm and the next, for a pack that narrows a
     * card block to the member a call speaks for or to the rest of the room.
     */
    Type.Object({
      of: Type.Literal('actor'),
      sectionId: Type.String(),
      scope: Type.Optional(ActorScope),
    }),
    /**
     * Non-prose actor fields. `traits` is a real field rather than a Section, so
     * a slot cannot reach it through `sectionId` — and card import puts a legacy
     * `personality` here, which makes this the slot ST's `charPersonality`
     * converts to (§8.4.1).
     */
    Type.Object({
      of: Type.Literal('actor'),
      field: Type.Union([Type.Literal('traits'), Type.Literal('visual')]),
      scope: Type.Optional(ActorScope),
    }),
    Type.Object({
      of: Type.Literal('lore'),
      phase: Type.Union([Type.Literal('before'), Type.Literal('after')]),
      /**
       * An outlet this slot positions — [P5.6], [03 §3.1].
       *
       * **Block addressing arriving from the other direction.** Every other
       * field here names what the preset wants and lets the engine supply it;
       * an outlet lets a lore *entry* name a place and asks the preset whether
       * that place exists. It is what decouples "this activated" from "this
       * gets pasted here", so a book can say *put my combat rules wherever the
       * preset keeps rules* without knowing anything about the preset.
       *
       * Matched exactly and case-sensitively, as `LoreEntry.outletName` says.
       * A near miss is not silently forgiven, because the two strings were
       * probably written by two different people and a fuzzy match would put
       * text somewhere neither of them chose — the mismatch is reported
       * instead, which is the only way it is ever visible.
       *
       * Absent means the slot takes the ordinary entries for its `phase` and no
       * outlet at all. Added rather than substituted, so every preset written
       * before P5.6 keeps meaning what it meant.
       */
      outlet: Type.Optional(Type.String()),
    }),
    Type.Object({ of: Type.Literal('history') }),
    /**
     * Writing samples — [04 §3.1]. **Renamed from `examples`**, which named the
     * SillyTavern field it was reserved for rather than the thing it fills; the
     * carrier is `writingSamples` on three kinds, and one concept under two
     * names is exactly the drift [21 §1.1] exists to prevent. Safe to rename
     * rather than add because this schema is `/0`, no shipped preset positions
     * the old arm, and `default:` in the collector skips an unknown slot
     * instead of throwing.
     *
     * `from` absent means **every carrier**, in the fixed order treatment →
     * lore → actor: the stance on the material, then the world, then the
     * person, which is the order they narrow in. An author who wants a
     * character's samples somewhere other than the setting's names one.
     *
     * ***`scope` narrows the actor carrier and nothing else*** ([P14.2]). A
     * character's example dialogue is the one sample that belongs to a *who*,
     * and [P14 §1.5] sends it scoped to the speaker: an example of how Lund
     * talks, in the call where Vera is talking, is an instruction to sound like
     * Lund. A treatment's or a book's samples belong to the story rather than
     * to anybody in it, so the scope does not reach them.
     */
    Type.Object({
      of: Type.Literal('samples'),
      from: Type.Optional(
        Type.Union([Type.Literal('actor'), Type.Literal('treatment'), Type.Literal('lore')]),
      ),
      scope: Type.Optional(ActorScope),
    }),
    Type.Object({ of: Type.Literal('channel'), channelId: Type.String() }),
    /**
     * ***What the story has established*** —
     * [P14 §1.9.2](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
     * added at [P14.5a].
     *
     * Every channel that declares itself established state (the SDK's
     * `EstablishedState`) and is switched on, **scoped values included**, as
     * one block: Marinara's committed tracker context, which says *as of the
     * last message* and is placed before it. **Not six `channel` slots**,
     * because that arm reads one unscoped key and a character tracker is one
     * value per character — the reason a new arm exists at all.
     *
     * Added rather than substituted, so an older build's collector skips the
     * arm it has not heard of rather than refusing the file.
     */
    Type.Object({ of: Type.Literal('state') }),
    /**
     * The treatment slot. Named for the kind it reads, completing the
     * Setting→Treatment rename ([04 §6]) that the docs took and the code did
     * not — [04 §8.2], the §8.4.1 marker table and [21 §1.1] have all spelled
     * this `treatment` since; every line of shipped code spelled it `setting`
     * until P4.0, which meant an importer written to the marker table emitted
     * presets this schema rejected ([P4 §1.7]).
     *
     * **Two axes, not one, and they must not be collapsed.** `treatment` above
     * is the `samples` *carrier* — which object a writing sample came off —
     * and it has always been spelled that way. This is the *slot kind*. A
     * find-and-replace over the word merges two vocabularies that happen to
     * share a noun.
     */
    Type.Object({
      of: Type.Literal('treatment'),
      part: Type.Union([Type.Literal('framing'), Type.Literal('tone')]),
    }),
    /**
     * ***A text answer the session was set up with*** (2026-09-30) —
     * `mode.config[field]`, from the mode's wizard or the Setup the session
     * began from ([04 §7], [06 §9]), named by the wizard field's id.
     *
     * Freeform's wizard requires a premise — *"A sentence or two. The narrator
     * opens from it"* — and nothing could carry it to a prompt: the answers
     * are a record field handed to steps as `input.setup`, Freeform's one step
     * reads nothing, no slot named them, and a block template's namespace is
     * names and never bodies (`renderTemplate`). A slot is how content reaches
     * a prompt, so the pack names the answer and the collector fills it. *Read
     * by the gather*, as the dials' rung is, so a preview and a turn cannot
     * disagree about it. **A string answer only**, trimmed; a choice's option
     * id is a string too, and a pack that slots one is saying it wants the id.
     *
     * *A widening of this closed union*, as `state` was — recorded as one.
     */
    Type.Object({ of: Type.Literal('setup'), field: Type.String() }),
    Type.Object({ of: Type.Literal('goal') }),
    /**
     * ***The two dials' prose*** — [06 §7.3.1], [06 §7.3.2], built at
     * [P7.8](../../../../docs/design/workplan/23-p7-implementation.md).
     *
     * **A slot of its own rather than `{ of: 'channel' }`, and the reason is
     * where the words are.** A channel slot renders the channel's *value*
     * through {@link ChannelDefinition.render}, and the value of either dial is
     * a **level id** — rendering it produces the word *harsh*, which is a label
     * and not an instruction. The prose lives in {@link DifficultyLevel}
     * fragments on this preset, keyed by that id, and no template over a channel
     * value can reach a sibling field of the file the template is in. So the
     * engine resolves *which level*, and this slot says *where its fragments
     * go* — which is also the split [06 §7.3.1] draws in as many words: the
     * levels are the pack's, the scheduling is engine code's.
     *
     * ***Two arms rather than one with a `part`, because the whole point is that
     * they are separable.*** [06 §7.3.2]: *"A naive difficulty implementation
     * raises both together… The result is railroading wearing difficulty's
     * clothes, and players report it as* the AI ignoring me *rather than as*
     * hard." A single slot taking a discriminator would put both sets of
     * fragments at one position by default, which is the conflation expressed as
     * a layout. An author who wants them adjacent writes two slots next to each
     * other and has said so.
     *
     * **Several candidates per slot, one per fragment**, in `priority` order —
     * which is what makes [19 §5.3]'s cap able to drop the lowest-ranked rather
     * than cut a sentence in half. A slot that joined them into one string would
     * have thrown that away at the point it was built.
     *
     * *Absent levels are not an error.* A preset with no `difficultyLevels`
     * fills the slot with nothing and reports why, the same as a session with no
     * goal: a mode that has no difficulty is [04 §7]'s explicit case, not a
     * misconfiguration.
     */
    Type.Object({ of: Type.Literal('difficulty') }),
    Type.Object({ of: Type.Literal('directedness') }),
    /**
     * The guidance slot — [06 §5.1](../../../../docs/design/06-modes-and-turn-pipeline.md).
     *
     * That section says the guidance block is *positioned by the preset*, which
     * makes it slot-nameable by definition. It was missing: the internal
     * `BlockSource` gained it at P2.5 and both [21 §1.1] and [04 §8.2] were
     * edited to match, but this — the schema that actually validates a preset —
     * was not, so a preset positioning the one block §5.1 says it positions
     * failed validation. Found at P2.6, by the first preset that needed it.
     *
     * One slot, several producers (the box, a rule's `giveGuidance`, a
     * Narrative Director push). Which one is recorded on the emitted block, not
     * chosen here.
     */
    Type.Object({ of: Type.Literal('guidance') }),
    /**
     * The previous attempt — the second advisory slot, [06 §5.1], [07 §7].
     *
     * On a *guided* redo the model is shown the sibling it is redoing, beside
     * the instruction saying what to change: "make it rain harder" needs an
     * *it*. What fills the slot is that sibling's `output.text`, read from the
     * server's own record and never from the wire — the posture the tape takes
     * ([19 §14.5]), so a client cannot show the model words the record does
     * not hold. Which sibling is recorded on the emitted block, as the producer
     * is for `guidance`.
     *
     * Advisory for a sharper reason than the instruction is: the text is the
     * model's own discarded reply, and an extractor that saw it would record
     * the events of a reply nobody kept as having happened. The collector
     * forces the marker exactly as it does for `guidance`, so a preset that
     * clears it changes nothing.
     *
     * Added rather than substituted, so every preset written before it keeps
     * meaning what it meant, and an older build's collector skips the arm it
     * has not heard of rather than refusing the file.
     */
    Type.Object({ of: Type.Literal('attempt') }),
    /**
     * What the player just did. **Not `history`**, which is turns that already
     * happened — this is the one that is happening, and every preset decides
     * where it sits relative to the lore and the instructions.
     */
    Type.Object({ of: Type.Literal('input') }),
    /**
     * The story above the window, as a chain of summaries —
     * [07 §5.1](../../../../docs/design/07-branching.md),
     * [25 E1](../../../../docs/design/25-open-questions.md), [P8.1].
     *
     * **Not a bigger `history`, and the distinction decides the budget.**
     * `history` is the mode's `historyWindow` of verbatim turns; this is
     * everything older, each link keyed by the hash of its inputs. The two never
     * overlap — [P8.1] refuses to widen the window for exactly that reason,
     * because a turn with two producers lets the budgeter decide which survives.
     *
     * ***So the alternative to this slot is not a longer history, it is
     * nothing.*** [P8 §5] is the argument: at turn four hundred everything above
     * turn twenty is already gone, so a summary does not compete with the
     * transcript — it competes with lore and the actor card, at a priority the
     * preset author chooses here.
     *
     * **Several candidates, one per link**, in the chain's own order, so the
     * budgeter can drop the oldest stretch of story and keep the recent one
     * rather than choosing between all of it and none. The same reason `history`
     * is splittable and `actor` is one candidate per actor.
     *
     * Added rather than substituted, as `attempt` was: every preset written
     * before it keeps meaning what it meant, and an older build's collector
     * skips an arm it has not heard of rather than refusing the file.
     */
    Type.Object({ of: Type.Literal('summary') }),
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
   * ([00 §2.6](../../../../docs/design/00-stance.md)).
   */
  priority: Type.Number(),
  /**
   * Which kinds of call this block applies to. Empty = all. This is what
   * dissolves ST's eight special-cased template fields (§8.4.3).
   */
  appliesTo: Type.Array(CallKind),
  /**
   * Guidance-class blocks are refused by effect-producing calls
   * ([06 §5.2](../../../../docs/design/06-modes-and-turn-pipeline.md)).
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
     * generalised from nine fixed fields to a property of any slot. Absent =
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

/**
 * ***Whether a block is the pack's own instruction*** —
 * [P14 §1.5](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
 * `prompts.instruction: false`, read at [P14.3].
 *
 * A chat may switch the pack's instruction off and send a card's system prompt
 * alone, which is SillyTavern's `prefer_character_prompt` one toggle away. So
 * *the instruction* has to be something the engine can find in any pack, and a
 * block carries no flag for it. **It is found by id**: the shipped packs name
 * theirs `se.instruction` or `se.instruction.<kind>` (Scene's narrator and
 * embodied pair, Freeform's per-kind blocks), and SillyTavern's `main` prompt —
 * the block `prefer_character_prompt` replaces — imports as `st.main`.
 *
 * *An id convention rather than a schema field*, because a field would be a
 * format change for a switch one stage uses, and the ids are already stable
 * content: a block id is what [04 §8] promises modes and the workbench can
 * address. A hand-made pack whose instruction is called something else is not
 * switched off by this toggle, and its author can rename the block.
 */
export function isInstructionBlock(block: { id: string }): boolean {
  return (
    block.id === 'se.instruction' ||
    block.id.startsWith('se.instruction.') ||
    block.id === 'st.main'
  );
}
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
 * ([00 §3.2](../../../../docs/design/00-stance.md)).
 *
 * The portable subset — the parameters an OpenAI-compatible chat endpoint
 * understands ([19 §5.5](../../../../docs/design/19-tech-stack.md)). Backend-specific
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
 * ([10 §6](../../../../docs/design/10-ui-surfaces.md)) — typed, enum options, required flag,
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
 * ([06 §7.3.1](../../../../docs/design/06-modes-and-turn-pipeline.md)).
 *
 * **The levels live in the prompt pack, not in engine code**, which is the
 * whole point: "hard" meaning something different in one prompt pack than
 * another is a feature, and its effect is visible in the turn record as a block
 * with a source rather than buried in a conditional.
 *
 * Fragments are *ranked* rather than a single string, so the prompt-cap
 * machinery ([19 §5.3](../../../../docs/design/19-tech-stack.md)) can drop the lowest-ranked
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

    /**
     * ***The second axis*** — [06 §7.3.2], added at [P7.8].
     *
     * **The same shape, because it is the same kind of thing**: a named level
     * with ranked fragments, resolved against a dial, replaceable by whoever
     * ships the pack. What differs is what the fragments say, and 7.3.2 is
     * emphatic that the difference is the feature — *resistance* is how readily
     * the world grants what you attempt, *directedness* is how hard the
     * narration pulls toward its own idea of the story, and a pack that raises
     * both together has built railroading and called it hard mode.
     *
     * *So this is a separate field and not a `kind` on the list above*, for the
     * reason the slot is two arms: a single list discriminated by axis would let
     * a pack ship four entries and never notice it had written the same prose
     * twice.
     *
     * **Its default is low and that is the pack's to state**, not this schema's.
     * 7.3.2 wants *some* — *"a narrator with none is a stenographer"* — which is
     * a statement about what good fragments say rather than about which level is
     * selected, and the level a session starts on is
     * [04 §7](../../../../docs/design/04-schemas.md)'s question, answered at P7.8.
     */
    directednessLevels: Type.Optional(Type.Array(DifficultyLevel)),

    /**
     * ***How the hook dial should read to a model*** — [06 §6.1], added at
     * [P11.5](../../../../docs/design/workplan/28-p11-implementation.md).
     *
     * §6.1's split, in its own words: ***"Level → cadence, cooldown and patience
     * is engine code; the level's prose is the prompt pack's."*** The numbers
     * live in `sessions/hooks.ts` and belong there — *"their effect is that a
     * step does not run, which is invisible in the turn record by construction,
     * and letting a portable preset set internal scheduling inverts the
     * dependency the step contract exists to keep one-way"*. The prose is the
     * half that transfers, and until this field there was **nowhere for it to
     * go**: the declaration existed, the dial existed, the selector's prompt
     * said the same thing at every setting.
     *
     * ***The same shape as the two above, and that is not laziness.*** A named
     * level with ranked fragments, resolved against a dial, replaceable by
     * whoever ships the pack — the argument [06 §7.3.1] makes for difficulty
     * transfers whole, and a third literal shape for the same idea would be
     * three things for an author to learn.
     *
     * ***But it is emphatically not a third dial axis***, and the separation is
     * load-bearing rather than filing. [23 §5.4] states it directly: a frequency
     * dial stays a **separate channel** from difficulty, *"because folding* how
     * often *into* how hard *rebuilds exactly the conflation 06 §7.3.2 exists to
     * prevent"*. So `DialAxis` does not grow an arm, `dials.ts` still reads
     * neither this field nor that channel, and `resolveDials` still loops over
     * two. What is shared here is a **data shape**, and nothing else.
     *
     * *The ids are `PACING_LEVELS`* — `sparse`, `normal`, `aggressive`,
     * `manual-only` — because the dial's own enum is what a level is selected
     * by. A pack that ships a level for a name the channel does not have is
     * shipping prose nothing can select, which the engine treats as absent.
     *
     * **Omitted means the selector asks its question with no pacing prose at
     * all**, which is exactly what every session did before this field and is
     * the honest reading of a pack that has not thought about it.
     */
    pacingLevels: Type.Optional(Type.Array(DifficultyLevel)),

    /**
     * ***What a push says when nobody could be asked*** —
     * [P14 §1.9.3](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
     * added at [P14.5b].
     *
     * A person arms *Push story* for one turn, `natural` or `random`, and the
     * engine's `se.scene.direct` makes one small call for a direction. When that
     * call fails, **this is the direction** — the pack's fixed words for the
     * flavour, which is what Marinara's individual group mode sends in place of
     * its director's (`generate.routes.ts:5754-5763`). It reaches the guidance
     * slot like any direction, and the step's outcome says it stood in.
     *
     * ***The pack's rather than the engine's***, for the pacing prose's reason:
     * how a push should read to a model is prompt content, and a pack that
     * wants a gentler nudge says so here. *Omitted*, a failed push has nothing to
     * stand in and the turn runs undirected, with the failure on the record.
     */
    pushDirections: Type.Optional(
      Type.Object({
        natural: Type.String({ minLength: 1 }),
        random: Type.String({ minLength: 1 }),
      }),
    ),

    variables: Type.Array(PresetVariable),

    tags: Type.Array(Type.String()),
    /** See {@link TagIdList} — the registry side of `tags`. */
    tagIds: Type.Optional(TagIdList),
    provenance: Provenance,
    generated: GeneratedMap,
    /** Unrecognised fields from an import, verbatim. */
    compat: Compat,
    metadata: Metadata,
  },
  {
    $id: `https://storyengine.dev/schemas/${PRESET_SCHEMA.replace('/', '.')}.json`,
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
