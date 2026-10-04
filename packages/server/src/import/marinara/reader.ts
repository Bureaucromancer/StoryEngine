// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportDisposition, ImportItemReport, ImportNote } from '@storyengine/shared';

import { marinaraPreflight } from '../detect.js';
import { ownEntry } from '../parse.js';
import { MARINARA_DISPOSITIONS } from '../registries/marinara.js';
import type {
  FileSource,
  ImportCandidate,
  SourceItem,
  SourceReader,
  SourceSurvey,
} from '../source.js';

import { MARINARA_CHATS_FORMAT } from './chat.js';
import {
  CHAT_TABLES,
  CONVERTED_ASSET_TREES,
  READ_TABLES,
  RECORDED_ASSET_TREES,
  TABLES,
  UNSHARD_SENTINEL,
  classifyTablePath,
  isReadTable,
} from './store-format.js';
import {
  MANIFEST,
  openStore,
  readMarinaraManifest,
  shortfalls,
  type FileFate,
  type MarinaraManifest,
  type MarinaraStore,
} from './store.js';

/**
 * A Marinara data root, read as candidates
 * ([P4 §1.3](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **This is the reader the seam exists for.** SillyTavern's walker is one file,
 * one candidate; here one *file* holds every character at once and one *object*
 * is a join across four tables plus an image on disk. A sweep engine written as
 * a file walker — which is what the plan said before the amendment — could not
 * have expressed this without a second, unlike path bolted on beside it.
 *
 * ~~Two layouts, and which one a table is in is a question for the filesystem
 * rather than for the manifest: at storage format 4 sixteen tables shard …~~
 * *Rewritten 2026-09-22 ([P4 §7.18]).* **Which layout a table is in, and which
 * file in it holds the truth, is answered by `store.ts`, which ports the
 * answers from the store that writes them.** From storage format 5 every table
 * shards, the tables this reader converts included, and the rules for which of
 * a single file, a directory of shards, a `.bak` and a pre-migration backup is
 * the table are upstream's rather than ours. This file decides only what to
 * *say* about each of them — which is the half of the job that is ours, and the
 * half where the old reader stayed silent.
 *
 * ***The chats go through the same store*** (2026-10-02). [P14.10] taught this
 * reader the chat tables while it still had a loader of its own, and that
 * loader learned the `.bak` filter for them independently; [P4 §7.18] replaced
 * the loader with `store.ts` on a branch that did not have the chats yet, and
 * the merge of the two keeps one. Two loaders would have been two answers to
 * *which file is the table*, and only the store's knows a backup read in place
 * of a torn shard, a bak-only shard, a single file an older build wrote back
 * beside the shards, or a row duplicated across two of them — every one of
 * which is a chat table's problem at least as often as a character's, because
 * the chat tables are where a store's writes are.
 */

// The tables the chats candidate carries beyond the actors are `CHAT_TABLES`,
// in `store-format.ts` beside `READ_TABLES` and not in it — that file says why.
// What this reader needs of them is only that every table it opens is opened
// *before* the report is written, so the report knows what became of its files.

export class MarinaraReader implements SourceReader {
  readonly kind = 'marinara' as const;

  readonly #files: FileSource;
  #opened: Promise<{ manifest: MarinaraManifest | null; store: MarinaraStore }> | null = null;

  constructor(files: FileSource) {
    this.#files = files;
  }

