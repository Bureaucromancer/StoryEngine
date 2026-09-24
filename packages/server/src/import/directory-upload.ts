// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { uploadPriority } from './marinara/store-format.js';
import type { ImportSourceKind } from './source.js';
import { SILLYTAVERN_DISPOSITIONS } from './registries/sillytavern.js';

/**
 * Which files a browser directory upload actually has to carry
 * ([P4 §7.13](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **P4 cut this transport and the cut is being reversed, so the reason it was
 * cut matters.** §5 called the browser directory upload *reach, not core* —
 * the server-path sweep already paid the demo — and cutting it was right at the
 * time. What makes it worth building now is the case the server path cannot
 * serve at all: a person whose browser is not on the machine the server runs on
 * has no path to type, and `fileAccess` is admin-only besides.
 *
 * **The whole folder is named; only some of it is sent.** A SillyTavern user
 * directory is thirty directories and most of them are chats, backups,
 * thumbnails and vectors — material the importer reports and never opens. So the
 * client sends a *manifest* of every relative path, this decides which of them
 * the reader will actually read, and the client uploads only those. The rest
 * arrive as `declared` paths on {@link MemoryFileSource}: listed, reported, and
 * answering `null` to a read.
 *
 * That is what keeps *nothing is silently dropped* true across a transport that
 * deliberately does not carry everything. The alternative — upload the tree and
 * discard most of it server-side — moves gigabytes to learn what a name already
 * says.
 *
 * **The knowledge is the registry's, not this file's.** Which SillyTavern
 * directories hold convertible material is `SILLYTAVERN_DISPOSITIONS`, the
 * vendored snapshot the walker already routes by; asking it here rather than
 * listing directories again is what stops the two from drifting into disagreeing
 * about which folder holds the cards.
 */

/** One entry of the manifest a browser sends: where a file sits, and how big. */
export interface ManifestEntry {
  /** Relative to the picked folder, `/`-separated, no leading slash. */
  path: string;
  bytes: number;
}

export interface UploadPlan {
  /** Paths whose bytes the reader will open. The client uploads exactly these. */
  wanted: string[];
  /** Paths that are named and not carried. Reported, never read. */
  declared: string[];
  /** Total size of `wanted`, which is what the upload limit applies to. */
  wantedBytes: number;
}

/**
 * How much the reader for `kind` wants a path, lower first, or `null` when
 * naming it is enough ([P4 §7.18](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * A loose root is the expensive case and honestly so: [P4 §7.8] made it probe
 * *every* file by content, because a folder nobody arranged has no positions to
 * route by. There is nothing to narrow, so everything is wanted and the size cap
 * is what bounds it.
 */
function priorityOf(kind: ImportSourceKind, path: string): number | null {
  if (kind === 'marinara') return uploadPriority(path);
  if (kind === 'sillytavern') {
    // Personas are a join between the settings file and `User Avatars/`, so the
    // settings file is read even though it is not in any directory.
    if (path === 'settings.json') return 0;
    const top = path.includes('/') ? (path.split('/')[0] ?? path) : path;
    // `Object.hasOwn`, not a bare lookup: the registry is an object literal, so
    // a directory named `constructor` would otherwise be handed a function.
    // The same prototype-chain hole [P4 §7.8] found on the other side of this.
    if (!Object.hasOwn(SILLYTAVERN_DISPOSITIONS, top)) return null;
    return SILLYTAVERN_DISPOSITIONS[top] === 'converted' ? 1 : null;
  }
  return 1;
}

/**
 * Splits a manifest into what must be carried and what only needs naming.
 *
 * **The budget is spent by priority, and both lists come back in manifest
 * order.** ~~Entries are taken in the order given until `budgetBytes` is
 * reached~~ *Changed 2026-09-22 ([P4 §7.18]).* Taking them in the browser's
 * order meant a large folder spent its budget on whatever the picker listed
 * first — for a Marinara root, every chat's shards before the one file of
 * characters — and a file the reader needed arrived declared. The order the
 * browser lists files in is a fact about the browser; which files matter is a
 * fact about the reader.
 *
 * **Truncation is not silent** — a declared file is still listed and still
 * reported, so the review says what happened to it rather than the file
 * vanishing between the picker and the report.
 */
export function planUpload(
  kind: ImportSourceKind,
  manifest: readonly ManifestEntry[],
  budgetBytes: number,
): UploadPlan {
  const ranked = manifest
    .map((entry, index) => ({ entry, index, priority: priorityOf(kind, entry.path) }))
    .filter(
      (one): one is { entry: ManifestEntry; index: number; priority: number } =>
        one.priority !== null,
    )
    .sort((left, right) => left.priority - right.priority || left.index - right.index);

  const carried = new Set<number>();
  let wantedBytes = 0;
  for (const { entry, index } of ranked) {
    if (wantedBytes + entry.bytes > budgetBytes) continue;
    carried.add(index);
    wantedBytes += entry.bytes;
  }

  const wanted: string[] = [];
  const declared: string[] = [];
  manifest.forEach((entry, index) => {
    (carried.has(index) ? wanted : declared).push(entry.path);
  });
  return { wanted, declared, wantedBytes };
}
