// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The connections surface — [10 §15.3](../../../../docs/design/10-ui-surfaces.md),
 * [P2B §3](../../../../docs/design/workplan/10-p2b-provider-configuration.md) stages P2B.3
 * and P2B.4.
 *
 * **Its own file rather than more of `SettingsPage.test.tsx`**, because what is
 * being asserted here is different in kind: that file is about *absent is
 * absent* and tests the network, this one is about a form whose every
 * interesting behaviour is a decision made between a keystroke and a request.
 *
 * The three that matter, and each was a real gap before it was a test:
 * a blank key box means *keep what is stored* rather than *clear it*; an edit
 * presents the hash it read and a create does not; and the role table renders
 * three states where a naive one would render two.
 */

const listConnections = vi.fn();
const readBindings = vi.fn();
const readRoles = vi.fn();
const createConnection = vi.fn();
const updateConnection = vi.fn();
const deleteConnection = vi.fn();
const connectionBindings = vi.fn();
const fetchModels = vi.fn();
const writeDefaultBindings = vi.fn();
/**
 * **Named rather than anonymous, which is the change that made this file able to
 * see the role editor at all.** It sat here as a bare `vi.fn()` for as long as
 * the route had no caller — mocked so the module would load, asserted on by
 * nothing, which is exactly what an unused surface looks like from a test file.
 */
const writeBindings = vi.fn();
const testConnection = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  /**
   * **Only `authState`, for the test panel's locale** ([polish §25]): it reads
   * the account to format a duration and a count, and an unmocked query would
   * reach for a network jsdom does not have. Pending forever is the honest stub
   * — the panel formats in the default locale until an account arrives, and
   * nothing here is about which locale that is.
   */
  api: {
    authState: () => new Promise(() => undefined),
  },
  adminApi: {
    listConnections: (...a: unknown[]) => listConnections(...a) as unknown,
    readBindings: (...a: unknown[]) => readBindings(...a) as unknown,
    readRoles: (...a: unknown[]) => readRoles(...a) as unknown,
    createConnection: (...a: unknown[]) => createConnection(...a) as unknown,
    updateConnection: (...a: unknown[]) => updateConnection(...a) as unknown,
    deleteConnection: (...a: unknown[]) => deleteConnection(...a) as unknown,
    connectionBindings: (...a: unknown[]) => connectionBindings(...a) as unknown,
    fetchModels: (...a: unknown[]) => fetchModels(...a) as unknown,
    writeDefaultBindings: (...a: unknown[]) => writeDefaultBindings(...a) as unknown,
    writeBindings: (...a: unknown[]) => writeBindings(...a) as unknown,
    testConnection: (...a: unknown[]) => testConnection(...a) as unknown,
  },
}));

const { AdminConnections } = await import('./Connections.js');

function connection(over: Record<string, unknown> = {}) {
  return {
    id: 'house',
    label: 'The house key',
    provider: 'openai-compatible',
    scope: 'system' as const,
    models: ['gpt-hi', 'gpt-lo'],
    baseUrl: 'https://api.internal.example/v1',
    hasKey: true,
    shadowed: false,
    contentHash: 'sha256:as-the-page-read-it',
    ...over,
  };
}

function role(over: Record<string, unknown> = {}) {
  return { role: 'prose', tier: 'hi' as const, ok: false, reason: 'unbound' as const, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  listConnections.mockResolvedValue({ connections: [] });
  readBindings.mockResolvedValue({ bindings: {}, contentHash: 'sha256:empty' });
  readRoles.mockResolvedValue({ roles: [] });
  connectionBindings.mockResolvedValue({ bindings: 0 });
  createConnection.mockResolvedValue({ connection: connection() });
  updateConnection.mockResolvedValue({ connection: connection({ label: 'Renamed' }) });
  deleteConnection.mockResolvedValue(undefined);
  fetchModels.mockResolvedValue({ models: ['gpt-hi'] });
  writeDefaultBindings.mockResolvedValue({ bindings: {}, contentHash: 'sha256:written' });
  writeBindings.mockResolvedValue({ bindings: {}, contentHash: 'sha256:written' });
  testConnection.mockResolvedValue({
    kind: 'text',
    text: 'Hello there.',
    modelId: 'gpt-hi',
    finishReason: 'stop',
    usage: { promptTokens: 12, completionTokens: 3 },
    cost: null,
    elapsedMs: 840,
  });
});

/**
 * One row's picker, once it can actually be used.
 *
 * The control is disabled until the bindings document has been read, because a
 * write has to present the hash it saw — so a test that selected the moment the
 * table rendered would be racing the query rather than testing the editor.
 */
async function rolePicker(name: string): Promise<HTMLSelectElement> {
  const picker: HTMLSelectElement = await screen.findByRole('combobox', { name });
  await waitFor(() => {
    expect(picker.disabled).toBe(false);
  });
  return picker;
}

function renderSurface(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AdminConnections />
    </QueryClientProvider>,
  );
}

describe('the key box', () => {
  /**
   * **Blank means keep, and the form has to say so** — [P2B §2.2].
   *
   * A stored key is never sent to the browser, so the box is always empty on an
   * edit. Which leaves it meaning either *there is no key* or *there is one and
   * you are not being shown it* — two states an admin has to tell apart, and
   * the reason `hasKey` is on the wire at all.
   */
  it('says what an empty box means, differently for a key that is stored', async () => {
    listConnections.mockResolvedValue({ connections: [connection({ hasKey: true })] });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(
      screen.getByText(
        'A key is stored. Leave this blank to keep it, or type a new one to replace it.',
      ),
    ).toBeTruthy();
  });

  it('says the other thing when there is no key', async () => {
    listConnections.mockResolvedValue({ connections: [connection({ hasKey: false })] });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(
      screen.getByText(
        'Leave this blank if the endpoint does not need one, which is usual for a model running on your own machine.',
      ),
    ).toBeTruthy();
  });

  /**
   * **And the blank box sends nothing**, which is the half a note cannot
   * guarantee. Sending `apiKey: ''` would clear the stored key — the server
   * treats an explicit empty string as *clear it* — so an edit of a label
   * would delete the credential and the note above would be a lie.
   */
  it('sends no key at all when it was left blank', async () => {
    listConnections.mockResolvedValue({ connections: [connection({ hasKey: true })] });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateConnection).toHaveBeenCalled();
    });
    const sent = updateConnection.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('apiKey' in sent).toBe(false);
  });

  it('sends the key when one was typed', async () => {
    listConnections.mockResolvedValue({ connections: [connection({ hasKey: true })] });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.type(screen.getByLabelText('Key'), 'sk-rotated');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateConnection).toHaveBeenCalled();
    });
    expect(updateConnection.mock.calls[0]?.[1]).toMatchObject({ apiKey: 'sk-rotated' });
  });

  /** The box is masked, and it is not a `Field`, so it has no assist slot. */
  it('is a password box', async () => {
    renderSurface();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));

    expect(screen.getByLabelText('Key').getAttribute('type')).toBe('password');
  });
});

