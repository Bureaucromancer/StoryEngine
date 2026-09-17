// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import { uuidv7 } from '@storyengine/shared';

/**
 * The notification vocabulary and its store —
 * [09 §3.4](../../../../docs/design/09-server-multiuser-deployment.md),
 * [09 §3.5](../../../../docs/design/09-server-multiuser-deployment.md), [P10.1].
 *
 * ***A notification is not a progress event, and the two live apart on
 * purpose.*** [09 §3.2] splits them and `state/events.ts` carries the other
 * half: a progress event is **structural**, belongs to a job, carries no prose,
 * and is read by whoever is watching that session. A notification belongs to a
 * **person**, carries a renderable summary, and has to find them in a session
 * they do not have open — or in none at all.
 *
 * **So the store is a different table keyed by account**, and the reason is not
 * taste. The `event` table foreign-keys to `job(id)`; `system.notice` has no
 * job, no session and no turn, and the whole point of the class is that several
 * admin warnings are already specified with nowhere to be delivered.
 *
 * ---
 *
 * ***§1.4's rule is what this module enforces, and it enforces it by
 * omission.*** *"Every class either has a producer or is not shipped."*
 * {@link NotificationClass} is therefore **four**, not the five
 * [09 §3.5](../../../../docs/design/09-server-multiuser-deployment.md) prints —
 * `turn.awaiting-input` is absent because nothing suspends, and a preference row
 * for it would be [work plan §2.3]'s failure inverted: a surface for
 * configuration with no producer. *Adding it later is one line here and one
 * producer there*, which is the cheap direction.
 */

/**
 * The classes that ship, which is four of [09 §3.5]'s six.
 *
 * ***The two that do not, named so their absence is a decision***:
 *
 * - **`turn.awaiting-input`** — conditional on [25 C5]'s suspending step, which
 *   four phases did not produce. `Turn.status: 'suspended'` exists and nothing
 *   sets it, and `packages/sdk/src/steps.ts` has no suspend verb at all. [09 §3.5]
 *   calls this *"the strongest argument for push"*, so it returns with the step
 *   rather than being quietly dropped.
 * - **`message.received`** — with Messages, which is unscheduled ([24 §3.4]).
 *
 * ***And `artifact.ready` is here because this stage built its producer.***
 * [P9 §1.5](../../../../docs/design/workplan/26-p9-implementation.md) owed it and
 * [P9.2] went another way for a structural reason that stands — a rendition
 * cannot be a `ProgressEvent`, because the `event` table foreign-keys to
 * `job(id)`. **That argument is about a transport and this is a class**, which
 * is why the two can coexist: the `rendition` SSE frame is how pixels reach an
 * open page, and this is how a person is told.
 */
export type NotificationClass =
  'turn.complete' | 'turn.failed' | 'artifact.ready' | 'system.notice';

const CLASSES: ReadonlySet<string> = new Set<NotificationClass>([
  'turn.complete',
  'turn.failed',
  'artifact.ready',
  'system.notice',
]);

/** Whether a class read back from the store is one this build knows. */
export function isNotificationClass(value: string): value is NotificationClass {
  return CLASSES.has(value);
}

/**
 * Whether the reader has to *do* something — [09 §3.4]'s one field.
 *
 * ***The table says **who decides**, not what the answer is***, and the
 * distinction is what stops it being either a rubber stamp or a straitjacket. A
 * class whose answer is a constant has it here, so that two producers cannot
 * eventually disagree about whether a failed turn needs attention. A class whose
 * answer depends on the **occasion** says `varies`, and the occasion is what
 * answers.
 *
 * ***`artifact.ready` is `varies`, and the test that made it so is worth
 * recording.*** It was written `false` — [09 §3.5]'s own column, and right for
 * the name — with the failed-picture override in
 * [`router.ts`](../notifications/router.js). *That override could not reach the
 * store*: this table won, and the row landed with `actionable: false`, which
 * `router.test.ts` caught on the first run. The fix is here rather than a
 * special case in `notify`, because the table was making a claim it does not
 * have the information to make: **a picture that failed has a retry button
 * behind it and a picture that arrived has nothing to do**, and only the arm
 * knows which one this is.
 *
 * *`varies` is not a hole in the no-disagreement rule*, because the two classes
 * that carry it have exactly one producer between them:
 * [`route`](../notifications/router.js) builds every draft, which is the reason
 * it exists rather than every producer calling {@link notify} directly.
 */
