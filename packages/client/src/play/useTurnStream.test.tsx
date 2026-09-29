// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***A turn stream refused as signed out*** (2026-09-27).
 *
 * The play page's stream reconnects on its own, and a reconnect after the
 * sign-in has ended is refused with the one class that is about the sign-in
 * rather than the stream. That class used to become the page's failed status
 * and nothing else; it now also raises the flag the shell turns into *your
 * sign-in has ended* (`auth/session-ended.ts`).
 */

let fatal: ((error: string) => void) | null = null;

vi.mock('./stream.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stream.js')>()),
  openTurnStream: (_sessionId: string, handlers: { onFatal: (error: string) => void }) => {
    fatal = handlers.onFatal;
    return { close: () => undefined };
  },
}));

const { useTurnStream } = await import('./useTurnStream.js');

function Probe(): JSX.Element {
  const { state } = useTurnStream('s-1');
  return <p data-testid="status">{state.status}</p>;
}

beforeEach(() => {
  fatal = null;
});

describe('a turn stream that closes for good', () => {
  it('raises the sign-in-ended flag only when it was refused as signed out', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );

    act(() => {
      fatal?.('not-found');
    });
    expect(client.getQueryData(['session-ended'])).toBeUndefined();

    act(() => {
      fatal?.('unauthenticated');
    });
    expect(client.getQueryData(['session-ended'])).toBe(true);
    expect(screen.getByTestId('status').textContent).toBe('failed');
  });
});
