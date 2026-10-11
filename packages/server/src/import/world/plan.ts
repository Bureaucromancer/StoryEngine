// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  isKnownSchema,
  type PortableObjectEnvelope,
  type PortableSchemaId,
  type Provenance,
  uuidv7,
  WORLD_SCHEMA,
  type World,
} from '@storyengine/shared';

import { findById, findPriorImport, findPriorImports } from '../../index-db/query.js';
import { encodeForCompare, LibraryError, read, type LibraryContext } from '../../library.js';
import { SYSTEM_OWNER } from '../../storage/layout.js';
import { identifyNative, stampImported, type ConflictPolicy } from '../identity.js';
import { entryKind, mergeContents, type WorldMember } from './landing.js';
import { idsNamedIn, rewriteIds } from './rewrite.js';

/**
 * ***Which id each object in a World file lands under*** —
 * [P16.3e](../../../../../docs/design/workplan/35-p16-world.md),
 * [16 §5.1](../../../../../docs/design/16-publish.md),
 * [04 §9](../../../../../docs/design/04-schemas.md).
 *
 * **Native ids are kept, and re-minted only where this account cannot hold
 * them** ([P16.3]'s plan, §3). A World file is our own objects, so an id is the
 * better identity than a filename (`identifyNative`'s whole argument) — and
 * keeping it is what lets a second version of the file update the first on the
 * other side rather than land beside it. But `create` refuses any id the
 * **install** holds (`library.ts`, `findById` — the plan's fact 1), and
 * `identifyNative` asks through `read`, which is owner-scoped: a second account
 * on one install sees *not found* for every object the first account published,
 * and every `create` then fails as a conflict. So the plan asks first, per id,
 * in this order:
 *
 * | What is here | Decision | Lands under |
 * |---|---|---|
 * | this account holds it, in the same kind | `here` | its id — under keep-both, when it differs, a copy: the one an earlier keep-both import left when it is the file's, else a fresh id |
 * | this account imported it from a World file before (`seworld:<id>`) | `prior` | that object's id — keep-both as above |
 * | the built-in library holds it, in the same kind | `system` when identical (nothing written), else `remint` | its id, or a fresh one |
 * | anything else holds it — another account, another kind | `remint` | a fresh uuidv7 |
 * | nothing holds it | `new` | its id |
 *
 * ***A re-mint is not named per object*** — *corrected 2026-10-11, the P16.3e
 * review.* ~~An id another account holds and an id nobody holds must give one
 * answer to the person importing.~~ They cannot quite: a re-minted object lands
 * under an id that is not the file's, and the review row names the object it
 * landed as, so a person who reads ids out of the file can tell — an oracle
 * `create`'s install-wide refusal already was before this stage (*failed*
 * against *created*). What holds is narrower, and is what the review promises:
 * **no note says *re-minted*, or anything that differs between the two** — a
 * `remint` and a `new` land stamped alike, and a history left behind by a
 * re-mint is not said per object (`reader.ts`). The id itself is the residual
 * side channel, inherent in keeping ids at all, and named in [P16.3]'s risks.
 *
 * **The stamp is the per-account arrival key** ([P16 §1.7], the plan's fact 6):
 * `new` and `remint` land with `source: 'import'` and `originalFilename:
 * 'seworld:<file id>'`, so the same account importing the file again finds its
 * earlier arrival with `findPriorImport` — *same owner, same kind, same
 * filename* — and nothing doubles. *So does keep-both's copy* (P16.3e's
 * reading, where the plan named only the two): it is the file's object
 * arriving, not the one here, and stamping it says so — and it is what lets
 * the next keep-both import of the same file find the copy rather than make
 * another (below). `here` and `prior` land with the local object's own
 * `source` and `originalFilename` copied over the file's before anything is
 * compared, which is what makes **your own file read back `unchanged`**: the
 * file carries the sender's provenance, and the sender is you.
 *
 * ***Tags are the account's own*** (the P16.3e review). An object's `tagIds`
 * name the sender's per-account registry, and `tags` beside them are the same
 * tags by name, index-aligned ([05 §3], `resolveTagNames`). So an object that
 * lands *onto* one here (`here`, `prior`, a copy found again) keeps that one's
 * `tags` and `tagIds` exactly — the registry is the recipient's, and a tag the
 * file cannot know about is not a difference, or your own file read back after
 * deleting a registry entry would strip it, and a recipient who tagged an
 * arrival would see it replaced on every import. An object that lands **new**
 * keeps its `tagIds` only if this registry holds every one; otherwise it lands
 * un-adopted — no `tagIds`, its names the truth — as `vault-tag.ts` lands an
 * import's tags, rather than with the two arrays out of step.
 *
 * ***Keep-both, and why it is a fixed point.*** Under keep-both an object here
 * that differs from the file's lands as a copy under a fresh id, and the file's
 * references must follow the copy — the file's treatment names the file's book,
 * not the one here it differs from. But following it changes the treatment: it
 * now names a book this treatment here does not, so it differs too, and lands
 * as a copy itself. So the comparison runs again over what names a new copy
 * until nothing more moves; it only ever adds copies, so it ends — and it asks
 * again only of the objects that **name** the one that moved (a worklist over
 * who names whom, the review's *quadratic over a chain*), not of every object
 * on every pass.
 *
 * ***And a copy made last time is found again*** (the P16.3e review: two
 * keep-both imports of one file made every copy twice). The arrival key is the
 * same on the arrival and on its copy, so an account can hold several objects
 * under one key; `findPriorImport` answers with whichever sorts first, which is
 * the edited original as often as the copy. So once the copies are settled,
 * each fresh one is compared with **every** object of this account under its
 * key, and lands onto the first that is already the file's — and since that
 * changes what its referrers name, they are asked again, until nothing moves.
 * A fresh id only ever turns into an existing one, so this ends too.
 *
 * *Tombstoned ids read as free* — the fact check of 2026-10-10. `findById` and
 * `findPriorImport` see only live rows (a trashed object's index row matures
 * away in seconds, `TOMBSTONE_TTL_MS`), so an id whose object sits in another
 * account's trash is `new` here, and that account restoring it later makes a
 * shadowed duplicate (the trash checks paths, not ids). ***Worse than a
 * duplicate***, the P16.3e review found: the arrival is the earlier path and
 * wins the id, so the owner's restored object is the shadowed copy — still in
 * their list, and no longer readable by its id, so their own links to it fall
 * back to its name. Named in [P16.3]'s risks and pinned by a test rather than
 * fixed: knowing the trash's ids is a walk of every account's trash per import,
 * and the better fix is the restore's (re-mint when another owner holds the
 * id), which is not this stage's.
 */

