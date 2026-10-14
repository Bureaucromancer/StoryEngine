// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The HUD strip — [10 §1.3]'s *"world state as a strip of widgets you can edit
 * in place"*, built at [P12A](../../../../docs/design/workplan/35-p12a-the-look.md)
 * P12A.4 under the decisions its §0.4 records.
 *
 * **Two claims, and each is the stage.** That an entry *writes* — through the
 * ordinary channel route, from an edit the server derived from the channel's
 * schema, with a refusal said rather than swallowed — because [P12A §1.4] calls
 * an uneditable HUD *"the stage not done"*. And that every item *opens in
 * place* to the controls the column's panels held, found by role and name,
 * with Escape handing the keyboard back to the item it opened from.
 */

const readSession = vi.fn();
const writeSessionChannel = vi.fn();
const listLibrary = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    readSession: (...a: unknown[]) => readSession(...a) as unknown,
    writeSessionChannel: (...a: unknown[]) => writeSessionChannel(...a) as unknown,
    api: { ...actual.api, listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown },
  };
});

const { HudStrip } = await import('./HudStrip.js');

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

/** Scene's place as the server sends it since P12A.4: its value and its edit beside its text. */
function place(value: string | null) {
  return {
    key: 'se.location',
    channelId: 'se.location',
    scopeKey: null,
    kind: 'text',
    label: 'Place',
    text: value ?? '',
    edit: { kind: 'text', nullable: true },
    value,
  };
}

const CLOCK = {
  key: 'se.clock',
  channelId: 'se.clock',
  scopeKey: null,
  kind: 'text',
  label: 'Time',
  text: 'Day 3, 09:05',
  edit: null,
};

const ROUND = {
  key: 'example.round',
  channelId: 'example.round',
  scopeKey: null,
  kind: 'text',
  label: 'Round',
  text: '3',
  edit: { kind: 'number', integer: true, nullable: false, min: 0, max: 10 },
  value: 3,
};

const VERA = {
  actorId: 'actor-vera',
  presence: true,
  status: 'alive',
  pending: null,
  introduced: true,
  party: null,
};

const DEGRADED = {
  key: 'se.clock',
  channelId: 'se.clock',
  scopeKey: null,
  version: 1,
  reason: '/minute must be equal to one of the allowed values',
  raw: { day: 1, hour: 8, minute: 5 },
  value: { day: 1, hour: 8, minute: 0 },
};

function sessionWith(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session: { id: SESSION_ID, name: 'A wet week' },
    activeJob: null,
    health: [],
    hud: [CLOCK, place('the harbour')],
    surfaces: [],
    cast: [],
    hooks: { pacing: 'normal', rows: [] },
    goals: { rows: [], concluded: false },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readSession.mockResolvedValue(sessionWith());
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
  writeSessionChannel.mockResolvedValue({
    session: { id: SESSION_ID },
    effect: { applied: true, rejectedReason: null },
    health: [],
  });
});

function renderStrip(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HudStrip sessionId={SESSION_ID} locale="en-US" busy={false} onSpeak={vi.fn()} />
      <button type="button">After the strip</button>
    </QueryClientProvider>,
  );
}

/** The strip itself, once the session has arrived. */
async function theStrip(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: 'The story now' });
}

