// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImportItemReport, Rendition, SessionExport } from '@storyengine/shared';

import { capPrompt } from '../../providers/prompt-caps.js';
import { readRenditions } from '../../renditions/store.js';
import { assetPath } from '../../renditions/worker.js';
import { importSession } from '../../sessions/import.js';
import { readFileBytes } from '../../storage/files.js';
import { openLocalSource } from '../../storage/local-source.js';
import { makeTestServer, setUpAdmin, tempRoot, type TestServer } from '../../test-server.js';
import {
  buildAventurasDatabase,
  FIXTURE_PICTURES,
  INLINE_PICTURES,
  LANTERN_FORK,
  STORY_TREES,
  writeAventurasBackupFolder,
} from '../fixtures/test-aventuras-db.js';
import { sweep } from '../sweep.js';
import { carryPictures, planPictures, type PicturePlan } from './pictures.js';
import { tablesIn } from './schema.js';
import { produceStory, type StoryProduction } from './story.js';
import { readStoryRows, type AventurasStoryRows } from './story-rows.js';

/**
 * ***A story's pictures, as renditions*** —
 * [P13.13](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * Three layers, as the stage has three. **The plan** — which turn each of the
 * *Lantern Fork*'s pictures hangs off, under which id, with what recipe and
 * what provenance — against the producer's own placement, with nothing
 * written. **The bytes** — the bounded row reader, the sniff, and the hook
 * `importSession` writes them through, including the one refusal that must
 * leave no picture behind. **The Writer** — a sweep with a bound set just
 * under one picture, which costs that picture and not the story. What a
 * person meets through the doors, and the second sweep, are the route
 * test's (`routes/import-aventuras-stories.test.ts`).
 */

let open: DatabaseSync[] = [];

afterEach(() => {
  for (const db of open) if (db.isOpen) db.close();
  open = [];
});

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  open.push(db);
  buildAventurasDatabase(db, { storyTrees: STORY_TREES });
  return db;
}

function rowsOf(db: DatabaseSync, maxPictureBytes?: number): AventurasStoryRows {
  const rows = readStoryRows(
    db,
    LANTERN_FORK.id,
    tablesIn(db),
    maxPictureBytes === undefined ? {} : { maxPictureBytes },
  );
  if (rows === null) throw new Error('no Lantern Fork');
  return rows;
}

const ORIGIN = `aventura.db/stories/${LANTERN_FORK.id}`;

function produced(rows: AventurasStoryRows, handle = 'ned'): StoryProduction & { ok: true } {
  const production = produceStory(rows, { handle, origin: ORIGIN });
  if (!production.ok) throw new Error('the Lantern Fork produced nothing');
  return production;
}

/** The turn an Aventuras entry became, by the producer's own word. */
function turnOfEntry(production: StoryProduction & { ok: true }, entryId: string): string {
  const turn = production.placement.turnOf.get(entryId);
  if (turn === undefined) throw new Error(`no turn for ${entryId}`);
  return turn;
}

function planned(plan: PicturePlan, sourceId: string): Rendition {
  const found = plan.planned.find((one) => one.source.id === sourceId);
  if (found === undefined) throw new Error(`nothing planned for ${sourceId}`);
  return found.rendition;
}

