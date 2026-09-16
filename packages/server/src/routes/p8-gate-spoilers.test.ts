// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, newTreatment, uuidv7, type Turn } from '@storyengine/shared';

import { memoryBookFor } from '../memory/books.js';
import { rememberThis } from '../memory/capture.js';
import { appendTurnToSession, deleteSession, readSession } from '../sessions/store.js';
import { resolveLore } from '../turns/lore.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***The spoiler defences at their cheap end, and [P8 §1.7]'s three small
 * things*** — [P8.5] under [P8 §5]'s fallback cut.
 *
 * **What the cut changes about this stage, said plainly.** §P8.5's obligation is
 * *a premise and an unfired entrance are absent from the second session's book*,
 * and that is a statement about an **extractor**, which §5's cut defers. What
 * remains is the half that has a subject: `memory/capture.test.ts` holds the
 * refusal — *a turn a hook fired on is declined, with a reason* — over the only
 * writer this build has. **This file holds the two things that are not about the
 * writer at all**: 08 §6's cheapest mitigation, and the deletion behaviour two
 * documents had already agreed on without noticing.
 *
 * ---
 *
 * ***Gate step 9*** — *"creating a session in a treatment that already has one
 * offers start isolated."* [08 §6] lists it first among the mitigations, *in
 * order of how much they cost*: **cheap, and catches the common case.** It is
 * also the *one obvious action* [08 §4]'s `[OPEN]` asks for — that paragraph
 * leaves `share: true` by default unresolved and says the mitigation is that
 * **isolating a session must be one obvious action rather than two toggles found
 * in a drawer.**
 *
 * ***And [P8 §1.7], which turned out not to be an open question.***
 * [03 §10.3](../../../../docs/design/03-data-model.md) had decided it and
 * [08 §8] did not know: *"it does not reach into other sessions to remove what
 * this one wrote. A session that… wrote a cross-session memory, leaves those
 * behind."* Not *ask* — **tell**. §1.7 resolves it to three small things and no
 * dialogue, and the first of them is *already true; the work is the test that
 * pins it.* This is that test.
 */

const PASSWORD = 'correct horse battery';

let dataDir: string;
let server: TestServer;
let vera: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-p8-spoilers-'));
  server = await makeTestServer({ dataDir });
  await setUpAdmin(server, 'ned', PASSWORD);

  const actor = newActor('Vera');
  await server.request({ method: 'POST', url: '/api/library/actors', payload: actor });
  vera = actor.id;
});

