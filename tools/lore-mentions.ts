// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// From `dist`, not `src`, for the reason `emit-schemas.ts` gives beside the same
// import: the reading should come from the code that ships, and `tsc -b` has run
// by the time this does. It is also the *same* function the book page renders,
// which is the whole point — an instrument measuring a different rule from the
// one on screen would be measuring nothing anybody sees.
import { mentionIndex, LOREBOOK_SCHEMA, type Lorebook } from '../packages/shared/dist/index.js';

/**
 * [11 §6](../docs/design/11-lorebooks-as-a-format.md)'s two counts, over
 * whatever library is to hand.
 *
 * **The sharpest test this project has against its own warrant.** §2 claims that
 * `keys` and `secondaryKeys` are *index terms* — the surface forms a concept
 * goes by — and not merely activation triggers. §6 says how we would know that
 * was wrong:
 *
 * > Count the mentions across the whole imported corpus. *Mentions* pairs
 * > entries whose `name` or keys occur in another entry's `content`. **If real
 * > books produce empty or absurd lists, then keys were chosen purely to
 * > trigger, with no aliasing intent behind them** — the *keys are index terms*
 * > premise in §2 is false, and this document's warrant falls with it.
 *
 * And the second, one line further down: count folders, because if real books
 * have few or none then *portable toggles* is an aspiration rather than an
 * observed practice and the folder gate panel is speculative rather than
 * overdue.
 *
 * **This is the instrument, not the verdict, and the distinction is the whole
 * reason it exists now.** §6 was amended on 2026-08-30 once P4 established that
 * no used SillyTavern or Marinara install is on hand: the premise is a claim
 * about *how real authors chose keys*, and a corpus we wrote cannot answer it
 * either way. So the counts are deferred until a real library exists rather than
 * skipped, and [P5.3](../docs/design/workplan/17-p5-implementation.md) owes the
 * script and a reading over whatever is to hand — which is the **control** the
 * real reading gets compared with, and worth nothing on its own.
 *
 * So: it prints what it ran against, first and unmissably. A number from this
 * script quoted without that line is a number about nothing.
 *
 *     node tools/lore-mentions.ts [directory]
 *
 * The directory defaults to `data`, and is walked for any file named
 * `lorebook.json` — so it reads a live install, an unpacked export, or a folder
 * of downloaded books equally well. It writes nothing.
 */

const ROOT = resolve(process.argv[2] ?? 'data');
const BOOK_FILE = 'lorebook.json';

interface Found {
  path: string;
  book: Lorebook;
}

/** Every `lorebook.json` under a directory, in walk order. */
function findBooks(directory: string): Found[] {
  let listing: string[];
  try {
    listing = readdirSync(directory);
  } catch {
    // A directory we cannot read is one book's worth of missing evidence, not a
    // reason to abandon the count — and this walks user data that may include
    // things this process has no business in.
    return [];
  }

  const found: Found[] = [];
  for (const name of listing) {
    const path = join(directory, name);
    let entry;
    try {
      entry = statSync(path);
    } catch {
      continue;
    }

    if (entry.isDirectory()) {
      found.push(...findBooks(path));
      continue;
    }
    if (name !== BOOK_FILE) continue;

    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      // Named `lorebook.json` is not the same as *being* one. A file that says
      // otherwise is skipped rather than guessed at.
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as { schema?: unknown }).schema === LOREBOOK_SCHEMA &&
        Array.isArray((parsed as { entries?: unknown }).entries)
      ) {
        found.push({ path, book: parsed as Lorebook });
      }
    } catch {
      // Unparsable is the storage thesis working; it is still not a book.
    }
  }
  return found;
}

/** The middle value, which says more than a mean over a long tail. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function main(): void {
  const books = findBooks(ROOT);

  // First and unmissably, because a count without it is a count about nothing.
  console.log(`Ran against: ${ROOT}`);
  console.log(`Books found: ${String(books.length)}`);
  if (books.length === 0) {
    console.log('\nNothing to count. Point this at a directory holding lorebook.json files.');
    return;
  }

  let entries = 0;
  let mentioning = 0;
  let pairs = 0;
  let folders = 0;
  let booksWithFolders = 0;
  let filed = 0;
  const perEntry: number[] = [];
  const perBook: { name: string; entries: number; pairs: number; folders: number }[] = [];
  /**
   * **Which surface forms are doing the work** — the first question anyone asks
   * of a number that looks absurd, and the one that says whether the absurdity
   * is the books or the matcher. A count where six terms carry nine tenths of
   * the pairs is a corpus where a few entries share a key; a long flat tail is
   * aliasing, which is the premise §2 is claiming.
   */
  const byTerm = new Map<string, number>();

  for (const { book } of books) {
    const index = mentionIndex(book);
    let bookPairs = 0;

    for (const entry of book.entries) {
      const out = index.mentions.get(entry) ?? [];
      entries += 1;
      perEntry.push(out.length);
      bookPairs += out.length;
      if (out.length > 0) mentioning += 1;
      if (entry.folderId !== null) filed += 1;
      for (const row of out) {
        for (const term of row.terms) byTerm.set(term, (byTerm.get(term) ?? 0) + 1);
      }
    }

    pairs += bookPairs;
    folders += book.folders.length;
    if (book.folders.length > 0) booksWithFolders += 1;
    perBook.push({
      name: book.name,
      entries: book.entries.length,
      pairs: bookPairs,
      folders: book.folders.length,
    });
  }

  const share = (part: number, whole: number): string =>
    whole === 0 ? 'n/a' : `${((part / whole) * 100).toFixed(1)}%`;

  console.log(`\n── Mentions ${'─'.repeat(50)}`);
  console.log(`Entries:                 ${String(entries)}`);
  console.log(`Entries mentioning any:  ${String(mentioning)}  (${share(mentioning, entries)})`);
  console.log(`Mention pairs:           ${String(pairs)}`);
  console.log(`Per entry, median:       ${String(median(perEntry))}`);
  console.log(`Per entry, max:          ${String(Math.max(0, ...perEntry))}`);
  console.log(
    `Books with no mentions:  ${String(perBook.filter((row) => row.pairs === 0).length)}`,
  );

  const ranked = [...byTerm].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 8);
  const carried = top.reduce((sum, [, count]) => sum + count, 0);
  console.log(`Distinct terms matched:  ${String(ranked.length)}`);
  console.log(`Top 8 carry:             ${share(carried, pairs)} of all pairs`);
  for (const [term, count] of top) {
    console.log(`  ${term.slice(0, 30).padEnd(32)}${String(count).padStart(8)}`);
  }

  console.log(`\n── Folders ${'─'.repeat(51)}`);
  console.log(`Folders:                 ${String(folders)}`);
  console.log(
    `Books with any:          ${String(booksWithFolders)}  (${share(booksWithFolders, books.length)})`,
  );
  console.log(`Entries filed in one:    ${String(filed)}  (${share(filed, entries)})`);

  console.log(`\n── Per book ${'─'.repeat(50)}`);
  for (const row of perBook) {
    console.log(
      `${row.name.slice(0, 34).padEnd(36)}${String(row.entries).padStart(6)} entries` +
        `${String(row.pairs).padStart(8)} pairs${String(row.folders).padStart(5)} folders`,
    );
  }

  console.log(
    '\nWhat this can and cannot say: an empty or absurd result over a corpus\n' +
      'somebody here wrote confirms what the fixtures were built to contain and\n' +
      'nothing else (16 §6, amended 2026-08-30). The reading that decides the\n' +
      'premise is the one taken over books real authors wrote.',
  );
}

main();
