// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { AVENTURAS_DATABASE_FILES, AVENTURAS_READS } from './aventuras/reader.js';
import {
  CHAT_TABLES,
  TABLES,
  backupPrimary,
  classifyTablePath,
  uploadPriority,
} from './marinara/store-format.js';
import type { ImportSourceKind } from './source.js';
import { CHAT_DIRECTORIES, SILLYTAVERN_DISPOSITIONS } from './registries/sillytavern.js';

/**
 * Which files a browser directory upload actually has to carry
 * ([P4 §7.13](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **P4 cut this transport and the cut is being reversed, so the reason it was
 * cut matters.** §5 called the browser directory upload *reach, not core* —
 * the server-path sweep already paid the demo — and cutting it was right at the
 * time. What makes it worth building now is the case the server path cannot
 * serve at all: a person whose browser is not on the machine the server runs on
 * has no path to type, and `fileAccess` is admin-only besides.
 *
 * **The whole folder is named; only some of it is sent.** A SillyTavern user
 * directory is thirty directories and most of them are chats, backups,
 * thumbnails and vectors — material the importer reports and never opens, or,
 * for the chats since [P14.8], opens only when the person asks. So the
 * client sends a *manifest* of every relative path, this decides which of them
 * the reader will actually read, and the client uploads only those. The rest
 * arrive as `declared` paths on {@link MemoryFileSource}: listed, reported, and
 * answering `null` to a read.
 *
 * That is what keeps *nothing is silently dropped* true across a transport that
 * deliberately does not carry everything. The alternative — upload the tree and
 * discard most of it server-side — moves gigabytes to learn what a name already
 * says.
 *
 * **The knowledge is the registry's, not this file's.** Which SillyTavern
 * directories hold convertible material is `SILLYTAVERN_DISPOSITIONS`, the
 * vendored snapshot the walker already routes by; asking it here rather than
 * listing directories again is what stops the two from drifting into disagreeing
 * about which folder holds the cards.
 */

/** One entry of the manifest a browser sends: where a file sits, and how big. */
export interface ManifestEntry {
  /** Relative to the picked folder, `/`-separated, no leading slash. */
  path: string;
  bytes: number;
}

export interface UploadPlan {
  /** Paths whose bytes the reader will open. The client uploads exactly these. */
  wanted: string[];
  /** Paths that are named and not carried. Reported, never read. */
  declared: string[];
  /** Total size of `wanted`, which is what the upload limit applies to. */
  wantedBytes: number;
  /** The limit `wantedBytes` was spent against, so a client can name the number. */
  limitBytes: number;
  /**
   * ***What choosing chats would add*** — [P14.8], counted whether or not they
   * were chosen, because the point is to say it *before* the choice.
   *
   * - **`count`**: the chat files — `.jsonl` under `chats/` and `group chats/`,
   *   or anywhere in a loose folder — which is the number a person recognises:
   *   *these are my 212 chats*.
   * - **`bytes`**: everything the choice would send, group files included, which
   *   is the number the upload limit will count.
   * - **`fit`**: the same two numbers for what would actually go, since chats
   *   spend what the library leaves of the limit. A choice that sends 40 of 212
   *   chats has to say so before it is made, not in 172 rows after.
   *
   * Zero for a Marinara root, where no choice is offered: it keeps its chats in
   * the store it already sends (read at [P14.10]). They still spend only what
   * the library left — {@link marinaraPriority} ranks them after it — and a chat
   * table the limit cut is in `overLimit`, like any other file the reader
   * wanted, since nobody was asked about it.
   */
  chats: { count: number; bytes: number; fit: { count: number; bytes: number } };
  /**
   * ***The library files the budget left out*** (2026-09-28): wanted, not one
   * of the chats [P14.8] offers as a choice, and not taken, because the upload
   * limit ran out before them. A subset of `declared`, which also holds
   * everything never wanted — and the difference is the whole point: a card
   * too big to send and a thumbnail nobody asked for are both *named and not
   * carried*, and only one of them is something a person needs telling about.
   * Said before the upload, and handed back with it so the review can name them
   * for what they are rather than reading them as unrecognised.
   */
  overLimit: string[];
}

