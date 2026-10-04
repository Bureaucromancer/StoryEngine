// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ModelCall, ModelRole, TokenUsage } from '@storyengine/shared';

import { appendLine } from '../storage/files.js';
import { KeyedQueue } from '../storage/keyed-queue.js';
import type { Layout } from '../storage/layout.js';

/**
 * ***What a model call that writes no turn spent*** —
 * [10 §11.4](../../../../docs/design/10-ui-surfaces.md),
 * [21 §1.4](../../../../docs/design/21-internal-contracts.md).
 *
 * §11.4 is the obligation, and it is unusually direct about why it cannot wait:
 * *"They cost money, and must be **recorded** even though nothing displays it at
 * 1.0. Recording is nearly free and cannot be added retroactively — a spend view
 * built later over data that was never captured shows nothing for the first
 * year."* [24 §3.3](../../../../docs/design/24-roadmap.md) repeats it as a 1.0
 * obligation. A turn records its calls on its own tape (`ModelCall`); the calls
 * that make no turn — a field assist, an impersonation, the moment call behind
 * **Illustrate** — had nowhere to put the provider's figures, and each of them
 * dropped them on the floor.
 *
 * ***One file per account, append-only, and not the index or `state.sqlite`.***
 * The index is out by [21 §5.1](../../../../docs/design/21-internal-contracts.md)'s
 * own test — *"if losing it would surprise a user, it is not derived"* — and
 * this is not derived from anything. `state.sqlite` is authoritative but
 * install-level: an account archive deliberately holds none of it. A file
 * under `users/<handle>/` is inside that archive, comes back with an install
 * restore and with an account archive unpacked in place, goes with the
 * account's removal, and a person can read it — which is the same reason a
 * rendition's record is a file beside its session rather than a row. *Not*
 * with a backup's merge import, whose scope is the library, sessions and tags
 * (per-turn spend comes with the sessions); what calls outside a turn cost
 * stays with the install that made them.
 *
 * ***Not the assist's field provenance, which §11.4 once named.*** Provenance
 * ([10 §11.2](../../../../docs/design/10-ui-surfaces.md)) is written by the
 * client, and only when the person saves: an assist they rejected — the one
 * that cost money and produced nothing — would leave no trace at all, and the
 * type has no field for usage in any case.
 */

export const USAGE_SCHEMA = 'storyengine.usage/1';

/**
 * ***The role a connection test's line carries, which is no role at all***
 * (2026-10-03, [polish §25] — the recommended answer, which the owner deferred
 * to).
 *
 * Every other line here names the role its call resolved: an assist asks the
 * role the account picked, impersonation and the moment call ask theirs. A
 * test resolves nothing — a person picked one model on one connection and
 * pressed a button — so any `ModelRole` written here would be a claim about a
 * binding that was never consulted, and a spend view grouping by role would
 * fold a person's tests into the role they happened to be filed under. **A
 * value no binding can ever have** keeps them apart and says what they were;
 * it widens this field and nothing else, so `ModelRole` itself, the bindings
 * files and the role tables are untouched. The purpose beside it,
 * `connection-test:text` or `connection-test:image`, says which arm.
 *
 * *Additive inside `storyengine.usage/1`*: nothing reads this file yet, and the
 * aggregate view that will ([24 §3.3](../../../../docs/design/24-roadmap.md))
 * is specified against [21 §1.4](../../../../docs/design/21-internal-contracts.md),
 * which records the value.
 */
export const CONNECTION_TEST_ROLE = 'connection-test';

/**
 * One call's line in `usage.jsonl`.
 *
 * ***The same three measured fields `ModelCall` carries, with the same rule.***
 * `usage` and `cost` are **provider-reported or null, never estimated**
 * ([21 §1.4]'s *"the estimate decides, the measurement records"*): they are
 * copied from what the adapter returned, so the capability gate
 * (`reportsUsage`) and the adapter's own second gate — *did the provider
 * actually send numbers* — are honoured by not being re-implemented here. A
 * null is an answer: the call happened, and nothing said what it cost.
 *
 * `resolved` follows `ModelCall` too: the connection's **id**, never the
 * connection (it carries `apiKey` and `baseUrl`), and the model that
 * *answered*, which the adapter reports and which can differ from the binding.
 */
export interface UsageRecord {
  schema: typeof USAGE_SCHEMA;
  /** When the call returned. ISO 8601. */
  at: string;
  /**
   * What the call was for — `impersonate`, `assist:<field path>`, `illustrate`,
   * `summarise`, `connection-test:text`, `connection-test:image`, and since the
   * P15 merge (2026-10-03) `setup-draft:<part>` and `setup-draft:summarise` for
   * *make a setup from here* (`turns/condense.ts` says why a link it derives is
   * filed under the wizard rather than `summarise`). An open string rather than
   * a union, because the next call path to need a line should not need a
   * migration to write one — which is how those two arrived.
   */
  purpose: string;
  /** The role the call resolved — or, for a connection test, which resolved none, {@link CONNECTION_TEST_ROLE}. */
  role: ModelRole | typeof CONNECTION_TEST_ROLE;
  resolved: { connectionId: string; modelId: string };
  usage: TokenUsage | null;
  cost: { amount: number; currency: string } | null;
  wallMs: number;
  /** The session the call was made from, when there was one. */
  sessionId?: string;
  /** The kind of library object an assist was writing for. */
  subject?: string;
}

/**
 * A `ModelCall` as a usage line — the shape impersonation and the moment call
 * already have in hand, because both go through `performCall`.
 */
export function fromModelCall(
  call: ModelCall,
  purpose: string,
  extra: { sessionId?: string; subject?: string } = {},
): UsageRecord {
  return {
    schema: USAGE_SCHEMA,
    at: new Date().toISOString(),
    purpose,
    role: call.role,
    resolved: { connectionId: call.resolved.connectionId, modelId: call.resolved.modelId },
    usage: call.usage,
    cost: call.cost,
    wallMs: call.wallMs,
    ...extra,
  };
}

/**
 * Appends are serialised per file. Two lines written concurrently would each
 * be a single `appendFile`, and in practice interleave cleanly — but "in
 * practice" is a claim about a platform, and `history.ts` queues its own
 * append-only index for the same reason.
 */
const appends = new KeyedQueue();

/**
 * Records one call. **Never throws.**
 *
 * *That is a decision, not an omission.* By the time this runs the provider has
 * answered and the person has paid; failing the request now would throw away
 * the one thing the call bought in order to protect a line about it. A lost line
 * costs what `appendLine`'s torn tail already costs — the newest entry — and a
 * disk that cannot take one line of JSON is failing every other write the
 * server makes, which will say so louder than this could.
 */
export async function recordUsage(
  layout: Layout,
  handle: string,
  record: UsageRecord,
): Promise<void> {
  try {
    const path = layout.usageLogFile(handle);
    await appends.run(path, () => appendLine(path, `${JSON.stringify(record)}\n`));
  } catch {
    // See the docstring: the answer outranks its receipt.
  }
}
