// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import { type Preset, uuidv7 } from '@storyengine/shared';

import {
  findTurnLocation,
  indexSession,
  indexTurn,
  removeSessionRows,
} from '../index-db/sessions.js';

import { writeJsonAtomic } from '../storage/atomic.js';
import { ensureDirectory, listDirectoryNames, moveTree, readFileBytes } from '../storage/files.js';
import { KeyedQueue } from '../storage/keyed-queue.js';
import type { Layout } from '../storage/layout.js';
import { resolveWithin } from '../storage/paths.js';
import type { Binding, ModelRole } from '../providers/types.js';
import { acceptEffect } from '../turns/effects.js';
import {
  channelKey,
  divergenceEffects,
  divergenceTurn,
  quarantineEffects,
  splitChannelKey,
} from './channels.js';
import { listSnapshots, readSnapshot, writeSnapshot } from './snapshots.js';
import {
  appendTurn,
  readAllTurns,
  readTurnAt,
  type SegmentLimits,
  type TurnLocation,
  walkPath,
} from './segments.js';
import type { BranchRef, ChannelEffect, ChannelState, SessionFile, Turn } from './types.js';

/**
 * Session storage — [03 §5.5](../../../../docs/design/03-data-model.md),
 * [03 §8.1](../../../../docs/design/03-data-model.md).
 *
 * The library's write path proved a thesis for objects; this is the sessions
 * half of it, and it is deliberately built on the *fixed* pattern rather than
 * beside it — the same per-key write queue, for the same reason. A turn append
 * and a head-snapshot write are a check-then-write sequence, and two of them
 * interleaving is how a head points at a turn that is not there.
 */

/** Serialises writes per session. Unrelated sessions never wait on each other. */
const writes = new KeyedQueue();

/**
 * Runs a task under one session's write lock.
 *
 * Exported because the turn-submission protocol
 * ([P2 §2.10](../../../../docs/design/workplan/08-p2-implementation.md)) runs *under the session's
 * keyed write queue* by name: it re-reads the head, decides, and reserves in a
 * sequence that means nothing if another writer can land between the read and
 * the decision. Sharing this queue is what makes "the head I checked" and "the
 * head I wrote against" the same head.
 *
 * **The lock is not reentrant**, so anything called from inside a task must be
 * an `…Locked` function rather than the public wrapper — which is why the pair
 * below is split the way it is.
 */
export function withSessionLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  return writes.run(`session:${sessionId}`, task);
}

export interface SessionContext {
  layout: Layout;
  /**
   * The index, written synchronously by this store's own writes.
   *
   * The same rule the library follows ([03 §5.1.1]): the server indexes what it
   * writes as it writes it, so a read straight after a write reflects it. Not
   * optional, because an optional index is one that a caller forgets and then
   * cannot explain why search is empty.
   */
  index: DatabaseSync;
  /** Which scope the sessions belong to — `user:<handle>`, for the index rows. */
  scope?: (handle: string) => string;
  /** Test seam; production uses the defaults. */
  limits?: SegmentLimits;
  /**
   * How many turns of depth a reconstruction may replay before leaving a
   * snapshot behind — `sessions.snapshotEveryNTurns`, [P6.0d].
   *
   * **A function, so the value cannot be captured.** The key is tiered `live`
   * ([21 §4]), and `applyLiveConfig` assigns into the config object rather than
   * replacing it — so a number read at construction would make this key's row
   * in `LIVE_APPLIERS` say `applied` and be a lie, which is the exact failure
   * that table exists to prevent and what `routes/live-config.test.ts` was
   * written for. Absent in a store-only test, where the default stands.
   */
  snapshotEvery?: () => number;
}

function scopeOf(context: SessionContext, handle: string): string {
  return (context.scope ?? ((each: string) => `user:${each}`))(handle);
}

export function sessionRoot(layout: Layout, handle: string, sessionId: string): string {
  return layout.sessionRoot(handle, sessionId);
}

function sessionFilePath(layout: Layout, handle: string, sessionId: string): string {
  return resolveWithin(sessionRoot(layout, handle, sessionId), 'session.json');
}

function turnsRoot(layout: Layout, handle: string, sessionId: string): string {
  return resolveWithin(sessionRoot(layout, handle, sessionId), 'turns');
}

/**
 * What a session is created as — [06 §1].
 *
 * The mode and its preset are decided once, at creation, because a session that
 * changed mode mid-story would have to answer what its existing turns meant.
 * The cast can change later; the preset cannot, because it is a **copy** and
 * swapping it would silently rewrite how the whole session assembles.
 */
export interface NewSession {
  /**
   * Optional, and stored as `''` when it is not given.
   *
   * **Not an optional field on `SessionFile`**, which is the tempting next
   * step and would be a mistake: the index column is `name text not null` in a
   * `strict` table, so `undefined` on that bind throws from *inside* a write
   * lock, after the file has already been written. Keeping the stored type
   * non-optional is what makes the compiler keep proving the column can be
   * filled, at every writer that reindexes.
   *
   * It also costs nothing to give up. The only distinction optionality would
   * buy is *never named* versus *named and then emptied*, and nothing consumes
   * it — the deferred derive-a-name feature ([25 E13]) has to treat both as
   * blank, or clearing a name would permanently disable derivation for that
   * session.
   */
  name?: string;
  mode?: { id: string; config: unknown };
  /** Copied in whole. [03 §8]: the session owns its prompt pack from here on. */
  preset?: Preset;
  cast?: { persona: string | null; actors: string[] };
  /** Links, not copies — [P5.6], and see `SessionFile` for why. */
  treatment?: string | null;
  lore?: string[];
  /**
   * The mode's wizard, answered — [P7.4]. Validated at the route, against the
   * declaration it came from, because that is where the mode is resolved.
   */
  setup?: Record<string, unknown>;
}

export async function createSession(
  context: SessionContext,
  handle: string,
  options: NewSession | string,
): Promise<SessionFile> {
  // A bare name is still accepted, because most callers have nothing else to
  // say and a required options object would be ceremony at every call site.
  const spec: NewSession = typeof options === 'string' ? { name: options } : options;
  const now = new Date().toISOString();
  const session: SessionFile = {
    schema: 'storyengine.session/1',
    id: uuidv7(),
    name: spec.name ?? '',
    createdAt: now,
    updatedAt: now,
    headTurnId: null,
    channels: {},
    ...(spec.mode === undefined ? {} : { mode: spec.mode }),
    ...(spec.preset === undefined ? {} : { preset: spec.preset }),
    ...(spec.cast === undefined ? {} : { cast: spec.cast }),
    ...(spec.setup === undefined ? {} : { setup: spec.setup }),
    ...(spec.treatment === undefined ? {} : { treatment: spec.treatment }),
    ...(spec.lore === undefined ? {} : { lore: spec.lore }),
  };

  const root = sessionRoot(context.layout, handle, session.id);
  await ensureDirectory(root);
  await context.layout.assertReal(root);
  await writeJsonAtomic(sessionFilePath(context.layout, handle, session.id), session);
  indexSession(context.index, scopeOf(context, handle), session);

  return session;
}

