// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  type Closure,
  fileSet,
  type FileSet,
  type ImportNote,
  newWorld,
  type NodeKey,
  type PortableObjectEnvelope,
  type PublishChoices,
  PUBLISH_RECORD_SCHEMA,
  type PublishRecord,
  type PublishStart,
  WORLD_SCHEMA,
  type World,
  worldFileName,
  type WorldFileManifest,
} from '@storyengine/shared';

import { create, LibraryError, read, remove } from '../library.js';
import { modeById } from '../mode-registry.js';
import { openImportScratch, type ScratchSpace } from '../storage/import-scratch.js';
import { SNAPSHOT_FREE_RESERVE_BYTES } from '../storage/sqlite-snapshot.js';
import { type ClosureRefusal, libraryReader, walkClosure } from './closure.js';
import { closureHash, type PublishContext, suggestedNameOf } from './review.js';
import {
  planWorldFile,
  type PublishPlan,
  WorldFileChangedError,
  type WorldFileRefusal,
  writeWorldFile,
} from './world-file.js';

/**
 * ***The confirm: walk again, plan, keep the one thing, write*** —
 * [16 §5](../../../../docs/design/16-publish.md),
 * [16 §3](../../../../docs/design/16-publish.md),
 * [16 §2](../../../../docs/design/16-publish.md), [P16.3d].
 *
 * **In the plan's order, and the order is the design** ([P16.3]'s plan, R11):
 *
 * 1. **Re-walk the library as it is now** — [16 §5]: *"the file is produced on
 *    confirm from the library as it is then."* The review's closure is not
 *    trusted, and not needed: the person's ticks are keyed by id and re-applied
 *    to the fresh walk by the same `fileSet` the review drew with, so a stale
 *    key is ignored and an object added since takes its default.
 * 2. **`fileSet`, and drift** — whether the fresh walk hashes to what the review
 *    was drawn from. Reported, never prevented: *the honest failure rather than
 *    a prevented one* (16 §5).
 * 3. **The World, in memory only.** For a selection kept as a World, the name
 *    is checked and the World built with its id minted — holding the
 *    **selection as selected**, an unchecked starting point included ([16 §3]:
 *    *a World is a set somebody named*; what was left out leaves the file, not
 *    the set). For a World start the stored World is read, and must still be
 *    the one walked.
 * 4. **Plan the file, then the room check** — every refusal the file can earn
 *    (too many members, too large, no room on the disk) is earned here, while
 *    nothing has been written but scratch.
 * 5. ***The one library write*** — `create` of the kept World, a kept
 *    selection only. **After the plan, so a refusal leaves no stray World**;
 *    before the write, because the file names the World's id and the World is
 *    cheap if what follows fails ([16 §3]: *a World nobody opens again is
 *    cheap*). A World start writes nothing to the World; one object writes
 *    nothing at all ([16 §2]).
 * 6. **Write the file** into the same scratch space. An object edited between
 *    plan and write fails it whole (`409 publish.changed`), and a World kept
 *    in step 5 stays — the person publishes it again from its page.
 *    ***Any other failure from here takes the World back*** (2026-10-11, the
 *    P16.3d review): a disk that fills while the file is written, or fails —
 *    answers that name no World, so one kept would be a World the person
 *    cannot find and their retry a second. R11's *refusals leave no stray
 *    World* covers the late arm of the room check as much as the early one;
 *    only the `409`, which names what it kept, leaves one.
 *
 * The response and the ledger are the route's: the file is sent from scratch
 * with its `content-length`, the ledger line is appended when the response
 * finishes, and the scratch space is disposed of when it closes.
 */

/** What the confirm made: a file on disk, its record, and what the response says beside it. */
export interface ConfirmedPublish {
  /** The World file, in {@link ConfirmedPublish.space}. */
  path: string;
  /** Scratch the caller owns from here: disposed of when the response closes, sent or not. */
  space: ScratchSpace;
  bytes: number;
  entries: number;
  fileName: string;
  /** The World the file is of, and whether this publish kept it — `null` for one object or a snapshot. */
  world: PublishRecord['world'];
  /** References the file would have followed and could not — `x-storyengine-missing`. */
  missing: number;
  drift: boolean;
  /** What the file does not carry and says so — the manifest's `omitted`, and a mode not here. */
  notes: ImportNote[];
  /** The ledger line, appended by the route once the download has finished. */
  record: PublishRecord;
}

/**
 * Why there is no file. **Each is one answer of the route**, and none leaves a
 * World but `changed` after the World was kept, which names it. *(Nor does a
 * throw, since 2026-10-11: a failure after the World was kept takes it back
 * before it propagates — see {@link takeBack}.)*
 */
