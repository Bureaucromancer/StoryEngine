// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { LoreBookRow, LoreReport, LoreSkipRow } from '@storyengine/shared';

import { formatCount } from '../../format.js';
import { Button } from '../../ui/Button.js';
import { table } from '../../ui/classes.js';
import { Fine } from '../../ui/Text.js';
import { labels } from '../../i18n/catalogue.js';

/**
 * **The keyword test, generalised** — [P5.8], [10 §3].
 *
 * §3 describes Marinara's panel as *paste sample text, see which entries would
 * fire*, and asks for it *as a workbench feature over the whole assembly,
 * against a real session's channel state*. Both halves of that are already
 * standing: the preview runs the real retriever against the real channels every
 * time somebody pauses typing, and what fired is already in the block table
 * with the key that did it. This view is the half nothing could show.
 *
 * ## The text box is the composer, and that is a decision
 *
 * Marinara's tester has a textarea of its own. This one does not, and the
 * reason is §3's own rule: *a reader holds no state of its own*. The section
 * admits exactly one exception — import — and says in as many words that if a
 * second arrives, the rule should be rewritten rather than quietly bent. A
 * textarea here would be that second one.
 *
 * It is also the better surface. The preview already re-runs on the composer,
 * so the feature is *live*: type a sentence and watch the list change. A second
 * box would be a second way to ask one question, and the panel would then have
 * to decide which of the two it was answering.
 *
 * The cost is real and worth naming: sample text you did not mean to send sits
 * in the composer until you clear it. That is a smaller price than a reader
 * that remembers things.
 *
 * ## Why the refused list is not truncated by the server
 *
 * It is capped *here* instead. A person with a four-hundred-entry book does not
 * want four hundred rows, but *and 380 more* is only honest if the count is
 * real — and the count is very often the whole answer on its own.
 */

/**
 * The class-to-sentence mapping, in the surface where sentences belong.
 *
 * Each says what to *do*, because that is the difference between sixteen
 * reasons and one shrug. `no-keys` means write a key; `cooling` means wait;
 * `lost-its-group` means another entry won; `never-fires` means those two flags
 * cannot both be satisfied.
 *
 * **Open, and the fallback is the class itself.** The server's list will grow —
 * `semantic` and channel predicates are both scheduled — and a client that
 * rendered nothing for an unfamiliar reason would go blank on exactly the entry
 * somebody was asking about. Showing the raw class is ugly and true.
 */
const SKIP_LABELS: Record<string, string> = labels('workbench.lore.skip', {
  'book-disabled': 'its book is switched off',
  'folder-disabled': 'a folder above it is shut',
  'entry-disabled': 'switched off',
  'filtered-out': 'a filter excluded this scene',
  'never-fires': 'it is barred from the first pass and from every later one',
  'awaiting-recursion': 'it fires only during recursion, and none happened',
  'excluded-from-recursion': 'it cannot be triggered by another entry',
  'recursion-off': 'its book does not do recursive scanning',
  'depth-exhausted': 'the book ran out of recursion depth',
  spent: 'it is used up',
  delayed: 'the conversation is not long enough yet',
  cooling: 'it fired recently and is waiting',
  'no-keys': 'it has no keys to match on',
  'no-match': 'none of its keys are in the text',
  'held-by-secondary': 'a key matched and its secondary rule refused it',
  'lost-the-roll': 'its probability roll failed',
  'lost-its-group': 'another entry in its group won',
});

/**
 * Why a book is being scanned at all — ~~and there are only two, because
 * selection is the only route a book reaches a session by.~~
 *
 * ***Three since [P8.2]***, and the third is still not a book volunteering:
 * a memory book is admitted by an **engine rule over the session's declared
 * cast** plus a toggle the session owns, never by anything the book claims about
 * itself. What matters here is that the three have **three different repairs** —
 * unlink the book, unlink the treatment, or turn intake off for this session —
 * which is the question [P5.8]'s keyword tester exists to answer and the reason
 * the route travels on the row rather than being inferred from the book.
 *
 * *The fallback below prints a route this build has not heard of rather than a
 * blank*, which is the posture that made adding this one a one-line change.
 */
const ROUTE_LABELS: Record<string, string> = labels('workbench.lore.route', {
  treatment: 'linked by the treatment',
  session: 'linked by this session',
  memory: 'memories of somebody in the cast',
});

/** Enough to see the shape without becoming the panel. */
const SHOWN = 12;