export async function readSession(
  context: SessionContext,
  handle: string,
  sessionId: string,
): Promise<SessionFile | null> {
  const path = sessionFilePath(context.layout, handle, sessionId);
  await context.layout.assertReal(path);

  const bytes = await readFileBytes(path);
  if (bytes === null) return null;

  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== 'object' || value === null) return null;
    const session = value as SessionFile;
    return typeof session.id === 'string' ? session : null;
  } catch {
    return null;
  }
}

export async function listSessions(context: SessionContext, handle: string): Promise<string[]> {
  return listDirectoryNames(context.layout.sessionsRoot(handle));
}

/**
 * The sessions themselves, archived ones hidden unless asked for.
 *
 * A folder that is not a readable session is skipped rather than fatal — the
 * same posture the library takes to a file it cannot parse, and for the same
 * reason: one bad folder must not make somebody's session list unopenable.
 */
export async function listSessionFiles(
  context: SessionContext,
  handle: string,
  options: { includeArchived?: boolean } = {},
): Promise<SessionFile[]> {
  const found: SessionFile[] = [];
  for (const id of await listSessions(context, handle)) {
    const session = await readSession(context, handle, id);
    if (session === null) continue;
    if (session.archivedAt !== undefined && options.includeArchived !== true) continue;
    found.push(session);
  }
  return found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Changes who is in a session — [06 §7.2].
 *
 * Separate from create because a cast is the one part of a session's
 * configuration that legitimately changes mid-story: somebody joins the scene.
 * The mode and the preset do not, for the reasons `NewSession` gives.
 */
export async function setCast(
  context: SessionContext,
  handle: string,
  sessionId: string,
  cast: { persona: string | null; actors: string[] },
): Promise<SessionFile | null> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return null;

    const next: SessionFile = { ...session, updatedAt: new Date().toISOString(), cast };
    await writeJsonAtomic(sessionFilePath(context.layout, handle, sessionId), next);
    indexSession(context.index, scopeOf(context, handle), next);
    return next;
  });
}

/**
 * Archives or unarchives a session — [03 §10.3](../../../../docs/design/03-data-model.md).
 *
 * *Hidden from the default list, fully intact, restorable, never swept.* All
 * four of those are properties of doing nothing except setting a field, which is
 * why it is a field.
 */
export async function setArchived(
  context: SessionContext,
  handle: string,
  sessionId: string,
  archived: boolean,
): Promise<SessionFile | null> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return null;

    const { archivedAt: wasArchived, ...rest } = session;
    void wasArchived;
    const next: SessionFile = {
      ...rest,
      updatedAt: new Date().toISOString(),
      ...(archived ? { archivedAt: new Date().toISOString() } : {}),
    };
    await writeJsonAtomic(sessionFilePath(context.layout, handle, sessionId), next);
    indexSession(context.index, scopeOf(context, handle), next);
    return next;
  });
}

/**
 * Renames a session — [03 §8](../../../../docs/design/03-data-model.md).
 *
 * One JSON write and one index upsert, because that is genuinely all a session
 * name is. Nothing resolves a session by it: the folder is the uuidv7, and
 * `resolveFreeSlug` — which freezes a library object's folder against its name
 * at creation — is never called for a session. So unlike a library object,
 * whose folder keeps the name it was born with, a session carries no record of
 * what it used to be called and needs none.
 *
 * **The `indexSession` line is the one that fails silently if it is dropped.**
 * `session.name` is denormalised into the index, so without it the file would
 * be right, the list would be right, and only search would disagree — which
 * nobody notices until they search. It is why `sessions.test.ts` reindexes a
 * renamed session and compares a rebuild-from-disk against the incremental
 * index rather than trusting the returned object.
 *
 * An empty name is allowed, and is the same state a session starts in.
 */
export async function setName(
  context: SessionContext,
  handle: string,
  sessionId: string,
  name: string,
): Promise<SessionFile | null> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return null;

    const next: SessionFile = { ...session, updatedAt: new Date().toISOString(), name };
    await writeJsonAtomic(sessionFilePath(context.layout, handle, sessionId), next);
    indexSession(context.index, scopeOf(context, handle), next);
    return next;
  });
}

/**
 * Deletes a session by **moving its folder to the user's trash**.
 *
 * [03 §10.3](../../../../docs/design/03-data-model.md) is explicit that a session is a folder
 * too and that §10.2 covers it unchanged — so this is the library's delete, not
 * a second mechanism. That is F7's lesson applied rather than re-learned: the
 * finding was a hard delete that took an object's history with it, and a
 * session's turns *are* its history. An erasure here would be the same bug in a
 * kind that has more to lose.
 *
 * Deletion is a move, so restore is a move back; the retention sweep and the
 * restore surface are P11's, and nothing is unrecoverable in the meantime.
 *
 * **It does not reach into other sessions.** An actor this session promoted to
 * the library, or a cross-session memory it wrote, stays — those are separate
 * objects that the library owns, and removing them because their origin was
 * deleted would be a far worse surprise than leaving them (§10.3).
 */
export async function deleteSession(
  context: SessionContext,
  handle: string,
  sessionId: string,
): Promise<boolean> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return false;

    const root = sessionRoot(context.layout, handle, sessionId);
    await context.layout.assertReal(root);
    // The suffix is what keeps delete-recreate-delete from colliding in the
    // trash, exactly as it does for library objects.
    await moveTree(root, context.layout.sessionTrashDestination(handle, sessionId, uuidv7()));
    // The index treats a trashed session as absent, exactly as it does a
    // trashed object ([03 §10.2]) — it does not appear in a list and does not
    // match a search. Restoring re-indexes it.
    removeSessionRows(context.index, sessionId);
    return true;
  });
}

/**
 * Appends a turn and advances the head.
 *
 * The order is deliberate and matches the library's: **write the durable thing
 * first, then the derived one.** A turn that is on disk with a head that has not
 * caught up is a recoverable state — the head is a snapshot and can be
 * recomputed. The reverse is a head pointing at a turn nobody wrote.
 */
export async function appendTurnToSession(
  context: SessionContext,
  handle: string,
  sessionId: string,
  turn: Turn,
): Promise<{ location: TurnLocation; session: SessionFile }> {
  return withSessionLock(sessionId, () => appendTurnLocked(context, handle, sessionId, turn));
}

