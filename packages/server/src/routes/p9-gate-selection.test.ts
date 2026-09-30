// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Rendition } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { readRenditions, reusableBackdrop } from '../renditions/store.js';
import { Layout } from '../storage/layout.js';
import {
  eventually,
  makeTestServer,
  settled,
  setUpAdmin,
  type TestServer,
} from '../test-server.js';

/**
 * ***Gate steps 4, 9, 10 and 11*** —
 * [P9 §3](../../../../docs/design/workplan/26-p9-implementation.md), [P9.3].
 *
 * 4.  *Illustrate a turn from forty back: a **second** rendition appears beside
 *     the first and the first is still selectable.*
 * 9.  *Branch a turn that has renditions: the branch inherits them by inheriting
 *     the turn, and nothing was replayed to make that true.*
 * 10. *Walk into a new place and a backdrop follows; walk back and the first one
 *     returns **without a second generation being dispatched**.*
 * 11. *Rewind past the doorway: the earlier backdrop is showing again, and the
 *     diff of what P9 wrote to make that work is empty.*
 *
 * ***Row 10 is the money row and it is asserted on the dispatch***, which §3.1
 * says in as many words: *"a reuse that quietly regenerates looks identical on
 * screen and only shows up on a bill."*
 *
 * ***Rows 9 and 11 are a diff rather than a behaviour.*** [P9 §1.7]: *"if this
 * stage finds itself writing branch-aware code, the split was implemented
 * backwards — so the test is the one that notices."* What that means here is two
 * assertions no other file can make: **nothing under `sessions/` or
 * `turns/effects.ts` names a rendition**, and **`BACKDROP_CHANNEL` declares no
 * `escapes`**. The second is [P9 §0.3]'s addition, because `escapes` did not
 * exist when §1.7 was written and is the one way an empty diff can be empty and
 * still wrong.
 */

const PASSWORD = 'correct horse battery';
const CHAT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a11';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');

let dataDir: string;
let server: TestServer;
let sessionId: string;
let fake: FakeProvider;
let head: string | null = null;
let counter = 0;

/** Stalls, for a picture that has to land while the next turn is written. */
async function boot(stalls: { replyMs?: number; imageMs?: number } = {}): Promise<void> {
  dataDir = await mkdtemp(join(tmpdir(), 'se-p9-sel-'));
  fake = new FakeProvider({
    script: [
      {
        text: 'The room was dim.',
        object: { subject: 'a dim room', anchor: 'The room' },
        ...(stalls.replyMs === undefined ? {} : { stallMs: stalls.replyMs }),
      },
    ],
    images: [stalls.imageMs === undefined ? {} : { stallMs: stalls.imageMs }],
    capabilities: { rendersImages: true, supportsStructuredOutput: true },
  });
  server = await makeTestServer({ dataDir, providers: () => fake });
  await setUpAdmin(server, 'ned', PASSWORD);
  counter = 0;

  const connections = new Layout(dataDir).userConnectionsRoot('ned');
  await mkdir(connections, { recursive: true });
  await writeFile(
    join(connections, 'both.json'),
    JSON.stringify({
      id: CHAT,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-hi'],
      capabilities: { rendersImages: true },
    }),
  );
  await writeFile(
    join(dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({
      prose: { connectionId: CHAT, modelId: 'fake-hi' },
      fast: { connectionId: CHAT, modelId: 'fake-hi' },
      image: { connectionId: CHAT, modelId: 'fake-hi' },
    }),
  );

  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'The inn' },
  });
  sessionId = (created.body as { session: { id: string } }).session.id;
  head = null;
}

afterEach(async () => {
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

async function write(key: string, value: unknown): Promise<void> {
  await server.request({
    method: 'PUT',
    url: `/api/sessions/${sessionId}/channels/${key}`,
    payload: { value },
  });
  head = await readHead();
}

async function readHead(): Promise<string | null> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  return (read.body as { session: { headTurnId: string | null } }).session.headTurnId;
}

/** A turn submitted and committed, with what it dispatched left running. */
async function submitATurn(): Promise<string> {
  const before = head;
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: {
      idempotencyKey: `k-${String(counter++)}`,
      headTurnId: before,
      input: { text: 'Walk on.' },
    },
  });
  expect(submitted.status).toBe(202);
  await eventually(async () => {
    const now = await readHead();
    return now !== null && now !== before;
  });
  await server.services.runner.settle();
  head = await readHead();
  return head ?? '';
}

