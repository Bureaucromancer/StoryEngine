// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  type ImportItemReport,
  type ImportNote,
  isKnownSchema,
  type PortableObjectEnvelope,
  readWorldFileManifest,
  validate,
  WORLD_FILE_MANIFEST,
  WORLD_FILE_MANIFEST_MAX_BYTES,
  WORLD_FILE_SESSION_EXPORT,
  WORLD_SCHEMA,
  type World,
  type WorldFileManifest,
  type WorldFileObject,
} from '@storyengine/shared';

import { contentHashOf } from '../../index-db/ingest.js';
import type { LibraryContext } from '../../library.js';
import type { TagStore } from '../../tags/store.js';
import type { ConflictPolicy } from '../identity.js';
import type { FileSource, SourceItem, SourceReader, SourceSurvey } from '../source.js';
import { type LibraryFolderItem, libraryFolderItems } from '../storyengine/library-items.js';
import {
  isWorldSchema,
  type WorldLanding,
  type WorldLandingEntry,
  type WorldMember,
} from './landing.js';
import { LegacyWorldRoot } from './legacy.js';
import { asLanded, type ArrivalObject, type ArrivalPlan, planArrivals } from './plan.js';

/**
 * ***A World file, read as a root*** —
 * [16 §5.1](../../../../../docs/design/16-publish.md),
 * [04 §9](../../../../../docs/design/04-schemas.md),
 * [P16.3e](../../../../../docs/design/workplan/35-p16-world.md).
 *
 * **What arrives**: a stored zip whose first member is the manifest
 * (`storyengine-world.json`), the members' own folders under `library/` laid
 * out as `data/` lays them out, and sessions under `sessions/` (P16.3c's
 * writer, `packaging/world-file.ts`). *First* is the writer's rule; the probe
 * finds the manifest wherever it is (`detect.ts`, corrected 2026-10-11), so a
 * file zipped again, or unpacked to a folder, is read here and not loose. The objects land as library objects; the
 * World lands **last**, naming what landed ([16 §5.1]); the sessions are
 * recorded, and land at [P16.3f].
 *
 * **In this order, and the order is the safety** ([P4 §1.3]: *a refusal after
 * the first object is written is a half-import*):
 *
 * 1. **The manifest is surveyed before anything is read past it.** Missing,
 *    unparseable, not this format, or a later version of it — `/2` would be a
 *    file this build has never seen claiming to be one it has — is
 *    `unknown-format`, and the sweep refuses with the library untouched.
 *    *So is a file that is not one thing* (the P16.3e review, 2026-10-11): an
 *    archive naming a member twice — the zip sources keep the last of a name
 *    while they list the first, so a head-of-file preview and this reader
 *    would read two different manifests — and a manifest listing one file or
 *    one id twice, which no writer of ours writes and which cost one full
 *    validation per row. And every field read *after* a write — `requires`,
 *    which the World's row reads last — is held to its shape here, so nothing
 *    a file says can throw once the first object is in.
 * 2. **Every folder is read**, through the backup reader's parser
 *    (`libraryFolderItems`, extracted for this — one reading of `data/`'s
 *    shape), and each object file is held to the manifest's `contentHash`. A
 *    file whose bytes are not the ones the manifest names is **refused alone**
 *    (`import.world.damaged`) — the zip's CRC is not enforced, here or in any
 *    reader ([P16.3]'s plan, R9), so this is the file's integrity — and the
 *    rest lands. Each picture and each history payload is held to its own
 *    sha256 name the same way, and a damaged one costs that one.
 * 3. **Validated, planned, rewritten** — every object that will land, the
 *    World and any unlisted folder included, through `planArrivals` (which id
 *    each lands under, [P16.3]'s identity table) and `asLanded` (its references
 *    renamed, its provenance stamped or copied, its tags this account's).
 *    *All of it before the first yield*: a reference can only follow a re-mint
 *    the plan already made — ***and the bodies too*** (the P16.3e review): an
 *    object whose rewrite throws is refused alone while nothing is written,
 *    where computing each one as it was yielded let a body nested deep enough
 *    overflow the stack after the objects before it had landed.
 * 4. **Yielded**: the manifest's objects in its order; then any folder it does
 *    not list, landing loose with `import.world.unlisted` — **never as a World**,
 *    so a second `world.json` hand-placed in the file cannot land a set nobody
 *    published; then what the file holds that nothing reads, named; then the
 *    one note for tags dropped; then the sessions; then **the World, last**.
 *
 * ***Re-reads are counted*** (the fact check of 2026-10-10): the zip reader's
 * byte budget is cumulative, and this reads each object file once (its hash
 * taken as it is parsed), each picture and history payload twice (verified
 * here, copied by the Writer), and a card twice (parsed here, its pixels read
 * again by `#native`) — the manifest twice, at survey and here, at most 4 MiB
 * each. `routes/import.ts`'s `landedZipLimits` budgets for that.
 *
 * **An object of a kind this build does not know is reported and not kept**
 * (`import.world.unknownKind`) — [04 §9]'s *"kept, not usable here"* has no
 * library to keep it in; [P16.3]'s plan, §5 Q4, owed a dated note there.
 */

