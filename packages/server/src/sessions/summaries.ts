// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { writeJsonAtomic } from '../storage/atomic.js';
import { ensureDirectory, listEntryNames, readFileBytes } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { PathEscapeError, resolveWithin } from '../storage/paths.js';
import {
  planChain,
  SUMMARY_SCHEMA,
  type SummaryLink,
  type SummarisableTurn,
  type SummaryPolicy,
  type SummaryRoot,
  type SummaryUnit,
} from './summary-chain.js';

/**
 * The summary store — [07 §5](../../../../docs/design/07-branching.md), [P8.0].
 *
 * **`sessions/snapshots.ts`'s posture, copied rather than reinvented**, and the
 * copying is the decision: one file per key, an atomic write, a best-effort
 * write path that never fails a caller, and **every read failure is a miss**.
 * *A derived store that can fail a read path is a session that cannot be
 * opened*, and the snapshot cache already argued that out — *"the cost of being
 * wrong about that is a slower reconstruction; the cost of throwing would be a
 * session that cannot be read because a derived file went bad."* A summary is
 * the same class of file and deserves the same answer, so this module differs
 * from that one only where the keying does.
 *
 * ***Where it differs is the file's name, and that is the whole design.*** A
 * snapshot is named by the node it is the state *at*; a summary is named by the
 * **hash of its inputs** and by nothing else. That is what
 * [07 §5](../../../../docs/design/07-branching.md) means by content-addressed,
 * and it is why a fork shares a prefix without copying: two lines inside one
 * session directory resolve the same key to the same path, so the sharing is a
 * consequence of the name rather than a thing any code does.
 *
 * **In the session directory rather than beside the library**, for the same
 * reason snapshots are: a summary is derived from this session's turns and means
 * nothing without them. Deleting `sessions/<id>/summaries/` must cost model
 * calls and nothing else, which is [P8]'s gate step 3.
 */

export function summariesRoot(layout: Layout, handle: string, sessionId: string): string {
  return resolveWithin(layout.sessionRoot(handle, sessionId), 'summaries');
}

/**
 * The path a key would have, or null when the key cannot be one.
 *
 * Keys reaching here are hex digests this process computed, so the guard looks
 * redundant — and it is the same guard `snapshots.ts` explains at length for
 * turn ids: a hand-edited file is a supported way to get data in
 * ([03 §8.1](../../../../docs/design/03-data-model.md)), and a `previousKey`
 * read back out of one is a string from disk. Returning null rather than
 * throwing keeps a miss a miss, because the derivation behind it is still
 * correct.
 */
function pathFor(layout: Layout, handle: string, sessionId: string, key: string): string | null {
  try {
    return resolveWithin(summariesRoot(layout, handle, sessionId), `${key}.json`);
  } catch (error) {
    if (error instanceof PathEscapeError) return null;
    throw error;
  }
}

/**
 * Which keys are held, as one directory read.
 *
 * `listSnapshots`' economics, for `listSnapshots`' reason: a chain of twenty
 * links would otherwise cost twenty failed opens to answer *what is already
 * here*. The property test also reads it directly — *the two lines resolve the
 * same key set* is a statement about this set.
 */
export async function listSummaries(
  layout: Layout,
  handle: string,
  sessionId: string,
): Promise<Set<string>> {
  const names = await listEntryNames(summariesRoot(layout, handle, sessionId));
  return new Set(
    names.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length)),
  );
}

/**
 * A link, or null when there is not a readable one under that key.
 *
 * **Every failure is a miss**, per the header. The key is checked against the
 * file's own field as well as against its name, so a summary that was copied or
 * renamed is refused rather than believed — the check `readSnapshot` makes for
 * `turnId`, and here it is load-bearing rather than defensive: the name is the
 * only thing asserting that these bytes are a summary of *these* inputs.
 */
export async function readSummary(
  layout: Layout,
  handle: string,
  sessionId: string,
  key: string,
): Promise<SummaryLink | null> {
  const path = pathFor(layout, handle, sessionId, key);
  if (path === null) return null;

  const bytes = await readFileBytes(path);
  if (bytes === null) return null;

  try {
    // Read as unknown rather than as a `Partial<SummaryLink>`: the file is
    // whatever is on disk, and a declared type would make the checks below look
    // redundant to the compiler while doing the only work that matters.
    const held = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (held['schema'] !== SUMMARY_SCHEMA || held['key'] !== key) return null;
    if (typeof held['text'] !== 'string') return null;
    if (!Array.isArray(held['unitKeys'])) return null;
    return held as unknown as SummaryLink;
  } catch {
    return null;
  }
}

