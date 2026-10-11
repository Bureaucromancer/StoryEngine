// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  ACTOR_SCHEMA,
  type ImportNote,
  isKnownSchema,
  LIBRARY_DIRECTORIES,
  type ManifestEntry,
  PACKAGE_EXPORT_SCHEMA,
  type PackageExport,
  schemaIdOf,
  slugify,
  upgradeLegacySchema,
  WORLD_FILE_MANIFEST,
  WORLD_FILE_SCHEMA,
  WORLD_SCHEMA,
  type World,
  type WorldFileManifest,
  type WorldFileObject,
} from '@storyengine/shared';

import { contentHashOf } from '../../index-db/ingest.js';
import { blankCardPixels } from '../../library.js';
import { envelope, pngCardCodec } from '../../storage/card/index.js';
import { OBJECT_FILENAMES } from '../../storage/layout.js';
import { MemoryFileSource } from '../memory-source.js';

/**
 * ***The frozen `.sepack.json`, read as a World file*** —
 * [16 §5.1](../../../../../docs/design/16-publish.md),
 * [P11.10](../../../../../docs/design/workplan/28-p11-implementation.md),
 * [P16.3e](../../../../../docs/design/workplan/35-p16-world.md).
 *
 * **It reads both formats** (16 §5.1): P16.3 writes the World's own, and reads
 * `storyengine.package-export/1` beside it, so a file written by P11.10's
 * export — which alpha 5 and alpha 6 shipped, so it is in files a release
 * handed out — imports as a World. ***By the same reader, not a second one***:
 * the envelope is turned into **the root a `.seworld` is** — a manifest first,
 * the World's `world.json`, each object in its kind's folder as its stored file
 * — and `WorldFileReader` reads that, so identity across accounts, the World
 * landing last and naming what landed, and every refusal are one code path for
 * both formats rather than two that drift.
 *
 * **What the old file does not have, and what is made up for it** (the fact
 * check's fact 11: *"the legacy manifest carries no description, requires,
 * provenance, media or metadata"*):
 *
 * - **The World** is built from `manifest` — its id, name and version as the
 *   file says, `contents` the entries it lists (P11.10 lists only what
 *   resolved, so a member missing on the sender's side is not named), and the
 *   rest a new World's blanks, its provenance dated by `exportedBy.at` so the
 *   same file synthesises the same bytes every time. ~~…and imports
 *   `unchanged` the second time.~~ *Corrected 2026-10-11, the P16.3e review*:
 *   determinism is not what makes the second import `unchanged` —
 *   `identifyNative` carries the stored object's timestamps over before it
 *   compares — and the blanks are not the file's: the old format never said
 *   what the World's description, gallery or requirements were. So the root
 *   is a {@link LegacyWorldRoot}, and the reader lands its World onto one here
 *   as **its name, its version and its list, merged**, leaving every field the
 *   file could not carry as it is — where `replace` wrote the blanks over a
 *   person's own World when they imported their old export back.
 * - **No pictures**: P11.10 carried each object's JSON and no pixels
 *   ([16 §5]'s pictures bullet). An actor's JSON is not its card — the card is
 *   the object ([03 §5.2]) — so each actor is synthesised **on the blank card**,
 *   the 1×1 transparent canvas every actor without a portrait has, and says so
 *   on its own row (`import.world.noPortrait`); the file as a whole says it
 *   carried no pictures (`import.world.legacyNoPictures`) on the World's row.
 * - **No sessions** (fact 11: P11.10's writer read members through the
 *   library, where a session is not found), **no history**, nothing left
 *   behind, nothing required.
 * - **Hashes are over the synthesised bytes**, not the sender's: the old file
 *   has none to check, so the manifest's `contentHash` here is what makes the
 *   reader's integrity check pass over bytes it built itself — honest about
 *   what it is, a check of the synthesis rather than of the transport.
 *
 * An object whose kind this build does not know is listed under its own
 * schema, so the reader reports it (`import.world.unknownKind`) rather than
 * dropping it; a World inside it is listed as a World, which the reader never
 * lands as one.
 */

/**
 * ***The root `packageExportRoot` makes*** — a memory root like any other,
 * and a class of its own so the World reader can tell it is reading the
 * synthesis rather than a file: the two notes only the synthesis writes are
 * let through from its manifest and from no other, and its World lands onto
 * one here as the partial thing it is. Known by what the source *is*, which a
 * file cannot claim, never by anything its manifest says, which a file can.
 */
export class LegacyWorldRoot extends MemoryFileSource {}

/** The legacy envelope, if that is what `document` is — or null, and the upload reads it otherwise. */
export function readPackageExport(document: unknown): PackageExport | null {
  if (!isRecord(document) || document['schema'] !== PACKAGE_EXPORT_SCHEMA) return null;
  const exportedBy = document['exportedBy'];
  const manifest = document['manifest'];
  if (!isRecord(exportedBy) || typeof exportedBy['at'] !== 'string') return null;
  if (exportedBy['version'] !== null && typeof exportedBy['version'] !== 'string') return null;
  if (
    !isRecord(manifest) ||
    typeof manifest['id'] !== 'string' ||
    typeof manifest['name'] !== 'string' ||
    typeof manifest['version'] !== 'string' ||
    !Array.isArray(manifest['contents']) ||
    // Each entry a record: P11.10 never wrote anything else, and a `null` here
    // was a 500 from the upload door rather than a refusal (the P16.3e review).
    !(manifest['contents'] as unknown[]).every(isRecord)
  ) {
    return null;
  }
  if (!Array.isArray(document['objects'])) return null;
  return document as unknown as PackageExport;
}