export type ArrivalDecision = 'here' | 'prior' | 'system' | 'remint' | 'new';

/** One object of the file, as the plan needs it. */
export interface ArrivalObject {
  /** Its id in the file — the body's own `id`. */
  id: string;
  schemaId: PortableSchemaId;
  /** As the file holds it: never rewritten, never stamped. */
  body: unknown;
  /** `sha256:<hex>` of the file's bytes — how a built-in object is recognised as the same. */
  contentHash?: string;
  /**
   * ***The World's members, as the landing will name them*** — its entries in
   * file ids, each marked when the reader refused it. A World is compared as
   * it would land (`worldAsMerged`), and what it would land naming is what
   * `landWorld` names: not a session until [P16.3f] lands one, not a refused
   * member, not a World. Absent, the body's own `contents` are read, none of
   * them refused — for a caller with no reader in front of it.
   */
  members?: readonly WorldMember[];
  /**
   * ***A World the file does not carry whole*** — the legacy `.sepack.json`,
   * which held a manifest's name, version and member list and nothing else of
   * the World (the fact check's fact 11). Landing onto a World here, only
   * those three are the file's; the rest are the one here, never the blanks
   * `legacy.ts` had to synthesise to make a body that validates.
   */
  partial?: boolean;
}

export interface Arrival {
  landedId: string;
  decision: ArrivalDecision;
  /**
   * ***Keep-both's copy*** — the object here differs from the file's, so the
   * file's lands beside it under `landedId` — a fresh id, or a copy an earlier
   * keep-both import left — and every reference in the file follows the copy.
   * Only ever set on `here` and `prior`.
   */
  keptBoth: boolean;
  /**
   * ***The object here it lands onto***, or null when it lands as a new one
   * (`new`, `remint`, a fresh copy). Its own account of where it came from
   * and its own tags, copied over the file's so a file read back is compared
   * like for like — and the reader's test of *is this a new object*: a
   * history, or a blank card's note, is said only where this is null.
   */
  local: LocalObject | null;
}