/** What the session read says the backdrop is, and what the stage draws. */
async function stage(): Promise<{ selected: string | null; drawn: string | null }> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  const body = read.body as {
    session: { channels: Record<string, { value: unknown }> };
    surfaces: { region: string; image?: { url: string } }[];
  };
  const value = body.session.channels['se.backdrop']?.value as { renditionId?: string } | undefined;
  return {
    selected: value?.renditionId ?? null,
    drawn: body.surfaces.find((one) => one.region === 'stage')?.image?.url ?? null,
  };
}

function assetOf(renditionId: string): string {
  return `/api/sessions/${sessionId}/renditions/${renditionId}/asset`;
}

async function takeATurn(): Promise<string> {
  const before = head;
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: {
      idempotencyKey: `k-${String(counter++)}`,
      headTurnId: before,
      input: { text: 'Walk on.' },
    },
  });
  expect(submitted.status).toBe(202);
  await eventually(async () => {
    const now = await readHead();
    return now !== null && now !== before;
  });
  // Not when the head moves: when the turn, and what it dispatched, are done.
  await settled(server);
  head = await readHead();
  return head ?? '';
}

async function renditionsOf(): Promise<Rendition[]> {
  const all = await readRenditions(server.services.sessions.layout, 'ned', sessionId);
  return [...all.values()];
}

