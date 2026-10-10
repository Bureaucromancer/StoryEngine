// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  newLoreEntry,
  newLorebook,
  type LoreEntry,
  type LoreFolder,
  type PlotHook,
} from '@storyengine/shared';
import { describe, expect, it } from 'vitest';

import {
  bookChanges,
  entryList,
  entryOf,
  moveEntryBefore,
  reapplyBookEdits,
  withEntry,
  withFolderGate,
  withNewEntry,
  withoutEntry,
  type Draft,
} from './book-form.js';

/**
 * The lorebook editor's edits, where they are pure — which is all of the part
 * that can eat somebody's work.
 *
 * **The three claims worth breaking a build over**, and each has a case below
 * that goes red on its own mutation: an edit to one entry leaves every other
 * entry *byte*-identical; a field this build has never heard of survives an
 * edit to the entry carrying it ([04 §2]); and the 412 merge resolves each of
 * the five three-way cases the way its docstring says, rather than the four
 * easy ones and a guess.
 */

function entry(name: string, over: Partial<LoreEntry> = {}): LoreEntry {
  return { ...newLoreEntry(name), ...over };
}

function folder(id: string, over: Partial<LoreFolder> = {}): LoreFolder {
  return { id, name: id, parentFolderId: null, enabled: true, order: 0, ...over };
}

function book(entries: LoreEntry[], folders: LoreFolder[] = []): Draft {
  return { ...newLorebook('Ardent'), entries, folders };
}

/** The entries of a draft, as JSON, for byte comparisons. */
function bytes(draft: Draft, id: string): string {
  return JSON.stringify(entryOf(draft, id));
}

describe('editing one entry', () => {
  it('leaves every other entry byte-identical', () => {
    const before = book([entry('Harbour'), entry('Bridge'), entry('Quay')]);
    const untouched = (before['entries'] as LoreEntry[]).map((each) => JSON.stringify(each));
    const target = (before['entries'] as LoreEntry[])[1]!.id;

    const after = withEntry(before, target, { content: 'Iron, and older than the town.' });
    const now = (after['entries'] as LoreEntry[]).map((each) => JSON.stringify(each));

    expect(now[0]).toBe(untouched[0]);
    expect(now[2]).toBe(untouched[2]);
    expect(now[1]).not.toBe(untouched[1]);
  });

  /**
   * [04 §2]'s promise, per object. An entry rebuilt from the fields this build
   * knows would strip whatever a newer one wrote into it — which is exactly
   * what a projected form type would have done here, and the reason the draft
   * is the book itself.
   */
  it('carries through a field this build has never heard of', () => {
    const odd = { ...entry('Harbour'), somethingNewerWrote: { depth: 3 } } as unknown as LoreEntry;
    const before = book([odd]);

    const after = withEntry(before, odd.id, { name: 'The harbour' });

    expect(entryOf(after, odd.id)).toMatchObject({
      name: 'The harbour',
      somethingNewerWrote: { depth: 3 },
    });
  });

  /**
   * **Ids are not unique in practice**, whatever [04 §5.2] intends: the
   * importers derive one as `stableId('entry', name, content)`, so two entries
   * agreeing on both collide. Editing the first degrades to *one of the two is
   * uneditable*; editing every match would change two entries from one form and
   * save both, which is the failure a read surface can survive and a write
   * surface cannot.
   */
  it('patches the first of two entries sharing an id, never both', () => {
    const twin = entry('Harbour');
    const before = book([twin, { ...entry('Harbour'), id: twin.id }]);

    const after = withEntry(before, twin.id, { content: 'Cranes.' });
    const entries = after['entries'] as LoreEntry[];

    expect(entries[0]?.content).toBe('Cranes.');
    expect(entries[1]?.content).toBe('');
  });

  it('changes nothing at all for an id the book does not hold', () => {
    const before = book([entry('Harbour')]);
    expect(JSON.stringify(withEntry(before, 'nobody', { name: 'x' }))).toBe(JSON.stringify(before));
  });
});

