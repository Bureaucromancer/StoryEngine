// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { migrateState } from '../state/migrations.js';
import { listNotifications, type Notification } from '../state/notifications.js';
import { NotificationBus } from './bus.js';
import { NOBODY_PRESENT, route, type Occurrence, type Presence } from './router.js';

/**
 * Who gets told — [09 §3.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md), [P10.1].
 *
 * ***This file holds the phase's named CI claim***, which
 * [P10 §0](../../../../docs/design/workplan/27-p10-implementation.md) states as
 * *"the notification routing test that matters on a household server: user A's
 * turn never produces an event addressed to user B."* It is the only safety
 * property in this subsystem — everything else here is a preference — so it is
 * asserted from both directions: A's turn reaches A, and A's turn reaches
 * **nobody else**, with a second account connected and listening throughout.
 *
 * **The falsifying mutation is routing on `deliver` instead of on the
 * occurrence's account** — a bus that fanned out to every subscriber. Every
 * assertion about A receiving one still passes; what goes red is B's inbox
 * being empty, which is the whole claim.
 */

function open(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateState(db);
  return db;
}

/** A router over a real store, collecting what was delivered and to whom. */
function harness(presence: Presence = NOBODY_PRESENT): {
  db: DatabaseSync;
  delivered: { account: string; notification: Notification }[];
  send: (occurrence: Occurrence) => Notification | null;
} {
  const db = open();
  const delivered: { account: string; notification: Notification }[] = [];
  return {
    db,
    delivered,
    send: (occurrence) =>
      route(
        {
          db,
          presence,
          deliver: (account, notification) => {
            delivered.push({ account, notification });
          },
        },
        occurrence,
      ),
  };
}

function turnFinished(account: string, sessionId: string): Occurrence {
  return {
    kind: 'turn.complete',
    account,
    sessionId,
    turnId: `t-${sessionId}`,
    sessionName: 'The harbour',
  };
}

describe('a household server tells one person at a time', () => {
  /**
   * ***[P10 §0]'s CI claim, asserted on the store as well as on delivery.***
   * A row addressed to B would be a badge B sees on their next page load even
   * if nothing was delivered live — so the absence has to hold in both places.
   */
  it('never addresses user A’s turn to user B', () => {
    const { db, delivered, send } = harness();

    send(turnFinished('ada', 's-ada'));

    expect(delivered.map((one) => one.account)).toEqual(['ada']);
    expect(listNotifications(db, 'ada')).toHaveLength(1);
    expect(listNotifications(db, 'ned')).toHaveLength(0);
  });

  /**
   * The same claim through the real bus rather than a collector, because the
   * bus is what the app wires: a fan-out bug lives there and not in `route`.
   */
  it('delivers to the account’s own listeners and to no others', () => {
    const db = open();
    const bus = new NotificationBus();
    const toAda: Notification[] = [];
    const toNed: Notification[] = [];
    bus.subscribe('ada', (one) => toAda.push(one));
    bus.subscribe('ned', (one) => toNed.push(one));

    route(
      {
        db,
        presence: bus,
        deliver: (account, notification) => {
          bus.deliver(account, notification);
        },
      },
      turnFinished('ada', 's-ada'),
    );

    expect(toAda).toHaveLength(1);
    expect(toNed).toHaveLength(0);
  });
});

describe('the one routing rule 1.0 has', () => {
  /**
   * ***If you are looking at the session, you are not told about it.*** You can
   * see the turn finish; a toast saying so is the app telling you what is on
   * your screen.
   */
  it('says nothing about a session the reader is watching', () => {
    const bus = new NotificationBus();
    bus.viewing('ada', 's-ada');
    const { db, delivered, send } = harness(bus);

    expect(send(turnFinished('ada', 's-ada'))).toBeNull();
    expect(delivered).toHaveLength(0);
    // And nothing is recorded either: an unread badge for what you watched
    // happen is the same failure arriving one page load later.
    expect(listNotifications(db, 'ada')).toHaveLength(0);
  });

  it('still tells you about a different session you have open', () => {
    const bus = new NotificationBus();
    bus.viewing('ada', 's-one');
    const { delivered, send } = harness(bus);

    send(turnFinished('ada', 's-two'));
    expect(delivered).toHaveLength(1);
  });

  /**
   * ***Not connected is deliberately not a reason to skip***, which is the half
   * of [09 §3.1] that a client-side router gets wrong: the notification is
   * durable and the badge is what a person comes back to.
   */
  it('records a notification for somebody who is not here', () => {
    const { db, delivered, send } = harness(NOBODY_PRESENT);

    const made = send(turnFinished('ada', 's-ada'));

    expect(made).not.toBeNull();
    expect(listNotifications(db, 'ada')).toHaveLength(1);
    // Delivered is called anyway; the bus is what knows nobody is listening.
    expect(delivered).toHaveLength(1);
  });

  /**
   * **A system notice has no session and therefore no way to be suppressed.**
   * The `'sessionId' in occurrence` test is what makes that true by
   * construction rather than by a special case somebody could forget.
   */
  it('never suppresses a system notice, whatever is on screen', () => {
    const bus = new NotificationBus();
    bus.viewing('ada', 's-ada');
    const { send } = harness(bus);

    const made = send({
      kind: 'system.notice',
      account: 'ada',
      notice: 'restart-required',
      actionable: true,
      params: { keys: 'server.host log.level', count: 2 },
    });

    expect(made?.actionable).toBe(true);
    expect(made?.params).toEqual({
      keys: 'server.host log.level',
      count: 2,
      notice: 'restart-required',
    });
  });

  /** A producer cannot overwrite what is being notified about. */
  it('keeps the notice itself out of a producer’s reach', () => {
    const { send } = harness();
    const made = send({
      kind: 'system.notice',
      account: 'ada',
      notice: 'restart-required',
      actionable: false,
      params: { notice: 'something-else' },
    });
    expect(made?.params['notice']).toBe('restart-required');
  });
});

