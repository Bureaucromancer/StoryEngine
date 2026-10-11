// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  type ImportItemReport,
  type ImportNote,
  isKnownSchema,
  LEGACY_PACKAGE_SCHEMA,
  type PortableObjectEnvelope,
  type PortableSchemaId,
  type Provenance,
  SESSION_SCHEMA,
  WORLD_SCHEMA,
  type World,
} from '@storyengine/shared';

import { compareVersions } from '../../build-info.js';
import type { IndexedObject } from '../../index-db/query.js';
import { LibraryError, read, type LibraryContext } from '../../library.js';
import { addMembers } from '../../library/worlds.js';
import { modeById } from '../../mode-registry.js';
import type { BlobStore } from '../../storage/card/envelope.js';
import { identifyNative, type ConflictPolicy } from '../identity.js';
import type { Arrival } from './plan.js';

/**
 * ***A World lands naming what landed*** —
 * [16 §5.1](../../../../../docs/design/16-publish.md),
 * [P16.3e](../../../../../docs/design/workplan/35-p16-world.md).
 *
 * **Last, and from what is here, not from what the file says.** The World is
 * the one object in a World file whose meaning is the others: a set somebody
 * named. So it is written after every object has been, and its `contents` is
 * the file's own list, in the file's order, kept to **the members that now
 * resolve here under the id they landed as** — a member that was damaged, did
 * not validate, or was refused by the library is not named, and the row says
 * so (`import.world.memberNotLanded`), because a World naming an object its
 * owner does not have is the dangling reference [00 §3.3] makes visible, not one
 * an import should mint. Sessions join it as they land ([P16.3f]; until then
 * none do, and each session's own row says why).
 *
 * **What it never names**: a World. A set of sets is a question nobody has
 * asked ([15 §3.1]), and `addMembers` refuses one on the way in — but only on
 * that way (the fact check's fact 12: `create` and `update` take a World whose
 * `contents` hold a World envelope, because an envelope's `schema` is validated
 * as a string). So the landing filters `storyengine.world/1` and the legacy
 * `storyengine.package/1` itself, on every arm, and the World's own id with
 * them; each is named in the row as left out.
 *
 * **Closure extras are loose objects.** A book a treatment links, an actor a
 * hook involves, a book scoped to the World and not one of its members — what
 * the walk carried beside the members (`member: false` in the manifest) —
 * arrive as library objects like any other and are not added to the World:
 * the file's World does not name them, and a landing that did would grow the
 * set the sender named into the set the walk found ([P16.3]'s plan, §3).
 *
 * ***`contents` merges and never shrinks*** — when the World is already here,
 * which is the sender importing their own file, or the second import of one.
 * The local list stays as it is, in its order, and any landed member it does
 * not name is added after it. What a publish leaves out — an unticked session,
 * an unchecked member — leaves *the file*, not the set ([16 §3]); a landing
 * that replaced the list would turn every publish into an edit of the World
 * it came from. So a sender cannot take a member out of a recipient's World
 * by publishing again, which every other kind's *replace* would do (the plan's
 * risk 7) — stated, and the right way round for a set.
 *
 * **The rest follows the policy**:
 *
 * | The World | Lands as |
 * |---|---|
 * | absent, re-minted, or keep-both's fresh copy | `create`, naming what landed |
 * | here — or the copy an earlier keep-both import left — *replace* or *keep-both* | `update` with the file's fields and the merged list — a no-op when they are the stored World's |
 * | here, from the legacy file (`partial`) | `update` with its name, its version and the merged list; the rest as stored |
 * | here, *skip* | `addMembers` — the members it lacks, and nothing else; a difference elsewhere is said |
 * | the built-in library's own, unchanged | nothing |
 *
 * **`requires` is a warning, never a block** ([04 §9]): a mode the file asks
 * for that this install does not have, or has older, is said once per mode,
 * and the World lands anyway — what needs the mode may not play, and the
 * person can see why.
 */

/**
 * ***One entry of the file's World, in the file's ids*** — what the reader
 * knows before anything is planned: the entry as the file wrote it, and
 * whether the reader refused the member it names (damaged, invalid, a kind
 * this build does not know). The plan's World comparison reads these, and the
 * landing reads them again with the ids the plan settled — one list, one
 * reading (`entryKind`), so the two cannot disagree about what the World will
 * name (the P16.3e review: they did, and keep-both made a World on every
 * import of a file with a ticked session).
 */
