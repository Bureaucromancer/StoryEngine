// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Actor, ImportNote, LoreFolder, Lorebook } from '@storyengine/shared';

import { stableId } from '../identity.js';
import { convertCharacter } from './character.js';
import { convertAventurasEntries } from './lorebook.js';
import { isRecord } from './shapes.js';
import type {
  AventurasBranch,
  AventurasCharacter,
  AventurasStoryRows,
  AventurasWorld,
  AventurasWorldRow,
} from './story-rows.js';
import { repairVisualDescriptors } from './vault-character.js';

/**
 * ***A story's world, resolved for the branch the person was on, and made
 * into a cast and a lorebook*** —
 * [P13.12](../../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * [19 §2.3.1](../../../../../docs/design/19-session-import.md).
 *
 * **Pure, as `story.ts` is**: rows in, objects out, nothing written. The sweep's
 * Writer stores what this returns — the actors and the book, each keyed for
 * re-import — and only then hands the session to `importSession`, whose
 * `requireLinks` holds because the links name objects already stored. Deleting
 * this file deletes the world's import and nothing else, which is [P13 §0.3]'s
 * test applied one layer down.
 *
 * ## Resolution — which rows the head sees
 *
 * [19 §2.3.1]: *"a branch's cast is its lineage's `characters` with each row's
 * `overrides_id` shadowing the row it names and `deleted` rows removed;
 * `snapshot_complete` marks a branch that owns a complete copy and needs no
 * lineage."* That sentence is Aventuras' own `getCharactersResolved`
 * (`database.ts`), and this follows the code rather than the sentence where
 * the two are finer-grained than each other:
 *
 * - **Every row has a canonical id** — `overrides_id` when it is a branch's
 *   edit, its own id otherwise — and a later row with the same canonical id
 *   replaces an earlier one. Aventuras' `cowCharacter` always writes the
 *   *root's* id into `overrides_id` (`entity.overridesId ?? entity.id`), so an
 *   edit of an edit still names the original, and one key is enough.
 * - **A tombstone hides its entity only on the head.** On an ancestor it is
 *   kept, with its deletion stripped, *"to preserve the entity for further
 *   inheritance"* — Aventuras' comment, and its behaviour: a branch below the
 *   one that deleted a character still sees them. Odd, and theirs; a
 *   conversion that disagreed would show a person a different cast from the
 *   one Aventuras showed them on the same branch.
 * - **Originals before edits, within one line**, so an edit always lands on
 *   top of what it edits, whichever order the rows were read in.
 *
 * ***What `snapshot_complete` does not say, and the one place this reads the
 * data rather than a flag.*** Aventuras keeps three kinds of branch, and which
 * kind a branch is depends on `experimentalFeatures.lightweightBranches` *when
 * it was made* — a setting in the `settings` table, which this build never
 * reads (§1.9) and which says only what is true now:
 *
 * | Made with | Holds | `snapshot_complete` | Aventuras loads it |
 * |---|---|---|---|
 * | the flag off — **the default** | a full copy of the world at the fork, new ids | 0 | its own rows only |
 * | the flag on, since 029 | a full copy, new ids | 1 | its own rows only |
 * | the flag on, 026–028 | its edits and tombstones only | 0 | main, then each ancestor, then itself |
 *
 * So `snapshot_complete = 0` is two different things, and resolving the
 * default kind through its lineage — which the letter of [19 §2.3.1] would do
 * — puts every character in the cast twice: main's, and the branch's copy
 * under another id. **A branch with the flag unset is read as a copy of its
 * own when it owns rows and none of them is an edit or a tombstone**, and
 * through its lineage otherwise. *Where that guesses wrong*, recorded rather
 * than hidden: a 026–028 branch whose only rows are new ones reads as a copy
 * and loses what it inherited, and a default branch that owns nothing — forked
 * before anything was tracked, and played no further — inherits its parent's
 * world as it stands now rather than as it stood at the fork. Both need a
 * branch nobody played on, or a three-migration window, and neither can be
 * told apart from the rows.
 *
 * ***The head*** is `stories.current_branch_id` when the story has that
 * branch, and main otherwise — `story.ts`'s rule, so the world is the one the
 * session opens on.
 *
 * ## What another branch holds differently
 *
 * One session has one cast and one book, so the other lines' worlds are not
 * carried — and a person should know there were others. Every other line
 * (main, when the head is not main, and every branch but the head) is resolved
 * the same way, and compared with the head by **kind and name**, since a
 * copied branch's rows share nothing with the head's but what they say.
 * `import.aventuras.worldBranchesDiffer` counts the lines that differ and the
 * things that differ in at least one of them — a place only one branch found,
 * a character another branch rewrote — and names none: the list would be the
 * other branches' worlds, which is what was left behind.
 *
 * ## What becomes of each kind
 *
 * - **Characters → actors**, through the vault's own converter
 *   (`convertCharacter`), handed the object Aventuras itself makes when a
 *   person saves a story character to the vault — `saveFromStory`
 *   (`characterVault.svelte.ts`): name, description, traits, descriptors,
 *   `source: 'story'`, the story's id — so a character is the same actor
 *   whichever of the two roads it took. **Two things `saveFromStory` drops are
 *   kept**: `relationship` and `status`, which ride in `compat` with the row's
 *   `metadata`, since a relationship is prose somebody reads. **The
 *   protagonist** — `relationship: 'self'`, Aventuras' own test
 *   (`story.svelte.ts`) — is the session's persona, and flagged `persona`.
 *   Portraits come as a vault character's do ([§1.6]), read one at a time.
 * - **The story's `entries` → one lorebook**, through the converter every
 *   Aventuras lorebook takes (`convertAventurasEntries`), with Aventuras'
 *   `mapEntry` defaults for an entry with no `injection` — keyword-triggered,
 *   priority 0 — and nothing invented for one with no `state`: the tracked
 *   state a story in progress keeps rides in the entry's `metadata`, and
 *   `entryStateRecorded` says so, which here is the truth.
 * - **Locations, items and story beats → entries in that same book, tagged by
 *   kind** — [P13 §4], decided 2026-09-28. *Tagged* is three things, each for
 *   a different reader: `LoreEntry.tag` (`location`, `item`, `story-beat`) —
 *   the open field whose suggested vocabulary is exactly *location, item,
 *   quest*, and the one filters and a future feature read; a folder per kind,
 *   which is what a person sees in the editor; and `metadata.aventuras.table`,
 *   the table the row came from, which is what tells a place from the
 *   `entries` table's own `location` entries, and what a later import reads
 *   back. Each kind's own fields — a place's `visited`, `current` and
 *   connections, an item's quantity, whether it is equipped and where it is,
 *   a beat's type, status and times — ride in `metadata.aventuras` beside it,
 *   with the row's own `metadata` whole. Connections and an item's place are
 *   **names**, not ids: an id names a row of one branch in somebody else's
 *   database.
 *
 * ***Story beats as lore are an interim home, and said to be one***
 * (`import.aventuras.storyBeatsAsLore`). StoryEngine means to grow beats as a
 * feature of their own; when it does, **its import reads them from here** —
 * `tag: 'story-beat'`, `metadata.aventuras.table: 'story_beats'`, and every
 * field Aventuras kept (`type`, `status`, `triggeredAt`, `resolvedAt`, the
 * row's `metadata`) — rather than going back to Aventuras for them. Nothing
 * about a beat is dropped so that this can be undone without loss.
 *
 * ## Identity
 *
 * Every object is keyed under the story's own key ([§1.5]):
 * `aventura.db/stories/<id>/characters/<cid>` for an actor, `<cid>` the
 * character's **canonical** id — so a branch's edit of a character is the
 * same actor as the character — and `aventura.db/stories/<id>/lorebook` for
 * the book. Entry ids are derived from the same key, the table, and the row's
 * canonical id (`convertAventurasEntries`' `idSpace`), which is what keeps
 * them clear of every vault book's name-derived ids — see there, and
 * [P13 §0.5]'s lore-timing item, which a shared id would make worse.
 */

