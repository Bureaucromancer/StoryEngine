// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { inOrderOf, mergeKeyed, reorderedIn, type Draft } from './book-form.js';

/**
 * The preset editor's form, which is the object — [P7B.1].
 *
 * **The lorebook's shape, not the actor's**, and the reason is the same one:
 * a preset is a list of blocks with a dozen fields apiece, and projecting that
 * into named form state would be writing out the schema a second time in
 * TypeScript. The draft is a structural clone of the file, edits are made
 * against it directly, and [04 §2](../../../../docs/design/04-schemas.md)'s
 * unknown-field rule holds by never having taken the object apart — which
 * matters more here than anywhere, because `Preset` is at `/0` with four
 * things still unsettled and a preset written by a later build is a thing this
 * one has to round-trip without understanding.
 */

/** A block, as far as anything here needs to know. */
export interface Block extends Record<string, unknown> {
  id: string;
  label?: string;
  kind?: string;
}

/**
 * Why this object cannot back the preset form, or null — the crash guard.
 *
 * Checks exactly what the editor dereferences and no more. The product invites
 * the input that breaks it: hand-writing preset JSON has been the *only* way to
 * set a slot's outlet since P5, so files edited by hand are not an edge case
 * here, they are the population this editor exists to retire.
 */
export function presetFormShape(object: Record<string, unknown>): string | null {
  if (typeof object['name'] !== 'string') return 'its "name" is not a string';
  if (!Array.isArray(object['blocks'])) return 'its "blocks" is not a list';
  for (const block of object['blocks'] as unknown[]) {
    if (typeof block !== 'object' || block === null) return 'a block is not an object';
    if (typeof (block as Record<string, unknown>)['id'] !== 'string')
      return 'a block has no "id" string';
  }
  return null;
}

export function blocksOf(draft: Draft): Block[] {
  return Array.isArray(draft['blocks']) ? (draft['blocks'] as Block[]) : [];
}

export function nameOfPreset(draft: Draft): string {
  return typeof draft['name'] === 'string' ? draft['name'] : '';
}

/** A draft with one block's fields patched. Never mutates what it was given. */
export function withBlock(draft: Draft, id: string, patch: Record<string, unknown>): Draft {
  const next = structuredClone(draft);
  next['blocks'] = blocksOf(next).map((block) =>
    block.id === id ? { ...block, ...patch } : block,
  );
  return next;
}

/**
 * A draft with one block's `source` fields patched — the slot half.
 *
 * Separate from {@link withBlock} because `source` is a nested object and a
 * caller spreading it by hand is a caller that can drop `kind`, which is the
 * one field the assembler dispatches on.
 */
export function withBlockSource(draft: Draft, id: string, patch: Record<string, unknown>): Draft {
  const next = structuredClone(draft);
  next['blocks'] = blocksOf(next).map((block) => {
    if (block.id !== id) return block;
    const source =
      typeof block['source'] === 'object' && block['source'] !== null ? block['source'] : {};
    return { ...block, source: { ...(source as Record<string, unknown>), ...patch } };
  });
  return next;
}

export function withoutBlock(draft: Draft, id: string): Draft {
  const next = structuredClone(draft);
  next['blocks'] = blocksOf(next).filter((block) => block.id !== id);
  return next;
}

/**
 * Move `id` to sit before `beforeId`, or to the end when that is null.
 *
 * The entry list's `moveEntryBefore` in miniature, and the same rule: the moved
 * item is removed first and then inserted, so a move onto a neighbour is not a
 * no-op that silently depends on which side of the list it came from.
 */
export function moveBlockBefore(draft: Draft, id: string, beforeId: string | null): Draft {
  const next = structuredClone(draft);
  const blocks = blocksOf(next);
  const moving = blocks.find((block) => block.id === id);
  if (moving === undefined) return draft;
  const without = blocks.filter((block) => block.id !== id);
  const at = beforeId === null ? without.length : without.findIndex((b) => b.id === beforeId);
  without.splice(at < 0 ? without.length : at, 0, moving);
  next['blocks'] = without;
  return next;
}

/** True when saving `draft` over `base` would change anything. */
export function presetChanges(base: Record<string, unknown>, draft: Draft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(base);
}

/**
 * The 412 merge — block by block, the way the lorebook merges entry by entry.
 *
 * **Not a whole-draft overwrite.** The 412's first offer means *my edits*, and
 * a block the user never touched must take the newer version's value or the
 * reload eats the concurrent change it refused to overwrite. ~~Blocks the newer
 * version does not have are dropped: it deleted them, and reinstating one is a
 * change nobody made.~~
 *
 * ***The lorebook's three-way walk, not a walk over theirs alone*** (2026-09-27).
 * This merge walked the newer version's blocks and asked only *did I edit this
 * one*, which could not tell a block I had deleted from one I had never
 * touched: every deletion came back on reload-and-reapply. And it kept their
 * order whatever I had done, so rearranging a pack and losing the race put the
 * arrangement back without a word. `mergeKeyed` is the lorebook's answer to the
 * first — `pristine` says whether a block missing from mine was deleted by me
 * or added by them — and `reorderedIn`/`inOrderOf` its answer to the second.
 *
 * *One behaviour this changes on purpose*: a block I edited and they deleted is
 * now kept, where it was dropped — at the end, or in my place if I reordered.
 * Dropping it discarded my work to honour theirs; keeping it keeps both, and the
 * deletion is one click to make again.
 */
export function reapplyPresetEdits(pristine: Draft, draft: Draft, fresh: Draft): Draft {
  const merged = structuredClone(fresh);
  const blocks = mergeKeyed(
    blocksOf(pristine),
    blocksOf(draft),
    blocksOf(fresh),
    (was, held, theirs) =>
      was !== undefined && JSON.stringify(was) === JSON.stringify(held) ? theirs : held,
  );
  merged['blocks'] = reorderedIn(blocksOf(pristine), blocksOf(draft))
    ? inOrderOf(blocks, blocksOf(draft))
    : blocks;

  // Top-level fields follow the same rule, one level up.
  for (const key of Object.keys(draft)) {
    if (key === 'blocks') continue;
    const untouched = JSON.stringify(pristine[key]) === JSON.stringify(draft[key]);
    if (!untouched) merged[key] = draft[key];
  }
  return merged;
}
