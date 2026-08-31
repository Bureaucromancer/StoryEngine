// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Portable types and schemas, shared by server, client and the SDK.
 *
 * Authored as TypeBox; **the published artefact is JSON Schema**
 * (docs/design/07-tech-stack.md §4), emitted to `schemas/` by
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
// What a turn *would* assemble to — the stateless preview's answer ([P3.4]).
// Beside the record rather than in it: it is never written to disk.
export * from './preview.js';
// The import review's vocabulary — internal tier, beside the turn record and
// for the same reason ([P4 §1.4]). Classes and params, never sentences.
export * from './import.js';
export * from './schema/common.js';
export * from './schema/hook.js';
export * from './schema/actor.js';
export * from './schema/lorebook.js';
export * from './schema/treatment.js';
export * from './schema/setup.js';
export * from './schema/preset.js';
export * from './schema/package.js';
export * from './schema/registry.js';
