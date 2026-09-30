// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { isUuidv7, uuidv7Timestamp, type Turn } from '@storyengine/shared';

import { walkPath } from '../../sessions/segments.js';
import type { SessionFile } from '../../sessions/types.js';
import { buildSession } from './build.js';
import type {
  BuildContext,
  ChatBuild,
  ChatFamily,
  ChatMessage,
  ChatResolution,
  ChatSettings,
  ChatSourceChat,
  ChatStateValue,
  ForeignRef,
} from './types.js';

/**
 * ***The chat tree builder, one rule at a time*** —
 * [P14.6](../../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * Each `describe` is one section of [P14 §2]: rounds (§2.2), swipes (§2.3),
 * identity (§2.4), refs and resolution (§2.5), settings and notes (§2.6). These
 * are the cases a person would write down; `build-property.test.ts` is the
 * stage's actual proof obligation, over families nobody would think to write,
 * because *"hand-written fixtures are linear"* and the builder's bugs are at the
 * forks.
 */

const CONTEXT: BuildContext = {
  account: 'ned',
  now: '2026-09-29T12:00:00.000Z',
  // A test may spell a mode id; the builder may not (`BuildContext.modeId`).
  modeId: 'storyengine.scene',
};
const VERA: ForeignRef = { key: 'Vera.png', name: 'Vera' };
const OSKAR: ForeignRef = { key: 'Oskar.png', name: 'Oskar' };

const NOBODY: ChatResolution = { speakers: new Map(), persona: null, lore: [] };
const LIBRARY: ChatResolution = {
  speakers: new Map([
    ['Vera.png', { id: 'actor-vera', name: 'Vera Lind' }],
    ['Oskar.png', null],
  ]),
  persona: { id: 'persona-ned', name: 'Ned' },
  lore: ['book-harbour'],
};

type Line = Omit<ChatMessage, 'foreignId'> & { foreignId?: string };

function user(text: string, at: number | null, more: Partial<ChatMessage> = {}): Line {
  return { role: 'user', text, at, ...more };
}

function said(
  speaker: ForeignRef,
  text: string,
  at: number | null,
  more: Partial<ChatMessage> = {},
): Line {
  return { role: 'character', speaker, text, at, ...more };
}

function narrator(text: string, at: number | null, more: Partial<ChatMessage> = {}): Line {
  return { role: 'narrator', text, at, ...more };
}

/** A chat whose lines are named SillyTavern's way: path, then index. */
function chat(
  id: string,
  lines: readonly Line[],
  more: Partial<ChatSourceChat> = {},
): ChatSourceChat {
  return {
    id,
    name: id,
    createdAt: null,
    messages: lines.map((line, index) => ({ foreignId: `${id}#${String(index)}`, ...line })),
    ...more,
  };
}

function family(...chats: ChatSourceChat[]): ChatFamily {
  return {
    source: 'sillytavern',
    key: chats[0]?.id ?? '',
    name: 'Harbour',
    chats,
  };
}

function build(
  of: ChatFamily,
  resolution: ChatResolution = NOBODY,
  settings?: ChatSettings,
  context: BuildContext = CONTEXT,
): ChatBuild {
  return buildSession(of, resolution, context, settings);
}

function sessionOf(built: ChatBuild): SessionFile {
  return built.document.session as unknown as SessionFile;
}

function turnsOf(built: ChatBuild): Map<string, Turn> {
  return new Map(built.document.turns.map((turn) => [turn.id, turn]));
}

/** The head's path, root first — what the session opens on. */
function headPath(built: ChatBuild): Turn[] {
  return walkPath(turnsOf(built), sessionOf(built).headTurnId);
}

function childrenOf(built: ChatBuild, parent: string | null): Turn[] {
  return built.document.turns.filter((turn) => turn.parentTurnId === parent);
}

function noteKeys(built: ChatBuild): string[] {
  return built.notes.map((note) => note.key);
}

// ---------------------------------------------------------------------------

