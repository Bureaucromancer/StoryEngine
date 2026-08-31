// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account, TurnPreview } from '../api.js';
import type { StreamHandlers } from '../play/stream.js';
import {
  OBJECT_ID,
  objectRows,
  objectVersions,
  shadowedObject,
  winningObject,
} from './library-fixtures.js';
import {
  ACTOR_ID,
  cancelledTurn,
  pendingPreview,
  restingPreview,
  richTurn,
  SESSION_ID,
} from './turn-fixtures.js';

/**
 * The panel frame over the real router —
 * [P3.1](../../../../docs/design/workplan/05-p3-implementation.md)'s exit
 * criteria, most of them the deliberate inverse of the focus-trap tests in
 * `ConflictDialog.test.tsx`: Tab *escapes* the dock, Escape closes it *only*
 * from inside, and `aria-modal` is asserted absent. These are the regressions
 * that catch the next person reaching for `useFocusTrap` on a dock.
 *
 * The real router, because the subject-follows-the-main-view rule quantifies
 * over routes — a stubbed `Outlet` could not show the subject changing under
 * a panel that stays open. The singleton-router caveat applies as everywhere:
 * the URL a test leaves is the URL the next one mounts, so every test
 * navigates explicitly in `act()` before asserting. It is also what makes
 * this file the one place the block table's library links resolve through
 * real route definitions — `views.test.tsx` mocks the router wholesale.
 *
 * The transcript is the fixture module's chain: the rich turn first, the
 * cancelled turn as head. Head-vs-first is asserted on what `TurnSubject`
 * *renders* — only the head's call was Stopped, only the first turn has the
 * `se.extract` call — because since [P3.2] the dock shows a rendering, not
 * the JSON whose `parentTurnId` used to make id-based assertions ambiguous.
 */

const ACCOUNT: Account = {
  handle: 'ned',
  displayName: 'Ned',
  role: 'user',
  enabled: true,
  locale: null,
  capabilities: { privateConnections: true, fileAccess: 'none', enableExtensions: false },
  createdAt: 0,
};

const SESSION = {
  id: SESSION_ID,
  name: 'The Ashfall Road',
  createdAt: '2026-08-18T10:00:00.000Z',
  updatedAt: '2026-08-18T10:05:00.000Z',
  headTurnId: 't-11',
};

// The fixture module's turns, in their own parent order: t-10 then t-11, so
// the cancelled turn is the head `at(-1)` finds.
const TURNS = [richTurn(), cancelledTurn()];

/**
 * The prefs half is stateful, because since [P3.1a] the dock's open state and
 * size *are* preferences: `readPrefs` answers what was patched and `patchPrefs`
 * merges with `null` deleting, the server's own contract. A test seeds
 * `prefsStore` before rendering to mean "what a reload would find".
 */
let prefsStore: Record<string, unknown> = {};
const patchPrefs = vi.fn();
/** What the preview route answers this test — staged before `renderApp`. */
let stagedPreview: TurnPreview = restingPreview();

beforeEach(() => {
  prefsStore = {};
  patchPrefs.mockClear();
  stagedPreview = restingPreview();
});

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      authState: () => Promise.resolve({ setupRequired: false, account: ACCOUNT }),
      listLibrary: () => Promise.resolve({ objects: [] }),
      readPrefs: () => Promise.resolve({ prefs: { ...prefsStore } }),
      patchPrefs: (patch: Record<string, unknown>) => {
        patchPrefs(patch);
        prefsStore = Object.fromEntries(
          Object.entries({ ...prefsStore, ...patch }).filter(([, value]) => value !== null),
        );
        return Promise.resolve({ prefs: { ...prefsStore } });
      },
      // The library subject's three reads ([P3.3]): the id-only read answers
      // the winner, the discriminated one the shadowed copy — the same split
      // the real route makes.
      readObject: (...args: unknown[]) =>
        Promise.resolve(args[2] === undefined ? winningObject() : shadowedObject()),
      indexRows: () => Promise.resolve({ rows: objectRows() }),
      history: () => Promise.resolve({ versions: objectVersions() }),
    },
    listSessions: () => Promise.resolve({ sessions: [SESSION] }),
    readSession: () => Promise.resolve({ session: SESSION, activeJob: null }),
    readTranscript: () => Promise.resolve({ turns: TURNS }),
    // The meter's question, answered with whatever the test has staged
    // ([P3.4]). Play mounts under the real router here, so this is called for
    // real the moment the surface appears — and so is the submission the
    // preview-clearing test drives, which is why that is stubbed too.
    previewTurn: () => Promise.resolve({ preview: stagedPreview }),
    submitTurn: () => Promise.resolve({ jobId: 'job-1', cursor: 'job-1.0' }),
  };
});