export interface WorldMember {
  fileId: string;
  schema: string;
  name: string | null;
  refused: boolean;
}

/**
 * ***What an entry of a World is to its landing*** — a World, which it never
 * names (nor itself); a session, named only once it landed ([P16.3f]); or a
 * member, named when it resolves here under the id it landed as.
 */
export function entryKind(
  entry: { schema: string; fileId: string },
  worldFileId: string,
): 'world' | 'session' | 'member' {
  if (isWorldSchema(entry.schema) || entry.fileId === worldFileId) return 'world';
  return entry.schema === SESSION_SCHEMA ? 'session' : 'member';
}

/** One entry of the file's World, as the reader resolved it. */
export interface WorldLandingEntry {
  /** The member's id in the file. */
  fileId: string;
  schema: string;
  name: string | null;
  /**
   * The id it landed under, by the plan; `null` when the reader already
   * knows it did not land — damaged, invalid, a kind this build does not know.
   * A non-null id is still checked: the library may have refused the write.
   */
  landedId: string | null;
}

/** What the reader hands the landing — built entirely from the file, before a byte is written. */
export interface WorldLanding {
  /** The World's member name — the row's `source`. */
  source: string;
  /** The World's id in the file. */
  fileId: string;
  /** The World as it lands: `asLanded`'s body — landed id, provenance, references renamed. */
  body: World;
  arrival: Arrival;
  /** The file's `contents`, in its order, nested Worlds included — they are filtered here. */
  entries: readonly WorldLandingEntry[];
  /** The manifest's `requires`: stored ∪ derived ([P16.3]'s plan, R12) — the warning's source. */
  requires: World['requires'];
  /** What the file says it does not carry that names no object of its own — said on this row. */
  omitted: readonly ImportNote[];
  /**
   * ***The file does not carry this World whole*** — the legacy `.sepack.json`
   * (`legacy.ts`), whose World is a name, a version and a member list. Landing
   * onto a World here, those three are applied and nothing else: the
   * synthesised blanks — no description, no gallery, nothing required — are
   * what the old format did not say, not what it said, and `replace` writing
   * them over a World here was the review's *your own legacy file blanks your
   * World* (P16.3e, 2026-10-11).
   */
  partial?: boolean;
}

/** The Writer's one door into the library — `Writer.store`, by shape, so this module imports no sweep. */
export interface WorldStore {
  store(
    object: { id: string; name: string; provenance: Provenance },
    schemaId: PortableSchemaId,
    notes: ImportNote[],
    pixels?: Uint8Array | null,
    media?: BlobStore,
    native?: boolean,
  ): Promise<'created' | 'unchanged' | 'replaced' | 'kept-both' | 'skipped' | 'failed'>;
}

export interface WorldLandingContext {
  library: LibraryContext;
  handle: string;
  policy: ConflictPolicy;
}

/**
 * Lands the World. **`carry`** is the id whose folder the World's own pictures
 * should go into — the World written or kept as it is — or `null` when they
 * should not: a skip, whose stored media rows are not the file's, or a failure.
 */
