// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  SESSION_EXPORT_SCHEMA,
  type SessionExport,
  uuidv7,
  uuidv7Timestamp,
} from '@storyengine/shared';
import { describe, expect, it } from 'vitest';

import { producedTurnId } from '../../sessions/producer.js';
import {
  asPlayed,
  derivedTurnIds,
  followIntoStrings,
  rekeyTurns,
  worldSessionOrigin,
} from './session.js';

/**
 * ***A session's turns, re-keyed for the account it lands on*** —
 * [P16.3f](../../../../../docs/design/workplan/35-p16-world.md), with the
 * fact check's two corrections to the plan's contract (2026-10-10): a turn id
 * is keyed in map **keys** as well as values, so the scan here reads keys too;
 * and a turn id that is not a v7 — every chat or Aventuras import's, and
 * every turn re-keyed once already — still gets a stable id, from its
 * `createdAt`.
 *
 * (Placed beside `session.ts` rather than in `rewrite.test.ts`, where the plan
 * listed it: `rekeyTurns` is this module's, and the rewrite's own tests stay
 * about the rewrite.)
 */

const SENDER_SESSION = uuidv7();
const ORIGIN = worldSessionOrigin(SENDER_SESSION);
const AT = '2026-10-11T09:00:00.000Z';

/** A v8 id, as `producer.ts` derives one — what a chat import's turns carry. */
const PRODUCED = producedTurnId({
  handle: 'someone',
  origin: 'chat/the-harbour.jsonl',
  sourceId: '0',
  at: Date.parse('2026-09-01T08:00:00.000Z'),
});

/**
 * ***A played session's export, with a turn id everywhere one can be*** — the
 * tree's parents, the head, a branch ref, an effect's turn, a rendition's turn,
 * and the three maps keyed by turn: hidden lines, chosen pictures, the choice
 * remembered at a fork (whose values are turn ids too).
 */
function exported(): { doc: SessionExport; turnIds: string[]; renditionId: string } {
  const root = PRODUCED;
  const left = uuidv7();
  const right = uuidv7();
  const renditionId = `${left}.0`;
  const turn = (id: string, parentTurnId: string | null) => ({
    id,
    sessionId: SENDER_SESSION,
    parentTurnId,
    createdAt: AT,
    status: 'complete',
    effects: [
      {
        id: uuidv7(),
        turnId: id,
        channelId: 'se.presence',
        scopeKey: 'an-actor',
        op: { type: 'set', path: '/' },
        before: null,
        after: true,
        proposedBy: { kind: 'engine' },
        applied: true,
        rejectedReason: null,
        supersedes: null,
        channelVersion: 1,
        scope: 'session',
      },
    ],
    tape: [],
    renditions: { requested: id === left ? [renditionId] : [] },
  });
  const doc = {
    schema: SESSION_EXPORT_SCHEMA,
    exportedBy: { version: '1.0.0-alpha.7', at: AT },
    session: {
      schema: 'storyengine.session/1',
      id: SENDER_SESSION,
      name: 'Night one',
      createdAt: AT,
      updatedAt: AT,
      headTurnId: right,
      branchRefs: [{ id: 'ref-1', name: 'The other way', headTurnId: left }],
      hidden: { [left]: true },
      renditionSelection: { [left]: renditionId },
      lastSelectedChild: { [root]: right },
      channels: { 'se.presence#an-actor': { value: true } },
    },
    turns: [turn(root, null), turn(left, root), turn(right, root)],
    renditions: [
      {
        schema: 'storyengine.rendition/1',
        id: renditionId,
        sessionId: SENDER_SESSION,
        turnId: left,
      },
    ],
  } as unknown as SessionExport;
  return { doc, turnIds: [root, left, right], renditionId };
}

/** Every string in a value — keys included — but nothing under a `foreign` key. */
function stringsOutsideForeign(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOutsideForeign);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    key === 'foreign' ? [] : [key, ...stringsOutsideForeign(inner)],
  );
}

