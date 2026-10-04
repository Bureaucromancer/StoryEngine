// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { newSetup, uuidv7, type Turn } from '@storyengine/shared';

import { importChatFile } from '../import/chat-sessions.js';
import { registerMode } from '../mode-registry.js';
import { FakeProvider } from '../providers/fake.js';
import type { GenerationRequest, Provider } from '../providers/types.js';
import { exportSession } from '../sessions/export.js';
import { importSession } from '../sessions/import.js';
import { appendTurnToSession, deleteSession } from '../sessions/store.js';
import { ensureChain, listSummaries, type Summariser } from '../sessions/summaries.js';
import { DEFAULT_SUMMARY_POLICY, planChain } from '../sessions/summary-chain.js';
import { Layout } from '../storage/layout.js';
import type { SummaryWarm } from '../stream/bus.js';
import { TEST_MODE, TEST_MODE_ID } from '../test-mode.js';
import {
  eventually,
  makeTestServer,
  setUpAdmin,
  settled,
  type TestServer,
} from '../test-server.js';
import { SUMMARISE_PROMPT } from './summarise.js';

/**
 * ***The first turn after a long import*** —
 * [P14.11](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [18 §7.5](../../../../docs/design/18-session-import.md)'s cliff.
 *
 * *Ends at: a long fixture's first previewed turn derives zero links.* So the
 * fixture is a real door — a SillyTavern chat file through `importChatFile`,
 * the path a person's chat takes — long enough to have several links above
 * Scene's twenty-turn window, and the claim is asserted three ways: the warm
 * said it derived every missing link, the preview carries the whole chain as
 * held, and the turn itself sent no summariser call.
 *
 * Then the things the stage says a warm must not do: change a key, or pay
 * for a link twice, when it races a turn; and warm a session that has no
 * chain to warm.
 */

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a77';
const CHAT = 'chats/Vera Solano/Vera Solano - long.jsonl';
/** 240 lines: a greeting, then 119 exchanges — ~120 turns, five links past the window. */
const MESSAGES = 240;

/** Whether a request is the summariser's — by its prompt, which is in its key. */
function summarising(request: GenerationRequest): boolean {
  return JSON.stringify(request.messages).includes(SUMMARISE_PROMPT.split('\n')[0] ?? '');
}

/**
 * The fake, with the summariser's calls counted, answered distinctly, and
 * optionally held at a gate — the seam the race test needs, since a fake with
 * no time in it cannot be caught mid-warm.
 */
class Counting {
  readonly inner = new FakeProvider({ script: [{ text: 'The harbour lights came on.' }] });
  summaries = 0;
  gate: Promise<void> | null = null;

  readonly provider: Provider = {
    kind: 'fake',
    capabilities: this.inner.capabilities,
    generate: async (request) => {
      if (!summarising(request)) return this.inner.generate(request);
      this.summaries += 1;
      const n = this.summaries;
      if (this.gate !== null) await this.gate;
      const result = await this.inner.generate(request);
      // Different prose from every call, so a race that wrote twice under one
      // key would still leave one key — which is the claim.
      return { ...result, text: `Summary number ${String(n)}.` };
    },
    stream: (request) => this.inner.stream(request),
  };
}

let dataDir: string;
let server: TestServer;
let counting: Counting;
let warms: SummaryWarm[];

