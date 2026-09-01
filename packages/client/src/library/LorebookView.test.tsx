// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newLoreEntry, newLorebook, type LoreEntry, type LoreFolder } from '@storyengine/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { LorebookView, lorebookShape } from './LorebookView.js';

/**
 * The book as a document — [05 §5.3], and P5.0's half of the exit gate.
 *
 * **The assertion the stage is about is the second block**: an entry that will
 * not fire says *which* of the three ways it is off, and the folder case leaves
 * the entry's own `enabled` visibly unchanged. Gate step 2 is exactly that, and
 * the schema is explicit that a folder gate leaves each entry's switch
 * *preserved rather than mutated* — so a surface that showed the entry as
 * switched off would be showing something the file does not say.
 *
 * The queries walk the rendered unit rather than the whole document, because a
 * book repeats nearly every string it contains: an entry's name is its heading
 * and its `Name` field in the fold, and *off* is a word in three sentences.
 */

/** The entry field whose value gate step 2 is about. A constant, not a literal
 * at the comparison: the rule against branching on displayed text is right, and
 * a label read out of the DOM is displayed text even in a test. */
const ENABLED = 'Enabled';

function folder(id: string, over: Partial<LoreFolder> = {}): LoreFolder {
  return { id, name: id, parentFolderId: null, enabled: true, order: 0, ...over };
}

function entry(name: string, over: Partial<LoreEntry> = {}): LoreEntry {
  return { ...newLoreEntry(name), ...over };
}

function book(over: Partial<ReturnType<typeof newLorebook>> = {}) {
  return { ...newLorebook('Ardent'), ...over };
}

/** The card for one entry, found by its heading. */
function unitFor(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name, level: 3 });
  const card = heading.closest('div.rounded-panel');
  if (card === null) throw new Error(`no unit rendered for ${name}`);
  return card as HTMLElement;
}

describe('an entry as a readable unit', () => {
  it('shows what an author wrote, with the keys as an index row', () => {
    render(
      <LorebookView
        book={book({
          entries: [
            entry('Harbour', {
              keys: ['harbour', 'docks'],
              description: 'Where the ships come in.',
              content: 'Cranes stand over the water.',
              tag: 'location',
            }),
          ],
        })}
      />,
    );

    const unit = unitFor('Harbour');
    expect(unit.textContent).toContain('Where the ships come in.');
    expect(unit.textContent).toContain('Cranes stand over the water.');
    expect([...unit.querySelectorAll('li')].map((node) => node.textContent)).toEqual([
      'harbour',
      'docks',
    ]);
    expect(unit.textContent).toContain('location');
  });

  /**
   * The premise of the whole section is that these are documents, so the body
   * opens clamped and readable rather than as a row in a table — and the clamp
   * is a class, because jsdom computes no layout.
   */
  it('opens clamped, and expands', async () => {
    const user = userEvent.setup();
    render(
      <LorebookView book={book({ entries: [entry('Harbour', { content: 'Long prose.' })] })} />,
    );

    const body = (): Element | null => unitFor('Harbour').querySelector('p.whitespace-pre-wrap');
    expect(body()?.className).toContain('line-clamp-6');

    await user.click(screen.getByRole('button', { name: 'Show all' }));

    expect(body()?.className).not.toContain('line-clamp-6');
  });

  it('folds every remaining field beneath, in the schema’s own groups', () => {
    render(<LorebookView book={book({ entries: [entry('Harbour', { content: 'Cranes.' })] })} />);

    const unit = unitFor('Harbour');
    const labels = [...unit.querySelectorAll('dt')].map((node) => node.textContent);

    // The fold carries what the unit above it did not.
    expect(labels).toContain('Secondary keys');
    // `h4`, not `h3`: these groups are inside the entry whose name is the h3.
    expect([...unit.querySelectorAll('h4')].map((node) => node.textContent)).toContain('Matching');
    // And does not repeat what it did.
    expect(labels).not.toContain('Content');
    expect(labels).not.toContain('Keys');
  });
});

