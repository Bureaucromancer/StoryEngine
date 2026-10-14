// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackdropCandidate } from '../api.js';

/**
 * ***Choose a backdrop…*** — [10 §2.3](../../../../docs/design/10-ui-surfaces.md),
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.2, under
 * §0.4's decisions.
 *
 * **What is held is the act, not the look**: the dialog lists both arms of the
 * channel's value as the server sent them, grouped by whose they are; a pick
 * is two of a person's channel writes, staging off first and then the
 * selection, sent back exactly as it came; *No backdrop* is the same two
 * writes with nothing chosen; and a refused first write stops the second. The
 * list itself — what a session uses, and nothing it does not — is the route's
 * claim, held in `routes/backdrops.test.ts`.
 */

const readBackdrops = vi.fn();
const writeSessionChannel = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readBackdrops: (...a: unknown[]) => readBackdrops(...a) as unknown,
    writeSessionChannel: (...a: unknown[]) => writeSessionChannel(...a) as unknown,
  };
});

const { ChooseBackdrop } = await import('./ChooseBackdrop.js');

const SESSION = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

/** One of each arm, and a second picture on the same object. */
const MADE: BackdropCandidate = {
  selection: { from: 'rendition', renditionId: 't-1.0' },
  url: `/api/sessions/${SESSION}/renditions/t-1.0/asset`,
  source: null,
  label: null,
  current: false,
};
const TIDE: BackdropCandidate = {
  selection: { from: 'authored', kind: 'treatments', objectId: 'tr-1', mediaId: 'm-tide' },
  url: '/api/library/treatments/tr-1/media/m-tide',
  source: { kind: 'treatments', id: 'tr-1', name: 'Low Tide' },
  label: 'Low water',
  current: true,
};
const SHORE: BackdropCandidate = {
  selection: { from: 'authored', kind: 'treatments', objectId: 'tr-1', mediaId: 'm-shore' },
  url: '/api/library/treatments/tr-1/media/m-shore',
  source: { kind: 'treatments', id: 'tr-1', name: 'Low Tide' },
  label: null,
  current: false,
};
const HARBOUR: BackdropCandidate = {
  selection: { from: 'authored', kind: 'lorebooks', objectId: 'lb-1', mediaId: 'm-harbour' },
  url: '/api/library/lorebooks/lb-1/media/m-harbour',
  source: { kind: 'lorebooks', id: 'lb-1', name: 'The Coast' },
  label: 'The harbour',
  current: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  readBackdrops.mockResolvedValue({ candidates: [MADE, TIDE, SHORE, HARBOUR] });
  writeSessionChannel.mockResolvedValue({
    session: {},
    effect: { applied: true, rejectedReason: null },
    health: [],
  });
});

async function opened(): Promise<HTMLElement> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChooseBackdrop sessionId={SESSION} busy={false} />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Choose a backdrop…' }));
  return screen.findByRole('dialog', { name: 'Choose a backdrop' });
}