/**
 * Writes a link, and never fails a caller.
 *
 * Best effort by construction, exactly as `writeSnapshot` is: a full disk, a
 * read-only mount or a directory somebody deleted underneath us are all
 * conditions under which the chain is still perfectly correct, only more
 * expensive. The one thing this must never do is leave a *wrong* file under a
 * key, which the atomic write handles.
 *
 * Returns whether it landed, so a caller that cares — a test — can tell a cache
 * that is off from one that is broken.
 */
export async function writeSummary(
  layout: Layout,
  handle: string,
  sessionId: string,
  link: SummaryLink,
): Promise<boolean> {
  const path = pathFor(layout, handle, sessionId, link.key);
  if (path === null) return false;

  try {
    await ensureDirectory(summariesRoot(layout, handle, sessionId));
    await writeJsonAtomic(path, link);
    return true;
  } catch {
    return false;
  }
}

/**
 * A resolved summariser: an identity, and a way to produce one link's prose.
 *
 * **An interface rather than a call site**, because [P8.0] is pure engine and
 * *"the chain is computed and stored and reaches nothing"*. The model-backed
 * implementation is a **step** — [P8 §1.3] settles that the summariser and the
 * extractor cannot be one step, since `callPurposeFor` derives a call's purpose
 * from its declaration and they declare differently — and a step belongs in the
 * pipeline, which is [P8.1]. Until then the only implementation is the property
 * test's, which is deterministic and makes no call at all.
 *
 * `key` is {@link summariserKey}'s output. It is passed in rather than computed
 * here because resolving a role needs the session's bindings, which this module
 * has no business reading.
 */
export interface Summariser {
  key: string;
  run(input: { previous: string | null; units: readonly SummaryUnit[] }): Promise<string>;
}

/** What a chain cost, so [P8 §1.3]'s procedure has a number from the first stage. */
export interface ChainResult {
  links: SummaryLink[];
  /**
   * How many links this call had to derive.
   *
   * ***Instrumented from the first stage deliberately.*** §1.3 does not ask for
   * a decision about cadence, it asks for a measurement — *"instrument the
   * summariser's call count and token spend per hundred turns from the first
   * stage"* — and the call count is the half this stage can honestly produce. **A
   * warm chain derives zero**, which is the number that makes the ratio §1.3
   * actually wants computable: extraction calls against narration calls, not
   * against turns.
   */
  derived: number;
}

/**
 * The chain for a path: read what is held, derive what is not, return all of it.
 *
 * **Lazy, and that is the point of content addressing.** Nothing is computed
 * because a turn happened; a link is computed because somebody asked for a chain
 * whose key is not on disk. A fork therefore pays for the one link it
 * invalidated and reads the rest, and regenerating after `rm -r summaries/`
 * produces **byte-identical files** rather than merely equivalent ones — which
 * is what lets [P8]'s gate step 3 be an equality instead of a judgement.
 *
 * *Derivation is sequential and has to be:* link *n* is `f(link(n-1), units)`,
 * so a parallel map over the plan would be a different function.
 */
export async function ensureChain(
  layout: Layout,
  handle: string,
  sessionId: string,
  path: readonly SummarisableTurn[],
  summariser: Summariser,
  policy: SummaryPolicy,
  /**
   * What had already happened — {@link SummaryRoot}, [P13.2]. It keys the
   * first link and is handed to it as `previous`, which is the only difference
   * a root makes to the chain; it is **not** in `links`, because the collector
   * is handed it separately and every caller that assembles a prompt has it
   * whether or not a chain was derived.
   */
  root: SummaryRoot | null = null,
): Promise<ChainResult> {
  const planned = planChain(path, summariser.key, policy, root?.key ?? null);
  const links: SummaryLink[] = [];
  let derived = 0;

  for (const plan of planned) {
    const held = await readSummary(layout, handle, sessionId, plan.key);
    if (held !== null) {
      links.push(held);
      continue;
    }

    const previous = links.at(-1)?.text ?? root?.text ?? null;
    const text = await summariser.run({ previous, units: plan.units });
    const link: SummaryLink = {
      schema: SUMMARY_SCHEMA,
      key: plan.key,
      summariser: summariser.key,
      previousKey: plan.previousKey,
      unitKeys: plan.units.map((unit) => unit.key),
      turnIds: plan.units.map((unit) => unit.turnId),
      from: plan.from,
      to: plan.to,
      text,
    };
    await writeSummary(layout, handle, sessionId, link);
    derived += 1;
    links.push(link);
  }

  return { links, derived };
}
