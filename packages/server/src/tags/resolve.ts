// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { resolveTagNames, type TagList } from '@storyengine/shared';

/**
 * An object's tags, as they are called *now* — [25 §3](../../../../docs/design/25-tagging.md).
 *
 * **This is the rule that lets the name copy on disk lag behind a rename.**
 * A rename is one write to the registry; the objects carrying that tag are not
 * touched, so their stored `tags` still say the old thing until each is next
 * saved. Nothing reads that stale copy, because everything that hands an object
 * onwards passes it through here first.
 *
 * **Two boundaries, not the read itself.** `library.read` is synchronous over
 * the index and the registry is an async file, so resolving inside it would
 * need a cache with invalidation. It does not: the two places that hand objects
 * to somebody who cares about names — the library routes, and the cast the
 * assembly gathers — are both already async at their own level. One `await`
 * each, no cache, nothing to go stale.
 *
 * **Returns the object unchanged when nothing moved**, which is not an
 * optimisation so much as a guarantee: an un-adopted object, or one whose names
 * already agree with the registry, comes back as the same reference, so nothing
 * downstream can tell this function ran.
 */
export function resolveObjectTags<T>(body: T, registry: TagList): T {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;

  const record = body as Record<string, unknown>;
  const tags = record['tags'];
  if (!Array.isArray(tags)) return body;

  const names = tags.filter((tag): tag is string => typeof tag === 'string');
  // A `tags` holding something that is not a string is a hand edit this cannot
  // improve on, so it is left exactly as found rather than quietly filtered.
  if (names.length !== tags.length) return body;

  const rawIds = record['tagIds'];
  const ids = Array.isArray(rawIds)
    ? rawIds.filter((id): id is string => typeof id === 'string')
    : undefined;
  if (ids !== undefined && Array.isArray(rawIds) && ids.length !== rawIds.length) return body;

  const resolved = resolveTagNames(names, ids, registry);
  if (same(names, resolved)) return body;

  return { ...record, tags: resolved } as T;
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
