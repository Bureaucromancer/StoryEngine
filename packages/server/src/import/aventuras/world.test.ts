// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import type { ImportNote, LoreEntry, Lorebook } from '@storyengine/shared';

import {
  buildAventurasDatabase,
  FIXTURE_PORTRAITS,
  LANTERN_FORK,
  QUIET_HARBOUR,
  STORY_TREES,
  type AventurasDbOptions,
} from '../fixtures/test-aventuras-db.js';
import { stableId } from '../identity.js';
import { convertAventurasEntries } from './lorebook.js';
import { aventurasPreflight, tablesIn } from './schema.js';
import {
  readStoryRows,
  type AventurasBranch,
  type AventurasCharacter,
  type AventurasStoryRows,
  type AventurasWorld,
} from './story-rows.js';
import { produceWorld, resolveWorld, WORLD_TAGS, type WorldProduction } from './world.js';

/**
 * ***A story's world*** —
 * [P13.12](../../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * [19 §2.3.1](../../../../../docs/design/19-session-import.md).
 *
 * Two halves, as the file under test has two. **Resolution** is held to
 * Aventuras' own `get*Resolved` (`database.ts`) and its three kinds of branch,
 * on worlds built by hand here, so each case is one line of rows and the rule
 * it makes is named beside it. **Production** is held to the fixture's
 * *Lantern Fork*, read out of a real database through `story-rows.ts` so the
 * column gate and the row reader are exercised with it: every kind, mapped;
 * the ids; and what the review is told. That the objects are written and the
 * session links them is the route test's
 * (`routes/import-aventuras-stories.test.ts`).
 */

let open: DatabaseSync[] = [];

afterEach(() => {
  for (const db of open) if (db.isOpen) db.close();
  open = [];
});

function database(options: AventurasDbOptions = {}): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  open.push(db);
  buildAventurasDatabase(db, { storyTrees: STORY_TREES, ...options });
  return db;
}

function rowsOf(db: DatabaseSync, story: { id: string }, maxPortraitBytes?: number) {
  const rows = readStoryRows(
    db,
    story.id,
    tablesIn(db),
    maxPortraitBytes === undefined ? {} : { maxPortraitBytes },
  );
  if (rows === null) throw new Error(`no story ${story.id}`);
  return rows;
}

const ORIGIN = `aventura.db/stories/${LANTERN_FORK.id}`;

function lantern(): WorldProduction {
  return produceWorld(rowsOf(database(), LANTERN_FORK), ORIGIN);
}

function entry(book: Lorebook | null, name: string): LoreEntry {
  const found = book?.entries.filter((one) => one.name === name) ?? [];
  if (found.length !== 1) throw new Error(`${String(found.length)} entries named ${name}`);
  return found[0]!;
}

function keys(notes: readonly ImportNote[]): string[] {
  return notes.map((note) => note.key);
}

// ── Hand-built worlds, for resolution ─────────────────────────────────────

/** A character on `branch` (`null` is main), editing `overrides` when given. */
function character(
  id: string,
  name: string,
  branch: string | null,
  extra: Partial<AventurasCharacter> = {},
): AventurasCharacter {
  return {
    id,
    branchId: branch,
    overridesId: null,
    deleted: false,
    name,
    description: null,
    relationship: null,
    traits: [],
    visualDescriptors: undefined,
    status: null,
    metadata: undefined,
    portraitOctets: null,
    ...extra,
  };
}

function world(characters: AventurasCharacter[]): AventurasWorld {
  return {
    characters,
    locations: [],
    items: [],
    beats: [],
    lore: [],
    unreadable: 0,
    portrait: () => null,
  };
}

function branch(id: string, parent: string | null, snapshotComplete = false): AventurasBranch {
  return { id, name: id, parentBranchId: parent, forkEntryId: 'e', createdAt: 0, snapshotComplete };
}

function names(resolved: { characters: AventurasCharacter[] }): string[] {
  return resolved.characters.map((one) => one.name).sort();
}

