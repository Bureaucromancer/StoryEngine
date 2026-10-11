// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { BACKUP_MANIFEST_MEMBER, readBackupManifest } from '@storyengine/shared';

import type { SourceItem, SourceReader, SourceSurvey, FileSource } from '../source.js';
import { libraryFolderItems } from './library-items.js';

/**
 * ***A StoryEngine backup, read as a root*** —
 * [P12.8](../../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***The one reader here whose objects need no conversion.*** Every other
 * source in this directory exists because somebody else's format has to be
 * turned into ours; this one is handed our own, and what it does instead is
 * **decide what it is looking at and refuse what it cannot vouch for**. An
 * object that does not validate is a report row rather than an abort, which is
 * the posture [P4 §1.3] sets for every reader: *one bad file never aborts a
 * sweep.*
 *
 * ***It reads one account's subtree, named by the caller.*** An install archive
 * holds several, and *which of them are you importing* is a fact about the
 * request rather than about the archive — so the handle is a constructor
 * argument. That is also what makes an admin's per-handle plan possible without
 * a second reader.
 *
 * ***What it deliberately does not yield.*** Sessions are not library objects
 * and go through `sessions/import.ts`'s envelope rather than through a
 * converter; `prefs.json`, `tags.json`, `connections/` and `backup.json` are
 * the optional groups, applied by the route because each is a switch somebody
 * ticked rather than an object to convert. All of them are **reported as
 * observed**, because *nothing is silently dropped* is a property of a single
 * pass and this is that pass.
 */

export class BackupReader implements SourceReader {
  readonly kind = 'storyengine-backup' as const;
  readonly #files: FileSource;
  readonly #handle: string;

  constructor(files: FileSource, handle: string) {
    this.#files = files;
    this.#handle = handle;
  }

  /**
   * ***Refused before anything is written, on the manifest alone.***
   *
   * The manifest is the archive's first member precisely so this costs one read
   * rather than a pass. An archive whose schema is not ours is `unknown-format`
   * for [P4 §1.3]'s reason — *a best-effort parse of a layout we have not seen
   * produces a plausible, wrong library* — and one that does not hold the
   * account being asked for is the same refusal wearing a different cause.
   */
  async survey(): Promise<SourceSurvey> {
    const bytes = await this.#files.read(BACKUP_MANIFEST_MEMBER);
    if (bytes === null) return { ok: false, refusal: 'unknown-format', notes: [] };

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return { ok: false, refusal: 'unknown-format', notes: [] };
    }

    const manifest = readBackupManifest(parsed);
    if ('refusal' in manifest) return { ok: false, refusal: 'unknown-format', notes: [] };
    if (!manifest.handles.includes(this.#handle)) {
      return {
        ok: false,
        refusal: 'unreadable-root',
        notes: [
          {
            key: 'import.backup.noSuchAccount',
            params: { handle: this.#handle },
            level: 'warn',
          },
        ],
      };
    }

    return { ok: true, kind: this.kind, notes: [] };
  }

  /**
   * ***Every object under the account's `library/`*** — through
   * `libraryFolderItems`, extracted from this method at [P16.3e] so the World
   * file's reader parses the same folders the same way ([P16.3]'s plan, §3).
   * What it yields is what this yielded: an object per file whose kind folder
   * is a library kind, with its `assets/` riding on it, and an observed row for
   * a folder this build does not know, bytes that will not parse, and a body
   * whose schema is not its folder's. A backup carries no history through the
   * sweep, so none is asked for.
   */
  async *items(): AsyncIterable<SourceItem> {
    for await (const item of libraryFolderItems(this.#files, `users/${this.#handle}/library/`)) {
      if ('observed' in item) {
        yield { outcome: 'observed', report: item.observed };
        continue;
      }
      yield {
        outcome: 'candidate',
        candidate: {
          source: item.path,
          format: 'storyengine.object',
          payload: item.body,
          ...(item.assets.length === 0 ? {} : { assets: item.assets }),
        },
      };
    }
  }
}
