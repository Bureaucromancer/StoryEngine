// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PRESET_SCHEMA, type PublishPreview, type PublishStart } from '@storyengine/shared';

import { graph, previewOf, worldOf } from './test-closure.js';

/**
 * ***The review*** — [16 §5](../../../../../docs/design/16-publish.md),
 * [P16.3g](../../../../../docs/design/workplan/34-p16-world.md): its tests, as
 * the plan lists them, and the facts the fact check owed to the session row.
 *
 * **The preview is the route's shape, built by hand** (`test-closure.ts`), and
 * the review draws it through the real `fileSet` — so a case here is *what a
 * person sees for this closure*, and the rule for what is in the file is the
 * one the confirm writes with. The confirm is a stub; what it is sent is
 * asserted, because the ticks the review sends are the whole of its output.
 */

const previewPublish = vi.fn();
const publish = vi.fn();
const takeFile = vi.fn();

vi.mock('../../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.js')>()),
  api: {
    previewPublish: (...a: unknown[]) => previewPublish(...a) as unknown,
    publish: (...a: unknown[]) => publish(...a) as unknown,
    takeFile: (...a: unknown[]) => takeFile(...a) as unknown,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    params,
  }: {
    children: React.ReactNode;
    to?: string;
    search?: Record<string, unknown>;
    params?: Record<string, unknown>;
  }) => (
    <a
      href="#"
      data-to={to ?? ''}
      data-search={JSON.stringify(search ?? {})}
      data-params={JSON.stringify(params ?? {})}
    >
      {children}
    </a>
  ),
}));

const { ApiError, PublishError } = await import('../../api.js');
const { PublishPage } = await import('./PublishPage.js');

const onFile = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

function show(preview: PublishPreview, start?: PublishStart): void {
  previewPublish.mockResolvedValue(preview);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PublishPage start={start ?? preview.closure.start} locale="en-GB" onFile={onFile} />
    </QueryClientProvider>,
  );
}

/** A World start's preview: a treatment, its books, its cast, a session, a built-in preset. */
function rainCity(): PublishPreview {
  return previewOf(
    graph()
      .found('rain', 'storyengine.treatment/1', { name: 'The Drowned Bell' })
      .found('harbour', 'storyengine.lorebook/1', {
        name: 'Harbour',
        required: true,
        facts: {
          entries: 3,
          bytes: 48 * 1024,
          pictures: { count: 2, bytes: 40 * 1024 },
          history: { versions: 2, entries: 3, bytes: 4096 },
          omitted: [],
        },
      })
      .found('vera', 'storyengine.actor/1', { name: 'Vera' })
      .found('vera-book', 'storyengine.lorebook/1', { name: 'What the quay knows' })
      .found('pack', PRESET_SCHEMA, {
        name: 'Wet Prose',
        owner: 'system',
        defaultOn: false,
        optional: true,
      })
      .found('keeper', 'storyengine.actor/1', { name: 'The Keeper' })
      .found('memories', 'storyengine.lorebook/1', {
        name: 'What Ned remembers',
        writtenByPlay: true,
      })
      .missing('missing:1', 'storyengine.lorebook/1', 'Old Pier')
      .session('night', {
        name: 'Night Market',
        leavesBehind: ['roles'],
        facts: {
          turns: 214,
          pictures: 23,
          attachments: 1,
          missingPixels: 0,
          entries: 30,
          bytes: 41 * 1024 * 1024,
          digest: 'sha256:night',
        },
      })
      .edge(null, 'rain', 'world.member')
      .edge(null, 'pack', 'world.member')
      .edge(null, 'memories', 'world.member')
      .edge(null, 'night', 'world.member')
      .edge('rain', 'harbour', 'treatment.lore', { required: true })
      .edge('rain', 'vera', 'treatment.cast', { resolvedBy: 'name' })
      .edge('rain', 'missing:1', 'treatment.lore')
      .edge('vera', 'vera-book', 'actor.lore')
      .edge('night', 'keeper', 'session.cast.arrived')
      .closure('world', worldOf()),
    { modeVersions: {} },
  );
}

const section = (name: string): HTMLElement =>
  screen.getByRole('heading', { name }).closest('section')!;

describe('what is being published', () => {
  it('says a World by its name, and that it is a world', async () => {
    show(rainCity());
    expect(await screen.findByRole('heading', { level: 1, name: 'Rain City' })).toBeTruthy();
    expect(screen.getByText(/^This world, with everything it holds/)).toBeTruthy();
  });

  it('says a selection by how many were chosen, and points at a World that holds exactly them', async () => {
    const closure = graph()
      .found('vera', 'storyengine.actor/1', { name: 'Vera' })
      .found('harbour', 'storyengine.lorebook/1', { name: 'Harbour' })
      .edge(null, 'vera', 'selected')
      .edge(null, 'harbour', 'selected')
      .closure('selection');
    show(previewOf(closure, { sameAs: [{ id: 'w-9', name: 'Old Rain City' }] }));

    expect(
      await screen.findByRole('heading', { level: 1, name: '2 things you chose' }),
    ).toBeTruthy();
    const link = screen.getByRole('link', {
      name: '“Old Rain City” already holds exactly these — publish that world instead.',
    });
    expect(link.getAttribute('data-search')).toBe(JSON.stringify({ world: 'w-9' }));
  });
});

/**
 * ***Every level, every reason as text*** — [16 §5]'s *every level is shown*,
 * and [P16.3]'s plan: *no reason only in a hover title*.
 */