/** What an object here keeps of its own when the file's lands onto it. */
export interface LocalObject {
  source: Provenance['source'];
  originalFilename: string | null;
  /** Its `tags` and `tagIds` as they are — absent ones absent. */
  tagging: { tags?: unknown; tagIds?: unknown };
}

export interface ArrivalPlan {
  /** File id → landed id, every object in the plan — an id landing as itself included. */
  ids: ReadonlyMap<string, string>;
  byFileId: ReadonlyMap<string, Arrival>;
}

export interface ArrivalContext {
  library: LibraryContext;
  handle: string;
  policy: ConflictPolicy;
  /**
   * The ids of this account's tag registry — what an arriving `tagIds` is
   * filtered to (the fact check's *tag ids name the sender's registry*). Null
   * keeps every id, for a caller with no registry to ask.
   */
  tags: ReadonlySet<string> | null;
}

/** The arrival key a World file stamps on what it lands new — per account, per file id. */
export function arrivalKey(fileId: string): string {
  return `seworld:${fileId}`;
}

export async function planArrivals(
  objects: readonly ArrivalObject[],
  context: ArrivalContext,
): Promise<ArrivalPlan> {
  const byFileId = new Map<string, Arrival>();
  for (const object of objects) {
    // A file naming one id twice is the reader's to refuse; the first decides.
    if (byFileId.has(object.id)) continue;
    byFileId.set(object.id, await decide(object, context));
  }
  const ids = new Map([...byFileId].map(([id, arrival]) => [id, arrival.landedId]));
  if (context.policy === 'keep-both') await copiesFollow(objects, byFileId, ids, context);
  return { ids, byFileId };
}

async function decide(object: ArrivalObject, context: ArrivalContext): Promise<Arrival> {
  const { library, handle } = context;
  const owner = `user:${handle}`;
  const row = findById(library.db, object.id);

  if (row !== null && row.owner === owner && row.schemaId === object.schemaId) {
    return { landedId: row.id, decision: 'here', keptBoth: false, local: localOf(row.body) };
  }

  const prior = findPriorImport(library.db, owner, object.schemaId, arrivalKey(object.id));
  if (prior !== null) {
    return { landedId: prior.id, decision: 'prior', keptBoth: false, local: localOf(prior.body) };
  }

  if (row !== null && row.owner === 'system' && row.schemaId === object.schemaId) {
    // The built-in library's own, unchanged: nothing to write, and every
    // reference to it resolves here already. Changed, it cannot be written
    // over (system objects are read-only) nor beside (the id is taken), so it
    // lands as a copy of its own under a fresh id.
    if (await sameAsSystem(object, row, library)) {
      return { landedId: row.id, decision: 'system', keptBoth: false, local: null };
    }
    return { landedId: uuidv7(), decision: 'remint', keptBoth: false, local: null };
  }

  if (row !== null) return { landedId: uuidv7(), decision: 'remint', keptBoth: false, local: null };
  return { landedId: object.id, decision: 'new', keptBoth: false, local: null };
}

/**
 * ***The body an object lands with*** — its references renamed by the plan,
 * its `id` the landed one, its provenance the decision's, its tags this
 * account's. **One function for the comparison and the write**, so the plan
 * never decides *unchanged* about a body the reader then writes otherwise.
 */
export function asLanded(
  object: ArrivalObject,
  arrival: Arrival,
  ids: ReadonlyMap<string, string>,
  tags: ReadonlySet<string> | null,
): { body: Record<string, unknown>; droppedTags: string[] } {
  const body = rewriteIds(object.body, ids) as Record<string, unknown>;
  body['id'] = arrival.landedId;
  const droppedTags: string[] = [];
  // The built-in library's own: compared, never written, so left as the file has it.
  if (arrival.decision === 'system') return { body, droppedTags };

  const provenance = body['provenance'];
  const { local } = arrival;
  if (local !== null) {
    if (isRecord(provenance)) {
      provenance['source'] = local.source;
      provenance['originalFilename'] = local.originalFilename;
    }
    // The account's own tags, exactly — see the module comment.
    if ('tags' in local.tagging) body['tags'] = structuredClone(local.tagging.tags);
    else delete body['tags'];
    if ('tagIds' in local.tagging) body['tagIds'] = structuredClone(local.tagging.tagIds);
    else delete body['tagIds'];
    return { body, droppedTags };
  }

  if (isRecord(provenance))
    stampImported(body as { provenance: Provenance }, arrivalKey(object.id));
  /**
   * ***Tag ids are the sender's registry's*** (the fact check of 2026-10-10):
   * a tag is a per-account registry entry keyed by an id minted there, and an
   * object's `tagIds` name that registry. Kept whole when this account's
   * registry holds every one — your own file landing as a copy, or a tag that
   * came across another way — and otherwise **the object lands un-adopted**:
   * no `tagIds`, its `tags` names the truth, which is what an import's tags are
   * everywhere else (`vault-tag.ts`) and which `resolveTagNames` reads as
   * names. Dropping the ids one by one would leave the two parallel arrays out
   * of step — *"somebody hand-edited one array"* — and take nothing a person
   * can see. One note for the whole file, by the reader.
   */
  if (tags !== null && Array.isArray(body['tagIds'])) {
    for (const id of body['tagIds'] as unknown[]) {
      if (typeof id !== 'string' || !tags.has(id)) droppedTags.push(String(id));
    }
    if (droppedTags.length > 0) delete body['tagIds'];
  }
  return { body, droppedTags };
}

