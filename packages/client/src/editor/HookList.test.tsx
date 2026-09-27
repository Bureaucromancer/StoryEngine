// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlotHook } from '@storyengine/shared';

import { choicesOf, fieldsOf, plotHookSchema } from '../library/fields.js';
import { AssistProvider, type AssistSubject } from '../ui/assist.js';

/**
 * The hook editor, which is the first surface in the application where a plot
 * hook can be written at all — [03 §4.1](../../../../docs/design/03-data-model.md),
 * [10 §10.1](../../../../docs/design/10-ui-surfaces.md), and the discharge of
 * [P7 §1.5](../../../../docs/design/workplan/23-p7-implementation.md)'s *"a
 * hook has nowhere to be authored"*.
 *
 * ***The contract claim runs over the schema, not over the fields somebody
 * remembered*** — which is the shape
 * [contract.test.tsx](./contract.test.tsx) sets for the editors one level up:
 * *"the claim runs over `LIBRARY_KINDS` and fails when a kind is added without
 * the affordance, which is the difference between a test that tracks the
 * feature and one that tracks the day it was written."* Here the key set is
 * `PlotHook`'s own properties, read out of the emitted artefact, so a field
 * added to the schema and forgotten here fails loudly rather than rendering
 * nowhere.
 *
 * The rest is what a list surface owes: create, delete, reorder, and the two
 * structures — the enums and `introduces` — that the generic renderer next door
 * cannot draw.
 */

const listLibrary = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    api: { ...actual.api, listLibrary: (...args: unknown[]) => listLibrary(...args) as unknown },
  };
});

const { HookList } = await import('./HookList.js');
const { newHook } = await import('./hook-form.js');

const VERA = {
  id: 'actor-vera',
  name: 'Vera Kohl',
  schema: 'storyengine.actor/1',
  slug: 'vera',
  source: 'user' as const,
  contentHash: 'sha256:x',
  shadowed: false,
  object: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  listLibrary.mockResolvedValue({ objects: [VERA] });
});

/**
 * The list, held the way a carrier's editor holds it — state in, state out.
 *
 * `latest` is what the assertions read, because the interesting half of every
 * claim below is *what this component handed back*, not what it drew: a surface
 * that rendered the right controls and produced a mangled list would pass a
 * rendering test and lose somebody's hooks.
 */
let latest: PlotHook[] = [];

function Harness(props: { hooks: PlotHook[] }): JSX.Element {
  const [hooks, setHooks] = useState(props.hooks);
  return (
    <HookList
      hooks={hooks}
      // Applied to the list as it is, the way every carrier applies it — the
      // list handed back is a change, not a value (see `HookList`'s `onChange`).
      onChange={(update) => {
        setHooks((was) => {
          const next = update(was);
          latest = next;
          return next;
        });
      }}
      note="Hooks on this treatment travel with it."
    />
  );
}

function mount(hooks: PlotHook[]): void {
  latest = hooks;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness hooks={hooks} />
    </QueryClientProvider>,
  );
}

/**
 * Opens the disclosure whose summary says this, by setting the attribute rather
 * than by clicking it.
 *
 * jsdom's support for a `summary` click toggling its `details` is the sort of
 * thing a test should not be asserting on the way to asserting something else,
 * and these two folds are uncontrolled — React writes `open` only when the
 * *prop* changes and neither passes one — so the attribute set here stays set
 * across the re-renders the test then causes.
 */
function openFold(summary: string | RegExp): void {
  screen.getByText(summary).closest('details')?.setAttribute('open', '');
}

/**
 * Every assist subject the fields offered, by path, as of the last render.
 *
 * A running assist holds the subject of the render that started it and calls
 * its `onChange` when the model answers. Taking one from here and calling it
 * after other edits is that, with the network and the model taken out: what is
 * left is the only thing that differs between a click and an answer — the time
 * in between.
 */
const offered = new Map<string, AssistSubject>();

function mountWithAssist(hooks: PlotHook[]): void {
  latest = hooks;
  offered.clear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AssistProvider
        contract={{
          slot: (subject) => {
            offered.set(subject.path, subject);
            return null;
          },
          onEdited: () => undefined,
        }}
      >
        <Harness hooks={hooks} />
      </AssistProvider>
    </QueryClientProvider>,
  );
}

