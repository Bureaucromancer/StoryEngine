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
import { eventually, makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

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

async function boot(): Promise<void> {
  dataDir = await mkdtemp(join(tmpdir(), 'se-p9-sel-'));
  fake = new FakeProvider({
    script: [{ text: 'The room was dim.', object: { subject: 'a dim room', anchor: 'The room' } }],
    images: [{}],
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
    await eventually(async () => (await renditionsOf()).every((one) => one.state === 'ready'));
    expect(fake.images).toHaveLength(1);

    // A second room. A new place is a new recipe, so this one is paid for.
    await write('se.location', 'the cellar');
    await takeATurn();
    await eventually(async () => (await renditionsOf()).every((one) => one.state === 'ready'));
    expect(fake.images).toHaveLength(2);

    // And back upstairs. **Nothing is dispatched**, which is the whole row.
    await write('se.location', 'the taproom');
    await takeATurn();
    expect(fake.images).toHaveLength(2);
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
    await eventually(async () => (await renditionsOf()).every((one) => one.state === 'ready'));

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
    await eventually(async () => (await renditionsOf()).every((one) => one.state === 'ready'));

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

describe('a turn accumulates renditions rather than replacing them', () => {
  beforeEach(async () => {
    await boot();
    await write('se.illustrate', 'each-turn');
  });

  it('keeps every sibling, with its own recipe', async () => {
    const turnId = await takeATurn();
    await eventually(async () => (await renditionsOf()).every((one) => one.state === 'ready'));

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
    await eventually(async () => (await renditionsOf()).every((one) => one.state === 'ready'));
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
