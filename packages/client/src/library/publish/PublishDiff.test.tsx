// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Closure,
  PUBLISH_RECORD_SCHEMA,
  type PublishPreview,
  type PublishRecord,
} from '@storyengine/shared';

import { formatTimestamp } from '../../format.js';
import { graph, previewOf, worldOf } from './test-closure.js';

/**
 * ***Re-publishing opens on the diff*** — [16 §5](../../../../../docs/design/16-publish.md),
 * [P16.3h](../../../../../docs/design/workplan/35-p16-world.md): the review's
 * half of it, as the plan lists it — *opens first*, *follows the checkboxes
 * live*, *Choose as last time never ticks an untold session* — and the
 * history flag it restores.
 *
 * **The preview is the route's shape, built by hand** (`test-closure.ts`), and
 * its `previous` a ledger record as the confirm writes one; the review draws
 * both through the real `fileSet` and the real `publishDiff`, so a case here is
 * what a person sees for this World and this last file. The confirm is a stub
 * whose arguments are asserted, because the ticks *Choose as last time* sets
 * are only worth anything if they are the ones that leave.
 */

const previewPublish = vi.fn();
const publish = vi.fn();

vi.mock('../../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.js')>()),
  api: {
    previewPublish: (...a: unknown[]) => previewPublish(...a) as unknown,
    publish: (...a: unknown[]) => publish(...a) as unknown,
    takeFile: vi.fn(),
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const { PublishPage } = await import('./PublishPage.js');

beforeEach(() => {
  vi.clearAllMocks();
});

function show(preview: PublishPreview): void {
  previewPublish.mockResolvedValue(preview);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PublishPage start={preview.closure.start} locale="en-GB" onFile={vi.fn()} />
    </QueryClientProvider>,
  );
}

const facts = (turns: number, digest = `sha256:${String(turns)}`) => ({
  turns,
  pictures: 0,
  attachments: 0,
  missingPixels: 0,
  entries: 1,
  bytes: 1024,
  digest,
});

/**
 * ***Rain City, published once before*** — a treatment, its required book and
 * its cast; a book only the World holds; two sessions, *Night Market* sent
 * last time and played on since, *Dusk* never sent.
 */
function rainCity(
  more: Partial<PublishRecord> = {},
  world: Partial<NonNullable<Closure['world']>> = {},
): PublishPreview {
  const closure = graph()
    .found('rain', 'storyengine.treatment/1', { name: 'The Drowned Bell' })
    .found('harbour', 'storyengine.lorebook/1', {
      name: 'Harbour',
      contentHash: 'sha256:harbour-edited',
    })
    .found('vera', 'storyengine.actor/1', { name: 'Vera' })
    .found('streets', 'storyengine.lorebook/1', { name: 'Rain City streets' })
    .session('night', {
      name: 'Night Market',
      headTurnId: 'turn-13',
      updatedAt: '2026-10-11T08:00:00.000Z',
      facts: facts(13),
    })
    .session('dusk', { name: 'Dusk', facts: facts(2) })
    .edge(null, 'rain', 'world.member')
    .edge(null, 'streets', 'world.member')
    .edge(null, 'night', 'world.member')
    .edge(null, 'dusk', 'world.member')
    .edge('rain', 'harbour', 'treatment.lore')
    .edge('rain', 'vera', 'treatment.cast')
    .closure('world', worldOf('Rain City', world));
  const previous: PublishRecord = {
    schema: PUBLISH_RECORD_SCHEMA,
    at: '2026-10-03T10:00:00.000Z',
    build: null,
    origin: 'world',
    start: ['world-1'],
    world: {
      id: 'world-1',
      name: 'Rain City',
      kept: 'existing',
      version: '1.0.0',
      about: 'sha256:about',
    },
    fileName: 'rain-city.seworld',
    bytes: 1,
    entries: 1,
    objects: [
      {
        schema: 'storyengine.treatment/1',
        id: 'rain',
        name: 'The Drowned Bell',
        contentHash: 'sha256:rain',
      },
      {
        schema: 'storyengine.lorebook/1',
        id: 'harbour',
        name: 'Harbor',
        contentHash: 'sha256:harbour',
      },
      { schema: 'storyengine.actor/1', id: 'vera', name: 'Vera', contentHash: 'sha256:vera' },
      {
        schema: 'storyengine.lorebook/1',
        id: 'pier',
        name: 'Old Pier',
        contentHash: 'sha256:pier',
      },
    ],
    sessions: [
      {
        id: 'night',
        name: 'Night Market',
        headTurnId: 'turn-10',
        turns: 10,
        updatedAt: '2026-10-03T09:00:00.000Z',
        digest: 'sha256:10',
      },
    ],
    offered: { objects: 4, sessions: 1 },
    unticked: [],
    ticked: ['night'],
    history: false,
    justTheObject: false,
    missing: 0,
    drift: false,
    ...more,
  };
  return previewOf(closure, { previous });
}

