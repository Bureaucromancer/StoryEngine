// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { migrateState } from './migrations.js';
import {
  COALESCE_WINDOW_MS,
  listNotifications,
  markRead,
  notify,
  unreadCount,
} from './notifications.js';

/**
 * The notification store — [09 §3.4](../../../../docs/design/09-server-multiuser-deployment.md),
 * [P10.1].
 *
 * ***What this file is for is the coalescing***, because it is the one part
 * [09 §3.4] calls *"trivial to design in and unpleasant to add once producers
 * exist"* — which is a statement that the behaviour has to be right on the day
 * the first producer ships, not later. The rest of the module is a table.
 *
 * **The falsifying mutation is making the fold a replace.** Every assertion
 * about *one row* still passes: a replace also yields one notification for five
 * arrivals. What goes red is `folded`, which is the difference between *five
 * characters replied* and *a character replied, four times, and we told you
 * about the last one.*
 */

function db(): DatabaseSync {
  const open = new DatabaseSync(':memory:');
  migrateState(open);
  return open;
}

describe('a notification is recorded against a person', () => {
  it('resolves actionable from the class rather than from the producer', () => {
    const open = db();

    // [09 §3.5]: `turn.failed` is actionable and `turn.complete` is not. A
    // producer cannot disagree, which is what stops two of them differing.
    const complete = notify(open, {
      account: 'ned',
      class: 'turn.complete',
      params: { sessionName: 'The harbour' },
      dedupeKey: 'turn:s-1',
    });
    const failed = notify(open, {
      account: 'ned',
      class: 'turn.failed',
      params: { sessionName: 'The harbour' },
      dedupeKey: 'fail:s-1',
    });

    expect(complete.actionable).toBe(false);
    expect(failed.actionable).toBe(true);
  });

  /**
   * `system.notice` is [09 §3.5]'s *varies*, and it is the one class whose
   * producer answers — because what varies is the notice, not the reader.
   */
  it('lets a system notice say whether it needs acting on', () => {
    const open = db();
    const restart = notify(open, {
      account: 'ned',
      class: 'system.notice',
      actionable: true,
      params: { notice: 'restart-required' },
      dedupeKey: 'notice:restart',
    });
    expect(restart.actionable).toBe(true);
  });

  /**
   * ***No English crosses this boundary*** — [20 §12.5], and the reason the
   * column is called `params`. The server does not know the reader's language,
   * so what is stored is what a sentence needs rather than the sentence.
   */
  it('keeps the params a summary is composed from', () => {
    const open = db();
    const one = notify(open, {
      account: 'ned',
      class: 'artifact.ready',
      params: { purpose: 'illustration', count: 1 },
      sessionId: 's-1',
      turnId: 't-9',
      dedupeKey: 'art:t-9',
    });

    expect(one.params).toEqual({ purpose: 'illustration', count: 1 });
    expect(one.sessionId).toBe('s-1');
    expect(one.turnId).toBe('t-9');
  });
});

