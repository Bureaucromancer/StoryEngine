// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationList, NotificationView } from './types.js';

/**
 * The four in-app channels, and the one rule that holds them together —
 * [09 §3.6](../../../../docs/design/09-server-multiuser-deployment.md), [P10.2].
 *
 * ***The claim worth testing is not that a toast appears.*** It is that
 * **arriving** and **being told about** are different things, and that the hook
 * knows which is which:
 *
 * - A notification that arrives **live** is announced — sound, toast, browser.
 * - A notification that arrives **on a snapshot** is not. It was already true
 *   before this tab attached, so a reconnect must be silent. ***This is the
 *   failure the whole `announced` ref exists for***: on a flaky LAN the stream
 *   reattaches every three seconds, and without it one finished turn becomes a
 *   chime every three seconds until the network settles — after which the person
 *   reasonably concludes notifications are broken.
 *   *Corrected 2026-09-28:* ~~so a reconnect must be silent~~ — silent about
 *   what it already said. A row raised while the stream was down reaches the
 *   tab only on the reattach's snapshot, and was never announced at all; the
 *   newest such row is now. And ~~the `announced` ref~~ was never read: the
 *   per-row fold count (`foldedAt`) is what stops the repeat.
 * - A **fold** of a row already announced is announced again, exactly once.
 *   *Your picture is ready* and *three pictures are ready* are different facts,
 *   and [09 §3.4]'s coalescing is pointless if the second one is silent.
 *
 * **The falsifying mutation is announcing on every frame.** Every assertion
 * about a toast appearing still passes; the snapshot case goes red.
 */

const readNotifications = vi.fn();
const markNotificationsRead = vi.fn();
const readPrefs = vi.fn();
const playChime = vi.fn();
const showBrowserNotification = vi.fn();

/** The stream, replaced by a handle a test can push frames through. */
let push: {
  snapshot: (list: NotificationList) => void;
  notification: (one: NotificationView) => void;
  fatal: (error: string) => void;
} | null = null;
const closed = vi.fn();
/** How many streams have been opened — one per account signed in, not per render. */
let opened = 0;

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  api: {
    readNotifications: (...a: unknown[]) => readNotifications(...a) as unknown,
    markNotificationsRead: (...a: unknown[]) => markNotificationsRead(...a) as unknown,
    // The preference bag, because [P10.3] gave the delivery path four switches
    // to read. An unmocked `usePrefs` rejects, and the hook then holds to
    // *nobody has told us yet*, which it treats as muted — correct behaviour,
    // and it would make every assertion below about the wrong thing.
    readPrefs: (...a: unknown[]) => readPrefs(...a) as unknown,
  },
}));

vi.mock('./chime.js', () => ({
  playChime: (one?: string) => playChime(one),
  primeAudio: () => () => undefined,
  resetChime: () => undefined,
}));

vi.mock('./browser.js', () => ({
  browserChannel: () => 'unsupported',
  askForBrowserNotifications: () => Promise.resolve('unsupported'),
  showBrowserNotification: (input: unknown) => showBrowserNotification(input),
}));

vi.mock('./stream.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stream.js')>()),
  openNotificationStream: (handlers: {
    onSnapshot: (list: NotificationList) => void;
    onNotification: (one: NotificationView) => void;
    onFatal: (error: string) => void;
  }) => {
    opened += 1;
    push = {
      snapshot: handlers.onSnapshot,
      notification: handlers.onNotification,
      fatal: handlers.onFatal,
    };
    return { close: closed };
  },
}));

const { useNotifications } = await import('./useNotifications.js');

function one(over: Partial<NotificationView> = {}): NotificationView {
  return {
    id: 'n-1',
    class: 'turn.complete',
    actionable: false,
    params: { sessionName: 'The harbour' },
    sessionId: 's-1',
    turnId: 't-1',
    folded: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
    readAt: null,
    ...over,
  };
}

