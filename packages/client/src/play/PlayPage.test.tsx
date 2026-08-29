// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
 * survive the turn ([03 §5.1]), and a reconnect is a status and not an error
 * ([07 §11]). The third this file used to hold — the raw record behind a
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
const previewTurn = vi.fn();
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
    // Since [P3.4] the page carries the context meter, which reads the auth
    // state for its locale, reads and writes the workbench preference, and
    // asks for a preview on every pause. These were the *real* functions
    // under the spread, so without them the page issues real fetches into
    // jsdom.
    previewTurn: (...a: unknown[]) => previewTurn(...a) as unknown,
    api: {
      ...actual.api,
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
  previewTurn.mockResolvedValue(previewOf(100));
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
   * **Guidance is one-shot** ([03 §5.1]): it applies to the turn it was written
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
   * A reconnect is **not** an error ([07 §11]). The cursor makes the resume
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
});