describe('the stale check', () => {
  /**
   * **An edit presents the hash it read; a create has nothing to present** —
   * [P2B §6]. The writer this defends against is a text editor, not a second
   * admin: `connections/` is hand-editable by design.
   */
  it('travels on an edit', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateConnection).toHaveBeenCalled();
    });
    expect(updateConnection.mock.calls[0]?.[1]).toMatchObject({
      contentHash: 'sha256:as-the-page-read-it',
    });
  });

  /**
   * **Weaker than the one above, and worth saying so.**
   *
   * Two things stop a hash reaching a create: the form has none to send, since
   * there is no connection to have read one from; and `useSaveConnection`
   * strips it anyway. Mutating either alone leaves this green — so what it pins
   * is the end-to-end fact (*no create request carries a hash*) rather than
   * which layer enforces it. That is the fact that matters, and claiming more
   * would be claiming what the test cannot distinguish.
   */
  it('does not travel on a create, because there is nothing to be stale against', async () => {
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));
    await userEvent.type(screen.getByLabelText('Name'), 'A new one');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createConnection).toHaveBeenCalled();
    });
    expect(updateConnection).not.toHaveBeenCalled();
    expect('contentHash' in (createConnection.mock.calls[0]?.[0] as object)).toBe(false);
  });
});

describe('asking an endpoint for its models', () => {
  /**
   * **A refused key gets its own sentence** — finding 5 in
   * [P2C log](../../../../docs/design/workplan/14-p2c-log.md). Both failures used
   * to read *did not answer with a model list*, which sends an admin to the
   * URL and the network — and the one case where that is exactly wrong is the
   * endpoint answering perfectly well that the key is bad.
   */
  it('says a refused key was refused, not that the endpoint is gone', async () => {
    const { ApiError } = await import('../api.js');
    listConnections.mockResolvedValue({ connections: [connection()] });
    fetchModels.mockRejectedValueOnce(
      new ApiError(401, 'unauthorized', 'That endpoint refused the key.'),
    );
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ask the endpoint what it offers' }));

    expect(await screen.findByText(/refused the key/)).toBeTruthy();
  });

  it('still reads as unreachable when the endpoint really is', async () => {
    const { ApiError } = await import('../api.js');
    listConnections.mockResolvedValue({ connections: [connection()] });
    fetchModels.mockRejectedValueOnce(
      new ApiError(502, 'unreachable', 'That endpoint could not be reached.'),
    );
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ask the endpoint what it offers' }));

    expect(await screen.findByText(/did not answer with a model list/)).toBeTruthy();
  });
});

describe('a 412 on a connection', () => {
  /**
   * **Both ways out, and the acknowledgement stays set for both** — the shape
   * the config form arrived at only after P2A's gate found that a 412 offering
   * one recovery is a wedge rather than a refusal.
   */
  it('offers what is on disk as well as overwriting with mine', async () => {
    const { ApiError } = await import('../api.js');
    listConnections.mockResolvedValue({ connections: [connection()] });
    updateConnection.mockRejectedValueOnce(
      new ApiError(
        412,
        'stale',
        'That connection has changed on disk.',
        connection({ label: 'Changed on disk', contentHash: 'sha256:what-is-there-now' }),
        'sha256:what-is-there-now',
      ),
    );
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Load what is on disk' })).toBeTruthy();

    // Overwriting presents the hash the refusal handed back, which is the form
    // saying *I have seen what is there*. Without it the next save is refused
    // again and the form is stuck — the exact wedge P2A shipped and fixed.
    await userEvent.click(screen.getByRole('button', { name: 'Overwrite with mine' }));

    await waitFor(() => {
      expect(updateConnection.mock.calls.length).toBe(2);
    });
    expect(updateConnection.mock.calls[1]?.[1]).toMatchObject({
      contentHash: 'sha256:what-is-there-now',
      label: 'The house key',
    });
  });

  it('loads what is on disk into the form when asked', async () => {
    const { ApiError } = await import('../api.js');
    listConnections.mockResolvedValue({ connections: [connection()] });
    updateConnection.mockRejectedValueOnce(
      new ApiError(
        412,
        'stale',
        'That connection has changed on disk.',
        connection({ label: 'Changed on disk', contentHash: 'sha256:what-is-there-now' }),
        'sha256:what-is-there-now',
      ),
    );
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Load what is on disk' }));

    expect(screen.getByLabelText('Name').getAttribute('value')).toBe('Changed on disk');
  });
});

/**
 * ***After a refusal, and before a choice*** (2026-09-27). Save sent the
 * refusal's hash as soon as there was one, so pressing it again overwrote the
 * file on disk with no offer taken; and *Load what is on disk* loaded three of
 * the fields, so the next save put back the disk's capabilities and picture
 * models from the page as it loaded.
 */
