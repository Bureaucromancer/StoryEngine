// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  newLorebook,
  newLoreEntry,
  newTreatment,
  newActor,
  type Lorebook,
} from '@storyengine/shared';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { create, read, remove, type LibraryContext } from '../library.js';
import { Layout } from '../storage/layout.js';
import { resolveLore } from './lore.js';

/**
 * What a session's world resolves to — [P5.6], [P5 §1.10].
 *
 * The half of these tests that matters is the half about **failing to
 * resolve**: a session whose books have been deleted, renamed, hand-edited into
 * invalidity, or listed twice. Every one of those produces a shorter prompt and
 * raises nothing, so the only way they are ever observed is if this function
 * says so out loud and something asserts on it.
 */

let dataDir: string;
let index: OpenedIndex;
let library: LibraryContext;

const ACCOUNT = 'ned';

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-lore-'));
  index = await openIndex({ path: ':memory:' });
  library = { db: index.db, layout: new Layout(dataDir), keepHistoryPerObject: 0 };
});

afterEach(async () => {
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function book(name: string, entryNames: string[] = []): Promise<string> {
  const made = newLorebook(name);
  made.entries = entryNames.map((entry) => newLoreEntry(entry));
  await create(library, ACCOUNT, made);
  return made.id;
}

/**
 * A treatment whose links are written as `Ref`s. Each half is given separately
 * so a test can build the three cases that matter: an id that resolves, a name
 * that has to, and an id that misses with a name that saves it.
 */
async function treatment(
  name: string,
  links: { id?: string; name?: string; required?: boolean }[] = [],
): Promise<string> {
  const made = newTreatment(name);
  made.lore = links.map((link) => ({
    ref: { id: link.id ?? '', name: link.name ?? '' },
    required: link.required ?? false,
  }));
  await create(library, ACCOUNT, made);
  return made.id;
}

describe('resolveLore', () => {
  it('reads the treatment and the books it links, in that order', async () => {
    const rain = await book('Rain City');
    const docks = await book('The Docks');
    const noir = await treatment('Rain City Noir', [{ id: rain }, { id: docks }]);

    const resolved = resolveLore(library, ACCOUNT, { treatment: noir, lore: [] });

    expect(resolved.treatment?.id).toBe(noir);
    expect(resolved.books.map((source) => source.book.name)).toEqual(['Rain City', 'The Docks']);
    expect(resolved.missing).toEqual([]);
  });

  it("carries the treatment's link strength through to each book", async () => {
    const world = await book('The World');
    const extra = await book('An Extra');
    const noir = await treatment('Noir', [
      { id: world, required: true },
      { id: extra, required: false },
    ]);

    const resolved = resolveLore(library, ACCOUNT, { treatment: noir });

    expect(resolved.books.map((source) => source.required)).toEqual([true, false]);
  });

  it("appends the session's own books after the treatment's", async () => {
    const linked = await book('Linked');
    const own = await book('Own');
    const noir = await treatment('Noir', [{ id: linked }]);

    const resolved = resolveLore(library, ACCOUNT, { treatment: noir, lore: [own] });

    expect(resolved.books.map((source) => source.book.name)).toEqual(['Linked', 'Own']);
    // A session's own extras carry no strength — see `LoreSource.required`.
    expect(resolved.books.at(-1)?.required).toBe(false);
  });

  it('resolves a session that links books and no treatment at all', async () => {
    const own = await book('Own');

    const resolved = resolveLore(library, ACCOUNT, { lore: [own] });

    expect(resolved.treatment).toBeNull();
    expect(resolved.books).toHaveLength(1);
    expect(resolved.missing).toEqual([]);
  });

  it('reads a pre-P5.6 session as no treatment and no books', () => {
    const resolved = resolveLore(library, ACCOUNT, { channels: {} } as never);

    expect(resolved).toEqual({ treatment: null, books: [], missing: [] });
  });

  /**
   * A book named twice is one book. Scanning it twice would double every entry
   * it activates and hand the budgeter two copies of each to trim — a bug whose
   * only symptom is a prompt that is quietly the wrong size.
   */
  it('scans a book named by both the treatment and the session exactly once', async () => {
    const shared = await book('Shared');
    const noir = await treatment('Noir', [{ id: shared }]);

    const resolved = resolveLore(library, ACCOUNT, { treatment: noir, lore: [shared] });

    expect(resolved.books).toHaveLength(1);
  });

  it('scans a book the treatment links twice exactly once', async () => {
    const shared = await book('Shared');
    const noir = await treatment('Noir', [{ id: shared }, { id: shared }]);

    const resolved = resolveLore(library, ACCOUNT, { treatment: noir });

    expect(resolved.books).toHaveLength(1);
  });

  /**
   * The first mention wins, which is what makes the strength survive
   * deduplication: a required book the session happens to re-list must not be
   * demoted to an optional one by the copy that arrived second.
   */
  it('keeps the strength of the first mention when a book is named twice', async () => {
    const shared = await book('Shared');
    const noir = await treatment('Noir', [{ id: shared, required: true }]);

    const resolved = resolveLore(library, ACCOUNT, { treatment: noir, lore: [shared] });

    expect(resolved.books[0]?.required).toBe(true);
  });

  /**
   * *Exact id, then case-insensitive name, then show as missing and continue* —
   * the sentence `schema/common.ts`, [03 §11.4] and [04 §8] all state and which
   * nothing implemented until this stage, because nothing on the server had
   * ever followed a `Ref`.
   *
   * **This is the case that decides whether an imported treatment works at
   * all.** Its links carry ids minted by whatever produced the file, and the
   * books it names came in as separate objects with ids of ours — so every id
   * misses, and without the name arm the whole book list resolves to nothing
   * with no error anywhere.
   */
  describe('resolving a link by name', () => {
    it('falls back to the name when the id names nothing', async () => {
      await book('Rain City');
      const noir = await treatment('Noir', [
        { id: 'an-id-from-somewhere-else', name: 'Rain City' },
      ]);

      const resolved = resolveLore(library, ACCOUNT, { treatment: noir });

      expect(resolved.books.map((source) => source.book.name)).toEqual(['Rain City']);
      expect(resolved.missing).toEqual([]);
    });

    it('matches the name without regard to case', async () => {
      await book('Rain City');
      const noir = await treatment('Noir', [
        { id: 'an-id-from-somewhere-else', name: 'RAIN city' },
      ]);

      expect(resolveLore(library, ACCOUNT, { treatment: noir }).books).toHaveLength(1);
    });

    /**
     * Folded in JavaScript rather than by SQLite's `lower()`, which is ASCII
     * only — see `findByName`. An accented title is exactly the data the
     * fallback exists to rescue, so it would be the wrong thing to get wrong.
     *
     * **The letters that differ in case here are the non-ASCII ones**, which
     * this test did not manage on the first attempt: it was written as *Régine
     * Le Fanu* against *régine le fanu*, where every letter whose case actually
     * changes is `R`, `L`, `F`, and the `é` is already lower in both. SQLite's
     * `lower()` handles that perfectly well, so a mutation swapping the fold
     * into SQL survived — the test named a property it was not exercising.
     */
    it('matches a name whose case difference is not ASCII', async () => {
      await book('ÉLODIE ÅSTRÖM');
      const noir = await treatment('Noir', [
        { id: 'an-id-from-somewhere-else', name: 'élodie åström' },
      ]);

      expect(resolveLore(library, ACCOUNT, { treatment: noir }).books).toHaveLength(1);
    });

    /**
     * An unlinked object is gone, and a name is the one way it could come back:
     * ids are unique, but the *name* of a deleted book is still sitting in the
     * treatment that linked it, and a tombstoned row still holds that name.
     * Resurrecting it would put a world somebody deleted back in their prompt.
     */
    it('does not resolve a name to a book that has been unlinked', async () => {
      const rain = await book('Rain City');
      const noir = await treatment('Noir', [{ id: rain, name: 'Rain City' }]);
      await remove(library, ACCOUNT, rain, read(library, ACCOUNT, rain).contentHash);

      const resolved = resolveLore(library, ACCOUNT, { treatment: noir });

      expect(resolved.books).toEqual([]);
      expect(resolved.missing).toEqual([
        { id: rain, name: 'Rain City', kind: 'lorebook', required: false },
      ]);
    });

    /**
     * The sharp edge of the tombstone rule, and the only case where filtering
     * them out of `findByName` changes an answer rather than saving a lookup.
     *
     * Two books of one name, the second deleted: the dead row keeps its name,
     * and it is the row that sorts first — `rain-city-2` orders ahead of
     * `rain-city` because `-` precedes the path separator. A search that let it
     * match would find it, fail to read it — `findByPath` refuses tombstones
     * too — and report the surviving book as missing, which is the worst of the
     * three possible answers, because the book is right there.
     *
     * The sort order is the load-bearing part and it is the opposite of what it
     * looks like, so it was measured rather than assumed: written the other way
     * round, deleting the *first* book, a mutation removing the tombstone
     * filter survives, because the live row sorts ahead of the dead one and is
     * found before the filter would have mattered.
     */
    it('skips a tombstoned row to reach the live book of the same name', async () => {
      const first = await book('Rain City');
      const second = await book('Rain City');
      await remove(library, ACCOUNT, second, read(library, ACCOUNT, second).contentHash);
      const noir = await treatment('Noir', [
        { id: 'an-id-from-somewhere-else', name: 'Rain City' },
      ]);

      const resolved = resolveLore(library, ACCOUNT, { treatment: noir });

      expect(resolved.books.map((source) => source.id)).toEqual([first]);
    });

    it('prefers the id when both halves resolve to different books', async () => {
      const rain = await book('Rain City');
      await book('The Docks');
      const noir = await treatment('Noir', [{ id: rain, name: 'The Docks' }]);

      expect(resolveLore(library, ACCOUNT, { treatment: noir }).books[0]?.id).toBe(rain);
    });

    it('will not cross accounts on a name any more than on an id', async () => {
      const theirs = newLorebook('Rain City');
      await create(library, 'someone-else', theirs);
      const noir = await treatment('Noir', [
        { id: 'an-id-from-somewhere-else', name: 'Rain City' },
      ]);

      const resolved = resolveLore(library, ACCOUNT, { treatment: noir });

      expect(resolved.books).toEqual([]);
      expect(resolved.missing).toEqual([
        { id: 'an-id-from-somewhere-else', name: 'Rain City', kind: 'lorebook', required: false },
      ]);
    });

    it('will not resolve a name to an object of another kind', async () => {
      await create(library, ACCOUNT, newActor('Rain City'));
      const noir = await treatment('Noir', [
        { id: 'an-id-from-somewhere-else', name: 'Rain City' },
      ]);

      expect(resolveLore(library, ACCOUNT, { treatment: noir }).books).toEqual([]);
    });

    /**
     * The dedup key is the resolved object, not the text of the link — an
     * imported treatment linking by name plus a hand-added extra linking by id
     * is how one book arrives wearing two different labels.
     */
    it('treats a link by id and a link by name as one book', async () => {
      const rain = await book('Rain City');
      const noir = await treatment('Noir', [
        { id: 'an-id-from-somewhere-else', name: 'Rain City' },
      ]);

      const resolved = resolveLore(library, ACCOUNT, { treatment: noir, lore: [rain] });

      expect(resolved.books).toHaveLength(1);
    });

    /**
     * **`Ref.id` carries `minLength: 1`**, which the first draft of this suite
     * discovered by trying to write a name-only link and being refused. So a
     * *schema-valid* treatment always has an id on every ref, and the real
     * shape of the name arm is the one every test above uses: an id that is
     * present and means nothing here. A link with neither half only arrives by
     * hand edit — reachable through the session's own list, which is a bare
     * array of ids with no validator between it and the file.
     */
    it('drops a link with nothing in it rather than reporting it', () => {
      const resolved = resolveLore(library, ACCOUNT, { lore: [''] });

      expect(resolved.books).toEqual([]);
      expect(resolved.missing).toEqual([]);
    });
  });

  /**
   * **The index is derived and long-lived, and that is the whole case.**
   *
   * A hand-edited invalid file never reaches the retriever: `ingestFile`
   * validates and skips, so it surfaces as a file error (F20) instead of
   * becoming a row. What does reach it is a row **an older build wrote** — the
   * schema tightens, the file has not been touched since, and the cached body
   * was valid when it was indexed and is not now.
   *
   * Reached here by writing the row the way that build would have, which is
   * also the only honest way to test it: the current write path cannot produce
   * this state, which is exactly why a mutation deleting the check survived
   * until this test existed.
   */
  it('refuses a book whose indexed body no longer validates', async () => {
    const rain = await book('Rain City');
    index.db
      .prepare('update object set body = ? where id = ?')
      .run(JSON.stringify({ schema: 'storyengine.lorebook/1', id: rain }), rain);

    const resolved = resolveLore(library, ACCOUNT, { lore: [rain] });

    expect(resolved.books).toEqual([]);
    expect(resolved.missing).toEqual([{ id: rain, name: '', kind: 'lorebook', required: false }]);
  });

  describe('what it could not read', () => {
    it('reports a book that does not exist and keeps the ones that do', async () => {
      const real = await book('Real');

      const resolved = resolveLore(library, ACCOUNT, { lore: [real, 'no-such-book'] });

      expect(resolved.books.map((source) => source.book.name)).toEqual(['Real']);
      expect(resolved.missing).toEqual([
        { id: 'no-such-book', name: '', kind: 'lorebook', required: false },
      ]);
    });

    it('reports a missing book the treatment called required as required', async () => {
      const noir = await treatment('Noir', [{ id: 'gone', required: true }]);

      const resolved = resolveLore(library, ACCOUNT, { treatment: noir });

      expect(resolved.missing).toEqual([
        { id: 'gone', name: '', kind: 'lorebook', required: true },
      ]);
    });

    it('reports a treatment that does not exist, and reports it as required', () => {
      const resolved = resolveLore(library, ACCOUNT, { treatment: 'gone' });

      expect(resolved.treatment).toBeNull();
      expect(resolved.missing).toEqual([
        { id: 'gone', name: '', kind: 'treatment', required: true },
      ]);
    });

    /**
     * The ownership rule reaching the retriever ([09 §4.3]): another account's
     * book is *not found*, never *forbidden*, because confirming that an id
     * exists elsewhere leaks the one fact separation exists to keep.
     */
    it("reports another account's book as missing rather than reading it", async () => {
      const theirs = newLorebook('Theirs');
      await create(library, 'someone-else', theirs);

      const resolved = resolveLore(library, ACCOUNT, { lore: [theirs.id] });

      expect(resolved.books).toEqual([]);
      expect(resolved.missing).toEqual([
        { id: theirs.id, name: '', kind: 'lorebook', required: false },
      ]);
    });

    /**
     * An id naming the wrong kind. `read` is given the schema it expects, so an
     * actor linked as a lorebook is missing rather than a book with no entries
     * — which is the difference between the retriever saying nothing and the
     * retriever crashing on `book.entries`.
     */
    it('reports a link that names an object of another kind as missing', async () => {
      const vera = newActor('Vera');
      await create(library, ACCOUNT, vera);

      const resolved = resolveLore(library, ACCOUNT, { lore: [vera.id] });

      expect(resolved.books).toEqual([]);
      expect(resolved.missing).toEqual([
        { id: vera.id, name: '', kind: 'lorebook', required: false },
      ]);
    });
  });

  /**
   * Everything below arrives by hand-editing `session.json`, which [03 §5] makes
   * a supported way to get data in. The never-throws claim in this module's
   * docstring is only true if each of these is guarded, and each of them was a
   * `TypeError` in a turn before the guard existed.
   */
  describe('given a file somebody edited by hand', () => {
    it('survives a lore field that is not an array', () => {
      const resolved = resolveLore(library, ACCOUNT, { lore: 'rain-city' });

      expect(resolved.books).toEqual([]);
      expect(resolved.missing).toEqual([]);
    });

    it('survives a treatment field that is not a string', () => {
      const resolved = resolveLore(library, ACCOUNT, { treatment: 7 });

      expect(resolved.treatment).toBeNull();
      // Not reported: nothing was named, so there is nothing to say was missing.
      expect(resolved.missing).toEqual([]);
    });

    it('survives a null session', () => {
      expect(resolveLore(library, ACCOUNT, null)).toEqual({
        treatment: null,
        books: [],
        missing: [],
      });
    });

    it('drops non-string entries in the lore array and keeps the rest', async () => {
      const real = await book('Real');

      const resolved = resolveLore(library, ACCOUNT, {
        lore: [null, real, 42, { id: real }] as never,
      });

      expect(resolved.books.map((source) => source.book.name)).toEqual(['Real']);
    });
  });

  /**
   * The address of the bytes that were read — [P3.0]. A link names whatever the
   * object is *now*, so the hash is what lets a block's source resolve to the
   * book as it was **used** rather than as it is by the time somebody looks.
   */
  it('carries the content hash of each object it read', async () => {
    const rain = await book('Rain City', ['The Ferryman']);
    const noir = await treatment('Noir', [{ id: rain }]);

    const resolved = resolveLore(library, ACCOUNT, { treatment: noir });

    expect(resolved.treatment?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(resolved.books[0]?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(resolved.books[0]?.book.entries).toHaveLength(1);
  });
});

/**
/**
 * **No lorebook is active that has not been selected for the session.**
 *
 * [P5.7] admitted books by their own `LoreScope` — `global` everywhere,
 * `linked` wherever one of its actors was cast — reading [03 §3.4]'s union as a
 * discovery mechanism. The consequence made the mistake plain: `global` is the
 * factory default *and* the SillyTavern importer's fallback, so every book a
 * person had ever created or imported was in every session's prompt, and the
 * only way out was hand-editing JSON.
 *
 * These tests hold the rule that replaced it. They are written against `global`
 * specifically because that is the default: a book built by the ordinary
 * factory and left alone is the case that used to leak.
 */
describe('selection is the only way into a session', () => {
  async function scoped(name: string, scope: Lorebook['scope']): Promise<string> {
    const made = { ...newLorebook(name), scope };
    await create(library, ACCOUNT, made);
    return made.id;
  }

  it('leaves a global book out of a session that did not select it', async () => {
    await scoped('Everywhere', { kind: 'global' });

    expect(resolveLore(library, ACCOUNT, {}).books).toEqual([]);
  });

  it('leaves a book scoped to an actor out of a session that did not select it', async () => {
    await scoped('Vera\u2019s', { kind: 'linked', actorIds: ['vera'] });

    expect(resolveLore(library, ACCOUNT, {}).books).toEqual([]);
  });

  /** The whole library, and none of it, because nothing named any of it. */
  it('reads a session with no links as having no world at all', async () => {
    await scoped('One', { kind: 'global' });
    await scoped('Two', { kind: 'global' });
    await scoped('Three', { kind: 'linked', actorIds: [] });

    expect(resolveLore(library, ACCOUNT, { lore: [] }).books).toEqual([]);
  });

  it('takes a global book once the session selects it, by that route', async () => {
    const everywhere = await scoped('Everywhere', { kind: 'global' });

    const resolved = resolveLore(library, ACCOUNT, { lore: [everywhere] });

    expect(resolved.books.map((source) => source.by)).toEqual(['session']);
  });

  it('takes a global book the treatment selects, by that route', async () => {
    const everywhere = await scoped('Everywhere', { kind: 'global' });
    const noir = await treatment('Noir', [{ id: everywhere }]);

    const resolved = resolveLore(library, ACCOUNT, { treatment: noir });

    expect(resolved.books.map((source) => source.by)).toEqual(['treatment']);
  });

  /**
   * A book's own `scope` decides nothing at all now — not admission, and not
   * exclusion either. Selecting a book scoped to a cast that is not in the
   * scene still uses it, because the person who linked it said to.
   */
  it('uses a selected book whatever its own scope says', async () => {
    const theirs = await scoped('Somebody Else\u2019s', {
      kind: 'linked',
      actorIds: ['an-actor-who-is-not-here'],
    });

    expect(resolveLore(library, ACCOUNT, { lore: [theirs] }).books).toHaveLength(1);
  });
});