/**
 * The body of the append, for a caller that already holds the session lock.
 *
 * **It is the two halves below, composed** — which is the point rather than an
 * implementation detail. The commit protocol
 * ([P2 §2.10](../../../../docs/design/workplan/08-p2-implementation.md)) must be able to be
 * interrupted *between* the append and the head advance and resume from either,
 * so the two have to be separately callable. Building the ordinary path out of
 * the same two pieces is what stops the recoverable version from drifting into a
 * second implementation of appending a turn.
 */
export async function appendTurnLocked(
  context: SessionContext,
  handle: string,
  sessionId: string,
  turn: Turn,
): Promise<{ location: TurnLocation; session: SessionFile }> {
  const location = await appendTurnOnly(context, handle, sessionId, turn);
  const session = await advanceHead(context, handle, sessionId, turn);
  if (session === null) throw new Error(`No session with id ${sessionId}.`);
  return { location, session };
}

/**
 * Writes the turn to a segment and touches nothing else.
 *
 * **The durable thing before the derived one**, which is the same order the
 * library's write path uses and for the same reason: a turn on disk with a head
 * that has not caught up is recoverable, because the head is a snapshot. A head
 * pointing at a turn nobody wrote is not.
 */
export async function appendTurnOnly(
  context: SessionContext,
  handle: string,
  sessionId: string,
  turn: Turn,
): Promise<TurnLocation> {
  const root = turnsRoot(context.layout, handle, sessionId);
  await context.layout.assertReal(root);
  const location = await appendTurn(root, turn, context.limits);
  indexTurn(context.index, turn, location);
  return location;
}

/**
 * Points the head at a turn that is already on disk, applying its effects.
 *
 * Idempotent by construction: it *sets* rather than advances, and the channel
 * map is recomputed from the turn's effects rather than mutated by them, so
 * running it twice produces the state it produced the first time. That is what
 * makes step 3 of the commit protocol safe to resume without knowing whether it
 * already ran.
 *
 * **Still idempotent after [P6.0b], by a slightly different argument.** A second
 * run finds the head already naming this turn, so the parent map is replayed
 * from the log rather than read off the file — and the same effects folded onto
 * the same parent state land on the same map. The resume costs one walk it did
 * not cost before, on a path that runs when a commit was interrupted.
 */
export async function advanceHead(
  context: SessionContext,
  handle: string,
  sessionId: string,
  turn: Turn,
): Promise<SessionFile | null> {
  const session = await readSession(context, handle, sessionId);
  if (session === null) return null;

  /**
   * **The map at the node this turn was appended to, not the map the head
   * happened to hold** — [P6.0b].
   *
   * This read `session.channels` unconditionally, which is correct for the only
   * shape P2 can produce — a child of the head — and wrong for every gesture P6
   * adds: append a sibling and the new state is the *abandoned* line's, plus
   * this turn's effects. It was unreachable while `submitTurn`'s head-equality
   * refusal held, and it is fixed here with that refusal still in place, so the
   * diff is a fix rather than a fix and a feature at once.
   *
   * **A clock-only fixture cannot see the difference**, which is why this went
   * five phases without being noticed: a whole-value set lands on the same
   * number whichever map it folds onto. What shows it is a key the abandoned
   * line wrote and this one never did.
   *
   * The head case still costs no read at all — the ordinary commit is as cheap
   * as it was — and the walk is paid only by an append that is genuinely off
   * the head. Making *that* cheap is P6.0d's snapshot cache.
   */
  let atParent = session.channels;
  if (!snapshotIsAt(session, turn.parentTurnId)) {
    const turns = await readTurns(context, handle, sessionId);
    atParent = await reconstructAlong(
      context,
      handle,
      sessionId,
      walkPath(turns, turn.parentTurnId),
    );
    await snapshotFork(context, handle, sessionId, turns, turn, atParent);
  }

  const next: SessionFile = {
    ...session,
    updatedAt: new Date().toISOString(),
    headTurnId: turn.id,
    channels: applyEffects(atParent, turn.effects),
  };
  await writeJsonAtomic(sessionFilePath(context.layout, handle, sessionId), next);
  indexSession(context.index, scopeOf(context, handle), next);
  return next;
}

/**
 * Every node's children, by parent id — [P6.1].
 *
 * **Extracted from `reconcileSession` rather than written a second time.** That
 * function has built this map since P2 to decide whether a session's head can
 * be walked forward, and it refuses to guess at a node with two children; the
 * navigation this phase adds asks the same question of the same shape, and two
 * copies would be two places for *what counts as a fork* to drift.
 *
 * `null` keys the roots. Order within a parent is the map's insertion order,
 * which is the order the turns were read — creation order, since a segment is
 * append-only ([03 §5.5]). That is the order siblings should be offered in.
 */
export function childrenByParent(turns: Map<string, Turn>): Map<string | null, Turn[]> {
  const byParent = new Map<string | null, Turn[]>();
  for (const turn of turns.values()) {
    const siblings = byParent.get(turn.parentTurnId) ?? [];
    siblings.push(turn);
    byParent.set(turn.parentTurnId, siblings);
  }
  return byParent;
}

/**
 * Where *forward* goes from a node — [07 §3]'s
 * *"navigating back and then forward again resumes where you were rather than
 * guessing"*.
 *
 * Two rules, and the second one is the one that keeps the promise:
 *
 * - **What was selected**, from `lastSelectedChild`. A head move records the
 *   whole path it moved to, so every node on the line somebody left remembers
 *   which way they went.
 * - **The only child**, when a node has exactly one. That is not guessing —
 *   there is nothing to guess between — and it is what makes forward work on a
 *   session that has never branched, whose map is empty.
 *
 * It stops at a node with two or more children that the map does not name,
 * which is `reconcileSession`'s rule for the identical situation: *a session
 * with two children of the head is a branch, and guessing there would silently
 * pick somebody's story for them.*
 *
 * A remembered child that is missing, tombstoned or not actually a child of the
 * node stops the walk too — the map is written by this server and edited by
 * whoever opens the file, and a name that no longer resolves is a stale note
 * rather than an error.
 */
export function resumeFrom(
  session: SessionFile,
  turns: Map<string, Turn>,
  fromTurnId: string,
): string {
  const children = childrenByParent(turns);
  const remembered = session.lastSelectedChild ?? {};

  let at = fromTurnId;
  // A hand-edited map can name a cycle, and walking one forever is the single
  // outcome worse than stopping early.
  const seen = new Set<string>([at]);

  for (;;) {
    const here = children.get(at) ?? [];
    const named = remembered[at];
    const next =
      named !== undefined && here.some((child) => child.id === named)
        ? named
        : here.length === 1
          ? here[0]?.id
          : undefined;

    if (next === undefined || seen.has(next)) return at;
    seen.add(next);
    at = next;
  }
}