describe('creating and removing an entry', () => {
  it('appends, so a new entry is where the author was rather than sorted away', () => {
    const before = book([entry('Harbour'), entry('Bridge')]);

    const { book: after, id } = withNewEntry(before, 'Quay');
    const entries = after['entries'] as LoreEntry[];

    expect(entries.map((each) => each.name)).toEqual(['Harbour', 'Bridge', 'Quay']);
    expect(entries[2]?.id).toBe(id);
  });

  /**
   * Through the shared factory, which is the same object
   * [entry-defaults.ts](../library/entry-defaults.ts) measures against — so a
   * freshly made entry opens with its sections reporting nothing set rather
   * than announcing non-defaults it has not got.
   */
  it('makes it out of the factory rather than a literal', () => {
    const { book: after, id } = withNewEntry(book([]), 'Quay');
    const made = entryOf(after, id);

    expect(made?.matchWholeWords).toBe(true);
    expect(made?.scanDepth).toBeNull();
    expect(made?.order).toBe(100);
    expect(Object.hasOwn(made ?? {}, 'stateSchema')).toBe(false);
  });

  it('removes the one named and no other', () => {
    const keep = entry('Harbour');
    const drop = entry('Bridge');
    const after = withoutEntry(book([keep, drop]), drop.id);

    expect((after['entries'] as LoreEntry[]).map((each) => each.name)).toEqual(['Harbour']);
    expect(bytes(after, keep.id)).toBe(bytes(book([keep]), keep.id));
  });
  /**
   * *Twins* (2026-09-27): two entries sharing an id is a state importers can
   * produce, and *Remove this entry* took both — one entry on screen, two gone
   * from the file.
   */
  it('removes the first of two entries sharing an id, never both', () => {
    const first = entry('Harbour', { id: 'twin' });
    const second = entry('Harbour, again', { id: 'twin' });
    const after = withoutEntry(book([first, second]), 'twin');

    expect((after['entries'] as LoreEntry[]).map((each) => each.name)).toEqual(['Harbour, again']);
  });
});

describe('the folder gate', () => {
  /**
   * Gate step 2's other half, at the surface that can change the answer: the
   * schema says a shut folder leaves each entry's own `enabled` *preserved
   * rather than mutated*, and [10 §5.3] says turning a folder off must never
   * look like turning its entries off.
   */
  it('writes the folder’s flag and never an entry’s', () => {
    const inside = entry('Harbour', { folderId: 'places', enabled: true });
    const before = book([inside], [folder('places')]);

    const after = withFolderGate(before, 'places', false);

    expect((after['folders'] as LoreFolder[])[0]?.enabled).toBe(false);
    expect(entryOf(after, inside.id)?.enabled).toBe(true);
    expect(bytes(after, inside.id)).toBe(bytes(before, inside.id));
  });

  it('leaves a folder it does not name alone', () => {
    const before = book([], [folder('places'), folder('people')]);
    const after = withFolderGate(before, 'places', false);

    expect((after['folders'] as LoreFolder[])[1]?.enabled).toBe(true);
  });
});

describe('whether anything would be written', () => {
  /**
   * **The same comparison the server makes.** Its no-op rule is byte equality
   * of the serialised object, so a client that compared structurally would be
   * laxer than the thing it is predicting. The case that matters is an imported
   * book, which carries none of the optional fields: an editor that
   * materialised `stateSchema` or `extensionActivations` on load would report
   * every such book as changed the moment it opened.
   */
  it('says no for a book that was loaded and not touched', () => {
    const imported = book([entry('Harbour')]);
    delete (imported as Record<string, unknown>)['writingSamples'];

    expect(bookChanges(imported, structuredClone(imported))).toBe(false);
  });

  it('says yes for one field on one entry', () => {
    const target = entry('Harbour');
    const before = book([target]);

    expect(bookChanges(before, withEntry(before, target.id, { enabled: false }))).toBe(true);
  });
});

