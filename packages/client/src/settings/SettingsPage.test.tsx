// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The settings surface — [10 §15](../../../../docs/design/10-ui-surfaces.md),
 * [P2A §3](../../../../docs/design/workplan/09-p2a-configuration-surface.md) stage P2A.6.
 *
 * **Absent is implemented as absent**, and [P2A §2.6] calls that directly
 * testable — which is the whole reason it is a mechanism rather than a style
 * choice. The admin sections are not rendered for a non-admin, so their hooks
 * never mount, so that browser issues no request to `/api/admin/*` at all.
 *
 * The test for it is therefore about the *network*, not the DOM. Asserting only
 * that the heading is missing would pass just as well against a page that
 * fetched the account list, was told 403, and rendered nothing — which is the
 * version that puts an error in the console of somebody who has done nothing
 * wrong.
 */

const authState = vi.fn();
const readMe = vi.fn();
const listAccounts = vi.fn();
const readConfig = vi.fn();
const notices = vi.fn();
const writeConfig = vi.fn();
const listConnections = vi.fn();
const readBindings = vi.fn();
const readRoles = vi.fn();
const updateMe = vi.fn();
const changePassword = vi.fn();
const readPrefs = vi.fn();
const patchPrefs = vi.fn();
// The role-bindings pane ([P7.3]) renders for every account, so this page reads
// it on every render — mocked here only so this file keeps testing what it is
// about, the way the connections surface already is. `MyRoles.test.tsx` is the
// file about that pane.
const readMyRoles = vi.fn();
const setAccountPassword = vi.fn();

const listMyConnections = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  api: {
    authState: (...a: unknown[]) => authState(...a) as unknown,
    readMe: (...a: unknown[]) => readMe(...a) as unknown,
    updateMe: (...a: unknown[]) => updateMe(...a) as unknown,
    changePassword: (...a: unknown[]) => changePassword(...a) as unknown,
    readPrefs: (...a: unknown[]) => readPrefs(...a) as unknown,
    patchPrefs: (...a: unknown[]) => patchPrefs(...a) as unknown,
    readMyRoles: (...a: unknown[]) => readMyRoles(...a) as unknown,
    writeMyBindings: vi.fn(),
    // [P10.3]'s *your connections*. Mocked here for `listConnections`' reason —
    // so this file keeps testing what it is about — and it must not be left
    // out: an unmocked query rejects, `MyConnections` renders its `role=alert`,
    // and every `findByRole('alert')` on this page finds two.
    listMyConnections: (...a: unknown[]) => listMyConnections(...a) as unknown,
    createMyConnection: vi.fn(),
    updateMyConnection: vi.fn(),
    deleteMyConnection: vi.fn(),
    fetchMyModels: vi.fn(),
  },
  /**
   * ***The backup panels*** — [P12.6]. Mocked for `listMyConnections`' reason,
   * stated ten lines up and proved by this file failing without it: an unmocked
   * query rejects, `Backups` renders its `role=alert`, and every
   * `findByRole('alert')` on this page finds two.
   */
  backupApi: {
    readMine: () => Promise.resolve({ backups: [], totalBytes: 0 }),
    takeMine: vi.fn(),
    deleteMine: vi.fn(),
    readSettings: () =>
      Promise.resolve({ settings: { frequency: 'off', onStart: false, contents: 'full' } }),
    writeSettings: vi.fn(),
    readInstall: () => Promise.resolve({ backups: [], totalBytes: 0 }),
    takeInstall: vi.fn(),
    deleteInstall: vi.fn(),
  },
  adminApi: {
    listAccounts: (...a: unknown[]) => listAccounts(...a) as unknown,
    readConfig: (...a: unknown[]) => readConfig(...a) as unknown,
    notices: (...a: unknown[]) => notices(...a) as unknown,
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    removeAccount: vi.fn(),
    setAccountPassword: (...a: unknown[]) => setAccountPassword(...a) as unknown,
    writeConfig: (...a: unknown[]) => writeConfig(...a) as unknown,
    // P2B's third section. Mocked here only so this file keeps testing what it
    // is about — the connections surface has its own file beside this one.
    listConnections: (...a: unknown[]) => listConnections(...a) as unknown,
    readBindings: (...a: unknown[]) => readBindings(...a) as unknown,
    readRoles: (...a: unknown[]) => readRoles(...a) as unknown,
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    deleteConnection: vi.fn(),
    connectionBindings: vi.fn(),
    fetchModels: vi.fn(),
    writeBindings: vi.fn(),
    writeDefaultBindings: vi.fn(),
  },
}));

