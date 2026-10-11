// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ACTOR_SCHEMA,
  type ImportReport,
  LEGACY_PACKAGE_SCHEMA,
  LOREBOOK_SCHEMA,
  newActor,
  newLoreEntry,
  newLorebook,
  newSetup,
  newTreatment,
  newWorld,
  PRESET_SCHEMA,
  SESSION_SCHEMA,
  SETUP_SCHEMA,
  TREATMENT_SCHEMA,
  uuidv7,
  WORLD_FILE_MANIFEST,
  WORLD_FILE_MANIFEST_MAX_BYTES,
  WORLD_SCHEMA,
  type World,
  type WorldFileManifest,
} from '@storyengine/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ingestFile } from '../../index-db/ingest.js';
import { rowsForId } from '../../index-db/query.js';
import {
  create,
  list,
  read,
  readCardPixels,
  readMedia,
  remove,
  update,
  versionsOf,
} from '../../library.js';
import { storeAsset } from '../../library/assets.js';
import { confirmPublish } from '../../packaging/confirm.js';
import { createSession } from '../../sessions/store.js';
import { makePng, pixelBytes } from '../../storage/card/test-png.js';
import { listTrash, restoreFromTrash } from '../../storage/trash.js';
import { readZipDirectory, readZipEntry } from '../../storage/zip.js';
import { DEFAULT_ZIP_FILE_LIMITS } from '../../storage/zip-file.js';
import { writeStoredZip } from '../../storage/zip-writer.js';
import { DEFAULT_MODE_ID } from '../../mode-registry.js';
import { landedZipLimits, landedZipOptions, openLandedZip } from '../../routes/import.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import type { ConflictPolicy } from '../identity.js';
import { LandedZipSource } from '../landed-source.js';
import { MemoryFileSource } from '../memory-source.js';
import { convertOne, sweep } from '../sweep.js';
import { WorldFileReader } from './reader.js';

/**
 * ***A World file, arriving*** — [P16.3e](../../../../../docs/design/workplan/35-p16-world.md),
 * [16 §5.1](../../../../../docs/design/16-publish.md), [04 §9](../../../../../docs/design/04-schemas.md).
 *
 * **Every file here is one the real writer wrote**: published by
 * `confirmPublish` — the walk, `fileSet`, the plan, the write, as `POST
 * /api/publish` does — and read back through `sweep()` over the archive on
 * disk, opened the way the upload route opens one. A case that needs a file
 * the writer would not write (a damaged byte, a folder nobody listed, a World
 * inside the World) edits a real one and says so.
 *
 * **The stage's end clause is the second describe**: a World file written by
 * one account imports on a second account of the same install as a World
 * naming exactly the members that landed, every reference followed, and the
 * first account's library unchanged byte for byte.
 */

const AT = '2026-10-11T09:00:00.000Z';

let server: TestServer;
let scratch: string;
const opened: LandedZipSource[] = [];

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
  scratch = await mkdtemp(join(tmpdir(), 'se-world-reader-'));
});

afterEach(async () => {
  for (const source of opened.splice(0)) await source.close();
  await server.dispose();
  await rm(scratch, { recursive: true, force: true });
});

interface Sent {
  world: World;
  vera: { id: string; name: string };
  wren: { id: string; name: string };
  harbour: { id: string; name: string };
  lanterns: { id: string; name: string };
  lighthouse: { id: string; name: string };
  bell: { id: string; name: string };
  market: { id: string; name: string };
  session: { id: string; name: string };
  tag: string;
  pictureRef: string;
  /** The World's own gallery picture, as its media row names it. */
  worldPictureRef: string;
}

const refTo = (one: { id: string; name: string }) => ({ id: one.id, name: one.name });

function hook(involves: unknown[], introduces: unknown): Record<string, unknown> {
  return {
    id: uuidv7(),
    title: 'A lantern goes out',
    premise: 'Somebody puts out every lantern on the quay at once.',
    magnitude: 'local',
    involves,
    weight: 1,
    delivery: 'guidance',
    once: true,
    introduces: { actor: introduces, entrances: [], primaryEntranceId: null },
  };
}

/**
 * ***Ned's world***, with a case of every reference [04 §9.1] follows and the
 * ones it does not that a re-mint must follow anyway: a treatment's required
 * lore and cast, a hook's bare `involves` and its `introduces.actor`, an
 * actor's lore, a setup's treatment and cast, a book scoped by `linked` to an
 * actor, and a book scoped by `world` to the World and not a member of it. The
 * book has a gallery picture and a version in its history; the actor a
 * portrait, an expression and a tag; the World a session member nobody ticks.
 */
async function author(on: TestServer = server): Promise<Sent> {
  const library = on.services.library;
  const now = new Date().toISOString();
  await on.services.tags.write('ned', [
    {
      id: 'tag-coast',
      name: 'Coast',
      swatch: null,
      sortOrder: 0,
      folder: 'none',
      hidden: false,
      createdAt: now,
    },
  ]);

  const harbour = {
    ...newLorebook('Harbour'),
    entries: [{ ...newLoreEntry('The quay'), keys: ['quay'], content: 'Stone and salt.' }],
  };
  const made = await create(library, 'ned', harbour, LOREBOOK_SCHEMA);
  const picture = await storeAsset(library, 'ned', harbour.id, makePng(6, 3), 'image/png');
  await update(
    library,
    'ned',
    harbour.id,
    { ...harbour, media: [{ id: 'm1', role: 'map', tags: [], ...picture }] },
    made.contentHash,
  );

  const wren = newActor('Wren');
  await create(library, 'ned', wren, ACTOR_SCHEMA, { cardPixels: makePng(5, 9) });
  const smile = makePng(4, 2);
  const vera = {
    ...newActor('Vera'),
    lore: [refTo(harbour)],
    // Parallel and index-aligned, as the library writes them ([05 §3]).
    tags: ['Coast'],
    tagIds: ['tag-coast'],
    media: [
      {
        id: 'e1',
        role: 'expression' as const,
        label: 'smiling',
        mime: 'image/png',
        digest: `sha256:${createHash('sha256').update(smile).digest('hex')}`,
        bytes: smile.length,
        ref: 'smiling',
        tags: [],
      },
    ],
  };
  await create(library, 'ned', vera, ACTOR_SCHEMA, {
    cardPixels: makePng(8, 1),
    media: new Map([['smiling', smile]]),
  });

  const bell = {
    ...newTreatment('The Drowned Bell'),
    lore: [{ ref: refTo(harbour), required: true }],
    cast: [{ ref: refTo(vera), billing: 'npc' as const, note: 'Keeps the lanterns.' }],
    hooks: [hook([refTo(vera)], refTo(wren))],
  };
  await create(library, 'ned', bell, TREATMENT_SCHEMA);

  const market = {
    ...newSetup('Night Market'),
    treatment: refTo(bell),
    cast: { personaOptions: [refTo(vera)], partyDefault: [refTo(vera)], narrator: refTo(wren) },
    lore: [{ ref: refTo(harbour), required: false }],
  };
  await create(library, 'ned', market, SETUP_SCHEMA);

  const lanterns = { ...newLorebook('Lanterns'), scope: { kind: 'linked', actorIds: [vera.id] } };
  await create(library, 'ned', lanterns, LOREBOOK_SCHEMA);

  const session = await createSession(on.services.sessions, 'ned', { name: 'Night one' });

  const world: World = {
    ...newWorld('Rain City'),
    description: 'A port that is always wet.',
    contents: [
      { schema: ACTOR_SCHEMA, id: vera.id, name: 'Vera' },
      { schema: LOREBOOK_SCHEMA, id: harbour.id, name: 'Harbour' },
      { schema: TREATMENT_SCHEMA, id: bell.id, name: 'The Drowned Bell' },
      { schema: SETUP_SCHEMA, id: market.id, name: 'Night Market' },
      { schema: LOREBOOK_SCHEMA, id: lanterns.id, name: 'Lanterns' },
      { schema: SESSION_SCHEMA, id: session.id, name: 'Night one' },
    ],
  };
  const placed = await create(library, 'ned', world, WORLD_SCHEMA);
  // The World's own picture — a gallery row, carried as every object's are.
  const view = await storeAsset(library, 'ned', world.id, makePng(7, 7), 'image/png');
  await update(
    library,
    'ned',
    world.id,
    { ...world, media: [{ id: 'w1', role: 'gallery', tags: [], ...view }] },
    placed.contentHash,
  );

  const lighthouse = {
    ...newLorebook('Lighthouse'),
    scope: { kind: 'world', worldIds: [world.id] },
  };
  await create(library, 'ned', lighthouse, LOREBOOK_SCHEMA);

  return {
    world,
    vera,
    wren,
    harbour,
    lanterns,
    lighthouse,
    bell,
    market,
    session: { id: session.id, name: 'Night one' },
    tag: 'tag-coast',
    pictureRef: picture.ref,
    worldPictureRef: view.ref,
  };
}

