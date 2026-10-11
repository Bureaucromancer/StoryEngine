// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ACTOR_SCHEMA,
  type Closure,
  fileSet,
  LEGACY_PACKAGE_SCHEMA,
  LOREBOOK_SCHEMA,
  newActor,
  newLoreEntry,
  newLorebook,
  newPreset,
  newTreatment,
  newWorld,
  PRESET_SCHEMA,
  readWorldFileManifest,
  RENDITION_SCHEMA,
  type Rendition,
  SESSION_SCHEMA,
  TREATMENT_SCHEMA,
  type PlotHook,
  type Turn,
  uuidv7,
  WORLD_FILE_MANIFEST,
  WORLD_SCHEMA,
  type World,
  type WorldFileManifest,
} from '@storyengine/shared';

import { rebuild } from '../index-db/rebuild.js';
import { create, list, read, update } from '../library.js';
import { digestOf, storeAsset } from '../library/assets.js';
import { newMemoryBook } from '../memory/books.js';
import { renditionIdFor, sessionAssetsRoot, writeRendition } from '../renditions/store.js';
import { attachmentOnDisk, storeAttachment } from '../sessions/attachments.js';
import { promoteSessionHook } from '../sessions/promote.js';
import { appendTurnOnly, createSession, sessionFilePath } from '../sessions/store.js';
import type { SessionFile } from '../sessions/types.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { pngCardCodec } from '../storage/card/png.js';
import { makePng } from '../storage/card/test-png.js';
import { openImportScratch, type ScratchSpace } from '../storage/import-scratch.js';
import { readZipDirectory, readZipEntry } from '../storage/zip.js';
import { ZipFile } from '../storage/zip-file.js';
import { DEFAULT_ZIP_WRITE_LIMITS } from '../storage/zip-writer.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { libraryReader, walkClosure } from './closure.js';
import {
  measureObject,
  measureSession,
  planWorldFile,
  type PlannedWorldFile,
  type PublishPlan,
  type WorldFileContext,
  WorldFileChangedError,
  writeWorldFile,
} from './world-file.js';

/**
 * ***The World file, planned from a real walk and written*** —
 * [16 §5.2](../../../../docs/design/16-publish.md),
 * [04 §9.1](../../../../docs/design/04-schemas.md), [P16.3c].
 *
 * **One fixture World, built to have every case in it** — the plan's list and
 * the fact check's additions: an actor whose card holds a portrait and an
 * expression; a lorebook with a gallery picture, an orphan upload beside it,
 * and history; a treatment whose required link names a book the person
 * unchecks; a member nobody references, unchecked; a member that no longer
 * exists; a book scoped to the World that is not a member; a ticked session
 * with a rendition (and a second whose pixels are gone), an attachment,
 * connection bindings and memory associations; and **an unticked session with
 * a distinctive name**, whose id the ticked session's associations and the
 * World's history both carry — so the leak test passes only because the
 * writer strips and filters, not because nothing ever named it.
 *
 * Every plan here is built the way P16.3d will build one: `walkClosure` over
 * the real library, `fileSet` over the person's ticks, and the plan read off
 * the result — the stage's end clause is *"a plan built from a P16.3a walk"*.
 */

const SECRET_NAME = 'Zanzibar Midnight Confession';
const AT = new Date('2026-10-10T12:00:00.000Z');
const BUILD = { version: '1.0.0-alpha.7', commit: 'abc1234' };

interface Fixture {
  server: TestServer;
  context: WorldFileContext;
  out: string;
  vera: { id: string };
  harbour: { id: string };
  tides: { id: string };
  almanac: { id: string };
  rain: { id: string };
  lighthouse: { id: string };
  ghost: string;
  galleryName: string;
  orphanName: string;
  world: World;
  night: SessionFile;
  secret: SessionFile;
  secretTurnId: string;
  pictureName: string;
  attachmentName: string;
}

/** Bytes that do not compress, from a seed: a picture's weight without a picture library. */
function noise(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0 || 1;
  for (let at = 0; at < length; at += 1) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    out[at] = state >>> 24;
  }
  return out;
}

const envelope = (object: { schema: string; id: string; name: string }) => ({
  schema: object.schema,
  id: object.id,
  name: object.name,
});

function turn(over: Partial<Turn> & { id: string; parentTurnId: string | null }): Turn {
  return { createdAt: AT.toISOString(), status: 'complete', ...over } as Turn;
}

function rendition(
  id: string,
  turnId: string,
  sessionId: string,
  path: string,
  bytes: number,
): Rendition {
  return {
    schema: RENDITION_SCHEMA,
    id,
    sessionId,
    turnId,
    createdAt: AT.toISOString(),
    kind: 'image',
    purpose: 'illustration',
    scope: { anchor: 'the lantern' },
    state: 'ready',
    prompt: {
      fragments: [{ id: 'moment', text: 'a lantern on a wet quay', rank: 100, required: true }],
      separator: ', ',
      budget: { maxChars: 320, usefulChars: 180 },
      text: 'a lantern on a wet quay',
      kept: ['moment'],
      dropped: [],
      overCap: false,
    },
    asset: { path, mime: 'image/png', bytes, digest: 'sha256:00' },
    provenance: {
      at: AT.toISOString(),
      binding: { connectionId: 'c-1', modelId: 'sdxl' },
      answeredAs: null,
      seed: 1,
      workflow: {},
    },
    error: null,
    digest: `d-${id}`,
    ordering: 0,
  } as unknown as Rendition;
}