describe('five of a kind is one notification that knows it is five', () => {
  /**
   * ***[09 §3.4]'s own example, asserted on the count rather than on the row.***
   * *"Five characters replying in a group chat is one notification, not five."*
   * A replace-on-conflict implementation gives one row too — so the assertion
   * that separates them is `folded`.
   */
  it('folds arrivals inside the window and counts them', () => {
    const open = db();
    const start = 1_000_000;

    for (let at = 0; at < 5; at += 1) {
      notify(
        open,
        { account: 'ned', class: 'artifact.ready', params: { n: at }, dedupeKey: 'art:t-9' },
        start + at * 1000,
      );
    }

    const held = listNotifications(open, 'ned');
    expect(held).toHaveLength(1);
    expect(held[0]?.folded).toBe(5);
  });

  /**
   * **The window runs from the last arrival, not the first**, so a trickle keeps
   * folding rather than splitting at an arbitrary boundary somebody did not
   * choose.
   */
  it('keeps folding a trickle that never pauses for a whole window', () => {
    const open = db();
    const start = 1_000_000;
    const step = COALESCE_WINDOW_MS - 1000;

    notify(open, { account: 'ned', class: 'turn.complete', params: {}, dedupeKey: 'k' }, start);
    notify(
      open,
      { account: 'ned', class: 'turn.complete', params: {}, dedupeKey: 'k' },
      start + step,
    );
    notify(
      open,
      { account: 'ned', class: 'turn.complete', params: {}, dedupeKey: 'k' },
      start + step * 2,
    );

    const held = listNotifications(open, 'ned');
    expect(held).toHaveLength(1);
    expect(held[0]?.folded).toBe(3);
  });

  /** Past the window it is news again, which is the other half of the claim. */
  it('starts a second notification once the window has passed', () => {
    const open = db();
    const start = 1_000_000;

    notify(open, { account: 'ned', class: 'turn.complete', params: {}, dedupeKey: 'k' }, start);
    notify(
      open,
      { account: 'ned', class: 'turn.complete', params: {}, dedupeKey: 'k' },
      start + COALESCE_WINDOW_MS + 1,
    );

    expect(listNotifications(open, 'ned')).toHaveLength(2);
  });

  /**
   * ***A read notification is finished, and folding into it would argue with
   * the person.*** They have been told; the next arrival is news. A badge that
   * went back to unread on a row somebody had dismissed is the failure this
   * clause prevents.
   */
  it('does not fold into a notification that has been read', () => {
    const open = db();
    const start = 1_000_000;

    notify(open, { account: 'ned', class: 'turn.complete', params: {}, dedupeKey: 'k' }, start);
    markRead(open, 'ned', []);
    notify(open, { account: 'ned', class: 'turn.complete', params: {}, dedupeKey: 'k' }, start + 1);

    const held = listNotifications(open, 'ned');
    expect(held).toHaveLength(2);
    expect(unreadCount(open, 'ned')).toBe(1);
  });

  /**
   * **Two people are two notifications**, which is [09 §4.3]'s per-user scoping
   * doing its job at the level a dedupe key could otherwise defeat: the key is
   * the producer's and says nothing about who is being told.
   */
  it('never folds one person’s notification into another’s', () => {
    const open = db();
    const start = 1_000_000;

    notify(open, { account: 'ned', class: 'turn.complete', params: {}, dedupeKey: 'k' }, start);
    notify(open, { account: 'ada', class: 'turn.complete', params: {}, dedupeKey: 'k' }, start + 1);

    expect(listNotifications(open, 'ned')).toHaveLength(1);
    expect(listNotifications(open, 'ada')).toHaveLength(1);
  });
});

describe('what a person has not seen', () => {
  it('counts the unread and marks them all', () => {
    const open = db();
    notify(open, { account: 'ned', class: 'turn.complete', params: {}, dedupeKey: 'a' });
    notify(open, { account: 'ned', class: 'turn.failed', params: {}, dedupeKey: 'b' });

    expect(unreadCount(open, 'ned')).toBe(2);
    expect(markRead(open, 'ned', [])).toBe(2);
    expect(unreadCount(open, 'ned')).toBe(0);
  });

  /**
   * *Marking somebody else's notification read is a no-op rather than an error*,
   * which is the same posture every other per-account write here takes: the
   * account is in the `where` clause, so a wrong handle changes nothing instead
   * of changing the wrong row.
   */
  it('refuses to mark a notification belonging to somebody else', () => {
    const open = db();
    const mine = notify(open, {
      account: 'ned',
      class: 'turn.complete',
      params: {},
      dedupeKey: 'a',
    });

    expect(markRead(open, 'ada', [mine.id])).toBe(0);
    expect(unreadCount(open, 'ned')).toBe(1);
  });

  it('lists only the unread when asked', () => {
    const open = db();
    const first = notify(open, {
      account: 'ned',
      class: 'turn.complete',
      params: {},
      dedupeKey: 'a',
    });
    notify(open, { account: 'ned', class: 'turn.failed', params: {}, dedupeKey: 'b' });
    markRead(open, 'ned', [first.id]);

    const unread = listNotifications(open, 'ned', { unreadOnly: true });
    expect(unread).toHaveLength(1);
    expect(unread[0]?.class).toBe('turn.failed');
  });
});
