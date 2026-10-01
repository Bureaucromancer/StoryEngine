// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Mode } from '@storyengine/sdk';

import { convertCard } from '../import/sillytavern/card.js';
import { create } from '../library.js';
import { registerMode } from '../mode-registry.js';
import { readAllTurns } from '../sessions/segments.js';
import { Layout } from '../storage/layout.js';
import { TEST_MODE, TEST_MODE_DEFINITION, TEST_STEP } from '../test-mode.js';
import {
  newLorebook,
  newLoreEntry,
  newTreatment,
  type AssembledPreview,
  type Lorebook,
  type LoreEntry,
  type TurnPreview,
} from '@storyengine/shared';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The stateless preview — [P3.4], [P3 §1.6].
 *
 * The claim this file exists to hold is a **negative** one: the route answers
 * what a turn would assemble to and *changes nothing while doing it*. That is
 * cheap to state and easy to lose — one convenience later, a preview that
 * reserved a job or reconciled a hand edit would still return the right
 * numbers, and the only thing that would notice is a test written now.
 *
 * The other half is the unbound install, which is not an edge case here: it is
 * what every install looks like before somebody configures a model, and [P3.4]
 * requires the meter to stay visible and say why rather than vanish.
 */

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a04';

let server: TestServer;
let sessionId: string;

async function bindProse(models: string[] = ['fake-hi'], maxContextTokens = 32_000): Promise<void> {
  const root = new Layout(server.dataDir).userConnectionsRoot('ned');
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'fake.json'),
    JSON.stringify({
      id: CONNECTION_ID,
      label: 'The double',
      provider: 'openai-compatible',
      models,
      capabilities: { maxContextTokens },
    }),
  );
  await writeFile(
    join(server.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );
}

async function preview(body: Record<string, unknown> = {}) {
  return server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/preview`,
    payload: body,
  });
}

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Rain City' },
  });
  sessionId = created.body.session.id as string;
});

afterEach(async () => {
  await server.dispose();
});

describe('a preview with a model bound', () => {
  it('assembles the pending action without reserving a job or writing a turn', async () => {
    await bindProse();

    const response = await preview({ input: { text: 'She opened the door.' } });
    expect(response.status).toBe(200);

    const answer = response.body.preview as {
      state: string;
      pendingInput: boolean;
      stepId: string;
      blocks: { id: string; text: string }[];
      budget: { spent: number; limit: { tokens: number } };
    };
    expect(answer.state).toBe('assembled');
    expect(answer.pendingInput).toBe(true);
    // The typed action is in the prompt, and the verdict has ruled on it.
    expect(answer.blocks.some((block) => block.text.includes('She opened the door.'))).toBe(true);
    expect(answer.budget.spent).toBeGreaterThan(0);
    expect(answer.budget.limit.tokens).toBeGreaterThan(0);

    // **Nothing happened.** No job was reserved, so the session is not busy;
    // no turn was appended, so the transcript is untouched. The falsifying
    // mutation is routing the handler through `submitTurn`, which returns
    // plausible numbers and quietly takes the session's one active-job slot.
    const session = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(session.body.activeJob).toBeNull();

    const turns = await readAllTurns(
      join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'turns'),
    );
    expect(turns).toHaveLength(0);
  });

  it('names the step it previewed, and previews the prose call', async () => {
    await bindProse();

    const answer = (await preview({ input: { text: 'Look around.' } })).body.preview as {
      stepId: string;
      callKind: string;
      purpose: string;
      resolved: { modelId: string };
    };

    // The meter's question is whether the *story* context fits, and the answer
    // says which call it measured rather than leaving it to be assumed. The
    // falsifying mutation is taking `steps[0]` blindly.
    expect(answer.stepId).toBe('se.narrate');
    expect(answer.callKind).toBe('narrate');
    expect(answer.purpose).toBe('prose');
    // The model that *would* be asked — nothing has answered.
    expect(answer.resolved.modelId).toBe('fake-hi');
  });

  it('reads at rest, and says nothing is composed', async () => {
    await bindProse();

    // The always-visible half: with no draft the meter still has a reading —
    // the context before you type — and the panel must not mistake it for a
    // turn being composed.
    const answer = (await preview()).body.preview as {
      state: string;
      pendingInput: boolean;
      budget: { spent: number };
    };
    expect(answer.state).toBe('assembled');
    expect(answer.pendingInput).toBe(false);
    expect(answer.budget.spent).toBeGreaterThan(0);
  });

  it('counts the guidance, which is the other thing on the input bar', async () => {
    await bindProse();

    const without = (await preview({ input: { text: 'Look around.' } })).body.preview as {
      budget: { spent: number };
    };
    const with_ = (
      await preview({
        input: { text: 'Look around.' },
        guidance: 'Keep it tense. No comfort yet, and let the rain do the talking.',
      })
    ).body.preview as { budget: { spent: number }; pendingInput: boolean };

    // Guidance is a block ([06 §5.1]), so it costs tokens — a meter that
    // ignored it would under-read whenever the box is open.
    expect(with_.budget.spent).toBeGreaterThan(without.budget.spent);
    expect(with_.pendingInput).toBe(true);
  });
});

/**
 * ***Measured against the model the session chose*** (2026-09-27). The
 * preview resolved its model without the session's overrides, so a session
 * whose narrator was pointed at a bigger model was metered against the account
 * default's window, under the account default's name, and reported blocks
 * dropped that the turn would send.
 */
describe('a preview for a session with its own model', () => {
  it('names and measures the model the session overrides to', async () => {
    await bindProse(['fake-hi', 'fake-lo']);
    const roles = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/roles`,
      payload: { roles: { prose: { connectionId: CONNECTION_ID, modelId: 'fake-lo' } } },
    });
    expect(roles.status).toBe(200);

    const answer = (await preview({ input: { text: 'Look around.' } })).body.preview as {
      resolved: { modelId: string };
    };
    expect(answer.resolved.modelId).toBe('fake-lo');
  });
});

