// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The assembly contracts — [02 §8](../../../../docs/design/02-data-model.md),
 * [13 §1.1 and §1.5](../../../../docs/design/13-internal-contracts.md).
 *
 * The pipeline's context stage is four steps
 * ([03 §5](../../../../docs/design/03-modes-and-turn-pipeline.md)): collect,
 * annotate, budget, render. These are the shapes that travel between them and
 * into the turn record — which is the point of writing them down. The workbench
 * renders a field the record already holds, so anything the assembler knows and
 * does not record is a question the workbench cannot answer later.
 */

/**
 * Where a block came from — **one vocabulary, used from both ends**.
 *
 * A preset slot names a source, the assembler fills it, and the resulting block
 * records where it came from: same names, both ends. Two vocabularies would
 * mean the workbench's block list and a preset's slot list disagreeing about
 * what anything *is*, while golden files snapshot one and authors edit the
 * other.
 *
 * The identifiers are what make provenance clickable — *which* lore entry, not
 * "a lore entry".
 */
export type BlockSource =
  | { kind: 'persona' }
  | { kind: 'actor'; actorId: string; sectionId?: string; field?: 'traits' | 'visual' }
  | { kind: 'lore'; entryId: string; phase: 'before' | 'after' }
  /**
   * One half of one past turn — F36.
   *
   * `part` because a turn is now **two** blocks rather than one, and a reader
   * with two rows carrying the same `range` and no way to tell them apart is a
   * reader that cannot answer *whose words were these*. Which is the question
   * the split was made to fix.
   */
  | { kind: 'history'; range: [number, number]; part: 'input' | 'output' }
  | { kind: 'examples'; actorId: string }
  | { kind: 'channel'; channelId: string }
  | { kind: 'setting'; part: 'framing' | 'tone' }
  | { kind: 'goal'; goalId: string }
  /**
   * The guidance slot — [03 §5.1](../../../../docs/design/03-modes-and-turn-pipeline.md).
   *
   * **A source of its own, and it had to become one.** That section says the
   * guidance block is *"positioned by the preset"*, which makes it slot-nameable
   * by definition — but it was reachable only as `{kind: 'step'}`, one of the
   * two `SlotSource` deliberately excludes. So a preset could not position the
   * one block the section says it positions. Found at P2.5, when the first real
   * producer needed a source to declare.
   *
   * `producer` because §5.1 is explicit that one slot has several producers —
   * the user's box, a rule's `giveGuidance`, a Narrative Director push — and the
   * workbench should say which, without three sources to keep in step.
   */
  | { kind: 'guidance'; producer: 'user' | 'rule' | 'step' }
  /**
   * What the player just did. Not `history`: history is turns that happened, and
   * this is the one that is happening. A preset positions it — every preset
   * decides where the player's action sits relative to the lore and the
   * instructions — so it is a slot source for the same reason guidance is.
   */
  | { kind: 'input' }
  // The two a slot can never name, because no preset positions them.
  | { kind: 'preset'; blockId: string }
  | { kind: 'step'; stepId: string };

/**
 * `BlockSource` minus the two a slot cannot name — a derivation rather than a
 * second list.
 *
 * A slot positions content the engine produces, so it can never point at the
 * preset's own prose (that *is* a block) or at a step's contribution (which did
 * not exist when the preset was authored).
 */
export type SlotSource = Exclude<BlockSource, { kind: 'preset' } | { kind: 'step' }>;

/** One candidate, before the budgeter has ruled on it. */
export interface Candidate {
  id: string;
  source: BlockSource;
  /**
   * Why it is here, in the words the workbench shows: *"keyword match:
   * 'cathedral'"*, *"pinned by user"*, *"always"*. **A product feature, not a
   * debug string** — which is also why it is required rather than optional.
   */
  reason: string;
  role: 'system' | 'user' | 'assistant';
  text: string;
  /**
   * Lower drops first. Absent means "the preset did not say", which the
   * budgeter treats as the middle rather than as the most expendable.
   */
  priority?: number;
  /**
   * Never dropped by the budgeter. For the things a request is meaningless
   * without — the user's own message.
   */
  required?: boolean;
  /**
   * **Guidance, and anything else that may influence prose and nothing else.**
   *
   * [03 §5.2](../../../../docs/design/03-modes-and-turn-pipeline.md) is a
   * specification rather than a preference: guidance must never be admissible
   * to a call whose output determines a systematic result. The sharp case is a
   * fuzzy rule condition — those are model calls, and *"the player has clearly
   * betrayed her by now"* typed into the guidance box would otherwise trip a
   * rule, letting someone talk past a mechanic without touching it.
   *
   * Enforced structurally rather than by convention: {@link assemble} refuses
   * to admit an advisory block to a call declared as producing effects or
   * verdicts.
   */
  advisory?: boolean;
}

/**
 * A call's declared appetite — [03 §6].
 *
 * A step says what it is, and the assembler enforces what follows. `effects`
 * and `verdict` are the two that may not see advisory content, and they are
 * separate names because they are separate claims a step makes about itself.
 *
 * **`CallPurpose`, not `CallKind`.** That name is taken, by a *portable*
 * type: [10 §8.2](../../../../docs/design/10-schemas.md)'s deliberately-open string
 * (`"narrate" | "impersonate" | … | (string & {})`) that a preset block's
 * `appliesTo` filters on, exported from `@storyengine/shared`. Two
 * incompatible types under one name is how a preset importing
 * `appliesTo: ["narrate"]` comes to match no call the engine ever makes — so
 * the internal one, which nothing outside this repo has ever seen, yields the
 * name.
 *
 * Declared here rather than beside `assemble`, because [P3.0] put it on the
 * record: `ModelCall.purpose` is the committed half of
 * [testing §1](../../../../docs/design/workplan/10-testing.md)'s invariant, and a
 * contract the record carries belongs with the contracts.
 */
export type CallPurpose = 'prose' | 'effects' | 'verdict';

/** A candidate the budgeter has ruled on — [02 §8]. */
export interface AssembledBlock {
  id: string;
  source: BlockSource;
  reason: string;
  role: 'system' | 'user' | 'assistant';
  text: string;
  tokens: number;
  included: boolean;
  /** Which budget rule dropped it. Absent when it was included. */
  droppedBy?: string;
  /**
   * Carried from the candidate, and the carrying is the point — [P3.0],
   * [testing §1](../../../../docs/design/workplan/10-testing.md). The invariant
   * *no advisory block ever appears in an effect-producing call* was enforced
   * at assembly and then unrecorded, so the gate could only test a proxy (a
   * guidance source kind) that an author-declared advisory text block slips
   * past. With the flag on the record, the invariant is expressible over a
   * committed turn. Absent means not advisory, as on `Candidate`.
   */
  advisory?: true;
}

/** [13 §1.5](../../../../docs/design/13-internal-contracts.md). */
export interface BudgetVerdict {
  /**
   * The window, and **where the number came from**. Presets carry absolute
   * ceilings from import, and a 4k number must not silently apply at 200k.
   */
  limit: { tokens: number; source: 'provider' | 'preset' | 'user' };
  /** Held back for the completion. */
  reserved: number;
  spent: number;
  /**
   * Ordered as considered. **Every block appears, including the included
   * ones** — a verdict listing only drops cannot answer "what falls out next".
   */
  decisions: {
    blockId: string;
    tokens: number;
    included: boolean;
    /** The rule, in the language the workbench shows. */
    rule: string;
  }[];
  /**
   * What would drop on the next turn at current pressure. The UI promises this
   * is answerable *before* it happens, which requires computing it.
   */
  nextToDrop: string[];
}