/** What the person has chosen to send beyond the library. */
export interface UploadChoices {
  /** Chats, group chats and group files — [P14.8]. Off unless chosen. */
  chats?: boolean;
}

/**
 * How much the reader for `kind` wants a path, lower first, or `null` when
 * naming it is enough ([P4 §7.18](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * A loose root is the expensive case and honestly so: [P4 §7.8] made it probe
 * *every* file by content, because a folder nobody arranged has no positions to
 * route by. There is nothing to narrow, so everything is wanted and the size cap
 * is what bounds it.
 */
function priorityOf(kind: ImportSourceKind, path: string): number | null {
  /**
   * ***An Aventuras root is one file, and a log and a note beside it*** —
   * [P13.2](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   * The reader reads exactly {@link AVENTURAS_READS}; everything else in the
   * folder is listed and reported `skipped` without being opened. Without this
   * arm the plan wanted the whole folder, and an older backup's
   * `stories/*.avt` — every story again, as JSON — could spend the budget
   * ahead of the database and leave the one file that matters declared.
   */
  if (kind === 'aventuras') {
    return (AVENTURAS_READS as readonly string[]).includes(path) ? 1 : null;
  }
  if (kind === 'marinara') return marinaraPriority(path);
  if (kind === 'sillytavern') {
    // Personas are a join between the settings file and `User Avatars/`, so the
    // settings file is read even though it is not in any directory.
    if (path === 'settings.json') return 0;
    const top = topOf(path);
    // `Object.hasOwn`, not a bare lookup: the registry is an object literal, so
    // a directory named `constructor` would otherwise be handed a function.
    // The same prototype-chain hole [P4 §7.8] found on the other side of this.
    if (!Object.hasOwn(SILLYTAVERN_DISPOSITIONS, top)) return null;
    return SILLYTAVERN_DISPOSITIONS[top] === 'converted' ? 1 : null;
  }
  return 1;
}

/**
 * ***The tables a Marinara store's chats are read from*** — [P14.10], where
 * the reader's `#chats` hands these five to the session pass as one candidate:
 * the chats, their messages and swipes, the trackers' snapshots ([P14.5a]) and
 * the director's secret plot ([P14.5b]). The characters and personas it also
 * hands over are the library's, and travel with it.
 *
 * **Named here because `uploadPriority` predates them.** It was written
 * ([P4 §7.18]) when the reader converted the library and only reported the
 * rest, so it ranks the tables the store's library half reads and declares
 * everything else under `storage/` — which, once [P14.10] made chats
 * `converted`, would have left every Marinara chat behind whenever the folder
 * came by browser rather than by path. The names are `store-format.ts`'s
 * `CHAT_TABLES`, the list the reader opens the chats from, which is kept out
 * of `READ_TABLES` for the reason given there; one list, so the upload and the
 * reader cannot come to disagree about which tables the chats are.
 * `directory-upload.test.ts` holds the upload to the registry rather than to
 * the list — a shard of every `converted` table travels, and of no other — so
 * a table converted later cannot quietly stay at home.
 */
const MARINARA_CHAT_TABLES: ReadonlySet<string> = new Set(CHAT_TABLES);

/**
 * Past every rank `uploadPriority` gives — the manifest at 0 through the
 * library's pre-migration backups at 3 — so the chats spend only what the
 * library left, as a SillyTavern tree's do ([P14.8]), and a pre-migration
 * backup of a chat table, which can be as large as the whole table was before
 * it sharded, spends only what the chats left.
 */
const MARINARA_CHATS_RANK = 10;
const MARINARA_CHATS_PRE_SHARD_RANK = 11;

