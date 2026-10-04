// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { memo, type JSX } from 'react';

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { roleLabel } from '../settings/roleWords.js';
import { activeLocale, applyCatalogue } from './catalogue.js';
import { MACHINE_FRENCH } from './fr-x-machine.js';
import { localised, useLocale } from './useLocale.js';

/**
 * ***The stage's *Ends at*, as far as a test can carry it*** —
 * [19 §12](../../../../docs/design/19-tech-stack.md),
 * [P11.8](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * *"The app runs in the test French… and an untranslated key renders English
 * with no placeholder and no console noise."* The **layout** half of that is a
 * person's — a browser, the machine French selected, and eyes on the tag
 * manager's three long folder labels — and it is recorded as a sitting rather
 * than pretended at here. What a test can hold is the **path**: an account's
 * locale reaches a chunk, the chunk reaches the module-level tables, and a
 * component that never heard of any of it re-renders in French. *Its own
 * subscription is what re-renders it here*, so this cannot see a page below the
 * router's memoised `Outlet` (corrected 2026-09-28); `shell-layout.test.tsx`
 * holds that, on the real router.
 *
 * ***`roleWords.ts` is the probe on purpose.*** It is an ordinary table in an
 * ordinary file that knows nothing about locales, imported here by the same
 * import any surface uses. A probe declared inside this file would prove the
 * Proxy works, which `catalogue.test.ts` already proves; this proves the
 * **wiring** — that a real table, in a real module, loaded before any catalogue
 * existed, follows the account.
 */

function Probe(props: { locale: string | null }): JSX.Element {
  useLocale(props.locale);
  return <p data-testid="role">{roleLabel('prose')}</p>;
}

afterEach(() => {
  applyCatalogue('en', {});
});

describe('the account’s locale', () => {
  it('leaves English alone when it names no translation', async () => {
    render(<Probe locale="en-GB" />);
    expect(screen.getByTestId('role').textContent).toBe('Writing the story');
    await waitFor(() => {
      expect(activeLocale()).toBe('en');
    });
  });

  /**
   * ***The whole path in one assertion.*** `roleWords.ts` was imported at the
   * top of this file, before any locale existed, and its table is a module
   * constant — so a design that read the words at import time would pass every
   * other test in the catalogue and fail here. That is the mistake worth having
   * a test for: it is invisible in review and total in effect.
   */
  it('loads the catalogue it names and re-renders in it', async () => {
    render(<Probe locale="fr-x-machine" />);
    expect(screen.getByTestId('role').textContent).toBe('Writing the story');

    await waitFor(() => {
      expect(screen.getByTestId('role').textContent).toBe('Rédaction de l’histoire');
    });
    expect(activeLocale()).toBe('fr-x-machine');
  });

  /**
   * *Switching back is a switch, not a reload.* A catalogue that stayed applied
   * after the account moved to a regional English would leave somebody stuck in
   * a machine's French with the setting saying otherwise — which is the one
   * failure mode a person cannot work around from inside the app.
   */
  it('goes back to English when the account changes its mind', async () => {
    const view = render(<Probe locale="fr-x-machine" />);
    await waitFor(() => {
      expect(screen.getByTestId('role').textContent).toBe('Rédaction de l’histoire');
    });

    view.rerender(<Probe locale="en-AU" />);
    await waitFor(() => {
      expect(screen.getByTestId('role').textContent).toBe('Writing the story');
    });
    expect(activeLocale()).toBe('en');
  });
});

/**
 * ***A page below a memoised boundary*** (2026-09-28). The router's `Outlet` is
 * `React.memo`, so a shell that re-renders when a catalogue lands does not
 * re-render the page under it; `Frozen` here is that boundary, never given a
 * reason to render again. A page that subscribes itself (`localised`) follows
 * the language through it, and one that does not keeps the words it had.
 */
describe('a page below a memoised boundary', () => {
  function Page(): JSX.Element {
    return <p data-testid="page">{roleLabel('prose')}</p>;
  }

  it('follows the language when the route subscribes it', async () => {
    const Wrapped = localised(Page);
    const Frozen = memo(function Frozen() {
      return <Wrapped />;
    });
    render(<Frozen />);
    expect(screen.getByTestId('page').textContent).toBe('Writing the story');

    act(() => {
      applyCatalogue('fr-x-machine', MACHINE_FRENCH);
    });
    await waitFor(() => {
      expect(screen.getByTestId('page').textContent).toBe('Rédaction de l’histoire');
    });
  });

  it('keeps the words it had when nothing subscribes it, which is the boundary’s effect', () => {
    const Frozen = memo(function Frozen() {
      return <Page />;
    });
    render(<Frozen />);

    act(() => {
      applyCatalogue('fr-x-machine', MACHINE_FRENCH);
    });
    expect(screen.getByTestId('page').textContent).toBe('Writing the story');
  });
});
