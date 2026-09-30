// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';

import type { ImportDisposition, ImportNote } from '@storyengine/shared';

import type { ScratchSpace } from '../../storage/import-scratch.js';
import type { Layout } from '../../storage/layout.js';
import {
  snapshotDatabase,
  type SnapshotInput,
  type SnapshotSeams,
} from '../../storage/sqlite-snapshot.js';
import { ownEntry } from '../parse.js';
import {
  AVENTURAS_DISPOSITIONS,
  AVENTURAS_STORY_TABLES,
  AVENTURAS_TABLES,
  type AventurasStoryTable,
} from '../registries/aventuras.js';
import type {
  FileSource,
  SourceItem,
  SourceReader,
  SourceRefusal,
  SourceSurvey,
} from '../source.js';
import {
  AVENTURAS_REQUIRED,
  aventurasPreflight,
  columnsOf,
  COPY_ON_WRITE,
  quoted,
} from './schema.js';
import { packRows } from './packs.js';
import { isRecord } from './shapes.js';
import {
  CHARACTER_TABLE,
  DEFAULT_MAX_PORTRAIT_BYTES,
  vaultCharacterItems,
} from './vault-character.js';
import { LOREBOOK_TABLE, vaultLorebookItems } from './vault-lorebook.js';
import { SCENARIO_TABLE, vaultScenarioItems } from './vault-scenario.js';
import { TAG_TABLE, vaultTagItems } from './vault-tag.js';
import { STORY_FORMAT } from './story.js';
import { readStoryRows } from './story-rows.js';

