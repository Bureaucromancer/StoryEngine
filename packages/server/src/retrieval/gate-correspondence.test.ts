// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  entryGate,
  newLorebook,
  newLoreEntry,
  type Lorebook,
  type LoreEntry,
  type LoreFolder,
} from '@storyengine/shared';

import { Rng } from '../rng/rng.js';
import { seededSource } from '../rng/source.js';
import { activate, type SkipReason } from './activate.js';

/**
 * **The reason rendered is the reason acted on** — [P5.7], and the one test
 * [P5 §5] names as uncuttable.
 *
 * The whole argument for building the document half first ([P5.0]) was that the
 * reading surface and the retriever would agree about why an entry is off. That
 * is a claim about two things staying equal, and *nothing but a test keeps two
 * implementations honest* — so P5.7 went further and made them one
 * implementation: `activate` calls the same `entryGate` the fold and the editor
 * call. This file is what makes that structural fact **observable**, because a
 * future edit re-inlining `!entry.enabled` into the scan would compile, pass
 * every example test, and silently reintroduce the divergence.
 *
 * ## Why a property rather than examples
 *
 * The three ways the naive check goes wrong are all shape problems, not value
 * problems: folders **nest**, so a gate can be inherited from an ancestor
 * several levels up; the chain is **not guaranteed acyclic**, because these
 * files are hand-edited and imported; and a `folderId` can name a folder the
 * book does not contain. An example test proves the case it was written for.
 * A generator that builds cycles, orphans and deep chains proves the ones
 * nobody thought of — which is the entire population of bugs this class has.
 *
 * ## What is deliberately *not* asserted
 *
 * That an entry `entryGate` calls active **fires**. [P5 §1.6] draws the line:
 * the document half renders *configuration* and only the retriever renders
 * *behaviour*, so `active` means *nothing switched off is in the way*, never
 * *this will appear*. Firing additionally needs keys, timing, a budget and a
 * turn. The equivalence runs one way — closed gate implies not activated — and
 * the other direction is asserted only against the **reason**, which is the
 * half that would drift.
 */

/** Ids from a small pool, so cycles and orphans actually get generated. */
const FOLDER_IDS = ['f1', 'f2', 'f3', 'f4'];

const folder = (id: string): fc.Arbitrary<LoreFolder> =>
  fc.record({
    id: fc.constant(id),
    name: fc.constant(`Folder ${id}`),
    // Any folder may parent any other, including itself: a cycle is a file
    // somebody can write, and [00 §3.3] says it degrades rather than throws.
    parentFolderId: fc.constantFrom(null, ...FOLDER_IDS),
    enabled: fc.boolean(),
    order: fc.constant(0),
  });

const entryShape = fc.record({
  // Drawn from a pool one wider than the folders that exist, so a dangling
  // `folderId` — an entry filed in a folder the book does not contain — is
  // generated rather than only imagined.
  folderId: fc.constantFrom(null, ...FOLDER_IDS, 'gone'),
  enabled: fc.boolean(),
  constant: fc.boolean(),
});

/**
 * **Ids are assigned by position, not drawn.**
 *
 * The first version of this drew each entry's index and two entries came out
 * sharing an id — which every lookup below then conflated, and the property
 * failed against a book that was fine. A generator that can produce two objects
 * with one identity is testing the test rather than the code, and it took two
 * confusing counterexamples to notice.
 */
const book: fc.Arbitrary<Lorebook> = fc
  .record({
    enabled: fc.boolean(),
    folders: fc.tuple(...FOLDER_IDS.map((id) => folder(id))),
    entries: fc.array(entryShape, { minLength: 1, maxLength: 6 }),
  })
  .map((over) => ({
    ...newLorebook('Rain City'),
    ...over,
    entries: over.entries.map((one, at): LoreEntry => ({
      ...newLoreEntry(`Entry ${String(at)}`),
      ...one,
      id: `e${String(at)}`,
      keys: ['ferryman'],
      content: `The content of entry ${String(at)}.`,
    })),
  }));

/** The reasons that mean *a switch is off*, as opposed to *nothing matched*. */
const GATE_REASONS: SkipReason[] = ['book-disabled', 'folder-disabled', 'entry-disabled'];