/**
 * Keep-both's copies, until no reference to one makes another differ, and then
 * each onto a copy an earlier import left where one is the file's already —
 * see the module comment.
 */
async function copiesFollow(
  objects: readonly ArrivalObject[],
  byFileId: Map<string, Arrival>,
  ids: Map<string, string>,
  context: ArrivalContext,
): Promise<void> {
  // Who names whom, once: an object is asked again only when one it names moves.
  const fileIds = new Set(objects.map((object) => object.id));
  const referrers = new Map<string, ArrivalObject[]>();
  for (const object of objects) {
    const named = idsNamedIn(object.body, fileIds);
    for (const member of object.members ?? []) named.add(member.fileId);
    named.delete(object.id);
    for (const id of named) referrers.set(id, [...(referrers.get(id) ?? []), object]);
  }
  const unique = (list: readonly ArrivalObject[]) => [...new Set(list)];

  // ── Which objects here differ, and so land as copies ──
  for (let queue = unique(objects); queue.length > 0;) {
    const next: ArrivalObject[] = [];
    for (const object of queue) {
      const arrival = byFileId.get(object.id);
      if (arrival === undefined || arrival.keptBoth) continue;
      if (arrival.decision !== 'here' && arrival.decision !== 'prior') continue;
      if (!(await differs(object, arrival, ids, context))) continue;
      const fresh = uuidv7();
      byFileId.set(object.id, { ...arrival, landedId: fresh, keptBoth: true, local: null });
      ids.set(object.id, fresh);
      next.push(...(referrers.get(object.id) ?? []));
    }
    queue = unique(next);
  }

  // ── A fresh copy that is one an earlier keep-both import left ──
  const owner = `user:${context.handle}`;
  const claimed = new Set<string>();
  const isFresh = (object: ArrivalObject) => {
    const arrival = byFileId.get(object.id);
    return arrival?.keptBoth === true && arrival.local === null;
  };
  for (let queue = objects.filter(isFresh); queue.length > 0;) {
    const next: ArrivalObject[] = [];
    for (const object of queue) {
      const arrival = byFileId.get(object.id);
      if (arrival === undefined || !isFresh(object)) continue;
      const earlier = findPriorImports(
        context.library.db,
        owner,
        object.schemaId,
        arrivalKey(object.id),
      );
      for (const row of earlier) {
        if (claimed.has(row.id)) continue;
        const onto: Arrival = { ...arrival, landedId: row.id, local: localOf(row.body) };
        ids.set(object.id, row.id);
        if (await differs(object, onto, ids, context)) {
          ids.set(object.id, arrival.landedId);
          continue;
        }
        claimed.add(row.id);
        byFileId.set(object.id, onto);
        next.push(...(referrers.get(object.id) ?? []).filter(isFresh));
        break;
      }
    }
    queue = unique(next);
  }
}

/** Whether the file's object, landed as `arrival` says, is not the one already under that id. */
async function differs(
  object: ArrivalObject,
  arrival: Arrival,
  ids: ReadonlyMap<string, string>,
  context: ArrivalContext,
): Promise<boolean> {
  const { body } = asLanded(object, arrival, ids, context.tags);
  const compared =
    object.schemaId === WORLD_SCHEMA
      ? worldAsMerged(object, body, arrival.landedId, ids, context)
      : body;
  const identity = await identifyNative(
    context.library,
    context.handle,
    object.schemaId,
    compared as { id: string; provenance: Provenance },
  );
  return identity.kind === 'changed';
}