/**
 * ***A whole Aventuras install, read as a review*** —
 * [P13.2](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * **P13.2 converted nothing, and that was the stage.** Every table the
 * database has is one row of the review, with its disposition from the
 * vendored registry and its row count; every story is one more, with what
 * Part 2 would bring from it. P13.3 onwards turn the vault rows into
 * candidates one table at a time, on the reading that made possible — so the
 * first thing built was the part that says what is there, and each stage after
 * it changes a `recorded` to a `converted` in plain view.
 *
 * ***P13.3: the characters.*** `character_vault` is the first table converted:
 * one candidate per row (`vault-character.ts`, the port of Aventuras' own row
 * mapper), its portrait decoded and handed to the Writer beside it (§1.6), and
 * the table's own row gone from the review — a converted table is reported by
 * the objects it became ({@link CONVERTED_TABLES}).
 *
 * ***P13.4: the lorebooks.*** `lorebook_vault` the same way
 * (`vault-lorebook.ts`), with the one step the plan first missed: a vault
 * book's entries are Aventuras' flat vault shape and not the `Entry[]` its
 * file export makes of them, so the export's own conversion is ported too
 * ([§0.4]). Emitted before the characters, in §1.7's order, so that P13.5's
 * links from a character or a scenario to a book find the book already stored.
 *
 * ***P13.5: the scenarios, and the links.*** `scenario_vault` the same way
 * again (`vault-scenario.ts`), each row mapped as Aventuras maps it and
 * converted by the scenario converter P4 wrote for the file — a treatment and
 * its cast. Emitted last, after the characters, so every book a scenario or a
 * character can link to has been stored before either asks for it; the Writer
 * keeps the map from a vault book's id to the book it became, and a link
 * resolves through it into `treatment.lore` or `actor.lore` (§1.7). This reader
 * resolves nothing itself: which object a row became is the Writer's to know.
 *
 * ***P13.6: the tags.*** `vault_tags` the same way once more
 * (`vault-tag.ts`), and first of the four — §1.7's order begins with them —
 * though nothing links to a tag, so the order is for the review and the
 * registry rather than for a link: a tag is a name before it is anything
 * else, and the books, characters and scenarios that carry it are written
 * with its colour already in place. Each row becomes a registry entry
 * rather than a library object, merged by name and never recolouring one
 * already there (§1.8), and the objects are not stamped with it.
 *
 * ***P13.9: the packs, recorded.*** Not converted — the stage's mapping table
 * showed four of eighty-one templates with a counterpart here, and in those the
 * variables they branch on with no name in our namespace (`packs.ts` has the
 * argument). So each pack is one `recorded` row, as a story is, saying what it
 * holds and which of its templates differ from the text Aventuras ships: what
 * somebody wrote, and what this import leaves in Aventuras. After the vault's
 * candidates and before the stories, since a pack is the library's and not a
 * story's.
 *
 * ***P13.11: the stories, when asked.*** A sweep that asks for them
 * (`SweepRequest.stories`) gets one candidate per story — its row, its
 * entries and its branches (`story-rows.ts`) — which the Writer hands to the
 * story producer (`story.ts`), and the producer's document to `importSession`.
 * A sweep that does not ask gets the `recorded` row per story it always had.
 * Last of everything, after the packs: a story is the largest thing in the
 * database, and P13.12's cast will link to what the vault already wrote.
 *
 * ***P13.12: and their worlds.*** The same candidate carries the story's
 * characters, places, items, beats and lore entries, every branch's rows of
 * them, which the Writer resolves for the head branch (`world.ts`) and writes
 * as a cast and a lorebook before it hands over the session that links to
 * them. The five tables join {@link CONVERTED_TABLES} and lose their rows.
 *
 * ***P13.13: and their pictures.*** The candidate carries the story's
 * `embedded_images` and `background_images` rows too, without their pixels,
 * and a bounded reader for them; the Writer makes them renditions beside the
 * turns (`pictures.ts`), and the two tables join {@link CONVERTED_TABLES}.
 *
 * ***The database is never read where it lies*** (§1.2). `survey()` takes a
 * private copy through `storage/sqlite-snapshot.ts` and opens that, read-only:
 *
 * | The file source | The snapshot's input | Ceiling |
 * |---|---|---|
 * | has `realPath` — a server-path sweep | `path`, which `VACUUM INTO`s or copies the real file | none |
 * | has `land` — an upload streamed to scratch, or an archive's entry landed there | `owned`: the landed file and its log, handed over | the upload's: `limits.maxImportUploadMb` ([P13.8]) |
 * | has none of these — a folder upload, a zip in memory | `bytes`: `aventura.db` and any `aventura.db-wal`, through `read` | the transport's: the upload limit, a zip entry's 64 MB (§1.11) |
 * | — (the constructor was handed one) | `owned`: a file already in our scratch | none |
 *
 * **A `null` from `realPath` refuses, and does not fall back to `read`** —
 * `FileSource.realPath`'s own rule: that answer is a refusal of the path (out
 * of the root, into our data directory, not a file), and `read` would be
 * asking a second door the question the first just answered.
 *
 * **A log the root names and the transport did not deliver refuses too** —
 * found at the P13.2 review. A folder upload whose `aventura.db-wal` was
 * declared rather than carried, or a zip whose log entry will not inflate,
 * answers `null` to `read` and `true` to `exists`; taking the database alone
 * would describe it *as of its last checkpoint: whole, plausible and quietly
 * older* — the snapshot's copy route refuses that for a server path, and the
 * bytes route now does the same. `directory-upload.ts` carries the two
 * together or not at all, so an honest client never meets this; a client that
 * sent half is refused rather than believed.
 *
 * ***The gate runs on the copy, and only here*** (§1.4, and `schema.ts`):
 * `classifyRoot` cannot make it, for the reasons the probe's comment gives, so
 * a folder that probes as `aventuras` is refused here — before `items()` is
 * asked for anything, and so before anything is written.
 *
 * ***The reader holds two things***, the first reader to hold anything: the
 * copy, which is as large as the install, and the handle open on it. `close()`
 * lets go of both — the handle first, since on Windows an open handle is a
 * file that cannot be removed — and a survey that refuses lets go of them
 * before it returns, so a refusal leaves scratch empty whoever forgets to
 * call `close()`.
 *
 * *SQLite on the main thread, and why that is acceptable here.* The copy and
 * its `quick_check` are the costly steps and run on the snapshot's worker. What
 * is left is the gate — a `pragma_table_info` per table — and a `count(*)` per
 * table and per story, which walk the tables' own pages and indexes and not the
 * base64 images stored beside the columns they count. *One exception, since
 * the P13.2 review:* the per-story counts of the five copy-on-write tables read
 * `overrides_id` and `deleted` ({@link entitiesOnly}), which migrations 026 and
 * 028 appended after every other column, `characters.portrait` among them — so
 * SQLite walks each of those rows to its end. That is once per character,
 * place, item, beat and lorebook entry, never per story entry, which is where
 * an install's size is. *And since P13.3*, the vault's own rows, one at a
 * time: a character's columns and its portrait, which is read only when it is
 * under the bound (`vault-character.ts`) and decoded from base64 here. That is
 * the one per-row cost that scales with a picture, and it is paid once per
 * character between the Writer's own writes, as a card's pixels are on every
 * other road in.
 */

