// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { SESSION_EXPORT_SCHEMA, type SessionExport } from '@storyengine/shared';

import { remint } from './remint.js';

/**
 * ***New ids for an imported session, and nothing left pointing at the old
 * ones*** — [P13.0](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * The rewrite is **by value, not by path**: any dot-separated segment of any
 * string or key that is one of the document's own turn ids — or its session id
 * — becomes the new one, everywhere but `foreign`. The fixture below is the
 * list of paths a by-path rewrite would have had to name, which is what makes
 * it a checklist here rather than the mechanism: a field this build has never
 * heard of is in it, and has to come out rewritten too.
 */

const WAS = '01900000-0000-7000-8000-00000000aaaa';
const T1 = '01900000-0000-7000-8000-000000000001';
const T2 = '01900000-0000-7000-8000-000000000002';
const T3 = '01900000-0000-7000-8000-000000000003';
const T4 = '01900000-0000-7000-8000-000000000004';
const OLD = [T1, T2, T3, T4, WAS];

function minted(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `01910000-0000-7000-8000-${String(n).padStart(12, '0')}`;
  };
}

function turn(id: string, parent: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    sessionId: WAS,
    parentTurnId: parent,
    createdAt: '2026-09-01T12:00:00.000Z',
    status: 'complete',
    output: { text: `A line that mentions ${id} in passing, and ends on it: ${id}.` },
    effects: [],
    tape: [],
    ...extra,
  };
}

/** Every id-bearing field the design audit found, plus one it could not have. */
function document(): SessionExport {
  return {
    schema: SESSION_EXPORT_SCHEMA,
    exportedBy: { version: null, at: '2026-09-01T12:00:00.000Z' },
    session: {
      id: WAS,
      name: 'Rain City',
      createdAt: '2026-09-01T12:00:00.000Z',
      updatedAt: '2026-09-01T12:00:00.000Z',
      headTurnId: T3,
      branchRefs: [{ id: 'b1', name: 'The other tide', headTurnId: T4 }],
      lastSelectedChild: { [T2]: T3 },
      renditionSelection: { [T3]: `${T3}.1` },
      channels: {
        'se.backdrop': { value: { from: 'rendition', renditionId: `${T2}.0` } },
      },
      someFutureField: { pointsAt: T1, andTheSession: WAS },
    },
    // Out of order on purpose: a child before its parent, and a repeated line.
    turns: [
      turn(T3, T2, {
        effects: [
          {
            id: 'e1',
            turnId: T3,
            channel: 'se.backdrop',
            before: { from: 'rendition', renditionId: `${T2}.0` },
            after: { from: 'rendition', renditionId: `${T3}.0` },
          },
        ],
        request: { calls: [{ blocks: [{ id: `lore.${T2}.opening` }] }] },
        renditions: { requested: [`${T3}.0`] },
      }),
      turn(T1, null),
      turn(T2, T1),
      turn(T4, T2, { foreign: { source: 'aventuras', id: 'entry-77' } }),
      turn(T2, T1),
    ] as unknown as SessionExport['turns'],
    renditions: [],
  };
}

const NEW_SESSION = '01920000-0000-7000-8000-00000000bbbb';

