// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { remedyFor, type StepFailureReason } from '@storyengine/shared';

import { remedySentence } from '../failures.js';
import type { NotificationView } from './types.js';

/**
 * **The notification vocabulary: one sentence per class the server emits** —
 * [20 §12.5](../../../../docs/design/20-tech-stack.md), [P10.2].
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
    /**
     * ***`{remedy}` is a sentence and `{error}` was a class*** — [P11.6].
     *
     * The comment here used to read *"the class, not a sentence: `rate-limit`
     * and `no-binding` are words the reader can act on"* — and it named a
     * vocabulary that does not exist. {@link StepFailureReason} is `transient |
     * retryable | terminal | …`, so what a person got in a toast was *Vera's
     * story — transient*. The rule the comment was defending is right and
     * unchanged: **the endpoint's own prose still goes to the log** and never
     * here. What crosses now is a remedy key, which the client turns into words
     * the way it always turned classes into words.
     *
     * {@link summary} falls back to the class when a notification carries no
     * remedy — an older row in the store, a turn that failed before any step
     * did — because a stored notification outlives the build that wrote it.
     */
    body: '{sessionName}{remedy}',
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
  /**
   * ***Only failures are ever announced*** —
   * [P12.5](../../../../docs/design/workplan/29-p12-implementation.md). A daily
   * backup that says so every day is noise, and noise is how somebody stops
   * reading the one that matters.
   *
   * **The body says where to look rather than what went wrong**, because the
   * cause is in the server log and the *action* is in Settings: turn the
   * schedule off, or delete some archives and free the disk.
   */
  'system.notice:backup-failed': {
    title: 'A scheduled backup did not happen',
    body: 'Check the backups in Settings — the disk may be full.',
  },
  /**
   * ***The one notice whose body names a filesystem path, and it is deliberate***
   * — [P12.12](../../../../docs/design/workplan/29-p12-implementation.md).
   * [22 §4.1] keeps paths out of what a person reads because a page somebody
   * screenshots should not describe their disk; the exception is the directory
   * that a restore moved aside, which **is** the undo. A sentence saying *your
   * previous data is safe* without saying where it is would be worse than
   * saying nothing.
   */
  'system.notice:restored': {
    title: 'This install was restored from a backup',
    body: '{files} files came from {archive}. What was here is kept at {moved} — this build will not delete it.',
  },
  'system.notice:restore-failed': {
    title: 'A restore did not happen',
    body: 'The install is unchanged. {why}',
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
  const params = withRemedy(notification.params);
  return {
    title: fill(label.title, params),
    body: fill(label.body, params),
  };
}

/**
 * ***`{remedy}` becomes a sentence, and an older row still gets one*** —
 * [P11.6].
 *
 * Two things happen here and both are about not leaking a machine word into a
 * toast. The remedy the server sent is a **key**, so it is turned into words the
 * way every other class on this surface is. And a notification that carries no
 * remedy — a row stored by a build older than P11.6, or a turn that failed
 * before any step ran — is not left with a literal `{remedy}` on screen:
 * `remedyFor` derives what it can from the class alone, which is the same
 * degrade the transcript makes and lands on the arm that says less.
 *
 * ***It carries its own separator***, which is {@link foldedSuffix}'s shape and
 * is here for the same reason: a row with nothing to add must read as the
 * session's name and not as *Vera's story — *. `fill` renders an unmatched
 * `{name}` as itself — right for a missing name, useless for a missing sentence
 * — so the empty case has to be an empty **string** rather than an absent param.
 */
function withRemedy(
  params: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const stated = typeof params['remedy'] === 'string' ? params['remedy'] : null;
  const derived =
    stated === null && typeof params['error'] === 'string'
      ? remedyFor({ reason: params['error'] as StepFailureReason, online: null })
      : stated;
  const sentence = remedySentence(derived);
  return { ...params, remedy: sentence === null ? '' : ` — ${sentence}` };
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