/** The file the probe names, and the install. */
export const AVENTURAS_DATABASE = 'aventura.db';

/** Its write-ahead log: commits a running Aventuras has not yet checkpointed into the file. */
export const AVENTURAS_WAL = `${AVENTURAS_DATABASE}-wal`;

/** What a backup carries beside the database; a config directory has none. */
export const AVENTURAS_METADATA = 'metadata.json';

/**
 * **The database and its log, which are one thing** — carried together or
 * not at all by a folder upload (`directory-upload.ts`), since the file
 * without the log is an older database that looks whole.
 */
export const AVENTURAS_DATABASE_FILES = [AVENTURAS_DATABASE, AVENTURAS_WAL] as const;

/**
 * **Every name whose bytes this reader reads** — which is what a browser
 * folder upload has to carry (`directory-upload.ts`), and all it has to.
 */
export const AVENTURAS_READS = [...AVENTURAS_DATABASE_FILES, AVENTURAS_METADATA] as const;

/**
 * ***The three tables a story's tree is made of*** — [P13.11]. A story is one
 * candidate, and its entries and its branches are the turns and the names
 * inside it, so none of the three has a row of its own in the review: each
 * story is a row, and what it held is said on it. **Converted when a sweep
 * asks for stories** (`AventurasReaderOptions.stories`); when it does not,
 * each story's row is `recorded` and says what it holds, which is still a row
 * per story and not per table — see the registry's comment on these three.
 */
export const STORY_TREE_TABLES = ['stories', 'story_entries', 'branches'] as const;

/**
 * ***The five tables of a story's world*** — [P13.12]. Read with the tree
 * when a sweep asks for stories, resolved for the head branch (`world.ts`),
 * and written as the story's cast and its lorebook before its session is:
 * converted on the same terms as the tree's three, and like them with no row
 * of their own. What each became is on the story's row.
 */
export const STORY_WORLD_TABLES = [
  'characters',
  'locations',
  'items',
  'story_beats',
  'entries',
] as const;

/**
 * ***The two tables of a story's pictures*** — [P13.13]. Read with the tree
 * when a sweep asks for stories, without their pixels (`story-rows.ts`), and
 * carried as renditions beside the turns — `embedded_images` as
 * illustrations, `background_images` as backdrops (`pictures.ts`). Converted
 * on the tree's terms, with no row of their own: the story's row counts what
 * came, and says what did not.
 */
export const STORY_PICTURE_TABLES = ['embedded_images', 'background_images'] as const;

/**
 * ***The tables whose rows this reader turns into candidates***, in the order
 * it emits them — P13.6's tags, then P13.4's lorebooks, then P13.3's
 * characters, then P13.5's scenarios: §1.7's order, complete. The order is
 * load-bearing, not tidy: a scenario's or a character's link to a lorebook
 * resolves only once the lorebook is stored, and the Writer resolves it as it
 * writes. The tags lead for a gentler reason — see the file header.
 *
 * `registries.test.ts` holds this to the registry's `converted` rows in both
 * directions: a table said to be converted is converted here, and a table
 * converted here is not also listed as `recorded`. Such a table has no row of
 * its own in the review ({@link tableRows}); its rows are the count.
 */
export const CONVERTED_TABLES = [
  TAG_TABLE,
  LOREBOOK_TABLE,
  CHARACTER_TABLE,
  SCENARIO_TABLE,
  ...STORY_TREE_TABLES,
  ...STORY_WORLD_TABLES,
  ...STORY_PICTURE_TABLES,
] as const;

/**
 * The files SQLite keeps beside a database, which are the database rather than
 * something beside it: the log is taken into the copy (and the review says so
 * with `walCopied`), and the other two are an index of the log and a rollback
 * journal, neither of them data a person put there. None is a row of its own.
 */
const SIDE_FILES = ['-wal', '-shm', '-journal'].map((suffix) => `${AVENTURAS_DATABASE}${suffix}`);

/**
 * A database the server already holds, in a scratch space it opened — [P13.8]'s
 * streamed upload, landed. **Ownership passes to the reader on construction**
 * and to the snapshot when `survey()` hands it over; a caller must not dispose
 * it after this, and `close()` disposes it if `survey()` never ran.
 */
export interface OwnedDatabase {
  space: ScratchSpace;
  /** The file's name inside the space. */
  name: string;
}