let published = 0;

/** Ned publishes the World as `POST /api/publish` would, and the file is kept here. */
async function publish(
  worldId: string,
  o: { history?: boolean; ticked?: Record<string, boolean>; on?: TestServer } = {},
): Promise<string> {
  const on = o.on ?? server;
  const confirmed = await confirmPublish(
    {
      library: on.services.library,
      sessions: on.services.sessions,
      build: { version: '1.0.0-alpha.7', commit: 'abc1234' },
      freeBytes: () => Promise.resolve(null),
      now: () => new Date(AT),
    },
    'ned',
    { kind: 'world', id: worldId },
    { ticked: o.ticked ?? {}, history: o.history ?? true, keep: 'world' },
  );
  if ('refusal' in confirmed) throw new Error(`the publish refused: ${confirmed.refusal}`);
  published += 1;
  const path = join(scratch, `published-${String(published)}.seworld`);
  await copyFile(confirmed.path, path);
  await confirmed.space.dispose();
  return path;
}

/** The file swept into `handle`'s library, through the archive on disk. */
async function importFile(
  handle: string,
  path: string,
  onConflict?: ConflictPolicy,
  on: TestServer = server,
): Promise<{ ok: true; report: ImportReport } | { ok: false; refusal: string }> {
  // The route's own door for what landed, read budget and all.
  const source = await openLandedZip(on.services, path);
  if (!source.ok) throw new Error(`the archive refused: ${source.refusal}`);
  opened.push(source.source);
  return sweep({
    library: on.services.library,
    sessions: on.services.sessions,
    handle,
    tags: on.services.tags,
    files: source.source,
    ...(onConflict === undefined ? {} : { onConflict }),
  });
}

async function imported(
  handle: string,
  path: string,
  onConflict?: ConflictPolicy,
  on: TestServer = server,
): Promise<ImportReport> {
  const outcome = await importFile(handle, path, onConflict, on);
  if (!outcome.ok) throw new Error(`the sweep refused: ${outcome.refusal}`);
  return outcome.report;
}

/** The objects an account owns — never the built-in library's. */
function own(handle: string, schemaId?: Parameters<typeof list>[2], on: TestServer = server) {
  return list(on.services.library, handle, schemaId).filter(
    (row) => row.owner === `user:${handle}`,
  );
}

/** The World's row: the one that says what the World landed naming. */
function worldRow(report: ImportReport) {
  return report.items.find((row) => row.notes.some((note) => note.key === 'import.world.landed'));
}

function keys(report: ImportReport): string[] {
  return report.items.flatMap((row) => row.notes.map((note) => note.key));
}

/** sha256 of every file under an account's library — what "unchanged byte for byte" is checked against. */
async function fingerprint(handle: string, on: TestServer = server): Promise<Map<string, string>> {
  const root = join(on.dataDir, 'users', handle, 'library');
  const out = new Map<string, string>();
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else
        out.set(
          full.slice(root.length),
          createHash('sha256')
            .update(await readFile(full))
            .digest('hex'),
        );
    }
  }
  await walk(root);
  return out;
}

/** Every string in a value, keys included. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...strings(inner)]);
}

/**
 * ***A real file, edited*** — every member read back, handed to `edit`, and
 * written again by the writer itself, so the result is still a file the
 * readers accept; only what `edit` changes differs.
 */
async function rezip(
  path: string,
  edit: (members: { name: string; bytes: Uint8Array }[]) => { name: string; bytes: Uint8Array }[],
): Promise<string> {
  const bytes = new Uint8Array(await readFile(path));
  const directory = readZipDirectory(bytes);
  if (!directory.ok) throw new Error(directory.refusal);
  const members = directory.entries.map((entry) => ({
    name: entry.name,
    bytes: readZipEntry(bytes, entry)!,
  }));
  published += 1;
  const to = join(scratch, `edited-${String(published)}.seworld`);
  await writeStoredZip(to, edit(members), { mtime: new Date(AT) });
  return to;
}

/** A file's members, as `rezip` reads them. */
async function membersOf(path: string): Promise<{ name: string; bytes: Uint8Array }[]> {
  const bytes = new Uint8Array(await readFile(path));
  const directory = readZipDirectory(bytes);
  if (!directory.ok) throw new Error(directory.refusal);
  return directory.entries.map((entry) => ({
    name: entry.name,
    bytes: readZipEntry(bytes, entry)!,
  }));
}

/**
 * ***Nothing written*** — through the index, and on disk: no library folder
 * for the account at all, so a write that bypassed the index (a picture, a
 * history, a folder made) would show too (the P16.3e review).
 */
async function nothingWritten(handle: string): Promise<void> {
  expect(own(handle)).toEqual([]);
  await expect(stat(join(server.dataDir, 'users', handle, 'library'))).rejects.toThrow();
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** The manifest of a member list, edited, and written back in its place. */
function withManifest(
  members: { name: string; bytes: Uint8Array }[],
  change: (manifest: WorldFileManifest) => void,
): { name: string; bytes: Uint8Array }[] {
  return members.map((member) => {
    if (member.name !== WORLD_FILE_MANIFEST) return member;
    const manifest = JSON.parse(decoder.decode(member.bytes)) as WorldFileManifest;
    change(manifest);
    return { name: member.name, bytes: encoder.encode(JSON.stringify(manifest, null, 2)) };
  });
}

/** A member's JSON replaced, and the manifest's hash for it with it — a file the writer could have written. */
function replaceJson(
  members: { name: string; bytes: Uint8Array }[],
  file: string,
  change: (body: any) => any,
): { name: string; bytes: Uint8Array }[] {
  let hash = '';
  const edited = members.map((member) => {
    if (member.name !== file) return member;
    const bytes = encoder.encode(
      `${JSON.stringify(change(JSON.parse(decoder.decode(member.bytes))), null, 2)}\n`,
    );
    hash = sha256(bytes);
    return { name: member.name, bytes };
  });
  return withManifest(edited, (manifest) => {
    for (const row of [...manifest.objects, ...(manifest.world === null ? [] : [manifest.world])]) {
      if (row.file === file) row.contentHash = hash;
    }
  });
}

function manifestOf(members: { name: string; bytes: Uint8Array }[]): WorldFileManifest {
  const member = members.find((one) => one.name === WORLD_FILE_MANIFEST)!;
  return JSON.parse(decoder.decode(member.bytes)) as WorldFileManifest;
}

function fileOf(members: { name: string; bytes: Uint8Array }[], id: string): string {
  const manifest = manifestOf(members);
  const row = [...manifest.objects, ...(manifest.world === null ? [] : [manifest.world])].find(
    (one) => one.id === id,
  );
  if (row === undefined) throw new Error(`the manifest does not list ${id}`);
  return row.file;
}

// ── A fresh account ─────────────────────────────────────────────────────────

describe('a World file on an install that has none of it', () => {
  it('keeps every id, stamps each as an arrival, and lands the pictures, the history and the World', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const other = await makeTestServer();
    try {
      await setUpAdmin(other, 'amy');
      const report = await imported('amy', path, undefined, other);
      const library = other.services.library;

      // Ids kept, each stamped as an arrival under its own file id.
      for (const one of [
        sent.vera,
        sent.wren,
        sent.harbour,
        sent.lanterns,
        sent.lighthouse,
        sent.bell,
        sent.market,
        sent.world,
      ]) {
        const row = read(library, 'amy', one.id);
        expect(row.owner).toBe('user:amy');
        expect((row.body as any).provenance).toMatchObject({
          source: 'import',
          originalFilename: `seworld:${one.id}`,
        });
      }

      // The portrait is the file's card's: its pixels, and its expression.
      const { bytes: card } = await readCardPixels(library, 'amy', sent.vera.id);
      const zip = new Uint8Array(await readFile(path));
      const directory = readZipDirectory(zip);
      if (!directory.ok) throw new Error(directory.refusal);
      const member = directory.entries.find(
        (entry) => entry.name === 'library/actors/vera/card.png',
      )!;
      const shipped = readZipEntry(zip, member)!;
      const pixels = (png: Uint8Array) => pixelBytes(png).map((chunk) => [...chunk]);
      expect(pixels(card)).toEqual(pixels(shipped));
      const expression = await readMedia(library, 'amy', sent.vera.id, 'e1');
      expect(sha256(expression.bytes)).toBe(expression.digest);

      // The book's gallery picture, and its history, beside it.
      const book = read(library, 'amy', sent.harbour.id);
      const folder = library.layout.folderOf(book.path);
      expect((await stat(join(folder, sent.pictureRef))).isFile()).toBe(true);
      const { versions } = await versionsOf(library, 'amy', sent.harbour.id);
      expect(versions.length).toBeGreaterThan(0);

      // The World, naming exactly the members that landed, in the file's order.
      const world = read(library, 'amy', sent.world.id).body as World;
      expect(world.contents.map((entry) => entry.id)).toEqual([
        sent.vera.id,
        sent.harbour.id,
        sent.bell.id,
        sent.market.id,
        sent.lanterns.id,
      ]);
      expect(worldRow(report)?.notes[0]).toEqual({
        key: 'import.world.landed',
        params: { world: 'Rain City', members: 5, sessions: 0 },
        level: 'info',
      });
      // The book scoped to the World travels and lands loose — not a member.
      expect(read(library, 'amy', sent.lighthouse.id).name).toBe('Lighthouse');
      expect(world.contents.some((entry) => entry.id === sent.lighthouse.id)).toBe(false);

      // The World's own gallery picture, beside the World its row names it in.
      const worldFolder = library.layout.folderOf(read(library, 'amy', sent.world.id).path);
      expect(world.media.map((row) => row.ref)).toEqual([sent.worldPictureRef]);
      expect((await stat(join(worldFolder, sent.worldPictureRef))).isFile()).toBe(true);
    } finally {
      await other.dispose();
    }
  });

  it('says a session it carries is not taken yet, and names it nowhere', async () => {
    const sent = await author();
    const path = await publish(sent.world.id, { ticked: { [sent.session.id]: true } });

    const report = await imported('amy', path);

    expect(report.items).toContainEqual({
      source: `sessions/${sent.session.id}/session-export.json`,
      disposition: 'recorded',
      notes: [
        { key: 'import.world.sessionsNotTaken', params: { session: 'Night one' }, level: 'info' },
      ],
    });
    const world = read(server.services.library, 'amy', worldRow(report)!.objectId!).body as World;
    expect(world.contents.some((entry) => entry.schema === SESSION_SCHEMA)).toBe(false);
  });
});

