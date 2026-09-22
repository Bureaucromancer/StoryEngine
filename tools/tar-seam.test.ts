// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { headerName as scriptHeaderName, tarHeader as scriptHeader } from './tar.mjs';
import {
  TarNameError,
  headerName as serverHeaderName,
  tarHeader as serverHeader,
} from '../packages/server/src/storage/tar.js';

/**
 * ***The seam between the two tar writers*** —
 * [P11.11](../docs/design/workplan/28-p11-implementation.md).
 *
 * **There are two on purpose and neither can import the other.** The image
 * ships `packages/server` alone, so nothing under `tools/` exists at runtime;
 * and `tools/backup.mjs` must run under plain node with no build, because it is
 * the tool somebody reaches for when things have already gone wrong, so it
 * cannot import built TypeScript. Two callers, no path between them, one format.
 *
 * ***`tools/tar.mjs` states the hazard this file exists to close***: *"two
 * hand-written tar writers in one repository is two places for the checksum
 * arithmetic to be subtly different, and the failure mode is an archive that
 * most readers accept."* An archive most readers accept is the worst possible
 * outcome — it is found by the one person restoring on the one day it matters.
 *
 * So the duplication is **admitted and checked** rather than argued away, which
 * is the shape `repo-shape.test.ts` already uses for a fact that lives in two
 * packages that cannot reach each other. The assertion is on bytes, not on
 * behaviour: a header is 512 bytes and there is no reading of *identical* that
 * needs interpreting.
 *
 * *The cases are chosen for where the two could drift*, which is everywhere a
 * field is computed rather than copied: the checksum, the octal widths, and the
 * name split — the last because it was added to both files at once, which is
 * exactly when two copies stop agreeing.
 */

const LONG_SLUG = 'a-lorebook-with-a-name-somebody-actually-typed-out-in-full-abcd';
const DIGEST = 'c'.repeat(64);

/** Hex, because a diff of 512 numbers names the offset that drifted. */
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const CASES: { why: string; name: string; size: number; mtime: number; mode: number }[] = [
  { why: 'a short ASCII name', name: 'accounts.json', size: 91, mtime: 0, mode: 0o644 },
  {
    why: 'a release artifact, which wants no time at all',
    name: 'storyengine/install.sh',
    size: 2048,
    mtime: 0,
    mode: 0o755,
  },
  {
    why: 'a backup, which wants the time it was taken',
    name: 'users/ned/library/actors/vera/card.png',
    size: 1_048_577,
    mtime: 1_790_000_000,
    mode: 0o644,
  },
  {
    why: 'exactly the name field, which must not spill into the prefix',
    name: `users/ned/library/lorebooks/${'x'.repeat(66)}/lorebook.json`,
    size: 0,
    mtime: 1_790_000_000,
    mode: 0o644,
  },
  {
    why: 'one byte past it, which must',
    name: `users/ned/library/lorebooks/${'x'.repeat(67)}/lorebook.json`,
    size: 1,
    mtime: 1_790_000_000,
    mode: 0o644,
  },
  {
    why: 'the version payload this project reaches in ordinary use',
    name: `users/${'n'.repeat(63)}/library/lorebooks/${LONG_SLUG}/history/v/${DIGEST}.json`,
    size: 4096,
    mtime: 1_790_000_000,
    mode: 0o644,
  },
  {
    why: 'a multi-byte name, where a character count and a byte count disagree',
    name: `users/ned/library/lorebooks/${'ゆ'.repeat(40)}/lorebook.json`,
    size: 512,
    mtime: 1_790_000_000,
    mode: 0o644,
  },
  {
    why: 'a size whose octal is wide enough to test the padding',
    name: 'state/state.sqlite',
    size: 8_589_934_591,
    mtime: 1_790_000_000,
    mode: 0o644,
  },
];

describe('the two tar writers', () => {
  for (const one of CASES) {
    it(`agree byte for byte on ${one.why}`, () => {
      const options = { mtime: one.mtime, mode: one.mode };
      const fromScript = scriptHeader(one.name, one.size, options) as Uint8Array;
      const fromServer = serverHeader(one.name, one.size, options);

      expect(fromServer).toHaveLength(512);
      expect(hex(fromServer)).toBe(hex(fromScript));
    });

    it(`read the name back the same way for ${one.why}`, () => {
      const block = serverHeader(one.name, one.size, { mtime: one.mtime, mode: one.mode });
      expect(serverHeaderName(block)).toBe(one.name);
      expect(scriptHeaderName(block) as string).toBe(one.name);
    });
  }

  /**
   * ***Both refuse, and that is as much a part of the agreement as the bytes.***
   * A name with no `/` inside the last 255 bytes cannot be expressed by the
   * format at all. One writer refusing while the other cut would be the two
   * drifting in the direction that loses data silently — which is the whole
   * reason the refusal is a refusal.
   */
  it('refuse the same unsplittable name', () => {
    const impossible = `users/ned/library/lorebooks/vera/${'x'.repeat(160)}.json`;

    expect(() => serverHeader(impossible, 0)).toThrow(TarNameError);
    expect(() => scriptHeader(impossible, 0)).toThrow(/cannot be split at a directory boundary/);
    // Word for word, so a person who meets one has met both.
    expect(() => serverHeader(impossible, 0)).toThrow(/cannot be split at a directory boundary/);
  });
});