export interface AventurasReaderOptions {
  /** Read this rather than asking the file source for `aventura.db`. */
  owned?: OwnedDatabase;
  /**
   * The snapshot's seams (`SnapshotSeams`). `freeBytes` arrives from the
   * sweep as `AppServices.freeBytes`, the one seam the services keep for a
   * test to answer *full*; the others are for a reader test that cannot make
   * its condition happen for real.
   */
  seams?: SnapshotSeams;
  /**
   * ***Whether each story becomes a candidate*** — [P13.11]. Absent or false,
   * a story is the `recorded` row it has been since P13.2, saying what it
   * holds; true, it is a candidate the Writer hands to the story producer.
   * **The sweep decides, from whether it was asked** (`SweepRequest.stories`),
   * and the reader is told rather than deciding, because the answer is about
   * the request and not the database.
   */
  stories?: boolean;
  /**
   * The largest portrait carried, decoded — `DEFAULT_MAX_PORTRAIT_BYTES`,
   * sixty-four megabytes, unless a test needs to meet the bound without
   * building a portrait that size.
   */
  maxPortraitBytes?: number;
  /**
   * The largest story picture carried, decoded — [P13.13], the portrait's
   * bound and its default, and a seam of its own so a test can meet it with
   * one picture of a story and leave the portraits alone.
   */
  maxPictureBytes?: number;
}

/** The names the per-story counts go by: the params of `storyRecorded`. */
type StoryCount =
  | 'entries'
  | 'branches'
  | 'characters'
  | 'locations'
  | 'items'
  | 'beats'
  | 'lore'
  | 'chapters'
  | 'checkpoints'
  | 'images';

/**
 * **What the review counts per story, under which name** — for every one of
 * the registry's {@link AVENTURAS_STORY_TABLES}, and keyed by it, so a table
 * the registry gains is a type error here until somebody decides. Both image
 * tables are one number: whether a picture was drawn into the story or behind
 * it is Part 2's to tell apart (P13.13), and the question a person has before
 * that is how many there are. *P13.13 tells them apart where it carries them*
 * — on the row of a story brought across, by what each became — and leaves
 * this count as it was, for a sweep that does not ask.
 *
 * `null` is *counted per table and not per story*: `time_anchors`,
 * `kept_separate` and `world_state_snapshots` are all derived from the rest,
 * and Part 2's copy-on-write resolution (P13.12) reads the branch tables they
 * summarise. Exported for `registries.test.ts`, which holds every table named
 * here to a `story_id` the gate has checked.
 */
export const STORY_COUNTS: Readonly<Record<AventurasStoryTable, StoryCount | null>> = {
  story_entries: 'entries',
  branches: 'branches',
  characters: 'characters',
  locations: 'locations',
  items: 'items',
  story_beats: 'beats',
  entries: 'lore',
  chapters: 'chapters',
  checkpoints: 'checkpoints',
  embedded_images: 'images',
  background_images: 'images',
  time_anchors: null,
  kept_separate: null,
  world_state_snapshots: null,
};

/** What a survey that passed holds until `close()`. */
interface Held {
  db: DatabaseSync;
  dispose: () => Promise<void>;
  version: number;
  tables: ReadonlySet<string>;
  /** The snapshot's notes and the gate's: about the database as a whole. */
  databaseNotes: readonly ImportNote[];
  /** `backupMetadata`, about `metadata.json`, when there is one worth saying. */
  metadataNote: ImportNote | null;
}

export class AventurasReader implements SourceReader {
  readonly kind = 'aventuras' as const;

  readonly #files: FileSource;
  readonly #layout: Layout;
  readonly #seams: SnapshotSeams;
  readonly #maxPortraitBytes: number;
  readonly #maxPictureBytes: number;
  readonly #stories: boolean;
  #owned: OwnedDatabase | null;
  #surveyed: Promise<SourceSurvey> | null = null;
  #held: Held | null = null;

  /**
   * `layout` is the library's own (`LibraryContext.layout`), because scratch
   * lives under it (§1.3) — there is no second layout to hand a reader.
   */
  constructor(files: FileSource, layout: Layout, options: AventurasReaderOptions = {}) {
    this.#files = files;
    this.#layout = layout;
    this.#seams = options.seams ?? {};
    this.#maxPortraitBytes = options.maxPortraitBytes ?? DEFAULT_MAX_PORTRAIT_BYTES;
    this.#maxPictureBytes = options.maxPictureBytes ?? DEFAULT_MAX_PORTRAIT_BYTES;
    this.#stories = options.stories === true;
    this.#owned = options.owned ?? null;
  }

