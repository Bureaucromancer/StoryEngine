// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * ***World changes no other portable schema*** —
 * [work plan §0.2](../../../../docs/design/workplan/01-work-plan.md)'s release
 * check, as [P16 §1.6](../../../../docs/design/workplan/35-p16-world.md) makes it:
 * **a test rather than a promise**, due at that phase's exit rather than at a
 * release.
 *
 * The check exists because a World is a container, and the pressure a
 * container puts on what it contains is the failure the old release check was
 * written against: the convenience of the set reaching into an actor, a book or
 * a treatment for a field it would like them to carry. [15 §3](../../../../docs/design/15-world.md)
 * reverses that check's reasoning and keeps its letter, and this is the letter
 * — **with its one exception named in advance**: `LoreScope`'s `world` arm, an
 * additive widening of the lorebook's scope union that
 * [P16.2](../../../../docs/design/workplan/35-p16-world.md) lands on
 * [26 B16](../../../../docs/design/26-open-questions.md)'s answer. *A check with
 * an unstated exception is a check that gets waived the first time it fires,
 * and one with a stated exception is still a check only if something reads it.*
 *
 * **What is pinned is the committed artefact**, `packages/shared/schemas/`,
 * because it is what a third party fetches and validates against
 * ([20 §4](../../../../docs/design/20-tech-stack.md)), and CI already holds it to
 * what the build emits. Each digest below is of the artefact as it stood on
 * `main` when P16 opened (`ad47e39`, alpha 6), parsed and re-serialised so that
 * whitespace is not content. **The World's own artefact is not pinned**: it is
 * the kind this phase changes, and it replaces the Package's rather than standing
 * beside it ([P16 §1.1]).
 *
 * ***When this fails***, the change it caught is a change to a portable schema
 * other than the World's, made inside the phase that promised none. That may be
 * right — but it is a decision, and it is made by recording it where
 * [work plan §0.2] keeps the check's answer and re-pinning here in the same
 * commit, never by re-pinning alone. After P16 closes, the pin's job is done and
 * it can be retired the same way: deliberately, with a line saying so.
 */

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas');

function artefact(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')) as Record<string, unknown>;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** The four artefacts World may not touch at all, as they stood at `ad47e39`. */
const PINNED = {
  'storyengine.actor.1.json': 'eb03e448ae58a04f0157471b3d0a96886cca4a3e1f4665a595366802b6109775',
  'storyengine.treatment.1.json':
    'b7bb1be5ad6566a62f180274c6c83dbcdd878fab60629804c94f85c1622f9270',
  'storyengine.setup.1.json': '2b88d86c8e6cb376c8e73cbaa2f6af1a6ce3e82bd4cae41cda46859c98ff448c',
  'storyengine.preset.0.json': '929cb7e9c04345932d6717f9daa20160628052f8eea8f75ac024e637dc5368e4',
} as const;

/** The lorebook artefact with `properties.scope` taken out, as it stood at `ad47e39`. */
const LOREBOOK_OUTSIDE_SCOPE = '376f2912d7611d940225f44079770b19982aefb941de6606fbf35c1acc76712f';

/** `LoreScope`'s two arms as they stood at `ad47e39`, which every later form must keep. */
const SCOPE_ARMS_BEFORE = [
  {
    type: 'object',
    required: ['kind'],
    properties: { kind: { const: 'global', type: 'string' } },
  },
  {
    type: 'object',
    required: ['kind', 'actorIds'],
    properties: {
      kind: { const: 'linked', type: 'string' },
      actorIds: { type: 'array', items: { type: 'string' } },
    },
  },
];

describe('World changes no other portable schema (P16 §1.6, work plan §0.2)', () => {
  it.each(Object.entries(PINNED))('leaves %s exactly as it was', (file, pinned) => {
    expect(digest(artefact(file))).toBe(pinned);
  });

  it('leaves the lorebook as it was outside LoreScope', () => {
    const lorebook = artefact('storyengine.lorebook.1.json');
    const rest = { ...(lorebook['properties'] as Record<string, unknown>) };
    delete rest['scope'];
    expect(digest({ ...lorebook, properties: rest })).toBe(LOREBOOK_OUTSIDE_SCOPE);
  });

  /**
   * ***Inside LoreScope, additive and only the named arm.*** The two arms `/1`
   * shipped with are kept exactly, and anything beyond them is the one
   * exception the check names in advance — `{ kind: 'world', worldIds:
   * string[] }` — or the check fails. Until [26 B16] is answered the union is
   * the two arms alone; the test admits the third so that the arm, when it
   * lands, lands against a check rather than around one.
   */
  it('widens LoreScope by the world arm or not at all, and drops nothing', () => {
    const scope = (
      artefact('storyengine.lorebook.1.json')['properties'] as Record<string, unknown>
    )['scope'] as { title?: unknown; anyOf?: unknown[] };
    expect(scope.title).toBe('LoreScope');
    const arms = scope.anyOf ?? [];
    expect(arms.slice(0, SCOPE_ARMS_BEFORE.length)).toEqual(SCOPE_ARMS_BEFORE);

    const added = arms.slice(SCOPE_ARMS_BEFORE.length);
    expect(added.length).toBeLessThanOrEqual(1);
    for (const arm of added) {
      expect(arm).toEqual({
        type: 'object',
        required: ['kind', 'worldIds'],
        properties: {
          kind: { const: 'world', type: 'string' },
          worldIds: { type: 'array', items: { type: 'string' } },
        },
      });
    }
  });

  it('pins every portable artefact but the World’s, so a seventh kind is noticed', () => {
    // Six kinds: four pinned whole, the lorebook pinned outside its scope, and
    // the World. A kind added beside them would be one this check never read,
    // so the directory is held to exactly that set.
    const emitted = readdirSync(SCHEMA_DIR)
      .filter((file) => file.endsWith('.json'))
      .sort();
    expect(emitted).toEqual(
      [...Object.keys(PINNED), 'storyengine.lorebook.1.json', 'storyengine.world.1.json'].sort(),
    );
  });
});