// ── A second account on one install ────────────────────────────────────────

describe('a World file on a second account of the same install', () => {
  /**
   * ***The stage's end clause.*** Every object Ned published is held by Ned,
   * so `create` would refuse each of Amy's under its own id; the plan re-mints
   * them all, and every reference in the file — through the fields 04 §9.1
   * follows and the scope arms it does not — names Amy's copies.
   */
  it('re-mints every object and follows every reference', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const nedIds = [
      sent.vera,
      sent.wren,
      sent.harbour,
      sent.lanterns,
      sent.lighthouse,
      sent.bell,
      sent.market,
      sent.world,
    ].map((one) => one.id);

    const report = await imported('amy', path);

    const library = server.services.library;
    const byName = (name: string) => {
      const found = own('amy').filter((row) => row.name === name);
      expect(found, name).toHaveLength(1);
      return found[0]!;
    };
    const vera = byName('Vera');
    const wren = byName('Wren');
    const harbour = byName('Harbour');
    const lanterns = byName('Lanterns');
    const lighthouse = byName('Lighthouse');
    const bell = byName('The Drowned Bell');
    const market = byName('Night Market');
    const world = byName('Rain City');

    // Re-minted: not one of Amy's objects carries an id of Ned's.
    for (const row of [vera, wren, harbour, lanterns, lighthouse, bell, market, world]) {
      expect(nedIds).not.toContain(row.id);
    }

    // Followed, through each field.
    const b = bell.body as any;
    expect(b.lore[0].ref.id).toBe(harbour.id);
    expect(b.cast[0].ref.id).toBe(vera.id);
    expect(b.hooks[0].involves[0].id).toBe(vera.id);
    expect(b.hooks[0].introduces.actor.id).toBe(wren.id);
    expect((vera.body as any).lore[0].id).toBe(harbour.id);
    const m = market.body as any;
    expect(m.treatment.id).toBe(bell.id);
    expect(m.cast.personaOptions[0].id).toBe(vera.id);
    expect(m.cast.partyDefault[0].id).toBe(vera.id);
    expect(m.cast.narrator.id).toBe(wren.id);
    expect(m.lore[0].ref.id).toBe(harbour.id);
    expect((lanterns.body as any).scope).toEqual({ kind: 'linked', actorIds: [vera.id] });
    expect((lighthouse.body as any).scope).toEqual({ kind: 'world', worldIds: [world.id] });

    // And nowhere at all: no string, value or key, in anything Amy holds names Ned's ids.
    const leaked = own('amy').flatMap((row) =>
      strings(row.body).filter((text) => nedIds.includes(text)),
    );
    expect(leaked).toEqual([]);

    // The World names Amy's ids, in the file's order.
    expect((world.body as World).contents.map((entry) => entry.id)).toEqual([
      vera.id,
      harbour.id,
      bell.id,
      market.id,
      lanterns.id,
    ]);

    // The re-mint is never said: no note names it, and none differs from what
    // an id nobody held would say — a history written under Ned's ids stays
    // behind *unsaid*, since a note on the re-minted rows alone would answer,
    // per object, which ids another account holds (the P16.3e review).
    expect(keys(report).filter((key) => /remint|another|elsewhere/i.test(key))).toEqual([]);
    expect(keys(report)).not.toContain('import.world.historyNotCarried');
    expect((await versionsOf(library, 'amy', harbour.id)).versions).toEqual([]);

    // And the World's own picture, beside the re-minted World.
    const worldFolder = library.layout.folderOf(world.path);
    expect((await stat(join(worldFolder, sent.worldPictureRef))).isFile()).toBe(true);
  });

  /**
   * ***The first account untouched*** — what makes a re-mint the right answer
   * rather than an overwrite: every file of Ned's library, history and
   * pictures included, hashes as it did before Amy's import, and every one of
   * his objects is still his.
   */
  it('leaves the first account’s library as it was, byte for byte', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const before = await fingerprint('ned');
    const owned = own('ned').map((row) => [row.id, row.contentHash]);

    const report = await imported('amy', path);

    // Amy's import landed — a re-mint gone wrong would fail every create and
    // leave Ned untouched for the wrong reason (the review's precondition).
    expect(worldRow(report)?.disposition).toBe('converted');
    expect(own('amy')).toHaveLength(8);
    expect(await fingerprint('ned')).toEqual(before);
    expect(own('ned').map((row) => [row.id, row.contentHash])).toEqual(owned);
  });

  /**
   * *The fact check's gap*: tag ids name the sender's registry. Amy's lacks
   * Ned's, so Vera lands **un-adopted** — her names kept, no ids — rather than
   * with `tags` and `tagIds` out of step (the P16.3e review), and the file
   * says so once.
   */
  it('lands tags Amy’s registry does not hold as names, with one note for the file', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);

    const report = await imported('amy', path);

    const vera = own('amy', ACTOR_SCHEMA).find((row) => row.name === 'Vera')!;
    expect((vera.body as any).tags).toEqual(['Coast']);
    expect('tagIds' in (vera.body as object)).toBe(false);
    const notes = report.items
      .flatMap((row) => row.notes)
      .filter((note) => note.key === 'import.world.tagsDropped');
    expect(notes).toEqual([
      { key: 'import.world.tagsDropped', params: { count: 1, objects: 1 }, level: 'info' },
    ]);
  });

  /**
   * *Her tags are hers*: Amy tags her arrival with a tag of her own registry,
   * and the same file imported again finds it as it is — the file's tags are
   * not a difference to an object here, or every import would strip hers.
   */
  it('keeps the tags Amy gave an arrival when the same file comes again', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    await imported('amy', path);
    const library = server.services.library;
    await server.services.tags.write('amy', [
      {
        id: 'tag-amy',
        name: 'Rainy',
        swatch: null,
        sortOrder: 0,
        folder: 'none',
        hidden: false,
        createdAt: AT,
      },
    ]);
    const vera = own('amy', ACTOR_SCHEMA).find((row) => row.name === 'Vera')!;
    await update(
      library,
      'amy',
      vera.id,
      { ...(vera.body as object), tags: ['Rainy'], tagIds: ['tag-amy'] },
      vera.contentHash,
    );
    const before = await fingerprint('amy');

    const again = await imported('amy', path);

    const row = again.items.find((one) => one.objectId === vera.id);
    expect(row?.disposition).toBe('unchanged');
    expect(read(library, 'amy', vera.id).body).toMatchObject({
      tags: ['Rainy'],
      tagIds: ['tag-amy'],
    });
    expect(await fingerprint('amy')).toEqual(before);
  });

  it('doubles nothing when Amy imports the same file again', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    await imported('amy', path);
    const first = await fingerprint('amy');
    const count = own('amy').length;

    const again = await imported('amy', path);

    expect(own('amy')).toHaveLength(count);
    expect(await fingerprint('amy')).toEqual(first);
    const objectRows = again.items.filter((row) => row.source.startsWith('library/'));
    expect(objectRows.map((row) => row.disposition)).toEqual(objectRows.map(() => 'unchanged'));
    expect(worldRow(again)?.disposition).toBe('unchanged');
  });

  /**
   * ***A World published again updates the one that arrived*** — the plan's
   * *here + replace: update*, and the case the sweep's default is for: Ned
   * adds a book and rewrites the description, publishes again, and Amy's
   * World takes the new fields and gains the new member after the ones it
   * had, with nothing doubled (the P16.3e review: no test reached this arm).
   */
  it('updates the World that arrived when its sender publishes a newer one', async () => {
    const sent = await author();
    const first = await publish(sent.world.id);
    await imported('amy', first);
    const library = server.services.library;
    const tides = newLorebook('Tides');
    await create(library, 'ned', tides, LOREBOOK_SCHEMA);
    const stored = read(library, 'ned', sent.world.id);
    await update(
      library,
      'ned',
      sent.world.id,
      {
        ...(stored.body as World),
        description: 'Wetter now.',
        contents: [
          ...(stored.body as World).contents,
          { schema: LOREBOOK_SCHEMA, id: tides.id, name: 'Tides' },
        ],
      },
      stored.contentHash,
    );
    const second = await publish(sent.world.id);
    const before = own('amy').map((row) => row.id);
    const held = (own('amy', WORLD_SCHEMA)[0]!.body as World).contents.map((entry) => entry.id);

    const report = await imported('amy', second);

    expect(worldRow(report)?.disposition).toBe('converted');
    const worlds = own('amy', WORLD_SCHEMA);
    expect(worlds).toHaveLength(1);
    const world = worlds[0]!.body as World;
    expect(world.description).toBe('Wetter now.');
    const landedTides = own('amy', LOREBOOK_SCHEMA).find((row) => row.name === 'Tides')!;
    expect(world.contents.map((entry) => entry.id)).toEqual([...held, landedTides.id]);
    // One more object, and nothing else new.
    expect(own('amy').map((row) => row.id)).toEqual(
      expect.arrayContaining([...before, landedTides.id]),
    );
    expect(own('amy')).toHaveLength(before.length + 1);
  });

  /**
   * ***Keep-both compares the World as it will land*** (the P16.3e review): a
   * ticked session and a damaged member are in the file's `contents`, and the
   * landing names neither — so neither may make the World here differ, or
   * every keep-both import of such a file wrote a new World and a new copy of
   * the book scoped to it.
   */
  it('keep-both: a ticked session or a damaged member makes no new World', async () => {
    const sent = await author();
    const ticked = await publish(sent.world.id, { ticked: { [sent.session.id]: true } });
    let damagedFile = '';
    const damaged = await rezip(ticked, (members) => {
      damagedFile = fileOf(members, sent.lanterns.id);
      return members.map((member) => {
        if (member.name !== damagedFile) return member;
        const bytes = Uint8Array.from(member.bytes);
        const at = Buffer.from(bytes).indexOf('"Lanterns"') + 8;
        bytes[at] = 'm'.charCodeAt(0);
        return { name: member.name, bytes };
      });
    });

    for (const path of [ticked, damaged]) {
      await imported('amy', path);
      const count = own('amy').length;
      const before = await fingerprint('amy');

      const kept = await imported('amy', path, 'keep-both');
      const again = await imported('amy', path, 'keep-both');

      expect(own('amy', WORLD_SCHEMA), path).toHaveLength(1);
      expect(own('amy'), path).toHaveLength(count);
      expect(await fingerprint('amy'), path).toEqual(before);
      for (const report of [kept, again]) {
        expect(keys(report), path).not.toContain('import.object.keptBoth');
        expect(worldRow(report)?.disposition, path).toBe('unchanged');
      }
    }
  });

  /**
   * ***A copy is found again*** (the P16.3e review): Amy edits her arrival,
   * so a keep-both import lands the file's copies beside it — and the next
   * keep-both import of the same file finds those copies, rather than the
   * edited arrival that sorts first under the same arrival key, and writes
   * nothing.
   */
  it('keep-both twice: the second import finds the copies the first made', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const library = server.services.library;
    // A book of Amy's own by the same name, so the arrival's folder is
    // `harbour-2` and its copy's `harbour-3` — the order in which the edited
    // arrival is the one `findPriorImport` answers with (the review's case).
    await create(library, 'amy', newLorebook('Harbour'), LOREBOOK_SCHEMA);
    await imported('amy', path);
    const arrival = own('amy', LOREBOOK_SCHEMA).find(
      (row) => (row.body as any).provenance.originalFilename === `seworld:${sent.harbour.id}`,
    )!;
    await update(
      library,
      'amy',
      arrival.id,
      { ...(arrival.body as object), description: 'Amy’s harbour.' },
      arrival.contentHash,
    );

    const first = await imported('amy', path, 'keep-both');
    expect(keys(first)).toContain('import.object.keptBoth');
    const count = own('amy').length;
    const before = await fingerprint('amy');

    const second = await imported('amy', path, 'keep-both');

    expect(own('amy')).toHaveLength(count);
    expect(await fingerprint('amy')).toEqual(before);
    expect(keys(second)).not.toContain('import.object.keptBoth');
    const rows = second.items.filter((row) => row.source.startsWith('library/'));
    expect(rows.map((row) => row.disposition)).toEqual(rows.map(() => 'unchanged'));
  });
});