const ACTIONABLE: Record<NotificationClass, boolean | 'varies'> = {
  'turn.complete': false,
  'turn.failed': true,
  'artifact.ready': 'varies',
  'system.notice': 'varies',
};

/**
 * What a producer hands in.
 *
 * ***No `createdAt`, no `id`, and no English.*** The store mints the first two
 * and [19 §12.5] forbids the third: `params` is the payload of a
 * `{ key, params }` summary composed at display time, and [09 §3.4] warns that
 * it must carry *everything the sentence needs* — a later composer working from
 * unstructured fields produces *"New event in session 4f2a"*.
 */
export interface NotificationDraft {
  /** Resolved server-side by the caller. [09 §3.1]'s rule, and the routing. */
  account: string;
  class: NotificationClass;
  /**
   * Answered by the producer for the two classes whose answer is the
   * occasion's, ignored for the two whose answer is the class's — see
   * {@link ACTIONABLE}. Absent means *nothing to do*.
   */
  actionable?: boolean;
  params: Readonly<Record<string, string | number | boolean>>;
  sessionId?: string;
  turnId?: string;
  /**
   * What two of these count as one — [09 §3.4].
   *
   * *Chosen by the producer rather than derived here*, because only the producer
   * knows what a duplicate **means**: three pictures finishing on one turn is
   * one notification, and three turns failing in one session is three. A default
   * would have to guess, and guessing wrong is the failure this field exists to
   * prevent.
   */
  dedupeKey: string;
}

export interface Notification {
  id: string;
  account: string;
  class: NotificationClass;
  actionable: boolean;
  params: Readonly<Record<string, string | number | boolean>>;
  sessionId: string | null;
  turnId: string | null;
  dedupeKey: string;
  /** How many arrivals this row stands for. One unless something coalesced. */
  folded: number;
  createdAt: number;
  updatedAt: number;
  readAt: number | null;
}

/**
 * How long two arrivals with one dedupe key are the same notification.
 *
 * ***A constant with its reason beside it, which is `MINUTES_PER_TURN`'s
 * precedent and `HOOK_PATIENCE`'s.*** [09 §3.4] gives the requirement and no
 * number, and a config key for it would be [work plan §2.3]'s standing line
 * asking for a surface nobody could form an opinion about — *how many seconds
 * should two pictures be one picture* is not a question a person has an answer
 * to before they have seen it happen.
 *
 * **Two minutes**, because the case it is for is a burst: a turn that dispatched
 * three renditions settles them within seconds of each other, and a person
 * reading a story generates turns minutes apart. Long enough to fold the burst,
 * short enough that two deliberate acts stay two notifications.
 */
export const COALESCE_WINDOW_MS = 120_000;

/**
 * Records a notification, folding it into a recent one with the same key.
 *
 * ***The fold is a fold, not a replace.*** `folded` counts arrivals and
 * `updated_at` moves, so a row can say *three pictures are ready* rather than
 * standing in for the newest and losing the other two. [09 §3.4]'s example is
 * exactly this — *five characters replying in a group chat is one notification,
 * not five* — and *not five* means one row that knows it is five.
 *
 * ***And the window is measured from the last arrival rather than the first.***
 * A steady trickle inside the window therefore keeps folding, which is the
 * behaviour somebody wants from a burst; the alternative restarts the window on
 * a schedule nobody chose and splits one burst into two notifications at an
 * arbitrary boundary.
 *
 * **Reading a folded notification does not re-fold into it.** A row with
 * `read_at` set is finished: the next arrival is news, because the person has
 * already been told about the ones before it. *That is the one case where
 * folding would be actively wrong* — a badge that went back to unread on a row
 * somebody had already dismissed reads as the app arguing with them.
 */