const diffSection = (): HTMLElement =>
  screen.getByRole('heading', { name: 'What changed since the last file' }).closest('section')!;
const lines = (): string[] =>
  within(diffSection())
    .getAllByRole('listitem')
    .map((item) => item.textContent);
const box = (label: string): HTMLInputElement => screen.getByLabelText<HTMLInputElement>(label);

describe('opening on the diff', () => {
  it('opens first: under the title, above every row, session and choice', async () => {
    show(rainCity());
    const diff = (
      await screen.findByRole('heading', { name: 'What changed since the last file' })
    ).closest('section')!;
    const title = screen.getByRole('heading', { level: 1, name: 'Rain City' });
    const members = screen.getByRole('heading', { name: 'Members of this world' });
    const sessions = screen.getByRole('heading', { name: 'Sessions in this world' });
    const history = box('Include each object’s edit history');

    // The page's own title, then the diff, then everything else the review says.
    const precedes = (a: Node, b: Node): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(precedes(title, diff)).toBe(true);
    for (const after of [members, sessions, history]) expect(precedes(diff, after)).toBe(true);
    // Nothing of the review's own sits between the title and the diff.
    const headings = screen.getAllByRole('heading').map((one) => one.textContent);
    expect(headings.slice(0, 2)).toEqual(['Rain City', 'What changed since the last file']);
    // The moment in the reader's own zone, by the function the page uses —
    // a literal time of day is true only where the runner's clock is UTC.
    const when = formatTimestamp('2026-10-03T10:00:00.000Z', 'en-GB');
    expect(
      within(diff).getByText(`The last file was “rain-city.seworld”, published ${when}.`),
    ).toBeTruthy();
  });

  it('draws no diff for a World never published, nor for a start that is not a World', async () => {
    show(previewOf(rainCity().closure, { previous: null }));
    await screen.findByRole('heading', { name: 'Members of this world' });
    expect(screen.queryByRole('heading', { name: 'What changed since the last file' })).toBeNull();
  });

  it('draws no diff for a selection, even handed a record', async () => {
    // The server answers `previous` for a World start alone; a record handed to
    // a selection anyway — a later server, a hand-built answer — is not one
    // this file is a re-publish of.
    const closure = graph()
      .found('vera', 'storyengine.actor/1', { name: 'Vera' })
      .found('harbour', 'storyengine.lorebook/1', { name: 'Harbour' })
      .edge(null, 'vera', 'selected')
      .edge(null, 'harbour', 'selected')
      .closure('selection');
    show(previewOf(closure, { previous: rainCity().previous }));
    await screen.findByRole('heading', { name: 'You chose these' });
    expect(screen.queryByRole('heading', { name: 'What changed since the last file' })).toBeNull();
  });

  it('says every change as a sentence: added, changed and renamed, no longer reached, a session not ticked, and what did not move', async () => {
    show(rainCity());
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    expect(lines()).toEqual([
      '“Rain City streets” (lorebook) is in this file and was not in the last.',
      '“Harbour” (lorebook) has changed since the last file. It was called “Harbor” then.',
      '“Old Pier” (lorebook) was in the last file, and nothing in this world reaches it now.',
      'The session “Night Market” was in the last file, and is not ticked now.',
      '2 things are as they were in the last file.',
    ]);
    // No table: every change is text a phone and a screen reader read whole.
    expect(within(diffSection()).queryByRole('table')).toBeNull();
  });

  it('says why each thing in the last file is not in this one, sessions included', async () => {
    const closure = graph()
      .found('rain', 'storyengine.treatment/1', { name: 'The Drowned Bell' })
      .found('atlas', 'storyengine.lorebook/1', {
        name: 'Atlas',
        facts: {
          entries: 0,
          bytes: 0,
          pictures: { count: 0, bytes: 0 },
          history: { versions: 0, entries: 0, bytes: 0 },
          omitted: [{ ref: 'lorebook.json', bytes: 70 * 1024 * 1024 }],
        },
      })
      // Members the World still names, deleted since: the walk records the
      // id each was named by (`lamp-id`, `dawn-id`).
      .missing('lamp', 'storyengine.lorebook/1', 'Lamp Room')
      .missing('dawn', 'storyengine.session/1', 'Dawn')
      .session('dusk', { name: 'Dusk' })
      .edge(null, 'rain', 'world.member')
      .edge(null, 'atlas', 'world.member')
      .edge(null, 'lamp', 'world.member')
      .edge(null, 'dawn', 'world.member')
      .edge(null, 'dusk', 'world.member')
      .closure('world', worldOf());
    const record = rainCity().previous!;
    show(
      previewOf(closure, {
        previous: {
          ...record,
          objects: [
            {
              schema: 'storyengine.lorebook/1',
              id: 'atlas',
              name: 'Atlas',
              contentHash: 'sha256:atlas',
            },
            {
              schema: 'storyengine.lorebook/1',
              id: 'lamp-id',
              name: 'Lamp Room',
              contentHash: 'sha256:lamp',
            },
          ],
          sessions: [
            { id: 'dusk', name: 'Dusk', headTurnId: null, turns: 0, updatedAt: '', digest: '' },
            { id: 'dawn-id', name: 'Dawn', headTurnId: null, turns: 0, updatedAt: '', digest: '' },
            {
              id: 'away',
              name: 'Moved Away',
              headTurnId: null,
              turns: 0,
              updatedAt: '',
              digest: '',
            },
          ],
          ticked: ['dusk', 'dawn-id', 'away'],
          history: true,
        },
      }),
    );
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    expect(lines()).toEqual([
      '“The Drowned Bell” (treatment) is in this file and was not in the last.',
      '“Atlas” (lorebook) was in the last file, and is now larger than one file in a world may be, so it stays home.',
      '“Lamp Room” (lorebook) was in the last file, and is not in your library any more.',
      'The session “Dusk” was in the last file, and is not ticked now.',
      'The session “Dawn” was in the last file, and is not in your library any more.',
      'The session “Moved Away” was in the last file, and is not in this world now.',
      'The last file included edit history, and this one does not.',
    ]);
  });
});

