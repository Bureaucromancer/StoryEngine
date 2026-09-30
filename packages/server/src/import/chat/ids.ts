// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { digest } from '../../sessions/digest.js';

/**
 * ***Turn identity: a trie over (account, family, parent, content), printed as
 * uuidv7*** —
 * [P14 §2.4](../../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * ```
 * id = uuidv7Shaped( time, H(account, familyKey, parentKey, input, messages) )
 * ```
 *
 * Every property the import needs falls out of this one function, which is why
 * it is a module of its own rather than a line in the builder:
 *
 * - **Content and parent, not position.** Chats in one family that share a
 *   prefix produce the same keys for it, so the prefix collapses into one path
 *   and each branch forks exactly where it diverged — *including a branch copy
 *   that was edited before its fork point*, which a position-based scheme would
 *   graft on at the wrong node. [P14 §0.1]'s family reconstruction is not an
 *   algorithm anywhere; it is this.
 * - **The account is in the hash.** `sessionHoldingTurns` looks turn ids up
 *   across the whole index (`index-db/sessions.ts:368`). Without the account, a
 *   second person importing the same chat would be refused `already-here` — and
 *   would learn from the refusal that somebody else on the install has it.
 * - **uuidv7-shaped**, because `exportSession` sorts turns by id and
 *   `importSession` appends in file order, so the id's time has to put every
 *   parent before its children (see {@link placeTime}).
 * - **Deterministic**, so importing an unchanged chat again finds every turn
 *   already present, and a chat grown by whole new rounds finds all but those.
 *   ***A chat that grew inside its last round is a new sibling, by decision***
 *   ([P14.10a], 2026-09-29). A reply to what was a trailing player's line, a
 *   further reply or narrator line with no new `gen_id` (single chats,
 *   Marinara), a greeting followed by an empty send — each changes the last
 *   round's content, so its key, so the old round is not found, and the round
 *   as it now stands is appended beside it. [P14 §2.7] offered two ways out;
 *   keying a round on its opening instead would have let replies extend a
 *   turn in place, which is a turn rewritten — the one thing sync promises
 *   never to do — and would have given one id to two contents, the property
 *   every other rule here rests on. So *identical content, identical id*
 *   stands, the sibling is named for what it is (`import.chat.roundGrew`,
 *   counted by `importSession`'s extend arm), and the head moves onto it when
 *   the person had not played on — which is all following the source means.
 *
 * ***The parent is named by its key, not its id.*** An id carries a time, and a
 * time is decided by first occurrence (below); the key is content all the way
 * to the root. So a node's key never depends on the order chats were visited in,
 * only its printed id's timestamp does.
 *
 * ***`SCHEME` must never change.*** It is hashed into every key, and a session
 * imported under one scheme and synced under another would find none of its
 * turns and fork itself whole. A different scheme is a different importer.
 */
const SCHEME = 'storyengine.import.chat/1';

/**
 * What a node's key is computed over: this stage's reading of [P14 §2.4]'s
 * `messages`, which is each message as its speaker key (or the narrator) and
 * its text, and nothing else of it.
 *
 * ***Decided here, not spelled out in §2.4***, whose formula hashes `messages`
 * without naming which of a message's fields that means. So it is stated as a
 * decision, and it has to be confirmed in the design — §2.4 amended to list the
 * hashed fields — before `storyengine.import.chat/1` is frozen by the first
 * import anybody keeps, since `SCHEME` can never change after that.
 *
 * - **`speakerKey`** is the source's `ForeignRef.key`, or null for the
 *   narrator (and for a character line nobody was named for). *Never the
 *   resolved library id*, for the reason `types.ts` gives at length: resolution
 *   changes when the library does, and a turn's identity must not.
 * - **`carried`, `reasoning` and `hidden` are deliberately not in it.**
 *   - *`carried` records which swipe the source happened to show*, not what
 *     the chat says. Two views of one round that differ only in the active
 *     swipe of its last message make the same turn from opposite sides — the
 *     round in one, a swipe's sibling in the other — and that happens both
 *     within an import (SillyTavern's branch-from-swipe copies the chat with
 *     another swipe showing, `swipe-picker.js:388`) and between two (the
 *     person picked another swipe before the sync). Keyed on the flag, each
 *     view would keep its own copy, and the sibling strip would show the same
 *     words twice. So the marker is presentation, taken from the node's first
 *     placement — the root chat's, when the root has the node — as its time is.
 *   - *Reasoning* is what a model thought, not what the chat says.
 *   - *Hiding* is mutable session state that [P14 §2.7] merges on every
 *     import. If an unhide changed a key, a sync would fork the session over a
 *     ghost icon.
 */
export interface NodeContent {
  input: string | null;
  messages: readonly { speakerKey: string | null; text: string }[];
}

/**
 * A node's key: 64 hex digits, and the whole of its identity.
 *
 * *Tagged, as well as length-prefixed by `digest`*: each variable part is
 * preceded by a word saying what it is, so an absent input cannot read as an
 * empty one, nor a narrator line as a speaker whose key happens to be the word
 * `narrator`. Two different trees can only share a key by a collision in
 * SHA-256.
 */
