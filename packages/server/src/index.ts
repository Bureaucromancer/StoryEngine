// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The StoryEngine server.
 *
 * Still nothing runs. P1.2 adds the storage layer — the audited path helper,
 * atomic writes, and the data-directory layout
 * (docs/design/19-p1-implementation.md §P1.2) — but there is no process to
 * start until the Fastify app at P1.5, and no index until P1.4.
 */

export * from './storage/index.js';
