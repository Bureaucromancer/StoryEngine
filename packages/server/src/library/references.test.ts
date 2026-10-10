// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  ACTOR_SCHEMA,
  LEGACY_PACKAGE_SCHEMA,
  LOREBOOK_SCHEMA,
  PRESET_SCHEMA,
  SESSION_SCHEMA,
  SETUP_SCHEMA,
  TREATMENT_SCHEMA,
  WORLD_SCHEMA,
} from '@storyengine/shared';

import { edgesOf, type OutboundRef, sessionEdges, worldScopeEdge } from './references.js';

/**
 * ***[04 §9.1]'s table, one row per case*** —
 * [04 §9.1](../../../../docs/design/04-schemas.md),
 * [16 §4](../../../../docs/design/16-publish.md), [P16.3a].
 *
 * **The stage ends when every row has a named test through the reader and
 * through the walker**, and these are the reader's: one `describe` per row, by
 * the table's own numbering as it stands after the owner's answers of
 * 2026-10-10 — thirteen rows, row 12 the one that is a query. The walker's half
 * is `packaging/closure.test.ts`.
 *
 * ***Written against the shape a real object has***, for the reason
 * `links.test.ts` gives about its hook fixtures: a reader that never looked and
 * a reader that looked in the wrong place are both proved right by a stub that
 * holds only the field under test. So hooks here are whole hooks, and the
 * `involves` cases put the bare `Ref` exactly where `PlotHook.involves` puts it
 * — the position 04 §9.1 spends a paragraph on.
 */

/** A hook that names one actor through `involves` and nowhere else. */
function involving(...refs: unknown[]): Record<string, unknown> {
  return {
    id: 'hook-debt',
    title: 'The debt comes due',
    premise: 'Somebody calls it in at the worst moment.',
    magnitude: 'local',
    involves: refs,
    weight: 1,
    delivery: 'guidance',
    once: true,
  };
}

/** A hook that **is** an arrival: its subject in `introduces.actor`, not in `involves`. */
function introducing(actor: unknown, id = 'hook-stranger'): Record<string, unknown> {
  return {
    id,
    title: 'The stranger at the door',
    premise: '',
    magnitude: 'personal',
    involves: [],
    weight: 1,
    delivery: 'seed',
    once: true,
    introduces: {
      actor,
      entrances: [{ id: 'entrance-1', label: 'Out of the rain', text: 'She knocks twice.' }],
      primaryEntranceId: null,
    },
  };
}

/** The four facts a case usually asserts, without the defaults it does not. */
function brief(edges: OutboundRef[]): [string, string, string | null, string | null][] {
  return edges.map((edge) => [edge.rule, edge.field, edge.ref.id, edge.ref.name]);
}

describe('row 1 — a treatment’s required lore', () => {
  it('says required at /lore/0/ref, included and not optional', () => {
    const [edge] = edgesOf(TREATMENT_SCHEMA, {
      id: 't-1',
      lore: [{ ref: { id: 'book-1', name: 'Harbour' }, required: true }],
      cast: [],
    });
    expect(edge).toEqual({
      rule: 'treatment.lore',
      field: '/lore/0/ref',
      target: LOREBOOK_SCHEMA,
      ref: { id: 'book-1', name: 'Harbour' },
      resolve: 'ref',
      required: true,
      default: 'included',
    });
  });

  /**
   * ***`=== true`, and nothing truthy.*** `required` defaults to false and is the
   * author's loud statement; a hand-edited `"yes"` is not that statement, and a
   * review that warned on it would warn about something nobody said.
   */
  it('reads a required that is not exactly true as not required', () => {
    const [edge] = edgesOf(TREATMENT_SCHEMA, {
      lore: [{ ref: { id: 'book-1' }, required: 'yes' }],
    });
    expect(edge?.required).toBe(false);
    expect(edge?.default).toBe('optional');
  });
});

describe('row 2 — a treatment’s other lore', () => {
  it('is included and can be unchecked, which the review calls optional', () => {
    const edges = edgesOf(TREATMENT_SCHEMA, {
      lore: [
        { ref: { id: 'book-1', name: 'Harbour' }, required: true },
        { ref: { id: 'book-2', name: 'Weather' }, required: false },
        { ref: { id: 'book-3', name: 'Tides' } },
      ],
    });
    expect(edges.map((edge) => [edge.ref.id, edge.required, edge.default])).toEqual([
      ['book-1', true, 'included'],
      ['book-2', false, 'optional'],
      ['book-3', false, 'optional'],
    ]);
  });
});