describe('a 412 on a connection, before either offer is taken', () => {
  async function refuse(onDisk: Record<string, unknown>): Promise<void> {
    const { ApiError } = await import('../api.js');
    listConnections.mockResolvedValue({ connections: [connection()] });
    updateConnection.mockRejectedValueOnce(
      new ApiError(
        412,
        'stale',
        'That connection has changed on disk.',
        connection({ contentHash: 'sha256:what-is-there-now', ...onDisk }),
        'sha256:what-is-there-now',
      ),
    );
    renderSurface();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
  }

  it('sends the hash it was opened with, so a plain Save is refused again', async () => {
    await refuse({ label: 'Changed on disk' });

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateConnection.mock.calls.length).toBe(2);
    });
    expect(updateConnection.mock.calls[1]?.[1]).toMatchObject({
      contentHash: 'sha256:as-the-page-read-it',
    });
  });

  it('loads every field from disk, and saves them with the hash it acknowledged', async () => {
    await refuse({
      label: 'Changed on disk',
      // The third is one this form has no control for, written by hand: the save
      // merges over the record it last read, so it has to arrive intact.
      capabilities: { maxContextTokens: 32768, reportsUsage: true, supportsStructuredOutput: true },
      imageModels: ['gpt-hi'],
    });

    await userEvent.click(screen.getByRole('button', { name: 'Load what is on disk' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateConnection.mock.calls.length).toBe(2);
    });
    expect(updateConnection.mock.calls[1]?.[1]).toMatchObject({
      label: 'Changed on disk',
      contentHash: 'sha256:what-is-there-now',
      capabilities: { maxContextTokens: 32768, reportsUsage: true, supportsStructuredOutput: true },
      imageModels: ['gpt-hi'],
    });
  });
});

describe('a duplicated id', () => {
  /**
   * **Both are listed and nothing is blocked** — [P1 §1.2]'s posture — but the
   * one that loses says so, or an admin edits the copy nothing resolves to and
   * watches their change do nothing.
   */
  it('says which copy nothing will ever resolve to', async () => {
    listConnections.mockResolvedValue({
      connections: [
        connection({ label: 'A first by label' }),
        connection({ label: 'Z last by label', shadowed: true }),
      ],
    });
    renderSurface();

    expect(
      await screen.findByText(
        "Another connection file on disk already uses this id, so nothing will ever resolve to this one. Delete this copy's file by hand: removing the connection here removes every file with this id, including the one in use.",
      ),
    ).toBeTruthy();
    // One warning, not two — the winner is not warned about.
    expect(screen.getAllByText(/Another connection file on disk already uses this id/).length).toBe(
      1,
    );
  });

  /**
   * ***The copy that loses has no controls*** (2026-09-27).
   *
   * Both buttons act on the id, and the id reaches the other file: Edit saves
   * over whichever copy resolution picks, and Remove unlinks every file that
   * claims it. Offered on the dead copy, Remove was the way an admin tidying a
   * hand edit deleted the key everything was using.
   */
  it('offers Edit and Remove on the copy in use, and on nothing else', async () => {
    listConnections.mockResolvedValue({
      connections: [
        connection({ label: 'A first by label' }),
        connection({ label: 'Z last by label', shadowed: true }),
      ],
    });
    renderSurface();

    expect(await screen.findByRole('button', { name: 'Remove A first by label…' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Z last by label…' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBe(1);
  });

  /**
   * **And removing the one in use says what else goes.** The server unlinks
   * every claimant — right for a leaked key, which must not survive in a
   * second file — so the dialog says it before the button is pressed.
   */
  it('says, before removing, that the other file with this id goes too', async () => {
    listConnections.mockResolvedValue({
      connections: [
        connection({ label: 'A first by label' }),
        connection({ label: 'Z last by label', shadowed: true }),
        connection({ id: 'elsewhere', label: 'Somewhere else' }),
      ],
    });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Remove A first by label…' }));
    expect(
      screen.getByText('Another file on disk claims this id as well, and it is removed too.'),
    ).toBeTruthy();

    // Not said of a connection whose id nothing else claims.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Somewhere else…' }));
    expect(await screen.findByRole('heading', { name: 'Remove Somewhere else?' })).toBeTruthy();
    expect(
      screen.queryByText('Another file on disk claims this id as well, and it is removed too.'),
    ).toBeNull();
  });

  /**
   * **Counted by id, not by which row object the dialog opened on.** A refetch
   * while it is open replaces a row whose file changed, and the new object for
   * the same one file is not a second file. Reddened by comparing rows by
   * identity.
   */
  it('does not count the same file twice when the list is read again underneath', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AdminConnections />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Remove The house key…' }));

    // Edited on disk meanwhile: the key taken out, which the row says, so the
    // refetch can be seen to have landed before anything is concluded.
    listConnections.mockResolvedValue({
      connections: [connection({ hasKey: false, contentHash: 'sha256:edited-on-disk-meanwhile' })],
    });
    await act(() => client.invalidateQueries());
    expect(
      await screen.findByText(
        'No key is stored, so this must be an endpoint that does not need one.',
      ),
    ).toBeTruthy();

    expect(screen.getByRole('heading', { name: 'Remove The house key?' })).toBeTruthy();
    expect(
      screen.queryByText('Another file on disk claims this id as well, and it is removed too.'),
    ).toBeNull();
  });
});

describe('the role table', () => {
  /**
   * **Three states, not two** — the distinction the resolution cannot supply
   * and the surface would otherwise flatten. `image` unbound on a fresh install
   * is policy working; `prose` unbound is an install nobody can play on.
   */
  it('tells unset by design apart from nothing is set for this', async () => {
    readRoles.mockResolvedValue({
      roles: [
        role({ role: 'prose', tier: 'hi', ok: false, reason: 'unbound' }),
        role({ role: 'image', tier: 'unset', ok: false, reason: 'unbound' }),
      ],
    });
    renderSurface();

    expect(
      await screen.findByText('Nothing is set for this, so anything that needs it will fail.'),
    ).toBeTruthy();
    expect(screen.getByText('Nothing can do this yet, and nothing needs to.')).toBeTruthy();
  });

  it('names the connection and the layer that won', async () => {
    readRoles.mockResolvedValue({
      roles: [
        role({
          role: 'prose',
          tier: 'hi',
          ok: true,
          via: 'default',
          connectionId: 'house',
          connectionLabel: 'The house key',
          modelId: 'gpt-hi',
        }),
      ],
    });
    renderSurface();

    expect(await screen.findByText('gpt-hi')).toBeTruthy();
    expect(screen.getByText("This install's default, on The house key")).toBeTruthy();
  });

  it('says what to do about a connection that was removed under a binding', async () => {
    readRoles.mockResolvedValue({
      roles: [role({ role: 'prose', tier: 'hi', ok: false, reason: 'dangling' })],
    });
    renderSurface();

    // Not the same sentence as unbound: the remedies differ, so the answers do
    // ([00 §3.3]).
    expect(
      await screen.findByText(
        'The connection this was set to has been removed. Set it to another one.',
      ),
    ).toBeTruthy();
  });
});

describe('the first-run offer', () => {
  /**
   * **After the save rather than instead of it** — [P2B §3] stage P2B.4. A
   * first connection is useless until something is bound to it, and asking
   * which model is the expensive one before there is a list of models to pick
   * from is asking a question nobody can answer.
   */
  it('appears when nothing is bound yet, and spreads two answers over the roles', async () => {
    readBindings.mockResolvedValue({ bindings: {}, contentHash: 'sha256:empty' });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));
    await userEvent.type(screen.getByLabelText('Name'), 'The house key');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Use this for everything?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Use these' }));

    await waitFor(() => {
      expect(writeDefaultBindings).toHaveBeenCalled();
    });
    // Two bindings, not eight: which role gets which is the server's policy
    // ([19 §5.1]), so a client that posted a whole document could put `prose`
    // on the cheap model without anybody having chosen that.
    expect(writeDefaultBindings.mock.calls[0]?.[0]).toEqual({
      hi: { connectionId: 'house', modelId: 'gpt-hi' },
      lo: { connectionId: 'house', modelId: 'gpt-lo' },
      contentHash: 'sha256:empty',
    });
  });

  /**
   * **And it does not re-ask.** The condition is the *bindings file*, not the
   * connection just saved — so a second connection on an install that already
   * has defaults goes straight back to the list, and so does a first
   * connection on an install whose `bindings.json` was written by hand.
   */
  it('stays away once something is bound', async () => {
    readBindings.mockResolvedValue({
      bindings: { prose: { connectionId: 'other', modelId: 'gpt-hi' } },
      contentHash: 'sha256:already',
    });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));
    await userEvent.type(screen.getByLabelText('Name'), 'A second one');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createConnection).toHaveBeenCalled();
    });
    expect(screen.queryByText('Use this for everything?')).toBeNull();
  });
});