describe('an entry of the strip', () => {
  /**
   * ***Place, corrected where it is shown.*** The write is the channel route's,
   * the value is what was typed — not the sentence the prompt renders — and the
   * strip reads the new place the moment the session does, with the keyboard
   * back on the entry it was opened from. Mutations: the panel left open after
   * a Save, and the keyboard left on the hidden box (`Popover`'s hand-back of
   * a stranded keyboard removed).
   */
  it('writes Place through the channel, and then shows the new place', async () => {
    renderStrip();
    const strip = await theStrip();
    await userEvent.click(within(strip).getByRole('button', { name: 'Place the harbour' }));

    const box = screen.getByRole('textbox', { name: 'Place' });
    expect(document.activeElement).toBe(box);
    expect((box as HTMLInputElement).value).toBe('the harbour');

    readSession.mockResolvedValue(sessionWith({ hud: [CLOCK, place('the docks')] }));
    await userEvent.clear(box);
    await userEvent.type(box, 'the docks{Enter}');

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'se.location', 'the docks');
    });
    const entry = await within(strip).findByRole('button', { name: 'Place the docks' });
    expect(entry.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(entry);
    expect(writeSessionChannel).toHaveBeenCalledTimes(1);
  });

  /**
   * ***What was typed is written when focus leaves, as `TokenField` does*** —
   * [P12A.3]'s review left this stage that sentence. Mutation: the close
   * dropping the draft, and nothing is written.
   */
  it('writes what was typed when the keyboard leaves it, and nothing when nothing changed', async () => {
    renderStrip();
    const strip = await theStrip();
    const entry = within(strip).getByRole('button', { name: 'Place the harbour' });

    // Opened and left untouched: a close, not an empty turn on the record.
    await userEvent.click(entry);
    await userEvent.click(screen.getByRole('button', { name: 'After the strip' }));
    expect(writeSessionChannel).not.toHaveBeenCalled();

    await userEvent.click(entry);
    await userEvent.type(screen.getByRole('textbox', { name: 'Place' }), ', north quay');
    await userEvent.tab(); // to Save, still inside
    await userEvent.tab(); // out of the panel

    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(
        SESSION_ID,
        'se.location',
        'the harbour, north quay',
      );
    });
    expect(screen.queryByRole('dialog', { name: 'Place' })).toBeNull();
  });

  /**
   * ***Escape is never mind***, the one close that drops what was typed, and
   * it hands the keyboard back to the entry. Mutations: Escape committing like
   * every other close, Escape keeping the draft, and the refocus removed — both
   * arms of it, Escape's own and the stranded keyboard's hand-back, since
   * either alone covers the other.
   */
  it('drops what was typed on Escape, and gives the keyboard back to the entry', async () => {
    renderStrip();
    const strip = await theStrip();
    const entry = within(strip).getByRole('button', { name: 'Place the harbour' });
    await userEvent.click(entry);
    await userEvent.type(screen.getByRole('textbox', { name: 'Place' }), ', north quay');

    await userEvent.keyboard('{Escape}');

    expect(document.activeElement).toBe(entry);
    expect(screen.queryByRole('dialog', { name: 'Place' })).toBeNull();
    expect(writeSessionChannel).not.toHaveBeenCalled();
    await userEvent.click(entry);
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Place' }).value).toBe(
      'the harbour',
    );
  });

  /**
   * ***A refusal is a `200` with the effect unapplied***, and it is said in the
   * entry's words by its class — in the panel, and in the strip once the panel
   * has closed, so a write that did not land never looks as though it did. A
   * close does not ask again what was just refused, which would record the
   * refusal twice. Mutations: `applied` not read (the panel closes as if
   * saved), the strip's note removed, the re-send on close let through.
   */
  it('says a refusal in its own words, in the panel and after it has closed', async () => {
    writeSessionChannel.mockResolvedValue({
      session: { id: SESSION_ID },
      effect: { applied: false, rejectedReason: 'schema' },
      health: [],
    });
    renderStrip();
    const strip = await theStrip();
    await userEvent.click(within(strip).getByRole('button', { name: 'Place the harbour' }));
    const box = screen.getByRole('textbox', { name: 'Place' });
    await userEvent.clear(box);
    await userEvent.type(box, 'the docks{Enter}');

    const said = 'Place was not changed. That doesn’t fit what Place holds.';
    const dialog = screen.getByRole('dialog', { name: 'Place' });
    expect((await within(dialog).findByRole('alert')).textContent).toBe(said);

    await userEvent.click(screen.getByRole('button', { name: 'After the strip' }));

    expect(screen.queryByRole('dialog', { name: 'Place' })).toBeNull();
    expect(within(strip).getByRole('alert').textContent).toBe(said);
    expect(within(strip).getByRole('button', { name: 'Place the harbour' })).toBeTruthy();
    expect(writeSessionChannel).toHaveBeenCalledTimes(1);
  });

  /**
   * ***A number is checked against the bounds its schema gives, at the box***,
   * before anything is sent — the common mistake said where it is fixed rather
   * than as a refusal on the record — and sent as a number. Mutations: the
   * bound check removed (11 is written), the whole-number check removed, the
   * value sent as the typed string.
   */
  it('holds a number to its bounds at the box, and writes it as a number', async () => {
    readSession.mockResolvedValue(sessionWith({ hud: [ROUND] }));
    renderStrip();
    const strip = await theStrip();
    await userEvent.click(within(strip).getByRole('button', { name: 'Round 3' }));
    const box = screen.getByRole('spinbutton', { name: 'Round' });

    await userEvent.clear(box);
    await userEvent.type(box, '11{Enter}');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Between 0 and 10.')).toBeTruthy();

    await userEvent.clear(box);
    await userEvent.type(box, '2.5{Enter}');
    expect(screen.getByText('That is not a whole number.')).toBeTruthy();
    expect(writeSessionChannel).not.toHaveBeenCalled();

    await userEvent.clear(box);
    await userEvent.type(box, '7{Enter}');
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'example.round', 7);
    });
  });

  /**
   * ***A write's answer does not take back what was typed after it was sent***
   * (2026-10-14, after review). Only the words sent landed; more typed while
   * the write was out are still unsaved, so they stay in the box, and the Save
   * that sent the first words does not close the panel over them. Mutation:
   * the answer reading the render that sent it (`HudEntry`'s `now.current !==
   * sent` guard removed) — the box goes back to *the docks* and the panel
   * closes.
   */
  it('keeps what was typed while a write was out, and the panel open', async () => {
    let answer: (result: unknown) => void = () => undefined;
    writeSessionChannel.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderStrip();
    const strip = await theStrip();
    await userEvent.click(within(strip).getByRole('button', { name: 'Place the harbour' }));
    const box = screen.getByRole<HTMLInputElement>('textbox', { name: 'Place' });
    await userEvent.clear(box);
    await userEvent.type(box, 'the docks{Enter}');
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledTimes(1);
    });

    await userEvent.type(box, ', north quay');
    readSession.mockResolvedValue(sessionWith({ hud: [CLOCK, place('the docks')] }));
    answer({
      session: { id: SESSION_ID },
      effect: { applied: true, rejectedReason: null },
      health: [],
    });

    await within(strip).findByRole('button', { name: 'Place the docks' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
    });
    expect(box.value).toBe('the docks, north quay');
    expect(screen.getByRole('dialog', { name: 'Place' })).toBeTruthy();
    expect(writeSessionChannel).toHaveBeenCalledTimes(1);
  });

  /**
   * ***Text a number box cannot read is said, not written as nothing***
   * (2026-10-14, after review). A `type="number"` box holding *1-2* or *abc*
   * reports its value as `''`, as an emptied one does, and for a number that
   * may be unset an empty box is a write of `null` — a recorded clearing of the
   * channel. jsdom never sets `badInput` itself, so the box's validity is
   * stubbed. Mutation: the `badInput` check removed, and `null` is written.
   */
  it('says a number box holds text it cannot read, rather than writing nothing for it', async () => {
    readSession.mockResolvedValue(
      sessionWith({
        hud: [
          {
            ...ROUND,
            edit: { kind: 'number', integer: false, nullable: true, min: null, max: null },
          },
        ],
      }),
    );
    renderStrip();
    const strip = await theStrip();
    await userEvent.click(within(strip).getByRole('button', { name: 'Round 3' }));
    const box = screen.getByRole('spinbutton', { name: 'Round' });
    await userEvent.clear(box);
    Object.defineProperty(box, 'validity', { value: { badInput: true } });

    await userEvent.keyboard('{Enter}');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('That is not a number.')).toBeTruthy();

    await userEvent.tab(); // to Save, still inside
    await userEvent.tab(); // out of the panel
    expect(screen.queryByRole('dialog', { name: 'Round' })).toBeNull();
    expect(within(strip).getByRole('alert').textContent).toBe(
      'Round was not changed. That is not a number.',
    );
    expect(writeSessionChannel).not.toHaveBeenCalled();
  });

  /**
   * ***Anything else is not changed here, and says so*** — the clock is an
   * object, and an entry from a server older than this stage carries no edit at
   * all; both open to the sentence rather than to a box that would write
   * refusals. Mutation: a text box offered whatever the edit, and the clock's
   * rendered sentence is a value waiting to be written back.
   */
  it('opens an entry it cannot change to a sentence saying so, and no box', async () => {
    // An entry from a server older than P12A.4: no edit, no value.
    const older = {
      key: 'se.location',
      channelId: 'se.location',
      scopeKey: null,
      kind: 'text',
      label: 'Place',
      text: 'the harbour',
    };
    readSession.mockResolvedValue(sessionWith({ hud: [CLOCK, older] }));
    renderStrip();
    const strip = await theStrip();

    for (const name of ['Time Day 3, 09:05', 'Place the harbour']) {
      await userEvent.click(within(strip).getByRole('button', { name }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText(/can’t be changed from here/)).toBeTruthy();
      expect(within(dialog).queryByRole('textbox')).toBeNull();
      await userEvent.keyboard('{Escape}');
    }
  });

  /**
   * ***Not set is the state a person corrects***, so a place nobody has named
   * stands in the strip, said, and clearing a nullable box writes `null` rather
   * than `""`. Mutation: an empty box sent as the empty string.
   */
  it('shows an unset place as not set, and clears a place to nothing', async () => {
    readSession.mockResolvedValue(sessionWith({ hud: [place(null)] }));
    renderStrip();
    const strip = await theStrip();
    expect(within(strip).getByRole('button', { name: 'Place not set' })).toBeTruthy();

    readSession.mockResolvedValue(sessionWith({ hud: [place('the harbour')] }));
    await userEvent.click(within(strip).getByRole('button', { name: 'Place not set' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Place' }), 'the harbour{Enter}');
    await within(strip).findByRole('button', { name: 'Place the harbour' });

    await userEvent.click(within(strip).getByRole('button', { name: 'Place the harbour' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Place' }));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenLastCalledWith(SESSION_ID, 'se.location', null);
    });
  });
});

describe('a mode’s placements in the strip', () => {
  /**
   * ***The `hud` region is drawn, at last.*** The session route has said a
   * contribution naming it *"appends to the strip"* since P7.11, and nothing
   * drew one. A `text` placed there is a channel's own entry by [10 §8.0]'s
   * definition, so it is drawn and edited the same way; a panel's placement is
   * not drawn here. Mutations: the region left undrawn, and the text drawn
   * as a panel's read-only line.
   * *(2026-10-13, P12A.5: a panel's placement **is** drawn here now, since the
   * column it stacked in is gone and a reading is a fact about now — but as
   * an item of its own and read-only, the server sending an edit only for
   * the `hud` region. So the assertion that the panel's line was absent from
   * the strip is the assertion that it is not the entry pressed: its own
   * item, opening to the sentence and not to a box.)*
   */
  it('draws a text a mode placed in the strip, and writes it like any entry', async () => {
    readSession.mockResolvedValue(
      sessionWith({
        hud: [],
        surfaces: [
          {
            region: 'hud',
            key: 'example.weather',
            channelId: 'example.weather',
            scopeKey: null,
            kind: 'text',
            label: 'Sky',
            text: 'rain',
            edit: { kind: 'text', nullable: false },
            value: 'rain',
          },
          {
            region: 'panel',
            key: 'example.weather',
            channelId: 'example.weather',
            scopeKey: null,
            kind: 'text',
            label: 'Weather, at length',
            text: 'rain',
          },
        ],
      }),
    );
    renderStrip();
    const strip = await theStrip();

    await userEvent.click(within(strip).getByRole('button', { name: 'Sky rain' }));
    const panels = within(strip).getByRole('button', { name: 'Weather, at length rain' });
    expect(panels.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);

    const box = screen.getByRole('textbox', { name: 'Sky' });
    await userEvent.clear(box);
    await userEvent.type(box, 'hail{Enter}');
    await waitFor(() => {
      expect(writeSessionChannel).toHaveBeenCalledWith(SESSION_ID, 'example.weather', 'hail');
    });

    await userEvent.click(panels);
    // *(2026-10-14, P12A's final audit: the sentence for an entry sent with no
    // edit, not the one that calls a string neither text nor a number.
    // Mutation: the read-only branch always saying `readOnly`.)*
    expect(within(strip).getByText('This can’t be changed from here.')).toBeTruthy();
    expect(within(strip).queryByText(/and this is neither/)).toBeNull();
  });

  /**
   * ***A picture is not a line, so it opens in place under its label***, and a
   * switch, which is, is drawn in the line as it is anywhere. No built-in mode
   * places either in the strip; the arms are drawn because the region is.
   * Mutation: the picture drawn in the line, as a panel draws it — the item
   * named by its label is not there to press.
   */
  it('opens a picture placed in the strip under its label, and draws a switch in the line', async () => {
    readSession.mockResolvedValue(
      sessionWith({
        hud: [],
        surfaces: [
          {
            region: 'hud',
            key: 'example.look',
            channelId: 'example.look',
            scopeKey: null,
            kind: 'image',
            label: 'How Vera looks',
            image: { url: '/api/x.png', alt: 'Vera, uneasy' },
          },
          {
            region: 'hud',
            key: 'example.rain',
            channelId: 'example.rain',
            scopeKey: null,
            kind: 'toggle',
            label: 'Rain',
            on: true,
          },
        ],
      }),
    );
    renderStrip();
    const strip = await theStrip();

    expect(within(strip).getByRole('checkbox', { name: 'Rain' })).toBeTruthy();
    expect(within(strip).queryByRole('img', { name: 'Vera, uneasy' })).toBeNull();
    await userEvent.click(within(strip).getByRole('button', { name: 'How Vera looks' }));
    const dialog = screen.getByRole('dialog', { name: 'How Vera looks' });
    expect(within(dialog).getByRole('img', { name: 'Vera, uneasy' })).toBeTruthy();
  });
});

describe('the strip’s items open in place', () => {
  /**
   * ***Every control the column's four story-now panels held, after one
   * press***, each in a panel named for what it is, and Escape back to the
   * item it was opened from. Mutations: the cast item drawn without its
   * panel, the health item's rows left out, and the refocus on Escape removed
   * both ways (see the Escape test above).
   */
  it('opens the cast, the goal, the hooks and the health to their controls', async () => {
    readSession.mockResolvedValue(
      sessionWith({
        session: {
          id: SESSION_ID,
          name: 'A wet week',
          cast: { persona: null, actors: ['actor-vera', 'actor-ned'] },
        },
        health: [DEGRADED],
        cast: [VERA, { ...VERA, actorId: 'actor-ned', presence: false }],
      }),
    );
    renderStrip();
    const strip = await theStrip();

    const items: [RegExp, string, [string, string][]][] = [
      [
        /could not be loaded/,
        'Channels that could not be loaded',
        [
          ['button', 'Try again'],
          ['button', 'Accept the reset'],
        ],
      ],
      [
        /^Cast\b/,
        'Cast',
        [
          ['combobox', 'You play'],
          ['button', 'Play as them'],
          ['combobox', 'Status for Vera Kohl'],
        ],
      ],
      [
        /^No objective$/,
        'Objective',
        [
          ['textbox', 'Set an objective'],
          ['button', 'Set'],
        ],
      ],
      [/^Plot hooks/, 'Plot hooks', [['button', 'Add']]],
    ];
    for (const [item, panel, controls] of items) {
      const trigger = within(strip).getByRole('button', { name: item });
      expect(screen.queryByRole('dialog', { name: panel })).toBeNull();

      await userEvent.click(trigger);
      const dialog = screen.getByRole('dialog', { name: panel });
      for (const [role, name] of controls) {
        expect(within(dialog).getByRole(role, { name })).toBeTruthy();
      }

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: panel })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    }
  });

  /**
   * ***Who is here, at a glance***: the faces of the present, and how many of
   * the cast that is. Mutation: every row's face drawn, present or not.
   * *(2026-10-14, P12A's final audit: and named, as an image whose name is
   * who it draws, so a screen reader hears who is here as a sighted reader
   * sees it. Mutation: the group put back to `aria-hidden`.)*
   */
  it('shows the faces of who is present, and how many of the cast that is', async () => {
    readSession.mockResolvedValue(
      sessionWith({ cast: [VERA, { ...VERA, actorId: 'actor-ned', presence: false }] }),
    );
    renderStrip();
    const strip = await theStrip();

    const cast = await within(strip).findByRole('button', { name: 'Cast Vera Kohl 1 of 2 here' });
    // The tile for Vera is drawn and Ned, who is elsewhere, has none.
    expect(within(cast).getByRole('img', { name: 'Vera Kohl' }).children).toHaveLength(1);
  });

  /**
   * ***A death the engine refused is said on the strip*** (2026-10-14, P12A's
   * final audit) — [06 §8.1]'s prominent surface, which the cast panel's
   * `Alert` was until P12A.4 put the panel a press away. Said on the item, in
   * the warning tone, and in a live region beside it, without a press; the
   * ruling's two buttons are one press away. Mutation: the escalation removed
   * — the item left as `strip.item` with the count alone.
   */
  it('says a ruling the narrator is waiting on without a press', async () => {
    readSession.mockResolvedValue(sessionWith({ cast: [{ ...VERA, pending: 'dead' }] }));
    renderStrip();
    const strip = await theStrip();

    const cast = await within(strip).findByRole('button', {
      name: /^Cast Vera Kohl 1 of 1 here The narrator has Vera Kohl as dead\. Rule on it$/,
    });
    expect(cast.className.split(' ')).toContain('bg-warn-surface');
    expect(within(strip).getByRole('status').textContent).toBe(
      'The narrator has Vera Kohl as dead. Rule on it',
    );

    await userEvent.click(cast);
    const panel = screen.getByRole('dialog', { name: 'Cast' });
    expect(within(panel).getByRole('button', { name: 'Confirm' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Not so' })).toBeTruthy();
  });

  /**
   * The first ruling named and the rest counted, in one sentence of its own —
   * and with nobody pending the item is quiet and its live region mounted and
   * empty, listening for the turn that brings one.
   */
  it('names the first ruling and counts the rest, and is quiet with none', async () => {
    readSession.mockResolvedValue(
      sessionWith({
        cast: [
          { ...VERA, pending: 'dead' },
          { ...VERA, actorId: 'actor-ned', pending: 'dead' },
        ],
      }),
    );
    renderStrip();
    let strip = await theStrip();
    expect(
      await within(strip).findByRole('button', {
        name: /The narrator has Vera Kohl as dead, and 1 more\. Rule on them$/,
      }),
    ).toBeTruthy();
    cleanup();

    readSession.mockResolvedValue(sessionWith({ cast: [VERA] }));
    renderStrip();
    strip = await theStrip();
    const cast = await within(strip).findByRole('button', { name: 'Cast Vera Kohl 1 of 1 here' });
    expect(cast.className.split(' ')).not.toContain('bg-warn-surface');
    expect(within(strip).getByRole('status').textContent).toBe('');
  });

  /**
   * ***What was typed into a panel survives its closing*** — the add-a-hook
   * form's half-typed title, a press outside later — because a strip item's
   * panel is hidden rather than unmade, as the `<details>` it replaces kept its
   * contents while shut. Mutation: the panel unmade on close, and the title is
   * gone.
   */
  it('keeps what was typed into a panel when it closes', async () => {
    renderStrip();
    const strip = await theStrip();
    const hooks = within(strip).getByRole('button', { name: /^Plot hooks/ });

    await userEvent.click(hooks);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Something you want to happen' }),
      'The ferry is late',
    );
    await userEvent.click(screen.getByRole('button', { name: 'After the strip' }));
    expect(screen.queryByRole('dialog', { name: 'Plot hooks' })).toBeNull();

    await userEvent.click(hooks);
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Something you want to happen' }).value,
    ).toBe('The ferry is late');
  });

  /**
   * ***One open at a time***, because each opens to the same place under the
   * strip: pressing a second item is a press outside the first.
   */
  it('closes one item as another opens', async () => {
    renderStrip();
    const strip = await theStrip();

    await userEvent.click(within(strip).getByRole('button', { name: /^Plot hooks/ }));
    await userEvent.click(within(strip).getByRole('button', { name: 'No objective' }));

    expect(screen.queryByRole('dialog', { name: 'Plot hooks' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Objective' })).toBeTruthy();
  });
});
