// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { UnmetRequirement } from '@storyengine/shared';

import { labels } from '../i18n/catalogue.js';
import { useSession } from '../queries.js';
import { roleLabel } from '../settings/roleWords.js';
import { Alert } from '../ui/Alert.js';

/**
 * ***What this session was started without*** — 2026-10-13, the owner's
 * answer to *"Build the promise, or narrow the notes"*: build it.
 *
 * A session started with **Start anyway** past `unmet-requirements`
 * (`StartAnyway.tsx`) records what it lacked (`session.startedWithout`, written
 * once at creation), and this says it on the session's page — the persistent
 * banner [06 §4.2](../../../../docs/design/06-modes-and-turn-pipeline.md) asks
 * for a degraded session, *not a modal and not a log line*. It is also where
 * a session that travels says it: the record goes with a session export.
 *
 * **In `ChannelHealth`'s register, and quieter.** `tone="warning"` because
 * something is missing and play goes on; `role="status"` because it is on the
 * page when it loads, not raised by anything the person just did; and the
 * reassurance — *it plays without them* — because the person chose this, and
 * the line is a reminder of a decision rather than news of a failure. No
 * controls: nothing here can be fixed from the session (installing a mode, or
 * choosing a model in Settings, does not change how this one started).
 *
 * ***Small on purpose*** — one Alert above the transcript beside the health
 * banner. [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) moves
 * the play page's panels; this moves with them.
 * *(2026-10-14: it did not move.
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.5 sorted it
 * onto Play, under* In these worlds*, since a standing warning about the whole
 * session with nothing in it to set is not configuration, while P12A.4 had
 * already made the health banner the HUD strip's first item. The two are no
 * longer side by side: this line sits above the strip, and above* Set the
 * scene *for a mode with a stage, still in the banner's register. P12A.5's
 * table in §2 has the row.)*
 *
 * Each item a short phrase per kind, whole, from a labels table — a list of
 * things, so no sentence is built from fragments.
 */

const WORDS = labels('session.started-without', {
  headline: 'This session started without what its world or setup asked for.',
  reassure: 'It plays without them:',
  mode: 'the {mode} mode — it plays in this install’s default mode',
  modeAsked: 'the {mode} mode',
  modeOlder: 'the {mode} mode at version {minVersion} or later — it uses {installed}',
  capability: 'a model for “{capability}”',
  capabilityUnknown: '“{capability}”, which this build cannot check for',
  extension: 'the {extension} extension',
  unknown: '“{id}”',
});

export function StartedWithout(props: { sessionId: string }): JSX.Element | null {
  const session = useSession(props.sessionId);
  const unmet = session.data?.session.startedWithout?.unmet ?? [];
  if (unmet.length === 0) return null;

  return (
    <Alert tone="warning" role="status" className="flex flex-col gap-1">
      <p>
        <strong>{WORDS.headline}</strong> {WORDS.reassure}
      </p>
      <ul className="list-disc ps-5">
        {unmet.map((one) => (
          <li key={`${one.kind}:${one.id}`}>{phrase(one)}</li>
        ))}
      </ul>
    </Alert>
  );
}

/** One item as a short phrase — what it lacked, and for a mode what it plays instead. */
function phrase(one: UnmetRequirement): string {
  switch (one.kind) {
    case 'mode':
      if (one.installed !== null) {
        return WORDS.modeOlder
          .replace('{mode}', () => one.id)
          .replace('{minVersion}', () => one.minVersion ?? '')
          .replace('{installed}', () => one.installed ?? '');
      }
      return (one.substituted === true ? WORDS.mode : WORDS.modeAsked).replace(
        '{mode}',
        () => one.id,
      );
    case 'capability':
      return (one.checkable ? WORDS.capability : WORDS.capabilityUnknown).replace(
        '{capability}',
        () => roleLabel(one.id),
      );
    case 'extension':
      return WORDS.extension.replace('{extension}', () => one.id);
    default:
      return WORDS.unknown.replace('{id}', () => (one as { id: string }).id);
  }
}
