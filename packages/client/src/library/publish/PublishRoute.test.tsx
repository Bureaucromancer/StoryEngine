// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***The review's route: the address read, and the two states of a lazy chunk***
 * — [P16.3g](../../../../../docs/design/workplan/35-p16-world.md),
 * [21 §7.2](../../../../../docs/design/21-client-loading.md).
 *
 * §7.2 says why the component tests cannot be the guardrail that the review is
 * off the entry — a rendered mock of a lazy component is a module however it
 * was imported — and `tools/entry-budget.test.ts` is that guardrail. What is
 * held here is what §7.2 says every boundary owes: **only a failed load is told
 * to reload**, anything else says the review stopped, and the way back to the
 * library stands outside the boundary either way.
 */

let search: { from?: string; world?: string } = {};
const previewPublish = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => search }),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

vi.mock('../../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.js')>()),
  api: {
    authState: () => Promise.resolve({ account: { handle: 'ned', locale: null } }),
    previewPublish: (...a: unknown[]) => previewPublish(...a) as unknown,
  },
}));

const { PublishChunkError, PublishLoad, PublishRoute, startOf } = await import('./PublishRoute.js');

beforeEach(() => {
  vi.clearAllMocks();
  search = {};
});

function Throws(props: { error: Error }): never {
  throw props.error;
}

describe('the address', () => {
  it('reads a World start, a selection, one object, and nothing', () => {
    expect(startOf({ world: 'w-1' })).toEqual({ kind: 'world', id: 'w-1' });
    expect(startOf({ from: 'a,b' })).toEqual({ kind: 'objects', ids: ['a', 'b'] });
    expect(startOf({ from: 'a' })).toEqual({ kind: 'objects', ids: ['a'] });
    expect(startOf({})).toBeNull();
    // A World wins over a list, as the router normalises it.
    expect(startOf({ world: 'w-1', from: 'a' })).toEqual({ kind: 'world', id: 'w-1' });
  });

  /**
   * ***Each id decoded whole*** (2026-10-11, the P16.3g review): the doors
   * write ids percent-encoded (`joinIds`), so a comma or a space inside one is
   * one id here, and the server is sent exactly the id on the page. A part
   * that will not decode — an address edited by hand — is dropped.
   */
  it('reads each id as it was written, a comma or a space inside it included', () => {
    expect(startOf({ from: 'vera%2C%20the%20elder%20,ash' })).toEqual({
      kind: 'objects',
      ids: ['vera, the elder ', 'ash'],
    });
    expect(startOf({ from: '%E0%A4%A,ash' })).toEqual({ kind: 'objects', ids: ['ash'] });
  });

  it('says nothing is chosen, and keeps the way back, for an address that names nothing', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <PublishRoute />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/^Nothing is chosen to publish\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the library' })).toBeTruthy();
    expect(previewPublish).not.toHaveBeenCalled();
  });

  it('loads the review for a start, with a sentence while it comes', async () => {
    search = { world: 'w-1' };
    previewPublish.mockReturnValue(new Promise(() => undefined));
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <PublishRoute />
      </QueryClientProvider>,
    );
    expect((await screen.findByRole('status')).textContent).toBe('Gathering what this would send…');
    await vi.waitFor(() => {
      expect(previewPublish).toHaveBeenCalledWith({ kind: 'world', id: 'w-1' });
    });
  });
});

describe('the boundary', () => {
  it('tells a failed load to reload', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <PublishLoad>
        <Throws error={new PublishChunkError(new Error('404'))} />
      </PublishLoad>,
    );
    expect(screen.getByRole('alert').textContent).toContain('reload the page');
  });

  it('does not blame an upgrade for a review that fails as it draws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <PublishLoad>
        <Throws error={new Error('a bug')} />
      </PublishLoad>,
    );
    const said = screen.getByRole('alert').textContent;
    expect(said).toContain('stopped with an error');
    expect(said).not.toContain('reload');
  });
});