describe('removing a connection', () => {
  /**
   * **Warns and proceeds** — [P2B §2.8]. The case is an admin revoking a leaked
   * key, and being blocked by the fact that people were using it is the wrong
   * answer at the worst moment. So the count is read *before* confirming.
   */
  it('says how many roles point at it before the confirm', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    connectionBindings.mockResolvedValue({ bindings: 2 });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Remove The house key…' }));

    expect(
      await screen.findByText(
        '2 roles point at this connection. They will fall back to the install default, or stop working if there is none.',
      ),
    ).toBeTruthy();
    // And it is still removable — the warning is not a gate.
    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    await waitFor(() => {
      expect(deleteConnection.mock.calls[0]?.[0]).toBe('house');
    });
  });

  it('says the singular sentence for one, as a whole sentence rather than a suffix', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    connectionBindings.mockResolvedValue({ bindings: 1 });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Remove The house key…' }));

    expect(
      await screen.findByText(
        '1 role points at this connection. It will fall back to the install default, or stop working if there is none.',
      ),
    ).toBeTruthy();
  });
});

/**
 * **The two capability overrides an operator has a reason to set** — §1.2's
 * remainder, and the last of it: the mechanism worked end to end and nothing
 * offered it. An audit found it by reading `routes/connections.ts`, which is
 * P2C.1's own stated signal — *every point at which you consulted the source
 * instead of the screen.*
 *
 * They are the two only the operator can know: a local model's real context
 * window, and whether the endpoint counts tokens. Everything else in the
 * capability table is a reasonable guess about a provider; these two are facts
 * about somebody's machine.
 */
describe('what an endpoint can do', () => {
  it('sends the window it was given, as a number', async () => {
    renderSurface();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));
    await userEvent.type(screen.getByRole('textbox', { name: /Name/ }), 'Local');
    await userEvent.type(screen.getByRole('textbox', { name: /Models/ }), 'qwen');

    await userEvent.click(screen.getByText('What this endpoint can do'));
    await userEvent.type(screen.getByRole('textbox', { name: /Context window/ }), '32768');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          capabilities: expect.objectContaining({ maxContextTokens: 32768 }),
        }),
      );
    });
  });

  /**
   * **The failure this file already had once, with the key.** A save that sent
   * only the fields the form knows about deleted a hand-written override for one
   * it does not — and `capabilities` is exactly where somebody writes an
   * override by hand, because until now there was no other way.
   */
  it('keeps an override it has no control for', async () => {
    listConnections.mockResolvedValue({
      connections: [connection({ capabilities: { maxContextTokens: 8192, supportsTools: true } })],
    });
    renderSurface();
    await userEvent.click(await screen.findByRole('button', { name: /Edit/ }));

    await userEvent.click(screen.getByText('What this endpoint can do'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateConnection).toHaveBeenCalled();
    });
    // The id travels as the first argument; the body is the second.
    const [, saved] = updateConnection.mock.calls[0] as [string, { capabilities: unknown }];
    // The one it has no control for survives, and the one it does is unchanged
    // because nothing was typed.
    expect(saved.capabilities).toEqual({ maxContextTokens: 8192, supportsTools: true });
  });

  it('clears the window when the box is emptied', async () => {
    listConnections.mockResolvedValue({
      connections: [connection({ capabilities: { maxContextTokens: 8192 } })],
    });
    renderSurface();
    await userEvent.click(await screen.findByRole('button', { name: /Edit/ }));

    await userEvent.click(screen.getByText('What this endpoint can do'));
    await userEvent.clear(screen.getByRole('textbox', { name: /Context window/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateConnection).toHaveBeenCalled();
    });
    const [, cleared] = updateConnection.mock.calls[0] as [string, { capabilities: unknown }];
    // Removed rather than set to zero — which is what *leave blank to use the
    // default* has to mean, and zero would be a real (wrong) window.
    expect(cleared.capabilities).toEqual({});
  });
});

