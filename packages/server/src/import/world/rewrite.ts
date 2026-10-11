// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { channelKey, splitChannelKey } from '../../sessions/channels.js';

/**
 * ***References follow a re-mint*** — [P16.3e](../../../../../docs/design/workplan/35-p16-world.md),
 * [04 §9](../../../../../docs/design/04-schemas.md), [16 §5.1](../../../../../docs/design/16-publish.md).
 *
 * **What it is for.** A World file arriving on an account that cannot hold an
 * object's id — another account on the same install holds it, so `create`'s
 * install-wide check refuses it ([P16.3]'s plan, fact 1) — lands that object
 * under a fresh id, and everything in the file that named the old one has to
 * name the new one, or a treatment arrives linking a book that is not there and
 * a World arrives naming objects its own owner cannot read. `ids` is the plan's
 * map from a file id to the id it landed under ({@link planArrivals}); this is
 * the one place the map is applied.
 *
 * ***One deep, exact-match replacement, not a per-field rewriter*** ([P16.3]'s
 * plan, §3). It reaches the positions [04 §9.1]'s table names — a treatment's
 * lore and cast, a hook's bare `involves` and `introduces.actor`, an actor's
 * lore, a setup's treatment, preset and cast, a World's `contents` — and the
 * ones the table deliberately does not follow, which a re-mint must follow all
 * the same: `LoreScope`'s `linked` and `world` arms, which name an actor and a
 * World by id. A rewriter that listed fields would be a second reading of the
 * schemas that a new field silently escapes. `links.ts`'s objection to a
 * deep search is to a *collector* deciding what a reference is; this decides
 * nothing about meaning, it only renames an id the plan already chose to rename.
 *
 * **Exact matches, never substrings.** A string is replaced when it *is* a
 * mapped id, whole — `seworld:<id>`, a rendition id `<turnId>.<n>`, a sentence
 * that happens to quote an id are left exactly as written. The ids mapped are
 * uuids the plan saw as objects' own ids in the file, so a string equal to one
 * that is not a reference to it would have to be one somebody typed on
 * purpose ([P16.3]'s plan, risk 1).
 *
 * ***And map keys*** — the fact check of 2026-10-10, which found the plan's
 * *"leaves keys alone"* false for a session: `SessionFile` keys ids in maps
 * (`prompts.cards` by actor, `hidden`, `renditionSelection` and
 * `lastSelectedChild` by turn) and in composite keys (`channels`, keyed
 * `<channelId>#<scopeKey>` with an actor id as the scope of `se.presence`,
 * `se.status` and `se.party`). A session landed with the old keys records, on
 * first open, *hand edits* deleting the re-minted actors' state. So:
 *
 * - **a key that is a mapped id, whole, is renamed** — anywhere, as a value
 *   is, and for the value's reason: the next id-keyed map is reached without
 *   anybody remembering to list it;
 * - **a key of a map held under `channels` is split** with `splitChannelKey`,
 *   its scope renamed when the scope is a mapped id, and joined again with
 *   `channelKey` — the composite shape is matched only where the format is
 *   known to be one, so *never substrings* stays true everywhere else.
 *
 * *The six portable kinds key no map by an object id* — checked against every
 * `Type.Record` in their schemas at [P16.3e]: `generated` is keyed by a dotted
 * field path, `modeData` by a mode id, a preset's `parameters` by a sampler's
 * name, and `compat` and `metadata` are open. So for objects the key rule
 * changes nothing a schema promises; it is here for sessions, which
 * [P16.3f] lands, and its tests scan keys as well as values.
 *
 * **`skip` names keys whose values are copied as they are, never entered** —
 * `foreign`, for [P16.3f]: a turn's record of the id it had in another app, or
 * in the sender's session, is provenance, and rewriting it would make it name
 * something it never was.
 *
 * Pure: the input is not changed, and a value with nothing to rename comes back
 * as an equal copy. Plain JSON only — what a parsed body is.
 *
 * ***Iterative, never recursive*** (the P16.3e review, 2026-10-11). A body
 * comes out of somebody else's file, and `metadata` is `Type.Unknown`, so a
 * book can carry a value nested thousands of levels deep that `JSON.parse` and
 * `validate` both accept. A recursive walk — and `structuredClone`, which this
 * used for the nothing-to-rename case — overflows the stack at about five
 * thousand levels, and it did so while the reader was yielding, *after* the
 * objects before it in the file had been written: a half-import with no
 * report. An explicit stack has no depth but the heap's, so a deep body is
 * copied like any other, and whatever the library then makes of it is that
 * one object's refusal.
 */
