// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { BlockSource } from '@storyengine/shared';

/**
 * The assembly contracts — [03 §8](../../../../docs/design/03-data-model.md),
 * [21 §1.1 and §1.5](../../../../docs/design/21-internal-contracts.md).
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
  BlockImage,
  BlockSource,
  BudgetLimit,
  BudgetVerdict,
  CallPurpose,
  NotFilledReason,
  NotFilledSlot,
} from '@storyengine/shared';

/**
 * `BlockSource` minus the ~~two~~ ~~three~~ four a slot cannot name — a derivation rather
 * than a second list.
 *
 * A slot positions content the engine produces, so it can never point at the
 * preset's own prose (that *is* a block) or at a step's contribution (which did
 * not exist when the preset was authored) — ***or, since [P13.2], at the round
 * so far***, which the engine places after the input slot of every pack rather
 * than wherever a pack remembered to put it — ***or, since [P13.3], at the
 * author's note***, which the engine places at the session's own depth.
 */
export type SlotSource = Exclude<
  BlockSource,
  { kind: 'preset' } | { kind: 'step' } | { kind: 'round' } | { kind: 'note' }
>;

/**
 * `Candidate` moved to `@storyengine/sdk` at [P7.0] — a step returns them, so a
 * mode package has to be able to name the type. Re-exported here so the
 * pipeline's import paths stay put, exactly as the record's shapes are above.
 *
 * **The docstring that said this one "never leaves the server" was true of the
 * value and wrong about the type.** What never leaves is the *pre-verdict*
 * candidate as data — it is not on the record, and `AssembledBlock` is what the
 * workbench reads. The declaration has to travel, because a step author writes
 * against it.
 */
export type { Candidate, CandidateImage } from '@storyengine/sdk';
