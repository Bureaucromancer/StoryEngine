// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LOREBOOK_SCHEMA,
  newLorebook,
  newTreatment,
  TREATMENT_SCHEMA,
  type Treatment,
} from '@storyengine/shared';

import { createSession } from '../sessions/store.js';
import { ingestFile, listFileErrors, ownerKey, removeFile } from './ingest.js';
import { usedBy } from './links.js';
import { listObjects, snapshot } from './query.js';
import { rebuild } from './rebuild.js';
import { listSessionRows } from './sessions.js';
import { makeTestLibrary, type TestLibrary } from './test-library.js';

/**
 * ***The index agrees with the disk*** (2026-09-27) — what a rebuild does with
 * what it cannot read, and what `object_link` says when two files hold one id.
 *
 * A rebuild is the remedy for an index nobody trusts, and the start-up path
 * when there is no index at all ([03 §5.1]). Each of the cases below either
 * stopped it — one folder or one file, and a start that needed a rebuild did
 * not start — or left it holding a different answer from the watcher about
 * the same disk.
 */

let library: TestLibrary;
let owners: string[];

beforeEach(async () => {
  library = await makeTestLibrary();
  owners = [ownerKey(library.owner)];
});

afterEach(async () => {
  await library.dispose();
});

function names(): string[] {
  return listObjects(library.db, { owners: [library.owner] })
    .map((row) => row.name)
    .sort();
}

function errors(): [string, string][] {
  return listFileErrors(library.db, owners).map((error) => [error.slug, error.reason]);
}

describe('a rebuild that meets something it cannot read', () => {
  it('passes over a folder under users/ that is not an account', async () => {
    // A NAS's indexer, and somebody's copy of their own folder. Neither is a
    // handle, and the layout refuses to build a path under either.
    await library.writeObject(newLorebook('Rain City'), 'rain-city');
    await mkdir(join(library.layout.usersRoot, '@eaDir', 'library'), { recursive: true });
    await mkdir(join(library.layout.usersRoot, 'Ned.old', 'sessions'), { recursive: true });

    await rebuild(library.db, library.layout);

    expect(names()).toEqual(['Rain City']);
  });

  // A file link needs privileges on Windows; the code is the same on both.
  it.skipIf(process.platform === 'win32')(
    'records a file that links out of the data directory, and indexes the rest',
    async () => {
      await library.writeObject(newLorebook('Alpha'), 'alpha');
      await library.writeObject(newLorebook('Zeta'), 'zeta');
      const outside = await mkdtemp(join(tmpdir(), 'se-rebuild-outside-'));
      try {
        const target = join(outside, 'lorebook.json');
        await writeFile(target, JSON.stringify(newLorebook('Not Yours')));
        const linked = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'middle');
        await mkdir(dirname(linked), { recursive: true });
        await symlink(target, linked);

        const result = await rebuild(library.db, library.layout);

        expect(names()).toEqual(['Alpha', 'Zeta']);
        expect(result.skipped).toBe(1);
        expect(errors()).toEqual([['middle', 'refused-path']]);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    },
  );

  it('records a file it cannot read, and indexes the rest', async () => {
    // A directory where the file should be reads as `EISDIR` on every
    // platform, and as root too — which a file with its permissions taken away
    // does not, so it is the unreadable file a test can make anywhere.
    await library.writeObject(newLorebook('Alpha'), 'alpha');
    await library.writeObject(newLorebook('Zeta'), 'zeta');
    await mkdir(library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'middle'), {
      recursive: true,
    });

    await rebuild(library.db, library.layout);

    expect(names()).toEqual(['Alpha', 'Zeta']);
    expect(errors()).toEqual([['middle', 'unreadable']]);
  });

  it('passes over a session it cannot read, and indexes the others', async () => {
    const context = { layout: library.layout, index: library.db };
    const kept = await createSession(context, 'ned', 'Rain City');
    // A session folder whose `session.json` cannot be read.
    await mkdir(join(library.layout.sessionRoot('ned', 'broken-session'), 'session.json'), {
      recursive: true,
    });

    const result = await rebuild(library.db, library.layout);

    expect(result).toMatchObject({ sessions: 1, sessionsSkipped: 1 });
    expect(listSessionRows(library.db, owners).map((row) => row.sessionId)).toEqual([kept.id]);
  });
});