describe('resolving the head branch', () => {
  const main = [character('a', 'Ada', null), character('b', 'Bram', null)];

  it('lets a branch’s edit shadow the row it edits, under the original’s id', () => {
    const resolved = resolveWorld(
      world([...main, character('a2', 'Ada, older', 'x', { overridesId: 'a' })]),
      [branch('x', null)],
      'x',
    );
    // One Ada, the edit: never both.
    expect(names(resolved)).toEqual(['Ada, older', 'Bram']);
    // An edit of an edit names the original too (`cowCharacter`), so one key is enough.
    const deeper = resolveWorld(
      world([
        ...main,
        character('a2', 'Ada, older', 'x', { overridesId: 'a' }),
        character('a3', 'Ada, oldest', 'y', { overridesId: 'a' }),
      ]),
      [branch('x', null), branch('y', 'x')],
      'y',
    );
    expect(names(deeper)).toEqual(['Ada, oldest', 'Bram']);
  });

  it('lands an edit on what it edits whatever order the rows came in', () => {
    const resolved = resolveWorld(
      world([character('a2', 'Ada, older', 'x', { overridesId: 'a' }), ...main]),
      [branch('x', null)],
      'x',
    );
    expect(names(resolved)).toEqual(['Ada, older', 'Bram']);
  });

  it('hides what the head deleted, and keeps what an ancestor deleted for the lines below', () => {
    const rows = world([
      ...main,
      character('b2', 'Bram', 'x', { overridesId: 'b', deleted: true }),
    ]);
    const branches = [branch('x', null), branch('y', 'x')];
    // On the branch that deleted him, Bram is gone.
    expect(names(resolveWorld(rows, branches, 'x'))).toEqual(['Ada']);
    // On its child, which owns nothing, he is back: Aventuras' own rule —
    // "an ancestor tombstone: preserve the entity for further inheritance".
    expect(names(resolveWorld(rows, branches, 'y'))).toEqual(['Ada', 'Bram']);
    // And main never saw the deletion.
    expect(names(resolveWorld(rows, branches, null))).toEqual(['Ada', 'Bram']);
  });

  it('leaves out a row only another branch has', () => {
    const rows = world([
      ...main,
      character('c', 'Cato', 'z'),
      character('a2', 'Ada', 'x', { overridesId: 'a' }),
    ]);
    const branches = [branch('x', null), branch('z', null)];
    expect(names(resolveWorld(rows, branches, 'x'))).toEqual(['Ada', 'Bram']);
    expect(names(resolveWorld(rows, branches, null))).toEqual(['Ada', 'Bram']);
  });

  it('reads a snapshot-complete branch as its own world, needing no lineage', () => {
    const rows = world([...main, character('s1', 'Ada', 's')]);
    expect(names(resolveWorld(rows, [branch('s', null, true)], 's'))).toEqual(['Ada']);
  });

  it('reads a copied branch — the default kind — as its own, and never doubles the cast', () => {
    // Aventuras' default branch (the flag off) copies the world under new ids
    // with `snapshot_complete` 0: resolved through main it would be every
    // character twice.
    const rows = world([...main, character('ca', 'Ada', 'copy'), character('cb', 'Bram', 'copy')]);
    const resolved = resolveWorld(rows, [branch('copy', null)], 'copy');
    expect(resolved.characters.map((one) => one.id)).toEqual(['ca', 'cb']);
  });

  it('gives a branch that owns nothing its parent’s world', () => {
    const rows = world([...main, character('a2', 'Ada, older', 'x', { overridesId: 'a' })]);
    const branches = [branch('x', null), branch('empty', 'x')];
    expect(names(resolveWorld(rows, branches, 'empty'))).toEqual(['Ada, older', 'Bram']);
  });

  it('hides a tombstone on main when main is the head', () => {
    const rows = world([
      ...main,
      character('b2', 'Bram', null, { overridesId: 'b', deleted: true }),
    ]);
    expect(names(resolveWorld(rows, [], null))).toEqual(['Ada']);
  });

  it('stops at a parent it has already walked, as Aventuras’ lineage does', () => {
    // A cycle somebody's edit made: each branch names the other.
    const rows = world([
      ...main,
      character('a2', 'Ada, older', 'x', { overridesId: 'a' }),
      character('b2', 'Bram', 'y', { overridesId: 'b', deleted: true }),
    ]);
    const resolved = resolveWorld(rows, [branch('x', 'y'), branch('y', 'x')], 'x');
    expect(names(resolved)).toEqual(['Ada, older', 'Bram']);
  });
});

// ── The Lantern Fork, for production ──────────────────────────────────────