describe('a round is a turn (§2.2)', () => {
  it('makes a greeting, an exchange and an unanswered line three turns', () => {
    const built = build(
      family(
        chat('chats/Vera/one.jsonl', [
          said(VERA, 'The ferry is late.', 1000),
          user('Again?', 2000),
          said(VERA, 'Again.', 3000),
          user('Then we walk.', 4000),
        ]),
      ),
    );

    const [greeting, exchange, unanswered] = headPath(built);
    expect(built.document.turns).toHaveLength(3);

    expect(greeting?.parentTurnId).toBeNull();
    expect(greeting?.input).toBeUndefined();
    expect(greeting?.output?.messages).toEqual([
      { speaker: { id: 'Vera.png', name: 'Vera' }, text: 'The ferry is late.' },
    ]);

    expect(exchange?.input).toEqual({ actorId: null, kind: 'do', text: 'Again?', raw: 'Again?' });
    expect(exchange?.output?.text).toBe('Again.');

    expect(unanswered?.input?.text).toBe('Then we walk.');
    expect(unanswered?.output).toBeUndefined();
  });

  it('records a turn nothing ran, and fabricates nothing', () => {
    const built = build(family(chat('c', [user('Hello.', 1), said(VERA, 'Hi.', 2)])));
    const [turn] = built.document.turns;

    expect(turn?.status).toBe('complete');
    expect(turn?.effects).toEqual([]);
    expect(turn?.tape).toEqual([]);
    expect(turn).not.toHaveProperty('request');
    expect(turn).not.toHaveProperty('cost');
    expect(turn).not.toHaveProperty('steps');
    // The round's first line, which is where a person holding the file finds it.
    expect(turn?.foreign).toEqual({ source: 'sillytavern', id: 'c#0' });
  });

  it('names speakers by the library where it knows them, and by the chat where it does not', () => {
    const built = build(
      family(chat('c', [user('Who is here?', 1), said(VERA, 'Me.', 2), said(OSKAR, 'And me.', 3)])),
      LIBRARY,
    );
    const [turn] = built.document.turns;

    expect(turn?.input?.actorId).toBe('persona-ned');
    expect(turn?.output?.messages?.map((message) => message.speaker)).toEqual([
      { id: 'actor-vera', name: 'Vera Lind' },
      { id: 'Oskar.png', name: 'Oskar' },
    ]);
  });

  it('puts a narrator line in the round it falls in, spoken by nobody', () => {
    const built = build(
      family(
        chat('c', [
          user('Listen.', 1),
          said(VERA, 'To what?', 2),
          narrator('The rain stops.', 3, { speaker: OSKAR }),
          said(VERA, 'Oh.', 4),
        ]),
      ),
    );
    const [turn] = built.document.turns;

    expect(built.document.turns).toHaveLength(1);
    expect(turn?.output?.messages?.map((message) => message.speaker?.name ?? null)).toEqual([
      'Vera',
      null,
      'Vera',
    ]);
    expect(turn?.output?.text).toBe('To what?\n\nThe rain stops.\n\nOh.');
  });

  it('splits a group round where SillyTavern’s batch changes, and folds where it does not', () => {
    const built = build(
      family(
        chat('c', [
          user('Everyone?', 1),
          said(VERA, 'Here.', 2, { batch: 'g1' }),
          narrator('A gull cries.', 3),
          said(OSKAR, 'Here too.', 4, { batch: 'g1' }),
          // A force-talk after the round: a batch of its own.
          said(VERA, 'Anyone else?', 5, { batch: 'g2' }),
        ]),
      ),
    );
    const [round, forced] = headPath(built);

    expect(built.document.turns).toHaveLength(2);
    expect(round?.output?.messages).toHaveLength(3);
    expect(forced?.input).toBeUndefined();
    expect(forced?.parentTurnId).toBe(round?.id);
    expect(forced?.output?.text).toBe('Anyone else?');
  });

  it('folds consecutive replies into the round when there is no batch at all', () => {
    const built = build(
      family(chat('c', [user('Go on.', 1), said(VERA, 'One.', 2), said(VERA, 'Two.', 3)])),
    );

    expect(built.document.turns).toHaveLength(1);
    expect(built.document.turns[0]?.output?.text).toBe('One.\n\nTwo.');
  });
});

// ---------------------------------------------------------------------------