/** The book's key under the story's: `aventura.db/stories/<id>/lorebook`. */
export const STORY_LOREBOOK_KEY = 'lorebook';

/** The name a story with none gives its book. */
export const UNTITLED_STORY = 'Untitled story';

/**
 * ***The tag each kind carries*** — `LoreEntry.tag`'s open vocabulary. The
 * `entries` table's own rows keep their Aventuras type (`character`,
 * `faction`, …), which is what `convertAventurasEntries` already does.
 */
export const WORLD_TAGS = {
  locations: 'location',
  items: 'item',
  story_beats: 'story-beat',
} as const;

/** What each world table's folder is called in the editor. */
const FOLDER_NAMES: Readonly<Record<keyof typeof WORLD_TAGS, string>> = {
  locations: 'Locations',
  items: 'Items',
  story_beats: 'Story beats',
};

/** The head's world, and every other line's. */
export interface ResolvedWorld {
  characters: AventurasCharacter[];
  locations: AventurasWorld['locations'];
  items: AventurasWorld['items'];
  beats: AventurasWorld['beats'];
  lore: AventurasWorld['lore'];
}

/** One actor to store: its key, the actor, and the row its portrait is on. */
export interface WorldCastMember {
  /** `aventura.db/stories/<id>/characters/<canonical id>`. */
  source: string;
  actor: Actor;
  /** The row the head resolved to — an edit's own id, since its portrait is its own copy. */
  rowId: string;
  /** Whether the row holds a portrait at all, so nothing is read for one that does not. */
  hasPortrait: boolean;
  /** `relationship: 'self'`: the session's persona. */
  protagonist: boolean;
}

