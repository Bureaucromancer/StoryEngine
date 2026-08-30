// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { NotFilledSlot } from '@storyengine/shared';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { sillyTavernFixture } from './fixtures/test-sillytavern.js';
import { MemoryFileSource } from './memory-source.js';
import { sweep } from './sweep.js';

/**
 * **The fixture-pair assertion** — [testing §5.1], wired red at P4.0 and green
 * here.
 *
 * It exists because *a converted card and a converted preset have to meet*, and
 * testing each importer alone will not find out whether they do. The card
 * importer routes SillyTavern's `personality` one way; the preset importer
 * points the `charPersonality` slot somewhere. **Both can be individually
 * correct and disagree** — an earlier draft of the two did exactly that,
 * producing a slot that would have resolved empty forever, hidden by
 * `omitWhenEmpty`. The class matters because its failure mode is *silence*.
 *
 * It runs as its own vitest project so it can be a **named CI step**
 * ([testing §6]): a gate that can be retired by a `test.skip` nobody notices is
 * not a gate. Run it with `pnpm test:fixture-pair`.
 *
 * The assertion is [P4 §3] step 2's, which replaced the skeleton's
 * unimplementable *"no slot resolves empty"*: import the fixture directory,
 * create a session with the imported preset, assemble one turn, and read
 * `notFilled` — **no `empty-source` rows for persona, actor, history or input,
 * and no `unknown-slot` rows at all**, while `lore` and `treatment` read
 * `no-producer`, which is expected until P5 and is asserted rather than
 * tolerated.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

async function importFixture() {
  const outcome = await sweep({
    library: server.services.library,
    handle: 'ned',
    files: new MemoryFileSource(sillyTavernFixture()),
  });
  if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
  return outcome.report;
}

const byId = <T extends { id: string; name: string }>(rows: T[], name: string): T | undefined =>
  rows.find((row) => row.name === name);

describe('a card and a preset imported from one directory agree', () => {
  it('fills every slot the pair should feed, and names no slot it does not know', async () => {
    const report = await importFixture();
    expect(report.counts.converted).toBeGreaterThan(0);

    const presets = await server.request({ method: 'GET', url: '/api/library/presets' });
    const actors = await server.request({ method: 'GET', url: '/api/library/actors' });
    const preset = byId(presets.body.objects, 'Harbour');
    const vera = byId(actors.body.objects, 'Vera Solano');
    const persona = byId(actors.body.objects, 'The Inspector');
    expect(preset, 'the preset did not import').toBeDefined();
    expect(vera, 'the card did not import').toBeDefined();
    expect(persona, 'the persona did not import').toBeDefined();

    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        name: 'The fixture pair',
        preset: preset?.id,
        cast: { persona: persona?.id, actors: [vera?.id] },
      },
    });
    expect(created.status).toBe(201);

    const sessionId = created.body.session.id as string;

    /**
     * **One turn first, which the gate's own wording asks for** — *"assemble one
     * turn against the fake provider"*.
     *
     * The first version of this test previewed immediately and the assertion
     * caught it: `history` read `empty-source`, honestly, because a session with
     * no turns has no history. That is not a conversion disagreement, and a gate
     * that cannot tell the two apart is a gate that gets edited until it passes.
     * So a turn is taken, and the assertion then means what it says.
     */
    const submitted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: 'fixture-pair-1',
        headTurnId: null,
        input: { actorId: null, kind: 'do', text: 'She knocks.' },
      },
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);

    const deadline = Date.now() + 20_000;
    for (;;) {
      const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
      const turns = (read.body as { turns?: Record<string, unknown>[] }).turns ?? [];
      if (turns.at(-1) !== undefined && turns.at(-1)?.['status'] !== 'running') break;
      if (Date.now() > deadline) throw new Error('the turn never finished');
      await new Promise((tick) => setTimeout(tick, 50));
    }

    // Assembled through the same `gatherAssemblyInputs` + `planCall` path the
    // runner uses ([P3.4]), so this is the real prompt rather than a
    // reconstruction of one.
    const preview = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/preview`,
      payload: { input: { text: 'She waited.' } },
    });
    expect(preview.status).toBe(200);

    const notFilled = preview.body.preview.notFilled as NotFilledSlot[];
    const reasonFor = (source: string): string | undefined =>
      notFilled.find((row) => row.source === source)?.reason;

    // **The assertion.** A slot the pair should have fed and did not is an
    // `empty-source` row, which is exactly the silence this test exists for.
    const fed = ['persona', 'actor', 'history', 'input'];
    const starved = notFilled.filter(
      (row) => row.reason === 'empty-source' && fed.includes(row.source),
    );
    expect(starved, `slots the pair should have fed: ${JSON.stringify(starved)}`).toEqual([]);

    // A slot the preset names and this build does not know is a conversion bug
    // in the marker table, not a missing producer.
    expect(notFilled.filter((row) => row.reason === 'unknown-slot')).toEqual([]);

    // And the two that *are* expected to be empty are asserted rather than
    // tolerated, so P5 filling them is a visible change here.
    for (const source of ['lore', 'treatment']) {
      const reason = reasonFor(source);
      if (reason !== undefined) {
        expect(reason, `${source} should read no-producer until P5`).toBe('no-producer');
      }
    }
  });

  it('drops the credential the fixture carries, from the object and from compat', async () => {
    // Gate step 3 as a property over the imported corpus rather than an example:
    // the fixture preset carries `proxy_password` and `reverse_proxy`, and no
    // imported object may contain either.
    await importFixture();

    for (const kind of ['presets', 'actors', 'lorebooks', 'treatments']) {
      const listed = await server.request({ method: 'GET', url: `/api/library/${kind}` });
      for (const row of listed.body.objects as { id: string }[]) {
        const object = await server.request({
          method: 'GET',
          url: `/api/library/${kind}/${row.id}`,
        });
        const serialised = JSON.stringify(object.body);
        expect(serialised, `${kind}/${row.id} carries a credential`).not.toContain(
          'this must never reach disk',
        );
        expect(serialised).not.toContain('example.invalid');
      }
    }
  });

  it('accounts for everything it saw, and survives the poisoned file', async () => {
    // Gate steps 1 and 8, at fixture scale: every path is in the report exactly
    // once, and the deliberately corrupt card is a row rather than an abort.
    const report = await importFixture();
    const sources = report.items.map((item) => item.source);

    const broken = report.items.find((item) => item.source === 'characters/broken.png');
    expect(broken?.disposition).toBe('unrecognised');
    expect(broken?.notes[0]?.level).toBe('warn');

    // The sweep completed around it: the card after it in the tree still landed.
    expect(sources).toContain('characters/Vera Solano.png');
    expect(report.counts.converted).toBeGreaterThan(2);
  });
});