export async function landWorld(
  writer: WorldStore,
  context: WorldLandingContext,
  payload: WorldLanding,
  sessions: ReadonlyMap<string, { id: string; name: string }>,
): Promise<{ row: ImportItemReport; carry: string | null }> {
  const { library, handle } = context;
  const notes: ImportNote[] = [];
  const worldId = payload.arrival.landedId;
  const name = payload.body.name;

  // ── What the World names: the file's list, kept to what is here now ──
  const contents: PortableObjectEnvelope[] = [];
  const named = new Set<string>();
  let members = 0;
  let landedSessions = 0;
  for (const entry of payload.entries) {
    const kind = entryKind(entry, payload.fileId);
    if (kind === 'world') {
      notes.push({
        key: 'import.world.nestedWorld',
        params: { name: entry.name ?? entry.fileId },
        level: 'info',
      });
      continue;
    }
    if (kind === 'session') {
      // A session is named when it landed ([P16.3f]); one that did not says
      // so on its own row, which is where its reason is.
      const landed = sessions.get(entry.fileId);
      if (landed === undefined || named.has(landed.id)) continue;
      named.add(landed.id);
      contents.push({ schema: SESSION_SCHEMA, id: landed.id, name: landed.name });
      landedSessions += 1;
      continue;
    }
    const row = entry.landedId === null ? null : resolves(library, handle, entry);
    if (row === null) {
      notes.push({
        key: 'import.world.memberNotLanded',
        params: { member: entry.name ?? entry.fileId },
        level: 'warn',
      });
      continue;
    }
    if (named.has(row.id)) continue;
    named.add(row.id);
    contents.push({ schema: row.schemaId, id: row.id, name: row.name });
    members += 1;
  }

  notes.push(...requiresNotes(payload.requires));

  // ── The World itself, by the plan's decision and the policy ──
  const { arrival } = payload;
  let outcome: Awaited<ReturnType<WorldStore['store']>>;
  let carry = true;
  /**
   * The body handed to the Writer, when one was: `store` settles the id on the
   * object it is handed (keep-both's copy takes a fresh one there), so the
   * row names the World by what was written rather than by what was planned.
   */
  let written: World | null = null;
  const store = async (body: World): Promise<typeof outcome> => {
    written = body;
    return writer.store(body, WORLD_SCHEMA, notes, null, undefined, true);
  };
  if (arrival.decision === 'system') {
    // The built-in library's own World, unchanged: read-only, and already
    // naming what it names. Nothing to write, and nothing to carry.
    outcome = 'unchanged';
    carry = false;
  } else if (arrival.decision === 'here' || arrival.decision === 'prior') {
    // Onto a World here — the one the plan found, or the copy an earlier
    // keep-both import left, which is merged into as any World here is — or,
    // for a fresh copy, none.
    const local = arrival.local === null ? null : localWorld(library, handle, worldId);
    if (local === null) {
      if (arrival.keptBoth) {
        notes.push({ key: 'import.object.keptBoth', params: { object: name }, level: 'warn' });
      }
      outcome = await store(worldWith(payload.body, contents));
    } else if (context.policy === 'skip') {
      outcome = await skipped(context, payload, local, contents, notes);
      carry = false;
    } else if (payload.partial === true) {
      // The legacy file's World onto the one here: its name, its version, the
      // merged list — and the rest as it is here, pictures included, so there
      // are none of the file's to carry (it has none).
      outcome = await store(onto(local, payload.body, mergeContents(local.contents, contents)));
      carry = false;
    } else {
      outcome = await store(worldWith(payload.body, mergeContents(local.contents, contents)));
    }
  } else {
    outcome = await store(worldWith(payload.body, contents));
  }

  const landedId = (written as World | null)?.id ?? worldId;
  const failed = outcome === 'failed';
  const row: ImportItemReport = {
    source: payload.source,
    disposition: dispositionOf(outcome),
    ...(failed ? {} : { objectId: landedId }),
    notes: [
      ...(failed
        ? []
        : [
            {
              key: 'import.world.landed',
              params: { world: name, members, sessions: landedSessions },
              level: 'info' as const,
            },
          ]),
      ...notes,
      ...payload.omitted,
    ],
  };
  return { row, carry: failed || !carry || outcome === 'skipped' ? null : landedId };
}

/**
 * ***Skip: the members the World here lacks, and nothing else*** —
 * `addMembers`, the one door that adds to a set somebody else may be editing
 * (`library/worlds.ts`), so a second tab's save is kept and this is applied on
 * top of it. A difference elsewhere — a description, a name — is left as it is
 * here and said, as a skip says it. A refusal is this row's, never the sweep's.
 */
