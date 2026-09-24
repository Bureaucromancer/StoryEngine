// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LOREBOOK_SCHEMA,
  newLorebook,
  newSetup,
  newTreatment,
  TREATMENT_SCHEMA,
  uuidv7,
  type Lorebook,
  type PlotHook,
  type Setup,
  type Treatment,
} from '@storyengine/shared';

import { DOCS_LOREBOOK_ID } from '../docs-lorebook.js';
import { LibraryError, read, versionsOf } from '../library.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

import { promoteSessionHook } from './promote.js';
import type { HookSource } from './types.js';
import { sessionFilePath } from './store.js';

/**
 * ***The valve out of a session*** — [03 §4.1](../../../../docs/design/03-data-model.md),
 * [06 §6.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [15 §5.1](../../../../docs/design/15-world.md).
 *
 * `hook-pool.test.ts` beside this file pins the copy running **in**, and its
 * central claim is [15 §5.1]'s: *a copied hook keeps the source hook's id*,
 * because a corpus of sessions whose hooks have unrelated ids cannot be
 * retro-fitted into a continuity. This file is the same obligation running
 * **out**, where it is sharper: a session's own hook has no upstream, so the id
 * it acquires when it is promoted is the only one it will ever have, and every
 * later copy of it is a copy of that.
 *
 * **Two things here would fail silently rather than loudly, and they are why
 * this is a unit test and not only a route test.**
 *
 * The first is the one the header of `promote.ts` argues at length: *the session
 * is not touched*. A promotion that re-attributed the pool entry to the object
 * it just wrote would pass every assertion about the target, and the damage
 * would surface a turn later as a hook that stopped being eligible in the
 * session somebody wrote it in — because `refuse` retires a `lore`-sourced hook
 * while its book is inactive. So the session file is compared **byte for byte**,
 * which is the only comparison that cannot be satisfied by a plausible-looking
 * rewrite.
 *
 * The second is the history record. [10 §11.2c]'s rule for entry imports is that
 * *the book's history is the record of the import*; nothing else anywhere says a
 * hook came from a session, so a promotion that wrote the object and skipped the
 * version would leave a treatment that gained a hook with no account of where it
 * came from — visible to nobody, and unrecoverable once the session is gone.
 */

let dataDir: string;
let server: TestServer;
let sessionId: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-promote-'));
  server = await makeTestServer({ dataDir });
  await setUpAdmin(server, 'ned', 'correct horse battery');
});

afterEach(async () => {
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

/** A whole hook, because promotion writes one into a schema that validates it. */
function aHook(id: string, title = 'The Flower Kingdom declares war'): PlotHook {
  return {
    id,
    title,
    premise: 'The Flower Kingdom will declare war before the thaw.',
    magnitude: 'sweeping',
    involves: [],
    weight: 1,
    delivery: 'guidance',
    once: true,
  };
}

/** A session carrying one hook of its own, which is the case with no upstream. */
async function aSessionWith(hook: PlotHook, over: Record<string, unknown> = {}): Promise<string> {
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Rain City', hooks: [hook], ...over },
  });
  sessionId = created.body.session.id as string;
  return sessionId;
}

async function aTreatment(): Promise<string> {
  const made = newTreatment('Rain City, noir');
  const response = await server.request({
    method: 'POST',
    url: '/api/library/treatments',
    payload: made,
  });
  return response.body.object.id as string;
}

async function aLorebook(): Promise<string> {
  const made = newLorebook('The Flower Kingdom');
  const response = await server.request({
    method: 'POST',
    url: '/api/library/lorebooks',
    payload: made,
  });
  return response.body.object.id as string;
}

function promote(
  hookId: string,
  target: { kind: 'treatment' | 'setup' | 'lore'; id: string },
  onSession = sessionId,
  from?: HookSource,
): ReturnType<typeof promoteSessionHook> {
  return promoteSessionHook(
    server.services.sessions,
    server.services.library,
    'ned',
    onSession,
    hookId,
    target,
    from,
  );
}

/**
 * ***One hook id, two pooled rows, different content*** — the state `poolFor`
 * refuses to collapse, built here the way an author would reach it.
 *
 * A treatment and one of its own lorebooks carrying the same hook is what that
 * function's docstring calls *"a real authoring situation"*, and promotion makes
 * it easier to reach rather than harder: saving a hook onto a second carrier is
 * exactly how one id comes to sit on two of them, after which the two copies are
 * edited on their own objects and drift.
 */
