// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportItemReport, ImportNote } from '@storyengine/shared';
import {
  LEGACY_LIBRARY_DIRECTORIES,
  LIBRARY_DIRECTORIES,
  isKnownSchema,
  schemaIdOf,
  type PortableSchemaId,
  upgradeLegacySchema,
} from '@storyengine/shared';

import { contentHashOf } from '../../index-db/ingest.js';
import { codecFor } from '../../storage/card/index.js';
import type { FileSource } from '../source.js';

/**
 * ***A tree of library folders, read as objects*** — extracted from
 * `BackupReader.items()` at [P16.3e](../../../../../docs/design/workplan/35-p16-world.md),
 * so the two readers of our own folders parse them once.
 *
 * **Why one parser, and why now.** [P16.3]'s plan, §3: *"the layout mirrors
 * `data/`, and the reader shares the backup reader's folder parser"* — a World
 * file ([16 §5.2](../../../../../docs/design/16-publish.md)) lays its objects
 * out as `library/<kind>/<folder>/<file>` exactly as an account archive lays
 * them out under `users/<handle>/library/`, and two spellings of *which member
 * is the object, which are its pictures, what is deeper and not the object*
 * would be two answers to one question about one shape. The backup reader's
 * tests are the net: it reads through this, unchanged in what it yields.
 *
 * **What it yields, under `prefix`** (relative, `/`-separated, ending in `/`):
 *
 * - **an object** for every `<kind>/<folder>/<file>` whose kind folder is a
 *   library kind, current or legacy ([P16 §1.1]) — its body upgraded from a
 *   kind's old name, its pictures (`<folder>/assets/<file>`), its history when
 *   asked for (`history/index.jsonl` and `history/v/<file>`), and the sha256 of
 *   the bytes read, so a caller that verifies a file against a manifest does
 *   so without reading it twice (the World reader's integrity check, [P16.3]'s
 *   plan R9 — and the fact check's *the read budget counts re-reads*);
 * - **an observed row** for every such file it will not vouch for: a kind
 *   folder this build does not know, bytes that do not parse, a body whose own
 *   schema is not its folder's ([10 §2.1]: a folder somebody may have edited).
 *   The note keys are the backup's, and say nothing about a backup — *in a
 *   folder this build does not recognise*, *could not be read*, *says it is
 *   something other than what its folder holds* — so the World reader keeps
 *   them rather than growing three synonyms.
 *
 * **Anything deeper is not the object**, `Layout.parseObjectPath`'s rule on
 * disk: an actor's `assets/portrait.png` is not an actor, and counting it would
 * make one spurious candidate per picture. A path this ignores is the caller's
 * to account for — the backup reader has always ignored them, and the World
 * reader names every member it did not read (`import.world.notRead`).
 *
 * ***`history` is opt-in, and off for a backup***: the backup reader carries
 * no history and never has — an account archive's history is the account's
 * own folders, restored by the route's copy, not the sweep — and a reader that
 * started yielding it would be a behaviour change a backup test should be
 * written for, not one an extraction should make.
 */

export interface LibraryFolderItem {
  /** The object's file — `library/actors/vera/card.png` — which becomes the row's `source`. */
  path: string;
  schemaId: PortableSchemaId;
  /** The body, upgraded from a kind's old name ([P16 §1.1]). */
  body: unknown;
  /** `sha256:<hex>` of the bytes read — the spelling of the index's `contentHash`. */
  contentHash: string;
  /** `<folder>/assets/<file>`, each a member path, in the order the source listed them. */
  assets: string[];
  /** `<folder>/history/index.jsonl` and `<folder>/history/v/<file>`, when asked for. */
  history: string[];
}

export type LibraryFolderYield = LibraryFolderItem | { observed: ImportItemReport };

/**
 * The member names that are a library object, by kind — the current folders
 * and the ones a kind had before a rename ([P16 §1.1]). An archive taken before
 * P16.0 holds `library/packages/<slug>/package.json`, and without the legacy
 * name each one would be an `unknownKind` row: the backup would import
 * everything but the person's Packages. With it they arrive as Worlds, because
 * the body is upgraded before its kind is compared.
 */
const KIND_OF: ReadonlyMap<string, PortableSchemaId> = new Map([
  ...Object.entries(LIBRARY_DIRECTORIES).map(
    ([schemaId, directory]) => [directory, schemaId as PortableSchemaId] as const,
  ),
  ...Object.entries(LEGACY_LIBRARY_DIRECTORIES),
]);

