// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLorebook, newLoreEntry, type Lorebook, type LoreEntry } from '@storyengine/shared';

import { bookToMarkdown } from './book-document.js';

/**
 * ***Raw is a claim about the words, not about the layout*** —
 * [11 §3](../../../../docs/design/11-lorebooks-as-a-format.md),
 * [10 §5.3](../../../../docs/design/10-ui-surfaces.md), [P11.1].
 *
 * That sentence licenses exactly one thing and forbids exactly one thing, and
 * both are asserted below: the document **may re-arrange** — folders group, the
 * book's own order holds inside them — and it **may not re-word**, which means
 * an entry's `content` survives byte for byte. *A Markdown serialiser's usual
 * instinct is to escape*, and escaping somebody's corpus is re-wording it under
 * a different name.
 */

/**
 * ***`newLoreEntry` rather than a hand-written literal.*** `LoreEntry` has
 * thirty-odd fields and a fixture that spelled them all would go stale the
 * first time a default moved — which is the fixture-pair discipline applied to
 * a small case, and the reason `shared` ships factories at all.
 */
function entry(over: Partial<LoreEntry>): LoreEntry {
  return { ...newLoreEntry('An entry'), ...over };
}

function book(over: Partial<Lorebook>): Lorebook {
  return { ...newLorebook('The harbour'), entries: [], folders: [], ...over };
}

describe('the book as a document', () => {
  it('keeps content exactly as written, markup and all', () => {
    const content = '# Not a heading\n\n*emphasis the author typed*\n\n| a | b |';
    const markdown = bookToMarkdown(book({ entries: [entry({ name: 'The keeper', content })] }));
    expect(markdown).toContain(content);
  });

  it('groups by folder and keeps the book’s own order inside one', () => {
    const made = book({
      folders: [{ id: 'f1', name: 'The docks', enabled: true, order: 0, parentFolderId: null }],
      entries: [
        entry({ id: 'e1', name: 'Second', folderId: 'f1' }),
        entry({ id: 'e2', name: 'First', folderId: 'f1' }),
      ],
    });
    const markdown = bookToMarkdown(made);
    expect(markdown).toContain('## The docks');
    // The author's order, not an alphabetical one — [11 §3]'s *may re-arrange*
    // licenses the grouping and not an opinion about the sequence within it.
    expect(markdown.indexOf('### Second')).toBeLessThan(markdown.indexOf('### First'));
  });

  /**
   * The firing notes are the column test one level down: what answers *why did
   * this fire, or why did it not* without opening the app. A disabled entry is
   * the case a reader is most likely to be looking for.
   */
  it('says when an entry would not fire', () => {
    const markdown = bookToMarkdown(book({ entries: [entry({ enabled: false })] }));
    expect(markdown).toContain('disabled');
  });

  /**
   * ***The fence, and it is structural.*** §5.3: *"no JavaScript in the
   * output — no search box, no toggles, no collapse handlers. If it needs a
   * script it is an application, and the application is StoryEngine."* A
   * function returning a string has nowhere to put one, and this asserts the
   * consequence rather than the intention.
   */
  it('produces text and nothing executable', () => {
    const markdown = bookToMarkdown(
      book({ entries: [entry({ name: 'The keeper', content: 'Words.' })] }),
    );
    expect(markdown).not.toContain('<script');
    expect(markdown).not.toContain('onclick');
    expect(typeof markdown).toBe('string');
  });
});
