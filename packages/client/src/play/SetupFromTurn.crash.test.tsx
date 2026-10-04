// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * ***The wizard's chunk arrives, and the dialog fails as it draws*** —
 * [21 §7.2](../../../../docs/design/21-client-loading.md), 2026-10-04.
 *
 * The boundary around the wizard catches more than its load: once the chunk is
 * in, anything thrown while rendering the dialog reaches it too. That is
 * deliberate — 21 §5's *a failed inspector should leave the page beside it
 * usable* holds for a bug as much as for a missing file — and what this file
 * holds is the advice. *Reload to fetch the new version* is right for a chunk
 * an upgrade removed and wrong for a bug, which a reload repeats, so only a
 * failed load is told it. `SetupFromTurn.load.test.tsx` holds the failed load.
 *
 * *Its own file* for that file's reason: a `vi.mock` holds for every test in a
 * file, and here the wizard's module has to load and then throw.
 */

vi.mock('./SetupWizard.js', () => ({
  SetupWizard: () => {
    throw new Error('A bug in the dialog, not a missing file.');
  },
}));

const { useSetupFromTurn } = await import('./SetupFromTurn.js');

/** The button in a row and what it opens after it, as `TurnView` places them. */
function Turn(props: { sessionId: string; turnId: string; busy: boolean }) {
  const setup = useSetupFromTurn(props);
  return (
    <>
      <div>{setup.trigger}</div>
      {setup.place}
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a setup wizard that fails once it has loaded', () => {
  it('says it stopped, does not blame an upgrade, and leaves the page standing', async () => {
    // React reports an error a boundary caught; expected here, as in the load test.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <div>
        <p>The story so far, still on the page.</p>
        <Turn sessionId="s1" turnId="t9" busy={false} />
      </div>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Make a setup from here' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/^The setup wizard stopped with an error\./);
    // The advice that belongs to a missing chunk, and not to this.
    expect(alert.textContent).not.toMatch(/could not be loaded|reload/i);
    expect(screen.getByText('The story so far, still on the page.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Make a setup from here' }),
    );
  });
});