export interface WorldProduction {
  cast: WorldCastMember[];
  /** Unstamped — the Writer stamps it with {@link WorldProduction.lorebookSource}. `null` when the story has no lore at all. */
  lorebook: Lorebook | null;
  lorebookSource: string;
  counts: { characters: number; locations: number; items: number; beats: number; lore: number };
  notes: ImportNote[];
}

/** Main's line key. A branch id is never null. */
type Line = string | null;

/**
 * ***The head's world*** — see the file header for the rules and where they
 * come from. `head` is a branch id, or `null` for main.
 *
 * *The resolution's own entry, which its tests drive directly* (2026-10-01:
 * the audit read it as dead). `produceWorld` does not call it because it needs
 * the same `Lines` again afterwards, for the note that says how the branches
 * differ, and building that index twice to share one line would be the worse
 * trade.
 */
export function resolveWorld(
  world: AventurasWorld,
  branches: readonly AventurasBranch[],
  head: Line,
): ResolvedWorld {
  const lines = new Lines(world, branches);
  return lines.resolve(head);
}

/**
 * The story's world as a cast and a lorebook, for the head branch —
 * `origin` is the story's key, `aventura.db/stories/<id>`.
 */
export function produceWorld(rows: AventurasStoryRows, origin: string): WorldProduction {
  const { story, world, branches } = rows;
  const title = story.title;
  const notes: ImportNote[] = [];
  const lines = new Lines(world, branches);
  const head: Line =
    story.currentBranchId !== null && branches.some((branch) => branch.id === story.currentBranchId)
      ? story.currentBranchId
      : null;
  const resolved = lines.resolve(head);

  // ── The cast ────────────────────────────────────────────────────────────
  const cast: WorldCastMember[] = [];
  let protagonist = false;
  for (const character of resolved.characters) {
    const canonical = canonicalOf(character);
    const source = `${origin}/characters/${canonical}`;
    const converted = convertCharacter(characterPayload(character, story.id), character.name);
    if (!converted.ok) {
      // A character with no name is the one refusal the converter makes of a
      // row this built; it costs that character, and says which row.
      notes.push({
        key: 'import.file.refused',
        params: { file: source, refusal: converted.refusal },
        level: 'warn',
      });
      continue;
    }
    const { actor } = converted.value;
    notes.push(...converted.value.notes);
    // One persona: Aventuras keeps one protagonist, and a second `self` in a
    // database somebody edited is a member of the cast like any other.
    const self = !protagonist && character.relationship === 'self';
    if (self) {
      protagonist = true;
      actor.roles = ['persona'];
    }
    cast.push({
      source,
      actor,
      rowId: character.id,
      hasPortrait: (character.portraitOctets ?? 0) > 0,
      protagonist: self,
    });
  }

  // ── The book ────────────────────────────────────────────────────────────
  const lorebookSource = `${origin}/${STORY_LOREBOOK_KEY}`;
  const name = title.trim() || UNTITLED_STORY;
  const sections = [
    convertAventurasEntries(resolved.lore.map(loreRow), name, `${origin}/entries`),
    convertAventurasEntries(
      resolved.locations.map((row) => locationRow(row, resolved)),
      name,
      `${origin}/locations`,
    ),
    convertAventurasEntries(
      resolved.items.map((row) => itemRow(row, resolved)),
      name,
      `${origin}/items`,
    ),
    convertAventurasEntries(resolved.beats.map(beatRow), name, `${origin}/story_beats`),
  ] as const;

  const counts = {
    characters: cast.length,
    lore: sections[0].lorebook.entries.length,
    locations: sections[1].lorebook.entries.length,
    items: sections[2].lorebook.entries.length,
    beats: sections[3].lorebook.entries.length,
  };

  let lorebook: Lorebook | null = null;
  if (counts.lore + counts.locations + counts.items + counts.beats > 0) {
    // The `entries` table's section is the book; the three kinds join it,
    // each in a folder of its own, in the order the kinds are listed.
    const book = sections[0].lorebook;
    book.name = name;
    book.metadata = { aventuras: { story: story.id } };
    const kinds = [
      ['locations', sections[1]],
      ['items', sections[2]],
      ['story_beats', sections[3]],
    ] as const;
    for (const [table, section] of kinds) {
      const { entries } = section.lorebook;
      if (entries.length === 0) continue;
      const folder: LoreFolder = {
        // From the story's key and the table, so the same story makes the
        // same folder on every sweep — which a second sweep compares.
        id: stableId('aventuras-folder', origin, table),
        name: FOLDER_NAMES[table],
        parentFolderId: null,
        enabled: true,
        order: book.folders.length,
      };
      book.folders.push(folder);
      for (const entry of entries) entry.folderId = folder.id;
      book.entries.push(...entries);
    }
    lorebook = book;
    // Each section's own notes but its count, which the story's own note
    // gives per kind: `entryStateRecorded` is the one that can fire, and
    // only for the `entries` table, which is the only one with tracked state.
    for (const section of sections) {
      notes.push(
        ...section.notes.filter((note) => note.key !== 'import.aventuras.lorebookEntries'),
      );
    }
  }

  // ── What was said about it ──────────────────────────────────────────────
  if (counts.beats > 0) {
    notes.push({
      key: 'import.aventuras.storyBeatsAsLore',
      params: { story: title, count: counts.beats },
      level: 'info',
    });
  }
  const differ = lines.differences(head, resolved);
  if (differ.branches > 0) {
    notes.push({
      key: 'import.aventuras.worldBranchesDiffer',
      params: { story: title, branches: differ.branches, entities: differ.entities },
      level: 'info',
    });
  }
  if (world.unreadable > 0) {
    notes.push({
      key: 'import.aventuras.worldFieldsUnreadable',
      params: { story: title, count: world.unreadable },
      level: 'warn',
    });
  }

  return { cast, lorebook, lorebookSource, counts, notes };
}

