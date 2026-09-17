// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { FailureRemedy } from '@storyengine/shared';

import { labels } from './i18n/catalogue.js';

/**
 * ***What a person is told when a turn could not finish*** —
 * [09 §6.5](../../../docs/design/09-server-multiuser-deployment.md),
 * [P11.6](../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **What this replaced, verbatim: *The turn failed (transient). Reload to try
 * again.*** The class the engine settled on was rendered at a reader, and
 * `transient` is a word about our retry ladder — it tells somebody nothing about
 * their evening, their wifi or their model server. [P6B.0] added the class
 * because *a turn that failed because a role was unbound and one that failed
 * because the server restarted produced the same sentence*, which was the right
 * diagnosis and the wrong vocabulary: the fix was more information, and what it
 * shipped was more jargon.
 *
 * ***A top-level module because it has two consumers in different
 * directories*** — the transcript's failed-turn note and the notification
 * catalogue. A copy in each is how two surfaces come to describe one failure
 * differently, which is the defect this stage is fixing in the first place.
 *
 * ***The sentences are here rather than on the server***, which is
 * [19 §12.4](../../../docs/design/19-tech-stack.md)'s rule and
 * [work plan §2](../../../docs/design/workplan/01-work-plan.md)'s: the server sends
 * classes and the client holds words.
 * [P11.8](../../../docs/design/workplan/28-p11-implementation.md) folds this
 * map into the catalogue with nothing to rewrite, because it is already the
 * right shape — one open key per sentence, English on the client.
 *
 * ***Exhaustive by the compiler rather than by a grep***, which is the one place
 * this differs from [`note-labels.ts`](./library/note-labels.ts)'s model. That
 * file explains the trade it made — a shared registry would be checked by the
 * compiler and would make every converter import one to add a note — and takes
 * the looser side *because that vocabulary should keep growing cheaply*. This
 * one is a **closed union in `@storyengine/shared`** decided by
 * [`remedy.ts`](../../shared/src/remedy.ts), and a closed union costs
 * nothing to check properly. `Record<FailureRemedy, string>` means the server
 * cannot add an arm without this file failing to build.
 *
 * ***No sentence claims anything nothing checked.*** `endpoint-silent` exists
 * precisely so that *we have not looked at this server's internet* does not get
 * rounded to *your internet is down* — the mistake [09 §6.5] warns about, in
 * which the operator of a deliberately local install is sent to look at their
 * router.
 */
export const REMEDY_SENTENCES: Record<FailureRemedy, string> = labels('failure.remedy', {
  'endpoint-silent-local':
    'Nothing answered at the model endpoint on this network. The model server is probably not running.',
  'endpoint-silent-offline':
    'This server appears to have no internet access, so it could not reach the model endpoint.',
  'endpoint-silent-online':
    'The model endpoint did not answer, though this server’s internet is working. Check the address in Settings.',
  'endpoint-silent':
    'Nothing answered at the model endpoint. Check that it is running and that the address is right.',
  'endpoint-busy': 'The model endpoint is busy or having trouble. Try again in a moment.',
  'endpoint-refused':
    'The model endpoint refused the request. Check the key, the model name and the permissions in Settings.',
  'endpoint-stalled': 'The model endpoint accepted the request and then went quiet.',
  'not-bound': 'No connection is set up for the model this step needs. Bind one in Settings.',
  engine: 'The server could not finish the turn. Nothing is wrong with your connection.',
});

/**
 * The sentence for a remedy, or null when there is none to give.
 *
 * **Null rather than a fallback sentence**, because the two callers want
 * different things around it — one adds *Reload to try again*, the other is a
 * notification body — and an invented middle sentence would read as a claim.
 * *A newer server's remedy this build has never heard of lands here*, and
 * saying nothing extra is the honest answer to a version skew.
 */
export function remedySentence(remedy: string | null): string | null {
  return remedy !== null && remedy in REMEDY_SENTENCES
    ? REMEDY_SENTENCES[remedy as FailureRemedy]
    : null;
}