export function notify(
  db: DatabaseSync,
  draft: NotificationDraft,
  now: number = Date.now(),
): Notification {
  const actionable = ACTIONABLE[draft.class];
  const resolved = actionable === 'varies' ? (draft.actionable ?? false) : actionable;

  const recent = db
    .prepare(
      `select * from notification
        where account = ? and dedupe_key = ? and read_at is null and updated_at >= ?
        order by updated_at desc limit 1`,
    )
    .get(draft.account, draft.dedupeKey, now - COALESCE_WINDOW_MS) as
    Record<string, unknown> | undefined;

  if (recent !== undefined) {
    const id = String(recent['id']);
    db.prepare(
      `update notification set folded = folded + 1, updated_at = ?, params = ? where id = ?`,
    ).run(now, JSON.stringify(draft.params), id);
    const after = db.prepare(`select * from notification where id = ?`).get(id) as Record<
      string,
      unknown
    >;
    return rowToNotification(after);
  }

  const id = uuidv7();
  db.prepare(
    `insert into notification
       (id, account, class, actionable, params, session_id, turn_id, dedupe_key,
        folded, created_at, updated_at, read_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, null)`,
  ).run(
    id,
    draft.account,
    draft.class,
    resolved ? 1 : 0,
    JSON.stringify(draft.params),
    draft.sessionId ?? null,
    draft.turnId ?? null,
    draft.dedupeKey,
    now,
    now,
  );

  const row = db.prepare(`select * from notification where id = ?`).get(id) as Record<
    string,
    unknown
  >;
  return rowToNotification(row);
}

/**
 * A person's notifications, newest first.
 *
 * **Scoped by account in the query rather than filtered after**, which is
 * [09 §4.3]'s per-user scoping applied where it cannot be forgotten: a caller
 * that passed the wrong handle gets that person's list, and a caller that passed
 * none gets a type error.
 */
export function listNotifications(
  db: DatabaseSync,
  account: string,
  options: { limit?: number; unreadOnly?: boolean } = {},
): Notification[] {
  const limit = options.limit ?? 50;
  const rows = options.unreadOnly
    ? db
        .prepare(
          `select * from notification where account = ? and read_at is null
            order by created_at desc limit ?`,
        )
        .all(account, limit)
    : db
        .prepare(`select * from notification where account = ? order by created_at desc limit ?`)
        .all(account, limit);

  return (rows as Record<string, unknown>[]).map(rowToNotification);
}

/** What the badge shows — [09 §3.6]'s first delivery channel. */
export function unreadCount(db: DatabaseSync, account: string): number {
  const row = db
    .prepare(`select count(*) as n from notification where account = ? and read_at is null`)
    .get(account) as { n: number };
  return row.n;
}

/**
 * Marks some or all of a person's notifications read.
 *
 * *`ids` empty means all of them*, which is the **Mark all read** affordance and
 * is one query rather than a client sending fifty ids back.
 */
export function markRead(
  db: DatabaseSync,
  account: string,
  ids: readonly string[],
  now: number = Date.now(),
): number {
  if (ids.length === 0) {
    const all = db
      .prepare(`update notification set read_at = ? where account = ? and read_at is null`)
      .run(now, account);
    return Number(all.changes);
  }

  let changed = 0;
  const one = db.prepare(
    `update notification set read_at = ? where id = ? and account = ? and read_at is null`,
  );
  for (const id of ids) changed += Number(one.run(now, id, account).changes);
  return changed;
}

/**
 * Reads a row back, defensively.
 *
 * **Through `unknown`, which is `readSummary`'s rule**: a row written by a newer
 * build can carry a class this one has never heard of, and the honest handling
 * is to drop it from the type rather than to widen the union at runtime. An
 * unknown class becomes `system.notice`, which is the one class whose meaning
 * survives not knowing what happened — *something you should see* — and is
 * strictly better than throwing on a list read.
 */
function rowToNotification(row: Record<string, unknown>): Notification {
  const declared = String(row['class']);
  return {
    id: String(row['id']),
    account: String(row['account']),
    class: isNotificationClass(declared) ? declared : 'system.notice',
    actionable: Number(row['actionable']) === 1,
    params: readParams(row['params']),
    // `readText` rather than `String(…)`: the lint rule is right that a value
    // out of a `Record<string, unknown>` could be an object, and `[object
    // Object]` in a session id is the sort of thing that reads as a missing
    // row rather than as a bad one.
    sessionId: readText(row['session_id']),
    turnId: readText(row['turn_id']),
    dedupeKey: String(row['dedupe_key']),
    folded: Number(row['folded']),
    createdAt: Number(row['created_at']),
    updatedAt: Number(row['updated_at']),
    readAt: row['read_at'] === null ? null : Number(row['read_at']),
  };
}

/** A nullable text column, as the type it actually is. */
function readText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readParams(value: unknown): Record<string, string | number | boolean> {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, string | number | boolean> = {};
    for (const [key, one] of Object.entries(parsed)) {
      if (typeof one === 'string' || typeof one === 'number' || typeof one === 'boolean') {
        out[key] = one;
      }
    }
    return out;
  } catch {
    return {};
  }
}
