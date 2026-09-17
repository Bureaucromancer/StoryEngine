// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import type { IndexRow, LibraryKind } from '../../api.js';
import { link, table } from '../../ui/classes.js';
import { Fine, SubsectionTitle } from '../../ui/Text.js';
import { Note } from '../../ui/Text.js';

import { labels } from '../../i18n/catalogue.js';

/**
 * The index rows, one per copy — the stage's ends-at surface ([P3.3]):
 * *opening the panel over a shadowed object names the winning path*, which
 * the detail page's warning poses and cannot answer. The winner is first
 * because the projection sorts by portable path, and the portable path is
 * the very string the shadow resolution orders by (F23) — the ruling column
 * only says in a word what the order already did.
 *
 * Every copy but the one being shown links through its `(source, slug)`
 * discriminator, never rebuilt from `{kind, id}` — F19's fix, and
 * [polish §4] names a panel building id-only links as exactly what would
 * lose it. A tombstoned row links nowhere: a read of it answers 404, and a
 * link that 404s on arrival is worse than a row that says what it is.
 */

const RULING_LABELS = labels('workbench.ruling', {
  winner: 'Winner',
  shadowed: 'Shadowed',
  tombstoned: 'Tombstoned',
});

function rulingOf(row: IndexRow): keyof typeof RULING_LABELS {
  if (row.tombstonedAt !== null) return 'tombstoned';
  return row.shadowed ? 'shadowed' : 'winner';
}

export function IndexRowTable({
  kind,
  id,
  rows,
  subject,
  subjectShadowed,
}: {
  kind: LibraryKind;
  id: string;
  rows: IndexRow[] | undefined;
  /** Which copy the panel is over, so its row says so instead of linking. */
  subject: { source: 'user' | 'system'; slug: string };
  subjectShadowed: boolean;
}): JSX.Element {
  const winner = rows?.find((row) => rulingOf(row) === 'winner');

  return (
    <section aria-label="Index rows" className="flex flex-col gap-2">
      <SubsectionTitle as="h4">Index rows</SubsectionTitle>
      {subjectShadowed && winner !== undefined ? (
        // The ends-at, as one sentence: the question the detail page's
        // warning poses, answered with the deciding string itself.
        <Note>{`The copy that loads lives at ${winner.path}.`}</Note>
      ) : null}
      {rows === undefined ? (
        <Fine>Reading the index…</Fine>
      ) : (
        <div className="overflow-x-auto">
          <table className={table.root}>
            <thead>
              <tr className={table.head}>
                <th scope="col" className={table.thCompact}>
                  Path
                </th>
                <th scope="col" className={table.thCompact}>
                  Source
                </th>
                <th scope="col" className={table.thCompact}>
                  Ruling
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const ruling = rulingOf(row);
                const isSubject = row.source === subject.source && row.slug === subject.slug;
                return (
                  <tr
                    key={`${row.source}:${row.slug}`}
                    className={ruling === 'tombstoned' ? `${table.row} text-ink-faint` : table.row}
                  >
                    <td className={table.cellCompact}>
                      {isSubject || ruling === 'tombstoned' ? (
                        <code className="break-all text-xs">{row.path}</code>
                      ) : (
                        <Link
                          to="/library/$kind/$id"
                          params={{ kind, id }}
                          search={{ source: row.source, slug: row.slug }}
                          className={link.inline}
                        >
                          <code className="break-all text-xs">{row.path}</code>
                        </Link>
                      )}
                    </td>
                    <td className={table.cellCompact}>
                      {row.source === 'system' ? 'System' : 'Yours'}
                    </td>
                    <td className={table.cellCompact}>
                      {isSubject ? `${RULING_LABELS[ruling]} — shown` : RULING_LABELS[ruling]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