/**
 * ***A Freeform preview shows the premise*** (2026-09-30) — the `setup` slot,
 * filled through the same gather the turn uses, so the meter measures the
 * prompt the narrator will actually get.
 */
describe('a Freeform preview', () => {
  it('shows the premise the narrator will be told', async () => {
    await bindProse();
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        name: 'Drowned city',
        mode: 'storyengine.freeform',
        modeConfig: {
          premise: 'A smuggler owes the wrong people.',
          difficulty: 'even',
          directedness: 'following',
        },
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    sessionId = created.body.session.id as string;

    const answer = (await preview({ input: { text: 'Look around.' } })).body.preview as {
      blocks: { id: string; text: string }[];
    };

    expect(answer.blocks.find((block) => block.id === 'se.premise')?.text).toBe(
      'What this story is about: A smuggler owes the wrong people.',
    );
  });
});

describe('a preview with nothing bound', () => {
  it('is unmeasurable rather than an error, and says which way', async () => {
    // The state every install is in before it is configured. A 4xx would push
    // this into the client's error channel and tempt the meter into an alert;
    // *nothing is bound to the prose role* is a true answer to *how full is
    // the context*. The falsifying mutation is rethrowing `RoleUnresolved`.
    const response = await preview({ input: { text: 'She opened the door.' } });
    expect(response.status).toBe(200);

    const answer = response.body.preview as { state: string; reason: string };
    expect(answer.state).toBe('unmeasurable');
    expect(answer.reason).toBe('role-unbound');
  });

  it('still answers why a slot is empty', async () => {
    // [P3.0] §7.5's answer does not need a model, and an unconfigured install
    // is exactly where somebody is most likely to be asking. The falsifying
    // mutation is dropping `notFilled` from the unmeasurable arm.
    const answer = (await preview({ input: { text: 'Look.' } })).body.preview as {
      notFilled: { blockId: string; reason: string }[];
    };

    expect(answer.notFilled.length).toBeGreaterThan(0);
    expect(answer.notFilled.some((slot) => slot.blockId === 'se.lore')).toBe(true);
  });

  /**
   * *No room beside the reply is no denominator either* (2026-09-27): the turn
   * would be refused, so the meter says so rather than measuring a prompt with
   * every block dropped. Scene keeps 800 for the reply and spends three
   * quarters of the window; a 1000-token window leaves nothing.
   */
  it('says the window has no room beside the reply', async () => {
    await bindProse(['fake-hi'], 1000);

    const answer = (await preview({ input: { text: 'Look.' } })).body.preview as {
      state: string;
      reason: string;
    };
    expect(answer).toMatchObject({ state: 'unmeasurable', reason: 'window-too-small' });
  });

  it('tells a dangling binding from an unbound one', async () => {
    // The remedies differ — one is setup, the other is an admin having removed
    // a connection out from under a binding — so the class travels.
    await writeFile(
      join(server.dataDir, 'users', 'ned', 'bindings.json'),
      JSON.stringify({ prose: { connectionId: 'no-such-connection', modelId: 'fake-hi' } }),
    );

    const answer = (await preview({ input: { text: 'Look.' } })).body.preview as {
      reason: string;
    };
    expect(answer.reason).toBe('role-dangling');
  });
});