export type PublishRefusal =
  | ClosureRefusal
  /** A selection kept as a World whose name is empty, too long, or holds a control character. */
  | { refusal: 'invalid-name' }
  /** The file would pass a bound its readers set — `planWorldFile`'s reason. */
  | { refusal: 'too-large'; reason: Exclude<WorldFileRefusal['refusal'], 'not-a-member'> }
  /** Something changed between the walk and the write; `world` is a World this confirm kept, which stays. */
  | { refusal: 'changed'; path: string; world: { id: string; name: string } | null }
  /** Not room on the disk for the file and the reserve the server keeps. */
  | { refusal: 'no-space'; needed: number; free: number };

/** How long a kept World's name may be — the bound the World editor's field is held to by nothing else. */
export const PUBLISH_NAME_MAX = 200;

/** The file's name inside its scratch space: one file per space, so it needs no more than this. */
const SCRATCH_FILE = 'world.seworld';

export async function confirmPublish(
  context: PublishContext,
  handle: string,
  start: PublishStart,
  choices: PublishChoices,
  reviewed?: string,
): Promise<ConfirmedPublish | PublishRefusal> {
  // ── 1–2. The library as it is now, and the person's ticks over it ──
  const closure = await walkClosure(libraryReader(context, handle), start);
  if ('refusal' in closure) return closure;
  const set = fileSet(closure, choices);
  // A caller that never asked for a review has nothing to have drifted from.
  const drift = reviewed !== undefined && reviewed !== closureHash(closure);

  // ── 3. The World the file is of — in memory ──
  let world: { body: World; kept: 'created' | 'existing'; contentHash?: string } | null = null;
  if (closure.world !== null) {
    let stored;
    try {
      stored = read(context.library, handle, closure.world.id, WORLD_SCHEMA);
    } catch (error) {
      if (error instanceof LibraryError && error.code === 'not-found') {
        return { refusal: 'changed', path: closure.world.id, world: null };
      }
      throw error;
    }
    // The World saved between the walk and this read: its members are not the
    // ones the walk followed, and a file built from both would be neither.
    if (stored.contentHash !== closure.world.contentHash) {
      return { refusal: 'changed', path: closure.world.id, world: null };
    }
    // And the plan holds its own read of the row to the same hash (2026-10-11,
    // the P16.3d review): it reads the World again for its folder and
    // pictures, after surveying every member, and a save in that window
    // would pair this body's `world.json` with the new row's pictures. Which
    // makes the check above that one's early answer — before any scratch is
    // opened — rather than a second rule; no test can tell the two apart.
    world = {
      body: stored.body as World,
      kept: 'existing',
      contentHash: closure.world.contentHash,
    };
  } else if (closure.origin === 'selection' && choices.keep === 'world') {
    const name = validName(choices.name);
    if (name === null) return { refusal: 'invalid-name' };
    // `requires` stays empty: the derived list goes in the manifest for the
    // reader's warning and is never persisted as the World's ([P16.3]'s plan,
    // R12; [00 §2.8]).
    world = { body: { ...newWorld(name), contents: selectedEnvelopes(closure) }, kept: 'created' };
  }

  const requires = derivedRequires(set.modes);
  const members = memberKeys(closure, world);
  const plan: PublishPlan = {
    origin: closure.origin,
    world:
      world === null
        ? null
        : {
            body: world.body,
            ...(world.contentHash === undefined ? {} : { contentHash: world.contentHash }),
          },
    objects: set.objects.map((object) => ({ id: object.id, member: members.has(object.key) })),
    sessions: set.sessions.map((session) => session.id),
    leftBehind: set.leftBehind,
    requires: requires.requires,
    history: choices.history,
  };

  // ── 4. The plan, and the room for it — everything that can refuse ──
  const space = await openImportScratch(context.library.layout);
  let handedOver = false;
  try {
    let planned;
    try {
      planned = await planWorldFile(context, handle, plan, space);
    } catch (error) {
      if (error instanceof WorldFileChangedError) {
        return { refusal: 'changed', path: error.path, world: null };
      }
      throw error;
    }
    if ('refusal' in planned) {
      // A session the plan was asked for that the World no longer names: the
      // World checked above makes this the plan's own disagreement, which is
      // still a change between the walk and the read.
      if (planned.refusal === 'not-a-member') {
        return { refusal: 'changed', path: closure.world?.id ?? '', world: null };
      }
      return { refusal: 'too-large', reason: planned.refusal };
    }
    const free = await context.freeBytes(context.library.layout.dataRoot);
    const needed = planned.bytes + SNAPSHOT_FREE_RESERVE_BYTES;
    if (free !== null && free < needed) return { refusal: 'no-space', needed, free };

    // ── 5. The one library write ──
    const kept =
      world === null ? null : { id: world.body.id, name: world.body.name, kept: world.kept };
    const created =
      world?.kept === 'created'
        ? await create(context.library, handle, world.body, WORLD_SCHEMA)
        : null;

    try {
      // ── 6. The file ──
      const path = space.path(SCRATCH_FILE);
      let written;
      try {
        written = await writeWorldFile(planned, path);
      } catch (error) {
        if (error instanceof WorldFileChangedError) {
          return {
            refusal: 'changed',
            path: error.path,
            world: world?.kept === 'created' ? { id: world.body.id, name: world.body.name } : null,
          };
        }
        throw error;
      }

      const fileName = worldFileName(
        world?.body.name ?? validName(choices.name) ?? suggestedNameOf(closure),
      );
      const missing = missingCount(closure, set);
      const record = recordOf(closure, set, choices, {
        at: planned.manifest.exportedBy.at,
        build: context.build?.version ?? null,
        world: kept,
        fileName,
        bytes: written.bytes,
        entries: written.entries,
        manifest: planned.manifest,
        missing,
        drift,
      });
      handedOver = true;
      return {
        path,
        space,
        bytes: written.bytes,
        entries: written.entries,
        fileName,
        world: kept,
        missing,
        drift,
        notes: [...planned.notes, ...requires.notes],
        record,
      };
    } catch (error) {
      // Anything but the `409` above, which returned naming the World: the
      // disk filling or failing under the write, or a fault after it. No
      // answer from here names the World, so it does not stay (step 6).
      if (created !== null && world !== null) {
        await takeBack(context, handle, world.body.id, created.contentHash);
      }
      throw error;
    }
  } finally {
    // Every way out but the file's own leaves nothing in scratch: a refusal,
    // a change, a throw. The file's is the route's to dispose of, once the
    // response has closed.
    if (!handedOver) await space.dispose().catch(() => undefined);
  }
}