describe('the plan: which turn, which id, what record', () => {
  it('hangs each illustration off the turn that holds its entry, on whichever branch', () => {
    const rows = rowsOf(database());
    const production = produced(rows);
    const plan = planPictures(rows, production.placement, 'The Lantern Fork');

    // The opening, a paired answer (twice), the forked action, a branch the
    // person was not on, the head — and the corrupt one, which is planned and
    // only found out when its bytes are read.
    expect(plan.planned.map((one) => one.source.id).sort()).toEqual(
      [
        'lf-p-opening',
        'lf-p-lamp',
        'lf-p-lamp-again',
        'lf-p-fork',
        'lf-p-ferry',
        'lf-p-large',
        'lf-p-corrupt',
        'lf-bg-main',
        'lf-bg-tower',
      ].sort(),
    );

    const opening = turnOfEntry(production, 'lf-e1');
    const lamp = turnOfEntry(production, 'lf-e3');
    expect(planned(plan, 'lf-p-opening')).toMatchObject({
      turnId: opening,
      id: `${opening}.0`,
      purpose: 'illustration',
    });
    // A paired turn: the answer's pictures, in the order they were made.
    expect(turnOfEntry(production, 'lf-e2')).toBe(lamp);
    expect(planned(plan, 'lf-p-lamp')).toMatchObject({ turnId: lamp, id: `${lamp}.0` });
    expect(planned(plan, 'lf-p-lamp-again')).toMatchObject({ turnId: lamp, id: `${lamp}.1` });

    // The forked action was written on main: main's turn, not Tower's re-pairing.
    const fork = planned(plan, 'lf-p-fork');
    const mainTurn = production.document.turns.find((turn) => turn.id === fork.turnId);
    expect(mainTurn?.output?.text).toBe('The beam sweeps the bay.');

    // Ferry is not the head, and its picture is on Ferry's turn all the same.
    const ferry = planned(plan, 'lf-p-ferry');
    expect(ferry.turnId).toBe(turnOfEntry(production, 'lf-f2'));
    expect(production.document.turns.find((turn) => turn.id === ferry.turnId)?.output?.text).toBe(
      'The ferry is waiting.',
    );
  });

  it('hangs a branch’s backdrop off the turn its line ends on, newest only, after its illustrations', () => {
    const rows = rowsOf(database());
    const production = produced(rows);
    const plan = planPictures(rows, production.placement, 'The Lantern Fork');

    const main = planned(plan, 'lf-bg-main');
    expect(main.purpose).toBe('background');
    expect(main.turnId).toBe(production.placement.headOf.get(null));
    expect(main.scope).toBeNull();
    // The older main backdrop is one Aventuras never shows; not carried.
    expect(plan.planned.some((one) => one.source.id === 'lf-bg-main-old')).toBe(false);

    // Tower's backdrop is on the head — after the head's illustration.
    const tower = planned(plan, 'lf-bg-tower');
    expect(tower.turnId).toBe(production.document.session.headTurnId);
    expect(tower.id).toBe(`${tower.turnId}.1`);
    expect(planned(plan, 'lf-p-large').id).toBe(`${tower.turnId}.0`);

    // What was not planned, said.
    expect(plan.notes).toEqual([
      {
        key: 'import.aventuras.picturesUnfinished',
        params: { story: 'The Lantern Fork', count: 1 },
        level: 'info',
      },
      {
        key: 'import.aventuras.picturesUnplaced',
        params: { story: 'The Lantern Fork', count: 1 },
        level: 'warn',
      },
      {
        key: 'import.aventuras.checkpointBackgrounds',
        params: { story: 'The Lantern Fork', count: 1 },
        level: 'info',
      },
    ]);
  });

  it('writes a finished record with Aventuras’ recipe and no claim of a request', () => {
    const rows = rowsOf(database());
    const plan = planPictures(rows, produced(rows).placement, 'The Lantern Fork');

    const lamp = planned(plan, 'lf-p-lamp');
    expect(lamp).toMatchObject({
      schema: 'storyengine.rendition/1',
      kind: 'image',
      state: 'ready',
      error: null,
      ordering: 0,
      // Aventuras' own `source_text`, which it matches without case.
      scope: { anchor: 'LAMP ROOM' },
      provenance: {
        at: new Date(LANTERN_FORK_CREATED + 11_000).toISOString(),
        binding: null,
        answeredAs: null,
        seed: null,
        workflow: {},
      },
      foreign: { source: 'aventuras', id: 'lf-p-lamp' },
    });
    expect(lamp.anchorResolved).toBeUndefined();
    // The recipe is the prompt, whole — and re-caps to itself, as every
    // stored recipe must.
    expect(lamp.prompt.text).toBe('An old lamp room, brass and oil');
    expect(
      capPrompt(
        lamp.prompt.fragments.map((fragment) => ({ ...fragment })),
        // The stored nulls, as `assemblePrompt` converts them back.
        { maxChars: undefined, usefulChars: undefined },
        lamp.prompt.separator,
      ).text,
    ).toBe(lamp.prompt.text);

    // A quote the entry does not have is a miss, recorded; no quote is no anchor.
    expect(planned(plan, 'lf-p-lamp-again').anchorResolved).toBe(false);
    expect(planned(plan, 'lf-p-fork').scope).toBeNull();
    // A backdrop has no prompt in Aventuras, and the recipe says so.
    expect(planned(plan, 'lf-bg-main').prompt).toMatchObject({ text: '', fragments: [] });

    // Two recipes, two digests; the same rows, the same records.
    expect(lamp.digest).not.toBe(planned(plan, 'lf-p-lamp-again').digest);
    const again = rowsOf(database());
    expect(planPictures(again, produced(again).placement, 'The Lantern Fork').planned).toEqual(
      plan.planned,
    );
  });
});

