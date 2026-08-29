// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * [polish §2]'s fold, claim by claim: collapsed on arrival, the open state a
 * per-user preference rather than component state, the copy control copying
 * the whole object, the height bounded. The preference half uses the stateful
 * prefs mock `dock.test.tsx` established — `readPrefs` answers what was
 * patched, `null` deletes — because "remembered per user" is a claim about
 * the round trip, not about a `useState`.
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

const { AsStored } = await import('./AsStored.js');

const OBJECT = { schema: 'storyengine.lorebook/1', name: 'Rain City', entries: [] };

function renderFold(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AsStored value={OBJECT} />
    </QueryClientProvider>,
  );
}

function fold(): HTMLDetailsElement {
  const details = document.querySelector('details');
  if (details === null) throw new Error('The fold did not render.');
  return details;
}

describe('the as-stored fold', () => {
  it('arrives collapsed, with the bytes behind the fold', () => {
    renderFold();

    expect(fold().getAttribute('open')).toBeNull();
    expect(screen.getByText('As stored')).toBeTruthy();
  });

  it('opens on toggle and records the preference — once, and not on mount', async () => {
    renderFold();

    await userEvent.click(screen.getByText('As stored'));

    expect(fold().getAttribute('open')).not.toBeNull();
    expect(screen.getByText(/"Rain City"/)).toBeTruthy();
    // One write, carrying the key — the mutation is a fold that toggles in
    // useState and forgets on the next page.
    expect(patchPrefs).toHaveBeenCalledTimes(1);
    expect(patchPrefs).toHaveBeenCalledWith({ 'ui.as-stored-open': true });
  });

  it('a stored preference arrives open, and opening is a read, not a write', async () => {
    prefsStore = { 'ui.as-stored-open': true };
    renderFold();

    // jsdom leaves closed-details content queryable, so the text is no proof
    // of openness — the attribute is, once the preference read lands.
    await waitFor(() => {
      expect(fold().getAttribute('open')).not.toBeNull();
    });
    // The mount-time toggle React fires while applying the stored preference
    // must not patch it back — the same read-not-write rule the dock's reload
    // test pins.
    expect(patchPrefs).not.toHaveBeenCalled();
  });

  it('copies the whole object, and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    prefsStore = { 'ui.as-stored-open': true };
    renderFold();

    await userEvent.click(await screen.findByRole('button', { name: 'Copy' }));

    expect(await screen.findByText('Copied.')).toBeTruthy();
    // The whole object, byte for byte with the pane — the mutation is copying
    // a summary, which passes every laxer assertion.
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(OBJECT, null, 2));
  });

  it('admits a copy that cannot happen', async () => {
    // jsdom's truth, made explicit rather than stumbled into: no clipboard.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    prefsStore = { 'ui.as-stored-open': true };
    renderFold();

    await userEvent.click(await screen.findByRole('button', { name: 'Copy' }));

    expect(await screen.findByText('The clipboard refused.')).toBeTruthy();
  });

  it('bounds the height so a long object scrolls inside the fold', () => {
    prefsStore = { 'ui.as-stored-open': true };
    renderFold();

    // jsdom computes no layout, so the class is the assertable fact; the
    // browser walk covers the real scroll.
    const pane = document.querySelector('pre')?.parentElement;
    expect(pane?.className).toContain('max-h-96');
    expect(pane?.className).toContain('overflow-auto');
  });
});