/** The subject for this path as the fields offer it now — what an assist started now would hold. */
function heldSubject(path: string): AssistSubject {
  const found = offered.get(path);
  if (found === undefined) throw new Error(`no assist offered for ${path}`);
  return found;
}

async function answerLate(subject: AssistSubject, text: string): Promise<void> {
  await act(async () => {
    subject.onChange(text);
    await Promise.resolve();
  });
}

function hook(title: string, over: Partial<PlotHook> = {}): PlotHook {
  return { ...newHook(title), ...over };
}

describe('every field of a hook is reachable', () => {
  /**
   * ***Writable or visibly read-only, over the schema's own key set.***
   *
   * [10 §2.1] forbids a hidden field and [polish §1] forbids one silently
   * dropped from an editor, so the two permitted answers are *there is a
   * control* and *there is a labelled value that cannot be typed into*. The
   * falsifying mutation is a `case` deleted from `HookFields`' switch: the
   * field then falls to `ReadOnlyField` and stays visible, which is the
   * designed degradation — what fails the suite is a field that disappears.
   */
  it('shows every property the schema declares', async () => {
    mount([hook('The war')]);
    await screen.findByLabelText('Title');

    const rows = fieldsOf(plotHookSchema(), hook('The war'));
    // The instrument has to be looking at something, or the loop proves nothing.
    expect(rows.length).toBeGreaterThan(8);

    for (const row of rows) {
      const labelled = screen.queryAllByLabelText(row.label).length;
      const shown = screen.queryAllByText(row.label).length;
      expect(labelled + shown, `${row.key} is neither writable nor shown`).toBeGreaterThan(0);
    }
  });

  /** The two arms, pinned: `title` is typed into and `id` is only read. */
  it('writes the title and never the id', async () => {
    const one = hook('The war');
    mount([one]);

    const title = await screen.findByLabelText('Title');
    await userEvent.type(title, '!');

    expect(latest[0]?.title).toBe('The war!');
    expect(screen.queryByLabelText('Id')).toBeNull();
    expect(screen.getByText(one.id)).toBeDefined();
  });

  /**
   * ***The two enums are pickers, and their options are the schema's.***
   *
   * This is the gap the generic renderer cannot close: `magnitude` and
   * `delivery` emit as `anyOf` of `const`s with no top-level `type`, so
   * `SchemaFields`' `controlFor` chooses by value and gives a closed union a
   * free-text box. The options are read back out of the schema here rather than
   * listed, so a value added to either union fails this test instead of
   * silently not being offered.
   */
  it('offers exactly the schema values for magnitude and delivery', async () => {
    mount([hook('The war')]);
    await screen.findByLabelText('Title');

    const declared = plotHookSchema()?.properties ?? {};
    for (const [key, label] of [
      ['magnitude', 'Magnitude'],
      ['delivery', 'Delivery'],
    ] as const) {
      const expected = choicesOf(declared[key] as never);
      expect(expected, `${key} is not a closed union any more`).not.toBeNull();

      const select = screen.getByRole('combobox', { name: label });
      const options = within(select)
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value);
      expect(options).toEqual(expected);
    }

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Magnitude' }), 'sweeping');
    expect(latest[0]?.magnitude).toBe('sweeping');
  });
});