export function LoreReportView({
  lore,
  locale,
}: {
  lore: LoreReport;
  /** The reader's, for every count in the report. */
  locale: string | undefined;
}): JSX.Element | null {
  const [all, setAll] = useState(false);

  /**
   * Nothing at all when no book is in play — an absent section is the right
   * rendering of nothing to say, and a session with no lorebook should not be
   * told about a subsystem it is not using. The moment a book *is* linked the
   * section appears, even if it matched nothing, because *scanned and matched
   * nothing* is the answer somebody is looking for.
   */
  if (lore.books.length === 0) return null;

  const shown = all ? lore.skipped : lore.skipped.slice(0, SHOWN);
  const rest = lore.skipped.length - shown.length;

  return (
    <div className="flex flex-col gap-3">
      <Fine>Lore</Fine>

      <BookRows books={lore.books} locale={locale} />

      {lore.skipped.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <Fine>{`Did not fire — ${formatCount(lore.skipped.length, locale)}`}</Fine>
          <ul className="flex flex-col gap-0.5 text-sm text-ink-muted">
            {shown.map((row) => (
              <SkipRow key={`${row.bookId}:${row.entryId}`} row={row} />
            ))}
          </ul>
          {rest > 0 && (
            <Button
              type="button"
              variant="quiet"
              size="tiny"
              onClick={() => {
                setAll(true);
              }}
            >
              {`Show ${formatCount(rest, locale)} more`}
            </Button>
          )}
        </div>
      )}

      {lore.refused.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          {/* [P5.4]'s refusals. Their own block rather than a skip reason,
              because a pattern that could not be *run* is a broken entry rather
              than an entry that did not match — and the repair is to fix the
              key, which is printed. */}
          <Fine>Patterns that could not be run</Fine>
          <ul className="flex flex-col gap-0.5 text-sm text-ink-muted">
            {lore.refused.map((row) => (
              <li key={row.key} className="flex items-baseline gap-2">
                <span>{row.entryName}</span>
                <code className="text-xs">{row.key}</code>
                <span>{row.reason === 'timed-out' ? 'timed out' : 'not a valid pattern'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lore.unknownSources.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          {/* An entry looking somewhere that does not exist never fires and
              looks exactly like an entry whose keys are wrong. */}
          <Fine>Sources nothing supplied</Fine>
          <ul className="flex flex-col gap-0.5 text-sm text-ink-muted">
            {lore.unknownSources.map((name) => (
              <li key={name}>
                <code className="text-xs">{name}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * One row per book, including a book that contributed nothing.
 *
 * *Is my lorebook even being looked at* is a different question from *did
 * anything match*, with a different repair, and only a row can tell them apart.
 */
function BookRows({
  books,
  locale,
}: {
  books: LoreBookRow[];
  locale: string | undefined;
}): JSX.Element {
  return (
    <table className="w-full text-sm">
      <thead className={table.head}>
        <tr>
          <th scope="col" className={table.thCompact}>
            Book
          </th>
          <th scope="col" className={table.thCompact}>
            Why
          </th>
          <th scope="col" className={table.thNumeric}>
            Entries
          </th>
          <th scope="col" className={table.thNumeric}>
            Tokens
          </th>
        </tr>
      </thead>
      <tbody>
        {books.map((book) => (
          <tr key={book.bookId} className={table.row}>
            <td className={table.cellCompact}>{book.bookName}</td>
            <td className={table.cellCompact}>{ROUTE_LABELS[book.by] ?? book.by}</td>
            {/* Spent of allowed, both halves, because a number on its own
                cannot say whether the limit was the thing in the way. */}
            <td className={table.cellNumeric}>
              {`${formatCount(book.entriesKept, locale)} / ${formatCount(book.entryLimit, locale)}`}
            </td>
            <td className={table.cellNumeric}>
              {budgetCell(book.tokensSpent, book.tokenBudget, locale)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Tokens spent against the book's allowance — [P6B.1].
 *
 * **Zero is unlimited** ([04 §5], and the schema says so), so the pair that
 * reads correctly everywhere else reads *412 / 0* on exactly the books that had
 * no limit at all. One string rather than a cell assembled around two values,
 * which is the shape [20 §12.6a] forbids and also the only way to make the
 * denominator conditional without splitting the sentence.
 */
export function budgetCell(spent: number, budget: number, locale: string | undefined): string {
  return budget === 0
    ? `${formatCount(spent, locale)} / no limit`
    : `${formatCount(spent, locale)} / ${formatCount(budget, locale)}`;
}

function SkipRow({ row }: { row: LoreSkipRow }): JSX.Element {
  /**
   * The folder is named where there is one, which is [P5.7]'s outermost shut
   * gate — the one that has to be opened before any below it can matter, so
   * naming a nearer one would send somebody to a switch that changes nothing.
   */
  const why =
    row.folder === undefined
      ? (SKIP_LABELS[row.reason] ?? row.reason)
      : `the folder ${row.folder.name} is shut`;

  return (
    <li className="flex items-baseline gap-2">
      <span>{row.entryName}</span>
      <span className="text-ink-faint">{why}</span>
    </li>
  );
}