describe('row 3 — a treatment’s cast', () => {
  it('reads the `cast[].ref` wrapper, and says so in the pointer', () => {
    expect(
      brief(
        edgesOf(TREATMENT_SCHEMA, {
          cast: [
            { ref: { id: 'actor-vera', name: 'Vera' }, role: 'lead' },
            { ref: { id: 'actor-keeper', name: 'The keeper' } },
          ],
        }),
      ),
    ).toEqual([
      ['treatment.cast', '/cast/0/ref', 'actor-vera', 'Vera'],
      ['treatment.cast', '/cast/1/ref', 'actor-keeper', 'The keeper'],
    ]);
  });
});

/**
 * ***The bare-ref trap, at the reader.*** `PlotHook.involves` is `Array(Ref)`
 * and `Introduction.actor` is a `Ref`; neither has a `.ref`. A reader spelled
 * `involves[].ref` finds `undefined` three times here and the introduced actor
 * once — and the test would still see *one* edge, which is why it counts four.
 */
describe('row 4 — a treatment’s hooks', () => {
  it('reads every bare involves and the introduced actor, per hook in order', () => {
    const edges = edgesOf(TREATMENT_SCHEMA, {
      lore: [],
      cast: [],
      hooks: [
        involving({ id: 'actor-a', name: 'Ada' }, { id: 'actor-b', name: 'Bo' }),
        introducing({ id: 'actor-c', name: 'Cy' }),
        involving({ id: 'actor-d', name: 'Di' }),
      ],
    });
    expect(brief(edges)).toEqual([
      ['treatment.hooks.involves', '/hooks/0/involves/0', 'actor-a', 'Ada'],
      ['treatment.hooks.involves', '/hooks/0/involves/1', 'actor-b', 'Bo'],
      ['treatment.hooks.introduces', '/hooks/1/introduces/actor', 'actor-c', 'Cy'],
      ['treatment.hooks.involves', '/hooks/2/involves/0', 'actor-d', 'Di'],
    ]);
    expect(edges.every((edge) => edge.target === ACTOR_SCHEMA && edge.resolve === 'ref')).toBe(
      true,
    );
  });

  it('comes after lore and cast — row order, then array order', () => {
    const edges = edgesOf(TREATMENT_SCHEMA, {
      hooks: [involving({ id: 'actor-a' })],
      cast: [{ ref: { id: 'actor-b' } }],
      lore: [{ ref: { id: 'book-1' } }],
    });
    expect(edges.map((edge) => edge.rule)).toEqual([
      'treatment.lore',
      'treatment.cast',
      'treatment.hooks.involves',
    ]);
  });
});

describe('row 5 — an actor’s lore', () => {
  it('reads bare Refs, where a lore link elsewhere is wrapped', () => {
    expect(
      brief(
        edgesOf(ACTOR_SCHEMA, {
          id: 'actor-vera',
          lore: [{ id: 'book-1', name: 'Harbour' }, { name: 'Weather' }],
        }),
      ),
    ).toEqual([
      ['actor.lore', '/lore/0', 'book-1', 'Harbour'],
      ['actor.lore', '/lore/1', null, 'Weather'],
    ]);
  });
});

describe('row 6 — a setup’s treatment', () => {
  it('reads the Ref, and a null treatment names nothing', () => {
    expect(
      brief(edgesOf(SETUP_SCHEMA, { treatment: { id: 't-1', name: 'Rain' }, preset: null })),
    ).toEqual([['setup.treatment', '/treatment', 't-1', 'Rain']]);
    expect(edgesOf(SETUP_SCHEMA, { treatment: null, preset: null })).toEqual([]);
  });
});