/**
 * The 412 merge, case by case — [09 §4.4].
 *
 * Written out as five separate cases rather than one round trip, because the
 * failure this function exists to prevent is *one* of them silently taking the
 * wrong side: a merge that got four right and resurrected every deletion would
 * pass any single end-to-end assertion.
 */
describe('reapplying my edits onto a newer book', () => {
  it('keeps my change and takes theirs on the same entry’s other fields', () => {
    const original = entry('Harbour');
    const pristine = book([original]);

    const mine = withEntry(pristine, original.id, { content: 'Cranes.' });
    const theirs = withEntry(pristine, original.id, { description: 'Where ships come in.' });

    const merged = reapplyBookEdits(pristine, mine, theirs);

    expect(entryOf(merged, original.id)?.content).toBe('Cranes.');
    expect(entryOf(merged, original.id)?.description).toBe('Where ships come in.');
  });

  it('takes their whole entry where I never touched it', () => {
    const untouched = entry('Bridge');
    const edited = entry('Harbour');
    const pristine = book([untouched, edited]);

    const mine = withEntry(pristine, edited.id, { content: 'Cranes.' });
    const theirs = withEntry(pristine, untouched.id, { content: 'Iron.' });

    const merged = reapplyBookEdits(pristine, mine, theirs);

    expect(entryOf(merged, untouched.id)?.content).toBe('Iron.');
    expect(entryOf(merged, edited.id)?.content).toBe('Cranes.');
  });

  /**
   * ***The book's own fields, which this merge dropped until [P7.14]*** — and
   * the loss it dropped was already live: the book's **name** has been writable
   * since this editor shipped, so *rename, lose the race, reload-and-reapply*
   * quietly restored their name over mine. The retrieval fieldset made it six
   * more fields and turned an invisible loss into an obvious one.
   */
  it('keeps a book-level field I changed and takes theirs where I did not', () => {
    const pristine = book([entry('Harbour')]);
    const mine = { ...pristine, name: 'Ardent Harbour', scanDepth: 7 };
    const theirs = { ...pristine, tokenBudget: 4096, scanDepth: 3 };

    const merged = reapplyBookEdits(pristine, mine, theirs);

    // Mine, because I changed them from what I opened.
    expect(merged['name']).toBe('Ardent Harbour');
    expect(merged['scanDepth']).toBe(7);
    // Theirs, because I never touched it — the same rule an entry's fields get.
    expect(merged['tokenBudget']).toBe(4096);
  });

  /**
   * ***The scope, since it has a control*** — [P16.2]. An ordinary book field:
   * mine when I changed it, theirs when I did not, and never a mixture of the
   * two — a scope is one statement, so their World list does not get spliced
   * into my characters.
   */
  it('merges the scope as one field: mine when I changed it, theirs when I did not', () => {
    const pristine = { ...book([entry('Harbour')]), scope: { kind: 'linked', actorIds: [] } };
    const toWorld = { kind: 'world', worldIds: ['w1'] };
    const toCharacters = { kind: 'linked', actorIds: ['a1'] };

    const mine = reapplyBookEdits(
      pristine,
      { ...pristine, scope: toWorld },
      {
        ...pristine,
        scope: toCharacters,
        name: 'Theirs',
      },
    );
    expect(mine['scope']).toEqual(toWorld);
    expect(mine['name']).toBe('Theirs');

    const theirs = reapplyBookEdits(
      pristine,
      { ...pristine, name: 'Mine' },
      {
        ...pristine,
        scope: { kind: 'campaign', campaignIds: ['c'] },
      },
    );
    // A kind this build does not know arriving from the other side is kept as
    // it came ([26 B16]), because I never touched the scope.
    expect(theirs['scope']).toEqual({ kind: 'campaign', campaignIds: ['c'] });
    expect(theirs['name']).toBe('Mine');
  });

  /**
   * *And the containers are still merged by the finer rules above*, which a
   * blanket three-way over the whole object would have flattened: this asserts
   * the book-level pass did not reach into them.
   */
  it('does not let the book-level merge touch the entries', () => {
    const original = entry('Harbour');
    const pristine = book([original]);
    const mine = withEntry({ ...pristine, name: 'Ardent Harbour' }, original.id, {
      content: 'Cranes.',
    });
    const theirs = withEntry(pristine, original.id, { description: 'Where ships come in.' });

    const merged = reapplyBookEdits(pristine, mine, theirs);

    expect(merged['name']).toBe('Ardent Harbour');
    expect(entryOf(merged, original.id)?.content).toBe('Cranes.');
    expect(entryOf(merged, original.id)?.description).toBe('Where ships come in.');
  });

  it('keeps an entry I created', () => {
    const pristine = book([entry('Harbour')]);
    const { book: mine, id } = withNewEntry(pristine, 'Quay');

    const merged = reapplyBookEdits(pristine, mine, pristine);

    expect(entryOf(merged, id)?.name).toBe('Quay');
  });

  /**
   * The case `pristine` exists for. *In theirs and not in mine* is either my
   * deletion or their addition, and the two want opposite outcomes — without a
   * third side to ask, a merge either resurrects every deletion or discards
   * every concurrent addition.
   */
  it('honours my deletion, and keeps an entry they added while I was editing', () => {
    const doomed = entry('Harbour');
    const pristine = book([doomed]);

    const mine = withoutEntry(pristine, doomed.id);
    const { book: theirs, id: added } = withNewEntry(pristine, 'Quay');

    const merged = reapplyBookEdits(pristine, mine, theirs);

    expect(entryOf(merged, doomed.id)).toBeUndefined();
    expect(entryOf(merged, added)?.name).toBe('Quay');
  });

  /**
   * The fifth case, and the asymmetric one: they deleted an entry I still hold.
   * Keeping an untouched copy would be undoing their delete; discarding an
   * edited one would throw away the work the 412 refused to write.
   */
  it('lets their deletion stand unless I had edited that entry', () => {
    const untouched = entry('Bridge');
    const edited = entry('Harbour');
    const pristine = book([untouched, edited]);

    const mine = withEntry(pristine, edited.id, { content: 'Cranes.' });
    const theirs = withoutEntry(withoutEntry(pristine, untouched.id), edited.id);

    const merged = reapplyBookEdits(pristine, mine, theirs);

    expect(entryOf(merged, untouched.id)).toBeUndefined();
    expect(entryOf(merged, edited.id)?.content).toBe('Cranes.');
  });

  it('follows their order, with anything of mine they have not got at the end', () => {
    const first = entry('Harbour');
    const second = entry('Bridge');
    const pristine = book([first, second]);

    const { book: mine, id: added } = withNewEntry(pristine, 'Quay');
    const theirs = book([second, first]);

    const merged = reapplyBookEdits(pristine, mine, theirs);

    expect((merged['entries'] as LoreEntry[]).map((each) => each.name)).toEqual([
      'Bridge',
      'Harbour',
      'Quay',
    ]);
    expect(entryOf(merged, added)).toBeDefined();
  });

  it('keeps my gate and takes theirs on a folder I never touched', () => {
    const pristine = book([], [folder('places'), folder('people')]);

    const mine = withFolderGate(pristine, 'places', false);
    const theirs = withFolderGate(pristine, 'people', false);

    const merged = reapplyBookEdits(pristine, mine, theirs);
    const folders = merged['folders'] as LoreFolder[];

    expect(folders[0]?.enabled).toBe(false);
    expect(folders[1]?.enabled).toBe(false);
  });

  /**
   * A folder carries a name and a parent this editor cannot change, so taking a
   * whole folder from my side would carry across a rename I never made.
   */
  it('takes their rename of a folder whose gate I moved', () => {
    const pristine = book([], [folder('places')]);
    const mine = withFolderGate(pristine, 'places', false);
    const theirs = { ...pristine, folders: [folder('places', { name: 'Locations' })] };

    const merged = reapplyBookEdits(pristine, mine, theirs);
    const only = (merged['folders'] as LoreFolder[])[0];

    expect(only?.name).toBe('Locations');
    expect(only?.enabled).toBe(false);
  });
});

