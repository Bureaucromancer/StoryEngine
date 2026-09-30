// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
const runSessionStep = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    writeSessionChannel: (...a: unknown[]) => writeSessionChannel(...a) as unknown,
    runSessionStep: (...a: unknown[]) => runSessionStep(...a) as unknown,
  };
});

const { ModeActions, ModeRegion } = await import('./ModeRegion.js');
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
  region: 'hud' | 'panel' | 'message' | 'stage' | 'settings',
  scopeKey?: string | null,
  nameOf?: (scopeKey: string) => string,
): Promise<{ container: HTMLElement }> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <ModeRegion
        sessionId={SESSION_ID}
        surfaces={given as ModeSurface[]}
        region={region}
        {...(scopeKey === undefined ? {} : { scopeKey })}
        {...(nameOf === undefined ? {} : { nameOf })}
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
  runSessionStep.mockReset();
  runSessionStep.mockResolvedValue({ turn: { id: 't-1' } });
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
    answerWith([surface({ kind: 'gauge', label: 'Health' })]);
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

/**
 * ***The two arms [P14.5a] added, and the grouping*** — a stat bar, and a
 * structured value read and edited field by field. Still knowing no channel:
 * every label, field and path below comes from the payload, and the writes
 * are the ordinary channel write — the whole value for an edit, the whole set
 * for a lock or a hide.
 */
