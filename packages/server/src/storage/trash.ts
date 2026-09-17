// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { LIBRARY_DIRECTORIES, type PortableSchemaId } from '@storyengine/shared';

import type { Layout } from './layout.js';
import { moveTree } from './files.js';

/**
 * ***The retention window, swept*** —
 * [03 §10.2](../../../../docs/design/03-data-model.md),
 * [P2 §2.11](../../../../docs/design/workplan/08-p2-implementation.md)'s F7
 * second half, [P11.7](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **Deleting has been a move since P4.4 and nothing has ever swept.**
 * `trash.retentionDays` defaults to thirty and `config.ts` says so outright —
 * *"the maturation sweep does not read it; trash retention is not
 * implemented"* — so the setting, the window and the folder all existed and a
 * thirty-day window had never expired anything. That is the standing line's
 * shape exactly: configuration with no consumer.
 *
 * ***When something was deleted is in its own folder name, and that is the find
 * this stage turns on.*** `trashDestination` suffixes each entry with a
 * `uuidv7`, whose first forty-eight bits are the Unix millisecond it was
 * minted — so the trash already records, exactly and per entry, the moment the
 * delete happened. **The alternative was the filesystem's mtime**, and it is
 * worse in a way that only shows up when it matters: a restore from backup, a
 * `cp -r` to a new disk, or a container migration resets every mtime, and a
 * sweep reading them would either delete nothing for thirty more days or —
 * depending on which way the tool sets them — delete everything the next
 * morning. *The name travels with the bytes.*
 *
 * **A clock the caller controls**, which is the proof obligation this stage was
 * given and the only shape that can assert *gone after it* without waiting
 * thirty days. It is also the reason to write it here rather than let somebody
 * reach for a real date inside the walk.
 *
 * ***Zero means keep forever, not delete immediately.*** The schema's minimum is
 * zero and the reading a sweep takes of it is load-bearing in the direction that
 * cannot be undone: an operator setting the window to nothing is asking for no
 * expiry, and a sweep that read it as *expire on sight* would empty the trash of
 * every install that tried to turn the feature off.
 */

/** One thing waiting in the trash. */
export interface TrashEntry {
  /** `<kind>/<slug>-<suffix>`, which is the address a restore takes. */
  id: string;
  /** The library directory it came from, or `sessions`. */
  kind: string;
  /** The slug or session id it had, with the suffix taken off. */
  name: string;
  deletedAt: number;
  /** When the sweep will take it, or null when the window is off. */
  expiresAt: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The millisecond a `uuidv7` was minted, or null for anything else.
 *
 * **Null rather than zero**, and the difference decides whether a hand-made
 * folder in the trash survives: zero would read as *deleted in 1970* and be
 * swept on the next pass, which is this program deleting somebody's directory
 * because it did not recognise the name.
 */
export function deletedAtFrom(suffix: string): number | null {
  const hex = suffix.replace(/-/g, '').slice(0, 12);
  if (!/^[0-9a-f]{12}$/i.test(hex)) return null;
  const at = Number.parseInt(hex, 16);
  return Number.isSafeInteger(at) && at > 0 ? at : null;
}

/**
 * A trash entry's original name and the uuid it was suffixed with.
 *
 * ***Matched as a whole uuid rather than split on the last hyphen***, and the
 * first draft did the latter — which put `afda52e19278` in `deletedAtFrom`,
 * twelve valid hex digits from the **end** of the uuid, producing a deletion
 * date some nine thousand years hence and a sweep that took nothing ever. The
 * test caught it on its first run. *A uuid is full of hyphens, so a name that
 * ends in one is not a delimiter*, and the only unambiguous reading is the
 * shape of the whole suffix.
 *
 * Null for a folder that carries no uuid, which is a hand-made one and stays.
 */
export function splitTrashEntry(entry: string): { name: string; suffix: string } | null {
  const match = /^(.*)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
    entry,
  );
  // Both groups are non-optional in the pattern, so `?? ''` is a type
  // obligation rather than a real case — and `noUncheckedIndexedAccess` is on,
  // which is why it has to be written at all.
  return match === null ? null : { name: match[1] ?? '', suffix: match[2] ?? '' };
}

/** The directories the trash is organised into — the live tree's, plus sessions. */
function trashKinds(): string[] {
  return [...Object.values(LIBRARY_DIRECTORIES as Record<PortableSchemaId, string>), 'sessions'];
}

/**
 * Everything in one account's trash, newest first.
 *
 * *Entries whose name carries no timestamp are listed with `deletedAt: 0` and
 * no expiry*, so a person can see and restore something the sweep will never
 * take — which is the honest presentation of a folder this build did not put
 * there.
 */
export async function listTrash(
  layout: Layout,
  handle: string,
  retentionDays: number,
): Promise<TrashEntry[]> {
  const root = layout.trashRoot(handle);
  const found: TrashEntry[] = [];

  for (const kind of trashKinds()) {
    let entries: string[];
    try {
      entries = await readdir(join(root, kind));
    } catch {
      // No such kind in the trash, which is the ordinary case.
      continue;
    }
    for (const entry of entries) {
      const split = splitTrashEntry(entry);
      const deletedAt = split === null ? 0 : (deletedAtFrom(split.suffix) ?? 0);
      found.push({
        id: `${kind}/${entry}`,
        kind,
        name: split?.name ?? entry,
        deletedAt,
        expiresAt: retentionDays > 0 && deletedAt > 0 ? deletedAt + retentionDays * DAY_MS : null,
      });
    }
  }

  return found.sort((one, two) => two.deletedAt - one.deletedAt);
}