export async function* libraryFolderItems(
  files: FileSource,
  prefix: string,
  o: { history?: boolean } = {},
): AsyncIterable<LibraryFolderYield> {
  /**
   * ***Each object's `assets/`, so they travel with it*** (2026-09-27). A
   * folder kind keeps its pictures beside its file, named by their digest,
   * and its `media` rows name them. They used to be skipped as *not the
   * object*, which is true, and then nothing carried them: every gallery and
   * every entry's pictures came back from a backup as rows naming files that
   * were not there. Gathered in a first pass because the source lists members
   * in whatever order the archive has them — and the history beside them in
   * the same pass, for the same reason ([P16.3e]).
   */
  const assets = new Map<string, string[]>();
  const history = new Map<string, string[]>();
  for await (const path of files.list()) {
    if (!path.startsWith(prefix)) continue;
    const [directory, slug, folder, file, ...deeper] = path.slice(prefix.length).split('/');
    const key = `${String(directory)}/${String(slug)}`;
    if (folder === 'assets' && file !== undefined && file !== '' && deeper.length === 0) {
      assets.set(key, [...(assets.get(key) ?? []), path]);
      continue;
    }
    if (o.history === true && folder === 'history' && isHistoryMember(file, deeper)) {
      history.set(key, [...(history.get(key) ?? []), path]);
    }
  }

  for await (const path of files.list()) {
    if (!path.startsWith(prefix)) continue;

    /**
     * `<kind>/<slug>/<file>` — and **anything deeper is not the object**, which
     * is the same rule `Layout.parseObjectPath` applies on disk. What is in
     * `assets/` (and, asked for, `history/`) rides on the object's item instead.
     */
    const parts = path.slice(prefix.length).split('/');
    const [directory, slug, filename, ...deeper] = parts;
    if (directory === undefined || slug === undefined || filename === undefined) continue;
    if (deeper.length > 0) continue;

    const schemaId = KIND_OF.get(directory);
    if (schemaId === undefined) {
      yield {
        observed: skipped(path, {
          key: 'import.backup.unknownKind',
          params: { file: path },
          level: 'info',
        }),
      };
      continue;
    }

    /**
     * ***A member the source will not give is passed over here, as the
     * backup reader always passed it over*** — an extraction changes no
     * answer ([P16.3e]). It is not silent for the World reader, which accounts
     * for every member of its file afterwards and names one it did not read
     * (`import.world.notRead`), or one its manifest lists as damaged; whether
     * the backup reader should name it too is a backup question, and a test
     * of its own, not a side effect of a move.
     */
    const bytes = await files.read(path);
    if (bytes === null) continue;

    // A body in a kind's old name is that kind ([P16 §1.1]): a Package's
    // `storyengine.package/1` reads as the World it is, so the check below
    // compares it with its folder as one.
    const body = upgradeLegacySchema(
      filename === 'card.png' ? readActorCard(bytes) : readJson(bytes),
    );
    if (body === null) {
      yield {
        observed: skipped(path, {
          key: 'import.backup.unreadable',
          params: { file: path },
          level: 'info',
        }),
      };
      continue;
    }

    /**
     * ***The schema in the file decides, not the folder it was in.*** A
     * folder somebody may have edited ([10 §2.1]) — so *typed* and
     * *conformant* are different claims, the distinction `export/writers.ts`
     * makes about a stored object. A body whose schema disagrees with its
     * directory is reported rather than filed by its path.
     */
    const declared = schemaIdOf(body);
    if (declared === null || !isKnownSchema(declared) || declared !== schemaId) {
      yield {
        observed: skipped(path, {
          key: 'import.backup.wrongKind',
          params: { file: path },
          level: 'info',
        }),
      };
      continue;
    }

    const key = `${directory}/${slug}`;
    yield {
      path,
      schemaId,
      body,
      contentHash: contentHashOf(bytes),
      assets: assets.get(key) ?? [],
      history: history.get(key) ?? [],
    };
  }
}

/**
 * `history/index.jsonl`, or `history/v/<file>` — the two shapes
 * `storage/history.ts` writes, and nothing else under `history/`.
 */
function isHistoryMember(file: string | undefined, deeper: readonly string[]): boolean {
  if (file === 'index.jsonl') return deeper.length === 0;
  return file === 'v' && deeper.length === 1 && deeper[0] !== undefined && deeper[0] !== '';
}

/**
 * One observed row.
 *
 * ***The note is built at the call site rather than here, and that is a
 * constraint rather than a preference.*** `note-labels.test.ts` proves every
 * `{placeholder}` in a review sentence is a parameter some emitter actually
 * sends, and it reads the source: a helper that took the key as a variable and
 * supplied the params itself hides the pair from the scan.
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
