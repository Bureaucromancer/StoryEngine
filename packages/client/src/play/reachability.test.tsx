// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor, within, type ByRoleMatcher } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account, TurnRecord } from '../api.js';
import { cancelledTurn, restingPreview, richTurn, SESSION_ID } from '../workbench/turn-fixtures.js';

/**
 * ***Everything the play column offered is still within reach*** — 2026-10-13,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.5.
 *
 * The stage moved the session's configuration out of the column and into the
 * workbench, and the plan's measurable claim for it is *"every control
 * reachable before is reachable after"*, asserted rather than hoped
 * ([P12A §2](../../../../docs/design/workplan/35-p12a-the-look.md)). Its §0.4
 * said where: `PlayPage.test.tsx` mounts the page alone, and a claim that
 * crosses from the page into the dock needs the **real router and the real
 * shell** — `workbench/dock.test.tsx`'s setup, which this file borrows.
 *
 * **The list below is the column as it stood at the start of the stage** —
 * `5d01529d`, the commit before it — and not a list written from what the
 * stage built. It was taken by rendering that column under this file's
 * fixture through the same router and shell, opening every disclosure in it
 * and every item of the strip in turn, and recording each control by its role
 * and accessible name: buttons, links, check boxes, selects, text boxes,
 * number boxes, radio buttons, and the disclosures' own summaries, which are
 * pressed too. Nothing on it was chosen; what the fixture could draw, it
 * drew. Each block carries where the stage put it — on the play surface, in
 * a strip item's panel, or in the workbench's **Session** section — and the
 * test asks for each control there, opening what a person would open on the
 * way: the item, the dock through *Session settings*, a disclosure.
 *
 * **The fixture is every block at once, which no real mode sends**: Scene's
 * chat settings and tracker cards beside Freeform's dials, a degraded channel,
 * a session imported from a chat and in a World, started without something it
 * asked for. The client draws whatever the read carries, so a union is the
 * one session that makes every block of the column show up for one count.
 * *The composer and the transcript are on the list too*, though the stage did
 * not touch them: they were in the column, and a move that dropped one by
 * accident is the regression a list like this is for.
 */

const ACCOUNT: Account = {
  handle: 'ned',
  displayName: 'Ned',
  role: 'user',
  enabled: true,
  locale: null,
  capabilities: {
    privateConnections: true,
    fileAccess: 'none',
    enableExtensions: false,
    scheduledBackups: false,
  },
  createdAt: 0,
};

const SESSION = {
  id: SESSION_ID,
  name: 'The Ashfall Road',
  createdAt: '2026-08-18T10:00:00.000Z',
  updatedAt: '2026-08-18T10:05:00.000Z',
  headTurnId: 'turn-1',
  treatment: null,
  lore: [],
  cast: { persona: null, actors: ['actor-vera'] },
  preset: {
    name: 'Scene pack',
    params: { temperature: 0.8 },
    blocks: [{ id: 'se.instruction', template: 'Write well.' }],
  },
  origin: { originalFilename: 'ashfall.jsonl' },
  startedWithout: {
    at: '2026-10-13T09:00:00.000Z',
    unmet: [{ kind: 'extension', id: 'dice', minVersion: '0.1.0' }],
  },
};

const TURN: TurnRecord = {
  id: 'turn-1',
  sessionId: SESSION_ID,
  parentTurnId: null,
  createdAt: '2026-08-18T10:00:00.000Z',
  status: 'complete',
  input: { actorId: null, text: 'I knock twice.', kind: 'action', raw: 'I knock twice.' },
  output: { text: 'The door opens a handspan.' },
  effects: [],
  tape: [],
};

/** A toggle in a region, as the session read sends one. */
function toggle(region: string, key: string, label: string, group?: string) {
  return {
    region,
    key,
    channelId: key,
    scopeKey: null,
    kind: 'toggle',
    label,
    on: false,
    ...(group === undefined ? {} : { group }),
  };
}