describe('row 7 — a setup’s own lore and cast', () => {
  it('keeps required on its lore, with the row’s included default', () => {
    const edges = edgesOf(SETUP_SCHEMA, {
      lore: [{ ref: { id: 'book-1' }, required: true }, { ref: { id: 'book-2' } }],
    });
    expect(edges.map((edge) => [edge.field, edge.required, edge.default])).toEqual([
      ['/lore/0/ref', true, 'included'],
      ['/lore/1/ref', false, 'included'],
    ]);
  });

  it('reads personaOptions, partyDefault and narrator', () => {
    expect(
      brief(
        edgesOf(SETUP_SCHEMA, {
          cast: {
            personaOptions: [{ id: 'actor-you', name: 'You' }],
            partyDefault: [{ id: 'actor-vera', name: 'Vera' }],
            narrator: { id: 'actor-voice', name: 'The voice' },
          },
        }),
      ),
    ).toEqual([
      ['setup.cast.personaOptions', '/cast/personaOptions/0', 'actor-you', 'You'],
      ['setup.cast.partyDefault', '/cast/partyDefault/0', 'actor-vera', 'Vera'],
      ['setup.cast.narrator', '/cast/narrator', 'actor-voice', 'The voice'],
    ]);
  });

  /**
   * ***`links.ts`'s first draft, kept as a case.*** `{ persona, actors }` is a
   * session's cast; a setup's is three other fields, and reading a setup with
   * the session's shape found nothing — silently.
   */
  it('finds nothing in a cast shaped like a session’s', () => {
    expect(
      edgesOf(SETUP_SCHEMA, { cast: { persona: 'actor-you', actors: ['actor-vera'] } }),
    ).toEqual([]);
  });
});

describe('row 8 — a setup’s own hooks', () => {
  it('reads both hook fields, after the cast and before the preset', () => {
    const edges = edgesOf(SETUP_SCHEMA, {
      treatment: null,
      preset: { id: 'preset-1' },
      cast: { personaOptions: [], partyDefault: [], narrator: null },
      lore: [],
      hooks: [involving({ id: 'actor-a' }), introducing({ id: 'actor-b' })],
    });
    expect(brief(edges)).toEqual([
      ['setup.hooks.involves', '/hooks/0/involves/0', 'actor-a', null],
      ['setup.hooks.introduces', '/hooks/1/introduces/actor', 'actor-b', null],
      ['setup.preset', '/preset', 'preset-1', null],
    ]);
  });
});

describe('row 9 — a setup’s preset', () => {
  it('is optional: leaving it out is what can be unchecked means', () => {
    const [edge] = edgesOf(SETUP_SCHEMA, { preset: { id: 'preset-1', name: 'Default' } });
    expect(edge).toMatchObject({
      rule: 'setup.preset',
      target: PRESET_SCHEMA,
      required: false,
      default: 'optional',
    });
  });
});

describe('row 10 — a lorebook’s hooks', () => {
  /**
   * **The first time a lorebook follows anything**, and only its hooks: an
   * entry and a folder are the book's own contents, and 04 §9.1's line is
   * *contents are not references*.
   */
  it('reads its hooks’ actors and never its entries or folders', () => {
    expect(
      brief(
        edgesOf(LOREBOOK_SCHEMA, {
          id: 'book-1',
          entries: [
            {
              id: 'entry-1',
              name: 'The keeper',
              actorFilter: { mode: 'include', values: ['Vera'] },
            },
          ],
          folders: [{ id: 'folder-1', name: 'The docks' }],
          hooks: [involving({ id: 'actor-a' }), introducing({ id: 'actor-b' })],
        }),
      ),
    ).toEqual([
      ['lorebook.hooks.involves', '/hooks/0/involves/0', 'actor-a', null],
      ['lorebook.hooks.introduces', '/hooks/1/introduces/actor', 'actor-b', null],
    ]);
  });

  it('finds nothing when the book has no hooks, which is the ordinary state', () => {
    expect(edgesOf(LOREBOOK_SCHEMA, { id: 'book-1', entries: [] })).toEqual([]);
  });
});

describe('row 11 — a World’s members', () => {
  it('reads every envelope in order, by id alone, with its schema for the walker', () => {
    const edges = edgesOf(WORLD_SCHEMA, {
      id: 'world-1',
      contents: [
        { schema: ACTOR_SCHEMA, id: 'actor-vera', name: 'Vera' },
        { schema: SESSION_SCHEMA, id: 'session-1', name: 'The docks' },
        { schema: 'storyengine.campaign/1', id: 'campaign-1' },
        { schema: WORLD_SCHEMA, id: 'world-2', name: 'Elsewhere' },
      ],
    });
    expect(edges.map((edge) => [edge.field, edge.envelopeSchema, edge.ref.id])).toEqual([
      ['/contents/0', ACTOR_SCHEMA, 'actor-vera'],
      ['/contents/1', SESSION_SCHEMA, 'session-1'],
      ['/contents/2', 'storyengine.campaign/1', 'campaign-1'],
      ['/contents/3', WORLD_SCHEMA, 'world-2'],
    ]);
    expect(
      edges.every(
        (edge) => edge.rule === 'world.member' && edge.target === null && edge.resolve === 'id',
      ),
    ).toBe(true);
  });

  it('reads a Package’s body under the name it had, and skips an envelope with no id', () => {
    expect(
      edgesOf(LEGACY_PACKAGE_SCHEMA, {
        contents: [
          { schema: ACTOR_SCHEMA, name: 'No id' },
          { schema: ACTOR_SCHEMA, id: 'a-1' },
        ],
      }).map((edge) => edge.field),
    ).toEqual(['/contents/1']);
  });
});

