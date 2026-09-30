// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The hook panel — [10 §10.1], [06 §6.1], [P7.5].
 *
 * **Four claims a simplification would break**: that the content stays hidden
 * until the hook has gone, that a blocked hook says *by what*, that committing
 * past a refusal names the clause it is skipping rather than doing it quietly —
 * which is [06 §6.1]'s first rule for keeping Commit honest — and, since
 * [P11.2], that saving a hook out of the session changes the **library** and
 * leaves the game in progress alone.
 */

const readSession = vi.fn();
const writeSessionChannel = vi.fn();
const addSessionHook = vi.fn();
const removeSessionHook = vi.fn();
const promoteSessionHook = vi.fn();
const listLibrary = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readSession: (...a: unknown[]) => readSession(...a) as unknown,
    writeSessionChannel: (...a: unknown[]) => writeSessionChannel(...a) as unknown,
    addSessionHook: (...a: unknown[]) => addSessionHook(...a) as unknown,
    removeSessionHook: (...a: unknown[]) => removeSessionHook(...a) as unknown,
    promoteSessionHook: (...a: unknown[]) => promoteSessionHook(...a) as unknown,
    api: { ...actual.api, listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown },
  };
});

const { HookPanel } = await import('./HookPanel.js');
const { ApiError } = await import('../api.js');

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

const WAR = {
  hookId: 'hook-war',
  title: 'War with the Flower Kingdom',
  source: { kind: 'treatment' as const, id: 't1' },
  state: null as 'fired' | 'provisional' | 'committed' | null,
  refusal: null as string | null,
  entrances: [] as { id: string; label: string }[],
};

/**
 * *The objects a session names*, which is where the promote control's list
 * comes from — a Setup reaches it through the session's own `setup` field and
 * through the `source` of any row it seeded, and the two are collapsed by the
 * kind-and-id dedupe. This row is the second of those; `answerWith`'s `setup`
 * option is the first.
 */
const DEBT = {
  ...WAR,
  hookId: 'hook-debt',
  title: 'The Fixer calls in the debt',
  source: { kind: 'setup' as const, id: 's1' },
};

const LIBRARY: Record<string, { id: string; name: string }[]> = {
  treatments: [{ id: 't1', name: 'Rain City, noir' }],
  setups: [{ id: 's1', name: 'The Fixer’s Debt' }],
  lorebooks: [{ id: 'book-rain', name: 'Rain City' }],
};

function answerWith(rows: unknown[], pacing = 'normal', setup?: { id: string }): void {
  readSession.mockResolvedValue({
    session: {
      id: SESSION_ID,
      name: 'A wet week',
      treatment: 't1',
      lore: ['book-rain'],
      ...(setup === undefined ? {} : { setup }),
    },
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
  addSessionHook.mockResolvedValue({ session: { id: SESSION_ID } });
  removeSessionHook.mockResolvedValue({ session: { id: SESSION_ID } });
  listLibrary.mockImplementation((kind: string) =>
    Promise.resolve({ objects: LIBRARY[kind] ?? [] }),
  );
  promoteSessionHook.mockResolvedValue({
    object: { id: 't1', name: 'Rain City, noir', kind: 'treatment' },
  });
});

/**
 * Rendered **open**, because a disclosure's contents are what every test below
 * is about and `<details>` is closed by default. Opening it in each test would
 * be six lines of the same click asserting nothing.
 */
async function renderPanel(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HookPanel sessionId={SESSION_ID} />
    </QueryClientProvider>,
  );
  const summary = await screen.findByText(/^Plot hooks/);
  summary.closest('details')?.setAttribute('open', '');
}

