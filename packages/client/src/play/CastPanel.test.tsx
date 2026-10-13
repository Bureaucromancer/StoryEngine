// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The cast panel — [10 §13.2], [06 §8.1], [P7.2].
 *
 * **The two claims worth holding are the ones a simplification would break**:
 * that one badge comes from two axes without collapsing them, and that a refused
 * death is surfaced as something a person rules on rather than as a badge — *"a
 * badge is precisely the quiet treatment §8.1 rules out"*.
 */

const readSession = vi.fn();
const writeSessionChannel = vi.fn();
const setSessionCast = vi.fn();
const listLibrary = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readSession: (...a: unknown[]) => readSession(...a) as unknown,
    writeSessionChannel: (...a: unknown[]) => writeSessionChannel(...a) as unknown,
    setSessionCast: (...a: unknown[]) => setSessionCast(...a) as unknown,
    api: { ...actual.api, listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown },
  };
});

const { CastPanel } = await import('./CastPanel.js');

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

const VERA = {
  actorId: 'actor-vera',
  presence: true,
  status: 'alive',
  pending: null as string | null,
  introduced: true,
};

function answerWith(cast: unknown[], roster?: { persona: string | null; actors: string[] }): void {
  readSession.mockResolvedValue({
    session: {
      id: SESSION_ID,
      name: 'A wet week',
      ...(roster === undefined ? {} : { cast: roster }),
    },
    activeJob: null,
    health: [],
    hud: [],
    cast,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listLibrary.mockResolvedValue({
    objects: [
      {
        id: 'actor-vera',
        name: 'Vera Kohl',
        schema: 'storyengine.actor.1',
        slug: 'vera',
        source: 'user',
        contentHash: 'sha256:x',
        shadowed: false,
        object: {},
      },
    ],
  });
  setSessionCast.mockResolvedValue({ session: { id: SESSION_ID } });
  writeSessionChannel.mockResolvedValue({
    session: { id: SESSION_ID },
    effect: { applied: true, rejectedReason: null },
    health: [],
  });
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CastPanel sessionId={SESSION_ID} locale="en-US" />
    </QueryClientProvider>,
  );
}

describe('the cast panel', () => {
  it('names the actor from the library and shows one badge', async () => {
    answerWith([VERA]);
    renderPanel();

    expect(await screen.findByText('Vera Kohl')).toBeTruthy();
    expect(screen.getByText('Here')).toBeTruthy();
  });

  it('says dead-but-present, which is the case the two axes exist for', async () => {
    // The body in the room, the ghost, the open casket. A derivation that
    // collapsed the axes back into one enum would have undone the split on the
    // screen, which is the thing 10 §13.2 spends its argument on.
    answerWith([{ ...VERA, status: 'dead', presence: true }]);
    renderPanel();

    expect(await screen.findByText('Dead, present')).toBeTruthy();
  });

  it('falls back to the id for an actor the library no longer has', async () => {
    // A cast entry is a link resolved fresh every turn, so a deleted actor is a
    // dangling reference the panel shows rather than hides — [00 §3.3].
    answerWith([{ ...VERA, actorId: 'actor-gone' }]);
    renderPanel();

    expect(await screen.findByText('actor-gone')).toBeTruthy();
  });

  it('corrects presence directly, which is the repair it offers', async () => {
    answerWith([VERA]);
    renderPanel();

    await userEvent.click(await screen.findByLabelText('In the scene'));

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.presence#actor-vera', false);
    });
  });

  it('corrects status directly, through the channel the engine judges', async () => {
    answerWith([VERA]);
    renderPanel();

    await userEvent.selectOptions(await screen.findByLabelText('Status for Vera Kohl'), 'departed');

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(
        SESSION_ID,
        'se.status#actor-vera',
        'departed',
      );
    });
  });

  it('surfaces a refused death as something to rule on, not as a badge', async () => {
    // **The asymmetry's surface** — [06 §8.1], [26 C12]. The engine refused the
    // model's proposal; a badge would be the *quiet* treatment that section
    // rules out, so this is a bordered box with two buttons and the actor's
    // name in a sentence.
    answerWith([{ ...VERA, pending: 'dead' }]);
    renderPanel();

    expect(await screen.findByText(/The narrator has Vera Kohl as dead/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
  });

  it('confirming writes what the model wanted', async () => {
    answerWith([{ ...VERA, pending: 'dead' }]);
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.status#actor-vera', 'dead');
    });
  });

  it('dismissing writes what is standing, which is also an answer', async () => {
    // Either button ends the proposal, because what clears it is an *applied*
    // status effect — a person having ruled, in one direction or the other.
    answerWith([{ ...VERA, pending: 'dead' }]);
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Not so' }));

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.status#actor-vera', 'alive');
    });
  });

  it('marks nobody as party, because there is no party channel to mark from', async () => {
    // 10 §13.2 wants party members marked *and* no parallel membership concept.
    // While `se.party` waits on P7.3, honouring the second means marking
    // nothing rather than inventing a second source of truth about who is in
    // the story — which that paragraph calls the class of bug it exists to
    // surface.
    answerWith([VERA]);
    renderPanel();

    await screen.findByText('Vera Kohl');
    expect(screen.queryByText(/party/i)).toBeNull();
  });

  it('renders nothing for a session with no cast', async () => {
    answerWith([]);
    renderPanel();

    await waitFor(() => {
      expect(readSession).toHaveBeenCalled();
    });
    expect(screen.queryByLabelText('Cast')).toBeNull();
  });

  /**
   * ***A face on every row, outside a chat as in one*** —
   * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.3. Every
   * row is a claim that this person is in this story, which is [10 §1.3]'s test
   * for a face; it was a chat's alone. The picture is the library's, by content
   * hash, and an actor the library no longer has keeps a face — the tile, by
   * the id the row carries.
   */
  it('draws a face on every row, outside a chat as in one', async () => {
    answerWith([VERA, { ...VERA, actorId: 'actor-gone' }]);
    renderPanel();

    const row = (name: string): HTMLElement => {
      const found = screen.getByText(name, { selector: 'span' }).parentElement;
      if (found === null) throw new Error(`no row for ${name}`);
      return found;
    };
    await screen.findByText('Vera Kohl');
    expect(row('Vera Kohl').querySelector('img')?.getAttribute('src')).toBe(
      '/api/library/actors/actor-vera/avatar?v=sha256%3Ax',
    );
    expect(row('actor-gone').querySelector('span[aria-hidden="true"]')?.textContent).toBe('A');
  });
});