describe('a record, a meter and a group', () => {
  const WORLD = {
    date: 'the third of Frost',
    time: '',
    location: 'the docks',
    weather: 'fog',
    temperature: '',
    fields: [],
    recent: [],
  };

  function world(over: Record<string, unknown> = {}): Record<string, unknown> {
    return surface({
      region: 'panel',
      key: 'se.track.world',
      channelId: 'se.track.world',
      kind: 'record',
      label: 'The world',
      group: 'Tracked',
      image: undefined,
      record: {
        value: WORLD,
        fields: [
          { key: 'date', label: 'Date', show: 'line' },
          { key: 'location', label: 'Location', show: 'line' },
          { key: 'weather', label: 'Weather', show: 'line' },
          { key: 'fields', label: 'Also', show: 'pairs' },
          { key: 'secret', label: 'Secret', show: 'hologram' },
        ],
        locks: { key: 'se.track.locks', paths: ['se.track.world/location'] },
        hidden: { key: 'se.track.hidden', paths: ['se.track.world/weather'] },
      },
      ...over,
    });
  }

  it('reads a record under its group, marks a lock, and leaves a hidden field off until asked', async () => {
    answerWith([world()]);
    await renderRegion('panel');

    expect(screen.getByRole('heading', { name: 'Tracked' })).toBeTruthy();
    expect(screen.getByText('The world')).toBeTruthy();
    expect(screen.getByText('the docks')).toBeTruthy();
    expect(screen.getByText('locked')).toBeTruthy();
    // Hidden from the reader, not from the story — and said, so it is findable.
    expect(screen.queryByText('fog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show 1 hidden' }));
    expect(screen.getByText('fog')).toBeTruthy();
    // A `show` this build has not heard of is skipped, as an arm is.
    expect(screen.queryByText('Secret')).toBeNull();
  });

  it('writes the whole value on Save, changed at the one field', async () => {
    answerWith([world()]);
    await renderRegion('panel');

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const location = screen.getByRole('textbox', { name: 'Location' });
    await userEvent.clear(location);
    await userEvent.type(location, 'the chapel');
    await userEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Tide');
    await userEvent.type(screen.getByRole('textbox', { name: 'Value' }), 'rising');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.track.world', {
        ...WORLD,
        location: 'the chapel',
        fields: [{ name: 'Tide', value: 'rising' }],
      });
    });
  });

  it('locks and hides a field by writing the set the widget names', async () => {
    answerWith([world()]);
    await renderRegion('panel');

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const date = screen.getByRole('group', { name: 'Date' });
    await userEvent.click(within(date).getByRole('checkbox', { name: 'Lock' }));
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.track.locks', [
        'se.track.world/location',
        'se.track.world/date',
      ]);
    });
    const weather = screen.getByRole('group', { name: 'Weather' });
    await userEvent.click(within(weather).getByRole('checkbox', { name: 'Hide' }));
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.track.hidden', []);
    });
  });

  it('ticks a quest objective straight from the card', async () => {
    const quests = [
      {
        name: 'The key',
        objectives: [
          { text: 'Find the vault', completed: false },
          { text: 'Open it', completed: false },
        ],
        completed: false,
      },
    ];
    answerWith([
      world({
        key: 'se.track.quests',
        channelId: 'se.track.quests',
        label: 'Quests',
        record: {
          value: quests,
          fields: [{ key: '', label: 'Quests', show: 'checklists' }],
          locks: null,
          hidden: null,
        },
      }),
    ]);
    await renderRegion('panel');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Find the vault' }));
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.track.quests', [
        {
          ...quests[0],
          objectives: [
            { text: 'Find the vault', completed: true },
            { text: 'Open it', completed: false },
          ],
        },
      ]);
    });
  });

  it('heads a per-character card with who it is about, and draws stats as bars', async () => {
    answerWith([
      world({
        key: 'se.track.character#a-vera',
        channelId: 'se.track.character',
        scopeKey: 'a-vera',
        label: 'Character',
        record: {
          value: { mood: 'wary', stats: [{ name: 'Patience', value: 3, max: 10 }] },
          fields: [
            { key: 'mood', label: 'Mood', show: 'line' },
            { key: 'stats', label: 'Stats', show: 'meters' },
          ],
          locks: null,
          hidden: null,
        },
      }),
      surface({
        region: 'panel',
        key: 'x.health',
        kind: 'meter',
        label: 'Health',
        image: undefined,
        meter: { value: 7, min: 0, max: 10 },
      }),
    ]);
    await renderRegion('panel', undefined, (actorId) => (actorId === 'a-vera' ? 'Vera' : actorId));

    expect(screen.getByText('Character: Vera')).toBeTruthy();
    const bars = screen.getAllByRole('meter');
    expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual(['Health', 'Patience']);
    expect(screen.getByText('3/10')).toBeTruthy();
  });

  /**
   * ***A row lock is shown and cleared*** (2026-09-29, the review) — the grain
   * the step writes back and the Marinara import writes, and a path the card
   * cannot place is listed with a way to clear it rather than held invisibly.
   */
  it('marks a locked row, clears it from the editor, and lists a lock it cannot place', async () => {
    const rowLock = 'se.track.character#a-vera/stats/Patience';
    const stray = 'se.track.character#a-vera/fields/gone';
    const card = (): Record<string, unknown> =>
      world({
        key: 'se.track.character#a-vera',
        channelId: 'se.track.character',
        scopeKey: 'a-vera',
        label: 'Character',
        record: {
          value: { mood: 'wary', stats: [{ name: 'Patience', value: 3, max: 10 }] },
          fields: [
            { key: 'mood', label: 'Mood', show: 'line' },
            { key: 'stats', label: 'Stats', show: 'meters' },
          ],
          locks: { key: 'se.track.locks', paths: [rowLock, stray] },
          hidden: { key: 'se.track.hidden', paths: [] },
        },
      });

    answerWith([card()]);
    await renderRegion('panel');
    expect(screen.getByRole('meter').getAttribute('aria-label')).toBe('Patience (locked)');

    // The lock the card has no row for, listed and cleared.
    expect(screen.getByText('fields › gone — locked')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.track.locks', [rowLock]);
    });

    // The row's own lock, on the row in the editor.
    writeSessionChannel.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const stats = screen.getByRole('group', { name: 'Stats' });
    const locks = within(stats).getAllByRole('checkbox', { name: 'Lock' });
    // The Patience row's, under its row, then the field's own.
    expect(locks.map((one) => (one as HTMLInputElement).checked)).toEqual([true, false]);
    const [rowLocked] = locks;
    if (rowLocked === undefined) throw new Error('no row lock');
    await userEvent.click(rowLocked);
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.track.locks', [stray]);
    });
  });

  it('offers a declared action, and runs its step', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ModeActions
          sessionId={SESSION_ID}
          actions={[{ stepId: 'se.scene.track', label: 'Update trackers' }]}
        />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Update trackers' }));
    await waitFor(() => {
      expect(runSessionStep).toHaveBeenCalledWith(SESSION_ID, 'se.scene.track');
    });
  });

  it('offers nothing when the server lists no action', () => {
    const client = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={client}>
        <ModeActions sessionId={SESSION_ID} actions={[]} />
      </QueryClientProvider>,
    );
    expect(container.textContent).toBe('');
  });
});