describe('a place already rendered dispatches no job', () => {
  beforeEach(async () => {
    await boot();
    await write('se.backdrop.on', true);
  });

  it('pays once for a place, and nothing to return to it', async () => {
    /**
     * ***[P9 §1.7]'s money row.*** *"Returning to a place you have been costs
     * nothing"* — and the assertion is on `fake.images`, the provider's own call
     * log, because a reuse that quietly regenerates is identical on screen.
     *
     * The place is `se.location`, which Scene declares and which the backdrop's
     * fragment ranking puts first. Moving it changes the recipe, so the digest
     * changes, so the step dispatches; moving it *back* restores the recipe, so
     * the digest matches a rendition already on disk.
     */
    await write('se.location', 'the taproom');
    await takeATurn();
    await eventually(async () => {
      const all = await renditionsOf();
      // **Non-empty, and that clause is load-bearing.** `every` over an empty
      // list is **true**, so without it this waits for nothing at all whenever
      // the record has not been written yet — and the next line reads
      // `[0]` off an empty array. *Found 2026-09-16 under the full suite's
      // load, where it presented as "the backdrop never landed" in one file and
      // passed in isolation every time.* It is the vacuous half of the same
      // fire-and-forget design [P9.2] chose deliberately: the dispatch is
      // detached, so *no renditions yet* and *all renditions settled* are the
      // same answer to `every`.
      return all.length > 0 && all.every((one) => one.state === 'ready');
    });
    expect(fake.images).toHaveLength(1);

    // A second room. A new place is a new recipe, so this one is paid for.
    await write('se.location', 'the cellar');
    await takeATurn();
    await eventually(async () => {
      const all = await renditionsOf();
      // Non-empty, for the reason spelled out on the first of these.
      return all.length > 0 && all.every((one) => one.state === 'ready');
    });
    expect(fake.images).toHaveLength(2);

    // And back upstairs. **Nothing is dispatched**, which is the whole row.
    await write('se.location', 'the taproom');
    await takeATurn();
    expect(fake.images).toHaveLength(2);
  });

  /**
   * ***And the place you come back to is the one on the stage*** (2026-09-30).
   * The step recorded which backdrop it reused and nothing pointed the channel
   * at it, so the cellar stayed behind the taproom's prose. Written in the
   * turn that reused it, and drawn: the session read draws a generated
   * backdrop now, where it drew nothing, having no session to address it by.
   */
  it('shows the returning place’s own backdrop, drawn from the session read', async () => {
    const ready = async (): Promise<void> => {
      await eventually(async () => {
        const all = await renditionsOf();
        return all.length > 0 && all.every((one) => one.state === 'ready');
      });
    };

    await write('se.location', 'the taproom');
    await takeATurn();
    await ready();
    const taproom = (await renditionsOf())[0]?.id ?? '';
    expect(await stage()).toEqual({ selected: taproom, drawn: assetOf(taproom) });

    await write('se.location', 'the cellar');
    await takeATurn();
    await ready();
    const cellar = (await renditionsOf()).find((one) => one.id !== taproom)?.id ?? '';
    expect(await stage()).toEqual({ selected: cellar, drawn: assetOf(cellar) });

    await write('se.location', 'the taproom');
    const returned = await takeATurn();
    expect(await stage()).toEqual({ selected: taproom, drawn: assetOf(taproom) });
    // In the turn that walked back, not a node after it.
    const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    const walkedBack = (
      turns.body as { turns: { id: string; effects: { channelId: string }[] }[] }
    ).turns.find((turn) => turn.id === returned);
    expect(walkedBack?.effects.some((one) => one.channelId === 'se.backdrop')).toBe(true);
  });
  it('comes back to the backdrop you chose rather than the oldest', async () => {
    /**
     * §10.1a's clause, at the level it is decided. A manual regenerate adds a
     * sibling and selects it, so a digest with two renditions behind it has to
     * answer with the selected one — *"having chosen a backdrop for the tavern,
     * the tavern is what should come back."*
     *
     * Asserted over `reusableBackdrop` rather than through a second walk,
     * because what is being pinned is the resolution rule and not the plumbing
     * the row above already covers.
     */
    await write('se.location', 'the taproom');
    await takeATurn();
    await eventually(async () => {
      const all = await renditionsOf();
      // Non-empty, for the reason spelled out on the first of these.
      return all.length > 0 && all.every((one) => one.state === 'ready');
    });

    const first = (await renditionsOf())[0];
    if (first === undefined) throw new Error('the backdrop never landed');

    const held = new Map((await renditionsOf()).map((one) => [one.id, one]));
    const sibling: Rendition = { ...first, id: 'chosen', createdAt: '2020-01-01T00:00:00.000Z' };
    held.set('chosen', sibling);

    // Older, and chosen. The digest resolves to it rather than to the newest.
    expect(reusableBackdrop(held, first.digest, 'chosen')?.id).toBe('chosen');
    // With nothing chosen, the newest — so a regenerate that nobody selected
    // still looks like it did something.
    expect(reusableBackdrop(held, first.digest, null)?.id).toBe(first.id);
  });

  it('points the backdrop channel at the rendition once it is ready', async () => {
    /**
     * ***The artefact is not an effect; the selection is*** — [06 §10.1a].
     *
     * And the selection is an **ordinary** effect: `scope: 'session'`, written
     * by the engine through `acceptEffect` on a turn with no model call and no
     * tape. `escaped` would make it correct on the turn it was written and
     * silently absent on rewind, which is gate 11 failing in the one way an
     * empty diff does not look for.
     */
    await write('se.location', 'the taproom');
    await takeATurn();
    await eventually(async () => {
      const all = await renditionsOf();
      // Non-empty, for the reason spelled out on the first of these.
      return all.length > 0 && all.every((one) => one.state === 'ready');
    });

    await eventually(async () => {
      const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      const channels = (read.body as { session: { channels: Record<string, { value: unknown }> } })
        .session.channels;
      const value = channels['se.backdrop']?.value as { from?: string } | undefined;
      return value?.from === 'rendition';
    });

    const turns = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/turns`,
    });
    const all = (turns.body as { turns: { effects: { channelId: string; scope: string }[] }[] })
      .turns;
    const backdropEffects = all.flatMap((turn) =>
      turn.effects.filter((one) => one.channelId === 'se.backdrop'),
    );

    expect(backdropEffects.length).toBeGreaterThan(0);
    // **Ordinary, never escaped** — the amendment [P9 §0.3] made to §1.7.
    expect(backdropEffects.every((one) => one.scope === 'session')).toBe(true);
  });
});

/**
 * ***A backdrop that lands while the next turn is being written*** (2026-09-30).
 *
 * Two things went wrong at once. The next turn found the place's backdrop
 * pending rather than ready and asked for another of the same place, which
 * made the first give way when it landed: paid for twice, and the first never
 * shown. And a backdrop held for a turn is selected after that turn's
 * `turn.finished`, which sends a page to read the head, so the page kept the
 * turn as its head and its next submission was refused as out of date — the
 * frame that says the backdrop moved had gone out while the turn was running.
 */
describe('a backdrop that lands while the next turn is written', () => {
  beforeEach(async () => {
    await boot({ replyMs: 1500, imageMs: 800 });
    await write('se.backdrop.on', true);
    await write('se.location', 'the taproom');
  });

  it('is paid for once, shown on top of that turn, and told after it', async () => {
    const heard: string[] = [];
    const unsubscribe = server.services.bus.subscribe(sessionId, {
      onEvents: (_jobId, events) => {
        for (const event of events) if (event.key === 'turn.finished') heard.push('finished');
      },
      onDelta: () => undefined,
      onRendition: (rendition) => {
        heard.push(`rendition ${rendition.state}`);
      },
    });

    try {
      const first = await submitATurn();
      const drawn = (await renditionsOf())[0];
      expect(drawn?.state).toBe('pending');

      await takeATurn();

      expect(fake.images).toHaveLength(1);
      expect(heard.lastIndexOf('rendition ready')).toBeGreaterThan(heard.lastIndexOf('finished'));
      const shown = await stage();
      expect(shown.selected).toBe(drawn?.id);
      // A node of its own on top of the second turn, which sits on the first.
      const turns = await server.request({
        method: 'GET',
        url: `/api/sessions/${sessionId}/turns`,
      });
      const byId = new Map(
        (
          turns.body as {
            turns: { id: string; parentTurnId: string | null; effects: { channelId: string }[] }[];
          }
        ).turns.map((turn) => [turn.id, turn]),
      );
      const selection = byId.get(head ?? '');
      expect(selection?.effects.map((one) => one.channelId)).toEqual(['se.backdrop']);
      expect(byId.get(selection?.parentTurnId ?? '')?.parentTurnId).toBe(first);
    } finally {
      unsubscribe();
    }
  });
});

describe('a turn accumulates renditions rather than replacing them', () => {
  beforeEach(async () => {
    await boot();
    await write('se.illustrate', 'each-turn');
  });

  it('keeps every sibling, with its own recipe', async () => {
    const turnId = await takeATurn();
    await eventually(async () => {
      const all = await renditionsOf();
      // Non-empty, for the reason spelled out on the first of these.
      return all.length > 0 && all.every((one) => one.state === 'ready');
    });

    const first = (await renditionsOf())[0];
    if (first === undefined) throw new Error('the illustration never landed');
    expect(first.turnId).toBe(turnId);

    /**
     * A second rendition of the same turn, written straight into the store — the
     * shape a manual **Illustrate** produces at [P9.4], without the route that
     * has not been built. What is being pinned here is [06 §10.7]'s policy:
     * *"illustrating an old turn adds; it does not overwrite"*, so the first is
     * still on disk with its own seed.
     */
    const { writeRendition } = await import('../renditions/store.js');
    const second: Rendition = {
      ...first,
      id: `${turnId}.1`,
      provenance: { ...first.provenance, seed: 4242 },
    };
    await writeRendition(server.services.sessions.layout, 'ned', sessionId, second);

    const both = await renditionsOf();
    expect(both).toHaveLength(2);
    // Two seeds, which is what makes *why did this one come out different*
    // answerable — [06 §10.7]'s third buy.
    expect(new Set(both.map((one) => one.provenance.seed)).size).toBe(2);

    const selected = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/turns/${turnId}/rendition`,
      payload: { renditionId: second.id },
    });
    expect(selected.status).toBe(200);

    // And the first is still selectable, because nothing was replaced.
    const back = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/turns/${turnId}/rendition`,
      payload: { renditionId: first.id },
    });
    expect(back.status).toBe(200);
  });

  it('refuses a pointer to another turn’s picture', async () => {
    await takeATurn();
    await eventually(async () => {
      const all = await renditionsOf();
      // Non-empty, for the reason spelled out on the first of these.
      return all.length > 0 && all.every((one) => one.state === 'ready');
    });
    const first = (await renditionsOf())[0];

    // A pointer to somebody else's picture would render one turn's moment under
    // another's prose, which is a worse outcome than a 404.
    const wrong = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/turns/not-this-turn/rendition`,
      payload: { renditionId: first?.id ?? '' },
    });
    expect(wrong.status).toBe(404);
  });
});