  async survey(): Promise<SourceSurvey> {
    const refusal = await marinaraPreflight(this.#files);
    if (refusal !== null) return { ok: false, refusal, notes: [] };
    return { ok: true, kind: this.kind, notes: [] as ImportNote[] };
  }

  async *items(): AsyncIterable<SourceItem> {
    const { manifest, store } = await this.#open();

    // Every table this reader converts is loaded before anything is reported,
    // so the report of the files knows what became of each of them. *The chat
    // tables too*: a torn message shard, or one an upload named and did not
    // carry, is otherwise a `converted` name with no row at all — the registry
    // says the chats stand for it, and the chats it held never arrived.
    for (const table of [...Object.keys(READ_TABLES), ...CHAT_TABLES]) await store.rows(table);

    yield* this.#reportUnreadPaths(manifest, store);

    yield* this.#lorebooks(store);
    yield* this.#presets(store);
    yield* this.#actors(store, 'characters', 'marinara.character');
    yield* this.#actors(store, 'personas', 'marinara.persona');
    yield* this.#chats(store);
  }

  /** The store and its manifest, opened once for the sweep. */
  #open(): Promise<{ manifest: MarinaraManifest | null; store: MarinaraStore }> {
    this.#opened ??= (async () => {
      const manifest = await readMarinaraManifest(this.#files);
      return { manifest, store: openStore(this.#files, manifest) };
    })();
    return this.#opened;
  }

  /**
   * Everything the sweep saw and is not converting, one row each — and, for the
   * files it did read, a row wherever something happened to them worth saying.
   *
   * The disposition comes from §1.8's vendored registry, so a table Marinara
   * adds is `unrecognised` and counted rather than passed over — which is what
   * makes *nothing is silently dropped* checkable rather than promised.
   */
  async *#reportUnreadPaths(
    manifest: MarinaraManifest | null,
    store: MarinaraStore,
  ): AsyncIterable<SourceItem> {
    const manifestNotes: ImportNote[] = [];
    for (const { table, expected, found } of await shortfalls(store, manifest)) {
      manifestNotes.push(note('import.marinara.rowsMissing', { table, expected, found }, 'warn'));
    }

    for await (const path of this.#files.list()) {
      if (path === MANIFEST || path === `${MANIFEST}.bak`) {
        const item = manifestRow(path, manifest, manifestNotes);
        if (item !== null) yield item;
        continue;
      }
      if (path === '.encryption-key') {
        yield observed(path, 'credential');
        continue;
      }
      if (path.startsWith(TABLES)) {
        const item = tableRow(path, store);
        if (item !== null) yield item;
        continue;
      }
      // A `.bak` holds the same rows rather than more of them. Reading one
      // doubles the library, and does it in the way hardest to notice, because
      // both copies are valid.
      if (path.endsWith('.bak')) {
        yield observed(path, 'skipped');
        continue;
      }

      yield observed(path, assetDisposition(path));
    }
  }

  async *#lorebooks(store: MarinaraStore): AsyncIterable<SourceItem> {
    const books = await store.rows('lorebooks');
    if (books.length === 0) return;

    const entries = await store.rows('lorebook_entries');
    const folders = await store.rows('lorebook_folders');
    const links = await store.rows('lorebook_character_links');

    for (const book of books) {
      const id = str(book['id']);
      yield candidate({
        source: `${TABLES}lorebooks.json#${id}`,
        format: 'marinara.lorebook',
        payload: {
          book,
          entries: entries.filter((row) => str(row['lorebookId']) === id),
          folders: folders.filter((row) => str(row['lorebookId']) === id),
          actorIds: links
            .filter((row) => str(row['lorebookId']) === id)
            .map((row) => str(row['characterId'])),
        },
      });
    }
  }

  async *#presets(store: MarinaraStore): AsyncIterable<SourceItem> {
    const presets = await store.rows('prompt_presets');
    if (presets.length === 0) return;

    const sections = await store.rows('prompt_sections');
    const choices = await store.rows('choice_blocks');
    // A disabled group switches its sections off, so the groups travel with
    // them (2026-09-27); they were never opened.
    const groups = await store.rows('prompt_groups');

    for (const preset of presets) {
      const id = str(preset['id']);
      yield candidate({
        // `…json#id` whatever the layout, because it is re-import identity: a
        // store that moved from one file to shards must re-import as the same
        // objects, not as new ones beside the old.
        source: `${TABLES}prompt_presets.json#${id}`,
        format: 'marinara.preset',
        payload: {
          preset,
          sections: sections.filter((row) => str(row['presetId']) === id),
          choiceBlocks: choices.filter((row) => str(row['presetId']) === id),
          groups: groups.filter((row) => str(row['presetId']) === id),
        },
      });
    }
  }

  /**
   * ***The chats, as one candidate*** —
   * [P14.10](../../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
   *
   * **One candidate for the three tables, not one per chat**, because what a
   * chat *is* here is a question about more than one row: a branch is a
   * family's, and its family is found across every chat the store holds
   * (`families.ts`). The sweep sets it aside with SillyTavern's chat files
   * (`sweep.ts`, `isChat`) until every character and persona above is written,
   * so the lines resolve against the library this same sweep made; the session
   * pass (`chat-sessions.ts`) then answers **one row per chat**, keyed
   * `storage/tables/chats.json#<id>`, in place of the per-shard rows the
   * message tables used to be reported as.
   *
   * *Every chat, not only roleplay*: which chats become sessions is the
   * parser's to say (`chat.ts`), and a conversation or game chat still gets its
   * row. The character and persona rows travel for their names — a message
   * names its speaker by id alone.
   *
   * ~~Held in memory as `#rows` already holds them: the store reader's one
   * cache, loaded once.~~ *Corrected 2026-10-02:* held as the store holds them,
   * loaded once and before the report (`items`), and read by its rules — so a
   * `.bak` beside a message shard is the backup it is rather than every message
   * and swipe twice, which this reader's own filter used to answer, and so a
   * storage format 5–7 store, where `chats` itself is sharded and an older
   * build may have written a single `chats.json` back beside the shards, comes
   * in as the store Marinara would show.
   */
  async *#chats(store: MarinaraStore): AsyncIterable<SourceItem> {
    const chats = await store.rows('chats');
    const messages = await store.rows('messages');
    const swipes = await store.rows('message_swipes');
    if (chats.length === 0 && messages.length === 0) return;
    yield candidate({
      source: `${TABLES}chats.json`,
      format: MARINARA_CHATS_FORMAT,
      payload: {
        chats,
        messages,
        swipes,
        characters: await store.rows('characters'),
        personas: await store.rows('personas'),
        // The trackers' state per message and swipe — [P14 §2.6], [P14.5a].
        snapshots: await store.rows('game_state_snapshots'),
        // The director's secret plot per chat — [P14 §2.6], [P14.5b].
        memory: await store.rows('agent_memory'),
      },
    });
  }

  /**
   * Characters and personas, which are the same table shape twice.
   *
   * **The card is a JSON string inside the JSON row** — double-encoded, and the
   * first thing a converter written against the table shape gets wrong. A row
   * whose inner parse fails is one `warn` line and the table converts around it:
   * one poisoned *row* never aborts a table, which is the row-level sibling of
   * the rule F22 already paid for ([22 §4.1.1]).
   */
  async *#actors(store: MarinaraStore, table: string, format: string): AsyncIterable<SourceItem> {
    const rows = await store.rows(table);

    for (const row of rows) {
      const id = str(row['id']);
      const source = `${TABLES}${table}.json#${id}`;

      /**
       * ***A persona is its own row*** (2026-09-27). A character keeps its
       * card as JSON in a `data` column; a persona has no such column — its
       * name, description and the rest are columns of the row itself — so
       * reading `data` for both handed the converter nothing for every persona,
       * and none ever imported. The row is the persona.
       */
      let card: unknown;
      try {
        const raw = table === 'personas' && row['data'] === undefined ? row : row['data'];
        card = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        yield observed(source, 'unrecognised', [
          { key: 'import.row.unreadable', params: { row: id, table }, level: 'warn' },
        ]);
        continue;
      }

      const avatar = str(row['avatarPath']) || `avatars/${id}.png`;

      yield candidate({
        source,
        format,
        payload: card,
        assets: (await this.#files.exists(avatar)) ? [avatar] : [],
      });
    }
  }
}

