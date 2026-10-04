// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ***Make a setup from here*** — [P15.8](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md).
 *
 * **What reaches the API is what is held to account**, as the session form's
 * tests hold it: the wizard drafts every part on open, redrafts one part on its
 * own, and saves what the person left on screen — the texts, the facts they
 * kept, the groups they did not switch off, and which fields a model wrote.
 * And the one thing it may not do is show what the preview withholds.
 */

const draftSetupFromTurn = vi.fn();
const saveSetupFromTurn = vi.fn();
const createSession = vi.fn();
const listModes = vi.fn();

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  draftSetupFromTurn: (...a: unknown[]) => draftSetupFromTurn(...a) as unknown,
  saveSetupFromTurn: (...a: unknown[]) => saveSetupFromTurn(...a) as unknown,
  createSession: (...a: unknown[]) => createSession(...a) as unknown,
  listModes: (...a: unknown[]) => listModes(...a) as unknown,
}));

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const { useSetupFromTurn } = await import('./SetupFromTurn.js');

/**
 * ***The two halves where `TurnView` puts them*** (2026-10-04): the button in
 * a row, and what it opens after the row. The hook hands back both since the
 * failure note moved out of the row that fades; where the play page puts them
 * is `PlayPage.test.tsx`'s to hold, and this only has to draw both.
 */
function Turn(props: { sessionId: string; turnId: string; busy: boolean }) {
  const setup = useSetupFromTurn(props);
  return (
    <>
      <div>{setup.trigger}</div>
      {setup.place}
    </>
  );
}
/*
 * ***The dialog's own module, imported once before any test opens it***
 * (2026-10-04). Since [P15 §1.11] the button reaches the dialog through
 * `lazy()`, so the first press makes vitest transform `SetupWizard.tsx` and
 * everything it imports that the button does not — on a loaded runner, a
 * wait `findByRole`'s one second was never sized for. Imported here, the
 * lazy's own `import()` resolves from the module cache: **the path under test
 * is still the lazy one**, button to boundary to dialog, and only the
 * transform has moved out of the timed part. The waiting and failing states
 * are `SetupFromTurn.load.test.tsx`'s.
 */
await import('./SetupWizard.js');

const CARRY = {
  mode: 'storyengine.scene',
  treatment: 'Rain City, noir',
  preset: null,
  persona: 'Marlow',
  party: ['Vera'],
  goals: { carried: 'carried', current: { hidden: true }, count: 2, hidden: 1 },
  hooks: { carried: 3, spent: 1 },
  lore: ['Rain City'],
};

function drafted(parts: string[]) {
  const all: Record<string, unknown> = {
    storySoFar: { ok: true, value: 'Marlow lost the ledger.', model: 'fake-hi' },
    opening: { ok: true, value: 'Rain on the docks.', model: 'fake-hi' },
    title: {
      ok: true,
      value: { name: 'The Ledger, Lost', blurb: 'At the docks.' },
      model: 'fake-hi',
    },
    facts: {
      ok: true,
      value: [
        { text: 'Vera owes Marlow a favour.', keys: ['Vera', 'favour'] },
        { text: 'The harbourmaster drinks.', keys: ['harbourmaster'] },
      ],
      model: 'fake-hi',
    },
  };
  return {
    draft: {
      carry: CARRY,
      warnings: [],
      parts: Object.fromEntries(parts.map((part) => [part, all[part]])),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listModes.mockResolvedValue({
    modes: [{ id: 'storyengine.scene', displayName: 'Scene' }],
    defaultModeId: 'storyengine.scene',
  });
  draftSetupFromTurn.mockImplementation((_s: string, _t: string, body: { parts: string[] }) =>
    Promise.resolve(drafted(body.parts)),
  );
  saveSetupFromTurn.mockResolvedValue({
    setup: { id: 'setup-new', name: 'The Ledger, Lost' },
    lorebook: { id: 'book-new', name: 'The Ledger, Lost — established facts' },
  });
});

async function openWizard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Turn sessionId="s1" turnId="t9" busy={false} />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Make a setup from here' }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => {
    expect(
      within(dialog).getByLabelText<HTMLTextAreaElement>(/What had already happened/).value,
    ).toBe('Marlow lost the ledger.');
  });
  return dialog;
}

