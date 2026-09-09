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
 * bug report needs in one copy-paste. The §13 source link and the licence
 * boundary are not here: the link goes in the footer when publication brings it
 * ([10 §15.1]).
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
    </section>
  );
}
