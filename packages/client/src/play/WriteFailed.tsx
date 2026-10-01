// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { errorCode } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { AlertNote } from '../ui/Alert.js';

/**
 * ***What a play panel says when a write did not land*** (2026-10-01,
 * polish 9).
 *
 * The play surface writes in a dozen small places — a dial, a hook's commit, a
 * cast member's mute, a card prompt, a mode's switch, the memory toggles — and
 * most of them said nothing at all when the server refused: the control sprang
 * back, or did not, and the person was left to guess whether it had worked. The
 * few that did speak had one sentence for everything, so the commonest refusal
 * of all read like a fault. That one is **`busy`**: since G, a write that would
 * move the story's head waits for the turn in flight (`409`), and a panel that
 * stays enabled while a turn runs in another tab, or under a backdrop job, meets
 * it. It is not a failure, and it says what to do — wait.
 *
 * Read by class, never by the server's English ([Q1a], `errorCode`): the
 * class is what crossed the wire, and the sentence is the reader's.
 */
const WORDS = labels('play.write-failed', {
  busy: 'A turn is running. Try again when it has finished.',
  otherwise: 'That could not be saved.',
});

/** The sentence for a refused write: `busy`'s own, or the panel's. */
export function writeFailed(error: unknown, otherwise?: string): string {
  if (errorCode(error) === 'busy') return WORDS.busy;
  return otherwise ?? WORDS.otherwise;
}

/**
 * The sentence, announced, where the write was made — or nothing while there is
 * no failure to say. A component rather than a pattern so a panel cannot spell
 * the condition and forget the role.
 */
export function WriteFailed(props: {
  /** The mutation's error, or null while it has none. */
  error: unknown;
  /** The panel's own sentence for everything that is not `busy`. */
  otherwise?: string;
}): JSX.Element | null {
  if (props.error === null || props.error === undefined) return null;
  return <AlertNote role="alert">{writeFailed(props.error, props.otherwise)}</AlertNote>;
}