/**
 * The stream, captured rather than merely silenced — [P3.5].
 *
 * It was a bare stub until the panel gained a live arm; now the frames are how
 * a test says *the server is working*, so the handlers have to be reachable.
 * The same trick `PlayPage.test.tsx` has always used, for the same reason.
 */
let handlers: StreamHandlers;

vi.mock('../play/stream.js', () => ({
  openTurnStream: (_id: string, given: StreamHandlers) => {
    handlers = given;
    return { close: () => undefined };
  },
}));

const { router } = await import('../router.js');

function renderApp(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

async function overPlay(): Promise<void> {
  await act(async () => {
    await router.navigate({ to: '/play/$sessionId', params: { sessionId: SESSION_ID } });
  });
  await screen.findByRole('heading', { name: 'The Ashfall Road', level: 1 });
}

async function overLibrary(): Promise<void> {
  await act(async () => {
    await router.navigate({ to: '/library', search: {} });
  });
  await screen.findByRole('heading', { name: 'Library', level: 1 });
}

/**
 * A route with no subject at all, now that the library list has one.
 *
 * The sessions list is the same shape the library list used to be — a list of
 * links with no selection concept — so it is what *honestly empty* is about
 * after [P4 §7.12] gave `/library` the import subject.
 */
async function overSessions(): Promise<void> {
  await act(async () => {
    await router.navigate({ to: '/play' });
  });
  await screen.findByRole('heading', { level: 1 });
}

async function overObject(at?: { source: 'user'; slug: string }): Promise<void> {
  await act(async () => {
    await router.navigate({
      to: '/library/$kind/$id',
      params: { kind: 'lorebooks', id: OBJECT_ID },
      search: at ?? {},
    });
  });
  await screen.findByRole('heading', {
    name: at === undefined ? 'Rain City' : 'Rain City (hand edited)',
    level: 1,
  });
}

const CHORD = '{Control>}[Backquote]{/Control}';

describe('the panel frame', () => {
  it('opens on the chord over Play, and the chord closes it again', async () => {
    renderApp();
    await overPlay();

    await userEvent.keyboard(CHORD);
    expect(screen.getByRole('complementary')).toBeTruthy();

    await userEvent.keyboard(CHORD);
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('is not summoned by the chord while the action input has focus', async () => {
    renderApp();
    await overPlay();

    screen.getByRole('textbox', { name: 'What do you do?' }).focus();
    await userEvent.keyboard(CHORD);

    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('insets the main view rather than replacing it', async () => {
    renderApp();
    await overPlay();

    await userEvent.keyboard(CHORD);

    // Both landmarks at once — the panel is beside the page, not over it or
    // instead of it — and the transcript is still on screen.
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getByRole('complementary')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'The Ashfall Road', level: 1 })).toBeTruthy();
  });

  it('lets Tab pass straight through, because it is not a trap', async () => {
    renderApp();
    await overPlay();
    await userEvent.keyboard(CHORD);

    const dock = screen.getByRole('complementary');
    // Found, not named: since [P3.2] the subject carries the block table's
    // library links, so the last control is whichever the record put there
    // rather than the Close button the frame stage could rely on.
    const controls = dock.querySelectorAll<HTMLElement>('a, button, [tabindex="0"]');
    controls[controls.length - 1]?.focus();
    await userEvent.tab();

    // The trap's behaviour, inverted: from the dock's last control, Tab
    // leaves. `useFocusTrap` here would wrap focus back inside and redden
    // this.
    expect(dock.contains(document.activeElement)).toBe(false);
  });

  it('is not aria-modal, because everything beside it stays live', async () => {
    renderApp();
    await overPlay();
    await userEvent.keyboard(CHORD);

    const dock = screen.getByRole('complementary');
    expect(dock).toHaveProperty('ariaModal', null);
    expect(dock.getAttribute('aria-modal')).toBeNull();
  });

  it('closes on Escape only when focus is inside it', async () => {
    renderApp();
    await overPlay();

    await userEvent.keyboard(CHORD);
    within(screen.getByRole('complementary')).getByRole('button', { name: 'Close' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();

    // Reopened, with focus out in the page: Escape is not the dock's to
    // answer — a dialog may be open over the same surface.
    await userEvent.keyboard(CHORD);
    screen.getByRole('textbox', { name: 'What do you do?' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('complementary')).toBeTruthy();
  });

  it('shows the head turn, not the first one', async () => {
    renderApp();
    await overPlay();
    await userEvent.keyboard(CHORD);

    const dock = screen.getByRole('complementary');
    expect(within(dock).getByText('The head turn of this session.')).toBeTruthy();
    // The head's call was Stopped; se.extract exists only on the first turn.
    expect(within(dock).getByText('Stopped')).toBeTruthy();
    expect(within(dock).queryByText(/se\.extract/)).toBeNull();
  });

  /**
   * The one integration path from the live route to the rendered record —
   * `views.test.tsx` proves the components against literal props with the
   * router mocked, so this is where the wiring is on trial: the transcript
   * cache's head reaches `TurnSubject`, its block table renders, and a
   * source link resolves through the *real* route table to the library page
   * it names (gate step 4's clickable half, end to end).
   */
  it('reaches the head turn’s block table, with its sources linked', async () => {
    renderApp();
    await overPlay();
    await userEvent.keyboard(CHORD);

    const dock = screen.getByRole('complementary');
    const table = within(dock).getByRole('table');
    expect(within(table).getByText('se.instruction')).toBeTruthy();
    const actor = within(table).getAllByRole('link', { name: 'Actor' })[0];
    expect(actor?.getAttribute('href')).toBe(`/library/actors/${ACTOR_ID}`);
  });

  /**
   * The panel's one way out — [P3.6]. Asserted here rather than in
   * `views.test.tsx` because the claim is about the *address*: the link is
   * built from the head and its parent and resolved through the real route
   * table, which is the whole of why comparison is a view and not a second
   * subject in this panel ([P3 §7.2]).
   */
  it('offers the head turn a comparison with the one before it, as an address', async () => {
    renderApp();
    await overPlay();
    await userEvent.keyboard(CHORD);

    const dock = screen.getByRole('complementary');
    const compare = within(dock).getByRole('link', { name: 'Compare with the turn before it' });
    // The head is the cancelled turn, whose parent is the rich one.
    expect(compare.getAttribute('href')).toBe(`/compare/${SESSION_ID}?before=t-10&after=t-11`);
  });

  it('is honestly empty over a view with no subject', async () => {
    // ~~The library list.~~ **The sessions list**, since [P4 §7.12] gave
    // `/library` the import subject and discharged [P3 §7.3] for that one route.
    // The interim answer itself is unchanged and still wanted: a route with
    // nothing to be about says so rather than keeping its last subject, which is
    // what would quietly make the reader stateful.
    renderApp();
    await overSessions();
    await userEvent.keyboard(CHORD);

    const dock = screen.getByRole('complementary');
    expect(within(dock).getByText(/follows the main view/)).toBeTruthy();
    expect(within(dock).queryByRole('table')).toBeNull();
  });

  it('shows import over the library list', async () => {
    renderApp();
    await overLibrary();
    await userEvent.keyboard(CHORD);

    const dock = screen.getByRole('complementary');
    expect(within(dock).getByRole('heading', { name: 'Import', level: 4 })).toBeTruthy();
    expect(within(dock).getByPlaceholderText(/full path/i)).toBeTruthy();
    // And the empty state is gone from it, rather than both being rendered.
    expect(within(dock).queryByText(/follows the main view/)).toBeNull();
  });

  it('stays open across navigation while its subject follows the view', async () => {
    renderApp();
    await overPlay();
    await userEvent.keyboard(CHORD);
    expect(within(screen.getByRole('complementary')).getByText('Stopped')).toBeTruthy();

    // Gate step 2's in-memory half: still open, new subject. The reload half
    // waits on P3.1a's preference keys.
    await overLibrary();
    const overTheLibrary = screen.getByRole('complementary');
    expect(within(overTheLibrary).getByRole('heading', { name: 'Import', level: 4 })).toBeTruthy();

    await overPlay();
    expect(within(screen.getByRole('complementary')).getByText('Stopped')).toBeTruthy();
  });

  /**
   * Gate step 2's reload half — [P3.1a]. A fresh mount with the preference
   * already stored *is* a reload as far as the client can tell: the dock is
   * open before anyone presses a key, already on the right subject, and
   * nothing writes — opening from a stored preference is a read, and a mount
   * that patched would overwrite what it was supposed to be honouring.
   */
  it('a reload finds it as it was left', async () => {
    prefsStore = { 'ui.workbench-open': true };
    renderApp();
    await overPlay();

    const dock = await screen.findByRole('complementary');
    expect(within(dock).getByText('Stopped')).toBeTruthy();
    expect(patchPrefs).not.toHaveBeenCalled();
  });
});

/**
 * The library subject through the live route — [P3.3]'s ends-at, end to end:
 * `subject.test.tsx` proves the views against literal props with the router
 * mocked, so this is where the wiring is on trial — the route match reaches
 * `LibrarySubject`, the discriminated read answers the shadowed copy, and
 * the panel names the winning path over it.
 */
describe('the library subject', () => {
  it('names the winning path over a shadowed copy', async () => {
    prefsStore = { 'ui.workbench-open': true };
    renderApp();
    await overObject({ source: 'user', slug: 'zz-copy-of-rain-city' });

    const dock = await screen.findByRole('complementary');
    expect(
      await within(dock).findByText(
        'The copy that loads lives at users/ned/library/lorebooks/rain-city/lorebook.json.',
      ),
    ).toBeTruthy();
    // Read-only, end to end: the revision list is there and powerless.
    const history = within(dock).getByRole('region', { name: 'History' });
    expect(within(history).getByText('Revision 2')).toBeTruthy();
    expect(within(history).queryByRole('button')).toBeNull();
  });

  it('does not cry shadow over the winner', async () => {
    prefsStore = { 'ui.workbench-open': true };
    renderApp();
    await overObject();

    const dock = await screen.findByRole('complementary');
    const table = await within(dock).findByRole('region', { name: 'Index rows' });
    expect(within(table).getByText('Winner — shown')).toBeTruthy();
    expect(within(dock).queryByText(/The copy that loads lives at/)).toBeNull();
  });
});

/**
 * The splitter — [P3.1a]'s exit criterion is the first test: one drag is one
 * write, at the width the pointer let go, because the prefs store serialises
 * writes through a `KeyedQueue` and a PATCH per pointermove would queue
 * behind itself for the whole gesture ([P3 §1.2]).
 *
 * The drag's arithmetic starts from the *committed* width rather than a
 * measured rect, which is also what makes it assertable here: jsdom computes
 * no layout and every rect is zero, so a measuring implementation would pass
 * no test and fail no mutation. Coordinates are dispatched straight at the
 * handle — pointer capture, which routes mid-drag moves to the handle in a
 * browser, is a feature jsdom lacks and the component feature-checks.
 */
describe('the splitter', () => {
  async function openOverPlay(): Promise<HTMLElement> {
    prefsStore = { 'ui.workbench-open': true };
    renderApp();
    await overPlay();
    await screen.findByRole('complementary');
    return screen.getByRole('separator', { name: 'Workbench width' });
  }

  it('writes once per drag, at the width the pointer let go', async () => {
    const handle = await openOverPlay();

    // A `setup()` instance, unlike everywhere else in this file: the default
    // API forgets which buttons are down between calls, and the drag has to
    // pause mid-gesture for the not-yet-written assertion.
    const user = userEvent.setup();
    await user.pointer([
      { keys: '[MouseLeft>]', target: handle, coords: { x: 800, y: 300 } },
      { target: handle, coords: { x: 760, y: 300 } },
      { target: handle, coords: { x: 720, y: 300 } },
      { target: handle, coords: { x: 700, y: 300 } },
    ]);
    // Three moves in, nothing has been written — the whole point.
    expect(patchPrefs).not.toHaveBeenCalled();

    await user.pointer([{ keys: '[/MouseLeft]', target: handle, coords: { x: 700, y: 300 } }]);
    expect(patchPrefs).toHaveBeenCalledTimes(1);
    // 384 committed + (800 − 700) dragged toward main = 484.
    expect(patchPrefs).toHaveBeenCalledWith({ 'ui.workbench-size': 484 });

    const dock = screen.getByRole('complementary');
    expect(dock.style.getPropertyValue('--workbench-size')).toBe('484px');
  });

  it('reads its stored width back, clamped', async () => {
    prefsStore = { 'ui.workbench-open': true, 'ui.workbench-size': 512 };
    renderApp();
    await overPlay();
    const dock = await screen.findByRole('complementary');
    expect(dock.style.getPropertyValue('--workbench-size')).toBe('512px');
  });

  it('will not let a hand-edited width swallow the shell', async () => {
    prefsStore = { 'ui.workbench-open': true, 'ui.workbench-size': 10_000 };
    renderApp();
    await overPlay();
    const dock = await screen.findByRole('complementary');
    expect(dock.style.getPropertyValue('--workbench-size')).toBe('640px');
  });

  it('resizes from the keyboard, one write per gesture', async () => {
    const handle = await openOverPlay();

    handle.focus();
    // Grow is the arrow pointing into main — ArrowLeft, this side of RTL.
    await userEvent.keyboard('{ArrowLeft}');
    expect(patchPrefs).toHaveBeenCalledTimes(1);
    expect(patchPrefs).toHaveBeenCalledWith({ 'ui.workbench-size': 400 });
  });

  it('abandons a live adjustment on Escape without closing the dock', async () => {
    const handle = await openOverPlay();

    handle.focus();
    // Key down, adjust, Escape while still held: the change is abandoned and
    // the Escape is spent on it — the dock stays. The eventual keyup finds
    // nothing live to commit.
    await userEvent.keyboard('{ArrowLeft>}{Escape}{/ArrowLeft}');

    expect(patchPrefs).not.toHaveBeenCalled();
    const dock = screen.getByRole('complementary');
    expect(dock.style.getPropertyValue('--workbench-size')).toBe('384px');
  });
});

/**
 * The meter and the panel, through the live route — [P3.4]'s ends-at at the
 * level `views.test.tsx` cannot reach. What is on trial here is the wiring:
 * that one server answer feeds both surfaces, and that the panel's subject
 * over Play widened to *the turn about to be taken* without the panel gaining
 * any state of its own.
 */
describe('the context meter and the panel', () => {
  it('shows the composed turn while something is composed', async () => {
    stagedPreview = pendingPreview();
    prefsStore = { 'ui.workbench-open': true };
    renderApp();
    await overPlay();

    const dock = await screen.findByRole('complementary');
    // The pending assembly, not the head turn's record: no Cost section, and
    // the sentence that says nothing has been sent. The falsifying mutation
    // is inverting the `pendingInput` test in `PlaySubject`.
    expect(
      await within(dock).findByText(
        'What would be sent if this turn were taken now — nothing has been sent.',
      ),
    ).toBeTruthy();
    expect(within(dock).queryByRole('region', { name: 'Cost' })).toBeNull();
  });

  it('falls back to the head turn when nothing is composed', async () => {
    stagedPreview = restingPreview();
    prefsStore = { 'ui.workbench-open': true };
    renderApp();
    await overPlay();

    const dock = await screen.findByRole('complementary');
    expect(within(dock).getByText('The head turn of this session.')).toBeTruthy();
    expect(within(dock).queryByText(/What would be sent if this turn were taken now/)).toBeNull();
  });

  it('reads one answer, so the meter and the panel cannot disagree', async () => {
    stagedPreview = pendingPreview();
    prefsStore = { 'ui.workbench-open': true };
    renderApp();
    await overPlay();

    const dock = await screen.findByRole('complementary');
    await within(dock).findByText(/What would be sent if this turn were taken now/);

    // 86 of 5,344 — one fixture's numbers, reported by the meter's accessible
    // name and by the panel's verdict, because both read the same cache
    // entry. Asserted as the same string on both surfaces rather than as two
    // separate correct-looking numbers, which is what would survive them
    // fetching separately. The falsifying mutation is giving `usePreview` a
    // real `queryFn`.
    const meter = screen.getByRole('button', { name: /Context fill/ });
    expect(meter.getAttribute('aria-label')).toContain('86 of 5,344');
    expect(within(dock).getByText(/86 of 5,344 tokens spent/)).toBeTruthy();
  });

  it('drops the composed reading from both surfaces when the turn is submitted', async () => {
    /**
     * **The half `PlayPage.test.tsx` cannot hold**, and the reason this test
     * exists: with the dock open there are *two* observers on the preview
     * entry. `removeQueries` destroys such an entry without notifying either
     * of them, so the meter kept the composed figure and the panel kept
     * showing a turn that was already running — found in a browser, invisible
     * to a page test with one observer. `resetQueries` notifies. The
     * falsifying mutation is going back to `remove`.
     */
    stagedPreview = pendingPreview();
    prefsStore = { 'ui.workbench-open': true };
    renderApp();
    await overPlay();

    const dock = await screen.findByRole('complementary');
    await within(dock).findByText(/What would be sent if this turn were taken now/);

    await userEvent.type(screen.getByRole('textbox', { name: 'What do you do?' }), 'Go on.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Context fill has not been measured yet.' }),
      ).toBeTruthy();
    });
    expect(within(dock).queryByText(/What would be sent if this turn were taken now/)).toBeNull();
  });
});

/**
 * The turn being taken — [P3.5], through the live route.
 *
 * The panel is a sibling of the play surface, so this is the wiring on trial:
 * the frames arrive at the page, the page mirrors them into the shared cache
 * entry, and the panel reads them without being able to ask for them itself.
 */
describe('the panel over a turn being taken', () => {
  it('shows the progress while it runs, and outranks the composed preview', async () => {
    stagedPreview = pendingPreview();
    prefsStore = { 'ui.workbench-open': true };
    renderApp();
    await overPlay();

    const dock = await screen.findByRole('complementary');
    // Composing: the preview is the subject, as P3.4 left it.
    await within(dock).findByText(/What would be sent if this turn were taken now/);

    // The server starts reporting.
    await act(async () => {
      handlers.onFrame({
        event: 'progress',
        id: 'job-9.1',
        data: { jobId: 'job-9', seq: 1, key: 'turn.started', params: { turnId: 't-9' }, at: 0 },
      });
      handlers.onFrame({
        event: 'progress',
        id: 'job-9.2',
        data: {
          jobId: 'job-9',
          seq: 2,
          key: 'step.started',
          params: { stepId: 'se.narrate', stage: 'generate' },
          at: 0,
        },
      });
      await Promise.resolve();
    });

    // A turn being taken outranks a turn being composed: there is nothing to
    // compose while the input is disabled, and the head is about to move.
    expect(
      await within(dock).findByText(
        'This turn is being taken. What follows is what the server has reported so far.',
      ),
    ).toBeTruthy();
    expect(within(dock).getByText('se.narrate')).toBeTruthy();
    expect(within(dock).getByText('Running')).toBeTruthy();
    expect(within(dock).queryByText(/What would be sent if this turn were taken now/)).toBeNull();
  });

  it('hands back to the record when the turn finishes', async () => {
    stagedPreview = restingPreview();
    prefsStore = { 'ui.workbench-open': true };
    renderApp();
    await overPlay();

    const dock = await screen.findByRole('complementary');

    await act(async () => {
      handlers.onFrame({
        event: 'progress',
        id: 'job-9.1',
        data: { jobId: 'job-9', seq: 1, key: 'turn.started', params: { turnId: 't-9' }, at: 0 },
      });
      await Promise.resolve();
    });
    expect(await within(dock).findByText(/This turn is being taken/)).toBeTruthy();

    await act(async () => {
      handlers.onFrame({
        event: 'progress',
        id: 'job-9.2',
        data: {
          jobId: 'job-9',
          seq: 2,
          key: 'turn.finished',
          params: { state: 'complete' },
          at: 0,
        },
      });
      await Promise.resolve();
    });

    // The live view is for a turn in flight only. Once it is not, the record
    // is the subject again — the falsifying mutation is dropping the
    // `state === 'running'` test in `PlaySubject`, which leaves a finished
    // turn's progress on screen in place of the record it produced.
    await waitFor(() => {
      expect(within(dock).getByText('The head turn of this session.')).toBeTruthy();
    });
    expect(within(dock).queryByText(/This turn is being taken/)).toBeNull();
  });

  it('is already on the turn when the dock is opened mid-flight', async () => {
    /**
     * **Opening the dock mid-turn finds the turn**, not the one before it.
     *
     * The live entry is written by the play surface, and while the dock is
     * shut nothing observes it — so this asserts the entry is still there to
     * be read when somebody opens the panel between two events, rather than
     * the panel falling through to the *previous* turn's record while a turn
     * is plainly running. It survives because a cache entry's options come
     * from its observers, so with no reader mounted the entry keeps the
     * default lifetime rather than the reader's zero.
     */
    stagedPreview = restingPreview();
    prefsStore = {};
    renderApp();
    await overPlay();
    expect(screen.queryByRole('complementary')).toBeNull();

    await act(async () => {
      handlers.onFrame({
        event: 'progress',
        id: 'job-9.1',
        data: { jobId: 'job-9', seq: 1, key: 'turn.started', params: { turnId: 't-9' }, at: 0 },
      });
      handlers.onFrame({
        event: 'progress',
        id: 'job-9.2',
        data: {
          jobId: 'job-9',
          seq: 2,
          key: 'step.started',
          params: { stepId: 'se.narrate', stage: 'generate' },
          at: 0,
        },
      });
      await Promise.resolve();
    });

    // Opened after the last event, with nothing further to come — and after
    // a pause, because a cache entry with no observers is collected on a
    // timer and the question is what a reader finds *later*, not instantly.
    await new Promise((settle) => setTimeout(settle, 60));
    await userEvent.keyboard(CHORD);
    const dock = await screen.findByRole('complementary');

    expect(await within(dock).findByText(/This turn is being taken/)).toBeTruthy();
    expect(within(dock).getByText('se.narrate')).toBeTruthy();
  });
});
