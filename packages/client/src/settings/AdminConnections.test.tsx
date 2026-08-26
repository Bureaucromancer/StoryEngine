// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The connections surface — [05 §15.3](../../../../docs/design/05-ui-surfaces.md),
 * [P2B §3](../../../../docs/design/workplan/14-p2b-provider-configuration.md) stages P2B.3
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

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
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
    writeBindings: vi.fn(),
  },
}));

const { AdminConnections } = await import('./AdminConnections.js');

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
});

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
   * [16](../../../../docs/design/workplan/16-p2c-log.md). Both failures used
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
        'Another connection file on disk already uses this id, so nothing will ever resolve to this one. Remove one of them.',
      ),
    ).toBeTruthy();
    // One warning, not two — the winner is not warned about.
    expect(screen.getAllByText(/Another connection file on disk already uses this id/).length).toBe(
      1,
    );
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
    // ([07 §5.1]), so a client that posted a whole document could put `prose`
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