describe('inline pictures: the tags out of the prose, the pictures where they stood', () => {
  /**
   * Found at P13.13 and fixed with P13.14: Aventuras' `<pic …>` tags are
   * placeholders its renderer swaps for the picture, so the turn text is the
   * prose without them, and a picture whose `source_text` was its tag is
   * anchored on the sentence the tag followed (`pic-tags.ts`).
   */
  function inline(): { rows: AventurasStoryRows; production: StoryProduction & { ok: true } } {
    const db = new DatabaseSync(':memory:');
    open.push(db);
    buildAventurasDatabase(db, { storyTrees: [INLINE_PICTURES] });
    const rows = readStoryRows(db, INLINE_PICTURES.id, tablesIn(db));
    if (rows === null) throw new Error('no Inline Pictures');
    const production = produceStory(rows, {
      handle: 'ned',
      origin: `aventura.db/stories/${INLINE_PICTURES.id}`,
    });
    if (!production.ok) throw new Error('Inline Pictures produced nothing');
    return { rows, production };
  }

  it('carries the prose as Aventuras showed it, and an entry with no tag byte for byte', () => {
    const { production } = inline();
    const texts = production.document.turns.map((turn) => turn.output?.text);
    expect(texts).toEqual([
      'The tide is out. Boats lean on the mud.\n\n' +
        'Somebody calls from the pier. The tide is out.\n\n' +
        'A bell rings. Then nothing.',
      'The mud holds.',
    ]);
    expect(JSON.stringify(production.document)).not.toContain('<pic');
  });

  it('anchors each picture on the sentence its tag followed, and says which cannot be placed', () => {
    const { rows, production } = inline();
    const plan = planPictures(rows, production.placement, INLINE_PICTURES.title);

    // First in its entry: nothing before it to follow, so under the text, and
    // no quote to have missed.
    const first = planned(plan, 'ip-p-first');
    expect(first.scope).toBeNull();
    expect(first.anchorResolved).toBeUndefined();

    // After a sentence that also opens the entry: the quote grows back a
    // sentence so it names this place and not the first.
    expect(planned(plan, 'ip-p-pier')).toMatchObject({
      scope: { anchor: 'Somebody calls from the pier. The tide is out' },
    });
    expect(planned(plan, 'ip-p-pier').anchorResolved).toBeUndefined();

    // Mid-line, with a `>` in its prompt — Aventuras' pattern keeps it one tag.
    expect(planned(plan, 'ip-p-bell').scope).toEqual({ anchor: 'A bell rings' });

    // A tag the entry never held is a miss like any quote's, and keeps the tag.
    const elsewhere = planned(plan, 'ip-p-elsewhere');
    expect(elsewhere.anchorResolved).toBe(false);
    expect(elsewhere.scope?.anchor).toBe(
      '<pic prompt="A tag this entry never held" characters=""></pic>',
    );
  });
});

/** Under the one large picture's size by half, and over every other's many times. */
const PICTURE_BOUND = 2048;

/** When the fixture writes its trees: the first tree's base time. */
const LANTERN_FORK_CREATED = 1_758_000_000_000;

