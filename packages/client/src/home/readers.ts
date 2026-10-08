// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***Everything that reads the changelog, as one chunk*** —
 * [21 §7.3](../../../../docs/design/21-client-loading.md), 2026-10-07.
 *
 * Home's release and the workbench's list of releases are each loaded with
 * `lazy()` (`ChangelogLoad.tsx` says why), and **both through this module**, so
 * the bundler makes them one chunk rather than three — one per reader, and a
 * third for the text they share. They always arrive together anyway: the dock's
 * subject is home's only over `/`, where home's release is already being
 * fetched. One chunk is one request on arrival and one place the text lives,
 * evaluated once, which is [log.ts](./log.ts)'s *one parse* by construction.
 *
 * Measured both ways with the entry-budget test's compressor: as three chunks
 * the bundler also split nine files off the entry, and as one it split five,
 * at a first load about one kilobyte smaller.
 *
 * *A module of re-exports, and nothing else may import it statically* — it is
 * the boundary, and a static import from anywhere the entry reaches puts the
 * renderer and the text back on every first load. The entry-budget test checks
 * the built files for exactly that.
 */

export { HomeRelease } from './HomeRelease.js';
export { ReleaseSubject } from '../workbench/home/ReleaseSubject.js';