describe('moving an entry', () => {
  /** Three entries, named so an order assertion reads as a sentence. */
  function threeEntries(): Draft {
    return {
      entries: [
        { ...newLoreEntry('Harbour'), id: 'a', order: 100 },
        { ...newLoreEntry('Bridge'), id: 'b', order: 200 },
        { ...newLoreEntry('Cathedral'), id: 'c', order: 300 },
      ],
      folders: [],
    };
  }

  const names = (book: Draft): string[] => entryList(book).map((entry) => entry.name);

  it('puts an entry in front of the one it was dropped on', () => {
    const moved = moveEntryBefore(threeEntries(), 'c', 'a');
    expect(names(moved)).toEqual(['Cathedral', 'Harbour', 'Bridge']);
  });

  it('puts it at the end when nothing follows', () => {
    const moved = moveEntryBefore(threeEntries(), 'a', null);
    expect(names(moved)).toEqual(['Bridge', 'Cathedral', 'Harbour']);
  });

  it('leaves `order` alone, because that is injection order and not this', () => {
    // [10 §5.3]: the list's order is the file's array order, and `order` is
    // where an activated entry lands in the prompt. Conflating them is *the
    // kind of small lie that teaches a false model of what the field means* —
    // so the falsifying mutation is a reorder that renumbers.
    const moved = moveEntryBefore(threeEntries(), 'c', 'a');
    expect(entryList(moved).map((entry) => entry.order)).toEqual([300, 100, 200]);
  });

  it('changes nothing else about any entry', () => {
    const book = threeEntries();
    const moved = moveEntryBefore(book, 'c', 'a');
    for (const entry of entryList(book)) {
      expect(JSON.stringify(entryOf(moved, entry.id))).toBe(JSON.stringify(entry));
    }
  });

  it('returns the same book when the move is not one', () => {
    // Identity, not equality: the editor's change test is a byte comparison, so
    // a drag that landed where it started must not light up Save.
    const book = threeEntries();
    expect(moveEntryBefore(book, 'a', 'a')).toBe(book);
    expect(moveEntryBefore(book, 'a', 'b')).toBe(book);
    expect(moveEntryBefore(book, 'c', null)).toBe(book);
  });

  /**
   * *Twins* (2026-09-27): the move took every entry with the id out and put one
   * back, so nudging one of two twins deleted the other.
   */
  it('moves one of two twins and keeps the other', () => {
    const twins: Draft = {
      entries: [
        { ...newLoreEntry('Harbour'), id: 'a' },
        { ...newLoreEntry('Bridge'), id: 'b' },
        { ...newLoreEntry('Cathedral'), id: 'c' },
        { ...newLoreEntry('Harbour, again'), id: 'a' },
      ],
      folders: [],
    };

    expect(names(moveEntryBefore(twins, 'a', 'c'))).toEqual([
      'Bridge',
      'Harbour',
      'Cathedral',
      'Harbour, again',
    ]);
  });

  it('refuses to move against a target that is not there', () => {
    // Appending would turn a caller's bug into a silent move to the end of a
    // two-hundred-entry book.
    const book = threeEntries();
    expect(moveEntryBefore(book, 'a', 'gone')).toBe(book);
    expect(moveEntryBefore(book, 'gone', 'a')).toBe(book);
  });
});