async function build(): Promise<Fixture> {
  const server = await makeTestServer();
  await setUpAdmin(server, 'ned');
  const library = server.services.library;
  const sessions = server.services.sessions;
  const layout = server.services.layout;
  const out = await mkdtemp(join(tmpdir(), 'se-world-file-'));

  // A large expression, so Vera's card is the largest file a member has —
  // which is what lets one injected limit leave her behind and nothing else.
  const smile = noise(40_000, 2);
  const vera = {
    ...newActor('Vera'),
    media: [
      {
        id: 'e1',
        role: 'expression' as const,
        label: 'smiling',
        mime: 'image/png',
        digest: digestOf(smile),
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

  const harbour = newLorebook('Harbour');
  const madeHarbour = await create(library, 'ned', harbour, LOREBOOK_SCHEMA);
  const gallery = await storeAsset(library, 'ned', harbour.id, makePng(6, 3), 'image/png');
  // An upload nobody saved into the book: a file in `assets/` no row names.
  const orphan = await storeAsset(library, 'ned', harbour.id, makePng(6, 4), 'image/png');
  await update(
    library,
    'ned',
    harbour.id,
    { ...harbour, media: [{ id: 'm1', role: 'map', tags: [], ...gallery }] },
    madeHarbour.contentHash,
  );

  const tides = newLorebook('Tides');
  await create(library, 'ned', tides, LOREBOOK_SCHEMA);
  const almanac = newLorebook('Almanac');
  await create(library, 'ned', almanac, LOREBOOK_SCHEMA);
  const rain = {
    ...newTreatment('Rain'),
    lore: [{ ref: { id: tides.id, name: 'Tides' }, required: true }],
  };
  await create(library, 'ned', rain, TREATMENT_SCHEMA);
  const ghost = uuidv7();

  const first: World = {
    ...newWorld('Rain City'),
    requires: {
      modes: [{ id: 'scene', minVersion: '1.2.0' }],
      extensions: [],
      capabilities: ['images'],
    },
    contents: [
      envelope(vera),
      envelope(harbour),
      envelope(rain),
      envelope(almanac),
      { schema: ACTOR_SCHEMA, id: ghost, name: 'Ghost' },
    ],
  };
  const madeWorld = await create(library, 'ned', first, WORLD_SCHEMA);
  const lighthouse = {
    ...newLorebook('Lighthouse'),
    scope: { kind: 'world', worldIds: [first.id] },
  };
  await create(library, 'ned', lighthouse, LOREBOOK_SCHEMA);

  // ── Sessions ──
  const night = await createSession(sessions, 'ned', {
    name: 'Night one',
    mode: { id: 'chat', config: {} },
    cast: { persona: null, actors: [vera.id] },
  });
  const secretHook: PlotHook = {
    id: uuidv7(),
    title: 'The tide turns early',
    premise: 'The harbour floods a night before anybody expects it.',
    magnitude: 'local',
    involves: [],
    weight: 1,
    delivery: 'guidance',
    once: true,
  };
  const secret = await createSession(sessions, 'ned', {
    name: SECRET_NAME,
    hooks: [{ hook: secretHook, source: { kind: 'session' } }],
  });

  /**
   * ***What play writes into a carried object's history*** (2026-10-10, the
   * P16.3c review), so the leak test is not vacuous with history on: the
   * session panel's promote control saves the unticked session's hook onto
   * the treatment — its version's reason names the session — and a memory
   * written from that session lands on the book with the session's id in the
   * version's source and its name in the reason. *The second is a memory
   * capture's write on a book that no longer carries the memory marking*
   * (a person can clear it by hand), because a book that does is not carried
   * at all; the scrub has to hold either way.
   */
  const promoted = await promoteSessionHook(sessions, library, 'ned', secret.id, secretHook.id, {
    kind: 'treatment',
    id: rain.id,
  });
  if (promoted.kind !== 'promoted') throw new Error(`the promotion answered ${promoted.kind}`);
  const remembered = read(library, 'ned', harbour.id);
  await update(
    library,
    'ned',
    harbour.id,
    { ...(remembered.body as object), description: 'Remembered, then kept.' },
    remembered.contentHash,
    { source: { kind: 'memory', sessionId: secret.id }, reason: `remembered from ${SECRET_NAME}` },
  );

  const attachment = await storeAttachment(layout, 'ned', night.id, makePng(5, 5));
  if (attachment === null) throw new Error('the attachment did not store');
  const t1 = uuidv7();
  const t2 = uuidv7();
  await appendTurnOnly(
    sessions,
    'ned',
    night.id,
    turn({
      id: t1,
      parentTurnId: null,
      sessionId: night.id,
      input: {
        text: 'Look at this.',
        attachments: [
          { id: 'a1', kind: 'image', digest: attachment.digest, mime: attachment.mime },
        ],
      },
    } as Partial<Turn> & { id: string; parentTurnId: string | null }),
  );
  await appendTurnOnly(
    sessions,
    'ned',
    night.id,
    turn({ id: t2, parentTurnId: t1, sessionId: night.id }),
  );
  const secretTurnId = uuidv7();
  await appendTurnOnly(
    sessions,
    'ned',
    secret.id,
    turn({ id: secretTurnId, parentTurnId: null, sessionId: secret.id }),
  );

  const pixels = makePng(7, 6);
  const shown = renditionIdFor(t1, 0);
  const assets = sessionAssetsRoot(layout, 'ned', night.id);
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, `${shown}.png`), pixels);
  await writeRendition(
    layout,
    'ned',
    night.id,
    rendition(shown, t1, night.id, `${shown}.png`, pixels.length),
  );
  // A second picture whose pixels are not on disk — named, never fatal.
  const lost = renditionIdFor(t2, 0);
  await writeRendition(layout, 'ned', night.id, rendition(lost, t2, night.id, `${lost}.png`, 10));

  // What must never travel: the dials, and the associations whose keys are
  // sibling sessions — the unticked one among them.
  await writeJsonAtomic(sessionFilePath(layout, 'ned', night.id), {
    ...night,
    headTurnId: t2,
    roles: { prose: { connectionId: 'c-1', modelId: 'm-1' } },
    stepRoles: { 'scene.stage': { connectionId: 'c-2', modelId: 'm-2' } },
    memory: {
      share: true,
      intake: true,
      associations: { [secret.id]: 'never' },
      acrossPersonas: false,
    },
  });

  // The sessions join the World, and the World is edited once more, so a
  // version in its history names the unticked session too. *The night first,
  // before the members* (2026-10-10, the P16.3c review): the World's own order
  // is not the walk's members-then-sessions, so a `world.json` rebuilt in walk
  // order rather than filtered in place is told apart — and its envelope
  // carries a field this build does not know, which a filter keeps and a
  // rebuild would drop.
  const withSessions: World = {
    ...first,
    contents: [
      {
        schema: SESSION_SCHEMA,
        id: night.id,
        name: 'Night one',
        pinned: true,
      } as World['contents'][number],
      ...first.contents,
      { schema: SESSION_SCHEMA, id: secret.id, name: SECRET_NAME },
    ],
  };
  const second = await update(library, 'ned', first.id, withSessions, madeWorld.contentHash);
  const world: World = { ...withSessions, description: 'A port that is always wet.' };
  await update(library, 'ned', first.id, world, second.contentHash);

  return {
    server,
    out,
    context: {
      library,
      sessions,
      build: BUILD,
      now: () => AT,
    },
    vera,
    harbour,
    tides,
    almanac,
    rain,
    lighthouse,
    ghost,
    galleryName: gallery.ref.replace('assets/', ''),
    orphanName: orphan.ref.replace('assets/', ''),
    world,
    night,
    secret,
    secretTurnId,
    pictureName: `${shown}.png`,
    attachmentName: `${attachment.digest.replace('sha256:', '')}.png`,
  };
}

async function dispose(fixture: Fixture): Promise<void> {
  await fixture.server.dispose();
  await rm(fixture.out, { recursive: true, force: true });
}

/** The plan P16.3d would build: a real walk, `fileSet` over the ticks, the plan read off it. */
async function planned(
  fixture: Fixture,
  start: { kind: 'world'; id: string } | { kind: 'objects'; ids: string[] },
  ticked: Record<string, boolean>,
  history: boolean,
  stage: ScratchSpace,
  context: WorldFileContext = fixture.context,
): Promise<PlannedWorldFile> {
  const plan = await publishPlan(fixture, start, ticked, history);
  const result = await planWorldFile(context, 'ned', plan, stage);
  if ('refusal' in result) throw new Error(`refused: ${result.refusal}`);
  return result;
}

async function publishPlan(
  fixture: Fixture,
  start: { kind: 'world'; id: string } | { kind: 'objects'; ids: string[] },
  ticked: Record<string, boolean>,
  history: boolean,
): Promise<PublishPlan> {
  const reader = libraryReader(
    { library: fixture.server.services.library, sessions: fixture.server.services.sessions },
    'ned',
  );
  const closure = (await walkClosure(reader, start)) as Closure;
  if (!('nodes' in closure)) throw new Error('the walk refused');
  const files = fileSet(closure, { ticked, history });
  const members = new Set(
    closure.edges
      .filter((edge) => edge.from === null && edge.rule === 'world.member')
      .map((edge) => edge.to),
  );
  // As the confirm hands it over: the stored body, held to the walk's hash
  // (2026-10-11, the P16.3d review), which the plan's own read must match.
  const stored =
    start.kind === 'world'
      ? read(fixture.server.services.library, 'ned', start.id, WORLD_SCHEMA)
      : null;
  return {
    origin: closure.origin,
    world:
      stored === null
        ? null
        : { body: stored.body as World, contentHash: closure.world?.contentHash ?? '' },
    objects: files.objects.map((object) => ({ id: object.id, member: members.has(object.key) })),
    sessions: files.sessions.map((session) => session.id),
    leftBehind: files.leftBehind,
    requires: {
      modes: files.modes.map((id) => ({ id, minVersion: '0.0.0' })),
      extensions: [],
      capabilities: [],
    },
    history,
  };
}

/** What the archive holds, read back by the in-memory reader. */
async function unpack(
  path: string,
): Promise<{ bytes: Uint8Array; names: string[]; entries: Map<string, Uint8Array> }> {
  const bytes = new Uint8Array(await readFile(path));
  const directory = readZipDirectory(bytes);
  if (!directory.ok) throw new Error(`refused: ${directory.refusal}`);
  const entries = new Map<string, Uint8Array>();
  for (const entry of directory.entries) {
    const body = readZipEntry(bytes, entry);
    if (body === null) throw new Error(`unreadable: ${entry.name}`);
    entries.set(entry.name, body);
  }
  return { bytes, names: directory.entries.map((entry) => entry.name), entries };
}

/** A member parsed as JSON — `any`, as a test reads it, cast where it is read. */
function json(entries: Map<string, Uint8Array>, name: string): any {
  const body = entries.get(name);
  if (body === undefined) throw new Error(`no member ${name}`);
  return JSON.parse(new TextDecoder().decode(body));
}

function contains(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(text, 'utf8'));
}

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe('a World published from a real walk', () => {
  let fixture: Fixture;
  let stage: ScratchSpace;
  /** The person's choices: the night ticked, the required book and an unreferenced member unchecked. */
  let ticks: Record<string, boolean>;
  let plain: Awaited<ReturnType<typeof unpack>>;
  let withHistory: Awaited<ReturnType<typeof unpack>>;
  let manifest: WorldFileManifest;

  beforeAll(async () => {
    fixture = await build();
    stage = await openImportScratch(fixture.server.services.layout);
    ticks = {
      [fixture.night.id]: true,
      [fixture.tides.id]: false,
      [fixture.almanac.id]: false,
    };
    const start = { kind: 'world' as const, id: fixture.world.id };

    const off = await planned(fixture, start, ticks, false, stage);
    const offPath = join(fixture.out, 'rain-city.seworld');
    const written = await writeWorldFile(off, offPath);
    expect(written).toEqual({ entries: off.entries, bytes: off.bytes });
    plain = await unpack(offPath);
    manifest = json(plain.entries, WORLD_FILE_MANIFEST) as WorldFileManifest;

    const on = await planned(fixture, start, ticks, true, stage);
    const onPath = join(fixture.out, 'rain-city-history.seworld');
    await writeWorldFile(on, onPath);
    withHistory = await unpack(onPath);
  }, 60_000);

  afterAll(async () => {
    await stage.dispose();
    await dispose(fixture);
  });

  it('lays the file out as the plan’s tree, the manifest first', () => {
    const night = `sessions/${fixture.night.id}`;
    expect(plain.names).toEqual([
      WORLD_FILE_MANIFEST,
      'library/worlds/rain-city/world.json',
      'library/actors/vera/card.png',
      'library/lorebooks/harbour/lorebook.json',
      `library/lorebooks/harbour/assets/${fixture.galleryName}`,
      'library/treatments/rain/treatment.json',
      'library/lorebooks/lighthouse/lorebook.json',
      `${night}/session-export.json`,
      `${night}/assets/${fixture.pictureName}`,
      `${night}/attachments/${fixture.attachmentName}`,
    ]);
    expect(readWorldFileManifest(manifest)).toBe(manifest);
    expect(manifest.objects.map((one) => [one.name, one.member])).toEqual([
      ['Vera', true],
      ['Harbour', true],
      ['Rain', true],
      // Scoped to the World, and not a member: it travels because it names
      // the World, and the World is not made to name it.
      ['Lighthouse', false],
    ]);
    expect(manifest.sessions).toEqual([
      {
        id: fixture.night.id,
        name: 'Night one',
        folder: night,
        turns: 2,
        headTurnId: expect.any(String),
        pictures: 1,
        attachments: 1,
        mode: 'chat',
      },
    ]);
    expect(manifest.exportedBy).toEqual({ version: BUILD.version, at: AT.toISOString() });
  });

  it('carries the card byte for byte, portrait and expression inside it', async () => {
    const row = read(fixture.server.services.library, 'ned', fixture.vera.id);
    expect(plain.entries.get('library/actors/vera/card.png')).toEqual(
      new Uint8Array(await readFile(row.path)),
    );
  });

  it('carries the picture the book names, and not the orphan beside it', () => {
    expect(plain.names).toContain(`library/lorebooks/harbour/assets/${fixture.galleryName}`);
    expect(plain.names.some((name) => name.includes(fixture.orphanName))).toBe(false);
    expect(withHistory.names.some((name) => name.includes(fixture.orphanName))).toBe(false);
  });

  it('carries history only when it was opted into, and never the World’s own', () => {
    expect(plain.names.some((name) => name.includes('/history/'))).toBe(false);
    const history = withHistory.names.filter((name) => name.includes('/history/'));
    expect(history).toContain('library/lorebooks/harbour/history/index.jsonl');
    expect(
      history.some((name) =>
        /^library\/lorebooks\/harbour\/history\/v\/[0-9a-f]{64}\.json$/.test(name),
      ),
    ).toBe(true);
    expect(history.some((name) => name.startsWith('library/worlds/'))).toBe(false);
    expect((json(withHistory.entries, WORLD_FILE_MANIFEST) as WorldFileManifest).history).toBe(
      true,
    );
    // And each payload is what its name says.
    for (const name of history.filter((one) => one.includes('/v/'))) {
      const hex = /([0-9a-f]{64})\.json$/.exec(name)?.[1] ?? 'no digest in the name';
      expect(sha256(withHistory.entries.get(name)!)).toBe(`sha256:${hex}`);
    }
  });

  /**
   * ***The leak test*** — the stage's end clause and the fact check's
   * addition: the unticked session's **name and id** appear nowhere in the
   * file's bytes, with history on as well as off. Not vacuous: the stored
   * World names it, a version in the World's history names it, and the ticked
   * session's own file keys its associations by its id — so this holds only
   * because the World is re-encoded, its history stays home, and the
   * associations are stripped.
   */
  it('names the unticked session nowhere — not its name, not its id', async () => {
    const layout = fixture.server.services.layout;
    const library = fixture.server.services.library;
    const storedWorld = await readFile(read(library, 'ned', fixture.world.id).path);
    expect(contains(storedWorld, fixture.secret.id)).toBe(true);
    expect(contains(storedWorld, SECRET_NAME)).toBe(true);
    const storedNight = await readFile(sessionFilePath(layout, 'ned', fixture.night.id));
    expect(contains(storedNight, fixture.secret.id)).toBe(true);
    // And the carried objects' histories, which travel with history on: the
    // treatment's names it in a promotion's reason, the book's by id and name.
    const historyOf = (id: string): Promise<Buffer> =>
      readFile(join(read(library, 'ned', id).path, '..', 'history', 'index.jsonl'));
    expect(contains(await historyOf(fixture.rain.id), SECRET_NAME)).toBe(true);
    expect(contains(await historyOf(fixture.harbour.id), fixture.secret.id)).toBe(true);
    expect(contains(await historyOf(fixture.harbour.id), SECRET_NAME)).toBe(true);

    for (const file of [plain, withHistory]) {
      expect(contains(file.bytes, SECRET_NAME)).toBe(false);
      expect(contains(file.bytes, fixture.secret.id)).toBe(false);
      /**
       * ***And inside every card*** (2026-10-10, the P16.3c review): an
       * actor's body is base64 in a `tEXt` chunk, so the raw search above
       * cannot see into one. Decoded, its envelope and every blob are
       * searched too.
       */
      const cards = [...file.entries].filter(([name]) => name.endsWith('/card.png'));
      expect(cards.length).toBeGreaterThan(0);
      for (const [, bytes] of cards) {
        const card = pngCardCodec.read(bytes);
        const inside = [
          Buffer.from(JSON.stringify(card.envelope), 'utf8'),
          ...[...card.blobs.values()].map((blob) => Buffer.from(blob)),
        ];
        for (const part of inside) {
          expect(contains(part, SECRET_NAME)).toBe(false);
          expect(contains(part, fixture.secret.id)).toBe(false);
        }
      }
    }
  });

  /**
   * ***What the scrub keeps*** — the history still says what happened, in
   * words that name no session: a promotion, a memory, each version once.
   */
  it('carries a history that says a session did it without saying which', () => {
    const lines = (name: string): { source: { kind: string }; reason: string }[] =>
      new TextDecoder()
        .decode(withHistory.entries.get(name))
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as { source: { kind: string }; reason: string });
    expect(lines('library/treatments/rain/history/index.jsonl')).toContainEqual(
      expect.objectContaining({
        source: { kind: 'manual' },
        reason: 'Plot hook saved from a session',
      }),
    );
    expect(lines('library/lorebooks/harbour/history/index.jsonl')).toContainEqual(
      expect.objectContaining({ source: { kind: 'memory' }, reason: 'remembered from a session' }),
    );
  });

  it('strips roles, stepRoles and memory.associations from the session export, and keeps the rest', () => {
    for (const file of [plain, withHistory]) {
      const exported = json(file.entries, `sessions/${fixture.night.id}/session-export.json`) as {
        session: Record<string, unknown>;
        exportedBy: unknown;
        turns: unknown[];
      };
      expect(exported.session).not.toHaveProperty('roles');
      expect(exported.session).not.toHaveProperty('stepRoles');
      expect(exported.session['memory']).toEqual({
        share: true,
        intake: true,
        acrossPersonas: false,
      });
      expect(exported.session['name']).toBe('Night one');
      expect(exported.turns).toHaveLength(2);
      expect(exported.exportedBy).toEqual(
        (json(file.entries, WORLD_FILE_MANIFEST) as WorldFileManifest).exportedBy,
      );
      // Written a turn at a time (2026-10-10, the P16.3c review), and still
      // exactly the compact JSON the session export route sends.
      const text = new TextDecoder().decode(
        file.entries.get(`sessions/${fixture.night.id}/session-export.json`),
      );
      expect(JSON.stringify(JSON.parse(text))).toBe(text);
    }
  });

  it('names the unchecked required book in leftBehind, required, from the treatment', () => {
    expect(manifest.leftBehind).toEqual([
      {
        schema: LOREBOOK_SCHEMA,
        id: fixture.tides.id,
        name: 'Tides',
        reason: 'unchecked',
        required: true,
        from: [fixture.rain.id],
      },
    ]);
    expect(plain.names.some((name) => name.startsWith('library/lorebooks/tides/'))).toBe(false);
  });

  it('leaves an unchecked member nothing references out altogether', () => {
    expect(plain.names.some((name) => name.startsWith('library/lorebooks/almanac/'))).toBe(false);
    expect(manifest.objects.some((one) => one.id === fixture.almanac.id)).toBe(false);
    expect(contains(plain.bytes, fixture.almanac.id)).toBe(false);
    expect(contains(plain.bytes, 'Almanac')).toBe(false);
  });

  it('publishes world.json as world/1, naming exactly what travels, its requires as stored', () => {
    const published = json(plain.entries, 'library/worlds/rain-city/world.json') as World;
    expect(published.schema).toBe(WORLD_SCHEMA);
    expect(published.id).toBe(fixture.world.id);
    expect(published.description).toBe('A port that is always wet.');
    // In the World's own order — the night first, as it stands there — and
    // as the stored entries, filtered in place.
    expect(published.contents).toEqual([
      { schema: SESSION_SCHEMA, id: fixture.night.id, name: 'Night one', pinned: true },
      { schema: ACTOR_SCHEMA, id: fixture.vera.id, name: 'Vera' },
      { schema: LOREBOOK_SCHEMA, id: fixture.harbour.id, name: 'Harbour' },
      { schema: TREATMENT_SCHEMA, id: fixture.rain.id, name: 'Rain' },
    ]);
    const travelled = new Set(published.contents.map((entry) => entry.id));
    expect(published.contents).toEqual(
      fixture.world.contents.filter((entry) => travelled.has(entry.id)),
    );
    // Not the missing member, not the unchecked one, not the scoped book.
    expect(contains(plain.entries.get('library/worlds/rain-city/world.json')!, fixture.ghost)).toBe(
      false,
    );
    expect(published.requires).toEqual(fixture.world.requires);
    // The manifest's is the stored ∪ the derived, the author's first.
    expect(manifest.requires).toEqual({
      modes: [
        { id: 'scene', minVersion: '1.2.0' },
        { id: 'chat', minVersion: '0.0.0' },
      ],
      extensions: [],
      capabilities: ['images'],
    });
    expect(manifest.world).toMatchObject({
      id: fixture.world.id,
      folder: 'library/worlds/rain-city',
      file: 'library/worlds/rain-city/world.json',
      member: false,
      description: 'A port that is always wet.',
    });
  });

  it('hashes every object as the bytes in the zip', () => {
    for (const object of [...manifest.objects, manifest.world!]) {
      expect(sha256(plain.entries.get(object.file)!), object.name).toBe(object.contentHash);
    }
  });

  it('names a session picture missing on disk, and does not fail for it', () => {
    expect(manifest.omitted).toContainEqual({
      key: 'publish.file.sessionPicturesMissing',
      level: 'info',
      params: { id: fixture.night.id, name: 'Night one', count: 1 },
    });
  });

  /**
   * The end clause's other half: **both repository readers**, and the tools
   * outside it where the machine has them.
   */
  it('is accepted by both repository readers and by unzip -t', async () => {
    const path = join(fixture.out, 'rain-city.seworld');
    const opened = await ZipFile.open(path);
    if (!opened.ok) throw new Error(`refused: ${opened.refusal}`);
    try {
      expect(opened.zip.entries.map((entry) => entry.name)).toEqual(plain.names);
      for (const entry of opened.zip.entries) {
        expect(await opened.zip.read(entry)).toEqual(plain.entries.get(entry.name));
      }
    } finally {
      await opened.zip.close();
    }
    if (spawnSync('unzip', ['-v'], { stdio: 'ignore' }).status === 0) {
      const run = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
      expect(run.status, run.stdout + run.stderr).toBe(0);
    }
  });

  it('writes the same bytes when the same library is published at the same moment', async () => {
    const again = await planned(
      fixture,
      { kind: 'world', id: fixture.world.id },
      ticks,
      false,
      stage,
    );
    const path = join(fixture.out, 'again.seworld');
    await writeWorldFile(again, path);
    expect(new Uint8Array(await readFile(path))).toEqual(plain.bytes);
  });

  it('measures an object and a session with the counts the plan wrote', async () => {
    const library = fixture.server.services.library;
    const harbour = read(library, 'ned', fixture.harbour.id);
    const facts = await measureObject(fixture.context, 'ned', harbour, { history: true });
    expect(facts.entries).toBe(2);
    expect(facts.bytes).toBe(
      plain.entries.get('library/lorebooks/harbour/lorebook.json')!.length +
        plain.entries.get(`library/lorebooks/harbour/assets/${fixture.galleryName}`)!.length,
    );
    expect(facts.pictures.count).toBe(1);
    expect(facts.history.entries).toBe(
      withHistory.names.filter((name) => name.startsWith('library/lorebooks/harbour/history/'))
        .length,
    );
    const vera = await measureObject(
      fixture.context,
      'ned',
      read(library, 'ned', fixture.vera.id),
      {
        history: false,
      },
    );
    expect(vera).toMatchObject({ entries: 1, pictures: { count: 1 }, omitted: [] });

    const night = await measureSession(fixture.context, 'ned', fixture.night.id);
    expect(night).toMatchObject({
      turns: 2,
      pictures: 1,
      attachments: 1,
      missingPixels: 1,
      entries: 3,
    });
    // The size the review shows is the size the file has (2026-10-10, the
    // P16.3c review: the export was measured with a shorter `exportedBy`).
    const inFile = [...plain.entries]
      .filter(([name]) => name.startsWith(`sessions/${fixture.night.id}/`))
      .reduce((sum, [, bytes]) => sum + bytes.length, 0);
    expect(night.bytes).toBe(inFile);
  });
});

