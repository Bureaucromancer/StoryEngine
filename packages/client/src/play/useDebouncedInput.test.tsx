// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedInput } from './useDebouncedInput.js';

/**
 * The client's first debounce — [P3.4].
 *
 * **Fake timers and no `userEvent`.** `userEvent` v14 schedules on real timers
 * and hangs under `vi.useFakeTimers()` unless it is constructed with
 * `advanceTimers`, and a hang reads as a broken component rather than as a
 * misconfigured test. So the boundary is pinned here, against a probe driven
 * by rerendering directly; `PlayPage.test.tsx` keeps real timers and `waitFor`
 * for the behaviour a person would see. Determinism in one place, robustness
 * in the other.
 */

const DELAY = 400;

let renders = 0;

function Probe({ text, guidance }: { text: string; guidance: string }): React.JSX.Element {
  const settled = useDebouncedInput(text, guidance, DELAY);
  renders += 1;
  return <output>{`${settled.text}|${settled.guidance}`}</output>;
}

function settledText(): string {
  return screen.getByRole('status').textContent;
}

beforeEach(() => {
  renders = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the debounce', () => {
  it('holds the new value until the delay has actually elapsed', () => {
    const view = render(<Probe text="a" guidance="" />);
    expect(settledText()).toBe('a|');

    view.rerender(<Probe text="ab" guidance="" />);
    // One millisecond short. The falsifying mutation is `setTimeout(fn, 0)`,
    // which passes every assertion that only checks the end state.
    act(() => {
      vi.advanceTimersByTime(DELAY - 1);
    });
    expect(settledText()).toBe('a|');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(settledText()).toBe('ab|');
  });

  it('settles on the last value of a burst, not on every one', () => {
    const view = render(<Probe text="a" guidance="" />);

    // Three keystrokes inside one window: each supersedes the last, and only
    // the final one is ever asked about. The falsifying mutation is dropping
    // the `clearTimeout`, which turns a burst into a request per keystroke.
    view.rerender(<Probe text="ab" guidance="" />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    view.rerender(<Probe text="abc" guidance="" />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    view.rerender(<Probe text="abcd" guidance="" />);

    expect(settledText()).toBe('a|');

    /**
     * **Advanced in two steps, and the first one is the whole test.** At
     * t=450 a superseded timer from the first keystroke would have fired
     * (it was armed at t=0 for 400ms) and settled on `ab` — a value nobody
     * paused on and a request nobody wanted. Cleared, there is only the last
     * keystroke's timer, armed at t=200, and nothing has settled yet.
     *
     * Neither an end-state assertion nor a render count can see this: late
     * timers still arrive in order and still leave the *last* value behind,
     * and React batches every one of them that lands inside a single `act`.
     */
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(settledText()).toBe('a|');

    act(() => {
      vi.advanceTimersByTime(DELAY);
    });
    expect(settledText()).toBe('abcd|');
  });

  it('settles on the guidance too, since it is the other half of the input bar', () => {
    const view = render(<Probe text="a" guidance="" />);
    view.rerender(<Probe text="a" guidance="tense" />);

    act(() => {
      vi.advanceTimersByTime(DELAY);
    });
    expect(settledText()).toBe('a|tense');
  });

  it('does not settle again when nothing changed', () => {
    render(<Probe text="a" guidance="" />);
    const afterMount = renders;

    // The arming timer fires on mount and must be a no-op: without the
    // identity bail-out it produces a fresh object, which is a new value
    // downstream and one redundant request per mount. The falsifying mutation
    // is `setSettled({ text, guidance })` unconditionally.
    act(() => {
      vi.advanceTimersByTime(DELAY * 2);
    });
    expect(renders).toBe(afterMount);
  });

  it('cancels on unmount rather than settling into nothing', () => {
    const view = render(<Probe text="a" guidance="" />);
    view.rerender(<Probe text="ab" guidance="" />);

    expect(vi.getTimerCount()).toBe(1);
    view.unmount();

    // **Asserted at the moment of unmount**, because advancing first would
    // run the timer and bring the count back to zero either way — which is
    // how a missing teardown passes a test that only looks afterwards. The
    // falsifying mutation is returning nothing from the effect.
    expect(vi.getTimerCount()).toBe(0);
  });
});
