// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { compareVersions, type BuildInfo } from '../build-info.js';
import { writeAtomic } from './atomic.js';
import { ensureDirectory, readFileBytes } from './files.js';
import type { Layout } from './layout.js';

/**
 * Which build last opened this data directory — [P6A §1.7](../../../../docs/design/workplan/19-p6a-alpha-1.md).
 *
 * **The hazard is not strangers, it is you.**
 * [21](../../../../docs/design/21-internal-contracts.md) licenses the storage
 * tier to change without migration *on the condition that nothing leaves the
 * install*, and nothing does — Alpha 1 is private and undistributed
 * ([P6A §1.1]). So the failure this closes is pointing an older build at a
 * volume a newer one has already migrated in place: your own data, changed
 * under a build that does not know the new shape, and no way to tell afterwards
 * which half of it is which.
 *
 * **One file, and deliberately nothing more.** It refuses; it does not convert.
 * Release notes stating no-carry-forward, a documented backup ritual and
 * migration machinery are what a *public* alpha would owe, and [P6A §4] lists
 * them as the price of publishing rather than work to do now.
 *
 * **A build with no identity neither stamps nor checks**, which is every
 * development run. The story above is about two builds; `pnpm dev` is not one of
 * them, and gating it would make a development server refuse to start because of
 * whichever image last touched the directory — turning a foot-gun guard into a
 * daily obstruction for the one person it was never about.
 */

export interface DataStamp {
  version: string;
  commit: string;
  /** When this build first opened the directory, ISO-8601. Informational. */
  writtenAt: string;
}

export class DataStampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataStampError';
  }
}

/**
 * Refuses a directory a newer build wrote, and records this one otherwise.
 *
 * The refusal is a thrown error rather than a log line, because the whole point
 * is that the process must not go on to read and write the directory. A warning
 * would be the half-measure that looks decided.
 */
export async function stampDataDirectory(layout: Layout, build: BuildInfo | null): Promise<void> {
  if (build === null) return;

  const existing = await readStamp(layout);
  if (existing !== null) {
    const order = compareVersions(existing.version, build.version);
    /**
     * **`null` is a refusal, not a shrug.** It means the stamp says something
     * this build cannot place — a hand edit, or a version scheme from a future
     * it does not know — and *carry on regardless* is the answer that loses
     * data. The message carries both strings, because the person reading it
     * knows which of their builds is which and this process does not.
     */
    if (order === null || order > 0) {
      throw new DataStampError(
        order === null
          ? `${layout.dataRoot} was written by a build this one cannot place: ${existing.version}. This build is ${build.version}. Run that build, or move the directory aside.`
          : `${layout.dataRoot} was written by a newer build: ${existing.version}. This build is ${build.version}, and opening it could write an older shape over data the newer one migrated. Run the newer build, or move the directory aside.`,
      );
    }
    // Same or older: nothing to fear, and the stamp moves forward below.
  }

  await ensureDirectory(layout.stateRoot);
  await writeAtomic(
    layout.buildStampFile,
    `${JSON.stringify({ ...build, writtenAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

/** The stamp on disk, or null when there is none this build can read. */
export async function readStamp(layout: Layout): Promise<DataStamp | null> {
  const bytes = await readFileBytes(layout.buildStampFile);
  if (bytes === null) return null;

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { version, commit, writtenAt } = parsed as Record<string, unknown>;
    if (typeof version !== 'string' || version === '') return null;
    return {
      version,
      commit: typeof commit === 'string' ? commit : '',
      writtenAt: typeof writtenAt === 'string' ? writtenAt : '',
    };
  } catch {
    // Unparseable is *no stamp*, not an unplaceable one. A truncated write is
    // the likely cause and it says nothing about which build wrote it, so
    // refusing on it would strand a directory over a fact nobody recorded.
    return null;
  }
}