/** The World's landing, handed to the Writer last — `Writer.#worldLanding`. */
export const WORLD_LANDING_FORMAT = 'storyengine.world-landing';

/** A session the file carries — `Writer.#worldSession`, which records it until [P16.3f]. */
export const WORLD_SESSION_FORMAT = 'storyengine.world-session';

/** What a session candidate carries: where it is in the file, and its names. */
export interface WorldSessionPayload {
  fileSessionId: string;
  folder: string;
  name: string;
}

export interface WorldReaderContext {
  library: LibraryContext;
  handle: string;
  policy: ConflictPolicy;
  /** The account's tag registry, which arriving `tagIds` are filtered to; null keeps them. */
  tags: TagStore | null;
}

export class WorldFileReader implements SourceReader {
  readonly kind = 'storyengine-world' as const;
  readonly #files: FileSource;
  readonly #context: WorldReaderContext;
  /** The survey's reading, so the items do not spend the read budget on it twice. */
  #manifest: WorldFileManifest | null = null;

  constructor(files: FileSource, context: WorldReaderContext) {
    this.#files = files;
    this.#context = context;
  }

  async survey(): Promise<SourceSurvey> {
    const manifest = await this.#surveyed();
    if (manifest === null) return { ok: false, refusal: 'unknown-format', notes: [] };
    this.#manifest = manifest;
    return { ok: true, kind: this.kind, notes: [] };
  }