/**
 * ***The World this confirm kept, taken back*** — when the write after it
 * failed with an answer that cannot name it (2026-10-11, the P16.3d review).
 * Milliseconds old, named by nothing yet: no answer carried its id, and the
 * person's retry would keep a second.
 *
 * **To the trash, as every removal here is** ([03 §10.2]: deletion is a move,
 * not an erasure) — `remove`'s own path, hash-checked against what `create`
 * wrote, so a World somebody has somehow already saved is left alone. *Never
 * throws*: it runs on the way out of a failure that is the answer, and a take
 * back that fails too (the disk that filled may refuse the index its row)
 * leaves the World as it was before this existed — kept, and unnamed.
 */
async function takeBack(
  context: PublishContext,
  handle: string,
  id: string,
  contentHash: string,
): Promise<void> {
  await remove(context.library, handle, id, contentHash, WORLD_SCHEMA).catch(() => undefined);
}

/**
 * ***A kept World's name***, trimmed, or `null` when there is none worth
 * keeping: empty, over {@link PUBLISH_NAME_MAX} characters, or holding a
 * control character — a name is a line of text a person reads in a list, and
 * a newline or a NUL in one is a mistake rather than a choice.
 */
function validName(name: string | undefined): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  // Counted as a person counts them — graphemes, so an accented letter or an
  // emoji is one — rather than in UTF-16 units, which would refuse a name of
  // emoji, or of characters outside the basic plane, at half the length the
  // person sees.
  const length = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)]
    .length;
  if (trimmed === '' || length > PUBLISH_NAME_MAX) return null;
  if (/\p{Cc}/u.test(trimmed)) return null;
  return trimmed;
}

/**
 * ***The selection, as selected*** — every starting point the walk found, in
 * the order picked, under its name now; an unchecked one included, because
 * unticking leaves a thing out of the file and not out of the set the person
 * named ([16 §3]). A selected id that is not there, or of a kind this build
 * does not know, is not a member: there is nothing to name.
 */
function selectedEnvelopes(closure: Closure): PortableObjectEnvelope[] {
  const byKey = new Map(closure.nodes.map((node) => [node.key, node]));
  const out: PortableObjectEnvelope[] = [];
  const seen = new Set<string>();
  for (const edge of closure.edges) {
    if (edge.from !== null || edge.rule !== 'selected') continue;
    const node = byKey.get(edge.to);
    if (node?.state !== 'found' || seen.has(node.id)) continue;
    seen.add(node.id);
    out.push({ schema: node.schema, id: node.id, name: node.name });
  }
  return out;
}

/**
 * Which carried nodes the file's World names — its members for a World start,
 * the selection for a kept one; none when there is no World. `planWorldFile`
 * holds the flag to the World's `contents` as well, so this is the order the
 * file lists them in (members first) as much as it is a claim.
 */
