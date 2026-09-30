// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportDisposition } from '@storyengine/shared';

/**
 * Aventuras' tables, vendored, and what the sweep does with each
 * ([P13.2](../../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * on [P4 §1.8](../../../../../docs/design/workplan/16-p4-implementation.md)'s
 * mechanism).
 *
 * The third registry of the same kind as `sillytavern.ts` and `marinara.ts`:
 * a committed snapshot with its provenance below, and `registries.test.ts`
 * asserting that **every name in it has a disposition**. A table a real
 * database has and this list does not — anything a later Aventuras adds — is
 * the `unrecognised` class, reported with its row count rather than passed
 * over, which is what the reader does with every name `sqlite_master` gives it
 * that is not here.
 *
 * Snapshot provenance:
 *   source  aventuras/src-tauri/migrations/001–039, replayed into an empty
 *           database and read back from `sqlite_master`; `_sqlx_migrations`
 *           is the migration runner's own bookkeeping table, which every
 *           database Aventuras has opened carries
 *   commit  c43da108f6b3679950e76afe020f6b26abf0c9ce (v0.7.11, migration 039)
 *   taken   2026-09-29
 *
 * **Names only.** The migrations are AGPL-3.0 text from another project;
 * a table's name is a fact about the file somebody hands us, and it is all
 * this list carries. The columns the reader depends on are in
 * `aventuras/schema.ts`, written by hand from the same replay.
 *
 * ***Fifteen of the twenty-eight are the stories*** — `stories` itself, and
 * fourteen tables whose every row carries a `story_id`. That is Part 2 of P13,
 * scheduled 2026-09-29 and built a stage at a time from P13.11, and it is why
 * the reader counts eleven of those per story rather than only per table (the
 * other three are derived from the rest): the review says what each story
 * holds, so nobody has to guess what an import left behind.
 */

/** Every table at the pin, in the order `sqlite_master` lists them by name. */
export const AVENTURAS_TABLES = [
  '_sqlx_migrations',
  'background_images',
  'branches',
  'chapters',
  'character_vault',
  'characters',
  'checkpoints',
  'embedded_images',
  'entries',
  'items',
  'kept_separate',
  'locations',
  'lorebook_vault',
  'model_health_cache',
  'pack_runtime_variables',
  'pack_templates',
  'pack_variables',
  'preset_packs',
  'scenario_vault',
  'settings',
  'stories',
  'story_beats',
  'story_entries',
  'templates',
  'time_anchors',
  'vault_assistant_conversations',
  'vault_tags',
  'world_state_snapshots',
] as const;

/**
 * The tables whose every row belongs to one story, by its `story_id` — the
 * list `stories` itself heads.
 *
 * Exported beside the dispositions rather than kept in the reader, because
 * which tables are a story's is a fact about the snapshot, and this list and
 * the dispositions must be edited together when it is retaken. **The reader
 * derives its per-story counts from it** — its `STORY_COUNTS` is keyed by
 * {@link AventurasStoryTable}, so the type checker refuses a table added here
 * until the reader has said whether it is counted per story (and under which
 * name) or only per table, as the three derived ones are. *Found at the P13.2
 * review:* this said it *was* the reader's counts while the reader kept a list
 * of its own, and nothing held the two together.
 */
export const AVENTURAS_STORY_TABLES = [
  'story_entries',
  'branches',
  'characters',
  'locations',
  'items',
  'story_beats',
  'entries',
  'chapters',
  'checkpoints',
  'embedded_images',
  'background_images',
  'time_anchors',
  'kept_separate',
  'world_state_snapshots',
] as const;

/** One of {@link AVENTURAS_STORY_TABLES}. */
export type AventurasStoryTable = (typeof AVENTURAS_STORY_TABLES)[number];

