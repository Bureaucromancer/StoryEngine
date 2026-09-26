// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NO_LORE_REPORT } from '@storyengine/shared';

import type { TurnPreview, TurnRecord } from '../api.js';
import type { StreamHandlers } from './stream.js';

/**
 * The play surface, mounted.
 *
 * The transport and the reducer have their own tests and are the parts a
 * component test is bad at; what only lives here is **the join** — that the
 * page hands the reducer what arrives, hands the API what the form holds, and
 * puts the result somewhere a reader can perceive.
 *
 * Two of P2's claims are only checkable at this level, which is why they had
 * no test before this file: guidance travels in its own field and does not
 * survive the turn ([06 §5.1]), and a reconnect is a status and not an error
 * ([19 §11]). The third this file used to hold — the raw record behind a
 * disclosure — left with the disclosure itself: since [P3.2] the record is
 * the workbench's subject, and `dock.test.tsx` owns that claim.
 *
 * The API module is mocked and the query client is real. The other way round —
 * mocking `useQuery` — would take the refetch-on-finish wiring out of the test,
 * and that wiring is the reason a committed turn appears in the transcript at
 * all.
 */

const listSessions = vi.fn();
const createSession = vi.fn();
const readSession = vi.fn();
const readTranscript = vi.fn();
const submitTurn = vi.fn();
const cancelTurn = vi.fn();
const moveHead = vi.fn();
const undoTurn = vi.fn();
const createBranchRef = vi.fn();
const previewTurn = vi.fn();
const setSessionLore = vi.fn();
const impersonateAs = vi.fn();
const readRenditions = vi.fn();
const listLibrary = vi.fn();
const patchPrefs = vi.fn();
let prefsStore: Record<string, unknown> = {};

// `importOriginal` spread rather than the bare factory this file used to have:
// the page now imports its session hooks from `queries.ts`, which loads under
// this same mock and needs `api`, `adminApi` and the rest to keep their real
// bindings rather than becoming `undefined`. Only the six session functions
// are replaced.
vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    listSessions: (...a: unknown[]) => listSessions(...a) as unknown,
    createSession: (...a: unknown[]) => createSession(...a) as unknown,
    readSession: (...a: unknown[]) => readSession(...a) as unknown,
    readTranscript: (...a: unknown[]) => readTranscript(...a) as unknown,
    submitTurn: (...a: unknown[]) => submitTurn(...a) as unknown,
    cancelTurn: (...a: unknown[]) => cancelTurn(...a) as unknown,
    moveHead: (...a: unknown[]) => moveHead(...a) as unknown,
    undoTurn: (...a: unknown[]) => undoTurn(...a) as unknown,
    createBranchRef: (...a: unknown[]) => createBranchRef(...a) as unknown,
    // Since [P3.4] the page carries the context meter, which reads the auth
    // state for its locale, reads and writes the workbench preference, and
    // asks for a preview on every pause. These were the *real* functions
    // under the spread, so without them the page issues real fetches into
    // jsdom.
    previewTurn: (...a: unknown[]) => previewTurn(...a) as unknown,
    // Since [P6B.0] the page carries the lore disclosure, which reads the
    // library for its options and writes the session's selection. Real here
    // would be two fetches into jsdom on every test in the file.
    setSessionLore: (...a: unknown[]) => setSessionLore(...a) as unknown,
    // Since [P9.4] the page reads the session's pictures, which is one more
    // fetch into jsdom on every test in the file if it is left real.
    readRenditions: (...a: unknown[]) => readRenditions(...a) as unknown,
    // Since [P11.4] the composer offers a draft of the player's own next
    // message, which is a model call and must never be a real one here.
    impersonateAs: (...a: unknown[]) => impersonateAs(...a) as unknown,
    api: {
      ...actual.api,
      listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown,
      authState: () => Promise.resolve({ setupRequired: false, account: null }),
      readPrefs: () => Promise.resolve({ prefs: { ...prefsStore } }),
      patchPrefs: (patch: Record<string, unknown>) => {
        patchPrefs(patch);
        prefsStore = Object.fromEntries(
          Object.entries({ ...prefsStore, ...patch }).filter(([, value]) => value !== null),
        );
        return Promise.resolve({ prefs: { ...prefsStore } });
      },
    },
  };
});

/** The last handlers the page opened a stream with — the test's way to speak. */
let handlers: StreamHandlers;
const close = vi.fn();

vi.mock('./stream.js', () => ({
  openTurnStream: (_id: string, given: StreamHandlers) => {
    handlers = given;
    return { close };
  },
}));

/**
 * ***`Link` only, and the rest of the router left alone*** — [P11.1].
 *
 * This file mounts the page **without a router**, which is the whole shape of
 * the suite: forty-two tests that assert about a transcript, a composer and a
 * stream, none of which is about navigation. `useNavigate` tolerates that with a
 * warning; `<Link>` throws, and [P11.1] added one — the way into the reading
 * view, which [10 §12.1] wants *"openable at any time on any session"* and so
 * renders unconditionally rather than behind a state these fixtures happen not
 * to reach. (`MemoryPanel` has carried a `<Link>` since P8.4 and never tripped
 * this, because its fixtures have no memory books.)
 *
 * **A plain anchor rather than a router**, because the alternative is driving
 * the real router to `/play/$sessionId` and rewriting every assertion around it
 * — a large change to prove something no test here is about. The anchor keeps
 * the address assertable, which is the only thing a link on this page is
 * checked for.
 */
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: (props: { to?: string; children?: ReactNode; className?: string }) => (
      <a href={props.to ?? '#'} className={props.className}>
        {props.children}
      </a>
    ),
  };
});

const { PlayPage } = await import('./PlayPage.js');