export function nodeKey(
  account: string,
  familyKey: string,
  parentKey: string | null,
  content: NodeContent,
): string {
  const parts = ['turn', SCHEME, account, familyKey, parentKey ?? 'root'];
  if (content.input === null) parts.push('no-input');
  else parts.push('input', content.input);
  parts.push(String(content.messages.length));
  for (const message of content.messages) {
    if (message.speakerKey === null) parts.push('narrator');
    else parts.push('speaker', message.speakerKey);
    parts.push('text', message.text);
  }
  return digest(parts);
}

/**
 * ***A chat's branch ref, named for the chat and not for where it ends.*** The
 * key is the account, the family and the chat's own id, so a chat that grew
 * since the last import keeps its ref's id while the ref moves — which is what
 * lets [P14 §2.7]'s merge tell *the same ref, further on* from *a new branch*.
 */
export function refKey(account: string, familyKey: string, chatId: string): string {
  return digest(['ref', SCHEME, account, familyKey, chatId]);
}

/**
 * The document's own session id, which `importSession` replaces with one it
 * mints. Derived rather than drawn only so the builder stays a function of its
 * arguments — a placeholder that changed between two builds of one family would
 * make them differ by a byte nobody reads.
 */
export function sessionKey(account: string, familyKey: string): string {
  return digest(['session', SCHEME, account, familyKey]);
}

/**
 * ***An effect the source's own state writes on a turn*** — [P14.9]'s muted
 * members, one `se.presence` per member on an opening turn (`build.ts`).
 *
 * Over the turn's **key**, the channel and the member's **foreign** key, and
 * so for the reason {@link nodeKey} gives for its own inputs: a card imported
 * later resolves the member to a different library id, and an effect whose id
 * moved when the library did would make two builds of one family differ. *Not
 * identity* — nothing looks an effect up by id across imports — but the builder
 * is a function of its arguments, and an id drawn at random here would be the
 * one byte that was not.
 */
export function effectKey(turnKey: string, channelId: string, memberKey: string): string {
  return digest(['effect', SCHEME, turnKey, channelId, memberKey]);
}

/**
 * ***The latest time a source may claim***: 2^47 ms, in the year 6429.
 *
 * uuidv7 has 48 bits of milliseconds and the builder needs room above any real
 * time to force children later than their parents, so half the range is the
 * ceiling. **Anything above it is a unit mistake rather than a date** —
 * microseconds since the epoch are about 1.7 × 10^15 — and is read as unknown,
 * which then takes the parent's time plus one like any other unknown.
 */
const LATEST = 2 ** 47;

/** A source's time, if it is one: a whole number of milliseconds in range. */
export function readableTime(at: number | null | undefined): number | null {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  const whole = Math.floor(at);
  return whole >= 0 && whole <= LATEST ? whole : null;
}

/**
 * ***A node's time: its own, forced strictly above its parent's*** —
 * [P14 §2.4]'s *"the send time, forced strictly above the parent's: both
 * sources hold send times that repeat or run backwards"*.
 *
 * - With a parent: `max(own, parent + 1)`, or `parent + 1` when the source did
 *   not say. Strictly above, because a tie would leave the two ids ordered by
 *   their hash bits, and half the time a child would sort before its parent —
 *   and `importSession` appends in file order.
 * - A root: its own time, else the chat's creation time, else zero. Zero is
 *   1970, and honest: a chat that dated nothing has no time to give, and any
 *   invented one would differ between two builds.
 *
 * ***Called once per node, at its first occurrence.*** Families are visited
 * root first, so a prefix shared with a branch takes the root chat's times, and
 * a branch added by a later import cannot move an id that is already on disk.
 */
export function placeTime(
  at: number | null,
  parentTime: number | null,
  chatCreatedAt: number | null,
): number {
  const own = readableTime(at);
  if (parentTime === null) return own ?? readableTime(chatCreatedAt) ?? 0;
  const floor = parentTime + 1;
  return own === null ? floor : Math.max(own, floor);
}

/**
 * ***A uuidv7 whose random bits are not random*** — RFC 9562's layout, filled
 * from a key instead of from `crypto.getRandomValues`.
 *
 * 48 bits of `time`, the version nibble 7, 12 bits of the key as `rand_a`, the
 * variant `10`, and 62 more bits of the key as `rand_b`: 74 bits of SHA-256 in
 * all. `isUuidv7` accepts it and `uuidv7Timestamp` reads `time` back, so every
 * reader that sorts, parses or validates our ids treats an imported turn as one
 * of its own — which is the point of printing it this way rather than as the
 * bare hash.
 *
 * *Not `createUuidv7()`*, even with its `now` argument: that generator is
 * monotonic by design and would move a timestamp forward to stay above the
 * last one it issued, and it draws its low bits at random. Both would make the
 * id a function of what was minted before it rather than of the node.
 */
export function uuidv7Shaped(time: number, key: string): string {
  const stamp = Math.floor(time).toString(16).padStart(12, '0');
  const variant = (0x8 | (Number.parseInt(key.charAt(3), 16) & 0x3)).toString(16);
  return [
    stamp.slice(0, 8),
    stamp.slice(8, 12),
    `7${key.slice(0, 3)}`,
    `${variant}${key.slice(4, 7)}`,
    key.slice(7, 19),
  ].join('-');
}