/**
 * ***Makes pictures*** — [polish §25]. The flag [21 §3] says is set per
 * connection, and until this control a hand edit was the only place to set it.
 * It rides the same merge the other two overrides do, so what matters is the
 * same two things: it is sent when set, and setting it back to the default
 * removes it without touching anything written by hand.
 */
describe('whether an endpoint makes pictures', () => {
  it('sends it when it is set', async () => {
    renderSurface();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));
    await userEvent.type(screen.getByRole('textbox', { name: /Name/ }), 'Images');
    await userEvent.type(screen.getByRole('textbox', { name: /Models/ }), 'gpt-image');

    await userEvent.click(screen.getByText('What this endpoint can do'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Makes pictures' }), 'yes');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          capabilities: expect.objectContaining({ rendersImages: true }),
        }),
      );
    });
  });

  it('forgets it when set back to the default, and keeps the rest', async () => {
    listConnections.mockResolvedValue({
      connections: [connection({ capabilities: { rendersImages: true, supportsTools: true } })],
    });
    renderSurface();
    await userEvent.click(await screen.findByRole('button', { name: /Edit/ }));

    await userEvent.click(screen.getByText('What this endpoint can do'));
    const picker = screen.getByRole('combobox', { name: 'Makes pictures' });
    expect((picker as HTMLSelectElement).value).toBe('yes');
    await userEvent.selectOptions(picker, 'default');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateConnection).toHaveBeenCalled();
    });
    const [, saved] = updateConnection.mock.calls[0] as [string, { capabilities: unknown }];
    expect(saved.capabilities).toEqual({ supportsTools: true });
  });

  /**
   * ***Drawing is not seeing*** (merged 2026-10-03). [25 E15]'s per-model
   * *Models that can see pictures* reached this form while the branch was out,
   * and the two questions sit one control apart; answering *Makes pictures*
   * yes on a chat endpoint because a vision model is ticked is the mistake
   * [21 §3] says the flag exists to stop. So the control lives in a group of
   * its own, and the group is not the other one.
   */
  it('asks it under drawing pictures, apart from the models that see them', async () => {
    renderSurface();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));
    await userEvent.type(screen.getByRole('textbox', { name: /Models/ }), 'llava');
    await userEvent.click(screen.getByText('What this endpoint can do'));

    const drawing = screen.getByRole('group', { name: 'Drawing pictures' });
    expect(within(drawing).getByRole('combobox', { name: 'Makes pictures' })).toBeTruthy();
    const seeing = screen.getByRole('group', { name: 'Models that can see pictures' });
    expect(within(seeing).queryByRole('combobox', { name: 'Makes pictures' })).toBeNull();
  });
});

/**
 * ***Sends a seed with a picture*** — owed since the youthful-keller merge
 * (2026-10-03), which made the seed travel only where `supportsImageSeed` says
 * so and left the flag a hand edit; work plan §2.3 counts that as configuration
 * without a surface. It sits beside *Makes pictures*, and only once that says
 * yes, so what is worth holding is the same merge as the other overrides plus
 * the one thing hiding could break: a value written by hand that the form
 * never showed.
 */
describe('whether an endpoint takes a seed with a picture', () => {
  it('is offered only once the connection makes pictures, and sent when set', async () => {
    renderSurface();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));
    await userEvent.type(screen.getByRole('textbox', { name: /Name/ }), 'Images');
    await userEvent.type(screen.getByRole('textbox', { name: /Models/ }), 'gpt-image');
    await userEvent.click(screen.getByText('What this endpoint can do'));

    expect(screen.queryByRole('combobox', { name: 'Sends a seed with a picture' })).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Makes pictures' }), 'yes');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Sends a seed with a picture' }),
      'yes',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createConnection).toHaveBeenCalled();
    });
    expect(createConnection.mock.calls[0]?.[0]).toMatchObject({
      capabilities: { rendersImages: true, supportsImageSeed: true },
    });
  });

  it('forgets it when set back to the default, and keeps the rest', async () => {
    listConnections.mockResolvedValue({
      connections: [
        connection({
          capabilities: { rendersImages: true, supportsImageSeed: true, supportsTools: true },
        }),
      ],
    });
    renderSurface();
    await userEvent.click(await screen.findByRole('button', { name: /Edit/ }));
    await userEvent.click(screen.getByText('What this endpoint can do'));

    const picker = screen.getByRole('combobox', { name: 'Sends a seed with a picture' });
    expect((picker as HTMLSelectElement).value).toBe('yes');
    await userEvent.selectOptions(picker, 'default');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateConnection).toHaveBeenCalled();
    });
    const [, saved] = updateConnection.mock.calls[0] as [string, { capabilities: unknown }];
    expect(saved.capabilities).toEqual({ rendersImages: true, supportsTools: true });
  });

  it('keeps a seed written by hand through a save that never showed it', async () => {
    listConnections.mockResolvedValue({
      connections: [connection({ capabilities: { supportsImageSeed: true } })],
    });
    renderSurface();
    await userEvent.click(await screen.findByRole('button', { name: /Edit/ }));
    await userEvent.click(screen.getByText('What this endpoint can do'));

    expect(screen.queryByRole('combobox', { name: 'Sends a seed with a picture' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateConnection).toHaveBeenCalled();
    });
    const [, saved] = updateConnection.mock.calls[0] as [string, { capabilities: unknown }];
    expect(saved.capabilities).toEqual({ supportsImageSeed: true });
  });

  /**
   * ***Load what is on disk* loads the two picture overrides too.** The handler
   * was written before the form held them, and a field it does not load is one
   * the next save puts back from the page as it was opened — here, deleting
   * both from a file that had them, because the page read none.
   */
  it('loads both picture overrides from disk after a refusal, so the save keeps them', async () => {
    const { ApiError } = await import('../api.js');
    listConnections.mockResolvedValue({ connections: [connection()] });
    updateConnection.mockRejectedValueOnce(
      new ApiError(
        412,
        'stale',
        'That connection has changed on disk.',
        connection({
          contentHash: 'sha256:what-is-there-now',
          capabilities: { rendersImages: true, supportsImageSeed: true },
        }),
        'sha256:what-is-there-now',
      ),
    );
    renderSurface();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Load what is on disk' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateConnection.mock.calls.length).toBe(2);
    });
    expect(updateConnection.mock.calls[1]?.[1]).toMatchObject({
      contentHash: 'sha256:what-is-there-now',
      capabilities: { rendersImages: true, supportsImageSeed: true },
    });
  });
});