async function bind(): Promise<void> {
  const connections = new Layout(dataDir).userConnectionsRoot('ned');
  await mkdir(connections, { recursive: true });
  await writeFile(
    join(connections, 'fake.json'),
    JSON.stringify({
      id: CONNECTION_ID,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-hi'],
    }),
  );
  await writeFile(
    join(dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-warm-'));
  counting = new Counting();
  server = await makeTestServer({ dataDir, providers: () => counting.provider });
  await setUpAdmin(server, 'ned');
  warms = [];
  const bus = server.services.bus;
  const summaries = bus.summaries.bind(bus);
  vi.spyOn(bus, 'summaries').mockImplementation((warm) => {
    warms.push(warm);
    summaries(warm);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

/** A long chat, shaped as SillyTavern's `saveChat` writes one. */
function longChat(): Uint8Array {
  const at = (index: number): string => new Date(Date.UTC(2026, 0, 1, 10, index)).toISOString();
  const lines: unknown[] = [
    {
      user_name: 'unused',
      character_name: 'unused',
      create_date: '2026-01-01@10h00m00s',
      chat_metadata: { integrity: '0f6d3c2e-7a41-4c1b-9e57-2b8a1d4f6c91' },
    },
  ];
  for (let index = 0; index < MESSAGES; index += 1) {
    const user = index % 2 === 1;
    lines.push({
      name: user ? 'The Inspector' : 'Vera Solano',
      is_user: user,
      is_system: false,
      send_date: at(index),
      mes: user
        ? `What about the manifest for day ${String(index)}?`
        : `Day ${String(index)}: the tide brought in crates nobody signed for.`,
      extra: {},
    });
  }
  return new TextEncoder().encode(lines.map((line) => JSON.stringify(line)).join('\n'));
}

async function importLong(): Promise<string> {
  const report = await importChatFile(
    { library: server.services.library, sessions: server.services.sessions, handle: 'ned' },
    CHAT,
    longChat(),
  );
  if (report.disposition !== 'converted' || report.objectId === undefined) {
    throw new Error(`the chat did not import: ${JSON.stringify(report)}`);
  }
  return report.objectId;
}

interface RecordedBlock {
  source: { kind: string; linkKey?: string };
  included?: boolean;
}

async function preview(sessionId: string): Promise<RecordedBlock[]> {
  const previewed = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/preview`,
    payload: { input: { text: 'And the next day?' } },
  });
  expect(previewed.status).toBe(200);
  return ((previewed.body.preview as { blocks?: RecordedBlock[] }).blocks ?? []).filter(
    (block) => block.source.kind === 'summary',
  );
}

interface RecordedTurn {
  steps?: { stepId: string; state: string }[];
  request?: { calls?: { stepId: string; blocks?: RecordedBlock[] }[] };
}

async function aTurn(sessionId: string, key: string): Promise<RecordedTurn> {
  const session = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: {
      idempotencyKey: key,
      headTurnId: session.body.session.headTurnId,
      input: { text: 'And the next day?' },
    },
  });
  expect(submitted.status).toBeLessThan(300);
  await eventually(async () => {
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    return read.body.activeJob === null;
  });
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
  return read.body.turns.at(-1) as RecordedTurn;
}

async function usageLines(): Promise<{ purpose: string; sessionId?: string }[]> {
  try {
    const text = await readFile(server.services.layout.usageLogFile('ned'), 'utf8');
    return text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { purpose: string; sessionId?: string });
  } catch {
    return [];
  }
}

describe('a long import', () => {
  it('is warmed in the background, and its first previewed turn derives zero links', async () => {
    await bind();
    const sessionId = await importLong();
    await server.services.summaryWarm.idle();

    // What the warm said: it began with every link missing and derived them all.
    const mine = warms.filter((warm) => warm.sessionId === sessionId);
    const first = mine[0];
    const last = mine.at(-1);
    expect(first?.state).toBe('warming');
    expect(first?.derived).toBe(0);
    expect(first?.links).toBeGreaterThanOrEqual(4);
    expect(first?.missing).toBe(first?.links);
    expect(last).toEqual({ ...first, state: 'warmed', derived: first?.links });

    // What it wrote, and what it cost — a usage line per link.
    const held = await listSummaries(server.services.layout, 'ned', sessionId);
    expect(held.size).toBe(first?.links);
    expect(counting.summaries).toBe(first?.links);
    const spent = (await usageLines()).filter((line) => line.purpose === 'summarise');
    expect(spent).toHaveLength(first?.links ?? -1);
    expect(spent.every((line) => line.sessionId === sessionId)).toBe(true);

    // The preview carries the whole chain, every link already on disk.
    const summary = await preview(sessionId);
    expect(summary).toHaveLength(first?.links ?? -1);
    expect(summary.every((block) => held.has(block.source.linkKey ?? ''))).toBe(true);

    // And the turn it previewed asks the summariser for nothing.
    const before = counting.summaries;
    const turn = await aTurn(sessionId, 'warm-1');
    expect(turn.steps?.find((step) => step.stepId === 'se.summary')?.state).toBe('ok');
    expect(turn.request?.calls?.some((call) => call.stepId === 'se.summary')).toBe(false);
    expect(counting.summaries).toBe(before);
    expect((await listSummaries(server.services.layout, 'ned', sessionId)).size).toBe(held.size);
  });

  it('warms nothing when the account has no summariser bound', async () => {
    const sessionId = await importLong();
    await server.services.summaryWarm.idle();
    expect(warms).toEqual([]);
    expect(counting.summaries).toBe(0);
    expect((await listSummaries(server.services.layout, 'ned', sessionId)).size).toBe(0);
  });

  it('is cancelled by deleting the session, and writes nothing after', async () => {
    await bind();
    let open: () => void = () => undefined;
    counting.gate = new Promise((resolve) => {
      open = resolve;
    });
    const sessionId = await importLong();
    await eventually(() => Promise.resolve(counting.summaries === 1));

    let finished = false;
    const deleting = deleteSession(server.services.sessions, 'ned', sessionId).then((outcome) => {
      finished = true;
      return outcome;
    });
    // The delete waits on the warm, and the warm on a reply that landed after
    // the abort: it is not written into a folder that is going.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(finished).toBe(false);
    open();
    expect((await deleting).kind).toBe('deleted');
    await server.services.summaryWarm.idle();

    expect(warms.at(-1)?.state).toBe('cancelled');
    expect(counting.summaries).toBe(1);
    expect((await listSummaries(server.services.layout, 'ned', sessionId)).size).toBe(0);
  });
});

/**
 * ***Racing a turn changes no key and costs no duplicate call*** — the
 * stage's argument, proved rather than asserted.
 *
 * *Link keys never include text*: `H(summariser, previous key, unit keys)`, so
 * the next link's key — which names the previous link's **key** — is the same
 * whichever walk derived a link. And a walk that reaches a link another walk
 * is deriving waits for it rather than calling again (`ensureChain`'s
 * in-flight map), so two walks in lockstep do not pay for the chain twice,
 * which is what they did before review caught it.
 */
describe('a warm racing a turn', () => {
  it('changes no key and calls once per link', async () => {
    await bind();
    const started: string[] = [];
    const bus = server.services.bus;
    const publish = bus.publish.bind(bus);
    vi.spyOn(bus, 'publish').mockImplementation((id, jobId, events) => {
      for (const event of events) {
        if (event.key === 'step.started') started.push(String(event.params['stepId']));
      }
      publish(id, jobId, events);
    });
    let open: () => void = () => undefined;
    counting.gate = new Promise((resolve) => {
      open = resolve;
    });
    const sessionId = await importLong();
    // The warm is inside its first link's call, held.
    await eventually(() => Promise.resolve(counting.summaries === 1));

    const session = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: 'race-1',
        headTurnId: session.body.session.headTurnId,
        input: { text: 'And the next day?' },
      },
    });
    // The turn is in its summary step, walking toward the link the warm holds;
    // a moment more lets it reach that link and join the warm's derivation
    // there. (Were it slower, it would read the link from disk instead — the
    // assertions below hold either way, and neither way calls twice.)
    await eventually(() => Promise.resolve(started.includes('se.summary')));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(counting.summaries).toBe(1);
    open();
    await eventually(async () => {
      const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      return read.body.activeJob === null;
    });
    await settled(server);

    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    const turn = read.body.turns.at(-1) as RecordedTurn;
    expect(turn.steps?.find((step) => step.stepId === 'se.summary')?.state).toBe('ok');

    // The chain the turn carried is exactly the set of files on disk: no key
    // was written that the turn did not read, and none the turn read is missing.
    const carried = new Set(
      (turn.request?.calls ?? [])
        .flatMap((call) => call.blocks ?? [])
        .filter((block) => block.source.kind === 'summary')
        .map((block) => block.source.linkKey),
    );
    const held = await listSummaries(server.services.layout, 'ned', sessionId);
    expect(carried.size).toBeGreaterThanOrEqual(4);
    expect(held).toEqual(carried);

    // One summariser call per link, whoever made it.
    expect(counting.summaries).toBe(held.size);
    expect(warms.filter((warm) => warm.sessionId === sessionId).at(-1)?.state).toBe('warmed');
  });

  it('is the same chain whichever derivation lands last, at the store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'se-warm-race-'));
    try {
      const layout = new Layout(root);
      const sessionId = uuidv7();
      const path = Array.from({ length: 100 }, (_, index) => ({
        id: `t${String(index).padStart(3, '0')}`,
        input: { text: `Said ${String(index)}.` },
        output: { text: `Replied ${String(index)}.` },
      }));
      const policy = { ...DEFAULT_SUMMARY_POLICY, window: 20 };
      const planned = planChain(path, 'summariser', policy).map((link) => link.key);

      /** Two walks of one chain in different words, started together. */
      const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
      let calls = 0;
      const summariser = (voice: string): Summariser => ({
        key: 'summariser',
        run: async ({ units }) => {
          calls += 1;
          await tick();
          return `${voice} summarised ${units[0]?.turnId ?? ''}.`;
        },
      });
      const [warm, turn] = await Promise.all([
        ensureChain(layout, 'ned', sessionId, path, summariser('The warm'), policy),
        ensureChain(layout, 'ned', sessionId, path, summariser('The turn'), policy),
      ]);

      expect(warm.links.map((link) => link.key)).toEqual(planned);
      expect(turn.links.map((link) => link.key)).toEqual(planned);
      expect(warm.links.map((link) => link.previousKey)).toEqual(
        turn.links.map((link) => link.previousKey),
      );
      expect([...(await listSummaries(layout, 'ned', sessionId))].sort()).toEqual(
        [...planned].sort(),
      );
      // Every link derived once between them, and the chain afterwards is warm.
      expect(calls).toBe(planned.length);
      expect(warm.derived + turn.derived).toBe(planned.length);
      const after = await ensureChain(layout, 'ned', sessionId, path, summariser('Nobody'), policy);
      expect(after.derived).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

/**
 * A session of sixty written turns in `mode`, exported, deleted and imported
 * again — the export door rather than the chat door, so the mode is the
 * test's to choose.
 */
async function reimported(mode?: string): Promise<string> {
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Sixty days', ...(mode === undefined ? {} : { mode }) },
  });
  expect(created.status).toBe(201);
  const original: string = created.body.session.id;

  let parent: string | null = null;
  for (let at = 0; at < 60; at += 1) {
    const id = uuidv7();
    const turn: Turn = {
      id,
      sessionId: original,
      parentTurnId: parent,
      createdAt: new Date(Date.UTC(2026, 8, 2, 0, at)).toISOString(),
      status: 'complete',
      input: { actorId: null, kind: 'do', text: `Day ${String(at)}.`, raw: `Day ${String(at)}.` },
      output: { text: `On day ${String(at)} the road turned.` },
      effects: [],
      tape: [],
    };
    await appendTurnToSession(server.services.sessions, 'ned', original, turn);
    parent = id;
  }
  const document = await exportSession(
    { sessions: server.services.sessions, build: null },
    'ned',
    original,
  );
  expect((await deleteSession(server.services.sessions, 'ned', original)).kind).toBe('deleted');

  const imported = await importSession({ sessions: server.services.sessions }, 'ned', document);
  if (!imported.ok) throw new Error(`refused: ${imported.reason}`);
  await server.services.summaryWarm.idle();
  return imported.sessionId;
}

/**
 * ***A session started from a story so far is warmed as its turns read it***
 * — [P15.2](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md), at
 * the merge into a `main` that had the warm (2026-10-03).
 *
 * The story so far is the chain's root: it keys the first link, and so every
 * link after it. The warm took its key and policy from `summaryPlanFor` and
 * never had the root, so on such a session it derived a whole chain nobody
 * reads — and the turn then derived its own, the cliff the warm exists to
 * remove, with the warm's bill on top. The preview read the unrooted keys
 * too, and so showed nothing held on a session whose every link was on disk.
 *
 * *Forty-five written turns over Scene's window of twenty is two links.* Warm,
 * then preview, then one turn: the preview carries both, and the turn asks
 * the summariser for nothing.
 */
describe('a session started from a story so far', () => {
  it('is warmed under its root, so the preview holds it all and the turn derives nothing', async () => {
    await bind();
    const setup = await server.request({
      method: 'POST',
      url: '/api/library/setups',
      payload: {
        ...newSetup('From the docks'),
        storySoFar: 'Before any of this, the ledger was lost.',
      },
    });
    expect(setup.status).toBe(201);
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { setup: setup.body.object.id as string },
    });
    expect(created.status).toBe(201);
    const sessionId: string = created.body.session.id;

    let parent = (created.body.session.headTurnId as string | null) ?? null;
    for (let at = 0; at < 45; at += 1) {
      const id = uuidv7();
      await appendTurnToSession(server.services.sessions, 'ned', sessionId, {
        id,
        sessionId,
        parentTurnId: parent,
        createdAt: new Date(Date.UTC(2026, 9, 3, 0, at)).toISOString(),
        status: 'complete',
        input: { actorId: null, kind: 'do', text: `Day ${String(at)}.`, raw: `Day ${String(at)}.` },
        output: { text: `On day ${String(at)} the tide came in.` },
        effects: [],
        tape: [],
      });
      parent = id;
    }

    server.services.summaryWarm.request('ned', sessionId);
    await server.services.summaryWarm.idle();
    expect(warms.at(-1)).toMatchObject({ sessionId, state: 'warmed', links: 2, derived: 2 });
    const held = await listSummaries(server.services.layout, 'ned', sessionId);
    expect(held.size).toBe(2);
    expect(counting.summaries).toBe(2);

    // Warm already, so a second warm finds nothing missing and says nothing —
    // which it can only know by counting the rooted keys it wrote.
    const said = warms.length;
    server.services.summaryWarm.request('ned', sessionId);
    await server.services.summaryWarm.idle();
    expect(warms).toHaveLength(said);

    // The preview reads the rooted chain the warm wrote — every link of it.
    const summary = await preview(sessionId);
    expect(summary.map((block) => block.source.linkKey).sort()).toEqual([...held].sort());

    // And the turn reads it too, asking the summariser for nothing.
    const turn = await aTurn(sessionId, 'rooted-1');
    expect(turn.steps?.find((step) => step.stepId === 'se.summary')?.state).toBe('ok');
    expect(turn.request?.calls?.some((call) => call.stepId === 'se.summary')).toBe(false);
    expect(counting.summaries).toBe(2);
    expect(await listSummaries(server.services.layout, 'ned', sessionId)).toEqual(held);
  });
});

describe('a session with no summary slot', () => {
  it('warms nothing', async () => {
    await bind();
    registerMode(TEST_MODE);
    const sessionId = await reimported(TEST_MODE_ID);

    expect(warms).toEqual([]);
    expect(counting.summaries).toBe(0);
    expect((await listSummaries(server.services.layout, 'ned', sessionId)).size).toBe(0);
  });

  it('where the same session in a mode with one is warmed, by any door', async () => {
    // The control: the export door warms too, so the case above is the slot.
    await bind();
    const sessionId = await reimported();

    expect(warms.at(-1)).toMatchObject({ sessionId, state: 'warmed' });
    expect((await listSummaries(server.services.layout, 'ned', sessionId)).size).toBe(
      warms.at(-1)?.links,
    );
  });
});
