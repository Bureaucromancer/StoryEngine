// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import { inTransaction } from '../storage/transaction.js';
import { watchWallClock, type WallClockWatch } from '../wall-clock.js';
import type { Logger } from './commit.js';

/**
 * ***The operational store, collected*** (2026-09-27) —
 * [P2 §2.10](../../../../docs/design/workplan/08-p2-implementation.md),
 * [22 §5.1](../../../../docs/design/22-internal-contracts.md).
 *
 * P2 §2.10 says a finished turn's *"operational draft may be collected"* and its
 * event rows *"are ephemeral and may be pruned after the terminal record
 * exists"*, and 21 §5.1 calls this *a small operational store*. Nothing ever
 * deleted a row from it. A turn's draft is the whole turn record with every
 * call's blocks and messages, so the history window's text is in it twice, and
 * a reply of twenty seconds leaves a hundred or more event rows beside it:
 * forty to a hundred and thirty kilobytes a turn, for as long as the install
 * lives, in a file that every install backup copies and snapshots twice over.
 *
 * **And it outlived the purge.** Deleting a session and letting the trash
 * expire it removed the files, and every prompt and reply it ever had stayed
 * here, in every archive taken after. 03 §10.2's *purge is available and
 * honest* was not, for the one kind that holds the most prose.
 *
 * So, once a day and shortly after a start:
 *
 * - **drafts and events** of a job that finished more than a day ago go. The
 *   turn is in its segment, which is their durable meaning.
 * - **except each session's latest job**, while the session is still there,
 *   because a client attaching to a session between turns is sent that job's
 *   snapshot and events (`attach.ts`), and a view reloaded the morning after
 *   is still entitled to them. A session that has gone keeps nothing.
 * - **idempotency keys** of finished jobs go after a week. A key only has to
 *   outlive a browser's retry of the same submission ([P2 §2.10]'s *long
 *   enough for a browser retry or reconnect*), and a week is generous for
 *   that.
 * - **job rows stay.** They are small, they hold no prose, and a cursor or a
 *   repeated key still resolves against them.
 *
 * Nothing here is a migration: the rows are the same shape, there are just
 * fewer of them, so a downgraded build reads the file as before.
 */

/** A finished job's draft and events, kept this long for a reattach. */
export const DRAFT_RETENTION_MS = 24 * 60 * 60 * 1000;
/** A finished job's idempotency key, kept this long for a browser's retry. */
export const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Jobs per transaction. The store's writer is shared with every turn in
 * flight, so a first prune over years of rows is many short transactions
 * rather than one long one.
 */
export const PRUNE_BATCH = 200;

export interface PruneResult {
  /** Jobs whose draft and events were collected. */
  jobs: number;
  events: number;
  keys: number;
}

export async function pruneOperationalStore(
  db: DatabaseSync,
  options: {
    /** Whether the session a job belongs to is still there to attach to. */
    sessionExists: (account: string, sessionId: string) => Promise<boolean>;
    now?: number;
  },
): Promise<PruneResult> {
  const now = options.now ?? Date.now();
  const result: PruneResult = { jobs: 0, events: 0, keys: 0 };

  const candidates = db
    .prepare(
      `select id, account, session_id,
              created_at = (select max(created_at) from job later
                             where later.session_id = job.session_id) as latest
         from job
        where finished_at is not null and finished_at < ?
          and (exists (select 1 from draft where draft.job_id = job.id)
               or exists (select 1 from event where event.job_id = job.id))`,
    )
    .all(now - DRAFT_RETENTION_MS) as {
    id: string;
    account: string;
    session_id: string;
    latest: number;
  }[];

  const doomed: string[] = [];
  for (const job of candidates) {
    if (job.latest === 1 && (await options.sessionExists(job.account, job.session_id))) continue;
    doomed.push(job.id);
  }

  const dropEvents = db.prepare('delete from event where job_id = ?');
  const dropDraft = db.prepare('delete from draft where job_id = ?');
  for (let start = 0; start < doomed.length; start += PRUNE_BATCH) {
    const batch = doomed.slice(start, start + PRUNE_BATCH);
    inTransaction(db, () => {
      for (const id of batch) {
        result.events += Number(dropEvents.run(id).changes);
        dropDraft.run(id);
        result.jobs += 1;
      }
    });
  }

  result.keys = Number(
    db
      .prepare(
        `delete from idempotency
          where created_at < ?
            and job_id in (select id from job where finished_at is not null)`,
      )
      .run(now - IDEMPOTENCY_RETENTION_MS).changes,
  );

  return result;
}

export interface OperationalPrune {
  runOnce(): Promise<PruneResult>;
  setLogger(log: Logger): void;
  stop(): void;
}

export const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/**
 * After a start, off the boot path, and after the trash sweep's first pass
 * rather than beside it: two minutes.
 */
export const PRUNE_START_DELAY_MS = 120_000;

/**
 * The prune, on the trash sweep's timer arrangement: a pass shortly after a
 * start and then daily, `unref`ed, and skipped when the wall clock has jumped
 * (`wall-clock.ts`), since every age here is measured against it.
 */
export function startOperationalPrune(
  db: DatabaseSync,
  sessionExists: (account: string, sessionId: string) => Promise<boolean>,
  options: { intervalMs?: number; startDelayMs?: number; clock?: WallClockWatch } = {},
): OperationalPrune {
  let log: Logger | null = null;
  let stopped = false;
  const clock = options.clock ?? watchWallClock();

  const runOnce = (): Promise<PruneResult> => pruneOperationalStore(db, { sessionExists });

  const run = (): void => {
    if (stopped) return;
    if (clock.jumped()) {
      log?.warn(
        { event: 'state.clockJumped' },
        'The clock moved unlike time passing, so this prune was skipped',
      );
      return;
    }
    void runOnce()
      .then((pruned) => {
        if (pruned.jobs + pruned.keys > 0) {
          log?.info({ event: 'state.pruned', ...pruned }, 'Collected finished turns');
        }
      })
      .catch((error: unknown) => {
        log?.error(
          { event: 'state.pruneFailed', message: error instanceof Error ? error.message : '' },
          'The operational store could not be pruned',
        );
      });
  };

  const first = setTimeout(run, options.startDelayMs ?? PRUNE_START_DELAY_MS);
  first.unref();
  const timer = setInterval(run, options.intervalMs ?? PRUNE_INTERVAL_MS);
  timer.unref();

  return {
    runOnce,
    setLogger: (next) => {
      log = next;
    },
    stop: () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
