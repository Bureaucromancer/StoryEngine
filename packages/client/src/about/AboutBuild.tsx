// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { BuildInfo } from '../api.js';
import { MetadataRow } from '../ui/MetadataRow.js';
import { Note, SectionTitle } from '../ui/Text.js';
import { buildLine } from './labels.js';

/**
 * What build this is, at the top of Settings — the first content of the About
 * surface [09 §7] and P11.6 plan, pulled forward at alpha.2 because a build
 * nobody can name from inside the app is a bug report nobody can file.
 *
 * On the user half, for every account: the data is `auth/state`'s, not the
 * admin route's, so the *absent is absent* mechanism the page is built on is
 * untouched — a non-admin's browser still asks `/api/admin/*` for nothing.
 *
 * The heading is the same line the footer shows, from the same function, so the
 * two cannot disagree; beneath it the string and the commit, which is what a
 * bug report needs in one copy-paste. ~~The §13 source link and the licence
 * boundary are not here: the link goes in the footer when publication brings it
 * ([10 §15.1]).~~
 *
 * ***The link went to the footer at [P10.5] and the boundary came here***, and
 * the split is [09 §7]'s: the **offer** has to be *"visible to every logged-in
 * user, not buried in an admin screen"*, which the footer is and this is not;
 * the **boundary** is a paragraph somebody reads once, which is what an About
 * block is for. Saying both halves clearly and in the same place is *"the
 * cheapest available defence against the misreading that copyleft is creeping
 * into people's stories"* — and the same place is this surface, with the link
 * one element down the page.
 */
export function AboutBuild(props: { build: BuildInfo | null | undefined }): JSX.Element | null {
  if (props.build === undefined) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="about">
      <SectionTitle id="about">{buildLine(props.build)}</SectionTitle>
      {props.build === null ? (
        <Note>
          Nothing identified this build, so there is no version or commit to report. Every
          development run looks like this; a release build carries both.
        </Note>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <MetadataRow label="Version">
            <code className="text-xs">{props.build.version}</code>
          </MetadataRow>
          <MetadataRow label="Commit">
            <code className="break-all text-xs">{props.build.commit}</code>
          </MetadataRow>
        </dl>
      )}
      <Licence />
    </section>
  );
}

/**
 * ***The licence boundary, both halves, in one place*** —
 * [09 §7](../../../../docs/design/09-server-multiuser-deployment.md),
 * [triage §1.2](../../../../docs/design/workplan/02-triage.md), [P10.5].
 *
 * The project *"asks copyleft of one category and nothing of the other"*, and
 * §7 says why that has to be stated rather than left to be inferred: it is the
 * cheapest defence against the misreading that copyleft is creeping into
 * people's stories. **Somebody who writes a character here should be able to
 * find out, in one place, that it is theirs.**
 *
 * *For every account rather than for admins.* The person who needs this
 * sentence is the one who authored something, which is everybody.
 */
function Licence(): JSX.Element {
  return (
    <div className="flex flex-col gap-2 text-sm text-ink-muted">
      <p>
        StoryEngine is free software under the GNU Affero General Public License, version 3 or
        later. The <strong>Source</strong> link at the foot of every page leads to the source for
        the exact build this install is running.
      </p>
      <p>
        <strong>Code extensions and modes are AGPL-3.0 too</strong>, because they import the SDK and
        run inside this process.
      </p>
      <p>
        <strong>What you write is yours.</strong> Actors, treatments, lorebooks, presets, sessions
        and packages — including the rules you author in them — are data this program produced, not
        derivative works of it. Nobody’s characters become AGPL by being written here, and a package
        of rules can be licensed however its author likes, or not at all.
      </p>
    </div>
  );
}