describe('the bytes', () => {
  it('reads each picture on its own, sniffs what it is, and says what it could not carry', () => {
    const rows = rowsOf(database());
    const plan = planPictures(rows, produced(rows).placement, 'The Lantern Fork');
    const carried = carryPictures(plan, rows.pictures.read, rows.pictures.maxBytes, 'x');

    expect(carried.illustrations).toBe(6);
    expect(carried.backgrounds).toBe(2);
    const byForeign = new Map(carried.renditions.map((one) => [one.foreign?.id, one]));
    // The JPEG under a PNG data URL is a JPEG, by its bytes.
    expect(byForeign.get('lf-p-lamp')?.asset).toMatchObject({
      mime: 'image/jpeg',
      path: `${byForeign.get('lf-p-lamp')?.id ?? ''}.jpg`,
      bytes: FIXTURE_PICTURES.lamp.byteLength,
    });
    expect(byForeign.get('lf-p-ferry')?.asset?.mime).toBe('image/webp');
    // A PNG under a JPEG data URL is a PNG.
    expect(byForeign.get('lf-bg-tower')?.asset?.mime).toBe('image/png');
    // Not a picture at all: left out, and counted.
    expect(byForeign.has('lf-p-corrupt')).toBe(false);
    expect(carried.notes.map((note) => note.key)).toEqual([
      'import.aventuras.pictureUnreadable',
      'import.aventuras.pictureModels',
    ]);
    expect(carried.notes[1]?.params).toEqual({
      story: 'x',
      models: 'fixture-image-model, other-image-model',
    });
  });

  it('measures a picture past the bound and never decodes it, and the rest still come', () => {
    // Half the picture: its stored text is past the bound's own allowance, so
    // SQLite's length answers and the value is never selected.
    const bound = PICTURE_BOUND;
    const rows = rowsOf(database(), bound);
    const large = rows.pictures.illustrations.find((one) => one.id === 'lf-p-large');
    const opening = rows.pictures.illustrations.find((one) => one.id === 'lf-p-opening');
    // Its stored length is what the listing carries, and the bound is met on it.
    expect(large?.octets).toBeGreaterThan(bound);
    expect(rows.pictures.read(large!)).toBe('too-large');
    expect(rows.pictures.read(opening!)).toEqual(FIXTURE_PICTURES.opening);

    const plan = planPictures(rows, produced(rows).placement, 'The Lantern Fork');
    const carried = carryPictures(plan, rows.pictures.read, rows.pictures.maxBytes, 'x');
    expect(carried.renditions.some((one) => one.foreign?.id === 'lf-p-large')).toBe(false);
    expect(carried.illustrations).toBe(5);
    expect(carried.notes[0]).toEqual({
      key: 'import.aventuras.pictureTooLarge',
      params: { story: 'x', count: 1, limit: 0 },
      level: 'warn',
    });
  });

  it('gives the hook the bytes it first read, and nothing when they have changed or cannot be read', async () => {
    const rows = rowsOf(database());
    const plan = planPictures(rows, produced(rows).placement, 'The Lantern Fork');
    let fail = false;
    let swap = false;
    const read: typeof rows.pictures.read = (picture) => {
      if (fail) throw new Error('the database went away');
      return swap ? FIXTURE_PICTURES.bay : rows.pictures.read(picture);
    };
    const carried = carryPictures(plan, read, rows.pictures.maxBytes, 'x');
    const opening = carried.renditions.find((one) => one.foreign?.id === 'lf-p-opening')!;

    expect(await carried.pixels(opening.asset!.path)).toEqual(FIXTURE_PICTURES.opening);
    expect(await carried.pixels('not-a-path-it-named.png')).toBeNull();
    swap = true;
    expect(await carried.pixels(opening.asset!.path)).toBeNull();
    swap = false;
    fail = true;
    await expect(carried.pixels(opening.asset!.path)).resolves.toBeNull();
    expect(carried.lost()).toBe(2);
  });
});