// ── The sender's own file ───────────────────────────────────────────────────

describe('a World file read back by the account that published it', () => {
  it('reads unchanged, and the World keeps the session it did not send', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const before = await fingerprint('ned');

    const report = await imported('ned', path);

    const library = report.items.filter((row) => row.source.startsWith('library/'));
    expect(library.length).toBeGreaterThan(5);
    expect(library.map((row) => [row.source, row.disposition])).toEqual(
      library.map((row) => [row.source, 'unchanged']),
    );
    expect(await fingerprint('ned')).toEqual(before);
    const world = read(server.services.library, 'ned', sent.world.id).body as World;
    expect(world.contents.some((entry) => entry.id === sent.session.id)).toBe(true);
    // Nothing to say about a history that is the account's own already.
    expect(keys(report)).not.toContain('import.world.historyNotCarried');
  });

  /**
   * *The registry is the account's, the tags on its objects too* (the P16.3e
   * review): Ned deletes a tag from his registry — which leaves his objects
   * alone ([05 §2]'s invariant 4) — and his own file read back is still
   * unchanged, rather than stripping the id from his own Vera.
   */
  it('reads unchanged after a registry entry was deleted since the publish', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    await server.services.tags.write('ned', []);
    const before = await fingerprint('ned');

    const report = await imported('ned', path);

    const rows = report.items.filter((row) => row.source.startsWith('library/'));
    expect(rows.map((row) => [row.source, row.disposition])).toEqual(
      rows.map((row) => [row.source, 'unchanged']),
    );
    expect(await fingerprint('ned')).toEqual(before);
    expect(read(server.services.library, 'ned', sent.vera.id).body).toMatchObject({
      tags: ['Coast'],
      tagIds: ['tag-coast'],
    });
  });

  /**
   * ***Keep-both: the file's references follow its copies.*** The book here
   * was edited after the publish, so the file's book lands beside it as a
   * copy — and the file's actor, treatment, setup and World, which name the
   * file's book, name the copy, and so are copies too. Ned's own are left as
   * they were.
   */
  it('keep-both: references follow the copies, and what was here stays as it was', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const library = server.services.library;
    const book = read(library, 'ned', sent.harbour.id);
    await update(
      library,
      'ned',
      sent.harbour.id,
      { ...(book.body as object), description: 'Edited after.' },
      book.contentHash,
    );
    const before = await fingerprint('ned');

    const report = await imported('ned', path, 'keep-both');

    const two = (name: string) => own('ned').filter((row) => row.name === name);
    const bookCopy = two('Harbour').find((row) => row.id !== sent.harbour.id);
    const veraCopy = two('Vera').find((row) => row.id !== sent.vera.id)!;
    const bellCopy = two('The Drowned Bell').find((row) => row.id !== sent.bell.id)!;
    const worldCopy = two('Rain City').find((row) => row.id !== sent.world.id)!;
    expect(bookCopy?.id).not.toBe(sent.harbour.id);
    expect((veraCopy.body as any).lore[0].id).toBe(bookCopy?.id);
    expect((bellCopy.body as any).lore[0].ref.id).toBe(bookCopy?.id);
    expect((bellCopy.body as any).cast[0].ref.id).toBe(veraCopy.id);
    expect((worldCopy.body as World).contents.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([veraCopy.id, bookCopy?.id, bellCopy.id]),
    );
    // A book that names no copy is the one here — the Wren card names nothing.
    expect(two('Wren')).toHaveLength(1);
    // Ned's own: as they were (the copies are new folders beside them).
    const after = await fingerprint('ned');
    for (const [file, hash] of before) expect(after.get(file), file).toBe(hash);
    expect(keys(report)).toContain('import.object.keptBoth');

    // A copy starts with no history of its own — every snapshot the file
    // carries names the original's id — and says so (the P16.3e review).
    expect((await versionsOf(library, 'ned', bookCopy!.id)).versions).toEqual([]);
    expect(report.items.find((row) => row.objectId === bookCopy!.id)?.notes).toContainEqual({
      key: 'import.world.historyNotCarried',
      params: { object: 'Harbour' },
      level: 'info',
    });
  });

  /**
   * ***Keep-both twice writes nothing the second time*** (the P16.3e review):
   * the original here is what `findById` answers for the file's id, and it
   * differs; the copy the first import made is stamped with the file's
   * arrival key, and is what the second import lands onto.
   */
  it('keep-both twice: the second import finds the copies and writes nothing', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const library = server.services.library;
    const book = read(library, 'ned', sent.harbour.id);
    await update(
      library,
      'ned',
      sent.harbour.id,
      { ...(book.body as object), description: 'Edited after.' },
      book.contentHash,
    );
    await imported('ned', path, 'keep-both');
    const count = own('ned').length;
    const before = await fingerprint('ned');

    const again = await imported('ned', path, 'keep-both');

    expect(own('ned')).toHaveLength(count);
    expect(await fingerprint('ned')).toEqual(before);
    expect(keys(again)).not.toContain('import.object.keptBoth');
  });

  /**
   * ***The manifest anywhere, not only first*** (the P16.3e review). A file
   * zipped again by a tool that sorts its members puts the manifest last;
   * swept as loose files, every `history/v/*.json` was a whole body with the
   * live object's id, and *replace* wound Harbour back to an old version. Read
   * as the World it is, nothing changes.
   */
  it('reads a file whose manifest is not its first member as the World it is', async () => {
    const sent = await author();
    const library = server.services.library;
    for (const description of ['v2', 'v3']) {
      const book = read(library, 'ned', sent.harbour.id);
      await update(
        library,
        'ned',
        sent.harbour.id,
        { ...(book.body as object), description },
        book.contentHash,
      );
    }
    const path = await publish(sent.world.id);
    const last = await rezip(path, (members) => [
      ...members.filter((member) => member.name !== WORLD_FILE_MANIFEST),
      ...members.filter((member) => member.name === WORLD_FILE_MANIFEST),
    ]);
    const before = await fingerprint('ned');

    const report = await imported('ned', last);

    expect(report.source).toBe('storyengine-world');
    expect((read(library, 'ned', sent.harbour.id).body as any).description).toBe('v3');
    expect(await fingerprint('ned')).toEqual(before);
  });

  /** *Skip* adds the members the World here lacks, and changes nothing else. */
  it('skip: the World here gains the members it lacks, and keeps its own edits', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const library = server.services.library;
    const stored = read(library, 'ned', sent.world.id);
    const without = (stored.body as World).contents.filter(
      (entry) => entry.id !== sent.lanterns.id,
    );
    await update(
      library,
      'ned',
      sent.world.id,
      { ...(stored.body as World), contents: without, description: 'Mine now.' },
      stored.contentHash,
    );

    const report = await imported('ned', path, 'skip');

    const world = read(library, 'ned', sent.world.id).body as World;
    expect(world.contents.map((entry) => entry.id)).toEqual([
      ...without.map((entry) => entry.id),
      sent.lanterns.id,
    ]);
    expect(world.description).toBe('Mine now.');
    expect(worldRow(report)?.notes.map((note) => note.key)).toContain(
      'import.object.differsAndKept',
    );
  });
});

