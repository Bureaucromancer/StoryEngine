// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Preset } from '@storyengine/shared';
import type { Mode } from '@storyengine/sdk';

/**
 * ***A session on its mode's own pack gains what the mode ships later***
 * (2026-09-27) — [03 §8], [P7B §1.1].
 *
 * A session copies its pack at creation, so that editing a preset in the
 * library never rewrites a game in progress, and nothing ever brought a copy
 * up to date. That was right for a library preset and wrong for the mode's
 * own: every block a mode shipped after a session began stayed out of that
 * session for good, and the blocks the engine has added since the first alpha
 * are the ones later machinery keys on. A session begun on alpha.1 has no
 * summary slot, so its chain is never computed and the story above the window
 * reaches no prompt; no pacing levels, so its hooks come with no pacing prose;
 * no goal slot, so the judge is paid for a goal the narrator is never told;
 * and, until alpha.3, no slot for lore placed after the characters, so those
 * entries were matched and then dropped as unplaced. The only remedy was
 * *Switch to the mode's own*, which throws away every edit made to the copy.
 *
 * **What follows is additions, by presence.** A copy that carries the mode's
 * own id gains each shipped block whose id it lacks — at the shipped position,
 * after the nearest shipped block it does have — each of the three level
 * lists it has none of, and the push texts ([P13.5b]) when it has none.
 * Nothing it has is touched: a block switched off stays off, an edited block
 * keeps the edit, and a library preset, whose id is its own, is never read
 * against a mode at all. *Presence is the whole test*, and
 * it is exact for what the product can do to a copy, because nothing in it
 * deletes a block from one — the panel edits a block in place, and a switch
 * replaces the whole pack. A block that is missing was therefore shipped after
 * the copy was made. (A hand edit to `session.json`, or a client of the preset
 * route, that deletes a shipped block will find it back: switching it off is
 * how a copy keeps one out, and the only way a copy can say so without a
 * record of what it was copied with.)
 *
 * **Changes to a block a copy already has do not follow**, and that is the
 * other half, still open: telling an unedited block from an edited one needs a
 * digest per block recorded at the copy, which sessions do not carry yet. Until
 * then a changed shipped block reaches new sessions only, and the release notes
 * say so where it matters.
 *
 * *Applied where the pack is read, never written back.* The gather, the
 * session's reply and its dials all read it through here, so the panel shows
 * the blocks the turn assembles from and can switch one off — and the file on
 * disk changes only when somebody edits the pack, which writes what they saw.
 */
export function presetOf(stored: Preset | undefined, mode: Mode): Preset {
  const shipped = mode.definition.assembly.defaultPreset;
  if (stored === undefined) return shipped;
  if (stored.id !== shipped.id) return stored;

  const have = new Set(stored.blocks.map((block) => block.id));
  const missing = shipped.blocks.some((block) => !have.has(block.id));
  const levels = LEVEL_LISTS.filter(
    (field) => stored[field] === undefined && shipped[field] !== undefined,
  );
  // The push texts ([P13.5b]) come the same way: by presence, whole.
  const push = stored.pushDirections === undefined && shipped.pushDirections !== undefined;
  if (!missing && levels.length === 0 && !push) return stored;

  const blocks = [...stored.blocks];
  shipped.blocks.forEach((block, at) => {
    if (have.has(block.id)) return;
    blocks.splice(afterNearest(blocks, shipped.blocks, at), 0, structuredClone(block));
    have.add(block.id);
  });

  const next: Preset = { ...stored, blocks };
  for (const field of levels) {
    const list = shipped[field];
    if (list !== undefined) next[field] = structuredClone(list);
  }
  if (push && shipped.pushDirections !== undefined) {
    next.pushDirections = structuredClone(shipped.pushDirections);
  }
  return next;
}

/** The three optional lists a pack's dials and pacing read their words from. */
const LEVEL_LISTS = ['difficultyLevels', 'directednessLevels', 'pacingLevels'] as const;

/**
 * Where a missing shipped block goes: straight after the nearest block before
 * it in the shipped order that the copy has, or first if the copy has none of
 * them. Declaration order is prompt order for every sequence block, so this is
 * the difference between a summary above the history and one below the input.
 */
function afterNearest(
  blocks: readonly Preset['blocks'][number][],
  shipped: readonly Preset['blocks'][number][],
  at: number,
): number {
  for (let back = at - 1; back >= 0; back -= 1) {
    const id = shipped[back]?.id;
    const found = blocks.findIndex((block) => block.id === id);
    if (found !== -1) return found + 1;
  }
  return 0;
}