/**
 * ***A preview asks the turn's question about cadence, in the turn's count***
 * (2026-09-27) — `sessions/depth.ts`.
 *
 * The preview evaluates the prose step's condition so it can say *not this
 * turn* instead of measuring a call that will not happen, and it counted the
 * path's length the way the runner did. A channel write is a turn on the path
 * and not one of the story, so a mode narrating every other turn was measured
 * as narrating the first one.
 */
describe('a preview of a step that does not run every turn', () => {
  const EVERY_OTHER_ID = 'storyengine.test.every-other';
  const EVERY_OTHER: Mode = {
    definition: {
      ...TEST_MODE_DEFINITION,
      id: EVERY_OTHER_ID,
      displayName: 'Engine test fixture — every other turn',
      steps: [{ ...TEST_STEP, when: { when: 'cadence', everyNTurns: 2 } }],
    },
    run: TEST_MODE.run,
  };

  it('counts the turns of the story, not a channel write before them', async () => {
    registerMode(EVERY_OTHER);
    await bindProse();
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Alternate', mode: EVERY_OTHER_ID },
    });
    expect(created.status).toBe(201);
    sessionId = created.body.session.id as string;

    const written = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/channels/se.hook.pacing`,
      payload: { value: 'sparse' },
    });
    expect(written.status).toBe(200);

    // The first turn of the story, with a dial change before it: not the second.
    const answer = (await preview({ input: { text: 'Look.' } })).body.preview as {
      state: string;
      reason?: string;
    };
    expect(answer).toMatchObject({ state: 'unmeasurable', reason: 'not-this-turn' });
  });
});

describe('what a preview refuses to touch', () => {
  it('does not reconcile a hand edit, and appends no divergence turn', async () => {
    await bindProse();

    /**
     * **The test most likely to be deleted by somebody tidying up two
     * ownership helpers that look alike**, so: `mine()` reconciles hand edits,
     * which takes the non-reentrant session lock and appends a
     * user-authored divergence turn when the file has moved. Correct for a
     * read somebody performs by opening a session; wrong for one that fires
     * every time they pause typing, because it would make *looking at a
     * meter* move the head the meter measures against. The preview goes
     * through `readMine` instead, and this is what says so.
     */
    const file = join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json');
    const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    stored['channels'] = {
      'se.clock': { version: 1, value: { day: 9, hour: 9, minute: 9 } },
    };
    await writeFile(file, JSON.stringify(stored, null, 2));

    const response = await preview({ input: { text: 'Look around.' } });
    expect(response.status).toBe(200);

    const turns = await readAllTurns(
      join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'turns'),
    );
    expect(turns).toHaveLength(0);
  });

  it('answers 404 for a session that is not this account’s', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/sessions/01a04c00-0000-7000-8000-00000000000f/preview',
      payload: { input: { text: 'Look.' } },
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('not-found');
  });

  it('refuses a body that names a field it does not have', async () => {
    // The envelope is closed, like every other write-shaped body here: a
    // client sending `headTurnId` is making an assumption this route does not
    // honour, and silence would let it think the preview was pinned.
    const response = await preview({ input: { text: 'Look.' }, headTurnId: 'nope' });
    expect(response.status).toBe(400);
  });
});

/**
 * **The keyword tester's round trip** — [P5.8], [10 §3].
 *
 * *Paste sample text, see which entries would fire.* The tester needs no
 * endpoint of its own, and this test is what makes that claim checkable: the
 * pasted text goes in as the input, and the answer carries both halves — what
 * fired, as blocks, and what did not, with the rule that stopped each one.
 *
 * The half worth the test is the second one. A fired entry was already legible
 * as a block with a reason beside it; nothing anywhere could say why an entry
 * did *not* fire, and per PLAYABLE that is the question this stage exists to
 * answer.
 */
describe('what the retriever did, on the preview', () => {
  async function aBookOf(entries: LoreEntry[], edits: Partial<Lorebook> = {}): Promise<Lorebook> {
    const made = { ...newLorebook('Rain City'), entries, ...edits };
    const posted = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: made,
    });
    if (posted.status !== 201) throw new Error(`the book did not save: ${String(posted.status)}`);
    return made;
  }

  function entryOf(name: string, edits: Partial<LoreEntry> = {}): LoreEntry {
    return { ...newLoreEntry(name), ...edits };
  }

  /**
   * **The session has to select the book.** Saving one to the library puts it
   * nowhere: a lorebook does not volunteer, whatever its own `scope` says, and
   * these tests used to rely on `global` admitting it — which is precisely the
   * behaviour that was reversed.
   */
  async function selectBook(book: Lorebook): Promise<void> {
    const put = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/lore`,
      payload: { treatment: null, lore: [book.id] },
    });
    if (put.status !== 200) throw new Error(`the link did not save: ${String(put.status)}`);
  }

  it('reports what the pasted text fired, and what it did not', async () => {
    await selectBook(
      await aBookOf([
        entryOf('The Ferryman', { keys: ['ferryman'], content: 'He works the crossing.' }),
        entryOf('The Council', { keys: ['council'], content: 'They settle nothing.' }),
      ]),
    );
    await bindProse();

    const response = await preview({ input: { text: 'She asked the ferryman.' } });

    expect(response.status).toBe(200);
    const body = response.body.preview as TurnPreview;
    // Fired: a block, with the key that did it in the reason.
    const lore = (body as AssembledPreview).blocks.filter((one) => one.source.kind === 'lore');
    expect(lore.map((one) => one.text)).toEqual(['He works the crossing.']);
    expect(lore[0]?.reason).toContain('ferryman');
    // Did not: named, with the rule.
    expect(body.lore.skipped.map((one) => [one.entryName, one.reason])).toEqual([
      ['The Council', 'no-match'],
    ]);
  });

  /**
   * The books row is the one that answers *is my lorebook even being looked
   * at*, which is a different question from *did anything match* and has a
   * different repair. It is reported for a book that contributed nothing,
   * because that is exactly when somebody is asking.
   */
  it('names every book in play and how it got there', async () => {
    const book = await aBookOf([entryOf('Quiet', { keys: ['nowhere'] })]);
    await selectBook(book);
    await bindProse();

    const body = (await preview({ input: { text: 'nothing relevant' } })).body
      .preview as TurnPreview;

    expect(body.lore.books).toEqual([
      expect.objectContaining({ bookId: book.id, bookName: 'Rain City', by: 'session' }),
    ]);
  });

  /**
   * **Carried on the unmeasurable arm too**, which is `notFilled`'s reason: the
   * scan runs before the role is resolved, so an install with nothing bound
   * still has a complete answer to *why is my world not appearing* — and that
   * install is precisely where somebody is asking.
   */
  it('answers about the lore even with no model bound', async () => {
    await selectBook(await aBookOf([entryOf('The Ferryman', { keys: ['ferryman'] })]));

    const body = (await preview({ input: { text: 'a quiet evening' } })).body
      .preview as TurnPreview;

    expect(body.state).toBe('unmeasurable');
    expect(body.lore.skipped.map((one) => one.reason)).toEqual(['no-match']);
  });
});