  /**
   * The snapshot, then the gate, then what a backup says about itself.
   *
   * **Refuses as the snapshot does** — `unreadable-root` for no database or a
   * file that is not SQLite, `live-install` for a copy that moved or failed
   * `quick_check` — **and `unknown-format` as the gate does.** Throws only what
   * the snapshot throws, which is what is ours to fix: a
   * `SnapshotSpaceError` above all, which the routes answer `507`.
   *
   * Asked twice, it answers once: the second call is the first's promise, and
   * never a second copy of somebody's install.
   */
  survey(): Promise<SourceSurvey> {
    this.#surveyed ??= this.#take();
    return this.#surveyed;
  }

  async *items(): AsyncIterable<SourceItem> {
    const held = this.#held;
    if (held === null) {
      throw new Error('The Aventuras reader was asked for items without a survey that passed.');
    }

    // The database's own row first: what it is, and what the snapshot and the
    // gate had to say about it — `walCopied`, `newerSchema`. The sweep keeps a
    // survey's notes to itself, so this row is where they reach the review.
    yield observed(AVENTURAS_DATABASE, 'recorded', [
      {
        key: 'import.aventuras.database',
        params: { version: held.version, tables: held.tables.size },
        level: 'info',
      },
      ...held.databaseNotes,
    ]);
    yield* this.#besideTheDatabase(held);
    yield* tableRows(held);
    // The vault, as candidates — after every table's row and before the
    // stories, so a review reads the database, then what it held, then what
    // Part 2 would bring. A database older than a table has none of its rows.
    // Tags first, then lorebooks, in the order {@link CONVERTED_TABLES} names.
    if (held.tables.has(TAG_TABLE)) {
      yield* vaultTagItems(held.db, { database: AVENTURAS_DATABASE });
    }
    if (held.tables.has(LOREBOOK_TABLE)) {
      yield* vaultLorebookItems(held.db, { database: AVENTURAS_DATABASE });
    }
    if (held.tables.has(CHARACTER_TABLE)) {
      yield* vaultCharacterItems(held.db, {
        database: AVENTURAS_DATABASE,
        maxPortraitBytes: this.#maxPortraitBytes,
      });
    }
    // Last of the vault: a scenario links to a book, and names a cast of its
    // own, so everything it could point at is already written.
    if (held.tables.has(SCENARIO_TABLE)) {
      yield* vaultScenarioItems(held.db, { database: AVENTURAS_DATABASE });
    }
    yield* packRows(held.db, { database: AVENTURAS_DATABASE, tables: held.tables });
    yield* storyRows(held, this.#stories, {
      maxPortraitBytes: this.#maxPortraitBytes,
      maxPictureBytes: this.#maxPictureBytes,
    });
  }

  /**
   * Lets go of the handle, then the copy — or, if `survey()` never took it, of
   * the owned database the constructor was handed. Safe to call twice.
   *
   * A survey still in flight is waited for first, so that what it takes is let
   * go rather than taken after this has run.
   */
  async close(): Promise<void> {
    await this.#surveyed?.catch(() => undefined);
    const held = this.#held;
    const owned = this.#owned;
    this.#held = null;
    this.#owned = null;
    if (held !== null) {
      if (held.db.isOpen) held.db.close();
      await held.dispose();
    }
    if (owned !== null) await owned.space.dispose();
  }

  async #take(): Promise<SourceSurvey> {
    const input = await this.#input();
    if (input === null) return refused('unreadable-root');

    const snapshot = await snapshotDatabase(this.#layout, input, this.#seams);
    if (!snapshot.ok) return refused(snapshot.refusal);

    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(snapshot.path, { readOnly: true });
      const gate = aventurasPreflight(db);
      if (!gate.ok) {
        db.close();
        await snapshot.dispose();
        return refused(gate.refusal);
      }

      const metadataNote = await this.#backupMetadata();
      const databaseNotes = [...snapshot.notes, ...gate.notes];
      this.#held = {
        db,
        dispose: () => snapshot.dispose(),
        version: gate.version,
        tables: gate.tables,
        databaseNotes,
        metadataNote,
      };
      return {
        ok: true,
        kind: this.kind,
        notes: metadataNote === null ? databaseNotes : [...databaseNotes, metadataNote],
      };
    } catch (error) {
      if (db?.isOpen) db.close();
      await snapshot.dispose().catch(() => undefined);
      throw error;
    }
  }

  /** The snapshot's input — see the table in the file header — or `null` for none to be had. */
  async #input(): Promise<SnapshotInput | null> {
    const owned = this.#owned;
    if (owned !== null) {
      // The space is the snapshot's from here, kept or disposed by it.
      this.#owned = null;
      return { kind: 'owned', space: owned.space, name: owned.name };
    }
    if (this.#files.realPath !== undefined) {
      const path = await this.#files.realPath(AVENTURAS_DATABASE);
      return path === null ? null : { kind: 'path', path };
    }
    // [P13.8]: a file that is ours already, on disk. A `null` is final, as
    // `realPath`'s is — `read` of a landed upload holds nothing to fall back
    // to, and an archive entry that would not land will not read either.
    if (this.#files.land !== undefined) {
      const landed = await this.#files.land(AVENTURAS_DATABASE);
      return landed === null ? null : { kind: 'owned', space: landed.space, name: landed.name };
    }
    const database = await this.#files.read(AVENTURAS_DATABASE);
    if (database === null) return null;
    const wal = await this.#files.read(AVENTURAS_WAL);
    // Named and not delivered — see the file header. `exists` rather than
    // trusting `read`'s `null`, which means "no log" and "a log you did not
    // get" alike.
    if (wal === null && (await this.#files.exists(AVENTURAS_WAL))) return null;
    return { kind: 'bytes', database, wal };
  }

  /**
   * ***What a backup says about itself***, when it is a backup:
   * `metadata.json`'s app version, story count and date. Small, and read
   * through the file source like any other file. A file that will not parse,
   * or lacks any of the three, says nothing — it is still listed, as every
   * file beside the database is.
   */
  async #backupMetadata(): Promise<ImportNote | null> {
    const bytes = await this.#files.read(AVENTURAS_METADATA);
    if (bytes === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
    if (!isRecord(parsed)) return null;
    const { appVersion, storyCount, createdAt } = parsed;
    if (typeof appVersion !== 'string' || typeof createdAt !== 'string') return null;
    if (typeof storyCount !== 'number' || !Number.isSafeInteger(storyCount) || storyCount < 0) {
      return null;
    }
    // The two strings are clamped: they are somebody else's, on their way into
    // the ledger, and a real one is a version or a date and nothing longer.
    return {
      key: 'import.aventuras.backupMetadata',
      params: {
        appVersion: appVersion.slice(0, FACT_LENGTH),
        storyCount,
        createdAt: createdAt.slice(0, FACT_LENGTH),
      },
      level: 'info',
    };
  }

  /**
   * ***Every other file in the root, one row each*** — *nothing is silently
   * dropped*, which the Marinara reader keeps the same way. An older backup
   * also carries `stories/*.avt`, which Aventuras' own restore ignores: the
   * database holds every story they do, so here they are `skipped`, and a
   * backup of `.avt` files alone never reaches this reader (it has no
   * `aventura.db`, so it probes as loose files, which is Part 2's P13.15).
   */
  async *#besideTheDatabase(held: Held): AsyncIterable<SourceItem> {
    for await (const path of this.#files.list()) {
      if (path === AVENTURAS_DATABASE || SIDE_FILES.includes(path)) continue;
      if (path === AVENTURAS_METADATA) {
        yield observed(path, 'skipped', held.metadataNote === null ? [] : [held.metadataNote]);
        continue;
      }
      yield observed(path, 'skipped');
    }
  }
}

