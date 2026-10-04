// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 StoryEngine contributors
// Derived in part from AGPL-3.0-only upstream code; see THIRD_PARTY_NOTICES.md

import { createHash } from 'node:crypto';

import { isLitter } from '../litter.js';

/**
 * Marinara's on-disk naming, ported
 * ([P4 §7.18](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **Pure: no `FileSource`, no reads, no decisions about *this* store.** What
 * lives here is the grammar of the files themselves — which name is a shard,
 * which is a backup, which is something a migration left behind — so that the
 * reader beside it can ask *what is this file* without also deciding *what do I
 * do about it*. The split exists because the first question has exactly one
 * right answer, which is upstream's, and the second one is ours.
 *
 * Provenance:
 *   source  Marinara-Engine/packages/server/src/db/file-backed-store.ts
 *   commit  459f8b85b9af8b674a86826ab1a5316d02139168 (staging, storage
 *           format 7, 2026-09-17)
 *   taken   2026-09-22
 *   lines   :442-485 (`SHARD_KEY_COLUMNS`), :563 (`UNASSIGNED_SHARD_KEY`),
 *           :566 (`SHARD_MIGRATION_SENTINEL`), :568-591
 *           (`WINDOWS_RESERVED_BASENAMES`), :603-615 (`encodeShardKey`),
 *           :1374 (`isShardDataFileName`), :1986-2010
 *           (`getFileTableShardStrategy`), :2622-2756 (the five migration
 *           states), plus `scripts/protect-launcher-data.mjs:229-450` for the
 *           names the launcher's `unshard` writes
 *
 * **The storage formats, and what each bump was protecting:**
 *
 * - **5** (`fa3971d5f`, 2026-08-20) is the only one that changed the layout:
 *   every table shards, where format 4 sharded sixteen chat-scoped ones.
 * - **6** (`e390e3619`, 2026-08-28) is a bare number, paired with the
 *   writer-lease record gaining fields, so an older *Marinara* refuses a store
 *   its lease parser cannot read.
 * - **7** (`5d6d7c52e`, 2026-09-17) adds nullable provenance columns to
 *   `lorebook_entries`, so an older *Marinara writer* cannot drop them.
 *
 * Two of the three protect Marinara's own writers against downgrade, which a
 * read-only importer is not — the observation the structural gate is built on.
 */

/**
 * The newest storage format this build has been **checked against**.
 *
 * Not "the newest it can read": a claim about what somebody compared against
 * upstream, which is the only thing a number can honestly mean here, since two
 * of the three bumps above changed nothing a reader sees. Moving it is the same
 * procedure as the table snapshot beside it — re-take the port from the new
 * commit, run the suite, change this line in the same commit ([P4 §7.18]).
 *
 * ***What was checked at 7 is the library*** (recorded 2026-10-02, at the
 * merge that brought [P14.10]'s chats here). The re-take at `459f8b85b` read
 * the library's tables; the chat readers (`chat.ts`, `trackers.ts`, `plot.ts`,
 * `editor.ts`, `families.ts`) were written at v2.4.3, format 4, and a format
 * 5–7 store now reaches them through this gate unchecked. A diff of their
 * tables found one drift that lost data — a player who played as a character,
 * fixed in `chat.ts` — and private-turn fields that are still read as
 * ordinary lines; [P14]'s sources table records both and the re-take owed.
 */
export const MARINARA_KNOWN_FORMAT = 7;

/** Where the tables live, relative to the data root. */
export const TABLES = 'storage/tables/';

/** The manifest, relative to the data root (`store.ts` reads it under the same name). */
const MANIFEST_PATH = 'storage/manifest.json';

/** The shard every row with no usable owner key lands in (S:563). */
export const UNASSIGNED_SHARD_KEY = 'orphaned-rows';

/** Present while a table is being migrated from one file to shards (S:566). */
export const MIGRATION_SENTINEL = '.migrating';

/** Present while the launcher's offline `unshard` is running (launcher :229). */
export const UNSHARD_SENTINEL = '.unshard-in-progress';