/**
 * ***A World is compared as it would land*** — `landWorld`'s rule, from the
 * same entries by the same reading (`entryKind`): its `contents` merged into
 * the one here, never shrinking it, gaining each member that will land under
 * the id it will land as, and nothing else — no session until [P16.3f] lands
 * one, no member the reader refused, no World, no member the file does not
 * carry unless it is here already. *Counting more than the landing adds* was
 * the review's finding: a ticked session or a damaged member made the World
 * here differ on every keep-both import, and each one made a new World.
 *
 * A **partial** World — the legacy file — lands onto the one here as its
 * name, its version and that list, and is compared so.
 */
export function worldAsMerged(
  object: ArrivalObject,
  body: Record<string, unknown>,
  landedId: string,
  ids: ReadonlyMap<string, string>,
  context: Pick<ArrivalContext, 'library' | 'handle'>,
): Record<string, unknown> {
  let local: World;
  try {
    local = read(context.library, context.handle, landedId, WORLD_SCHEMA).body as World;
  } catch (error) {
    if (error instanceof LibraryError && error.code === 'not-found') return body;
    throw error;
  }
  const incoming: PortableObjectEnvelope[] = [];
  for (const member of membersOf(object)) {
    if (member.refused || entryKind(member, object.id) !== 'member') continue;
    const landed = ids.get(member.fileId);
    if (landed === undefined && !resolvesHere(context, member.fileId, member.schema)) continue;
    incoming.push({ schema: member.schema, id: landed ?? member.fileId });
  }
  const contents = mergeContents(local.contents, incoming);
  if (object.partial === true) {
    return {
      ...local,
      provenance: { ...local.provenance },
      name: body['name'],
      version: body['version'],
      contents,
    };
  }
  return { ...body, contents };
}

/** The World's members in file ids — the reader's, or the body's own `contents`, none refused. */
function membersOf(object: ArrivalObject): readonly WorldMember[] {
  if (object.members !== undefined) return object.members;
  const contents = (object.body as { contents?: unknown }).contents;
  if (!Array.isArray(contents)) return [];
  return contents.flatMap((entry: unknown) => {
    if (!isRecord(entry)) return [];
    const { schema, id, name } = entry;
    if (typeof schema !== 'string' || typeof id !== 'string') return [];
    return [{ fileId: id, schema, name: typeof name === 'string' ? name : null, refused: false }];
  });
}

/** Whether this account already has `id` as a `schema` — a member the file names and does not carry. */
function resolvesHere(
  context: Pick<ArrivalContext, 'library' | 'handle'>,
  id: string,
  schema: string,
): boolean {
  if (!isKnownSchema(schema)) return false;
  try {
    read(context.library, context.handle, id, schema);
    return true;
  } catch (error) {
    if (error instanceof LibraryError && error.code === 'not-found') return false;
    throw error;
  }
}

/**
 * Whether the file's copy of a built-in object is the built-in object: its
 * bytes the same, or its body encoding to the stored file's bytes — the second
 * for a card, whose pixels the file carries as the sender's install had them.
 */
async function sameAsSystem(
  object: ArrivalObject,
  row: { slug: string; contentHash: string },
  library: LibraryContext,
): Promise<boolean> {
  if (object.contentHash !== undefined && object.contentHash === row.contentHash) return true;
  try {
    const encoded = await encodeForCompare(
      library,
      SYSTEM_OWNER,
      object.schemaId,
      row.slug,
      object.body,
    );
    return encoded === row.contentHash;
  } catch {
    // Cannot say: not the same, so it lands as its own copy rather than being
    // taken for the built-in one.
    return false;
  }
}

function localOf(body: unknown): LocalObject {
  const record = isRecord(body) ? body : {};
  const provenance = record['provenance'];
  const tagging: LocalObject['tagging'] = {};
  if ('tags' in record) tagging.tags = record['tags'];
  if ('tagIds' in record) tagging.tagIds = record['tagIds'];
  if (!isRecord(provenance)) return { source: 'manual', originalFilename: null, tagging };
  const source = provenance['source'];
  const originalFilename = provenance['originalFilename'];
  return {
    source: typeof source === 'string' ? (source as Provenance['source']) : 'manual',
    originalFilename: typeof originalFilename === 'string' ? originalFilename : null,
    tagging,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
