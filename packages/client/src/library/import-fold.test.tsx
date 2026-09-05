// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The import controls fold, and the fold is remembered ([P4 §7.12]).
 *
 * A separate file from `ImportPanel.test.tsx` because the claim needs a
 * different double: that file spies on one API call at a time, and *remembered
 * per user* is a claim about a round trip through the prefs store. So this uses
 * the stateful mock `dock.test.tsx` established and `AsStored.test.tsx` reuses —
 * `readPrefs` answers what was patched, `null` deletes.
 *
 * **The default is inverted from `AsStored`'s and that is deliberate**, so it is
 * asserted rather than left to the reader: a fold whose entire content is the
 * import controls should not greet somebody closed, whereas a fold over an
 * object's raw JSON should. Open is therefore the absence of the preference, and
 * `false` is what gets stored.
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

const { ImportPanel, importOpenFromPrefs, importOpenPatch } = await import('./ImportPanel.js');
const { api } = await import('../api.js');

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ImportPanel />
    </QueryClientProvider>,
  );
}

function fold(): HTMLDetailsElement {
  const details = document.querySelector('details');
  if (details === null) throw new Error('The fold did not render.');
  return details;
}

describe('the preference pair', () => {
  it('reads open as the absence of the key', () => {
    expect(importOpenFromPrefs(undefined)).toBe(true);
    expect(importOpenFromPrefs({})).toBe(true);
    expect(importOpenFromPrefs({ 'ui.import-open': false })).toBe(false);
  });

  it('writes closed and deletes to mean open', () => {
    // `null` is the store's delete, so reopening leaves no key behind — the
    // never-set case and the reopened case are one state, which is the whole
    // reason the default is expressed as an absence.
    expect(importOpenPatch(false)).toEqual({ 'ui.import-open': false });
    expect(importOpenPatch(true)).toEqual({ 'ui.import-open': null });
  });

  it('uses a key the prefs store will accept', () => {
    // Lowercase and hyphens only, or the server answers 400 at the first patch
    // — the constraint `workbench/prefs.ts` records so the next key inherits it
    // rather than rediscovering it.
    const key = Object.keys(importOpenPatch(false))[0]!;
    expect(key).toMatch(/^[a-z0-9]+(\.[a-z0-9-]+)+$/);
  });
});

describe('the fold', () => {
  it('is open on arrival, unlike the folds that hide detail', async () => {
    renderPanel();
    await waitFor(() => {
      expect(fold().open).toBe(true);
    });
    expect(screen.getByPlaceholderText(/full path/i)).toBeTruthy();
  });

  it('remembers being closed, and stores it as a preference', async () => {
    renderPanel();
    await waitFor(() => {
      expect(fold().open).toBe(true);
    });

    await userEvent.click(screen.getByText('Add to your library'));

    await waitFor(() => {
      expect(patchPrefs).toHaveBeenCalledWith({ 'ui.import-open': false });
    });
    expect(prefsStore['ui.import-open']).toBe(false);
  });

  it('comes back closed for somebody who closed it', async () => {
    // What a reload finds, which is the half a `useState` would get wrong.
    prefsStore = { 'ui.import-open': false };
    renderPanel();

    await waitFor(() => {
      expect(fold().open).toBe(false);
    });
  });

  it('does not patch the preference just for rendering it', async () => {
    // React applying the stored value at mount fires `toggle`, and writing that
    // back would make every render of the page a write. The guard is what stops
    // it, and this is what would catch the guard being dropped.
    prefsStore = { 'ui.import-open': false };
    renderPanel();

    await waitFor(() => {
      expect(fold().open).toBe(false);
    });
    expect(patchPrefs).not.toHaveBeenCalled();
  });

  it('keeps the review visible when the controls are folded away', async () => {
    // The reason collapsing is worth having: the report outlives the form that
    // produced it, so it sits outside the fold.
    const { api } = await import('../api.js');
    vi.spyOn(api, 'importSweep').mockResolvedValue({
      suggestions: [],
      report: {
        jobId: 'job-1',
        source: 'sillytavern',
        items: [{ source: 'worlds/Rain City.json', disposition: 'converted', notes: [] }],
        counts: { converted: 1 },
      },
    });

    renderPanel();
    await waitFor(() => {
      expect(fold().open).toBe(true);
    });

    await userEvent.type(screen.getByPlaceholderText(/full path/i), '/somewhere/data');
    await userEvent.click(screen.getByRole('button', { name: /import folder/i }));
    await waitFor(() => {
      expect(screen.getByText('worlds/Rain City.json')).toBeTruthy();
    });

    await userEvent.click(screen.getByText('Add to your library'));
    await waitFor(() => {
      expect(fold().open).toBe(false);
    });

    // **Asserted structurally, not by visibility.** A closed `<details>` keeps
    // its content in the DOM and the browser declines to paint it; jsdom paints
    // nothing either way, so `queryBy` finds the input whether it is folded or
    // not. What decides whether closing the fold hides a thing is which side of
    // the `<details>` it was rendered on, and that is checkable here.
    const details = fold();
    expect(details.contains(screen.getByPlaceholderText(/full path/i))).toBe(true);
    expect(details.contains(screen.getByText('worlds/Rain City.json'))).toBe(false);
  });
});

/**
 * The folder half is behind `fileAccess`, so it says so ([05 §4.2.2]).
 *
 * The permission defaults to `none`, so before this most accounts saw a form
 * that could only fail — and the failure arrived as a red string after a round
 * trip. [01 §2.2] forbids a control that does nothing; one guaranteed to refuse
 * is the same fault with a request attached.
 */
describe('the folder half, against the permission', () => {
  function withFileAccess(fileAccess: string): void {
    vi.spyOn(api, 'authState').mockResolvedValue({
      setupRequired: false,
      setupTokenRequired: false,
      minPasswordLength: 8,
      account: {
        handle: 'ned',
        displayName: 'Ned',
        role: 'admin',
        enabled: true,
        locale: null,
        capabilities: { privateConnections: true, fileAccess, enableExtensions: false },
        createdAt: 0,
      },
    });
  }

  it('explains the permission instead of offering a control that must refuse', async () => {
    withFileAccess('none');
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/needs a permission this account does not have/i)).toBeTruthy();
    });
    // Present but inert: `hidden` keeps it out of the accessibility tree and out
    // of the tab order, which is what "not offered" has to mean for somebody
    // navigating by keyboard.
    const box = screen.getByPlaceholderText(/full path/i);
    expect(box.closest('[hidden]')).not.toBeNull();
  });

  it('offers it to an account that holds the grant', async () => {
    withFileAccess('read');
    renderPanel();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/full path/i).closest('[hidden]')).toBeNull();
    });
    expect(screen.queryByText(/needs a permission/i)).toBeNull();
  });

  it('offers it while the answer is still unknown', async () => {
    // Permissive on purpose: showing the controls to somebody who turns out not
    // to hold the grant costs one clear refusal, and hiding them from somebody
    // who does costs them the feature with nothing to explain it. The server is
    // the real gate either way.
    vi.spyOn(api, 'authState').mockRejectedValue(new Error('offline'));
    renderPanel();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/full path/i).closest('[hidden]')).toBeNull();
    });
  });
});
