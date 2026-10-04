// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The seeded install is playable — [P6B.0].
 *
 * **`pnpm seed` built a treatment with a lorebook and then created its session
 * naming neither**, so the one command whose whole purpose is *a known library
 * and a playable session* produced a session that resolved zero books. It
 * shipped that way through P5 and P6 and nothing noticed, because no test
 * looked at the script and every server test builds its selection by hand —
 * which is [P5 §0.5](../docs/design/workplan/17-p5-implementation.md)'s
 * finding, and half the reason PLAYABLE could not run.
 *
 * **A text assertion, and it is weak on purpose.** The honest proof is the
 * walk — reset, seed, take a turn, read the lore report — and that is
 * [P6B §3](../docs/design/workplan/20-p6b-playable.md) step 3, a person's.
 * What this catches is the regression: somebody editing the session block and
 * dropping the field again, silently, exactly as before. The same weak-but-real
 * shape `release.test.ts` uses on the workflow, and for the same reason.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = readFileSync(join(root, 'tools', 'seed.mjs'), 'utf8');

describe('the seeded session', () => {
  it('is created naming the treatment the script just built', () => {
    // The treatment carries the lorebook link, so naming it is what puts a book
    // in play — and the id has to be captured for that to be possible at all.
    expect(seed).toMatch(/const treatment = await ensure\('treatments'/);

    const create = /await call\('POST', '\/api\/sessions', \{([\s\S]*?)\}\)/.exec(seed);
    expect(create, 'no POST /api/sessions call matched in seed.mjs').not.toBeNull();
    expect(create?.[1]).toContain('treatment');
  });

  it('still builds the lorebook the treatment links', () => {
    // If this stops being true the treatment links nothing and the session
    // resolves nothing again, one layer further out.
    expect(seed).toMatch(/const lorebook = await ensure\('lorebooks'/);
    expect(seed).toContain('lore: [{ ref: { id: lorebook');
  });
});

/**
 * ***The seeded actor says something*** — 2026-10-01.
 *
 * The seed wrote Mara as a SillyTavern card — `description`, `personality`,
 * `greeting` — and an actor keeps none of those: the schema preserves unknown
 * keys rather than refusing them, so the request succeeded and every section
 * she has was empty. A text assertion, for this file's reason: what it catches
 * is the card fields coming back.
 */
describe('the seeded actor', () => {
  const block = /const actor = await ensure\('actors'[\s\S]*?\n {2}\}\);/.exec(seed)?.[0] ?? '';

  it('is found, or the two below agree about nothing', () => {
    expect(block).toContain("'mara-vance'");
  });

  it('writes no SillyTavern card field an actor does not have', () => {
    expect(block).not.toMatch(/^\s+(description|personality|greeting|first_mes|scenario):/m);
  });

  it('fills the summary section and a written opening instead', () => {
    expect(block).toContain('section.id === CONVENTIONAL_SECTION_IDS.summary');
    expect(block).toContain('primaryWrittenId: greeting');
  });
});
