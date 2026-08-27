// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { BlockSource } from '@storyengine/shared';

/**
 * The assembly contracts — [02 §8](../../../../docs/design/02-data-model.md),
 * [13 §1.1 and §1.5](../../../../docs/design/13-internal-contracts.md).
 *
 * **The record-crossing shapes live in `@storyengine/shared` since [P3.0]**
 * (`packages/shared/src/turn.ts`, with the contracts' documentation): what
 * the assembler writes onto the record is what the client's workbench reads,
 * and one declaration is what keeps the two ends one vocabulary. Re-exported
 * here so the pipeline's import paths stay put. What stays in this module is
 * what never leaves the server: the pre-verdict `Candidate`, and the
 * slot-side derivation of `BlockSource`.
 */
export type {
  AssembledBlock,
  BlockSource,
  BudgetLimit,
  BudgetVerdict,
  CallPurpose,
  NotFilledReason,
  NotFilledSlot,
} from '@storyengine/shared';

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
   * Enforced structurally rather than by convention: `assemble` refuses to
   * admit an advisory block to a call declared as producing effects or
   * verdicts.
   */
  advisory?: boolean;
}
