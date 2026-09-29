// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoMode } from './useAutoMode.js';

/**
 * Auto-mode's clock — [P13 §1.8], [P13.5]. Fake timers and a probe, as
 * `useDebouncedInput.test.tsx` pins its debounce and for its reason: the
 * boundary is a statement about milliseconds, and a real-timer test of it is a
 * flaky one.
 */

const fire = vi.fn();

function Probe(props: { on: boolean; idle: boolean; delayMs?: number }): null {
  useAutoMode({ on: props.on, idle: props.idle, delayMs: props.delayMs ?? 5000, fire });
  return null;
}

beforeEach(() => {
  fire.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('auto-mode', () => {
  it('fires once the page has been idle for the whole delay, and not before', () => {
    render(<Probe on idle />);
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(fire).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('waits the whole delay again after a turn, rather than keeping a beat', () => {
    const view = render(<Probe on idle />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // The turn it started runs for a while: not idle.
    view.rerender(<Probe on idle={false} />);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fire).toHaveBeenCalledTimes(1);
    view.rerender(<Probe on idle />);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(fire).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it('stops when switched off mid-wait — typing, Stop, a failure', () => {
    const view = render(<Probe on idle />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    view.rerender(<Probe on={false} idle />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(fire).not.toHaveBeenCalled();
  });

  it('honours a configured delay', () => {
    render(<Probe on idle delayMs={1000} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
