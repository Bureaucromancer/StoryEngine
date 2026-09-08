// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  findTag,
  folderOf,
  isAdopted,
  newTagRegistry,
  normaliseTagName,
  readTagRegistry,
  resolveTagNames,
  sameTag,
  TAG_REGISTRY_SCHEMA,
  tagById,
  type TagEntry,
} from './tags.js';

/**
 * The tag registry's vocabulary — [25](../../../docs/design/25-tagging.md).
 *
 * The subject throughout is **tolerance**. This document is hand-editable by
 * design, like everything else in the data directory, and what it holds is
 * decoration: a reader that threw would take the whole tag surface down over
 * somebody's typo in a colour name. So nearly every test below is a malformed
 * input with a defined, quiet answer.
 */

function entry(over: Partial<TagEntry> = {}): TagEntry {
  return {
    id: 'tag-1',
    name: 'noir',
    swatch: null,
    sortOrder: 0,
    folder: 'none',
    hidden: false,
    createdAt: '2026-09-08T00:00:00Z',
    ...over,
  };
}

describe('a tag name', () => {
  it('is trimmed and has its internal whitespace collapsed', () => {
    expect(normaliseTagName('  post   waterloo  ')).toBe('post waterloo');
  });

  /**
   * **Case is the author's.** Folding it here would make the registry decide
   * how names look, which is the one thing [25 §2] says it may not do — and it
   * would silently rewrite `NPC` to `npc` on the way to disk.
   */
  it('keeps the case it was written in', () => {
    expect(normaliseTagName('NPC')).toBe('NPC');
    expect(normaliseTagName('Napoleonic')).toBe('Napoleonic');
  });
});

describe('two names being the same tag', () => {
  it('ignores case, because a person means one tag', () => {
    expect(sameTag('noir', 'Noir')).toBe(true);
    expect(sameTag('NPC', 'npc')).toBe(true);
  });

  it('ignores the whitespace normalisation would have removed', () => {
    expect(sameTag(' noir ', 'noir')).toBe(true);
  });

  /**
   * Accents stay significant. `resumé` and `resume` are different words, and a
   * comparison that folded them would merge two tags nobody asked to merge.
   */
  it('does not fold accents', () => {
    expect(sameTag('resumé', 'resume')).toBe(false);
  });

  it('still tells different tags apart', () => {
    expect(sameTag('noir', 'noire')).toBe(false);
  });
});

describe('reading a registry off disk', () => {
  it('accepts one it wrote', () => {
    const registry = { schema: TAG_REGISTRY_SCHEMA, tags: [entry()] };

    expect(readTagRegistry(JSON.parse(JSON.stringify(registry)))).toEqual(registry);
  });

  it('reads anything that is not a document as an empty one', () => {
    expect(readTagRegistry(null)).toEqual(newTagRegistry());
    expect(readTagRegistry([])).toEqual(newTagRegistry());
    expect(readTagRegistry('tags')).toEqual(newTagRegistry());
    expect(readTagRegistry({})).toEqual(newTagRegistry());
    expect(readTagRegistry({ tags: 'noir' })).toEqual(newTagRegistry());
  });

  /**
   * **One bad row costs one row.** The alternative — refusing the document —
   * would mean a single hand-edit mistake greyed out every chip in the library,
   * which is a much larger consequence than the mistake.
   */
  it('drops a row it cannot read and keeps the rest', () => {
    const read = readTagRegistry({
      tags: [entry({ id: 'tag-1', name: 'noir' }), null, { id: 'tag-2' }, { name: 'nameless' }, 7],
    });

    expect(read.tags.map((tag) => tag.name)).toEqual(['noir']);
  });

  it('drops a row whose name is only whitespace', () => {
    expect(readTagRegistry({ tags: [entry({ name: '   ' })] }).tags).toEqual([]);
  });

  /**
   * The case a list makes possible and a map would have hidden. Both rows stay
   * in the file for whoever wrote them to see; the app acts on one.
   */
  it('keeps the first of two rows that are the same tag', () => {
    const read = readTagRegistry({
      tags: [entry({ id: 'a', name: 'noir' }), entry({ id: 'b', name: 'Noir' })],
    });

    expect(read.tags.map((tag) => tag.id)).toEqual(['a']);
  });

  it('keeps the first of two rows sharing an id, even under different names', () => {
    const read = readTagRegistry({
      tags: [entry({ id: 'a', name: 'noir' }), entry({ id: 'a', name: 'city' })],
    });

    expect(read.tags.map((tag) => tag.name)).toEqual(['noir']);
  });

  it('fills in what a partial row left out, rather than refusing it', () => {
    const read = readTagRegistry({ tags: [{ id: 'tag-1', name: 'noir' }] });

    expect(read.tags[0]).toEqual({
      id: 'tag-1',
      name: 'noir',
      swatch: null,
      sortOrder: 0,
      folder: 'none',
      hidden: false,
      createdAt: '',
    });
  });

  it('normalises the name on the way in', () => {
    expect(readTagRegistry({ tags: [entry({ name: '  post  waterloo ' })] }).tags[0]?.name).toBe(
      'post waterloo',
    );
  });

  it('stamps the schema it understands, whatever the file claimed', () => {
    expect(readTagRegistry({ schema: 'storyengine.tags/99', tags: [] }).schema).toBe(
      TAG_REGISTRY_SCHEMA,
    );
  });
});