/** A row's canonical id: what it edits, or itself. */
function canonicalOf(row: AventurasWorldRow): string {
  return row.overridesId ?? row.id;
}

/**
 * ***The lines of one story, and how each resolves*** — a class because the
 * classification of each branch and the parent walk are shared by the head's
 * resolution and every other line's, and computed once.
 */
class Lines {
  readonly #world: AventurasWorld;
  readonly #byId = new Map<string, AventurasBranch>();
  /** Branches read as owning a whole world of their own — see the file header. */
  readonly #complete = new Set<string>();

  constructor(world: AventurasWorld, branches: readonly AventurasBranch[]) {
    this.#world = world;
    for (const branch of branches) this.#byId.set(branch.id, branch);

    const owns = new Set<string>();
    const edits = new Set<string>();
    for (const row of allRows(world)) {
      if (row.branchId === null) continue;
      owns.add(row.branchId);
      if (row.overridesId !== null || row.deleted) edits.add(row.branchId);
    }
    for (const branch of branches) {
      if (branch.snapshotComplete || (owns.has(branch.id) && !edits.has(branch.id))) {
        this.#complete.add(branch.id);
      }
    }
  }

  /** Every line but the head: main, then each branch, in the order they were made. */
  others(head: Line): Line[] {
    const lines: Line[] = head === null ? [] : [null];
    for (const id of this.#byId.keys()) if (id !== head) lines.push(id);
    return lines;
  }

  resolve(line: Line): ResolvedWorld {
    const world = this.#world;
    return {
      characters: this.#table(world.characters, line),
      locations: this.#table(world.locations, line),
      items: this.#table(world.items, line),
      beats: this.#table(world.beats, line),
      lore: this.#table(world.lore, line),
    };
  }

  /**
   * ***How many other lines differ from the head, and in how many things*** —
   * by kind and name, see the file header.
   */
  differences(head: Line, resolved: ResolvedWorld): { branches: number; entities: number } {
    const mine = signatures(resolved);
    const differing = new Set<string>();
    let branches = 0;
    for (const line of this.others(head)) {
      const theirs = signatures(this.resolve(line));
      let differs = false;
      for (const key of new Set([...mine.keys(), ...theirs.keys()])) {
        if (mine.get(key) === theirs.get(key)) continue;
        differs = true;
        differing.add(key);
      }
      if (differs) branches += 1;
    }
    return { branches, entities: differing.size };
  }

  /** One table's rows, as `line` sees them — the head's rule when `line` is the one asked for. */
  #table<T extends AventurasWorldRow>(rows: readonly T[], line: Line): T[] {
    return [...this.#view(rows, line, true, new Set()).values()];
  }

  /**
   * A line's view, by canonical id. `head` is whether this line is the one
   * being resolved — where a tombstone hides — or an ancestor of it, where a
   * tombstone is kept for the lines below (Aventuras' rule, file header).
   */
  #view<T extends AventurasWorldRow>(
    rows: readonly T[],
    line: Line,
    head: boolean,
    seen: Set<string>,
  ): Map<string, T> {
    const own = rows.filter((row) => row.branchId === line);
    const partial = line !== null && !this.#complete.has(line);
    let view = new Map<string, T>();
    if (partial) {
      seen.add(line);
      const parent = this.#byId.get(line)?.parentBranchId ?? null;
      // A parent with no row, or one already walked (a cycle somebody's edit
      // made — Aventuras' `buildBranchLineage` stops at the first repeat), is
      // main, which is where every lineage ends.
      const up = parent !== null && this.#byId.has(parent) && !seen.has(parent) ? parent : null;
      view = this.#view(rows, up, false, seen);
    }
    // Originals first, then edits, so an edit lands on what it edits.
    const ordered = [
      ...own.filter((row) => row.overridesId === null),
      ...own.filter((row) => row.overridesId !== null),
    ];
    for (const row of ordered) {
      const key = canonicalOf(row);
      if (row.deleted && head) view.delete(key);
      else view.set(key, row);
    }
    return view;
  }
}