/**
 * ***Row 12 — the table's one query*** (*added 2026-10-10*). Nothing the World
 * holds points at these books; each book's scope points at the World. What is
 * pure about the row is the question put to one book, and the walker asks the
 * library which books to put it to.
 */
describe('row 12 — the books scoped to a World', () => {
  it('answers a book whose world arm names the World, pointing into the book', () => {
    expect(
      worldScopeEdge(
        { id: 'book-1', scope: { kind: 'world', worldIds: ['world-0', 42, 'world-1'] } },
        'world-1',
      ),
    ).toEqual({
      rule: 'world.scopedBook',
      // The element as the file holds it — after the number `worldIdsOf` drops.
      field: '/scope/worldIds/2',
      target: WORLD_SCHEMA,
      ref: { id: 'world-1', name: null },
      resolve: 'id',
      required: false,
      default: 'included',
    });
  });

  it('answers nothing for another World, another arm, or a book with no scope', () => {
    const scoped = { scope: { kind: 'world', worldIds: ['world-2'] } };
    expect(worldScopeEdge(scoped, 'world-1')).toBeNull();
    expect(
      worldScopeEdge({ scope: { kind: 'linked', actorIds: ['world-1'] } }, 'world-1'),
    ).toBeNull();
    expect(worldScopeEdge({ scope: { kind: 'global' } }, 'world-1')).toBeNull();
    expect(worldScopeEdge({ id: 'book-1' }, 'world-1')).toBeNull();
    expect(worldScopeEdge(null, 'world-1')).toBeNull();
    expect(worldScopeEdge(scoped, '')).toBeNull();
  });

  /** The arm is an inbound statement: reading the book outward reaches no World. */
  it('is never an outbound edge of the book itself', () => {
    expect(
      edgesOf(LOREBOOK_SCHEMA, { id: 'book-1', scope: { kind: 'world', worldIds: ['world-1'] } }),
    ).toEqual([]);
  });
});