const SESSION = {
  id: '01a008de-7e08-70d0-899c-f6869d6b9aeb',
  name: 'The Ashfall Road',
  createdAt: '2026-08-18T10:00:00.000Z',
  updatedAt: '2026-08-18T10:00:00.000Z',
  headTurnId: 'turn-1',
};

// Typed as the real record since [P3.0] — the mocks are untyped `vi.fn()`s,
// so the annotation is what keeps this fixture honest against the shared
// shape instead of drifting behind an index signature.
const TURN: TurnRecord = {
  id: 'turn-1',
  sessionId: SESSION.id,
  parentTurnId: null,
  createdAt: '2026-08-18T10:00:00.000Z',
  status: 'complete',
  input: { actorId: null, text: 'I knock twice.', kind: 'action', raw: 'I knock twice.' },
  output: { text: 'The door opens a handspan.' },
  effects: [],
  tape: [],
};

/** A preview whose numbers are readable in an assertion rather than realistic. */
function previewOf(spent: number): { preview: TurnPreview } {
  return {
    preview: {
      state: 'assembled',
      headTurnId: 'turn-1',
      pendingInput: spent > 100,
      stepId: 'se.narrate',
      callKind: 'narrate',
      purpose: 'prose',
      resolved: { connectionId: 'conn-1', modelId: 'fake-hi' },
      blocks: [],
      budget: {
        limit: { tokens: 6144, ceiling: 8192, source: 'user', share: 0.75 },
        reserved: 1024,
        spent,
        decisions: [],
        nextToDrop: [],
      },
      notFilled: [],
      lore: NO_LORE_REPORT,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prefsStore = {};
  readSession.mockResolvedValue({ session: SESSION, activeJob: null });
  readTranscript.mockResolvedValue({ turns: [TURN] });
  submitTurn.mockResolvedValue({ jobId: 'job-1', cursor: 'job-1.0' });
  cancelTurn.mockResolvedValue({ jobId: 'job-1' });
  moveHead.mockResolvedValue({ session: SESSION });
  undoTurn.mockResolvedValue({ session: SESSION });
  createBranchRef.mockResolvedValue({ session: SESSION });
  previewTurn.mockResolvedValue(previewOf(100));
  setSessionLore.mockResolvedValue({ session: SESSION });
  listLibrary.mockResolvedValue({ objects: [] });
  readRenditions.mockResolvedValue({ renditions: [], selection: {} });
  impersonateAs.mockResolvedValue({ text: 'I would not go in there.' });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlayPage sessionId={SESSION.id} />
    </QueryClientProvider>,
  );
}

describe('the transcript', () => {
  it('renders the turns the session already has', async () => {
    renderPage();

    expect(await screen.findByText('I knock twice.')).toBeTruthy();
    expect(screen.getByText('The door opens a handspan.')).toBeTruthy();
  });
});

describe('submitting a turn', () => {
  it('sends the text with the head it was written against', async () => {
    renderPage();
    await screen.findByText('I knock twice.');

    await userEvent.type(screen.getByRole('textbox', { name: 'What do you do?' }), 'I step in.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'I step in.', headTurnId: 'turn-1' }),
      );
    });
  });

  /**
   * **Guidance is one-shot** ([06 §5.1]): it applies to the turn it was written
   * for. A box that kept its text would silently steer every later turn, which
   * is the failure the design calls out by name — so the clearing is asserted,
   * not just the sending.
   */
  it('sends guidance in its own field and then forgets it', async () => {
    renderPage();
    await screen.findByText('I knock twice.');

    await userEvent.click(screen.getByText('Guidance for this turn', { selector: 'summary' }));
    const box = screen.getByRole('textbox', { name: /guidance/i });
    await userEvent.type(box, 'Keep it tense.');
    await userEvent.type(screen.getByRole('textbox', { name: 'What do you do?' }), 'I step in.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'I step in.', guidance: 'Keep it tense.' }),
      );
    });
    await waitFor(() => {
      expect((box as HTMLTextAreaElement).value).toBe('');
    });
  });

  it('refuses an empty action rather than sending one', async () => {
    renderPage();
    await screen.findByText('I knock twice.');

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(submitTurn).not.toHaveBeenCalled();
  });
});

