// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  familiesOf,
  legacyMetadataOf,
  parseSillyTavernGroup,
  type ChatHeading,
  type SillyTavernGroup,
} from './families.js';

/**
 * ***A folder's chats into families, and a group's file into settings*** —
 * [P14.9](../../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * The grouping is pure and the sweep-level tests (`chat-families.test.ts`) see
 * only its result as sessions; these hold the rules one at a time — the older
 * checkpoint name rule, cycles, missing parents, and above all that the order
 * a family's chats are handed to the builder in does not depend on the order
 * the source listed them, since turn ids take their time from it.
 */

const DIR = 'chats/Vera Solano';

function heading(name: string, more: Partial<ChatHeading> = {}): ChatHeading {
  return { path: `${DIR}/${name}.jsonl`, name, group: false, earliest: 1_000, ...more };
}

/** Every permutation of a short list — the listings a source could hand over. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]),
  );
}

describe('families by main_chat', () => {
  const root = heading('Vera');
  const branch = heading('Vera - Branch #1', { mainChat: 'Vera', earliest: 1_000 });
  const deeper = heading('Vera - Branch #1 - Branch #1', {
    mainChat: 'Vera - Branch #1',
    earliest: 1_000,
  });
  const checkpoint = heading('Vera - Checkpoint #1', { mainChat: 'Vera', earliest: 1_000 });
  const other = heading('Another day', { earliest: 5_000 });

  it('chains a branch of a branch to the root, and leaves an unlinked chat its own family', () => {
    const plans = familiesOf([root, branch, deeper, checkpoint, other], []).plans;

    expect(plans.map((plan) => plan.key)).toEqual([other.path, root.path]);
    const family = plans.find((plan) => plan.key === root.path);
    expect(family?.chats[0]).toEqual({ path: root.path });
    expect(family?.chats.map((chat) => chat.path).sort()).toEqual(
      [root.path, branch.path, deeper.path, checkpoint.path].sort(),
    );
    expect(family?.chats.find((chat) => chat.path === deeper.path)?.parentId).toBe(branch.path);
    expect(family?.notes).toEqual([]);
  });

  it('orders a family the same way whatever order the source listed it in', () => {
    const answers = new Set(
      permutations([root, branch, deeper, checkpoint]).map((listing) =>
        JSON.stringify(familiesOf(listing, []).plans),
      ),
    );
    expect(answers.size).toBe(1);
  });

  it('puts the root first and the rest by their earliest message, then path', () => {
    const late = heading('A late branch', { mainChat: 'Vera', earliest: 9_000 });
    const early = heading('Z early branch', { mainChat: 'Vera', earliest: 2_000 });
    const [plan] = familiesOf([late, early, root], []).plans;
    expect(plan?.chats.map((chat) => chat.path)).toEqual([root.path, early.path, late.path]);
  });

  it('makes a chat whose parent is not here a root, keeping the pointer for the note', () => {
    const orphan = heading('Orphan', { mainChat: 'Gone' });
    const [plan] = familiesOf([orphan], []).plans;
    expect(plan).toEqual({
      key: orphan.path,
      chats: [{ path: orphan.path, parentId: `${DIR}/Gone.jsonl` }],
      group: null,
      notes: [],
    });
  });

  it('looks for a parent in the chat’s own folder only', () => {
    const elsewhere = { ...heading('Vera'), path: 'chats/Maris Okonkwo/Vera.jsonl' };
    const [plan] = familiesOf([elsewhere, branch], []).plans.filter((p) => p.key === branch.path);
    expect(plan?.chats).toEqual([{ path: branch.path, parentId: `${DIR}/Vera.jsonl` }]);
  });

  it('breaks a cycle at the earliest member, deterministically, and says so', () => {
    const a = heading('a', { mainChat: 'b', earliest: 1_000 });
    const b = heading('b', { mainChat: 'a', earliest: 2_000 });
    for (const listing of [
      [a, b],
      [b, a],
    ]) {
      const plans = familiesOf(listing, []).plans;
      expect(plans).toHaveLength(1);
      expect(plans[0]?.key).toBe(a.path);
      expect(plans[0]?.chats).toEqual([{ path: a.path }, { path: b.path, parentId: a.path }]);
      expect(plans[0]?.notes).toEqual([
        { key: 'import.chat.familyCycle', params: { chat: 'a', parent: 'b' }, level: 'warn' },
      ]);
    }
  });

  it('takes a chat that names itself as an original, with a note of its own', () => {
    const self = heading('self', { mainChat: 'self' });
    const [plan] = familiesOf([self], []).plans;
    expect(plan?.chats).toEqual([{ path: self.path }]);
    expect(plan?.notes).toEqual([
      { key: 'import.chat.familySelfParent', params: { chat: 'self' }, level: 'warn' },
    ]);
  });

  it('breaks a loop of three at its earliest member, naming the chat it names', () => {
    // a → c → b → a: `a` names `c`, which is in the loop, whatever its length.
    const a = heading('a', { mainChat: 'c', earliest: 1_000 });
    const b = heading('b', { mainChat: 'a', earliest: 2_000 });
    const c = heading('c', { mainChat: 'b', earliest: 3_000 });
    const answers = new Set(
      permutations([a, b, c]).map((listing) => JSON.stringify(familiesOf(listing, []).plans)),
    );
    expect(answers.size).toBe(1);
    const [plan] = familiesOf([a, b, c], []).plans;
    expect(plan?.key).toBe(a.path);
    expect(plan?.chats.map((chat) => chat.path)).toEqual([a.path, b.path, c.path]);
    expect(plan?.notes).toEqual([
      { key: 'import.chat.familyCycle', params: { chat: 'a', parent: 'c' }, level: 'warn' },
    ]);
  });

  it('holds back a branch, and its branches, whose parent is in the source and unread', () => {
    const child = heading('Vera - Branch #1', { mainChat: 'Vera' });
    const grandchild = heading('Vera - Branch #1 - Branch #1', { mainChat: 'Vera - Branch #1' });
    const { plans, heldBack } = familiesOf([child, grandchild], [], new Set([root.path]));
    expect(plans).toEqual([]);
    // By path, where a space sorts before the dot.
    expect(heldBack).toEqual([
      { path: grandchild.path, parent: 'Vera' },
      { path: child.path, parent: 'Vera' },
    ]);
    // Absent from the source altogether, the same parent is only missing.
    expect(familiesOf([child], []).heldBack).toEqual([]);
  });

  it('reads an older checkpoint’s parent from its name, when that names a chat here', () => {
    // `getMainChatName`'s older arm: no `main_chat`, the text before the last
    // `Checkpoint #`, and today's ` - ` separator's dash dropped.
    const legacy = heading('Vera - Checkpoint #2');
    const [plan] = familiesOf([root, legacy], []).plans;
    expect(plan?.chats).toEqual([{ path: root.path }, { path: legacy.path, parentId: root.path }]);

    // A name with the words in it and no such chat is a chat somebody named.
    const named = heading('Nobody - Checkpoint #3');
    expect(familiesOf([named], []).plans[0]?.chats).toEqual([{ path: named.path }]);
  });
});

describe('group files', () => {
  const file = {
    id: '1700000000000',
    name: 'Night Crossing',
    members: ['Maris Okonkwo.png', 'Vera Solano.png', 'Lund Harrow.png'],
    disabled_members: ['Lund Harrow.png', 'Removed Since.png'],
    allow_self_responses: true,
    activation_strategy: 3,
    generation_mode: 2,
    chats: ['1700000000000'],
    chat_id: '1700000000000',
  };

  it('maps the strategy, self-responses and muted members, and drops a stale mute', () => {
    const read = parseSillyTavernGroup(JSON.stringify(file), 'groups/1700000000000.json');
    if (!read.ok) throw new Error(read.refusal);
    expect(read.value).toEqual({
      path: 'groups/1700000000000.json',
      id: '1700000000000',
      name: 'Night Crossing',
      members: file.members,
      muted: ['Lund Harrow.png'],
      speakers: { policy: 'pooled', allowSelfResponses: true },
      generationMode: 'append-disabled',
      chats: ['1700000000000'],
      legacyMetadata: {},
      notes: [],
    });
  });

  it('reads a group file from before chat_id as SillyTavern does: one chat, members by name', () => {
    const read = parseSillyTavernGroup(
      JSON.stringify({ id: 'old', name: 'Old Crew', members: ['Alice', 'Bob', 'Alice'] }),
      'groups/old.json',
    );
    if (!read.ok) throw new Error(read.refusal);
    expect(read.value.members).toEqual(['name:Alice', 'name:Bob']);
    expect(read.value.chats).toEqual(['old']);
    expect(read.value.notes.map((note) => note.key)).toEqual(['import.chat.groupLegacyFormat']);

    const chat: ChatHeading = {
      path: 'group chats/old.jsonl',
      name: 'old',
      group: true,
      earliest: 1_000,
    };
    const [plan] = familiesOf([chat], [read.value]).plans;
    expect(plan?.group).toBe(read.value);
  });

  it('keeps the chat metadata an unmigrated group file holds, by chat', () => {
    const read = parseSillyTavernGroup(
      JSON.stringify({
        ...file,
        chats: ['A', 'B'],
        chat_id: 'B',
        chat_metadata: { main_chat: 'A' },
        past_metadata: { A: { note_prompt: 'x' }, B: { main_chat: 'stale' } },
      }),
      'groups/1700000000000.json',
    );
    if (!read.ok) throw new Error(read.refusal);
    // The open chat's own metadata wins over its stale `past_metadata` entry,
    // as the migration's spread order has it.
    expect(read.value.legacyMetadata).toEqual({ A: { note_prompt: 'x' }, B: { main_chat: 'A' } });
    expect(read.value.notes.map((note) => note.key)).toEqual(['import.chat.groupLegacyMetadata']);
    expect(legacyMetadataOf([read.value], 'group chats/A.jsonl')).toEqual({ note_prompt: 'x' });
    expect(legacyMetadataOf([read.value], 'chats/Vera/A.jsonl')).toBeUndefined();
  });

  it('says what it cannot map, and refuses what is not a group', () => {
    const odd = parseSillyTavernGroup(
      JSON.stringify({ ...file, activation_strategy: 9 }),
      'groups/x.json',
    );
    if (!odd.ok) throw new Error(odd.refusal);
    expect(odd.value.speakers).toEqual({ allowSelfResponses: true });
    expect(odd.value.notes.map((note) => note.key)).toEqual(['import.chat.groupStrategyUnknown']);

    expect(parseSillyTavernGroup('not json', 'groups/y.json')).toEqual({
      ok: false,
      refusal: 'unreadable',
    });
    expect(parseSillyTavernGroup('{"name":"x"}', 'groups/z.json')).toEqual({
      ok: false,
      refusal: 'missing-field',
      field: 'members',
    });
  });

  it('is matched to the family whose chats its list names, under group chats only', () => {
    const read = parseSillyTavernGroup(JSON.stringify(file), 'groups/1700000000000.json');
    if (!read.ok) throw new Error(read.refusal);
    const group: SillyTavernGroup = read.value;
    const chat: ChatHeading = {
      path: 'group chats/1700000000000.jsonl',
      name: '1700000000000',
      group: true,
      earliest: 1_000,
    };
    const branch: ChatHeading = {
      path: 'group chats/1700000000000 - Branch #1.jsonl',
      name: '1700000000000 - Branch #1',
      mainChat: '1700000000000',
      group: true,
      earliest: 1_000,
    };
    // A single chat that happens to share the name is not the group's.
    const single = heading('1700000000000');

    const plans = familiesOf([chat, branch, single], [group]).plans;
    expect(plans.find((plan) => plan.key === chat.path)?.group).toBe(group);
    expect(plans.find((plan) => plan.key === chat.path)?.chats).toHaveLength(2);
    expect(plans.find((plan) => plan.key === single.path)?.group).toBeNull();
  });
});
