// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { LOREBOOK_SCHEMA, newLorebook } from '@storyengine/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { create, read, update } from '../../library.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import { planArrivals, type ArrivalObject } from './plan.js';

/**
 * ***Keep-both's fixed point costs a comparison per object, and one more per
 * object it names that moved*** — the P16.3e review, which measured the pass
 * structure at *N²/2* comparisons over a chain: each pass flipped one object
 * and compared every object not yet copied again (320 objects, 10.6 s; 4,096,
 * the entry limit, about half an hour).
 *
 * ***Counted, not timed***, for `auth/sign-in-cost.test.ts`'s reason: the
 * number of `identifyNative` calls is the cost the time follows, and a
 * stopwatch would be the flakiest test in the suite. The chain is the worst
 * order for passes — each object names the next, and only the last differs —
 * and a worklist over who names whom asks of each object once, and once more
 * when the one it names becomes a copy: under *3N* where passes took *N²/2*.
 * *A file of its own* because the counter wraps a module every other plan
 * test uses as it is.
 */
const probes = vi.hoisted(() => ({ compared: 0 }));

vi.mock('../identity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../identity.js')>();
  return {
    ...actual,
    identifyNative: (...args: Parameters<typeof actual.identifyNative>) => {
      probes.compared += 1;
      return actual.identifyNative(...args);
    },
  };
});

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

it('compares each object of a chain about twice, not once per pass', async () => {
  const library = server.services.library;
  const length = 40;
  const books = Array.from({ length }, (_, at) => newLorebook(`Link ${String(at)}`));
  // Each names the next, as a description quoting its id — any string field is a reference.
  books.forEach((book, at) => {
    book.description = books[at + 1]?.id ?? '';
  });
  for (const book of books) await create(library, 'ned', book, LOREBOOK_SCHEMA);
  // Only the last moved on since the file was made.
  const last = books[length - 1]!;
  const stored = read(library, 'ned', last.id);
  await update(
    library,
    'ned',
    last.id,
    { ...(stored.body as object), description: 'Edited since.' },
    stored.contentHash,
  );

  const objects: ArrivalObject[] = books.map((book) => ({
    id: book.id,
    schemaId: LOREBOOK_SCHEMA,
    body: structuredClone(book),
  }));
  probes.compared = 0;

  const plan = await planArrivals(objects, {
    library,
    handle: 'ned',
    policy: 'keep-both',
    tags: null,
  });

  // Every one is a copy — the last differs, and each names the one after it.
  expect([...plan.byFileId.values()].every((arrival) => arrival.keptBoth)).toBe(true);
  expect(probes.compared).toBeLessThan(3 * length);
});