describe('row 13 — a session’s links and its hook pool', () => {
  it('reads its treatment, lore, persona and actors as bare ids, by id alone', () => {
    const edges = sessionEdges({
      id: 'session-1',
      treatment: 't-1',
      lore: ['book-1', 'book-2'],
      cast: { persona: 'actor-you', actors: ['actor-vera'] },
      channels: {},
    });
    expect(brief(edges)).toEqual([
      ['session.treatment', '/treatment', 't-1', null],
      ['session.lore', '/lore/0', 'book-1', null],
      ['session.lore', '/lore/1', 'book-2', null],
      ['session.cast.persona', '/cast/persona', 'actor-you', null],
      ['session.cast.actors', '/cast/actors/0', 'actor-vera', null],
    ]);
    expect(edges.every((edge) => edge.resolve === 'id')).toBe(true);
  });

  /** An id-only position needs an id: a name there would resolve to nothing by the row's own rule. */
  it('ignores a link with a name and no id', () => {
    expect(sessionEdges({ treatment: { name: 'Rain' }, lore: [{ name: 'Harbour' }] })).toEqual([]);
  });

  /**
   * ***The owner's first answer, 2026-10-10.*** A pooled hook is `{ hook,
   * source }`, so the pointer runs through `/hook`; its `involves` is followed
   * whether it fired or not, and resolved as a `Ref` — the copy carries
   * whatever the treatment's refs carried.
   */
  it('reads every pooled hook’s involves, fired or not, as Refs', () => {
    const edges = sessionEdges({
      hooks: [
        {
          hook: involving({ id: 'actor-a', name: 'Ada' }),
          source: { kind: 'treatment', id: 't-1' },
        },
        {
          hook: { ...involving({ id: 'actor-b', name: 'Bo' }), id: 'hook-waiting' },
          source: { kind: 'session' },
        },
      ],
      channels: { 'se.hook#hook-debt': { value: 'fired' } },
    });
    const pooled = (i: number, id: string, name: string) => ({
      rule: 'session.hooks.involves',
      field: `/hooks/${String(i)}/hook/involves/0`,
      target: ACTOR_SCHEMA,
      ref: { id, name },
      resolve: 'ref',
      required: false,
      default: 'included',
    });
    // The first has fired and the second has not; both name who they involve.
    expect(edges).toEqual([pooled(0, 'actor-a', 'Ada'), pooled(1, 'actor-b', 'Bo')]);
  });

  /**
   * ***A fired arrival's subject has arrived*** and is in the cast, which the
   * links reach; an unfired one's has not, and leaving it home would land *an
   * arrival with nobody to arrive*. Only `fired` stops the edge: `provisional`
   * may lapse back to the pool, and `committed`/`forced` are intent, not record.
   */
  it('reads an introduced actor only while the hook has not fired', () => {
    const pool = ['fresh', 'done', 'maybe', 'wanted', 'pushed'].map((id) => ({
      hook: introducing({ id: `actor-${id}` }, id),
      source: { kind: 'session' },
    }));
    const edges = sessionEdges({
      hooks: pool,
      channels: {
        'se.hook#done': { value: 'fired' },
        'se.hook#maybe': { value: 'provisional' },
        'se.hook#wanted': { value: 'committed' },
        'se.hook#pushed': { value: 'forced' },
      },
    });
    expect(brief(edges)).toEqual([
      ['session.hooks.introduces', '/hooks/0/hook/introduces/actor', 'actor-fresh', null],
      ['session.hooks.introduces', '/hooks/2/hook/introduces/actor', 'actor-maybe', null],
      ['session.hooks.introduces', '/hooks/3/hook/introduces/actor', 'actor-wanted', null],
      ['session.hooks.introduces', '/hooks/4/hook/introduces/actor', 'actor-pushed', null],
    ]);
  });

  it('comes after the links, and reads a hand-edited channel map as nothing fired', () => {
    const session = {
      cast: { persona: null, actors: ['actor-vera'] },
      hooks: [{ hook: introducing({ id: 'actor-b' }, 'h-1'), source: { kind: 'session' } }],
    };
    for (const channels of [undefined, 'fired', ['se.hook#h-1'], { 'se.hook#h-1': 'fired' }]) {
      expect(sessionEdges({ ...session, channels }).map((edge) => edge.rule)).toEqual([
        'session.cast.actors',
        'session.hooks.introduces',
      ]);
    }
  });
});

describe('what the table does not follow', () => {
  it('a preset points at nothing', () => {
    expect(
      edgesOf(PRESET_SCHEMA, {
        id: 'preset-1',
        modes: ['scene'],
        blocks: [{ id: 'block-1', name: 'System' }],
      }),
    ).toEqual([]);
  });

  /**
   * ***The complement of the table, field by field.*** Each of these looks like
   * a pointer to somebody, and each is deliberately not one — the module header
   * says why per field. A reader that "helpfully" followed any of them would be
   * a second table, and the review would send things nobody linked.
   */
  it('follows no scope arm, filter, hook id, goal id, hint or mode list', () => {
    expect(
      edgesOf(LOREBOOK_SCHEMA, {
        scope: { kind: 'linked', actorIds: ['actor-vera'] },
        entries: [
          {
            id: 'entry-1',
            actorFilter: { mode: 'include', values: ['actor-vera'] },
            actorTagFilter: { mode: 'include', values: ['tag-1'] },
          },
        ],
      }),
    ).toEqual([]);
    expect(
      edgesOf(LOREBOOK_SCHEMA, { scope: { kind: 'region', worldIds: ['w-1'], actorIds: ['a-1'] } }),
    ).toEqual([]);
    expect(
      edgesOf(TREATMENT_SCHEMA, {
        modeHints: { modeId: 'scene', config: { id: 'x-1' } },
        hooks: [{ ...involving(), blockedBy: ['hook-2'], notBefore: { afterHook: 'hook-3' } }],
      }),
    ).toEqual([]);
    expect(
      edgesOf(SETUP_SCHEMA, {
        mode: { id: 'scene', config: null },
        spentHooks: ['hook-1'],
        goals: [{ id: 'goal-1', next: 'goal-2' }],
      }),
    ).toEqual([]);
  });

  /**
   * ***A session's copies, its siblings, its bindings and its turns.*** `source`
   * is the case the hook-pool row makes easy to get wrong: it names a library
   * object, and following it would publish the treatment a session was started
   * under after the session dropped it.
   */
  it('follows nothing else on a session', () => {
    expect(
      sessionEdges({
        setup: { treatment: { id: 't-1' }, cast: { personaOptions: [{ id: 'a-1' }] } },
        preset: { id: 'preset-1' },
        goals: [{ id: 'goal-1', next: 'goal-2' }],
        hooks: [
          { hook: involving(), source: { kind: 'treatment', id: 't-1' } },
          { hook: involving(), source: { kind: 'lore', id: 'book-1' } },
        ],
        memory: { associations: { 'session-2': 'always' } },
        roles: { narrator: { connectionId: 'c-1', modelId: 'm-1' } },
        stepRoles: { extract: { connectionId: 'c-1', modelId: 'm-1' } },
        branchRefs: [{ id: 'b-1', turnId: 'turn-1' }],
        renditionSelection: { 'turn-1': 'turn-1.0' },
        lastSelectedChild: { 'turn-1': 'turn-2' },
        hidden: { 'turn-1': true },
        prompts: { cards: { 'actor-vera': { system: '' } } },
        channels: { 'se.status#actor-vera': { value: 'well' } },
      }),
    ).toEqual([]);
  });
});

