// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * ***Home's release, on its way and failing to arrive*** —
 * [21 §7.3](../../../../docs/design/21-client-loading.md).
 *
 * `HomePage.test.tsx` renders the page through the real chunk and so proves
 * the release *arrives*; this file holds what the split added, which nothing
 * reached before: the sentence while the chunk is on its way, and a load that
 * fails — **an upgrade under an open tab**, 21 §5's case — which has to cost
 * the page its release and nothing else.
 *
 * *Its own file* for the setup wizard's reason (`SetupFromTurn.load.test.tsx`):
 * a `vi.mock` holds for every test in a file, and the page's other tests need
 * the readers to load. The mock waits on a gate before it throws, so the
 * waiting state can be looked at first.
 */

const gate = vi.hoisted(() => {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    opened,
    open: () => {
      open();
    },
  };
});

vi.mock('./readers.js', async () => {
  await gate.opened;
  // What a browser says when the chunk an old tab knows by name is gone.
  throw new TypeError('Failed to fetch dynamically imported module: /assets/readers-old.js');
});

const { HomePage } = await import('./HomePage.js');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loading the release home shows', () => {
  it('says it is loading, and a chunk that never arrives leaves the page standing', async () => {
    // React reports an error a boundary caught; expected here.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<HomePage />);

    // On its way: the page is already a page, and says what it is waiting for.
    expect(screen.getByRole('heading', { level: 1, name: 'StoryEngine' })).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toBe('Loading this build’s changelog…');

    gate.open();

    // Never arrived: said where the release would have been, with the advice
    // that answers it, and the title and the line under it untouched.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be loaded.*reload the page/);
    expect(screen.getByRole('heading', { level: 1, name: 'StoryEngine' })).toBeTruthy();
    expect(screen.getByText(/not built yet/)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