function Probe(props: { account?: string }): JSX.Element {
  const state = useNotifications(props.account ?? 'ned');
  return (
    <div>
      <p data-testid="unread">{String(state.list.unread)}</p>
      <p data-testid="rows">{String(state.list.notifications.length)}</p>
      <p data-testid="toast">{state.toast === null ? 'none' : state.toast.id}</p>
      <p data-testid="muted">{String(state.muted)}</p>
      <button
        type="button"
        data-testid="mark"
        onClick={() => {
          state.markRead();
        }}
      >
        Mark all read
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  push = null;
  opened = 0;
  readNotifications.mockResolvedValue({ notifications: [], unread: 0 });
  // No stored preferences: every class is `sound` and nothing starts muted.
  readPrefs.mockResolvedValue({ prefs: {} });
  markNotificationsRead.mockResolvedValue({ read: 0, unread: 0 });
  document.title = 'StoryEngine';
});

function mount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
}

/**
 * Mounts and waits for **both** the stream and the preferences.
 *
 * ***The second wait is load-bearing and is [P10.3]'s doing.*** Until prefs
 * land the hook holds the mute *on*: *nobody has told us yet* is not the same
 * as *not muted*, and playing the first notification out loud for somebody
 * whose whole preference is that it should not is the failure that choice
 * prevents. A test that raced it would assert silence and call it a bug.
 */
async function mounted(): Promise<void> {
  mount();
  await waitFor(() => {
    expect(push).not.toBeNull();
  });
  await waitFor(() => {
    expect(screen.getByTestId('muted').textContent).toBe('false');
  });
}

describe('a notification arriving live', () => {
  it('sounds, toasts and offers it to the browser', async () => {
    await mounted();

    act(() => push?.notification(one()));

    // The class, not a generic chime — [10 §9]'s *tellable apart from another
    // room*.
    expect(playChime).toHaveBeenCalledWith('turn.complete');
    expect(showBrowserNotification).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId('toast').textContent).toBe('n-1');
    });
  });

  it('puts the unread count in the document title', async () => {
    await mounted();

    act(() => push?.notification(one()));

    // A prefix, not a replacement: losing *which page this is* to gain a count
    // would be a bad trade, and the tab strip is where somebody looks when they
    // come back to a browser they left.
    await waitFor(() => {
      expect(document.title).toBe('(1) StoryEngine');
    });
  });
});

describe('a snapshot', () => {
  /**
   * ***The reconnect case, which is the reason this hook has a memory at
   * all.*** What is on a snapshot was already true; announcing it would turn a
   * flaky network into a chime every three seconds.
   */
  it('fills the list without announcing anything', async () => {
    await mounted();

    act(() => push?.snapshot({ notifications: [one(), one({ id: 'n-2' })], unread: 2 }));

    await waitFor(() => {
      expect(document.title).toBe('(2) StoryEngine');
    });
    expect(playChime).not.toHaveBeenCalled();
    expect(screen.getByTestId('toast').textContent).toBe('none');
  });

  it('does not announce a row it has already carried', async () => {
    await mounted();

    act(() => push?.snapshot({ notifications: [one()], unread: 1 }));
    // The same row again, as a reattach would send it.
    act(() => push?.notification(one()));

    expect(playChime).not.toHaveBeenCalled();
  });
});

/**
 * ***What arrived while the stream was down*** (2026-09-28). A row raised in
 * those seconds reaches this tab only on the reattach's snapshot, which was
 * recorded as announced without announcing it — so the turn a person left the
 * room waiting to hear finished in silence, and the badge was the only sign.
 */
