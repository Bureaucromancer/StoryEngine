// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Accounts } from '../auth/accounts.js';
import type { Occurrence } from './router.js';

/**
 * `system.notice`'s producer — [09 §3.5](../../../../docs/design/09-server-multiuser-deployment.md),
 * [P10.1].
 *
 * ***The class [09 §3.4] says has nowhere to be delivered, given somewhere.***
 * That section's argument for a notification table separate from `event` is
 * this class in particular: *"several admin warnings are already specified with
 * nowhere to be delivered."* A restart-required notice is the first of them, and
 * it is the one that is worst as a banner on a page — the person who saved the
 * setting is the person who then closes the settings tab.
 *
 * ***Addressed to every enabled admin rather than to whoever saved.*** The
 * notice is a property of **the install**, not of an act: the keys are pending
 * until somebody restarts, whoever that turns out to be, and an admin who was
 * not at the keyboard is exactly the person who needs telling. [09 §3.1]'s rule
 * — *the server knows who should be told* — reads directly as *ask the account
 * store*, which is what this does.
 */

export interface NoticeContext {
  accounts: Accounts;
  notify: (occurrence: Occurrence) => void;
}

/**
 * Tells the admins that a saved setting needs a restart to take effect.
 *
 * ***Named keys rather than a sentence, and space-joined rather than
 * comma-joined.*** [09 §6.3] is explicit that a bare *restart required* *"invites
 * people to restart and hope"*, so the keys travel; and [19 §12.5] forbids the
 * server composing the list, so what crosses is a token list a client splits and
 * re-joins in its own punctuation. A config key cannot contain a space, which is
 * what makes the separator carry no language.
 *
 * **Nothing pending is nothing said.** A save that changed only `live` keys is
 * an ordinary save, and a notification saying *zero settings need a restart*
 * would be the surface arguing that something happened.
 */
export async function announceRestartPending(
  context: NoticeContext,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;

  const held = await context.accounts.list();
  for (const account of held) {
    if (account.role !== 'admin' || !account.enabled) continue;
    context.notify({
      kind: 'system.notice',
      account: account.handle,
      notice: 'restart-required',
      /**
       * **Actionable, and it is the clearest case the field has.** There is
       * something for a person to *do* — [P10.3]'s *Restart now* is the button
       * — which is [09 §3.4]'s distinction doing real work rather than
       * decorating a row.
       */
      actionable: true,
      params: { keys: [...keys].join(' '), count: keys.length },
    });
  }
}

/**
 * Tells somebody that a backup the server was taking for them did not happen.
 *
 * ***Only failures, and that is the whole of the policy.*** A daily backup that
 * announces itself every day is noise, and noise is how a person stops reading
 * the one that matters. [10 §15.4](../../../../docs/design/10-ui-surfaces.md)
 * sets the same bar for a panel — an *action*, not a statistic — and the action
 * here is real: a schedule that is failing is one somebody has to look at, and
 * the alternative to telling them is that they find out when they need the
 * archive that was never written.
 *
 * ***Addressed by scope, which is `announceRestartPending`'s rule applied one
 * step out.*** An install backup is a property of the install, so every enabled
 * admin hears; an account's own is a property of one person's data, so only
 * they do — and an admin reading *ned's backup failed* would be an admin being
 * told about somebody's library on a surface that has never been about that.
 */
export async function announceBackupFailed(
  context: NoticeContext,
  scope: { kind: 'install' } | { kind: 'account'; handle: string },
): Promise<void> {
  const notice = 'backup-failed';
  if (scope.kind === 'account') {
    context.notify({
      kind: 'system.notice',
      account: scope.handle,
      notice,
      /**
       * **Actionable**: their schedule is in Settings and turning it off, or
       * deleting some archives, is a thing they can do about it.
       */
      actionable: true,
      params: { scope: 'account' },
    });
    return;
  }

  const held = await context.accounts.list();
  for (const account of held) {
    if (account.role !== 'admin' || !account.enabled) continue;
    context.notify({
      kind: 'system.notice',
      account: account.handle,
      notice,
      actionable: true,
      params: { scope: 'install' },
    });
  }
}