describe('the story’s rows', () => {
  it('reads every branch’s world, with the columns that say which view each is in', () => {
    const { world: read, branches } = rowsOf(database(), LANTERN_FORK);
    const byId = new Map(read.characters.map((one) => [one.id, one]));
    expect([...byId.keys()].sort()).toEqual([
      'lf-c-gull',
      'lf-c-gull-tower',
      'lf-c-keeper',
      'lf-c-keeper-tower',
      'lf-c-mara',
    ]);
    expect(byId.get('lf-c-gull-tower')).toMatchObject({
      branchId: 'lf-tower',
      overridesId: 'lf-c-gull',
      deleted: true,
    });
    // The portrait's length, and never the portrait.
    expect(byId.get('lf-c-mara')?.portraitOctets).toBeGreaterThan(0);
    expect(JSON.stringify(read.characters)).not.toContain('base64');
    expect(read.locations).toHaveLength(4);
    expect(read.items).toHaveLength(3);
    expect(read.beats).toHaveLength(2);
    expect(read.lore).toHaveLength(2);
    expect(branches.every((one) => !one.snapshotComplete)).toBe(true);
    expect(read.unreadable).toBe(0);
  });

  it('reads a portrait when asked, one character at a time, and bounds it', () => {
    const rows = rowsOf(database(), LANTERN_FORK);
    const notes: ImportNote[] = [];
    expect(rows.world.portrait('lf-c-mara', 'Mara', 'key', notes)).toEqual(FIXTURE_PORTRAITS.png);
    expect(notes).toEqual([]);

    const bounded = rowsOf(database(), LANTERN_FORK, 8);
    expect(bounded.world.portrait('lf-c-mara', 'Mara', 'key', notes)).toBeNull();
    expect(keys(notes)).toEqual(['import.aventuras.portraitTooLarge']);
  });

  it('reads a database from before branches as one world, and one from before copy-on-write as no edits', () => {
    const before = database({ version: 12 });
    expect(aventurasPreflight(before).ok).toBe(true);
    const flat = rowsOf(before, LANTERN_FORK).world;
    expect(flat.characters.every((one) => one.branchId === null)).toBe(true);

    const noCow = database({ version: 25 });
    expect(aventurasPreflight(noCow).ok).toBe(true);
    const plain = rowsOf(noCow, LANTERN_FORK).world;
    expect(plain.characters.some((one) => one.branchId === 'lf-tower')).toBe(true);
    expect(plain.characters.every((one) => one.overridesId === null && !one.deleted)).toBe(true);
  });

  it('refuses a database past copy-on-write that has lost its columns', () => {
    // Read as absent, a branch's edit of a character would be a second character.
    const torn = database({ omitColumns: { characters: ['overrides_id'] } });
    expect(aventurasPreflight(torn)).toMatchObject({
      ok: false,
      refusal: 'unknown-format',
      missing: 'characters.overrides_id',
    });
  });
});

describe('the cast', () => {
  it('is the head’s characters, each keyed under the story by its canonical id', () => {
    const { cast } = lantern();
    expect(cast.map((member) => member.actor.name)).toEqual(['Mara', 'The Drowned Keeper']);
    // The Gull was deleted on Tower, the head; the Keeper is Tower's edit of
    // him, under main's id — so a branch's edit is the same actor.
    const keeper = cast.find((member) => member.actor.name === 'The Drowned Keeper')!;
    expect(keeper.source).toBe(`${ORIGIN}/characters/lf-c-keeper`);
    expect(keeper.rowId).toBe('lf-c-keeper-tower');
    expect(JSON.stringify(keeper.actor)).toContain('Mara’s father');
  });

  it('maps a character as the vault does, keeping what saving it to the vault would drop', () => {
    const mara = lantern().cast.find((member) => member.actor.name === 'Mara')!;
    expect(mara.actor.profile.traits).toEqual(['stubborn', 'afraid of the dark']);
    expect(mara.actor.profile.visual).toEqual({ hair: 'salt-stiff black', eyes: 'grey' });
    expect(JSON.stringify(mara.actor.profile.sections)).toContain('back after ten years');
    // `saveFromStory`'s own fields, and the two it drops, in `compat`.
    expect(mara.actor.compat).toMatchObject({
      source: 'story',
      originalStoryId: LANTERN_FORK.id,
      relationship: 'self',
      status: 'active',
      metadata: { age: 29 },
    });
    expect(mara.hasPortrait).toBe(true);
  });

  it('makes the protagonist the persona, and only one', () => {
    const { cast } = lantern();
    const mara = cast.find((member) => member.actor.name === 'Mara')!;
    expect(mara.protagonist).toBe(true);
    expect(mara.actor.roles).toEqual(['persona']);
    expect(cast.filter((member) => member.protagonist)).toHaveLength(1);

    const rows = rowsOf(database(), LANTERN_FORK);
    rows.world.characters = rows.world.characters.map((one) => ({
      ...one,
      relationship: 'self',
    }));
    expect(produceWorld(rows, ORIGIN).cast.filter((member) => member.protagonist)).toHaveLength(1);
  });
});

