// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { NotificationView } from './types.js';

/**
 * **The notification vocabulary: one sentence per class the server emits** —
 * [19 §12.5](../../../../docs/design/19-tech-stack.md), [P10.2].
 *
 * The server never sends a sentence. [09 §3.4](../../../../docs/design/09-server-multiuser-deployment.md)
 * makes `params` the payload of a `{ key, params }` summary *"composed at
 * display time"*, and warns what happens when the params do not carry enough:
 * *"New event in session 4f2a"*. This is where the words live, and the reason
 * they live on this side is that the server does not know the reader's language.
 *
 * ***This is `library/note-labels.ts` on a second subject, and the precedent is
 * followed deliberately rather than rediscovered.*** That table had drifted by
 * twenty-four keys with nothing saying so, because `sentence()` renders an
 * unlabelled key **as itself** — correct for a version skew, and a silent defect
 * for a build shipped against itself. `labels.test.ts` greps the server's own
 * `NotificationClass` union against this file for exactly that reason: a fifth
 * class shipped without a sentence fails loudly.
 *
 * **Two sentences per class, not one**, and that is the one structural
 * difference from the import table. A notification is shown in three places
 * — a toast, a list row, and a browser notification with a title and a body —
 * so a single string would have to serve as both a headline and an explanation
 * and would be bad at one of them.
 */
export interface NotificationLabel {
  /** The headline. A browser notification's title, and a list row's first line. */
  title: string;
  /** The detail, or an empty template when the headline says everything. */
  body: string;
}

export const NOTIFICATION_LABELS: Record<string, NotificationLabel> = {
  'turn.complete': {
    title: 'Your turn is ready',
    /**
     * *The session by name*, which is the whole reason [09 §3.4] insists the
     * params carry what the sentence needs. A person with three sessions open
     * and a notification that names none of them has been told nothing.
     */
    body: '{sessionName}',
  },
  'turn.failed': {
    title: 'A turn could not finish',
    // The class, not a sentence: `rate-limit` and `no-binding` are words the
    // reader can act on, and the endpoint's own prose went to the log.
    body: '{sessionName} — {error}',
  },
  'artifact.ready': {
    title: 'A picture is ready',
    body: '{purpose}',
  },
  /**
   * ***The one class whose title is wrong until the params are read***, which
   * is why {@link summary} special-cases it rather than the table carrying two
   * more rows. A failed picture is the same subject in a different state
   * ([09 §3.5]) and the state is in `outcome`.
   */
  'artifact.ready:failed': {
    title: 'A picture could not be made',
    body: '{purpose}',
  },
  'system.notice': {
    title: 'Something needs your attention',
    body: '{notice}',
  },
  'system.notice:restart-required': {
    title: 'A setting needs a restart',
    body: 'Waiting for a restart: {keys}.',
  },
};

/**
 * The sentence a notification renders as.
 *
 * ***Two lookups, most specific first***, which is how a class whose meaning
 * turns on one param gets its own words without becoming its own class. The
 * server deliberately did not split `artifact.ready` in two — [09 §3.5] named it
 * so its second instance would not require renaming it — and a restart notice is
 * one of several `system.notice`s. So the *variant* is a display concern and it
 * is resolved here.
 *
 * **The fallback renders the raw key**, which is `sentence()`'s rule: a newer
 * server's class appears as itself rather than as a blank. `labels.test.ts` is
 * what keeps that from being how this build ships.
 */
export function summary(notification: Pick<NotificationView, 'class' | 'params'>): {
  title: string;
  body: string;
} {
  const variant = variantKey(notification);
  const label =
    (variant === null ? undefined : NOTIFICATION_LABELS[variant]) ??
    NOTIFICATION_LABELS[notification.class];

  if (label === undefined) return { title: notification.class, body: '' };
  return {
    title: fill(label.title, notification.params),
    body: fill(label.body, notification.params),
  };
}

/**
 * The param that decides which words a class gets, when one does.
 *
 * A table rather than a chain of ifs, so adding a variant is a line here and a
 * line above rather than a branch somebody has to find.
 */
const VARIANT_BY: Record<string, string> = {
  'artifact.ready': 'outcome',
  'system.notice': 'notice',
};

function variantKey(notification: Pick<NotificationView, 'class' | 'params'>): string | null {
  const field = VARIANT_BY[notification.class];
  if (field === undefined) return null;
  const value = notification.params[field];
  return typeof value === 'string' ? `${notification.class}:${value}` : null;
}

/** `{name}` substitution, which is all the catalogue needs until ICU arrives. */
function fill(template: string, params: Record<string, string | number | boolean>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = params[key];
    return value === undefined ? whole : String(value);
  });
}

/**
 * What a folded notification adds, if anything.
 *
 * ***`folded` is the field [09 §3.4] built the whole coalescing rule for***, and
 * it is useless if nothing renders it: *"five characters replying in a group
 * chat is one notification, not five"* — and *not five* is only true of the
 * badge if the row says it stands for five. A row that silently swallowed four
 * arrivals would be the replace-on-conflict implementation with extra steps.
 */
export function foldedSuffix(folded: number): string {
  return folded > 1 ? ` (${String(folded)})` : '';
}