/** What moving the head can answer — [P6.1]. */
/**
 * What moving the head leaves behind — [07 §7]'s honesty banner, [§1.5],
 * [P6.3].
 *
 * **Reversibility holds for channel state and not for what left the session.**
 * A library write, a generated asset, a message an extension sent: branching
 * cannot un-write those, and effects carry `scope: 'escaped'` so that a line
 * somebody abandons can *say* how many of them it still has out in the world
 * rather than implying they went with it.
 *
 * Counted over the turns that are on the old path and not on the new one, which
 * is the honest definition of *abandoned*: everything before the fork is shared
 * by construction and is not going anywhere.
 *
 * **Nothing writes an escaped effect yet**, and that is recorded rather than
 * hidden: `acceptEffect` hard-codes `'session'`, so `escaped` is a count that
 * is always zero until something produces one. [P6 §0.2] identifies the first
 * producer as P8's memory extraction — memory books are ordinary library
 * lorebooks, so every extraction is exactly the *lorebook entry promoted to the
 * shared library* [07 §7] classifies as escaped. The count is here because the
 * alternative is P8 shipping a producer with nowhere for it to surface.
 */
function abandonedBy(
  from: readonly Turn[],
  to: readonly Turn[],
): { turns: number; escapedEffects: number } {
  const joining = new Set(to.map((turn) => turn.id));
  const left = from.filter((turn) => !joining.has(turn.id));
  let escapedEffects = 0;
  for (const turn of left) {
    for (const effect of turn.effects) {
      if (effect.scope === 'escaped') escapedEffects += 1;
    }
  }
  return { turns: left.length, escapedEffects };
}

export type MoveHeadOutcome =
  | {
      kind: 'moved';
      session: SessionFile;
      /** What the old line still has out in the world — [07 §7], [P6.3]. */
      abandoned: { turns: number; escapedEffects: number };
    }
  | { kind: 'no-session' }
  | { kind: 'no-turn' };

/**
 * Points the head at any node, and re-derives the channel state there — [P6.1].
 *
 * **The first consumer of [P6.0b]**, and where a regression in it would show.
 * `advanceHead` folds one turn's effects onto the map at its parent, which is
 * right for appending and meaningless here: this head did not arrive by a turn
 * being taken. So the state is reconstructed at the node through the cache
 * ([P6.0d]), which is the same answer `replayChannels(walkPath(...))` gives and
 * the property test says so at every index.
 *
 * **Moving the head moves no turn data**, which is the whole point of the tree
 * model: every node on both lines is where it was, and the only writes are this
 * file's `headTurnId`, its channel snapshot, and the path this move selects.
 *
 * `resume` is the forward gesture — see {@link resumeFrom}. Without it the head
 * lands exactly where it was told.
 */
export async function moveHead(
  context: SessionContext,
  handle: string,
  sessionId: string,
  turnId: string,
  options: { resume?: boolean } = {},
): Promise<MoveHeadOutcome> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return { kind: 'no-session' };

    const turns = await readTurns(context, handle, sessionId);
    // Scoped to this session by the read itself, so a bare turn id from another
    // one cannot move this head — the same boundary `GET /turns/:turnId` keeps.
    if (!turns.has(turnId)) return { kind: 'no-turn' };

    const target = options.resume === true ? resumeFrom(session, turns, turnId) : turnId;
    const path = walkPath(turns, target);

    /**
     * The path is remembered, not just the tip.
     *
     * Recording only the new head's parent would answer *forward* for one node
     * and lose it for every ancestor, so walking back twice and forward twice
     * would resume once and then guess. Entries for nodes off this path are
     * left alone, which is what makes the line somebody abandoned still
     * remember its own continuation when they come back to it.
     */
    const lastSelectedChild = { ...(session.lastSelectedChild ?? {}) };
    for (const [at, turn] of path.entries()) {
      const parent = path[at - 1];
      if (parent !== undefined) lastSelectedChild[parent.id] = turn.id;
    }

    const next: SessionFile = {
      ...session,
      updatedAt: new Date().toISOString(),
      headTurnId: target,
      channels: await reconstructAlong(context, handle, sessionId, path),
      lastSelectedChild,
    };
    await writeJsonAtomic(sessionFilePath(context.layout, handle, sessionId), next);
    indexSession(context.index, scopeOf(context, handle), next);
    return {
      kind: 'moved',
      session: next,
      abandoned: abandonedBy(walkPath(turns, session.headTurnId), path),
    };
  });
}

/** What a branch-ref write can answer — [P6.1]. */
export type BranchRefOutcome =
  | { kind: 'written'; session: SessionFile }
  | { kind: 'no-session' }
  | { kind: 'no-turn' }
  | { kind: 'no-ref' };

/**
 * Writes the session file with a new set of refs, under the lock.
 *
 * The three gestures below differ only in how they compute that set, and every
 * one of them writes **names** — no turn is read, moved, or written by any of
 * them, which is [07 §6]'s *promoting a swipe writes about fifty bytes and
 * moves no data* stated as code.
 */
async function withBranchRefs(
  context: SessionContext,
  handle: string,
  sessionId: string,
  change: (session: SessionFile, turns: Map<string, Turn>) => BranchRef[] | BranchRefOutcome,
): Promise<BranchRefOutcome> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return { kind: 'no-session' };

    const turns = await readTurns(context, handle, sessionId);
    const changed = change(session, turns);
    if (!Array.isArray(changed)) return changed;

    const next: SessionFile = {
      ...session,
      updatedAt: new Date().toISOString(),
      branchRefs: changed,
    };
    await writeJsonAtomic(sessionFilePath(context.layout, handle, sessionId), next);
    indexSession(context.index, scopeOf(context, handle), next);
    return { kind: 'written', session: next };
  });
}

/** Names a node — [07 §6]'s *promote*. */
export async function createBranchRef(
  context: SessionContext,
  handle: string,
  sessionId: string,
  name: string,
  turnId: string,
): Promise<BranchRefOutcome> {
  return withBranchRefs(context, handle, sessionId, (session, turns) => {
    if (!turns.has(turnId)) return { kind: 'no-turn' };
    const ref: BranchRef = { id: uuidv7(), name, headTurnId: turnId };
    return [...(session.branchRefs ?? []), ref];
  });
}