// ── The World's own row ─────────────────────────────────────────────────────

describe('what the World’s row says', () => {
  /**
   * ***`requires` is a warning, never a block*** ([04 §9]): a mode the file
   * asks for that this install does not have, or has older, is said once —
   * and the World lands anyway. A mode it has, new enough, says nothing.
   */
  it('warns of a mode this install lacks or has older, and lands the World anyway', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const edited = await rezip(path, (members) =>
      withManifest(members, (manifest) => {
        manifest.requires.modes = [
          { id: 'storyengine.no-such-mode', minVersion: '1.0.0' },
          { id: DEFAULT_MODE_ID, minVersion: '999.0.0' },
          { id: DEFAULT_MODE_ID, minVersion: '0.0.0' },
        ];
      }),
    );

    const report = await imported('amy', edited);

    const landed = worldRow(report)!;
    expect(landed.disposition).toBe('converted');
    expect(landed.notes.filter((note) => note.key === 'import.world.requiresMode')).toEqual([
      {
        key: 'import.world.requiresMode',
        params: { mode: 'storyengine.no-such-mode', minVersion: '1.0.0' },
        level: 'warn',
      },
      {
        key: 'import.world.requiresMode',
        params: { mode: DEFAULT_MODE_ID, minVersion: '999.0.0' },
        level: 'warn',
      },
    ]);
  });

  /**
   * ***Nothing a manifest says can throw after the first write*** (the P16.3e
   * review): `requires` is read by the World's row, last, and a `null` in
   * `modes` — which the manifest reader checks only as an array — threw there
   * with every object already in: a 500, a half-import, nothing recorded.
   */
  it('lands the World when `requires` holds what is not a requirement', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const edited = await rezip(path, (members) =>
      withManifest(members, (manifest) => {
        (manifest.requires as any).modes = [null, 7, { id: 'storyengine.no-such-mode' }, 'x'];
        (manifest.requires as any).extensions = [null];
        (manifest.requires as any).capabilities = [null, 'cap.real'];
        manifest.requires.modes.push({ id: 'storyengine.no-such-mode', minVersion: '1.0.0' });
      }),
    );

    const report = await imported('amy', edited);

    expect(worldRow(report)?.disposition).toBe('converted');
    expect(own('amy', WORLD_SCHEMA)).toHaveLength(1);
    expect(
      worldRow(report)?.notes.filter((note) => note.key === 'import.world.requiresMode'),
    ).toEqual([
      {
        key: 'import.world.requiresMode',
        params: { mode: 'storyengine.no-such-mode', minVersion: '1.0.0' },
        level: 'warn',
      },
    ]);
  });

  /**
   * ***A file's `omitted` says what the writer says there, and nothing else***
   * (the P16.3e review): a hand-made manifest put *the world landed* on an
   * actor's row and *replaced your object* on another's, and the ledger kept
   * them. Only `publish.file.*` notes, with flat parameters, reach the review.
   */
  it('keeps the manifest’s notes to the writer’s own vocabulary', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const edited = await rezip(path, (members) =>
      withManifest(members, (manifest) => {
        manifest.omitted.push(
          {
            key: 'import.world.landed',
            params: { id: sent.harbour.id, world: 'Totally Different', members: 99, sessions: 7 },
            level: 'info',
          },
          {
            key: 'import.object.replaced',
            params: { id: sent.vera.id, object: 'Your Own Diary' },
            level: 'warn',
          },
          { key: 'import.file.notStored', params: { object: 'Everything' }, level: 'warn' },
          // The legacy synthesis's own note, which only that synthesis may write.
          {
            key: 'import.world.noPortrait',
            params: { id: sent.vera.id, actor: 'Vera' },
            level: 'info',
          },
          // A writer's key with a parameter that is not flat.
          {
            key: 'publish.file.pictureMissing',
            params: { id: sent.harbour.id, ref: { x: 1 } } as any,
            level: 'info',
          },
          // And one the writer does write, kept.
          {
            key: 'publish.file.pictureMissing',
            params: { id: sent.harbour.id, name: 'Harbour', ref: 'assets/gone.png' },
            level: 'info',
          },
        );
      }),
    );

    const report = await imported('amy', edited);

    const said = report.items.flatMap((row) => row.notes);
    expect(said.filter((note) => note.key === 'import.world.landed')).toHaveLength(1);
    expect(worldRow(report)?.notes[0]?.params).toMatchObject({ world: 'Rain City' });
    expect(keys(report)).not.toContain('import.object.replaced');
    expect(keys(report)).not.toContain('import.file.notStored');
    expect(keys(report)).not.toContain('import.world.noPortrait');
    expect(said.filter((note) => note.key === 'publish.file.pictureMissing')).toEqual([
      {
        key: 'publish.file.pictureMissing',
        params: { id: sent.harbour.id, name: 'Harbour', ref: 'assets/gone.png' },
        level: 'info',
      },
    ]);
  });
});

// ── Through the door a person uses ──────────────────────────────────────────