/**
 * **Trying a saved connection** — [polish §25].
 *
 * The claims worth a test are the ones a person would act on wrongly if they
 * broke: it tries what is saved (the id, never a key), it offers a picture only
 * where the connection says it can make one, an empty reply cut off at the
 * limit reads as a working connection, and a refused key says *key*.
 */
describe('trying a saved connection', () => {
  async function openTest(): Promise<void> {
    renderSurface();
    await userEvent.click(await screen.findByRole('button', { name: 'Test' }));
  }

  it('tries what is saved, with the first model and the offered prompt', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    await openTest();

    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }));

    await waitFor(() => {
      expect(testConnection).toHaveBeenCalledWith('house', {
        kind: 'text',
        modelId: 'gpt-hi',
        prompt: 'Say hello in one short sentence.',
      });
    });
    expect(await screen.findByText('Hello there.')).toBeTruthy();
    expect(screen.getByText('That used 12 tokens of prompt and 3 of reply.')).toBeTruthy();
    // Nothing a key could travel in: the id and three fields, and no more.
    const [, sent] = testConnection.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(sent).sort()).toEqual(['kind', 'modelId', 'prompt']);
  });

  it('asks the model picked and the words typed', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    await openTest();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'gpt-lo');
    const message = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.clear(message);
    await userEvent.type(message, 'Write one line about rain.');
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }));

    await waitFor(() => {
      expect(testConnection).toHaveBeenCalledWith('house', {
        kind: 'text',
        modelId: 'gpt-lo',
        prompt: 'Write one line about rain.',
      });
    });
  });

  it('offers a picture only on a connection that says it makes them', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    await openTest();
    expect(screen.queryByRole('combobox', { name: 'Ask for' })).toBeNull();
  });

  it('shows the picture a picture test made', async () => {
    listConnections.mockResolvedValue({
      connections: [connection({ capabilities: { rendersImages: true } })],
    });
    testConnection.mockResolvedValue({
      kind: 'image',
      mime: 'image/png',
      base64: 'AQID',
      modelId: 'gpt-hi',
      seed: 7,
      cost: null,
      elapsedMs: 14_300,
    });
    await openTest();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Ask for' }), 'image');
    await userEvent.click(screen.getByRole('button', { name: 'Try a picture' }));

    await waitFor(() => {
      expect(testConnection).toHaveBeenCalledWith(
        'house',
        expect.objectContaining({ kind: 'image', modelId: 'gpt-hi' }),
      );
    });
    const picture: HTMLImageElement = await screen.findByRole('img');
    expect(picture.getAttribute('src')).toBe('data:image/png;base64,AQID');
  });

  it('takes a typed model when the connection lists none', async () => {
    listConnections.mockResolvedValue({ connections: [connection({ models: [] })] });
    await openTest();

    const button = screen.getByRole('button', { name: 'Send a test message' });
    // Nothing to ask with yet, so nothing to press.
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: /Model/ }), 'qwen3:8b');
    await userEvent.click(button);

    await waitFor(() => {
      expect(testConnection).toHaveBeenCalledWith(
        'house',
        expect.objectContaining({ modelId: 'qwen3:8b' }),
      );
    });
  });

  it('says a refused key was refused', async () => {
    const { ApiError } = await import('../api.js');
    listConnections.mockResolvedValue({ connections: [connection()] });
    testConnection.mockRejectedValue(
      new ApiError(401, 'unauthorized', 'That endpoint refused the key.'),
    );
    await openTest();

    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/refused the key/);
  });

  it('says a prompt too long to send was too long, rather than blaming the endpoint', async () => {
    const { ApiError } = await import('../api.js');
    listConnections.mockResolvedValue({ connections: [connection()] });
    testConnection.mockRejectedValue(new ApiError(400, 'invalid', 'body/prompt must be shorter'));
    await openTest();

    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/shorter message/);
  });

  /**
   * ***A window too small to hold a test*** — the one refusal the message earned
   * by going through `performCall` (2026-10-03). The field to fix is on this
   * connection, and the sentence has to send a person there rather than to the
   * endpoint, which was never asked.
   */
  it('sends a person to the context window when it cannot hold a test', async () => {
    const { ApiError } = await import('../api.js');
    listConnections.mockResolvedValue({ connections: [connection()] });
    testConnection.mockRejectedValue(
      new ApiError(422, 'window-too-small', 'This connection’s context window is 100 tokens.'),
    );
    await openTest();

    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/check Context window/);
  });

  /**
   * ***A picture the server says this connection cannot make*** means the page
   * is stale (2026-10-03). The sentence the branch wrote sent a person to save
   * the connection so the server would pick up a hand edit — a remedy for the
   * memo keyed by id that 8dc8e587 replaced on 2026-09-27, after which a hand
   * edit is in force at the next call, and a save from a stale row only meets
   * `412 stale`. So the sentence has to send a person to reload, and must not
   * still send them to save.
   */
  it('sends a person to reload when the server no longer reads the connection as making pictures', async () => {
    const { ApiError } = await import('../api.js');
    listConnections.mockResolvedValue({
      connections: [connection({ capabilities: { rendersImages: true } })],
    });
    testConnection.mockRejectedValue(
      new ApiError(422, 'not-an-image-endpoint', 'This connection does not say it makes pictures.'),
    );
    await openTest();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Ask for' }), 'image');
    await userEvent.click(screen.getByRole('button', { name: 'Try a picture' }));

    const said = (await screen.findByRole('alert')).textContent;
    expect(said).toMatch(/Reload the page/);
    expect(said).not.toMatch(/save it once/);
  });

  /**
   * ***The one answer that most needs a sentence.*** A model that thinks before
   * it answers spends the test's small allowance where nobody sees it, and what
   * comes back — no text, stopped by length — is the exact shape of a broken
   * endpoint unless something says otherwise.
   */
  it('calls an empty reply cut off at the limit a working connection', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    testConnection.mockResolvedValue({
      kind: 'text',
      text: '',
      modelId: 'gpt-hi',
      finishReason: 'length',
      usage: { promptTokens: 12, completionTokens: 256 },
      cost: null,
      elapsedMs: 4_000,
    });
    await openTest();

    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }));

    expect(await screen.findByText(/The key, the address and the model all worked/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when a different model answered than the one asked for', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    testConnection.mockResolvedValue({
      kind: 'text',
      text: 'Hi.',
      modelId: 'gpt-hi-2026-09-01',
      finishReason: 'stop',
      usage: null,
      cost: null,
      elapsedMs: 300,
    });
    await openTest();

    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }));

    expect(
      await screen.findByText(
        'You asked for gpt-hi; the endpoint says gpt-hi-2026-09-01 answered.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('The endpoint did not say how many tokens that used.')).toBeTruthy();
  });

  it('cannot be pressed twice while it waits', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    testConnection.mockReturnValue(new Promise(() => undefined));
    await openTest();

    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }));

    const waiting = await screen.findByRole('button', { name: 'Waiting for the endpoint…' });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    expect(testConnection).toHaveBeenCalledTimes(1);
  });

  it('offers no test on a copy nothing resolves to', async () => {
    listConnections.mockResolvedValue({
      connections: [
        connection({ label: 'A first by label' }),
        connection({ label: 'Z last by label', shadowed: true, contentHash: 'sha256:other' }),
      ],
    });
    renderSurface();
    await screen.findByText('Z last by label');

    expect(screen.getAllByRole('button', { name: 'Test' })).toHaveLength(1);
  });
});