const READ = {
  session: SESSION,
  activeJob: null,
  health: [
    {
      key: 'se.mood',
      channelId: 'se.mood',
      scopeKey: null,
      version: 1,
      reason: 'schema',
      raw: 1,
      value: null,
    },
  ],
  hud: [
    {
      key: 'se.location',
      channelId: 'se.location',
      scopeKey: null,
      kind: 'text',
      label: 'Place',
      text: 'the harbour',
      edit: { kind: 'text', nullable: true },
      value: 'the harbour',
    },
  ],
  cast: [
    {
      actorId: 'actor-vera',
      presence: true,
      status: 'alive',
      pending: null,
      introduced: true,
      party: null,
    },
  ],
  hooks: {
    pacing: 'normal',
    rows: [
      {
        hookId: 'h-1',
        title: 'A stranger at the door',
        source: { kind: 'session' },
        state: null,
        refusal: null,
        entrances: [],
      },
    ],
  },
  goals: {
    rows: [
      {
        goalId: 'g-1',
        statement: 'Reach the harbour',
        visibility: 'player',
        completion: 'narrative',
        current: true,
        achieved: false,
        proposed: false,
        next: null,
        thenDefault: 'continue-open',
      },
    ],
    concluded: false,
  },
  dials: {
    difficulty: {
      levelId: 'normal',
      levels: [
        { id: 'easy', label: 'Easy' },
        { id: 'normal', label: 'Normal' },
      ],
    },
    directedness: {
      levelId: 'loose',
      levels: [
        { id: 'loose', label: 'Loose' },
        { id: 'tight', label: 'Tight' },
      ],
    },
  },
  renditions: { illustration: 'on-demand', backdrop: true },
  surfaces: [
    toggle('panel', 'se.staging', 'Show the scene'),
    toggle('panel', 'se.backdrop.on', 'Stage a backdrop'),
    {
      region: 'panel',
      group: 'Tracked',
      key: 'se.track.world',
      channelId: 'se.track.world',
      scopeKey: null,
      kind: 'record',
      label: 'The world',
      record: {
        value: { location: 'the harbour', weather: 'rain' },
        fields: [
          { key: 'location', label: 'Location', show: 'line' },
          { key: 'weather', label: 'Weather', show: 'line' },
        ],
        locks: { key: 'se.track.locks', paths: [] },
        hidden: { key: 'se.track.hidden', paths: [] },
      },
    },
    toggle('panel', 'se.plot.reveal', 'Show me the secret plot', 'Director'),
    toggle(
      'settings',
      'se.track.world.on',
      'Track the world: date, time, place, weather',
      'Agents',
    ),
  ],
  actions: [{ stepId: 'se.track', label: 'Update trackers' }],
  chat: {
    voice: 'embodied',
    dispatch: 'merged',
    speakers: {
      policy: 'natural',
      allowSelfResponses: false,
      namesInHistory: 'groups',
      maxPerRound: 2,
    },
    note: null,
    hidden: {},
    prompts: { instruction: true, cards: {} },
  },
};

/** One library row of a kind, with the fields every row carries. */
function row(kind: string, id: string, name: string, object: unknown = {}) {
  return {
    id,
    name,
    schema: `storyengine.${kind}/1`,
    slug: id,
    source: 'user',
    contentHash: `sha256:${id}`,
    shadowed: false,
    object,
  };
}

const LIBRARY: Record<string, unknown[]> = {
  presets: [row('preset', 'p-1', 'House style')],
  lorebooks: [row('lorebook', 'b-1', 'Rain City')],
  treatments: [row('treatment', 't-1', 'The Ashfall setting')],
  actors: [row('actor', 'actor-vera', 'Vera')],
  worlds: [
    row('world', 'w-ash', 'The Ashfall setting', {
      contents: [{ schema: 'storyengine.session/1', id: SESSION_ID }],
    }),
  ],
};

let prefsStore: Record<string, unknown> = {};
const patchPrefs = vi.fn();
let turns: TurnRecord[] = [TURN];
/** What the prefs read waits on before it answers — open unless a test holds it. */
let prefsRead: Promise<unknown> = Promise.resolve();
/**
 * What a Save in the Session section wrote, which the session read answers
 * with from then on (2026-10-14) — the pack and the author's note, the two
 * drafts the dock keeps past a close. Reset before each test.
 */
let written: {
  preset?: Record<string, unknown>;
  note?: { text: string; depth: number; every: number } | null;
} = {};

beforeEach(() => {
  prefsStore = {};
  patchPrefs.mockClear();
  turns = [TURN];
  prefsRead = Promise.resolve();
  written = {};
});

/** The session read, with whatever a Save wrote. */
function readNow() {
  return {
    ...READ,
    session: { ...SESSION, ...(written.preset === undefined ? {} : { preset: written.preset }) },
    chat: { ...READ.chat, ...('note' in written ? { note: written.note } : {}) },
  };
}

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      authState: () => Promise.resolve({ setupRequired: false, account: ACCOUNT }),
      listLibrary: (kind?: string) => Promise.resolve({ objects: LIBRARY[kind ?? ''] ?? [] }),
      readPrefs: async () => {
        await prefsRead;
        return { prefs: { ...prefsStore } };
      },
      patchPrefs: (patch: Record<string, unknown>) => {
        patchPrefs(patch);
        prefsStore = Object.fromEntries(
          Object.entries({ ...prefsStore, ...patch }).filter(([, value]) => value !== null),
        );
        return Promise.resolve({ prefs: { ...prefsStore } });
      },
      readMyRoles: () =>
        Promise.resolve({
          roles: [{ role: 'prose', tier: 'hi', ok: true }],
          connections: [],
          disabled: [],
          bindings: {},
          contentHash: 'sha256:roles',
        }),
    },
    listSessions: () => Promise.resolve({ sessions: [SESSION] }),
    readSession: () => Promise.resolve(readNow()),
    setSessionPreset: (_id: string, body: { preset?: Record<string, unknown> }) => {
      if (body.preset !== undefined) written.preset = body.preset;
      return Promise.resolve({ session: readNow().session });
    },
    setChatSettings: (_id: string, patch: { note?: typeof written.note }) => {
      if ('note' in patch) written.note = patch.note;
      const now = readNow();
      return Promise.resolve({ session: now.session, chat: now.chat });
    },
    readTranscript: () => Promise.resolve({ turns }),
    previewTurn: () => Promise.resolve({ preview: restingPreview() }),
    readRenditions: () => Promise.resolve({ renditions: [], selection: {} }),
    readMemoryPanel: () =>
      Promise.resolve({
        config: { share: true, intake: true, acrossPersonas: false, associations: {} },
        books: [],
        others: [],
      }),
  };
});

