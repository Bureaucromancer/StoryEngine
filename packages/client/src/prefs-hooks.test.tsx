// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one optimistic mutation in this codebase — [P2A §3](../../../docs/design/workplan/13-p2a-configuration-surface.md).
 *
 * Everywhere else this client waits for the server, and the editor goes further:
 * its base is *deliberately unpolled*, so a save presents the hash it read and
 * finds out whether the world moved. Optimism there would mean showing somebody
 * their own change as saved when it was about to be refused.
 *
 * A preference toggle is the inverse on all three counts — it must feel instant,
 * the value is trivially reversible, and there is no hash to be stale against.
 * That argument is only worth anything if the three behaviours it justifies are
 * actually there, which is what this file asserts: **the value moves before the
 * request resolves**, **a failure puts it back**, and **the server's answer wins
 * over the client's guess**.
 */

const patchPrefs = vi.fn();
const readPrefs = vi.fn();

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.js')>()),
  api: {
    readPrefs: (...a: unknown[]) => readPrefs(...a) as unknown,
    patchPrefs: (...a: unknown[]) => patchPrefs(...a) as unknown,
  },
}));

const { usePatchPrefs, usePrefs } = await import('./queries.js');

/** A probe that renders the cached value and exposes the mutation. */
function Probe({ onReady }: { onReady: (patch: (next: Record<string, unknown>) => void) => void }) {
  const prefs = usePrefs();
  const patch = usePatchPrefs();
  onReady((next) => {
    patch.mutate(next);
  });
  // Rendered as present-or-absent rather than through a nullish fallback:
  // `??` reports a stored null and a missing key identically, which is
  // precisely the distinction the delete-on-null claim is about — so the
  // first draft of this probe could not have failed on a client that
  // optimistically stored the null.
  const value = prefs.data?.prefs['library.density'];
  return (
    <p data-testid="density">
      {'library.density' in (prefs.data?.prefs ?? {}) ? JSON.stringify(value) : 'absent'}
    </p>
  );
}

let client: QueryClient;
let fire: (next: Record<string, unknown>) => void;

function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Probe
        onReady={(patch) => {
          fire = patch;
        }}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  readPrefs.mockResolvedValue({ prefs: { 'library.density': 'roomy' } });
});

describe('the optimistic path', () => {
  /**
   * **The value moves before the request resolves.**
   *
   * A checkbox that waits for a round trip before moving reads as broken, and
   * the person clicks it again. The test holds the request open deliberately —
   * a promise nothing resolves — because that is the only way to observe the
   * window the optimism exists to fill.
   */
  it('shows the new value while the request is still in flight', async () => {
    let settle: (value: { prefs: Record<string, unknown> }) => void = () => undefined;
    patchPrefs.mockImplementation(
      () =>
        new Promise<{ prefs: Record<string, unknown> }>((resolve) => {
          settle = resolve;
        }),
    );

    mount();
    await screen.findByText('"roomy"');

    act(() => {
      fire({ 'library.density': 'compact' });
    });

    // Still unresolved, and already showing the new value.
    await waitFor(() => {
      expect(screen.getByTestId('density').textContent).toBe('"compact"');
    });
    // The first argument only: TanStack v5 hands a mutation context second,
    // and asserting the whole call would pin a framework detail.
    expect(patchPrefs.mock.calls[0]?.[0]).toEqual({ 'library.density': 'compact' });

    act(() => {
      settle({ prefs: { 'library.density': 'compact' } });
    });
  });

  /**
   * **A failure puts it back**, which is the half that makes optimism honest.
   *
   * Without it the switch stays where the user left it while the server holds
   * the opposite value — and the next reload silently undoes their change, which
   * is worse than never having moved.
   */
  it('reverts when the request fails', async () => {
    patchPrefs.mockRejectedValue(new Error('nope'));

    mount();
    await screen.findByText('"roomy"');

    act(() => {
      fire({ 'library.density': 'compact' });
    });

    // **The mutation actually ran**, first. Asserting only that the value is
    // back at "roomy" is vacuous — that is where it started, so the test would
    // pass just as well if `fire` had done nothing at all, which is exactly how
    // the first draft of it survived deleting the rollback.
    await waitFor(() => {
      expect(patchPrefs).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByTestId('density').textContent).toBe('"roomy"');
    });
    // **And it was the rollback that did it, not a refetch.** A query resuming
    // after `cancelQueries` would fetch the old value back and look exactly
    // like a revert — while against a slower server it would leave the switch
    // sitting on a change that never happened.
    expect(readPrefs).toHaveBeenCalledTimes(1);
  });

  /**
   * **The server's answer wins over the client's guess.**
   *
   * The route responds with the whole document rather than an acknowledgement,
   * so a client that guessed wrong — a key the server dropped, a value it
   * normalised, another tab's write merged in — lands on the truth rather than
   * on its own arithmetic.
   */
  it('takes the whole document from the response, not the patch it sent', async () => {
    patchPrefs.mockResolvedValue({
      prefs: { 'library.density': 'compact', 'editor.pane': 'open' },
    });

    mount();
    await screen.findByText('"roomy"');

    act(() => {
      fire({ 'library.density': 'compact' });
    });

    await waitFor(() => {
      // The key this client never mentioned, which only the response could have
      // supplied — a merge computed locally would not have it.
      expect(client.getQueryData(['prefs'])).toEqual({
        prefs: { 'library.density': 'compact', 'editor.pane': 'open' },
      });
    });
  });

  /**
   * The optimistic merge has to match the server's, including that **`null`
   * deletes** — otherwise clearing a preference shows it vanishing, then
   * reappearing when the response lands, then vanishing again.
   */
  it('deletes on null the same way the server does', async () => {
    // Held open, because the claim is about the *optimistic* view. Letting the
    // response land first would assert the server's answer instead, and pass
    // against a client that had optimistically rendered the literal `null` —
    // the switch showing a third state for as long as the request took.
    let settle: (value: { prefs: Record<string, unknown> }) => void = () => undefined;
    patchPrefs.mockImplementation(
      () =>
        new Promise<{ prefs: Record<string, unknown> }>((resolve) => {
          settle = resolve;
        }),
    );

    mount();
    await screen.findByText('"roomy"');

    act(() => {
      fire({ 'library.density': null });
    });

    await waitFor(() => {
      expect(screen.getByTestId('density').textContent).toBe('absent');
    });

    act(() => {
      settle({ prefs: {} });
    });
  });
});