describe('the World and its sessions, said', () => {
  /**
   * ***The World itself*** (2026-10-11, the P16.3h review) — [16 §5]'s *send
   * them 1.2* is a version: a World renamed, re-versioned and re-described is
   * said as such, first, and *nothing has changed* is never drawn over it.
   */
  it('says the World renamed, re-versioned and re-described, first', async () => {
    show(
      rainCity({}, { name: 'Rain City Redux', version: '1.2.0', about: 'sha256:now-with-tides' }),
    );
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    expect(lines().slice(0, 3)).toEqual([
      'This file is version 1.2.0 of the world; the last was version 1.0.0.',
      'This world was called “Rain City” in the last file.',
      'The world’s own description, pictures or requirements have changed since the last file.',
    ]);
    expect(within(diffSection()).queryByText(/^Nothing in it has changed/)).toBeNull();
  });

  it('says a version cleared without quoting nothing', async () => {
    show(rainCity({}, { version: '' }));
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    expect(lines()[0]).toBe('The world’s version is not what it was in the last file.');
  });

  /**
   * ***A session that changed without being played*** — a rename, a hidden
   * turn, a picture drawn since — is its own sentence, its old name a second
   * one; a session played on and renamed says both; and what did not move is
   * counted.
   */
  it('says a session changed but not played, a session played on and renamed, and counts the rest', async () => {
    const closure = graph()
      .found('rain', 'storyengine.treatment/1', { name: 'The Drowned Bell' })
      .session('night', { name: 'Night Market', facts: facts(13) })
      .session('dawn', { name: 'Dawn Patrol', facts: facts(4, 'sha256:dawn-hidden') })
      .session('dusk', { name: 'Dusk', facts: facts(2, 'sha256:dusk') })
      .edge(null, 'rain', 'world.member')
      .edge(null, 'night', 'world.member')
      .edge(null, 'dawn', 'world.member')
      .edge(null, 'dusk', 'world.member')
      .closure('world', worldOf());
    const record = rainCity().previous!;
    show(
      previewOf(closure, {
        previous: {
          ...record,
          objects: [record.objects[0]!],
          sessions: [
            {
              id: 'night',
              name: 'Night Bazaar',
              headTurnId: 't-10',
              turns: 10,
              updatedAt: '',
              digest: 'sha256:10',
            },
            {
              id: 'dawn',
              name: 'Dawn',
              headTurnId: 'd-4',
              turns: 4,
              updatedAt: '',
              digest: 'sha256:dawn',
            },
            {
              id: 'dusk',
              name: 'Dusk',
              headTurnId: 'k-2',
              turns: 2,
              updatedAt: '',
              digest: 'sha256:dusk',
            },
          ],
          ticked: ['night', 'dawn', 'dusk'],
        },
      }),
    );
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    for (const name of ['Night Market', 'Dawn Patrol', 'Dusk']) await userEvent.click(box(name));
    expect(lines()).toEqual([
      'The session “Night Market” has been played on since the last file, and holds 3 turns more than it did. It was called “Night Bazaar” then.',
      'The session “Dawn Patrol” has changed since the last file, though it holds no more turns than it did. It was called “Dawn” then.',
      '1 thing is as it was in the last file.',
      '1 session is as it was in the last file.',
    ]);
  });

  it('counts more than one session as it was', async () => {
    const closure = graph()
      .session('dawn', { name: 'Dawn', facts: facts(4, 'sha256:dawn') })
      .session('dusk', { name: 'Dusk', facts: facts(2, 'sha256:dusk') })
      .edge(null, 'dawn', 'world.member')
      .edge(null, 'dusk', 'world.member')
      .closure('world', worldOf());
    const record = rainCity().previous!;
    show(
      previewOf(closure, {
        previous: {
          ...record,
          objects: [],
          sessions: [
            {
              id: 'dawn',
              name: 'Dawn',
              headTurnId: null,
              turns: 4,
              updatedAt: '',
              digest: 'sha256:dawn',
            },
            {
              id: 'dusk',
              name: 'Dusk',
              headTurnId: null,
              turns: 2,
              updatedAt: '',
              digest: 'sha256:dusk',
            },
          ],
          ticked: ['dawn', 'dusk'],
        },
      }),
    );
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    await userEvent.click(screen.getByRole('button', { name: 'Choose as last time' }));
    expect(lines()).toEqual(['2 sessions are as they were in the last file.']);
  });
});

