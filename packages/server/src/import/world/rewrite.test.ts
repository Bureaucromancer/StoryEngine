// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { uuidv7 } from '@storyengine/shared';
import { describe, expect, it } from 'vitest';

import { rewriteIds } from './rewrite.js';

/**
 * ***References follow a re-mint, and nothing else moves*** —
 * [P16.3e](../../../../../docs/design/workplan/35-p16-world.md).
 *
 * The plan's risk 1 is that an exact-match rewrite renames a string that was
 * not a reference; the fact check's finding is that a value-only rewrite
 * misses the ids a session keys its maps by. These hold the line both ways:
 * whole strings and whole keys move, substrings and unmapped strings do not,
 * and the one composite key shape — a channel's `<channelId>#<scope>` — is
 * split only where the format says it is one.
 */

const actor = uuidv7();
const book = uuidv7();
const turn = uuidv7();
const sibling = uuidv7();
const ids = new Map([
  [actor, 'actor-landed'],
  [book, 'book-landed'],
  [turn, 'turn-landed'],
  [sibling, 'sibling-landed'],
]);

/** Every string in a value, keys included, with the key path that reached it. */
function strings(value: unknown, path = ''): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value))
    return value.flatMap((one, at) => strings(one, `${path}/${String(at)}`));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [
    { path: `${path}/[${key}]`, text: key },
    ...strings(inner, `${path}/${key}`),
  ]);
}

