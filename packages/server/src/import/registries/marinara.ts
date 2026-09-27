// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportDisposition } from '@storyengine/shared';

/**
 * Marinara's table registry, vendored, and what the sweep does with each table
 * ([P4 §1.8](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * The Marinara half of the same mechanism the SillyTavern registry carries: a
 * committed snapshot with the provenance below, and a test asserting **every
 * name in it has a disposition**. A table appearing in a real install but in
 * neither the snapshot nor the map is not a hole — it is the `unrecognised`
 * class, reported and counted. The `scenarios` table is the worked example: it
 * only ever existed on a branch that was deleted, so it is not here, and an
 * install that ran that branch still has it.
 *
 * Snapshot provenance:
 *   source  Marinara-Engine/packages/server/src/db/file-backed-store.ts,
 *           `FILE_BACKED_TABLES`
 *   commit  34442e26da577ff0d95ee890a87024e35831bfa9 (v2.4.3, 2026-08-18)
 *   taken   2026-08-30
 *
 * **Twenty-four of the eighty-one are the social feed** — the `noodle_*` and
 * `slurp_*` families, nearly a third of the store, a subsystem
 * [triage §4](../../../../../docs/design/workplan/02-triage.md) discards
 * outright. Worth knowing before anyone estimates this conversion by table
 * count.
 */

/** The registry's contents, verbatim and in its own order. */
export const MARINARA_TABLES = [
  'chats',
  'messages',
  'message_swipes',
  'conversation_call_sessions',
  'conversation_call_messages',
  'conversation_call_sounds',
  'characters',
  'character_card_versions',
  'personas',
  'persona_card_versions',
  'character_groups',
  'persona_groups',
  'noodle_accounts',
  'noodle_posts',
  'noodle_account_subscriptions',
  'noodle_post_unlocks',
  'noodle_interactions',
  'noodler_creator_reply_claims',
  'noodler_prepared_posts',
  'noodler_automatic_attempts',
  'noodler_reserve_state',
  'noodler_fan_activity_state',
  'noodle_activity_digests',
  'noodle_refresh_runs',
  'slurp_accounts',
  'slurp_posts',
  'slurp_account_subscriptions',
  'slurp_post_unlocks',
  'slurp_interactions',
  'slurp_creator_reply_claims',
  'slurp_prepared_posts',
  'slurp_automatic_attempts',
  'slurp_reserve_state',
  'slurp_fan_activity_state',
  'slurp_activity_digests',
  'slurp_refresh_runs',
  'lorebooks',
  'lorebook_character_links',
  'lorebook_persona_links',
  'lorebook_folders',
  'lorebook_entries',
  'prompt_presets',
  'prompt_groups',
  'prompt_sections',
  'choice_blocks',
  'api_connections',
  'assets',
  'agent_configs',
  'agent_runs',
  'agent_memory',
  'custom_tools',
  'game_state_snapshots',
  'spatial_context_snapshots',
  'capability_documents',
  'game_engine_state',
  'game_checkpoints',
  'game_scene_videos',
  'game_turn_storyboards',
  'game_turn_storyboard_keyframes',
  'regex_scripts',
  'chat_images',
  'character_images',
  'persona_images',
  'gallery_folders',
  'global_images',
  'custom_emojis',
  'custom_stickers',
  'ooc_influences',
  'conversation_notes',
  'memory_chunks',
  'chat_folders',
  'api_connection_folders',
  'custom_themes',
  'app_settings',
  'achievement_unlocks',
  'chat_presets',
  'prompt_overrides',
  'installed_extensions',
  'library_folders',
  'mari_instructions',
  'mari_workspace_context',
] as const;

/**
 * What becomes of each table.
 *
 * Grouped by what makes them alike rather than alphabetically, because the
 * grouping *is* the argument: everything under `recorded` is a foreign engine's
 * runtime state waiting on machinery a later phase brings, and that is one
 * decision rather than twenty-five.
 */