describe('making a setup from a turn', () => {
  it('drafts every part on open, for the turn it was opened on', async () => {
    await openWizard();

    expect(draftSetupFromTurn).toHaveBeenCalledTimes(1);
    expect(draftSetupFromTurn).toHaveBeenCalledWith('s1', 't9', {
      parts: ['storySoFar', 'opening', 'title', 'facts'],
      guidance: {},
    });
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe(
      'The Ledger, Lost',
    );
    expect(screen.getByLabelText<HTMLInputElement>('Fact 1').value).toBe(
      'Vera owes Marlow a favour.',
    );
  });

  it('shows what carries by name and count, and a hidden goal only as hidden', async () => {
    const dialog = await openWizard();

    expect(within(dialog).getByText('Rain City, noir')).toBeTruthy();
    // By the name the session form uses, not the id.
    expect(await within(dialog).findByText('Scene')).toBeTruthy();
    expect(within(dialog).getByLabelText('The party: Vera')).toBeTruthy();
    expect(
      within(dialog).getByLabelText('Goals — Begins on a goal that is hidden from you.'),
    ).toBeTruthy();
    expect(
      within(dialog).getByLabelText('Plot hooks — 3 still waiting, 1 already used'),
    ).toBeTruthy();
  });

  it('redrafts one part on its own, with the note written for it', async () => {
    await openWizard();

    await userEvent.type(
      screen.getByLabelText('A note for the next draft of the story so far'),
      'Shorter.',
    );
    const soFar = screen.getByRole('region', { name: 'The story so far' });
    await userEvent.click(within(soFar).getByRole('button', { name: 'Regenerate' }));

    await waitFor(() => {
      expect(draftSetupFromTurn).toHaveBeenLastCalledWith('s1', 't9', {
        parts: ['storySoFar'],
        guidance: { storySoFar: 'Shorter.' },
      });
    });
  });

  /**
   * *With the remedy the route sends since the merge* (2026-10-03): a provider
   * failure says what to do about that failure — here a refusal, whose fix is
   * the key or the model — rather than *the model did not answer* for every
   * failure alike, which is impersonation's sentence for the same class.
   */
  it('says why a part did not land, and keeps the ones that did', async () => {
    draftSetupFromTurn.mockImplementationOnce(() =>
      Promise.resolve({
        draft: {
          ...drafted(['storySoFar', 'title', 'facts']).draft,
          parts: {
            ...drafted(['storySoFar', 'title', 'facts']).draft.parts,
            opening: {
              ok: false,
              reason: 'call-failed',
              class: 'terminal',
              remedy: 'endpoint-refused',
            },
          },
        },
      }),
    );
    await openWizard();

    const openingSection = screen.getByRole('region', { name: 'Opening' });
    expect(within(openingSection).getByRole('alert').textContent).toBe(
      'The model endpoint refused the request. Check the key, the model name and the permissions in Settings.',
    );
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe(
      'The Ledger, Lost',
    );
  });

  /**
   * ***The two refusals the draft learned at the merge, and a remedy from the
   * future*** (2026-10-03). A cut-off part and a window too small each have a
   * sentence of their own rather than an `undefined` in the alert; and a remedy
   * this build has never heard of falls back to the generic line, which is
   * `remedySentence`'s *nothing rather than a guess* reaching the wizard.
   */
  it('says a part was cut off, or the window is too small, and never guesses a remedy', async () => {
    draftSetupFromTurn.mockImplementationOnce(() =>
      Promise.resolve({
        draft: {
          ...drafted(['storySoFar']).draft,
          parts: {
            ...drafted(['storySoFar']).draft.parts,
            opening: { ok: false, reason: 'truncated' },
            title: { ok: false, reason: 'window-too-small' },
            facts: {
              ok: false,
              reason: 'call-failed',
              class: 'transient',
              remedy: 'a-remedy-from-next-year',
            },
          },
        },
      }),
    );
    await openWizard();

    const alertIn = (name: string) =>
      within(screen.getByRole('region', { name })).getByRole('alert').textContent;
    expect(alertIn('Opening')).toBe(
      'The draft ran past the reply length and was cut off, so it is not shown. Try again with a note asking for it shorter, or raise the reply length.',
    );
    expect(alertIn('Name and blurb')).toBe(
      'The model’s context window is too small to hold the story beside its reply. Raise the context window in the connection’s settings, or lower the reply length.',
    );
    expect(alertIn('Established facts')).toBe('The model did not answer. Try again.');
  });

  /**
   * ***A summary link that was not kept says so*** (2026-10-03, at review).
   * The server fails every part with `summary-truncated` or
   * `summary-no-answer` when a link of the chain was cut off or empty, and the
   * sentence names the summary and the fix that reaches it — never *a note*,
   * which reaches only the part it names. (The server fails every part at
   * once; the story so far is left standing here only because the wizard
   * opens on it.) Mutation: drop either entry from `REFUSAL` and its alert is
   * empty.
   */
  it('says when it was a summary of the earlier story that was not kept', async () => {
    draftSetupFromTurn.mockImplementationOnce(() =>
      Promise.resolve({
        draft: {
          ...drafted(['storySoFar']).draft,
          parts: {
            ...drafted(['storySoFar']).draft.parts,
            opening: { ok: false, reason: 'summary-truncated' },
            title: { ok: false, reason: 'summary-no-answer' },
          },
        },
      }),
    );
    await openWizard();

    const alertIn = (name: string) =>
      within(screen.getByRole('region', { name })).getByRole('alert').textContent;
    expect(alertIn('Opening')).toBe(
      'A summary of the earlier story ran past the reply length and was cut off, so nothing was drafted from it. Raise the reply length, then try again.',
    );
    expect(alertIn('Name and blurb')).toBe(
      'The model wrote no usable summary of the earlier story, so nothing was drafted from it. Try again.',
    );
  });

  it('saves what the person left on screen, and offers to start from it', async () => {
    await openWizard();

    await userEvent.clear(screen.getByRole('textbox', { name: 'Name' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Docks at Dawn');
    await userEvent.click(screen.getByLabelText('Keep fact 2'));
    await userEvent.click(screen.getByLabelText('The party: Vera'));
    await userEvent.click(screen.getByRole('button', { name: 'Save as a setup' }));

    await waitFor(() => {
      expect(saveSetupFromTurn).toHaveBeenCalledWith('s1', 't9', {
        texts: {
          name: 'Docks at Dawn',
          blurb: 'At the docks.',
          storySoFar: 'Marlow lost the ledger.',
          opening: { label: '', text: 'Rain on the docks.' },
        },
        include: { party: false, goals: true, hooks: true },
        facts: [{ text: 'Vera owes Marlow a favour.', keys: ['Vera', 'favour'] }],
        generated: {
          storySoFar: { original: 'Marlow lost the ledger.', model: 'fake-hi' },
          'openings.written.0.text': { original: 'Rain on the docks.', model: 'fake-hi' },
          name: { original: 'The Ledger, Lost', model: 'fake-hi' },
          blurb: { original: 'At the docks.', model: 'fake-hi' },
        },
      });
    });

    expect(await screen.findByText(/Saved “The Ledger, Lost”/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Start a session from it' }));
    expect(createSession).toHaveBeenCalledWith({ setup: 'setup-new' });
  });

  it('will not save without a name, and says so', async () => {
    await openWizard();

    await userEvent.clear(screen.getByRole('textbox', { name: 'Name' }));

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save as a setup' }).disabled,
    ).toBe(true);
    expect(screen.getByText('A setup needs a name.')).toBeTruthy();
  });
});