describe('the hook panel', () => {
  /**
   * ***Present even with no pool, and that is the one place this panel breaks
   * the "nothing when there is nothing" pattern its neighbours follow.*** The
   * add form is inside it, and [03 §4.1] calls adding a hook to a running
   * session *the primary path* — a panel that appeared only once a session
   * already had hooks would make the primary path reachable exclusively from the
   * path it is primary over.
   */
  it('is one line with an offer when there is no pool at all', async () => {
    answerWith([]);
    await renderPanel();

    expect(screen.getByText('Plot hooks — none yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    // And no dial, because there is nothing for it to pace.
    expect(screen.queryByRole('combobox', { name: 'How often hooks fire' })).toBeNull();
  });

  /**
   * **Eligible rather than total**, because the total is a fact about the
   * treatment and the eligible count is a fact about *now*: six hooks of which
   * none can fire is the session state worth noticing from a closed panel.
   */
  it('says how many are eligible without being opened', async () => {
    answerWith([WAR, { ...WAR, hookId: 'hook-late', refusal: 'too-early' }]);
    await renderPanel();

    expect(screen.getByText('Plot hooks — 1 of 2 eligible')).toBeTruthy();
  });

  it('counts commitments separately, because they are the ones going to fire', async () => {
    answerWith([{ ...WAR, state: 'committed', committed: { overrode: null } }]);
    await renderPanel();

    expect(screen.getByText('Plot hooks — 0 of 1 eligible, 1 committed')).toBeTruthy();
  });

  it('names a hook by its title and says where it came from', async () => {
    answerWith([WAR]);
    await renderPanel();

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
    await renderPanel();
    expect(await screen.findByText('War with the Flower Kingdom')).toBeTruthy();
    expect(screen.queryByText('The Flower Kingdom will declare war.')).toBeNull();

    answerWith([
      { ...WAR, state: 'fired', refusal: 'fired', premise: 'The Flower Kingdom will declare war.' },
    ]);
    await renderPanel();
    expect(await screen.findByText('The Flower Kingdom will declare war.')).toBeTruthy();
  });

  it('says which clause is holding a hook back', async () => {
    // [06 §6.1]'s *which are blocked **and by what***, in the words a person
    // can act on rather than the class the wire carries.
    answerWith([{ ...WAR, refusal: 'too-early' }]);
    await renderPanel();

    expect(await screen.findByText('Waiting for a later turn')).toBeTruthy();
  });

  it('reads a refusal class it does not know as held back, not as eligible', async () => {
    // A client one deploy behind a server is the ordinary shape of this, and an
    // empty row would say *eligible* about a hook the engine is refusing.
    answerWith([{ ...WAR, refusal: 'moon-phase' }]);
    await renderPanel();

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
    await renderPanel();

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
    await renderPanel();

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
    await renderPanel();

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
    await renderPanel();

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
    await renderPanel();

    await screen.findByText('War with the Flower Kingdom');
    expect(screen.queryByRole('button', { name: /fire/i })).toBeNull();
  });

  /**
   * **No Commit on a hook that has gone.** Committing a fired hook is
   * *un-firing* it — the states are exclusive on one channel — which is a real
   * thing a person may want and is not something to offer by accident from a row
   * that says *Fired*. Remove stays, because a spent hook cluttering the pool is
   * exactly the thing an author wants gone.
   */
  it('offers no way to commit a hook that has gone', async () => {
    answerWith([{ ...WAR, state: 'fired', refusal: 'fired' }]);
    await renderPanel();

    expect(await screen.findByText('Fired')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  /**
   * ***Adding one while the game is running*** — [03 §4.1]'s *primary path*.
   * Two fields and not an editor: the sentence the feature exists for, with the
   * rest taking the defaults a hook typed here would want.
   */
  it('adds a hook mid-session from a title and a premise', async () => {
    answerWith([WAR]);
    await renderPanel();

    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Something you want to happen' }),
      'The bridge falls',
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'What happens' }),
      'The old bridge gives way in the storm.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(addSessionHook).toHaveBeenCalledWith(SESSION_ID, {
        title: 'The bridge falls',
        premise: 'The old bridge gives way in the storm.',
        magnitude: 'local',
        involves: [],
        weight: 1,
        delivery: 'guidance',
        once: true,
      });
    });
  });

  it('will not add a hook with nothing to weave', async () => {
    // The premise *is* the hook, and one with nothing in it would sit in the
    // pool being eligible forever. Refused at the control rather than after.
    answerWith([WAR]);
    await renderPanel();

    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Something you want to happen' }),
      'A title alone',
    );

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(true);
  });

  /**
   * *Remove takes **any** hook, whichever source put it there* — [00 §3.1]'s
   * prefill-not-binding. The pool was copied at creation, so a treatment-borne
   * row is this session's copy, and refusing to remove it would make the copy a
   * binding.
   */
  it('removes a hook the treatment put there', async () => {
    answerWith([WAR]);
    await renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(removeSessionHook).toHaveBeenCalledWith(SESSION_ID, 'hook-war', {
        kind: 'treatment',
        id: 't1',
      });
    });
  });

  /**
   * ***The row pressed, and only it*** (2026-09-28). One hook can reach the
   * pool through two carriers and is drawn as two rows; by id alone, Remove on
   * either took both, and the two rows shared a React key. The row's source
   * goes with the request, as it does for `Save this to…`.
   */
  it('names the row it removes when two rows share an id', async () => {
    // React says so on the console when two siblings share a key, and says
    // nothing else: the rows render, and it is their identity across a
    // re-render that is lost.
    const warned = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answerWith([WAR, { ...WAR, source: { kind: 'lore', id: 'book-rain' } }]);
    await renderPanel();

    const removes = await screen.findAllByRole('button', { name: 'Remove' });
    expect(removes).toHaveLength(2);
    await userEvent.click(removes[1]!);

    await waitFor(() => {
      expect(removeSessionHook).toHaveBeenCalledWith(SESSION_ID, 'hook-war', {
        kind: 'lore',
        id: 'book-rain',
      });
    });
    expect(
      warned.mock.calls.some((call) => call.some((part) => String(part).includes('same key'))),
    ).toBe(false);
    warned.mockRestore();
  });

  /**
   * *Entrances by label, never by text*, which the server enforces and the panel
   * has to render as labels rather than as something that looks like content.
   */
  it('lists arrivals by label', async () => {
    answerWith([{ ...WAR, entrances: [{ id: 'e-rain', label: 'In the rain' }] }]);
    await renderPanel();

    expect(await screen.findByText('Arrivals: In the rain')).toBeTruthy();
  });

  /**
   * ***Saving a hook back out of the session*** — [03 §4.1], [06 §6.1],
   * [15 §5.1], [P11.2]. The valve the pool never had in this direction.
   */
  describe('saving a hook onto a library object', () => {
    /**
     * **The objects this session already names, and nothing else.** Two lists
     * joined: `treatment`, `setup` and `lore` off the session, plus the sources
     * the pool itself reports — neither half alone is enough, because a carrier
     * with no hooks seeds no row and the pool can name a carrier the session
     * fields do not. Offering the whole library instead would be a library
     * browser grown inside a play panel.
     */
    it('offers the objects this session names, by name', async () => {
      answerWith([WAR, DEBT]);
      await renderPanel();

      const save = await screen.findByRole('combobox', {
        name: 'Save War with the Flower Kingdom to',
      });

      // Names, not ids — resolved through the library the way the cast panel
      // resolves an actor — and in 03 §4.1's order of precedence.
      expect(
        within(save)
          .getAllByRole('option')
          .map((one) => one.textContent),
      ).toEqual(['Save this to…', 'Rain City, noir', 'The Fixer’s Debt', 'Rain City']);
    });

    /**
     * ***The first hook anybody puts on a Setup is the case the pool cannot
     * seed.*** A Setup usually exists for cast, goals and openings and carries
     * no `hooks[]` at all, so there is no row whose `source` names it — and a
     * control that learned the Setup only from such a row would offer every
     * other carrier and never the one somebody was trying to start. Both
     * [10 §10.1] and [03 §4.1] say the control offers the Setup; this is the
     * sentence holding them.
     */
    it('offers a Setup that carries no hooks of its own', async () => {
      answerWith([WAR], 'normal', { id: 's1' });
      await renderPanel();

      const save = await screen.findByRole('combobox', {
        name: 'Save War with the Flower Kingdom to',
      });

      expect(
        within(save)
          .getAllByRole('option')
          .map((one) => one.textContent),
      ).toEqual(['Save this to…', 'Rain City, noir', 'The Fixer’s Debt', 'Rain City']);
    });

    /**
     * *And the two routes to it are one option.* A session whose Setup seeded a
     * row names that Setup twice — once as a session field, once as the row's
     * source — and the kind-and-id dedupe is what keeps the menu from saying so.
     */
    it('offers a Setup once when the pool names it too', async () => {
      answerWith([WAR, DEBT], 'normal', { id: 's1' });
      await renderPanel();

      const save = await screen.findByRole('combobox', {
        name: 'Save War with the Flower Kingdom to',
      });

      expect(
        within(save)
          .getAllByRole('option')
          .map((one) => one.textContent),
      ).toEqual(['Save this to…', 'Rain City, noir', 'The Fixer’s Debt', 'Rain City']);
    });

    it('saves the row’s own hook onto the object that was picked', async () => {
      answerWith([WAR, DEBT]);
      await renderPanel();

      // The second row's control, so that a component sending the first row's
      // id — or the first object's — fails rather than passing by coincidence.
      await userEvent.selectOptions(
        await screen.findByRole('combobox', { name: 'Save The Fixer calls in the debt to' }),
        'treatment:t1',
      );

      // The fourth argument is the row's own source, which is what makes the
      // request name *this* pooled row rather than the first one holding that
      // id — see `sessions/promote.ts` for what an id alone costs.
      await waitFor(() => {
        expect(promoteSessionHook).toHaveBeenCalledWith(
          SESSION_ID,
          'hook-debt',
          { kind: 'treatment', id: 't1' },
          { kind: 'setup', id: 's1' },
        );
      });

      /**
       * **It says where the hook went, because the row will not.** Nothing
       * visible on the row changes after a successful save — by design — so
       * the confirmation naming the object is the only evidence the act
       * happened.
       */
      expect(await screen.findByText('Saved to “Rain City, noir”.')).toBeTruthy();
    });

    /**
     * ***A second press reads as a sentence about where the hook is, not as a
     * status.*** The row looks exactly as it did after the first press, so
     * pressing again is an ordinary thing to do; the answer has to be the fact
     * that makes it a non-event. [15 §5.1] is why the alternative is not *save
     * it again under a new id*.
     */
    it('names where the hook already is rather than reporting a failure', async () => {
      promoteSessionHook.mockRejectedValue(
        new ApiError(409, 'already-there', 'That object already carries this hook.'),
      );
      answerWith([WAR]);
      await renderPanel();

      await userEvent.selectOptions(
        await screen.findByRole('combobox', { name: 'Save War with the Flower Kingdom to' }),
        'treatment:t1',
      );

      expect(await screen.findByText('This hook is already on “Rain City, noir”.')).toBeTruthy();
    });

    /**
     * *Any hook, whichever source put it there* — [00 §3.1]'s
     * prefill-not-binding, the position Remove already takes on this panel. The
     * pool was **copied** at creation, so a lorebook-borne row is this
     * session's copy of that hook and saving it onto the treatment is a copy of
     * a copy, not a move.
     */
    it('saves a hook the session did not originate', async () => {
      answerWith([{ ...WAR, hookId: 'hook-lore', source: { kind: 'lore', id: 'book-rain' } }]);
      await renderPanel();

      await userEvent.selectOptions(
        await screen.findByRole('combobox', { name: 'Save War with the Flower Kingdom to' }),
        'treatment:t1',
      );

      await waitFor(() => {
        expect(promoteSessionHook).toHaveBeenCalledWith(
          SESSION_ID,
          'hook-lore',
          { kind: 'treatment', id: 't1' },
          { kind: 'lore', id: 'book-rain' },
        );
      });
    });

    /**
     * ***The asymmetry is the whole point of the act.*** Promotion changes a
     * **library object** and leaves the game in progress alone: the pool entry
     * keeps its own source, the hook goes on being eligible in the session
     * somebody wrote it in, and for a lorebook target a re-attributed hook would
     * silently acquire a `book-inactive` clause it never had ([06 §6.1]'s
     * *pulled, never pushed*). A session refetch here would be the client
     * claiming otherwise.
     *
     * *The positive half is asserted beside it*, because a mutation that
     * invalidated nothing at all would pass the negative half on its own.
     */
    it('refreshes the library and not the session', async () => {
      answerWith([WAR]);
      await renderPanel();

      const listings = (): number =>
        listLibrary.mock.calls.filter((call) => call[0] === 'treatments').length;
      const before = { sessions: readSession.mock.calls.length, treatments: listings() };

      await userEvent.selectOptions(
        await screen.findByRole('combobox', { name: 'Save War with the Flower Kingdom to' }),
        'treatment:t1',
      );

      await waitFor(() => {
        expect(listings()).toBeGreaterThan(before.treatments);
      });
      expect(readSession.mock.calls.length).toBe(before.sessions);
    });

    /**
     * **Nothing when there is nowhere.** A session with no treatment, no Setup
     * and no books has nowhere to save a hook to, and a select offering only
     * its own placeholder would be an affordance for an act that cannot be
     * performed.
     */
    it('offers nothing when the session names no object at all', async () => {
      readSession.mockResolvedValue({
        session: { id: SESSION_ID, name: 'A wet week' },
        activeJob: null,
        health: [],
        hud: [],
        cast: [],
        hooks: { pacing: 'normal', rows: [{ ...WAR, source: { kind: 'session' } }] },
      });
      await renderPanel();

      expect(await screen.findByRole('button', { name: 'Remove' })).toBeTruthy();
      expect(screen.queryByRole('combobox', { name: /^Save/ })).toBeNull();
    });
  });
});