function memberKeys(
  closure: Closure,
  world: { kept: 'created' | 'existing' } | null,
): Set<NodeKey> {
  if (world === null) return new Set();
  const rule = world.kept === 'existing' ? 'world.member' : 'selected';
  return new Set(
    closure.edges.filter((edge) => edge.from === null && edge.rule === rule).map((edge) => edge.to),
  );
}

/**
 * ***`requires`, derived*** — the modes carried Setups and sessions play, at
 * this install's version of each ([P16.3]'s plan, §2 P16.3a). A mode this
 * install does not have is required at `0.0.0` — the file still says it is
 * needed, without a version it cannot know — and the person is told so.
 * Extensions and capabilities: no portable field names one, so the derivation
 * honestly answers none, and an author's own entries are merged over this by
 * the writer ([P16.3]'s plan, R12).
 */
function derivedRequires(modes: readonly string[]): {
  requires: World['requires'];
  notes: ImportNote[];
} {
  const notes: ImportNote[] = [];
  const derived = modes.map((id) => {
    const version = modeById(id)?.definition.version;
    if (version === undefined) {
      notes.push({ key: 'publish.requires.modeNotHere', level: 'info', params: { mode: id } });
    }
    return { id, minVersion: version ?? '0.0.0' };
  });
  return { requires: { modes: derived, extensions: [], capabilities: [] }, notes };
}

/**
 * ***What the file would have carried and could not find*** — P11.10's
 * `x-storyengine-missing`, counted over the walk: every missing node a
 * starting point names (a World member gone, a selected id that is not there)
 * or something carried names. One missing only an unticked thing named is not
 * the file's to report.
 */
function missingCount(closure: Closure, set: FileSet): number {
  const carried = new Set([...set.objects, ...set.sessions].map((one) => one.key));
  return closure.nodes.filter(
    (node) =>
      node.state === 'missing' &&
      node.inbound.some((index) => {
        const from = closure.edges[index]?.from;
        return from === null || (from !== undefined && carried.has(from));
      }),
  ).length;
}

/**
 * ***The ledger line*** — what left, and the person's overrides; never a body
 * (see `PublishRecord`). What left is read off the manifest, which is what the
 * file holds after the writer's own decisions (a card too large, a session too
 * long), with each object's hash the walk's — the stored object's — so the
 * diff a re-publish opens on compares like with like.
 */
function recordOf(
  closure: Closure,
  set: FileSet,
  choices: PublishChoices,
  file: {
    at: string;
    build: string | null;
    world: PublishRecord['world'];
    fileName: string;
    bytes: number;
    entries: number;
    manifest: WorldFileManifest;
    missing: number;
    drift: boolean;
  },
): PublishRecord {
  const byKey = new Map(closure.nodes.map((node) => [node.key, node]));
  const tick = (key: NodeKey): boolean | undefined =>
    Object.hasOwn(choices.ticked, key) && typeof choices.ticked[key] === 'boolean'
      ? choices.ticked[key]
      : undefined;

  const unticked: PublishRecord['unticked'] = [];
  const ticked: string[] = [];
  for (const node of closure.nodes) {
    if (node.state !== 'found' && node.state !== 'session') continue;
    if (!node.canUncheck) continue;
    const chosen = tick(node.key);
    if (chosen === undefined || chosen === node.defaultOn) continue;
    if (chosen) ticked.push(node.id);
    else unticked.push({ id: node.id, required: node.state === 'found' && node.required });
  }

  return {
    schema: PUBLISH_RECORD_SCHEMA,
    at: file.at,
    build: file.build,
    origin: closure.origin,
    start: closure.start.kind === 'world' ? [closure.start.id] : distinct(closure.start.ids),
    world: file.world,
    fileName: file.fileName,
    bytes: file.bytes,
    entries: file.entries,
    objects: file.manifest.objects.map((object) => {
      const node = byKey.get(object.id);
      return {
        schema: object.schema,
        id: object.id,
        name: object.name,
        contentHash: node?.state === 'found' ? node.contentHash : object.contentHash,
      };
    }),
    sessions: file.manifest.sessions.map((session) => {
      const node = byKey.get(session.id);
      return {
        id: session.id,
        name: session.name,
        headTurnId: session.headTurnId,
        turns: session.turns,
        updatedAt: node?.state === 'session' ? node.updatedAt : '',
      };
    }),
    offered: {
      objects: closure.nodes.filter((node) => node.state === 'found').length,
      sessions: closure.nodes.filter((node) => node.state === 'session').length,
    },
    unticked,
    ticked,
    history: choices.history,
    justTheObject:
      closure.origin === 'object' && set.objects.length === 1 && set.sessions.length === 0,
    missing: file.missing,
    drift: file.drift,
  };
}

/** The distinct ids, in order — the walk's own reading of a selection. */
function distinct(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === 'string' && id !== ''))];
}
