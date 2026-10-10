// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  ACTOR_SCHEMA,
  LOREBOOK_SCHEMA,
  PRESET_SCHEMA,
  SETUP_SCHEMA,
  TREATMENT_SCHEMA,
  WORLD_SCHEMA,
} from '@storyengine/shared';

import { edgesOf, sessionEdges } from '../library/references.js';
import type { SessionFile } from '../sessions/types.js';
import { referencesIn } from './links.js';
import { openIndex } from './open.js';
import { indexSession } from './sessions.js';

/**
 * ***What counts as a reference*** —
 * [03 §10.1](../../../../docs/design/03-data-model.md),
 * [10 §5.2](../../../../docs/design/10-ui-surfaces.md),
 * [P11.7](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * The stage's proof obligation is *"an object referenced by a session, a
 * treatment and a package reports **three**"* — a claim [03 §10.1] makes and
 * one a panel showing *Used by* would otherwise assert only by looking right.
 * The counting is `usedBy`'s and the deciding is here, which is where a wrong
 * answer would come from: **a reference is a link somebody authored, not a
 * mention.**
 */

describe('what an object points at', () => {
  it('reads a setup’s treatment, preset, cast and lore', () => {
    const found = referencesIn(SETUP_SCHEMA, {
      id: 'setup-1',
      treatment: { id: 'treatment-1', name: 'Rain' },
      preset: { id: 'preset-1', name: 'Default' },
      cast: {
        personaOptions: [{ id: 'actor-you', name: 'You' }],
        partyDefault: [{ id: 'actor-vera' }],
        narrator: null,
      },
      lore: [{ ref: { id: 'book-1', name: 'Harbour' }, required: true }],
    });
    expect(new Set(found)).toEqual(
      new Set(['treatment-1', 'preset-1', 'actor-you', 'actor-vera', 'book-1']),
    );
  });

  /**
   * ***Both shapes, because the corpus has both.*** `Setup.treatment` is a
   * `Ref` and a session's `cast.actors` is an array of bare ids; a reader that
   * took only one would silently count half the references, which is worse than
   * counting none because the number still looks like an answer.
   */
  it('reads a bare id as readily as a Ref', () => {
    const found = referencesIn(SETUP_SCHEMA, {
      id: 'setup-1',
      cast: { personaOptions: ['actor-you'], partyDefault: ['actor-vera'], narrator: null },
    });
    expect(new Set(found)).toEqual(new Set(['actor-you', 'actor-vera']));
  });

  it('reads a treatment’s lore and cast', () => {
    const found = referencesIn(TREATMENT_SCHEMA, {
      id: 'treatment-1',
      lore: [{ ref: { id: 'book-1' } }],
      cast: [{ ref: { id: 'actor-vera' } }],
    });
    expect(new Set(found)).toEqual(new Set(['book-1', 'actor-vera']));
  });

  it('reads a World’s contents, which were a Package’s', () => {
    const found = referencesIn(WORLD_SCHEMA, {
      id: 'world-1',
      contents: [{ id: 'actor-vera' }, { id: 'book-1' }],
    });
    expect(new Set(found)).toEqual(new Set(['actor-vera', 'book-1']));
  });

  /**
   * ***Row 5, which this function had no arm for*** — [P16.3b], 2026-10-10.
   * An actor's `lore` is bare `Ref`s ([04 §4]), and until the index read the
   * walker's table it read nothing on an actor at all, so a lorebook's *Used by*
   * never named the actors whose lore links it. *Every shape the reader takes*:
   * a `Ref`, a bare id, a wrapper a hand edit put where the schema says bare —
   * and a `Ref` with a name and no id, which is no link, because the index
   * stores ids as written and never resolves a name.
   */
  it('reads an actor’s lore, which it once read nothing of', () => {
    const found = referencesIn(ACTOR_SCHEMA, {
      id: 'actor-vera',
      lore: [
        { id: 'book-1', name: 'Harbour' },
        'book-2',
        { ref: { id: 'book-3', name: 'Docks' } },
        { id: '', name: 'Only a name' },
      ],
    });
    expect(found).toEqual(['book-1', 'book-2', 'book-3']);
  });

  /**
   * ***A lorebook's entries are inside it, not pointed at by it.*** This is the
   * kind where a generic walk over every `{ id, name }`-shaped value looks most
   * principled and is most wrong: it would produce a table where a book
   * references its own three hundred entries, and *Used by* would answer with
   * the book's own contents.
   *
   * **Kept as the other half of the hook exception below**, and the pair is the
   * point: a lorebook now contributes edges, and this says the reason it does
   * is not *lorebooks contribute edges now*. Entries and folders are still its
   * own contents and still name nothing.
   */
  it('finds nothing in a lorebook, because its entries are its own', () => {
    expect(
      referencesIn(LOREBOOK_SCHEMA, {
        id: 'book-1',
        entries: [{ id: 'entry-1', name: 'The keeper' }],
        folders: [{ id: 'folder-1', name: 'The docks' }],
      }),
    ).toEqual([]);
  });

  it('reports each target once, however many fields name it', () => {
    const found = referencesIn(SETUP_SCHEMA, {
      id: 'setup-1',
      cast: {
        personaOptions: [{ id: 'actor-vera' }],
        partyDefault: [{ id: 'actor-vera' }],
        narrator: null,
      },
    });
    expect(found).toEqual(['actor-vera']);
  });

  it('answers empty for a kind that points at nothing and for a malformed one', () => {
    expect(referencesIn(SETUP_SCHEMA, null)).toEqual([]);
    expect(referencesIn(SETUP_SCHEMA, { id: 'setup-1', lore: 'not an array' })).toEqual([]);
  });
});