/**
 * ***A Marinara root's ranks*** — the store's own (`uploadPriority`, from
 * [P4 §7.18]: the manifest, the library's tables, ~~the pictures they carry~~
 * the portraits under `avatars/`, the library's pre-migration backups), and
 * then the chats. *(Corrected 2026-10-02: `sprites/`, `lorebooks/images/` and
 * `prompts/images/` are named and never opened, so they are declared rather
 * than ranked, and a tree of expressions can no longer cost a chat.)*
 *
 * **The library's pre-migration backups come before the chats, not after.**
 * One is read only when its table has nothing else, and then it *is* that
 * table — every character, say — so ranking a chat ahead of it would let a
 * long conversation cost a card, which is the one thing [P14.8]'s ordering
 * exists to rule out. Where its table has shards it is dead weight, and the
 * chats pay for that in budget; the other way round, the library pays in cards.
 *
 * A chat table's file is wanted by the same grammar the library's are: a
 * shard or single file and its `.bak` (`classifyTablePath`'s `data` and
 * `backup`), and the two untimestamped pre-migration backups the store would
 * restore from (`store.ts`, case 0). Its artifacts, sentinels and unknown
 * names are named and not carried — a sentinel is probed with `exists()`,
 * which a declared path answers.
 */
function marinaraPriority(path: string): number | null {
  if (path.startsWith(TABLES)) {
    const { table, role } = classifyTablePath(path);
    // Checked before `uploadPriority`, so the chats keep their place after the
    // library even if the store's own list of tables it reads grows to hold them.
    if (table !== null && MARINARA_CHAT_TABLES.has(table)) {
      if (role === 'data' || role === 'backup') return MARINARA_CHATS_RANK;
      const monolith = `${TABLES}${table}.json`;
      if (path === `${monolith}.pre-shard` || path === `${monolith}.bak.pre-shard`) {
        return MARINARA_CHATS_PRE_SHARD_RANK;
      }
      return null;
    }
  }
  return uploadPriority(path);
}

/**
 * ***Files that are one thing, carried together or not at all*** — found at
 * the P13.2 review — or `null` for a file that stands alone.
 *
 * The budget below is spent entry by entry, and for most roots that is right:
 * one card declared is one card missing, and the review says so. An Aventuras
 * database and its `-wal` are not two files in that sense. The log holds
 * commits the file does not have yet, so a budget that carried the database
 * and declared the log handed the reader an *older* database that looked
 * whole — and the review said nothing, since the log is part of the database
 * rather than a row of its own. Carried as a bundle, the two fit together or
 * are declared together, and a database that did not come is a refusal the
 * person can see.
 */
function bundleOf(kind: ImportSourceKind, path: string): string | null {
  if (kind === 'aventuras' && (AVENTURAS_DATABASE_FILES as readonly string[]).includes(path)) {
    return AVENTURAS_DATABASE_FILES[0];
  }
  return null;
}

/**
 * ***The file a backup is read in place of***, or `null` for a path that is
 * nobody's backup — a Marinara table file's `.bak`, or the manifest's
 * (`store-format.ts`, `backupPrimary`).
 *
 * **Found at the merge of origin's main, 2026-10-02, between two fixes that
 * were each right alone.** [P4 §7.18] gave a shard and its `.bak` one rank so
 * they would travel together, and the budget passes over a file that does not
 * fit for a later one that does; a `.bak` is one save older and usually the
 * smaller, so at the edge of the limit the primary was cut and its backup
 * carried. The store then read the backup in the primary's place — one save
 * stale — and noted it on the primary's row, which the upload route rewrites
 * as *over the limit*: the session arrived short and the review said only that
 * a file had not been sent.
 *
 * **Not a bundle**, which would be the other answer and the worse one. The
 * reader never opens a backup whose primary parses, so a primary is worth
 * carrying alone; a pair taken whole or not at all would cut a primary that
 * fits whenever its backup does not. So a backup is decided after every
 * primary of its rank, and only when its own primary was carried — and one
 * whose primary is not in the folder at all is the table's only copy, and is
 * carried like any other file.
 */
function backupOf(kind: ImportSourceKind, path: string): string | null {
  return kind === 'marinara' ? backupPrimary(path) : null;
}