describe('a World file through the upload door', () => {
  it('lands as a World through POST /api/import/file', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const other = await makeTestServer();
    try {
      await setUpAdmin(other, 'ned');
      const boundary = '----storyengineWorldBoundary';
      const payload = Buffer.concat([
        Buffer.from(
          [
            `--${boundary}`,
            'Content-Disposition: form-data; name="file"; filename="rain-city.seworld"',
            'Content-Type: application/zip',
            '',
            '',
          ].join('\r\n'),
        ),
        await readFile(path),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const response = await other.request({
        method: 'POST',
        url: '/api/import/file',
        payload,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      });

      expect(response.status).toBe(201);
      expect(response.body.report.source).toBe('storyengine-world');
      const world = read(other.services.library, 'ned', sent.world.id, WORLD_SCHEMA).body as World;
      expect(world.contents.map((entry) => entry.name)).toEqual([
        'Vera',
        'Harbour',
        'The Drowned Bell',
        'Night Market',
        'Lanterns',
      ]);
    } finally {
      await other.dispose();
    }
  });

  /**
   * ***The read budget counts re-reads*** (the fact check of 2026-10-10): a
   * World file is stored, so its members come to about the bytes that landed,
   * and the reader reads a picture or a card twice and the manifest twice —
   * so the budget must hold two passes and both manifests, at any size, and
   * stays the zip reader's own for a small upload.
   */
  it('budgets a landed archive for two passes over it and the manifest twice', async () => {
    const MiB = 1024 * 1024;
    for (const landed of [1, 100, 300, 1024].map((n) => n * MiB)) {
      const { maxReadTotalBytes } = landedZipLimits(server.services, landed);
      expect(maxReadTotalBytes, String(landed)).toBeGreaterThanOrEqual(
        2 * landed + 2 * WORLD_FILE_MANIFEST_MAX_BYTES,
      );
    }
    expect(landedZipLimits(server.services, MiB).maxReadTotalBytes).toBe(
      DEFAULT_ZIP_FILE_LIMITS.maxReadTotalBytes,
    );

    // ***And the door passes what landed*** (the P16.3e review): the options
    // the upload route opens an archive with, for a file of 300 MiB on disk —
    // sparse, so it costs no room — budget for it, where a door that stopped
    // passing the size would hand every archive the zip reader's own 256 MiB.
    const sparse = join(scratch, 'landed.zip');
    await writeFile(sparse, '');
    await truncate(sparse, 300 * MiB);
    const { limits } = await landedZipOptions(server.services, sparse);
    expect(limits.maxReadTotalBytes).toBeGreaterThanOrEqual(
      2 * 300 * MiB + 2 * WORLD_FILE_MANIFEST_MAX_BYTES,
    );
  });
});

// ── Refused, alone ──────────────────────────────────────────────────────────

describe('what a World file holds that does not land', () => {
  it('does not name a member that does not validate, and lands the rest', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const edited = await rezip(path, (members) =>
      replaceJson(members, fileOf(members, sent.bell.id), (body) => ({ ...body, framing: 42 })),
    );

    const report = await imported('amy', edited);

    const bellRow = report.items.find((row) => row.source.startsWith('library/treatments/'));
    expect(bellRow).toMatchObject({ disposition: 'unrecognised' });
    expect(bellRow?.notes[0]).toMatchObject({
      key: 'import.file.refused',
      params: { refusal: 'does-not-validate' },
    });
    expect(own('amy', TREATMENT_SCHEMA)).toEqual([]);
    const world = read(server.services.library, 'amy', worldRow(report)!.objectId!).body as World;
    expect(world.contents.map((entry) => entry.name)).toEqual([
      'Vera',
      'Harbour',
      'Night Market',
      'Lanterns',
    ]);
    expect(worldRow(report)?.notes).toContainEqual({
      key: 'import.world.memberNotLanded',
      params: { member: 'The Drowned Bell' },
      level: 'warn',
    });
  });

  /**
   * ***A damaged object is refused alone*** — one byte of the stored member
   * changed, the manifest left as the writer wrote it: the zip readers check
   * no CRC, so the manifest's sha256 is the only thing that can tell.
   */
  it('refuses a damaged object alone, and lands everything else', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    let damagedFile = '';
    const edited = await rezip(path, (members) => {
      damagedFile = fileOf(members, sent.lanterns.id);
      return members.map((member) => {
        if (member.name !== damagedFile) return member;
        // One byte, inside the book's name: still JSON, still a valid book of
        // the same size — only the manifest's hash can tell it is not the one
        // that was sent.
        const bytes = Uint8Array.from(member.bytes);
        const at = Buffer.from(bytes).indexOf('"Lanterns"') + 8;
        bytes[at] = 'm'.charCodeAt(0);
        return { name: member.name, bytes };
      });
    });

    const report = await imported('amy', edited);

    expect(report.items.find((row) => row.source === damagedFile)).toEqual({
      source: damagedFile,
      disposition: 'unrecognised',
      notes: [
        {
          key: 'import.world.damaged',
          params: { object: 'Lanterns', file: damagedFile },
          level: 'warn',
        },
      ],
    });
    expect(
      own('amy')
        .map((row) => row.name)
        .sort(),
    ).toEqual(
      [
        'Harbour',
        'Lighthouse',
        'Night Market',
        'Rain City',
        'The Drowned Bell',
        'Vera',
        'Wren',
      ].sort(),
    );
    expect(own('amy').map((row) => row.name)).not.toContain('Lanterms');
    const world = read(server.services.library, 'amy', worldRow(report)!.objectId!).body as World;
    expect(world.contents.map((entry) => entry.name)).not.toContain('Lanterns');
  });

  /**
   * ***A body nested deeper than a stack is refused alone, or lands — never
   * thrown*** (the P16.3e review). `metadata` is open, so a book can carry a
   * value ten thousand levels deep that parses and validates; the rewrite ran
   * as each object was yielded, recursed once per level, and overflowed after
   * the objects before it had landed — a half-import with no report.
   */
  it('takes a body nested ten thousand deep without a half-import', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    let deepFile = '';
    const edited = await rezip(path, (members) => {
      deepFile = fileOf(members, sent.lanterns.id);
      const member = members.find((one) => one.name === deepFile)!;
      const body = JSON.parse(decoder.decode(member.bytes));
      const depth = 10_000;
      const text = JSON.stringify({ ...body, metadata: { deep: '§' } }).replace(
        '"§"',
        `${'['.repeat(depth)}"${sent.vera.id}"${']'.repeat(depth)}`,
      );
      const bytes = encoder.encode(text);
      return withManifest(
        members.map((one) => (one.name === deepFile ? { name: one.name, bytes } : one)),
        (manifest) => {
          for (const row of manifest.objects)
            if (row.file === deepFile) row.contentHash = sha256(bytes);
        },
      );
    });

    const report = await imported('amy', edited);

    // Everything before it landed, and so did everything after it: the World too.
    const names = own('amy').map((row) => row.name);
    for (const name of ['Vera', 'Harbour', 'The Drowned Bell', 'Night Market', 'Rain City']) {
      expect(names, name).toContain(name);
    }
    const row = report.items.find((one) => one.source === deepFile);
    expect(['converted', 'unrecognised']).toContain(row?.disposition);
    expect(worldRow(report)?.disposition).toBe('converted');
  });

  /**
   * ***A history payload is held to its own name*** — a byte of one version
   * changed: the book lands, and its history does not, said once.
   */
  it('leaves a damaged history behind and lands its book', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const edited = await rezip(path, (members) =>
      members.map((member) => {
        if (!member.name.startsWith('library/lorebooks/harbour/history/v/')) return member;
        const bytes = Uint8Array.from(member.bytes);
        bytes[bytes.length - 2] = bytes[bytes.length - 2]! ^ 0x01;
        return { name: member.name, bytes };
      }),
    );
    const other = await makeTestServer();
    try {
      await setUpAdmin(other, 'amy');
      const report = await imported('amy', edited, undefined, other);

      const row = report.items.find((one) => one.objectId === sent.harbour.id);
      expect(row?.disposition).toBe('converted');
      expect(row?.notes).toContainEqual({
        key: 'import.world.historyDamaged',
        params: { object: 'Harbour' },
        level: 'warn',
      });
      expect((await versionsOf(other.services.library, 'amy', sent.harbour.id)).versions).toEqual(
        [],
      );
    } finally {
      await other.dispose();
    }
  });

  /**
   * ***An index naming a version that did not arrive*** carries no history:
   * a list of versions some of which cannot be restored is not one a person
   * can use (the P16.3e review: the index was not read).
   */
  it('carries no history whose index names a version the file lacks', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const edited = await rezip(path, (members) =>
      members.filter((member) => !member.name.startsWith('library/lorebooks/harbour/history/v/')),
    );
    const other = await makeTestServer();
    try {
      await setUpAdmin(other, 'amy');
      const report = await imported('amy', edited, undefined, other);

      const row = report.items.find((one) => one.objectId === sent.harbour.id);
      expect(row?.notes).toContainEqual({
        key: 'import.world.historyDamaged',
        params: { object: 'Harbour' },
        level: 'warn',
      });
      expect((await versionsOf(other.services.library, 'amy', sent.harbour.id)).versions).toEqual(
        [],
      );
    } finally {
      await other.dispose();
    }
  });

  /** *A picture is held to its own name*: a damaged one costs that one picture. */
  it('leaves a damaged picture behind and lands its book', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const picture = sent.pictureRef.replace('assets/', '');
    const edited = await rezip(path, (members) =>
      members.map((member) => {
        if (!member.name.endsWith(`/assets/${picture}`)) return member;
        const bytes = Uint8Array.from(member.bytes);
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
        return { name: member.name, bytes };
      }),
    );

    const report = await imported('amy', edited);

    const row = report.items.find((one) => one.source.startsWith('library/lorebooks/harbour/'));
    expect(row?.disposition).toBe('converted');
    expect(row?.notes).toContainEqual({
      key: 'import.world.pictureDamaged',
      params: { object: 'Harbour', file: `library/lorebooks/harbour/assets/${picture}` },
      level: 'warn',
    });
    const book = own('amy', LOREBOOK_SCHEMA).find((one) => one.name === 'Harbour')!;
    const folder = server.services.library.layout.folderOf(book.path);
    await expect(stat(join(folder, sent.pictureRef))).rejects.toThrow();
  });

  /**
   * ***A folder the manifest does not list lands loose — and a World among
   * them never lands as one*** (the fact check's fact 12): a second
   * `world.json` hand-placed in the file would otherwise be a set nobody
   * published.
   */
  it('lands an unlisted folder as a loose object, and never an unlisted World', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const stray = newLorebook('Stray');
    const inner: World = {
      ...newWorld('Inner City'),
      contents: [{ schema: LOREBOOK_SCHEMA, id: stray.id, name: 'Stray' }],
    };
    const edited = await rezip(path, (members) => [
      ...members,
      {
        name: 'library/lorebooks/stray/lorebook.json',
        bytes: encoder.encode(JSON.stringify(stray)),
      },
      { name: 'library/worlds/inner/world.json', bytes: encoder.encode(JSON.stringify(inner)) },
      // And a file that is nothing at all, which is named rather than passed over.
      { name: 'notes.txt', bytes: encoder.encode('remember the lanterns') },
    ]);

    const report = await imported('amy', edited);

    expect(report.items).toContainEqual({
      source: 'notes.txt',
      disposition: 'skipped',
      notes: [{ key: 'import.world.notRead', params: { file: 'notes.txt' }, level: 'info' }],
    });

    expect(
      report.items.find((row) => row.source === 'library/lorebooks/stray/lorebook.json'),
    ).toMatchObject({
      disposition: 'converted',
      notes: [{ key: 'import.world.unlisted' }],
    });
    expect(own('amy', LOREBOOK_SCHEMA).map((row) => row.name)).toContain('Stray');
    expect(own('amy', WORLD_SCHEMA).map((row) => row.name)).toEqual(['Rain City']);
    expect(
      report.items.find((row) => row.source === 'library/worlds/inner/world.json'),
    ).toMatchObject({
      disposition: 'skipped',
      notes: [{ key: 'import.world.nestedWorld', params: { name: 'Inner City' } }],
    });
    // Not a member: the World names what it published.
    const world = read(server.services.library, 'amy', worldRow(report)!.objectId!).body as World;
    expect(world.contents.map((entry) => entry.name)).not.toContain('Stray');
  });

  /**
   * *Nested World envelopes never land*, whichever name the kind goes by —
   * and the case that matters is one that **would resolve**: Worlds the
   * importing account already holds, named by id, so only the landing's own
   * filter keeps them out (`addMembers` is not on the create path, the fact
   * check's fact 12). One under the legacy name, and the World's own id.
   */
  it('never names a World inside the World, in either name, even one that is here', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const library = server.services.library;
    const inner = newWorld('Inner City');
    const older = newWorld('Old Package');
    await create(library, 'amy', inner, WORLD_SCHEMA);
    await create(library, 'amy', older, WORLD_SCHEMA);
    const edited = await rezip(path, (members) =>
      replaceJson(members, fileOf(members, sent.world.id), (body) => ({
        ...body,
        contents: [
          ...body.contents,
          { schema: WORLD_SCHEMA, id: inner.id, name: 'Inner City' },
          { schema: LEGACY_PACKAGE_SCHEMA, id: older.id, name: 'Old Package' },
          { schema: WORLD_SCHEMA, id: sent.world.id, name: 'Rain City' },
        ],
      })),
    );

    const report = await imported('amy', edited);

    const landed = worldRow(report)!;
    const world = read(library, 'amy', landed.objectId!).body as World;
    expect(world.contents.map((entry) => entry.name)).toEqual([
      'Vera',
      'Harbour',
      'The Drowned Bell',
      'Night Market',
      'Lanterns',
    ]);
    const nested = landed.notes.filter((note) => note.key === 'import.world.nestedWorld');
    expect(nested.map((note) => note.params['name'])).toEqual([
      'Inner City',
      'Old Package',
      'Rain City',
    ]);
  });

  /** *And a World listed as an object of the file* is not one either. */
  it('never lands a World the manifest lists among its objects', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const inner = newWorld('Inner City');
    const edited = await rezip(path, (members) => {
      const bytes = encoder.encode(`${JSON.stringify(inner, null, 2)}\n`);
      return withManifest(
        [...members, { name: 'library/worlds/inner/world.json', bytes }],
        (manifest) => {
          manifest.objects.push({
            schema: WORLD_SCHEMA,
            id: inner.id,
            name: 'Inner City',
            folder: 'library/worlds/inner',
            file: 'library/worlds/inner/world.json',
            contentHash: sha256(bytes),
            member: false,
          });
        },
      );
    });

    const report = await imported('amy', edited);

    expect(own('amy', WORLD_SCHEMA).map((row) => row.name)).toEqual(['Rain City']);
    expect(report.items.find((row) => row.source === 'library/worlds/inner/world.json')).toEqual({
      source: 'library/worlds/inner/world.json',
      disposition: 'skipped',
      notes: [{ key: 'import.world.nestedWorld', params: { name: 'Inner City' }, level: 'info' }],
    });
  });
});

