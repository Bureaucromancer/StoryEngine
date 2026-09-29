// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { Draft } from './book-form.js';
import { blocksOf, reapplyPresetEdits, type Block } from './preset-form.js';

/**
 * ***The preset's 412 merge, three ways*** (2026-09-27).
 *
 * It walked the newer version's blocks and asked only *did I edit this one*,
 * which could not tell a block I had deleted from one I had never touched —
 * every deletion came back — and it kept their order whatever I had done. It
 * is the lorebook's walk now (`mergeKeyed`, `reorderedIn`, `inOrderOf`), and
 * each case below is one that walk answers differently from a walk over theirs.
 */

function block(id: string, template = id): Block {
  return { id, kind: 'text', template };
}

function pack(blocks: Block[], name = 'House style'): Draft {
  return { id: 'pack', name, blocks };
}

const ids = (draft: Draft): string[] => blocksOf(draft).map((one) => one.id);

describe('reapplying my edits onto a newer pack', () => {
  it('keeps a block I deleted deleted, and a block they added', () => {
    const pristine = pack([block('a'), block('b'), block('c')]);
    const mine = pack([block('a'), block('c')]);
    const theirs = pack([block('a'), block('b'), block('c'), block('d')]);

    expect(ids(reapplyPresetEdits(pristine, mine, theirs))).toEqual(['a', 'c', 'd']);
  });

  it('keeps my arrangement, with their edit to a block I only moved', () => {
    const pristine = pack([block('a'), block('b'), block('c')]);
    const mine = pack([block('c'), block('a'), block('b')]);
    const theirs = pack([block('a'), block('b', 'Their words.'), block('c')]);

    const merged = reapplyPresetEdits(pristine, mine, theirs);

    expect(ids(merged)).toEqual(['c', 'a', 'b']);
    expect(blocksOf(merged).find((one) => one.id === 'b')?.['template']).toBe('Their words.');
  });

  it('takes their order when I moved nothing', () => {
    const pristine = pack([block('a'), block('b')]);
    const mine = pack([block('a', 'Mine.'), block('b')]);
    const theirs = pack([block('b'), block('x'), block('a')]);

    const merged = reapplyPresetEdits(pristine, mine, theirs);

    expect(ids(merged)).toEqual(['b', 'x', 'a']);
    expect(blocksOf(merged).find((one) => one.id === 'a')?.['template']).toBe('Mine.');
  });

  /** The one behaviour this changes on purpose: my work is kept over their delete. */
  it('keeps a block I edited that they deleted', () => {
    const pristine = pack([block('a'), block('b')]);
    const mine = pack([block('a'), block('b', 'Mine.')]);
    const theirs = pack([block('a')]);

    const merged = reapplyPresetEdits(pristine, mine, theirs);

    expect(ids(merged)).toEqual(['a', 'b']);
    expect(blocksOf(merged).find((one) => one.id === 'b')?.['template']).toBe('Mine.');
  });

  it('lets their delete stand for a block I never touched', () => {
    const pristine = pack([block('a'), block('b')]);
    const mine = pack([block('a'), block('b')], 'Renamed');
    const theirs = pack([block('a')]);

    const merged = reapplyPresetEdits(pristine, mine, theirs);

    expect(ids(merged)).toEqual(['a']);
    expect(merged['name']).toBe('Renamed');
  });
});