function scan(subject: Lorebook): ReturnType<typeof activate> {
  return activate({
    books: [
      { book: subject, id: 'book-1', contentHash: 'sha256:0', required: false, by: 'session' },
    ],
    // Names every entry's key, so nothing is held back for want of a match and
    // the only thing that can stop an entry is a gate or a filter.
    input: { messages: ['the ferryman'] },
    messagesSoFar: 100,
    timing: {},
    filters: { actorIds: [], actorTags: [], generationTrigger: 'story' },
    rng: new Rng({ source: seededSource(0x9e3779b9) }),
  });
}

describe('the gate the surface renders is the gate the engine acts on', () => {
  it('never activates an entry the reading surface calls inactive', () => {
    fc.assert(
      fc.property(book, (subject) => {
        const result = scan(subject);
        const activated = new Set(result.activated.map((one) => one.entry.id));

        for (const one of subject.entries) {
          if (!entryGate(subject, one).active) {
            expect(activated.has(one.id), `${one.name} fired through a closed gate`).toBe(false);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  /**
   * The half that would drift. Both sides answer *which switch*, and if the
   * scan ever computes its own the two will disagree first about a nested
   * folder and only much later about anything a person would notice.
   */
  it('gives the same reason the reading surface gives, for the same entry', () => {
    fc.assert(
      fc.property(book, (subject) => {
        const result = scan(subject);
        const skipped = new Map(result.skipped.map((one) => [one.entry.id, one]));

        for (const one of subject.entries) {
          const gate = entryGate(subject, one);
          const outermost = gate.blockedBy[0];
          if (outermost === undefined) continue;

          const row = skipped.get(one.id);
          expect(row, `${one.name} is gated and the scan reported nothing`).toBeDefined();

          const expected =
            outermost.kind === 'book-off'
              ? 'book-disabled'
              : outermost.kind === 'folder-off'
                ? 'folder-disabled'
                : 'entry-disabled';
          expect(row?.reason, `${one.name}: the two halves disagree about which switch`).toBe(
            expected,
          );

          // And the folder named is the one the surface names — the outermost
          // shut one, which is the only one worth sending anybody to.
          if (outermost.kind === 'folder-off') {
            expect(row?.folder).toEqual({ id: outermost.folderId, name: outermost.folderName });
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  /**
   * The converse, bounded as §1.6 requires: an entry with **no** closed gate
   * must not be refused *for a gate reason*. It may still be refused — by a
   * filter, by timing, by a budget — and that is the line between rendering
   * configuration and rendering behaviour.
   */
  it('never blames a gate for an entry whose gates are all open', () => {
    fc.assert(
      fc.property(book, (subject) => {
        const result = scan(subject);

        for (const one of result.skipped) {
          if (!GATE_REASONS.includes(one.reason)) continue;
          expect(
            entryGate(subject, one.entry).active,
            `${one.entry.name} was refused as ${one.reason} with every gate open`,
          ).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  /**
   * Three shapes the naive check gets wrong, pinned as examples beside the
   * property — because a property that stops generating them (a narrowed
   * arbitrary, a smaller pool) goes quiet rather than red, and these say in one
   * line each what the generator is for.
   */
  describe('the shapes a folders.find would miss', () => {
    function bookWith(folders: LoreFolder[], folderId: string | null): Lorebook {
      return {
        ...newLorebook('Rain City'),
        folders,
        entries: [{ ...newLoreEntry('One'), id: 'e0', folderId, keys: ['ferryman'] }],
      };
    }

    const open = (id: string, parent: string | null): LoreFolder => ({
      id,
      name: `Folder ${id}`,
      parentFolderId: parent,
      enabled: true,
      order: 0,
    });

    it('inherits a gate from a grandparent', () => {
      const subject = bookWith(
        [{ ...open('f1', null), enabled: false }, open('f2', 'f1'), open('f3', 'f2')],
        'f3',
      );

      const row = scan(subject).skipped[0];
      expect(row?.reason).toBe('folder-disabled');
      expect(row?.folder?.id).toBe('f1');
    });

    it('survives a cycle in the folder chain', () => {
      const subject = bookWith([open('f1', 'f2'), open('f2', 'f1')], 'f1');

      expect(scan(subject).activated).toHaveLength(1);
    });

    it('treats a folderId naming no folder as no folder', () => {
      const subject = bookWith([open('f1', null)], 'gone');

      expect(scan(subject).activated).toHaveLength(1);
    });
  });
});
