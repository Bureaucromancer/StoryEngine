// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { Suspense, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChangelogChunkError, ChangelogLoad, lazyChangelogReader } from './ChangelogLoad.js';

/**
 * ***What the changelog's two readers show when their chunk fails*** —
 * [21 §7.3](../../../../docs/design/21-client-loading.md).
 *
 * The boundary and the factory both readers are declared with, against the
 * two failures they tell apart: a chunk that never arrived, which a reload
 * answers, and a reader that throws once it has, which a reload would only
 * repeat. `HomePage.load.test.tsx` holds the same through the page, with the
 * sentence while the chunk is on its way.
 *
 * *What no test here can prove is that the readers are off the entry* — a
 * module is a module however it was imported, [21 §6]. That is the build's
 * question, and `tools/entry-budget.test.ts` asks it.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function Throws({ error }: { error: Error }): JSX.Element {
  throw error;
}

describe('the boundary', () => {
  it('tells a chunk that never arrived to reload, and leaves its neighbours standing', () => {
    // React reports an error a boundary caught; expected here.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <div>
        <h1>StoryEngine</h1>
        <ChangelogLoad>
          <Throws error={new ChangelogChunkError(new TypeError('Failed to fetch'))} />
        </ChangelogLoad>
      </div>,
    );

    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded.*reload the page/);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('does not tell a bug to reload, which would only repeat it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ChangelogLoad>
        <Throws error={new Error('a reader that cannot draw')} />
      </ChangelogLoad>,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(
      'The changelog stopped with an error. The rest of the page is unaffected.',
    );
    expect(alert.textContent).not.toMatch(/reload/);
  });
});

describe('the factory', () => {
  /**
   * **The wrapping is the whole job**: without it the boundary would see the
   * browser's own `TypeError` and call it a bug, and the one failure a reload
   * answers would be the one not told to.
   */
  it('turns a rejected load into the failure a reload answers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Reader = lazyChangelogReader<{ selected: string }>(() =>
      Promise.reject(
        new TypeError('Failed to fetch dynamically imported module: /assets/readers-old.js'),
      ),
    );
    render(
      <ChangelogLoad>
        <Suspense fallback={<p role="status">On its way.</p>}>
          <Reader selected="1.0.0-alpha.5" />
        </Suspense>
      </ChangelogLoad>,
    );

    expect((await screen.findByRole('alert')).textContent).toMatch(/reload the page/);
  });

  it('draws the reader it loaded, with its props', async () => {
    const Reader = lazyChangelogReader<{ selected: string }>(() =>
      Promise.resolve(({ selected }: { selected: string }) => <p>{`Showing ${selected}`}</p>),
    );
    render(
      <ChangelogLoad>
        <Suspense fallback={<p role="status">On its way.</p>}>
          <Reader selected="1.0.0-alpha.5" />
        </Suspense>
      </ChangelogLoad>,
    );

    expect((await screen.findByText(/Showing/)).textContent).toBe('Showing 1.0.0-alpha.5');
  });
});