/** Renames one. The node it points at is not this gesture's business. */
export async function renameBranchRef(
  context: SessionContext,
  handle: string,
  sessionId: string,
  refId: string,
  name: string,
): Promise<BranchRefOutcome> {
  return withBranchRefs(context, handle, sessionId, (session) => {
    const refs = session.branchRefs ?? [];
    if (!refs.some((ref) => ref.id === refId)) return { kind: 'no-ref' };
    return refs.map((ref) => (ref.id === refId ? { ...ref, name } : ref));
  });
}

/**
 * Forgets a name.
 *
 * **Deleting a ref deletes a name**, and the turns it pointed at are exactly
 * where they were — reachable by id, by a walk from anything below them, and by
 * any other ref. There is no cascade here because there is nothing to cascade
 * to: a ref owns nothing.
 */
export async function deleteBranchRef(
  context: SessionContext,
  handle: string,
  sessionId: string,
  refId: string,
): Promise<BranchRefOutcome> {
  return withBranchRefs(context, handle, sessionId, (session) => {
    const refs = session.branchRefs ?? [];
    if (!refs.some((ref) => ref.id === refId)) return { kind: 'no-ref' };
    return refs.filter((ref) => ref.id !== refId);
  });
}

/** What an undo can answer — [§1.4], [21 §1.2.1], [P6.3]. */
export type UndoOutcome =
  | { kind: 'undone'; session: SessionFile; turn: Turn }
  | { kind: 'no-session' }
  | { kind: 'no-turn' }
  /** On disk, but not on the line the head is on. */
  | { kind: 'off-path' }
  /** Nothing this turn wrote can be inverted — see the kinds below. */
  | { kind: 'nothing-to-undo' }
  /**
   * Something wrote those keys after it, so `before` is not an inverse.
   * `branchFrom` is the node to branch from instead — the refusal's whole
   * point is that it can offer one.
   */
  | { kind: 'not-at-tip'; keys: string[]; branchFrom: string | null };

/**
 * Undoes a turn's effects by applying their `before` — [§1.4],
 * [21 §1.2.1](../../../../docs/design/21-internal-contracts.md).
 *
 * **`before` is only an inverse while nothing has touched the same key since**,
 * and that sentence is the whole of this function. [21 §1.2.1] corrects an
 * earlier draft that thought otherwise, with the case that makes it plain: HP
 * goes 10 → 8 at turn N and 8 → 5 later; applying turn N's `before: 10` now
 * does not undo turn N, it destroys the later change and produces a state no
 * turn ever wrote. The value is plausible, so nothing surfaces. **Refusing is
 * what converts a silent corruption into an affordance** — and the affordance
 * is the one this phase built: branch from before it and play it differently.
 *
 * **The check reads the log rather than the index.** [21 §1.2.1] says *the
 * index knows the latest effect per path*; this index knows no effects at all,
 * and [P6.1] decided against the column that would have carried a path — a turn
 * is on every path through it, so *latest on the path* is a question about the
 * reader's head rather than a fact about a row. Walking the path from the log is
 * O(depth) against turns already read, which is what everything else here costs.
 *
 * **The undo is an append, not an erasure.** A segment is never rewritten
 * ([03 §5.5]), so the inverse lands as its own turn, attributed to the user, the
 * way a hand edit does ([03 §8.1]). The record then says a person undid
 * something, which is more honest than a history that quietly lacks it — and it
 * is why undoing an undo is an ordinary undo.
 *
 * **Escaped effects are never inverted** ([07 §7]): a library write or a
 * generated asset left the session, and pretending a branch can un-write it
 * would be worse than saying plainly that it cannot.
 */
export async function undoTurn(
  context: SessionContext,
  handle: string,
  sessionId: string,
  turnId: string,
): Promise<UndoOutcome> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return { kind: 'no-session' };

    const turns = await readTurns(context, handle, sessionId);
    if (!turns.has(turnId)) return { kind: 'no-turn' };

    const path = walkPath(turns, session.headTurnId);
    const at = path.findIndex((turn) => turn.id === turnId);
    const subject = path[at];
    // A turn on an abandoned line has no *current* state to be the tip of, and
    // inverting it would write its `before` into a line it was never on.
    if (subject === undefined) return { kind: 'off-path' };

    /**
     * The pre-turn value per key, and the value standing now.
     *
     * **The first `before` and the last `after`**, because `acceptEffect`
     * chains within a turn: a second effect on one key carries the first one's
     * `after` as its `before`, so the earliest is the only one that names the
     * state the turn began from.
     */
    const restore = new Map<string, { was: unknown; now: unknown; effect: ChannelEffect }>();
    for (const effect of subject.effects) {
      if (!effect.applied || effect.scope === 'escaped') continue;
      const key = channelKey(effect.channelId, effect.scopeKey);
      const held = restore.get(key);
      restore.set(key, {
        was: held === undefined ? effect.before : held.was,
        now: effect.after,
        effect,
      });
    }
    if (restore.size === 0) return { kind: 'nothing-to-undo' };

    const later = new Set<string>();
    for (const turn of path.slice(at + 1)) {
      for (const effect of turn.effects) {
        if (!effect.applied || effect.scope === 'escaped') continue;
        later.add(channelKey(effect.channelId, effect.scopeKey));
      }
    }

    const blocked = [...restore.keys()].filter((key) => later.has(key));
    if (blocked.length > 0) {
      return { kind: 'not-at-tip', keys: blocked, branchFrom: subject.parentTurnId };
    }

    const id = uuidv7();
    const effects = [...restore.entries()].map(([, held]) =>
      inverseOf(id, held.effect, held.was, held.now),
    );
    const undone: Turn = {
      id,
      sessionId,
      parentTurnId: session.headTurnId,
      createdAt: new Date().toISOString(),
      status: 'complete',
      effects,
      tape: [],
    };

    await appendTurnOnly(context, handle, sessionId, undone);
    const next = await advanceHead(context, handle, sessionId, undone);
    if (next === null) return { kind: 'no-session' };
    return { kind: 'undone', session: next, turn: undone };
  });
}

/**
 * What a person's write to a channel came to.
 *
 * A value rather than a throw, because the interesting outcome is the one where
 * the engine says no: [06 §4.2]'s recovery is *offered*, and an offer that could
 * fail silently would be worse than none.
 */
export type ChannelWriteOutcome =
  { kind: 'no-session' } | { kind: 'written'; session: SessionFile; effect: ChannelEffect };