describe('the list', () => {
  /**
   * The guarantee [hook-form.ts](./hook-form.ts) makes, asserted through the
   * component that calls it — because a surface that patched the right hook and
   * rebuilt the others would pass the model's unit test and fail here.
   */
  it('edits one hook and leaves the other byte-identical', async () => {
    const other = hook('The marriage', { weight: 3, premise: 'They announce it.' });
    mount([hook('The war'), other]);
    await screen.findAllByLabelText('Title');

    await userEvent.type(screen.getAllByLabelText('Premise')[0]!, 'A');

    expect(latest[0]?.premise).toBe('A');
    expect(JSON.stringify(latest[1])).toBe(JSON.stringify(other));
  });

  it('adds a hook with the defaults a hook typed by hand wants', async () => {
    mount([]);
    await screen.findByLabelText('Something you want to happen');

    await userEvent.type(
      screen.getByLabelText('Something you want to happen'),
      'The Flower Kingdom declares war',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add a hook' }));

    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({
      title: 'The Flower Kingdom declares war',
      magnitude: 'local',
      weight: 1,
      delivery: 'guidance',
      once: true,
      involves: [],
    });
    expect(latest[0]?.id).not.toBe('');
  });

  it('removes the hook named on the button and no other', async () => {
    mount([hook('The war'), hook('The marriage')]);
    await screen.findAllByLabelText('Title');

    await userEvent.click(screen.getByRole('button', { name: 'Remove The war' }));

    expect(latest.map((each) => each.title)).toEqual(['The marriage']);
  });

  /**
   * The keyboard half of a reorder, which here is the whole of it: this list
   * does not port the entry list's drag gesture, so the nudge buttons are the
   * only way a hook moves and they have to work for everybody.
   */
  it('reorders with the nudge buttons and says so in the live region', async () => {
    mount([hook('The war'), hook('The marriage')]);
    await screen.findAllByLabelText('Title');

    await userEvent.click(screen.getByRole('button', { name: 'Move The marriage up' }));

    expect(latest.map((each) => each.title)).toEqual(['The marriage', 'The war']);
    expect(screen.getByText('Moved The marriage to position 1 of 2.')).toBeDefined();
  });

  /**
   * The eligibility gates, which are the other thing no surface could set —
   * [04 §6.1a].
   */
  it('gates a hook on a turn and on another hook, and lets both go', async () => {
    mount([hook('The war'), hook('The marriage')]);
    await screen.findAllByLabelText('Title');

    await userEvent.type(screen.getAllByLabelText('Turn')[0]!, '12');
    expect(latest[0]?.notBefore).toEqual({ turn: 12 });

    await userEvent.selectOptions(
      screen.getAllByRole('combobox', { name: 'After hook' })[0]!,
      latest[1]!.id,
    );
    expect(latest[0]?.notBefore).toEqual({ turn: 12, afterHook: latest[1]!.id });

    await userEvent.clear(screen.getAllByLabelText('Turn')[0]!);
    expect(latest[0]?.notBefore).toEqual({ afterHook: latest[1]!.id });
  });

  /**
   * ***Cleared is absent, and the assertion is byte equality with a hook that
   * never had the field.***
   *
   * `newHook` leaves `blockedBy`, `notBefore` and `introduces` unset and states
   * the rule: *a hook that has never been given an eligibility filter says
   * nothing about one*. The engine cannot tell `notBefore: {}` from no
   * `notBefore`, which is exactly why this needs holding somewhere — the cost
   * of getting it wrong is invisible in play and permanent in the file, in
   * every export of it and every diff. Type a floor, think better of it, and
   * what is left has to be what you started with.
   */
  it('leaves a cleared gate byte-identical to a hook that never had one', async () => {
    const plain = hook('The war');
    mount([plain, hook('The marriage')]);
    await screen.findAllByLabelText('Title');

    await userEvent.type(screen.getAllByLabelText('Turn')[0]!, '12');
    await userEvent.clear(screen.getAllByLabelText('Turn')[0]!);

    expect(Object.hasOwn(latest[0]!, 'notBefore')).toBe(false);
    expect(JSON.stringify(latest[0])).toBe(JSON.stringify(plain));
  });

  /** And the same for a blocker list emptied of its last token. */
  it('leaves an emptied blocker list absent rather than empty', async () => {
    const plain = hook('The war');
    mount([plain, hook('The marriage')]);
    await screen.findAllByLabelText('Title');

    const box = screen.getAllByLabelText('Blocked by')[0]!;
    await userEvent.click(box);
    const popup = document.getElementById(box.getAttribute('aria-controls') ?? '');
    await userEvent.click(within(popup!).getByRole('option', { name: 'The marriage' }));
    expect(latest[0]?.blockedBy).toEqual([latest[1]!.id]);

    // The token's own control, which `TokenField` names by the stored **value**
    // rather than by the title it draws — so this cannot land on the card's
    // *Remove The marriage* button beside it.
    await userEvent.click(screen.getByRole('button', { name: `Remove ${latest[1]!.id}` }));

    expect(Object.hasOwn(latest[0]!, 'blockedBy')).toBe(false);
    expect(JSON.stringify(latest[0])).toBe(JSON.stringify(plain));
  });

  /**
   * ***A held `Ref` comes through by identity, which is what keeps a
   * fingerprint.***
   *
   * `ActorRefs` rebuilds the list around the combobox's ids on every commit, so
   * the thing to hold is that it rebuilds *around* them rather than rebuilding
   * *them*: a `Ref` carries an optional `fingerprint` recording what the actor
   * looked like when it was linked ([04 §3]), and a control that minted a fresh
   * one per commit would drop it from every actor somebody merely re-ordered or
   * sat beside a second one.
   */
  it('keeps a ref already held byte-identical when another is added', async () => {
    const linked = {
      id: 'actor-vera',
      name: 'Vera Kohl',
      fingerprint: 'sha256:vera-as-she-was',
    } as PlotHook['involves'][number];
    listLibrary.mockResolvedValue({ objects: [VERA, { ...VERA, id: 'actor-ash', name: 'Ash' }] });
    mount([hook('The war', { involves: [linked] })]);
    await screen.findAllByLabelText('Title');

    // A second actor, committed through the same control, so the first ref is
    // carried across a rebuild of the list rather than simply left alone.
    const box = screen.getAllByLabelText('Involves')[0]!;
    await userEvent.click(box);
    const popup = document.getElementById(box.getAttribute('aria-controls') ?? '');
    await waitFor(() => {
      expect(within(popup!).queryByRole('option', { name: 'Ash' })).toBeTruthy();
    });
    await userEvent.click(within(popup!).getByRole('option', { name: 'Ash' }));

    expect(latest[0]?.involves).toHaveLength(2);
    expect(JSON.stringify(latest[0]?.involves[0])).toBe(JSON.stringify(linked));
  });

  /** A hook cannot gate itself: the blockers offered are the other hooks. */
  it('offers only the other hooks as blockers', async () => {
    mount([hook('The war'), hook('The marriage')]);
    await screen.findAllByLabelText('Title');

    const box = screen.getAllByLabelText('Blocked by')[0]!;
    await userEvent.click(box);

    // Scoped to this combobox's own popup, which is what `aria-controls`
    // names: every enum on the page is a listbox too, so an unscoped option
    // query would be asserting about the whole form.
    const popup = document.getElementById(box.getAttribute('aria-controls') ?? '');
    const options = within(popup!)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['The marriage']);
  });
});