async function aSessionSeeingBothCopies(): Promise<{ treatment: string; book: string }> {
  const treatmentMade = {
    ...newTreatment('Rain City, noir'),
    hooks: [aHook('hook-duke', 'The duke')],
  };
  treatmentMade.hooks[0]!.premise = 'The duke dies before the thaw.';
  const treatment = (
    await server.request({
      method: 'POST',
      url: '/api/library/treatments',
      payload: treatmentMade,
    })
  ).body.object.id as string;

  const bookMade = {
    ...newLorebook('The Flower Kingdom'),
    hooks: [aHook('hook-duke', 'The duke')],
  };
  bookMade.hooks[0]!.premise = 'The duke is exiled before the thaw.';
  const book = (
    await server.request({ method: 'POST', url: '/api/library/lorebooks', payload: bookMade })
  ).body.object.id as string;

  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Rain City', treatment, lore: [book] },
  });
  sessionId = created.body.session.id as string;
  return { treatment, book };
}

describe('a hook promoted onto a library object', () => {
  it('lands on the treatment with the id it had in the pool', async () => {
    const treatment = await aTreatment();
    await aSessionWith(aHook('hook-war'));

    const outcome = await promote('hook-war', { kind: 'treatment', id: treatment });

    expect(outcome).toEqual({
      kind: 'promoted',
      object: { id: treatment, name: 'Rain City, noir', kind: 'treatment' },
    });
    const held = read(server.services.library, 'ned', treatment, TREATMENT_SCHEMA)
      .body as Treatment;
    // The whole hook, not the panel's redaction of it — `hookRows` never sends
    // `involves`, `weight`, `delivery` or `once`, and would not have sent
    // `premise` at all for a hook that has not fired. That is the entire reason
    // this runs on the server.
    expect(held.hooks).toEqual([aHook('hook-war')]);
  });

  it('appends rather than replacing what the object already carried', async () => {
    const made = { ...newTreatment('Rain City, noir'), hooks: [aHook('hook-old', 'The old one')] };
    const response = await server.request({
      method: 'POST',
      url: '/api/library/treatments',
      payload: made,
    });
    const treatment = response.body.object.id as string;
    await aSessionWith(aHook('hook-war'));

    await promote('hook-war', { kind: 'treatment', id: treatment });

    const held = read(server.services.library, 'ned', treatment, TREATMENT_SCHEMA)
      .body as Treatment;
    expect(held.hooks.map((one) => one.id)).toEqual(['hook-old', 'hook-war']);
  });

  /**
   * ***The omission the whole feature rests on*** — [06 §6.1]'s *pulled, never
   * pushed*, read in the direction that bites.
   *
   * Byte-identical rather than deep-equal: a rewrite that re-attributed the pool
   * entry, restamped `updatedAt`, or reordered the pool would all produce a file
   * that *looks* right in a structural comparison of the one field somebody
   * thought to assert on.
   */
  it('leaves the session file untouched, to the byte', async () => {
    const treatment = await aTreatment();
    await aSessionWith(aHook('hook-war'));
    const path = sessionFilePath(server.services.layout, 'ned', sessionId);
    const before = await readFile(path, 'utf8');

    await promote('hook-war', { kind: 'treatment', id: treatment });

    expect(await readFile(path, 'utf8')).toBe(before);
    // And the claim that byte-identity is standing in for: the pool entry still
    // says the session owns it. Re-attributing it to a lorebook would quietly
    // add `refuse`'s `book-inactive` clause to a hook that had none.
    const file: unknown = JSON.parse(before);
    expect((file as { hooks: { source: unknown }[] }).hooks[0]?.source).toEqual({
      kind: 'session',
    });
  });

  /**
   * [10 §11.2c], read one kind over: *the book's history is the record of the
   * import*. Nothing else records that a hook came from a session.
   */
  it('writes the promotion into the target’s history, naming the session', async () => {
    const treatment = await aTreatment();
    await aSessionWith(aHook('hook-war'));

    await promote('hook-war', { kind: 'treatment', id: treatment });

    const { versions } = await versionsOf(server.services.library, 'ned', treatment);
    const last = versions.at(-1);
    // `manual` rather than an eighth `VersionSource` arm — a person did this,
    // deliberately, and the reason says where they were standing. The arm it
    // would otherwise sit beside is `memory`, which exists because the engine
    // writes memories on its own initiative and this is the opposite of that.
    expect(last?.source).toEqual({ kind: 'manual' });
    expect(last?.reason).toBe('Plot hook saved from "Rain City"');
  });
});

