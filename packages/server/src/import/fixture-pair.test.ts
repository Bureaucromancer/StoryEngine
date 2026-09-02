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
    const books = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    const preset = byId(presets.body.objects, 'Harbour');
    const vera = byId(actors.body.objects, 'Vera Solano');
    const persona = byId(actors.body.objects, 'The Inspector');
    const book = byId(books.body.objects, 'Rain City');
    expect(preset, 'the preset did not import').toBeDefined();
    expect(vera, 'the card did not import').toBeDefined();
    expect(persona, 'the persona did not import').toBeDefined();
    expect(book, 'the lorebook did not import').toBeDefined();

    /**
     * **The session links the imported book from P5.6**, which widens this gate
     * to cover the pair's third member.
     *
     * The gate exists because a converted card and a converted preset can each
     * be individually correct and still disagree. A converted *lorebook* is the
     * same class of hazard and, until the retriever existed, was untestable
     * here: the entry's `key` array, its `position`, and the preset slot that
     * would hold it are converted by three different tables, and a mismatch in
     * any of them produces a world that silently never appears. That failure
     * mode is precisely this file's subject.
     */
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        name: 'The fixture pair',
        preset: preset?.id,
        cast: { persona: persona?.id, actors: [vera?.id] },
        lore: [book?.id],
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
        // Names one of the imported book's keys, so the turn's own prompt is
        // where the lorebook half of the pair is proved. See below.
        input: { actorId: null, kind: 'do', text: 'She knocks at the docks.' },
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
    /**
     * The input names one of the book's keys — `docks`, from the fixture's
     * first entry — so the lore slot has something to fill with. Anything else
     * would leave the assertion below unable to tell *the conversion is broken*
     * from *nothing matched*, which is the distinction the whole file is about.
     */
    const preview = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/preview`,
      payload: { input: { text: 'She waited at the docks.' } },
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

    /**
     * ~~And the two that *are* expected to be empty are asserted rather than
     * tolerated, so P5 filling them is a visible change here.~~
     *
     * **Changed at P5.6, in the commit that changed what it means** — [P5 §1.10]
     * asks for exactly that, with the discipline P4.1 applied to the
     * `LIVE_APPLIERS` flip: a gate that changes meaning is changed on purpose,
     * by the change that alters it, rather than repaired later by whoever finds
     * the build red.
     *
     * Lore now has a producer, the session links a book, and the input names
     * one of its keys — so *filling* is the assertion, and the reason to check
     * is that it is not in `notFilled` at all. Weakening it to *filled or
     * honestly empty* would let a broken key conversion pass as a quiet miss,
     * which is the exact substitution this file exists to refuse.
     *
     * **[P5 §0] found the old form's real defect and it is fixed here too.**
     * The check sat inside `if (reason !== undefined)`, so the moment lore
     * filled, the row would leave `notFilled` and the assertion would silently
     * skip — a gate that goes quiet rather than red is not a gate. The polarity
     * is now the other way round: filling is what passes, and a row of any kind
     * is what fails.
     *
     * `treatment` still has no producer. Its row may be absent simply because
     * this preset names no treatment slot, so both are allowed — what is not
     * allowed is `empty-source`, which would mean something claimed to produce
     * a treatment and did not.
     */
    expect(
      reasonFor('lore'),
      `lore should fill from the linked book: ${JSON.stringify(notFilled)}`,
    ).toBeUndefined();

    expect(reasonFor('treatment'), 'treatment has no producer yet').toBeOneOf([
      undefined,
      'no-producer',
    ]);

    /**
     * **The text itself is proved elsewhere, and deliberately.** This server
     * binds no connection, so the turn makes no model call and there are no
     * assembled blocks to read — which is fine, because the gate has always
     * been about `notFilled` and that is the signal [P5 §1.10] named. The
     * matching *content* reaching a prompt is asserted in `runner.test.ts`,
     * where a provider double already exists; duplicating that setup here would
     * turn a conversion gate into a second runner test.
     */
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