function allRows(world: AventurasWorld): AventurasWorldRow[] {
  return [...world.characters, ...world.locations, ...world.items, ...world.beats, ...world.lore];
}

/**
 * ***What each resolved thing says, by kind and name*** — the comparison the
 * branches note makes. Ids, branches and the copy-on-write columns are left
 * out, since a copied branch differs in every one of them and in nothing a
 * person wrote; a place's connections and an item's place are compared as
 * names, for the same reason. Two things of one kind and one name are one key
 * holding both, sorted, so a repeat is compared as a repeat.
 */
function signatures(world: ResolvedWorld): Map<string, string> {
  const held = new Map<string, string[]>();
  const add = (kind: string, name: string, value: unknown): void => {
    const key = `${kind}:${name}`;
    const list = held.get(key) ?? [];
    list.push(JSON.stringify(value));
    held.set(key, list);
  };
  for (const row of world.characters) {
    const { name, description, relationship, traits, visualDescriptors, status } = row;
    add('character', name, [
      description,
      relationship,
      traits,
      visualDescriptors,
      status,
      row.metadata,
      row.portraitOctets,
    ]);
  }
  for (const row of world.locations) {
    add('location', row.name, locationRow(row, world));
  }
  for (const row of world.items) add('item', row.name, itemRow(row, world));
  for (const row of world.beats) add('beat', row.title, beatRow(row));
  for (const row of world.lore) add('lore', row.name, loreRow(row));
  const out = new Map<string, string>();
  for (const [key, list] of held) {
    // The id each row-shaped value carries is not what it says: dropped here.
    out.set(key, list.map(withoutId).sort().join('\n'));
  }
  return out;
}

function withoutId(serialised: string): string {
  const value = JSON.parse(serialised) as unknown;
  if (!isRecord(value)) return serialised;
  return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id')));
}

/**
 * ***A story character, as `saveFromStory` would hand it to the vault*** —
 * the shape `convertCharacter` takes, so the conversion is the vault's own.
 * `relationship`, `status` and the row's `metadata` ride beside it, into
 * `compat`, where `saveFromStory` drops them (the file header).
 */
