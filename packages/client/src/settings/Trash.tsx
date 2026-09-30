// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';

import { errorCode, readTrash, restoreFromTrash, type TrashEntry } from '../api.js';
import { formatTimestamp } from '../format.js';
import { Button } from '../ui/Button.js';
import { Fine, Note, SectionTitle } from '../ui/Text.js';

/**
 * ***What you deleted, and how long it has*** —
 * [03 §10.2](../../../../docs/design/03-data-model.md),
 * [P2 §2.11](../../../../docs/design/workplan/08-p2-implementation.md)'s F7
 * second half, [P11.7](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **Delete has been a move since P4.4 and nothing could look in the drawer.**
 * That is the half of F7 P2 named and left: `trash/` filled up, the retention
 * setting shipped with no reader, and the one thing a move buys over an
 * erasure — being able to change your mind — was unreachable.
 *
 * ***In Settings rather than in the library***, and the reason is the contents
 * rather than the taxonomy: the trash holds **sessions** as well as library
 * objects ([03 §10.3] puts `trash/sessions/` beside the kinds), so a drawer
 * inside the library would be a library surface answering about something that
 * is not a library object. *It is also not a browsing view*: nobody goes to the
 * trash to look around, they go because they want one thing back.
 */
export function Trash(props: {
  /** The reader's, for when each thing was deleted and when it goes. */
  locale: string | undefined;
}): JSX.Element {
  const client = useQueryClient();
  const trash = useQuery({ queryKey: ['trash'], queryFn: readTrash });
  const restore = useMutation({
    mutationFn: (id: string) => restoreFromTrash(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['trash'] });
      void client.invalidateQueries({ queryKey: ['library'] });
    },
  });

  const entries = trash.data?.entries ?? [];

  return (
    <section className="flex flex-col gap-3" aria-labelledby="trash">
      <SectionTitle id="trash">Trash</SectionTitle>
      <Fine>{windowLine(trash.data?.retentionDays)}</Fine>

      {restore.isError ? (
        <p role="alert" className="text-danger-ink">
          {restoreLine(restore.error)}
        </p>
      ) : null}

      {trash.isPending ? <Note>Loading…</Note> : null}

      {!trash.isPending && entries.length === 0 ? <Note>Nothing has been deleted.</Note> : null}

      {entries.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-3"
            >
              <span className="text-ink">{entry.name}</span>
              <Fine>{entry.kind}</Fine>
              <Fine>{whenLine(entry, props.locale)}</Fine>
              <Button
                type="button"
                className="ms-auto"
                disabled={restore.isPending}
                onClick={() => {
                  restore.mutate(entry.id);
                }}
              >
                Put it back
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Whole sentences, one per state — the shape [P11.8]'s catalogue wants and the
 * shape the sentence-assembly rule requires.
 */
function windowLine(days: number | undefined): string {
  if (days === undefined) return 'Deleted things wait here before they are removed.';
  if (days <= 0) {
    return 'Deleted things stay here until you remove them — this install has no retention window.';
  }
  return days === 1
    ? 'Deleted things stay here for 1 day, then they are removed.'
    : `Deleted things stay here for ${String(days)} days, then they are removed.`;
}

/**
 * When it was deleted, and when it goes.
 *
 * ***An entry whose age is unknown says so rather than claiming a date.*** A
 * folder this build did not put in the trash carries no timestamp in its name,
 * and the sweep will never take it — so the honest line is that it stays, which
 * is also the useful one.
 */
function whenLine(entry: TrashEntry, locale: string | undefined): string {
  if (entry.deletedAt === 0) return 'Put here by hand; it will not be removed.';
  const deleted = formatTimestamp(new Date(entry.deletedAt).toISOString(), locale);
  if (entry.expiresAt === null) return `Deleted ${deleted}.`;
  return `Deleted ${deleted}; removed after ${formatTimestamp(new Date(entry.expiresAt).toISOString(), locale)}.`;
}

/**
 * Why something could not be put back — by the class the route sends
 * (`occupied`), not by the English it sends with it (2026-09-27).
 */
function restoreLine(error: unknown): string {
  return errorCode(error) === 'occupied'
    ? 'Something with that name is already there. Rename it first, then put this one back.'
    : 'That could not be put back.';
}