/**
 * ***An actor named only by a hook*** —
 * [04 §6.1a](../../../../docs/design/04-schemas.md),
 * [03 §4.1](../../../../docs/design/03-data-model.md),
 * [P11.2](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **The edge that was missing, and the reason it could go missing.** Hooks have
 * been on three carriers since [P7 §1.5] and authorable on none of them, so an actor
 * that only a hook named could not exist to be miscounted. It reads as *used by
 * nothing* — which is the one direction [03 §10.1]'s count must not lie in,
 * because the count is shown at the moment somebody is deciding whether to
 * delete. These tests are written against the shape a real hook has rather than
 * a two-field stub, because the failure being fixed was a reader that never
 * looked, and a stub proves a reader that never looked wrong just as well as it
 * proves one that looks in the wrong place right.
 */
describe('the actors a hook names', () => {
  /** A hook that names one actor through `involves` and nowhere else. */
  function involvingHook(actorId: string): Record<string, unknown> {
    return {
      id: 'hook-debt',
      title: 'The debt comes due',
      premise: 'Somebody calls it in at the worst moment.',
      magnitude: 'local',
      involves: [{ id: actorId, name: 'Vera' }],
      weight: 1,
      delivery: 'guidance',
      once: true,
    };
  }

  /**
   * A hook that **is** an arrival. Its subject sits in `introduces.actor` and,
   * per [04 §6.1a], deliberately *not* in `involves` — the two fields want
   * opposite answers about the same person, so a reader that only read
   * `involves` would find an introduction hook's subject nowhere at all.
   */
  function introducingHook(actorId: string): Record<string, unknown> {
    return {
      id: 'hook-stranger',
      title: 'The stranger at the door',
      premise: '',
      magnitude: 'personal',
      involves: [],
      weight: 1,
      delivery: 'seed',
      once: true,
      introduces: {
        actor: { id: actorId, name: 'The keeper' },
        entrances: [{ id: 'entrance-1', label: 'Out of the rain', text: 'She knocks twice.' }],
        primaryEntranceId: null,
      },
    };
  }

  it('reads an actor a treatment names only through a hook’s involves', () => {
    const found = referencesIn(TREATMENT_SCHEMA, {
      id: 'treatment-1',
      lore: [],
      cast: [],
      hooks: [involvingHook('actor-vera')],
    });
    expect(found).toEqual(['actor-vera']);
  });

  it('reads the actor a treatment’s hook introduces', () => {
    const found = referencesIn(TREATMENT_SCHEMA, {
      id: 'treatment-1',
      lore: [],
      cast: [],
      hooks: [introducingHook('actor-keeper')],
    });
    expect(found).toEqual(['actor-keeper']);
  });

  it('reads both on a setup, whose hooks are additional to the treatment’s', () => {
    const found = referencesIn(SETUP_SCHEMA, {
      id: 'setup-1',
      cast: { personaOptions: [], partyDefault: [], narrator: null },
      lore: [],
      hooks: [involvingHook('actor-vera'), introducingHook('actor-keeper')],
    });
    expect(new Set(found)).toEqual(new Set(['actor-vera', 'actor-keeper']));
  });

  /**
   * ***The arm that used to answer nothing.*** A lorebook returning `[]`
   * outright was right about its entries and wrong about its hooks, and this is
   * the case that makes the difference visible: the same object carries both,
   * and only the hooks' actors come out. The entry and the folder are contents;
   * the actors are links somebody authored.
   */
  it('reads both on a lorebook, and still not its own entries', () => {
    const found = referencesIn(LOREBOOK_SCHEMA, {
      id: 'book-1',
      entries: [{ id: 'entry-1', name: 'The keeper' }],
      folders: [{ id: 'folder-1', name: 'The docks' }],
      hooks: [involvingHook('actor-vera'), introducingHook('actor-keeper')],
    });
    expect(new Set(found)).toEqual(new Set(['actor-vera', 'actor-keeper']));
  });

  /**
   * **A preset keeps the whole of the old argument**, because it has no `hooks`
   * to make an exception for. It is here so that the exception above is a
   * change to one kind rather than to the rule.
   */
  it('finds nothing in a preset', () => {
    expect(
      referencesIn(PRESET_SCHEMA, {
        id: 'preset-1',
        name: 'Default',
        blocks: [{ id: 'block-1', name: 'System' }],
      }),
    ).toEqual([]);
  });

  /**
   * ***Malformed hooks are a rebuild that finishes, not a rebuild that dies.***
   * This index is fed by files people hand-edit, so the question is never
   * whether a bad hook can arrive but what happens when one does: every other
   * reader here answers *nothing, quietly*, and a throw would take a whole
   * rebuild down over one file somebody mistyped.
   */
  it('survives hooks that are absent, or not hooks at all', () => {
    const bare = { id: 'treatment-1', lore: [], cast: [] };
    expect(referencesIn(TREATMENT_SCHEMA, bare)).toEqual([]);
    expect(referencesIn(TREATMENT_SCHEMA, { ...bare, hooks: 'not an array' })).toEqual([]);
    expect(referencesIn(LOREBOOK_SCHEMA, { id: 'book-1', hooks: null })).toEqual([]);
    expect(
      referencesIn(TREATMENT_SCHEMA, {
        ...bare,
        hooks: [
          null,
          'a hook, allegedly',
          { involves: 'not an array' },
          { involves: [null, 42, {}] },
          { introduces: 'not an object' },
          { introduces: {} },
          { introduces: { actor: null } },
        ],
      }),
    ).toEqual([]);
  });
});

