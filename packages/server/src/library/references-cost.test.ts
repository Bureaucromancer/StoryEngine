// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { expect, it, vi } from 'vitest';

import { sessionEdges } from './references.js';

/**
 * ***Row 13's played cast costs one pass over the channel map, however many
 * arrived*** (2026-10-10, the review of the correction after [P16.3b]).
 *
 * `sessionEdges` is on the per-turn write path, not only the publish path:
 * `indexSession` runs it on every write of `session.json` — every appended
 * turn, every channel `PUT`, every head move, and every session during a
 * rebuild — synchronously, on the event loop. The correction gave each arrival a
 * pointer at the first channel key that names them, and found that key by
 * scanning the whole map once per arrival, asking `actorsWithState` about each
 * key it passed: *O(arrivals × keys)*. A long session's map is not small —
 * `se.lore.timing#<entry>` holds a key for every entry whose counters ever
 * moved — and the review measured the scan at 116 ms a call for 5,000 keys and
 * 40 arrivals, against 0.87 ms for one `actorsWithState` over the same map.
 *
 * ***Counted, not timed***, for the reason `auth/sign-in-cost.test.ts` gives: a
 * stopwatch would be the flakiest test in the suite, and the number of keys
 * `actorsWithState` is asked about is the cost the time follows. The bound is
 * *twice the map* — one pass that decides who arrived, one that finds each
 * arrival's first key — which any linear reading meets and the per-arrival scan
 * exceeds by the number of arrivals. *A file of its own* because the counter
 * wraps a module every other reference test uses as it is.
 */
const probes = vi.hoisted(() => ({ keys: 0 }));

vi.mock('../sessions/cast.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sessions/cast.js')>();
  return {
    ...actual,
    actorsWithState: (...args: Parameters<typeof actual.actorsWithState>) => {
      probes.keys += Object.keys(args[0]).length;
      return actual.actorsWithState(...args);
    },
  };
});

/**
 * A long session's channel map, the worst order for a scan that stops at the
 * first match: two thousand lorebook timing keys first, as a session that has
 * retrieved for a while holds them, and forty characters who walked in after.
 */
function longSession(arrivals: number): { channels: Record<string, { value: unknown }> } {
  const channels: Record<string, { value: unknown }> = {};
  for (let i = 0; i < 2000; i += 1) {
    channels[`se.lore.timing#entry-${String(i).padStart(4, '0')}`] = { value: { lastFired: i } };
  }
  for (let n = 0; n < arrivals; n += 1) {
    channels[`se.presence#actor-${String(n).padStart(2, '0')}`] = { value: true };
  }
  return { channels };
}

it('asks about each channel key at most twice, however many characters arrived', () => {
  const session = { cast: { persona: null, actors: [] }, ...longSession(40) };
  const size = Object.keys(session.channels).length;
  probes.keys = 0;

  const edges = sessionEdges(session);

  // The answer first, so a cheap reading that dropped somebody cannot pass.
  expect(edges.filter((edge) => edge.rule === 'session.cast.arrived')).toHaveLength(40);
  expect(edges.at(-1)?.field).toBe('/channels/se.presence#actor-39');
  expect(probes.keys).toBeLessThanOrEqual(2 * size);
});

it('costs the same for one arrival as for forty in a map of the same size', () => {
  // Same key count both ways: the second map trades thirty-nine arrivals for
  // thirty-nine more timing keys, so only the number of arrivals differs.
  const one = longSession(1);
  for (let i = 0; i < 39; i += 1) one.channels[`se.lore.timing#extra-${String(i)}`] = { value: 0 };
  const forty = longSession(40);
  expect(Object.keys(one.channels)).toHaveLength(Object.keys(forty.channels).length);

  probes.keys = 0;
  sessionEdges({ cast: {}, ...one });
  const forOne = probes.keys;
  probes.keys = 0;
  sessionEdges({ cast: {}, ...forty });
  expect(probes.keys).toBe(forOne);
});
