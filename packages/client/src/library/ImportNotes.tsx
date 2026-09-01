// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { ObjectImportNotes } from '../api.js';
import { Panel } from '../ui/Panel.js';
import { Fine, SubsectionTitle } from '../ui/Text.js';
import { sentence } from './note-labels.js';

/**
 * What the import did to this book — [P5 §1.8].
 *
 * **The facts an import establishes belong on the object, not only on the sweep
 * that created it.** A clamped entry limit, an entry that sat at a position with
 * no equivalent here, a book that was scoped to one chat and is global now: they
 * are exactly what somebody asks about when an entry does not behave, and the
 * review that recorded them is a page you had open once. §1.8 decided the book's
 * own page carries them, on the grounds that somebody debugging an entry six
 * months later will not think to look for the sweep.
 *
 * **The words are `note-labels.ts`'s, which the review panel also reads.** Two
 * renderers, one catalogue — a copy of the sentence table would let the two
 * surfaces disagree about what an import did, which is the worst possible thing
 * for them to disagree about.
 *
 * **Absent when there is nothing to say, and that is not the same as silence.**
 * A book made by hand has no notes; so does one brought in through the file
 * upload, which records no job at all. Both are *nothing recorded* rather than
 * *nothing happened*, and this renders nothing rather than an empty box that
 * implies the import was uneventful.
 */
export function ImportNotes({ rows }: { rows: ObjectImportNotes[] }): JSX.Element | null {
  const anything = rows.some((row) => row.notes.length > 0);
  if (!anything) return null;

  return (
    <section>
      <SubsectionTitle as="h2" className="mb-2">
        What the import did
      </SubsectionTitle>
      <div className="flex flex-col gap-3">
        {rows.map((row) =>
          row.notes.length === 0 ? null : (
            <Panel key={row.jobId} variant="inset">
              {/*
               * The file it came from, named relative to the sweep root — never
               * absolutely, which is [13 §4.1]'s foreign-path doctrine: the root
               * is recorded once, on the job, and a per-item absolute path turns
               * a page somebody screenshots into a description of their disk.
               */}
              <Fine className="mb-2">{row.source}</Fine>
              <ul className="flex flex-col gap-1 text-sm text-ink-muted">
                {row.notes.map((note, index) => (
                  <li key={`${note.key}:${String(index)}`}>{sentence(note)}</li>
                ))}
              </ul>
            </Panel>
          ),
        )}
      </div>
    </section>
  );
}

/**
 * The notes about one entry, for the fold beneath it.
 *
 * **How an entry-level note finds its entry** is what §1.8 calls the half that
 * was always the interesting one, and the answer is a parameter the converters
 * already send: the four entry-level classes carry the entry's name in
 * `params.entry`. Matching on that is matching on a *display name*, which two
 * entries in one book may share — so this is deliberately a filter and not a
 * lookup, and an ambiguous name shows the note on both entries rather than
 * guessing which one it meant.
 *
 * The sharper fix is at the converter: the entry's `stableId` in the params
 * would make this exact. That is a change to what the importers write, so it
 * belongs to a stage that is allowed to touch them rather than to this one.
 */
export function notesForEntry(
  rows: ObjectImportNotes[],
  entryName: string,
): ObjectImportNotes['notes'] {
  if (entryName === '') return [];
  return rows.flatMap((row) => row.notes.filter((note) => note.params['entry'] === entryName));
}