/**
 * ***The index and the walker agree about what a reference is*** —
 * [P16.3a](../../../../docs/design/workplan/35-p16-world.md),
 * [04 §9.1](../../../../docs/design/04-schemas.md).
 *
 * `hookActorIds`' docstring said it in advance: *"the two agreeing about hooks
 * is a thing to check rather than a thing either one inherits."* This is the
 * check, for every field, on one object per kind built to name something
 * through each field its rows read — and a session, which reaches the index
 * through `indexSession` rather than `referencesIn`.
 *
 * ~~***The differences are listed, and the list is exact.*** The case fails if a
 * listed difference is not there as surely as if an unlisted one is, so it
 * cannot outlive the thing it describes. As of P16.3a there are three, all of
 * them the index under-counting what 04 §9.1 says is a reference: **an actor's
 * lore** (`referencesIn` has no Actor arm, so a lorebook's *Used by* omits the
 * actors that link it), **a session's treatment** (`indexSession` writes the
 * cast and the books and not the treatment), and **a session's hook pool**
 * (the owner's answer of 2026-10-10 made its actors a row; the index never read
 * the pool). P16.3b points the index at the walker's reader and this table
 * empties.~~
 *
 * ***There are none, and the case says so*** — [P16.3b], 2026-10-10. The index
 * reads the walker's reader now (`referencesIn` is `edgesOf`'s ids, and
 * `indexSession` writes `sessionEdges`'), so the three listed differences went
 * the way the list said they would: removed knowingly, in the stage that
 * removed them. **What keeps this from being a tautology** is that the session
 * half goes through the database — `indexSession`'s write, read back out of
 * `object_link` — and that the portable half fails the day somebody gives
 * `referencesIn` an arm of its own again, which is how the three differences
 * came to exist. The session carries a fired arrival beside an unfired one, so
 * the walker's *only while unfired* rule is held to the index too: the fired
 * hook's subject is in neither list.
 */