/**
 * **The preview's carriers** — [P5.9].
 *
 * The runner and the preview must not disagree about what would be sent, which
 * is `gather.ts`'s whole reason for existing; a preview that fetched the books
 * and forgot the treatment's prose would show somebody a prompt they are not
 * about to send, and the difference would be invisible in both. This is the
 * assertion that keeps the two wired the same way.
 */
describe('writing samples on the preview', () => {
  it('offers a treatment’s sample and a book’s, from the session’s own links', async () => {
    const noir = newTreatment('Rain City Noir');
    noir.writingSamples = [
      { id: 't-s1', title: 'Tone', body: 'The rain never lets up.', enabled: true, note: '' },
    ];
    const book = newLorebook('Rain City');
    book.writingSamples = [
      { id: 'b-s1', title: 'Register', body: 'Nobody hurries here.', enabled: true, note: '' },
    ];
    for (const object of [noir, book]) {
      const kind = object === noir ? 'treatments' : 'lorebooks';
      const posted = await server.request({
        method: 'POST',
        url: `/api/library/${kind}`,
        payload: object,
      });
      if (posted.status !== 201) throw new Error(`did not save: ${String(posted.status)}`);
    }
    await bindProse();

    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Samples', treatment: noir.id, lore: [book.id] },
    });
    const withLinks = created.body.session.id as string;

    const response = await server.request({
      method: 'POST',
      url: `/api/sessions/${withLinks}/preview`,
      payload: { input: { text: 'She waited.' } },
    });

    expect(response.status).toBe(200);
    const preview = response.body.preview as AssembledPreview;
    const samples = preview.blocks.filter((one) => one.source.kind === 'samples');

    // Both carriers, and in [04 §3.1]'s order — the stance, then the world.
    expect(samples.map((one) => one.text)).toEqual([
      'The rain never lets up.',
      'Nobody hurries here.',
    ]);
  });
});

