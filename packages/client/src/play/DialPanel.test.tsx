// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two dials — [06 §7.3.1], [06 §7.3.2], [P7.8].
 *
 * ***The claim worth holding is that they are two.*** [06 §7.3.2] names the
 * failure this surface is shaped against: *"A naive difficulty implementation
 * raises both together… The result is railroading wearing difficulty's clothes,
 * and players report it as* the AI ignoring me *rather than as* hard." A single
 * control would build that failure into the UI, where nothing downstream could
 * undo it — so the test that matters is that changing one writes one channel.
 */

const readSession = vi.fn();
const writeSessionChannel = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readSession: (...a: unknown[]) => readSession(...a) as unknown,
    writeSessionChannel: (...a: unknown[]) => writeSessionChannel(...a) as unknown,
  };
});

const { DialPanel } = await import('./DialPanel.js');
const { ApiError } = await import('../api.js');

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

const LEVELS = [
  { id: 'gentle', label: 'Gentle' },
  { id: 'even', label: 'Even' },
  { id: 'harsh', label: 'Harsh' },
];

function answerWith(dials: unknown): void {
  readSession.mockResolvedValue({
    session: { id: SESSION_ID, name: 'A wet week' },
    activeJob: null,
    health: [],
    hud: [],
    cast: [],
    hooks: { pacing: 'normal', rows: [] },
    goals: { rows: [], concluded: false },
    ...(dials === undefined ? {} : { dials }),
  });
}

async function renderPanel(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DialPanel sessionId={SESSION_ID} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(readSession).toHaveBeenCalled();
  });
}

beforeEach(() => {
  readSession.mockReset();
  writeSessionChannel.mockReset();
  writeSessionChannel.mockResolvedValue({});
});

describe('the dial panel', () => {
  it('renders one control per axis the mode declares', async () => {
    answerWith({
      difficulty: { levelId: 'even', levels: LEVELS },
      directedness: { levelId: 'following', levels: [{ id: 'following', label: 'Following' }] },
    });
    await renderPanel();

    expect(await screen.findByLabelText(/resists you/)).toBeTruthy();
    expect(screen.getByLabelText(/narrator steers/)).toBeTruthy();
  });

  /**
   * ***One control, one channel — the assertion [06 §7.3.2] is about.*** If a
   * change to difficulty ever wrote directedness as well, this is what would
   * catch it, and there is no downstream prompt language that could.
   */
  it('writes only the axis that changed', async () => {
    answerWith({
      difficulty: { levelId: 'even', levels: LEVELS },
      directedness: { levelId: 'following', levels: [{ id: 'following', label: 'Following' }] },
    });
    await renderPanel();

    await userEvent.selectOptions(await screen.findByLabelText(/resists you/), 'harsh');

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.difficulty', 'harsh');
    });
    expect(writeSessionChannel).toHaveBeenCalledTimes(1);
  });

  /**
   * **The options are the pack's**, not the client's — [06 §7.3.1]: *"'Hard'
   * meaning something different in one prompt pack than another is a feature."*
   * A hard-coded list would produce a recorded refusal against a pack with four.
   */
  it('offers the levels the pack shipped and no others', async () => {
    answerWith({ difficulty: { levelId: 'gentle', levels: [{ id: 'brutal', label: 'Brutal' }] } });
    await renderPanel();

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Brutal']);
  });

  /**
   * ***The floor, said to the player*** — [06 §7.3.1]: *"Obstruction must not
   * reach unreachability."* Someone on Harsh who cannot tell whether the game is
   * hard or broken is the failure the sentence exists to prevent, and it is a
   * failure of the surface as much as of the pack.
   */
  it('says that harder never means unreachable', async () => {
    answerWith({ difficulty: { levelId: 'harsh', levels: LEVELS } });
    await renderPanel();

    expect(await screen.findByText(/never means you cannot get there/)).toBeTruthy();
  });

  /**
   * *A mode with no difficulty is [04 §7]'s explicit case rather than an empty
   * state*: Scene and Messages declare neither channel, and a heading over
   * nothing would be a surface claiming a feature that is not configured.
   */
  it('renders nothing for a mode that declares no dials', async () => {
    answerWith(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <DialPanel sessionId={SESSION_ID} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(readSession).toHaveBeenCalled();
    });
    expect(container.querySelector('select')).toBeNull();
  });

  /** An axis the pack ships no levels for is absent, not an empty select. */
  it('renders only the axis the pack has levels for', async () => {
    answerWith({ difficulty: { levelId: 'even', levels: LEVELS } });
    await renderPanel();

    expect(await screen.findByLabelText(/resists you/)).toBeTruthy();
    expect(screen.queryByLabelText(/narrator steers/)).toBeNull();
  });
});

/**
 * ***A dial the server refused says so*** — polish 9 (2026-10-01). It sprang
 * back without a word, and the commonest refusal is a turn in flight, which is
 * a reason to wait rather than a fault.
 */
describe('a refused dial', () => {
  it('says that a turn is running, where the dial is', async () => {
    writeSessionChannel.mockRejectedValue(new ApiError(409, 'busy', 'In flight.'));
    answerWith({ difficulty: { levelId: 'even', levels: LEVELS } });
    await renderPanel();

    await userEvent.selectOptions(await screen.findByLabelText(/resists you/), 'harsh');

    expect((await screen.findByRole('alert')).textContent).toBe(
      'A turn is running. Try again when it has finished.',
    );
  });
});