describe('the lorebook', () => {
  it('holds the story’s entries and, tagged by kind, its places, things and beats — the head’s', () => {
    const { lorebook, counts } = lantern();
    expect(lorebook?.name).toBe('The Lantern Fork');
    expect(counts).toEqual({ characters: 2, locations: 2, items: 3, beats: 1, lore: 2 });
    expect(lorebook?.entries.map((one) => [one.name, one.tag]).sort()).toEqual(
      [
        ['Blue Wick', 'item'],
        ['Lamp Room', 'location'],
        ['Lamplighters’ Guild', 'faction'],
        ['Light the lamp', 'story-beat'],
        ['Matches', 'item'],
        ['Oil Can', 'item'],
        ['Stairwell', 'location'],
        ['The Bay', 'location'],
      ].sort(),
    );
    // Ferry's dock is another branch's, and Ferry's Lamp Room its own edit.
    expect(JSON.stringify(lorebook)).not.toContain('Ferry Dock');
    expect(entry(lorebook, 'Lamp Room').content).toBe('Glass on every side, and the great lamp.');
  });

  it('keeps each kind in a folder of its own, and says which table each entry came from', () => {
    const { lorebook } = lantern();
    const folders = new Map(lorebook!.folders.map((folder) => [folder.id, folder.name]));
    expect([...folders.values()]).toEqual(['Locations', 'Items', 'Story beats']);
    // The `entries` table's own rows are the book's, in no folder — which is
    // what tells its `location` entry from a place.
    expect(entry(lorebook, 'The Bay').folderId).toBeNull();
    expect(entry(lorebook, 'The Bay').metadata).toMatchObject({ aventuras: { table: 'entries' } });
    expect(folders.get(entry(lorebook, 'Lamp Room').folderId!)).toBe('Locations');
    expect(entry(lorebook, 'Lamp Room').metadata).toMatchObject({
      aventuras: { table: 'locations' },
    });
    expect(folders.get(entry(lorebook, 'Oil Can').folderId!)).toBe('Items');
    expect(folders.get(entry(lorebook, 'Light the lamp').folderId!)).toBe('Story beats');
  });

  it('maps a lore entry through the converter every Aventuras lorebook takes', () => {
    const bay = entry(lantern().lorebook, 'The Bay');
    expect(bay.keys).toEqual(['bay', 'water']);
    expect(bay.secondaryKeys).toEqual(['the harbour mouth']);
    expect(bay.order).toBe(995);
    expect(bay.content).toBe('Black water, and rocks like teeth.');
    // The secret stays out of the content, and the tracked state rides along.
    expect(bay.metadata).toMatchObject({
      hiddenInfo: 'A wreck lies under the north rocks.',
      state: { type: 'location', visited: true },
      createdBy: 'ai',
    });
    // An entry with no `injection` gets Aventuras' own default: its name fires it.
    expect(entry(lantern().lorebook, 'Lamplighters’ Guild').keys).toEqual(['Lamplighters’ Guild']);
  });

  it('keeps a place’s, a thing’s and a beat’s own fields, with places named rather than id’d', () => {
    const { lorebook } = lantern();
    expect(entry(lorebook, 'Lamp Room').metadata).toMatchObject({
      aventuras: { visited: true, current: true, connections: ['Stairwell'] },
    });
    expect(entry(lorebook, 'Oil Can').metadata).toMatchObject({
      aventuras: { table: 'items', quantity: 2, equipped: false, location: 'Lamp Room' },
    });
    expect(entry(lorebook, 'Matches').metadata).toMatchObject({
      aventuras: { equipped: true, location: 'inventory' },
    });
    // The beat is Tower's edit — completed — and keeps every field Aventuras
    // did, so a beats feature of our own can read it from here.
    expect(entry(lorebook, 'Light the lamp').metadata).toEqual({
      aventuras: {
        table: 'story_beats',
        type: 'quest',
        status: 'completed',
        triggeredAt: 1_758_000_100_000,
        resolvedAt: 1_758_000_200_000,
        metadata: { chapter: 1 },
      },
    });
    expect(WORLD_TAGS.story_beats).toBe('story-beat');
  });

  it('derives entry ids from the story, the table and the row, clear of every vault book', () => {
    const { lorebook } = lantern();
    const lamp = entry(lorebook, 'Lamp Room');
    expect(lamp.id).toBe(stableId('aventuras-entry', `${ORIGIN}/locations`, 'lf-l-lamp'));
    // A vault book of the story's own name derives its ids from names, and
    // meets none of these ([P13 §0.5]'s timing item, not made worse).
    const vault = convertAventurasEntries(
      [{ name: 'Lamp Room', type: 'location', description: '', injection: { mode: 'keyword' } }],
      'The Lantern Fork',
    );
    expect(vault.lorebook.entries[0]?.id).not.toBe(lamp.id);
    // Nor does another story holding a row of the same id.
    const other = produceWorld(rowsOf(database(), LANTERN_FORK), 'aventura.db/stories/other');
    expect(entry(other.lorebook, 'Lamp Room').id).not.toBe(lamp.id);
    // The whole book's ids are distinct.
    const ids = lorebook!.entries.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is the same book on every run, but for the id the library settles', () => {
    const strip = (book: Lorebook | null) => ({ ...book, id: '', provenance: undefined });
    const first = lantern();
    const second = lantern();
    expect(strip(second.lorebook)).toEqual(strip(first.lorebook));
    expect(second.cast.map((member) => member.source)).toEqual(
      first.cast.map((member) => member.source),
    );
  });

  it('makes no book, and no cast, of a story with no world', () => {
    const quiet = produceWorld(rowsOf(database(), QUIET_HARBOUR), 'aventura.db/stories/qh');
    expect(quiet.lorebook).toBeNull();
    expect(quiet.cast).toEqual([]);
    expect(quiet.notes).toEqual([]);
  });
});

