// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  choiceFor,
  choicePatch,
  deliveryFor,
  MUTED_KEY,
  mutedPatch,
  notificationPrefs,
  NOTIFYING_CLASSES,
  startMutedPatch,
  START_MUTED_KEY,
} from './prefs.js';

/**
 * The preference model — [09 §3.5](../../../../docs/design/09-server-multiuser-deployment.md),
 * [10 §9](../../../../docs/design/10-ui-surfaces.md), [P10.3].
 *
 * ***The claim worth holding is that a preference can quiet you and cannot lose
 * anything.*** [10 §9] puts unread state on the server so it survives a reload
 * and agrees across two devices; a switch that suppressed the *record* rather
 * than the *delivery* would break that from the client side, and it would be
 * invisible until somebody came back to a badge that had already forgotten.
 *
 * **The falsifying mutation is making `off` mean *do not record*.** Every
 * assertion about silence still passes.
 */

describe('what a class is allowed to do', () => {
  it('defaults to the loud one, because that is the feature', () => {
    // [09 §3] exists for "the completion-sound case". A default of silence
    // would ship the machinery and not the thing it was for.
    const held = notificationPrefs({});
    expect(choiceFor(held, 'turn.complete')).toBe('sound');
  });

  it('reads a stored choice and ignores one it does not recognise', () => {
    const held = notificationPrefs({
      'notifications.turn.complete': 'quiet',
      'notifications.turn.failed': 'shout',
    });

    expect(choiceFor(held, 'turn.complete')).toBe('quiet');
    // A newer client's value falls back rather than being stored as a choice
    // this build would then have to render.
    expect(choiceFor(held, 'turn.failed')).toBe('sound');
  });

  /**
   * ***`null` deletes, which is `themePatch`'s rule.*** A person who never
   * opened the screen and a person who chose the default are in one state, so
   * the default cannot later drift away from what they were shown.
   */
  it('stores the default as an absence', () => {
    expect(choicePatch('turn.complete', 'sound')).toEqual({ 'notifications.turn.complete': null });
    expect(choicePatch('turn.complete', 'off')).toEqual({ 'notifications.turn.complete': 'off' });
    expect(mutedPatch(false)).toEqual({ [MUTED_KEY]: null });
    expect(startMutedPatch(true)).toEqual({ [START_MUTED_KEY]: true });
  });
});

describe('what actually happens when one arrives', () => {
  const held = notificationPrefs({
    'notifications.turn.failed': 'quiet',
    'notifications.artifact.ready': 'off',
  });

  it('gives a loud class all three channels', () => {
    expect(deliveryFor(held, 'turn.complete', { muted: false })).toEqual({
      sound: true,
      toast: true,
      browser: true,
    });
  });

  it('keeps a quiet class visible and silent', () => {
    expect(deliveryFor(held, 'turn.failed', { muted: false })).toMatchObject({
      sound: false,
      toast: true,
    });
  });

  it('stops an off class interrupting at all', () => {
    expect(deliveryFor(held, 'artifact.ready', { muted: false })).toEqual({
      sound: false,
      toast: false,
      browser: false,
    });
  });

  /**
   * ***Mute is sound-only***, which is [10 §9]'s *"the sound is still wanted;
   * the toast is not"* read from the other end: the two channels interrupt
   * differently and answer to different switches. Somebody who muted a tab has
   * not asked to stop being shown things.
   */
  it('silences a muted tab without blinding it', () => {
    expect(deliveryFor(held, 'turn.complete', { muted: true })).toEqual({
      sound: false,
      toast: true,
      browser: true,
    });
  });
});

/**
 * ***One row per class, checked against the server rather than against
 * itself*** — the same instrument `labels.test.ts` carries, pointed at the
 * other half of [P10 §1.4]'s rule. A class with a producer and no row is a
 * notification nobody can turn off; a row with no class is
 * [work plan §2.3]'s failure inverted, *a surface for configuration that has no
 * producer*.
 */
describe('the rows and the classes are the same list', () => {
  const CLASS_UNION = join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'server',
    'src',
    'state',
    'notifications.ts',
  );

  function shippedClasses(): string[] {
    const source = readFileSync(CLASS_UNION, 'utf8');
    const at = source.indexOf('export type NotificationClass');
    expect(at, 'NotificationClass moved — repoint CLASS_UNION').toBeGreaterThan(-1);
    const declaration = source.slice(at, source.indexOf(';', at));
    return [...declaration.matchAll(/'([a-z]+\.[a-z-]+)'/g)].map((match) => match[1] ?? '');
  }

  it('has exactly the classes the server ships', () => {
    expect([...NOTIFYING_CLASSES].sort()).toEqual(shippedClasses().sort());
  });
});
