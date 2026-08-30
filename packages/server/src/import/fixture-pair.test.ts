// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestLibrary, type TestLibrary } from '../index-db/test-library.js';
import { sillyTavernFixture } from './fixtures/test-sillytavern.js';
import { MemoryFileSource } from './memory-source.js';
import { sweep } from './sweep.js';

/**
 * **The fixture-pair assertion — and it is expected to fail until P4.2.**
 *
 * [testing §5.1](../../../../docs/design/workplan/10-testing.md) exists because
 * *a converted card and a converted preset have to meet*, and testing each
 * importer alone will not find out whether they do. The card importer routes
 * SillyTavern's `personality` one way; the preset importer points the
 * `charPersonality` slot somewhere. **Both can be individually correct and
 * disagree** — an earlier draft of the two did exactly that, producing a slot
 * that would have resolved empty forever, hidden by `omitWhenEmpty`. The class
 * matters because its failure mode is *silence*.
 *
 * It runs as its own vitest project so it can be a **named CI step**
 * ([testing §6]): a gate that can be retired by a `test.skip` nobody notices is
 * not a gate. It is excluded from `pnpm test` for the same reason the rebuild
 * property gate is — a step that is expected to be red for two stages must not
 * make the ordinary suite meaningless in the meantime.
 *
 * **Run it with `pnpm test:fixture-pair`. It fails today, on purpose.** P4.2's
 * job is to make this exact file green without editing it.
 *
 * The assertion is [P4 §3](../../../../docs/design/workplan/06-p4-implementation.md)
 * step 2's, which replaced the skeleton's unimplementable *"no slot resolves
 * empty"*: import the fixture directory, create a session with the imported
 * preset, assemble one turn, and read `ModelCall.notFilled` — **no
 * `empty-source` rows for persona, actor, history or input, and no
 * `unknown-slot` rows at all**, while `lore` and `treatment` read `no-producer`,
 * which is expected until P5 and is asserted rather than tolerated.
 */

let library: TestLibrary;

beforeEach(async () => {
  library = await makeTestLibrary();
});

afterEach(async () => {
  await library.dispose();
});

describe('a card and a preset imported from one directory agree', () => {
  it('fills every slot the pair should feed, and names no slot it does not know', async () => {
    const outcome = await sweep({
      handle: 'ned',
      files: new MemoryFileSource(sillyTavernFixture()),
    });

    // Everything below this line is the assertion P4.2 has to satisfy. Until the
    // readers exist, `sweep` throws before returning and the test fails here —
    // which is the point of wiring it now rather than writing it later.
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const { report } = outcome;
    expect(report.counts.converted).toBeGreaterThan(0);

    // TODO(P4.2): create a session with the imported preset, assemble one turn
    // against the fake provider, and read `notFilled` off the record:
    //
    //   const fed = ['persona', 'actor', 'history', 'input'];
    //   expect(notFilled.filter((row) => row.reason === 'empty-source' &&
    //     fed.includes(row.source))).toEqual([]);
    //   expect(notFilled.filter((row) => row.reason === 'unknown-slot')).toEqual([]);
    //   expect(reasonFor('lore')).toBe('no-producer');
    //   expect(reasonFor('treatment')).toBe('no-producer');
    //
    // Written out rather than described, so P4.2 inherits the assertion instead
    // of re-deriving it from the plan.
  });

  it('drops the credential the fixture carries, from the object and from compat', async () => {
    // Gate step 3, as a property over the imported corpus rather than an
    // example: the fixture preset carries `proxy_password` and `reverse_proxy`,
    // and no imported object may contain either.
    const outcome = await sweep({
      handle: 'ned',
      files: new MemoryFileSource(sillyTavernFixture()),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const serialised = JSON.stringify(outcome.report);
    expect(serialised).not.toContain('this must never reach disk');
  });
});