/** S:568-591, verbatim. */
const WINDOWS_RESERVED_BASENAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/**
 * An ownership key, as the filename Marinara would have written for it
 * (S:603-615, byte for byte).
 *
 * **We encode rather than decode, and that is the whole reason this is here.**
 * Marinara's filenames are containers — rows carry their own keys — so a reader
 * never has to read a name to know what is in it. What a reader *does* need is
 * the question the dedupe asks: *is this row in the file it belongs in?* Two
 * copies of one row can exist across shards after a crash, and upstream keeps
 * the copy sitting in its canonical file. Answering that needs the encoder, and
 * an encoder that is nearly right picks the wrong copy in silence.
 *
 * Every byte outside `[a-z0-9-]` is percent-encoded, uppercase included,
 * because NTFS and APFS are case-insensitive and two ids differing only in case
 * must never share a file. The length and reserved-name checks are made against
 * the **encoded** string, not the raw key, which is a distinction a test can
 * only catch with a key whose two forms differ in length.
 */
export function encodeShardKey(rawKey: string): string {
  if (!rawKey) return UNASSIGNED_SHARD_KEY;

  let encoded = '';
  for (const byte of Buffer.from(rawKey, 'utf8')) {
    const char = String.fromCharCode(byte);
    encoded += /[a-z0-9-]/.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }

  const upper = encoded.toUpperCase();
  if (
    encoded.length > 120 ||
    WINDOWS_RESERVED_BASENAMES.has(upper) ||
    encoded.endsWith('.') ||
    encoded.endsWith(' ')
  ) {
    return `%h${createHash('sha256').update(rawKey, 'utf8').digest('hex').slice(0, 32)}`;
  }
  return encoded;
}

/**
 * Whether a name inside a table's directory is a shard Marinara would load
 * (S:1374, the same expression).
 *
 * The leading `[^.]` is what makes every `.bak`, `.tmp-…`, `.corrupt-…` and
 * sentinel invisible to the store — and it is the filter our reader did not
 * have, which is how a `.bak` beside each shard became a second copy of every
 * object in the library.
 */
export function isShardDataFileName(name: string): boolean {
  return /^[^.][^\\/]*\.json$/.test(name);
}

/**
 * The column a table's rows are grouped into shard files by (S:442-485).
 *
 * **The whole map, not only the tables we convert.** Two reasons: a reader that
 * can load any table keeps [19 §2.2]'s claim true — session import needs no new
 * reading code — and a partial copy of somebody else's table is the kind of
 * vendored fragment that is wrong without being noticeably wrong.
 *
 * A table absent from this map shards by its primary key, which is `id` for
 * every table we read. `message_swipes` is upstream's one indirect case: it
 * resolves through its parent message rather than a column of its own, so it
 * has no entry here and no canonical file a dedupe could prefer.
 */
export const SHARD_OWNERS: Readonly<Record<string, string>> = {
  messages: 'chatId',
  conversation_call_sessions: 'chatId',
  conversation_call_messages: 'chatId',
  character_card_versions: 'characterId',
  persona_card_versions: 'personaId',
  noodle_posts: 'authorAccountId',
  noodle_account_subscriptions: 'creatorAccountId',
  noodle_post_unlocks: 'postId',
  noodle_interactions: 'postId',
  noodler_creator_reply_claims: 'postId',
  noodler_prepared_posts: 'creatorAccountId',
  slurp_posts: 'authorAccountId',
  slurp_account_subscriptions: 'creatorAccountId',
  slurp_post_unlocks: 'postId',
  slurp_interactions: 'postId',
  slurp_creator_reply_claims: 'postId',
  slurp_prepared_posts: 'creatorAccountId',
  lorebook_character_links: 'lorebookId',
  lorebook_persona_links: 'lorebookId',
  lorebook_folders: 'lorebookId',
  lorebook_entries: 'lorebookId',
  prompt_groups: 'presetId',
  prompt_sections: 'presetId',
  choice_blocks: 'presetId',
  agent_runs: 'chatId',
  agent_memory: 'chatId',
  game_state_snapshots: 'chatId',
  spatial_context_snapshots: 'chatId',
  game_engine_state: 'chatId',
  game_checkpoints: 'chatId',
  game_scene_videos: 'chatId',
  game_turn_storyboards: 'chatId',
  game_turn_storyboard_keyframes: 'storyboardId',
  game_dice_pools: 'chatId',
  chat_images: 'chatId',
  character_images: 'characterId',
  persona_images: 'personaId',
  ooc_influences: 'targetChatId',
  conversation_notes: 'targetChatId',
  memory_chunks: 'chatId',
  advanced_memory_records: 'chatId',
  mari_workspace_context: 'chatId',
};