vi.mock('./stream.js', () => ({
  openTurnStream: () => ({ close: () => undefined }),
}));

const { router } = await import('../router.js');

function renderApp(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

async function overPlay(search: { turn?: string; block?: string } = {}): Promise<void> {
  await act(async () => {
    await router.navigate({ to: '/play/$sessionId', params: { sessionId: SESSION_ID }, search });
  });
  await screen.findByRole('heading', { name: 'The Ashfall Road', level: 1 });
}

/** Play's column: `<main>`'s one child. */
function column(): HTMLElement {
  const main = document.getElementById('main');
  const found = main?.firstElementChild;
  if (!(found instanceof HTMLElement)) throw new Error('no play column');
  return found;
}

function theStrip(): HTMLElement {
  return within(column()).getByRole('region', { name: 'The story now' });
}

/** Press every shut disclosure in a scope, nested ones included, as a reader would. */
async function openEvery(scope: HTMLElement): Promise<void> {
  for (let pass = 0; pass < 4; pass += 1) {
    const shut = [...scope.querySelectorAll<HTMLElement>('details:not([open]) > summary')].filter(
      (one) => one.closest('[hidden]') === null,
    );
    if (shut.length === 0) return;
    for (const summary of shut) await userEvent.click(summary);
  }
}

/**
 * A control by role and name, or a disclosure by its summary's words — the
 * one control a role query cannot reach, since a `<summary>` has none.
 */
type Control = readonly [role: ByRoleMatcher | 'summary', name: string | RegExp];

/** Where a block of the column is after the stage. */
type After = 'play' | 'strip' | 'session';

/**
 * ***The column at `5d01529d`, block by block, top to bottom*** — every
 * control the fixture made it draw (see the file's docstring for how the list
 * was taken). `after` is the stage's sorting, which its record in P12A §2
 * argues block by block: a fact about the story now stays on Play, a fact
 * about how the session is configured goes to the workbench's Session section.
 */
const BEFORE: readonly { block: string; after: After; controls: readonly Control[] }[] = [
  {
    block: 'the heading row',
    after: 'play',
    controls: [
      ['button', 'Rename The Ashfall Road'],
      ['button', 'Add to a world: The Ashfall Road'],
    ],
  },
  { block: 'In these worlds', after: 'play', controls: [['link', 'The Ashfall setting']] },
  // `StartedWithout`'s line came next, and holds no control.
  {
    block: 'How this chat plays (ChatSettingsPanel, with the mode’s settings region)',
    after: 'session',
    controls: [
      ['summary', 'How this chat plays'],
      ['radio', 'The characters, each in their own voice'],
      ['radio', 'A narrator, telling the scene'],
      ['checkbox', 'Each character replies in a call of their own'],
      ['combobox', 'Who replies'],
      ['checkbox', 'A character may reply straight after themselves'],
      ['combobox', 'Naming speakers to the model'],
      ['checkbox', 'Send the prompt pack’s own instruction'],
      ['textbox', 'Author’s note'],
      ['spinbutton', 'How many lines back'],
      ['spinbutton', 'Every how many of your messages (0 switches it off)'],
      ['button', 'Save the note'],
      ['checkbox', 'Its system prompt'],
      ['checkbox', 'Its post-history instructions'],
      ['checkbox', 'Its depth prompt'],
      ['checkbox', 'Track the world: date, time, place, weather'],
    ],
  },
  {
    block: 'the lore panel (LorePanel)',
    after: 'session',
    controls: [
      ['summary', 'Retrieving from no lorebooks'],
      ['combobox', 'Treatment'],
      ['checkbox', 'Rain City'],
      ['button', 'Save selection'],
    ],
  },
  {
    block: 'the session panel (SessionPanel, with Memories and Pictures)',
    after: 'session',
    controls: [
      ['summary', 'Prompted with Scene pack'],
      ['combobox', 'Prompt pack'],
      ['spinbutton', 'Temperature'],
      ['spinbutton', 'Maximum reply length'],
      ['link', 'Read it as a story'],
      ['link', 'Export this session'],
      ['button', 'Archive this session'],
      ['button', 'Delete this session'],
      ['button', 'Update from source'],
      ['summary', 'Memories'],
      ['checkbox', /^Share memories from this session/],
      ['checkbox', /^Use memories from these characters/],
      ['checkbox', /^Remember across all my personas/],
      ['summary', 'Pictures'],
      ['combobox', 'Illustrate the story'],
    ],
  },
  {
    block: 'the dials (DialPanel)',
    after: 'session',
    controls: [
      ['combobox', /^How much the world resists you/],
      ['combobox', /^How much the narrator steers/],
    ],
  },
  {
    block: 'what a person may run (ModeActions)',
    after: 'session',
    controls: [['button', 'Update trackers']],
  },
  {
    block: 'the mode’s panel region: its switches',
    after: 'session',
    controls: [
      ['checkbox', 'Show the scene'],
      ['checkbox', 'Stage a backdrop'],
      ['checkbox', 'Show me the secret plot'],
    ],
  },
  {
    block: 'the mode’s panel region: its readings',
    after: 'strip',
    controls: [
      ['summary', 'The world'],
      ['button', 'Edit'],
    ],
  },
  {
    block: 'Set the scene, and Choose a backdrop…',
    after: 'play',
    controls: [
      ['button', 'Set the scene'],
      ['button', 'Choose a backdrop…'],
    ],
  },
  {
    block: 'the strip, and what its items open',
    after: 'strip',
    controls: [
      ['button', '1 channel could not be loaded. Your story is unaffected.'],
      ['button', 'Try again'],
      ['button', 'Accept the reset'],
      ['button', 'Place the harbour'],
      ['textbox', 'Place'],
      ['button', 'Save'],
      // *(2026-10-14, P12A's final audit: the same control, named now for the
      // face it draws as well — it was* Cast 1 of 1 here *at `5d01529d`.)*
      ['button', 'Cast Vera 1 of 1 here'],
      ['combobox', 'You play'],
      ['button', 'Play as them'],
      ['checkbox', 'Muted'],
      ['combobox', 'Status for Vera'],
      ['button', 'Speak'],
      ['button', 'Remove from the cast'],
      ['summary', 'Card prompts'],
      ['checkbox', 'Its system prompt'],
      ['checkbox', 'Its post-history instructions'],
      ['checkbox', 'Its depth prompt'],
      ['combobox', 'Somebody to add'],
      ['button', 'Add to the cast'],
      ['button', 'Working toward: Reach the harbour'],
      ['button', 'Mark it done'],
      ['textbox', 'Set an objective'],
      ['button', 'Set'],
      ['button', 'Plot hooks — 1 of 1 eligible'],
      ['combobox', 'How often hooks fire'],
      ['button', 'Commit A stranger at the door'],
      ['button', 'Remove A stranger at the door'],
      ['textbox', 'Something you want to happen'],
      ['textbox', 'What happens'],
      ['button', 'Add'],
    ],
  },
  {
    block: 'the transcript',
    after: 'play',
    controls: [
      ['button', 'Edit'],
      ['button', 'Hide this exchange'],
      ['button', 'Hide'],
      ['button', 'Delete'],
      ['button', 'Redo'],
      ['button', 'Redo with guidance'],
      ['button', 'Continue from here'],
      ['button', 'Make a setup from here'],
      ['button', 'Illustrate'],
      ['button', 'Remember this'],
      ['button', 'Undo'],
    ],
  },
  {
    block: 'the composer',
    after: 'play',
    controls: [
      ['button', /^Context fill: /],
      ['combobox', 'Who speaks next'],
      ['combobox', 'Push the story'],
      ['textbox', 'What do you do?'],
      ['button', 'Let them talk'],
      ['button', 'Attach a picture'],
      ['button', 'Draft my next message'],
      ['checkbox', 'Let them keep talking on their own'],
      ['spinbutton', 'Seconds of quiet'],
      ['summary', 'Guidance for this turn'],
      ['textbox', 'Guidance for this turn'],
    ],
  },
];

/** Whether a control is in a scope, drawn — not inside a shut item's panel. */
function holds(scope: HTMLElement, [role, name]: Control, outside?: HTMLElement): boolean {
  const drawn = (one: Element): boolean =>
    one.closest('[hidden]') === null && outside?.contains(one) !== true;
  if (role === 'summary') {
    return [...scope.querySelectorAll('summary')].some(
      (one) =>
        drawn(one) &&
        (typeof name === 'string'
          ? one.textContent.trim() === name
          : name.test(one.textContent.trim())),
    );
  }
  return within(scope).queryAllByRole(role, { name }).some(drawn);
}

function label(control: Control): string {
  return `${String(control[0])} “${String(control[1])}”`;
}

describe('every control the play column offered', () => {
  it('is still within reach: on the play surface, in a strip item, or in the Session section', async () => {
    renderApp();
    await overPlay();
    await within(column()).findByRole('button', { name: 'Place the harbour' });
    const missing: string[] = [];

    // **On the play surface**: the column, every disclosure in it opened, and
    // the strip left out — what is in the strip is reached through its items.
    await openEvery(column());
    for (const block of BEFORE.filter((one) => one.after === 'play')) {
      for (const control of block.controls) {
        if (!holds(column(), control, theStrip()))
          missing.push(`${block.block}: ${label(control)}`);
      }
    }

    // **In a strip item's panel**: each item pressed in turn, as one would be,
    // and what it opens opened in its turn. A control counts once any item
    // (or the line itself) shows it.
    const inStrip = BEFORE.filter((one) => one.after === 'strip').flatMap((one) =>
      one.controls.map((control) => ({ block: one.block, control })),
    );
    const seen = new Set<number>();
    const look = (): void => {
      inStrip.forEach((one, index) => {
        if (holds(theStrip(), one.control)) seen.add(index);
      });
    };
    look();
    const items = [...theStrip().querySelectorAll<HTMLElement>('button[aria-expanded]')].filter(
      (one) => one.closest('[hidden]') === null,
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      await userEvent.click(item);
      await openEvery(theStrip());
      look();
      if (item.getAttribute('aria-expanded') === 'true') await userEvent.click(item);
    }
    inStrip.forEach((one, index) => {
      if (!seen.has(index)) missing.push(`${one.block}: ${label(one.control)}`);
    });

    // **In the workbench's Session section**, opened the way the page offers:
    // its *Session settings*, one press.
    expect(screen.queryByRole('complementary')).toBeNull();
    await userEvent.click(within(column()).getByRole('button', { name: 'Session settings' }));
    const dock = await screen.findByRole('complementary');
    const session = within(dock).getByRole('region', { name: 'Session' });
    await within(session).findByText('Prompted with Scene pack');
    await openEvery(session);
    await within(session).findByRole('checkbox', { name: /^Share memories from this session/ });
    for (const block of BEFORE.filter((one) => one.after === 'session')) {
      for (const control of block.controls) {
        if (!holds(session, control)) missing.push(`${block.block}: ${label(control)}`);
      }
    }

    expect(missing).toEqual([]);
  });

  /**
   * ***And the configuration is not on Play any more*** — the other half of the
   * sort, held here over the same list rather than restated: no control of a
   * block the stage moved to the Session section is drawn in the column.
   * `PlayPage.test.tsx` holds the same claim over the page alone.
   */
  it('leaves none of what moved to the Session section on the play surface', async () => {
    renderApp();
    await overPlay();
    await within(column()).findByRole('button', { name: 'Place the harbour' });
    await openEvery(column());

    const left = BEFORE.filter((one) => one.after === 'session')
      .flatMap((one) => one.controls)
      // Two names are in both places by design: the cast panel's card prompts,
      // in the strip, and the chat settings' own, which moved.
      .filter((control) => !String(control[1]).startsWith('Its '))
      .filter((control) => holds(column(), control))
      .map(label);
    expect(left).toEqual([]);
  });
});

/**
 * ***One press to the Session section, and one to the record*** — the two
 * controls on the page that open the dock somewhere in particular. Each opens
 * the dock if it is shut, writing the preference once, and hands the section
 * the keyboard; a press with the dock open writes nothing and takes the reader
 * there again. Mutations: the jump left out (focus stays on the page), the
 * anchor swapped (the meter landing on the settings), and the open patched on
 * every press.
 */
describe('opening the dock at a section', () => {
  it('opens at Session from Session settings, and goes back there with the dock open', async () => {
    renderApp();
    await overPlay();

    const control = within(column()).getByRole('button', { name: 'Session settings' });
    // *Shown, not declared* (2026-10-14, after review): the chord is the
    // shell's toggle, which closes an open dock where this only opens and
    // jumps, so it is not this control's `aria-keyshortcuts`. The hint beside
    // the name stays, out of it. Mutation: the attribute put back.
    expect(control.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(control.textContent).toContain('Ctrl+`');
    expect(control.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(control);

    const dock = await screen.findByRole('complementary');
    const session = within(dock).getByRole('region', { name: 'Session' });
    await waitFor(() => {
      expect(document.activeElement).toBe(session);
    });
    expect(patchPrefs).toHaveBeenCalledTimes(1);
    expect(patchPrefs).toHaveBeenCalledWith({ 'ui.workbench-open': true });
    expect(control.getAttribute('aria-expanded')).toBe('true');

    // Somewhere else, then the same press: back at Session, nothing written.
    within(dock).getByRole('region', { name: 'Turn record' }).focus();
    await userEvent.click(control);
    await waitFor(() => {
      expect(document.activeElement).toBe(session);
    });
    expect(patchPrefs).toHaveBeenCalledTimes(1);
  });

  it('opens at the turn record from the context meter', async () => {
    renderApp();
    await overPlay();

    await userEvent.click(within(column()).getByRole('button', { name: /^Context fill/ }));
    const dock = await screen.findByRole('complementary');
    const record = within(dock).getByRole('region', { name: 'Turn record' });
    await waitFor(() => {
      expect(document.activeElement).toBe(record);
    });
    expect(patchPrefs).toHaveBeenCalledTimes(1);
  });
});

/**
 * ***`?block=`, both ends in the dock*** — [P7B.4]'s *Edit in the pack*, whose
 * editor moved with the session panel into the Session section. The address
 * still names the block, and an address that names one opens the dock; the
 * link in the record keeps the turn it was pressed under, since the record is
 * now right under the editor. Mutations: the route not opening the dock, the
 * dock not handing the block to the section, the editor not bringing itself
 * into view, and the link dropping `turn`.
 */
describe('the ?block= deep link', () => {
  it('opens a shut dock at the block’s editor, with the keyboard in its text', async () => {
    renderApp();
    await overPlay({ block: 'se.instruction' });

    const dock = await screen.findByRole('complementary');
    const session = within(dock).getByRole('region', { name: 'Session' });
    const box = await within(session).findByRole('textbox', { name: 'Block: se.instruction' });
    await waitFor(() => {
      expect(document.activeElement).toBe(box);
    });
    expect(patchPrefs).toHaveBeenCalledWith({ 'ui.workbench-open': true });
    // The page draws no editor of its own: the panel is the dock's alone.
    expect(within(column()).queryByRole('textbox', { name: 'Block: se.instruction' })).toBeNull();
  });

  /**
   * *Once per arrival, not for as long as the address says so*: a person who
   * closes the dock with the block still in the address is not overruled on
   * the next render. Mutation: the effect keyed on the opener as well as the
   * block, whose identity changes when the dock closes.
   */
  it('stays shut when it is closed with the block still in the address', async () => {
    renderApp();
    await overPlay({ block: 'se.instruction' });
    const dock = await screen.findByRole('complementary');
    await within(dock).findByRole('textbox', { name: 'Block: se.instruction' });

    await userEvent.click(within(dock).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
    await new Promise((settle) => setTimeout(settle, 50));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(router.state.location.search).toEqual({ block: 'se.instruction' });
  });

  /**
   * ***And reopened, it starts at its top, not at the editor*** (2026-10-14,
   * after review). The dock unmounts on close and the block stays in the
   * address, so the editor is drawn again on every reopen; the landing is the
   * arrival's, and a reopen is not one. Both ways of reopening are tried — the
   * header's *Workbench* and the chord — and the chord, which is inert in a
   * text box, must still close what it opened. Mutation: the editor's
   * `landOnce` guard removed, so every draw takes the keyboard.
   */
  it('opens at its top when it is reopened with the block still in the address', async () => {
    renderApp();
    await overPlay({ block: 'se.instruction' });
    const first = await screen.findByRole('complementary');
    const box = await within(first).findByRole('textbox', { name: 'Block: se.instruction' });
    await waitFor(() => {
      expect(document.activeElement).toBe(box);
    });

    async function reopened(how: () => Promise<void>): Promise<HTMLElement> {
      await userEvent.click(
        within(screen.getByRole('complementary')).getByRole('button', { name: 'Close' }),
      );
      await waitFor(() => {
        expect(screen.queryByRole('complementary')).toBeNull();
      });
      (document.activeElement as HTMLElement | null)?.blur();
      await how();
      const dock = await screen.findByRole('complementary');
      // Drawn, as the address asks — and not handed the keyboard.
      const again = await within(dock).findByRole('textbox', { name: 'Block: se.instruction' });
      await new Promise((settle) => setTimeout(settle, 50));
      expect(document.activeElement).not.toBe(again);
      return dock;
    }

    await reopened(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Workbench' }));
    });
    await reopened(async () => {
      await userEvent.keyboard('{Control>}`{/Control}');
    });
    // The keyboard is not in a text box, so the chord closes what it opened.
    await userEvent.keyboard('{Control>}`{/Control}');
    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
  });

  /**
   * ***An address loaded with the dock already open writes nothing***
   * (2026-10-14, after review). The route's opener waits for the preference
   * to be read: called before, it took *unknown* for *shut*, sent a patch
   * that cancelled the read, and left the cache holding the open key alone.
   * The router is at the address before anything is drawn, as a reload would
   * have it, and the read is held so the first draws happen without it.
   * Mutation: `loaded` dropped from the opener's guard.
   */
  it('writes nothing when the address is loaded with the dock already open', async () => {
    prefsStore = { 'ui.workbench-open': true };
    let answer: () => void = () => undefined;
    prefsRead = new Promise<void>((resolve) => {
      answer = resolve;
    });
    // Started before anything is drawn, and settled by the router's first
    // load once it is: the route mounts at the address, as on a reload.
    const arriving = router.navigate({
      to: '/play/$sessionId',
      params: { sessionId: SESSION_ID },
      search: { block: 'se.instruction' },
    });
    renderApp();
    await act(async () => {
      await arriving;
    });
    await screen.findByRole('heading', { name: 'The Ashfall Road', level: 1 });
    await act(async () => {
      answer();
      await prefsRead;
    });

    const dock = await screen.findByRole('complementary');
    const box = await within(dock).findByRole('textbox', { name: 'Block: se.instruction' });
    await waitFor(() => {
      expect(document.activeElement).toBe(box);
    });
    expect(patchPrefs).not.toHaveBeenCalled();
  });

  it('is what Edit in the pack opens, from a turn the head has passed, keeping that turn', async () => {
    turns = [richTurn(), cancelledTurn()];
    prefsStore = { 'ui.workbench-open': true };
    renderApp();
    await overPlay({ turn: 't-10' });

    const dock = await screen.findByRole('complementary');
    const record = within(dock).getByRole('region', { name: 'Turn record' });
    await within(record).findByText('A turn the head has passed. Nothing here is live.');
    const [edit] = within(record).getAllByRole('link', { name: 'Edit in the pack' });
    if (edit === undefined) throw new Error('no Edit in the pack link');
    await userEvent.click(edit);

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ turn: 't-10', block: 'se.instruction' });
    });
    const session = within(dock).getByRole('region', { name: 'Session' });
    const box = await within(session).findByRole('textbox', { name: 'Block: se.instruction' });
    await waitFor(() => {
      expect(document.activeElement).toBe(box);
    });
    // Still on the turn it was pressed under.
    expect(
      within(record).getByText('A turn the head has passed. Nothing here is live.'),
    ).toBeTruthy();
  });

  /**
   * ***The record's turn picker keeps the block, and the draft*** (2026-10-14,
   * after review). The editor and the record are read together, so choosing
   * another turn to compare against must not unmount the editor above it.
   * Mutation: the picker's search back to `{ turn }` alone.
   */
  it('keeps the block and what was typed in it when the record shows another turn', async () => {
    turns = [richTurn(), cancelledTurn()];
    prefsStore = { 'ui.workbench-open': true };
    renderApp();
    await overPlay({ turn: 't-10', block: 'se.instruction' });

    const dock = await screen.findByRole('complementary');
    const session = within(dock).getByRole('region', { name: 'Session' });
    const box = await within(session).findByRole('textbox', { name: 'Block: se.instruction' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Write better.');

    const record = within(dock).getByRole('region', { name: 'Turn record' });
    await userEvent.selectOptions(
      within(record).getByRole('combobox', { name: 'Showing' }),
      't-11',
    );

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ turn: 't-11', block: 'se.instruction' });
    });
    const still = within(session).getByRole('textbox', { name: 'Block: se.instruction' });
    expect(still).toBe(box);
    expect((still as HTMLTextAreaElement).value).toBe('Write better.');
  });

  /**
   * ***A second press lands again*** (2026-10-14, P12A's final audit). The
   * address already names the block, so the router hears nothing and the
   * editor is not drawn afresh; before the fix the press moved nothing, with
   * the editor a screen above the record in the same scroller. The draft
   * typed after the first press is still there after the second. Mutation:
   * the link's `onClick` removed.
   */
  it('lands again when Edit in the pack is pressed a second time for the same block', async () => {
    turns = [richTurn(), cancelledTurn()];
    prefsStore = { 'ui.workbench-open': true };
    renderApp();
    await overPlay({ turn: 't-10' });

    const dock = await screen.findByRole('complementary');
    const record = within(dock).getByRole('region', { name: 'Turn record' });
    await within(record).findByText('A turn the head has passed. Nothing here is live.');
    const [edit] = within(record).getAllByRole('link', { name: 'Edit in the pack' });
    if (edit === undefined) throw new Error('no Edit in the pack link');
    await userEvent.click(edit);

    const session = within(dock).getByRole('region', { name: 'Session' });
    const box = await within(session).findByRole('textbox', { name: 'Block: se.instruction' });
    await waitFor(() => {
      expect(document.activeElement).toBe(box);
    });
    await userEvent.clear(box);
    await userEvent.type(box, 'Write better.');

    // Down to the record to compare, then the same link again.
    record.focus();
    expect(document.activeElement).toBe(record);
    const [again] = within(record).getAllByRole('link', { name: 'Edit in the pack' });
    if (again === undefined) throw new Error('no Edit in the pack link');
    await userEvent.click(again);

    await waitFor(() => {
      expect(document.activeElement).toBe(box);
    });
    expect((box as HTMLTextAreaElement).value).toBe('Write better.');
    expect(router.state.location.search).toEqual({ turn: 't-10', block: 'se.instruction' });
  });
});

