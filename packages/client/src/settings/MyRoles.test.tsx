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
const writeMyTaskRoles = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  api: {
    readMyRoles: (...a: unknown[]) => readMyRoles(...a) as unknown,
    writeMyBindings: (...a: unknown[]) => writeMyBindings(...a) as unknown,
    writeMyTaskRoles: (...a: unknown[]) => writeMyTaskRoles(...a) as unknown,
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
  writeMyTaskRoles.mockResolvedValue({ tasks: { assist: 'fast' } });
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

/**
 * ***An install connection one of yours hides*** — [polish §26](../../../../docs/design/workplan/06-polish.md),
 * 2026-10-04.
 *
 * Both share an id, so a job set to either reaches your file. Before this the
 * pane offered the install's models as choices that saved and then sent to
 * yours — and where both listed a model, two options with one value. The
 * server marks the hidden one (`shadowedBy`) and the pane takes its word.
 */
describe('an install connection one of yours hides', () => {
  const MINE = {
    id: HOUSE.id,
    label: 'My copy',
    provider: 'openai-compatible',
    scope: 'user' as const,
    models: ['llama-local', 'gpt-hi'],
  };
  const HIDDEN = { ...HOUSE, shadowedBy: { label: 'My copy' } };

  it('is not offered, and the pane says why', async () => {
    readMyRoles.mockResolvedValue(state({ connections: [MINE, HIDDEN] }));
    renderPane();

    const control = (await screen.findAllByRole('combobox'))[0]!;
    const labels = [...control.querySelectorAll('option')].map((one) => one.textContent);
    expect(labels).toEqual([
      'Use this install’s default',
      'llama-local — My copy',
      'gpt-hi — My copy',
    ]);
    expect(
      screen.getByText(
        'The install’s connection “The house key” is not offered below: your own “My copy” has the same id, so any job set to it uses yours.',
      ),
    ).toBeTruthy();
  });

  it('says nothing when nothing is hidden', async () => {
    readMyRoles.mockResolvedValue(state({ connections: [{ ...MINE, id: 'conn-mine' }, HOUSE] }));
    renderPane();

    await screen.findAllByRole('combobox');
    expect(screen.queryByText(/is not offered below/)).toBeNull();
  });

  /**
   * **A binding chosen on the install's connection before your file arrived**
   * is not gone: it reaches your file, asking for a model your file does not
   * list. Calling it gone would send somebody looking for a removed connection
   * that is sitting in the list above it.
   */
  it('calls a binding to the hidden connection by the file it reaches', async () => {
    readMyRoles.mockResolvedValue(
      state({
        connections: [MINE, HIDDEN],
        bindings: { prose: { connectionId: HOUSE.id, modelId: 'gpt-lo' } },
      }),
    );
    renderPane();

    await screen.findAllByRole('combobox');
    expect(screen.getByText('gpt-lo — My copy, which does not list it')).toBeTruthy();
    expect(screen.queryByText('gpt-lo — on a connection that is gone')).toBeNull();
  });

  /**
   * **And one your file does list is simply yours** — the other half of the
   * case above, and the one a straight copy always produces, since a copy
   * keeps the install's `models`. The held pair `<id>\n<model>` is then the
   * value of an option the pane already offers, so it is that option, chosen,
   * and no second label is drawn for it. Sitting Z2 and the guide both say a
   * person sees exactly this; without it they would be promising a sentence
   * the code had only been shown to draw for the other case (found in review,
   * 2026-10-04).
   */
  it('calls a binding to a model your file also lists by your file alone', async () => {
    readMyRoles.mockResolvedValue(
      state({
        connections: [MINE, HIDDEN],
        bindings: { prose: { connectionId: HOUSE.id, modelId: 'gpt-hi' } },
      }),
    );
    renderPane();

    const control = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    const labels = [...control.querySelectorAll('option')].map((one) => one.textContent);
    expect(labels).toEqual([
      'Use this install’s default',
      'llama-local — My copy',
      'gpt-hi — My copy',
    ]);
    expect(control.value).toBe(`${HOUSE.id}\ngpt-hi`);
  });

  /**
   * **Said once for two install copies of one connection.** The server marks
   * every install file claiming the hidden id, and two that share it by a
   * straight copy share the label too — so the pane had two identical
   * sentences under one React key. What a person should see is one.
   */
  it('says it once when two install files share the id and the label', async () => {
    readMyRoles.mockResolvedValue(state({ connections: [MINE, HIDDEN, { ...HIDDEN }] }));
    renderPane();

    await screen.findAllByRole('combobox');
    expect(screen.getAllByText(/is not offered below/)).toHaveLength(1);
  });
});

/**
 * ***Which of your models writes a field when you ask for help*** — the
 * stopgap for [26 C15] that lets a person point field assist at their quick
 * model. It picks a **row of the table**, so the model it reports is that row's
 * and nothing is worked out here.
 */
describe('choosing what writing help uses', () => {
  it('defaults to the story’s model, and says which model that is', async () => {
    renderPane();

    const control = await screen.findByRole('combobox', {
      name: 'Writing help uses the model for',
    });
    expect((control as HTMLSelectElement).value).toBe('prose');
    expect(screen.getByText('Right now that is gpt-hi.')).toBeTruthy();
  });

  it('writes the role chosen, and nothing else', async () => {
    renderPane();

    const control = await screen.findByRole('combobox', {
      name: 'Writing help uses the model for',
    });
    await userEvent.selectOptions(control, 'Quick background jobs');

    await waitFor(() => {
      expect(writeMyTaskRoles).toHaveBeenCalledWith({ assist: 'fast' });
    });
    expect(writeMyBindings).not.toHaveBeenCalled();
  });
});