// ── The built-in library ────────────────────────────────────────────────────

describe('a built-in object in a World file', () => {
  it('is not written when it is the built-in one, and is its own copy when it differs', async () => {
    const sent = await author();
    const library = server.services.library;
    const system = list(library, 'ned', PRESET_SCHEMA).find((row) => row.owner === 'system')!;
    const stored = read(library, 'ned', sent.world.id);
    await update(
      library,
      'ned',
      sent.world.id,
      {
        ...(stored.body as World),
        contents: [
          ...(stored.body as World).contents,
          { schema: PRESET_SCHEMA, id: system.id, name: system.name },
        ],
      },
      stored.contentHash,
    );
    const path = await publish(sent.world.id, { ticked: { [system.id]: true } });

    const same = await imported('amy', path);

    expect(same.items.find((row) => row.objectId === system.id)).toMatchObject({
      disposition: 'unchanged',
      notes: [{ key: 'import.world.builtIn', params: { object: system.name } }],
    });
    expect(own('amy', PRESET_SCHEMA)).toEqual([]);
    const world = read(library, 'amy', worldRow(same)!.objectId!).body as World;
    expect(world.contents.map((entry) => entry.id)).toContain(system.id);

    const differing = await rezip(path, (members) =>
      replaceJson(members, fileOf(members, system.id), (body) => ({
        ...body,
        blurb: 'Tuned elsewhere.',
      })),
    );
    const other = await imported('bea', differing);
    const copies = own('bea', PRESET_SCHEMA);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.id).not.toBe(system.id);
    expect((copies[0]!.body as any).blurb).toBe('Tuned elsewhere.');
    const theirs = read(library, 'bea', worldRow(other)!.objectId!).body as World;
    expect(theirs.contents.map((entry) => entry.id)).toContain(copies[0]!.id);
    expect(theirs.contents.map((entry) => entry.id)).not.toContain(system.id);
  });
});

// ── Refused before anything is written ──────────────────────────────────────

