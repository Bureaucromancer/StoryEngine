// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { FailureRemedy, StepFailureReason } from './turn.js';

/**
 * ***A failure, turned into something a person can do*** —
 * [09 §6.5](../../../docs/design/09-server-multiuser-deployment.md),
 * [P11.6](../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **This is the half [P10.3](../../../docs/design/workplan/27-p10-implementation.md)
 * named and did not build.** P10 took the update check — the badge, the
 * conditionality, and the distinction that makes the signal trustworthy — and
 * recorded the rest: *"an engine that says 'this server appears to have no
 * internet access' instead of surfacing a raw connection error when a turn fails
 * against a remote provider… belongs where a provider failure becomes a
 * `StepFailureReason`."* That is here, and the signal it needs now exists.
 *
 * ***Pure, and that is what makes the conditionality testable.*** The awkward
 * case is not the failure, it is the **absence** of a warning: an install whose
 * endpoints are all on the LAN must be told nothing about the internet, and a
 * happy-path test would never see that. A function over three values can be
 * asked the question directly, once per combination, which is the only shape
 * that holds [09 §6.5]'s *"a fully local setup is a legitimate,
 * fully-functional deployment and its operator chose it deliberately."*
 *
 * **Locality is asked before connectivity, and the order is the rule.** A model
 * server that is not running and an internet connection that is down produce the
 * identical `ECONNREFUSED`, and only the address distinguishes them. Reading
 * connectivity first would let one dead container on `localhost:11434` report
 * the internet as broken — which is not merely wrong, it is wrong in the
 * direction that sends somebody to look at their router.
 *
 * ***In `shared` because it has two callers on opposite sides of the wire.***
 * The runner derives a remedy while the failure is fresh and has every input;
 * the transcript derives one for a turn that failed last week and has only the
 * class. **One function answering both is the point** — a second copy on the
 * client would be a second opinion about what a failure means, and the two
 * would disagree the first time an arm was added. The optional fields are how
 * the same function serves a caller that knows less, and every one of them
 * degrades towards saying less rather than towards guessing.
 */

export interface Diagnosis {
  /** The class the engine settled on, after its retries. */
  reason: StepFailureReason;
  /**
   * Whether the endpoint this step resolved to is on this network.
   *
   * *Undefined when no call was ever dispatched* — a role that resolved to
   * nothing, an assembly that refused itself — because there is no endpoint to
   * ask about and a default either way would be a claim.
   */
  endpoint?: 'local' | 'remote';
  /**
   * Whether the endpoint accepted the request and then went silent, as opposed
   * to refusing it.
   *
   * Both are `terminal` to the retry ladder and they are opposite remedies:
   * one is *wait, or lower the load*, the other is *change something*. The
   * class cannot carry it because the class is about retrying.
   */
  stalled?: boolean;
  /**
   * What the last update check learned about this server's internet — `null`
   * when no check has run, which is a third state and not a pessimistic
   * default ([`updates.ts`](../../server/src/updates.ts)).
   */
  online: boolean | null;
}

export function remedyFor(diagnosis: Diagnosis): FailureRemedy {
  const { reason, endpoint, stalled, online } = diagnosis;

  /**
   * The configuration faults first, because they are the ones where the network
   * is fine and looking at it wastes somebody's evening. `unbound` is *no
   * connection for this role*; `dangling` is *a binding pointing at a
   * connection that is gone* — [P2B]'s posture, which says both plainly rather
   * than failing obscurely.
   */
  if (reason === 'unbound' || reason === 'dangling') return 'not-bound';

  // Ours, and saying anything about the network would send somebody to look in
  // the wrong place. `advisory-leak` is [06 §5.2]'s structural refusal firing,
  // which is this build protecting itself from itself.
  if (reason === 'advisory-leak' || reason === 'internal' || reason === 'cancelled') {
    return 'engine';
  }

  // The endpoint answered. 429 and 5xx are the retry ladder's own subject, and
  // a person's remedy is to wait rather than to change anything.
  if (reason === 'retryable') return 'endpoint-busy';

  if (reason === 'terminal') return stalled === true ? 'endpoint-stalled' : 'endpoint-refused';

  /**
   * `transient` is *the connection did not work* —
   * [`openai-compatible.ts`](../../server/src/providers/openai-compatible.ts)'s
   * `TRANSIENT_CODES` and the SDK's own `isRetryable`, both of which mean
   * nothing answered. **This is the only arm where connectivity is a fair
   * question**, and it is still only fair for a remote address.
   */
  if (endpoint === 'local') return 'endpoint-silent-local';
  /**
   * ***No endpoint, which is the reader's case rather than the runner's.***
   * `transient` is only ever produced by a dispatched call, so the runner
   * always has the locality. A **reader** — the transcript, reconstructing a
   * remedy from a turn that failed last week — has the class and nothing else,
   * because [18 §3](../../../docs/design/18-session-import.md)'s record keeps
   * neither the address nor that day's connectivity. `endpoint-silent` is that
   * reader's honest answer, and it is why the arm exists.
   */
  if (endpoint === undefined) return 'endpoint-silent';
  if (online === true) return 'endpoint-silent-online';
  if (online === false) return 'endpoint-silent-offline';
  return 'endpoint-silent';
}