/**
 * A person writes a value to one channel — [06 §4.2]'s recovery, [P7.1].
 *
 * **One primitive for all three of the offered recoveries**, which is why it is
 * a write rather than two verbs. 06 §4.2 offers *"retry the migration once the
 * author ships a fix, edit the quarantined value by hand, or accept the
 * reset"*: retry is this with the quarantined raw value, edit is this with
 * whatever the person typed, and accept is this with the value already standing
 * — which clears the `degraded` marker, because `applyEffects` writes one only
 * for an effect that carries a reason.
 *
 * **Through `acceptEffect`, so a retry that still does not fit is refused and
 * recorded** rather than silently reinstating the value that was quarantined in
 * the first place. That is the whole reason recovery is safe to offer: the
 * button cannot put the session back in the state it was rescued from.
 *
 * *A turn with no model call and no tape, the same shape `undoTurn` and
 * `divergenceTurn` write, and for the same reason: [03 §8.1]'s promise is that a
 * change of state is visible in the turn record, and a turn is what the
 * workbench shows.*
 */
export async function writeChannel(
  context: SessionContext,
  handle: string,
  sessionId: string,
  key: string,
  value: unknown,
): Promise<ChannelWriteOutcome> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return { kind: 'no-session' };

    const turns = await readTurns(context, handle, sessionId);
    const running = await reconstructAlong(
      context,
      handle,
      sessionId,
      walkPath(turns, session.headTurnId),
    );

    const id = uuidv7();
    const { channelId, scopeKey } = splitChannelKey(key);
    const effect = acceptEffect(
      id,
      {
        channelId,
        scopeKey,
        op: { type: 'set', path: '/' },
        after: value,
        proposedBy: { kind: 'user' },
      },
      running,
    );

    const turn: Turn = {
      id,
      sessionId,
      parentTurnId: session.headTurnId,
      createdAt: new Date().toISOString(),
      status: 'complete',
      effects: [effect],
      tape: [],
    };

    await appendTurnOnly(context, handle, sessionId, turn);
    const next = await advanceHead(context, handle, sessionId, turn);
    if (next === null) return { kind: 'no-session' };
    return { kind: 'written', session: next, effect };
  });
}

/**
 * One effect's inverse, attributed to the person who asked for it.
 *
 * **A `before` of null becomes a delete rather than a set to null**, and the
 * ambiguity is worth naming: `acceptEffect` stamps `null` both for a key that
 * held null and for one that did not exist, because it reads
 * `running[key]?.value ?? null`. Restoring by *setting* null would leave the key
 * present holding null, which for a timing counter is the difference between
 * *this entry has never fired* and *this entry fired and the record of it is
 * broken*. Deleting is the reading that matches every value the engine actually
 * writes, all of which are objects.
 */
function inverseOf(
  turnId: string,
  effect: ChannelEffect,
  was: unknown,
  now: unknown,
): ChannelEffect {
  return {
    id: uuidv7(),
    turnId,
    channelId: effect.channelId,
    scopeKey: effect.scopeKey,
    op: was === null ? { type: 'delete', path: '/' } : { type: 'set', path: '/' },
    // Honest in both directions, so undoing an undo is an ordinary undo.
    before: now,
    after: was,
    // The person who pressed it, not the engine that computed the original —
    // the same attribution a hand edit gets, and for the same reason.
    proposedBy: { kind: 'user' },
    applied: true,
    rejectedReason: null,
    supersedes: effect.id,
    channelVersion: effect.channelVersion,
    scope: 'session',
  };
}

/**
 * Reconciles a hand-edited `session.json` into the effect log — [03 §8.1].
 *
 * The load-time half of the rule. It replays the channels the log says are true
 * at head, compares them with what the file holds, and — if a person has been in
 * there — appends a turn whose effects carry their edit, attributed to them.
 *
 * **This is why the file may be edited at all.** [10 §4](../../../../docs/design/10-ui-surfaces.md)
 * promises that editing your own data on disk works, and without this it would
 * work for library objects and silently not for sessions: the next head advance
 * would recompute `channels` from the log and the edit would vanish with no
 * error, which is the worst of the three possible behaviours.
 *
 * Returns the effects it recorded — empty when the file and the log agree, which
 * is the ordinary case and costs one replay.
 */
export async function reconcileHandEdits(
  context: SessionContext,
  handle: string,
  sessionId: string,
): Promise<ChannelEffect[]> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return [];

    const turns = await readTurns(context, handle, sessionId);
    /**
     * Through the cache — [P6.0d]. This runs on the outermost session read, so
     * it is the reconstruction a person waits for when they open a session, and
     * the one [07 §4] means by *too slow to feel casual* at turn eight hundred.
     *
     * **It is also the one place a bad snapshot would have a durable
     * consequence**, which is worth naming rather than discovering: a snapshot
     * that disagreed with the fold would read here as a hand edit and be
     * written into the log as a user-attributed effect. What stands between is
     * the property test asserting the two agree at every index, a snapshot that
     * carries its own turn id so a copied or renamed file is refused, and an
     * atomic write so a torn one is never read. [07 §4] says the rest plainly:
     * a snapshot that disagrees with a replay is a bug in the effects.
     */
    const replayed = await reconstructAlong(
      context,
      handle,
      sessionId,
      walkPath(turns, session.headTurnId),
    );

    const diverged = divergenceEffects(session.headTurnId ?? '', replayed, session.channels);

    /**
     * **And the quarantine rung, in the same turn** — [06 §4.2], [P7.1].
     *
     * Over the state *after* the divergence rather than before it, which is the
     * only order that is not wrong twice: quarantining first would re-check a
     * value the user's edit is about to replace, and the edit itself is already
     * schema-checked where it is built. So the sequence is *what the log says*,
     * then *what the person wrote*, then *what still does not fit* — and the
     * last of those is the case neither of the first two covers, a value that
     * was legal when written and is not now.
     *
     * **One turn for both, because they are one event**: a session was opened
     * and the engine reconciled it. Two turns would put a parent link between
     * two halves of a reconciliation nobody performed in two steps.
     */
    const effects = [
      ...diverged,
      ...quarantineEffects(session.headTurnId ?? '', applyEffects(replayed, diverged)),
    ];
    if (effects.length === 0) return [];

    const turn = divergenceTurn(sessionId, session.headTurnId, effects);
    await appendTurnOnly(context, handle, sessionId, turn);
    await advanceHead(context, handle, sessionId, turn);
    return turn.effects;
  });
}

/**
 * Applies a turn's effects to a channel map.
 *
 * Only `applied` effects change anything: a rejected effect is part of the
 * record — the model tried to give itself 40 gold and the engine said no — and
 * replaying it would apply what was refused.
 *
 * `escaped` effects are recorded and never replayed, because a library write or
 * a generated asset is not something a branch can un-write.
 */
