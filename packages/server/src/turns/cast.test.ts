// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor } from '@storyengine/shared';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { create, type LibraryContext } from '../library.js';
import { channelKey } from '../sessions/channels.js';
import { SE_PRESENCE, SE_STATUS } from '../sessions/cast.js';
import { Layout } from '../storage/layout.js';
import { resolveCast } from './cast.js';

/**
 * Who the assembler thinks is in this story — [P7.3], 2026-09-12.
 *
 * **The half that matters is the union.** [P7.2] gave the cast panel a set built
 * from the session's roster *and* from the actors the channels name, on the
 * argument that somebody written into the story without being added to
 * `cast.actors` is *"exactly the drift the panel exists to make visible"*. The
 * assembler read the roster alone, so the drift was visible in one surface and
 * invisible in the one that costs something: the panel gave the new arrival a
 * row and the prompt carried no character card for them, every turn thereafter.
 *
 * The rest of this file is the never-throws contract, which is older than the
 * union and must survive it: this function is handed whatever is in
 * `session.json` and whatever the channel map holds, and neither is validated
 * before it arrives.
 */

let dataDir: string;
let index: OpenedIndex;
let library: LibraryContext;

const ACCOUNT = 'ned';
const REGISTRY = { schema: 'storyengine.taglist/1' as const, tags: [] };

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-cast-'));
  index = await openIndex({ path: ':memory:' });
  library = { db: index.db, layout: new Layout(dataDir), keepHistoryPerObject: 0 };
});

afterEach(async () => {
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function actor(name: string): Promise<string> {
  const made = newActor(name);
  await create(library, ACCOUNT, made);
  return made.id;
}

/** One presence effect's worth of channel state, as `applyEffects` would leave it. */
function present(actorId: string, value = true): Record<string, { value: unknown }> {
  return { [channelKey(SE_PRESENCE, actorId)]: { value } };
}

describe('resolveCast', () => {
  it('reads the roster, in the order the session declares it', async () => {
    const vera = await actor('Vera');
    const lund = await actor('Lund');

    const resolved = resolveCast(
      library,
      ACCOUNT,
      { persona: null, actors: [vera, lund] },
      REGISTRY,
      {},
    );

    expect(resolved.actors.map((one) => one.actor.id)).toEqual([vera, lund]);
  });

  /**
   * **The drift, measured.** Before this parameter existed the second assertion
   * was `[vera]` — the panel's row and the prompt's silence, from one channel
   * effect nobody had to hand-edit: `se.presence` is `model-proposed`.
   */
  it('resolves an actor the channels name and the roster does not', async () => {
    const vera = await actor('Vera');
    const stranger = await actor('The Stranger');

    const resolved = resolveCast(
      library,
      ACCOUNT,
      { persona: null, actors: [vera] },
      REGISTRY,
      present(stranger),
    );

    expect(resolved.actors.map((one) => one.actor.id)).toEqual([vera, stranger]);
  });

  /**
   * **`false` still counts, and this is the finding that settled where the
   * roster lives.** `se.presence` declares `init: false`, so *in the cast and
   * elsewhere* and *not in the cast at all* are the same value — a roster read
   * off presence values could not tell them apart. What the channel map does
   * carry is the *key*, which is why `actorsWithState` matches on the key and
   * why an actor who has walked out is still someone this story is about.
   */
  it('keeps an actor the channels say has left the scene', async () => {
    const stranger = await actor('The Stranger');

    const resolved = resolveCast(
      library,
      ACCOUNT,
      { persona: null, actors: [] },
      REGISTRY,
      present(stranger, false),
    );

    expect(resolved.actors.map((one) => one.actor.id)).toEqual([stranger]);
  });

  it('takes a status effect as naming somebody too, not only presence', async () => {
    const stranger = await actor('The Stranger');

    const resolved = resolveCast(library, ACCOUNT, { persona: null, actors: [] }, REGISTRY, {
      [channelKey(SE_STATUS, stranger)]: { value: 'dead' },
    });

    expect(resolved.actors.map((one) => one.actor.id)).toEqual([stranger]);
  });

  /**
   * [00 §3.3] and `assembly/collect.ts`'s `{{char}}`: an arrival appends rather
   * than sorting into the roster, because `actors[0]` is what that macro means
   * and it must not change identity part-way through somebody's story.
   */
  it('never lets an arrival take the first seat', async () => {
    const vera = await actor('Vera');
    const abel = await actor('Abel');

    const resolved = resolveCast(
      library,
      ACCOUNT,
      { persona: null, actors: [vera] },
      REGISTRY,
      present(abel),
    );

    expect(resolved.actors[0]?.actor.id).toBe(vera);
  });

  it('does not also seat the persona as an actor when the channels name them', async () => {
    const player = await actor('You');

    const resolved = resolveCast(
      library,
      ACCOUNT,
      { persona: player, actors: [] },
      REGISTRY,
      present(player),
    );

    expect(resolved.persona?.actor.id).toBe(player);
    expect(resolved.actors).toEqual([]);
  });

  it('does not seat the same actor twice when the roster and the channels agree', async () => {
    const vera = await actor('Vera');

    const resolved = resolveCast(
      library,
      ACCOUNT,
      { persona: null, actors: [vera] },
      REGISTRY,
      present(vera),
    );

    expect(resolved.actors.map((one) => one.actor.id)).toEqual([vera]);
  });

  /**
   * The never-throws contract, over the new source as well as the old one. A
   * scope key is whatever was in the effect log; nothing promises it is an
   * actor id, and a channel map is as hand-editable as the cast field.
   */
  it('reads a channel key that names nothing as nothing', () => {
    const resolved = resolveCast(
      library,
      ACCOUNT,
      { persona: null, actors: [] },
      REGISTRY,
      present('not-an-actor'),
    );

    expect(resolved.actors).toEqual([]);
  });

  it('survives a cast field that is not a cast', async () => {
    const stranger = await actor('The Stranger');

    expect(resolveCast(library, ACCOUNT, null, REGISTRY, {}).actors).toEqual([]);
    expect(resolveCast(library, ACCOUNT, undefined, REGISTRY, {}).actors).toEqual([]);
    // A hand-edited `actors: "vera"` reaches here, and the channel half must
    // still resolve rather than being lost with the malformed half.
    expect(
      resolveCast(
        library,
        ACCOUNT,
        { persona: 7, actors: 'vera' },
        REGISTRY,
        present(stranger),
      ).actors.map((one) => one.actor.id),
    ).toEqual([stranger]);
  });
});