describe('a reattach', () => {
  const AT = 1_000_000;

  async function reattached(first: NotificationView[]): Promise<void> {
    await mounted();
    act(() => push?.snapshot({ notifications: first, unread: first.length, at: AT - 5_000 }));
  }

  it('announces a row raised while the stream was down, once', async () => {
    await reattached([one({ id: 'old', updatedAt: AT - 60_000 })]);

    const missed = one({ id: 'missed', updatedAt: AT - 2_000 });
    act(() =>
      push?.snapshot({
        notifications: [missed, one({ id: 'old', updatedAt: AT - 60_000 })],
        unread: 2,
        at: AT,
      }),
    );

    expect(playChime).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId('toast').textContent).toBe('missed');
    });
    // And the next reattach, a flaky LAN's, does not say it again.
    act(() => push?.snapshot({ notifications: [missed], unread: 1, at: AT + 3_000 }));
    expect(playChime).toHaveBeenCalledTimes(1);
  });

  it('says nothing when every row on it was already said', async () => {
    // Recent, so the news window is not what keeps it quiet.
    const said = one({ updatedAt: AT - 1_000 });
    await reattached([said]);

    act(() => push?.snapshot({ notifications: [said], unread: 1, at: AT }));

    expect(playChime).not.toHaveBeenCalled();
  });

  it('announces only the newest of several, by when each last changed', async () => {
    await reattached([]);

    act(() =>
      push?.snapshot({
        notifications: [
          one({ id: 'first', createdAt: AT - 9_000, updatedAt: AT - 9_000 }),
          // Created earlier and folded since: the newest news, listed second.
          one({ id: 'folded', createdAt: AT - 90_000, updatedAt: AT - 1_000, folded: 2 }),
        ],
        unread: 2,
        at: AT,
      }),
    );

    expect(playChime).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId('toast').textContent).toBe('folded');
    });
  });

  it('does not announce a row already read, or one older than the news window', async () => {
    await reattached([]);

    act(() =>
      push?.snapshot({
        notifications: [
          one({ id: 'read', updatedAt: AT - 1_000, readAt: AT - 500 }),
          one({ id: 'slept', updatedAt: AT - 3 * 60 * 60 * 1000 }),
        ],
        unread: 1,
        at: AT,
      }),
    );

    expect(playChime).not.toHaveBeenCalled();
  });
});

describe('a fold', () => {
  /**
   * **News the second time, and once**. [09 §3.4]'s coalescing exists so that
   * five arrivals are one notification — *one*, not *none*.
   */
  it('announces again when the count moves, and not when it repeats', async () => {
    await mounted();

    act(() => push?.notification(one({ folded: 1 })));
    act(() => push?.notification(one({ folded: 3, updatedAt: 2_000 })));
    act(() => push?.notification(one({ folded: 3, updatedAt: 2_000 })));

    expect(playChime).toHaveBeenCalledTimes(2);
    // And it is still one row, which `stream.test.ts` asserts on the reducer.
    await waitFor(() => {
      expect(document.title).toBe('(1) StoryEngine');
    });
  });
});

describe('marking read', () => {
  it('clears the badge before the server answers', async () => {
    let settle: (value: { read: number; unread: number }) => void = () => undefined;
    markNotificationsRead.mockReturnValue(
      new Promise<{ read: number; unread: number }>((resolve) => {
        settle = resolve;
      }),
    );

    await mounted();
    act(() => push?.notification(one()));
    await waitFor(() => {
      expect(document.title).toBe('(1) StoryEngine');
    });

    act(() => {
      screen.getByTestId('mark').click();
    });

    // Optimistic, for `usePatchPrefs`' reason: a badge that waits for a round
    // trip before clearing is a badge that feels broken on a LAN.
    await waitFor(() => {
      expect(document.title).toBe('StoryEngine');
    });
    act(() => {
      settle({ read: 1, unread: 0 });
    });
  });
});

/**
 * ***The stream is the signed-in account's*** (2026-09-27). It is opened with
 * the cookie of the moment, so a switch made in another tab left this tab
 * delivering the account that had gone. And a stream refused as signed out is
 * the one fatal close that is about the sign-in, which the page has to hear.
 */
describe('the account the stream belongs to', () => {
  it('closes the stream and opens the next account’s when the account changes', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <Probe account="ned" />
      </QueryClientProvider>,
    );
    expect(opened).toBe(1);

    view.rerender(
      <QueryClientProvider client={client}>
        <Probe account="sam" />
      </QueryClientProvider>,
    );

    expect(closed).toHaveBeenCalledTimes(1);
    expect(opened).toBe(2);
  });

  it('raises the sign-in-ended flag when the stream is refused as signed out', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );

    act(() => {
      push?.fatal('not-found');
    });
    expect(client.getQueryData(['session-ended'])).toBeUndefined();
    act(() => {
      push?.fatal('unauthenticated');
    });
    expect(client.getQueryData(['session-ended'])).toBe(true);
  });
});
