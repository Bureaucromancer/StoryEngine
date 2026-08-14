// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The derived index.
 *
 * **Never authoritative, never the only home for a fact**
 * ([02 §5.1](docs/design/02-data-model.md)). Deleting `index.sqlite` costs a
 * rescan and nothing else; if a feature can only be answered from here, that
 * feature is storing data in the wrong place.
 */

export * from './migrations.js';
export * from './open.js';
export * from './ingest.js';
export * from './rebuild.js';
export * from './query.js';
export * from './watcher.js';