/**
 * The manifest's own row, which it has only when there is something to say.
 *
 * A manifest that parsed is an input, not an object, and says nothing by
 * existing — so it had no row, and still has none unless a count it declares
 * went unmet. A torn primary is the exception: it is a file that could not be
 * read, and a person restoring from a backup wants to know which one was used.
 */
function manifestRow(
  path: string,
  manifest: MarinaraManifest | null,
  notes: readonly ImportNote[],
): SourceItem | null {
  if (path === MANIFEST && manifest?.tornPrimary === true) {
    return observed(path, 'unrecognised', [note('import.file.notJson', { file: path }, 'warn')]);
  }
  if (manifest?.path === path && notes.length > 0) return observed(path, 'skipped', [...notes]);
  // The backup of a manifest that read fine holds the same counts, and is
  // counted as the copy it is.
  return path === MANIFEST ? null : observed(path, 'skipped');
}

/**
 * One path under `storage/tables/`, reported for what became of it.
 *
 * **The fate comes first**, because a name can be innocent and its file still
 * worth a line: a shard that would not parse, a backup that had to be read
 * instead, the single file shards overruled. Only when the store did not touch
 * a file does its name decide — artifacts and sentinels skipped, names upstream
 * never writes unrecognised, and whole tables this reader does not convert
 * given the registry's answer.
 */
function tableRow(path: string, store: MarinaraStore): SourceItem | null {
  const found = classifyTablePath(path);
  const fate = store.fate(path);
  if (fate !== undefined) return fateRow(path, fate, store);

  if (found.role === 'sentinel') {
    return path === `${TABLES}${UNSHARD_SENTINEL}`
      ? observed(path, 'skipped', [
          note('import.marinara.unshardUnfinished', { file: path }, 'warn'),
        ])
      : observed(path, 'skipped');
  }
  if (found.role === 'artifact' || found.role === 'backup') return observed(path, 'skipped');
  if (found.role === 'unknown') {
    return observed(path, 'unrecognised', [
      note('import.file.unrecognised', { file: path }, 'warn'),
    ]);
  }

  // A data file. The tables this reader converts are reported by the objects
  // they produce rather than by the file they came out of — otherwise
  // `characters.json` would appear as one row beside the four characters it
  // yielded.
  const table = found.table ?? '';
  if (isReadTable(table)) return null;
  const disposition = dispositionOf(table);
  if (disposition === 'converted') return null;
  return disposition === 'unrecognised'
    ? observed(path, 'unrecognised', [note('import.file.unrecognised', { file: path }, 'warn')])
    : observed(path, disposition);
}