/**
 * **Binding a role to a second model** — [R2](../../../../docs/design/workplan/22-walkthrough-refinements.md)'s
 * real blocker, and the thing this surface told an admin to do without offering
 * a control that could.
 *
 * Every test here would have passed vacuously a day ago, because the only
 * binding writer in the client was the first-run offer and it hides itself for
 * good once anything is bound. The route and the hook both already existed.
 */
describe('the role editor', () => {
  /**
   * **One entry per endpoint-and-model pair.** The data model separates a
   * connection from a model, and pushing that separation onto the person
   * choosing *which model writes the story* makes them assemble the answer from
   * two controls. The pair is what they are picking, so it is what is listed.
   */
  it('offers one entry for each endpoint and model, across connections', async () => {
    listConnections.mockResolvedValue({
      connections: [
        connection(),
        connection({ id: 'local', label: 'The laptop', models: ['qwen'] }),
      ],
    });
    readRoles.mockResolvedValue({ roles: [role({ role: 'prose' })] });
    renderSurface();

    await rolePicker('Model for Writing the story');

    expect(screen.getByRole('option', { name: 'The house key · gpt-hi' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'The house key · gpt-lo' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'The laptop · qwen' })).toBeTruthy();
  });

  it('binds a role to a second model on the same endpoint', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    readBindings.mockResolvedValue({
      bindings: { prose: { connectionId: 'house', modelId: 'gpt-hi' } },
      contentHash: 'sha256:the-document',
    });
    readRoles.mockResolvedValue({ roles: [role({ role: 'prose' })] });
    renderSurface();

    const picker = await rolePicker('Model for Writing the story');
    await userEvent.selectOptions(
      picker,
      screen.getByRole('option', { name: 'The house key · gpt-lo' }),
    );

    await waitFor(() => {
      expect(writeBindings).toHaveBeenCalled();
    });
    expect(writeBindings.mock.calls[0]?.[0]).toEqual({
      prose: { connectionId: 'house', modelId: 'gpt-lo' },
    });
    // The hash it read, which is the whole of the guard.
    expect(writeBindings.mock.calls[0]?.[1]).toBe('sha256:the-document');
  });

  /**
   * **The whole document, or the other seven roles are deleted.**
   * `PUT /bindings` rewrites the file rather than patching it, so a write
   * carrying only the role that changed would silently unbind everything else —
   * and `image`, `video` and `speech` are the ones nobody would notice, because
   * they are usually unbound by policy anyway.
   */
  it('sends every role, not only the one that changed', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    readBindings.mockResolvedValue({
      bindings: {
        prose: { connectionId: 'house', modelId: 'gpt-hi' },
        image: { connectionId: 'house', modelId: 'painter' },
      },
      contentHash: 'sha256:the-document',
    });
    readRoles.mockResolvedValue({ roles: [role({ role: 'prose' })] });
    renderSurface();

    const picker = await rolePicker('Model for Writing the story');
    await userEvent.selectOptions(
      picker,
      screen.getByRole('option', { name: 'The house key · gpt-lo' }),
    );

    await waitFor(() => {
      expect(writeBindings).toHaveBeenCalled();
    });
    expect(writeBindings.mock.calls[0]?.[0]).toEqual({
      prose: { connectionId: 'house', modelId: 'gpt-lo' },
      image: { connectionId: 'house', modelId: 'painter' },
    });
  });

  it('unbinds a role, by removing it rather than by writing an empty binding', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    readBindings.mockResolvedValue({
      bindings: {
        prose: { connectionId: 'house', modelId: 'gpt-hi' },
        fast: { connectionId: 'house', modelId: 'gpt-lo' },
      },
      contentHash: 'sha256:the-document',
    });
    readRoles.mockResolvedValue({ roles: [role({ role: 'prose' })] });
    renderSurface();

    const picker = await rolePicker('Model for Writing the story');
    await userEvent.selectOptions(picker, screen.getByRole('option', { name: 'Nothing' }));

    await waitFor(() => {
      expect(writeBindings).toHaveBeenCalled();
    });
    expect(writeBindings.mock.calls[0]?.[0]).toEqual({
      fast: { connectionId: 'house', modelId: 'gpt-lo' },
    });
  });

  /**
   * **A binding can name a model nothing offers**, and the control has to be
   * able to say so. With no option to match it, a `<select>` displays its first
   * entry — so the picker would claim the role is bound to whatever sorts first,
   * in the one row where being wrong matters most.
   */
  it('says when a binding names a model no connection offers any more', async () => {
    listConnections.mockResolvedValue({ connections: [connection()] });
    readBindings.mockResolvedValue({
      bindings: { prose: { connectionId: 'house', modelId: 'retired' } },
      contentHash: 'sha256:the-document',
    });
    readRoles.mockResolvedValue({ roles: [role({ role: 'prose', reason: 'dangling' })] });
    renderSurface();

    const picker = await rolePicker('Model for Writing the story');

    expect(
      screen.getByRole('option', { name: 'retired — no connection offers this any more' }),
    ).toBeTruthy();
    expect(picker.value).toBe('missing');
  });
});