const { SettingsPage } = await import('./SettingsPage.js');

function account(role: 'admin' | 'user') {
  return {
    handle: 'ned',
    displayName: 'Ned',
    role,
    enabled: true,
    locale: null,
    capabilities: { privateConnections: true, fileAccess: 'none', enableExtensions: false },
    createdAt: 1786800000000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listMyConnections.mockResolvedValue({ connections: [] });
  readMe.mockResolvedValue({ account: account('user') });
  updateMe.mockResolvedValue({ account: account('user') });
  // The Preferences pane reads these on every render of this page. Empty is the
  // ordinary state: no preference set means every default.
  readPrefs.mockResolvedValue({ prefs: {} });
  patchPrefs.mockResolvedValue({ prefs: {} });
  listAccounts.mockResolvedValue({
    accounts: [{ ...account('admin'), hasUsableConnection: false }],
    withoutUsableConnection: 1,
    systemConnectionCount: 0,
  });
  readConfig.mockResolvedValue({
    config: {
      dataDir: './data',
      log: { level: 'info' },
      server: { host: '127.0.0.1', port: 8080 },
    },
    path: '/data/config.json',
    tiers: {
      dataDir: 'restart',
      'log.level': 'live',
      'server.host': 'restart',
      'server.port': 'restart',
    },
    appliers: { 'log.level': 'applied' },
    bounds: { 'server.port': { minimum: 1, maximum: 65_535 } },
    // The closed unions, which the form renders as pickers rather than as text.
    choices: { 'log.level': ['silent', 'error', 'warn', 'info', 'debug'] },
    pendingRestart: [],
  });
  notices.mockResolvedValue({ pendingRestart: [], canRestart: false });
  listConnections.mockResolvedValue({ connections: [] });
  readBindings.mockResolvedValue({ bindings: {}, contentHash: 'sha256:empty' });
  readRoles.mockResolvedValue({ roles: [] });
  readMyRoles.mockResolvedValue({
    roles: [],
    bindings: {},
    contentHash: 'sha256:empty',
    connections: [],
    disabled: [],
  });
});

const ALPHA = { version: '1.0.0-alpha.2', commit: '7573e8a0' };

