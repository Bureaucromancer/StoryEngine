// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';

import { api, type LibraryFileError } from '../api.js';
import { Alert } from '../ui/Alert.js';
import { Fine, SectionTitle } from '../ui/Text.js';

/**
 * What the library holds and cannot read — [P7B.8].
 *
 * ***The gate step this closes has been failing since it was written.***
 * `GET /api/library/errors` shipped at P2 and
 * [manual gate §3.5](../../../../docs/design/workplan/11-p2-manual-gate.md) has
 * said *"No client code calls it"* ever since, with the consequence spelled
 * out: *"Break an actor by hand and the app is silent: stale content presented
 * as current, edited, then refused by a conflict dialog blaming a concurrent
 * editor."* Three wrong things in a row, the last of which accuses the user of
 * a conflict that never happened.
 *
 * **Absent when there is nothing wrong**, which is the whole of its design. A
 * permanently-present *0 problems* panel on a library page is a thing people
 * learn to stop seeing, and this has to be noticed the once it matters. It is
 * also why it sits on the library rather than in settings: the quarantine is
 * about *these objects*, and the page that lists them is where somebody is
 * standing when one is missing from the list.
 *
 * **Paths, not native paths.** `library.ts` makes them portable on the way out
 * — the reader needs to know *which folder*, and a server's disk layout is not
 * theirs to reason about. A row whose path escaped the data directory says so
 * rather than printing something that looks relative and is not.
 */
export function QuarantinePanel(): JSX.Element | null {
  const errors = useQuery({
    queryKey: ['library', 'errors'],
    queryFn: () => api.libraryErrors(),
  });

  const rows = errors.data?.errors ?? [];
  // Silent while loading and silent when clean: the one state worth a row on
  // this page is *something is wrong*, and a spinner for a list that is almost
  // always empty is noise on every visit.
  if (rows.length === 0) return null;

  return (
    <section className="mb-6">
      <SectionTitle as="h2">Files the library could not read</SectionTitle>
      <Fine>
        These are on disk and are not in the list above. Nothing was deleted — repair the file, or
        remove the folder.
      </Fine>
      <ul className="mt-2 flex flex-col gap-2">
        {rows.map((row) => (
          <li key={`${row.source}:${row.path}`}>
            <Alert tone="error">
              <QuarantineRow row={row} />
            </Alert>
          </li>
        ))}
      </ul>
    </section>
  );
}

function QuarantineRow(props: { row: LibraryFileError }): JSX.Element {
  const { row } = props;
  return (
    <div>
      <code className="break-all text-xs">{row.path}</code>
      {/* The reason is the server's vocabulary and the detail is the parser's.
          Both, because the first says which class of problem it is and the
          second is the only thing that says where in the file to look. */}
      <p className="mt-1 text-sm">{row.reason}</p>
      {row.detail === null ? null : <Fine>{row.detail}</Fine>}
    </div>
  );
}
