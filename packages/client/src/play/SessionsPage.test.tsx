// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Starting a session with something to retrieve from — [P6B.0].
 *
 * **This form is where PLAYABLE stopped.** `POST /api/sessions` has accepted
 * `treatment`, `lore` and `preset` since P5.6 and this page sent `name` alone,
 * so every session ever started in the browser resolved zero lorebooks and ran
 * the mode's built-in preset — which made an imported preset unplayable and the
 * retrieval half of P5 unreachable
 * ([P6B §0.1](../../../../docs/design/workplan/20-p6b-playable.md)).
 *
 * The preset is the field with no second chance: a session copies it at
 * creation and no route changes it afterwards, so a session started without one
 * is on the default forever.
 */

const listSessions = vi.fn();
const createSession = vi.fn();
const listLibrary = vi.fn();
const renameSession = vi.fn();
const listModes = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    listSessions: (...a: unknown[]) => listSessions(...a) as unknown,
    createSession: (...a: unknown[]) => createSession(...a) as unknown,
    renameSession: (...a: unknown[]) => renameSession(...a) as unknown,
    listModes: (...a: unknown[]) => listModes(...a) as unknown,
    api: { ...actual.api, listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown },
  };
});

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const { SessionsPage, setupLine } = await import('./SessionsPage.js');
const { ApiError } = await import('../api.js');

/** The install's default, which the form sends explicitly since [P7.4]. */
const SCENE = 'storyengine.scene';

function aSession(id: string, name: string) {
  return {
    id,
    name,
    createdAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:00:00Z',
    headTurnId: null,
  };
}

function libraryObject(id: string, name: string, schema: string) {
  return {
    id,
    name,
    schema,
    slug: id,
    source: 'user',
    contentHash: 'sha256:x',
    shadowed: false,
    object: {},
  };
}

/** A mode with no wizard, which is Scene and every session before [P7.4]. */
function plainMode(id = 'storyengine.scene', displayName = 'Scene') {
  return {
    id,
    displayName,
    voice: 'narrator',
    dispatch: 'merged',
    participants: { select: 'fixed', maxActors: 1 },
    inputs: ['do'],
    presetIds: [],
    setup: { kind: 'none' },
    surfaces: [],
  };
}