async function skipped(
  context: WorldLandingContext,
  payload: WorldLanding,
  local: World,
  contents: readonly PortableObjectEnvelope[],
  notes: ImportNote[],
): Promise<Awaited<ReturnType<WorldStore['store']>>> {
  const { library, handle } = context;
  const name = payload.body.name;
  const added = contents.filter((entry) => !local.contents.some((held) => held.id === entry.id));
  let kept;
  try {
    kept = await addMembers(library, handle, payload.arrival.landedId, added);
  } catch (error) {
    notes.push({
      key: 'import.file.notStored',
      params: { object: name, reason: error instanceof Error ? error.name : 'unknown' },
      level: 'warn',
    });
    return 'failed';
  }
  const merged = mergeContents((kept.object as World).contents, contents);
  const identity = await identifyNative(
    library,
    handle,
    WORLD_SCHEMA,
    payload.partial === true
      ? onto(kept.object as World, payload.body, merged)
      : { ...worldWith(payload.body, merged), provenance: { ...payload.body.provenance } },
  );
  if (identity.kind === 'changed') {
    notes.push({ key: 'import.object.differsAndKept', params: { object: name }, level: 'warn' });
  }
  return kept.written ? 'replaced' : identity.kind === 'changed' ? 'skipped' : 'unchanged';
}

/**
 * ***The list here, then what it lacks*** — `contents` merges and never
 * shrinks. The local order is kept; each incoming member not already named by
 * id is added after it, in the file's order.
 */
export function mergeContents(
  held: readonly PortableObjectEnvelope[],
  incoming: readonly PortableObjectEnvelope[],
): PortableObjectEnvelope[] {
  const ids = new Set(held.map((entry) => entry.id));
  const out = [...held];
  for (const entry of incoming) {
    if (ids.has(entry.id)) continue;
    ids.add(entry.id);
    out.push(entry);
  }
  return out;
}

/** The World with this list — a copy; the payload's own body is never changed. */
function worldWith(body: World, contents: PortableObjectEnvelope[]): World {
  return { ...body, contents };
}

/** A partial World landed onto the one here: the file's name and version, this list, the rest as it is. */
function onto(local: World, body: World, contents: PortableObjectEnvelope[]): World {
  return {
    ...local,
    provenance: { ...local.provenance },
    name: body.name,
    version: body.version,
    contents,
  };
}

/** A World, in its current name or the one it had before P16.0 ([P16 §1.1]). */
export function isWorldSchema(schema: string): boolean {
  return schema === WORLD_SCHEMA || schema === LEGACY_PACKAGE_SCHEMA;
}

/** The member as it is here now, under the id it landed as and in its kind — or null. */
function resolves(
  library: LibraryContext,
  handle: string,
  entry: WorldLandingEntry,
): IndexedObject | null {
  if (entry.landedId === null || !isKnownSchema(entry.schema)) return null;
  try {
    return read(library, handle, entry.landedId, entry.schema);
  } catch (error) {
    if (error instanceof LibraryError && error.code === 'not-found') return null;
    throw error;
  }
}

function localWorld(library: LibraryContext, handle: string, id: string): World | null {
  try {
    return read(library, handle, id, WORLD_SCHEMA).body as World;
  } catch (error) {
    if (error instanceof LibraryError && error.code === 'not-found') return null;
    throw error;
  }
}

/**
 * ***A mode the file needs and this install cannot offer*** — absent, or older
 * than the file asks for. One warning per mode; extensions and capabilities
 * have no registry here to ask, and the file's manifest names them for the
 * preview ([P16.3f]).
 */
function requiresNotes(requires: World['requires']): ImportNote[] {
  const notes: ImportNote[] = [];
  const modes: unknown[] = Array.isArray(requires.modes) ? requires.modes : [];
  for (const wanted of modes) {
    // A hand-made manifest's `modes` can hold anything, `null` included — and
    // this runs after every object was written, so a throw here was a
    // half-import with no report (the P16.3e review). The reader keeps the
    // list to records at its survey; this does not trust that it did.
    if (!isRecord(wanted)) continue;
    if (typeof wanted['id'] !== 'string' || typeof wanted['minVersion'] !== 'string') continue;
    const mode = wanted['id'];
    const minVersion = wanted['minVersion'];
    const have = modeById(mode)?.definition.version;
    const enough = have !== undefined && (compareVersions(have, minVersion) ?? -1) >= 0;
    if (enough) continue;
    notes.push({
      key: 'import.world.requiresMode',
      params: { mode, minVersion },
      level: 'warn',
    });
  }
  return notes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dispositionOf(outcome: string): ImportItemReport['disposition'] {
  if (outcome === 'unchanged' || outcome === 'skipped') return 'unchanged';
  return outcome === 'failed' ? 'unrecognised' : 'converted';
}
