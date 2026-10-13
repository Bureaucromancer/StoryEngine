// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { ImportNote } from '@storyengine/shared';

import { encodeNotes, encodeNotesWithin } from './headers.js';

/**
 * ***A notes header within its budget*** — `encodeNotesWithin`, 2026-10-11,
 * the P16.3d review: the World file's notes grow with the library (one per
 * picture a book names and does not have), and a header of all of them is
 * one a proxy or Node's own `fetch` refuses. The route test holds the budget
 * through a real publish; these hold the rule's three promises on their own.
 */

const decode = (header: string): ImportNote[] =>
  JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as ImportNote[];

const more = (rest: readonly ImportNote[]): ImportNote => ({
  key: 'more',
  level: rest.some((note) => note.level === 'warn') ? 'warn' : 'info',
  params: { count: rest.length },
});

function missing(count: number): ImportNote[] {
  return Array.from({ length: count }, (_, at) => ({
    key: 'publish.file.pictureMissing',
    level: 'info' as const,
    params: { id: `id-${String(at)}`, ref: `assets/${'0'.repeat(64)}.png` },
  }));
}

describe('encodeNotesWithin', () => {
  it('sends a list that fits exactly as encodeNotes does', () => {
    const notes = missing(3);
    expect(encodeNotesWithin(notes, 4096, more)).toBe(encodeNotes(notes));
  });

  it('cuts a long list to the budget, warnings first, and counts the rest', () => {
    const warning: ImportNote = {
      key: 'publish.closure.writtenByPlay',
      level: 'warn',
      params: { id: 'memories' },
    };
    const notes = [...missing(100), warning];
    const header = encodeNotesWithin(notes, 1024, more);
    expect(header.length).toBeLessThanOrEqual(1024);

    const sent = decode(header);
    // The warning came last and is sent first.
    expect(sent[0]).toEqual(warning);
    const kept = sent.length - 1;
    expect(kept).toBeGreaterThan(1);
    expect(sent.at(-1)).toEqual({ key: 'more', level: 'info', params: { count: 101 - kept } });
    // As many as fit: the next one, with the count after it, would not have.
    const ordered = [warning, ...missing(100)];
    const next = encodeNotes([...ordered.slice(0, kept + 1), more(ordered.slice(kept + 1))]);
    expect(next.length).toBeGreaterThan(1024);
  });

  it('sends the count alone when the budget holds nothing else', () => {
    const sent = decode(encodeNotesWithin(missing(5), 8, more));
    expect(sent).toEqual([{ key: 'more', level: 'info', params: { count: 5 } }]);
  });
});