describe('the index and the walker agree about what a reference is', () => {
  const ref = (id: string) => ({ id, name: id });
  const hook = (id: string, involves: string, introduces: string) => ({
    id,
    title: id,
    premise: '',
    magnitude: 'local',
    involves: [ref(involves)],
    weight: 1,
    delivery: 'guidance',
    once: true,
    introduces: { actor: ref(introduces), entrances: [], primaryEntranceId: null },
  });

  const bodies: [string, string, unknown][] = [
    [
      'setup',
      SETUP_SCHEMA,
      {
        id: 'setup-1',
        treatment: ref('treatment-1'),
        preset: ref('preset-1'),
        cast: {
          personaOptions: [ref('actor-you')],
          partyDefault: [ref('actor-vera')],
          narrator: ref('actor-voice'),
        },
        lore: [{ ref: ref('book-1'), required: true }],
        hooks: [hook('h-1', 'actor-a', 'actor-b')],
        goals: [{ id: 'goal-1', next: 'goal-2' }],
      },
    ],
    [
      'treatment',
      TREATMENT_SCHEMA,
      {
        id: 'treatment-1',
        lore: [{ ref: ref('book-1'), required: false }],
        cast: [{ ref: ref('actor-vera') }],
        hooks: [hook('h-1', 'actor-a', 'actor-b')],
      },
    ],
    [
      'lorebook',
      LOREBOOK_SCHEMA,
      {
        id: 'book-1',
        scope: { kind: 'world', worldIds: ['world-1'] },
        entries: [{ id: 'entry-1', name: 'The keeper' }],
        hooks: [hook('h-1', 'actor-a', 'actor-b')],
      },
    ],
    ['actor', ACTOR_SCHEMA, { id: 'actor-vera', lore: [ref('book-1'), ref('book-2')] }],
    [
      'world',
      WORLD_SCHEMA,
      {
        id: 'world-1',
        contents: [
          { schema: ACTOR_SCHEMA, id: 'actor-vera', name: 'Vera' },
          { schema: 'storyengine.session/1', id: 'session-1', name: 'Night one' },
        ],
      },
    ],
    ['preset', PRESET_SCHEMA, { id: 'preset-1', blocks: [{ id: 'block-1', name: 'System' }] }],
  ];

  /** Agreement: nothing either one names that the other does not. */
  const NONE = { walkerOnly: [], indexOnly: [] };

  function differences(walker: string[], index: string[]) {
    return {
      walkerOnly: walker.filter((id) => !index.includes(id)),
      indexOnly: index.filter((id) => !walker.includes(id)),
    };
  }

  const walkerIds = (edges: { ref: { id: string | null } }[]): string[] => [
    ...new Set(edges.flatMap((edge) => (edge.ref.id === null ? [] : [edge.ref.id]))),
  ];

  it('on every portable kind, with no exceptions', () => {
    for (const [name, schemaId, body] of bodies) {
      const walker = walkerIds(edgesOf(schemaId, body));
      expect(differences(walker, referencesIn(schemaId, body)), name).toEqual(NONE);
      // Not two empty lists agreeing: every body but the preset's names something.
      if (name !== 'preset') expect(walker.length, name).toBeGreaterThan(0);
    }
  });

  it('on a session, with no exceptions — its treatment and its pool included', async () => {
    const opened = await openIndex({ path: ':memory:' });
    try {
      const session = {
        schema: 'storyengine.session/1',
        id: 'session-1',
        name: 'Night one',
        createdAt: '2026-10-10T00:00:00.000Z',
        updatedAt: '2026-10-10T00:00:00.000Z',
        headTurnId: null,
        // `h-2` has fired: neither reader follows its `introduces.actor` past
        // that, and both still follow its `involves`. *The row as 04 §9.1
        // prints it, questioned at P16.3b's review* — firing put
        // `actor-arrived` in no `cast.actors`, so nothing either reader
        // follows names them now; see `used-by.test.ts`.
        channels: { 'se.hook#h-2': { value: 'fired' } },
        treatment: 'treatment-1',
        lore: ['book-1'],
        cast: { persona: 'actor-you', actors: ['actor-vera'] },
        hooks: [
          { hook: hook('h-1', 'actor-a', 'actor-b'), source: { kind: 'session' } },
          { hook: hook('h-2', 'actor-c', 'actor-arrived'), source: { kind: 'session' } },
        ],
      } as unknown as SessionFile;
      indexSession(opened.db, 'user:ned', session);
      const indexed = (
        opened.db
          .prepare("select to_id from object_link where from_kind = 'session' and from_id = ?")
          .all(session.id) as { to_id: string }[]
      ).map((row) => row.to_id);
      expect(differences(walkerIds(sessionEdges(session)), indexed)).toEqual(NONE);
      // Spelled out, so agreement cannot be two readers both reading nothing.
      expect(new Set(indexed)).toEqual(
        new Set([
          'treatment-1',
          'book-1',
          'actor-you',
          'actor-vera',
          'actor-a',
          'actor-b',
          'actor-c',
        ]),
      );
    } finally {
      opened.close();
    }
  });
});
