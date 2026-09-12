// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The role-binding editor — [10 §15.1](../../../../docs/design/10-ui-surfaces.md),
 * [P7.3](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **What is worth testing here is the document, not the table.** The table is
 * rendered from what the server resolved and works nothing out, so asserting on
 * its cells would be asserting on a fixture. What this component actually
 * decides is *what gets written* — and two of those decisions are the kind that
 * would be silently wrong: clearing a role has to remove its key rather than
 * write a null, and a binding onto a connection that is gone has to survive
 * editing a different row.
 */

const readMyRoles = vi.fn();
const writeMyBindings = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  api: {
    readMyRoles: (...a: unknown[]) => readMyRoles(...a) as unknown,
    writeMyBindings: (...a: unknown[]) => writeMyBindings(...a) as unknown,
  },
}));

const { MyRoles } = await import('./MyRoles.js');
const { ApiError } = await import('../api.js');

const HOUSE = {
  id: 'conn-house',
  label: 'The house key',
  provider: 'openai-compatible',
  scope: 'system' as const,
  models: ['gpt-hi', 'gpt-lo'],
};

function state(over: Record<string, unknown> = {}) {
  return {
    roles: [
      {
        role: 'prose',
        tier: 'hi',
        ok: true,
        via: 'default',
        connectionId: HOUSE.id,
        connectionLabel: HOUSE.label,
        modelId: 'gpt-hi',
      },
      { role: 'image', tier: 'unset', ok: false, reason: 'unbound' },
    ],
    bindings: {},
    contentHash: 'sha256:read',
    connections: [HOUSE],
    disabled: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readMyRoles.mockResolvedValue(state());
  writeMyBindings.mockResolvedValue({ bindings: {}, contentHash: 'sha256:written' });
});

function renderPane() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MyRoles />
    </QueryClientProvider>,
  );
}

describe('MyRoles', () => {
  it('says what each job does now and where the answer came from', async () => {
    renderPane();

    // The row header, by role: the select in the same row carries the job's
    // words too, as its `sr-only` label.
    expect(await screen.findByRole('rowheader', { name: 'Writing the story' })).toBeTruthy();
    expect(screen.getByText("This install's default, on The house key")).toBeTruthy();
    // The three-state distinction the admin table already draws: unset by
    // policy reads differently from unbound by accident.
    expect(screen.getByText('Nothing can do this yet, and nothing needs to.')).toBeTruthy();
  });

  it('offers every model on every connection, plus leaving it to the install', async () => {
    renderPane();

    const control = (await screen.findAllByRole('combobox'))[0]!;
    const labels = [...control.querySelectorAll('option')].map((one) => one.textContent);

    expect(labels).toEqual([
      'Use this install’s default',
      'gpt-hi — The house key',
      'gpt-lo — The house key',
    ]);
  });

  it('writes the chosen pair against the hash it read', async () => {
    renderPane();

    const control = (await screen.findAllByRole('combobox'))[0]!;
    await userEvent.selectOptions(control, `${HOUSE.id}\ngpt-lo`);

    await waitFor(() => {
      expect(writeMyBindings).toHaveBeenCalledWith(
        { prose: { connectionId: HOUSE.id, modelId: 'gpt-lo' } },
        'sha256:read',
      );
    });
  });

  /**
   * **Absent, not null.** *Use the install's default* is expressed by the key
   * not being there — `pickBindings` would drop a null and `resolveRole` skips
   * it, so a null would work by accident while meaning something the document
   * cannot say.
   */
  it('clears a role by removing its key rather than writing an empty one', async () => {
    readMyRoles.mockResolvedValue(
      state({ bindings: { prose: { connectionId: HOUSE.id, modelId: 'gpt-lo' } } }),
    );
    renderPane();

    const control = (await screen.findAllByRole('combobox'))[0]!;
    await userEvent.selectOptions(control, '');

    await waitFor(() => {
      expect(writeMyBindings).toHaveBeenCalledWith({}, 'sha256:read');
    });
  });

  /**
   * **The silent-rewrite case.** A select whose value is absent from its options
   * renders as the first option, so a binding this build cannot offer would read
   * back as *use the install's default* — and the next change to **any other
   * row** would save a document with this one quietly cleared.
   */
  it('keeps a binding whose connection is gone, and says that is what it is', async () => {
    readMyRoles.mockResolvedValue(
      state({
        bindings: {
          prose: { connectionId: 'conn-removed', modelId: 'gpt-hi' },
          image: { connectionId: HOUSE.id, modelId: 'gpt-lo' },
        },
      }),
    );
    renderPane();

    const controls = await screen.findAllByRole('combobox');
    expect(screen.getByText('gpt-hi — on a connection that is gone')).toBeTruthy();

    // Editing the *other* row must not take the dangling one with it.
    await userEvent.selectOptions(controls[1]!, '');

    await waitFor(() => {
      expect(writeMyBindings).toHaveBeenCalledWith(
        { prose: { connectionId: 'conn-removed', modelId: 'gpt-hi' } },
        'sha256:read',
      );
    });
  });

  it('reports a file that moved underneath it, and does not claim the save happened', async () => {
    writeMyBindings.mockRejectedValue(
      new ApiError(412, 'stale', 'Your bindings file has changed since this page read it.'),
    );
    renderPane();

    const control = (await screen.findAllByRole('combobox'))[0]!;
    await userEvent.selectOptions(control, `${HOUSE.id}\ngpt-lo`);

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText(/Nothing was overwritten/)).toBeTruthy();
  });

  /**
   * A refusal that is not a collision must not be reported as one — a
   * stale-file notice about a dropped connection would send somebody looking
   * for an edit nobody made.
   */
  it('reports an ordinary failure as an ordinary failure', async () => {
    writeMyBindings.mockRejectedValue(new ApiError(500, 'internal', 'No.'));
    renderPane();

    const control = (await screen.findAllByRole('combobox'))[0]!;
    await userEvent.selectOptions(control, `${HOUSE.id}\ngpt-lo`);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/Nothing was overwritten/)).toBeNull();
  });

  it('says so when connections of your own are being withheld', async () => {
    readMyRoles.mockResolvedValue(
      state({ disabled: [{ ...HOUSE, id: 'conn-mine', label: 'My own', scope: 'user' as const }] }),
    );
    renderPane();

    expect(await screen.findByText(/not letting you use/)).toBeTruthy();
  });
});