/**
 * ***Whether a path is one the chat choice governs*** — a SillyTavern tree's
 * `chats/`, `group chats/` and `groups/` ([P14.8], `CHAT_DIRECTORIES`). Every
 * one of them is `converted` now, so {@link priorityOf} ranks them; this is
 * what holds them back until the person says yes too.
 *
 * ***And a loose folder's `.jsonl` files***, because [P14.8] makes chats
 * opt-in in the browser upload, not opt-in in a SillyTavern tree. A loose root
 * is probed by content and has no positions to route by, so the name is all
 * there is to go on before a byte moves — and it is enough to *ask*: the
 * content probe still decides what each file sent actually is. Without this, a
 * SillyTavern `data/` folder picked one level too high, or a folder of
 * exports, sent every chat in it and made each a session, unasked.
 *
 * Not a Marinara store's chats, which are tables in the store rather than
 * files of their own, and come without a choice (see `UploadPlan.chats`).
 */
function isChat(kind: ImportSourceKind, path: string): boolean {
  if (kind === 'sillytavern') return CHAT_DIRECTORIES.includes(topOf(path));
  return kind === 'loose-files' && CHAT_FILE.test(path);
}

/** A chat file by its name, which is what the count counts. */
const CHAT_FILE = /\.jsonl$/i;

function topOf(path: string): string {
  return path.includes('/') ? (path.split('/')[0] ?? path) : path;
}

/** One manifest entry, with where it sat and what the plan makes of it. */
interface Ranked {
  entry: ManifestEntry;
  index: number;
  /** {@link priorityOf}'s answer: lower first, `null` for never wanted. */
  rank: number | null;
  /** Whether the chat choice governs it ({@link isChat}). */
  chat: boolean;
  /**
   * For a backup ({@link backupOf}), where in the manifest the file it stands
   * in for sits; `null` for a file that is not a backup, and for a backup whose
   * primary the folder does not hold.
   */
  primary: number | null;
}

/**
 * Splits a manifest into what must be carried and what only needs naming.
 *
 * **The budget is spent by priority, and both lists come back in manifest
 * order.** ~~Entries are taken in the order given until `budgetBytes` is
 * reached~~ *Changed 2026-09-22 ([P4 §7.18]).* Taking them in the browser's
 * order meant a large folder spent its budget on whatever the picker listed
 * first — for a Marinara root, every chat's shards before the one file of
 * characters — and a file the reader needed arrived declared. The order the
 * browser lists files in is a fact about the browser; which files matter is a
 * fact about the reader. Within one rank, the manifest's order decides, and a
 * file that does not fit is passed over for a later one that does — *except a
 * backup* (2026-10-02), which is decided after every primary of its rank and
 * never carried when its own primary was not ({@link backupOf}).
 *
 * **Truncation is not silent** — a declared file is still listed and still
 * reported, so the review says what happened to it rather than the file
 * vanishing between the picker and the report. ~~That was the whole of it.~~
 * *Corrected 2026-09-28:* listed, yes, but reported as whatever a reader makes
 * of a name with no bytes — *not recognised*, or *could not be read* — which
 * said something had happened and not what. `overLimit` names the budget's
 * cuts, so the panel can say them before sending and the review can say *over
 * the limit* after.
 *
 * ***The library is budgeted before the chats*** ([P14.8]). The browser lists
 * a folder in whatever order its file system does, so a first-come budget with
 * chats in it would let one long conversation that happened to sort early push
 * the cards out of the upload — and choosing *also import chats* would lose the
 * thing the person came for. So the chats a person is asked about spend what
 * the library left, in a pass of their own after it; a Marinara store's chats,
 * which nobody is asked about, are ranked last within the library's pass, to
 * the same end.
 *
 * **One limit, spent once.** `wantedBytes` is a running total over everything
 * both passes take, never more than `budgetBytes`, because that is how
 * `POST /import/directory` enforces it — across the whole folder, not per file.
 *
 * A {@link bundleOf bundle} is decided at its first member in the order the
 * library's pass reaches it, by the size of all of its wanted members together,
 * and every later member follows that answer.
 */
