// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The hook panel — [10 §10.1], [06 §6.1], [P7.5].
 *
 * **Three claims a simplification would break**: that the content stays hidden
 * until the hook has gone, that a blocked hook says *by what*, and that
 * committing past a refusal names the clause it is skipping rather than doing it
 * quietly — which is [06 §6.1]'s first rule for keeping Commit honest.
 */

const readSession = vi.fn();
const writeSessionChannel = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readSession: (...a: unknown[]) => readSession(...a) as unknown,
    writeSessionChannel: (...a: unknown[]) => writeSessionChannel(...a) as unknown,
  };
});

const { HookPanel } = await import('./HookPanel.js');

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

const WAR = {
  hookId: 'hook-war',
  title: 'War with the Flower Kingdom',
  source: { kind: 'treatment' as const, id: 't1' },
  state: null as 'fired' | 'provisional' | 'committed' | null,
  refusal: null as string | null,
  entrances: [] as { id: string; label: string }[],
};

function answerWith(rows: unknown[], pacing = 'normal'): void {
  readSession.mockResolvedValue({
    session: { id: SESSION_ID, name: 'A wet week' },
    activeJob: null,
    health: [],
    hud: [],
    cast: [],
    hooks: { pacing, rows },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  writeSessionChannel.mockResolvedValue({
    session: { id: SESSION_ID },
    effect: { applied: true, rejectedReason: null },
    health: [],
  });
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HookPanel sessionId={SESSION_ID} />
    </QueryClientProvider>,
  );
}

describe('the hook panel', () => {
  it('shows nothing at all for a session with no pool', async () => {
    // The ordinary case today, and an empty heading over it would be a surface
    // claiming a feature is configured when it is not.
    answerWith([]);
    renderPanel();

    await waitFor(() => {
      expect(readSession).toHaveBeenCalled();
    });
    expect(screen.queryByLabelText('Plot hooks')).toBeNull();
  });

  it('names a hook by its title and says where it came from', async () => {
    answerWith([WAR]);
    renderPanel();

    expect(await screen.findByText('War with the Flower Kingdom')).toBeTruthy();
    expect(screen.getByText('from the treatment')).toBeTruthy();
    expect(screen.getByText('Eligible now')).toBeTruthy();
  });

  /**
   * ***The premise is hidden content until the hook has gone*** — [08 §6],
   * [10 §10.1]: *"a panel that spoils the arrival to the person about to read it
   * defeats the feature"*. The server withholds it; this is the half of the
   * claim a client can be wrong about, since a panel that rendered a field it
   * was not sent would render nothing and pass a weaker test.
   */
  it('shows the premise only once the hook has fired', async () => {
    answerWith([WAR]);
    renderPanel();
    expect(await screen.findByText('War with the Flower Kingdom')).toBeTruthy();
    expect(screen.queryByText('The Flower Kingdom will declare war.')).toBeNull();

    answerWith([
      { ...WAR, state: 'fired', refusal: 'fired', premise: 'The Flower Kingdom will declare war.' },
    ]);
    renderPanel();
    expect(await screen.findByText('The Flower Kingdom will declare war.')).toBeTruthy();
  });

  it('says which clause is holding a hook back', async () => {
    // [06 §6.1]'s *which are blocked **and by what***, in the words a person
    // can act on rather than the class the wire carries.
    answerWith([{ ...WAR, refusal: 'too-early' }]);
    renderPanel();

    expect(await screen.findByText('Waiting for a later turn')).toBeTruthy();
  });

  it('reads a refusal class it does not know as held back, not as eligible', async () => {
    // A client one deploy behind a server is the ordinary shape of this, and an
    // empty row would say *eligible* about a hook the engine is refusing.
    answerWith([{ ...WAR, refusal: 'moon-phase' }]);
    renderPanel();

    expect(
      await screen.findByText('Held back for a reason this version does not recognise'),
    ).toBeTruthy();
  });

  /**
   * **The dial is here because it is the control that explains an empty panel** —
   * [10 §10.1]: *"a session at `sparse` with six eligible hooks and nothing
   * firing is working correctly, and without the dial in view that is
   * indistinguishable from broken"*.
   */
  it('shows the dial at the level the session resolves to, and turns it', async () => {
    answerWith([WAR], 'sparse');
    renderPanel();

    const dial = await screen.findByRole<HTMLSelectElement>('combobox', {
      name: 'How often hooks fire',
    });
    expect(dial.value).toBe('sparse');

    await userEvent.selectOptions(dial, 'manual-only');
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.hook.pacing', 'manual-only');
    });
  });

  it('commits an eligible hook without asking', async () => {
    answerWith([WAR]);
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Commit' }));

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.hook#hook-war', 'committed');
    });
  });

  /**
   * ***Skipping the filter says what it skipped*** — [06 §6.1]'s first rule.
   * *"The failure this section names twice is a hook firing about someone dead
   * four sessions ago; a control that permits it silently reintroduces that
   * failure by hand. The confirmation names the clause that failed and
   * proceeds."*
   */
  it('names the clause before committing past it', async () => {
    answerWith([{ ...WAR, refusal: 'cast-gone' }]);
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Commit' }));
    // Asked, not done.
    expect(writeSessionChannel).not.toHaveBeenCalled();
    expect(screen.getByText('Someone it is about is not here. Commit it anyway?')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Commit' }));
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.hook#hook-war', 'committed');
    });
  });

  it('lets a commitment be released, and says what it was carrying it past', async () => {
    answerWith([
      { ...WAR, state: 'committed', refusal: null, committed: { overrode: 'too-early' } },
    ]);
    renderPanel();

    expect(await screen.findByText('Committed past: waiting for a later turn.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Release' }));
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.hook#hook-war', null);
    });
  });

  /**
   * **Force-fire is deliberately not here** — [10 §10.1]: it *"is a test of the
   * material and lives in the workbench beside the keyword test and the dry
   * run"*, and splitting them *"keeps a control that skips the engine's
   * judgement out of the surface people play on"*. A test for an absence,
   * because the pressure to add it will come from this panel.
   */
  it('offers no way to fire a hook outright', async () => {
    answerWith([WAR]);
    renderPanel();

    await screen.findByText('War with the Flower Kingdom');
    expect(screen.queryByRole('button', { name: /fire/i })).toBeNull();
  });

  it('offers no control at all on a hook that has gone', async () => {
    answerWith([{ ...WAR, state: 'fired', refusal: 'fired' }]);
    renderPanel();

    expect(await screen.findByText('Fired')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  /**
   * *Entrances by label, never by text*, which the server enforces and the panel
   * has to render as labels rather than as something that looks like content.
   */
  it('lists arrivals by label', async () => {
    answerWith([{ ...WAR, entrances: [{ id: 'e-rain', label: 'In the rain' }] }]);
    renderPanel();

    expect(await screen.findByText('Arrivals: In the rain')).toBeTruthy();
  });
});
