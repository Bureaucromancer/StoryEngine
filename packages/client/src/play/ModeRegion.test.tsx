// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A mode's contributed surfaces — [06 §9], [10 §8], [P7.11].
 *
 * ***The claim under test is an absence***, the same one `ChannelHud.test.tsx`
 * makes and for the same reason: this component knows no channel and no mode,
 * and the assertions that matter are the ones a future shortcut would break —
 * that an unrecognised `kind` **and** an unrecognised `region` are skipped
 * rather than rendered or thrown, and that every label and value comes from the
 * payload rather than from anything here.
 *
 * **Widening either vocabulary has to stay additive.** A session opened against
 * a newer build renders what this build understands and omits the rest; the
 * alternative — a thrown render — would make adding a widget a breaking change,
 * which is precisely what [10 §8.1] trades the iframe escape hatch away to
 * avoid.
 */

const writeSessionChannel = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    writeSessionChannel: (...a: unknown[]) => writeSessionChannel(...a) as unknown,
  };
});

const { ModeRegion } = await import('./ModeRegion.js');
type ModeSurface = import('../api.js').ModeSurface;

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

/**
 * *What the page would have read once and handed down.* The component takes the
 * list as a prop rather than reading it, because the message region renders once
 * per turn — see `ModeRegion`'s own note.
 */
let given: unknown[] = [];
function answerWith(surfaces: unknown[]): void {
  given = surfaces;
}

function surface(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    region: 'stage',
    key: 'se.backdrop',
    channelId: 'se.backdrop',
    scopeKey: null,
    kind: 'image',
    label: 'The tavern',
    image: { url: '/api/library/actors/a-1/media/m-1', alt: 'The tavern' },
    ...over,
  };
}

async function renderRegion(
  region: 'hud' | 'panel' | 'message' | 'stage',
  scopeKey?: string | null,
): Promise<{ container: HTMLElement }> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <ModeRegion
        sessionId={SESSION_ID}
        surfaces={given as ModeSurface[]}
        region={region}
        {...(scopeKey === undefined ? {} : { scopeKey })}
      />
    </QueryClientProvider>,
  );
  // Nothing to wait for: the surfaces arrive as a prop, which is the point of
  // the page reading them once. `await` keeps the helper's shape and lets a
  // caller that does need a tick have one.
  await Promise.resolve();
  return { container };
}

beforeEach(() => {
  given = [];
  writeSessionChannel.mockReset();
  writeSessionChannel.mockResolvedValue({});
});

describe('a mode’s contributed surface', () => {
  it('shows a picture the server resolved, with the declaration’s label as its alt', async () => {
    answerWith([surface()]);
    await renderRegion('stage');

    const image = await screen.findByRole('img');
    expect(image.getAttribute('src')).toBe('/api/library/actors/a-1/media/m-1');
    // The alt is authored content travelling with the mode. A filename would be
    // worse than nothing and an empty alt would make the picture invisible to
    // anyone not looking at it.
    expect(image.getAttribute('alt')).toBe('The tavern');
  });

  it('renders only the region it was asked for', async () => {
    answerWith([
      surface(),
      surface({ region: 'panel', key: 'se.staging', kind: 'toggle', on: true }),
    ]);
    const { container } = await renderRegion('stage');

    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('input')).toBeNull();
  });

  /**
   * ***The additive claim, on the widget vocabulary.*** A session opened against
   * a newer build renders the widgets this one understands and silently omits
   * the rest — the same posture the collector takes toward a preset slot kind
   * from the future.
   */
  it('skips a widget kind it does not know', async () => {
    answerWith([surface({ kind: 'meter', label: 'Health' })]);
    const { container } = await renderRegion('stage');

    expect(screen.queryByText('Health')).toBeNull();
    // And renders no wrapper either: a gap in the layout for a feature that is
    // not there is worse than nothing.
    expect(container.textContent).toBe('');
  });

  /**
   * ***And on the region vocabulary***, which is the half that is new at
   * [P7.11]. A fifth region is as additive as a fourth widget arm, and neither
   * may break a build that has not heard of it.
   */
  it('skips a region it does not know', async () => {
    answerWith([surface({ region: 'sidebar' })]);
    const { container } = await renderRegion('stage');

    expect(container.textContent).toBe('');
  });

  /**
   * *Nothing when there is nothing*, and for the stage this is a requirement
   * rather than tidiness — [10 §2.3]: *"with the backdrop off Play is the
   * surface it was before, not a surface with an empty frame in it."*
   */
  it('renders no frame when the session has nothing to show', async () => {
    answerWith([]);
    const { container } = await renderRegion('stage');

    expect(container.textContent).toBe('');
    expect(container.querySelector('img')).toBeNull();
  });

  /**
   * **One surface per scope key**, which is what a sprite beside each speaker's
   * line is. The caller names the key; the component filters.
   */
  it('shows only the scope it was given', async () => {
    answerWith([
      surface({
        region: 'message',
        key: 'se.expression#a-vera',
        scopeKey: 'a-vera',
        image: { url: '/api/library/actors/a-vera/media/m-1', alt: 'Vera' },
      }),
      surface({
        region: 'message',
        key: 'se.expression#a-lund',
        scopeKey: 'a-lund',
        image: { url: '/api/library/actors/a-lund/media/m-1', alt: 'Lund' },
      }),
    ]);
    await renderRegion('message', 'a-vera');

    const images = await screen.findAllByRole('img');
    expect(images.map((one) => one.getAttribute('alt'))).toEqual(['Vera']);
  });

  /**
   * ***The first writable widget***, and the write is the ordinary channel
   * write — a mode gains a control and gains no new authority.
   */
  it('writes the channel when a toggle is pressed', async () => {
    answerWith([
      surface({
        region: 'panel',
        key: 'se.staging',
        kind: 'toggle',
        label: 'Show the scene',
        on: false,
      }),
    ]);
    await renderRegion('panel');

    await userEvent.click(await screen.findByRole('checkbox'));

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.staging', true);
    });
  });

  it('shows a toggle whether it is on or off, because off is a state', async () => {
    answerWith([
      surface({
        region: 'panel',
        key: 'se.staging',
        kind: 'toggle',
        label: 'Show the scene',
        on: false,
      }),
    ]);
    await renderRegion('panel');

    const box = await screen.findByRole('checkbox');
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('Show the scene')).toBeTruthy();
  });
});