export function rewriteIds<T>(
  value: T,
  ids: ReadonlyMap<string, string>,
  skip: ReadonlySet<string> = NOTHING,
): T {
  return walk(value, changing(ids), skip) as T;
}

const NOTHING: ReadonlySet<string> = new Set();

/** The mappings that rename something — an id landing as itself is not one. */
function changing(ids: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  return new Map([...ids].filter(([from, to]) => from !== to));
}

/** One value still to copy: where it goes, and how its strings and keys are read. */
interface Pending {
  from: unknown;
  into: (copy: unknown) => void;
  /** False under a skipped key: copied as it is, never entered. */
  rename: boolean;
  /** The value is the map held under `channels`, so its keys are composite. */
  channels: boolean;
}

function walk(root: unknown, ids: ReadonlyMap<string, string>, skip: ReadonlySet<string>): unknown {
  let result: unknown;
  const stack: Pending[] = [
    { from: root, into: (copy) => (result = copy), rename: true, channels: false },
  ];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { from, into, rename, channels } = next;
    if (typeof from === 'string') {
      into(rename ? (ids.get(from) ?? from) : from);
      continue;
    }
    if (Array.isArray(from)) {
      const out: unknown[] = new Array<unknown>(from.length);
      into(out);
      from.forEach((one, at) =>
        stack.push({ from: one, into: (copy) => (out[at] = copy), rename, channels: false }),
      );
      continue;
    }
    if (typeof from !== 'object' || from === null) {
      into(from);
      continue;
    }

    const out: Record<string, unknown> = {};
    into(out);
    for (const [key, inner] of Object.entries(from as Record<string, unknown>)) {
      const name = !rename ? key : channels ? channelRenamed(key, ids) : (ids.get(key) ?? key);
      // Defined, never assigned: a parsed body can hold an own `__proto__` key,
      // and assigning one would set this copy's prototype instead of a field.
      // Defined now, in the source's order, so the copy's keys keep it however
      // the stack visits them.
      define(out, name, undefined);
      stack.push({
        from: inner,
        into: (copy) => {
          define(out, name, copy);
        },
        rename: rename && !skip.has(key),
        channels: rename && !skip.has(key) && key === CHANNELS && isMap(inner),
      });
    }
  }
  return result;
}

function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * ***Which of `ids` a value names*** — as a whole string or a whole key, the
 * same reading `rewriteIds` renames by, and by the same explicit stack. What
 * keep-both's fixed point asks to know which objects to look at again when one
 * becomes a copy (`plan.ts`), rather than comparing every object on every pass.
 * A channel key's scope counts as the rewrite counts it.
 */
export function idsNamedIn(value: unknown, ids: ReadonlySet<string>): Set<string> {
  const found = new Set<string>();
  const stack: { from: unknown; channels: boolean }[] = [{ from: value, channels: false }];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { from, channels } = next;
    if (typeof from === 'string') {
      if (ids.has(from)) found.add(from);
      continue;
    }
    if (Array.isArray(from)) {
      for (const one of from) stack.push({ from: one, channels: false });
      continue;
    }
    if (typeof from !== 'object' || from === null) continue;
    for (const [key, inner] of Object.entries(from as Record<string, unknown>)) {
      if (ids.has(key)) found.add(key);
      if (channels) {
        const { scopeKey } = splitChannelKey(key);
        if (scopeKey !== null && ids.has(scopeKey)) found.add(scopeKey);
      }
      stack.push({ from: inner, channels: key === CHANNELS && isMap(inner) });
    }
  }
  return found;
}

/** The property whose map is keyed `<channelId>#<scopeKey>` — `SessionFile.channels`. */
const CHANNELS = 'channels';

function isMap(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A channel map's key with its scope renamed — or, unscoped or scoped by
 * something unmapped, as it was. A whole key that is a mapped id is renamed as
 * any key is, so the rule here is never narrower than the general one.
 */
function channelRenamed(key: string, ids: ReadonlyMap<string, string>): string {
  const whole = ids.get(key);
  if (whole !== undefined) return whole;
  const { channelId, scopeKey } = splitChannelKey(key);
  if (scopeKey === null) return key;
  const scope = ids.get(scopeKey);
  return scope === undefined ? key : channelKey(channelId, scope);
}
