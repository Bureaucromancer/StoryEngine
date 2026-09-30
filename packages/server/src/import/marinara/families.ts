// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from '@storyengine/shared';

import type { MarinaraChat } from './chat.js';

/**
 * ***Marinara's families*** —
 * [P14.10](../../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [P14 §0.1](../../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [P14 §2.5](../../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * **A Marinara branch is a copied chat with a back-pointer**, as SillyTavern's
 * is: *Branch* creates a new `chats` row, copies the messages up to the fork
 * with their times, swipes and active index preserved, and writes the source
 * chat's id as `metadata.branchParentChatId` (`chats.routes.ts:3885`). A branch
 * of a branch names the branch. So one family is a chat and every chat that
 * points back to it, and it becomes one session whose shared prefix exists once
 * — which the builder's content identity does ([P14 §2.4]); this module only
 * says which chats are one family, and in what order.
 *
 * ***SillyTavern's rules, on ids rather than names*** (`sillytavern/families.ts`
 * is the pattern, and each rule below is its rule): a parent that is not here
 * makes a root of its own with the pointer kept, so the builder's
 * `parentMissing` says which; a chat naming itself is a root, with a note; a
 * cycle is broken at its first member in creation order, with a note. What
 * SillyTavern needed and Marinara does not: no folder to look in (an id is
 * unique across the store), and no older checkpoint rule (Marinara has always
 * written the pointer).
 *
 * *Not `chats.groupId`*, which is Marinara's sidebar grouping — *"like ST chat
 * files per character"* — and which the branch route also sets
 * (`chats.routes.ts:3751`). Two chats started separately for one character share
 * a group and are not a family: [P14 §2.5]'s *"unlinked chats stay separate
 * sessions, even when they open on the same greeting."*
 *
 * **Pure**: parsed chats in, plans out.
 */

/** Where a family is keyed — [P14 §2.7]'s `storage/tables/chats.json#<chatId>`. */
export const MARINARA_CHAT_SOURCE = 'storage/tables/chats.json#';

/**
 * ***One family, as the pass will build it.***
 *
 * - **`key`**: `storage/tables/chats.json#<root id>`, `ChatFamily.key` —
 *   hashed into every turn id and frozen with the id scheme (`chat/types.ts`).
 * - **`chats`**: root first, then the rest in creation order, each with the id
 *   it names as its parent: present in the family, or — for a root whose
 *   pointer names a chat that is not here — that id, for `parentMissing`.
 * - **`notes`**: a cycle broken, a chat that named itself.
 */
export interface MarinaraFamilyPlan {
  key: string;
  chats: { chat: MarinaraChat; parentId?: string }[];
  notes: ImportNote[];
}

/**
 * ***The roleplay chats, grouped into families*** — see the module header.
 *
 * ***Order***, which ids depend on (`ChatFamily.chats`): the root first, then
 * every other chat by its earliest message's time, then its depth below the
 * root, then its id — SillyTavern's order, for SillyTavern's reason. A branch
 * copies its parent's times, so the earliest time is mostly a tie between a
 * chat and its branches; depth puts a branch after the chat it was made from,
 * which it cannot have preceded; and an id is fixed where a listing order is
 * not. Families come back by key.
 */
export function marinaraFamilies(chats: readonly MarinaraChat[]): MarinaraFamilyPlan[] {
  const byId = new Map<string, MarinaraChat>();
  for (const chat of chats) {
    if (!byId.has(chat.chat.id)) byId.set(chat.chat.id, chat);
  }

  const parent = new Map<string, string>();
  const missing = new Map<string, string>();
  const selfNotes = new Map<string, ImportNote>();
  for (const [id, chat] of byId) {
    const stated = chat.branchOf;
    if (stated === undefined) continue;
    if (stated === id) {
      selfNotes.set(id, {
        key: 'import.chat.familySelfParent',
        params: { chat: chat.chat.name },
        level: 'warn',
      });
    } else if (byId.has(stated)) parent.set(id, stated);
    else missing.set(id, stated);
  }

  const order = (one: string, two: string): number => {
    const a = byId.get(one)?.earliest ?? null;
    const b = byId.get(two)?.earliest ?? null;
    if (a !== b) {
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    }
    return one < two ? -1 : one > two ? 1 : 0;
  };

  // -------------------------------------------------------------------------
  // Cycles — broken at the earliest member, each with a note
  // -------------------------------------------------------------------------

  const cycleNotes = new Map<string, ImportNote[]>();
  for (const start of [...parent.keys()].sort(order)) {
    const seen: string[] = [];
    let at: string | undefined = start;
    while (at !== undefined && !seen.includes(at)) {
      seen.push(at);
      at = parent.get(at);
    }
    if (at === undefined) continue;
    const loop = seen.slice(seen.indexOf(at));
    const first = [...loop].sort(order)[0];
    if (first === undefined) continue;
    const was = parent.get(first) ?? first;
    parent.delete(first);
    const note: ImportNote = {
      key: 'import.chat.familyCycle',
      params: {
        chat: byId.get(first)?.chat.name ?? first,
        parent: byId.get(was)?.chat.name ?? was,
      },
      level: 'warn',
    };
    cycleNotes.set(first, [...(cycleNotes.get(first) ?? []), note]);
  }

  // -------------------------------------------------------------------------
  // Families — each chat to its root
  // -------------------------------------------------------------------------

  const rootOf = (id: string): string => {
    let at = id;
    for (let next = parent.get(at); next !== undefined; next = parent.get(at)) at = next;
    return at;
  };
  const depthOf = (id: string): number => {
    let depth = 0;
    for (let next = parent.get(id); next !== undefined; next = parent.get(next)) depth += 1;
    return depth;
  };
  const creation = (one: string, two: string): number => {
    const a = byId.get(one)?.earliest ?? null;
    const b = byId.get(two)?.earliest ?? null;
    if (a === b) {
      const deeper = depthOf(one) - depthOf(two);
      if (deeper !== 0) return deeper;
    }
    return order(one, two);
  };

  const members = new Map<string, string[]>();
  for (const id of byId.keys()) {
    const root = rootOf(id);
    members.set(root, [...(members.get(root) ?? []), id]);
  }

  const plans: MarinaraFamilyPlan[] = [];
  for (const root of [...members.keys()].sort()) {
    const ids = members.get(root) ?? [];
    const rest = ids.filter((id) => id !== root).sort(creation);
    const planned: MarinaraFamilyPlan['chats'] = [];
    for (const id of [root, ...rest]) {
      const chat = byId.get(id);
      if (chat === undefined) continue;
      const parentId = parent.get(id) ?? missing.get(id);
      planned.push(parentId === undefined ? { chat } : { chat, parentId });
    }
    plans.push({
      key: `${MARINARA_CHAT_SOURCE}${root}`,
      chats: planned,
      notes: [root, ...rest].flatMap((id) => {
        const self = selfNotes.get(id);
        return [...(self === undefined ? [] : [self]), ...(cycleNotes.get(id) ?? [])];
      }),
    });
  }
  return plans;
}