/** The one table whose shard is decided by another table's row (S:1990). */
export const INDIRECT_SHARD_TABLES: ReadonlySet<string> = new Set(['message_swipes']);

/**
 * The tables the reader actually converts, and what a row of each must carry.
 * *(The library's tables, since the merge of origin's main on 2026-10-02 — the
 * chats are read too now, and are {@link CHAT_TABLES}, kept apart for the
 * reason given there.)*
 *
 * - `owner` is the column upstream groups the table's rows into files by, which
 *   the dedupe uses to recognise a row's canonical file.
 * - `joins` are the columns the reader keys on. They are checked as *string or
 *   null*, because a legitimate orphan carries `null` — upstream normalises
 *   every row, so an absent column means a rename rather than an odd row.
 * - `payload` are columns the converters read. They are checked for presence
 *   only: their *values* are the source's business, but a column that has
 *   vanished from every row is the shape changing underneath us.
 *
 * Both lists exist for the structural gate. Below the checked format they cost
 * nothing; above it they are the difference between reading a store whose
 * tables merely moved and one whose columns were renamed.
 */
export const READ_TABLES = {
  lorebooks: { owner: 'id', joins: ['id'], payload: ['name'] },
  lorebook_entries: { owner: 'lorebookId', joins: ['lorebookId'], payload: ['content', 'keys'] },
  lorebook_folders: { owner: 'lorebookId', joins: ['lorebookId'], payload: ['name'] },
  lorebook_character_links: {
    owner: 'lorebookId',
    joins: ['lorebookId', 'characterId'],
    payload: [],
  },
  prompt_presets: { owner: 'id', joins: ['id'], payload: ['name'] },
  prompt_sections: { owner: 'presetId', joins: ['presetId'], payload: ['content', 'role'] },
  prompt_groups: { owner: 'presetId', joins: ['presetId'], payload: ['name'] },
  choice_blocks: { owner: 'presetId', joins: ['presetId'], payload: ['variableName'] },
  characters: { owner: 'id', joins: ['id'], payload: ['data'] },
  personas: { owner: 'id', joins: ['id'], payload: ['name'] },
} as const satisfies Record<
  string,
  { owner: string; joins: readonly string[]; payload: readonly string[] }
>;

export type ReadTable = keyof typeof READ_TABLES;

/** Whether a table name is one the reader converts, without the prototype hole. */
export function isReadTable(table: string): table is ReadTable {
  return Object.hasOwn(READ_TABLES, table);
}

/**
 * ***The tables a store's chats are read from*** — [P14.10], [P14.5a],
 * [P14.5b]: the chats, their messages and swipes, the trackers' snapshots and
 * the director's secret plot, which the reader's `#chats` hands to the session
 * pass as one candidate. The characters and personas it hands over with them
 * are the library's, and are in {@link READ_TABLES}.
 *
 * ***Beside `READ_TABLES` rather than in it***, because that table is also the
 * structural gate's list and the browser upload's priority, and a chat table in
 * either means something the merge that brought the chats here (2026-10-02)
 * did not decide: what a message row must carry above the checked format, and
 * where chat shards rank against the library in an upload's budget. Each of
 * those is answered where it is used — the reader opens these before its
 * report is written, and `directory-upload.ts` ranks them after the library —
 * and both read the names from here, so the two cannot come to disagree about
 * which tables the chats are.
 */
export const CHAT_TABLES = [
  'chats',
  'messages',
  'message_swipes',
  'game_state_snapshots',
  'agent_memory',
] as const;

/**
 * ***The asset tree whose files the reader opens*** — the portraits, which
 * `reader.ts`'s `#actors` attaches to the character or persona whose
 * `avatarPath` names them.
 *
 * ~~`CARRIED_ASSET_TREES`: the four trees whose files travel with a converted
 * object.~~ *Split 2026-10-02, at the merge of origin's main.* The list was
 * written ([P4 §7.18], 2026-09-22) while the reader reported all four trees as
 * `converted`; origin found on 2026-09-27, on a branch this one could not see,
 * that only the avatar was ever attached, and made the other three
 * {@link RECORDED_ASSET_TREES}. The
 * merge kept that reader and this ranking, and with the chats ranked after the
 * pictures, a folder with a large `sprites/` spent the upload limit on files
 * nothing opens and cut the message shards — every session in it gone, for
 * bytes whose review row is the same `recorded` whether they arrived or not.
 */