afterEach(async () => {
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

async function aTreatment(name: string): Promise<string> {
  const treatment = newTreatment(name);
  const created = await server.request({
    method: 'POST',
    url: '/api/library/treatments',
    payload: treatment,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return treatment.id;
}

async function aSession(name: string, treatment?: string): Promise<{ id: string; body: any }> {
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: {
      name,
      cast: { persona: null, actors: [vera] },
      ...(treatment === undefined ? {} : { treatment }),
    },
  });
  return { id: created.body.session.id as string, body: created.body };
}

async function aTurn(sessionId: string): Promise<string> {
  const session = await readSession(server.services.sessions, 'ned', sessionId);
  const turn: Turn = {
    id: uuidv7(),
    sessionId,
    parentTurnId: session?.headTurnId ?? null,
    createdAt: new Date().toISOString(),
    status: 'complete',
    input: { actorId: null, kind: 'do', text: 'She waited.', raw: 'She waited.' },
    output: { text: 'The ferryman took her coin.' },
    effects: [],
    tape: [],
  };
  await appendTurnToSession(server.services.sessions, 'ned', sessionId, turn);
  return turn.id;
}

describe('a second story in the same treatment says so', () => {
  it('says which sessions have played it, and does not say so for the first', async () => {
    const noir = await aTreatment('Rain City');

    const first = await aSession('One', noir);
    // **The first session warns about nothing**, which is the control: a warning
    // that appeared on every creation would be furniture rather than a mitigation.
    expect(first.body.sharesTreatmentWith).toBeUndefined();

    const second = await aSession('Two', noir);
    expect(second.body.sharesTreatmentWith).toEqual([{ sessionId: first.id, name: 'One' }]);

    // And a session under a different treatment is not a replay of this one.
    const elsewhere = await aSession('Elsewhere', await aTreatment('Somewhere Else'));
    expect(elsewhere.body.sharesTreatmentWith).toBeUndefined();
  });

  /**
   * ***Start isolated, in one action*** — the offer, exercised through the route
   * the control calls. Both switches off is what *isolated* means: nothing comes
   * in, and nothing this playthrough produces goes out to colour the next.
   */
  it('seals a session in one call, and the seal holds both ways', async () => {
    const noir = await aTreatment('Rain City');
    const first = await aSession('One', noir);
    await rememberThis(server.services.sessions, server.services.library, 'ned', first.id, {
      turnId: await aTurn(first.id),
      actorId: vera,
      text: 'He takes coin, not names.',
      keys: ['ferryman'],
    });

    const replay = await aSession('Two', noir);
    expect(replay.body.sharesTreatmentWith).toHaveLength(1);

    const sealed = await server.request({
      method: 'PUT',
      url: `/api/sessions/${replay.id}/memory`,
      payload: { share: false, intake: false, acrossPersonas: false, associations: {} },
    });
    expect(sealed.status).toBe(200);

    const session = await readSession(server.services.sessions, 'ned', replay.id);
    expect(
      resolveLore(server.services.library, 'ned', session).books.filter(
        (book) => book.by === 'memory',
      ),
    ).toEqual([]);

    const refused = await rememberThis(
      server.services.sessions,
      server.services.library,
      'ned',
      replay.id,
      { turnId: await aTurn(replay.id), actorId: vera, text: 'Twist.', keys: ['twist'] },
    );
    expect(refused.kind).toBe('refused');
  });
});

describe('deleting a session leaves what it wrote elsewhere', () => {
  /**
   * ***[03 §10.3]'s rule, pinned*** — [P8 §1.7]'s first item, which that section
   * found *"already true; the work is the test that pins it."*
   *
   * **The premise the old lean rested on argues against the lean.** [08 §8]
   * wanted to *ask, defaulting to keep*, on the grounds that the answer interacts
   * with P11's trash retention — and that interaction is the reason **not** to
   * ask: a delete is a move, so nothing is gone, and a modal demanding a decision
   * about forty memory entries at the moment somebody tidies up is a decision
   * demanded about a reversible act.
   */
  it('keeps the memories and leaves the origin naming a session that is gone', async () => {
    const first = await aSession('One');
    await rememberThis(server.services.sessions, server.services.library, 'ned', first.id, {
      turnId: await aTurn(first.id),
      actorId: vera,
      text: 'He takes coin, not names.',
      keys: ['ferryman'],
    });

    await deleteSession(server.services.sessions, 'ned', first.id);
    expect((await server.request({ method: 'GET', url: `/api/sessions/${first.id}` })).status).toBe(
      404,
    );

    const book = memoryBookFor(server.services.library, 'ned', { actor: vera, persona: null });
    expect(book?.book.entries).toHaveLength(1);

    /**
     * ***And the origin still names the session that is gone***, which is
     * §1.7's second item: **a rendering of an absence, not a field.** A written
     * *this session was deleted* marking would become a lie the moment the
     * folder came back from trash, because a delete is a move ([03 §10.2]) until
     * the retention window closes. The client resolves the id and renders *a
     * session you have deleted* when it finds nothing — the posture
     * `turns/lore.ts`'s `MissingLink` takes, and [00 §3.3]'s.
     */
    expect((book?.book.entries[0]?.metadata['se.memory'] as { sessionId?: string }).sessionId).toBe(
      first.id,
    );

    // And a later session still reads it, which is the whole point of keeping it.
    const second = await aSession('Two');
    const session = await readSession(server.services.sessions, 'ned', second.id);
    expect(
      resolveLore(server.services.library, 'ned', session)
        .books.filter((one) => one.by === 'memory')
        .flatMap((one) => one.book.entries.map((entry) => entry.content)),
    ).toEqual(['He takes coin, not names.']);
  });
});