/** A treatment that points at the books named, written where a person would put it. */
async function treatmentAt(
  slug: string,
  books: readonly string[],
  id?: string,
): Promise<{ path: string; treatment: Treatment }> {
  const treatment: Treatment = {
    ...newTreatment('Rain'),
    ...(id === undefined ? {} : { id }),
    lore: books.map((book) => ({ ref: { id: book, name: book }, required: false })),
  };
  const path = library.layout.objectFile(library.owner, TREATMENT_SCHEMA, slug);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(treatment));
  return { path, treatment };
}

function users(bookId: string): string[] {
  return usedBy(library.db, bookId, owners).map((use) => use.fromId);
}

/**
 * ***What points at what, when two files hold one id*** (2026-09-27).
 *
 * A folder is copy-pasteable ([P1 §1.2]), so two files can hold one id, and
 * `object_link` is keyed by the id. The links were whatever the file ingested
 * last said, and deleting either copy cleared them.
 */
describe('the links of an id two files hold', () => {
  it('survive deleting one copy, because the other still makes them', async () => {
    const original = await treatmentAt('rain', ['book-harbour']);
    const copy = await treatmentAt('rain-copy', ['book-harbour'], original.treatment.id);
    await ingestFile(library.db, library.layout, original.path);
    await ingestFile(library.db, library.layout, copy.path);
    expect(users('book-harbour')).toEqual([original.treatment.id]);

    await rm(dirname(copy.path), { recursive: true, force: true });
    removeFile(library.db, library.layout, copy.path);

    // The delete confirmation's count: the surviving copy still names the book.
    expect(users('book-harbour')).toEqual([original.treatment.id]);
  });

  it('are the winning copy’s, whichever arrived last, as a rebuild has them', async () => {
    const alpha = await treatmentAt('alpha', ['book-harbour']);
    const beta = await treatmentAt('beta', ['book-bridge'], alpha.treatment.id);
    // Beta first and alpha last: the scan a rebuild makes goes the other way,
    // so a rule of *last one wins* gives the two producers different answers.
    await ingestFile(library.db, library.layout, beta.path);
    await ingestFile(library.db, library.layout, alpha.path);

    expect(users('book-harbour')).toEqual([alpha.treatment.id]);
    expect(users('book-bridge')).toEqual([]);

    const live = snapshot(library.db);
    // Stated on its own, because equality alone would hold just as well if
    // `snapshot` still said nothing about links.
    expect(live.some((line) => line.startsWith('link |'))).toBe(true);
    await rebuild(library.db, library.layout);
    expect(snapshot(library.db)).toEqual(live);
  });

  it('go with an id a file stops holding', async () => {
    // Editing a file's id in place is all it takes; the id it left has no file.
    const before = await treatmentAt('rain', ['book-harbour']);
    await ingestFile(library.db, library.layout, before.path);
    const after = await treatmentAt('rain', ['book-harbour'], 'another-id');
    await ingestFile(library.db, library.layout, after.path);

    expect(users('book-harbour')).toEqual(['another-id']);
  });
});

describe('a rebuild and the links of files that are gone', () => {
  it('forgets them', async () => {
    const { path } = await treatmentAt('rain', ['book-harbour']);
    await ingestFile(library.db, library.layout, path);
    expect(users('book-harbour')).toHaveLength(1);

    // Deleted while the server was down: nothing told the index.
    await rm(dirname(path), { recursive: true, force: true });
    await rebuild(library.db, library.layout);

    expect(users('book-harbour')).toEqual([]);
  });
});