describe('re-keying a session’s turns', () => {
  it('leaves no string equal to an old turn id outside `foreign` — keys as well as values', () => {
    const { doc, turnIds } = exported();

    const rekeyed = rekeyTurns(doc, 'amy', ORIGIN);

    const left = stringsOutsideForeign(rekeyed).filter((one) => turnIds.includes(one));
    expect(left).toEqual([]);
    // And every place one was now names the new one — not merely nothing.
    const ids = derivedTurnIds(doc.turns, 'amy', ORIGIN);
    const [root, branch, head] = turnIds.map((id) => ids.get(id)!);
    const session = rekeyed.session as Record<string, any>;
    expect(session['headTurnId']).toBe(head);
    expect(session['branchRefs'][0].headTurnId).toBe(branch);
    expect(Object.keys(session['hidden'])).toEqual([branch]);
    expect(Object.keys(session['renditionSelection'])).toEqual([branch]);
    expect(session['lastSelectedChild']).toEqual({ [root!]: head });
    expect(rekeyed.turns.map((turn) => [turn.id, turn.parentTurnId])).toEqual([
      [root, null],
      [branch, root],
      [head, root],
    ]);
    expect(rekeyed.turns.map((turn) => turn.effects[0]?.turnId)).toEqual([root, branch, head]);
    expect((rekeyed.renditions[0] as { turnId: string }).turnId).toBe(branch);
  });

  it('keeps each turn’s provenance as the id it had where it was made', () => {
    const { doc, turnIds } = exported();
    const travelled = {
      ...doc,
      turns: doc.turns.map((turn, at) =>
        at === 0 ? { ...turn, foreign: { source: 'an-earlier-install', id: 'turn-7' } } : turn,
      ),
    } as SessionExport;

    const rekeyed = rekeyTurns(travelled, 'amy', ORIGIN);

    expect(rekeyed.turns.map((turn) => (turn as { foreign?: unknown }).foreign)).toEqual([
      // A turn that had travelled before keeps the first place it came from.
      { source: 'an-earlier-install', id: 'turn-7' },
      { source: SENDER_SESSION, id: turnIds[1] },
      { source: SENDER_SESSION, id: turnIds[2] },
    ]);
  });

  it('leaves a rendition its own id — it names a record, and keeps the old turn id only as a substring', () => {
    const { doc, renditionId } = exported();

    const rekeyed = rekeyTurns(doc, 'amy', ORIGIN);

    const session = rekeyed.session as Record<string, any>;
    expect(rekeyed.renditions[0]?.id).toBe(renditionId);
    expect(Object.values(session['renditionSelection'])).toEqual([renditionId]);
  });

  it('does not change the document it was handed', () => {
    const { doc } = exported();
    const before = structuredClone(doc);

    rekeyTurns(doc, 'amy', ORIGIN);

    expect(doc).toEqual(before);
  });
});

describe('the ids an account derives', () => {
  it('are v8, keep the old id’s millisecond, stay the same per account and differ across accounts', () => {
    const { doc, turnIds } = exported();
    const v7 = turnIds[1]!;

    const amy = derivedTurnIds(doc.turns, 'amy', ORIGIN);
    const again = derivedTurnIds(doc.turns, 'amy', ORIGIN);
    const ida = derivedTurnIds(doc.turns, 'ida', ORIGIN);

    for (const id of amy.values()) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8/);
    // The first 48 bits are the millisecond, as in a v7.
    const millisecond = (id: string) => Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
    expect(millisecond(amy.get(v7)!)).toBe(uuidv7Timestamp(v7));
    expect([...again]).toEqual([...amy]);
    for (const id of turnIds) expect(ida.get(id)).not.toBe(amy.get(id));
    // And another session of the same file — another arrival key — never meets these.
    const elsewhere = derivedTurnIds(doc.turns, 'amy', worldSessionOrigin(uuidv7()));
    for (const id of turnIds) expect(elsewhere.get(id)).not.toBe(amy.get(id));
  });

  it('re-keys a v8 turn id, from the turn’s `createdAt` — a chat import’s, or one re-keyed before', () => {
    const { doc } = exported();
    expect(uuidv7Timestamp(PRODUCED)).toBeNull();

    const amy = derivedTurnIds(doc.turns, 'amy', ORIGIN);
    const derived = amy.get(PRODUCED)!;

    expect(derived).not.toBe(PRODUCED);
    expect(derived).toBe(
      producedTurnId({ handle: 'amy', origin: ORIGIN, sourceId: PRODUCED, at: Date.parse(AT) }),
    );
    // Re-keyed once already, it re-keys again, stably, for the next account.
    const once = rekeyTurns(doc, 'amy', ORIGIN);
    const twice = derivedTurnIds(once.turns, 'ida', ORIGIN);
    expect(twice.get(derived)).toBe(
      producedTurnId({ handle: 'ida', origin: ORIGIN, sourceId: derived, at: Date.parse(AT) }),
    );
  });
});

