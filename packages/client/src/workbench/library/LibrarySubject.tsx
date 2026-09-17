// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { ApiError, type LibraryKind, type ObjectAddress } from '../../api.js';
import { useAuthState, useIndexRows, useLibraryObject, useObjectHistory } from '../../queries.js';
import { ObjectSubject } from './ObjectSubject.js';
import { Note } from '../../ui/Text.js';

/**
 * The fetching half of the library subject, the way `PlaySubject` is for the
 * turn: the panel is a stateless reader, so everything here is a query the
 * route parameters name. All three reads share the detail page's cache
 * prefix and its two-second poll — which is what gate step 7's *hand-edit
 * the file and watch the panel follow* rides on: the watcher re-indexes the
 * foreign write, and the next poll shows it here without a visit.
 *
 * The `at` discriminator travels into the object read only. The rows and
 * the history are facts about the *id* — every copy, one history folder per
 * copy addressed by the winner — so narrowing them by copy would claim a
 * precision the server does not offer.
 */
export function LibrarySubject({
  kind,
  id,
  at,
}: {
  kind: LibraryKind;
  id: string;
  at: ObjectAddress | undefined;
}): JSX.Element {
  const object = useLibraryObject(kind, id, at);
  const rows = useIndexRows(kind, id);
  const history = useObjectHistory(kind, id);
  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;

  if (object.isPending) {
    return <Note>Loading the object…</Note>;
  }
  if (object.isError) {
    return (
      <p role="alert" className="text-sm text-danger-ink">
        {object.error instanceof ApiError && object.error.status === 404
          ? 'There is no such object in your library.'
          : object.error.message}
      </p>
    );
  }
  return (
    <ObjectSubject
      kind={kind}
      object={object.data}
      rows={rows.data?.rows}
      versions={history.data?.versions}
      locale={locale}
    />
  );
}