/** How long a fact read out of `metadata.json` may be when it is noted. */
const FACT_LENGTH = 64;

/**
 * ***One row per table the database has*** — the registry's in its order, then
 * anything the registry lacks, which is `unrecognised`: a newer Aventuras's
 * table, named and counted rather than passed over.
 *
 * `settings` is counted and nothing more: `count(*)` is the only statement this
 * reader runs against it, so no value in it is ever selected, and none can
 * reach the review or the ledger (§1.9). The test that holds this watches the
 * statements, not only the output.
 *
 * ***A converted table has no row here*** (P13.3) — the Marinara reader's
 * rule, for the Marinara reason: its rows are reported by the objects they
 * became, and a `converted` row for the table beside three `converted`
 * characters would count four imports where there were three. The count is
 * not lost: every row of such a table is an item of its own, a candidate or,
 * for a row that cannot be one, an `unrecognised` row that says why
 * (`vault-character.ts`), so the rows under its name *are* its row count.
 */
function* tableRows(held: Held): Iterable<SourceItem> {
  const known = AVENTURAS_TABLES.filter((table) => held.tables.has(table));
  const unknown = [...held.tables]
    .filter((table) => ownEntry(AVENTURAS_DISPOSITIONS, table) === undefined)
    .sort();

  for (const table of [...known, ...unknown]) {
    const disposition = ownEntry(AVENTURAS_DISPOSITIONS, table) ?? 'unrecognised';
    if (disposition === 'converted') continue;
    const rows = countRows(held.db, table);
    const notes: ImportNote[] = [];
    if (rows !== null && disposition === 'credential') {
      notes.push({ key: 'import.aventuras.settingsDropped', params: { rows }, level: 'info' });
    } else if (rows !== null) {
      notes.push({ key: 'import.aventuras.tableRows', params: { table, rows }, level: 'info' });
    }
    yield observed(`${AVENTURAS_DATABASE}/${table}`, disposition, notes);
  }
}

