// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { activeJobs } from './state/jobs.js';
import type { AppServices } from './app.js';

/**
 * Restarting on purpose — [09 §6.4](../../../docs/design/09-server-multiuser-deployment.md),
 * [P10 §1.6](../../../docs/design/workplan/27-p10-implementation.md), [P10.3].
 *
 * ***§6.4 asks for three things and the middle one is the work***: only offer
 * it where something will start the process again ([`supervision.ts`](./supervision.js)),
 * **drain** rather than exit, and say what the drain is about to interrupt.
 *
 * ***"Drain" here means wait, and `runner.drain()` does not.*** That method
 * aborts every live turn and then settles — which is right for shutdown, where
 * the process is going whatever happens, and wrong for this, where the whole
 * point is that a turn somebody is reading gets to finish. So the sequence is:
 * **stop accepting**, then `settle()`, then exit — and the abort is what happens
 * when the timeout runs out, because a turn against a stalled endpoint must not
 * hold a restart open forever.
 *
 * *[C4] already says an interrupted turn is recorded as failed rather than
 * resumed*, which §6.4 calls *"survivable but rude when self-inflicted"*. This
 * is the difference between self-inflicted and unavoidable.
 */

/** How long a restart waits for turns in flight before it stops waiting. */
export const DRAIN_TIMEOUT_MS = 30_000;

/**
 * The status a requested restart exits with — `EX_TEMPFAIL`, *try again*.
 *
 * ***Not 0, because 0 means *stopped on purpose* to every supervisor that
 * reads it.*** The shipped unit said `Restart=on-failure`, which restarts on
 * any non-zero status and on nothing else. So *Restart now* drained, exited 0,
 * and left the tarball install stopped until somebody with a shell started it,
 * with a restore marker waiting for whoever that was. That is the exact
 * trap [09 §6.4] exists to refuse. A status of its own lets a unit say
 * *restart on this one* (`RestartForceExitStatus=`) without also restarting a
 * server that exited because somebody stopped it. `release.test.ts` holds the
 * unit to this number.
 *
 * *A signal still exits 0*: `systemctl stop` and `docker stop` are somebody
 * asking for the process to stay down.
 */
export const RESTART_EXIT_CODE = 75;

/**
 * What a restart would interrupt, right now — the confirmation's own sentence.
 *
 * ***"2 other users have active sessions" is [09 §6.4]'s example and the split
 * is the point***: an admin restarting during **their own** turn has made an
 * informed choice about their own story, and an admin restarting during
 * somebody else's has made it about a person who is not in the room. So the two
 * are counted separately, and the surface can say the second thing loudly.
 *
 * **Counts, never contents** — [09 §4.5]'s rule, the same one the connection
 * delete warning follows. *Who* is mid-turn is a different feature.
 */
export function wouldInterrupt(
  services: AppServices,
  handle: string,
): { mine: number; others: number } {
  let mine = 0;
  let others = 0;
  for (const job of activeJobs(services.state.db)) {
    if (job.account === handle) mine += 1;
    else others += 1;
  }
  return { mine, others };
}

export type RestartRefusal =
  /** Nothing would start the process again. [09 §6.4]'s trap, refused. */
  | 'unsupervised'
  /** No `exit` seam is wired — a test harness, or a build that embeds the app. */
  | 'unavailable'
  /** One is already running. A second would drain a process that is leaving. */
  | 'already-restarting';

/**
 * Stops accepting turns, waits for the ones in flight, and exits.
 *
 * ***Returns as soon as the drain is *begun***, deliberately. The caller is an
 * HTTP handler and the process is about to end: a handler that awaited this
 * would be a response nobody receives, on a socket the exit closes. So the
 * route answers *accepted* and the drain runs behind it — which is also why
 * `services.draining` is set **synchronously**, before the first `await`, or a
 * turn submitted in the same tick would slip past the refusal.
 *
 * **Clients reconnect on their own** ([19 §8]), so what a person sees is the
 * stream's *reconnecting* state and then the page coming back — which is
 * §6.4's own description of the result.
 */
export function beginRestart(
  services: AppServices,
): { ok: true } | { ok: false; why: RestartRefusal } {
  if (!services.supervision.supervised) return { ok: false, why: 'unsupervised' };
  if (services.exit === null) return { ok: false, why: 'unavailable' };
  if (services.draining) return { ok: false, why: 'already-restarting' };

  const exit = services.exit;
  services.draining = true;

  void drainThen(services, exit);
  return { ok: true };
}

async function drainThen(services: AppServices, exit: () => void): Promise<void> {
  /**
   * **Wait, and then stop waiting.** `settle()` resolves when every live turn
   * has finished of its own accord; the race gives it a bounded amount of time
   * to do that. A turn against an endpoint that has stopped answering is capped
   * by `limits.providerTimeoutMs` in the ordinary case, and this is the case
   * where that is not enough — a whole session's worth of steps, each inside
   * its own timeout.
   */
  const settled = services.runner.settle();
  await Promise.race([settled, delay(DRAIN_TIMEOUT_MS)]);

  /**
   * `drain()` rather than `settle()` here, and the difference is what the
   * timeout means: anything still running has had its chance, and aborting it
   * commits it as a **failed turn** rather than losing it — which is the
   * recovery contract `#finaliseUnstartable` and startup reconciliation are
   * built around.
   */
  await services.runner.drain();
  exit();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Never the reason a process stays alive — the same rule the SSE keepalive
    // follows, and here the process is trying to leave.
    timer.unref();
  });
}