describe('an entry that is off says which way', () => {
  it('names the entry’s own switch', () => {
    render(<LorebookView book={book({ entries: [entry('Harbour', { enabled: false })] })} />);

    expect(unitFor('Harbour').textContent).toContain('off');
  });

  it('names the book', () => {
    render(<LorebookView book={book({ enabled: false, entries: [entry('Harbour')] })} />);

    expect(unitFor('Harbour').textContent).toContain('off: the book is off');
  });

  /**
   * Gate step 2, both halves. The folder is named rather than merely referred
   * to — the design's words are "off: its folder is off", and naming it is
   * strictly more useful without inventing vocabulary — and the entry's own
   * switch is still visibly on in the fold, because the gate preserves it.
   */
  it('names the folder, and leaves the entry’s own switch reading on', () => {
    render(
      <LorebookView
        book={book({
          folders: [folder('timeline', { name: 'Timeline B', enabled: false })],
          entries: [entry('Harbour', { folderId: 'timeline' })],
        })}
      />,
    );

    const unit = unitFor('Harbour');
    expect(unit.textContent).toContain('off: the folder Timeline B is off');

    const label = [...unit.querySelectorAll('dt')].find((node) => node.textContent === ENABLED);
    expect(label?.nextElementSibling?.textContent).toBe('Yes');
  });

  it('says nothing at all about an entry with nothing shut in its way', () => {
    render(<LorebookView book={book({ entries: [entry('Harbour')] })} />);

    expect(unitFor('Harbour').textContent).not.toContain('off:');
  });
});

describe('the folders panel', () => {
  it('heads its column with the schema’s own word and counts what each governs', () => {
    render(
      <LorebookView
        book={book({
          folders: [folder('timeline', { name: 'Timeline B', enabled: false })],
          entries: [entry('Harbour', { folderId: 'timeline' }), entry('Docks')],
        })}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Gate' })).toBeTruthy();
    const row = screen.getByRole('cell', { name: 'Timeline B' }).closest('tr');
    expect(row?.textContent).toContain('Off');
    expect(row?.textContent).toContain('1');
  });

  /**
   * §5.3: `folderId: null` gets a real node "because a nullable field that
   * renders as nothing hides entries".
   */
  it('gives the ungrouped entries a row of their own', () => {
    render(
      <LorebookView book={book({ folders: [folder('timeline')], entries: [entry('Docks')] })} />,
    );

    expect(screen.getByRole('cell', { name: 'Ungrouped' })).toBeTruthy();
  });

  it('is absent from a book that has no folders at all', () => {
    render(<LorebookView book={book({ entries: [entry('Docks')] })} />);

    expect(screen.queryByRole('columnheader', { name: 'Gate' })).toBeNull();
  });
});

describe('the book’s own header', () => {
  it('counts the entries and how many are off, which no surface has shown', () => {
    render(
      <LorebookView
        book={book({
          folders: [folder('timeline', { enabled: false })],
          entries: [
            entry('A'),
            entry('B', { enabled: false }),
            entry('C', { folderId: 'timeline' }),
          ],
        })}
      />,
    );

    expect(screen.getByText('3 entries, 2 off')).toBeTruthy();
  });

  it('drops the second half when nothing is off', () => {
    render(<LorebookView book={book({ entries: [entry('A')] })} />);

    expect(screen.getByText('1 entries')).toBeTruthy();
  });

  /**
   * [02 §3.1]'s *each flag is a direct UI control* is satisfied by reachable,
   * not by prominent — so the tuning is present and quiet rather than absent.
   */
  it('carries the book’s activation settings as one quiet strip', () => {
    render(<LorebookView book={book({ tokenBudget: 4096, entries: [] })} />);

    // Queried rather than compared: the label is displayed text, and the lint
    // rule that forbids branching on it is right — a test that switched on a
    // sentence would change what it checked the day the sentence was
    // translated.
    expect(screen.getByText('Token budget').nextElementSibling?.textContent).toBe('4,096');
  });
});

describe('a book this build cannot read', () => {
  it('is refused by the guard rather than rendered as one', () => {
    expect(lorebookShape({ entries: [], folders: [] })).toBeNull();
    expect(lorebookShape({ entries: 'not a list', folders: [] })).toBe(
      'its "entries" is not a list',
    );
    expect(lorebookShape({ entries: [null], folders: [] })).toBe('an entry is not an object');
  });
});

describe('the load the page exists for', () => {
  /**
   * Gate step 1's *three-hundred-entry imported book*, as the load rather than
   * as the corpus: §1.6 settles that a synthesised book of that size exercises
   * the layout and the address exactly as an authored one would, and that only
   * step 6 — is this a document or a form — needs books somebody else wrote.
   */
  it('renders a three-hundred-entry book', () => {
    const entries = Array.from({ length: 300 }, (_, index) =>
      entry(`Entry ${String(index)}`, { content: 'Prose.' }),
    );
    render(<LorebookView book={book({ entries })} />);

    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(300);
    expect(screen.getByText('300 entries')).toBeTruthy();
  });
});