/**
 * ***One row per story*** — named `aventura.db/stories/<id>`, which is
 * [§1.5]'s row identity and the key [P13.10] makes a story's re-import turn
 * on. Ordered by title, so a review of a library with forty stories reads as
 * one.
 *
 * ***Asked for, each story is a candidate*** (P13.11): its rows, read one
 * story at a time so a library of two hundred stories is never in memory at
 * once, for the Writer to hand to the story producer (`story.ts`). What the
 * story holds that this build does not bring — ~~its world~~, its chapters,
 * ~~its pictures~~ — rides on the candidate as `storyWorldRecorded`, so the row
 * that says *imported* also says what stayed behind. *Since P13.12* the world
 * is read with the tree (`story-rows.ts`) and comes across, so it is no longer
 * in that sentence; *since P13.13* the pictures are read with it too, and
 * leave it as well. A story the database lists but cannot give back — gone
 * between the list and the read — is left out, which it would also be from
 * Aventuras.
 *
 * ***Not asked, each is the `recorded` row it was at P13.2***, saying what it
 * holds — the stage text's *"counts per story, so the review says what Part 2
 * would bring rather than only that something exists"*.
 *
 * ***What a story holds, across all its branches*** — which is what the
 * sentence says, because it is not what any one of Aventuras' own views shows.
 * See {@link entitiesOnly} for the rows left out, and for the rows that are
 * still counted once per branch.
 */
function* storyRows(
  held: Held,
  asked: boolean,
  bounds: { maxPortraitBytes: number; maxPictureBytes: number },
): Iterable<SourceItem> {
  if (!held.tables.has('stories')) return;

  const tallies = new Map<string, Record<StoryCount, number>>();
  for (const table of AVENTURAS_STORY_TABLES) {
    const name = STORY_COUNTS[table];
    // Counted per table only, or a table the database predates, which has no
    // rows to count (`schema.ts`).
    if (name === null || !held.tables.has(table)) continue;
    const grouped = held.db
      .prepare(
        `select story_id as story, count(*) as n from ${quoted(table)}` +
          `${entitiesOnly(held.db, table)} group by story_id`,
      )
      .all();
    for (const row of grouped) {
      const story = String(row['story']);
      const tally = tallies.get(story) ?? emptyTally();
      tally[name] += Number(row['n']);
      tallies.set(story, tally);
    }
  }

  const stories = held.db
    .prepare('select id, title from stories order by title collate nocase, id')
    .all();
  for (const row of stories) {
    const id = String(row['id']);
    const story = typeof row['title'] === 'string' ? row['title'] : '';
    const source = `${AVENTURAS_DATABASE}/stories/${id}`;
    const tally = tallies.get(id) ?? emptyTally();

    if (asked) {
      const rows = readStoryRows(held.db, id, held.tables, bounds);
      if (rows === null) continue;
      // *Since P13.12* the world comes with the story — its cast and its
      // lorebook, which the Writer says on the row — ~~so what stays behind is
      // the chapters, the checkpoints and the pictures, P13.13's and P13.14's~~
      // *and since P13.13 its pictures*, which the Writer counts on the row as
      // it carries them, and the few it cannot carry with them
      // (`aventuras/pictures.ts`). So what stays behind here is the chapters
      // and the checkpoints, P13.14's and nobody's yet; the `images` count
      // leaves this sentence and stays in `storyRecorded`, which a sweep that
      // does not ask still says.
      const { chapters, checkpoints } = tally;
      const behindNote: ImportNote = {
        key: 'import.aventuras.storyWorldRecorded',
        params: { story, chapters, checkpoints },
        level: 'info',
      };
      const behind = chapters + checkpoints;
      yield {
        outcome: 'candidate',
        candidate: {
          source,
          format: STORY_FORMAT,
          payload: rows,
          ...(behind === 0 ? {} : { notes: [behindNote] }),
        },
      };
      continue;
    }

    const {
      entries,
      branches,
      characters,
      locations,
      items,
      beats,
      lore,
      chapters,
      checkpoints,
      images,
    } = tally;
    yield observed(source, 'recorded', [
      {
        key: 'import.aventuras.storyRecorded',
        params: {
          story,
          entries,
          branches,
          characters,
          locations,
          items,
          beats,
          lore,
          chapters,
          checkpoints,
          images,
        },
        level: 'info',
      },
    ]);
  }
}

