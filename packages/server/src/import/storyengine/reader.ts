// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportItemReport, ImportNote } from '@storyengine/shared';
import {
  BACKUP_MANIFEST_MEMBER,
  LIBRARY_DIRECTORIES,
  isKnownSchema,
  readBackupManifest,
  schemaIdOf,
  type PortableSchemaId,
} from '@storyengine/shared';

import { codecFor } from '../../storage/card/index.js';
import type { FileSource, SourceItem, SourceReader, SourceSurvey } from '../source.js';

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

/** The member names that are a library object, by kind. */
const KIND_OF: ReadonlyMap<string, PortableSchemaId> = new Map(
  Object.entries(LIBRARY_DIRECTORIES).map(([schemaId, directory]) => [
    directory,
    schemaId as PortableSchemaId,
  ]),
);

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

  async *items(): AsyncIterable<SourceItem> {
    const prefix = `users/${this.#handle}/library/`;

    /**
     * ***Each object's `assets/`, so they travel with it*** (2026-09-27). A
     * folder kind keeps its pictures beside its file, named by their digest,
     * and its `media` rows name them. They used to be skipped here as *not the
     * object*, which is true, and then nothing carried them: every gallery and
     * every entry's pictures came back from a backup as rows naming files that
     * were not there. Gathered in a first pass because the source lists
     * members in whatever order the archive has them.
     */
    const assets = new Map<string, string[]>();
    for await (const path of this.#files.list()) {
      if (!path.startsWith(prefix)) continue;
      const [directory, slug, folder, file, ...deeper] = path.slice(prefix.length).split('/');
      if (folder !== 'assets' || file === undefined || file === '' || deeper.length > 0) continue;
      const key = `${String(directory)}/${String(slug)}`;
      assets.set(key, [...(assets.get(key) ?? []), path]);
    }

    for await (const path of this.#files.list()) {
      if (!path.startsWith(prefix)) continue;

      /**
       * `users/<handle>/library/<kind>/<slug>/<file>` — and **anything deeper
       * is not the object**, which is the same rule `Layout.parseObjectPath`
       * applies on disk: an actor's `assets/portrait.png` is not an actor, and
       * counting it would produce one spurious candidate per picture. What is
       * in `assets/` rides on the object's candidate instead (above).
       */
      const parts = path.slice(prefix.length).split('/');
      const [directory, slug, filename, ...deeper] = parts;
      if (directory === undefined || slug === undefined || filename === undefined) continue;
      if (deeper.length > 0) continue;

      const schemaId = KIND_OF.get(directory);
      if (schemaId === undefined) {
        yield {
          outcome: 'observed',
          report: skipped(path, {
            key: 'import.backup.unknownKind',
            params: { file: path },
            level: 'info',
          }),
        };
        continue;
      }

      const bytes = await this.#files.read(path);
      if (bytes === null) continue;

      const body = filename === 'card.png' ? readActorCard(bytes) : readJson(bytes);
      if (body === null) {
        yield {
          outcome: 'observed',
          report: skipped(path, {
            key: 'import.backup.unreadable',
            params: { file: path },
            level: 'info',
          }),
        };
        continue;
      }

      /**
       * ***The schema in the file decides, not the folder it was in.***
       * A backup is a folder somebody may have edited ([10 §2.1]), so *typed*
       * and *conformant* are different claims — the same distinction
       * `export/writers.ts` makes about a stored object. A body whose schema
       * disagrees with its directory is reported rather than filed by its path.
       */
      const declared = schemaIdOf(body);
      if (declared === null || !isKnownSchema(declared) || declared !== schemaId) {
        yield {
          outcome: 'observed',
          report: skipped(path, {
            key: 'import.backup.wrongKind',
            params: { file: path },
            level: 'info',
          }),
        };
        continue;
      }

      const carried = assets.get(`${directory}/${slug}`);
      yield {
        outcome: 'candidate',
        candidate: {
          source: path,
          format: 'storyengine.object',
          payload: body,
          ...(carried === undefined ? {} : { assets: carried }),
        },
      };
    }
  }
}

/**
 * One observed row.
 *
 * ***The note is built at the call site rather than here, and that is a
 * constraint rather than a preference.*** `note-labels.test.ts` proves every
 * `{placeholder}` in a review sentence is a parameter some emitter actually
 * sends, and it reads the source: a helper that took the key as a variable and
 * supplied the params itself hides the pair from the scan, so the check reports
 * *which no emitter sends* for a parameter that is in fact always sent. Found
 * on the first run, which is the check doing exactly its job.
 */
function skipped(path: string, note: ImportNote): ImportItemReport {
  return { source: path, disposition: 'skipped', notes: [note] };
}

function readJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * An actor out of its card.
 *
 * **`card.png` is the object rather than a mirror of one** ([03 §5.2]), so
 * there is no JSON beside it to read instead — the same reader the library's
 * own load path uses is the only way in.
 */
function readActorCard(bytes: Uint8Array): unknown {
  const codec = codecFor(bytes);
  if (codec === null) return null;
  try {
    // The envelope's payload, not the legacy V2 block: this is our own card, so
    // the portable object is the thing that was written and the legacy half is
    // the compatibility copy beside it.
    return codec.read(bytes).envelope?.payload ?? null;
  } catch {
    return null;
  }
}
