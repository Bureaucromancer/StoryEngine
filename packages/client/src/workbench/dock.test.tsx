// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account } from '../api.js';

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
 * navigates explicitly in `act()` before asserting.
 *
 * Two turns in the transcript, distinguished by their input text, because the
 * head turn's own JSON *contains* the previous turn's id (`parentTurnId`) —
 * an id-based assertion would pass against a panel showing the wrong turn.
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

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aed';

const SESSION = {
  id: SESSION_ID,
  name: 'The Ashfall Road',
  createdAt: '2026-08-18T10:00:00.000Z',
  updatedAt: '2026-08-18T10:05:00.000Z',
  headTurnId: 'turn-2',
};

const TURNS = [
  {
    id: 'turn-1',
    parentTurnId: null,
    createdAt: '2026-08-18T10:00:00.000Z',
    status: 'complete' as const,
    input: { text: 'I knock twice.', kind: 'action' },
    output: { text: 'The door opens a handspan.' },
  },
  {
    id: 'turn-2',
    parentTurnId: 'turn-1',
    createdAt: '2026-08-18T10:05:00.000Z',
    status: 'complete' as const,
    input: { text: 'I step inside.', kind: 'action' },
    output: { text: 'The hall smells of wet rope.' },
  },
];

/**
 * The prefs half is stateful, because since [P3.1a] the dock's open state and
 * size *are* preferences: `readPrefs` answers what was patched and `patchPrefs`
 * merges with `null` deleting, the server's own contract. A test seeds
 * `prefsStore` before rendering to mean "what a reload would find".
 */
let prefsStore: Record<string, unknown> = {};
const patchPrefs = vi.fn();

beforeEach(() => {
  prefsStore = {};
  patchPrefs.mockClear();
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
    },
    listSessions: () => Promise.resolve({ sessions: [SESSION] }),
    readSession: () => Promise.resolve({ session: SESSION, activeJob: null }),
    readTranscript: () => Promise.resolve({ turns: TURNS }),
  };
});

vi.mock('../play/stream.js', () => ({
  openTurnStream: () => ({ close: () => undefined }),
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
    within(dock).getByRole('button', { name: 'Close' }).focus();
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
    expect(within(dock).getByText('The head turn of this session, as stored.')).toBeTruthy();
    expect(within(dock).getByText(/I step inside\./)).toBeTruthy();
    expect(within(dock).queryByText(/I knock twice\./)).toBeNull();
  });

  it('is honestly empty over a view with no subject', async () => {
    renderApp();
    await overLibrary();
    await userEvent.keyboard(CHORD);

    const dock = screen.getByRole('complementary');
    expect(within(dock).getByText(/follows the main view/)).toBeTruthy();
    expect(dock.querySelector('pre')).toBeNull();
  });

  it('stays open across navigation while its subject follows the view', async () => {
    renderApp();
    await overPlay();
    await userEvent.keyboard(CHORD);
    expect(within(screen.getByRole('complementary')).getByText(/I step inside\./)).toBeTruthy();

    // Gate step 2's in-memory half: still open, new subject. The reload half
    // waits on P3.1a's preference keys.
    await overLibrary();
    const overTheLibrary = screen.getByRole('complementary');
    expect(within(overTheLibrary).getByText(/follows the main view/)).toBeTruthy();
    expect(overTheLibrary.querySelector('pre')).toBeNull();

    await overPlay();
    expect(within(screen.getByRole('complementary')).getByText(/I step inside\./)).toBeTruthy();
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
    expect(within(dock).getByText(/I step inside\./)).toBeTruthy();
    expect(patchPrefs).not.toHaveBeenCalled();
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