/** The fixture's shape: one of each arm of the widget vocabulary. */
const WIZARD = {
  ...plainMode('storyengine.test.setup', 'Wizard'),
  setup: {
    kind: 'declared',
    fields: [
      {
        id: 'premise',
        required: true,
        widget: { kind: 'text', label: 'What is this story about?', lines: 4 },
      },
      {
        id: 'difficulty',
        required: true,
        widget: {
          kind: 'choice',
          label: 'How much should the world resist you?',
          options: [
            { value: 'gentle', label: 'Gentle' },
            { value: 'harsh', label: 'Harsh' },
          ],
        },
      },
      { id: 'dice', widget: { kind: 'toggle', label: 'Roll dice for outcomes' } },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  listModes.mockResolvedValue({ modes: [plainMode()], defaultModeId: 'storyengine.scene' });
  listSessions.mockResolvedValue({ sessions: [] });
  createSession.mockResolvedValue({ session: { id: 'new-1', name: 'A wet week' } });
  listLibrary.mockImplementation((kind: string) => {
    if (kind === 'lorebooks') {
      return Promise.resolve({
        objects: [libraryObject('book-rain', 'Rain City', 'storyengine.lorebook.1')],
      });
    }
    if (kind === 'treatments') {
      return Promise.resolve({
        objects: [libraryObject('treat-wet', 'A wet week', 'storyengine.treatment.1')],
      });
    }
    if (kind === 'actors') {
      return Promise.resolve({
        objects: [libraryObject('actor-vera', 'Vera Kohl', 'storyengine.actor.1')],
      });
    }
    return Promise.resolve({
      objects: [libraryObject('preset-noir', 'Rain noir', 'storyengine.preset.1')],
    });
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SessionsPage />
    </QueryClientProvider>,
  );
}

describe('setupLine', () => {
  it('says plainly when a session would start with nothing', () => {
    // The fold is closed by default, so this line is the only thing between
    // somebody and the state every session was in before [P6B.0].
    expect(setupLine(0, false, false, false)).toBe(
      'Nothing chosen yet — the mode default, and no lorebooks',
    );
  });

  it('names what was chosen, and counts the books', () => {
    expect(setupLine(1, false, false, false)).toBe('With one lorebook');
    expect(setupLine(2, true, false, false)).toBe('With a treatment, 2 lorebooks');
    expect(setupLine(0, true, true, false)).toBe('With a treatment, a preset');
  });

  it('names the persona first, because its absence is the silent one', () => {
    // The other three change what a session *retrieves* and show up as missing
    // content. A missing persona shows up as prose addressed to "the player",
    // which reads like a writing choice rather than an unset field.
    expect(setupLine(0, false, false, true)).toBe('With a persona');
    expect(setupLine(1, true, true, true)).toBe(
      'With a persona, a treatment, one lorebook, a preset',
    );
  });
});

describe('starting a session', () => {
  it('sends the name alone when nothing else was chosen', async () => {
    renderPage();

    await userEvent.type(
      screen.getByLabelText('Name for the new session, if you have one'),
      'A wet week',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    // Absent rather than empty: the route's optional fields mean *unset*, and
    // an empty list would be a session that has decided to retrieve nothing.
    await waitFor(() => {
      /**
       * ***`mode` travels now, where it used to be omitted — [P7.4].*** The
       * form had no mode control at all, so an absent `mode` meant *whatever
       * the route defaults to* and the two agreed by not being asked. With a
       * picker on the form the displayed mode and the created one have to be
       * the same thing, so the effective id is sent rather than left implied.
       */
      expect(createSession).toHaveBeenCalledWith({ name: 'A wet week', mode: SCENE });
    });
  });

  it('sends the treatment, the books and the preset that were chosen', async () => {
    renderPage();

    await userEvent.type(
      screen.getByLabelText('Name for the new session, if you have one'),
      'A wet week',
    );
    await userEvent.click(await screen.findByText(/Nothing chosen yet/));

    await userEvent.selectOptions(screen.getByLabelText('Treatment'), 'treat-wet');
    await userEvent.selectOptions(screen.getByLabelText('Preset'), 'preset-noir');
    await userEvent.click(screen.getByLabelText('Rain City'));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({
        name: 'A wet week',
        treatment: 'treat-wet',
        preset: 'preset-noir',
        lore: ['book-rain'],
        mode: SCENE,
      });
    });
  });

  /**
   * **The half of the cast deferral that was wrong** — [P7 §0.2] item 5.
   *
   * `cast.persona` stays a plain session field through P7 ([P7 §1.6], [06 §8]);
   * `cast.actors` becomes channel state. Deferring both meant every session
   * started in a browser had no persona at all, so the shipped preset's
   * `se.persona` slot omitted and the instruction addressed *the player* — the
   * same class of gap P6B.0 closed for lore, sitting beside it.
   *
   * Asserted as *what reaches the API* rather than as what the select shows,
   * because the wire shape is the thing the route has to accept: `cast` with
   * both members, `actors` empty because `CastBody` requires it.
   */
  it('sends a chosen persona as a cast, and nothing else', async () => {
    renderPage();

    await userEvent.click(await screen.findByText(/Nothing chosen yet/));
    await userEvent.selectOptions(screen.getByLabelText('Persona'), 'actor-vera');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({ persona: 'actor-vera', mode: SCENE });
    });
  });

  it('sends no cast when nobody was chosen, which is not the same as an empty one', async () => {
    // A session that named nobody and a session that named nobody *in
    // particular* are the same thing here, and both must leave `cast` off the
    // wire — the route's optional field means unset, and sending
    // `{persona: null, actors: []}` would be a session asserting an empty cast.
    renderPage();

    await userEvent.click(await screen.findByText(/Nothing chosen yet/));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({ mode: SCENE });
    });
  });

  /**
   * **The change this whole workstream is.**
   *
   * Start used to read `if (name.trim().length > 0) create.mutate()`, so this
   * exact interaction — press Start, having typed nothing — did nothing at all.
   * Not a refusal and not a prevention, which is the shape
   * [10 §11.1a](../../../../docs/design/10-ui-surfaces.md) exists to rule out. Asserting on
   * the argument rather than only on the call matters: sending `{ name: '' }`
   * would also "work", and would put an empty string on the wire as though it
   * were a choice somebody made.
   */
  it('starts a session with nothing typed at all', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({ mode: SCENE });
    });
  });

  it('says so when the server refuses', async () => {
    createSession.mockRejectedValue(new Error('No such preset.'));
    renderPage();

    await userEvent.type(
      screen.getByLabelText('Name for the new session, if you have one'),
      'A wet week',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('No such preset.');
    });
  });
});