/**
 * ***It follows the checkboxes*** — the diff is `publishDiff` over the same
 * `FileSet` the rows are drawn from, so a tick moves a line as the box changes.
 */
describe('following the ticks', () => {
  it('moves a row and a session between its sentences as their boxes change', async () => {
    show(rainCity());
    await screen.findByRole('heading', { name: 'What changed since the last file' });

    await userEvent.click(box('Include “Vera”'));
    expect(lines()).toContain(
      '“Vera” (actor) was in the last file, and what is ticked now leaves it out.',
    );
    expect(lines()).toContain('1 thing is as it was in the last file.');

    await userEvent.click(box('Night Market'));
    expect(lines()).not.toContain(
      'The session “Night Market” was in the last file, and is not ticked now.',
    );
    expect(lines()).toContain(
      'The session “Night Market” has been played on since the last file, and holds 3 turns more than it did.',
    );

    await userEvent.click(box('Dusk'));
    expect(lines()).toContain('The session “Dusk” is ticked, and was not in the last file.');

    await userEvent.click(box('Include each object’s edit history'));
    expect(lines()).toContain('This file includes edit history, and the last one did not.');
  });

  it('says nothing changed when nothing did', async () => {
    const preview = rainCity({
      objects: [
        {
          schema: 'storyengine.treatment/1',
          id: 'rain',
          name: 'The Drowned Bell',
          contentHash: 'sha256:rain',
        },
        {
          schema: 'storyengine.lorebook/1',
          id: 'harbour',
          name: 'Harbour',
          contentHash: 'sha256:harbour-edited',
        },
        { schema: 'storyengine.actor/1', id: 'vera', name: 'Vera', contentHash: 'sha256:vera' },
        {
          schema: 'storyengine.lorebook/1',
          id: 'streets',
          name: 'Rain City streets',
          contentHash: 'sha256:streets',
        },
      ],
      sessions: [],
      ticked: [],
    });
    show(preview);
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    expect(
      within(diffSection()).getByText(
        'Nothing in it has changed since then: every object and session would leave as it did.',
      ),
    ).toBeTruthy();
    expect(lines()).toEqual(['4 things are as they were in the last file.']);
  });
});