export const CONVERTED_ASSET_TREES = ['avatars/'] as const;

/**
 * ***The asset trees the reader names and does not open*** — `recorded`,
 * waiting on the image tables ([P4 §1.8]'s correction of 2026-09-27), and
 * reported from the path alone. One list, read by both the reader's
 * `assetDisposition` and {@link uploadPriority}, so the review and the upload
 * cannot come to disagree about which pictures are read.
 *
 * **When a reader starts attaching one of these, it moves to the list above,
 * and that is a ranking decision too**: a picture ranked with the library's
 * portraits comes ahead of every chat (`directory-upload.ts`), so a tree that
 * can be a hundred megabytes of expressions should earn that place rather
 * than inherit it.
 */
export const RECORDED_ASSET_TREES = ['sprites/', 'lorebooks/images/', 'prompts/images/'] as const;

/**
 * How much a browser upload should want a file from a Marinara root, lower
 * first, or `null` for a file it only needs to name ([P4 §7.18]).
 *
 * **The order is what the reader cannot do without, spent first.** The
 * manifest, then the files that hold the tables it converts, then ~~the
 * pictures those objects carry~~ the portraits those objects carry
 * ({@link CONVERTED_ASSET_TREES}), and last the pre-migration backups — which
 * are read only when a table has nothing else and can be as large as the whole
 * old table. *(Corrected 2026-10-02: only `avatars/` is read; the other three
 * picture trees are {@link RECORDED_ASSET_TREES} and only need naming, so they
 * are `null` here — declared, never in `overLimit`, and given the same
 * `recorded` row by name as if they had come.)*
 * ~~Everything else under `storage/` is chats, memories and the social feed,
 * which the reader reports without opening; naming them is enough.~~
 * (2026-10-02, the merge of origin's main) Everything else under `storage/` is
 * what the reader reports without opening, *except* {@link CHAT_TABLES}, which
 * [P14.10] made read: this ranks only the library's half, and
 * `directory-upload.ts`'s `marinaraPriority` ranks the chats after all of it
 * before asking here.
 *
 * This is not merely thrift. The reader falls back to a shard's `.bak` when the
 * primary cannot be read, and a declared file reads as nothing — so a budget
 * that happened to carry a backup and not its primary would import the backup,
 * one save stale, and say only that it had. *(2026-10-02: giving the two one
 * rank did not prevent that — within a rank a file that does not fit is
 * passed over for a later one that does, and a `.bak` is usually the smaller.
 * `planUpload` now decides each backup after its primary and never carries one
 * whose primary it cut; {@link backupPrimary} is how it knows which is which.)*
 */
export function uploadPriority(path: string): number | null {
  if (path === MANIFEST_PATH || path === `${MANIFEST_PATH}.bak`) return 0;
  if (path.startsWith(TABLES)) {
    const found = classifyTablePath(path);
    if (found.table === null || !isReadTable(found.table)) return null;
    if (found.role === 'data' || found.role === 'backup') return 1;
    if (path.endsWith('.pre-shard')) return 3;
    return null;
  }
  return CONVERTED_ASSET_TREES.some((tree) => path.startsWith(tree)) ? 2 : null;
}

/**
 * ***The file a backup stands in for***, or `null` for a path that is not a
 * backup Marinara reads in place of another — the manifest's `.bak`, and a
 * table's `.json.bak`, sharded or single.
 *
 * **For the upload's budget, which must never carry the stand-in without the
 * original** (2026-10-02). Both readers fall back by the same rule — the
 * manifest to its `.bak` (`readMarinaraManifest`), a table file to its own
 * (`store.ts`'s `readWithFallback`) — when the primary reads as nothing, and a
 * declared primary does. So a primary the limit cut beside a backup it carried
 * was the backup imported in its place, one save stale, with the only note
 * about it on a row the route then rewrites as *over the limit*. A pre-shard
 * backup is not one of these: it is read when its table has nothing else at
 * all, never in place of a file that is there.
 */
export function backupPrimary(path: string): string | null {
  if (path === `${MANIFEST_PATH}.bak`) return MANIFEST_PATH;
  if (!path.startsWith(TABLES)) return null;
  return classifyTablePath(path).role === 'backup' ? path.slice(0, -'.bak'.length) : null;
}

/** What a path under `storage/tables/` is. */
export type TablePathRole = 'data' | 'backup' | 'artifact' | 'sentinel' | 'unknown';

