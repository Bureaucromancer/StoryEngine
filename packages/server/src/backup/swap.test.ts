// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { basename, dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Layout } from '../storage/layout.js';
import { KEPT_LIVE, OWN_ENTRIES } from './swap.js';

/**
 * ***The swap knows every entry the layout puts at the root*** (2026-09-27).
 *
 * `swap.ts` said this file held `OWN_ENTRIES` to every root entry `Layout`
 * names, and there was no such file. The claim matters because a root entry
 * the swap does not know about is either left behind by a restore (it belongs
 * to the install being replaced, and stays) or moved when it must not be (the
 * instance lock, whose name moved aside is free for a second server). So every
 * root path `Layout` builds is either one the swap moves or one it keeps live.
 */
describe('the restore swap', () => {
  it('has an answer for every entry the layout puts at the data root', () => {
    const layout = new Layout('/data');
    const rootEntries = Object.entries(Object.getOwnPropertyDescriptors(Layout.prototype))
      .filter(([, descriptor]) => descriptor.get !== undefined)
      .map(([name]) => (layout as unknown as Record<string, unknown>)[name])
      .filter((value): value is string => typeof value === 'string')
      .filter((path) => dirname(path) === layout.dataRoot)
      .map((path) => basename(path));

    // Enough of them that an introspection gone wrong cannot pass as none.
    expect(rootEntries.length).toBeGreaterThan(8);
    const unknown = rootEntries.filter((name) => !OWN_ENTRIES.has(name) && !KEPT_LIVE.has(name));
    expect(unknown).toEqual([]);
  });

  it('keeps the instance lock where it is', () => {
    expect(KEPT_LIVE.has('instance.lock')).toBe(true);
    expect(OWN_ENTRIES.has('instance.lock')).toBe(false);
  });
});