/**
 * ***Two entries sharing an id, and nothing lost to either*** —
 * [P13 §0.5](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * `withEntry` already acts on the first match, and its comment says why: ids
 * are not unique in practice. Removing and moving did not, and both run on save
 * — removing one twin removed every entry with its id, and dragging one filtered
 * both out and put back one. The twins here differ in content, which is what an
 * Aventuras book imported before `distinctIds` holds: two entries named alike, and
 * saying different things.
 */
describe('twins, removed and moved', () => {
  function twins(): { draft: Draft; id: string } {
    const first = { ...newLoreEntry('The Harbour'), content: 'The old quay.' };
    return {
      id: first.id,
      draft: {
        entries: [
          first,
          { ...newLoreEntry('Bridge'), id: 'b' },
          { ...newLoreEntry('The Harbour'), id: first.id, content: 'The new quay.' },
        ],
        folders: [],
      },
    };
  }
  const contents = (book: Draft): string[] => entryList(book).map((entry) => entry.content);

  it('removes the first, which is the one the form shows, and keeps the other', () => {
    const { draft, id } = twins();
    expect(entryOf(draft, id)?.content).toBe('The old quay.');
    expect(contents(withoutEntry(draft, id))).toEqual(['', 'The new quay.']);
  });

  it('moves one and keeps both', () => {
    const { draft, id } = twins();
    const moved = moveEntryBefore(draft, id, null);
    expect(contents(moved).sort()).toEqual(['', 'The new quay.', 'The old quay.']);
    expect(contents(moved).at(-1)).toBe('The old quay.');
  });

  it('still returns the same book for a move that changes nothing', () => {
    const { draft, id } = twins();
    expect(moveEntryBefore(draft, id, 'b')).toBe(draft);
  });
});