describe('through importSession', () => {
  let server: TestServer;
  let container: string;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
    container = await tempRoot('se-aventuras-pictures-');
  });

  afterEach(async () => {
    await server.dispose();
    await rm(container, { recursive: true, force: true });
  });

  function lantern(): {
    document: SessionExport;
    pixels: (path: string) => Promise<Uint8Array | null>;
  } {
    const rows = rowsOf(database());
    const production = produced(rows);
    const carried = carryPictures(
      planPictures(rows, production.placement, 'The Lantern Fork'),
      rows.pictures.read,
      rows.pictures.maxBytes,
      'The Lantern Fork',
    );
    production.document.renditions = carried.renditions;
    return { document: production.document, pixels: carried.pixels };
  }

  it('writes every record and its bytes into the new session, readable where the route reads them', async () => {
    const { document, pixels } = lantern();
    const result = await importSession({ sessions: server.services.sessions }, 'ned', document, {
      originalFilename: ORIGIN,
      pixels,
    });
    expect(result).toMatchObject({ ok: true, renditions: 8 });
    if (!result.ok) return;

    const { layout } = server.services.sessions;
    const held = await readRenditions(layout, 'ned', result.sessionId);
    expect(held.size).toBe(8);
    for (const rendition of held.values()) {
      expect(rendition.sessionId).toBe(result.sessionId);
      expect(rendition.state).toBe('ready');
      const path = assetPath(layout, 'ned', result.sessionId, rendition);
      expect(path).not.toBeNull();
      const bytes = await readFileBytes(path!);
      expect(bytes?.byteLength).toBe(rendition.asset?.bytes);
    }
    const ferry = [...held.values()].find((one) => one.foreign?.id === 'lf-p-ferry')!;
    const onDisk = await readFileBytes(assetPath(layout, 'ned', result.sessionId, ferry)!);
    expect(new Uint8Array(onDisk!)).toEqual(FIXTURE_PICTURES.ferry);

    // Finished records, never jobs: nothing is queued for any of them.
    const jobs = server.services.state.db
      .prepare('select count(*) as n from rendition_job')
      .get() as { n: unknown };
    expect(Number(jobs.n)).toBe(0);
  });

  it('writes no picture anywhere when the reader refuses the story', async () => {
    const { document, pixels } = lantern();
    const asked = vi.fn(pixels);
    // A head that names no turn: `broken-tree`, before anything is written.
    document.session.headTurnId = 'a-turn-that-is-not-here';
    const result = await importSession({ sessions: server.services.sessions }, 'ned', document, {
      originalFilename: ORIGIN,
      pixels: asked,
    });
    expect(result).toEqual({ ok: false, reason: 'broken-tree' });
    expect(asked).not.toHaveBeenCalled();

    const sessions = dirname(server.services.sessions.layout.sessionRoot('ned', 'x'));
    const left = await readdir(sessions).catch(() => [] as string[]);
    expect(left).toEqual([]);
  });

  it('costs the one picture past the bound through a sweep, and the story still imports', async () => {
    const root = join(container, 'aventura-backup');
    await writeAventurasBackupFolder(root, { storyTrees: STORY_TREES });
    const opened = await openLocalSource(root, server.dataDir);
    if (!opened.ok) throw new Error(opened.refusal);

    const outcome = await sweep({
      library: server.services.library,
      handle: 'ned',
      tags: server.services.tags,
      files: opened.source,
      stories: {
        sessions: server.services.sessions,
        maxPictureBytes: PICTURE_BOUND,
      },
    });
    if (!outcome.ok) throw new Error(outcome.refusal);
    const row = outcome.report.items.find((item: ImportItemReport) => item.source === ORIGIN)!;
    expect(row.disposition).toBe('converted');
    const said = new Map(row.notes.map((note) => [note.key, note.params]));
    expect(said.get('import.aventuras.storyPictures')).toEqual({
      story: 'The Lantern Fork',
      illustrations: 5,
      backgrounds: 2,
    });
    expect(said.get('import.aventuras.pictureTooLarge')).toMatchObject({ count: 1 });
    expect(said.has('import.aventuras.pictureUnreadable')).toBe(true);

    const held = await readRenditions(server.services.sessions.layout, 'ned', row.objectId!);
    expect(held.size).toBe(7);
    expect([...held.values()].some((one) => one.foreign?.id === 'lf-p-large')).toBe(false);
  });
});