/**
 * ***Who you play*** — the correction the face on the player's own line leads
 * to, [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.3.
 *
 * [06 §8] makes a mid-session persona change *"an explicit act rather than an
 * outcome of play"*, so what is held is that choosing writes nothing and
 * pressing writes the persona, the roster's actors as they were.
 */
describe('who you play', () => {
  it('changes the persona when asked, and only then, with the roster whole', async () => {
    answerWith([VERA], { persona: null, actors: ['actor-vera', 'actor-lund'] });
    renderPanel();

    const choice = await screen.findByRole('combobox', { name: 'You play' });
    expect((choice as HTMLSelectElement).value).toBe('');
    const press = screen.getByRole('button', { name: 'Play as them' });
    expect((press as HTMLButtonElement).disabled).toBe(true);

    await within(choice).findByRole('option', { name: 'Vera Kohl' });
    await userEvent.selectOptions(choice, 'actor-vera');
    expect(setSessionCast).not.toHaveBeenCalled();
    await userEvent.click(press);

    await waitFor(() => {
      expect(setSessionCast).toHaveBeenCalledWith(SESSION_ID, {
        persona: 'actor-vera',
        actors: ['actor-vera', 'actor-lund'],
      });
    });
  });

  it('says who the session is played as, even somebody the library no longer has', async () => {
    answerWith([VERA, { ...VERA, actorId: 'actor-gone' }], {
      persona: 'actor-gone',
      actors: ['actor-vera'],
    });
    renderPanel();

    const choice = await screen.findByRole('combobox', { name: 'You play' });
    await waitFor(() => {
      expect(
        within(choice)
          .getAllByRole('option')
          .map((one) => one.textContent),
      ).toContain('Vera Kohl');
    });
    expect((choice as HTMLSelectElement).value).toBe('actor-gone');
  });
});