describe('a lorebook, whose hooks are optional', () => {
  /**
   * The distinction `setSessionHooks` and `poolFor` both keep: **absent is not
   * an emptied list**. A book that never carried hooks and a book somebody
   * emptied are different states, and `hooks: []` is the second one.
   */
  it('gains the key on the first promotion, and never as an empty array', async () => {
    const book = await aLorebook();
    await aSessionWith(aHook('hook-war'));

    const before = read(server.services.library, 'ned', book, LOREBOOK_SCHEMA).body as Lorebook;
    expect('hooks' in before).toBe(false);

    await promote('hook-war', { kind: 'lore', id: book });

    const after = read(server.services.library, 'ned', book, LOREBOOK_SCHEMA).body as Lorebook;
    expect(after.hooks).toEqual([aHook('hook-war')]);
  });
});

describe('a Setup, which the session holds a copy of rather than a link to', () => {
  /**
   * `SessionFile.setup` is a **copy** ([04 §7]), so promoting to *the session's
   * Setup* means promoting to the library object that copy was made from — and
   * the write lands there, not on the copy the session is playing with. The
   * asymmetry is the preset's, and it is the reason the target is named by id in
   * the request rather than inferred from the session.
   */
  it('takes the hook onto the library object, leaving the session’s copy alone', async () => {
    const made = newSetup('The Fixer’s Debt');
    const response = await server.request({
      method: 'POST',
      url: '/api/library/setups',
      payload: made,
    });
    const setup = response.body.object.id as string;
    await aSessionWith(aHook('hook-war'), { setup });

    const outcome = await promote('hook-war', { kind: 'setup', id: setup });

    expect(outcome).toMatchObject({ kind: 'promoted', object: { kind: 'setup', id: setup } });
    const held = read(server.services.library, 'ned', setup).body as Setup;
    expect(held.hooks.map((one) => one.id)).toEqual(['hook-war']);

    const file: unknown = JSON.parse(
      await readFile(sessionFilePath(server.services.layout, 'ned', sessionId), 'utf8'),
    );
    expect((file as { setup: Setup }).setup.hooks).toEqual([]);
  });
});

/**
 * ***An id does not name one pooled row, and the panel draws every row.***
 *
 * `poolFor` deliberately does not de-duplicate — *"collapsing them here would
 * drop the attribution 03 §4.1 requires while making the pool disagree with what
 * the author sees in two places"* — so the pool legitimately holds two entries
 * under one id with **different content**, each drawn with its own control.
 * Resolving by id alone copies the first of them, which is the row above the one
 * somebody pressed; and because the id check then refuses every later attempt as
 * `already-there`, the hook they meant can never reach that object at all. So
 * the wrong copy is not merely wrong, it is **unrepairable by trying again**,
 * which is what makes this worth an argument and a test rather than a caveat.
 */