describe('what the review is told', () => {
  it('says beats are lore for now, and how many other branches differ, naming none', () => {
    const { notes } = lantern();
    expect(notes.find((note) => note.key === 'import.aventuras.storyBeatsAsLore')).toEqual({
      key: 'import.aventuras.storyBeatsAsLore',
      params: { story: 'The Lantern Fork', count: 1 },
      level: 'info',
    });
    // Main (the Keeper unedited, the Gull alive, the beat active, no wick),
    // Ferry (its own dock and Lamp Room), and Tower Stair (the Gull, kept by
    // Tower's tombstone): all three differ.
    const differ = notes.find((note) => note.key === 'import.aventuras.worldBranchesDiffer');
    expect(differ?.params).toMatchObject({ story: 'The Lantern Fork', branches: 3 });
    expect(differ?.params['entities']).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(notes)).not.toContain('Ferry Dock');
  });

  it('says nothing of branches when every line holds the same world', () => {
    const rows: AventurasStoryRows = rowsOf(database(), LANTERN_FORK);
    rows.world = {
      ...rows.world,
      characters: rows.world.characters.filter((one) => one.branchId === null),
      locations: rows.world.locations.filter((one) => one.branchId === null),
      items: rows.world.items.filter((one) => one.branchId === null),
      beats: rows.world.beats.filter((one) => one.branchId === null),
    };
    expect(keys(produceWorld(rows, ORIGIN).notes)).not.toContain(
      'import.aventuras.worldBranchesDiffer',
    );
  });

  it('counts the world’s fields that would not read', () => {
    const db = database();
    db.prepare("update characters set traits = '{not json' where id = 'lf-c-mara'").run();
    const production = produceWorld(rowsOf(db, LANTERN_FORK), ORIGIN);
    expect(
      production.notes.find((note) => note.key === 'import.aventuras.worldFieldsUnreadable'),
    ).toEqual({
      key: 'import.aventuras.worldFieldsUnreadable',
      params: { story: 'The Lantern Fork', count: 1 },
      level: 'warn',
    });
    // The field is lost; the character is not.
    expect(production.cast.map((member) => member.actor.name)).toContain('Mara');
  });
});