export function applyEffects(
  channels: Record<string, ChannelState>,
  effects: readonly ChannelEffect[],
): Record<string, ChannelState> {
  let next = { ...channels };

  for (const effect of effects) {
    if (!effect.applied || effect.scope === 'escaped') continue;

    /**
     * **Through `channelKey`, so a scoped channel has one value per key rather
     * than one value.** This read `effect.channelId` alone, which made
     * `ChannelDefinition.scope`'s `'actor'` and `'entry'` arms vocabulary
     * nothing implemented: two entries' timing states written to one channel
     * overwrote each other, silently, and the branch reconstruction on top
     * inherited whichever landed last. [P5 §0.4] found it and P5.5 is the first
     * stage that needs the answer.
     */
    const key = channelKey(effect.channelId, effect.scopeKey);

    if (effect.op.type === 'delete') {
      // Rebuilt without the key rather than deleted from: the map is a value
      // here, and a channel that was removed on one branch must not disappear
      // from a map another branch is still replaying against.
      const { [key]: removed, ...rest } = next;
      void removed;
      next = rest;
      continue;
    }

    next[key] = {
      version: effect.channelVersion,
      value: effect.after,
      /**
       * **`degraded`'s first writer** — [06 §4.2], [P7.1]. `ChannelState` has
       * carried this field since P3.0 with a docstring saying *"the writer
       * arrives with the first `ChannelDefinition.schema`"*, and that schema
       * arrived this stage.
       *
       * Composed from the effect rather than copied: the effect carries a
       * reason, and `before` *is* the raw value it is a reason about. Spreading
       * conditionally so an ordinary effect writes no key at all — a state
       * carrying `degraded: undefined` and one carrying nothing serialise
       * differently, and `divergenceEffects` compares serialised values.
       */
      ...(effect.degraded === undefined
        ? {}
        : { degraded: { reason: effect.degraded.reason, raw: effect.before } }),
    };
  }

  return next;
}

/**
 * The channel state at a turn, replayed from zero.
 *
 * P2 has no snapshot *cache* — that is P6's, and it is an optimisation rather
 * than a mechanism ([07 §4](../../../../docs/design/07-branching.md)). What
 * matters now is that the head in `session.json` is **derived**: this function
 * is the thing it is derived from, and deleting the file must cost a
 * recomputation and nothing else.
 */
export function replayChannels(path: readonly Turn[]): Record<string, ChannelState> {
  let channels: Record<string, ChannelState> = {};
  for (const turn of path) {
    channels = applyEffects(channels, turn.effects);
  }
  return channels;
}

/**
 * How many turns a reconstruction may replay before leaving a snapshot behind.
 *
 * The schema already says integer-and-at-least-one (`config.ts`), so the guard
 * below is for this store's own callers rather than for a settings save: a
 * closure returning zero would otherwise write a snapshot per turn through a
 * modulo by zero, and the failure would read as a cache bug rather than as a
 * bad argument.
 */
const DEFAULT_SNAPSHOT_EVERY = 10;

function snapshotInterval(context: SessionContext): number {
  const every = context.snapshotEvery?.() ?? DEFAULT_SNAPSHOT_EVERY;
  return Number.isInteger(every) && every > 0 ? every : DEFAULT_SNAPSHOT_EVERY;
}

/**
 * The channel state at the end of a path, through the snapshot cache —
 * [07 §4](../../../../docs/design/07-branching.md), [P6.0d].
 *
 * *Walk up to the nearest ancestor holding a snapshot, replay effects forward
 * along the path.* The walk is the caller's, because every caller has already
 * done one; what this adds is the two ends — where to start, and what to leave
 * behind.
 *
 * **It must return exactly what `replayChannels` would**, and that is a
 * property this phase asserts rather than a hope it holds:
 * `reconstruct-property.test.ts` compares the two at every node of a forked
 * session, with the cache warm and again with every snapshot deleted. [07 §4]
 * asks CI for precisely that, and it is why a cache is allowed on this path.
 *
 * **Snapshots are written while folding forward, every N turns of the replayed
 * suffix** — not at fixed depths. Nothing depends on *which* nodes have one, so
 * the useful rule is the one that bounds the work: after this returns, no node
 * it replayed through is more than N turns from a snapshot, and the next
 * reconstruction on this line replays at most N. One slow reconstruction of a
 * long line therefore leaves the whole line cached, which is what makes a
 * property test that reconstructs at *every* node affordable.
 *
 * **A miss is only ever slower.** An unreadable snapshot, an id no path can
 * name, a directory somebody deleted — each is a miss, and the fold behind it
 * is still the truth.
 */
export async function reconstructAlong(
  context: SessionContext,
  handle: string,
  sessionId: string,
  path: readonly Turn[],
): Promise<Record<string, ChannelState>> {
  if (path.length === 0) return {};

  const available = await listSnapshots(context.layout, handle, sessionId);

  let channels: Record<string, ChannelState> = {};
  let start = 0;
  // From the tip back, so the first hit is the deepest — the least to replay.
  for (let at = path.length - 1; at >= 0; at -= 1) {
    const turn = path[at];
    if (turn === undefined || !available.has(turn.id)) continue;
    const held = await readSnapshot(context.layout, handle, sessionId, turn.id);
    // A listed file that will not read is a miss rather than an error, so the
    // scan carries on to the next-deepest rather than falling all the way to
    // zero because of one bad file.
    if (held === null) continue;
    channels = held;
    start = at + 1;
    break;
  }

  const every = snapshotInterval(context);
  let replayed = 0;
  for (const turn of path.slice(start)) {
    channels = applyEffects(channels, turn.effects);
    replayed += 1;
    if (replayed % every === 0) {
      await writeSnapshot(context.layout, handle, sessionId, turn.id, channels);
    }
  }

  return channels;
}

/**
 * A snapshot at a node that has just acquired a second child — [07 §4]'s other
 * trigger, and the cheap one: a node with several children is a node whose
 * state will be materialised once per sibling explored.
 *
 * **Free where it is called.** `advanceHead` has already read the turns and
 * already computed the parent's map to fold onto, so the whole added cost is
 * counting that parent's children in a map it is holding.
 *
 * **Today a branch append is the only way a node acquires a second child**,
 * which is worth stating because it will stop being true. A second child means
 * two turns naming one parent, and the second of those cannot be a child of the
 * head unless the head moved backwards first — and moving the head backwards is
 * P6.1's work. When it lands, the head path in `advanceHead` needs this too.
 */
async function snapshotFork(
  context: SessionContext,
  handle: string,
  sessionId: string,
  turns: Map<string, Turn>,
  turn: Turn,
  atParent: Record<string, ChannelState>,
): Promise<void> {
  const parentTurnId = turn.parentTurnId;
  if (parentTurnId === null) return;

  let siblings = 0;
  for (const other of turns.values()) {
    if (other.parentTurnId === parentTurnId && other.id !== turn.id) siblings += 1;
  }
  if (siblings === 0) return;

  await writeSnapshot(context.layout, handle, sessionId, parentTurnId, atParent);
}

