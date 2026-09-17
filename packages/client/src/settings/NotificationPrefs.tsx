// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { browserChannel } from '../notifications/browser.js';
import {
  choiceFor,
  choicePatch,
  mutedPatch,
  notificationPrefs,
  NOTIFYING_CLASSES,
  startMutedPatch,
  type DeliveryChoice,
} from '../notifications/prefs.js';
import { usePatchPrefs, usePrefs } from '../queries.js';
import { CheckboxField, SelectField } from '../ui/Field.js';

/**
 * **One row per notification class** —
 * [09 §3.5](../../../../docs/design/09-server-multiuser-deployment.md),
 * [10 §9](../../../../docs/design/10-ui-surfaces.md),
 * [10 §15.1](../../../../docs/design/10-ui-surfaces.md), [P10.3].
 *
 * ***Four rows, and the count is the rule rather than the current state of the
 * code.*** [09 §3.5]'s table prints six and [P10 §1.4] says *every class either
 * has a producer or is not shipped* — so `turn.awaiting-input` and
 * `message.received` have no rows here, because a preference row for a class
 * nothing emits is [work plan §2.3]'s failure inverted: a surface for
 * configuring something that never happens. **The list comes from
 * `NOTIFYING_CLASSES`**, which the router's own union is checked against, so a
 * fifth class cannot arrive with no row or a row with no class.
 *
 * ***The mute is above the rows and it is sound-only***, because [10 §9] asks
 * for *"per-class volume, a global mute, and a start-muted preference"* and a
 * global mute that is four gestures is not global. What it does not do is stop
 * you being *shown* things: muting a tab is not a request to stop seeing.
 *
 * **In the user half, beside Preferences**, for `MyRoles`' reason: this is a
 * fact about one person's ears rather than about the install, so it is not
 * inside the admin conditional and its writes go to `prefs.json`.
 */

/**
 * *Louder first*, which is the reverse of the theme list's ordering and
 * deliberate: the default is the loud one, and a person scanning a row should
 * meet the current behaviour before the ways to reduce it.
 */
const CHOICES: readonly (readonly [DeliveryChoice, string])[] = [
  ['sound', 'Sound and a toast'],
  ['quiet', 'A toast, no sound'],
  ['off', 'Only the unread count'],
];

/**
 * What each class is, in words — and **not** [`labels.ts`](../notifications/labels.js)'s
 * words.
 *
 * *Two catalogues, and the split is not duplication.* That one composes a
 * **notification** — *Your turn is ready* — and this one names a **kind of
 * thing that happens**, which is a different sentence in every language and
 * would read as a stray notification if it were borrowed. The mechanical check
 * over there is about classes the server emits; this is about rows a person
 * reads.
 */
const ROWS: Record<string, { label: string; hint: string }> = {
  'turn.complete': {
    label: 'A turn finishes',
    hint: 'The case this exists for: you walked away while a long turn was being written.',
  },
  'turn.failed': {
    label: 'A turn fails',
    hint: 'Something went wrong and the turn stopped. Not shown for a turn you stopped yourself.',
  },
  'artifact.ready': {
    label: 'A picture is ready',
    hint: 'An illustration or a backdrop has finished, or could not be made.',
  },
  'system.notice': {
    label: 'The server needs attention',
    hint: 'A saved setting waiting for a restart, and other install-level notices.',
  },
};

export function NotificationPrefs(): JSX.Element {
  const prefs = usePrefs();
  const patch = usePatchPrefs();

  if (prefs.isPending) return <p className="text-sm text-ink-faint">Loading…</p>;
  if (prefs.isError) return <p role="alert">Your preferences could not be read.</p>;

  const held = notificationPrefs(prefs.data.prefs);

  return (
    <section className="flex flex-col gap-6" aria-labelledby="notification-prefs">
      <h2 id="notification-prefs" className="text-section text-ink">
        Notifications
      </h2>

      <div className="flex max-w-md flex-col gap-4">
        <CheckboxField
          label="Mute sounds"
          checked={held.muted}
          hint="Toasts and the unread count are unaffected. You can also mute for one sitting from the Notifications button in the header."
          onChange={(value) => {
            patch.mutate(mutedPatch(value));
          }}
        />
        <CheckboxField
          label="Start muted every time"
          checked={held.startMuted}
          hint="For a shared room: each new page starts silent until you turn sound back on."
          onChange={(value) => {
            patch.mutate(startMutedPatch(value));
          }}
        />

        {NOTIFYING_CLASSES.map((one) => {
          const row = ROWS[one];
          if (row === undefined) return null;
          return (
            <SelectField
              key={one}
              label={row.label}
              hint={row.hint}
              value={choiceFor(held, one)}
              options={CHOICES}
              onChange={(value) => {
                patch.mutate(choicePatch(one, value as DeliveryChoice));
              }}
            />
          );
        })}

        <SecureContextNote />

        {patch.isError ? (
          <p role="alert" className="text-sm text-danger-ink">
            {patch.error.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * ***[09 §3.6]'s first obligation, in the place that section names.***
 *
 * *"The notification settings screen detects an insecure context and explains it
 * in one sentence with the fix, rather than offering a permission prompt the
 * browser will refuse. A greyed toggle with no reason is the worst version of
 * this."* So there is no toggle at all here — the ask lives in the notification
 * list, where somebody is already looking at notifications — and what this adds
 * is the sentence, at the point where a person is deciding how they want to be
 * told.
 */
function SecureContextNote(): JSX.Element | null {
  if (browserChannel() !== 'insecure-context') return null;

  return (
    <p className="text-xs text-ink-faint">
      Your browser will not show notifications outside this tab, because StoryEngine is reached over
      plain HTTP and that is not a secure context. The sounds and toasts above are unaffected.
      Reaching it over HTTPS — a reverse proxy, or Tailscale — turns the rest on.
    </p>
  );
}