/**
 * ***A chat's preview, and [P14.3]'s *Ends at**** — a preview of an imported
 * SillyTavern card's session shows the card's system prompt stacked after the
 * pack's instruction and its post-history instructions last, and a second
 * preview with that card's prompts switched off shows neither. Through the
 * card converter and the route, so the section ids the importer writes are the
 * ones the Scene pack places.
 */
describe('a chat’s preview', () => {
  async function imported(card: Record<string, unknown>): Promise<string> {
    const converted = convertCard({ spec: 'chara_card_v2', data: card }, 'fallback');
    if (!converted.ok) throw new Error(`refused: ${converted.refusal}`);
    await create(server.services.library, 'ned', converted.value.actor);
    return converted.value.actor.id;
  }

  async function chatWith(actors: string[]): Promise<void> {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'A chat', cast: { persona: null, actors } },
    });
    expect(created.status).toBe(201);
    sessionId = created.body.session.id as string;
  }

  async function blocksOf(input: string): Promise<{ id: string; role: string; text: string }[]> {
    const response = await preview({ input: { text: input } });
    const answer = response.body.preview as AssembledPreview;
    expect(answer.state).toBe('assembled');
    return answer.blocks;
  }

  it('stacks an imported card’s system prompt after the instruction, and its post-history last', async () => {
    await bindProse();
    const vera = await imported({
      name: 'Vera',
      description: 'A fence with a long memory.',
      system_prompt: 'You are {{char}}. Answer in short sentences.',
      post_history_instructions: 'Stay as {{char}}.',
    });
    await chatWith([vera]);

    const blocks = await blocksOf('Evening.');
    const ids = blocks.map((block) => block.id);
    const system = ids.indexOf(`se.card.system.${vera}`);

    expect(ids[system - 1]).toBe('se.instruction.embodied');
    expect(blocks[system]?.text).toBe('You are Vera. Answer in short sentences.');
    expect(blocks.at(-1)).toMatchObject({
      id: `se.card.post-history.${vera}`,
      role: 'user',
      text: 'Stay as Vera.',
    });

    // Switched off for this card — the session field P14.5's panel will write.
    const file = join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json');
    const session = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...session, prompts: { cards: { [vera]: false } } }));

    const off = (await blocksOf('Evening.')).map((block) => block.id);
    expect(off).not.toContain(`se.card.system.${vera}`);
    expect(off).not.toContain(`se.card.post-history.${vera}`);
    expect(off).toContain('se.instruction.embodied');
  });

  it('previews the first speaker’s call under per-actor dispatch, not one merged call', async () => {
    // [P14.2] left the preview assembling one merged call. The mention decides
    // `natural`'s first speaker, so the preview can say whose call it shows.
    await bindProse();
    const vera = await imported({ name: 'Vera', description: 'A fence.' });
    const lund = await imported({ name: 'Lund', description: 'The harbourmaster.' });
    await chatWith([vera, lund]);

    const blocks = await blocksOf('Lund, is the gate shut?');
    const instruction = blocks.find((block) => block.id === 'se.instruction.embodied')?.text;

    expect(instruction).toContain("Write Lund's next reply");
    // The speaker's card first.
    const ids = blocks.map((block) => block.id);
    expect(ids.indexOf(`se.actor.summary.${lund}`)).toBeLessThan(
      ids.indexOf(`se.actor.summary.${vera}`),
    );
  });

  it('previews a scene nobody has been cast in as the narrator’s call', async () => {
    // The session made in `beforeEach` has no cast: no selection, so the one
    // call nobody speaks, in the narrator's voice (`turnSelection`).
    await bindProse();

    const ids = (await blocksOf('I wait.')).map((block) => block.id);
    expect(ids).toContain('se.instruction');
    expect(ids).not.toContain('se.instruction.embodied');
  });
});