describe('which of two pooled rows sharing an id', () => {
  it('copies the row the caller names rather than the first with that id', async () => {
    const { book } = await aSessionSeeingBothCopies();
    const setupMade = newSetup('The Fixer’s Debt');
    const setup = (
      await server.request({ method: 'POST', url: '/api/library/setups', payload: setupMade })
    ).body.object.id as string;

    await promote('hook-duke', { kind: 'setup', id: setup }, sessionId, {
      kind: 'lore',
      id: book,
    });

    const held = read(server.services.library, 'ned', setup).body as Setup;
    expect(held.hooks[0]?.premise).toBe('The duke is exiled before the thaw.');
  });

  it('copies the treatment’s when that is the row named', async () => {
    const { treatment } = await aSessionSeeingBothCopies();
    const setup = (
      await server.request({
        method: 'POST',
        url: '/api/library/setups',
        payload: newSetup('The Fixer’s Debt'),
      })
    ).body.object.id as string;

    await promote('hook-duke', { kind: 'setup', id: setup }, sessionId, {
      kind: 'treatment',
      id: treatment,
    });

    const held = read(server.services.library, 'ned', setup).body as Setup;
    expect(held.hooks[0]?.premise).toBe('The duke dies before the thaw.');
  });

  /**
   * *A source the pool does not hold is the absence it says it is*, rather than
   * a quiet fall back to the first match — which would be the same wrong copy
   * arriving through the guard against it.
   */
  it('is no-such-hook for a source this pool does not carry', async () => {
    await aSessionSeeingBothCopies();
    const setup = (
      await server.request({
        method: 'POST',
        url: '/api/library/setups',
        payload: newSetup('The Fixer’s Debt'),
      })
    ).body.object.id as string;

    expect(
      await promote('hook-duke', { kind: 'setup', id: setup }, sessionId, { kind: 'session' }),
    ).toEqual({ kind: 'no-such-hook' });
  });

  /** And an id on its own still means what it can only mean: the first of them. */
  it('takes the first match when no source is named', async () => {
    const { treatment } = await aSessionSeeingBothCopies();
    const setup = (
      await server.request({
        method: 'POST',
        url: '/api/library/setups',
        payload: newSetup('The Fixer’s Debt'),
      })
    ).body.object.id as string;
    expect(treatment).toBeTruthy();

    await promote('hook-duke', { kind: 'setup', id: setup });

    const held = read(server.services.library, 'ned', setup).body as Setup;
    expect(held.hooks[0]?.premise).toBe('The duke dies before the thaw.');
  });
});

describe('what it refuses, each a different claim', () => {
  it('refuses a second promotion of the same hook, leaving the target as it was', async () => {
    const treatment = await aTreatment();
    await aSessionWith(aHook('hook-war'));
    await promote('hook-war', { kind: 'treatment', id: treatment });
    const after = read(server.services.library, 'ned', treatment, TREATMENT_SCHEMA);

    const second = await promote('hook-war', { kind: 'treatment', id: treatment });

    expect(second).toEqual({ kind: 'already-there' });
    // Not a duplicate and not a re-mint: [15 §5.1] calls a re-minted id the one
    // thing that cannot be repaired afterwards. The hash is the assertion that
    // nothing at all was written.
    const now = read(server.services.library, 'ned', treatment, TREATMENT_SCHEMA);
    expect(now.contentHash).toBe(after.contentHash);
    expect((now.body as Treatment).hooks).toHaveLength(1);
  });

  it('is no-such-hook for an id this pool does not carry', async () => {
    const treatment = await aTreatment();
    await aSessionWith(aHook('hook-war'));

    expect(await promote('hook-elsewhere', { kind: 'treatment', id: treatment })).toEqual({
      kind: 'no-such-hook',
    });
  });

  it('is no-such-object for a target that is gone', async () => {
    await aSessionWith(aHook('hook-war'));

    expect(await promote('hook-war', { kind: 'treatment', id: uuidv7() })).toEqual({
      kind: 'no-such-object',
    });
  });

  /**
   * *Wrong kind is the same absence*, because `read` is built that way: from the
   * caller's side that collection genuinely does not contain that id, and
   * answering *wrong kind* would confirm the object exists somewhere else.
   */
  it('is no-such-object for an id that is not the kind the target claims', async () => {
    const book = await aLorebook();
    await aSessionWith(aHook('hook-war'));

    expect(await promote('hook-war', { kind: 'treatment', id: book })).toEqual({
      kind: 'no-such-object',
    });
  });

  it('is no-session for a session that is not there', async () => {
    const treatment = await aTreatment();

    expect(await promote('hook-war', { kind: 'treatment', id: treatment }, uuidv7())).toEqual({
      kind: 'no-session',
    });
  });

  /**
   * The library's own refusal, raised by the write path rather than re-decided
   * here: a system object is app-shipped and a release would overwrite the edit
   * anyway ([10 §4.2]). *Copy to my library* is the intended move, and then the
   * copy is an ordinary target.
   */
  it('lets the library refuse a system-owned target', async () => {
    await aSessionWith(aHook('hook-war'));

    await expect(promote('hook-war', { kind: 'lore', id: DOCS_LOREBOOK_ID })).rejects.toThrow(
      LibraryError,
    );
    await expect(promote('hook-war', { kind: 'lore', id: DOCS_LOREBOOK_ID })).rejects.toMatchObject(
      { code: 'read-only' },
    );
  });
});