/**
 * Removes what the window has expired, and answers what it took.
 *
 * **Per account rather than over the whole data root**, because the trash is
 * per user and a sweep that walked the root would have to know which
 * directories are accounts — a second place for the layout's rules to live.
 */
export async function sweepTrash(
  layout: Layout,
  handle: string,
  retentionDays: number,
  now: number,
): Promise<string[]> {
  if (retentionDays <= 0) return [];

  const taken: string[] = [];
  for (const entry of await listTrash(layout, handle, retentionDays)) {
    if (entry.expiresAt === null || entry.expiresAt > now) continue;
    // `resolveWithin` is what makes the id safe to join: it came from a
    // `readdir` of the trash and is put back through the audited resolver
    // rather than concatenated.
    await rm(trashEntryPath(layout, handle, entry.id), { recursive: true, force: true });
    taken.push(entry.id);
  }
  return taken;
}

/**
 * Where one trash entry is, resolved through the layout.
 *
 * *Exported because restore and empty both need it*, and because an id that
 * arrived in a request must go through one audited join rather than three.
 */
export function trashEntryPath(layout: Layout, handle: string, id: string): string {
  const [kind, entry] = splitTrashId(id);
  return join(layout.trashRoot(handle), kind, entry);
}

/**
 * Puts one entry back where it came from.
 *
 * ***The suffix is taken off and the original name is restored***, which is the
 * half that makes this a restore rather than a copy: the folder's name is the
 * object's slug, and an object restored as `vera-0199a1b2…` would be a second
 * actor with a name nobody chose.
 *
 * **Refused when something is already there.** Delete-recreate-restore is a real
 * sequence — somebody deletes an actor, makes a new one with the same name, then
 * changes their mind — and overwriting would destroy the newer object to
 * resurrect the older. The answer is to say so and let them rename one.
 */
export async function restoreFromTrash(
  layout: Layout,
  handle: string,
  id: string,
): Promise<{ ok: true; path: string } | { ok: false; reason: 'not-found' | 'occupied' }> {
  const [kind, entry] = splitTrashId(id);
  const from = trashEntryPath(layout, handle, id);
  if (!(await exists(from))) return { ok: false, reason: 'not-found' };

  const name = splitTrashEntry(entry)?.name ?? entry;
  const to =
    kind === 'sessions'
      ? layout.sessionRoot(handle, name)
      : join(layout.userRoot(handle), 'library', kind, name);

  if (await exists(to)) return { ok: false, reason: 'occupied' };

  await moveTree(from, to);
  return { ok: true, path: to };
}

/** `kind/entry`, refusing anything that is not exactly that. */
function splitTrashId(id: string): [string, string] {
  const parts = id.split('/');
  const kind = parts[0] ?? '';
  const entry = parts[1] ?? '';
  if (parts.length !== 2 || !trashKinds().includes(kind) || entry === '' || entry.includes('..')) {
    throw new Error('That is not an address in the trash.');
  }
  return [kind, entry];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * ***The sweep, on a timer*** — [P11.7].
 *
 * **Once at startup and then daily**, which is `startMaturation`'s arrangement
 * and for one of its two reasons: an entry that expired while the server was
 * down has no timer coming for it. The second reason does not apply — the trash
 * has no watcher to fall back on, which is exactly why nothing has ever swept.
 *
 * **Daily rather than hourly**, because the window is measured in days: a sweep
 * sixteen times finer than the thing it is measuring buys nothing and costs a
 * `readdir` per account per hour on an install that may have a hundred.
 *
 * ***`unref`ed***, the rule every timer in this build follows: housekeeping over
 * somebody's deleted files must never be the reason a process asked to exit
 * stays alive.
 *
 * **The config is read per pass rather than captured**, because
 * `trash.retentionDays` is tiered `live` — a number copied in at construction
 * is what makes a live tier untrue, which is the mistake `watcher.ts` records
 * about `history.keepPerObject`.
 */
export interface TrashSweep {
  /** Runs one pass now over every account, and answers what it took. */
  runOnce(): Promise<string[]>;
  stop(): void;
}

export const TRASH_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startTrashSweep(
  layout: Layout,
  handles: () => Promise<string[]>,
  retentionDays: () => number,
  intervalMs: number = TRASH_SWEEP_INTERVAL_MS,
): TrashSweep {
  let stopped = false;

  const runOnce = async (): Promise<string[]> => {
    const days = retentionDays();
    if (days <= 0) return [];
    const taken: string[] = [];
    for (const handle of await handles()) {
      if (stopped) break;
      taken.push(...(await sweepTrash(layout, handle, days, Date.now())));
    }
    return taken;
  };

  const timer = setInterval(() => {
    void runOnce().catch(() => undefined);
  }, intervalMs);
  timer.unref();

  return {
    runOnce,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
