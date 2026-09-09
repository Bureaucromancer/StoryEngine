// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { writeJsonAtomic } from '../storage/atomic.js';
import { ensureDirectory, listEntryNames, readFileBytes } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { PathEscapeError, resolveWithin } from '../storage/paths.js';
import type { ChannelState } from './types.js';

/**
 * The snapshot cache — [07 §4](../../../../docs/design/07-branching.md), [P6.0d].
 *
 * **Derived, disposable, never authoritative**, which is the same rule the
 * SQLite index follows ([03 §5.1](../../../../docs/design/03-data-model.md)) and
 * the reason this module is small: deleting every file it writes must cost time
 * and nothing else. Everything here is a cache in front of
 * `replayChannels(walkPath(...))`, and the property test asserts that the two
 * agree at every index — with the cache warm, and again with it deleted.
 *
 * **Why a cache is needed at all**, since replaying is correct: at turn eight
 * hundred it is *"too slow to feel casual"* ([07 §4]), and P5 made that sharper
 * than walk depth alone. Every turn touching a lorebook writes one
 * `se.lore.timing` effect per entry whose counters moved, and `applyEffects`
 * copies the whole map per effect — so the fold is turns × effects × keys, and
 * a library of a few hundred entries makes the middle term large. The cache
 * bounds the first factor; nothing bounds the others.
 *
 * **One file per node, named by turn id**, in the location [03 §5.1] already
 * fixed — `sessions/<id>/snapshots/`. This stage did not get to choose it.
 */

/** What a snapshot file holds. */
export interface Snapshot {
  schema: 'storyengine.snapshot/1';
  /** The node this is the state *at*. Also the file's name, so it is checkable. */
  turnId: string;
  channels: Record<string, ChannelState>;
  createdAt: string;
}

export function snapshotsRoot(layout: Layout, handle: string, sessionId: string): string {
  return resolveWithin(layout.sessionRoot(handle, sessionId), 'snapshots');
}

/**
 * The path a node's snapshot would have, or null when the id cannot be one.
 *
 * A turn id reaches here from a **record on disk**, and a hand-edited segment is
 * a supported way to get data in ([03 §8.1]) — so an id of `../../session.json`
 * is a shape this has to answer for rather than assume away. `resolveWithin`
 * refuses it; returning null rather than throwing keeps a cache miss a cache
 * miss, because the fold behind it is still correct for that node.
 */
function pathFor(layout: Layout, handle: string, sessionId: string, turnId: string): string | null {
  try {
    return resolveWithin(snapshotsRoot(layout, handle, sessionId), `${turnId}.json`);
  } catch (error) {
    if (error instanceof PathEscapeError) return null;
    throw error;
  }
}

/**
 * Which nodes have a snapshot, as one directory read.
 *
 * **One listing rather than a stat per node**, and the difference is the whole
 * economics of the read path: walking a path of two hundred looking for the
 * nearest snapshot would otherwise cost two hundred failed opens, which is
 * worse than the fold it is trying to avoid.
 */
export async function listSnapshots(
  layout: Layout,
  handle: string,
  sessionId: string,
): Promise<Set<string>> {
  const names = await listEntryNames(snapshotsRoot(layout, handle, sessionId));
  return new Set(
    names.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length)),
  );
}

/**
 * A node's snapshot, or null when there is not a readable one.
 *
 * **Every failure is a miss**, deliberately: a truncated file, a half-written
 * one, a hand-edited one that is not JSON. The cost of being wrong about that
 * is a slower reconstruction; the cost of throwing would be a session that
 * cannot be read because a derived file went bad.
 */
export async function readSnapshot(
  layout: Layout,
  handle: string,
  sessionId: string,
  turnId: string,
): Promise<Record<string, ChannelState> | null> {
  const path = pathFor(layout, handle, sessionId, turnId);
  if (path === null) return null;

  const bytes = await readFileBytes(path);
  if (bytes === null) return null;

  try {
    // Read as unknown rather than as a `Partial<Snapshot>`, because the file is
    // whatever is on disk: a declared type here would make the checks below
    // look redundant to the compiler while doing the only work that matters.
    const held = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    // The id is in the file as well as in its name, so a snapshot that was
    // copied or renamed is refused rather than believed.
    if (held['schema'] !== 'storyengine.snapshot/1' || held['turnId'] !== turnId) return null;
    const channels = held['channels'];
    if (typeof channels !== 'object' || channels === null) return null;
    return channels as Record<string, ChannelState>;
  } catch {
    return null;
  }
}

/**
 * Writes a node's snapshot, and never fails a caller.
 *
 * **Best effort by construction.** A read path that writes a cache entry must
 * not be able to fail because of the write: a full disk, a read-only mount or a
 * directory somebody deleted underneath us are all conditions under which
 * reconstruction is still perfectly correct, only slower. The one thing this
 * must never do is leave a *wrong* file, which the atomic write handles.
 *
 * Returns whether it landed, so a caller that cares — a test — can tell the
 * difference between a cache that is off and one that is broken.
 */
export async function writeSnapshot(
  layout: Layout,
  handle: string,
  sessionId: string,
  turnId: string,
  channels: Record<string, ChannelState>,
  now: string = new Date().toISOString(),
): Promise<boolean> {
  const path = pathFor(layout, handle, sessionId, turnId);
  if (path === null) return false;

  const snapshot: Snapshot = {
    schema: 'storyengine.snapshot/1',
    turnId,
    channels,
    createdAt: now,
  };

  try {
    await ensureDirectory(snapshotsRoot(layout, handle, sessionId));
    await writeJsonAtomic(path, snapshot);
    return true;
  } catch {
    return false;
  }
}