describe('the stream', () => {
  it('renders arriving text where a screen reader will announce it', async () => {
    renderPage();
    await screen.findByText('I knock twice.');

    act(() => {
      handlers.onFrame({ event: 'snapshot', data: { job: { id: 'job-1', status: 'running' } } });
      handlers.onFrame({ event: 'delta', data: { text: 'The lamp ' } });
      handlers.onFrame({ event: 'delta', data: { text: 'gutters.' } });
    });

    // Both halves in one node: a live region announces what changed, and text
    // split across two elements is announced as two interruptions.
    const live = await screen.findByText('The lamp gutters.');
    expect(live.closest('[aria-live]')).toBeTruthy();
  });

  /**
   * A reconnect is **not** an error ([19 §11]). The cursor makes the resume
   * lossless, so the surface says so quietly — `role="status"`, which a screen
   * reader announces without interrupting, rather than the `alert` a real
   * failure gets.
   */
  it('says reconnecting quietly, and failure loudly', async () => {
    renderPage();
    await screen.findByText('I knock twice.');

    act(() => {
      handlers.onReconnecting();
    });
    expect(screen.getByRole('status').textContent).toContain('Reconnect');
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => {
      handlers.onFatal('internal');
    });
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  /**
   * **And says which failure** — [P6B.0].
   *
   * `onFatal` has always been handed a class and the reducer had nowhere to
   * put it, so a turn that failed because a role was unbound and one that
   * failed because the server restarted produced the same sentence. The class
   * is the first thing a bug report needs, and this checkpoint is the first
   * time anybody will be reading these.
   */
  it('names the class the stream failed with', async () => {
    renderPage();
    await screen.findByText('I knock twice.');

    act(() => {
      handlers.onFatal('unbound');
    });

    expect(screen.getByRole('alert').textContent).toContain('unbound');
  });

  /**
   * **A refused submission says so** — [P6B.0].
   *
   * Every mutation on this page could fail and none of them rendered anything:
   * a `409 busy`, a `412 stale-head` from a second tab, an expired session.
   * The only feedback was a turn that did not appear, which during a play
   * session is indistinguishable from the model being slow.
   */
  it('says why a submission was refused', async () => {
    submitTurn.mockRejectedValue(new Error('The session already has a turn in flight.'));
    renderPage();
    await screen.findByText('I knock twice.');

    await userEvent.type(screen.getByLabelText('What do you do?'), 'I wait.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('already has a turn in flight');
    });
  });

  /**
   * The closing frame is what says the record is durable in all three places,
   * so it — and not a timer — is what makes the finished turn appear. Without
   * this the transcript would be one turn stale until something else happened
   * to invalidate it.
   */
  it('refetches the transcript when the turn finishes', async () => {
    renderPage();
    await screen.findByText('I knock twice.');
    expect(readTranscript).toHaveBeenCalledTimes(1);

    act(() => {
      handlers.onFrame({
        event: 'progress',
        id: 'job-1.4',
        data: { jobId: 'job-1', seq: 4, key: 'turn.finished' },
      });
    });

    await waitFor(() => {
      expect(readTranscript).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * **And refetches it once, which the test above cannot tell you.**
   *
   * That one waits for a second call and stops, so it passed for the whole of
   * P2.6 against an invalidate that ran in the render body and re-armed itself
   * every time its own refetch landed. `waitFor` reaching 2 says nothing about
   * what happens at 3. The real cost was two requests every few milliseconds for
   * as long as a session was open — found by opening one and watching the server
   * log scroll, not by anything here.
   *
   * The window matters more than the number: with the loop, twelve milliseconds
   * against a real server produced six requests, so fifty is long enough to be
   * unambiguous and short enough not to slow the suite.
   */
  it('does not keep refetching afterwards', async () => {
    renderPage();
    await screen.findByText('I knock twice.');

    act(() => {
      handlers.onFrame({
        event: 'progress',
        id: 'job-1.4',
        data: { jobId: 'job-1', seq: 4, key: 'turn.finished' },
      });
    });
    await waitFor(() => {
      expect(readTranscript).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 50));
    });

    expect(readTranscript).toHaveBeenCalledTimes(2);
    // The session was invalidated in the same block and guarded by the
    // transcript's fetch state, so it span even harder. Asserted separately
    // because a guard that covers one query and not the other is the shape of
    // the original bug.
    expect(readSession).toHaveBeenCalledTimes(2);
  });

  it('closes the stream when the page goes away', async () => {
    const { unmount } = renderPage();
    await screen.findByText('I knock twice.');

    unmount();

    expect(close).toHaveBeenCalled();
  });
});

describe('a turn in flight', () => {
  it('offers Stop instead of Send, and cancels the job it names', async () => {
    renderPage();
    await screen.findByText('I knock twice.');

    act(() => {
      handlers.onFrame({ event: 'snapshot', data: { job: { id: 'job-7', status: 'running' } } });
    });

    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(cancelTurn).toHaveBeenCalledWith(SESSION.id, 'job-7');
  });
});

/**
 * **The turn that ends before it is announced.**
 *
 * A step that refuses immediately takes about a millisecond, so `turn.finished`
 * can arrive on the already-open stream before the submission's response is
 * handled. Found by playing a turn against a session with nothing bound to the
 * prose role, which left the surface showing *Stop* with no job to stop.
 *
 * The reducer has its own test for the guard; this one is here because the race
 * is a property of the *join* — a page that dispatched `submitted` without the
 * job id could not express the guard at all, and would pass the reducer's test
 * while reproducing the bug.
 */
describe('a turn that finishes instantly', () => {
  it('leaves the surface ready to send again', async () => {
    submitTurn.mockImplementation(() => {
      // Finished before the caller sees the response — the frames beat it.
      act(() => {
        handlers.onFrame({
          event: 'progress',
          id: 'job-9.1',
          data: { jobId: 'job-9', seq: 1, key: 'turn.finished' },
        });
      });
      return Promise.resolve({ jobId: 'job-9', cursor: 'job-9.1' });
    });

    renderPage();
    await screen.findByText('I knock twice.');
    await userEvent.type(screen.getByRole('textbox', { name: 'What do you do?' }), 'I step in.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalled();
    });
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});

/**
 * The context meter — [P3.4]'s ends-at, at the level a person meets it.
 *
 * Real timers here, and `waitFor` rather than clock control: the debounce's
 * own boundary is pinned deterministically in `useDebouncedInput.test.tsx`,
 * and `userEvent` schedules on real timers, so faking them here would hang
 * the typing rather than test it. What this file owes is the join — that
 * typing reaches the server, that the answer reaches the meter, and that the
 * meter opens the dock.
 */
describe('the context meter', () => {
  it('asks at rest, before anything is typed', async () => {
    renderPage();

    // The always-visible half: a reading exists before the first keystroke,
    // and it is the context as it stands. The falsifying mutation is gating
    // the effect on a non-empty draft.
    await waitFor(() => {
      expect(previewTurn).toHaveBeenCalledWith(SESSION.id, { text: '', guidance: '' });
    });
    expect(await screen.findByRole('button', { name: /Context fill: 100 of 5,120/ })).toBeTruthy();
  });

  it('reflects the pending input rather than the last committed turn', async () => {
    renderPage();
    await screen.findByText('I knock twice.');
    await waitFor(() => {
      expect(previewTurn).toHaveBeenCalled();
    });

    previewTurn.mockResolvedValue(previewOf(2_500));
    await userEvent.type(screen.getByRole('textbox', { name: 'What do you do?' }), 'I step in.');

    // The stage's ends-at: the number moves for text that has not been sent.
    // The falsifying mutation is dropping `settled` from the effect's deps,
    // which leaves the meter showing the at-rest reading for ever.
    await waitFor(() => {
      expect(previewTurn).toHaveBeenCalledWith(SESSION.id, {
        text: 'I step in.',
        guidance: '',
      });
    });
    expect(await screen.findByRole('button', { name: /2,500 of 5,120/ })).toBeTruthy();
  });

  it('asks once for a burst of typing, not once per keystroke', async () => {
    renderPage();
    await waitFor(() => {
      expect(previewTurn).toHaveBeenCalledTimes(1);
    });

    await userEvent.type(screen.getByRole('textbox', { name: 'What do you do?' }), 'abcdefghij');
    await waitFor(() => {
      expect(previewTurn).toHaveBeenCalledWith(SESSION.id, { text: 'abcdefghij', guidance: '' });
    });

    // Ten keystrokes, and the server was asked about the settled value — not
    // about each letter on the way to it. The mutation is removing the
    // debounce, which turns every keystroke into a transcript read.
    expect(previewTurn.mock.calls.length).toBeLessThan(5);
  });

  it('opens the dock once, and does not patch when it is already open', async () => {
    renderPage();
    const meter = await screen.findByRole('button', { name: /Context fill/ });

    await userEvent.click(meter);
    expect(patchPrefs).toHaveBeenCalledTimes(1);
    expect(patchPrefs).toHaveBeenCalledWith({ 'ui.workbench-open': true });

    // Already open: clicking again must not write. `dock.test.tsx` asserts the
    // inverse of this on mount, and a redundant patch would redden it.
    await waitFor(() => {
      expect(meter.getAttribute('aria-expanded')).toBe('true');
    });
    await userEvent.click(meter);
    expect(patchPrefs).toHaveBeenCalledTimes(1);
  });

  it('stays visible and says why when nothing is bound', async () => {
    previewTurn.mockResolvedValue({
      preview: {
        state: 'unmeasurable',
        headTurnId: null,
        pendingInput: false,
        reason: 'role-unbound',
        notFilled: [],
        lore: NO_LORE_REPORT,
      },
    });
    renderPage();

    // [P3.4]'s decision: the meter is always visible, and an install with no
    // model says so rather than vanishing or implying zero. The falsifying
    // mutation is returning null from the meter on this arm.
    expect(
      await screen.findByRole('button', {
        name: 'Context fill is unmeasurable: nothing is bound to the prose role.',
      }),
    ).toBeTruthy();
  });

  it('asks nothing while a turn is in flight', async () => {
    renderPage();
    await waitFor(() => {
      expect(previewTurn).toHaveBeenCalledTimes(1);
    });

    await userEvent.type(screen.getByRole('textbox', { name: 'What do you do?' }), 'Go on.');
    await waitFor(() => {
      expect(previewTurn).toHaveBeenCalledTimes(2);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    // The input is disabled, the head is moving, and the preview entry was
    // dropped at submit — asking now would measure a turn nobody can change.
    // The mutation is dropping the `running` guard.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    });
    expect(previewTurn).toHaveBeenCalledTimes(2);
  });

  it('lets the last answer win when two are in flight', async () => {
    /**
     * Only bites when the endpoint is slower than the debounce — which is
     * exactly the install somebody is debugging when they look at the meter:
     * a stale answer landing last would settle the meter on a keystroke the
     * person has already typed past.
     *
     * **The guard this was written for does not exist**, and this test is why
     * it does not: a sequence number in `useRefreshPreview` could not be made
     * to fail, because the mutation observer never runs a superseded
     * mutation's `onSuccess`. So the claim is pinned here at the level that
     * matters — the last answer wins — and it holds whoever provides it. If a
     * future version of the query library stops providing it, this reddens
     * and the guard comes back with a reason attached.
     */
    // Hand-rolled rather than `Promise.withResolvers`, which this tsconfig's
    // lib does not carry.
    let settleTheStaleOne = (answer: { preview: TurnPreview }): void => void answer;
    const slow = new Promise<{ preview: TurnPreview }>((resolve) => {
      settleTheStaleOne = resolve;
    });
    previewTurn.mockReturnValueOnce(slow).mockResolvedValue(previewOf(2_500));

    renderPage();
    await screen.findByText('I knock twice.');
    await userEvent.type(screen.getByRole('textbox', { name: 'What do you do?' }), 'Later.');

    // The second answer arrives first and is shown.
    await waitFor(() => {
      expect(previewTurn).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByRole('button', { name: /2,500 of 5,120/ })).toBeTruthy();

    // Then the stale first answer lands. It must not win.
    await act(async () => {
      settleTheStaleOne(previewOf(100));
      await slow;
    });
    expect(screen.getByRole('button', { name: /2,500 of 5,120/ })).toBeTruthy();
  });

  it('clears the preview when the turn is submitted, so the record can take over', async () => {
    /**
     * The claim, at this level: the composed reading does not outlive the
     * submission that consumed it.
     *
     * **This test does not distinguish `reset` from `remove`, and the note
     * matters** — with only this page mounted, removing the entry and
     * re-rendering produces the same empty reading. The browser walk found a
     * case where it does not: with the dock open there is a second observer,
     * and `removeQueries` destroyed the entry *without notifying either*, so
     * both surfaces went on rendering the value they had last been handed.
     * `dock.test.tsx` holds that half. The falsifying mutation for this one
     * is dropping the call entirely.
     */
    renderPage();
    await screen.findByText('I knock twice.');

    previewTurn.mockResolvedValue(previewOf(2_500));
    await userEvent.type(screen.getByRole('textbox', { name: 'What do you do?' }), 'I step in.');
    expect(await screen.findByRole('button', { name: /2,500 of 5,120/ })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    // The composed reading is gone the moment the turn is reserved.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Context fill has not been measured yet.' }),
      ).toBeTruthy();
    });
  });

  it('does not ask about text it has already sent', async () => {
    /**
     * The debounce lags the cleared draft: `send` empties `draft` at once, but
     * `settled` still holds what was typed for another beat. If the turn ends
     * inside that beat, the effect fires with the *submitted* text and the
     * panel is handed a "what would be sent" preview of a turn already taken.
     */
    renderPage();
    await screen.findByText('I knock twice.');
    await waitFor(() => {
      expect(previewTurn).toHaveBeenCalled();
    });

    await userEvent.type(screen.getByRole('textbox', { name: 'What do you do?' }), 'I step in.');
    await waitFor(() => {
      expect(previewTurn).toHaveBeenCalledWith(SESSION.id, { text: 'I step in.', guidance: '' });
    });
    const sentAt = previewTurn.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    // The turn finishes almost at once, as an unbound install's does.
    await act(async () => {
      handlers.onFrame({
        event: 'progress',
        id: 'job-1.1',
        data: { jobId: 'job-1', seq: 1, key: 'turn.finished', params: { state: 'failed' }, at: 0 },
      });
      await Promise.resolve();
    });

    // Every ask from the submit onwards, and the window matters: a stale one
    // fires the instant `running` flips false, so clearing the mock after the
    // finish frame would throw away the only evidence.
    await new Promise((settle) => setTimeout(settle, 700));
    const asked = previewTurn.mock.calls.slice(sentAt).map((call) => call[1]);
    expect(asked).not.toContainEqual({ text: 'I step in.', guidance: '' });
  });
});

/**
 * The two gestures — [07 §7], [19 §14.5–14.6], [P6.2].
 *
 * What only shows at this level is which request each button makes, and — the
 * one the design states as a rule rather than a preference — that **the reroll
 * affordance is absent on a turn that consumed no draws**. A button offering to
 * roll again where nothing was rolled is a button that lies, and an ordinary
 * turn against an ordinary book draws nothing, so absent is the common case.
 */
describe('the two gestures', () => {
  /** A turn that rolled, which is the only kind reroll may be offered on. */
  const ROLLED: TurnRecord = {
    ...TURN,
    id: 'turn-2',
    parentTurnId: 'turn-1',
    input: { actorId: null, text: 'I ask about the ferryman.', kind: 'action', raw: '' },
    output: { text: 'He does not look up.' },
    tape: [
      {
        key: 'lore.probability:e1#0',
        site: 'lore.probability',
        purpose: 'e1',
        index: 0,
        kind: 'chance',
        detail: 'p=0.5',
        value: true,
        replayed: false,
      },
    ],
  };

  it('redoes a turn as a sibling, replaying its draws', async () => {
    readTranscript.mockResolvedValue({ turns: [TURN, ROLLED] });
    renderPage();
    await screen.findByText('He does not look up.');

    await userEvent.click(screen.getAllByRole('button', { name: 'Redo' })[1]!);

    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          // The turn's own words, not the composer's: this is *that turn
          // again*.
          text: 'I ask about the ferryman.',
          // A sibling — same parent — and the draws come off its tape.
          parentTurnId: 'turn-1',
          rewriteOf: 'turn-2',
        }),
      );
    });
  });

  it('rerolls without a tape, which is the explicit second action', async () => {
    readTranscript.mockResolvedValue({ turns: [TURN, ROLLED] });
    renderPage();
    await screen.findByText('He does not look up.');

    await userEvent.click(screen.getByRole('button', { name: 'Reroll' }));

    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'I ask about the ferryman.', parentTurnId: 'turn-1' }),
      );
    });
    // Rewrite is the default and reroll is the departure from it, so the
    // absence of the tape is the whole difference between the two buttons.
    expect(submitTurn.mock.calls[0]?.[0]).not.toHaveProperty('rewriteOf');
  });

  it('offers no reroll on a turn that consumed no draws', async () => {
    // [19 §14.6]'s rule. `TURN` has an empty tape, which is what every turn
    // against a book with nothing probabilistic in it has.
    readTranscript.mockResolvedValue({ turns: [TURN] });
    renderPage();
    await screen.findByText('I knock twice.');

    expect(screen.getByRole('button', { name: 'Redo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reroll' })).toBeNull();
  });

  it('redoes the first turn of a session from the root, explicitly', async () => {
    // `null` and *absent* are different requests on the wire: absent means the
    // head, which is what this gesture is not. The first turn's parent is the
    // root, and it has to be said.
    readTranscript.mockResolvedValue({ turns: [TURN] });
    renderPage();
    await screen.findByText('I knock twice.');

    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));

    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(
        expect.objectContaining({ parentTurnId: null, rewriteOf: 'turn-1' }),
      );
    });
  });

  it('continues from a turn by moving the head there, sending nothing', async () => {
    readTranscript.mockResolvedValue({ turns: [TURN, ROLLED] });
    renderPage();
    await screen.findByText('I knock twice.');

    await userEvent.click(screen.getAllByRole('button', { name: 'Continue from here' })[0]!);

    await waitFor(() => {
      expect(moveHead).toHaveBeenCalledWith(SESSION.id, 'turn-1');
    });
    // Nothing was submitted: the composer writes the child, and this only says
    // where the child goes.
    expect(submitTurn).not.toHaveBeenCalled();
  });

  it('leaves the composer alone when it redoes', async () => {
    // The gesture did not use what is in the box, so clearing it would throw
    // away something somebody typed.
    readTranscript.mockResolvedValue({ turns: [TURN] });
    renderPage();
    await screen.findByText('I knock twice.');

    const box = screen.getByRole('textbox', { name: 'What do you do?' });
    await userEvent.type(box, 'I was still writing this.');
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));

    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalled();
    });
    expect((box as HTMLTextAreaElement).value).toBe('I was still writing this.');
  });

  /**
   * Either gesture may carry an instruction — [06 §5.1], [07 §7]. What these
   * pin is the pairing rule: `guidance` and `redoOf` travel together or not at
   * all, and a plain gesture's body is exactly what it was.
   */
  describe('with guidance', () => {
    const NOTE = 'Make it rain harder.';

    /** Renders two turns, opens the second one's field and types the note. */
    async function openAndType(): Promise<void> {
      readTranscript.mockResolvedValue({ turns: [TURN, ROLLED] });
      renderPage();
      await screen.findByText('He does not look up.');
      await userEvent.click(screen.getAllByRole('button', { name: 'Redo with guidance' })[1]!);
      await userEvent.type(screen.getByRole('textbox', { name: 'What should change?' }), NOTE);
    }

    it('redoes with the note, naming the attempt it is about', async () => {
      await openAndType();
      await userEvent.click(screen.getAllByRole('button', { name: 'Redo' })[1]!);

      await waitFor(() => {
        expect(submitTurn).toHaveBeenCalledWith(
          expect.objectContaining({
            text: 'I ask about the ferryman.',
            parentTurnId: 'turn-1',
            rewriteOf: 'turn-2',
            // The attempt the note refers to — sent with the note, never
            // without it.
            redoOf: 'turn-2',
            guidance: NOTE,
          }),
        );
      });
    });

    it('rerolls with the note, still without the tape', async () => {
      await openAndType();
      await userEvent.click(screen.getByRole('button', { name: 'Reroll' }));

      await waitFor(() => {
        expect(submitTurn).toHaveBeenCalledWith(
          expect.objectContaining({ parentTurnId: 'turn-1', redoOf: 'turn-2', guidance: NOTE }),
        );
      });
      expect(submitTurn.mock.calls[0]?.[0]).not.toHaveProperty('rewriteOf');
    });

    it('submits the default gesture on Enter', async () => {
      await openAndType();
      await userEvent.keyboard('{Enter}');

      await waitFor(() => {
        expect(submitTurn).toHaveBeenCalledWith(
          expect.objectContaining({ rewriteOf: 'turn-2', redoOf: 'turn-2', guidance: NOTE }),
        );
      });
    });

    it('sends neither field when the note is open but empty', async () => {
      readTranscript.mockResolvedValue({ turns: [TURN, ROLLED] });
      renderPage();
      await screen.findByText('He does not look up.');
      await userEvent.click(screen.getAllByRole('button', { name: 'Redo with guidance' })[1]!);
      await userEvent.click(screen.getAllByRole('button', { name: 'Redo' })[1]!);

      await waitFor(() => {
        expect(submitTurn).toHaveBeenCalled();
      });
      // A plain redo, exactly: sending `redoOf` on its own would show the
      // model a reply with no instruction about it.
      expect(submitTurn.mock.calls[0]?.[0]).not.toHaveProperty('guidance');
      expect(submitTurn.mock.calls[0]?.[0]).not.toHaveProperty('redoOf');
    });

    it('closes the field once a gesture has spent it', async () => {
      await openAndType();
      await userEvent.click(screen.getAllByRole('button', { name: 'Redo' })[1]!);

      await waitFor(() => {
        expect(submitTurn).toHaveBeenCalled();
      });
      // One-shot, like the composer's box: the note went with the gesture, and
      // the field does not stay open offering to send it again. It cannot be
      // reopened here to read the note back — the turn is running and the
      // toggle is disabled with everything else — which is why the next test
      // reads it back through a close and a reopen instead.
      expect(screen.queryByRole('textbox', { name: 'What should change?' })).toBeNull();
    });

    it('discards a note when the field is closed, so a hidden note cannot ride along', async () => {
      await openAndType();
      const toggle = (): Promise<void> =>
        userEvent.click(screen.getAllByRole('button', { name: 'Redo with guidance' })[1]!);

      await toggle();
      expect(screen.queryByRole('textbox', { name: 'What should change?' })).toBeNull();
      // Reopened, it is empty: closing forgot the note rather than hiding it.
      await toggle();
      expect(
        screen.getByRole<HTMLInputElement>('textbox', { name: 'What should change?' }).value,
      ).toBe('');

      // And a plain Redo after closing sends the plain body.
      await toggle();
      await userEvent.click(screen.getAllByRole('button', { name: 'Redo' })[1]!);
      await waitFor(() => {
        expect(submitTurn).toHaveBeenCalled();
      });
      expect(submitTurn.mock.calls[0]?.[0]).not.toHaveProperty('guidance');
      expect(submitTurn.mock.calls[0]?.[0]).not.toHaveProperty('redoOf');
    });

    it('offers the field only on a turn that can be redone', async () => {
      // A turn with no input is not one a person wrote, so there is nothing
      // to attempt again — the same gate Redo itself sits behind. Built
      // without the key rather than with an undefined one, which
      // `exactOptionalPropertyTypes` correctly refuses.
      const divergence: TurnRecord = { ...ROLLED };
      delete divergence.input;
      readTranscript.mockResolvedValue({ turns: [TURN, divergence] });
      renderPage();
      await screen.findByText('He does not look up.');

      expect(screen.getAllByRole('button', { name: 'Redo with guidance' })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Redo' })).toHaveLength(1);
    });

    /**
     * ***A Setup's opening is read, continued from, and never redone*** —
     * [P13.3](../../../../docs/design/workplan/30-p13-implementation.md). An
     * author wrote it and nothing generated it, so there is nothing to attempt
     * again; the route refuses a redo naming one, and this is the surface
     * agreeing rather than offering a button that fails.
     */
    it('shows an opening as narration, with continue and without redo', async () => {
      const opening: TurnRecord = {
        ...TURN,
        id: 'turn-open',
        output: { text: 'Rain on the docks.' },
        opening: { id: 'o-docks' },
      };
      delete opening.input;
      readTranscript.mockResolvedValue({
        turns: [opening, { ...ROLLED, parentTurnId: 'turn-open' }],
      });
      renderPage();
      await screen.findByText('Rain on the docks.');

      expect(screen.getAllByRole('button', { name: 'Redo' })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Redo with guidance' })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Continue from here' })).toHaveLength(2);
      // [P13.8]: a point worth starting from again is not only one somebody
      // typed, so the opening offers it too.
      expect(screen.getAllByRole('button', { name: 'Make a setup from here' })).toHaveLength(2);
    });
  });
});

