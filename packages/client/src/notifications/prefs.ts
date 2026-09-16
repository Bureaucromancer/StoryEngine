// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The notification preference model — [09 §3.5](../../../../docs/design/09-server-multiuser-deployment.md),
 * [10 §9](../../../../docs/design/10-ui-surfaces.md),
 * [10 §15.1](../../../../docs/design/10-ui-surfaces.md), [P10.3].
 *
 * ***"One row per class in settings" is [09 §3.5]'s own sentence about its own
 * table***, and it is the reason [P10 §1.4]'s rule — *every class either has a
 * producer or is not shipped* — is a rule about **surfaces** rather than about
 * code. A row for a class nothing emits is [work plan §2.3]'s failure inverted,
 * so there are **four** rows here and not the table's six:
 * `turn.awaiting-input` has no suspending step and `message.received` arrives
 * with Messages.
 *
 * ***The rows govern delivery and not the record.*** Turning a class off stops
 * the sound, the toast and the browser notification; the notification is still
 * written, still counted, and still in the list. That is [10 §9]'s *"unread
 * state belongs to the server"* — it has to survive a reload and agree across a
 * phone and a laptop — and it means a preference cannot make you lose something,
 * only stop it interrupting you.
 *
 * **Per user, in `prefs.json`** ([25 B13]), for `ui.theme`'s reason: two people
 * sharing a server do not share ears. The server enforces the dotted shape and a
 * size cap and reads no meaning into either half.
 */

/** What a class is allowed to do when one of its notifications arrives. */
export type DeliveryChoice =
  /** Everything: a sound, a toast, and a browser notification if that channel is on. */
  | 'sound'
  /** Seen, not heard. The toast and the badge, no sound. */
  | 'quiet'
  /** The badge and the list only — nothing interrupts. */
  | 'off';

/** The classes with a producer, in the order the settings rows read. */
export const NOTIFYING_CLASSES = [
  'turn.complete',
  'turn.failed',
  'artifact.ready',
  'system.notice',
] as const;

export type NotifyingClass = (typeof NOTIFYING_CLASSES)[number];

/** `notifications.turn.complete`, and so on. The class is the key's tail. */
export function classKey(one: string): string {
  return `notifications.${one}`;
}

/**
 * **Mute is sound-only and is not a fifth choice on every row.**
 *
 * [10 §9] asks for *"per-class volume, a global mute, and a start-muted
 * preference"*, and a global mute has to be one switch or it is not global: four
 * rows set to `off` is a different state, it is four gestures, and it cannot be
 * undone in one. So mute sits above the rows and silences every one of them
 * without changing what any of them says.
 */
export const MUTED_KEY = 'notifications.muted';

/**
 * ***Marinara's, and worth copying for a reason that is about other people.***
 * Somebody who plays on a laptop in a shared room wants silence by default and
 * sound when they ask for it — and the alternative, remembering to mute before
 * opening the tab, fails exactly once and loudly. A page load starts muted and
 * the mute switch un-mutes for that page only.
 */
export const START_MUTED_KEY = 'notifications.startMuted';

export interface NotificationPrefs {
  /** Per class. Absent means {@link DEFAULT_CHOICE}. */
  byClass: Record<string, DeliveryChoice>;
  muted: boolean;
  startMuted: boolean;
}

/**
 * **`sound` is the default, and it is the whole feature.** [09 §3] exists
 * because of *"the completion-sound case"*; a build whose default was silence
 * would ship the machinery and not the thing it was for.
 */
export const DEFAULT_CHOICE: DeliveryChoice = 'sound';

function choiceOf(value: unknown): DeliveryChoice | null {
  return value === 'sound' || value === 'quiet' || value === 'off' ? value : null;
}

export function notificationPrefs(prefs: Record<string, unknown> | undefined): NotificationPrefs {
  const byClass: Record<string, DeliveryChoice> = {};
  for (const one of NOTIFYING_CLASSES) {
    const stored = choiceOf(prefs?.[classKey(one)]);
    if (stored !== null) byClass[one] = stored;
  }
  return {
    byClass,
    muted: prefs?.[MUTED_KEY] === true,
    startMuted: prefs?.[START_MUTED_KEY] === true,
  };
}

/** What this class may do. An unknown class gets the default, which is generous. */
export function choiceFor(prefs: NotificationPrefs, one: string): DeliveryChoice {
  return prefs.byClass[one] ?? DEFAULT_CHOICE;
}

/**
 * The patch that records a choice.
 *
 * **`null` deletes**, which is `themePatch`'s rule and means the same thing
 * here: a person who never opened this screen and a person who chose the default
 * are in one state, so the default cannot drift away from what they were
 * shown.
 */
export function choicePatch(one: string, choice: DeliveryChoice): Record<string, unknown> {
  return { [classKey(one)]: choice === DEFAULT_CHOICE ? null : choice };
}

export function mutedPatch(muted: boolean): Record<string, unknown> {
  return { [MUTED_KEY]: muted ? true : null };
}

export function startMutedPatch(startMuted: boolean): Record<string, unknown> {
  return { [START_MUTED_KEY]: startMuted ? true : null };
}

/** What actually happens for one notification, once every switch is applied. */
export interface Delivery {
  sound: boolean;
  toast: boolean;
  /** The OS one, which the channel's own state can still refuse. */
  browser: boolean;
}

/**
 * ***One function, so four surfaces cannot disagree.***
 *
 * The mute is deliberately **sound-only**: [10 §9] asks to *"suppress what is
 * already visible… the sound is still wanted; the toast is not"*, which is the
 * same distinction from the other end — the two channels answer to different
 * switches because they interrupt differently. Somebody who muted the tab has
 * not asked to stop being shown things.
 */
export function deliveryFor(
  prefs: NotificationPrefs,
  one: string,
  options: { muted: boolean },
): Delivery {
  const choice = choiceFor(prefs, one);
  if (choice === 'off') return { sound: false, toast: false, browser: false };
  return {
    sound: choice === 'sound' && !options.muted,
    toast: true,
    browser: true,
  };
}