/**
 * ***Choose as last time*** — [P16.3h]'s rule: *defaults stay the table's*, and
 * the button applies the last record's unticks and ticks and its history flag,
 * **never ticking a session it was not told to tick**.
 */
describe('choose as last time', () => {
  it('opens on the defaults, whatever was chosen last time', async () => {
    show(rainCity({ unticked: [{ id: 'vera', required: false }], history: true }));
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    expect(box('Night Market').checked).toBe(false);
    expect(box('Include “Vera”').checked).toBe(true);
    expect(box('Include each object’s edit history').checked).toBe(false);
    expect(within(diffSection()).getByRole('status').textContent).toBe('');
  });

  it('applies the last ticks, unticks and history — and ticks no session it was not told to', async () => {
    show(
      rainCity({
        unticked: [{ id: 'vera', required: false }],
        // Dusk is in the record's sessions — a hand-edited line, which no build
        // writes — and not in its ticks: holding is not being told to tick.
        sessions: [
          {
            id: 'night',
            name: 'Night Market',
            headTurnId: 'turn-10',
            turns: 10,
            updatedAt: '2026-10-03T09:00:00.000Z',
            digest: 'sha256:10',
          },
          { id: 'dusk', name: 'Dusk', headTurnId: null, turns: 2, updatedAt: '', digest: '' },
        ],
        ticked: ['night', 'no-longer-here'],
        history: true,
      }),
    );
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    // The person's own tick on a session the last file was not told to tick.
    await userEvent.click(box('Dusk'));
    expect(box('Dusk').checked).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Choose as last time' }));

    expect(box('Night Market').checked).toBe(true);
    expect(box('Dusk').checked).toBe(false);
    expect(box('Include “Vera”').checked).toBe(false);
    expect(box('Include “Harbour”').checked).toBe(true);
    expect(box('Include each object’s edit history').checked).toBe(true);
    expect(within(diffSection()).getByRole('status').textContent).toBe(
      'Your choices from the last file are in place, and history is as it was then.',
    );

    // And those are the choices that leave.
    publish.mockResolvedValue({
      blob: new Blob(),
      fileName: 'rain-city.seworld',
      world: null,
      notes: [],
      missing: 0,
      drift: false,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(publish.mock.calls[0]?.[1]).toEqual({
      ticked: { night: true, vera: false },
      history: true,
      keep: 'world',
    });
  });

  /**
   * ***It never turns on what the person turned off, unless the last file
   * held it*** (2026-10-11, the P16.3h review). A book added to the World
   * since opens ticked — the table's default — and the person who unticks it
   * and then asks for last time's choices has said twice they do not want it
   * sent: the last file never held it, and the record never ticked it. A
   * thing the last file *did* hold comes back on, which is what *as last
   * time* means.
   */
  it('keeps off what is new since and was unticked, and puts back on what the last file held', async () => {
    show(rainCity());
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    await userEvent.click(box('Include “Rain City streets”'));
    await userEvent.click(box('Include “Vera”'));
    expect(box('Include “Rain City streets”').checked).toBe(false);
    expect(box('Include “Vera”').checked).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Choose as last time' }));

    expect(box('Include “Rain City streets”').checked).toBe(false);
    expect(box('Include “Vera”').checked).toBe(true);
    expect(box('Night Market').checked).toBe(true);
    expect(lines()).not.toContain(
      '“Rain City streets” (lorebook) is in this file and was not in the last.',
    );
    expect(within(diffSection()).getByRole('status').textContent).toBe(
      'Your choices from the last file are in place, and history is as it was then.',
    );

    publish.mockResolvedValue({
      blob: new Blob(),
      fileName: 'rain-city.seworld',
      world: null,
      notes: [],
      missing: 0,
      drift: false,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(publish.mock.calls[0]?.[1]).toMatchObject({
      ticked: { streets: false, night: true },
    });
    expect(publish.mock.calls[0]?.[1].ticked).not.toHaveProperty('vera', false);
  });

  it('says what it does to what is new since', async () => {
    show(rainCity());
    const button = await screen.findByRole('button', { name: 'Choose as last time' });
    expect(button.getAttribute('aria-describedby')).not.toBeNull();
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Puts back what you ticked and unticked for the last file, and history as it was then. A session you did not tick then is unticked; anything new since stays as you have it.',
    );
  });

  /**
   * ***History both ways*** — a last file made without history turns the box
   * back off, and the status line follows the history box as it follows the
   * rest.
   */
  it('turns history back off when the last file had none, and the status follows the history box', async () => {
    show(rainCity({ history: false }));
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    await userEvent.click(box('Include each object’s edit history'));
    expect(box('Include each object’s edit history').checked).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Choose as last time' }));
    const status = within(diffSection()).getByRole('status');
    expect(box('Include each object’s edit history').checked).toBe(false);
    expect(status.textContent).toBe(
      'Your choices from the last file are in place, and history is as it was then.',
    );

    await userEvent.click(box('Include each object’s edit history'));
    expect(status.textContent).toBe('');
  });

  it('leaves home what a record names both ticked and unticked', async () => {
    // No build writes such a line; a hand-edited one is read so the one way
    // the button can be wrong is by leaving something home.
    show(rainCity({ ticked: ['night', 'vera'], unticked: [{ id: 'vera', required: false }] }));
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    await userEvent.click(screen.getByRole('button', { name: 'Choose as last time' }));
    expect(box('Include “Vera”').checked).toBe(false);
  });

  it('stops saying the boxes are as last time once one moves', async () => {
    show(rainCity());
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    await userEvent.click(screen.getByRole('button', { name: 'Choose as last time' }));
    const status = within(diffSection()).getByRole('status');
    expect(status.textContent).toBe(
      'Your choices from the last file are in place, and history is as it was then.',
    );
    await userEvent.click(box('Include “Vera”'));
    expect(status.textContent).toBe('');
  });
});

/**
 * ***After publishing on the page*** (2026-10-11, the P16.3h review). The
 * ledger's line for the file just made is written when its download
 * finishes, so the record this page was drawn from is no longer *the last
 * file*: the diff stops comparing with it and says so, *Choose as last time*
 * goes until there is a record to choose from, and *Look again* draws the
 * diff against the file just made.
 */
describe('after publishing on the page', () => {
  it('stops presenting the older file as the last, until a look again compares with the new one', async () => {
    const first = rainCity();
    show(first);
    await screen.findByRole('heading', { name: 'What changed since the last file' });
    publish.mockResolvedValue({
      blob: new Blob(),
      fileName: 'rain-city.seworld',
      world: null,
      notes: [],
      missing: 0,
      drift: false,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await screen.findByText('Saved rain-city.seworld.');

    const section = diffSection();
    expect(
      within(section).getByText(
        'You have just published this world, so the last file is the one you made. Look again to compare with it.',
      ),
    ).toBeTruthy();
    expect(within(section).queryByText(/^The last file was/)).toBeNull();
    expect(within(section).queryAllByRole('listitem')).toEqual([]);
    expect(within(section).queryByRole('button', { name: 'Choose as last time' })).toBeNull();

    // The next look reads the line the publish wrote.
    const made: PublishRecord = {
      ...first.previous!,
      at: '2026-10-11T09:00:00.000Z',
      fileName: 'rain-city-2.seworld',
      objects: [
        ...first.previous!.objects.filter((one) => one.id !== 'pier' && one.id !== 'harbour'),
        {
          schema: 'storyengine.lorebook/1',
          id: 'harbour',
          name: 'Harbour',
          contentHash: 'sha256:harbour-edited',
        },
        {
          schema: 'storyengine.lorebook/1',
          id: 'streets',
          name: 'Rain City streets',
          contentHash: 'sha256:streets',
        },
      ],
      sessions: [],
      ticked: [],
    };
    previewPublish.mockResolvedValue({ ...first, previous: made });
    await userEvent.click(screen.getByRole('button', { name: 'Look again' }));
    const when = formatTimestamp('2026-10-11T09:00:00.000Z', 'en-GB');
    expect(
      await within(diffSection()).findByText(
        `The last file was “rain-city-2.seworld”, published ${when}.`,
      ),
    ).toBeTruthy();
    expect(within(diffSection()).getByRole('button', { name: 'Choose as last time' })).toBeTruthy();
  });
});