/**
 * ***Escape in a Session field is the field's*** (2026-10-14, after review).
 * The dock closes on Escape while the keyboard is in it, a rule written for a
 * reader; since P12A.5 its Session section holds drafts, and closing unmounts
 * them. Escape in a text box no longer closes the dock; on a check box, which
 * keeps no draft, it still does. `dock.test.tsx`'s *closes on Escape only when
 * focus is inside it* still holds it for the Close button. Mutations: the
 * guard removed; the guard keyed only on `defaultPrevented`, which nothing in
 * a text box sets; the guard widened to `isEditable`, which takes the check
 * box too.
 */
describe('Escape in the Session section', () => {
  it('leaves the dock open, and the draft in it, when it is pressed while typing', async () => {
    renderApp();
    await overPlay({ block: 'se.instruction' });
    const dock = await screen.findByRole('complementary');
    const box = await within(dock).findByRole('textbox', { name: 'Block: se.instruction' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Write better.');

    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('complementary')).toBe(dock);
    expect(within(dock).getByRole('textbox', { name: 'Block: se.instruction' })).toBe(box);
    expect((box as HTMLTextAreaElement).value).toBe('Write better.');
  });

  it('still closes the dock from a control that keeps no draft', async () => {
    renderApp();
    await overPlay();
    await userEvent.click(within(column()).getByRole('button', { name: 'Session settings' }));
    const dock = await screen.findByRole('complementary');
    const session = within(dock).getByRole('region', { name: 'Session' });
    (await within(session).findByRole('checkbox', { name: 'Show the scene' })).focus();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
  });

  /**
   * ***A check box that builds a draft keeps it*** (2026-10-14, P12A's final
   * audit). The lore panel's boxes write nothing until *Save selection*, so
   * Escape on one, with a book ticked, is the panel's while the selection is
   * unsaved — and the dock's again once nothing is. T3's own step: *change
   * the lore selection*. Mutation: the panel's `onKeyDown` removed.
   */
  it('leaves the dock open, and the lore selection in it, while the selection is unsaved', async () => {
    renderApp();
    await overPlay();
    await userEvent.click(within(column()).getByRole('button', { name: 'Session settings' }));
    const dock = await screen.findByRole('complementary');
    const session = within(dock).getByRole('region', { name: 'Session' });
    await userEvent.click(await within(session).findByText('Retrieving from no lorebooks'));
    const book = await within(session).findByRole('checkbox', { name: 'Rain City' });
    await userEvent.click(book);
    expect((book as HTMLInputElement).checked).toBe(true);

    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('complementary')).toBe(dock);
    expect(within(session).getByRole('checkbox', { name: 'Rain City' })).toBe(book);
    expect((book as HTMLInputElement).checked).toBe(true);

    // Ticked back, nothing is unsaved, and Escape is the dock's again.
    await userEvent.click(book);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
  });
});