/**
 * What becomes of each table — P13.2 converted nothing, and each stage since
 * turns one `recorded` into a `converted` here.
 *
 * Grouped by what each group is waiting on, because that is the argument for
 * its row: every `recorded` below names the stage that turns it into
 * something, and the stage that does must change the row here — a table whose
 * rows are converted and which still says `recorded` is a review describing an
 * import that did not happen. **The other direction is held too**: a
 * `converted` table is one the reader emits a candidate per row for
 * (`CONVERTED_TABLES` in the reader, which `registries.test.ts` holds to this
 * list), and such a table has **no row of its own** in the review — it is
 * reported by the objects it became, as Marinara's converted tables are, so a
 * table of three characters is three rows and not four.
 */
export const AVENTURAS_DISPOSITIONS: Readonly<Record<string, ImportDisposition>> = {
  // ── The library: converted stage by stage from P13.3 ─────────────────────
  //
  // The three vault tables are the rows Aventuras' own vault exports map
  // (§0.1), so their converters are the ones P4 §1.5 already wrote. Each
  // becomes `converted` at its stage: characters at P13.3, lorebooks at P13.4,
  // scenarios at P13.5, tags at P13.6.
  /** P13.3: one actor per row, portrait carried (§1.6). */
  character_vault: 'converted',
  /** P13.4: one lorebook per row, its flat vault entries mapped as Aventuras' export maps them (§0.4). */
  lorebook_vault: 'converted',
  /**
   * P13.5: one treatment and its cast per row, through the file's own
   * scenario converter; its linked lorebook resolved into `lore` (§1.7).
   */
  scenario_vault: 'converted',
  /**
   * P13.6: one registry entry per name, merged by `sameTag` and never
   * recolouring one already there; the kind has nowhere to go (§1.8). Not a
   * library object, and the objects are not stamped with it.
   */
  vault_tags: 'converted',
  // Packs are their own stage (§1.10), and ***P13.9 closed them `recorded`***,
  // which the stage allowed and its mapping table decided: four of the pin's
  // eighty-one templates have a counterpart here — the narrator's — and those
  // branch on `pov`, `tense` and `narratorReinforcement`, which our render
  // namespace has no name for, so a preset made of them would render voice
  // rules that contradict the story and two empty user halves
  // (`aventuras/packs.ts` has the whole argument). Recorded, then, and said:
  // each pack is a row of its own beside its table's, naming the templates
  // that differ from Aventuras' own — what somebody wrote, left in Aventuras.
  // `pack_variables` would carry one for one and be inert; with no templates
  // to read them they are counted on the pack's row instead.
  /** One row per pack beside this one (`aventura.db/preset_packs/<id>`), with what it holds. */
  preset_packs: 'recorded',
  /** Counted here and per pack; the ids that differ from the pin's text are named on the pack's row. */
  pack_templates: 'recorded',
  /** Counted here and per pack. */
  pack_variables: 'recorded',
  /** Per-entity tracked state: channel-shaped, P7's, and `recorded` past P13.9 too (§1.10). Counted per pack. */
  pack_runtime_variables: 'recorded',
  /** A chat with Aventuras' own assistant, with no counterpart here ("not in this phase"). */
  vault_assistant_conversations: 'recorded',

  // ── Credential: counted, never read ([P4 §1.1], §1.9) ────────────────────
  //
  // Provider keys in plain text (`api_profiles`, `openai_api_key`), beside
  // window widths and a theme. **Dropped, not quarantined** — and not even
  // selected: the reader runs `count(*)` on this table and nothing else, so no
  // value from it is ever read out of the database, and none can reach the
  // review or the ledger. (Its bytes do pass through this process: an upload
  // or a zip entry is the whole database, `settings` and all, on its way to
  // the copy. What §1.9 promises is the statement, and the statement is only
  // ever a count.)
  settings: 'credential',

  // ── Skipped and counted ───────────────────────────────────────────────────
  /** Migration bookkeeping. The reader reads its highest version for the gate; the rows are not the person's. */
  _sqlx_migrations: 'skipped',
  /** A cache of which of a provider's models answered, when. Stale on arrival. */
  model_health_cache: 'skipped',
  /**
   * The prompt templates of migration 001, which nothing in Aventuras reads at
   * the pin: its prompts moved to built-in seeds at 020, and into packs —
   * created at 030 — after that. Superseded. (*Corrected at the P13.2 review*,
   * which found this saying 020 had moved these rows into packs, ten
   * migrations before packs existed.)
   */
  templates: 'skipped',

  // ── The stories: Part 2, scheduled 2026-09-29 ────────────────────────────
  //
  // ***P13.11: the tree.*** A story, its entries and its branches become one
  // session each — the producer's document handed to `importSession` — and so
  // are `converted`, and have no row of their own: each story is a row, keyed
  // `aventura.db/stories/<id>`, with the session as its `objectId`, and its
  // entries and branches are the turns and the names inside it.
  //
  // **Converted when a sweep asks for stories, and only then** (the reader's
  // `stories` option, and `SweepRequest.stories` for why it is asked). A
  // sweep that does not ask still gives each story its own row, `recorded`,
  // saying what it holds — so the registry says what this build does with the
  // table, and the row says what this sweep did with the story, which is the
  // split every other converted table already has between its disposition
  // and a row that failed. `registries.test.ts` holds these three to the
  // reader's `CONVERTED_TABLES`.
  /** P13.11: one session per story, its head from `current_branch_id`. */
  stories: 'converted',
  /** P13.11: paired into turns — an action and its answer are one. */
  story_entries: 'converted',
  /** P13.11: the tree's shape, rebuilt from `fork_entry_id`; each a named ref on the session. */
  branches: 'converted',
  //
  // ***P13.12: the world.*** The five tables are resolved for the branch the
  // session opens on — copy-on-write, `overrides_id` shadowing and `deleted`
  // hiding (`aventuras/world.ts`) — and become the story's cast and one
  // lorebook of its own, written before the session that links to them. They
  // are converted on the tree's terms: when a sweep asks for stories, and with
  // no row of their own — each story's row names the actors and the book it
  // made (`alsoProduced`) and says per kind what came. *Converted is the head
  // branch's world*: what another branch holds differently is counted on the
  // story's row and left in Aventuras, since one session has one cast.
  /** P13.12: the head's characters, each an actor in the session's cast; the protagonist its persona. */
  characters: 'converted',
  /** P13.12: entries of the story's lorebook, tagged `location`. */
  locations: 'converted',
  /** P13.12: entries of the story's lorebook, tagged `item`. */
  items: 'converted',
  /**
   * P13.12: entries of the story's lorebook, tagged `story-beat` — ***an
   * interim home***, decided 2026-09-28 (§4): beats are a feature StoryEngine
   * means to grow, and its import will read them from there.
   */
  story_beats: 'converted',
  /** P13.12: the story's own lorebook, through the converter every Aventuras lorebook takes. */
  entries: 'converted',
  //
  // ***P13.13: the pictures.*** Each carried as a finished rendition of the
  // session, never a job: an embedded image on the turn that holds its entry,
  // on whichever branch, as an `illustration`; the backdrop a branch was
  // showing on the turn its line ends on, as a `background`, carried and not
  // selected (`aventuras/pictures.ts` says why). Converted on the tree's terms
  // — when a sweep asks for stories, with no row of their own; each story's
  // row counts what came and says what did not (a picture never finished, one
  // past the bound, one that is not a picture, a checkpoint's backdrop).
  /** P13.13: `illustration` renditions, on the turn that holds each entry. */
  embedded_images: 'converted',
  /** P13.13: `background` renditions, on the turn each branch's line ends on; a checkpoint's stays with it. */
  background_images: 'converted',
  //
  // The rest wait on their stage — ~~P13.13 the pictures~~, P13.14 the chapters.
  // Recorded, and counted per story on each story's row. The derived ones —
  // checkpoints, snapshots, time anchors, `kept_separate` — are "recorded or
  // skipped, with a count" in the phase's own words; recorded here until their
  // stage decides which, since `skipped` says *deliberately not taken* about a
  // decision nobody has made yet.
  chapters: 'recorded',
  checkpoints: 'recorded',
  time_anchors: 'recorded',
  kept_separate: 'recorded',
  world_state_snapshots: 'recorded',
};