/**
 * The inline sibling affordance and undo — [§1.2], [§1.4], [07 §6], [P6.3].
 *
 * History shows the selected path only, so what is being checked here is that
 * the alternatives are *reachable at all*: a count on the node that has them,
 * a way to step between them, and a way to give one a name. The full tree
 * visualiser is post-1.0 and this is deliberately not a small one.
 */
describe('siblings and undo', () => {
  const SIBLING = 'turn-1b';

  function withSiblings() {
    readTranscript.mockResolvedValue({
      turns: [TURN],
      siblings: { [TURN.id]: [TURN.id, SIBLING] },
    });
  }

  it('says how many versions there are, and which one this is', async () => {
    withSiblings();
    renderPage();

    expect(await screen.findByText('1 of 2')).toBeTruthy();
  });

  it('shows nothing on a node that has no alternatives', async () => {
    // The rule the affordance follows: it appears where there is a choice. A
    // count of one on every turn would be noise on every turn.
    readTranscript.mockResolvedValue({ turns: [TURN], siblings: {} });
    renderPage();
    await screen.findByText('I knock twice.');

    expect(screen.queryByText('1 of 1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next version' })).toBeNull();
  });

  it('steps to the next version, resuming the line it was left on', async () => {
    withSiblings();
    renderPage();
    await screen.findByText('1 of 2');

    await userEvent.click(screen.getByRole('button', { name: 'Next version' }));

    await waitFor(() => {
      // `true` is the resume flag: coming back to a line returns to where you
      // were on it rather than to its first turn ([07 §3]).
      expect(moveHead).toHaveBeenCalledWith(SESSION.id, SIBLING, true);
    });
  });

  it('cannot step past either end', async () => {
    withSiblings();
    renderPage();
    await screen.findByText('1 of 2');

    expect(screen.getByRole('button', { name: 'Previous version' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Next version' })).toHaveProperty('disabled', false);
  });

  it('names a line, which writes a name and moves no turn', async () => {
    withSiblings();
    renderPage();
    await screen.findByText('1 of 2');

    await userEvent.click(screen.getByRole('button', { name: 'Name this line' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: /name for this line/i }),
      'The way in',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createBranchRef).toHaveBeenCalledWith(SESSION.id, 'The way in', TURN.id);
    });
    // Promoting a swipe writes about fifty bytes and moves no data ([07 §6]),
    // so nothing was submitted and no head moved.
    expect(submitTurn).not.toHaveBeenCalled();
    expect(moveHead).not.toHaveBeenCalled();
  });

  it('refuses to name a line nothing was typed for', async () => {
    withSiblings();
    renderPage();
    await screen.findByText('1 of 2');

    await userEvent.click(screen.getByRole('button', { name: 'Name this line' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(createBranchRef).not.toHaveBeenCalled();
  });

  it('asks the server to undo a turn', async () => {
    // The button is offered on every turn and the *server* refuses when
    // something has written the same channels since — the refusal is the
    // feature, and hiding the button would make the rule invisible.
    renderPage();
    await screen.findByText('I knock twice.');

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => {
      expect(undoTurn).toHaveBeenCalledWith(SESSION.id, TURN.id);
    });
  });
});

/**
 * ***A draft in your own character's voice*** —
 * [06 §3.1](../../../../docs/design/06-modes-and-turn-pipeline.md), [P11.4].
 *
 * §3.1's first detail is the whole of what a component test can hold: *"the
 * output lands in the input box, editable, and is not sent until the user sends
 * it. Anything else takes authorship away rather than assisting it."* So the
 * assertions are that the words arrive **in the box** and that **nothing was
 * submitted** — the second being the one a happy-path test forgets, and the one
 * that would go quiet the day somebody wired the control to `send` for
 * convenience.
 */
describe('drafting your own next message', () => {
  it('puts the words in the box and sends nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('I knock twice.');

    await user.click(screen.getByRole('button', { name: 'Draft my next message' }));

    const box = await screen.findByDisplayValue('I would not go in there.');
    expect(box).toBeTruthy();
    expect(submitTurn).not.toHaveBeenCalled();
  });

  /**
   * ***Re-rolling is pressing it again*** — §3.1's *"re-rollable without
   * ceremony"* read literally. The second draft replaces the first, which is
   * what a second press means: somebody who wanted to keep the first would have
   * edited it.
   */
  it('replaces the draft when asked again', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('I knock twice.');

    await user.click(screen.getByRole('button', { name: 'Draft my next message' }));
    await screen.findByDisplayValue('I would not go in there.');

    impersonateAs.mockResolvedValue({ text: 'Fine. After you.' });
    await user.click(screen.getByRole('button', { name: 'Draft my next message' }));

    expect(await screen.findByDisplayValue('Fine. After you.')).toBeTruthy();
    expect(screen.queryByDisplayValue('I would not go in there.')).toBeNull();
  });
});