/**
 * ***The arrival, round-tripped*** — [04 §6.1a], the field
 * [P7.5](../../../../docs/design/workplan/23-p7-implementation.md) added to the
 * schema and nothing has ever been able to write.
 */
describe('introduces', () => {
  it('sets a subject, writes an entrance, names a primary and takes it all back', async () => {
    mount([hook('Somebody arrives')]);
    await screen.findByLabelText('Title');
    await waitFor(() => {
      expect(listLibrary).toHaveBeenCalled();
    });

    openFold('Introduces');
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Arrives' })).toBeDefined();
    });

    // The subject is what turns the field on — there is no separate switch,
    // because an introduction with no subject is a hook that can never fire.
    await waitFor(() => {
      expect(
        within(screen.getByRole('combobox', { name: 'Arrives' })).getAllByRole('option'),
      ).toHaveLength(2);
    });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Arrives' }), 'actor-vera');
    expect(latest[0]?.introduces).toEqual({
      actor: { id: 'actor-vera', name: 'Vera Kohl' },
      entrances: [],
      primaryEntranceId: null,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Add an entrance' }));
    expect(latest[0]?.introduces?.entrances).toHaveLength(1);

    await userEvent.type(screen.getByLabelText('Label'), 'Through the rain');
    await userEvent.type(screen.getByLabelText('Text'), 'She is already sitting down.');
    const entrance = latest[0]?.introduces?.entrances[0];
    expect(entrance?.label).toBe('Through the rain');
    expect(entrance?.text).toBe('She is already sitting down.');

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Primary entrance' }),
      entrance!.id,
    );
    expect(latest[0]?.introduces?.primaryEntranceId).toBe(entrance?.id);

    /**
     * Removing the entrance takes the primary with it: an id pointing at
     * nothing is what a manual fire would read as *use this* and find nothing
     * to use, which is worse than no favourite at all.
     */
    await userEvent.click(screen.getByRole('button', { name: 'Remove Through the rain' }));
    expect(latest[0]?.introduces?.entrances).toEqual([]);
    expect(latest[0]?.introduces?.primaryEntranceId).toBeNull();

    // And choosing nobody removes the key rather than blanking it — the one
    // edit a patch cannot express.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Arrives' }), '');
    expect(Object.hasOwn(latest[0] ?? {}, 'introduces')).toBe(false);
  });
});