describe('the merge, when I reordered', () => {
  function book(ids: string[]): Draft {
    return {
      entries: ids.map((id) => ({ ...newLoreEntry(id.toUpperCase()), id })),
      folders: [],
    };
  }

  const ids = (merged: Draft): string[] => entryList(merged).map((entry) => entry.id);

  it('keeps my arrangement rather than taking theirs', () => {
    // The loss this rule exists to stop: rearrange a book, lose the race, and
    // reload-and-reapply hands the arrangement back to them without a word.
    const pristine = book(['a', 'b', 'c']);
    const mine = moveEntryBefore(pristine, 'c', 'a');
    const theirs = book(['a', 'b', 'c']);

    expect(ids(reapplyBookEdits(pristine, mine, theirs))).toEqual(['c', 'a', 'b']);
  });

  it('takes their order when I did not move anything', () => {
    // The ordinary case, unchanged: a concurrent insertion is not shuffled to
    // the end of somebody else's book.
    const pristine = book(['a', 'b']);
    const mine = withEntry(pristine, 'a', { content: 'Cranes.' });
    const theirs = book(['b', 'a']);

    expect(ids(reapplyBookEdits(pristine, mine, theirs))).toEqual(['b', 'a']);
    expect(entryOf(reapplyBookEdits(pristine, mine, theirs), 'a')?.content).toBe('Cranes.');
  });

  it('puts an entry only they have at the end of my arrangement', () => {
    // The mirror of the loss the ordinary case takes, and the cheaper one in
    // this direction: one entry's position against a whole arrangement.
    const pristine = book(['a', 'b']);
    const mine = moveEntryBefore(pristine, 'b', 'a');
    const theirs = book(['a', 'new', 'b']);

    expect(ids(reapplyBookEdits(pristine, mine, theirs))).toEqual(['b', 'a', 'new']);
  });

  it('does not read an addition or a deletion of mine as a reorder', () => {
    // Restricted to the ids we both hold: otherwise every ordinary edit claims
    // a position the merge then has to honour.
    const pristine = book(['a', 'b']);
    const mine = withoutEntry(pristine, 'a');
    const theirs = book(['b', 'a']);

    // Their order stands for what is left, because I moved nothing.
    expect(ids(reapplyBookEdits(pristine, mine, theirs))).toEqual(['b']);
  });
});