describe('a manifest this build does not read', () => {
  it.each([
    [
      'a later version',
      (manifest: WorldFileManifest) => ({ ...manifest, schema: 'storyengine.world-file/2' }),
    ],
    [
      'another format',
      (manifest: WorldFileManifest) => ({ ...manifest, schema: 'storyengine.package-export/1' }),
    ],
    [
      'one missing what a reader acts on',
      (manifest: WorldFileManifest) => ({ ...manifest, objects: undefined }),
    ],
  ])('is unknown-format, and nothing is written: %s', async (_name, change) => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const edited = await rezip(path, (members) =>
      members.map((member) =>
        member.name === WORLD_FILE_MANIFEST
          ? {
              name: member.name,
              bytes: encoder.encode(JSON.stringify(change(manifestOf(members)))),
            }
          : member,
      ),
    );

    expect(await importFile('amy', edited)).toEqual({ ok: false, refusal: 'unknown-format' });
    await nothingWritten('amy');
  });

  it('is unknown-format when the manifest is not JSON, or not there at all', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const torn = await rezip(path, (members) =>
      members.map((member) =>
        member.name === WORLD_FILE_MANIFEST
          ? { name: member.name, bytes: encoder.encode('{ torn') }
          : member,
      ),
    );
    expect(await importFile('amy', torn)).toEqual({ ok: false, refusal: 'unknown-format' });
    await nothingWritten('amy');

    // Without the manifest the probe does not call it a World at all; a
    // reader handed one anyway still refuses before reading a folder.
    const bare = await rezip(path, (members) =>
      members.filter((member) => member.name !== WORLD_FILE_MANIFEST),
    );
    const source = await LandedZipSource.open(bare, {
      layout: server.services.layout,
      limits: DEFAULT_ZIP_FILE_LIMITS,
    });
    if (!source.ok) throw new Error(source.refusal);
    opened.push(source.source);
    const reader = new WorldFileReader(source.source, {
      library: server.services.library,
      handle: 'amy',
      policy: 'replace',
      tags: server.services.tags,
    });
    expect(await reader.survey()).toEqual({ ok: false, refusal: 'unknown-format', notes: [] });
    await nothingWritten('amy');
  });

  /**
   * ***A manifest listing one file twice is not one this build reads*** (the
   * P16.3e review). No writer of ours writes one, and each row was validated
   * in full — a hostile file listing one large book thousands of times held
   * the event loop for seconds per thousand. Refused at the survey, before a
   * byte past the manifest is read.
   */
  it('is unknown-format when the manifest lists a file or an id twice', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const twice = await rezip(path, (members) =>
      withManifest(members, (manifest) => {
        const row = manifest.objects.find((one) => one.id === sent.harbour.id)!;
        for (let n = 0; n < 50; n += 1) manifest.objects.push({ ...row });
      }),
    );
    const sameId = await rezip(path, (members) =>
      withManifest(members, (manifest) => {
        const row = manifest.objects.find((one) => one.id === sent.harbour.id)!;
        manifest.objects.push({ ...row, file: `${row.folder}/again.json` });
      }),
    );

    expect(await importFile('amy', twice)).toEqual({ ok: false, refusal: 'unknown-format' });
    expect(await importFile('amy', sameId)).toEqual({ ok: false, refusal: 'unknown-format' });
    await nothingWritten('amy');
  });

  /**
   * ***An archive naming a member twice is not one file*** (the P16.3e
   * review). The zip sources answer for a name with its last member and list
   * it at its first, so a decoy manifest first — what a head-of-file preview
   * reads — and the real one later — what this reader read — would show a
   * person one World and import another.
   */
  it('is unknown-format when the archive names a member twice', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const decoy = encoder.encode(
      JSON.stringify({ ...manifestOf(await membersOf(path)), world: null, objects: [] }),
    );
    // The writer refuses a repeated name, so the decoy goes in under a name of
    // the same length, which is then renamed in the bytes: header and directory.
    const stand = 'storyengine-world.jsoX';
    const doubled = await rezip(path, (members) => [{ name: stand, bytes: decoy }, ...members]);
    const bytes = Buffer.from(await readFile(doubled));
    const from = Buffer.from(stand);
    for (let at = bytes.indexOf(from); at >= 0; at = bytes.indexOf(from, at + 1)) {
      Buffer.from(WORLD_FILE_MANIFEST).copy(bytes, at);
    }
    await writeFile(doubled, bytes);

    expect(await importFile('amy', doubled)).toEqual({ ok: false, refusal: 'unknown-format' });
    await nothingWritten('amy');
  });
});

// ── A risk, pinned ──────────────────────────────────────────────────────────

/**
 * ***An id in another account's trash reads as free*** — the fact check of
 * 2026-10-10, named in [P16.3]'s risks and pinned here, not fixed: `findById`
 * sees live rows only, so Amy's arrival keeps the id, and Ned restoring his
 * book from the trash afterwards makes one id held twice — the shadowed
 * duplicate the library already shows and leaves the person to resolve.
 */
describe('an id another account has in its trash', () => {
  it('is kept by the arrival, and a restore afterwards holds it twice', async () => {
    const sent = await author();
    const path = await publish(sent.world.id);
    const library = server.services.library;
    const lanterns = read(library, 'ned', sent.lanterns.id);
    await remove(library, 'ned', sent.lanterns.id, lanterns.contentHash, LOREBOOK_SCHEMA);

    await imported('amy', path);
    expect(read(library, 'amy', sent.lanterns.id).owner).toBe('user:amy');

    const [entry] = await listTrash(server.services.layout, 'ned', 30);
    const restored = await restoreFromTrash(server.services.layout, 'ned', entry!.id);
    if (!restored.ok) throw new Error(restored.reason);
    await ingestFile(library.db, library.layout, join(restored.path, 'lorebook.json'));

    const rows = rowsForId(library.db, sent.lanterns.id).filter((row) => row.tombstonedAt === null);
    expect(rows.map((row) => row.owner).sort()).toEqual(['user:amy', 'user:ned']);
    expect(rows.filter((row) => row.shadowed)).toHaveLength(1);

    // ***And the owner is the one who loses*** (the P16.3e review): Amy's is
    // the earlier path, so hers wins the id and Ned's restored book is the
    // shadowed copy — in his list, and no longer readable by its id, so his
    // links to it fall back to its name. Pinned exactly, as the risk records it.
    expect(rows.find((row) => row.owner === 'user:amy')?.shadowed).toBe(false);
    expect(rows.find((row) => row.owner === 'user:ned')?.shadowed).toBe(true);
    expect(() => read(library, 'ned', sent.lanterns.id)).toThrow(/No object with id/);
    expect(own('ned').map((row) => row.name)).toContain('Lanterns');
  });
});

// ── The Writer's history rule ───────────────────────────────────────────────

/**
 * ***History after a create, and never beside an object already here*** — the
 * Writer's half of the rule (`#native`), which the reader's half makes
 * unreachable from a World file: a candidate carrying history whose object is
 * already here, and replaced, gains no versions from it. Asked of the Writer
 * directly, so the rule holds for whatever sets `candidate.history` next.
 */
describe('a candidate carrying history', () => {
  it('writes it beside an object it created, and never beside one already here', async () => {
    const library = server.services.library;
    const book = newLorebook('Harbour');
    const payload = new TextEncoder().encode(
      `${JSON.stringify({ ...book, description: 'v0' }, null, 2)}\n`,
    );
    const digest = createHash('sha256').update(payload).digest('hex');
    const index = `${JSON.stringify({ id: uuidv7(), digest, authoredAt: AT, recordedAt: AT, source: { kind: 'manual' }, reason: 'Old', authorVersion: null, pinned: false })}\n`;
    const files = new MemoryFileSource({
      'library/lorebooks/harbour/lorebook.json': JSON.stringify(book),
      'library/lorebooks/harbour/history/index.jsonl': index,
      [`library/lorebooks/harbour/history/v/${digest}.json`]: payload,
    });
    const candidate = (body: unknown) => ({
      source: 'library/lorebooks/harbour/lorebook.json',
      format: 'storyengine.object',
      payload: body,
      history: [
        'library/lorebooks/harbour/history/index.jsonl',
        `library/lorebooks/harbour/history/v/${digest}.json`,
      ],
    });
    const request = { library, handle: 'ned', tags: server.services.tags, files };

    await convertOne(request, candidate(book));
    expect((await versionsOf(library, 'ned', book.id)).versions.map((one) => one.reason)).toEqual([
      'Old',
    ]);

    // Already here and the same: `unchanged`, and a folder with no history of
    // its own gains none — the one case the folder's own files cannot guard.
    const other = newLorebook('Tides');
    await create(library, 'ned', other, LOREBOOK_SCHEMA);
    const [same] = await convertOne(request, candidate(structuredClone(other)));
    expect(same?.disposition).toBe('unchanged');
    expect((await versionsOf(library, 'ned', other.id)).versions).toEqual([]);

    // Already here and different: replaced, and its history is its own.
    const [replaced] = await convertOne(request, candidate({ ...other, description: 'Replaced.' }));
    expect(replaced?.disposition).toBe('converted');
    expect((await versionsOf(library, 'ned', other.id)).versions.map((one) => one.reason)).toEqual([
      'Replaced by a re-import',
    ]);
  });
});