/**
 * ***The root a `.seworld` would be***, in memory — the manifest first (the
 * probe asks for it as the first member), then the World, then each object.
 */
export function packageExportRoot(exported: PackageExport): LegacyWorldRoot {
  const at = validTimestamp(exported.exportedBy.at);
  const folders = new Folders();
  const files = new Map<string, Uint8Array>();
  const rows: WorldFileObject[] = [];
  const omitted: ImportNote[] = [
    { key: 'import.world.legacyNoPictures', params: {}, level: 'info' },
  ];
  // Records only, whoever made the document: `readPackageExport` checks it,
  // and this does not trust that the caller asked it.
  const entries: Partial<ManifestEntry>[] = exported.manifest.contents.filter(isRecord);
  const members = new Set(
    entries.map((entry) => entry.id).filter((id): id is string => typeof id === 'string'),
  );

  exported.objects.forEach((raw, index) => {
    const object = upgradeLegacySchema(raw);
    const schema = schemaIdOf(object);
    const id = stringOf(object, 'id') ?? '';
    const name = stringOf(object, 'name') ?? id;
    const known = schema !== null && isKnownSchema(schema);
    const directory = known ? LIBRARY_DIRECTORIES[schema] : 'other';
    const folder = `library/${directory}/${folders.take(directory, slugify(name) || `object-${String(index + 1)}`)}`;
    const file = `${folder}/${known ? OBJECT_FILENAMES[schema] : 'object.json'}`;
    const bytes =
      schema === ACTOR_SCHEMA
        ? pngCardCodec.write(blankCardPixels(), envelope(object), new Map())
        : json(object);
    files.set(file, bytes);
    rows.push({
      schema: schema ?? '',
      id,
      name,
      folder,
      file,
      contentHash: contentHashOf(bytes),
      member: members.has(id),
    });
    if (schema === ACTOR_SCHEMA) {
      omitted.push({ key: 'import.world.noPortrait', params: { id, actor: name }, level: 'info' });
    }
  });

  const world: World = {
    schema: WORLD_SCHEMA,
    id: exported.manifest.id,
    name: exported.manifest.name,
    version: exported.manifest.version,
    description: '',
    media: [],
    contents: entries.flatMap((entry) =>
      typeof entry.id === 'string' && typeof entry.schema === 'string'
        ? [{ schema: entry.schema, id: entry.id, name: entry.name ?? entry.id }]
        : [],
    ),
    requires: { modes: [], extensions: [], capabilities: [] },
    provenance: {
      source: 'manual',
      creator: null,
      version: null,
      license: null,
      originalFilename: null,
      createdAt: at,
      updatedAt: at,
    },
    metadata: {},
  };
  const worldFolder = `library/${LIBRARY_DIRECTORIES[WORLD_SCHEMA]}/${folders.take('worlds', slugify(world.name) || 'world')}`;
  const worldFile = `${worldFolder}/${OBJECT_FILENAMES[WORLD_SCHEMA]}`;
  const worldBytes = json(world);

  const manifest: WorldFileManifest = {
    schema: WORLD_FILE_SCHEMA,
    exportedBy: { version: exported.exportedBy.version, at: exported.exportedBy.at },
    origin: 'world',
    world: {
      schema: WORLD_SCHEMA,
      id: world.id,
      name: world.name,
      folder: worldFolder,
      file: worldFile,
      contentHash: contentHashOf(worldBytes),
      member: false,
      description: '',
    },
    objects: rows,
    sessions: [],
    leftBehind: [],
    requires: { modes: [], extensions: [], capabilities: [] },
    history: false,
    omitted,
  };

  // The manifest first, as the writer puts it and the head-of-file preview reads it.
  return new LegacyWorldRoot({
    [WORLD_FILE_MANIFEST]: json(manifest),
    [worldFile]: worldBytes,
    ...Object.fromEntries(files),
  });
}

const encoder = new TextEncoder();

/** The library's own JSON spelling — two spaces and a newline — so a synthesised file reads as a stored one. */
function json(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * ***A folder name inside its kind, each once*** — case-folded, as the
 * writer's are. ~~Each name probed from `-2` upwards~~ — *corrected
 * 2026-10-11, the P16.3e review*: a file of N objects all named alike probed
 * N²/2 names, synchronously, in the request (16,000 of them held the event
 * loop for 27 seconds). Each wanted name now remembers the next suffix to
 * try, so a run of one name costs one probe each; a probe still checks the
 * set, because `a-2` may have been taken as a name of its own.
 */
export class Folders {
  readonly #taken = new Set<string>();
  readonly #next = new Map<string, number>();
  #probes = 0;

  /** How many names were tried in all — what the cost test counts. */
  get probes(): number {
    return this.#probes;
  }

  take(directory: string, wanted: string): string {
    const base = `${directory}/${wanted.toLowerCase()}`;
    for (let n = this.#next.get(base) ?? 1; ; n += 1) {
      this.#probes += 1;
      const candidate = n === 1 ? wanted : `${wanted}-${String(n)}`;
      const key = `${directory}/${candidate.toLowerCase()}`;
      if (this.#taken.has(key)) continue;
      this.#taken.add(key);
      this.#next.set(base, n + 1);
      return candidate;
    }
  }
}

/** `exportedBy.at` when it is a moment, else a fixed one — the World must synthesise the same each time. */
function validTimestamp(at: string): string {
  const parsed = Date.parse(at);
  return Number.isNaN(parsed) ? '1970-01-01T00:00:00.000Z' : new Date(parsed).toISOString();
}

function stringOf(value: unknown, key: string): string | null {
  const field = isRecord(value) ? value[key] : undefined;
  return typeof field === 'string' ? field : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