/**
 * ***The hooks a lorebook carries, through the same 412*** — [03 §4.1],
 * [P11.2].
 *
 * **This is the half that was left coarse when the fold was built.** Until this
 * page could author `hooks`, the field was one more top-level value and the
 * field rule was the honest unit for it: nothing here wrote one, so there was no
 * edit of mine to lose. The fold changed that and the merge did not, so a save
 * conflict took one side's **whole hook list** — mine if I had touched any hook,
 * theirs if I had not — and dropped the other's without a word, inside the
 * dialog whose entire offer is *reapply my edits*. It is the same loss the
 * treatment and setup editors were given a hook-by-hook merge to avoid, on the
 * one carrier that had not been given one.
 *
 * *And the absence rule survives the merge*, which is the second claim: a
 * conflict must not be what leaves `"hooks": []` on a book that had no hooks,
 * because 03 §4.1 makes hooks-on-lorebooks secondary and an empty list is a
 * claim about narrative intent its author did not make.
 */
describe('reapplying my edits onto a newer book, for its hooks', () => {
  function hook(id: string, title = id): PlotHook {
    return {
      id,
      title,
      premise: '',
      magnitude: 'local',
      involves: [],
      weight: 1,
      delivery: 'guidance',
      once: true,
    };
  }

  const withHooks = (draft: Draft, hooks: PlotHook[]): Draft => ({ ...draft, hooks });
  const hookIds = (merged: Draft): string[] =>
    ((merged['hooks'] ?? []) as PlotHook[]).map((one) => one.id);

  /** The failure this exists to stop, in the direction that loses theirs. */
  it('keeps a hook they added while I was editing one of mine', () => {
    const a = hook('a');
    const pristine = withHooks(book([]), [a]);
    const mine = withHooks(pristine, [{ ...a, premise: 'The duke dies.' }]);
    const theirs = withHooks(pristine, [a, hook('x')]);

    const merged = reapplyBookEdits(pristine, mine, theirs);

    expect(hookIds(merged)).toEqual(['a', 'x']);
    expect((merged['hooks'] as PlotHook[])[0]?.premise).toBe('The duke dies.');
  });

  /** And in the direction that loses mine, which the old rule also did. */
  it('keeps a hook I added while they were editing one of theirs', () => {
    const a = hook('a');
    const pristine = withHooks(book([]), [a]);
    const mine = withHooks(pristine, [a, hook('mine')]);
    const theirs = withHooks(pristine, [{ ...a, premise: 'The duke is exiled.' }]);

    const merged = reapplyBookEdits(pristine, mine, theirs);

    expect(hookIds(merged)).toEqual(['a', 'mine']);
    expect((merged['hooks'] as PlotHook[])[0]?.premise).toBe('The duke is exiled.');
  });

  /** A delete of mine is a delete, not an entry to resurrect from their copy. */
  it('does not bring back a hook I removed', () => {
    const a = hook('a');
    const b = hook('b');
    const pristine = withHooks(book([]), [a, b]);
    const mine = withHooks(pristine, [a]);
    const theirs = withHooks(pristine, [a, b]);

    expect(hookIds(reapplyBookEdits(pristine, mine, theirs))).toEqual(['a']);
  });

  /**
   * The absence rule, through the merge: neither of us has hooks, so the book
   * must not come out of a conflict carrying an empty list.
   */
  it('leaves a book with no hooks without the key', () => {
    const pristine = book([entry('Harbour')]);
    const mine = withEntry(pristine, entryList(pristine)[0]!.id, { content: 'Cranes.' });
    const theirs = book([entry('Harbour')]);

    expect(Object.hasOwn(reapplyBookEdits(pristine, mine, theirs), 'hooks')).toBe(false);
  });

  /** And when I emptied the fold, the key goes rather than becoming `[]`. */
  it('takes the key off when I removed the last hook', () => {
    const a = hook('a');
    const pristine = withHooks(book([]), [a]);
    const mine = book([]);
    const theirs = withHooks(pristine, [a]);

    expect(Object.hasOwn(reapplyBookEdits(pristine, mine, theirs), 'hooks')).toBe(false);
  });
});