/** What the store did with a file, as a row — or nothing, when it simply read it. */
function fateRow(path: string, fate: FileFate, store: MarinaraStore): SourceItem | null {
  switch (fate.kind) {
    case 'read':
      return fate.malformed > 0
        ? observed(path, 'skipped', [
            note('import.marinara.rowsMalformed', { file: path, count: fate.malformed }, 'warn'),
          ])
        : null;
    case 'recovered':
      return observed(path, 'skipped', [
        note('import.marinara.backupUsed', { file: path }, 'warn'),
      ]);
    case 'backup-read': {
      // The note belongs on whichever file failed. When the primary is there and
      // was recovered it carries it; when only the backup survived, the backup
      // is the file the person needs to hear about.
      const primary = path.slice(0, -'.bak'.length);
      return store.fate(primary)?.kind === 'recovered'
        ? observed(path, 'skipped')
        : observed(path, 'skipped', [note('import.marinara.backupUsed', { file: path }, 'warn')]);
    }
    case 'unreadable':
      return observed(path, 'unrecognised', [
        note('import.file.unreadable', { file: path }, 'warn'),
      ]);
    case 'not-json':
      return observed(path, 'unrecognised', [note('import.file.notJson', { file: path }, 'warn')]);
    case 'not-rows':
      return observed(path, 'unrecognised', [
        note('import.file.unrecognised', { file: path }, 'warn'),
      ]);
    case 'superseded':
      // Upstream quarantines this file and says to recover its rows by hand:
      // they can be edits an older build made after the store was sharded.
      return path.endsWith('.bak')
        ? observed(path, 'skipped')
        : observed(path, 'skipped', [
            note('import.marinara.monolithSuperseded', { file: path }, 'warn'),
          ]);
    case 'restored':
      return observed(path, 'skipped', [
        note('import.marinara.preShardRestored', { file: path, table: fate.table }, 'warn'),
      ]);
  }
}

/**
 * The registry's answer, without the prototype hole a bare lookup has.
 *
 * Own entries only: `tables/constructor.json` found `Object`, which travelled
 * into the report and its counts as a disposition. The hole was closed twice,
 * on two branches merged 2026-10-02 — here at [P4 §7.18], and by the
 * importers' pass of 2026-09-27 with `ownEntry` — so it is closed once, with
 * the helper every other lookup of that pass uses.
 */
function dispositionOf(table: string): ImportDisposition {
  return ownEntry(MARINARA_DISPOSITIONS, table) ?? 'unrecognised';
}

/**
 * The seventeen asset directories beside `storage/`.
 *
 * `avatars/` travels with the actor it is the portrait of. ~~The four that feed
 * a converted object travel with it~~ (corrected 2026-09-27): `sprites/`,
 * `lorebooks/images/` and `prompts/images/` were reported `converted` and never
 * attached to anything, so a review promised pictures that did not arrive. They
 * are `recorded`, waiting on the image tables (see the registry). The rest —
 * game assets, fonts, notification sounds, the video directories — are counted
 * and skipped.
 *
 * *The two lists are `store-format.ts`'s* (2026-10-02), because the browser
 * upload ranks by them too: it carries what this reads and only names what
 * this records, and two copies of the lists were how the upload went on
 * spending its limit on sprites for five days after this function stopped
 * reading them.
 */
function assetDisposition(path: string): ImportDisposition {
  if (CONVERTED_ASSET_TREES.some((prefix) => path.startsWith(prefix))) return 'converted';
  return RECORDED_ASSET_TREES.some((prefix) => path.startsWith(prefix)) ? 'recorded' : 'skipped';
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function note(
  key: string,
  params: Record<string, string | number>,
  level: ImportNote['level'],
): ImportNote {
  return { key, params, level };
}

function candidate(value: ImportCandidate): SourceItem {
  return { outcome: 'candidate', candidate: value };
}

function observed(
  source: string,
  disposition: ImportDisposition,
  notes: ImportNote[] = [],
): SourceItem {
  const report: ImportItemReport = { source, disposition, notes };
  return { outcome: 'observed', report };
}