/**
 * **The bindings 412** — and the reason this file can test it at all is that the
 * refusal started carrying a hash on 2026-09-11. Without one, *apply mine* has
 * nothing to present and can only re-send the hash it was just refused for,
 * which is a wedge rather than a refusal.
 */
describe('a 412 on the bindings document', () => {
  it('applies the one change onto what is on disk, rather than overwriting it', async () => {
    const { ApiError } = await import('../api.js');
    listConnections.mockResolvedValue({ connections: [connection()] });
    readBindings.mockResolvedValue({
      bindings: { prose: { connectionId: 'house', modelId: 'gpt-hi' } },
      contentHash: 'sha256:what-this-page-read',
    });
    readRoles.mockResolvedValue({ roles: [role({ role: 'prose' })] });
    writeBindings.mockRejectedValueOnce(
      new ApiError(
        412,
        'stale',
        'The bindings file has changed since this page read it.',
        // Somebody else bound a role this admin never touched.
        { fast: { connectionId: 'house', modelId: 'gpt-lo' } },
        'sha256:what-is-there-now',
      ),
    );
    renderSurface();

    const picker = await rolePicker('Model for Writing the story');
    await userEvent.selectOptions(
      picker,
      screen.getByRole('option', { name: 'The house key · gpt-lo' }),
    );

    await screen.findByRole('alert');
    await userEvent.click(
      screen.getByRole('button', { name: 'Apply my change to what is on disk' }),
    );

    await waitFor(() => {
      expect(writeBindings.mock.calls.length).toBe(2);
    });
    /**
     * **The retry keeps the other person's work.** The unit of edit here is one
     * role, so re-sending this page's whole document would revert `fast` — a
     * role this admin never opened. The connection form's *overwrite with mine*
     * is right for a whole connection and wrong for this.
     */
    expect(writeBindings.mock.calls[1]?.[0]).toEqual({
      fast: { connectionId: 'house', modelId: 'gpt-lo' },
      prose: { connectionId: 'house', modelId: 'gpt-lo' },
    });
    expect(writeBindings.mock.calls[1]?.[1]).toBe('sha256:what-is-there-now');
  });
});

/**
 * **Provisioning what an endpoint offers** — the half of R2 that is about
 * setting a provider up rather than about using it: *add a provider, ask it what
 * it serves, take all of them or a subset*.
 */
describe('what the endpoint offers', () => {
  it('provisions a subset of what the endpoint listed', async () => {
    fetchModels.mockResolvedValue({ models: ['gpt-hi', 'gpt-lo', 'gpt-vision'] });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));
    await userEvent.type(screen.getByLabelText('Name'), 'The house key');
    await userEvent.click(screen.getByRole('button', { name: 'Ask the endpoint what it offers' }));

    expect(
      await screen.findByText(
        'This endpoint offers 3 models. Tick the ones this install should use.',
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('checkbox', { name: 'gpt-hi' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'gpt-vision' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createConnection).toHaveBeenCalled();
    });
    expect(createConnection.mock.calls[0]?.[0]).toMatchObject({
      models: ['gpt-hi', 'gpt-vision'],
    });
  });

  it('takes all of them in one gesture', async () => {
    fetchModels.mockResolvedValue({ models: ['gpt-hi', 'gpt-lo', 'gpt-vision'] });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));
    await userEvent.type(screen.getByLabelText('Name'), 'The house key');
    await userEvent.click(screen.getByRole('button', { name: 'Ask the endpoint what it offers' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Use all of them' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createConnection).toHaveBeenCalled();
    });
    expect(createConnection.mock.calls[0]?.[0]).toMatchObject({
      models: ['gpt-hi', 'gpt-lo', 'gpt-vision'],
    });
  });

  /**
   * **Unticking removes it, including one the admin typed by hand.** The field
   * stays the value ([P2B §2.6] keeps it free text), so the checkboxes have to
   * read from it rather than keep a second list — or the two drift and the saved
   * models are whichever one the save happened to consult.
   */
  it('reads its ticks from the field, so a typed model can be unticked', async () => {
    fetchModels.mockResolvedValue({ models: ['gpt-hi'] });
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));
    await userEvent.type(screen.getByLabelText('Name'), 'The house key');
    await userEvent.type(screen.getByRole('textbox', { name: /Models/ }), 'gpt-hi');
    await userEvent.click(screen.getByRole('button', { name: 'Ask the endpoint what it offers' }));

    const tick: HTMLInputElement = await screen.findByRole('checkbox', { name: 'gpt-hi' });
    expect(tick.checked).toBe(true);

    await userEvent.click(tick);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createConnection).toHaveBeenCalled();
    });
    expect(createConnection.mock.calls[0]?.[0]).toMatchObject({ models: [] });
  });
});

/**
 * ***Which models see pictures, per model*** — [25 E15]. One endpoint
 * routinely serves a model that sees and one that does not, and a picture sent
 * to the second is refused — so the form asks per model, starts with none, and
 * saves only models the connection still lists.
 */
describe('models that can see pictures', () => {
  it('saves the models ticked as seeing pictures, and only those still listed', async () => {
    renderSurface();

    await userEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));
    await userEvent.type(screen.getByLabelText('Name'), 'The house key');
    await userEvent.type(screen.getByRole('textbox', { name: /Models/ }), 'llava, llama3');
    await userEvent.click(screen.getByText('What this endpoint can do', { selector: 'summary' }));

    const sees: HTMLInputElement = await screen.findByRole('checkbox', {
      name: 'llava can see pictures',
    });
    expect(sees.checked).toBe(false);
    await userEvent.click(sees);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createConnection).toHaveBeenCalled();
    });
    expect(createConnection.mock.calls[0]?.[0]).toMatchObject({
      models: ['llava', 'llama3'],
      imageModels: ['llava'],
    });
  });
});