describe('what counts as the same news', () => {
  /**
   * ***Three pictures of one turn are one notification*** — [09 §3.4]'s example
   * in this build's own terms, and the reason the key is the **turn**.
   */
  it('folds a turn’s renditions settling together', () => {
    const { db, send } = harness();

    for (const purpose of ['illustration', 'illustration', 'illustration']) {
      send({
        kind: 'artifact.ready',
        account: 'ada',
        sessionId: 's-ada',
        turnId: 't-9',
        purpose,
        outcome: 'ready',
      });
    }

    const held = listNotifications(db, 'ada');
    expect(held).toHaveLength(1);
    expect(held[0]?.folded).toBe(3);
  });

  /**
   * ***And two deliberate **Illustrate** presses on different turns are two.***
   * Keying on the session would fold them, which is losing news rather than
   * coalescing noise — the distinction the dedupe key exists to encode.
   */
  it('keeps two turns’ pictures apart', () => {
    const { db, send } = harness();

    for (const turnId of ['t-9', 't-10']) {
      send({
        kind: 'artifact.ready',
        account: 'ada',
        sessionId: 's-ada',
        turnId,
        purpose: 'illustration',
        outcome: 'ready',
      });
    }

    expect(listNotifications(db, 'ada')).toHaveLength(2);
  });

  /**
   * **A completion and a failure in one session are two notifications**, even
   * inside the window: they are not the same news, and only one of them is
   * actionable.
   */
  it('never folds a failure into a completion', () => {
    const { db, send } = harness();

    send(turnFinished('ada', 's-ada'));
    send({
      kind: 'turn.failed',
      account: 'ada',
      sessionId: 's-ada',
      turnId: 't-2',
      sessionName: 'The harbour',
      error: 'rate-limit',
    });

    const held = listNotifications(db, 'ada');
    expect(held).toHaveLength(2);
    expect(held.filter((one) => one.actionable)).toHaveLength(1);
  });
});

describe('a picture that failed', () => {
  /**
   * ***The one place this module overrides the class table, and the reason
   * {@link route} exists rather than every producer calling `notify`.***
   * [09 §3.5] says `artifact.ready` is never actionable, which is right for the
   * name and wrong for this arm: a failed picture has a retry button behind it.
   */
  it('is actionable where a ready one is not', () => {
    const { send } = harness();

    const ready = send({
      kind: 'artifact.ready',
      account: 'ada',
      sessionId: 's-ada',
      turnId: 't-1',
      purpose: 'illustration',
      outcome: 'ready',
    });
    const failed = send({
      kind: 'artifact.ready',
      account: 'ada',
      sessionId: 's-ada',
      turnId: 't-2',
      purpose: 'illustration',
      outcome: 'failed',
    });

    expect(ready?.actionable).toBe(false);
    expect(failed?.actionable).toBe(true);
    expect(failed?.params['outcome']).toBe('failed');
  });
});

describe('presence over the notification bus', () => {
  it('is connected exactly while a stream is attached', () => {
    const bus = new NotificationBus();
    expect(bus.isConnected('ada')).toBe(false);

    const detach = bus.subscribe('ada', () => undefined);
    expect(bus.isConnected('ada')).toBe(true);

    detach();
    expect(bus.isConnected('ada')).toBe(false);
    // Idempotent: a stream closes from three directions and each detaches.
    detach();
    expect(bus.isConnected('ada')).toBe(false);
  });

  /**
   * ***Two tabs on one session are two attachments.*** A flag rather than a
   * count would make the second close wrong, and the symptom — notifications
   * about a session that is on screen — would arrive only for the person who
   * had two tabs open, which is nobody's idea of a reproducible bug.
   */
  it('counts viewers rather than flagging them', () => {
    const bus = new NotificationBus();
    const first = bus.viewing('ada', 's-ada');
    const second = bus.viewing('ada', 's-ada');

    first();
    expect(bus.isViewing('ada', 's-ada')).toBe(true);

    second();
    expect(bus.isViewing('ada', 's-ada')).toBe(false);
  });

  it('never lets one listener’s failure reach a producer', () => {
    const bus = new NotificationBus();
    const seen: unknown[] = [];
    bus.onListenerError = (error) => seen.push(error);

    const delivered: Notification[] = [];
    bus.subscribe('ada', () => {
      throw new Error('a socket in a state nobody measured');
    });
    bus.subscribe('ada', (one) => delivered.push(one));

    const db = open();
    expect(() =>
      route(
        {
          db,
          presence: bus,
          deliver: (account, notification) => {
            bus.deliver(account, notification);
          },
        },
        turnFinished('ada', 's-ada'),
      ),
    ).not.toThrow();

    expect(seen).toHaveLength(1);
    // The second listener still got it: one broken subscriber loses its own
    // frame and nothing else, which is `TurnStream.#each`'s rule.
    expect(delivered).toHaveLength(1);
  });
});
