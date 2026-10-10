// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ACTOR_SCHEMA, newActor, newLorebook, newSetup, newTreatment } from '@storyengine/shared';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***Referenced by a session, a treatment and a package reports three*** —
 * [03 §10.1](../../../../docs/design/03-data-model.md),
 * [10 §5.2](../../../../docs/design/10-ui-surfaces.md),
 * [P11.7](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * The stage's proof obligation, in the words it was written in: *"an object
 * referenced by a session, a treatment and a package reports **three**, which
 * is the claim [03 §10.1] makes and the one a panel showing *Used by* would
 * otherwise assert only by looking right."*
 *
 * ***The count is the whole assertion and the directions are why.*** `usedBy`
 * asks *who points at me*, and every producer writes in the other direction —
 * a session writes its own cast, an object writes its own refs — so the one
 * thing that cannot be checked by reading either producer is whether the two
 * meet. This makes three files point at one actor through three different code
 * paths and asks the route.
 */

let server: TestServer;
let vera: string;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
  const actor = newActor('Vera');
  await server.request({ method: 'POST', url: '/api/library/actors', payload: actor });
  vera = actor.id;
});

afterEach(async () => {
  await server.dispose();
});

async function usedBy(): Promise<{ fromKind: string; fromName: string }[]> {
  const response = await server.request({
    method: 'GET',
    url: `/api/library/actors/${vera}/links`,
  });
  expect(response.status).toBe(200);
  return response.body.usedBy as { fromKind: string; fromName: string }[];
}

describe('who points at an object', () => {
  it('is nobody, for an object nothing uses', async () => {
    expect(await usedBy()).toEqual([]);
  });

  it('counts a session, a treatment and a setup as three', async () => {
    await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain City', cast: { persona: null, actors: [vera] } },
    });

    const treatment = {
      ...newTreatment('Harbour nights'),
      cast: [{ ref: { id: vera, name: 'Vera' }, billing: 'npc' as const, note: '' }],
    };
    await server.request({ method: 'POST', url: '/api/library/treatments', payload: treatment });

    /**
     * ***The setup is the one that found a real bug***, and it is why this test
     * makes each producer through its own route rather than asserting about
     * `referencesIn` three times. A setup's cast is
     * `{ personaOptions, partyDefault, narrator }`; the reader was written
     * against `{ persona, actors }`, which is a **session**'s shape, and found
     * nothing — silently, because an absent field and an empty list are
     * indistinguishable there. *The unit test agreed with the bug, because it
     * was written from the same wrong picture.*
     */
    const setup = {
      ...newSetup('A night at the docks'),
      cast: { personaOptions: [], partyDefault: [{ id: vera, name: 'Vera' }], narrator: null },
    };
    await server.request({ method: 'POST', url: '/api/library/setups', payload: setup });

    const book = newLorebook('Harbour lore');
    await server.request({ method: 'POST', url: '/api/library/lorebooks', payload: book });

    const used = await usedBy();
    expect(used).toHaveLength(3);
    expect(used.map((one) => one.fromName).sort()).toEqual([
      'A night at the docks',
      'Harbour nights',
      'Rain City',
    ]);

    /**
     * ***And the book is not among them***, which is the negative half: a
     * lorebook points at nothing, so creating one must not change an actor's
     * count. The mutation this catches is a generic walk over every
     * `{ id, name }` in a document, which would have counted the book's own
     * entries as references and made this number grow with the corpus.
     */
    expect(used.some((one) => one.fromName === 'Harbour lore')).toBe(false);
  });

  /**
   * ***A deleted user stops being a user*** — the count is about now.
   * [03 §10.2] makes delete a move, and an actor still reported as used by a
   * setup somebody binned this morning would make the delete confirmation lie
   * in the direction that stops people tidying up.
   */
  it('drops a reference when the thing making it is deleted', async () => {
    const treatment = {
      ...newTreatment('Harbour nights'),
      cast: [{ ref: { id: vera, name: 'Vera' }, billing: 'npc' as const, note: '' }],
    };
    const created = await server.request({
      method: 'POST',
      url: '/api/library/treatments',
      payload: treatment,
    });
    expect(created.status).toBe(201);
    expect(await usedBy()).toHaveLength(1);

    const removed = await server.request({
      method: 'DELETE',
      url: `/api/library/treatments/${treatment.id}`,
      headers: { 'if-match': created.body.contentHash as string },
    });
    expect(removed.status).toBe(204);

    expect(await usedBy()).toEqual([]);
  });
});