describe('the closure, every level', () => {
  it('groups by depth, with every reason as text', async () => {
    show(rainCity());
    await screen.findByRole('heading', { name: 'Members of this world' });

    expect(within(section('Members of this world')).getByText('The Drowned Bell')).toBeTruthy();
    const named = section('What they name');
    expect(within(named).getByText('Harbour')).toBeTruthy();
    expect(
      within(named).getByText('The treatment “The Drowned Bell” links it as lore.'),
    ).toBeTruthy();
    expect(
      within(named).getByText('In the cast of the treatment “The Drowned Bell”.'),
    ).toBeTruthy();
    const twoOut = section('Two steps out');
    expect(within(twoOut).getByText('What the quay knows')).toBeTruthy();
    expect(
      within(twoOut).getByText('The character “Vera” links it as their own lore.'),
    ).toBeTruthy();

    // Found by name, the required mark, pictures and size, the built-in source:
    // all text on the row.
    expect(screen.getByText(/^Found by its name/)).toBeTruthy();
    expect(screen.getByText('Marked required.')).toBeTruthy();
    expect(screen.getByText('2 pictures, 48 KB')).toBeTruthy();
    expect(screen.getByText(/^From the built-in library/)).toBeTruthy();
    expect(screen.getByText(/^A preset is tuning rather than content/)).toBeTruthy();
    // A reference that resolves to nothing, under the row that names it.
    const bell = screen.getByText('The Drowned Bell').closest('li') as HTMLElement;
    expect(
      within(bell).getByText(
        'Not in your library: “Old Pier” (lorebook). The file says it is missing.',
      ),
    ).toBeTruthy();

    // No table, and nothing said only in a hover title.
    expect(document.querySelector('table')).toBeNull();
    expect(document.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('starts a built-in object off and a user’s on', async () => {
    show(rainCity());
    expect((await screen.findByLabelText<HTMLInputElement>('Include “Wet Prose”')).checked).toBe(
      false,
    );
    expect(screen.getByLabelText<HTMLInputElement>('Include “Harbour”').checked).toBe(true);
  });

  /**
   * ***The memory book stays home, and its row says why*** — [P16.3c]'s
   * decision, `fileSet`'s rule since [P16.3d]: no tick could send it, so it
   * has no checkbox, and the row says what play wrote and why that stays.
   */
  it('shows a book play wrote staying home, with no checkbox, and why', async () => {
    show(rainCity());
    const row = (await screen.findByText('What Ned remembers')).closest('li') as HTMLElement;
    expect(within(row).queryByRole('checkbox')).toBeNull();
    expect(
      within(row).getByText(/^Stays home whatever is ticked: play wrote this book/),
    ).toBeTruthy();
  });

  it('shows what only an unticked session reaches nowhere until the session is ticked', async () => {
    show(rainCity());
    await screen.findByRole('heading', { name: 'Members of this world' });
    expect(screen.queryByText('The Keeper')).toBeNull();

    await userEvent.click(screen.getByLabelText('Night Market'));

    const row = screen.getByText('The Keeper').closest('li') as HTMLElement;
    // Row 13's other half, worded as the walker computes it.
    expect(
      within(row).getByText(
        'In play in the session “Night Market”, though not in its configured cast.',
      ),
    ).toBeTruthy();
  });
});

/**
 * ***A required book left out warns, and Publish still goes*** — [16 §5]:
 * *permitted and warned about*, the one case where the review says plainly
 * that the recipient will be missing the world.
 */
describe('a required row left out', () => {
  it('warns on its row and beside the button, and publishes anyway', async () => {
    publish.mockResolvedValue({
      blob: new Blob(['zip']),
      fileName: 'Rain-City.seworld',
      world: null,
      drift: false,
      notes: [],
      missing: 0,
    });
    show(rainCity());
    await userEvent.click(await screen.findByLabelText('Include “Harbour”'));

    const row = screen.getByText('Harbour').closest('li') as HTMLElement;
    expect(
      within(row).getByText(/whoever opens the file will be missing the world, not a nice extra/),
    ).toBeTruthy();
    expect(screen.getByText('Before you publish:')).toBeTruthy();

    const button = screen.getByRole('button', { name: 'Publish' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(button);

    await waitFor(() => {
      expect(publish).toHaveBeenCalledTimes(1);
    });
    expect(publish.mock.calls[0]?.[1]).toMatchObject({ ticked: { harbour: false } });
  });
});

/**
 * ***Unticking never cascades; Leave these out too does, for one group*** —
 * [P16.3]'s plan, R1.
 */
describe('an orphan', () => {
  it('is labelled with what it came with, and Leave these out too unticks its group', async () => {
    show(rainCity());
    await userEvent.click(await screen.findByLabelText('Include “The Drowned Bell”'));

    // Vera and her book stay ticked, each saying what it came with.
    const vera = screen.getByRole('link', { name: 'Vera' }).closest('li') as HTMLElement;
    expect(
      within(vera).getByText(
        'Nothing left in the file names this — it came with “The Drowned Bell”.',
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Include “Vera”').checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Include “What the quay knows”').checked).toBe(
      true,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Leave these out too' }));

    expect(screen.getByLabelText<HTMLInputElement>('Include “Vera”').checked).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>('Include “What the quay knows”').checked).toBe(
      false,
    );
    // Harbour is in the same group — the treatment brought it, and nothing left
    // in the file names it — so it goes with the rest. *(Corrected 2026-10-11,
    // the P16.3g review: ~~only that group: the required book the treatment
    // brought is its own decision~~ — the comment said Harbour was outside the
    // group and the line under it expected it unticked, which is only true
    // because it is inside. The case below is the one that holds a group to
    // itself.)*
    expect(screen.getByLabelText<HTMLInputElement>('Include “Harbour”').checked).toBe(false);
    expect(screen.queryByRole('button', { name: 'Leave these out too' })).toBeNull();
  });

  /**
   * ***One group, and nothing outside it*** — R1's *Leave these out too* on
   * the group (`orphanGroups`): the books a dropped treatment brought go, the
   * ones a dropped setup brought stay for their own decision, and a row that
   * was never an orphan is not touched. *Added 2026-10-11, the P16.3g review*:
   * the case above has one group and nothing ticked outside it, so a button
   * that unticked the whole closure, or one group holding every orphan, passed.
   */
  it('unticks its own group only, leaving another group and every other row as they were', async () => {
    const closure = graph()
      .found('rain', 'storyengine.treatment/1', { name: 'The Drowned Bell' })
      .found('docks', 'storyengine.lorebook/1', { name: 'The Docks' })
      .found('ledger', 'storyengine.setup/1', { name: 'The Ledger' })
      .found('tide', 'storyengine.lorebook/1', { name: 'Tide Tables' })
      .found('vera', 'storyengine.actor/1', { name: 'Vera' })
      .edge(null, 'rain', 'world.member')
      .edge(null, 'ledger', 'world.member')
      .edge(null, 'vera', 'world.member')
      .edge('rain', 'docks', 'treatment.lore')
      .edge('ledger', 'tide', 'setup.lore')
      .closure('world', worldOf());
    show(previewOf(closure));
    await userEvent.click(await screen.findByLabelText('Include “The Drowned Bell”'));
    await userEvent.click(screen.getByLabelText('Include “The Ledger”'));
    expect(screen.getAllByRole('button', { name: 'Leave these out too' })).toHaveLength(2);

    const first = screen.getByText(/^These came with “The Drowned Bell”/).closest('div')!;
    await userEvent.click(within(first).getByRole('button', { name: 'Leave these out too' }));

    expect(screen.getByLabelText<HTMLInputElement>('Include “The Docks”').checked).toBe(false);
    // The setup's group is its own decision, and Vera was never an orphan.
    expect(screen.getByLabelText<HTMLInputElement>('Include “Tide Tables”').checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Include “Vera”').checked).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Leave these out too' })).toHaveLength(1);
    // The button that was pressed is gone; the keyboard is given the next group's.
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Leave these out too' }),
    );
  });

  it('gives the keyboard the first heading when the last group goes', async () => {
    show(rainCity());
    await userEvent.click(await screen.findByLabelText('Include “The Drowned Bell”'));
    await userEvent.click(screen.getByRole('button', { name: 'Leave these out too' }));
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Members of this world' }),
    );
  });
});

describe('sessions', () => {
  it('start off, each with what would leave with it', async () => {
    show(rainCity());
    const box = await screen.findByLabelText<HTMLInputElement>('Night Market');
    expect(box.checked).toBe(false);

    const row = box.closest('li') as HTMLElement;
    expect(within(row).getByText(/^214 turns, 23 pictures, 41\.0 MB, last played /)).toBeTruthy();
    expect(within(row).getByText('Brings 1 thing not otherwise in the file.')).toBeTruthy();
    expect(
      within(row).getByText(
        'The connections it was set to play with stay here: a file never carries a connection.',
      ),
    ).toBeTruthy();
    // The two facts the fact check named: said, not scrubbed.
    expect(within(row).getByText('Its turns record which model answered each one.')).toBeTruthy();
    expect(
      within(row).getByText(
        'Its recorded prompts may quote memories drawn from your other sessions, as the session sent them. A memory left out of a prompt for room travels without its words.',
      ),
    ).toBeTruthy();
  });

  it('send nothing ticked unless ticked', async () => {
    publish.mockResolvedValue({
      blob: new Blob(['zip']),
      fileName: 'Rain-City.seworld',
      world: null,
      drift: false,
      notes: [],
      missing: 0,
    });
    show(rainCity());
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    await waitFor(() => {
      expect(publish).toHaveBeenCalledTimes(1);
    });
    expect(publish.mock.calls[0]?.[1]).toEqual({ ticked: {}, history: false, keep: 'world' });
    // The treatment, its book, Vera and hers: not the built-in preset, not the
    // book play wrote, not what only the unticked session reaches.
    expect(screen.getByText(/^In the file: 4 objects, 0 sessions/)).toBeTruthy();
  });

  /** AA13: a World holding only sessions, none ticked. */
  it('says a file of only the world’s name, when nothing else would leave', async () => {
    const closure = graph()
      .session('night', { name: 'Night Market' })
      .edge(null, 'night', 'world.member')
      .closure('world', worldOf());
    show(previewOf(closure));

    expect(
      await screen.findByText('This file would hold the world’s name and nothing else.'),
    ).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Night Market'));
    expect(
      screen.queryByText('This file would hold the world’s name and nothing else.'),
    ).toBeNull();
  });
});

describe('history', () => {
  it('carries 03 §11.6’s sentence and what it would add', async () => {
    show(rainCity());
    const box = await screen.findByLabelText<HTMLInputElement>(
      'Include each object’s edit history',
    );
    expect(box.checked).toBe(false);
    expect(
      screen.getByText(
        /^Edit history is a working record — the false starts, the abandoned phrasings — that people do not necessarily intend to publish\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText('Adds 2 earlier versions, 4 KB.')).toBeTruthy();
  });
});

describe('what opening the file needs', () => {
  it('says what an older build does, and more when history is in it', async () => {
    show(rainCity());
    const needs = await screen.findByRole('heading', { name: 'What opening it needs' });
    const area = needs.closest('section')!;
    // Named by its boundary, not as *before this one*, which stops being true
    // the day a release carries the reader (2026-10-11, the P16.3g review).
    const older = within(area).getByText(
      /^Alpha 6 and earlier builds cannot read this as a world\./,
    );
    // Every picture but those inside a character's card: alpha 6 attaches no
    // folder picture of any kind, a treatment's no more than a lorebook's.
    expect(older.textContent).toContain('no picture except those inside a character’s card');
    expect(within(area).queryByText(/^With history included, alpha 6/)).toBeNull();

    await userEvent.click(screen.getByLabelText('Include each object’s edit history'));
    expect(within(area).getByText(/^With history included, alpha 6 also lands/)).toBeTruthy();
  });

  it('names a mode this install lacks, and a picture too large to travel', async () => {
    const closure = graph()
      .found('setup', 'storyengine.setup/1', {
        name: 'The Ledger',
        modes: ['example.mode'],
        facts: {
          entries: 1,
          bytes: 10,
          pictures: { count: 0, bytes: 0 },
          history: { versions: 0, entries: 0, bytes: 0 },
          omitted: [{ ref: 'assets/huge.png', bytes: 70 * 1024 * 1024 }],
        },
      })
      .edge(null, 'setup', 'world.member')
      .closure('world', worldOf());
    show(previewOf(closure, { modeVersions: { 'example.mode': null } }));

    expect(
      await screen.findByText(
        'The example.mode mode, which this install does not have: the file says it needs it, and whoever opens it is told.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'A picture of “The Ledger” (assets/huge.png, 70.0 MB) is larger than one file in a world may be, and stays behind.',
      ),
    ).toBeTruthy();
  });
});

describe('just the object', () => {
  it('offers Download as the primary door when nothing else would leave', async () => {
    const closure = graph()
      .found('vera', 'storyengine.actor/1', { name: 'Vera', canUncheck: false })
      .edge(null, 'vera', 'selected')
      .closure('object');
    show(previewOf(closure, { suggestedName: 'Vera', justTheObject: true }));

    const download = await screen.findByRole('link', { name: 'Download this actor' });
    expect(download.getAttribute('href')).toBe('/api/library/actors/vera/download');
    // The primary look: the action recipe, not an inline link.
    expect(download.className).toContain('bg-accent');
    expect(screen.getByText(/^Nothing else would leave with “Vera”/)).toBeTruthy();
    expect(screen.getByText('Publishing one object keeps nothing.')).toBeTruthy();
    // It is always in the file, so it has no checkbox to uncheck.
    expect(screen.queryByLabelText('Include “Vera”')).toBeNull();
  });

  it('does not, once something else would leave with it', async () => {
    const closure = graph()
      .found('vera', 'storyengine.actor/1', { name: 'Vera', canUncheck: false })
      .found('pack', PRESET_SCHEMA, { name: 'Wet Prose', owner: 'system', defaultOn: false })
      .edge(null, 'vera', 'selected')
      .edge('vera', 'pack', 'actor.lore')
      .closure('object');
    show(previewOf(closure, { suggestedName: 'Vera', justTheObject: true }));

    expect(await screen.findByRole('link', { name: 'Download this actor' })).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Include “Wet Prose”'));
    expect(screen.queryByRole('link', { name: 'Download this actor' })).toBeNull();
  });
});

describe('what publishing keeps', () => {
  function selection(): PublishPreview {
    return previewOf(
      graph()
        .found('vera', 'storyengine.actor/1', { name: 'Vera' })
        .found('harbour', 'storyengine.lorebook/1', { name: 'Harbour' })
        .edge(null, 'vera', 'selected')
        .edge(null, 'harbour', 'selected')
        .closure('selection'),
      { suggestedName: 'Vera, Harbour' },
    );
  }

  it('offers a selection the World, named, or just the file — and only a selection', async () => {
    show(selection());
    const keepWorld = await screen.findByLabelText<HTMLInputElement>(
      'Keep these 2 as a world named',
    );
    expect(keepWorld.checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('The world’s name').value).toBe('Vera, Harbour');
    expect(screen.getByLabelText('Just make the file')).toBeTruthy();
    expect(
      screen.getByText('What you leave out above leaves the file, not the world.'),
    ).toBeTruthy();
  });

  it('keeps no name field for a World start, and says it keeps nothing new', async () => {
    show(rainCity());
    expect(
      await screen.findByText('Publishing again makes a new file; the world stays one world.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('The world’s name')).toBeNull();
    expect(screen.queryByLabelText('Just make the file')).toBeNull();
  });

  it('sends the name and the snapshot choice for a selection', async () => {
    publish.mockResolvedValue({
      blob: new Blob(['zip']),
      fileName: 'Rain.seworld',
      world: null,
      drift: false,
      notes: [],
      missing: 0,
    });
    show(selection());
    await userEvent.click(await screen.findByLabelText('Just make the file'));
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => {
      expect(publish).toHaveBeenCalledTimes(1);
    });
    expect(publish.mock.calls[0]?.[1]).toMatchObject({
      keep: 'snapshot',
      name: 'Vera, Harbour',
    });
  });

  /**
   * ***Named by what travels, until the person names it*** (2026-10-11, the
   * [P16 audit], privacy finding 4): the suggestion is the starting points the
   * file carries, so unticking one takes it out of the name the file and a
   * kept World's `world.json` would carry; a name the person typed is theirs,
   * and the ticks no longer move it.
   */
  it('names a selection by the starting points that travel, until a name is typed', async () => {
    show(
      previewOf(
        graph()
          .found('vera', 'storyengine.actor/1', { name: 'Vera' })
          .found('twist', 'storyengine.lorebook/1', { name: 'Act III twist' })
          .found('bob', 'storyengine.actor/1', { name: 'Bob' })
          .edge(null, 'vera', 'selected')
          .edge(null, 'twist', 'selected')
          .edge(null, 'bob', 'selected')
          .closure('selection'),
        { suggestedName: 'Vera, Act III twist, Bob' },
      ),
    );
    const field = await screen.findByLabelText<HTMLInputElement>('The world’s name');
    expect(field.value).toBe('Vera, Act III twist, Bob');

    await userEvent.click(screen.getByLabelText('Include “Act III twist”'));
    expect(field.value).toBe('Vera, Bob');

    await userEvent.clear(field);
    await userEvent.type(field, 'Harbour folk');
    await userEvent.click(screen.getByLabelText('Include “Bob”'));
    expect(field.value).toBe('Harbour folk');
  });

  /**
   * ***A snapshot's file is named here too*** (the [P16 audit]): the field was
   * disabled for a snapshot while the confirm still named the file from it.
   * Now it is the file's name, under the choice it names, and editable.
   */
  it('lets the file be named for a snapshot, and sends that name', async () => {
    publish.mockResolvedValue({
      blob: new Blob(['zip']),
      fileName: 'Notes.seworld',
      world: null,
      drift: false,
      notes: [],
      missing: 0,
    });
    show(selection());
    await userEvent.click(await screen.findByLabelText('Just make the file'));
    expect(screen.queryByLabelText('The world’s name')).toBeNull();
    const field = screen.getByLabelText<HTMLInputElement>('The file’s name');
    expect(field.disabled).toBe(false);
    expect(field.value).toBe('Vera, Harbour');
    await userEvent.clear(field);
    await userEvent.type(field, 'Notes');
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => {
      expect(publish).toHaveBeenCalledTimes(1);
    });
    expect(publish.mock.calls[0]?.[1]).toMatchObject({ keep: 'snapshot', name: 'Notes' });
  });

  it('will not keep a World with no name', async () => {
    show(selection());
    const name = await screen.findByLabelText('The world’s name');
    await userEvent.clear(name);
    expect(screen.getByText('A world needs a name.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Publish' }).disabled).toBe(true);
  });
});

describe('the confirm', () => {
  it('is disabled while it is pending, so a double press keeps no second World', async () => {
    let finish: (value: unknown) => void = () => undefined;
    publish.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    show(rainCity());
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    const pending = screen.getByRole<HTMLButtonElement>('button', { name: 'Publishing…' });
    expect(pending.disabled).toBe(true);
    await userEvent.click(pending);
    expect(publish).toHaveBeenCalledTimes(1);

    finish({
      blob: new Blob(['zip']),
      fileName: 'Rain-City.seworld',
      world: null,
      drift: false,
      notes: [],
      missing: 0,
    });
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeTruthy();
  });

  it('says what it saved, the World it kept with a way to it, and drift', async () => {
    publish.mockResolvedValue({
      blob: new Blob(['zip']),
      fileName: 'Vera-and-Harbour.seworld',
      world: 'w-new',
      drift: true,
      notes: [
        { key: 'publish.file.pictureMissing', params: { id: 'v', name: 'Vera', ref: 'a.png' } },
      ],
      missing: 2,
    });
    show(
      previewOf(
        graph()
          .found('vera', 'storyengine.actor/1', { name: 'Vera' })
          .found('harbour', 'storyengine.lorebook/1', { name: 'Harbour' })
          .edge(null, 'vera', 'selected')
          .edge(null, 'harbour', 'selected')
          .closure('selection'),
        { suggestedName: 'Vera, Harbour' },
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    expect(await screen.findByText('Saved Vera-and-Harbour.seworld.')).toBeTruthy();
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Kept as the world “Vera, Harbour”.')).toBeTruthy();
    const open = screen.getByRole('link', { name: 'Open it' });
    expect(open.getAttribute('data-params')).toBe(JSON.stringify({ kind: 'worlds', id: 'w-new' }));
    expect(screen.getByText(/^The library changed while you were looking/)).toBeTruthy();
    expect(
      screen.getByText('2 references could not be carried: they name things not in your library.'),
    ).toBeTruthy();
    expect(screen.getByText(/^A picture of “Vera” \(a\.png\) was not on disk/)).toBeTruthy();
    // A selection kept once is not kept twice from here.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Publish' }).disabled).toBe(true);
    expect(screen.getByText(/^This selection is the world “Vera, Harbour” now\./)).toBeTruthy();
  });

  it('says a refusal by its class, and names a World a 409 kept', async () => {
    publish.mockRejectedValue(
      new PublishError(new ApiError(409, 'publish.changed', 'changed'), {
        id: 'w-kept',
        name: 'Rain City',
      }),
    );
    show(rainCity());
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    expect(
      await screen.findByText(
        'Something changed while the file was being written, so no file was made. Publish again.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'The world “Rain City” was kept before that happened; publish it from its page.',
      ),
    ).toBeTruthy();
    expect(onFile).not.toHaveBeenCalled();
  });
});

describe('looking again', () => {
  it('keeps the ticks whose keys the new look still holds, and drops the rest', async () => {
    const first = rainCity();
    show(first);
    await userEvent.click(await screen.findByLabelText('Night Market'));
    await userEvent.click(screen.getByLabelText('Include “Vera”'));

    // The library changed: Vera is gone; the session is still there.
    const second = previewOf(
      graph()
        .found('rain', 'storyengine.treatment/1', { name: 'The Drowned Bell' })
        .found('keeper', 'storyengine.actor/1', { name: 'The Keeper' })
        .session('night', { name: 'Night Market' })
        .edge(null, 'rain', 'world.member')
        .edge(null, 'night', 'world.member')
        .edge('night', 'keeper', 'session.cast.actors')
        .closure('world', worldOf()),
    );
    previewPublish.mockResolvedValue(second);
    publish.mockResolvedValue({
      blob: new Blob(['zip']),
      fileName: 'Rain-City.seworld',
      world: null,
      drift: false,
      notes: [],
      missing: 0,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Look again' }));

    await waitFor(() => {
      expect(screen.queryByText('Vera')).toBeNull();
    });
    expect(screen.getByLabelText<HTMLInputElement>('Night Market').checked).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => {
      expect(publish).toHaveBeenCalledTimes(1);
    });
    expect(publish.mock.calls[0]?.[1]).toMatchObject({ ticked: { night: true } });
    expect(Object.keys((publish.mock.calls[0]?.[1] as { ticked: object }).ticked)).toEqual([
      'night',
    ]);
  });
});

describe('a review that cannot be drawn', () => {
  it('says why, by the class the server sends', async () => {
    previewPublish.mockRejectedValue(new ApiError(404, 'not-found', 'gone'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PublishPage start={{ kind: 'objects', ids: ['gone'] }} locale="en-GB" onFile={onFile} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText(
        'Nothing there to publish — what was chosen is not in your library any more.',
      ),
    ).toBeTruthy();
  });
});

/**
 * ***What the P16.3g review found, held*** — 2026-10-11. Each case below
 * failed before its fix; the finding is named on the case.
 */
describe('every reason and every level', () => {
  /**
   * A row reached two ways says both, and a node three steps out is under
   * *Further out* — the plan's *every reason as text* and *every level is
   * shown*, which `rainCity()` could not hold: each of its rows has one
   * inbound edge, and its deepest is two out.
   */
  it('says every edge that reaches a row, and files three steps out under Further out', async () => {
    const closure = graph()
      .found('rain', 'storyengine.treatment/1', { name: 'The Drowned Bell' })
      .found('vera', 'storyengine.actor/1', { name: 'Vera' })
      .found('harbour', 'storyengine.lorebook/1', { name: 'Harbour' })
      .found('keeper', 'storyengine.actor/1', { name: 'The Keeper' })
      .found('keeper-book', 'storyengine.lorebook/1', { name: 'The Keeper’s Log' })
      .edge(null, 'rain', 'world.member')
      .edge(null, 'vera', 'world.member')
      .edge('rain', 'harbour', 'treatment.lore', { required: true })
      .edge('vera', 'harbour', 'actor.lore')
      .edge('harbour', 'keeper', 'lorebook.hooks.involves')
      .edge('keeper', 'keeper-book', 'actor.lore')
      .closure('world', worldOf());
    show(previewOf(closure));
    await screen.findByRole('heading', { name: 'Members of this world' });

    const harbour = screen.getByRole('link', { name: 'Harbour' }).closest('li') as HTMLElement;
    expect(
      within(harbour).getByText('The treatment “The Drowned Bell” links it as lore.'),
    ).toBeTruthy();
    expect(
      within(harbour).getByText('The character “Vera” links it as their own lore.'),
    ).toBeTruthy();
    // A reason and what is appended to it are two sentences, spaced as two —
    // assistive technology reads the text, not the margin between spans.
    expect(harbour.textContent).toContain('links it as lore. Marked required.');

    const further = section('Further out');
    expect(within(further).getByText('The Keeper’s Log')).toBeTruthy();
    expect(within(section('Two steps out')).queryByText('The Keeper’s Log')).toBeNull();
  });

  it('says the World lead as a whole sentence', async () => {
    show(rainCity());
    expect(
      await screen.findByText(
        'This world, with everything it holds and everything they name, as one file.',
      ),
    ).toBeTruthy();
  });
});

/** The review held still: no refetch under the person, and nothing kept once left. */
describe('the preview, held', () => {
  it('is not asked again when the window regains focus', async () => {
    show(rainCity());
    await screen.findByRole('heading', { name: 'Members of this world' });
    expect(previewPublish).toHaveBeenCalledTimes(1);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(previewPublish).toHaveBeenCalledTimes(1);
    focusManager.setFocused(undefined);
  });

  it('is walked afresh when the review is left and opened again', async () => {
    previewPublish.mockResolvedValue(rainCity());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = (): React.JSX.Element => (
      <QueryClientProvider client={client}>
        <PublishPage start={rainCity().closure.start} locale="en-GB" onFile={onFile} />
      </QueryClientProvider>
    );
    const view = render(page());
    await screen.findByRole('heading', { name: 'Members of this world' });
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    render(page());
    await screen.findByRole('heading', { name: 'Members of this world' });
    expect(previewPublish).toHaveBeenCalledTimes(2);
  });
});

/**
 * ***The strip holds the decision and nothing else*** — the review's
 * blocking finding: the warnings and the outcome were inside the sticky strip,
 * which at 280 px covered the review and, after a publish, was taller than
 * the page. jsdom has no layout, so this holds the arrangement the fix rests
 * on: only the totals and the two buttons are in the sticky element.
 */
describe('the strip', () => {
  const file = {
    blob: new Blob(['zip']),
    fileName: 'Rain-City.seworld',
    world: null,
    drift: true,
    notes: [
      { key: 'publish.file.pictureMissing', params: { id: 'v', name: 'Vera', ref: 'a.png' } },
    ],
    missing: 1,
  };

  it('holds the totals and the two buttons, and draws the warnings and the outcome in the page', async () => {
    publish.mockResolvedValue(file);
    show(rainCity());
    await userEvent.click(await screen.findByLabelText('Include “Harbour”'));
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await screen.findByText('Saved Rain-City.seworld.');

    const strip = screen.getByRole('button', { name: 'Publish' }).closest('.sticky');
    expect(strip).not.toBeNull();
    expect(strip?.contains(screen.getByRole('button', { name: 'Look again' }))).toBe(true);
    expect(strip?.contains(screen.getByText(/^In the file: /))).toBe(true);
    for (const text of [
      'Before you publish:',
      'Saved Rain-City.seworld.',
      /^The library changed while you were looking/,
      /^A picture of “Vera” \(a\.png\) was not on disk/,
    ]) {
      expect(screen.getByText(text).closest('.sticky'), String(text)).toBeNull();
    }
  });

  /**
   * ***Said, as well as shown*** — a live region inserted already holding its
   * text is one most screen readers never read (`ui/TwoStep.tsx`). The line
   * that says what happened is a status that was on the page, empty, before
   * the press.
   */
  it('says what happened in a status that was already there', async () => {
    publish.mockResolvedValue(file);
    show(rainCity());
    await screen.findByRole('button', { name: 'Publish' });
    const before = screen.getAllByRole('status');
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));

    const saved = await screen.findByText('Saved Rain-City.seworld.');
    const region = saved.closest('[role="status"]');
    expect(region).not.toBeNull();
    expect(before).toContain(region);
  });

  /**
   * ***Focus, given back*** — `PlayPage`'s rule: disabling the button that has
   * focus drops it to `<body>`, where Tab starts again from the top. jsdom
   * leaves it on the disabled button (and will not `blur()` a disabled
   * element), so the cases put it on `<body>` the way a browser does — through
   * a focusable stand-in — and ask where it is after.
   */
  function dropFocus(): void {
    const away = document.createElement('button');
    document.body.append(away);
    away.focus();
    away.blur();
    away.remove();
    expect(document.activeElement).toBe(document.body);
  }

  it('gives the keyboard back to Publish when the publish ends', async () => {
    let finish: (value: unknown) => void = () => undefined;
    publish.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    show(rainCity());
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    dropFocus();

    await act(async () => {
      finish(file);
      await Promise.resolve();
    });
    await screen.findByText('Saved Rain-City.seworld.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Publish' }));
  });

  it('gives it to Open it when the selection was kept and Publish stays off', async () => {
    publish.mockResolvedValue({ ...file, world: 'w-new' });
    show(
      previewOf(
        graph()
          .found('vera', 'storyengine.actor/1', { name: 'Vera' })
          .found('harbour', 'storyengine.lorebook/1', { name: 'Harbour' })
          .edge(null, 'vera', 'selected')
          .edge(null, 'harbour', 'selected')
          .closure('selection'),
        { suggestedName: 'Vera, Harbour' },
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    await screen.findByText('Kept as the world “Vera, Harbour”.');
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Open it' }));
  });

  it('gives it back to Look again when the look ends', async () => {
    show(rainCity());
    await screen.findByRole('button', { name: 'Look again' });
    let finish: (value: unknown) => void = () => undefined;
    previewPublish.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Look again' }));
    await screen.findByRole('button', { name: 'Looking again…' });
    dropFocus();

    await act(async () => {
      finish(rainCity());
      await Promise.resolve();
    });
    await screen.findByRole('button', { name: 'Look again' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Look again' }));
  });
});

/** What the file would not hold, said as what it would not hold. */
describe('what stays home', () => {
  /**
   * ***An object too large to be one file stays home whole*** — the writer's
   * `too-large` (`measureObject`: no entries, its own file omitted), which the
   * review drew as a ticked row and called *a picture*.
   */
  it('says an object too large to travel stays home, and does not count it', async () => {
    const closure = graph()
      .found('rain', 'storyengine.treatment/1', { name: 'The Drowned Bell' })
      .found('vera', 'storyengine.actor/1', {
        name: 'Vera',
        facts: {
          entries: 0,
          bytes: 0,
          pictures: { count: 0, bytes: 0 },
          history: { versions: 0, entries: 0, bytes: 0 },
          omitted: [{ ref: 'card.png', bytes: 70 * 1024 * 1024 }],
        },
      })
      .edge(null, 'rain', 'world.member')
      .edge('rain', 'vera', 'treatment.cast')
      .closure('world', worldOf());
    show(previewOf(closure));

    const row = (await screen.findByRole('link', { name: 'Vera' })).closest('li') as HTMLElement;
    expect(within(row).queryByRole('checkbox')).toBeNull();
    expect(
      within(row).getByText(
        'Stays home whatever is ticked: “Vera” is 70.0 MB, larger than one file in a world may be.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/^A picture of “Vera”/)).toBeNull();
    expect(
      within(section('What opening it needs')).getByText(
        '“Vera” stays home: at 70.0 MB it is larger than one file in a world may be.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/^In the file: 1 object, /)).toBeTruthy();
  });

  /**
   * ***A starting point that is gone is not in the file, and not named in it***
   * — `fileSet` never puts a missing root in `leftBehind`, and the writer
   * filters the World's contents to what travels.
   */
  it('says a missing starting point is neither held nor named', async () => {
    const closure = graph()
      .found('rain', 'storyengine.treatment/1', { name: 'The Drowned Bell' })
      .missing('missing:1', '', 'Old Pier')
      .edge(null, 'rain', 'world.member')
      .edge(null, 'missing:1', 'world.member')
      .closure('world', worldOf());
    show(previewOf(closure));

    // On its row, and in the folded list of everything the review notes
    // (`publish.closure.missingStart`, a key of its own for this).
    expect(
      await screen.findAllByText(
        '“Old Pier” is not in your library any more, so the file will not hold it or name it.',
      ),
    ).toHaveLength(2);
    expect(screen.queryByText(/so the file says it is missing/)).toBeNull();
  });

  /** A reference from a row that is not in the file is not a thing the file says. */
  it('does not say the file names what an unticked row names', async () => {
    show(rainCity());
    await userEvent.click(await screen.findByLabelText('Include “The Drowned Bell”'));
    const bell = screen.getByText('The Drowned Bell').closest('li') as HTMLElement;
    expect(within(bell).queryByText(/The file says it is missing\./)).toBeNull();
    expect(
      within(bell).getByText('It names “Old Pier” (lorebook), which is not in your library.'),
    ).toBeTruthy();
  });

  /**
   * ***A book play wrote, chosen on its own*** — the shelves no longer offer
   * it, but an address can still name it: the row says it stays home and not
   * that it is always in the file, the review says the file would hold
   * nothing, and Publish does not make that file.
   */
  it('will not publish a file of nothing from one object', async () => {
    const closure = graph()
      .found('memories', 'storyengine.lorebook/1', {
        name: 'What Ned remembers',
        canUncheck: false,
        writtenByPlay: true,
      })
      .edge(null, 'memories', 'selected')
      .closure('object');
    show(previewOf(closure, { suggestedName: 'What Ned remembers' }));

    expect(await screen.findByText(/^Stays home whatever is ticked: play wrote/)).toBeTruthy();
    expect(screen.queryByText(/^This is what you are publishing/)).toBeNull();
    expect(
      screen.getByText('Nothing would be in this file, so there is nothing to publish.'),
    ).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Publish' }).disabled).toBe(true);
  });

  it('says a selection with everything left out keeps a world and sends its name alone', async () => {
    show(
      previewOf(
        graph()
          .found('vera', 'storyengine.actor/1', { name: 'Vera' })
          .found('harbour', 'storyengine.lorebook/1', { name: 'Harbour' })
          .edge(null, 'vera', 'selected')
          .edge(null, 'harbour', 'selected')
          .closure('selection'),
        { suggestedName: 'Vera, Harbour' },
      ),
    );
    await userEvent.click(await screen.findByLabelText('Include “Vera”'));
    await userEvent.click(screen.getByLabelText('Include “Harbour”'));
    expect(
      screen.getByText('This file would hold the world’s name and nothing else.'),
    ).toBeTruthy();

    await userEvent.click(screen.getByLabelText('Just make the file'));
    expect(
      screen.getByText('Nothing would be in this file, so there is nothing to publish.'),
    ).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Publish' }).disabled).toBe(true);
  });

  it('counts only the chosen things that are there when it offers to keep them', async () => {
    show(
      previewOf(
        graph()
          .found('vera', 'storyengine.actor/1', { name: 'Vera' })
          .found('harbour', 'storyengine.lorebook/1', { name: 'Harbour' })
          .missing('missing:1', '', null)
          .edge(null, 'vera', 'selected')
          .edge(null, 'harbour', 'selected')
          .edge(null, 'missing:1', 'selected')
          .closure('selection'),
        { suggestedName: 'Vera, Harbour' },
      ),
    );
    expect(await screen.findByLabelText('Keep these 2 as a world named')).toBeTruthy();
  });
});

/**
 * ***Just the object, honestly*** — Download is the object as stored: for any
 * kind but an actor, that is its JSON without its pictures, which the World
 * file would carry. And it is fetched, as the detail page fetches it, so a
 * refusal is said rather than saved as the file (gap round A5.4).
 */
describe('just the object, downloaded', () => {
  function book(pictures: number): PublishPreview {
    return previewOf(
      graph()
        .found('harbour', 'storyengine.lorebook/1', {
          name: 'Harbour',
          canUncheck: false,
          facts: {
            entries: 1 + pictures,
            bytes: 2048,
            pictures: { count: pictures, bytes: pictures * 512 },
            history: { versions: 0, entries: 0, bytes: 0 },
            omitted: [],
          },
        })
        .edge(null, 'harbour', 'selected')
        .closure('object'),
      { suggestedName: 'Harbour', justTheObject: true },
    );
  }

  it('says a book’s pictures stay behind with Download and travel with Publish, and does not press Download first', async () => {
    show(book(2));
    const download = await screen.findByRole('link', { name: 'Download this lorebook' });
    expect(download.className).not.toContain('bg-accent');
    expect(
      screen.getByText(
        'Nothing else would leave with “Harbour”. Download hands this lorebook over as stored, without its 2 pictures; the file Publish makes carries them.',
      ),
    ).toBeTruthy();
  });

  it('fetches a plain click, saves what came back, and says a refusal', async () => {
    takeFile.mockResolvedValueOnce({ blob: new Blob(['{}']), fileName: 'harbour.json', notes: [] });
    show(book(0));
    const download = await screen.findByRole('link', { name: 'Download this lorebook' });
    await userEvent.click(download);
    await waitFor(() => {
      expect(onFile).toHaveBeenCalledTimes(1);
    });
    expect(takeFile).toHaveBeenCalledWith('/api/library/lorebooks/harbour/download');

    takeFile.mockRejectedValueOnce(new ApiError(404, 'not-found', 'gone'));
    await userEvent.click(download);
    expect(
      await screen.findByText('That is not here any more, so there was nothing to download.'),
    ).toBeTruthy();
    expect(onFile).toHaveBeenCalledTimes(1);
  });
});

/**
 * ***A file that did not arrive*** — the server kept the World and sent its
 * id in a header before the body failed; the review must not lose it, or the
 * next press keeps a second one (risk 14).
 */
describe('a publish whose file does not arrive', () => {
  it('names the World that was kept, and offers no second keep', async () => {
    publish.mockRejectedValue(
      new PublishError(new ApiError(0, 'publish.interrupted', 'cut'), { id: 'w-kept', name: null }),
    );
    show(
      previewOf(
        graph()
          .found('vera', 'storyengine.actor/1', { name: 'Vera' })
          .found('harbour', 'storyengine.lorebook/1', { name: 'Harbour' })
          .edge(null, 'vera', 'selected')
          .edge(null, 'harbour', 'selected')
          .closure('selection'),
        { suggestedName: 'Vera, Harbour' },
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    expect(
      await screen.findByText(
        'The file did not arrive — the connection ended part way — so nothing was saved.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'The world “Vera, Harbour” was kept before that happened; publish it from its page.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Publish' }).disabled).toBe(true);
  });
});
