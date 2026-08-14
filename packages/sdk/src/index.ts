// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The published extension and mode contract.
 *
 * Scaffolded at P1.0: it re-exports `shared` and nothing else. The mode
 * contract itself is P7 (docs/design/15-work-plan.md), but the package exists
 * now because the boundary rule that makes built-in modes consume this package
 * — rather than reaching into `server` — has to predate the first mode
 * (docs/design/07-tech-stack.md §10).
 */

export * from '@storyengine/shared';