describe('hidden lines are imported, and hidden (§2.2, §2.6)', () => {
  const hiddenChat = chat('c', [
    user('Off the record.', 1, { hidden: true }),
    said(VERA, 'Understood.', 2, { hidden: true }),
    user('Back on.', 3),
    said(VERA, 'Visible.', 4),
    said(OSKAR, 'Ghosted.', 5, { hidden: true }),
    user('Hide me alone.', 6, { hidden: true }),
    said(VERA, 'But not me.', 7),
  ]);

  it('hides a whole turn, some messages of one, and says how many', () => {
    const built = build(family(hiddenChat));
    const [whole, some, inputOnly] = headPath(built);
    const hidden = sessionOf(built).hidden ?? {};

    expect(hidden[whole?.id ?? '']).toBe(true);
    expect(hidden[some?.id ?? '']).toEqual([1]);
    // A hidden player's line under a visible reply has no exact home, so it
    // is shown — and the person is told.
    expect(hidden[inputOnly?.id ?? '']).toBeUndefined();

    expect(built.notes).toContainEqual({
      key: 'import.chat.hiddenKept',
      params: { count: 3 },
      level: 'info',
    });
    expect(built.notes).toContainEqual({
      key: 'import.chat.hiddenInputShown',
      params: { count: 1 },
      level: 'warn',
    });
  });

  it('hides a line the source settings name by foreign id', () => {
    const built = build(family(chat('c', [user('Hi.', 1), said(VERA, 'Hi.', 2)])), NOBODY, {
      hidden: ['c#1'],
    });
    const [turn] = built.document.turns;

    expect(sessionOf(built).hidden).toEqual({ [turn?.id ?? '']: [0] });
  });

  it('never lets a hide change a turn’s identity, so an unhide can sync', () => {
    const shown = build(family(chat('c', [user('Hi.', 1), said(VERA, 'Hi.', 2)])));
    const ghosted = build(
      family(chat('c', [user('Hi.', 1, { hidden: true }), said(VERA, 'Hi.', 2, { hidden: true })])),
    );

    expect(ghosted.document.turns.map((turn) => turn.id)).toEqual(
      shown.document.turns.map((turn) => turn.id),
    );
    expect(sessionOf(shown).hidden).toBeUndefined();
  });

  /** A prefix two chats share, with the branch's own round after it. */
  const prefix = (hide: boolean): Line[] => [
    said(VERA, 'Evening.', 1000),
    user('Off the record.', 2000, hide ? { hidden: true } : {}),
    said(VERA, 'Understood.', 3000, hide ? { hidden: true } : {}),
  ];

  it.each<[string, boolean, boolean]>([
    ['the root shows and the branch hid it', false, true],
    ['the root hid it and the branch shows it', true, false],
  ])('hides a shared line either chat hid, and says so, when %s', (_, rootHides, branchHides) => {
    const built = build(
      family(
        chat('root', [...prefix(rootHides), user('Yes.', 4000)]),
        chat('branch', [...prefix(branchHides), user('No.', 4500)], { parentId: 'root' }),
      ),
    );
    const [, exchange] = headPath(built);

    expect(sessionOf(built).hidden).toEqual({ [exchange?.id ?? '']: true });
    expect(built.notes).toContainEqual({
      key: 'import.chat.hiddenDisagrees',
      params: { count: 2 },
      level: 'warn',
    });
  });

  it('says nothing about disagreement where the chats agree', () => {
    const built = build(
      family(
        chat('root', [...prefix(true), user('Yes.', 4000)]),
        chat('branch', [...prefix(true), user('No.', 4500)], { parentId: 'root' }),
      ),
    );

    expect(noteKeys(built)).not.toContain('import.chat.hiddenDisagrees');
  });

  it('hides a line the import had to hide, and does not say the source hid it', () => {
    // A SillyTavern tool call's record: sent by the source, hidden on the way in.
    const built = build(
      family(
        chat('c', [
          user('Roll.', 1),
          narrator('Tool calls: roll', 2, { hiddenByImport: true }),
          said(VERA, 'A four.', 3),
        ]),
      ),
    );
    const [turn] = built.document.turns;

    expect(sessionOf(built).hidden).toEqual({ [turn?.id ?? '']: [0] });
    expect(noteKeys(built)).not.toContain('import.chat.hiddenKept');
  });
});

// ---------------------------------------------------------------------------

