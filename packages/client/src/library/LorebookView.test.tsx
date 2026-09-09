// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newLoreEntry, newLorebook, type LoreEntry, type LoreFolder } from '@storyengine/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LorebookView, lorebookShape } from './LorebookView.js';

/**
 * The book as a document — [10 §5.3], and P5.0's half of the exit gate.
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

/**
 * Long enough that the six-line clamp bites.
 *
 * Written out rather than a short string, because the control that reveals the
 * rest is only offered where there *is* a rest — a *Show all* on a two-line
 * entry is a button that visibly does nothing, which is most entries in a real
 * book.
 */
const LONG = Array.from({ length: 9 }, (_, line) => `Line ${String(line)} of the prose.`).join(
  '\n',
);

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
    render(<LorebookView book={book({ entries: [entry('Harbour', { content: LONG })] })} />);

    const body = (): Element | null => unitFor('Harbour').querySelector('p.whitespace-pre-wrap');
    expect(body()?.className).toContain('line-clamp-6');

    await user.click(screen.getByRole('button', { name: 'Show all' }));

    expect(body()?.className).not.toContain('line-clamp-6');
  });

  /**
   * The other half of the same decision: where there is no rest to show, there
   * is no control offering to show it.
   */
  it('offers no expand on an entry short enough to be whole already', () => {
    render(
      <LorebookView book={book({ entries: [entry('Harbour', { content: 'Two words.' })] })} />,
    );

    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    expect(unitFor('Harbour').textContent).toContain('Two words.');
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
   * [03 §3.1]'s *each flag is a direct UI control* is satisfied by reachable,
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

/**
 * Narrowing a book — [10 §5.3]'s *search, which is two features at very
 * different prices*, and the cheap one.
 *
 * Within a book it is free: the detail route already holds the whole object, so
 * every one of these runs against what is on screen and asks the server
 * nothing. Gate step 3 is the first three tests — a key chip, a tag and a
 * folder each narrow the list.
 */
describe('narrowing a book', () => {
  const shelf = () =>
    book({
      folders: [folder('timeline', { name: 'Timeline B' })],
      entries: [
        entry('Harbour', {
          keys: ['docks'],
          tag: 'location',
          content: 'Cranes stand over the water.',
          folderId: 'timeline',
        }),
        entry('Vera', { keys: ['vera'], tag: 'person', content: 'She never looks up.' }),
      ],
    });

  const shown = (): string[] =>
    screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);

  it('narrows to the entries carrying a key, and the same chip is the way back', async () => {
    const user = userEvent.setup();
    render(<LorebookView book={shelf()} />);

    await user.click(screen.getByRole('button', { name: 'docks' }));
    expect(shown()).toEqual(['Harbour']);

    await user.click(screen.getByRole('button', { name: 'docks' }));
    expect(shown()).toEqual(['Harbour', 'Vera']);
  });

  it('narrows by a tag', async () => {
    const user = userEvent.setup();
    render(<LorebookView book={shelf()} />);

    await user.click(screen.getByRole('button', { name: 'person' }));

    expect(shown()).toEqual(['Vera']);
  });

  it('narrows by a folder, and by the ungrouped node', async () => {
    const user = userEvent.setup();
    render(<LorebookView book={shelf()} />);

    await user.click(screen.getByRole('button', { name: 'Timeline B' }));
    expect(shown()).toEqual(['Harbour']);

    await user.click(screen.getByRole('button', { name: 'Ungrouped' }));
    expect(shown()).toEqual(['Vera']);
  });

  it('searches the fields §5.3 lists, including the prose', async () => {
    const user = userEvent.setup();
    render(<LorebookView book={shelf()} />);

    await user.type(screen.getByLabelText('Search this book'), 'cranes');

    expect(shown()).toEqual(['Harbour']);
  });

  it('marks what it found, rather than only hiding what it did not', async () => {
    const user = userEvent.setup();
    render(<LorebookView book={shelf()} />);

    await user.type(screen.getByLabelText('Search this book'), 'cranes');

    const marks = [...document.querySelectorAll('mark')].map((node) => node.textContent);
    expect(marks).toContain('Cranes');
  });

  /**
   * A clamp that hides the words somebody just searched for is a search that
   * found something and then put it out of sight.
   */
  it('opens the entry whose prose answered the search', async () => {
    const user = userEvent.setup();
    render(<LorebookView book={shelf()} />);

    const body = (): Element | null => unitFor('Harbour').querySelector('p.whitespace-pre-wrap');
    expect(body()?.className).toContain('line-clamp-6');

    await user.type(screen.getByLabelText('Search this book'), 'cranes');

    expect(body()?.className).not.toContain('line-clamp-6');
  });

  it('says how much it is hiding, and clears back to the whole book', async () => {
    const user = userEvent.setup();
    render(<LorebookView book={shelf()} />);

    await user.click(screen.getByRole('button', { name: 'docks' }));
    expect(screen.getByText('Showing 1 of 2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(shown()).toEqual(['Harbour', 'Vera']);
    expect(screen.queryByText('Showing 1 of 2')).toBeNull();
  });

  it('says so when nothing matches, rather than showing an empty page', async () => {
    const user = userEvent.setup();
    render(<LorebookView book={shelf()} />);

    await user.type(screen.getByLabelText('Search this book'), 'zeppelin');

    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([]);
    expect(screen.getByText('No entry in this book matches.')).toBeTruthy();
  });

  it('is quiet until something is narrowed', () => {
    render(<LorebookView book={shelf()} />);

    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });
});

/**
 * The entry address — [10 §5.3]'s *an entry's address is a validated search
 * param on that route*, and gate step 1's second half: a named entry is
 * reachable by its own address, and the link survives a reload and lands on
 * that entry.
 *
 * The routing half is `router.tsx`'s and is tested there. What this covers is
 * what the page does with the value: mark the entry the address names, bring it
 * into view, offer the address on every entry, and degrade to the whole book
 * for a value that names nothing.
 */
describe('an entry addressed by the route', () => {
  const shelf = () =>
    book({
      entries: [entry('Harbour', { id: 'e-harbour' }), entry('Vera', { id: 'e-vera' })],
    });

  it('marks the one the address names, and only that one', () => {
    render(<LorebookView book={shelf()} focused="e-vera" />);

    expect(unitFor('Vera').getAttribute('aria-current')).toBe('true');
    expect(unitFor('Harbour').getAttribute('aria-current')).toBeNull();
  });

  /**
   * In a book of a few hundred, an address that does not bring the entry into
   * view has delivered the reader to the right page and the wrong screen.
   */
  it('brings it into view', () => {
    // Spied here rather than read off the prototype: `vi.mocked` on an unbound
    // method is the shape the `this`-scoping rule exists to catch, and the spy
    // is also what makes this test say what it depends on.
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');

    render(<LorebookView book={shelf()} focused="e-vera" />);

    expect(scrolled).toHaveBeenCalled();
    scrolled.mockRestore();
  });

  /**
   * §5.3's posture, unchanged from `kind` and `slug`: **dropped rather than
   * rejected**. An entry id "is unique within one book and carries no meaning
   * beyond it" and an importer may renumber freely, so a saved link outliving
   * its entry is the expected end of one — and the whole book is a real page
   * where an error card is not.
   */
  it('degrades to the whole book when the address names nothing', () => {
    render(<LorebookView book={shelf()} focused="an-entry-that-left" />);

    expect(screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual([
      'Harbour',
      'Vera',
    ]);
    expect(document.querySelector('[aria-current]')).toBeNull();
  });

  it('offers each entry its own address, so one can be got at all', () => {
    render(
      <LorebookView
        book={shelf()}
        focused={null}
        linkToEntry={(entryId, children) => <a href={`?entry=${entryId}`}>{children}</a>}
      />,
    );

    expect(screen.getByRole('link', { name: 'Vera' }).getAttribute('href')).toBe('?entry=e-vera');
  });

  it('reads the same without a link builder, since the mark is the route’s', () => {
    render(<LorebookView book={shelf()} focused="e-vera" />);

    expect(screen.queryByRole('link', { name: 'Vera' })).toBeNull();
    expect(unitFor('Vera').getAttribute('aria-current')).toBe('true');
  });
});

/**
 * What the import did to this book — [P5 §1.8], and gate step 16.
 *
 * §1.8's decision was that these facts belong on the *book* rather than only in
 * the review that recorded them: somebody debugging an entry six months after
 * an import will not think to look for the sweep. So the page carries them, in
 * the same words the review panel uses — one catalogue, two renderers.
 */
describe('what the import said about this book', () => {
  const notes = (over: Record<string, unknown> = {}) => [
    {
      jobId: 'j-1',
      source: 'cards/Vera.png',
      notes: [
        { key: 'import.lore.entryLimitClamped', params: { from: 5000, to: 1000 }, level: 'warn' },
        {
          key: 'import.lore.positionCollapsed',
          params: { entry: 'Harbour', original: 'before_an' },
          level: 'info',
        },
      ],
      ...over,
    },
  ];

  it('says what happened to the book, in the review’s own words', () => {
    render(<LorebookView book={book({ entries: [entry('Harbour')] })} importNotes={notes()} />);

    expect(screen.getByText('Entry limit reduced from 5000 to 1000.')).toBeTruthy();
    expect(screen.getByText('cards/Vera.png')).toBeTruthy();
  });

  /**
   * The half §1.8 calls the interesting one: an entry-level fact belongs on the
   * entry it is about, not in a list at the top of the page.
   */
  it('puts an entry-level note on the entry it names', () => {
    render(
      <LorebookView
        book={book({ entries: [entry('Harbour'), entry('Vera')] })}
        importNotes={notes()}
      />,
    );

    expect(unitFor('Harbour').textContent).toContain('“Harbour” sat at before_an');
    expect(unitFor('Vera').textContent).not.toContain('sat at');
  });

  /**
   * Nothing recorded is not the same as nothing happened, and an empty box
   * saying "what the import did" above a book made by hand would imply the
   * second. A book imported through the file upload has no job at all.
   */
  it('says nothing at all when there is nothing recorded', () => {
    render(<LorebookView book={book({ entries: [entry('Harbour')] })} importNotes={[]} />);

    expect(screen.queryByRole('heading', { name: 'What the import did' })).toBeNull();
  });

  it('says nothing when a job recorded no notes about this object', () => {
    render(
      <LorebookView
        book={book({ entries: [entry('Harbour')] })}
        importNotes={[{ jobId: 'j-1', source: 'cards/Vera.png', notes: [] }]}
      />,
    );

    expect(screen.queryByRole('heading', { name: 'What the import did' })).toBeNull();
  });
});

/**
 * [P5.3] — *Mentions* and *Mentioned by*, which [10 §5.3] specifies as derived,
 * labelled sections precisely so that the prose is left alone.
 *
 * **What is asserted here is the rendering, not the rule.** The rule lives in
 * `shared/mentions.ts` because [11 §6]'s falsification script counts the same
 * pairs this page draws, and it is tested there. What this file owes is the
 * three things §5.3 says about the *surface*: both directions appear, every row
 * names what matched, and an entry with no mentions gets no heading.
 */
describe('an entry’s mentions', () => {
  const linked = [
    entry('Harbour District', { keys: ['the docks'], content: 'Cranes over the water.' }),
    entry('The Ferryman', { content: 'He works the docks and crosses at dawn.' }),
  ];

  it('lists both directions, each row naming what matched', () => {
    render(<LorebookView book={book({ entries: linked })} />);

    const ferryman = unitFor('The Ferryman');
    expect(within(ferryman).getByRole('heading', { name: 'Mentions', level: 4 })).toBeTruthy();
    expect(ferryman.textContent).toContain('Harbour District');
    // §5.3: every row names what matched — which is what makes the ambiguity a
    // list can carry and an underline could not.
    expect(ferryman.textContent).toContain('matched: the docks');

    const harbour = unitFor('Harbour District');
    expect(within(harbour).getByRole('heading', { name: 'Mentioned by', level: 4 })).toBeTruthy();
    expect(harbour.textContent).toContain('The Ferryman');
  });

  /**
   * An empty mention list is not a thing anybody can act on, so it gets no
   * heading — the opposite of the by-field view's *show the empty field* rule,
   * and right for the opposite reason: an unset field is one somebody could
   * fill, where a heading over *None* on every entry of a book whose author did
   * not write that way is noise standing where a finding would be.
   */
  it('renders no heading for an entry nothing mentions', () => {
    render(<LorebookView book={book({ entries: [entry('Alone', { content: 'Nothing.' })] })} />);

    expect(screen.queryByRole('heading', { name: 'Mentions' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Mentioned by' })).toBeNull();
  });

  /**
   * **The list is capped and says by how much**, which is a different thing
   * from the stop-list [10 §5.3] rejects: that rejection turns on the word
   * *invisible*, and a truncated list stating its own remainder is a list plus
   * the fact that it is long. Found by walking a real book — forty entries
   * there share the key *quay*, so uncapped every one of them listed thirty-nine
   * others and the page rendered nine thousand rows.
   */
  it('shows a few and says how many more', () => {
    const shared = Array.from({ length: 9 }, (_, at) =>
      entry(`Quay ${String(at)}`, { keys: ['quay'], content: 'Terraces, mostly.' }),
    );
    render(
      <LorebookView
        book={book({ entries: [...shared, entry('Ferryman', { content: 'Along the quay.' })] })}
      />,
    );

    const unit = unitFor('Ferryman');
    expect(within(unit).getAllByText('matched: quay')).toHaveLength(5);
    expect(unit.textContent).toContain('and 4 more');
  });

  /**
   * The row is a link into the entry it names, built by the page so it carries
   * the shadowed-copy discriminator — F19 one level down, the same reason the
   * entry's own heading is a link rather than text.
   */
  it('links a mentioned entry at its own address', () => {
    render(
      <LorebookView
        book={book({ entries: linked })}
        linkToEntry={(entryId, children) => <a href={`?entry=${entryId}`}>{children}</a>}
      />,
    );

    const row = within(unitFor('The Ferryman')).getByRole('link', { name: 'Harbour District' });
    expect(row.getAttribute('href')).toBe(`?entry=${linked[0]!.id}`);
  });
});

/**
 * Inline highlighting, made honest — [P5.8], [10 §5.3].
 *
 * §5.3 scheduled this rather than refusing it: *once a real matcher exists it
 * stops being a guess about linking and becomes the keyword test applied to
 * entry content*. The matcher is now the same code the retriever runs, shared
 * at `shared/matching.ts`, and the switch is what keeps the underline from
 * reading as an activation preview nobody asked for.
 */
describe('marking what the scanner sees', () => {
  const linked = () =>
    book({
      entries: [
        entry('Harbour', { keys: ['harbour'], content: 'Cranes over the water.' }),
        entry('The Docks', { keys: ['docks'], content: 'The harbour is north of the docks.' }),
      ],
    });

  const marksIn = (name: string): string[] =>
    [...unitFor(name).querySelectorAll('mark')].map((node) => node.textContent);

  /** Off by default, which §5.3 says twice. */
  it('marks nothing until it is switched on', () => {
    render(<LorebookView book={linked()} />);

    expect(marksIn('The Docks')).toEqual([]);
  });

  it('marks another entry’s key inside this one’s prose', async () => {
    const user = userEvent.setup();
    render(<LorebookView book={linked()} />);

    await user.click(screen.getByRole('checkbox', { name: 'Mark what the scanner sees' }));

    expect(marksIn('The Docks')).toEqual(['harbour']);
  });

  /**
   * **An entry's own key is not marked.** Matching itself is trivially true and
   * says nothing; the question is *if this fires, what does it pull in*.
   */
  it('does not mark an entry’s own key', async () => {
    const user = userEvent.setup();
    render(<LorebookView book={linked()} />);

    await user.click(screen.getByRole('checkbox', { name: 'Mark what the scanner sees' }));

    // 'docks' is The Docks' own key and appears in its own prose.
    expect(marksIn('The Docks')).not.toContain('docks');
  });

  /**
   * The per-entry flags are the whole reason this is *honest* rather than a
   * guess: the mentions list beside it uses one stated rule, and this uses the
   * matcher's.
   */
  it('honours the matching entry’s own whole-word rule', async () => {
    const user = userEvent.setup();
    render(
      <LorebookView
        book={book({
          entries: [
            entry('Dock', { keys: ['dock'], matchWholeWords: true }),
            entry('Prose', { content: 'Down at the dockside.' }),
          ],
        })}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Mark what the scanner sees' }));

    expect(marksIn('Prose')).toEqual([]);
  });

  /**
   * **A pattern is never run in a browser** — it cannot be bounded there, and
   * [P5.4] exists because an unbounded one is a denial of service. The count is
   * beside the switch rather than buried, because an author whose book is half
   * patterns would otherwise read an empty highlight as *nothing links*.
   */
  it('says how many entries it cannot speak for', async () => {
    const user = userEvent.setup();
    render(
      <LorebookView
        book={book({
          entries: [
            entry('Pattern', { keys: ['do.ks'], useRegex: true }),
            entry('Prose', { content: 'Down at the docks.' }),
          ],
        })}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Mark what the scanner sees' }));

    expect(marksIn('Prose')).toEqual([]);
    expect(screen.getByText(/1 entries match by pattern/)).toBeTruthy();
  });

  /**
   * Offering a switch that provably changes nothing is the same complaint §5.3
   * makes about a *Show all* on a two-line entry.
   */
  it('offers no switch on a book with nothing to link', () => {
    render(<LorebookView book={book({ entries: [entry('Alone')] })} />);

    expect(screen.queryByRole('checkbox', { name: 'Mark what the scanner sees' })).toBeNull();
  });
});

/**
 * **Spans from different entries arrive grouped by entry, not in reading
 * order**, so they have to be sorted before they can be rendered — `runsFor`
 * walks forward and drops anything behind its cursor.
 *
 * This is the case that proves the sort happens, and it took a surviving
 * mutation to find: with only one marking entry per test the order is trivially
 * correct, and removing the merge changed nothing.
 */
describe('marking when two entries both match', () => {
  it('marks both, whichever order the entries are declared in', async () => {
    const user = userEvent.setup();
    render(
      <LorebookView
        book={book({
          entries: [
            // 'wharf' appears *later* in the prose than 'harbour', while its
            // entry is declared first — so the raw spans come out backwards.
            entry('Wharf', { keys: ['wharf'] }),
            entry('Harbour', { keys: ['harbour'] }),
            entry('Prose', { content: 'The harbour road runs to the wharf.' }),
          ],
        })}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Mark what the scanner sees' }));

    expect([...unitFor('Prose').querySelectorAll('mark')].map((node) => node.textContent)).toEqual([
      'harbour',
      'wharf',
    ]);
  });
});