/**
 * ***What was typed in the Session section outlives a close*** (2026-10-14,
 * P12A's final audit). The dock is unmounted when it closes, by *Close*, the
 * header's *Workbench* and the chord as much as by Escape, and on a phone
 * closing is the only way back to the story; the two drafts the section holds
 * behind a Save — the pack's block and the author's note — are kept outside
 * it (`kept.ts`) and are there again when it reopens, until a Save writes
 * them. Mutations: `kept` not read when an editor is drawn, and `keep` not
 * called when it changes — each fails both arms.
 */
describe('a close of the dock', () => {
  const CHORD = '{Control>}`{/Control}';

  async function closed(how: () => Promise<void>): Promise<void> {
    await how();
    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
  }

  it('keeps what was typed in the pack’s block, until it is saved', async () => {
    renderApp();
    await overPlay({ block: 'se.instruction' });
    const first = await screen.findByRole('complementary');
    const box = await within(first).findByRole('textbox', { name: 'Block: se.instruction' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Write better.');

    // Close, then the header's Workbench.
    await closed(async () => {
      await userEvent.click(within(first).getByRole('button', { name: 'Close' }));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Workbench' }));
    let dock = await screen.findByRole('complementary');
    let again = await within(dock).findByRole('textbox', { name: 'Block: se.instruction' });
    expect((again as HTMLTextAreaElement).value).toBe('Write better.');

    // The chord from the Save button, which is not a text box, and back.
    within(dock).getByRole('button', { name: 'Save this block' }).focus();
    await closed(async () => {
      await userEvent.keyboard(CHORD);
    });
    await userEvent.keyboard(CHORD);
    dock = await screen.findByRole('complementary');
    again = await within(dock).findByRole('textbox', { name: 'Block: se.instruction' });
    expect((again as HTMLTextAreaElement).value).toBe('Write better.');

    // Saved, the pack holds it, and a reopen shows what was stored.
    await userEvent.click(within(dock).getByRole('button', { name: 'Save this block' }));
    await waitFor(() => {
      expect(written.preset).toBeDefined();
    });
    await waitFor(() => {
      expect(
        within(dock).getByRole('button', { name: 'Save this block' }).hasAttribute('disabled'),
      ).toBe(true);
    });
    await closed(async () => {
      await userEvent.click(within(dock).getByRole('button', { name: 'Close' }));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Workbench' }));
    dock = await screen.findByRole('complementary');
    again = await within(dock).findByRole('textbox', { name: 'Block: se.instruction' });
    expect((again as HTMLTextAreaElement).value).toBe('Write better.');
    expect(
      within(dock).getByRole('button', { name: 'Save this block' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('keeps what was typed in the author’s note, until it is saved', async () => {
    renderApp();
    await overPlay();

    async function theNote(): Promise<HTMLTextAreaElement> {
      await userEvent.click(within(column()).getByRole('button', { name: 'Session settings' }));
      const dock = await screen.findByRole('complementary');
      const session = within(dock).getByRole('region', { name: 'Session' });
      await userEvent.click(await within(session).findByText('How this chat plays'));
      return within(session).findByRole<HTMLTextAreaElement>('textbox', { name: 'Author’s note' });
    }
    async function close(): Promise<void> {
      await closed(async () => {
        await userEvent.click(
          within(screen.getByRole('complementary')).getByRole('button', { name: 'Close' }),
        );
      });
    }

    const note = await theNote();
    expect(note.value).toBe('');
    await userEvent.type(note, 'Keep it short.');
    await close();
    expect((await theNote()).value).toBe('Keep it short.');

    // Saved, the session holds it, and a reopen shows what was stored.
    const dock = screen.getByRole('complementary');
    await userEvent.click(within(dock).getByRole('button', { name: 'Save the note' }));
    await waitFor(() => {
      expect(written.note).toEqual({ text: 'Keep it short.', depth: 4, every: 1 });
    });
    await within(dock).findByRole('button', { name: 'Remove the note' });
    await close();
    expect((await theNote()).value).toBe('Keep it short.');
  });
});
