// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportDisposition } from '@storyengine/shared';

/**
 * SillyTavern's per-user directory tree, vendored, and what the sweep does with
 * each part of it ([P4 §1.8](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **Vendored as a snapshot, on the mechanism §1.1 already decided for
 * credentials**: committed here with the provenance below rather than derived at
 * build time, so there is no dependency on another repository being checked out,
 * and a test asserts that **every name in the snapshot has a disposition**. That
 * is what turns *nothing is silently dropped* from a promise into something that
 * fails the build.
 *
 * Snapshot provenance:
 *   source  SillyTavern/src/constants.js, `USER_DIRECTORY_TEMPLATE`
 *   commit  06bde939fb1e9c4c8d8641d810f0a916b5bce127 (1.19.0, 2026-09-14)
 *   taken   2026-09-22
 *   was     8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8 (1.18.0+1, 2026-07-07),
 *           byte-identical: the template has not moved since 2025-06
 *
 * Counting it is how P4 found that its own plan named about eighteen of these
 * and the template has thirty-one. A disposition nobody wrote is exactly the
 * silent drop this section exists to prevent.
 */

/**
 * The template's values, verbatim. `root` is the tree itself and carries no
 * disposition, which is why the map below has thirty entries and this has
 * thirty-one.
 */
export const SILLYTAVERN_DIRECTORIES = [
  '',
  'thumbnails',
  'thumbnails/bg',
  'thumbnails/avatar',
  'thumbnails/persona',
  'worlds',
  'user',
  'User Avatars',
  'user/images',
  'groups',
  'group chats',
  'chats',
  'characters',
  'backgrounds',
  'NovelAI Settings',
  'KoboldAI Settings',
  'OpenAI Settings',
  'TextGen Settings',
  'themes',
  'movingUI',
  'extensions',
  'instruct',
  'context',
  'QuickReplies',
  'assets',
  'user/workflows',
  'user/files',
  'vectors',
  'backups',
  'sysprompt',
  'reasoning',
] as const;

/**
 * What becomes of each directory.
 *
 * The four not-converted classes are kept apart because they answer differently
 * to a person reading the review: *never coming*, *not yet*, *deliberately not
 * taken*, and *we could not tell*.
 */
export const SILLYTAVERN_DISPOSITIONS: Readonly<Record<string, ImportDisposition>> = {
  // ── Converted ──────────────────────────────────────────────────────────────
  characters: 'converted',
  worlds: 'converted',
  'OpenAI Settings': 'converted',
  'TextGen Settings': 'converted',
  sysprompt: 'converted',
  /**
   * Personas: the images live here and their names and descriptions live under
   * `power_user.personas` in `settings.json`
   * ([survey §3](../../../../../docs/design/01-source-survey.md)). This is the
   * tree's one irregular case, and it is why `settings.json` is an import input
   * rather than a skipped file.
   */
  'User Avatars': 'converted',

  // ── Recorded, not converted: needs machinery a later phase brings ──────────
  groups: 'recorded',
  'group chats': 'recorded',
  /**
   * ~~Chat import is closed rather than deferred ([25 E4]), and the review says
   * so.~~
   *
   * *Corrected 2026-09-01.* **Conditional, not closed** — and this comment
   * outlived the decision it cites by a day. [25 E4] was rewritten on
   * 2026-08-31 to *"conditional on an interchange format… no longer a flat
   * refusal. The condition is the shape, not the appetite"*; what stood here
   * quoted the version it replaced. The condition is a format that begins at
   * P11's session export ([25 B12]).
   *
   * **The disposition does not move, and is now the right arm rather than an
   * approximate one.** `recorded` means *the machinery belongs to a later phase,
   * and the review says when* — which is what a condition with a named phase is,
   * and is what sat badly against a decision described as closed. The comment
   * was the only wrong part.
   *
   * [18](../../../../../docs/design/18-session-import.md) surveys what such an
   * import would meet, including the finding that bears on this row directly: an
   * ST message carries no id, so a re-import has nothing better to key on than
   * its index in the file.
   */
  chats: 'recorded',

  // ── Not converted, by position: nothing chat-shaped to become ─────────────
  instruct: 'by-position',
  context: 'by-position',
  'NovelAI Settings': 'by-position',
  'KoboldAI Settings': 'by-position',

  // ── Skipped and counted ───────────────────────────────────────────────────
  backgrounds: 'skipped',
  themes: 'skipped',
  backups: 'skipped',
  /** Embeddings are derived data ([00 §2.8]). */
  vectors: 'skipped',
  /** Absent from every survey document; counted by name so the review is honest. */
  QuickReplies: 'skipped',
  thumbnails: 'skipped',
  'thumbnails/bg': 'skipped',
  'thumbnails/avatar': 'skipped',
  'thumbnails/persona': 'skipped',
  movingUI: 'skipped',
  extensions: 'skipped',
  assets: 'skipped',
  reasoning: 'skipped',
  user: 'skipped',
  'user/images': 'skipped',
  'user/files': 'skipped',
  'user/workflows': 'skipped',
};

/**
 * The files that sit at the root of a user directory, beside the thirty
 * directories ([P4 §7.19]).
 *
 * **The template does not name them, and the reader met them as
 * `unrecognised`.** `USER_DIRECTORY_TEMPLATE` is directories only, so every one
 * of these arrived in a real import as a row saying nothing was recognised —
 * which is the same silent-drop failure §1.8 built the directory snapshot to
 * prevent, one level down. They are files somebody would recognise the names
 * of, and each one has an answer:
 *
 *   settings.json       `src/constants.js:9`           — read: personas, tags
 *                                                        and the world-info
 *                                                        settings every book
 *                                                        here matches by
 *   secrets.json        `src/endpoints/secrets.js:8`   — a credential, never
 *                                                        opened
 *   stats.json          `src/endpoints/stats.js:13`    — usage counters
 *   image-metadata.json `src/endpoints/image-metadata.js:15`
 *   content.log         `src/endpoints/content-manager.js:195` — which default
 *                                                        files were seeded
 */
export const SILLYTAVERN_ROOT_FILES = [
  'settings.json',
  'secrets.json',
  'stats.json',
  'image-metadata.json',
  'content.log',
] as const;

/** What becomes of each root file. */
export const SILLYTAVERN_ROOT_DISPOSITIONS: Readonly<Record<string, ImportDisposition>> = {
  /** An input to the sweep rather than an object in it, like the directory above. */
  'settings.json': 'converted',
  /**
   * The same answer `.encryption-key` gets on the Marinara side ([P4 §1.1]):
   * named in the review, never read, never in `compat`. SillyTavern's own
   * backup writer leaves it out of the archive it builds, which is independent
   * arrival at the same position.
   */
  'secrets.json': 'credential',
  'stats.json': 'skipped',
  'image-metadata.json': 'skipped',
  'content.log': 'skipped',
};

/**
 * The newest SillyTavern this build has been checked against.
 *
 * **It is a claim about us, not about them.** SillyTavern has no storage format
 * number; the only version in a user directory is `settings.json`'s
 * `currentVersion`, which records the app that last *saved settings* — not the
 * shape of the worlds, cards and presets beside it. So this constant says what
 * the vocabularies in `sillytavern/vocabulary.ts` were read against and what
 * the fixtures were written from, and above it the sweep is careful rather than
 * trusting ([P4 §7.19]).
 *
 * To move it: re-extract every set in `vocabulary.ts` from the new tag, run the
 * suite, and change this line in the same commit. The sizes are pinned, so a
 * set that gained a key fails rather than drifts.
 */
export const SILLYTAVERN_CHECKED_VERSION = '1.19.0';
