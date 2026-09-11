// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The mode manifest moved to `@storyengine/sdk` at [P7.0](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **It had to.** A mode package declares a `ModeDefinition`, so the type has to
 * be reachable from a package the engine is not on the other side of — and this
 * file is what `registry.ts`, `turns/gather.ts` and `turns/preview.ts` import,
 * none of which may reach into a mode. Re-exported here so the engine's import
 * paths stay put while the declarations live where a mode author can read them.
 */
export type {
  AssemblyPlan,
  Mode,
  ModeDefinition,
  ModePreset,
  NoSetup,
  ParticipantPolicy,
  SetupSchema,
  SurfaceContribution,
} from '@storyengine/sdk';
