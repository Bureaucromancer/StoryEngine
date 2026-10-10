// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';

import { errorCode, isLibraryKind, readTrash, restoreFromTrash, type TrashEntry } from '../api.js';
import { formatTimestamp } from '../format.js';
import { labels } from '../i18n/catalogue.js';
import { KIND_WORDS } from '../library/labels.js';
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

      {/* ***A trash that could not be read is not an empty one*** (2026-10-01,
          polish 10). Both rendered *Nothing has been deleted.* — the one
          sentence on this page a person acts on by giving up looking. */}
      {trash.isError ? (
        <p role="alert" className="text-danger-ink">
          The trash could not be read. Try reloading the page.
        </p>
      ) : null}

      {trash.isSuccess && entries.length === 0 ? <Note>Nothing has been deleted.</Note> : null}

      {entries.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-3"
            >
              <span className="text-ink">{entry.name}</span>
              <Fine>{kindWord(entry.kind)}</Fine>
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
 * ***Folders a kind used to live in, as the kind they hold now*** —
 * [P16 §1.1](../../../../docs/design/workplan/35-p16-world.md).
 *
 * A trash entry's `kind` is the folder it was deleted from, and a Package
 * deleted before [P16.0] was deleted from `packages/`. `storage/trash.ts` keeps
 * that folder as a legacy kind so the entry is still listed, restorable and
 * expired rather than stranded — and its restore lands in `library/worlds/`,
 * because a restore is a write and every write writes the new form. So the
 * entry *is* a World in every sense but its address, and labelling it by the
 * address would name a kind this build no longer has, on the one row whose
 * button is about to make it a World.
 *
 * **The same alias the registry's `LEGACY_LIBRARY_DIRECTORIES` holds**, written
 * here rather than imported because that table maps a folder to a *schema id*
 * and this one needs the folder's successor; one entry, and it goes when the
 * legacy read does.
 */
const LEGACY_TRASH_KINDS: Readonly<Record<string, string>> = { packages: 'worlds' };

/** The trash's one kind that is not a library kind ([03 §10.3]). */
const TRASH_KIND_WORDS: Readonly<Record<string, string>> = labels('settings.trash.kind', {
  sessions: 'session',
});

/**
 * The word for a trash entry's kind, in the singular — one row, one object.
 *
 * ***A word rather than the folder name since 2026-10-10*** ([P16.0]). The row
 * printed `entry.kind` as it came — `lorebooks`, `sessions` — which was a
 * folder name standing in for a word, and harmless while every folder was the
 * name of a kind. The legacy `packages` entry above is the case where it
 * stops being harmless, and once that row needed a word the others needed one
 * too, or one row in the list would read differently from its neighbours. A
 * library kind takes `KIND_WORDS`, the same singular the object page's
 * sentences use; a session takes `TRASH_KIND_WORDS`' one word; and a folder this build
 * has no word for is shown as itself, `UsedBy`'s rule for a kind a newer
 * server knows.
 */
function kindWord(folder: string): string {
  const kind = Object.hasOwn(LEGACY_TRASH_KINDS, folder)
    ? (LEGACY_TRASH_KINDS[folder] ?? folder)
    : folder;
  if (isLibraryKind(kind)) return KIND_WORDS[kind];
  return Object.hasOwn(TRASH_KIND_WORDS, kind) ? (TRASH_KIND_WORDS[kind] ?? kind) : kind;
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