/**
 * ***Who points at an object, read off 04 §9.1's table*** —
 * [04 §9.1](../../../../docs/design/04-schemas.md),
 * [10 §5.2](../../../../docs/design/10-ui-surfaces.md),
 * [P16.3b](../../../../docs/design/workplan/35-p16-world.md).
 *
 * The index reads the publish walker's reader since P16.3b, and these are the
 * three answers that grew when it did — *and a fourth since the correction of
 * 2026-10-10, the actors a session plays with that its roster does not name* —
 * each asked of the route the client's
 * *Used by* panel and delete confirmation read (`readUsedBy` in the client's
 * `api.ts`), each made through the routes that make the referring thing, for
 * the reason the case above gives: the deciding and the counting are written
 * in opposite directions, and only the route sees whether they meet.
 */
describe('who points at an object, as 04 §9.1 names it', () => {
  async function linksOf(
    kind: string,
    id: string,
  ): Promise<{ fromKind: string; fromId: string; fromName: string }[]> {
    const response = await server.request({
      method: 'GET',
      url: `/api/library/${kind}/${id}/links`,
    });
    expect(response.status).toBe(200);
    return response.body.usedBy as { fromKind: string; fromId: string; fromName: string }[];
  }

  async function startSession(payload: Record<string, unknown>): Promise<string> {
    const created = await server.request({ method: 'POST', url: '/api/sessions', payload });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.body.session.id as string;
  }

  /**
   * ***Row 5, and [10 §5.2]'s own list*** — *"Actors, setups and Worlds follow
   * as ordinary rows."* An actor's `lore` is bare `Ref`s, and until P16.3b the
   * index read nothing on an actor, so the book an actor depends on said it was
   * used by nobody — the direction the delete confirmation must not lie in.
   */
  it('a lorebook’s Used by names the actors that link it', async () => {
    const book = newLorebook('Harbour lore');
    await server.request({ method: 'POST', url: '/api/library/lorebooks', payload: book });
    const marlow = { ...newActor('Marlow'), lore: [{ id: book.id, name: book.name }] };
    const made = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: marlow,
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);

    expect(await linksOf('lorebooks', book.id)).toEqual([
      { fromKind: ACTOR_SCHEMA, fromId: marlow.id, fromName: 'Marlow' },
    ]);
  });

  /**
   * ***A session's treatment, which `indexSession` never wrote.*** A treatment
   * played as three stories reported none of them, so the delete confirmation
   * offered to bin it as used by nothing. *Counts*, not names: two sessions
   * with one name are two uses, and a session started without it is none.
   */
  it('a treatment’s Used by counts the sessions played under it', async () => {
    const treatment = newTreatment('Harbour nights');
    await server.request({ method: 'POST', url: '/api/library/treatments', payload: treatment });

    const first = await startSession({ name: 'Rain City', treatment: treatment.id });
    const second = await startSession({ name: 'Rain City', treatment: treatment.id });
    await startSession({ name: 'Elsewhere' });

    const used = await linksOf('treatments', treatment.id);
    expect(used.map((one) => [one.fromKind, one.fromId]).sort()).toEqual(
      [
        ['session', first],
        ['session', second],
      ].sort(),
    );
  });

  /**
   * ***The pool's actors, and ~~the rule that moves with play~~ a rule that
   * does not*** — row 13's second clause, the owner's answer of 2026-10-10. A
   * pooled hook names its `involves` for as long as it is in the pool, and its
   * `introduces.actor` ~~only while the hook has not fired~~ *fired or not*:
   * the walker's rule, and the index's, because they are one function.
   *
   * **Fired through the door a person uses** — the hook panel's channel write,
   * which appends a turn like any other — so this also proves the index is
   * refreshed when a hook fires rather than only when the session is next
   * saved for some other reason: the session is written once, here, and the
   * link goes with it.
   *
   * ~~***The second half pins the row as 04 §9.1 prints it, and the row is
   * questioned*** (2026-10-10, at P16.3b's review). Its reason for stopping at
   * the firing — *the subject has arrived and is in the cast, which the row
   * reaches anyway* — holds for the cast a turn is played with (`resolveCast`
   * unions the roster with whoever the channels name) and not for the `cast`
   * field the row reads: firing adds nobody to `cast.actors`. So the assertion
   * after the firing is the session dropping out of the keeper's *Used by*, and
   * out of the count the delete confirmation shows, **at the moment the keeper
   * enters the story** — under-counting, which `usedBy`'s docstring calls the
   * direction that makes [03 §10.1]'s confirmation lie. It is asserted because
   * it is what the row says and the walker does, not because it is settled: the
   * decision is the owner's, on 04 §9.1's row 13, and if it goes the other way
   * this assertion and `links.test.ts`'s session parity case flip with it. See
   * `sessionEdges`' and `indexSession`'s notes.~~
   *
   * ***Flipped 2026-10-10*** — the correction after P16.3b's review, as the
   * struck paragraph said it would be. The struck reason was false of the roster
   * the row read, so the keeper's *Used by* lost the session at the moment the
   * keeper entered the story; the row now names every pooled arrival's subject
   * whatever the hook's state, because the owner's answer is about the actors a
   * session's hooks name. So the firing changes nothing here, and the second
   * half asserts exactly that — the session stays in the keeper's *Used by* and
   * in the count the delete confirmation shows. *When the story then walks the
   * keeper in*, the played cast names him too (`session.cast.arrived`, the case
   * below); `usedBy` is one row per thing that names, so that adds no row.
   */
  it('an actor named by a session’s arrival hook lists that session, fired or not', async () => {
    const keeper = newActor('The keeper');
    await server.request({ method: 'POST', url: '/api/library/actors', payload: keeper });
    const session = await startSession({ name: 'Night one' });

    const added = await server.request({
      method: 'POST',
      url: `/api/sessions/${session}/hooks`,
      payload: {
        hook: {
          id: 'hook-stranger',
          title: 'The stranger at the door',
          premise: 'Somebody knocks who should not know the way.',
          magnitude: 'personal',
          involves: [{ id: vera, name: 'Vera' }],
          weight: 1,
          delivery: 'seed',
          once: true,
          introduces: {
            actor: { id: keeper.id, name: 'The keeper' },
            entrances: [],
            primaryEntranceId: null,
          },
        },
      },
    });
    expect(added.status, JSON.stringify(added.body)).toBe(200);

    const bySession = (used: { fromKind: string; fromId: string }[]) =>
      used.filter((one) => one.fromKind === 'session' && one.fromId === session);
    expect(bySession(await linksOf('actors', keeper.id))).toHaveLength(1);
    expect(bySession(await linksOf('actors', vera))).toHaveLength(1);

    const fired = await server.request({
      method: 'PUT',
      url: `/api/sessions/${session}/channels/${encodeURIComponent('se.hook#hook-stranger')}`,
      payload: { value: 'fired' },
    });
    expect(fired.status, JSON.stringify(fired.body)).toBe(200);
    expect(fired.body.effect.applied).toBe(true);

    // ~~`toEqual([])`, as row 13 stood~~ — the fired hook still names him.
    expect(bySession(await linksOf('actors', keeper.id))).toHaveLength(1);
    // `involves` is not the subject: a fired hook that involved Vera still names her.
    expect(bySession(await linksOf('actors', vera))).toHaveLength(1);
  });

  /**
   * ***Row 13's played cast, through the door a person uses*** — 2026-10-10,
   * the correction after P16.3b's review. A person gives a stranger presence
   * by hand (`PUT /sessions/:id/channels/se.presence#<id>`, the write the
   * narrator's presence effect also makes); the stranger is in no
   * `cast.actors` and in every turn `resolveCast` assembles from here on, so
   * the session is in his *Used by* — and the delete confirmation counts it —
   * as an actor who **arrived during play**.
   *
   * ***And rewinding past the arrival takes it away.*** `PUT /sessions/:id/head`
   * back to before the first turn rebuilds the head's channels without the
   * write, and writes the session through the index as every head move does;
   * the stranger is no longer in the cast the session plays with, so he is no
   * longer used by it. Vera, on the roster, is unmoved by either.
   */
  it('an actor who arrived during play lists the session that walked them in, until a rewind takes them out', async () => {
    const stranger = newActor('A stranger');
    await server.request({ method: 'POST', url: '/api/library/actors', payload: stranger });
    const session = await startSession({
      name: 'Night one',
      cast: { persona: null, actors: [vera] },
    });
    const bySession = (used: { fromKind: string; fromId: string }[]) =>
      used.filter((one) => one.fromKind === 'session' && one.fromId === session);
    expect(bySession(await linksOf('actors', stranger.id))).toEqual([]);

    const walkedIn = await server.request({
      method: 'PUT',
      url: `/api/sessions/${session}/channels/${encodeURIComponent(`se.presence#${stranger.id}`)}`,
      payload: { value: true },
    });
    expect(walkedIn.status, JSON.stringify(walkedIn.body)).toBe(200);
    expect(walkedIn.body.effect.applied).toBe(true);
    // Not on the roster: what names him is the channel, and only the channel.
    expect(walkedIn.body.session.cast.actors).toEqual([vera]);

    expect(bySession(await linksOf('actors', stranger.id))).toHaveLength(1);
    expect(bySession(await linksOf('actors', vera))).toHaveLength(1);

    const rewound = await server.request({
      method: 'PUT',
      url: `/api/sessions/${session}/head`,
      payload: { turnId: null },
    });
    expect(rewound.status, JSON.stringify(rewound.body)).toBe(200);

    expect(bySession(await linksOf('actors', stranger.id))).toEqual([]);
    expect(bySession(await linksOf('actors', vera))).toHaveLength(1);
  });
});