describe('shapes it tolerates, and shapes it survives', () => {
  /**
   * ***Both shapes wherever it looks***, because hand-edited files put a wrapper
   * where the schema says bare and a bare id where it says `Ref` — `links.ts`
   * learned the tolerance first. The pointer says which it found.
   */
  it('reads a wrapper where the schema says bare, and a bare id where it says Ref', () => {
    expect(
      brief(
        edgesOf(TREATMENT_SCHEMA, {
          cast: ['actor-vera'],
          hooks: [involving({ ref: { id: 'actor-a' } }, 'actor-b')],
        }),
      ),
    ).toEqual([
      ['treatment.cast', '/cast/0', 'actor-vera', null],
      ['treatment.hooks.involves', '/hooks/0/involves/0/ref', 'actor-a', null],
      ['treatment.hooks.involves', '/hooks/0/involves/1', 'actor-b', null],
    ]);
  });

  it('reads an empty id or name as absent, and a ref with neither as no reference', () => {
    expect(
      brief(
        edgesOf(ACTOR_SCHEMA, { lore: [{ id: '', name: 'Harbour' }, { id: '', name: '' }, ''] }),
      ),
    ).toEqual([['actor.lore', '/lore/0', null, 'Harbour']]);
  });

  /** A walk that threw on one malformed hook would refuse to publish a World over a typo. */
  it('never throws, and answers nothing for what holds nothing', () => {
    // No string here: a string where a `Ref` belongs is a bare id, which is a
    // reference — the tolerance case above — and junk is what holds nothing.
    const junk: unknown[] = [null, undefined, 42, true, [], [1, 2], { ref: { ref: { id: 'x' } } }];
    for (const kind of [
      ACTOR_SCHEMA,
      LOREBOOK_SCHEMA,
      TREATMENT_SCHEMA,
      SETUP_SCHEMA,
      PRESET_SCHEMA,
      WORLD_SCHEMA,
      'storyengine.unknown/1',
    ]) {
      for (const body of [...junk, 'text']) expect(edgesOf(kind, body)).toEqual([]);
      expect(
        edgesOf(kind, {
          lore: junk,
          cast: { personaOptions: junk, partyDefault: 'x', narrator: 7 },
          hooks: [...junk, { involves: junk, introduces: junk }, { introduces: { actor: null } }],
          contents: junk,
          treatment: [],
          preset: {},
        }),
      ).toEqual([]);
    }
    for (const session of [...junk, 'text']) expect(sessionEdges(session)).toEqual([]);
    expect(
      sessionEdges({
        treatment: 7,
        lore: 'book-1',
        cast: { persona: {}, actors: junk },
        hooks: [...junk, { hook: junk }, { hook: { introduces: 'x' } }],
        channels: null,
      }),
    ).toEqual([]);
  });
});
