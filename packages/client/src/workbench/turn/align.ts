// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { AssembledBlock } from '@storyengine/shared';

/**
 * Two turns' block tables, paired by block id — [P3.6], and the one piece of
 * new logic the compare view needs.
 *
 * **The existing object differ cannot do this, and would be silently wrong if
 * asked to.** `diffObjects` pairs arrays *by index* ([10 §11.2a]'s field-level
 * diff, which is right for what it does), so a single dropped block shifts
 * every later position and the comparison reports the whole tail as changed.
 * A rendering that looks plausible and is false is the worst outcome available
 * to a phase whose thesis is honest records, which is why [P3 §1.5] names this
 * as a mechanical requirement rather than a preference.
 *
 * **Ids are what make the pairing meaningful, and they are stable on purpose.**
 * A history block's id is keyed by the id of the turn it came *from*
 * (`se.history.<turnId>.<part>`, minted in the collector), not by its position
 * in the window — a repair P3.0 made precisely so that a comparison stays
 * right past the twentieth turn, when the window starts sliding and positions
 * stop meaning anything.
 *
 * Order is the left side's, because that is the order the budgeter considered
 * — blocks only on the right are appended in theirs, so nothing is hidden and
 * nothing is invented.
 */
export interface AlignedBlock {
  id: string;
  /** Absent when this block was not in the left turn at all. */
  before: AssembledBlock | undefined;
  /** Absent when it is not in the right turn. */
  after: AssembledBlock | undefined;
}

export function alignBlocks(
  before: readonly AssembledBlock[],
  after: readonly AssembledBlock[],
): AlignedBlock[] {
  const rightById = new Map(after.map((block) => [block.id, block]));
  const aligned: AlignedBlock[] = before.map((block) => ({
    id: block.id,
    before: block,
    after: rightById.get(block.id),
  }));

  const seen = new Set(before.map((block) => block.id));
  for (const block of after) {
    if (seen.has(block.id)) continue;
    aligned.push({ id: block.id, before: undefined, after: block });
  }

  return aligned;
}

/**
 * What changed about one block, as a class rather than a sentence — the same
 * posture every other classified thing in this codebase takes.
 *
 * `ruling` is deliberately its own answer rather than folded into `changed`.
 * A history block's ruling carries its priority, and that priority is its
 * position in the window, so once a session passes the window's length the
 * *same* block legitimately reports a different ruling in two adjacent turns
 * without anybody having touched anything. Naming that case is what stops the
 * view claiming an edit nobody made.
 */
export type BlockChange = 'same' | 'ruling' | 'changed' | 'added' | 'removed';

export function changeOf(
  aligned: AlignedBlock,
  beforeRule: string | undefined,
  afterRule: string | undefined,
): BlockChange {
  if (aligned.before === undefined) return 'added';
  if (aligned.after === undefined) return 'removed';

  if (
    aligned.before.text !== aligned.after.text ||
    aligned.before.included !== aligned.after.included ||
    aligned.before.tokens !== aligned.after.tokens ||
    pictureChanged(aligned.before.image, aligned.after.image)
  ) {
    return 'changed';
  }

  return beforeRule === afterRule ? 'same' : 'ruling';
}

/**
 * ***A different picture is a change, whatever the words say*** — [26 E15].
 * Two uncaptioned pictures read the same (*[Picture]*), cost the same, and are
 * different pixels; and one picture held for two different reasons is two
 * different answers to *did the model see it*.
 */
function pictureChanged(
  before: AssembledBlock['image'] | undefined,
  after: AssembledBlock['image'] | undefined,
): boolean {
  return (
    (before?.digest ?? null) !== (after?.digest ?? null) ||
    before?.sent !== after?.sent ||
    before?.withheld !== after?.withheld
  );
}