export function planUpload(
  kind: ImportSourceKind,
  manifest: readonly ManifestEntry[],
  budgetBytes: number,
  choices: UploadChoices = {},
): UploadPlan {
  const position = new Map(manifest.map((entry, index) => [entry.path, index]));
  const ranked: Ranked[] = manifest.map((entry, index) => {
    const stands = backupOf(kind, entry.path);
    return {
      entry,
      index,
      rank: priorityOf(kind, entry.path),
      chat: isChat(kind, entry.path),
      primary: stands === null ? null : (position.get(stands) ?? null),
    };
  });
  // Keyed by position, which is what the two lists below are built from: one
  // decision per entry of the manifest.
  const taken = new Set<number>();
  let wantedBytes = 0;

  /**
   * ***A bundle is taken whole or not at all*** ([P13.2]'s review), inside the
   * library's pass, since no chat is ever a bundle member: an Aventuras root
   * has no chats, and a SillyTavern tree no bundles.
   */
  const bundleBytes = new Map<string, number>();
  for (const { entry, rank } of ranked) {
    const bundle = bundleOf(kind, entry.path);
    if (bundle === null || rank === null) continue;
    bundleBytes.set(bundle, (bundleBytes.get(bundle) ?? 0) + entry.bytes);
  }
  const decided = new Map<string, boolean>();

  const take = ({ entry, index, primary }: Ranked): void => {
    // A backup read in place of a primary the limit cut is that primary one
    // save stale, imported as if current ({@link backupOf}).
    if (primary !== null && !taken.has(primary)) return;
    const bundle = bundleOf(kind, entry.path);
    if (bundle === null) {
      if (wantedBytes + entry.bytes > budgetBytes) return;
      taken.add(index);
      wantedBytes += entry.bytes;
      return;
    }
    let answer = decided.get(bundle);
    if (answer === undefined) {
      const bytes = bundleBytes.get(bundle) ?? 0;
      answer = wantedBytes + bytes <= budgetBytes;
      if (answer) wantedBytes += bytes;
      decided.set(bundle, answer);
    }
    if (answer) taken.add(index);
  };

  /**
   * The library's pass: by rank, and within a rank by the manifest's order —
   * every primary of a rank before any backup of it, so a backup's primary is
   * always decided first, and the budget goes to files the reader will read
   * before files it reads only when one of those is torn.
   */
  const isBackup = (one: Ranked): number => (one.primary === null ? 0 : 1);
  const library = ranked
    .filter((one): one is Ranked & { rank: number } => one.rank !== null && !one.chat)
    .sort(
      (left, right) =>
        left.rank - right.rank || isBackup(left) - isBackup(right) || left.index - right.index,
    );
  for (const one of library) take(one);

  /**
   * ***The chats' pass, run whether or not they were chosen*** — so `fit` can
   * say before the choice what `take` would do after it. The same first-come
   * rule over what the library left; committed only when chosen.
   */
  const chats = { count: 0, bytes: 0 };
  const fit = { count: 0, bytes: 0 };
  for (const { entry, index, rank, chat } of ranked) {
    if (rank === null || !chat) continue;
    chats.bytes += entry.bytes;
    if (CHAT_FILE.test(entry.path)) chats.count += 1;
    if (wantedBytes + fit.bytes + entry.bytes > budgetBytes) continue;
    fit.bytes += entry.bytes;
    if (CHAT_FILE.test(entry.path)) fit.count += 1;
    if (choices.chats === true) taken.add(index);
  }
  if (choices.chats === true) wantedBytes += fit.bytes;

  const wanted: string[] = [];
  const declared: string[] = [];
  const overLimit: string[] = [];
  for (const { entry, index, rank, chat } of ranked) {
    if (taken.has(index)) {
      wanted.push(entry.path);
      continue;
    }
    declared.push(entry.path);
    // Chats have their own count and their own sentence, `chats.fit`.
    if (rank !== null && !chat) overLimit.push(entry.path);
  }

  return {
    wanted,
    declared,
    wantedBytes,
    limitBytes: budgetBytes,
    chats: { ...chats, fit },
    overLimit,
  };
}