function renderPage(
  role: 'admin' | 'user',
  minPasswordLength = 8,
  build: { version: string; commit: string } | null = ALPHA,
) {
  authState.mockResolvedValue({
    setupRequired: false,
    account: account(role),
    minPasswordLength,
    build,
  });
  readMe.mockResolvedValue({ account: account(role) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

describe('for a non-admin', () => {
  it('does not render the administration half', async () => {
    renderPage('user');
    await screen.findByText('You');

    expect(screen.queryByRole('heading', { name: 'Administration' })).toBeNull();
  });

  /**
   * **The mechanism, not the symptom.** This is what separates *absent* from
   * *disabled*: a disabled control still mounts its hook, still fetches, and
   * still gets refused.
   */
  it('asks the admin API for nothing at all', async () => {
    renderPage('user');
    await screen.findByText('You');
    // Their own profile did load, so the page is working rather than empty.
    expect(await screen.findByDisplayValue('Ned')).toBeTruthy();

    expect(listAccounts).not.toHaveBeenCalled();
    expect(readConfig).not.toHaveBeenCalled();
    // And P2B's section is inside the same conditional, which is the point of
    // there being one conditional rather than one per section.
    expect(listConnections).not.toHaveBeenCalled();
    expect(readRoles).not.toHaveBeenCalled();
    // And the build on the page came from the auth state, not from the admin
    // notices route — the one way a version for everyone could have broken
    // this claim.
    expect(notices).not.toHaveBeenCalled();
  });
});

describe('for an admin', () => {
  it('renders both halves and asks for both', async () => {
    renderPage('admin');

    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeTruthy();
    await waitFor(() => {
      expect(listAccounts).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(readConfig).toHaveBeenCalled();
    });
  });
});

/**
 * The About block — [P6A §1.5], alpha.2: the version, prominently, for every
 * account. It reads `auth/state` rather than the admin route, which is what
 * keeps the non-admin's *asks for nothing* claim above true with a version on
 * the page.
 */
describe('the build', () => {
  it('is named first, for a user, with the string and the commit beneath', async () => {
    renderPage('user');

    expect(await screen.findByRole('heading', { name: 'StoryEngine 1.0-alpha 2' })).toBeTruthy();
    expect(screen.getByText('1.0.0-alpha.2')).toBeTruthy();
    expect(screen.getByText(ALPHA.commit)).toBeTruthy();
    // First after the page title: prominence was the ask.
    const headings = screen.getAllByRole('heading');
    expect(headings[0]?.textContent).toBe('Settings');
    expect(headings[1]?.textContent).toBe('StoryEngine 1.0-alpha 2');
  });

  it('says so when nothing identified the build', async () => {
    renderPage('user', 8, null);

    expect(
      await screen.findByRole('heading', { name: 'StoryEngine development build' }),
    ).toBeTruthy();
    expect(screen.getByText(/Nothing identified this build/)).toBeTruthy();
    expect(screen.queryByText('1.0.0-alpha.2')).toBeNull();
  });
});

/**
 * **"1 person has no usable connection"** — [09 §4.5](../../../../docs/design/09-server-multiuser-deployment.md)
 * commissioned this sentence and named this screen as where it appears.
 *
 * It is the reason the phase exists in the shape it does: the surface earns its
 * place by reporting the dead-end state rather than leaving it to arrive as a
 * bug report from somebody who cannot send a message.
 */
describe('the dead-end warning', () => {
  it('says how many, and what fixes it', async () => {
    renderPage('admin');

    const warning = await screen.findByRole('status');
    expect(warning.textContent).toContain('1 person has no usable connection');
    // With no system connection at all, this is one fix rather than n — which
    // is the fact the second number exists to make obvious.
    expect(warning.textContent).toContain('adding one fixes this for everybody');
  });

  it('says it again on the row, so the count has something to point at', async () => {
    renderPage('admin');

    expect(
      await screen.findByText('No usable connection — this account cannot send a message.'),
    ).toBeTruthy();
  });

  it('says nothing when everybody can play', async () => {
    listAccounts.mockResolvedValue({
      accounts: [{ ...account('admin'), hasUsableConnection: true }],
      withoutUsableConnection: 0,
      systemConnectionCount: 1,
    });
    renderPage('admin');
    await screen.findByRole('heading', { name: 'Accounts' });

    // A warning that appears when there is nothing wrong is one people stop
    // reading.
    expect(screen.queryByText(/no usable connection/i)).toBeNull();
  });
});

/**
 * **In force now, and recorded for later** — [P2A §2.1].
 *
 * Two dishonest options were available and both are refused: inventing a partial
 * enforcement so a switch feels real, and rendering three switches as though
 * they were equally live. The grouping says the other half of the truth
 * [10 §15.2] asks for, which is *when*.
 */
describe('the capability groups', () => {
  it('separates the two that bite from the one that does not', async () => {
    renderPage('admin');

    const now = await screen.findByRole('group', { name: 'In force now' });
    const later = screen.getByRole('group', { name: 'Recorded for later' });

    expect(now.textContent).toContain('May use their own connections');
    expect(later.textContent).toContain('May enable extensions');
    // And the group says why once, rather than each switch apologising for
    // itself.
    expect(later.textContent).toContain('have not shipped');
  });

  it('puts file access in force, because the import sweep reads it', async () => {
    // The P4 audit's finding 7.2, as a test: this control sat in *Recorded for
    // later* for three weeks after `POST /api/import/sweep` began refusing on
    // `fileAccess: "none"`. A group whose legend promises nothing has shipped is
    // a claim about every control inside it.
    renderPage('admin');

    const now = await screen.findByRole('group', { name: 'In force now' });
    const later = screen.getByRole('group', { name: 'Recorded for later' });

    expect(now.textContent).toContain('Import from a folder on this machine');
    expect(later.textContent).not.toContain('Import from a folder');
  });

  it('says what the grant actually reaches, not what it used to', async () => {
    // [10 §4.2.2] widened this capability deliberately and bound the relabel to
    // ship with it. The old labels described a file browser over the user's own
    // directory; the grant is a server-side read of the host. The bar is the
    // design's own sentence rather than a softer paraphrase, so it is asserted.
    renderPage('admin');

    const now = await screen.findByRole('group', { name: 'In force now' });

    expect(now.textContent).toContain('outside the data directory');
    expect(now.textContent).toContain('would give a shell to');
    // The three labels must not describe a browser over their own files, which
    // is the sentence that was false.
    expect(now.textContent).not.toContain('No file browser');
  });

  it('writes the consequence beside the switch that has one', async () => {
    renderPage('admin');

    const now = await screen.findByRole('group', { name: 'In force now' });
    // [09 §4.5]'s *revoking disables, never deletes*, said where somebody is
    // about to do it rather than in documentation they will not read.
    expect(now.textContent).toContain('stay on disk');
  });
});

/**
 * **Removal says what it does before it does it** — [P2A §2.3], [03 §10.2].
 *
 * The trash's honesty obligation, one step further: an administrator about to
 * remove somebody should read what actually happens to their library *before*
 * clicking, not go looking for it afterwards.
 */
describe('removing an account', () => {
  it('names the folder, and says StoryEngine will not delete it', async () => {
    renderPage('admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove ned…' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('data/removed/');
    expect(dialog.textContent).toContain('StoryEngine will not delete it');
    expect(dialog.textContent).toContain('free to use again straight away');
  });

  /**
   * Typing the handle back is the confirmation, because a destructive control
   * whose confirmation is a second button is a control people click twice.
   */
  it('will not remove until the handle is typed back', async () => {
    renderPage('admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove ned…' }));

    const confirm = screen.getByRole('button', { name: 'Remove and move their data' });
    expect(confirm.hasAttribute('disabled')).toBe(true);

    await userEvent.type(screen.getByRole('textbox', { name: 'Type ned to confirm' }), 'ned');

    expect(confirm.hasAttribute('disabled')).toBe(false);
  });
});

/**
 * ***Restoring access to an account*** — [P7B.5].
 *
 * `POST /api/admin/accounts/:handle/password` shipped at P2A and nothing called
 * it until the route-caller check
 * ([`route-callers.test.ts`](../../../server/src/routes/route-callers.test.ts))
 * asked. **The sharp assertion is which handle it went to**, because these
 * controls are one per row and a component that read the wrong row's handle
 * would set the wrong person's password — a bug with no visible symptom on the
 * page that caused it, discovered by somebody who cannot sign in.
 */
describe('setting an account’s password', () => {
  beforeEach(() => {
    listAccounts.mockResolvedValue({
      accounts: [
        { ...account('admin'), hasUsableConnection: true },
        {
          ...account('user'),
          handle: 'vera',
          displayName: 'Vera',
          hasUsableConnection: true,
        },
      ],
      withoutUsableConnection: 0,
      systemConnectionCount: 1,
    });
    setAccountPassword.mockResolvedValue(undefined);
  });

  /** The row's own handle, not the first row's. */
  it('sends the typed password to the account whose row it is on', async () => {
    renderPage('admin');

    const row = (await screen.findByText('Vera')).closest('li');
    expect(row).not.toBeNull();
    const panel = within(row as HTMLElement);

    await userEvent.type(panel.getByRole('textbox', { name: /^New password/ }), 'a long password');
    await userEvent.click(panel.getByRole('button', { name: 'Set password' }));

    await waitFor(() => {
      expect(setAccountPassword).toHaveBeenCalledWith('vera', 'a long password');
    });
    expect(setAccountPassword).toHaveBeenCalledTimes(1);
  });

  /**
   * A blank box is refused here rather than sent. The create form's hint says a
   * blank field is a legal empty password, which is true of *making* an account
   * on an install with no minimum; setting one from a box somebody clicked past
   * is a different act, and the two surfaces must not read the same.
   */
  it('refuses a blank box without asking the server', async () => {
    renderPage('admin');

    const row = (await screen.findByText('Vera')).closest('li');
    await userEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('Type the new password first.')).toBeTruthy();
    expect(setAccountPassword).not.toHaveBeenCalled();
  });

  /**
   * The two things the mechanism does *not* do, which an administrator would
   * otherwise assume it did. Both are properties of the route and the session
   * cookie rather than of this form, which is why they are said here rather
   * than left to be discovered.
   */
  it('says that it neither re-enables nor signs anybody out', async () => {
    renderPage('admin');

    const row = (await screen.findByText('Vera')).closest('li');
    const hint = within(row as HTMLElement).getByText(/does not re-enable a disabled account/);

    expect(hint.textContent).toContain('does not sign them out');
    expect(hint.textContent).toContain('At least 8 characters');
  });
});

/**
 * The install form — [10 §15.3], [P2A §2.5] and [P2A §2.6].
 *
 * Every control is generated from what the server sent, tier badge included,
 * because the tier table travels as data ([21 §4]) and a hand-written list of
 * fields here would be a second copy of the schema — wrong the first time
 * somebody adds a key.
 */
describe('the install form', () => {
  it('badges a restart-tier key, from the table the server sent', async () => {
    renderPage('admin');

    // Not a list of key names kept here: a key a newer build adds renders with
    // the right badge without a client release.
    expect(await screen.findByLabelText('server.port (needs a restart)')).toBeTruthy();
    expect(screen.getByLabelText('log.level')).toBeTruthy();
  });

  /**
   * **`dataDir` is read-only, with the reason** — [P2A §2.6].
   *
   * It decides where `config.json` itself lives, so a form that edited it and
   * then wrote to the old location would be a one-click way to appear to lose
   * everything. A field somebody cannot edit and cannot find out why about is
   * worse than no field, so the note points at `--data` and the file.
   */
  it('locks dataDir and says where to change it instead', async () => {
    renderPage('admin');

    const field = await screen.findByLabelText('dataDir (needs a restart)');
    expect(field.hasAttribute('readonly')).toBe(true);
    expect(screen.getByText(/Set with --data when you start the server/)).toBeTruthy();
  });

  /**
   * **`server.host` carries the binding sentence at the moment of binding** —
   * [09 §4.1] requires it of every place somebody can bind beyond loopback, and
   * this form is the fourth.
   */
  it('warns about binding beyond loopback where the binding happens', async () => {
    renderPage('admin');
    await screen.findByLabelText('log.level');

    expect(screen.getByText(/reachable from your network/)).toBeTruthy();
  });

  /**
   * **The group that stops a control ever doing nothing silently** — [P2A §2.5].
   *
   * A tier says what a key is *for*; the appliers table says whether anything
   * reads it yet, and the two are allowed to disagree. Without this the form
   * would tell somebody a change had taken when it had only been stored.
   */
  it('names the live keys nothing reads yet', async () => {
    readConfig.mockResolvedValue({
      config: { limits: { maxUploadMb: 64 }, log: { level: 'info' } },
      path: '/data/config.json',
      tiers: { 'limits.maxUploadMb': 'live', 'log.level': 'live' },
      appliers: { 'limits.maxUploadMb': 'unread', 'log.level': 'applied' },
      bounds: {},
      choices: {},
      pendingRestart: [],
    });
    renderPage('admin');

    const notice = await screen.findByText(/Stored, but nothing reads these yet/);
    expect(notice.textContent).toContain('limits.maxUploadMb');
    // And not the one that is read, which is what makes the list mean something.
    expect(notice.textContent).not.toContain('log.level');
  });
});

describe('the user half', () => {
  it('saves a display name and a locale together', async () => {
    renderPage('user');
    const name = await screen.findByLabelText('Display name');

    await userEvent.clear(name);
    await userEvent.type(name, 'Ned C.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateMe.mock.calls[0]?.[0]).toMatchObject({ displayName: 'Ned C.' });
    });
  });

  /**
   * **`null`, not `''`.** *Use my browser's* is a real state and a different one
   * from an empty locale — the server stores null to mean *no preference*, and
   * sending `''` would store a locale that formats nothing.
   */
  it('sends null when the person picks their browser default', async () => {
    renderPage('user');
    await screen.findByLabelText('Display name');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateMe.mock.calls[0]?.[0]).toMatchObject({ locale: null });
    });
  });

  /**
   * **The two password failures are told apart**, because "that did not work"
   * for both leaves somebody retyping a password that was right.
   */
  it('says which password was wrong', async () => {
    const { ApiError } = await import('../api.js');
    changePassword.mockRejectedValue(new ApiError(401, 'invalid-credentials', 'no'));
    renderPage('user');

    await userEvent.type(await screen.findByLabelText('Current password'), 'wrong');
    await userEvent.type(screen.getByLabelText('New password'), 'a long enough one');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('That is not your current password.')).toBeTruthy();
  });

  it('states this install’s minimum rather than a number baked into the build', async () => {
    // The assertion that proves the 8 is gone. It was hardcoded in the error
    // branch, so every install that changed `auth.minPasswordLength` was told
    // the wrong rule — and nothing was watching.
    const { ApiError } = await import('../api.js');
    changePassword.mockRejectedValue(new ApiError(400, 'invalid', 'too short'));
    renderPage('user', 12);

    await userEvent.type(await screen.findByLabelText('Current password'), 'whatever');
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(
      await screen.findByText('The new password must be at least 12 characters.'),
    ).toBeTruthy();
  });

  it('does not blame the password’s length for a server fault', async () => {
    // The old else-branch claimed a length problem for every non-401, so a 500
    // told somebody their password was too short.
    const { ApiError } = await import('../api.js');
    changePassword.mockRejectedValue(new ApiError(500, 'internal', 'The request failed.'));
    renderPage('user', 12);

    await userEvent.type(await screen.findByLabelText('Current password'), 'whatever');
    await userEvent.type(screen.getByLabelText('New password'), 'a long enough one');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('The password could not be changed.')).toBeTruthy();
  });

  /**
   * **Sessions elsewhere survive a password change**, and the form says so.
   *
   * Sessions are signed stateless cookies with no denylist ([09 §4.1]), so
   * nothing here can revoke one — and a form that quietly implied otherwise
   * would leave somebody believing they had shut out whoever they changed the
   * password because of.
   */
  it('does not imply it has signed anyone else out', async () => {
    renderPage('user');
    await screen.findByLabelText('Current password');

    expect(screen.getByText(/does not sign out other browsers you are already/i)).toBeTruthy();
  });
});

