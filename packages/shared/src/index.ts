// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Portable types and schemas, shared by server, client and the SDK.
 *
 * Authored as TypeBox; **the published artefact is JSON Schema**
 * (docs/design/19-tech-stack.md §4), emitted to `schemas/` by
 * `pnpm --filter @storyengine/shared emit-schemas` so that third-party tools can
 * validate a card or a package without compiling our types.
 *
 * Pure. No I/O, and no runtime dependency beyond the schema library and its
 * validator — which is what makes this the cheapest place in the project to be
 * thorough.
 */

export * from './ids.js';
export * from './factories.js';
// The turn record — internal tier, deliberately outside `schema/`: no $id, no
// registry entry, no emitted artefact. `turn.ts` carries the argument.
export * from './turn.js';
/**
 * What a person could do about a failure — [P11.6].
 *
 * Beside the turn record and **not part of it**: `remedyFor` reads the record's
 * vocabulary and produces something the record never holds, because two of its
 * three inputs are facts about now. It is here rather than in the server
 * because the transcript derives one too, and one function is what keeps the
 * two from having different opinions.
 */
export * from './remedy.js';
/**
 * A turn's output as messages, and the text derived from them — [P13.0].
 *
 * Beside the turn record and not part of it, for `remedy.js`'s reason: the
 * record is types, and `Turn.output.text` became a *derived* value that the
 * server writes and the client reads, so one derivation is what keeps the two
 * agreeing about it.
 */
export * from './output-messages.js';
/**
 * The interchange format, and the event that freezes two records —
 * [25 B12](../../../docs/design/25-open-questions.md), [P11.10].
 */
export * from './session-export.js';
/**
 * ***What a backup archive says it is*** — [25 E6](../../../docs/design/25-open-questions.md),
 * [P12](../../../docs/design/workplan/29-p12-implementation.md).
 *
 * Beside the interchange formats rather than in `schema/`, and for their reason:
 * an envelope is not an object somebody edits, so it carries a `schema` string
 * and a hand-written reader rather than an emitted JSON Schema.
 */
export * from './backup.js';
// The tag registry — internal tier, beside the turn record and for the same
// reason: it decorates names inside one install and never crosses a boundary
// ([05](../../../docs/design/05-tagging.md)).
export * from './tags.js';
// Renditions — internal tier, beside the turn record and governed by the same
// sentence: a rendition hangs off a turn, travels with the session directory,
// and graduates to `schema/` when the turn record does ([25 B12]'s freeze).
export * from './rendition.js';
// What a turn *would* assemble to — the stateless preview's answer ([P3.4]).
// Beside the record rather than in it: it is never written to disk.
export * from './preview.js';
// The import review's vocabulary — internal tier, beside the turn record and
// for the same reason ([P4 §1.4]). Classes and params, never sentences.
export * from './import.js';
// What an import *would* do — beside the review rather than in it, because a
// report is written to disk and a prediction never is.
export * from './import-preview.js';
// The other direction: what a library object can be written out *as*. Shared
// because the client builds the menu from the same table the server dispatches
// on, and two copies of it would disagree about what a file will work in.
export * from './export-formats.js';
export * from './schema/banners.js';
// Derived logic over a lorebook — whose gates are shut, and what a folder
// governs. Beside the factories rather than in `schema/`: it reads the schema
// and adds no field to it, and both halves of P5 must compute it the same way.
export * from './lore.js';
// Where an entry's surface forms turn up in another entry's prose. Here for the
// same reason `lore.ts` is, doubled: the book page renders it and [11 §6]'s
// falsification script counts it, and an instrument that measured a different
// rule from the one on screen would be measuring nothing anybody sees.
export * from './mentions.js';
// The pure half of key matching, shared so the retriever and the book page's
// inline highlighting cannot answer differently — [P5.8]. The regex arm stays
// server-side: a browser cannot bound a catastrophic pattern, so it declines to
// run one rather than hanging the tab.
export * from './matching.js';
// The name a person calls a build, from the string the machinery reads —
// [releases §7.1]'s rule as code, so the footer derives it rather than typing
// it, and a CHANGELOG heading can be held to the same rule.
export * from './version.js';
// The same heading, read the other way: `CHANGELOG.md` as releases rather than
// as a string. Beside `version.js` because it recognises a release heading with
// `versionName`, and here rather than in the client because the grammar was
// already read by the release workflow and two tests before the arrival page
// became a fourth reader.
export * from './changelog.js';
export * from './schema/common.js';
export * from './schema/hook.js';
export * from './schema/actor.js';
export * from './schema/lorebook.js';
export * from './schema/treatment.js';
export * from './schema/setup.js';
export * from './schema/preset.js';
export * from './schema/package.js';
export * from './schema/registry.js';