describe('a session that has not been named', () => {
  /**
   * A bug that predates unnamed sessions being reachable from the form: the
   * list rendered `{session.name}` bare, so a session whose name is `''` — one
   * hand-edit away, since `session.json` is meant to be edited — produced a
   * link with no accessible name and nothing to click. Queried by role rather
   * than by text, because *findable and clickable* is the actual claim.
   */
  it('is labelled, and its link can still be found and followed', async () => {
    listSessions.mockResolvedValue({ sessions: [aSession('s-1', '')] });
    renderPage();

    expect(await screen.findByRole('link', { name: 'Untitled session' })).toBeTruthy();
  });

  /**
   * The rename box opens on the *stored* name, not on the label. Seeding it
   * with *Untitled session* is how a placeholder becomes somebody's real
   * session name the first time they press Save without reading it.
   */
  it('opens its rename box empty rather than seeded with the placeholder', async () => {
    listSessions.mockResolvedValue({ sessions: [aSession('s-1', '')] });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Rename Untitled session' }));

    const box = screen.getByRole('textbox', { name: 'Session name' });
    expect((box as HTMLInputElement).value).toBe('');
  });
});

describe('renaming a session from the list', () => {
  it('sends the id and the typed name, and shows the result', async () => {
    listSessions.mockResolvedValue({ sessions: [aSession('s-1', 'Rain City')] });
    renameSession.mockImplementation((_id: string, name: string) => {
      // The list refetches on success, so the mock has to start answering with
      // the new name — otherwise this would pass on a stale cache and prove
      // nothing about the invalidation.
      listSessions.mockResolvedValue({ sessions: [aSession('s-1', name)] });
      return Promise.resolve({ session: aSession('s-1', name) });
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Rename Rain City' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Session name' }), ', after the fire');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(renameSession).toHaveBeenCalledWith('s-1', 'Rain City, after the fire');
    });
    expect(await screen.findByRole('link', { name: 'Rain City, after the fire' })).toBeTruthy();
  });

  it('leaves the name alone when the rename is cancelled', async () => {
    listSessions.mockResolvedValue({ sessions: [aSession('s-1', 'Rain City')] });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Rename Rain City' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Session name' }), ' burned');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(renameSession).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Rain City' })).toBeTruthy();
  });
});

/**
 * **The wizard, rendered from a declaration this build has never heard of** —
 * [06 §7.3], [P7.4], and the stage's exit line as a test.
 *
 * The fixture below is not Scene and is not any mode in `packages/server`: it is
 * a declaration, and everything the form draws from it is drawn by
 * `SetupFields`, which knows a widget vocabulary and a loop. If this passes,
 * then a mode an extension shipped gets a wizard too — which is the only thing
 * *"a mode the engine has no knowledge of"* can mean in a test.
 */