describe('rewriting ids', () => {
  it('renames exact matches wherever they sit — values, arrays, nested objects', () => {
    const rewritten = rewriteIds(
      {
        id: actor,
        lore: [{ id: book, name: 'Harbour' }],
        cast: [{ ref: { id: actor, name: 'Vera' }, billing: 'npc', note: '' }],
        scope: { kind: 'linked', actorIds: [actor] },
      },
      ids,
    );

    expect(rewritten).toEqual({
      id: 'actor-landed',
      lore: [{ id: 'book-landed', name: 'Harbour' }],
      cast: [{ ref: { id: 'actor-landed', name: 'Vera' }, billing: 'npc', note: '' }],
      scope: { kind: 'linked', actorIds: ['actor-landed'] },
    });
  });

  it('leaves substrings and unmapped strings exactly as written', () => {
    const value = {
      originalFilename: `seworld:${actor}`,
      rendition: `${turn}.0`,
      prose: `She said ${book} twice.`,
      other: uuidv7(),
      number: 7,
      flag: true,
      nothing: null,
    };

    expect(rewriteIds(value, ids)).toEqual(value);
  });

  it('never changes what it was given', () => {
    const value = { id: actor, keyed: { [book]: [actor] } };
    const before = structuredClone(value);

    rewriteIds(value, ids);

    expect(value).toEqual(before);
  });

  it('renames a key that is a mapped id, whole, in any map', () => {
    const rewritten = rewriteIds(
      {
        prompts: { cards: { [actor]: { text: 'card' } } },
        hidden: { [turn]: true },
        renditionSelection: { [turn]: `${turn}.1` },
        lastSelectedChild: { [turn]: turn },
        memory: { associations: { [sibling]: 'never' } },
        // A key that only contains an id is not one.
        notes: { [`about-${actor}`]: 1 },
      },
      ids,
    );

    expect(rewritten).toEqual({
      prompts: { cards: { 'actor-landed': { text: 'card' } } },
      hidden: { 'turn-landed': true },
      // The rendition id is a composite — `<turnId>.<n>` — and keeps its old
      // turn id as a substring, harmlessly: nothing reads a turn out of it.
      renditionSelection: { 'turn-landed': `${turn}.1` },
      lastSelectedChild: { 'turn-landed': 'turn-landed' },
      memory: { associations: { 'sibling-landed': 'never' } },
      notes: { [`about-${actor}`]: 1 },
    });
  });

  /**
   * *The fact check's case*: `se.status#<actorId>` in the head snapshot, with
   * the effect that wrote it rewritten. Left with the old key, the session's
   * first open would record a hand edit deleting the re-minted actor's state.
   */
  it('renames the scope of a channel key, and only under channels', () => {
    const rewritten = rewriteIds(
      {
        channels: {
          [`se.status#${actor}`]: { value: 'wounded' },
          [`se.presence#${actor}`]: { value: true },
          'se.hook#a-hook-id': { value: 'fired' },
          'se.clock': { value: 3 },
          [actor]: { value: 'a whole key is a key' },
        },
        elsewhere: { [`se.status#${actor}`]: 1 },
      },
      ids,
    );

    expect(rewritten).toEqual({
      channels: {
        'se.status#actor-landed': { value: 'wounded' },
        'se.presence#actor-landed': { value: true },
        'se.hook#a-hook-id': { value: 'fired' },
        'se.clock': { value: 3 },
        'actor-landed': { value: 'a whole key is a key' },
      },
      elsewhere: { [`se.status#${actor}`]: 1 },
    });
  });

  it('enters nothing under a skipped key — a turn’s foreign id is its provenance', () => {
    const value = {
      turns: [{ id: turn, foreign: { source: sibling, id: turn }, parentTurnId: turn }],
    };

    expect(rewriteIds(value, ids, new Set(['foreign']))).toEqual({
      turns: [
        { id: 'turn-landed', foreign: { source: sibling, id: turn }, parentTurnId: 'turn-landed' },
      ],
    });
    // And without the skip, it would have been entered — so the skip is doing it.
    expect(rewriteIds(value, ids).turns[0]?.foreign).toEqual({
      source: 'sibling-landed',
      id: 'turn-landed',
    });
  });

  it('keeps an own `__proto__` key a field, never a prototype', () => {
    const value = JSON.parse(`{"__proto__": {"id": "${actor}"}, "id": "${actor}"}`) as object;

    const rewritten = rewriteIds(value, ids) as Record<string, unknown>;

    expect(Object.getPrototypeOf(rewritten)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(rewritten, '__proto__')?.value).toEqual({
      id: 'actor-landed',
    });
  });

  it('is an equal copy when every id lands as itself', () => {
    const value = { id: actor, keyed: { [actor]: [book] } };
    const same = new Map([
      [actor, actor],
      [book, book],
    ]);

    const rewritten = rewriteIds(value, same);

    expect(rewritten).toEqual(value);
    expect(rewritten).not.toBe(value);
  });

  /**
   * ***The scan the fact check asked for***: a session-shaped document with
   * every id-keyed map it names, rewritten, then every key and every value
   * searched for an id that moved. What may keep one is said by name: the
   * skipped `foreign`. (A rendition id keeps its turn id as a prefix, which
   * no exact search counts, and nothing reads a turn out of it.)
   */
  it('leaves no moved id anywhere in a session-shaped document, keys included', () => {
    const session = {
      id: 'the-session',
      headTurnId: turn,
      cast: { persona: null, actors: [actor] },
      lore: [book],
      channels: { [`se.party#${actor}`]: { value: { member: true } } },
      prompts: { cards: { [actor]: { text: '' } } },
      hidden: { [turn]: true },
      renditionSelection: { [turn]: `${turn}.0` },
      lastSelectedChild: { [turn]: turn },
      memory: { share: true, associations: { [sibling]: 'never' } },
      turns: [
        {
          id: turn,
          parentTurnId: null,
          foreign: { source: 'the-session', id: turn },
          effects: [{ channel: 'se.status', scopeKey: actor, value: 'ok' }],
        },
      ],
    };

    const rewritten = rewriteIds(session, ids, new Set(['foreign']));

    const moved = [...ids.keys()];
    const leftovers = strings(rewritten).filter(
      (one) => moved.includes(one.text) && !one.path.includes('/foreign/'),
    );
    expect(leftovers).toEqual([]);
    expect(Object.keys(rewritten.channels)).toEqual(['se.party#actor-landed']);
  });
});