function characterPayload(row: AventurasCharacter, storyId: string): Record<string, unknown> {
  return {
    id: canonicalOf(row),
    name: row.name,
    description: row.description,
    traits: row.traits,
    visualDescriptors: repairVisualDescriptors(row.visualDescriptors),
    tags: [],
    favorite: false,
    source: 'story',
    originalStoryId: storyId,
    ...(row.relationship === null ? {} : { relationship: row.relationship }),
    ...(row.status === null ? {} : { status: row.status }),
    ...(row.metadata === undefined || row.metadata === null ? {} : { metadata: row.metadata }),
  };
}

/** Aventuras' `mapEntry` default for an entry with no `injection` column. */
const DEFAULT_INJECTION = { mode: 'keyword', keywords: [], priority: 0 } as const;

/**
 * An `entries` row, as the `Entry` `convertAventurasEntries` reads — the
 * canonical id, so the entry's id survives a branch's edit of it; `mapEntry`'s
 * defaults for `aliases` and `injection`, and **none** for the three state
 * columns: absent stays absent, where `mapEntry` would invent `{ type }`.
 */
function loreRow(row: AventurasWorld['lore'][number]): Record<string, unknown> {
  return defined({
    id: canonicalOf(row),
    name: row.name,
    type: row.type,
    description: row.description ?? '',
    hiddenInfo: row.hiddenInfo ?? undefined,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    injection: isRecord(row.injection) ? row.injection : DEFAULT_INJECTION,
    state: row.state,
    adventureState: row.adventureState,
    creativeState: row.creativeState,
    createdBy: row.createdBy ?? undefined,
    aventuras: { table: 'entries' },
  });
}

/** A place, as an `Entry` tagged `location`, its own fields in `metadata.aventuras`. */
function locationRow(
  row: AventurasWorld['locations'][number],
  world: Pick<ResolvedWorld, 'locations'>,
): Record<string, unknown> {
  return {
    id: canonicalOf(row),
    name: row.name,
    type: WORLD_TAGS.locations,
    description: row.description ?? '',
    injection: DEFAULT_INJECTION,
    aventuras: defined({
      table: 'locations',
      visited: row.visited,
      current: row.current,
      connections: row.connections.map((id) => placeName(id, world)),
      metadata: row.metadata ?? undefined,
    }),
  };
}

/** A thing, as an `Entry` tagged `item`. */
function itemRow(
  row: AventurasWorld['items'][number],
  world: Pick<ResolvedWorld, 'locations'>,
): Record<string, unknown> {
  return {
    id: canonicalOf(row),
    name: row.name,
    type: WORLD_TAGS.items,
    description: row.description ?? '',
    injection: DEFAULT_INJECTION,
    aventuras: defined({
      table: 'items',
      quantity: row.quantity ?? undefined,
      equipped: row.equipped,
      // `inventory` is Aventuras' word for *carried*, and stays one.
      location: row.location === null ? undefined : placeName(row.location, world),
      metadata: row.metadata ?? undefined,
    }),
  };
}

/**
 * A story beat, as an `Entry` tagged `story-beat` — **an interim home**
 * (the file header): every field Aventuras kept is in `metadata.aventuras`,
 * so a beats feature of our own reads them from here.
 */
function beatRow(row: AventurasWorld['beats'][number]): Record<string, unknown> {
  return {
    id: canonicalOf(row),
    name: row.title,
    type: WORLD_TAGS.story_beats,
    description: row.description ?? '',
    injection: DEFAULT_INJECTION,
    aventuras: defined({
      table: 'story_beats',
      type: row.type ?? undefined,
      status: row.status ?? undefined,
      triggeredAt: row.triggeredAt ?? undefined,
      resolvedAt: row.resolvedAt ?? undefined,
      metadata: row.metadata ?? undefined,
    }),
  };
}

/**
 * A location id as the place's name, from the same resolved world — which is
 * what a person reads, and the only thing that means anything here. An id
 * that names no place this view holds stays as it was, and `inventory`, which
 * is not an id, is itself.
 */
function placeName(id: unknown, world: Pick<ResolvedWorld, 'locations'>): unknown {
  if (typeof id !== 'string') return id;
  const place = world.locations.find((row) => row.id === id || canonicalOf(row) === id);
  return place?.name ?? id;
}

/** The fields that hold something — so an absent value is absent, not `undefined` in the bytes. */
function defined(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) out[key] = value;
  return out;
}