export const MARINARA_DISPOSITIONS: Readonly<Record<string, ImportDisposition>> = {
  // ── Converted: the library half, and it is entirely unsharded ─────────────
  characters: 'converted',
  personas: 'converted',
  lorebooks: 'converted',
  lorebook_entries: 'converted',
  lorebook_folders: 'converted',
  lorebook_character_links: 'converted',
  prompt_presets: 'converted',
  prompt_sections: 'converted',
  choice_blocks: 'converted',

  // ── Recorded: the library half nothing reads yet ──────────────────────────
  //
  // *Corrected 2026-09-27.* These five were marked `converted`, and the reader
  // skips a converted table in the review because the objects it produced
  // stand for it. Nothing read them: the two image tables were loaded and
  // thrown away, and the other three never loaded. So an import said nothing
  // at all about a character's sprites, a persona's pictures, a book's persona
  // links, prompt groups or library folders. `recorded` is the honest arm:
  // named in the review, waiting on a reader. `marinara.test.ts` now holds
  // every `converted` table to one a sweep opens.
  character_images: 'recorded',
  persona_images: 'recorded',
  lorebook_persona_links: 'recorded',
  prompt_groups: 'recorded',
  /** Would become tags on whatever it organises; `Lorebook.category` was removed deliberately ([24 §2d]). */
  library_folders: 'recorded',

  // ── Credential: never lands, not even in `compat` ([P4 §1.1]) ─────────────
  //
  // Marinara's own profile importer quarantines these rather than trusting
  // them, which is independent arrival at the same position from a project with
  // no stake in ours. Ours is stricter: dropped, and named in the review.
  api_connections: 'credential',
  api_connection_folders: 'credential',

  // ── Recorded, not converted ───────────────────────────────────────────────
  // Session-shaped. ~~Chat import is closed rather than deferred ([25 E4]).~~
  //
  // *Corrected 2026-09-01.* **Conditional, not closed.** [25 E4] was rewritten
  // on 2026-08-31 — *"the condition is the shape, not the appetite"* — and the
  // condition is a session interchange format beginning at P11's export
  // ([25 B12]). The dispositions below are unchanged and `recorded` is now the
  // right arm rather than an approximate one; see the longer note on the same
  // row in `sillytavern.ts`, and [21] for the survey.
  //
  // Worth knowing before anyone reads these five rows as equivalent to ST's:
  // Marinara messages and swipes carry real ids, so re-import identity here is
  // tractable where ST's is not — and a Marinara *branch* is a copied chat with
  // a back-pointer, not a tree edge, so a family of them imports as duplicated
  // prefixes unless it is reassembled whole ([18 §2.2]).
  chats: 'recorded',
  messages: 'recorded',
  message_swipes: 'recorded',
  chat_folders: 'recorded',
  chat_presets: 'recorded',
  conversation_notes: 'recorded',
  ooc_influences: 'recorded',
  // Party- and mode-shaped: P7 ([P7 §1.10]).
  character_groups: 'recorded',
  persona_groups: 'recorded',
  game_state_snapshots: 'recorded',
  game_engine_state: 'recorded',
  game_checkpoints: 'recorded',
  game_scene_videos: 'recorded',
  game_turn_storyboards: 'recorded',
  game_turn_storyboard_keyframes: 'recorded',
  spatial_context_snapshots: 'recorded',
  // Agent- and extension-shaped: waiting on the extension host P7 makes real.
  agent_configs: 'recorded',
  agent_runs: 'recorded',
  agent_memory: 'recorded',
  capability_documents: 'recorded',
  // Rule-shaped, deferred with the rule vocabulary to 2.0 ([25 C7]).
  regex_scripts: 'recorded',
  prompt_overrides: 'recorded',
  /**
   * History-shaped. Ours are files per version and a first import writes no
   * version record ([P4 §1.3]), so there is no writer for a foreign history —
   * and inventing one would fabricate dates.
   */
  character_card_versions: 'recorded',
  persona_card_versions: 'recorded',
  /** Configuration, which has its own surface here ([P2A]). */
  app_settings: 'recorded',

  // ── Skipped and counted ───────────────────────────────────────────────────
  // The social feed: twenty-four tables, discarded from core by the triage.
  noodle_accounts: 'skipped',
  noodle_posts: 'skipped',
  noodle_account_subscriptions: 'skipped',
  noodle_post_unlocks: 'skipped',
  noodle_interactions: 'skipped',
  noodler_creator_reply_claims: 'skipped',
  noodler_prepared_posts: 'skipped',
  noodler_automatic_attempts: 'skipped',
  noodler_reserve_state: 'skipped',
  noodler_fan_activity_state: 'skipped',
  noodle_activity_digests: 'skipped',
  noodle_refresh_runs: 'skipped',
  slurp_accounts: 'skipped',
  slurp_posts: 'skipped',
  slurp_account_subscriptions: 'skipped',
  slurp_post_unlocks: 'skipped',
  slurp_interactions: 'skipped',
  slurp_creator_reply_claims: 'skipped',
  slurp_prepared_posts: 'skipped',
  slurp_automatic_attempts: 'skipped',
  slurp_reserve_state: 'skipped',
  slurp_fan_activity_state: 'skipped',
  slurp_activity_digests: 'skipped',
  slurp_refresh_runs: 'skipped',
  /** Embeddings and derived state ([00 §2.8]). An imported library has no memories. */
  memory_chunks: 'skipped',
  achievement_unlocks: 'skipped',
  conversation_call_sessions: 'skipped',
  conversation_call_messages: 'skipped',
  conversation_call_sounds: 'skipped',
  // Media libraries with no object to hang on.
  assets: 'skipped',
  chat_images: 'skipped',
  gallery_folders: 'skipped',
  global_images: 'skipped',
  custom_emojis: 'skipped',
  custom_stickers: 'skipped',
  // The four Marinara's own profile importer quarantines rather than trusts.
  custom_tools: 'skipped',
  mari_instructions: 'skipped',
  installed_extensions: 'skipped',
  custom_themes: 'skipped',
  mari_workspace_context: 'skipped',
};