/**
 * ***A branch's edit and a deletion's tombstone are not things a story
 * holds*** — found at the P13.2 review, which counted them as if they were.
 *
 * Aventuras' copy-on-write branches (026, 028) keep both as rows of the five
 * tables of a story's world. A row with an `overrides_id` is a branch's copy of
 * an entity that has its own row already — the same character, edited on a
 * branch — and a row with `deleted = 1` is a tombstone: the entity deleted, in
 * place on the branch that owned it or as an override on one that inherited it.
 * Counted as rows, a story whose person had edited three characters on a
 * branch and deleted ten reported thirteen more characters than it has. So
 * where the schema declares these columns (`COPY_ON_WRITE`, optional in
 * `schema.ts` until P13.12 and late since) and the database has them, both
 * kinds are left out; a database from before them has neither kind of row,
 * and every row counts.
 *
 * **What this does not resolve, and is not trying to.** A branch made without
 * copy-on-write — every branch before 026, and every one since made without
 * Aventuras' experimental lightweight branches — holds a complete copy of the
 * world, whose rows are counted once per branch; and a tombstone hides its
 * entity only in its own branch's view, since Aventuras' lineage resolution
 * still hands an ancestor's tombstoned row down to the branches below it.
 * Saying what any one branch shows is P13.12's resolution, not a count's; the
 * sentence says *across all its branches*, which is what this is.
 */
function entitiesOnly(db: DatabaseSync, table: string): string {
  // `optional` until P13.12 and `late` since (`schema.ts`); asked of both, so
  // the count follows whichever the gate says, and a table that declares
  // neither is never asked for a column it was not checked for.
  const need = AVENTURAS_REQUIRED[table];
  const declared = new Set([...(need?.optional ?? []), ...Object.keys(need?.late ?? {})]);
  const [overrides, deleted] = COPY_ON_WRITE;
  const have = columnsOf(db, table);
  const where: string[] = [];
  if (declared.has(overrides) && have.has(overrides)) where.push('overrides_id is null');
  if (declared.has(deleted) && have.has(deleted)) where.push('coalesce(deleted, 0) = 0');
  return where.length === 0 ? '' : ` where ${where.join(' and ')}`;
}

function emptyTally(): Record<StoryCount, number> {
  return {
    entries: 0,
    branches: 0,
    characters: 0,
    locations: 0,
    items: 0,
    beats: 0,
    lore: 0,
    chapters: 0,
    checkpoints: 0,
    images: 0,
  };
}

/**
 * A table's rows, or `null` when SQLite will not count them — a virtual table
 * whose module this build lacks is the case, and it costs that table its
 * count and nothing else.
 */
function countRows(db: DatabaseSync, table: string): number | null {
  try {
    const n = db.prepare(`select count(*) as n from ${quoted(table)}`).get()?.['n'];
    if (typeof n === 'bigint') return Number(n);
    return typeof n === 'number' ? n : null;
  } catch {
    return null;
  }
}

function refused(refusal: SourceRefusal): SourceSurvey {
  return { ok: false, refusal, notes: [] };
}

function observed(
  source: string,
  disposition: ImportDisposition,
  notes: readonly ImportNote[] = [],
): SourceItem {
  return { outcome: 'observed', report: { source, disposition, notes: [...notes] } };
}
