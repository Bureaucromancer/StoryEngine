// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { newActor } from '@storyengine/shared';

import { HistoryPanel } from './HistoryPanel.js';

/**
 * Exit-gate step 19's client half — F11, on F16's infrastructure.
 *
 * *"Diff two versions → the changed field, and only the changed field."* The
 * comparison itself is `diffObjects`, unit-tested exhaustively in
 * `form.test.ts`; what was never exercised is the join — that opening a diff
 * asks for the right version and renders what came back. A component test is
 * the only place that claim lives, which is why the step sat in the
 * never-automated pile.
 *
 * The query hooks are mocked rather than wrapped in a provider: the subject is
 * this component's behaviour, and a `QueryClientProvider` plus a fake transport
 * would put two more moving parts between the assertion and the thing it is
 * about.
 */

const versions = [
  {
    id: 'v2',
    digest: 'sha256:bbb',
    revision: 2,
    authoredAt: '2026-08-16T12:00:00.000Z',
    recordedAt: '2026-08-16T12:00:00.000Z',
    source: { kind: 'manual' },
    reason: 'Second pass',
    authorVersion: null,
    pinned: false,
  },
];

const before = newActor('Vera Solano') as unknown as Record<string, unknown>;
const current = { ...before, name: 'Vera Solano, the fixer' };

const useObjectHistory = vi.fn();
const useVersionPayload = vi.fn();

vi.mock('../queries.js', () => ({
  useObjectHistory: (...args: unknown[]) => useObjectHistory(...args) as unknown,
  useVersionPayload: (...args: unknown[]) => useVersionPayload(...args) as unknown,
  useRestoreVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useAmendVersion: () => ({ mutate: vi.fn(), isPending: false }),
}));

beforeEach(() => {
  useObjectHistory.mockReturnValue({ data: { versions }, isPending: false, isError: false });
  useVersionPayload.mockReturnValue({ data: { object: before }, isPending: false });
});

function renderPanel() {
  return render(
    <HistoryPanel
      id="01a008de-7e08-70d0-899c-f6869d6b9aeb"
      currentObject={current}
      contentHash="sha256:ccc"
      locale={undefined}
      onRestored={vi.fn()}
    />,
  );
}

describe('the diff view', () => {
  it('asks for nothing until a diff is opened', () => {
    renderPanel();

    // The version id is the third argument, and it is null while the panel is
    // just a list — otherwise every render of the history fetches every payload.
    expect(useVersionPayload).toHaveBeenCalledWith('actors', expect.any(String), null);
  });

  it('shows the changed field, and only the changed field', async () => {
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Diff' }));

    // The table has one row, and the row is the field that moved. Asserted as
    // the whole set of paths rather than "name is somewhere on the page",
    // because *only the changed field* is the half of step 19 that a dump would
    // also satisfy.
    const rows = screen.getAllByRole('row').slice(1); // minus the header
    const paths = rows.map((row) => row.querySelector('code')?.textContent);
    expect(paths).toEqual(['name']);

    // Both sides of the change, in the order the columns claim.
    const cells = rows[0]!.querySelectorAll('td');
    expect(cells[1]?.textContent).toContain('Vera Solano');
    expect(cells[2]?.textContent).toContain('the fixer');
  });

  it('asks for the version it was told to diff', async () => {
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Diff' }));

    expect(useVersionPayload).toHaveBeenCalledWith('actors', expect.any(String), 'v2');
  });
});