describe('what a plan decides, case by case', () => {
  let fixture: Fixture;
  let stage: ScratchSpace;

  beforeEach(async () => {
    fixture = await build();
    stage = await openImportScratch(fixture.server.services.layout);
  }, 60_000);

  afterEach(async () => {
    await stage.dispose();
    await dispose(fixture);
  });

  const worldStart = (): { kind: 'world'; id: string } => ({ kind: 'world', id: fixture.world.id });

  it('writes no World for one object published alone', async () => {
    const plan = await planned(
      fixture,
      { kind: 'objects', ids: [fixture.harbour.id] },
      {},
      false,
      stage,
    );
    expect(plan.manifest.origin).toBe('object');
    expect(plan.manifest.world).toBeNull();
    expect(plan.manifest.objects.map((one) => one.id)).toEqual([fixture.harbour.id]);
    const path = join(fixture.out, 'harbour.seworld');
    await writeWorldFile(plan, path);
    const file = await unpack(path);
    expect(file.names.some((name) => name.startsWith('library/worlds/'))).toBe(false);
  });

  /**
   * ***A selection kept as a World*** (P16.3d's `keep: 'world'`): the World
   * is minted in memory and not yet stored when the file is planned
   * ([P16.3]'s plan, R11), so there is no folder to read — the file names it
   * by its slug, and carries no pictures of its own.
   */
  it('publishes a World that is not stored yet under its slug, naming what travels', async () => {
    const plan = await publishPlan(
      fixture,
      { kind: 'objects', ids: [fixture.harbour.id, fixture.rain.id, fixture.almanac.id] },
      { [fixture.almanac.id]: false, [fixture.tides.id]: false },
      false,
    );
    const kept: World = {
      ...newWorld('Kept for Mara'),
      contents: [fixture.harbour, fixture.rain, fixture.almanac].map((one) => {
        const row = read(fixture.server.services.library, 'ned', one.id);
        return { schema: row.schemaId, id: row.id, name: row.name };
      }),
    };
    const result = await planWorldFile(
      fixture.context,
      'ned',
      {
        ...plan,
        world: { body: kept },
        objects: plan.objects.map((one) => ({ ...one, member: true })),
      },
      stage,
    );
    if ('refusal' in result) throw new Error(result.refusal);
    expect(result.manifest.origin).toBe('selection');
    expect(result.manifest.world).toMatchObject({
      id: kept.id,
      file: 'library/worlds/kept-for-mara/world.json',
    });
    const world = result.members[1];
    if (world === undefined || !('bytes' in world)) throw new Error('no world.json');
    const published = JSON.parse(new TextDecoder().decode(world.bytes)) as World;
    // The selection held three; the person unchecked one, and the file's
    // World names the two that travel.
    expect(published.contents.map((one) => one.id)).toEqual([fixture.harbour.id, fixture.rain.id]);
  });

  it('gives two objects of one kind and one folder name a suffix', async () => {
    const library = fixture.server.services.library;
    const system = list(library, 'ned', PRESET_SCHEMA).find((row) => row.owner === 'system');
    if (system === undefined) throw new Error('the test server ships no system preset');
    // A person's preset named so its folder is the system one's.
    const mine = { ...newPreset(system.slug), id: uuidv7() };
    await create(library, 'ned', mine, PRESET_SCHEMA);
    expect(read(library, 'ned', mine.id).slug).toBe(system.slug);

    const plan = await planned(
      fixture,
      { kind: 'objects', ids: [system.id, mine.id] },
      { [system.id]: true },
      false,
      stage,
    );
    expect(plan.manifest.objects.map((one) => one.folder)).toEqual([
      `library/presets/${system.slug}`,
      `library/presets/${system.slug}-2`,
    ]);
  });

  it('omits a picture over the entry limit, with a note, and carries the book', async () => {
    const library = fixture.server.services.library;
    const big = await storeAsset(library, 'ned', fixture.harbour.id, noise(20_000, 9), 'image/png');
    const now = read(library, 'ned', fixture.harbour.id);
    const body = now.body as { media: unknown[] };
    await update(
      library,
      'ned',
      fixture.harbour.id,
      { ...body, media: [...body.media, { id: 'm2', role: 'map', tags: [], ...big }] },
      now.contentHash,
    );
    const size = (await stat(read(library, 'ned', fixture.harbour.id).path)).size;
    expect(big.bytes).toBeGreaterThan(size);
    const context = {
      ...fixture.context,
      limits: { ...DEFAULT_ZIP_WRITE_LIMITS, maxEntryBytes: size },
    };
    const plan = await planned(
      fixture,
      { kind: 'objects', ids: [fixture.harbour.id] },
      {},
      false,
      stage,
      context,
    );
    expect(plan.members.map((member) => member.name)).toEqual([
      WORLD_FILE_MANIFEST,
      'library/lorebooks/harbour/lorebook.json',
      `library/lorebooks/harbour/assets/${fixture.galleryName}`,
    ]);
    expect(plan.manifest.omitted).toEqual([
      {
        key: 'publish.file.pictureTooLarge',
        level: 'warn',
        params: { id: fixture.harbour.id, name: 'Harbour', ref: big.ref, bytes: big.bytes },
      },
    ]);
    // And the review's numbers agree: the picture is named, not counted.
    const facts = await measureObject(context, 'ned', read(library, 'ned', fixture.harbour.id), {
      history: false,
    });
    expect(facts.omitted).toEqual([{ ref: big.ref, bytes: big.bytes }]);
    expect(facts.entries).toBe(2);
  });

  it('refuses a plan with too many files before anything is written', async () => {
    const plan = await publishPlan(fixture, worldStart(), { [fixture.night.id]: true }, false);
    const context = { ...fixture.context, limits: { ...DEFAULT_ZIP_WRITE_LIMITS, maxEntries: 4 } };
    expect(await planWorldFile(context, 'ned', plan, stage)).toEqual({ refusal: 'too-many-files' });
    const archive = {
      ...fixture.context,
      limits: { ...DEFAULT_ZIP_WRITE_LIMITS, maxArchiveBytes: 2048 },
    };
    expect(await planWorldFile(archive, 'ned', plan, stage)).toEqual({ refusal: 'too-large' });
  });

  it('refuses a session that is not a session member of the World', async () => {
    const plan = await publishPlan(fixture, worldStart(), {}, false);
    expect(
      await planWorldFile(fixture.context, 'ned', { ...plan, sessions: [uuidv7()] }, stage),
    ).toEqual({
      refusal: 'not-a-member',
    });
    expect(
      await planWorldFile(
        fixture.context,
        'ned',
        { ...plan, world: null, sessions: [fixture.night.id] },
        stage,
      ),
    ).toEqual({ refusal: 'not-a-member' });
  });

  /**
   * ***An edit between plan and write fails the publish whole***, and no file
   * results — a save of the book (its stored file re-hashed against the
   * manifest's `contentHash`), and a picture removed (its name's hash no
   * longer answered).
   */
  it('throws WorldFileChangedError for an object saved between plan and write, and leaves no file', async () => {
    const plan = await planned(fixture, worldStart(), { [fixture.night.id]: true }, false, stage);
    const library = fixture.server.services.library;
    const now = read(library, 'ned', fixture.harbour.id);
    await update(
      library,
      'ned',
      fixture.harbour.id,
      { ...(now.body as object), description: 'Edited.' },
      now.contentHash,
    );

    const to = join(fixture.out, 'changed.seworld');
    const error = await writeWorldFile(plan, to).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorldFileChangedError);
    expect((error as WorldFileChangedError).path).toBe('library/lorebooks/harbour/lorebook.json');
    expect(await exists(to)).toBe(false);
    expect(await exists(`${to}.part`)).toBe(false);
  });

  it('throws WorldFileChangedError for a picture gone between plan and write, and leaves no file', async () => {
    const plan = await planned(fixture, worldStart(), { [fixture.night.id]: true }, false, stage);
    const book = read(fixture.server.services.library, 'ned', fixture.harbour.id);
    await unlink(join(book.path, '..', 'assets', fixture.galleryName));

    const to = join(fixture.out, 'gone.seworld');
    await expect(writeWorldFile(plan, to)).rejects.toBeInstanceOf(WorldFileChangedError);
    expect(await exists(to)).toBe(false);
    expect(await exists(`${to}.part`)).toBe(false);
  });

  /**
   * ***The hash, not the size, is the check.*** A card re-saved with one
   * pixel changed is the same length and different bytes; a writer that
   * compared sizes alone would publish the new card under the manifest's
   * hash of the old one, and the reader would refuse it as damaged. The
   * manifest's `contentHash` is the plan's reading, and the write holds every
   * file to it.
   */
  it('throws WorldFileChangedError for a card whose bytes change but not its length', async () => {
    const plan = await planned(fixture, worldStart(), { [fixture.night.id]: true }, false, stage);
    const card = read(fixture.server.services.library, 'ned', fixture.vera.id).path;
    const bytes = new Uint8Array(await readFile(card));
    bytes[bytes.length - 20] = (bytes[bytes.length - 20]! + 1) % 256;
    await writeFile(card, bytes);

    const to = join(fixture.out, 'same-size.seworld');
    const error = await writeWorldFile(plan, to).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorldFileChangedError);
    expect((error as WorldFileChangedError).path).toBe('library/actors/vera/card.png');
    expect(await exists(to)).toBe(false);
    expect(await exists(`${to}.part`)).toBe(false);
  });

  /**
   * ***A session export past the entry bound is left behind by name*** — the
   * fact check's correction: a transcript records the rendered prompt of every
   * call, so it reaches the readers' 64 MiB long before a card does. Injected
   * small here; the rule is the same.
   */
  it('leaves a session export over the entry limit behind, naming the session', async () => {
    // A long transcript: a turn whose recorded text outweighs every card.
    await appendTurnOnly(
      fixture.server.services.sessions,
      'ned',
      fixture.night.id,
      turn({
        id: uuidv7(),
        parentTurnId: null,
        sessionId: fixture.night.id,
        output: { text: 'rain '.repeat(20_000) },
      }),
    );
    const plan = await publishPlan(fixture, worldStart(), { [fixture.night.id]: true }, false);
    const exportSize = (await measureSession(fixture.context, 'ned', fixture.night.id)).bytes;
    const book = read(fixture.server.services.library, 'ned', fixture.harbour.id);
    const card = read(fixture.server.services.library, 'ned', fixture.vera.id);
    const biggestObject = Math.max(
      (await stat(book.path)).size,
      (await stat(card.path)).size,
      ...(await Promise.all(
        [fixture.rain.id, fixture.lighthouse.id].map(
          async (id) => (await stat(read(fixture.server.services.library, 'ned', id).path)).size,
        ),
      )),
    );
    const limit = Math.max(biggestObject, 512) + 1;
    expect(exportSize).toBeGreaterThan(limit);
    const context = {
      ...fixture.context,
      limits: { ...DEFAULT_ZIP_WRITE_LIMITS, maxEntryBytes: limit },
    };
    const result = await planWorldFile(context, 'ned', plan, stage);
    if ('refusal' in result) throw new Error(result.refusal);

    expect(result.manifest.sessions).toEqual([]);
    expect(result.members.some((member) => member.name.startsWith('sessions/'))).toBe(false);
    expect(result.manifest.omitted).toContainEqual({
      key: 'publish.file.sessionTooLarge',
      level: 'warn',
      params: { id: fixture.night.id, name: 'Night one', bytes: expect.any(Number) },
    });
    expect(result.manifest.leftBehind).toContainEqual(
      expect.objectContaining({
        schema: SESSION_SCHEMA,
        id: fixture.night.id,
        name: 'Night one',
        reason: 'too-large',
      }),
    );
    const world = result.members.find((member) => member.name.endsWith('/world.json'));
    if (world === undefined || !('bytes' in world)) throw new Error('no world.json');
    expect(contains(world.bytes, fixture.night.id)).toBe(false);
    // Measured, never staged: nothing of it is left in the scratch space.
    expect(await readdir(stage.directory)).toEqual([]);
  });

  it('leaves a session it can no longer read behind, with a note, and publishes the rest', async () => {
    const plan = await publishPlan(fixture, worldStart(), { [fixture.night.id]: true }, false);
    await unlink(sessionFilePath(fixture.server.services.layout, 'ned', fixture.night.id));
    const result = await planWorldFile(fixture.context, 'ned', plan, stage);
    if ('refusal' in result) throw new Error(result.refusal);
    expect(result.manifest.sessions).toEqual([]);
    expect(result.manifest.omitted).toContainEqual({
      key: 'publish.file.sessionUnreadable',
      level: 'warn',
      params: { id: fixture.night.id, name: 'Night one' },
    });
    // Nothing unchecked this time: every member, then what the walk reached.
    expect(result.manifest.objects.map((one) => one.name)).toEqual([
      'Vera',
      'Harbour',
      'Rain',
      'Almanac',
      'Lighthouse',
      'Tides',
    ]);
  });

  /**
   * ***An oversized card leaves its actor behind*** (risk 3), as `too-large`
   * in `leftBehind`, named by the session that casts her.
   */
  it('leaves an object whose stored file is over the limit behind, as too-large', async () => {
    const card = (await stat(read(fixture.server.services.library, 'ned', fixture.vera.id).path))
      .size;
    const plan = await publishPlan(fixture, worldStart(), { [fixture.night.id]: true }, false);
    const context = {
      ...fixture.context,
      limits: { ...DEFAULT_ZIP_WRITE_LIMITS, maxEntryBytes: card - 1 },
    };
    const result = await planWorldFile(context, 'ned', plan, stage);
    if ('refusal' in result) throw new Error(result.refusal);
    expect(result.manifest.objects.some((one) => one.id === fixture.vera.id)).toBe(false);
    // The session travels — its export is smaller than her card — and it is
    // what names her, by its cast.
    expect(result.manifest.sessions.map((one) => one.id)).toEqual([fixture.night.id]);
    expect(result.manifest.leftBehind).toContainEqual({
      schema: ACTOR_SCHEMA,
      id: fixture.vera.id,
      name: 'Vera',
      reason: 'too-large',
      required: false,
      from: [fixture.night.id],
    });
    expect(result.manifest.omitted).toContainEqual({
      key: 'publish.file.objectTooLarge',
      level: 'warn',
      params: { id: fixture.vera.id, name: 'Vera', schema: ACTOR_SCHEMA, bytes: card },
    });
    // Nor does the World name her: what does not travel is not a member of it.
    const world = result.members.find((member) => member.name.endsWith('/world.json'));
    if (world === undefined || !('bytes' in world)) throw new Error('no world.json');
    expect(contains(world.bytes, fixture.vera.id)).toBe(false);
  });

  /**
   * ***A book play wrote stays home*** (2026-10-10, the P16.3c review). Its
   * entries carry the session and turn they were remembered from, and their
   * text is what that session's play produced — so a memory book carried
   * because the World names it would send an unticked session's id, and
   * something of its transcript, with it. `provenance.source === 'session'`
   * is the marking the library page reads to say *not meant to be shared or
   * published*, and the planner reads the same one.
   *
   * *Since [P16.3d] (2026-10-10) the rule says so before the planner does*:
   * the walker marks the book `writtenByPlay` and `fileSet` never carries it,
   * so this test holds both halves — the plan the confirm would build never
   * asks for the book, and a plan that asks for it by hand is still refused it.
   */
  it('leaves a book written by play behind, and names nothing of the sessions it remembers', async () => {
    const library = fixture.server.services.library;
    const memory = newMemoryBook(
      { actor: fixture.vera.id, persona: null },
      { actor: 'Vera', persona: null },
    );
    const remembered = {
      ...memory,
      entries: [
        {
          ...newLoreEntry('The confession'),
          content: 'She said the tide was hers to call.',
          metadata: {
            'se.memory': {
              sessionId: fixture.secret.id,
              turnId: fixture.secretTurnId,
              at: AT.toISOString(),
              by: 'manual',
            },
          },
        },
      ],
    };
    await create(library, 'ned', remembered, LOREBOOK_SCHEMA);
    const stored = read(library, 'ned', fixture.world.id);
    const world = stored.body as World;
    await update(
      library,
      'ned',
      fixture.world.id,
      {
        ...world,
        contents: [...world.contents, envelope({ ...remembered, schema: LOREBOOK_SCHEMA })],
      },
      stored.contentHash,
    );

    const plan = await planned(fixture, worldStart(), { [fixture.night.id]: true }, true, stage);
    expect(plan.manifest.objects.some((one) => one.id === memory.id)).toBe(false);
    const stayedHome = {
      schema: LOREBOOK_SCHEMA,
      id: memory.id,
      name: memory.name,
      reason: 'not-portable',
      required: false,
      from: [],
    };
    expect(plan.manifest.leftBehind).toContainEqual(stayedHome);
    // ***Said by the rule since [P16.3d]***, not discovered by the writer: the
    // walker marks the book and `fileSet` never asks for it, so the plan the
    // confirm builds holds the row before the writer reads a byte — and the
    // writer's own note, which is its backstop's, is not needed.
    expect(plan.manifest.leftBehind.filter((one) => one.id === memory.id)).toHaveLength(1);
    expect(plan.manifest.omitted.some((one) => one.key === 'publish.file.writtenByPlay')).toBe(
      false,
    );

    // ***And the writer's own check, belt and braces***: a plan built some
    // other way than from `fileSet` — asking for the book by hand, as a member
    // — still leaves it home, with the writer's note.
    const byHand = await publishPlan(fixture, worldStart(), { [fixture.night.id]: true }, true);
    const forced = await planWorldFile(
      fixture.context,
      'ned',
      {
        ...byHand,
        objects: [...byHand.objects, { id: memory.id, member: true }],
        leftBehind: byHand.leftBehind.filter((one) => one.id !== memory.id),
      },
      stage,
    );
    if ('refusal' in forced) throw new Error(`refused: ${forced.refusal}`);
    expect(forced.manifest.objects.some((one) => one.id === memory.id)).toBe(false);
    expect(forced.manifest.leftBehind).toContainEqual(stayedHome);
    expect(forced.manifest.omitted).toContainEqual({
      key: 'publish.file.writtenByPlay',
      level: 'warn',
      params: { id: memory.id, name: memory.name, schema: LOREBOOK_SCHEMA },
    });

    const path = join(fixture.out, 'with-memories.seworld');
    await writeWorldFile(plan, path);
    const file = await unpack(path);
    expect(contains(file.bytes, fixture.secret.id)).toBe(false);
    expect(contains(file.bytes, fixture.secretTurnId)).toBe(false);
    expect(contains(file.bytes, SECRET_NAME)).toBe(false);
    expect(contains(file.bytes, 'She said the tide was hers to call.')).toBe(false);
    const published = json(file.entries, 'library/worlds/rain-city/world.json') as World;
    expect(published.contents.some((entry) => entry.id === memory.id)).toBe(false);
  });

  /**
   * ***A card carries the pictures its rows name, and no others*** (2026-10-10,
   * the P16.3c review). The store never takes a picture out of a card — an
   * actor's history keeps its JSON and not its pixels, so the card is where a
   * restored version finds them — and a card copied whole would send an
   * expression the author removed, history off or on. So a card holding a
   * picture no current row names is re-spliced without it (the codec splices
   * chunks and never re-encodes pixels), and only then.
   */
  it('carries a card without an expression the author removed, and its numbers agree', async () => {
    const library = fixture.server.services.library;
    const now = read(library, 'ned', fixture.vera.id);
    await update(
      library,
      'ned',
      fixture.vera.id,
      { ...(now.body as object), media: [] },
      now.contentHash,
    );
    const storedPath = read(library, 'ned', fixture.vera.id).path;
    const stored = pngCardCodec.read(new Uint8Array(await readFile(storedPath)));
    expect(stored.blobs.has('smiling')).toBe(true);
    const removed = Buffer.from(noise(40_000, 2).subarray(20_000, 20_064));

    for (const history of [false, true]) {
      const plan = await planned(
        fixture,
        { kind: 'objects', ids: [fixture.vera.id] },
        {},
        history,
        stage,
      );
      const path = join(fixture.out, `vera-${String(history)}.seworld`);
      await writeWorldFile(plan, path);
      const file = await unpack(path);
      const card = file.entries.get('library/actors/vera/card.png')!;
      const carried = pngCardCodec.read(card);
      expect(carried.blobs.size).toBe(0);
      expect(carried.envelope).toEqual(stored.envelope);
      expect(Buffer.from(file.bytes).includes(removed)).toBe(false);
      expect(plan.manifest.objects[0]?.contentHash).toBe(sha256(card));

      const facts = await measureObject(
        fixture.context,
        'ned',
        read(library, 'ned', fixture.vera.id),
        { history },
      );
      expect(facts).toMatchObject({ entries: 1, bytes: card.length, pictures: { count: 0 } });
    }
  });

  /**
   * ***The bytes copied are the body that chose the pictures*** (2026-10-10,
   * the P16.3c review). The plan picks an object's pictures, name and edges
   * from the index's row, then reads the file; a file that is not the row's —
   * saved in between, or edited by hand before the watcher re-read it — would
   * travel with the old body's pictures. So it is the same `409` as a change
   * between plan and write.
   */
  it('throws WorldFileChangedError when the stored file is not the body the index holds', async () => {
    const plan = await publishPlan(
      fixture,
      { kind: 'objects', ids: [fixture.harbour.id] },
      {},
      false,
    );
    const book = read(fixture.server.services.library, 'ned', fixture.harbour.id);
    await writeFile(
      book.path,
      `${JSON.stringify({ ...(book.body as object), media: [] }, null, 2)}\n`,
    );

    const error = await planWorldFile(fixture.context, 'ned', plan, stage).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(WorldFileChangedError);
    expect((error as WorldFileChangedError).path).toBe('library/lorebooks/harbour/lorebook.json');
  });

  /**
   * ***The World the plan reads is the World it was handed*** (2026-10-11, the
   * P16.3d review). A World start's `world.json` is encoded from the body the
   * confirm read; its folder and pictures come from the row the plan reads
   * itself, later. A save in between — a rename, a picture replaced — would
   * pair the old `world.json` with the new row's pictures in a file that says
   * nothing changed. So the plan holds its read to the hash it was handed, and
   * a World gone or saved since is the same `409` as any other change.
   */
  it('throws WorldFileChangedError when the World is saved between the hand-over and the plan', async () => {
    const library = fixture.server.services.library;
    const plan = await publishPlan(fixture, { kind: 'world', id: fixture.world.id }, {}, false);
    const stored = read(library, 'ned', fixture.world.id);
    await update(
      library,
      'ned',
      fixture.world.id,
      { ...(stored.body as World), name: 'Rain Town' },
      stored.contentHash,
    );

    const error = await planWorldFile(fixture.context, 'ned', plan, stage).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(WorldFileChangedError);
    expect((error as WorldFileChangedError).path).toBe(fixture.world.id);

    // Handed the World as it is now, the same plan is made.
    const again = await publishPlan(fixture, { kind: 'world', id: fixture.world.id }, {}, false);
    const result = await planWorldFile(fixture.context, 'ned', again, stage);
    expect('refusal' in result).toBe(false);
  });

  /**
   * ***A picture whose bytes contradict its name stays home***, named, and
   * the rest is written: the reader verifies each against its name (P16.3e)
   * and would refuse it on arrival. Both kinds that are addressed by their
   * hash — a book's gallery picture and a session's attachment.
   */
  it('leaves a damaged picture behind with a note, and writes the rest', async () => {
    const book = read(fixture.server.services.library, 'ned', fixture.harbour.id);
    await writeFile(join(book.path, '..', 'assets', fixture.galleryName), makePng(6, 9));
    const digest = `sha256:${fixture.attachmentName.replace(/\.png$/, '')}`;
    const attachment = await attachmentOnDisk(
      fixture.server.services.layout,
      'ned',
      fixture.night.id,
      digest,
    );
    if (attachment === null) throw new Error('the attachment is not on disk');
    await writeFile(attachment.path, makePng(5, 9));

    const plan = await planned(fixture, worldStart(), { [fixture.night.id]: true }, false, stage);
    const names = plan.members.map((member) => member.name);
    expect(names.some((name) => name.endsWith(fixture.galleryName))).toBe(false);
    expect(names.some((name) => name.endsWith(fixture.attachmentName))).toBe(false);
    expect(plan.manifest.omitted).toContainEqual({
      key: 'publish.file.pictureDamaged',
      level: 'warn',
      params: { id: fixture.harbour.id, name: 'Harbour', ref: `assets/${fixture.galleryName}` },
    });
    expect(plan.manifest.omitted).toContainEqual({
      key: 'publish.file.pictureDamaged',
      level: 'warn',
      params: {
        id: fixture.night.id,
        name: 'Night one',
        ref: `attachments/${fixture.attachmentName}`,
      },
    });
    const path = join(fixture.out, 'damaged.seworld');
    await writeWorldFile(plan, path);
    expect((await unpack(path)).names).toEqual(names);
  });

  /**
   * ***The bound is the readers', exactly*** (2026-10-10, the P16.3c review):
   * a file with no World has no `world.json` to make room for, so a plan of
   * exactly `maxEntries` members is planned and written, and one more is not.
   */
  it('plans a file of exactly maxEntries members, and refuses one more', async () => {
    const start = { kind: 'objects' as const, ids: [fixture.harbour.id] };
    const at = (maxEntries: number): WorldFileContext => ({
      ...fixture.context,
      limits: { ...DEFAULT_ZIP_WRITE_LIMITS, maxEntries },
    });
    // The manifest, the book, its picture.
    const plan = await planned(fixture, start, {}, false, stage, at(3));
    expect(plan.entries).toBe(3);
    const path = join(fixture.out, 'exact.seworld');
    expect(await writeWorldFile(plan, path)).toMatchObject({ entries: 3 });
    const plan2 = await publishPlan(fixture, start, {}, false);
    expect(await planWorldFile(at(2), 'ned', plan2, stage)).toEqual({ refusal: 'too-many-files' });
  });

  /**
   * ***Refused before a byte is read.*** A picture that cannot be read at all
   * — a directory where the file should be — makes the read throw, so a plan
   * that answers with a refusal answered before it read anything; and with
   * room, the same plan reaches the read and fails there, which is what makes
   * the first answer mean *before*.
   */
  it('refuses too many files, or too many bytes, before it reads a file', async () => {
    const book = read(fixture.server.services.library, 'ned', fixture.harbour.id);
    const picture = join(book.path, '..', 'assets', fixture.galleryName);
    await rm(picture);
    await mkdir(picture);
    const plan = await publishPlan(fixture, worldStart(), { [fixture.night.id]: true }, false);
    const few = { ...fixture.context, limits: { ...DEFAULT_ZIP_WRITE_LIMITS, maxEntries: 4 } };
    expect(await planWorldFile(few, 'ned', plan, stage)).toEqual({ refusal: 'too-many-files' });
    const small = {
      ...fixture.context,
      limits: { ...DEFAULT_ZIP_WRITE_LIMITS, maxArchiveBytes: 2048 },
    };
    expect(await planWorldFile(small, 'ned', plan, stage)).toEqual({ refusal: 'too-large' });
    await expect(planWorldFile(fixture.context, 'ned', plan, stage)).rejects.toThrow();
  });

  /**
   * ***Folders compared as a filesystem that folds case would*** — macOS's,
   * Windows' — so a file made here extracts to the same tree there. Two books
   * whose folders differ only in case are two folders on this disk and would
   * be one on that one.
   */
  it('suffixes a folder that differs from another of its kind only in case', async () => {
    const library = fixture.server.services.library;
    const second = newLorebook('Harbour, the second');
    await create(library, 'ned', second, LOREBOOK_SCHEMA);
    const folder = dirname(read(library, 'ned', second.id).path);
    await rename(folder, join(dirname(folder), 'Harbour'));
    await rebuild(fixture.server.services.index.db, fixture.server.services.layout);
    expect(basename(dirname(read(library, 'ned', second.id).path))).toBe('Harbour');

    const plan = await planned(
      fixture,
      { kind: 'objects', ids: [fixture.harbour.id, second.id] },
      {},
      false,
      stage,
    );
    expect(plan.manifest.objects.map((one) => one.folder)).toEqual([
      'library/lorebooks/harbour',
      'library/lorebooks/Harbour-2',
    ]);
  });

  it('publishes a World still stored under packages/ as world/1 under library/worlds/', async () => {
    const vera = fixture.vera;
    const legacy = {
      ...newWorld('Old Harbour'),
      schema: LEGACY_PACKAGE_SCHEMA,
      contents: [{ schema: ACTOR_SCHEMA, id: vera.id, name: 'Vera' }],
    };
    const folder = join(
      fixture.server.dataDir,
      'users',
      'ned',
      'library',
      'packages',
      'old-harbour',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), `${JSON.stringify(legacy, null, 2)}\n`);
    await rebuild(fixture.server.services.index.db, fixture.server.services.layout);

    const plan = await planned(fixture, { kind: 'world', id: legacy.id }, {}, true, stage);
    const path = join(fixture.out, 'old-harbour.seworld');
    await writeWorldFile(plan, path);
    const file = await unpack(path);
    expect(file.names.slice(0, 3)).toEqual([
      WORLD_FILE_MANIFEST,
      'library/worlds/old-harbour/world.json',
      'library/actors/vera/card.png',
    ]);
    expect(file.names.some((name) => name.includes('packages'))).toBe(false);
    const published = json(file.entries, 'library/worlds/old-harbour/world.json') as World;
    expect(published.schema).toBe(WORLD_SCHEMA);
    expect(published.contents).toEqual(legacy.contents);
  });
});
