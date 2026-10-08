// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { findRelease } from '@storyengine/shared';

import { formatCalendarDate } from '../../format.js';
import { CHANGELOG, NEWEST } from '../../home/log.js';
import { useAuthState } from '../../queries.js';
import { Badge } from '../../ui/Badge.js';
import { link, table } from '../../ui/classes.js';
import { Note, SubsectionTitle } from '../../ui/Text.js';

/**
 * Every release this build's changelog carries — [home, revised], the
 * workbench's subject over `/`.
 *
 * **This is a reader, and that is not a courtesy.**
 * [10 §3](../../../../../docs/design/10-ui-surfaces.md) names `ImportSubject` as
 * the *honest residue* — the one subject that is not a reader — and warns in the
 * same breath that *"one exception is a decision; two is a definition nobody
 * updated."* This is not the second, and the test is the relationship between
 * the two subjects rather than a promise about this one. The main view's subject
 * is **a release of this build's changelog**; the panel's is **every release of
 * the same document** — the same subject at list scale, which is exactly the
 * relationship `TurnPicker` has to `TurnSubject` and the reason a picker is
 * allowed in this panel at all. It holds no state: the selection is in the
 * address, the list is derived from a string the bundle already contains, and it
 * issues no request of its own. *(2026-10-07: the string is in a chunk now, and
 * so is this component — `Workbench.tsx` loads it with `lazy()`,
 * [21 §7.3](../../../../../docs/design/21-client-loading.md). Fetching part of
 * the build is not a request for data, so the sentence stands.)*
 *
 * *What would make it the second exception*, said plainly so the line stays
 * visible: a control here that changed something, or a subject that survived
 * leaving `/`.
 *
 * **A table rather than a `<select>`, and the difference from `TurnPicker` is
 * argued rather than ignored.** That picker is a select because *"a scrollable
 * turn list in [a two-hundred-pixel column] would be a second transcript
 * competing with the first."* Nothing here competes: home's panel shows one
 * release, never the history, so the list is the only place the history exists.
 * And a session's turns grow without bound while releases grow by a handful a
 * year — four today — so the argument that made a select right there does not
 * reach this.
 */
export function ReleaseSubject({ selected }: { selected: string | undefined }): JSX.Element {
  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;
  /**
   * **`null` is a development run**, which is every build nobody identified
   * ([P6A §1.5], and `about/labels.ts` says it in words). Then no row is
   * badged — the honest answer, rather than badging the newest on the
   * assumption that a developer is running the tip of it. A version the file
   * does not contain is unbadged for the same reason.
   */
  const running = auth.data?.build?.version;

  // The same lookup and the same fallback the page makes, through the same
  // function — which is why `findRelease` lives in `shared` rather than in
  // either surface. A panel whose highlighted row was not the release beside it
  // is the failure this forecloses, including in the `?release=9.9.9` case
  // where both land on the newest.
  const shown = (selected === undefined ? undefined : findRelease(CHANGELOG, selected)) ?? NEWEST;

  return (
    <section aria-label="Releases" className="flex flex-col gap-3">
      <SubsectionTitle as="h4">Releases</SubsectionTitle>
      {CHANGELOG.releases.length === 0 ? (
        <Note>This build’s changelog carries no releases.</Note>
      ) : (
        <>
          <Note>Every release this build’s changelog carries, newest first.</Note>
          <table className={table.root}>
            <thead>
              <tr className={table.head}>
                <th className={table.thCompact}>Release</th>
                <th className={table.thCompact}>Date</th>
              </tr>
            </thead>
            <tbody>
              {CHANGELOG.releases.map((release) => (
                <tr
                  key={release.version}
                  /**
                   * **The mark has to be visible, not only announced.**
                   * `aria-current` on the link below says which release the
                   * page is showing, and on its own that is a marker half the
                   * people using this panel cannot perceive — `ui/Panel.tsx`
                   * makes the same point about its own current state, one step
                   * further on: *a focus mark that exists only as a colour is a
                   * focus mark half the people using the page cannot perceive.*
                   * A filled row is the cheapest thing that reads at a glance
                   * and does not compete with the *This build* badge, which
                   * answers a different question in the same row.
                   */
                  className={release === shown ? `${table.row} bg-surface-muted` : table.row}
                >
                  <td className={table.cellCompact}>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* **The newest row links to `/` with no query**, not to
                          its own version. That is `TurnPicker`'s blank option —
                          *"not `no turn`… a live answer rather than an
                          absence"* — so the default release keeps the default
                          address and the history does not leave a query string
                          behind for the sake of one. */}
                      <Link
                        to="/"
                        search={release === NEWEST ? {} : { release: release.version }}
                        className={link.object}
                        /**
                         * **Both halves of this are load-bearing, and the
                         * default was wrong.** Every row's `to` is `/`, so the
                         * router's own active detection compares addresses that
                         * differ only in a search param — and its default
                         * treats a link's search as a *subset* match, under
                         * which the newest row's `{}` is a subset of every
                         * address and so every release lit the newest as well
                         * as itself. `exact` with `includeSearch` is what makes
                         * the comparison the one a reader means.
                         *
                         * The explicit `aria-current` is then the authority
                         * rather than a duplicate of it: for `?release=9.9.9`
                         * no row's address matches at all, and the panel must
                         * still mark the newest, because that is the release
                         * the page fell back to and rendered. A panel whose
                         * marked row disagreed with the prose beside it is the
                         * failure both of these exist to prevent, and
                         * `subject.test.tsx` asserts the mark is unique rather
                         * than merely present.
                         */
                        activeOptions={{ exact: true, includeSearch: true }}
                        aria-current={release === shown ? 'page' : undefined}
                      >
                        {release.name}
                      </Link>
                      {running === release.version ? (
                        <Badge tone="neutral">This build</Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className={table.cellCompact}>{formatCalendarDate(release.date, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
