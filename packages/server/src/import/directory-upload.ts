// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { AVENTURAS_DATABASE_FILES, AVENTURAS_READS } from './aventuras/reader.js';
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
   * the store it already sends (read at [P14.10]).
   */
  chats: { count: number; bytes: number; fit: { count: number; bytes: number } };
}

/** What the person has chosen to send beyond the library. */
export interface UploadChoices {
  /** Chats, group chats and group files — [P14.8]. Off unless chosen. */
  chats?: boolean;
}

/**
 * Marinara reads its store and four asset trees; everything else beside them is
 * `skipped` by the reader's own `assetDisposition`, without ever being opened.
 */
const MARINARA_WANTED = [
  'storage/',
  'avatars/',
  'sprites/',
  'lorebooks/images/',
  'prompts/images/',
] as const;

/**
 * Whether the reader for `kind` will open this path.
 *
 * A loose root is the expensive case and honestly so: [P4 §7.8] made it probe
 * *every* file by content, because a folder nobody arranged has no positions to
 * route by. There is nothing to narrow, so everything is wanted and the size cap
 * is what bounds it.
 */
function isWanted(kind: ImportSourceKind, path: string): boolean {
  /**
   * ***An Aventuras root is one file, and a log and a note beside it*** —
   * [P13.2](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   * The reader reads exactly {@link AVENTURAS_READS}; everything else in the
   * folder is listed and reported `skipped` without being opened. Without this
   * arm the plan wanted the whole folder, and an older backup's
   * `stories/*.avt` — every story again, as JSON — could spend the budget
   * ahead of the database and leave the one file that matters declared.
   */
  if (kind === 'aventuras') return (AVENTURAS_READS as readonly string[]).includes(path);
  if (kind === 'marinara') {
    return MARINARA_WANTED.some((prefix) => path.startsWith(prefix));
  }
  if (kind === 'sillytavern') {
    // Personas are a join between the settings file and `User Avatars/`, so the
    // settings file is read even though it is not in any directory.
    if (path === 'settings.json') return true;
    const top = topOf(path);
    // `Object.hasOwn`, not a bare lookup: the registry is an object literal, so
    // a directory named `constructor` would otherwise be handed a function.
    // The same prototype-chain hole [P4 §7.8] found on the other side of this.
    if (!Object.hasOwn(SILLYTAVERN_DISPOSITIONS, top)) return false;
    return SILLYTAVERN_DISPOSITIONS[top] === 'converted';
  }
  return true;
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
 * ***Whether a path is one the chat choice governs*** — a SillyTavern tree's
 * `chats/`, `group chats/` and `groups/` ([P14.8], `CHAT_DIRECTORIES`). Every
 * one of them is `converted` now, so {@link isWanted} says yes to them; this is
 * what holds them back until the person says yes too.
 *
 * ***And a loose folder's `.jsonl` files***, because [P14.8] makes chats
 * opt-in in the browser upload, not opt-in in a SillyTavern tree. A loose root
 * is probed by content and has no positions to route by, so the name is all
 * there is to go on before a byte moves — and it is enough to *ask*: the
 * content probe still decides what each file sent actually is. Without this, a
 * SillyTavern `data/` folder picked one level too high, or a folder of
 * exports, sent every chat in it and made each a session, unasked.
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

/**
 * Splits a manifest into what must be carried and what only needs naming.
 *
 * Entries are taken in the order given until `budgetBytes` is reached; anything
 * past it is declared instead. **Truncation is not silent** — a declared file is
 * still listed and still reported, so the review says what happened to it rather
 * than the file vanishing between the picker and the report.
 *
 * ***The library is budgeted before the chats*** ([P14.8]), and both lists
 * still come back in the manifest's order. The browser lists a folder in
 * whatever order its file system does, so a first-come budget with chats in it
 * would let one long conversation that happened to sort early push the cards
 * out of the upload — and choosing *also import chats* would lose the thing the
 * person came for. So chats spend what the library left.
 *
 * A {@link bundleOf bundle} is decided at its first member, by the size of all
 * of its wanted members together, and every later member follows that answer.
 */
export function planUpload(
  kind: ImportSourceKind,
  manifest: readonly ManifestEntry[],
  budgetBytes: number,
  choices: UploadChoices = {},
): UploadPlan {
  const taken = new Set<ManifestEntry>();
  const chats = { count: 0, bytes: 0 };
  let wantedBytes = 0;

  /**
   * ***A bundle is taken whole or not at all*** ([P13.2]'s review), inside the
   * library's pass, since no chat is ever a bundle member: an Aventuras root
   * has no chats, and a SillyTavern tree no bundles.
   */
  const bundleBytes = new Map<string, number>();
  for (const entry of manifest) {
    const bundle = bundleOf(kind, entry.path);
    if (bundle === null || !isWanted(kind, entry.path)) continue;
    bundleBytes.set(bundle, (bundleBytes.get(bundle) ?? 0) + entry.bytes);
  }
  const decided = new Map<string, boolean>();

  const take = (entry: ManifestEntry): void => {
    const bundle = bundleOf(kind, entry.path);
    if (bundle === null) {
      if (wantedBytes + entry.bytes > budgetBytes) return;
      taken.add(entry);
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
    if (answer) taken.add(entry);
  };

  for (const entry of manifest) {
    if (!isWanted(kind, entry.path)) continue;
    if (isChat(kind, entry.path)) {
      chats.bytes += entry.bytes;
      if (CHAT_FILE.test(entry.path)) chats.count += 1;
      continue;
    }
    take(entry);
  }

  /**
   * ***The chats' pass, run whether or not they were chosen*** — so `fit` can
   * say before the choice what `take` would do after it. The same first-come
   * rule over what the library left; committed only when chosen.
   */
  const fit = { count: 0, bytes: 0 };
  for (const entry of manifest) {
    if (!isWanted(kind, entry.path) || !isChat(kind, entry.path)) continue;
    if (wantedBytes + fit.bytes + entry.bytes > budgetBytes) continue;
    fit.bytes += entry.bytes;
    if (CHAT_FILE.test(entry.path)) fit.count += 1;
    if (choices.chats === true) taken.add(entry);
  }
  if (choices.chats === true) wantedBytes += fit.bytes;

  const wanted: string[] = [];
  const declared: string[] = [];
  for (const entry of manifest) (taken.has(entry) ? wanted : declared).push(entry.path);

  return { wanted, declared, wantedBytes, limitBytes: budgetBytes, chats: { ...chats, fit } };
}
