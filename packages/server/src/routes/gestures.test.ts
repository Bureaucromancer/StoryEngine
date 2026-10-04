// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  newActor,
  newLoreEntry,
  newLorebook,
  newSetup,
  uuidv7,
  type OutputMessage,
  type Turn,
} from '@storyengine/shared';

import { CONTINUE_NUDGE } from '../assembly/collect.js';
import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type SseFrame, type TestServer } from '../test-server.js';

/**
 * ***Every row of §1.6's table, through the route*** —
 * [P14 §1.6](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)
 * and [§1.7](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * built at [P14.4], whose *Ends at* this file is: *"every row of §1.6's table
 * has a route test, and a new session opens on its greeting with the
 * alternates as siblings."*
 *
 * **Played on Scene itself**, the mode the table is about, rather than on a
 * fixture: what is proved is that a chat's gestures land on the tree the way
 * the table says, which is a claim about the shipped mode and its pack. The
 * speaker policy is Scene's `natural`, so every test that needs a known order
 * gets it by force-talk — the one choice of speaker the route itself makes.
 *
 * `turns/runner-gestures.test.ts` proves what the runner does with a swipe
 * and a continue it is handed; this proves what the route hands it, and
 * refuses.
 */

let server: TestServer;
let provider: FakeProvider;

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a31';
/** The budget `force-talk.test.ts` uses for a whole turn, for its reason. */
const TURN_FINISHES_MS = 8_000;

const finished = (frame: SseFrame): boolean =>
  frame.event === 'progress' && (frame.data as { key: string }).key === 'turn.finished';

beforeEach(async () => {
  // One double for the server, so its request log is every call any turn made
  // — which is what *"an edit makes no call"* is asserted against.
  provider = new FakeProvider();
  server = await makeTestServer({
    providers: () => provider,
    config: {
      sessions: { snapshotEveryNTurns: 10, streamKeepaliveMs: 15000, streamCoalesceMs: 0 },
    },
  });
  await setUpAdmin(server, 'ned');

  const root = new Layout(server.dataDir).userConnectionsRoot('ned');
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'fake.json'),
    JSON.stringify({
      id: CONNECTION_ID,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-hi'],
    }),
  );
  await writeFile(
    join(server.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );
});

afterEach(async () => {
  await server.dispose();
});

/** A card, with written openings — the first the primary unless `primary` says. */
async function anActor(name: string, openings: string[] = [], primary = 0): Promise<string> {
  const made = newActor(name);
  const written = openings.map((text, index) => ({
    id: uuidv7(),
    label: `Opening ${String(index + 1)}`,
    text,
  }));
  const actor = {
    ...made,
    openings: {
      ...made.openings,
      written,
      primaryWrittenId: written[primary]?.id ?? null,
    },
  };
  const created = await server.request({
    method: 'POST',
    url: '/api/library/actors',
    payload: actor,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return actor.id;
}

/** The ids of a card's written openings, in order. */
async function openingIds(actorId: string): Promise<string[]> {
  const read = await server.request({ method: 'GET', url: `/api/library/actors/${actorId}` });
  const body = (read.body.object ?? read.body) as {
    body?: { openings: { written: { id: string }[] } };
    openings?: { written: { id: string }[] };
  };
  const openings = body.body?.openings ?? body.openings;
  return (openings?.written ?? []).map((opening) => opening.id);
}

async function aSession(
  actors: string[],
  persona: string | null = null,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; headTurnId: string | null }> {
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Harbour', cast: { persona, actors }, ...extra },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return {
    id: created.body.session.id as string,
    headTurnId: created.body.session.headTurnId as string | null,
  };
}

async function head(sessionId: string): Promise<string | null> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  return read.body.session.headTurnId as string | null;
}

async function turn(sessionId: string, turnId: string): Promise<Turn> {
  const read = await server.request({
    method: 'GET',
    url: `/api/sessions/${sessionId}/turns/${turnId}`,
  });
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  return read.body.turn as Turn;
}

function submit(
  sessionId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  return server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: uuidv7(), ...body },
  });
}

/** Submits against the current head unless the body says otherwise, and waits for the turn. */
async function play(
  sessionId: string,
  body: Record<string, unknown>,
  script?: ScriptedReply[],
): Promise<Turn> {
  if (script !== undefined) provider.setScript(script);
  const submitted = await submit(sessionId, { headTurnId: await head(sessionId), ...body });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);
  const stream = await server.stream({ url: submitted.body.stream as string });
  await stream.until(finished, TURN_FINISHES_MS);
  await stream.abort();
  return turn(sessionId, submitted.body.turnId as string);
}