/**
 * ***An answer that arrives after other edits*** (2026-09-27) — [10 §11.5]'s
 * *"every field stays directly typeable while an assist is running"*.
 *
 * A hook's premise and an entrance's text carry an assist. Its answer used to
 * build the next list — and the next arrival — from the render that started it,
 * so it put back everything typed in the meantime, and an entrance removed in
 * the meantime came back with its primacy. Each change is now a function of the
 * list as it is when it lands.
 */
describe('an answer that arrives after other edits', () => {
  const VERA = { id: 'actor-vera', name: 'Vera Kohl' };

  it('keeps the title typed while the premise was being written', async () => {
    const one = hook('The war');
    mountWithAssist([one]);
    await screen.findByLabelText('Title');
    const premise = heldSubject(`hooks.${one.id}.premise`);

    await userEvent.type(screen.getByLabelText('Title'), '!');
    await answerLate(premise, 'Over some damned island.');

    expect(latest[0]?.title).toBe('The war!');
    expect(latest[0]?.premise).toBe('Over some damned island.');
  });

  it('keeps an entrance’s label typed while its text was being written', async () => {
    const one = hook('Somebody arrives', {
      introduces: {
        actor: VERA,
        entrances: [{ id: 'entrance-rain', label: '', text: '' }],
        primaryEntranceId: null,
      },
    });
    mountWithAssist([one]);
    await screen.findByLabelText('Title');
    openFold(/^Introduces/);
    const text = heldSubject(`hooks.${one.id}.introduces.entrances.entrance-rain.text`);

    await userEvent.type(screen.getByLabelText('Label'), 'Through the rain');
    await answerLate(text, 'She is already sitting down.');

    expect(latest[0]?.introduces?.entrances).toEqual([
      { id: 'entrance-rain', label: 'Through the rain', text: 'She is already sitting down.' },
    ]);
  });

  /**
   * The answer for an entrance that has gone has nowhere to land. And the
   * primary is read off the arrival as it is: a favourite chosen after the
   * answer was asked for is one the answer knows nothing about, and must keep.
   */
  it('does not bring back an entrance removed meanwhile, or unset the primary chosen since', async () => {
    const one = hook('Somebody arrives', {
      introduces: {
        actor: VERA,
        entrances: [
          { id: 'entrance-rain', label: 'Through the rain', text: '' },
          { id: 'entrance-door', label: 'By the door', text: 'She knocks.' },
        ],
        primaryEntranceId: 'entrance-rain',
      },
    });
    mountWithAssist([one]);
    await screen.findByLabelText('Title');
    openFold(/^Introduces/);
    const text = heldSubject(`hooks.${one.id}.introduces.entrances.entrance-rain.text`);

    await userEvent.click(screen.getByRole('button', { name: 'Remove Through the rain' }));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Primary entrance' }),
      'entrance-door',
    );
    await answerLate(text, 'She is already sitting down.');

    expect(latest[0]?.introduces?.entrances.map((entrance) => entrance.id)).toEqual([
      'entrance-door',
    ]);
    expect(latest[0]?.introduces?.primaryEntranceId).toBe('entrance-door');
  });
});