describe('a mode that asks for something', () => {
  async function openWizard() {
    listModes.mockResolvedValue({ modes: [WIZARD], defaultModeId: WIZARD.id });
    renderPage();
    await screen.findByText('Sessions');
    await userEvent.click(screen.getByText(/Nothing chosen yet|Starting with/));
    /**
     * **By accessible name, not by label text** — which also pins what `Field`'s
     * `required` docstring claims: the glyph is `aria-hidden` and the state is
     * `aria-required`, so *"neither gets the word asterisk"*. A
     * `getByLabelText` here matches the label's **text content**, asterisk and
     * all, and would pass only by being loosened — hiding the very thing the
     * mark is supposed to get right.
     */
    return screen.findByRole('textbox', { name: 'What is this story about?' });
  }

  function difficulty(): HTMLSelectElement {
    return screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'How much should the world resist you?',
    });
  }

  it('draws a control for each declared field, of the kind declared', async () => {
    const premise = await openWizard();

    // A text field with `lines: 4` is a textarea; one line would be an input,
    // and the declaration is the only thing that says which.
    expect(premise.tagName).toBe('TEXTAREA');
    expect(difficulty().tagName).toBe('SELECT');
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Roll dice for outcomes' }).type,
    ).toBe('checkbox');
  });

  it('offers exactly the choices the mode declared', async () => {
    await openWizard();

    const options = [...difficulty().querySelectorAll('option')];
    // No empty first option: the field is required, so there is no *unanswered*
    // state to represent and an empty one would be a value nobody chose.
    expect(options.map((one) => one.textContent)).toEqual(['Gentle', 'Harsh']);
  });

  it('sends the answers under the ids the mode declared', async () => {
    const premise = await openWizard();

    await userEvent.type(premise, 'A city that does not sleep.');
    await userEvent.selectOptions(difficulty(), 'harsh');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Roll dice for outcomes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({
        mode: WIZARD.id,
        setup: { premise: 'A city that does not sleep.', difficulty: 'harsh', dice: true },
      });
    });
  });

  /**
   * **A cleared field is removed, not sent as `""`.** The derived schema has no
   * `minLength`, so an empty string satisfies a required field — and a person
   * who typed and then deleted has answered nothing.
   */
  it('sends nothing for a field that was typed into and emptied', async () => {
    const premise = await openWizard();

    await userEvent.type(premise, 'x');
    await userEvent.clear(premise);
    await userEvent.selectOptions(difficulty(), 'gentle');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({
        mode: WIZARD.id,
        setup: { difficulty: 'gentle' },
      });
    });
  });

  /**
   * **The route's refusal, with the field names in it.** A wizard is a form the
   * engine generated, so *that is not what this mode asked for* on its own would
   * leave somebody looking at controls they did not design and guessing.
   */
  it('says which field the server refused', async () => {
    createSession.mockRejectedValue(
      new ApiError(
        422,
        'setup-invalid',
        'That is not what this mode asked for.',
        undefined,
        undefined,
        ["/ must have required property 'difficulty'"],
      ),
    );
    await openWizard();

    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect((await screen.findByRole('alert')).textContent).toContain('difficulty');
  });

  it('says so when a mode wants a control this build does not have', async () => {
    // The vocabulary is additive, so a newer build's `kind` reaches an older
    // client — and skipping it silently would leave a required field the route
    // refuses and nobody was shown.
    listModes.mockResolvedValue({
      modes: [
        {
          ...WIZARD,
          setup: {
            kind: 'declared',
            fields: [{ id: 'map', required: true, widget: { kind: 'hexgrid', label: 'The map' } }],
          },
        },
      ],
      defaultModeId: WIZARD.id,
    });
    renderPage();
    await screen.findByText('Sessions');
    await userEvent.click(screen.getByText(/Nothing chosen yet|Starting with/));

    expect(await screen.findByText(/cannot ask for "The map"/)).toBeTruthy();
  });

  it('draws nothing at all for a mode with no wizard', async () => {
    renderPage();
    await screen.findByText('Sessions');
    await userEvent.click(screen.getByText(/Nothing chosen yet|Starting with/));

    // Scene declares `{ kind: 'none' }`, which is an answer rather than silence
    // — and the answer is that there is nothing to ask.
    expect(screen.queryByRole('textbox', { name: 'What is this story about?' })).toBeNull();
  });
});