/**
 * **The 412, from the client's side** — [P2A §2.5], and the path that had no
 * test at all.
 *
 * The server's own test asserts `response.body.current` and stops there. What
 * nothing checked is what the form does with it, and the form did nothing:
 * `request()` lifts the body's `current` field onto the error, and the handler
 * read `.current` off *that* — always `undefined`, so *Load what is on disk*
 * was unreachable markup.
 *
 * It matters beyond this screen. [P2B §6](../../../../docs/design/workplan/10-p2b-provider-configuration.md)
 * commits the next phase to the same idiom twice over, for `system/bindings.json`
 * and for a connection, so shipping the dead affordance once would have shipped
 * it three times.
 */
/**
 * The theme control — [10 §15.1](../../../../docs/design/10-ui-surfaces.md)'s
 * Preferences pane, and the first thing to use the per-user store that
 * [25 B13](../../../../docs/design/25-open-questions.md) settled.
 *
 * The claim being tested is not that a `<select>` works. It is that *system* is
 * recorded as the **absence** of a preference rather than as a third stored
 * word — because the moment it is stored, a person who never opened this
 * setting and a person who chose *system* are in two different states that have
 * to be kept behaving identically forever.
 */
describe('the theme preference', () => {
  it('offers the three choices, defaulting to system when nothing is stored', async () => {
    renderPage('user');
    const theme: HTMLSelectElement = await screen.findByLabelText('Theme');

    expect([...theme.options].map((option) => option.value)).toEqual(['system', 'light', 'dark']);
    expect(theme.value).toBe('system');
  });

  it('shows the stored choice', async () => {
    readPrefs.mockResolvedValue({ prefs: { 'ui.theme': 'dark' } });
    renderPage('user');

    const theme: HTMLSelectElement = await screen.findByLabelText('Theme');
    expect(theme.value).toBe('dark');
  });

  it('records an explicit choice, and paints it without waiting for the server', async () => {
    let settle: (value: unknown) => void = () => undefined;
    patchPrefs.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    renderPage('user');
    await userEvent.selectOptions(await screen.findByLabelText('Theme'), 'dark');

    // Before the request has answered: the page a person is looking at has
    // already changed, which is the whole feedback this control gives.
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(patchPrefs.mock.calls[0]?.[0]).toEqual({ 'ui.theme': 'dark' });

    settle({ prefs: { 'ui.theme': 'dark' } });
  });

  it('deletes the key for system rather than storing the word', async () => {
    readPrefs.mockResolvedValue({ prefs: { 'ui.theme': 'dark' } });
    renderPage('user');
    await userEvent.selectOptions(await screen.findByLabelText('Theme'), 'system');

    // The first argument only: React Query passes a mutation context as a second.
    expect(patchPrefs.mock.calls[0]?.[0]).toEqual({ 'ui.theme': null });
    // Removed, not set to 'system' — the stylesheet's default arm is the media
    // query, and an unrecognised attribute would sit in front of it.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

/**
 * ***Your* connections, and the capability that decides whether it exists** —
 * [10 §15.1](../../../../docs/design/10-ui-surfaces.md), [P10.3].
 *
 * The same *absent is absent* mechanism the administration half rests on, on a
 * second subject and for a sharper reason: an admin without the panel is
 * looking at a page that is not for them, and a person without
 * `privateConnections` would be looking at a form whose **writes the resolver
 * would ignore** — `resolveConnections` returns their files as `disabled`. A
 * greyed form would promise something the loader has already decided against.
 */
describe('your own connections', () => {
  it('is there for an account that may keep its own keys', async () => {
    listMyConnections.mockResolvedValue({
      connections: [
        {
          id: 'mine',
          label: 'My own key',
          provider: 'openai-compatible',
          scope: 'user',
          models: ['local-hi'],
          hasKey: true,
          shadowed: false,
          contentHash: 'h1',
        },
      ],
    });

    renderPage('user');

    expect(await screen.findByRole('heading', { name: 'Your connections' })).toBeTruthy();
    expect(await screen.findByText('My own key')).toBeTruthy();
  });

  it('is absent without the capability, and nothing is asked for', async () => {
    authState.mockResolvedValue({
      setupRequired: false,
      account: {
        ...account('user'),
        capabilities: { privateConnections: false, fileAccess: 'none', enableExtensions: false },
      },
      minPasswordLength: 8,
      build: ALPHA,
    });
    readMe.mockResolvedValue({ account: account('user') });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SettingsPage />
      </QueryClientProvider>,
    );

    await screen.findByText('You');
    expect(screen.queryByRole('heading', { name: 'Your connections' })).toBeNull();
    // The mechanism rather than the symptom: the hook never mounts, so that
    // browser issues no request there is nothing to refuse.
    expect(listMyConnections).not.toHaveBeenCalled();
  });
});

describe('a config save the file has moved under', () => {
  it('offers what is on disk, rather than only refusing', async () => {
    const { ApiError } = await import('../api.js');
    writeConfig.mockRejectedValue(
      new ApiError(
        412,
        'stale',
        'The config file has changed on disk.',
        {
          dataDir: './data',
          log: { level: 'warn' },
          server: { host: '127.0.0.1', port: 8080 },
        },
        'the-hash-the-file-has-now',
      ),
    );

    renderPage('admin');
    await screen.findByLabelText('log.level');
    // Scoped: the page has two Save buttons, and the user half's is first.
    const install = within(screen.getByRole('region', { name: 'This install' }));
    await userEvent.click(install.getByRole('button', { name: 'Save' }));

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('changed on disk');

    // The offer, and then what it does: the form's values become the file's.
    await userEvent.click(screen.getByRole('button', { name: 'Load what is on disk' }));

    expect(screen.getByLabelText<HTMLSelectElement>('log.level').value).toBe('warn');
  });
  /**
   * **The other offer**, and the reason both exist — gate step 15 asks for *load
   * what is on disk* **or** *overwrite with mine*, and *neither by accident*.
   *
   * Until this was walked as a checklist the form had only the first, and the
   * server had no way to accept either: a 412 wedged the form until the process
   * restarted, because the refusal never refreshed what the process had read.
   */
  it('offers to overwrite too, and presents the acknowledgement either way', async () => {
    const { ApiError } = await import('../api.js');
    writeConfig.mockRejectedValueOnce(
      new ApiError(
        412,
        'stale',
        'The config file has changed on disk.',
        {
          dataDir: './data',
          log: { level: 'warn' },
          server: { host: '127.0.0.1', port: 8080 },
        },
        'the-hash-the-file-has-now',
      ),
    );
    writeConfig.mockResolvedValue({ config: {}, pendingRestart: [] });

    renderPage('admin');
    await screen.findByLabelText('log.level');
    const install = within(screen.getByRole('region', { name: 'This install' }));
    await userEvent.click(install.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Overwrite with mine' }));
    await userEvent.click(install.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(writeConfig).toHaveBeenCalledTimes(2);
    });
    // `adminApi.writeConfig(config, contentHash)` — two arguments, not one
    // object. The mutation hook takes the pair and spreads it here.
    const [config, contentHash] = writeConfig.mock.calls[1] as [
      { log: { level: string } },
      string | undefined,
    ];
    // The acknowledgement, with the form's own values beside it — which is the
    // whole difference between this offer and the other one.
    expect(contentHash).toBe('the-hash-the-file-has-now');
    expect(config.log.level).toBe('info');
  });

  /**
   * ***Save, pressed again with neither offer chosen*** (2026-09-27). The
   * refusal's hash used to ride on the very next Save, so this overwrote the
   * file on disk — the silent overwrite the refusal exists for, and what gate
   * step 15's *neither by accident* rules out. It is refused again now.
   */
  it('sends no acknowledgement on a Save pressed straight after a refusal', async () => {
    const { ApiError } = await import('../api.js');
    writeConfig.mockRejectedValueOnce(
      new ApiError(
        412,
        'stale',
        'The config file has changed on disk.',
        {
          dataDir: './data',
          log: { level: 'warn' },
          server: { host: '127.0.0.1', port: 8080 },
        },
        'the-hash-the-file-has-now',
      ),
    );
    writeConfig.mockResolvedValue({ config: {}, pendingRestart: [] });

    renderPage('admin');
    await screen.findByLabelText('log.level');
    const install = within(screen.getByRole('region', { name: 'This install' }));
    await userEvent.click(install.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');

    await userEvent.click(install.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(writeConfig).toHaveBeenCalledTimes(2);
    });
    expect(writeConfig.mock.calls[1]?.[1]).toBeUndefined();
  });

  it('sends no acknowledgement on an ordinary save, so neither offer fires by accident', async () => {
    writeConfig.mockResolvedValue({ config: {}, pendingRestart: [] });
    renderPage('admin');
    await screen.findByLabelText('log.level');

    const install = within(screen.getByRole('region', { name: 'This install' }));
    await userEvent.click(install.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(writeConfig).toHaveBeenCalled();
    });
    // `adminApi.writeConfig(config, contentHash)` — the hash is the SECOND
    // argument. Reading it off the first is reading it off the config object,
    // which never has one, so the assertion passed no matter what the form
    // sent. Found by mutation: making the form always acknowledge left this
    // green.
    expect(writeConfig.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('says so when the server refuses a save, instead of looking unchanged', async () => {
    // Before this the form rendered only success and the 412 block, so a 400 —
    // a value past its range, a key the build does not know — left the page
    // exactly as it was. An admin typing 999 saw nothing happen at all.
    const { ApiError } = await import('../api.js');
    writeConfig.mockRejectedValue(
      new ApiError(400, 'invalid', '/auth/minPasswordLength must be <= 128'),
    );

    renderPage('admin');
    await screen.findByLabelText('log.level');
    const install = within(screen.getByRole('region', { name: 'This install' }));
    await userEvent.click(install.getByRole('button', { name: 'Save' }));

    const alert = await install.findByRole('alert');
    expect(alert.textContent).toContain('/auth/minPasswordLength must be <= 128');
  });

  it('carries the server’s bounds onto the control', async () => {
    // Derived from the schema and sent as data, the way the tier table is — so
    // the browser refuses an out-of-range value before the save has to.
    renderPage('admin');

    const port = await screen.findByRole('spinbutton', {
      name: 'server.port (needs a restart)',
    });
    expect(port.getAttribute('min')).toBe('1');
    expect(port.getAttribute('max')).toBe('65535');
  });
});