/**
 * ***Ids inside strings*** — the review of 2026-10-11. A mode builds field
 * paths out of channel keys (the Scene mode's locks and hidden fields), and a
 * draw names an actor in its purpose; `rewriteIds` renames only a string that
 * *is* an id, so these are followed by shape, and only by shape.
 */
describe('the ids inside the strings a session builds', () => {
  const NED_VERA = uuidv7();
  const AMY_VERA = uuidv7();
  const ids = new Map([[NED_VERA, AMY_VERA]]);

  it('renames the scope of a channel key or a field path under one, in state and in effects', () => {
    const locked = [`se.track.character#${NED_VERA}/mood`, `se.track.character#${NED_VERA}`];
    const doc = {
      channels: { 'se.track.locks': { value: locked }, 'se.track.hidden': { value: [] } },
      turns: [
        {
          effects: [{ channelId: 'se.track.locks', scopeKey: null, before: [], after: locked }],
        },
      ],
    };

    const followed = followIntoStrings(doc, ids);

    const expected = [`se.track.character#${AMY_VERA}/mood`, `se.track.character#${AMY_VERA}`];
    expect(followed.channels['se.track.locks'].value).toEqual(expected);
    expect(followed.turns[0]!.effects[0]!.after).toEqual(expected);
    expect(JSON.stringify(followed)).not.toContain(NED_VERA);
  });

  it('renames the actor a draw was asked for by, in its key, site and purpose', () => {
    const draw = {
      key: `speakers:talkativeness:${NED_VERA}#0`,
      site: 'speakers',
      purpose: `talkativeness:${NED_VERA}`,
      index: 0,
      kind: 'float',
      detail: '0..1',
      value: 0.4,
      replayed: false,
    };

    const followed = followIntoStrings({ tape: [draw] }, ids);

    expect(followed.tape[0]).toEqual({
      ...draw,
      key: `speakers:talkativeness:${AMY_VERA}#0`,
      purpose: `talkativeness:${AMY_VERA}`,
    });
  });

  it('leaves prose, an undotted key, and `foreign` exactly as written', () => {
    const doc = {
      output: { text: `She wrote #${NED_VERA} on the wall, and talkativeness:${NED_VERA}.` },
      note: `vera#${NED_VERA}/mood`,
      foreign: { source: 'elsewhere', id: `se.track.character#${NED_VERA}` },
    };

    expect(followIntoStrings(doc, ids)).toEqual(doc);
  });
});

/**
 * ***A session already here keeps the objects it plays*** — the review of
 * 2026-10-11: under keep-both the plan points the file's Vera at a fresh
 * copy, and a session whose turns name the Vera an earlier import landed is
 * followed to that one instead; one that names neither takes the plan's.
 */
describe('the map for a session already here', () => {
  const [fileVera, hers, copy, fileBook, book] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];

  it('follows each object to the arrival the session names, else the plan’s', () => {
    const plan = new Map([
      [fileVera, copy],
      [fileBook, book],
    ]);
    const arrivals = new Map([[fileVera, [hers, copy]]]);
    const held = [
      { cast: { persona: null, actors: [hers] }, channels: { [`se.presence#${hers}`]: {} } },
    ];

    expect(asPlayed(plan, arrivals, held)).toEqual(
      new Map([
        [fileVera, hers],
        [fileBook, book],
      ]),
    );
    expect(asPlayed(plan, arrivals, [{}])).toEqual(plan);
    // Naming the plan's own id, it keeps it — whatever else is an arrival.
    expect(asPlayed(plan, arrivals, [{ cast: { actors: [copy, hers] } }]).get(fileVera)).toBe(copy);
  });
});