/**
 * ***The composer*** — [polish §11], and the element itself.
 *
 * The box was an `<input>` from P2 until this pass, which made a turn of a
 * story a single line that scrolled sideways. Changing the element is only safe
 * if the habit survives it, so the first of these is the one that matters:
 * **Enter has sent a turn since P2**, and a textarea's own default is to insert
 * a newline. Nothing else here asserts what the box looks like — that is
 * layout, and jsdom computes none.
 *
 * The other three are the feedback §11 asks for, and the guard that came with
 * it. `running` is set in the send's `onSuccess`, so for the whole duration of
 * the POST there was nothing at all between a person pressing Send and the
 * first token: the button did not change, no live region fired, and the box had
 * already cleared.
 */
describe('the composer', () => {
  /** A send that has gone out and not come back, so `isPending` is observable. */
  function heldSend(): (accepted: { jobId: string; cursor: string }) => void {
    let settle: (accepted: { jobId: string; cursor: string }) => void = () => undefined;
    submitTurn.mockReturnValue(
      new Promise<{ jobId: string; cursor: string }>((resolve) => {
        settle = resolve;
      }),
    );
    return (accepted) => {
      settle(accepted);
    };
  }

  async function typeInto(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    renderPage();
    await screen.findByText('I knock twice.');
    const box = screen.getByRole('textbox', { name: 'What do you do?' });
    await user.click(box);
    return box;
  }

  it('sends on Enter, and writes a newline on Shift+Enter', async () => {
    const user = userEvent.setup();
    const box = await typeInto(user);

    await user.keyboard('The first line.{Shift>}{Enter}{/Shift}The second.');
    expect(submitTurn).not.toHaveBeenCalled();
    expect((box as HTMLTextAreaElement).value).toBe('The first line.\nThe second.');

    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'The first line.\nThe second.' }),
      );
    });
  });

  /**
   * The half of §11 the register does not describe. `running` arrives in
   * `onSuccess`, so until this guard the composer stayed live through the whole
   * request and a second press started a **second turn** — a duplicate the
   * idempotency key cannot catch, because the client mints a fresh one per
   * submission on purpose ([P2 §2.10]).
   */
  it('does not start a second turn while the first is still going out', async () => {
    heldSend();
    const user = userEvent.setup();
    await typeInto(user);

    await user.keyboard('I step in.{Enter}{Enter}{Enter}');

    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalledTimes(1);
    });
    expect(submitTurn).toHaveBeenCalledTimes(1);
  });

  it('says it is sending, and goes on saying so until the first words arrive', async () => {
    const release = heldSend();
    const user = userEvent.setup();
    await typeInto(user);

    await user.keyboard('I step in.{Enter}');

    // The two facts, in the two places they belong: the control says that *it*
    // is busy, and the live region says that the story has not started. Only
    // the second is announced, which is why it is the one carrying the wait.
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeTruthy();
    expect(await screen.findByText('Waiting for the first words…')).toBeTruthy();

    await act(async () => {
      release({ jobId: 'job-1', cursor: 'job-1.0' });
      await Promise.resolve();
    });

    // The POST being answered is not the model being answered. The seam between
    // the two waits is not something anybody is waiting *for*, so the message
    // does not change across it.
    expect(screen.getByText('Waiting for the first words…')).toBeTruthy();
  });

  /**
   * ***The half of the focus restoration that jsdom can hold.***
   *
   * The defect is the disable: the composer is `disabled` for the whole of a
   * running turn, a browser moves focus to `<body>` when the element holding it
   * is disabled, and nothing brought it back — so every turn ended with the
   * keyboard outside the box it had been in.
   *
   * **That cannot be asserted here.** jsdom leaves focus on the disabled
   * element and treats neither it nor `<body>` as a focus target, so `blur()`
   * and `body.focus()` are both no-ops; and the Stop control is not a way round
   * it either, because React reconciles Stop and Send to the same `<button>`
   * node, so focus is never dropped through that path in any environment. The
   * restoration is asserted in a real browser instead — `e2e/journeys.spec.ts`
   * journey 5 sends with Enter, from the composer, and expects the composer
   * focused once the prose lands.
   *
   * **What is asserted here is the guard**, which is the half that can do harm.
   * Restoring focus is a courtesy; *taking it back from somewhere a person put
   * it* is a bug, and it is the one this effect could plausibly introduce. So
   * the test walks away from the composer deliberately and checks that the turn
   * ending leaves that alone.
   */
  it('leaves focus alone when the turn ends somewhere the person put it', async () => {
    const user = userEvent.setup();
    await typeInto(user);

    await user.keyboard('I step in.{Enter}');
    await waitFor(() => {
      expect(submitTurn).toHaveBeenCalled();
    });

    const elsewhere = screen.getByText('Guidance for this turn', { selector: 'summary' });
    act(() => {
      elsewhere.focus();
    });
    expect(document.activeElement).toBe(elsewhere);

    act(() => {
      handlers.onFrame({ event: 'snapshot', data: { job: { id: 'job-1', status: 'committed' } } });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    });
    expect(document.activeElement).toBe(elsewhere);
  });

  /**
   * Stop was the one control on this page outside `useMutation`, so a refused
   * cancel produced nothing — on the control a person reaches for *because*
   * something already feels wrong.
   */
  it('says so when the stop is refused', async () => {
    cancelTurn.mockRejectedValue(new Error('That turn had already finished.'));
    const user = userEvent.setup();
    await typeInto(user);

    await user.keyboard('I step in.{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Stop' }));

    expect(await screen.findByText('That turn had already finished.')).toBeTruthy();
  });
});
