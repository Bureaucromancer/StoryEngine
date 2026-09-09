// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { NO_LORE_REPORT, type LoreReport, type LoreSkipRow } from '@storyengine/shared';

import { LoreReportView } from './LoreReportView.js';

/**
 * The keyword test, generalised — [P5.8], [10 §3].
 *
 * What is asserted here is almost entirely the **refused** half, because that
 * is the half nothing else in the app could show: an entry that fired is
 * already a row in the block table with the key that did it. *My lorebook never
 * fires* is the complaint this view exists to end, and it ends it by naming a
 * different repair for each of sixteen reasons.
 */

function bookRow(over: Partial<LoreReport['books'][number]> = {}): LoreReport['books'][number] {
  return {
    bookId: 'b1',
    bookName: 'Rain City',
    by: 'session',
    tokenBudget: 2048,
    tokensSpent: 41,
    entryLimit: 100,
    entriesKept: 1,
    ...over,
  };
}

function report(over: Partial<LoreReport> = {}): LoreReport {
  return { ...NO_LORE_REPORT, books: [bookRow()], ...over };
}

function skip(over: Partial<LoreSkipRow> = {}): LoreSkipRow {
  return { bookId: 'b1', entryId: 'e1', entryName: 'The Council', reason: 'no-match', ...over };
}

describe('what the retriever refused', () => {
  it('names each entry and what to do about it', () => {
    render(
      <LoreReportView
        lore={report({
          skipped: [
            skip({ entryId: 'e1', entryName: 'No keys', reason: 'no-keys' }),
            skip({ entryId: 'e2', entryName: 'Cooling', reason: 'cooling' }),
          ],
        })}
      />,
    );

    expect(screen.getByText('No keys').parentElement?.textContent).toContain('no keys to match on');
    expect(screen.getByText('Cooling').parentElement?.textContent).toContain('waiting');
  });

  /**
   * **An unfamiliar reason shows as itself.** The server's list will grow —
   * `semantic` and the channel predicates are both scheduled — and a client
   * that rendered nothing for a class it did not know would go blank on exactly
   * the entry somebody was asking about. Ugly and true beats absent.
   */
  it('falls back to the class itself for a reason it does not know', () => {
    render(<LoreReportView lore={report({ skipped: [skip({ reason: 'semantic-miss' })] })} />);

    expect(screen.getByText('semantic-miss')).toBeTruthy();
  });

  /**
   * [P5.7]'s folder gate names the **outermost** shut folder — the one that has
   * to be opened before any below it can matter. Naming a nearer one would send
   * somebody to a switch that changes nothing.
   */
  it('names the folder when a folder is what shut the entry out', () => {
    render(
      <LoreReportView
        lore={report({
          skipped: [skip({ reason: 'folder-disabled', folder: { id: 'f1', name: 'Act Two' } })],
        })}
      />,
    );

    expect(screen.getByText('The Council').parentElement?.textContent).toContain('Act Two');
  });

  /**
   * Capped in the surface rather than by the server, so *and N more* is honest:
   * the count is very often the whole answer on its own.
   */
  it('caps the list and offers the rest, with a real count', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 20 }, (_, at) =>
      skip({ entryId: `e${String(at)}`, entryName: `Entry ${String(at)}` }),
    );
    render(<LoreReportView lore={report({ skipped: many })} />);

    expect(screen.queryByText('Entry 19')).toBeNull();
    expect(screen.getByText('Did not fire — 20')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Show 8 more' }));

    expect(screen.getByText('Entry 19')).toBeTruthy();
  });
});

describe('the books in play', () => {
  /**
   * *Is my lorebook even being looked at* is a different question from *did
   * anything match*, with a different repair. Only a row tells them apart, so
   * the row appears for a book that contributed nothing.
   */
  it('lists a book that contributed nothing, with why it is being scanned', () => {
    render(
      <LoreReportView
        lore={report({
          books: [
            {
              bookId: 'b1',
              bookName: 'Rain City',
              by: 'treatment',
              tokenBudget: 2048,
              tokensSpent: 0,
              entryLimit: 100,
              entriesKept: 0,
            },
          ],
        })}
      />,
    );

    const row = screen.getByRole('cell', { name: 'Rain City' }).closest('tr');
    expect(row?.textContent).toContain('linked by the treatment');
  });

  /** Spent of allowed: a number alone cannot say whether the limit was in the way. */
  it('shows what each book spent against what it was allowed', () => {
    render(<LoreReportView lore={report()} />);

    const row = screen.getByRole('cell', { name: 'Rain City' }).closest('tr');
    expect(row?.textContent).toContain('1 / 100');
    expect(row?.textContent).toContain('41 / 2,048');
  });

  /**
   * A session with no lorebook should not be told about a subsystem it is not
   * using — an absent section is the right rendering of nothing to say. The
   * moment a book *is* in play the section appears, even with nothing skipped.
   */
  it('renders nothing at all when no book is in play', () => {
    const { container } = render(<LoreReportView lore={NO_LORE_REPORT} />);

    expect(container.textContent).toBe('');
  });

  it('appears for a book in play even when nothing was refused', () => {
    render(<LoreReportView lore={report({ skipped: [] })} />);

    expect(screen.getByText('Rain City')).toBeTruthy();
    expect(screen.queryByText(/Did not fire/)).toBeNull();
  });
});

describe('the patterns that could not be run', () => {
  /**
   * [P5.4]'s refusals get their own block rather than a skip reason: a pattern
   * that could not be *run* is a broken entry rather than an entry that did not
   * match, and the repair is to fix the key — which is printed.
   */
  it('prints the key and says which way it failed', () => {
    render(
      <LoreReportView
        lore={report({
          refused: [
            { entryId: 'e1', entryName: 'Broken', key: '(', reason: 'invalid' },
            { entryId: 'e2', entryName: 'Slow', key: '(a+)+$', reason: 'timed-out' },
          ],
        })}
      />,
    );

    expect(screen.getByText('(').closest('li')?.textContent).toContain('not a valid pattern');
    expect(screen.getByText('(a+)+$').closest('li')?.textContent).toContain('timed out');
  });
});

describe('the sources nothing supplied', () => {
  /**
   * An entry looking somewhere that does not exist never fires and looks
   * exactly like an entry whose keys are wrong. This is the list that separates
   * them.
   */
  it('names a source no one supplied', () => {
    render(<LoreReportView lore={report({ unknownSources: ['the-moon'] })} />);

    expect(screen.getByText('the-moon')).toBeTruthy();
  });
});

/**
 * The budget column, and the one value it could not render — [P6B.1].
 *
 * Zero means unlimited ([04 §5], and the schema annotates it), so the pair that
 * reads correctly for every other book read *41 / 0* on precisely the books
 * that had no limit. The retriever's own reading was settled in the same stage;
 * this is the half a person sees.
 */
describe('a book with no token limit', () => {
  it('says so, rather than dividing by a limit of nothing', () => {
    render(<LoreReportView lore={report({ books: [bookRow({ tokenBudget: 0 })] })} />);

    expect(screen.getByText('41 / no limit')).toBeTruthy();
  });

  it('still shows the allowance where there is one', () => {
    render(<LoreReportView lore={report()} />);

    expect(screen.getByText('41 / 2,048')).toBeTruthy();
  });
});
