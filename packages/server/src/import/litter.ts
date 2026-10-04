// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The files an operating system or a sync client leaves in somebody's folder
 * ([P4 §7.18](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **Named explicitly rather than matched by shape.** The obvious rule — *a
 * dot-file is not data* — is the one that cannot be used here: both sources we
 * read use dot-files as markers that a reader has to respect. Marinara's
 * `.migrating` says a table is mid-migration and its `.writer-lease` says an
 * application is running; SillyTavern's `.migrated` says a directory has been
 * converted. Treating every dot-name as litter would skip exactly the files
 * that say *do not read this yet*, and the next in-progress marker either
 * source invents would be skipped the day it appears.
 *
 * So this list is closed, and anything outside it that looks unfamiliar is
 * reported rather than swallowed. The cost of the choice is a review row for a
 * file nobody cares about; the cost of the other one is a torn library.
 *
 * The entries are what turns up in real folders that have been on a Mac, on
 * Windows, in a Dropbox or Syncthing share, or on a Synology NAS — and
 * `:Zone.Identifier`, which is what a Windows download looks like after it has
 * been unpacked under WSL.
 */

/** Exact basenames, compared case-insensitively. */
const LITTER_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.stfolder', '.dropbox']);

/** Whole directories, matched on any path segment. */
const LITTER_DIRECTORIES = new Set(['.stversions', '@eadir', '.stfolder']);

/**
 * Whether a source-relative path is something a filesystem left behind.
 *
 * `path` is `/`-separated with no leading slash, which is what every
 * `FileSource` yields.
 */
export function isLitter(path: string): boolean {
  const segments = path.split('/');
  for (const segment of segments.slice(0, -1)) {
    if (LITTER_DIRECTORIES.has(segment.toLowerCase())) return true;
  }

  const name = (segments.at(-1) ?? '').toLowerCase();
  if (name === '') return false;
  if (LITTER_NAMES.has(name)) return true;
  // macOS resource forks, Dropbox's own files, and the alternate-data-stream
  // companion a download carries across from Windows.
  if (name.startsWith('._')) return true;
  if (name.startsWith('.dropbox')) return true;
  return name.endsWith(':zone.identifier');
}
