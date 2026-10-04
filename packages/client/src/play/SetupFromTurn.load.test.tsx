// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * ***The wizard's chunk, on its way and failing to arrive*** —
 * [P15 §1.11](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md),
 * [20 §7.2](../../../../docs/design/20-client-loading.md).
 *
 * `SetupFromTurn.test.tsx` drives the dialog through `lazy()` and so proves
 * the chunk *arrives*; this file holds the two states the boundary adds, which
 * nothing reached before the dialog was split off: the sentence while the
 * chunk is on its way, and a load that fails — **an upgrade under an open tab**
 * is the case 20 §5 names, and the one that matters is that it costs the page
 * nothing beside the button. `SetupFromTurn.crash.test.tsx` holds the third,
 * a chunk that arrives and then fails as it draws.
 *
 * *Its own file* because both states need the wizard's module to be one that
 * never loads, and a `vi.mock` holds for every test in a file — while the
 * dialog's own tests need it to load. The mock waits on a gate before it
 * throws, so the test can look at the waiting state first.
 *
 * *What this file cannot prove is that the dialog is off the entry*: a mocked
 * module is a module however it is imported, which is [20 §6]'s *"a unit test
 * that renders a mocked lazy component cannot"*. That is the build's question,
 * and `tools/entry-budget.test.ts` asks it — *keeps the setup wizard off the
 * entry*.
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

vi.mock('./SetupWizard.js', async () => {
  await gate.opened;
  // What a browser says when the chunk an old tab knows by name is gone.
  throw new TypeError('Failed to fetch dynamically imported module: /assets/SetupWizard-old.js');
});

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

describe('loading the setup wizard', () => {
  it('says it is opening, and a chunk that never arrives leaves the page standing', async () => {
    // React reports an error a boundary caught; the report is expected here
    // and would otherwise read as a failure in the run's output.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <div>
        <p>The story so far, still on the page.</p>
        <Turn sessionId="s1" turnId="t9" busy={false} />
      </div>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Make a setup from here' }));

    // On its way: a sentence under the button, and nothing modal over the page.
    expect((await screen.findByRole('status')).textContent).toBe('Opening the setup wizard…');
    expect(screen.queryByRole('dialog')).toBeNull();

    gate.open();

    // Never arrived: said under the button, and the page beside it intact.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/^The setup wizard could not be loaded\./);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('The story so far, still on the page.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    const trigger = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Make a setup from here',
    });
    expect(trigger.disabled).toBe(false);
    // ***Focus goes back to the button*** (2026-10-04, in review). *Dismiss*
    // unmounts itself while it holds focus, and without somewhere to send it
    // the browser drops it on `<body>` — a keyboard user's place in a long
    // transcript, gone. The dialog's own close is the focus trap's to handle;
    // this note has none, so it is `useSetupFromTurn`'s.
    expect(document.activeElement).toBe(trigger);
  });
});