describe('remint', () => {
  it('leaves no old id anywhere but in foreign', () => {
    const out = remint(document(), { sessionId: NEW_SESSION, was: WAS }, minted());

    const withoutForeign = JSON.stringify({
      session: out.session,
      // `undefined` drops out of the JSON, which is the point: `foreign` is where
      // the old ids are supposed to be.
      turns: out.turns.map((each) => ({ ...each, foreign: undefined })),
    });
    for (const old of OLD) {
      // Prose is the one place an old id may stay: it is words, not a reference.
      const outsideProse = withoutForeign.replaceAll(/"text":"[^"]*"/g, '');
      expect(outsideProse, old).not.toContain(old);
    }
    expect(out.session.id).toBe(NEW_SESSION);
    expect(out.session.someFutureField).toEqual({
      pointsAt: out.turnIds.get(T1),
      andTheSession: NEW_SESSION,
    });
  });

  it('rewrites rendition ids, block ids and object keys, not only whole values', () => {
    const out = remint(document(), { sessionId: NEW_SESSION, was: WAS }, minted());
    const id = (old: string): string => out.turnIds.get(old) as string;

    expect(out.session.headTurnId).toBe(id(T3));
    expect(out.session.branchRefs).toEqual([
      { id: 'b1', name: 'The other tide', headTurnId: id(T4) },
    ]);
    expect(out.session.lastSelectedChild).toEqual({ [id(T2)]: id(T3) });
    expect(out.session.renditionSelection).toEqual({ [id(T3)]: `${id(T3)}.1` });
    expect(out.session.channels).toEqual({
      'se.backdrop': { value: { from: 'rendition', renditionId: `${id(T2)}.0` } },
    });

    const third = out.turns.find((each) => each.id === id(T3)) as unknown as {
      effects: { turnId: string; before: unknown; after: unknown }[];
      request: { calls: { blocks: { id: string }[] }[] };
      renditions: { requested: string[] };
    };
    expect(third.effects[0]).toMatchObject({
      turnId: id(T3),
      before: { renditionId: `${id(T2)}.0` },
      after: { renditionId: `${id(T3)}.0` },
    });
    expect(third.request.calls[0]?.blocks[0]?.id).toBe(`lore.${id(T2)}.opening`);
    expect(third.renditions.requested).toEqual([`${id(T3)}.0`]);
  });

  it('does not touch prose that merely mentions an id', () => {
    const out = remint(document(), { sessionId: NEW_SESSION, was: WAS }, minted());
    const first = out.turns.find((each) => each.foreign?.id === T1);
    expect(first?.output?.text).toBe(
      `A line that mentions ${T1} in passing, and ends on it: ${T1}.`,
    );
  });

  it('puts every parent before its children, and mints in that order', () => {
    const out = remint(document(), { sessionId: NEW_SESSION, was: WAS }, minted());
    const seen = new Set<string>();
    for (const each of out.turns) {
      if (each.parentTurnId !== null) expect(seen.has(each.parentTurnId), each.id).toBe(true);
      seen.add(each.id);
    }
    // Minted in that order, so uuidv7 order is creation order again. First
    // occurrences only: a repeated line stays where it was (below).
    const ids = out.turns.map((each) => each.id);
    const firsts = ids.filter((id, at) => ids.indexOf(id) === at);
    expect([...firsts].sort()).toEqual(firsts);
  });

  /**
   * ***A repeated line is a later version, so it keeps its place.*** A segment
   * is read last-line-wins — a tombstone is a turn appended again with
   * `removed` — and a backup envelope carries the raw lines, so moving the
   * second copy ahead of the first would resurrect whatever it superseded.
   */
  it('maps a repeated line to one new id, and keeps both lines in their order', () => {
    const doc = document();
    const later = turn(T2, T1, { removed: true });
    doc.turns = [...doc.turns.slice(0, 4), later] as unknown as SessionExport['turns'];
    const out = remint(doc, { sessionId: NEW_SESSION, was: WAS }, minted());
    expect(out.turnIds.size).toBe(4);
    const copies = out.turns.filter((each) => each.id === out.turnIds.get(T2));
    expect(copies).toHaveLength(2);
    expect(copies.map((each) => each.removed === true)).toEqual([false, true]);
  });

  it('marks each turn foreign once, keeping a foreign it already had', () => {
    const out = remint(document(), { sessionId: NEW_SESSION, was: WAS }, minted());
    for (const each of out.turns) {
      expect(each.sessionId).toBe(NEW_SESSION);
      const original = [...out.turnIds].find(([, now]) => now === each.id)?.[0];
      if (original === T4) expect(each.foreign).toEqual({ source: 'aventuras', id: 'entry-77' });
      else expect(each.foreign).toEqual({ source: WAS, id: original });
    }
  });

  it('keeps a turn whose parent is not in the document, as a root', () => {
    const lone = document();
    lone.turns = [turn(T4, T2)] as unknown as SessionExport['turns'];
    const out = remint(lone, { sessionId: NEW_SESSION, was: WAS }, minted());
    expect(out.turns).toHaveLength(1);
    // A parent this document never mentions is left as it was: not a reference
    // this import can resolve, and not one it may invent.
    expect(out.turns[0]?.parentTurnId).toBe(T2);
  });
});