describe('the code written to make branching work on renditions', () => {
  /**
   * ***Is empty, and that is the assertion*** — [06 §10.2], [P9 §1.7], gate rows
   * 9 and 11.
   *
   * *"A rendition is **not** a channel effect and does not participate in state
   * reconstruction. It is an artefact hanging off a turn, so a branch inherits
   * the turn's renditions by inheriting the turn."* A record keyed by `turnId`
   * with nothing reconciling it gets that for free — and the way to check *for
   * free* is to look for the code that would have been written instead.
   *
   * A source assertion rather than a behaviour, because the behaviour is
   * indistinguishable from a careful implementation that did write the code. It
   * is [P9 §1.7]'s own framing: *"if this stage finds itself writing branch-aware
   * code, the split was implemented backwards — so the test is the one that
   * notices."*
   */
  const RECONSTRUCTION = [
    'packages/server/src/sessions/channels.ts',
    'packages/server/src/sessions/segments.ts',
    'packages/server/src/sessions/snapshots.ts',
    'packages/server/src/turns/effects.ts',
  ];

  /**
   * ***`sessions/store.ts` is deliberately not on that list***, and saying why is
   * the point rather than an exemption.
   *
   * It holds `setRenditionSelection`, so it does name one — and that function is
   * not reconstruction. It writes a **pointer** into the session file's mutable
   * half, beside `lastSelectedChild`, which is the same kind of fact for the same
   * reason: a turn is a line in an append-only segment, so *which of a node's
   * children you last went through* and *which of a node's pictures you chose*
   * both have to live somewhere a rewrite is allowed.
   *
   * What the list above holds is the code that answers *what was true at this
   * node* — the walk, the fold, the cache and the effect applier. **None of them
   * knows what a rendition is**, which is the claim [06 §10.2] makes and the one
   * this file exists to keep true.
   */

  it('names no rendition anywhere reconstruction happens', () => {
    for (const file of RECONSTRUCTION) {
      const source = readFileSync(join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(source, `${file} knows what a rendition is`).not.toMatch(/rendition/i);
    }
  });

  it('declares no escaping channel for a backdrop, which is the new way to be wrong', () => {
    /**
     * ***[P9 §0.3]'s addition to §1.7.*** `ChannelDefinition` gained
     * `escapes?: boolean` at [P8.2] and an effect whose channel declares it is
     * written with `scope: 'escaped'` — a scope `applyEffects`, `undoTurn` and
     * `reconstructAlong` all **skip**.
     *
     * A backdrop declared that way is correct on the turn it is written and
     * silently does not return on rewind: gate 11 failing in the single manner
     * an *empty diff* cannot see, because nothing was written and that is
     * precisely the bug.
     *
     * *Read as source rather than imported*, because the engine imports no mode
     * from anywhere in its tree and `tools/repo-shape.test.ts` enforces it. The
     * declaration-side twin of this lives in the Scene package's own test, where
     * the constant can be named; what belongs here is the engine noticing that a
     * mode it writes to has not acquired the one field that would break it.
     */
    const scene = readFileSync(join(ROOT, 'packages/modes/scene/src/mode.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(scene).toContain('BACKDROP_CHANNEL');
    expect(scene).not.toContain('escapes');
  });
});
