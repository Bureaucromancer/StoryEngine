// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { LibraryFileError, LibraryObject } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { useLibraryErrors } from '../queries.js';
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
  const errors = useLibraryErrors();

  const rows = errors.data?.errors ?? [];
  // Silent while loading and silent when clean: the one state worth a row on
  // this page is *something is wrong*, and a spinner for a list that is almost
  // always empty is noise on every visit.
  if (rows.length === 0) return null;

  return (
    <section className="mb-6">
      <SectionTitle as="h2">Files the library could not read</SectionTitle>
      {/*
        ***Corrected 2026-09-28.*** ~~These are on disk and are not in the
        list above~~ — the panel is above the list, and a file that broke
        after it was read *is* in it: the index keeps the last good version
        rather than lose the object (`ingest.ts`, `recordInvalid`). Only a
        file that never read is missing from it.
      */}
      <Fine>
        These are on disk and could not be read. Nothing was deleted. One that read before is still
        in the list below as it last read, and its page says so; one that never did is not in it.
        Repair the file, or delete it — from its page, or by removing its folder.
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
          second is the only thing that says where in the file to look. The
          reason is said in words since 2026-09-28; it was printed as its code. */}
      <p className="mt-1 text-sm">{reasonWords(row.reason)}</p>
      {row.detail === null ? null : <Fine>{row.detail}</Fine>}
    </div>
  );
}

/**
 * ***Why a file was refused, in words*** (2026-09-28), keyed by the server's
 * `FileErrorReason`; `file-error-reasons.test.ts` holds this table to that
 * union. A reason a newer server sends and this build has no words for is
 * shown as itself rather than as nothing.
 */
export const REASON_WORDS: Readonly<Record<string, string>> = labels('library.file-error', {
  unparsable: 'It could not be parsed: it is not JSON, or not a picture this build can read.',
  'wrong-kind': 'It does not describe this kind of object, or it has no id.',
  schema: 'It is this kind of object with something missing, or something of the wrong type.',
  'unusable-name': 'Its folder has a name this system cannot open.',
  unreadable: 'It could not be opened: its permissions, or another program holding it.',
  'refused-path':
    'It is a link to somewhere outside the data folder, which the library does not follow.',
});

export function reasonWords(reason: string): string {
  return Object.hasOwn(REASON_WORDS, reason) ? (REASON_WORDS[reason] ?? reason) : reason;
}

/**
 * ***The trouble with this object's own file, if any*** (2026-09-28) — for the
 * page of an object whose file broke after it was read. Matched by where the
 * file is, which is all a broken file still has: its owner, the kind its
 * folder says, and its folder.
 */
export function fileErrorFor(
  errors: readonly LibraryFileError[] | undefined,
  object: Pick<LibraryObject, 'source' | 'schema' | 'slug'>,
): LibraryFileError | undefined {
  return errors?.find(
    (row) => row.source === object.source && row.kind === object.schema && row.slug === object.slug,
  );
}
