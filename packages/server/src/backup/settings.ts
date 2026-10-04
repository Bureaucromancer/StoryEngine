// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  BACKUP_SETTINGS_SCHEMA,
  DEFAULT_BACKUP_SETTINGS,
  type BackupSettings,
} from '@storyengine/shared';

import { writeJsonAtomic } from '../storage/atomic.js';
import { readFileBytes } from '../storage/files.js';
import { KeyedQueue } from '../storage/keyed-queue.js';
import type { Layout } from '../storage/layout.js';

/**
 * One account's backup schedule —
 * [P12.4](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***`PrefsStore`'s shape with `tags.json`'s posture***, and the difference is
 * the whole reason this is a separate file rather than three keys in the
 * preferences bag. [26 B13] chose a bag *because* a preference the client stops
 * using should rot quietly rather than need a migration. This is read by a
 * timer, on the server, and what it decides is whether a file gets written to
 * somebody's disk — so an unrecognised value here is not a stale preference, it
 * is a schedule nobody can predict.
 *
 * **A whole-document write rather than a patch**, which is the other difference
 * from `PrefsStore`. Three fields arrive together from one form, and a shallow
 * merge would let a client that knew about two of them silently keep the third
 * at whatever it was — the failure being a schedule somebody thinks they turned
 * off. The queue is still here because two tabs saving at once is still a
 * read-modify-write against the same file.
 */

export class BackupSettingsStore {
  readonly #layout: Layout;
  readonly #writes = new KeyedQueue();

  constructor(layout: Layout) {
    this.#layout = layout;
  }

  /**
   * The stored schedule, or the default one.
   *
   * ***An unreadable or unrecognised file reads as "everything off".***
   * `PrefsStore`'s asymmetry with `accounts.json`, taken one step further in
   * the direction that matters here: a schedule this build cannot interpret
   * must not become *some other schedule*. Off is the only safe reading of a
   * document we do not understand, because it is the only one that cannot
   * surprise somebody by writing to their disk.
   */
  async read(handle: string): Promise<BackupSettings> {
    const bytes = await readFileBytes(this.#layout.backupSettingsFile(handle));
    if (bytes === null) return { ...DEFAULT_BACKUP_SETTINGS };

    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_BACKUP_SETTINGS };
      const row = parsed as Record<string, unknown>;
      if (row['schema'] !== BACKUP_SETTINGS_SCHEMA) return { ...DEFAULT_BACKUP_SETTINGS };

      const frequency = row['frequency'];
      const contents = row['contents'];
      return {
        frequency:
          frequency === 'daily' || frequency === 'weekly' || frequency === 'off'
            ? frequency
            : DEFAULT_BACKUP_SETTINGS.frequency,
        onStart: row['onStart'] === true,
        contents:
          contents === 'full' || contents === 'redacted'
            ? contents
            : DEFAULT_BACKUP_SETTINGS.contents,
      };
    } catch {
      return { ...DEFAULT_BACKUP_SETTINGS };
    }
  }

  /** Replaces the stored schedule and answers what is now stored. */
  async write(handle: string, settings: BackupSettings): Promise<BackupSettings> {
    return this.#writes.run(handle, async () => {
      await writeJsonAtomic(this.#layout.backupSettingsFile(handle), {
        schema: BACKUP_SETTINGS_SCHEMA,
        ...settings,
      });
      return settings;
    });
  }
}