/**
 * Whether `session.channels` is the state at this node — [P6.0b].
 *
 * **It is the state at the head, and at no other node.** `SessionFile` says so
 * of itself — *"state at `headTurnId`. Derived."* ([03 §8.1]) — and until this
 * stage nothing enforced it: two readers took the file's map whenever the file
 * was there, which pairs one line's history with another line's state the
 * moment anything asks for a node that is not the head. The symptom used to be
 * a wrong clock, one visibly bogus number. Since P5 it is also wrong **lore** —
 * an entry sticky on a line that never fired it, an `ephemeral` spent by a turn
 * that is not in this history — which changes the prose the model is given
 * rather than a field on the screen.
 *
 * **The fast path is sound because `advanceHead` maintains it**, and the two
 * belong together: the head snapshot is that turn's effects folded onto its own
 * parent's map, so it equals `replayChannels(walkPath(turns, head))` by
 * construction rather than by luck.
 *
 * **The one legitimate divergence is a hand edit, and preferring the file there
 * is deliberate.** A person who opens `session.json` has expressed an intent,
 * and `reconcileHandEdits` calls recomputing over the top of it *"the worst of
 * the three possible behaviours"* — the read route folds the edit into the log
 * as a user-attributed effect rather than this path discarding it.
 *
 * A type predicate, so a caller's `session.channels` narrows without an
 * assertion. A null session — an unreadable or missing file — is the state at
 * nothing.
 */
export function snapshotIsAt(
  session: SessionFile | null,
  nodeId: string | null,
): session is SessionFile {
  return session !== null && (session.headTurnId ?? null) === (nodeId ?? null);
}

/**
 * Every turn on disk for a session, by id.
 *
 * The cold read. P2.3's index rows make the hot path cheap; this is what a
 * rebuild — or a deleted index — falls back to, and it is why deleting the
 * index stays a non-event for sessions as well as for the library.
 */
export async function readTurns(
  context: SessionContext,
  handle: string,
  sessionId: string,
): Promise<Map<string, Turn>> {
  const root = turnsRoot(context.layout, handle, sessionId);
  const found = await readAllTurns(root);
  return new Map(found.map(({ turn }) => [turn.id, turn]));
}

/**
 * One turn by id, without the transcript riding along — [P3.0]. `GET /turns`
 * costs about 10.8 KB a turn and the whole path per request; the panel wants
 * one turn, and this is the location index finally doing the job its header
 * promised.
 *
 * **Index hit first, cold read second, and the fallback is required rather
 * than defensive** ([21 §5]): the index is derived, deleting it is a
 * non-event, and a route that 404'd on a missing row would make it
 * load-bearing. **The ownership boundary is structural**: the location is
 * only ever resolved under the *requested* session's own turns directory, so
 * a cross-session turn id cannot read across it — the sessionId and owner
 * comparisons below merely skip a read that cannot succeed. What carries the
 * correctness is the id-match on the line read back: two sessions' first
 * turns share `{000001.jsonl, offset 0}`, so an unchecked hit would serve
 * the wrong session's turn under the requested id — and a stale row after a
 * hand-edited segment has the same shape. Both fall through to the cold
 * read. A tombstone reads as absent on both paths — `readAllTurns` skips
 * them and `readTurnAt` does not, so the guard lives here.
 */
export async function readTurnById(
  context: SessionContext,
  handle: string,
  sessionId: string,
  turnId: string,
): Promise<Turn | null> {
  const root = turnsRoot(context.layout, handle, sessionId);

  const located = findTurnLocation(context.index, turnId);
  if (
    located !== null &&
    located.sessionId === sessionId &&
    located.owner === scopeOf(context, handle)
  ) {
    const turn = await readTurnAt(root, { segment: located.segment, offset: located.offset });
    if (turn !== null && turn.id === turnId) {
      return turn.removed === true ? null : turn;
    }
  }

  const turn = (await readTurns(context, handle, sessionId)).get(turnId) ?? null;
  return turn?.removed === true ? null : turn;
}

/**
 * Which model this session uses for a role, and for one step — [19 §5.1],
 * [P7 §1.9], built at [P7.3].
 *
 * **A whole replacement rather than a merge**, which is the same choice
 * {@link setLore} makes and for the same reason: a partial update cannot express
 * *clear this override*, and clearing one is the commoner act of the two. A
 * caller sends what it wants to hold.
 *
 * *Unvalidated against the account's connections, deliberately.* A binding
 * naming a connection that has since been removed resolves as `dangling`, which
 * `resolveRole` already distinguishes from `unbound` because *"the remedies
 * differ — the first is setup, the second is an admin having removed a
 * connection out from under a binding"*. Refusing the write here would trade a
 * diagnosable state for a rejected request, and [00 §3.3] takes the other side
 * of that everywhere else.
 */
export async function setSessionRoles(
  context: SessionContext,
  handle: string,
  sessionId: string,
  overrides: { roles: Partial<Record<ModelRole, Binding>>; stepRoles: Record<string, Binding> },
): Promise<SessionFile | null> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return null;

    const next: SessionFile = {
      ...session,
      updatedAt: new Date().toISOString(),
      roles: overrides.roles,
      stepRoles: overrides.stepRoles,
    };
    await writeJsonAtomic(sessionFilePath(context.layout, handle, sessionId), next);
    indexSession(context.index, scopeOf(context, handle), next);
    return next;
  });
}

/**
 * Sets which treatment and which lorebooks a session plays with.
 *
 * **The sibling of {@link setCast}, and it exists for the reason that rule
 * created.** Selection is the only way a lorebook reaches a session — a book
 * does not volunteer, whatever its own `scope` says — so without a way to
 * change the selection after creation, a session started without naming books
 * could never gain a world, and every session that predates the field would be
 * stuck without one for good.
 *
 * Links rather than copies, exactly as the cast is ([03 §8]): fixing a typo in
 * a lorebook should reach the story being told in it.
 */
export async function setLore(
  context: SessionContext,
  handle: string,
  sessionId: string,
  lore: { treatment: string | null; lore: string[] },
): Promise<SessionFile | null> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(context, handle, sessionId);
    if (session === null) return null;

    const next: SessionFile = {
      ...session,
      updatedAt: new Date().toISOString(),
      treatment: lore.treatment,
      lore: lore.lore,
    };
    await writeJsonAtomic(sessionFilePath(context.layout, handle, sessionId), next);
    indexSession(context.index, scopeOf(context, handle), next);
    return next;
  });
}
