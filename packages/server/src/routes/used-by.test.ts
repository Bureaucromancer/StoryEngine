// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, newLorebook, newSetup, newTreatment } from '@storyengine/shared';

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