describe('swipes are siblings from the message they belong to (§2.3)', () => {
  const swiped = chat('c', [
    user('Well?', 1000),
    said(VERA, 'First.', 2000),
    said(OSKAR, 'Kept.', 3000, {
      swipes: [
        { text: 'Tried once.', at: 3100 },
        { text: 'Tried twice.', at: 3200 },
        { text: 'Kept.', at: 3300 },
      ],
      activeSwipe: 2,
    }),
    user('And then?', 4000, { swipes: [{ text: 'ignored', at: null }], activeSwipe: 0 }),
    said(VERA, 'Then this.', 5000),
  ]);

  it('carries the messages before the swipe, holds the swipe, and nothing after', () => {
    const built = build(family(swiped));
    const [round, next] = headPath(built);
    // Siblings of one round tie on time, so their order is their ids' hash
    // bits (`roundTime`); what is asserted is what each holds.
    const siblings = childrenOf(built, null)
      .filter((turn) => turn.id !== round?.id)
      .sort((one, two) => ((one.foreign?.id ?? '') < (two.foreign?.id ?? '') ? -1 : 1));

    expect(built.document.turns).toHaveLength(4);
    expect(siblings.map((turn) => turn.output?.messages)).toEqual([
      [
        { speaker: { id: 'Vera.png', name: 'Vera' }, text: 'First.', carried: true },
        { speaker: { id: 'Oskar.png', name: 'Oskar' }, text: 'Tried once.' },
      ],
      [
        { speaker: { id: 'Vera.png', name: 'Vera' }, text: 'First.', carried: true },
        { speaker: { id: 'Oskar.png', name: 'Oskar' }, text: 'Tried twice.' },
      ],
    ]);
    for (const sibling of siblings) {
      expect(sibling.input).toEqual(round?.input);
      // Leaves: the continuation answered the active swipe, so it hangs there.
      expect(childrenOf(built, sibling.id)).toEqual([]);
    }
    expect(next?.parentTurnId).toBe(round?.id);
    expect(siblings.map((turn) => turn.foreign?.id)).toEqual(['c#2:swipe:0', 'c#2:swipe:1']);
    expect(built.notes).toContainEqual({
      key: 'import.chat.swipes',
      params: { count: 2 },
      level: 'info',
    });
  });

  it('gives a round and every alternative of it the round’s time, never a swipe’s', () => {
    const built = build(family(swiped));
    const roots = childrenOf(built, null);

    expect(roots).toHaveLength(3);
    // The player's line opened the round at 1000; the swipes' own times, 3100
    // to 3300, are in no id.
    expect(roots.map((turn) => uuidv7Timestamp(turn.id))).toEqual([1000, 1000, 1000]);
  });

  /** One round: a player's line and one reply with two swipes, `active` showing. */
  function oneReply(active: 0 | 1): ChatSourceChat {
    const swipes = [
      { text: 'x', at: 3000 },
      { text: 'y', at: 3500 },
    ];
    return chat('c', [
      user('u', 1000),
      said(OSKAR, swipes[active]!.text, swipes[active]!.at, { swipes, activeSwipe: active }),
    ]);
  }

  /** One group round, one batch: Vera, then Oskar with two swipes, `active` showing. */
  function groupRound(id: string, active: 0 | 1, more: Partial<ChatSourceChat> = {}) {
    const swipes = [
      { text: 'x', at: 3000 },
      { text: 'y', at: 3500 },
    ];
    return chat(
      id,
      [
        user('u', 1000),
        said(VERA, 'a', 2000, { batch: 'g' }),
        said(OSKAR, swipes[active]!.text, swipes[active]!.at, {
          batch: 'g',
          swipes,
          activeSwipe: active,
        }),
      ],
      more,
    );
  }

  const idsOf = (built: ChatBuild): string[] => built.document.turns.map((turn) => turn.id).sort();
  const textsOf = (turns: readonly Turn[]): string[] =>
    turns.map((turn) => (turn.output?.messages ?? []).map((m) => m.text).join('|')).sort();

  it('moves no id when the person shows another swipe, in a round of one reply or of many', () => {
    // SillyTavern swaps which swipe the line holds, and its time with it
    // (`syncSwipeToMes`): the round becomes a sibling and a sibling the round.
    expect(idsOf(build(family(oneReply(1))))).toEqual(idsOf(build(family(oneReply(0)))));
    expect(idsOf(build(family(groupRound('c', 1))))).toEqual(
      idsOf(build(family(groupRound('c', 0)))),
    );
  });

  it('makes one turn per swipe when two chats of a family show different swipes of a round', () => {
    // SillyTavern's branch-from-swipe copies the chat with another swipe up.
    const built = build(
      family(groupRound('root', 0), groupRound('branch', 1, { parentId: 'root' })),
    );

    expect(textsOf(childrenOf(built, null))).toEqual(['a|x', 'a|y']);
    expect(built.notes).toContainEqual({
      key: 'import.chat.swipes',
      params: { count: 1 },
      level: 'info',
    });
    // The carried marker is the root's: its copy of Vera's line in the
    // sibling, and none in its own round.
    const byText = new Map(childrenOf(built, null).map((turn) => [turn.output?.text, turn]));
    expect(byText.get('a\n\nx')?.output?.messages?.[0]?.carried).toBeUndefined();
    expect(byText.get('a\n\ny')?.output?.messages?.[0]?.carried).toBe(true);
  });

  it('makes one turn per swipe when only the branch ever had the alternative', () => {
    // The root was copied before the regenerate: Oskar's line has one swipe.
    const lone = chat('root', [
      user('u', 1000),
      said(VERA, 'a', 2000, { batch: 'g' }),
      said(OSKAR, 'x', 3000, { batch: 'g', swipes: [{ text: 'x', at: 3000 }], activeSwipe: 0 }),
    ]);
    const built = build(family(lone, groupRound('branch', 1, { parentId: 'root' })));

    expect(textsOf(childrenOf(built, null))).toEqual(['a|x', 'a|y']);
  });

  it('makes a greeting’s alternates sibling opening turns, and opens on the active one', () => {
    const built = build(
      family(
        chat('c', [
          said(VERA, 'Good evening.', 1000, {
            swipes: [
              { text: 'Good morning.', at: null },
              { text: 'Good evening.', at: null },
              { text: 'You again.', at: null },
            ],
            activeSwipe: 1,
          }),
          user('Hello.', 2000),
          said(VERA, 'Sit.', 3000),
        ]),
      ),
    );
    const roots = childrenOf(built, null);
    const path = headPath(built);

    expect(roots).toHaveLength(3);
    expect(path).toHaveLength(2);
    expect(path[0]?.output?.text).toBe('Good evening.');
    // A root has no parent to key a choice by; the head chooses it.
    expect(sessionOf(built).lastSelectedChild).toEqual({});
  });

  it('names the active sibling in `lastSelectedChild`', () => {
    const built = build(
      family(
        chat('c', [
          said(VERA, 'Evening.', 1000),
          user('Well?', 2000),
          said(VERA, 'Yes.', 3000, {
            swipes: [
              { text: 'No.', at: null },
              { text: 'Yes.', at: null },
            ],
            activeSwipe: 1,
          }),
        ]),
      ),
    );
    const [greeting, answer] = headPath(built);

    expect(childrenOf(built, greeting?.id ?? null)).toHaveLength(2);
    expect(sessionOf(built).lastSelectedChild).toEqual({ [greeting?.id ?? '']: answer?.id });
  });

  it('finds the active swipe by its text when the index is unusable', () => {
    const built = build(
      family(
        chat('c', [
          said(VERA, 'Shown.', 1, {
            swipes: [
              { text: 'Other.', at: null },
              { text: 'Shown.', at: null },
            ],
            activeSwipe: 7,
          }),
        ]),
      ),
    );

    expect(built.document.turns.map((turn) => turn.output?.text).sort()).toEqual([
      'Other.',
      'Shown.',
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('identity is content and parent (§2.4)', () => {
  const opening = [
    said(VERA, 'The ferry is late.', 1000),
    user('Again?', 2000),
    said(VERA, 'Again.', 3000),
    user('Then we walk.', 4000),
    said(VERA, 'In this rain?', 5000),
  ];
  const root = chat('chats/Vera/main.jsonl', [
    ...opening,
    user('Yes.', 6000),
    said(VERA, 'Fine.', 7000),
  ]);
  const branch = chat(
    'chats/Vera/branch.jsonl',
    [...opening, user('No, we wait.', 6500), said(VERA, 'Good.', 7500)],
    { parentId: 'chats/Vera/main.jsonl' },
  );

  it('collapses a branch’s copied prefix and forks it where it diverged', () => {
    const built = build(family(root, branch));
    const [rootRef, branchRef] = sessionOf(built).branchRefs ?? [];
    const turns = turnsOf(built);
    const main = walkPath(turns, rootRef?.headTurnId ?? null);
    const other = walkPath(turns, branchRef?.headTurnId ?? null);

    expect(built.document.turns).toHaveLength(5);
    expect(main.slice(0, 3).map((turn) => turn.id)).toEqual(other.slice(0, 3).map((t) => t.id));
    expect(main[3]?.id).not.toBe(other[3]?.id);
    expect(main[3]?.parentTurnId).toBe(other[3]?.parentTurnId);

    expect(rootRef?.name).toBe('chats/Vera/main.jsonl');
    expect(sessionOf(built).headTurnId).toBe(rootRef?.headTurnId);
    // The fork remembers the root chat's way.
    expect(sessionOf(built).lastSelectedChild).toEqual({ [main[2]?.id ?? '']: main[3]?.id });
  });

  it('forks a copy edited before its fork point at the edit, not at the fork', () => {
    const edited = chat(
      'chats/Vera/edited.jsonl',
      [
        opening[0]!,
        opening[1]!,
        said(VERA, 'Again, and it is raining.', 3000),
        ...opening.slice(3),
        user('Yes.', 6000),
      ],
      { parentId: 'chats/Vera/main.jsonl' },
    );
    const built = build(family(root, edited));
    const [, editedRef] = sessionOf(built).branchRefs ?? [];
    const other = walkPath(turnsOf(built), editedRef?.headTurnId ?? null);
    const [greeting] = headPath(built);

    // The greeting is shared; everything from the edited round on is its own.
    expect(other[0]?.id).toBe(greeting?.id);
    expect(other[1]?.parentTurnId).toBe(greeting?.id);
    expect(other[1]?.id).not.toBe(headPath(built)[1]?.id);
    expect(built.document.turns).toHaveLength(4 + 3);
  });

  it('keeps every id already made when a later import brings a branch', () => {
    const alone = build(family(root));
    const later = build(family(root, branch));
    const ids = new Set(later.document.turns.map((turn) => turn.id));

    for (const turn of alone.document.turns) expect(ids.has(turn.id)).toBe(true);
    expect(sessionOf(later).headTurnId).toBe(sessionOf(alone).headTurnId);
    expect(sessionOf(later).branchRefs?.[0]).toEqual(sessionOf(alone).branchRefs?.[0]);
  });

  it('finds a chat’s earlier rounds again when it grew, and makes a round that grew a sibling', () => {
    // [P14 §2.2] makes a round one turn, so a reply to a trailing player's line
    // changes that turn's content — and its key. [P14 §2.7]'s open case,
    // decided at P14.10a (`ids.ts`): the grown round is a *sibling* of the
    // round as it was imported, never the same turn extended in place — a
    // turn rewritten is what sync promises never to do. The extend arm names
    // it and moves the head onto it (`chat-sync.test.ts`); this pins the
    // builder half, on purpose.
    const before = build(family(chat('c', [said(VERA, 'Evening.', 1000), user('Well?', 2000)])));
    const after = build(
      family(
        chat('c', [said(VERA, 'Evening.', 1000), user('Well?', 2000), said(VERA, 'Yes.', 3000)]),
      ),
    );
    const [greeting, asked] = headPath(before);
    const [greetingAgain, answered] = headPath(after);

    expect(greetingAgain?.id).toBe(greeting?.id);
    expect(answered?.id).not.toBe(asked?.id);
    expect(answered?.parentTurnId).toBe(asked?.parentTurnId);
  });

  it('puts the account in the hash, and nothing else that varies', () => {
    const ned = build(family(root, branch));
    const again = build(family(root, branch));
    const ada = build(family(root, branch), NOBODY, undefined, { ...CONTEXT, account: 'ada' });
    const nedIds = new Set(ned.document.turns.map((turn) => turn.id));

    expect(JSON.stringify(again)).toBe(JSON.stringify(ned));
    expect(ada.document.turns.some((turn) => nedIds.has(turn.id))).toBe(false);
  });

  it('prints uuidv7s whose time is the send time, forced above the parent’s', () => {
    const built = build(
      family(
        chat('c', [
          said(VERA, 'One.', 5000),
          user('Backwards.', 3000),
          said(VERA, 'Two.', 3001),
          user('Unknown.', null),
          user('Microseconds.', 1.7e15),
          user('Later.', 9000),
        ]),
      ),
    );
    const times = headPath(built).map((turn) => uuidv7Timestamp(turn.id));

    expect(built.document.turns.every((turn) => isUuidv7(turn.id))).toBe(true);
    expect(times).toEqual([5000, 5001, 5002, 5003, 9000]);
    expect(headPath(built).map((turn) => turn.createdAt)[4]).toBe(new Date(9000).toISOString());
  });

  it('dates a root with no time by its chat, and a chat with none by zero', () => {
    const dated = build(family(chat('c', [user('When?', null)], { createdAt: 777 })));
    const undated = build(family(chat('c', [user('When?', null)])));

    expect(uuidv7Timestamp(dated.document.turns[0]?.id ?? '')).toBe(777);
    expect(uuidv7Timestamp(undated.document.turns[0]?.id ?? '')).toBe(0);
  });

  it('lists turns in id order, so every parent is written before its children', () => {
    const built = build(family(root, branch));
    const ids = built.document.turns.map((turn) => turn.id);
    const at = new Map(ids.map((id, index) => [id, index]));

    expect(ids).toEqual([...ids].sort());
    for (const turn of built.document.turns) {
      if (turn.parentTurnId !== null) {
        expect(at.get(turn.parentTurnId)).toBeLessThan(at.get(turn.id) ?? -1);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('the session document (§2.5, §2.6)', () => {
  it('is a Scene chat, embodied, with the family’s root where a sync will look for it', () => {
    const built = build(
      family(chat('chats/Vera/main.jsonl', [user('Hi.', 1), said(VERA, 'Hi.', 2)])),
      LIBRARY,
    );
    const session = sessionOf(built);

    expect(built.document.schema).toBe('storyengine.session-export/1');
    expect(built.document.exportedBy).toEqual({ version: null, at: CONTEXT.now });
    expect(built.document.renditions).toEqual([]);
    expect(session).toMatchObject({
      schema: 'storyengine.session/1',
      name: 'Harbour',
      createdAt: CONTEXT.now,
      updatedAt: CONTEXT.now,
      channels: {},
      mode: { id: 'storyengine.scene', config: null },
      cast: { persona: 'persona-ned', actors: ['actor-vera'] },
      lore: ['book-harbour'],
      voice: 'embodied',
      dispatch: 'per-actor',
      speakers: {
        policy: 'natural',
        allowSelfResponses: false,
        namesInHistory: 'groups',
        maxPerRound: 3,
      },
    });
    expect(session.origin?.originalFilename).toBe('chats/Vera/main.jsonl');
    expect(isUuidv7(session.id)).toBe(true);
    expect(session).not.toHaveProperty('note');
  });

  it('takes what the source said about how the chat is played', () => {
    const built = build(family(chat('c', [user('Hi.', 1)])), NOBODY, {
      voice: 'narrator',
      dispatch: 'merged',
      speakers: { policy: 'list', allowSelfResponses: true },
      note: { text: 'Keep it short.', depth: 2, every: 3 },
    });

    expect(sessionOf(built)).toMatchObject({
      voice: 'narrator',
      dispatch: 'merged',
      speakers: { policy: 'list', allowSelfResponses: true, namesInHistory: 'groups' },
      note: { text: 'Keep it short.', depth: 2, every: 3 },
    });
  });

  it('casts each resolved speaker once, in order of first appearance, up to 32', () => {
    const many = Array.from({ length: 34 }, (_, index) => ({
      key: `member-${String(index)}.png`,
      name: `Member ${String(index)}`,
    }));
    const resolution: ChatResolution = {
      speakers: new Map(many.map((ref) => [ref.key, { id: `actor-${ref.key}`, name: ref.name }])),
      persona: null,
      lore: [],
    };
    const built = build(
      family(
        chat('c', [
          user('Roll call.', 1),
          ...many.map((ref, index) => said(ref, 'Here.', 2 + index)),
          said(many[0]!, 'Still here.', 99),
        ]),
      ),
      resolution,
    );

    expect(sessionOf(built).cast?.actors).toEqual(
      many.slice(0, 32).map((ref) => `actor-${ref.key}`),
    );
    expect(built.notes).toContainEqual({
      key: 'import.chat.castCapped',
      params: { count: 2, limit: 32 },
      level: 'warn',
    });
  });

  it('says once per speaker when the library does not have them', () => {
    const built = build(
      family(chat('c', [user('Hi.', 1), said(OSKAR, 'Hi.', 2), said(OSKAR, 'Again.', 3)])),
      LIBRARY,
    );

    expect(built.notes.filter((note) => note.key === 'import.chat.speakerUnresolved')).toEqual([
      { key: 'import.chat.speakerUnresolved', params: { name: 'Oskar' }, level: 'warn' },
    ]);
  });

  it('notes a parent that is not in the family, and builds the chat anyway', () => {
    const built = build(
      family(
        chat('chats/Vera/main.jsonl', [user('Hi.', 1)]),
        chat('chats/Vera/orphan.jsonl', [user('Lost.', 2)], { parentId: 'chats/Vera/gone.jsonl' }),
      ),
    );

    expect(built.notes).toContainEqual({
      key: 'import.chat.parentMissing',
      params: { chat: 'chats/Vera/orphan.jsonl', parent: 'chats/Vera/gone.jsonl' },
      level: 'warn',
    });
    expect(sessionOf(built).branchRefs).toHaveLength(2);
    expect(childrenOf(built, null)).toHaveLength(2);
  });

  it('gives an empty chat no ref, and says so', () => {
    const built = build(family(chat('main', [user('Hi.', 1)]), chat('empty', [])));

    expect(sessionOf(built).branchRefs?.map((ref) => ref.name)).toEqual(['main']);
    expect(noteKeys(built)).toContain('import.chat.emptyChat');
  });

  it('opens on the first chat with a head when the root has none', () => {
    const built = build(family(chat('main', []), chat('other', [user('Hi.', 1)])));

    expect(headPath(built).map((turn) => turn.input?.text)).toEqual(['Hi.']);
  });
});

describe('a group’s roster and muted members — P14.9', () => {
  const MARIS: ForeignRef = { key: 'Maris.png', name: 'Maris' };
  const LUND: ForeignRef = { key: 'Lund.png', name: 'Lund' };
  const CREW: ChatResolution = {
    speakers: new Map([
      ['Vera.png', { id: 'actor-vera', name: 'Vera' }],
      ['Maris.png', { id: 'actor-maris', name: 'Maris' }],
      ['Lund.png', { id: 'actor-lund', name: 'Lund' }],
    ]),
    persona: null,
    lore: [],
  };
  const greetings = (): ChatSourceChat =>
    chat('group chats/1.jsonl', [
      // Two greetings as alternatives: two sibling openings, each a root.
      said(VERA, 'Evening.', 1, {
        swipes: [
          { text: 'Evening.', at: 1 },
          { text: 'Late again.', at: 1 },
        ],
        activeSwipe: 0,
      }),
      user('Two tickets.', 2),
      said(VERA, 'Cash.', 3),
    ]);

  it('casts the roster in its order, silent members included, then anyone else who spoke', () => {
    const built = build({ ...family(greetings()), roster: [MARIS, LUND] }, CREW, {});
    expect(sessionOf(built).cast?.actors).toEqual(['actor-maris', 'actor-lund', 'actor-vera']);
  });

  it('mutes on every opening, as the engine recording the source, with the head cache to match', () => {
    const of = { ...family(greetings()), roster: [VERA, MARIS, LUND] };
    const built = build(of, CREW, { muted: ['Lund.png'] });

    const openings = childrenOf(built, null);
    expect(openings).toHaveLength(2);
    for (const opening of openings) {
      expect(opening.effects).toEqual([
        {
          id: expect.any(String) as string,
          turnId: opening.id,
          channelId: 'se.presence',
          scopeKey: 'actor-lund',
          op: { type: 'set', path: '/' },
          before: null,
          after: false,
          proposedBy: { kind: 'engine' },
          applied: true,
          rejectedReason: null,
          supersedes: null,
          channelVersion: 1,
          scope: 'session',
        },
      ]);
    }
    // Nothing past the opening carries one: the mute is inherited, not repeated.
    expect(
      headPath(built)
        .slice(1)
        .flatMap((turn) => turn.effects),
    ).toEqual([]);
    expect(sessionOf(built).channels).toEqual({
      'se.presence#actor-lund': { version: 1, value: false },
    });
    // A function of its arguments still, effect ids and all.
    expect(JSON.stringify(build(of, CREW, { muted: ['Lund.png'] }))).toBe(JSON.stringify(built));
  });

  it('says a muted member it cannot name, rather than muting a name nobody answers to', () => {
    const built = build(
      { ...family(greetings()), roster: [VERA, LUND] },
      { ...CREW, speakers: new Map([['Vera.png', { id: 'actor-vera', name: 'Vera' }]]) },
      { muted: ['Lund.png'] },
    );
    expect(built.document.turns.flatMap((turn) => turn.effects)).toEqual([]);
    expect(sessionOf(built).channels).toEqual({});
    expect(built.notes).toContainEqual({
      key: 'import.chat.mutedUnresolved',
      params: { name: 'Lund' },
      level: 'warn',
    });
  });
});

/**
 * ***The source's state, as effects — [P14.5a]***. The builder knows no
 * tracker: it is handed `ChatStateValue`s and writes each where it moves the
 * state along the path. The sweep over Marinara's fixture holds the Marinara
 * half (`marinara/trackers.test.ts`); this holds the builder to its own.
 */
describe('the source’s state — P14.5a', () => {
  const place = (value: string, member?: ForeignRef): ChatStateValue[] => [
    {
      channelId: member === undefined ? 'x.place' : 'x.mood',
      version: 1,
      init: '',
      value,
      ...(member === undefined ? {} : { member }),
    },
  ];

  it('writes a value where it moves, never where it repeats, and a swipe’s own on its sibling', () => {
    const of = family(
      chat('c', [
        said(VERA, 'Hello.', 1000, { state: place('') }),
        user('Where are we?', 2000),
        said(VERA, 'The docks.', 3000, {
          state: place('docks'),
          swipes: [
            { text: 'The chapel.', at: 3000, state: place('chapel') },
            { text: 'The docks.', at: 3000 },
          ],
          activeSwipe: 1,
        }),
        user('And now?', 4000),
        said(VERA, 'Still the docks.', 5000, { state: place('docks') }),
      ]),
    );
    const built = build(of, LIBRARY);
    const effects = (turn: Turn | undefined) =>
      (turn?.effects ?? []).map((effect) => [effect.channelId, effect.after]);

    const [opening, round, next] = headPath(built);
    // Empty is the channel's `init`: nothing moved, nothing written.
    expect(effects(opening)).toEqual([]);
    expect(effects(round)).toEqual([['x.place', 'docks']]);
    expect(effects(next)).toEqual([]);
    const sibling = childrenOf(built, opening?.id ?? null).find((turn) => turn.id !== round?.id);
    expect(effects(sibling)).toEqual([['x.place', 'chapel']]);
    expect(sessionOf(built).channels['x.place']?.value).toBe('docks');
  });

  it('scopes a member’s value to their actor, and counts one it cannot place', () => {
    const of = family(
      chat('c', [
        said(VERA, 'Hello.', 1000, {
          state: [...place('wary', VERA), ...place('loud', OSKAR)],
        }),
      ]),
    );
    const built = build(of, LIBRARY);
    expect(headPath(built)[0]?.effects.map((effect) => [effect.scopeKey, effect.after])).toEqual([
      ['actor-vera', 'wary'],
    ]);
    expect(built.notes).toContainEqual({
      key: 'import.chat.stateMemberUnresolved',
      params: { count: 1, names: 'Oskar' },
      level: 'warn',
    });
  });

  it('rewrites a path naming a member to their actor, and drops one naming nobody here', () => {
    const of = family(chat('c', [said(VERA, 'Hello.', 1000)]));
    const built = build(of, LIBRARY, {
      state: [
        {
          channelId: 'x.locks',
          version: 1,
          init: [],
          value: ['x.place/where', 'x.mood#Vera.png/mood', 'x.mood#Oskar.png/mood'],
          paths: true,
        },
      ],
    });
    expect(headPath(built)[0]?.effects.map((effect) => effect.after)).toEqual([
      ['x.place/where', 'x.mood#actor-vera/mood'],
    ]);
    // The dropped path is counted, not lost without a word.
    expect(built.notes).toContainEqual({
      key: 'import.chat.stateMemberUnresolved',
      params: { count: 1, names: 'Oskar.png' },
      level: 'warn',
    });
  });

  it('reads a `#` past the channel key as a row name, not a member', () => {
    // An unscoped tracker's row is a person's words — "Quest #1" — and a `#`
    // in it once read as a member reference and dropped the path silently.
    const of = family(chat('c', [said(VERA, 'Hello.', 1000)]));
    const built = build(of, LIBRARY, {
      state: [
        {
          channelId: 'x.locks',
          version: 1,
          init: [],
          value: ['x.quests/Quest #1', 'x.mood#Vera.png/Potion #2'],
          paths: true,
        },
      ],
    });
    expect(headPath(built)[0]?.effects.map((effect) => effect.after)).toEqual([
      ['x.quests/Quest #1', 'x.mood#actor-vera/Potion #2'],
    ]);
    expect(built.notes.map((note) => note.key)).not.toContain('import.chat.stateMemberUnresolved');
  });
});