  /** The manifest, if the file is one this build reads as a whole — see the module comment, step 1. */
  async #surveyed(): Promise<WorldFileManifest | null> {
    if ((this.#files.duplicateNames?.() ?? []).length > 0) return null;
    const manifest = await readManifest(this.#files);
    if (manifest === null) return null;
    const rows = [...manifest.objects, ...(manifest.world === null ? [] : [manifest.world])];
    if (new Set(rows.map((row) => row.file)).size !== rows.length) return null;
    if (new Set(rows.map((row) => row.id)).size !== rows.length) return null;
    return { ...manifest, requires: wellFormedRequires(manifest.requires) };
  }

  async *items(): AsyncIterable<SourceItem> {
    const manifest = this.#manifest ?? (await this.#surveyed());
    // The survey refused this already; a caller that skipped it gets nothing.
    if (manifest === null) return;
    const files = this.#files;
    /**
     * ***The legacy file, synthesised in memory*** (`legacy.ts`) — known by
     * the source it is, never by anything the manifest says, since a file can
     * say anything: what it lets through is the two notes only that synthesis
     * writes, and a World that lands onto one here as its name, version and
     * list rather than as blanks.
     */
    const legacy = files instanceof LegacyWorldRoot;

    // ── Every folder, read once ──
    const read = new Map<string, LibraryFolderItem>();
    const folderRows: ImportItemReport[] = [];
    const accounted = new Set<string>([WORLD_FILE_MANIFEST]);
    for await (const one of libraryFolderItems(files, 'library/', { history: true })) {
      if ('observed' in one) {
        folderRows.push(one.observed);
        accounted.add(one.observed.source);
        continue;
      }
      read.set(one.path, one);
      for (const path of [one.path, ...one.assets, ...one.history]) accounted.add(path);
    }

    // ── The manifest's objects, each checked against it ──
    const listed = new Set<string>();
    const order: (Landable | ImportItemReport)[] = [];
    const fileIds = new Set<string>();
    for (const row of manifest.objects) {
      listed.add(row.file);
      const checked = check(row, read.get(row.file), fileIds);
      // The folder's own row for a file the manifest lists says less than this one.
      dropRow(folderRows, row.file);
      order.push(checked);
    }

    let world: Landable | null = null;
    let worldRow: ImportItemReport | null = null;
    if (manifest.world !== null) {
      listed.add(manifest.world.file);
      dropRow(folderRows, manifest.world.file);
      const checked = check(manifest.world, read.get(manifest.world.file), fileIds, true);
      if ('item' in checked) world = checked;
      else worldRow = checked;
    }

    // ── Folders the manifest does not list: loose objects, never a World ──
    const unlisted: (Landable | ImportItemReport)[] = [];
    for (const item of read.values()) {
      if (listed.has(item.path)) continue;
      if (isWorldSchema(item.schemaId)) {
        unlisted.push({
          source: item.path,
          disposition: 'skipped',
          notes: [
            {
              key: 'import.world.nestedWorld',
              params: { name: nameOf(item.body) ?? item.path },
              level: 'info',
            },
          ],
        });
        continue;
      }
      unlisted.push(landable(item, nameOf(item.body) ?? item.path, fileIds, true));
    }

    // ── The World's members, in the file's ids, before anything is planned ──
    const refusedFiles = new Set(
      [...order, ...unlisted]
        .filter((one): one is ImportItemReport => !('item' in one))
        .map((one) => one.source),
    );
    if (world !== null) {
      world.object.members = membersOf(world.object.body, manifest, refusedFiles);
      if (legacy) world.object.partial = true;
    }

    // ── The plan: which id each lands under, before anything is written ──
    const candidates = [...order, ...unlisted, ...(world === null ? [] : [world])].filter(
      (one): one is Landable => 'item' in one,
    );
    const tags =
      this.#context.tags === null
        ? null
        : new Set((await this.#context.tags.read(this.#context.handle)).tags.map((tag) => tag.id));
    const plan = await planArrivals(
      candidates.map((one) => one.object),
      {
        library: this.#context.library,
        handle: this.#context.handle,
        policy: this.#context.policy,
        tags,
      },
    );

    // ── Every body as it will land, still before anything is written ──
    const bodies = new Map<Landable, Landed>();
    const failed = new Map<Landable, ImportItemReport>();
    for (const one of candidates) {
      const arrival = plan.byFileId.get(one.object.id);
      if (arrival === undefined) continue;
      try {
        bodies.set(one, asLanded(one.object, arrival, plan.ids, tags));
      } catch {
        // Refused alone, as a body that does not validate is: the library
        // could not have taken what this could not copy.
        failed.set(one, refused(one.item.path, 'does-not-validate'));
        refusedFiles.add(one.item.path);
      }
    }
    if (world !== null && failed.has(world)) {
      worldRow = failed.get(world) ?? null;
      world = null;
    }
    if (world !== null) world.object.members = membersOf(world.object.body, manifest, refusedFiles);

    const omitted = wellFormedNotes(manifest.omitted, legacy);
    const dropped = { tags: new Set<string>(), objects: 0 };
    const worldTags = world === null ? [] : (bodies.get(world)?.droppedTags ?? []);
    if (worldTags.length > 0) {
      dropped.objects += 1;
      for (const id of worldTags) dropped.tags.add(id);
    }
    // The objects that have a row of their own to say the file's notes about
    // them on; the rest — the World's own pictures, an object left at home —
    // are said on the World's row.
    const ownIds = new Set(candidates.filter((one) => one !== world).map((one) => one.object.id));

    // ── The objects, in the manifest's order; then the unlisted ──
    for (const one of [...order, ...unlisted]) {
      if (!('item' in one)) {
        yield { outcome: 'observed', report: one };
        continue;
      }
      const refusal = failed.get(one);
      if (refusal !== undefined) {
        yield { outcome: 'observed', report: refusal };
        continue;
      }
      yield await this.#candidate(one, plan, bodies.get(one), omitted, dropped);
    }

    // ── What the file holds that nothing above read ──
    for (const report of folderRows) yield { outcome: 'observed', report };
    if (worldRow !== null) yield { outcome: 'observed', report: worldRow };
    const sessionFolders = manifest.sessions.map((session) => `${session.folder}/`);
    for await (const path of files.list()) {
      if (accounted.has(path) || sessionFolders.some((folder) => path.startsWith(folder))) {
        continue;
      }
      yield {
        outcome: 'observed',
        report: {
          source: path,
          disposition: 'skipped',
          notes: [{ key: 'import.world.notRead', params: { file: path }, level: 'info' }],
        },
      };
    }

    // One note for the file, not one per object — see `asLanded`.
    if (dropped.tags.size > 0) {
      yield {
        outcome: 'observed',
        report: {
          source: WORLD_FILE_MANIFEST,
          disposition: 'skipped',
          notes: [
            {
              key: 'import.world.tagsDropped',
              params: { count: dropped.tags.size, objects: dropped.objects },
              level: 'info',
            },
          ],
        },
      };
    }

    // ── The sessions: recorded here, landed from [P16.3f] ──
    for (const session of manifest.sessions) {
      const payload: WorldSessionPayload = {
        fileSessionId: session.id,
        folder: session.folder,
        name: session.name,
      };
      yield {
        outcome: 'candidate',
        candidate: {
          source: `${session.folder}/${WORLD_FILE_SESSION_EXPORT}`,
          format: WORLD_SESSION_FORMAT,
          payload,
        },
      };
    }

    // ── The World, last ──
    if (world === null) return;
    const arrival = plan.byFileId.get(world.object.id);
    const landedWorld = bodies.get(world);
    if (arrival === undefined || landedWorld === undefined) return;
    const body = landedWorld.body as unknown as World;
    const notes: ImportNote[] = [];
    const assets = legacy ? [] : await this.#verifiedAssets(world.item.assets, body.name, notes);
    const landing: WorldLanding = {
      source: world.item.path,
      fileId: world.object.id,
      body,
      arrival,
      entries: entriesOf(world.object.members ?? [], plan),
      requires: manifest.requires,
      omitted: [
        ...notes,
        ...omitted.filter((note) => !ownIds.has(String(note.params['id'] ?? ''))),
      ],
      ...(legacy ? { partial: true } : {}),
    };
    yield {
      outcome: 'candidate',
      candidate: {
        source: world.item.path,
        format: WORLD_LANDING_FORMAT,
        payload: landing,
        ...(assets.length === 0 ? {} : { assets }),
      },
    };
  }

  /** One object, as the Writer's native arm takes it — or the built-in library's own, unwritten. */
  async #candidate(
    one: Landable,
    plan: ArrivalPlan,
    landed: Landed | undefined,
    omitted: readonly ImportNote[],
    dropped: { tags: Set<string>; objects: number },
  ): Promise<SourceItem> {
    const { item, object, name } = one;
    const arrival = plan.byFileId.get(object.id);
    if (arrival === undefined) {
      // A second object of the file under an id the first already took.
      return { outcome: 'observed', report: refused(item.path, 'duplicate-id') };
    }
    const own = omitted.filter((note) => note.params['id'] === object.id);
    if (arrival.decision === 'system' || landed === undefined) {
      return {
        outcome: 'observed',
        report: {
          source: item.path,
          disposition: 'unchanged',
          objectId: arrival.landedId,
          notes: [
            { key: 'import.world.builtIn', params: { object: name }, level: 'info' },
            // Nothing of this object is written, so nothing it lacks is said.
            ...own.filter((note) => !LANDS_NEW_ONLY.has(note.key)),
          ],
        },
      };
    }

    if (landed.droppedTags.length > 0) {
      dropped.objects += 1;
      for (const id of landed.droppedTags) dropped.tags.add(id);
    }

    /**
     * ***A new object, or one here*** — `arrival.local` is null exactly when
     * this lands as an object of its own (`new`, `remint`, keep-both's fresh
     * copy), and only then do what the file did not carry of it, its history,
     * and *kept both* say anything: an object landing onto one here keeps its
     * portrait, its history and its place, and a note that the file's did not
     * come would tell a person their own actor is on a blank card when it is
     * not (the review's `noPortrait` on every row).
     */
    const isNew = arrival.local === null;
    const notes: ImportNote[] = [];
    if (arrival.keptBoth && isNew) {
      notes.push({ key: 'import.object.keptBoth', params: { object: name }, level: 'warn' });
    }
    if (one.unlisted) {
      notes.push({ key: 'import.world.unlisted', params: { file: item.path }, level: 'info' });
    }
    // What the file says it does not carry of this object — a picture too
    // large, an actor's missing portrait — on the object's own row.
    notes.push(...own.filter((note) => isNew || !LANDS_NEW_ONLY.has(note.key)));

    const assets = await this.#verifiedAssets(item.assets, name, notes);

    /**
     * ***History only for an object arriving under the id it was written
     * under, as itself*** ([P16.3]'s plan, §3): every snapshot is a whole body
     * carrying that id, and `update` refuses an id change — so beside a
     * re-minted object it would be versions of something else, and beside an
     * object already here it would be a second history merged into the first,
     * which nobody has asked for.
     *
     * *Said only for keep-both's fresh copy* — whose history stayed behind and
     * which has none of its own, and which is the person's own object, so the
     * note tells them nothing about anybody else's. ~~A re-mint says it too.~~
     * *Corrected 2026-10-11, the P16.3e review*: a re-mint saying it and a new
     * object not saying it was a per-object answer to *does another account
     * hold this id* — the plan's identity rule forbids exactly that — so a
     * re-mint's history stays behind unsaid, as its re-mint is. An object
     * already here (`here`, `prior`) keeps the history it has, and a note that
     * the file's did not come would be noise on every row of a person's own
     * file read back.
     */
    let history: string[] = [];
    if (item.history.length > 0) {
      if (arrival.decision === 'new' && isNew && arrival.landedId === object.id) {
        history = await this.#verifiedHistory(item.history, name, notes);
      } else if (arrival.keptBoth && isNew) {
        notes.push({
          key: 'import.world.historyNotCarried',
          params: { object: name },
          level: 'info',
        });
      }
    }

    return {
      outcome: 'candidate',
      candidate: {
        source: item.path,
        format: 'storyengine.object',
        payload: landed.body,
        ...(assets.length === 0 ? {} : { assets }),
        ...(history.length === 0 ? {} : { history }),
        ...(notes.length === 0 ? {} : { notes }),
      },
    };
  }

  /**
   * ***Each picture held to its own name*** — a content-addressed asset is
   * `<sha256>.<ext>`, so its bytes either are that digest or are not the
   * picture the object's media row names. A damaged one is left behind and
   * said (`import.world.pictureDamaged`); the object lands without it, as a
   * picture missing on disk would read. A name that is not a digest has
   * nothing to be held to, and travels as it is.
   */
  async #verifiedAssets(
    paths: readonly string[],
    object: string,
    notes: ImportNote[],
  ): Promise<string[]> {
    const kept: string[] = [];
    for (const path of paths) {
      const claimed = addressedHex(basenameOf(path));
      if (claimed === null) {
        kept.push(path);
        continue;
      }
      const bytes = await this.#files.read(path);
      if (bytes === null || contentHashOf(bytes) !== `sha256:${claimed}`) {
        notes.push({
          key: 'import.world.pictureDamaged',
          params: { object, file: path },
          level: 'warn',
        });
        continue;
      }
      kept.push(path);
    }
    return kept;
  }

  /**
   * A history whose every payload is the one its name says, or none: an index
   * naming a version whose body did not arrive is a list of versions some of
   * which cannot be restored, and a person cannot tell which. ~~Only the
   * payloads present were held to their names~~ — *corrected 2026-10-11, the
   * P16.3e review*: a file missing one `v/` member carried an index naming it,
   * and the version listed and would not restore. So the index is read too,
   * as `storage/history.ts` reads it, and every digest it names must be among
   * the payloads that arrived whole.
   */
  async #verifiedHistory(
    paths: readonly string[],
    object: string,
    notes: ImportNote[],
  ): Promise<string[]> {
    const damaged = (): string[] => {
      notes.push({ key: 'import.world.historyDamaged', params: { object }, level: 'warn' });
      return [];
    };
    const arrived = new Set<string>();
    let index: string | null = null;
    for (const path of paths) {
      if (basenameOf(path) === 'index.jsonl') {
        index = path;
        continue;
      }
      const claimed = /^([0-9a-f]{64})\.json$/.exec(basenameOf(path))?.[1];
      const bytes = claimed === undefined ? null : await this.#files.read(path);
      if (claimed === undefined || bytes === null || contentHashOf(bytes) !== `sha256:${claimed}`) {
        return damaged();
      }
      arrived.add(claimed);
    }
    if (index !== null) {
      const bytes = await this.#files.read(index);
      if (bytes === null) return damaged();
      for (const digest of indexedDigests(bytes)) if (!arrived.has(digest)) return damaged();
    }
    return [...paths];
  }
}

/** A body as `asLanded` made it. */
type Landed = ReturnType<typeof asLanded>;

/** An object of the file that may land: its folder item, and the plan's view of it. */
interface Landable {
  item: LibraryFolderItem;
  object: ArrivalObject;
  name: string;
  /** In the file, not in its manifest. */
  unlisted: boolean;
}

/**
 * The manifest, or null when there is none this build reads: absent, past its
 * ceiling, not JSON, or `readWorldFileManifest`'s refusal — the wrong schema,
 * a later version, a field a reader acts on missing.
 */
async function readManifest(files: FileSource): Promise<WorldFileManifest | null> {
  const bytes = await files.read(WORLD_FILE_MANIFEST);
  if (bytes === null || bytes.byteLength > WORLD_FILE_MANIFEST_MAX_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const manifest = readWorldFileManifest(parsed);
  return 'refusal' in manifest ? null : manifest;
}

/**
 * ***One manifest row against the file*** — refused alone when it is not what
 * the manifest says, or not something this build can keep; otherwise the
 * object, ready for the plan.
 */
function check(
  row: WorldFileObject,
  item: LibraryFolderItem | undefined,
  fileIds: Set<string>,
  isTheWorld = false,
): Landable | ImportItemReport {
  if (!isTheWorld && isWorldSchema(row.schema)) {
    return {
      source: row.file,
      disposition: 'skipped',
      notes: [{ key: 'import.world.nestedWorld', params: { name: row.name }, level: 'info' }],
    };
  }
  if (!isKnownSchema(row.schema)) {
    return {
      source: row.file,
      disposition: 'skipped',
      notes: [
        {
          key: 'import.world.unknownKind',
          params: { object: row.name, schema: row.schema },
          level: 'info',
        },
      ],
    };
  }
  if (
    item?.contentHash !== row.contentHash ||
    item.schemaId !== row.schema ||
    (item.body as { id?: unknown }).id !== row.id ||
    (isTheWorld && item.schemaId !== WORLD_SCHEMA)
  ) {
    return {
      source: row.file,
      disposition: 'unrecognised',
      notes: [
        {
          key: 'import.world.damaged',
          params: { object: row.name, file: row.file },
          level: 'warn',
        },
      ],
    };
  }
  return landable(item, row.name, fileIds, false);
}

/** A folder item that validates, as the plan takes it — or the row that says why not. */
function landable(
  item: LibraryFolderItem,
  name: string,
  fileIds: Set<string>,
  unlisted: boolean,
): Landable | ImportItemReport {
  if (!validate(item.body).valid) return refused(item.path, 'does-not-validate');
  const id = (item.body as { id: string }).id;
  if (fileIds.has(id)) return refused(item.path, 'duplicate-id');
  fileIds.add(id);
  return {
    item,
    object: {
      id,
      schemaId: item.schemaId,
      body: item.body,
      contentHash: item.contentHash,
    },
    name,
    unlisted,
  };
}

/**
 * ***The World's members, in the file's ids*** — its own `contents`, in its
 * order, each marked when the reader refused the file the manifest lists for
 * it. The plan compares the World by these (`worldAsMerged`) and the landing
 * names by them, so the two read one list.
 */
function membersOf(
  worldBody: unknown,
  manifest: WorldFileManifest,
  refusedFiles: ReadonlySet<string>,
): WorldMember[] {
  const contents = (worldBody as { contents?: unknown }).contents;
  if (!Array.isArray(contents)) return [];
  const fileOf = new Map(manifest.objects.map((row) => [row.id, row.file]));
  const out: WorldMember[] = [];
  for (const entry of contents as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { schema, id, name } = entry as Partial<PortableObjectEnvelope> & { name?: unknown };
    if (typeof schema !== 'string' || typeof id !== 'string') continue;
    const file = fileOf.get(id);
    out.push({
      fileId: id,
      schema,
      name: typeof name === 'string' ? name : null,
      refused: file !== undefined && refusedFiles.has(file),
    });
  }
  return out;
}

/**
 * ***The World's entries, as the landing resolves them*** — each member with
 * the id the plan landed it under: `null` for one the reader refused, and its
 * own id for one the file does not carry (it resolves only if this account
 * already has it).
 */
function entriesOf(members: readonly WorldMember[], plan: ArrivalPlan): WorldLandingEntry[] {
  return members.map((member) => ({
    fileId: member.fileId,
    schema: member.schema,
    name: member.name,
    landedId: member.refused ? null : (plan.ids.get(member.fileId) ?? member.fileId),
  }));
}

/**
 * ***The manifest's `omitted`, kept to what the writers say there*** — a
 * hand-made file can hold anything in it, and each note reaches the review and
 * the import ledger as the person's own record. ~~Kept to what is a note~~ —
 * *corrected 2026-10-11, the P16.3e review*: any key a file liked went through,
 * so a file could put *the world landed* or *replaced your object* on a row
 * that never did either. Now only the World file writer's own vocabulary
 * (`publish.file.*`), the two notes `legacy.ts` synthesises when the root is
 * the legacy synthesis itself, and flat parameters — a string or a finite
 * number, what every sentence's placeholders take.
 */
function wellFormedNotes(notes: readonly unknown[], legacy: boolean): ImportNote[] {
  const out: ImportNote[] = [];
  for (const note of notes) {
    if (typeof note !== 'object' || note === null) continue;
    const { key, params, level } = note as Record<string, unknown>;
    if (typeof key !== 'string' || (level !== 'info' && level !== 'warn')) continue;
    if (!/^publish\.file\.[A-Za-z]+$/.test(key) && !(legacy && LEGACY_NOTES.has(key))) continue;
    if (typeof params !== 'object' || params === null || Array.isArray(params)) continue;
    const flat = Object.entries(params as Record<string, unknown>);
    if (!flat.every(([, value]) => typeof value === 'string' || Number.isFinite(value))) continue;
    out.push({ key, params: Object.fromEntries(flat) as ImportNote['params'], level });
  }
  return out;
}

/** The notes `legacy.ts` writes into the manifest it synthesises — and that only it may. */
const LEGACY_NOTES: ReadonlySet<string> = new Set([
  'import.world.legacyNoPictures',
  'import.world.noPortrait',
]);

/**
 * The notes about what an object *lacks*, which are true only of an object
 * landing as itself — onto one here, the one here keeps what it has.
 */
const LANDS_NEW_ONLY: ReadonlySet<string> = new Set(['import.world.noPortrait']);

/**
 * ***`requires`, kept to its shape*** — what the World's row reads last,
 * after every object is written, so a `null` in its `modes` (which the
 * manifest reader checks only as an array) threw there: a 500 and a
 * half-import (the P16.3e review). Each list kept to what it is a list of.
 */
function wellFormedRequires(requires: World['requires']): World['requires'] {
  const versioned = (list: unknown[]) =>
    list.flatMap((one) => {
      if (typeof one !== 'object' || one === null || Array.isArray(one)) return [];
      const { id, minVersion } = one as Record<string, unknown>;
      return typeof id === 'string' && typeof minVersion === 'string' ? [{ id, minVersion }] : [];
    });
  return {
    modes: versioned(requires.modes),
    extensions: versioned(requires.extensions),
    capabilities: (requires.capabilities as unknown[]).filter(
      (one): one is string => typeof one === 'string',
    ),
  };
}

/** The digests a history index names, read as `storage/history.ts` reads them. */
function indexedDigests(bytes: Uint8Array): string[] {
  const digests: string[] = [];
  for (const line of new TextDecoder().decode(bytes).split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as { id?: unknown; digest?: unknown };
      if (typeof parsed.id === 'string' && typeof parsed.digest === 'string') {
        if (/^[0-9a-f]{64}$/.test(parsed.digest)) digests.push(parsed.digest);
      }
    } catch {
      // A torn line is skipped there, so it names nothing here.
    }
  }
  return digests;
}

function refused(file: string, refusal: string): ImportItemReport {
  return {
    source: file,
    disposition: 'unrecognised',
    notes: [{ key: 'import.file.refused', params: { file, refusal }, level: 'warn' }],
  };
}

/** Takes a folder's own row out for a file a better one will be said about. */
function dropRow(rows: ImportItemReport[], source: string): void {
  const at = rows.findIndex((row) => row.source === source);
  if (at >= 0) rows.splice(at, 1);
}

function nameOf(body: unknown): string | null {
  const name = (body as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : null;
}

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The hex a `<sha256>.<ext>` name claims, or null for any other name. */
function addressedHex(name: string): string | null {
  return /^([0-9a-f]{64})\.[a-z0-9]+$/.exec(name)?.[1] ?? null;
}