describe('choosing a backdrop', () => {
  it('lists both arms as the server sent them, under whose pictures they are', async () => {
    const dialog = await opened();

    // *Whose*, not who made them (2026-10-13, after review): an imported
    // story's backgrounds are the session's own and were not made in it.
    const made = await within(dialog).findByRole('region', {
      name: 'This session’s own backgrounds',
    });
    expect(
      within(made)
        .getAllByRole('button')
        .map((one) => one.textContent),
    ).toEqual(['Picture 1']);
    const tide = within(dialog).getByRole('region', { name: 'From the treatment “Low Tide”' });
    // The picture's own label, a number where it has none, and which is showing.
    const [low, second] = within(tide).getAllByRole('button');
    expect(low?.textContent).toBe('Low waterShowing now');
    expect(low?.getAttribute('aria-pressed')).toBe('true');
    expect(second?.textContent).toBe('Picture 2');
    expect(second?.getAttribute('aria-pressed')).toBe('false');
    expect(
      within(dialog).getByRole('region', { name: 'From the lorebook “The Coast”' }),
    ).toBeTruthy();
    // Each thumbnail is drawn from the address the stage would draw it from,
    // and says nothing of its own to a screen reader — the button's text does.
    const thumbnails = [...dialog.querySelectorAll('img')];
    expect(thumbnails.map((one) => one.getAttribute('src'))).toEqual([
      MADE.url,
      TIDE.url,
      SHORE.url,
      HARBOUR.url,
    ]);
    expect(thumbnails.every((one) => one.getAttribute('alt') === '')).toBe(true);
  });

  /**
   * ***The sentence that goes with the act*** — §0.4: choosing one turns
   * *Stage a backdrop* off, said in the same sentence, and turning it back on
   * hands the choice back. A dialog that wrote the switch without saying so
   * would be a control that changes another control behind the person's back.
   * *(2026-10-13, P12A.5: and where that switch is, now that it is not in the
   * column beside this control but in the workbench's Session section, which
   * Play's* Session settings *opens.)*
   */
  it('says that choosing stops the story staging one, and how to hand it back', async () => {
    const dialog = await opened();

    const said = dialog.textContent;
    expect(said).toContain('stops the story staging its own');
    expect(said).toContain('“Stage a backdrop” is switched off');
    expect(said).toContain('Switching “Stage a backdrop” back on hands the choice back');
    expect(said).toContain('That switch is in Session settings.');
  });

  it('turns staging off and then writes the choice, as it was sent', async () => {
    const dialog = await opened();
    const harbour = within(
      await within(dialog).findByRole('region', { name: 'From the lorebook “The Coast”' }),
    ).getByRole('button', { name: 'The harbour' });

    await userEvent.click(harbour);

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledTimes(2);
    });
    expect(writeSessionChannel.mock.calls).toEqual([
      [SESSION, 'se.backdrop.on', false],
      [SESSION, 'se.backdrop', HARBOUR.selection],
    ]);
    // Sent back unread: the very value the list carried.
    expect(writeSessionChannel.mock.calls[1]?.[2]).toBe(HARBOUR.selection);
    // And the dialog is done.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('writes no backdrop as staging off and then nothing', async () => {
    const dialog = await opened();

    await userEvent.click(within(dialog).getByRole('button', { name: 'No backdrop' }));

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledTimes(2);
    });
    expect(writeSessionChannel.mock.calls).toEqual([
      [SESSION, 'se.backdrop.on', false],
      [SESSION, 'se.backdrop', null],
    ]);
  });

  /**
   * ***A refused switch stops the pick.*** Written with staging still on, the
   * pick would last until the story's next picture overwrote it — a choice
   * that quietly un-chooses itself. So nothing is chosen, and the dialog says
   * the choice did not take.
   */
  it('chooses nothing when the switch refuses, and says so', async () => {
    writeSessionChannel.mockResolvedValueOnce({
      session: {},
      effect: { applied: false, rejectedReason: 'policy' },
      health: [],
    });
    const dialog = await opened();

    await userEvent.click(await within(dialog).findByRole('button', { name: 'The harbour' }));

    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      'That backdrop could not be chosen.',
    );
    expect(writeSessionChannel.mock.calls).toEqual([[SESSION, 'se.backdrop.on', false]]);
  });

  it('does not offer a picture whose thumbnail will not load', async () => {
    const dialog = await opened();
    const tide = await within(dialog).findByRole('region', {
      name: 'From the treatment “Low Tide”',
    });
    const shore = tide.querySelectorAll('img')[1];
    if (shore === undefined) throw new Error('fixture lost a picture');

    fireEvent.error(shore);

    expect(
      within(tide)
        .getAllByRole('button')
        .map((one) => one.textContent),
    ).toEqual(['Low waterShowing now']);
  });

  it('says where pictures come from when the session uses none', async () => {
    readBackdrops.mockResolvedValue({ candidates: [] });
    const dialog = await opened();

    const said = await within(dialog).findByText(/^Nothing this session uses has a picture yet\./);
    // And sends a person to a gallery that exists (2026-10-13, after review):
    // only a lorebook has a picture editor, so the sentence names the lorebook
    // rather than every kind the list reads.
    expect(said.textContent).toContain('to a lorebook this session uses');
    // *No backdrop* is still there: off is always a choice.
    expect(within(dialog).getByRole('button', { name: 'No backdrop' })).toBeTruthy();
  });

  /**
   * ***A phone is told there is no backdrop there*** (2026-10-14, P12A's final
   * audit). The layer is `max-sm:hidden`, so below `sm` a pick or *Set the
   * scene* changed nothing on the screen; the controls stay, since a pick
   * holds on a wider one, and a sentence says so beside them and in the
   * dialog. jsdom applies no stylesheet, so what is held is that each copy is
   * there and carries `sm:hidden`. Mutations: either line removed, and
   * `sm:hidden` dropped from either.
   */
  it('tells a phone there is no backdrop there, beside the control and in the dialog', async () => {
    const PHONE =
      'There is no backdrop on a phone-sized screen. What is set here shows on a wider one.';
    const dialog = await opened();

    const said = screen.getAllByText(PHONE);
    expect(said).toHaveLength(2);
    const [beside, inDialog] = [
      said.find((one) => !dialog.contains(one)),
      within(dialog).getByText(PHONE),
    ];
    expect(beside?.classList.contains('sm:hidden')).toBe(true);
    expect(beside?.classList.contains('basis-full')).toBe(true);
    expect(inDialog.classList.contains('sm:hidden')).toBe(true);
  });
});