/** A PNG by its signature, which is all the attachment store checks. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7, 7]);

/** Puts a picture in the session's store, as `attachments.test.ts` does, and returns its digest. */
async function attach(sessionId: string): Promise<string> {
  const boundary = '----se';
  const open = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const sent = await server.app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/attachments`,
    payload: Buffer.concat([Buffer.from(open), PNG, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      cookie: [...server.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      'x-csrf-token': server.cookies.get('se_csrf') ?? '',
    },
  });
  expect(sent.statusCode, sent.body).toBe(201);
  return sent.json<{ attachment: { digest: string } }>().attachment.digest;
}

/** The session's hide map, as the record holds it. */
async function hiddenOf(sessionId: string): Promise<Record<string, true | number[]> | undefined> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  return read.body.session.hidden as Record<string, true | number[]> | undefined;
}

/** The ids of the blocks a turn's first call sent. */
function sentIds(played: Turn): string[] {
  return (played.request?.calls[0]?.blocks ?? []).map((block) => block.id);
}

/** Who said what, as a reader of the transcript sees it. */
function said(played: Turn): { by: string | null; text: string; carried?: true }[] {
  return (played.output?.messages ?? []).map((message: OutputMessage) => ({
    by: message.speaker?.name ?? null,
    text: message.text,
    ...(message.carried === true ? { carried: true as const } : {}),
  }));
}

/** A request as a reader sees it — role and words, the last `n` of them. */
function lastSent(at: number, n: number): { role: string; content: string }[] {
  return (provider.requests[at]?.messages ?? [])
    .slice(-n)
    .map((message) => ({ role: message.role, content: message.content }));
}

describe('§1.7 — the opening turn at creation', () => {
  it('opens a single-character chat on the primary, each alternate a sibling', async () => {
    const ned = await anActor('Ned');
    const vera = await anActor('Vera', [
      'Vera looks up. "{{user}}. You came."',
      '"Late again, {{user}}," says {{char}}.',
    ]);
    const session = await aSession([vera], ned);

    // The head is on the primary, and it was written as a greeting is: no
    // call, no request, the session's names in it.
    expect(session.headTurnId).not.toBeNull();
    const primary = await turn(session.id, session.headTurnId ?? '');
    expect(said(primary)).toEqual([{ by: 'Vera', text: 'Vera looks up. "Ned. You came."' }]);
    expect(primary.parentTurnId).toBeNull();
    expect(primary.input).toBeUndefined();
    expect(primary.request).toBeUndefined();
    expect(provider.requests).toHaveLength(0);

    // The alternate is a sibling — a root beside it, primary first.
    const listed = await server.request({
      method: 'GET',
      url: `/api/sessions/${session.id}/turns`,
    });
    const siblings = listed.body.siblings as Record<string, string[]>;
    const strip = siblings[primary.id] ?? [];
    expect(strip).toHaveLength(2);
    expect(strip[0]).toBe(primary.id);
    const alternate = await turn(session.id, strip[1] ?? '');
    expect(said(alternate)).toEqual([{ by: 'Vera', text: '"Late again, Ned," says Vera.' }]);
  });

  it('starts on the alternate the creation form chose', async () => {
    const vera = await anActor('Vera', ['First.', 'Second.']);
    const [, second] = await openingIds(vera);
    const session = await aSession([vera], null, { openings: { [vera]: second } });
    expect(said(await turn(session.id, session.headTurnId ?? ''))).toEqual([
      { by: 'Vera', text: 'Second.' },
    ]);
  });

  it("opens a group on each member's opening, one message each, in cast order", async () => {
    const vera = await anActor('Vera', ['"You came."', '"Again?"']);
    const mute = await anActor('Abel');
    const lund = await anActor('Lund', ['Lund nods to {{user}}.']);
    const [, again] = await openingIds(vera);
    const session = await aSession([lund, mute, vera], null, { openings: { [vera]: again } });

    const opening = await turn(session.id, session.headTurnId ?? '');
    // Abel has nothing written and says nothing; the player with no persona
    // is "the player", as the prompt calls them.
    expect(said(opening)).toEqual([
      { by: 'Lund', text: 'Lund nods to the player.' },
      { by: 'Vera', text: '"Again?"' },
    ]);
    const listed = await server.request({
      method: 'GET',
      url: `/api/sessions/${session.id}/turns`,
    });
    expect(listed.body.siblings).toEqual({});
  });

  it('refuses a choice that names nothing, before any session exists', async () => {
    const vera = await anActor('Vera', ['Hello.']);
    const before = await server.request({ method: 'GET', url: '/api/sessions' });
    const refused = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { cast: { persona: null, actors: [vera] }, openings: { [vera]: uuidv7() } },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('unknown-opening');
    const after = await server.request({ method: 'GET', url: '/api/sessions' });
    expect(after.body.sessions).toHaveLength((before.body.sessions as unknown[]).length);
  });

  it('writes no opening for a mode that does not declare one, or a cast with nothing written', async () => {
    const vera = await anActor('Vera', ['Hello.']);
    // The assistant is embodied too, which is why the opening is a mode's
    // declaration and not a reading of the voice.
    const assistant = await aSession([vera], null, { mode: 'storyengine.assistant' });
    expect(assistant.headTurnId).toBeNull();
    const silent = await aSession([await anActor('Lund')]);
    expect(silent.headTurnId).toBeNull();
  });
});

/**
 * ***§1.7 beside a Setup*** — the merge's one account of turn 1
 * (`sessions/opening.ts`, 2026-10-03), through the route and on Scene, the
 * mode whose greetings it is about. `sessions/opening.test.ts` holds every
 * rule over values; what is here is that the route hands it the cast and
 * writes what it answers.
 */
describe('§1.7 beside a Setup — what a session started from one opens on', () => {
  async function aSetup(over: Record<string, unknown>): Promise<string> {
    const made = { ...newSetup('The Harbour'), ...over };
    const created = await server.request({
      method: 'POST',
      url: '/api/library/setups',
      payload: made,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.body.object.id as string;
  }

  /** A Setup seating `actorId`, with `openings` when it carries any. */
  const seating = (actorId: string, openings?: unknown): Record<string, unknown> => ({
    cast: { personaOptions: [], partyDefault: [{ id: actorId, name: 'Vera' }], narrator: null },
    ...(openings === undefined ? {} : { openings }),
  });
  const QUAY = {
    written: [{ id: 'o-quay', label: 'The quay', text: 'Fog on the quay.' }],
    seeds: [],
    primaryWrittenId: 'o-quay',
    primarySeedId: null,
  };

  async function started(
    payload: Record<string, unknown>,
  ): Promise<{ id: string; path: Turn[]; siblings: Record<string, string[]> }> {
    const created = await server.request({ method: 'POST', url: '/api/sessions', payload });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.session.id as string;
    const listed = await server.request({ method: 'GET', url: `/api/sessions/${id}/turns` });
    return {
      id,
      path: listed.body.turns as Turn[],
      siblings: listed.body.siblings as Record<string, string[]>,
    };
  }

  /**
   * ***The owner's decision, 2026-10-03 — [26 B18](../../../../docs/design/26-open-questions.md).*** Mutation: make
   * `firstTurns`' `setupWins` false and the greeting is written on top of the
   * opening, so the path is two turns long.
   */
  it('opens on the Setup’s opening and writes no greeting, chosen or started cold', async () => {
    const vera = await anActor('Vera', ['"You came."', '"Late again."']);
    const setup = await aSetup(seating(vera, QUAY));

    const chosen = await started({ setup });
    expect(chosen.path).toHaveLength(1);
    expect(chosen.path[0]?.output?.text).toBe('Fog on the quay.');
    expect(chosen.siblings).toEqual({});

    // Started cold, the session still writes no greeting: only the seating,
    // on a turn that says nothing. Mutation: drop `carriesOpening` from the
    // rule and the greeting is written on top of it.
    const cold = await started({ setup, opening: null });
    expect(cold.path).toHaveLength(1);
    expect(cold.path[0]?.output).toBeUndefined();
    expect(cold.path[0]?.effects.map((effect) => [effect.channelId, effect.scopeKey])).toEqual([
      ['se.party', vera],
    ]);
    expect(provider.requests).toHaveLength(0);
  });

  /**
   * ***Rule 3 — recommended answer, owner deferred, 2026-10-03.*** Mutation:
   * hang the greetings at the root and the path is the greeting alone, with
   * Vera never seated.
   */
  it('hangs the greetings from what a Setup with no opening seats', async () => {
    const vera = await anActor('Vera', ['"You came."', '"Late again."']);
    const { id, path, siblings } = await started({ setup: await aSetup(seating(vera)) });

    expect(path).toHaveLength(2);
    const [seat, greeting] = path;
    if (seat === undefined || greeting === undefined) throw new Error('two turns, checked above');
    expect(seat.output).toBeUndefined();
    expect(seat.effects.map((effect) => [effect.channelId, effect.scopeKey, effect.after])).toEqual(
      [['se.party', vera, 'companion']],
    );
    expect(greeting.parentTurnId).toBe(seat.id);
    expect(said(greeting)).toEqual([{ by: 'Vera', text: '"You came."' }]);
    // The alternate is still a swipe away, a sibling under the seating.
    expect(siblings[greeting.id]).toHaveLength(2);

    // And the head is seated, read through the panel a person sees.
    const read = await server.request({ method: 'GET', url: `/api/sessions/${id}` });
    const rows = read.body.cast as { actorId: string; party: string | null }[];
    expect(rows.find((row) => row.actorId === vera)?.party).toBe('companion');
  });

  /**
   * ***A whole-turn redo of a greeting is refused, a swipe of one is not***
   * — `refuseOpening`, recommended answer, owner deferred, 2026-10-03.
   * Mutations: delete the refusal and the two submissions are accepted; drop
   * its `fromMessage` exemption and the swipe — P14's Swipe on a greeting
   * line — is refused.
   */
  it('refuses a whole-turn redo of a greeting, and swipes one', async () => {
    const vera = await anActor('Vera', ['"Evening."']);
    const { id, headTurnId } = await aSession([vera]);
    const greeting = headTurnId ?? '';

    for (const field of ['rewriteOf', 'redoOf'] as const) {
      const refused = await submit(id, { headTurnId, parentTurnId: null, [field]: greeting });
      expect([refused.status, refused.body.error], field).toEqual([422, 'opening-turn']);
    }

    const swiped = await play(id, { rewriteOf: greeting, fromMessage: 0 }, [
      { text: '"Well, well."' },
    ]);
    expect(swiped.parentTurnId).toBeNull();
    expect(said(swiped)).toEqual([{ by: 'Vera', text: '"Well, well."' }]);
  });

  /**
   * ***A let-them-talk reply is redone***: it answered no move but made a
   * call, so the convention reads `request` as well as `input`. Mutation: let
   * `redoable` read `input` alone and this redo is refused.
   */
  it('redoes a reply to nothing, which made a call', async () => {
    const vera = await anActor('Vera', ['"Evening."']);
    const { id } = await aSession([vera]);
    const first = await play(id, {}, [{ text: 'Vera pours another glass.' }]);
    expect(first.input).toBeUndefined();
    expect(first.request).toBeDefined();

    const again = await play(id, { redoOf: first.id, parentTurnId: first.parentTurnId }, [
      { text: 'Vera waits.' },
    ]);
    expect(again.parentTurnId).toBe(first.parentTurnId);
    expect(said(again)).toEqual([{ by: 'Vera', text: 'Vera waits.' }]);
  });
});

describe('§1.6 — the gestures', () => {
  it('Send: a turn with input, speakers by policy', async () => {
    const vera = await anActor('Vera');
    const { id } = await aSession([vera]);
    const played = await play(id, { input: { text: 'Well?' } }, [{ text: 'Vera shrugs.' }]);
    expect(played.input?.text).toBe('Well?');
    expect(said(played)).toEqual([{ by: 'Vera', text: 'Vera shrugs.' }]);
  });

  it('Empty send: a turn with no input is the cast answering the last message', async () => {
    const vera = await anActor('Vera', ['"Evening."']);
    const { id } = await aSession([vera]);
    const played = await play(id, {}, [{ text: 'Vera pours another glass.' }]);

    expect(played.status).toBe('complete');
    expect(played.input).toBeUndefined();
    expect(said(played)).toEqual([{ by: 'Vera', text: 'Vera pours another glass.' }]);
    // The call ends on the greeting it answers: no player line was invented.
    expect(lastSent(0, 1)).toEqual([{ role: 'assistant', content: '"Evening."' }]);
  });

  it('Force talk: `speakers` names who replies, in order', async () => {
    const vera = await anActor('Vera');
    const lund = await anActor('Lund');
    const { id } = await aSession([vera, lund]);
    const played = await play(id, { input: { text: 'Well?' }, speakers: [lund] }, [
      { text: 'Lund grunts.' },
    ]);
    expect(said(played)).toEqual([{ by: 'Lund', text: 'Lund grunts.' }]);
  });

  describe('Swipe', () => {
    async function aRound(): Promise<{ id: string; round: Turn; vera: string; lund: string }> {
      const vera = await anActor('Vera');
      const lund = await anActor('Lund');
      const { id } = await aSession([vera, lund]);
      const round = await play(id, { input: { text: 'Well?' }, speakers: [vera, lund] }, [
        { text: '"You came."' },
        { text: '"Aye."' },
      ]);
      return { id, round, vera, lund };
    }

    it('regenerates message k by its speaker, carrying 0..k-1', async () => {
      const { id, round, vera, lund } = await aRound();
      provider.requests.length = 0;
      const swiped = await play(id, { redoOf: round.id, fromMessage: 1 }, [
        { text: '"Not tonight."' },
      ]);

      expect(swiped.parentTurnId).toBe(round.parentTurnId);
      expect(said(swiped)).toEqual([
        { by: 'Vera', text: '"You came."', carried: true },
        { by: 'Lund', text: '"Not tonight."' },
      ]);
      // The same move, and the force-talk it recorded — not *"only Lund was
      // asked for"*, which nobody asked.
      expect(swiped.input?.text).toBe('Well?');
      expect(swiped.input?.speakers).toEqual([vera, lund]);
      // One call, Lund's, shown Vera's line as the round so far.
      expect(provider.requests).toHaveLength(1);
      expect(lastSent(0, 2)).toEqual([
        { role: 'user', content: 'Well?' },
        { role: 'assistant', content: '"You came."' },
      ]);
      // The redone attempt is the one message being swiped, not the round,
      // most of which the swipe keeps.
      const attempt = (swiped.request?.calls[0]?.blocks ?? []).find(
        (block) => block.source.kind === 'attempt',
      );
      expect(attempt?.source).toEqual({ kind: 'attempt', turnId: round.id });
      expect(attempt?.text).toContain('"Aye."');
      expect(attempt?.text).not.toContain('You came');
    });

    it('rewrites message 0 under rewriteOf, carrying nothing', async () => {
      const { id, round } = await aRound();
      const swiped = await play(id, { rewriteOf: round.id, fromMessage: 0 }, [
        { text: '"Well, well."' },
      ]);
      expect(said(swiped)).toEqual([{ by: 'Vera', text: '"Well, well."' }]);
    });

    it('refuses what a swipe cannot mean', async () => {
      const { id, round, lund } = await aRound();
      const at = { headTurnId: await head(id) };
      const cases: [Record<string, unknown>, number, string][] = [
        [{ fromMessage: 1 }, 422, 'conflicting-gesture'],
        [{ redoOf: round.id, fromMessage: 1, input: { text: 'x' } }, 422, 'conflicting-gesture'],
        [{ redoOf: round.id, fromMessage: 1, speakers: [lund] }, 422, 'conflicting-gesture'],
        [{ redoOf: round.id, fromMessage: 5 }, 422, 'no-such-message'],
        [{ redoOf: round.id, fromMessage: 1, parentTurnId: round.id }, 422, 'not-a-sibling'],
        [{ redoOf: uuidv7(), fromMessage: 0 }, 404, 'no-such-turn'],
      ];
      for (const [body, status, error] of cases) {
        const refused = await submit(id, { ...at, ...body });
        expect([refused.status, refused.body.error], JSON.stringify(body)).toEqual([status, error]);
      }
    });

    /**
     * ***A hide follows the message onto its carried copy*** — 2026-09-29, at
     * the [P14.4] review: the swipe showed the model a line the person had
     * hidden, and brought it back visible on the sibling.
     */
    it('keeps a hidden carried message out of the call, and hidden on the sibling', async () => {
      const vera = await anActor('Vera');
      const lund = await anActor('Lund');
      const { id } = await aSession([vera, lund]);
      const round = await play(id, { input: { text: 'Well?' }, speakers: [vera, lund] }, [
        { text: 'SECRET-V.' },
        { text: '"Aye."' },
      ]);
      const hid = await server.request({
        method: 'PUT',
        url: `/api/sessions/${id}/turns/${round.id}/hidden`,
        payload: { hidden: [0] },
      });
      expect(hid.status).toBe(200);
      provider.requests.length = 0;

      const swiped = await play(id, { redoOf: round.id, fromMessage: 1 }, [{ text: '"No."' }]);
      expect(said(swiped)[0]).toEqual({ by: 'Vera', text: 'SECRET-V.', carried: true });
      expect(sentIds(swiped)).not.toContain('se.round.0');
      expect(JSON.stringify(provider.requests[0]?.messages ?? [])).not.toContain('SECRET-V.');
      expect(await hiddenOf(id)).toEqual({ [round.id]: [0], [swiped.id]: [0] });
    });

    /**
     * ***A rewrite swipe replays call k's draws, not call 0's*** — 2026-09-29,
     * at the [P14.4] review. A book whose one entry rolls on every speaking
     * call gives the round one `lore.probability` draw per message, tagged
     * with it; the swipe's one call must take message 1's, re-keyed from 0.
     */
    it('replays the draws message k was made with, under rewriteOf', async () => {
      const book = {
        ...newLorebook('Harbour'),
        entries: [
          {
            ...newLoreEntry('The ferry'),
            // Constant, so every speaking call rolls it whatever it scans.
            constant: true,
            content: 'It runs at dawn.',
            probability: 50,
          },
        ],
      };
      const made = await server.request({
        method: 'POST',
        url: '/api/library/lorebooks',
        payload: book,
      });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      const vera = await anActor('Vera');
      const lund = await anActor('Lund');
      const { id } = await aSession([vera, lund], null, { lore: [book.id] });
      const round = await play(id, { input: { text: 'The ferry?' }, speakers: [vera, lund] }, [
        { text: '"Gone."' },
        { text: '"Aye."' },
      ]);
      const rolls = round.tape.filter((draw) => draw.site === 'lore.probability');
      // The fixture rolled once per speaking call, and said which call.
      expect(rolls.map((draw) => draw.message)).toEqual([0, 1]);

      const swiped = await play(id, { rewriteOf: round.id, fromMessage: 1 }, [{ text: '"No."' }]);
      const replayed = swiped.tape.filter((draw) => draw.site === 'lore.probability');
      expect(replayed).toHaveLength(1);
      expect(replayed[0]).toMatchObject({
        message: 1,
        index: 0,
        replayed: true,
        value: rolls[1]?.value,
      });
    });
  });

  it('Regenerate the round: the existing redo, a sibling with its speakers chosen again', async () => {
    const vera = await anActor('Vera');
    const { id } = await aSession([vera]);
    const first = await play(id, { input: { text: 'Well?' } }, [{ text: 'One.' }]);
    const again = await play(
      id,
      { redoOf: first.id, parentTurnId: first.parentTurnId, input: { text: 'Well?' } },
      [{ text: 'Two.' }],
    );
    expect(again.parentTurnId).toBe(first.parentTurnId);
    expect(said(again)).toEqual([{ by: 'Vera', text: 'Two.' }]);
    expect(await head(id)).toBe(again.id);
  });

  describe('Continue', () => {
    it('extends the last message, the call ending on the nudge', async () => {
      const vera = await anActor('Vera');
      const { id } = await aSession([vera]);
      const first = await play(id, { input: { text: 'Well?' } }, [{ text: 'She smiled.' }]);
      provider.requests.length = 0;
      const continued = await play(id, { continueOf: first.id }, [{ text: 'Then she left.' }]);

      expect(continued.parentTurnId).toBe(first.parentTurnId);
      expect(continued.input?.text).toBe('Well?');
      expect(said(continued)).toEqual([{ by: 'Vera', text: 'She smiled. Then she left.' }]);
      expect(continued.output?.text).toBe('She smiled. Then she left.');
      // The old message is the last assistant entry, and the nudge ends the call.
      expect(lastSent(0, 2)).toEqual([
        { role: 'assistant', content: 'She smiled.' },
        { role: 'system', content: CONTINUE_NUDGE },
      ]);
      const blocks = continued.request?.calls[0]?.blocks ?? [];
      expect(blocks.at(-1)?.source).toEqual({ kind: 'continue' });
    });

    it("continues a round's last speaker, carrying the rest", async () => {
      const vera = await anActor('Vera');
      const lund = await anActor('Lund');
      const { id } = await aSession([vera, lund]);
      const round = await play(id, { input: { text: 'Well?' }, speakers: [vera, lund] }, [
        { text: '"You came."' },
        { text: '"Aye"' },
      ]);
      const continued = await play(id, { continueOf: round.id }, [{ text: 'he said, at last.' }]);
      expect(said(continued)).toEqual([
        { by: 'Vera', text: '"You came."', carried: true },
        { by: 'Lund', text: '"Aye" he said, at last.' },
      ]);
    });

    it('refuses a continue beside an input, or of a turn that said nothing', async () => {
      const vera = await anActor('Vera');
      const { id } = await aSession([vera]);
      const quiet = await play(id, { input: { text: 'Well?' }, speakers: [vera] }, [
        { text: 'Hm.' },
      ]);
      const clash = await submit(id, {
        headTurnId: await head(id),
        continueOf: quiet.id,
        input: { text: 'x' },
      });
      expect([clash.status, clash.body.error]).toEqual([422, 'conflicting-gesture']);

      // An edit that wrote only the move leaves nothing to continue.
      const moveOnly = await play(id, { authored: { input: { text: 'I wait.' } } });
      const nothing = await submit(id, { headTurnId: await head(id), continueOf: moveOnly.id });
      expect([nothing.status, nothing.body.error]).toEqual([422, 'nothing-to-continue']);
    });

    // 2026-09-29, at the [P14.4] review — see the swipe's test of the same.
    it('keeps a hidden earlier message out of the call, and refuses a hidden last one', async () => {
      const vera = await anActor('Vera');
      const lund = await anActor('Lund');
      const { id } = await aSession([vera, lund]);
      const round = await play(id, { input: { text: 'Well?' }, speakers: [vera, lund] }, [
        { text: 'SECRET-V.' },
        { text: '"Aye"' },
      ]);
      const hide = (hidden: unknown): Promise<{ status: number; body: any }> =>
        server.request({
          method: 'PUT',
          url: `/api/sessions/${id}/turns/${round.id}/hidden`,
          payload: { hidden },
        });

      expect((await hide([1])).status).toBe(200);
      const refused = await submit(id, { headTurnId: await head(id), continueOf: round.id });
      expect([refused.status, refused.body.error]).toEqual([422, 'hidden-message']);

      expect((await hide([0])).status).toBe(200);
      provider.requests.length = 0;
      const continued = await play(id, { continueOf: round.id }, [{ text: 'he said.' }]);
      expect(said(continued)[1]?.text).toBe('"Aye" he said.');
      expect(sentIds(continued)).not.toContain('se.round.0');
      expect(sentIds(continued)).toContain('se.round.1');
      expect(JSON.stringify(provider.requests[0]?.messages ?? [])).not.toContain('SECRET-V.');
      expect(await hiddenOf(id)).toEqual({ [round.id]: [0], [continued.id]: [0] });
    });
  });

  describe('Edit', () => {
    it('writes a sibling by hand: no call, no request, the original kept', async () => {
      const vera = await anActor('Vera');
      const lund = await anActor('Lund');
      const ned = await anActor('Ned');
      const { id } = await aSession([vera, lund], ned);
      const original = await play(id, { input: { text: 'Well?' }, speakers: [vera] }, [
        { text: 'Vera frowns.' },
      ]);
      provider.requests.length = 0;

      const edited = await play(id, {
        parentTurnId: original.parentTurnId,
        authored: {
          input: { text: 'Well, then?' },
          messages: [
            { speaker: vera, text: 'Vera laughs.' },
            { speaker: null, text: 'The lamp gutters.' },
            { speaker: lund, text: '"Aye."' },
          ],
        },
      });

      expect(provider.requests).toHaveLength(0);
      expect(edited.status).toBe('complete');
      expect(edited.request).toBeUndefined();
      expect(edited.effects).toEqual([]);
      expect(edited.parentTurnId).toBe(original.parentTurnId);
      expect(edited.input?.text).toBe('Well, then?');
      expect(said(edited)).toEqual([
        { by: 'Vera', text: 'Vera laughs.' },
        { by: null, text: 'The lamp gutters.' },
        { by: 'Lund', text: '"Aye."' },
      ]);
      // The original is still there, a sibling nobody is on.
      expect((await turn(id, original.id)).output?.text).toBe('Vera frowns.');
      expect(await head(id)).toBe(edited.id);
    });

    /**
     * ***`editOf` keeps what the edit leaves alone*** — 2026-09-29, at the
     * [P14.4] review: an edit of the reply lost the move's picture and
     * force-talk, which `authored.input` has no field for.
     */
    it('keeps the edited turn’s move, pictures and force-talk included, under editOf', async () => {
      const vera = await anActor('Vera');
      const lund = await anActor('Lund');
      const { id } = await aSession([vera, lund]);
      const digest = await attach(id);
      const original = await play(
        id,
        { input: { text: 'Look.', attachments: [{ digest }] }, speakers: [vera, lund] },
        [{ text: 'Vera looks.' }, { text: 'SECRET-L.' }],
      );
      expect(original.input?.attachments).toHaveLength(1);
      await server.request({
        method: 'PUT',
        url: `/api/sessions/${id}/turns/${original.id}/hidden`,
        payload: { hidden: [0, 1] },
      });

      const edited = await play(id, {
        editOf: original.id,
        authored: {
          messages: [
            { speaker: vera, text: 'Vera stares.' },
            { speaker: lund, text: 'SECRET-L.' },
          ],
        },
      });
      expect(edited.parentTurnId).toBe(original.parentTurnId);
      expect(edited.input?.text).toBe('Look.');
      expect(edited.input?.attachments).toEqual(original.input?.attachments);
      expect(edited.input?.speakers).toEqual([vera, lund]);
      expect(said(edited)).toEqual([
        { by: 'Vera', text: 'Vera stares.' },
        { by: 'Lund', text: 'SECRET-L.' },
      ]);
      // The unchanged line is still hidden; the rewritten one is the person's
      // new words, shown.
      expect((await hiddenOf(id))?.[edited.id]).toEqual([1]);

      // A new move laid over the carried one keeps its picture.
      const reworded = await play(id, {
        editOf: original.id,
        authored: { input: { text: 'Look closer.' } },
      });
      expect(reworded.input?.text).toBe('Look closer.');
      expect(reworded.input?.raw).toBe('Look closer.');
      expect(reworded.input?.attachments).toEqual(original.input?.attachments);
      expect(said(reworded).map((line) => line.text)).toEqual(['Vera looks.', 'SECRET-L.']);

      const bare = await submit(id, { headTurnId: await head(id), editOf: original.id });
      expect([bare.status, bare.body.error]).toEqual([422, 'conflicting-gesture']);
    });

    it('is idempotent on its key, as any submission is', async () => {
      const vera = await anActor('Vera');
      const { id } = await aSession([vera]);
      const body = {
        idempotencyKey: uuidv7(),
        headTurnId: null,
        authored: { messages: [{ speaker: vera, text: 'Once.' }] },
      };
      const first = await submit(id, body);
      await server.services.runner.settle();
      const again = await submit(id, body);
      expect(again.body.turnId).toBe(first.body.turnId);
      const listed = await server.request({ method: 'GET', url: `/api/sessions/${id}/turns` });
      expect(listed.body.turns).toHaveLength(1);
    });

    it('refuses a line for the persona, for somebody not cast, or beside a call', async () => {
      const vera = await anActor('Vera');
      const ned = await anActor('Ned');
      const stranger = await anActor('Abel');
      const { id } = await aSession([vera], ned);
      const at = { headTurnId: await head(id) };
      const line = (speaker: string): Record<string, unknown> => ({
        authored: { messages: [{ speaker, text: 'Hi.' }] },
      });
      const persona = await submit(id, { ...at, ...line(ned) });
      expect([persona.status, persona.body.error]).toEqual([422, 'speaker-is-persona']);
      const outside = await submit(id, { ...at, ...line(stranger) });
      expect(outside.status).toBe(422);
      expect(outside.body.speaker).toBe(stranger);
      const steered = await submit(id, { ...at, ...line(vera), guidance: 'Be kind.' });
      expect([steered.status, steered.body.error]).toEqual([422, 'conflicting-gesture']);
      const empty = await submit(id, { ...at, authored: {} });
      expect(empty.status).toBe(400);
    });
  });

  describe('Delete', () => {
    it('is the head moving to the parent; the turn stays, a sibling nobody is on', async () => {
      const vera = await anActor('Vera');
      const { id } = await aSession([vera]);
      const first = await play(id, { input: { text: 'Well?' } }, [{ text: 'One.' }]);
      const second = await play(id, { input: { text: 'And?' } }, [{ text: 'Two.' }]);

      const moved = await server.request({
        method: 'PUT',
        url: `/api/sessions/${id}/head`,
        payload: { turnId: second.parentTurnId },
      });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(await head(id)).toBe(first.id);
      expect((await turn(id, second.id)).output?.text).toBe('Two.');
    });

    it('deletes a first turn — the greeting — by moving the head to the root', async () => {
      const vera = await anActor('Vera', ['Hello.']);
      const session = await aSession([vera]);
      const moved = await server.request({
        method: 'PUT',
        url: `/api/sessions/${session.id}/head`,
        payload: { turnId: null },
      });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(await head(session.id)).toBeNull();
      const listed = await server.request({
        method: 'GET',
        url: `/api/sessions/${session.id}/turns`,
      });
      expect(listed.body.turns).toEqual([]);
      // Still on the record, and a turn submitted now starts a new line from
      // the root beside it.
      expect((await turn(session.id, session.headTurnId ?? '')).output?.text).toBe('Hello.');
      const fresh = await play(session.id, { input: { text: 'Hi?' } }, [{ text: 'Mm.' }]);
      expect(fresh.parentTurnId).toBeNull();

      // And `resume` from the root goes forward only where there is one way to go.
      const resumed = await server.request({
        method: 'PUT',
        url: `/api/sessions/${session.id}/head`,
        payload: { turnId: null, resume: true },
      });
      expect(resumed.status).toBe(200);
      expect(await head(session.id)).toBeNull();
    });
  });

  describe('Hide / unhide', () => {
    it('sets and clears session.hidden, and history skips what it hides', async () => {
      const vera = await anActor('Vera');
      const lund = await anActor('Lund');
      const { id } = await aSession([vera, lund]);
      const round = await play(id, { input: { text: 'Well?' }, speakers: [vera, lund] }, [
        { text: 'SECRET-V.' },
        { text: 'SECRET-L.' },
      ]);
      const hide = (hidden: unknown): Promise<{ status: number; body: any }> =>
        server.request({
          method: 'PUT',
          url: `/api/sessions/${id}/turns/${round.id}/hidden`,
          payload: { hidden },
        });

      const one = await hide([0]);
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(one.body.session.hidden).toEqual({ [round.id]: [0] });
      provider.requests.length = 0;
      await play(id, { input: { text: 'And?' }, speakers: [vera] }, [{ text: 'Mm.' }]);
      const sent = JSON.stringify(provider.requests[0]?.messages ?? []);
      expect(sent).not.toContain('SECRET-V.');
      expect(sent).toContain('SECRET-L.');

      const whole = await hide(true);
      expect(whole.body.session.hidden).toEqual({ [round.id]: true });

      const cleared = await hide(false);
      expect(cleared.status).toBe(200);
      expect(cleared.body.session.hidden).toBeUndefined();
      expect((await hide([])).body.session.hidden).toBeUndefined();
    });

    it('refuses a message the turn does not have, and a turn the session does not', async () => {
      const vera = await anActor('Vera');
      const { id } = await aSession([vera]);
      const played = await play(id, { input: { text: 'Well?' } }, [{ text: 'One.' }]);
      const past = await server.request({
        method: 'PUT',
        url: `/api/sessions/${id}/turns/${played.id}/hidden`,
        payload: { hidden: [1] },
      });
      expect([past.status, past.body.error]).toEqual([422, 'no-such-message']);
      const nobody = await server.request({
        method: 'PUT',
        url: `/api/sessions/${id}/turns/${uuidv7()}/hidden`,
        payload: { hidden: true },
      });
      expect([nobody.status, nobody.body.error]).toEqual([404, 'no-such-turn']);
    });
  });

  it('Impersonate: as built — a draft, and nothing on the tree', async () => {
    const vera = await anActor('Vera', ['Hello.']);
    const ned = await anActor('Ned');
    const session = await aSession([vera], ned);
    provider.setScript([{ text: 'I would not go in there.' }]);
    const drafted = await server.request({
      method: 'POST',
      url: `/api/sessions/${session.id}/impersonate`,
      payload: {},
    });
    expect(drafted.status).toBe(200);
    expect(drafted.body.text).toBe('I would not go in there.');
    expect(await head(session.id)).toBe(session.headTurnId);
  });

  it('Stop: a stopped swipe keeps what it carried and what had streamed', async () => {
    const vera = await anActor('Vera');
    const lund = await anActor('Lund');
    const { id } = await aSession([vera, lund]);
    const round = await play(id, { input: { text: 'Well?' }, speakers: [vera, lund] }, [
      { text: '"You came."' },
      { text: '"Aye."' },
    ]);
    provider.setScript([{ text: 'a b c d e f g h i j', chunks: 10, chunkDelayMs: 20 }]);
    const submitted = await submit(id, {
      headTurnId: await head(id),
      redoOf: round.id,
      fromMessage: 1,
    });
    expect(submitted.status).toBe(202);
    const stream = await server.stream({ url: submitted.body.stream as string });
    await stream.until((frame) => frame.event === 'delta' && frame.data !== undefined, 4000);
    await stream.until(
      (frame) => frame.event === 'delta' && (frame.data as { message?: number }).message === 1,
      4000,
    );
    await server.request({
      method: 'POST',
      url: `/api/sessions/${id}/jobs/${String(submitted.body.jobId)}/cancel`,
    });
    await stream.until(finished, TURN_FINISHES_MS);
    await stream.abort();

    const stopped = await turn(id, submitted.body.turnId as string);
    expect(stopped.status).toBe('failed');
    const messages = said(stopped);
    expect(messages[0]).toEqual({ by: 'Vera', text: '"You came."', carried: true });
    expect(messages[1]?.by).toBe('Lund');
    expect(messages[1]?.text.length).toBeGreaterThan(0);
  });
});
