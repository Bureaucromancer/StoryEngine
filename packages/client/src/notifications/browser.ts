// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Channel 2 — the browser's own notifications,
 * [09 §3.6](../../../../docs/design/09-server-multiuser-deployment.md), [P10.2].
 *
 * ***"Small step, large practical gain"*** is §3.6's whole argument for it, and
 * it is true: the API is three calls. What is not small is the **collision**
 * that section then records against itself, and this module's real job is to
 * make that collision legible rather than to call `new Notification()`.
 *
 * ***The Notification API requires a secure context, and the default install is
 * not one.*** `localhost` is trustworthy by definition; `http://192.168.1.50:8080`
 * — which is [09 §5.1]'s recommended default, LAN over plain HTTP — is not. So
 * on the install this project tells people to run, **channel 2 is unavailable no
 * matter what is built here**. §3.6 states the obligation that follows: *"say so
 * where the user chooses… a greyed toggle with no reason is the worst version of
 * this."*
 *
 * {@link browserChannel} is that sentence made answerable. It distinguishes four
 * states — unsupported, blocked by the context, not yet asked, and decided — so
 * a surface can say *which* of those it is instead of rendering a dead control.
 */

export type BrowserChannelState =
  /** No `Notification` at all. An old browser, or a test environment. */
  | 'unsupported'
  /**
   * The API exists and the page is not a secure context, so permission can
   * never be granted. **The default LAN-over-HTTP install lands here**, and it
   * is the state that needs a sentence rather than a disabled switch.
   */
  | 'insecure-context'
  /** Askable: nobody has answered the permission prompt yet. */
  | 'askable'
  /** Granted, and notifications will be shown when the tab is hidden. */
  | 'granted'
  /** Refused by the person. Not re-askable — only the browser's own UI can undo it. */
  | 'denied';

interface NotificationApi {
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  new (title: string, options?: NotificationOptions): Notification;
}

function api(): NotificationApi | null {
  const held = (globalThis as { Notification?: NotificationApi }).Notification;
  return held ?? null;
}

/**
 * Where this install stands, right now.
 *
 * ***`isSecureContext` is checked before `permission`, and the order carries the
 * finding.*** A browser on plain HTTP reports `permission: 'default'` — which
 * reads as *askable* — and then refuses the prompt. Asking first would produce
 * exactly the experience §3.6 forbids: a control that appears to work, does
 * nothing, and explains neither.
 */
export function browserChannel(): BrowserChannelState {
  const held = api();
  if (held === null) return 'unsupported';
  if (!globalThis.isSecureContext) return 'insecure-context';
  if (held.permission === 'granted') return 'granted';
  if (held.permission === 'denied') return 'denied';
  return 'askable';
}

/**
 * Asks, once, and answers with where things now stand.
 *
 * **Must be called from a user gesture** — browsers refuse a permission prompt
 * that no click preceded, and some of them count an unprompted request against
 * the origin. So there is no *ask on load*: the affordance is a button.
 */
export async function askForBrowserNotifications(): Promise<BrowserChannelState> {
  const held = api();
  if (held === null || browserChannel() === 'insecure-context') return browserChannel();
  try {
    await held.requestPermission();
  } catch {
    // Some browsers reject rather than resolving 'denied'. Same outcome.
  }
  return browserChannel();
}

/**
 * Shows one, if this channel is available.
 *
 * ***Only when the page is hidden***, which is the division of labour §3.6 sets
 * out: channel 1 *"covers the completion-sound case entirely"* in a foreground
 * tab, and channel 2 is for *"when the tab is backgrounded"*. Both firing at
 * once is the same news twice, and the operating-system one is the more
 * intrusive of the two — so the foreground case keeps the quieter channel.
 *
 * **Never throws.** It shares a delivery path with the sound and the badge.
 */
export function showBrowserNotification(input: {
  title: string;
  body: string;
  /** Collapses repeats of the same subject, the way `dedupeKey` does server-side. */
  tag?: string;
}): void {
  const held = api();
  if (held === null || browserChannel() !== 'granted') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;

  try {
    new held(input.title, {
      body: input.body,
      ...(input.tag === undefined ? {} : { tag: input.tag }),
    });
  } catch {
    // A browser that requires a service worker for this (some mobile ones do)
    // throws here. Losing the OS notification is not losing the notification.
  }
}