export interface TablePath {
  /** The table it belongs to, or null when the name does not name one. */
  table: string | null;
  role: TablePathRole;
  /** For a shard, the encoded name without `.json`; null for a single file. */
  shard: string | null;
}

/** A timestamp as Marinara writes it into a filename: ISO with `:` and `.` as `-`. */
const TS = '[0-9A-Za-z-]+';

/** The suffixes a single-file table can wear, none of which is data. */
const MONOLITH_ARTIFACT = new RegExp(
  `^(.+)\\.json(?:\\.bak)?(?:\\.tmp-\\d+-\\d+|\\.pre-shard(?:-${TS})?|\\.post-downgrade-${TS}|\\.corrupt-${TS}(?:-\\d+)?|\\.unshard-tmp|\\.pre-unshard-${TS})$`,
);

/** The suffixes a shard can wear. */
const SHARD_ARTIFACT = new RegExp(
  `^(.+)\\.json(?:\\.bak)?(?:\\.tmp-\\d+-\\d+|\\.corrupt-${TS}(?:-\\d+)?)$`,
);

/** A directory the launcher's `unshard` leaves behind, which holds old shards. */
const POST_UNSHARD_DIR = new RegExp(`^(.+)\\.post-unshard-${TS}$`);

/**
 * What a `storage/tables/`-relative path is, by name alone.
 *
 * **Every name Marinara or its launcher can write, and `unknown` for the rest.**
 * The `unknown` arm is the one that earns the table: below the checked storage
 * format it is a review row saying we did not recognise a file, and above it,
 * for a table we convert, it is the signal that the layout moved — the only
 * evidence available before reading anything, since a manifest version has
 * already been established not to carry it.
 *
 * `path` is the whole source-relative path, `storage/tables/…` included.
 */
export function classifyTablePath(path: string): TablePath {
  const rest = path.startsWith(TABLES) ? path.slice(TABLES.length) : path;
  if (rest === '') return { table: null, role: 'unknown', shard: null };

  // Left behind by a filesystem rather than by Marinara. Deliberately checked
  // before the sentinels below, and deliberately a closed list: see `litter.ts`.
  if (isLitter(rest)) return { table: null, role: 'artifact', shard: null };

  const slash = rest.indexOf('/');
  if (slash === -1) return classifyLoose(rest);

  const first = rest.slice(0, slash);
  const within = rest.slice(slash + 1);

  const unsharded = POST_UNSHARD_DIR.exec(first);
  if (unsharded) return { table: unsharded[1] ?? null, role: 'artifact', shard: null };

  // A table directory holds files and nothing else; anything nested is a shape
  // upstream never writes.
  if (within.includes('/')) return { table: first, role: 'unknown', shard: null };
  if (within === MIGRATION_SENTINEL) return { table: first, role: 'sentinel', shard: null };
  if (isShardDataFileName(within)) {
    return { table: first, role: 'data', shard: within.slice(0, -'.json'.length) };
  }
  if (within.endsWith('.json.bak')) {
    const stem = within.slice(0, -'.bak'.length);
    if (isShardDataFileName(stem)) {
      return { table: first, role: 'backup', shard: stem.slice(0, -'.json'.length) };
    }
  }
  if (SHARD_ARTIFACT.test(within)) return { table: first, role: 'artifact', shard: null };
  return { table: first, role: 'unknown', shard: null };
}

/** A path directly under `storage/tables/`, which is a single-file table or an artifact. */
function classifyLoose(name: string): TablePath {
  if (name === UNSHARD_SENTINEL) return { table: null, role: 'sentinel', shard: null };

  if (name.endsWith('.json.bak')) {
    return { table: name.slice(0, -'.json.bak'.length), role: 'backup', shard: null };
  }
  if (name.endsWith('.json')) {
    return { table: name.slice(0, -'.json'.length), role: 'data', shard: null };
  }

  const artifact = MONOLITH_ARTIFACT.exec(name);
  if (artifact) return { table: artifact[1] ?? null, role: 'artifact', shard: null };

  // Unrecognised, and still attributed to a table: `characters.json.idx` is
  // evidence about `characters` specifically, and a finding that cannot name
  // the table it is about is a refusal nobody can act on.
  const head = name.split('.')[0] ?? '';
  return { table: head === '' ? null : head, role: 'unknown', shard: null };
}