/**
 * Open strings, read through helpers — [25 §4], and the rule
 * [10 §8.2](../../../docs/design/10-schemas.md) generalises: a portable enum is
 * a documented string, not an `enum`, unless the engine cannot proceed without
 * understanding it. Nothing proceeds on a swatch or a folder mode.
 */
describe('a value this build has never heard of', () => {
  it('reads an unknown folder mode as no folder', () => {
    expect(folderOf(entry({ folder: 'carousel' }))).toBe('none');
    expect(folderOf(entry({ folder: 'open' }))).toBe('open');
    expect(folderOf(entry({ folder: 'closed' }))).toBe('closed');
  });

  it('keeps an unknown swatch rather than discarding it', () => {
    // Kept, not dropped: a newer build wrote it, and blanking the field here
    // would lose the author's choice on the way through an older one.
    expect(readTagRegistry({ tags: [entry({ swatch: 'chartreuse' })] }).tags[0]?.swatch).toBe(
      'chartreuse',
    );
  });
});

describe('looking a tag up', () => {
  const registry = readTagRegistry({
    tags: [entry({ id: 'a', name: 'noir' }), entry({ id: 'b', name: 'City' })],
  });

  it('finds one by name, whatever case it was asked about', () => {
    expect(findTag(registry, 'NOIR')?.id).toBe('a');
    expect(findTag(registry, 'city')?.id).toBe('b');
  });

  it('finds one by id', () => {
    expect(tagById(registry, 'b')?.name).toBe('City');
  });

  /**
   * **Null, not a throw, and not a minted entry.** A tag an object carries with
   * no registry row is [25 §2]'s invariant 4 — normal, not an error — so the
   * lookup has to have a quiet answer for it.
   */
  it('answers null for a tag it does not know', () => {
    expect(findTag(registry, 'napoleonic')).toBeNull();
    expect(tagById(registry, 'nope')).toBeNull();
  });
});

/**
 * Resolution — [25 §3](../../../docs/design/25-tagging.md), and the rule that
 * lets a name copy lag safely behind a rename.
 *
 * Every case here is a way the two arrays can disagree, because that is the
 * whole risk of carrying identity and readability in two fields.
 */
describe('resolving an object tag names', () => {
  const registry = readTagRegistry({
    tags: [entry({ id: 'a', name: 'Noir' }), entry({ id: 'b', name: 'City' })],
  });

  /**
   * The state every object is in until it is adopted. Its names are the truth,
   * which is what lets an un-adopted library go on working exactly as it did.
   */
  it('leaves an unadopted object alone', () => {
    expect(resolveTagNames(['noir', 'city'], undefined, registry)).toEqual(['noir', 'city']);
    expect(isAdopted(undefined)).toBe(false);
  });

  it('tells an empty adoption apart from no adoption', () => {
    expect(isAdopted([])).toBe(true);
    expect(resolveTagNames([], [], registry)).toEqual([]);
  });

  /** The point of the whole arrangement: a rename reaches the object with no write. */
  it('answers with the registry name, not the stored one', () => {
    expect(resolveTagNames(['noir', 'city'], ['a', 'b'], registry)).toEqual(['Noir', 'City']);
  });

  /**
   * Invariant 4. An entry somebody deleted must not take the tag with it, so
   * the name sitting beside the id is the fallback.
   */
  it('falls back to the stored name for an id the registry has lost', () => {
    expect(resolveTagNames(['noir', 'ronin'], ['a', 'gone'], registry)).toEqual(['Noir', 'ronin']);
  });

  /**
   * A hand edit to one array and not the other. The readable copy wins: it is
   * what a person was looking at, and guessing at an alignment that is visibly
   * broken is how a tag silently becomes a different tag.
   */
  it('prefers the readable copy when the two arrays disagree in length', () => {
    expect(resolveTagNames(['noir', 'city'], ['a'], registry)).toEqual(['noir', 'city']);
    expect(resolveTagNames(['noir'], ['a', 'b'], registry)).toEqual(['noir']);
  });

  it('drops a position that resolves to nothing at all', () => {
    expect(resolveTagNames(['', 'city'], ['gone', 'b'], registry)).toEqual(['City']);
  });
});
