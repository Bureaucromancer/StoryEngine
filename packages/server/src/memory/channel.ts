// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ChannelDefinition } from '@storyengine/sdk';

/**
 * ***Memory extraction is the first escaped effect*** —
 * [07 §7](../../../../docs/design/07-branching.md), [P8 §1.9], [P8.2].
 *
 * **[P6 §0.2] found this and neither document contained the word.** *"A memory
 * extracted on a line somebody then abandons is the case the abandonment banner
 * exists for. Neither P8 nor 08 contains the word."* Correct — and [P8 §1.1]'s
 * answer is what makes it true: under *memory books are library lorebooks*,
 * every write is exactly the *"lorebook entry promoted to the shared library"*
 * that [07 §7] classifies as escaped. **Under the second storage option the
 * question would genuinely have reopened**, which is an argument for the first
 * worth having deliberately: it puts memory writes inside the one mechanism this
 * project has for admitting that branching cannot un-write things.
 *
 * ---
 *
 * ***A channel, because a proposal requires a `channelId`.*** That is the whole
 * reason this file exists rather than a boolean somewhere: the effect log is how
 * this build records *something happened that a rewind will not undo*, and
 * joining it means declaring a channel. The alternative — a bespoke list of
 * escaped writes beside the effect log — would be a second effect log, and the
 * four readers that already skip escaped effects would not know about it.
 *
 * **Never replayed, and that costs nothing to arrange.** `applyEffects`,
 * `undoTurn`, `reconstructAlong` and the cast rebuild all skip
 * `scope: 'escaped'` already, so this adds not one line to any of them — which
 * is the dividend of the mechanism having been built one phase before its first
 * producer.
 *
 * *Book-scoped, so the key names the book the entries went into.* A session
 * plays with more than one character, so a session-scoped value would have to
 * be a map keyed by book to say anything useful, which is what a `scopeKey` is.
 */
export const SE_MEMORY_WRITTEN = 'se.memory.written';

export const MEMORY_WRITTEN_CHANNEL: ChannelDefinition = {
  id: SE_MEMORY_WRITTEN,
  /**
   * A package rather than a mode, for the reason `storyengine.lore` and
   * `storyengine.hooks` are: **every mode that plays with a character wants
   * memory and none of them owns it.** A mode that declared this would make
   * every other mode either import that one or declare a rival `se.memory`,
   * which is `registerChannel`'s last-write-wins rule being asked to arbitrate.
   */
  owner: 'storyengine.memory',
  version: 1,
  scope: 'book',
  /**
   * The engine writes it, never the model. A memory is written because an
   * extraction or a *remember this* produced one, and a narrator that could
   * propose this channel could claim to have remembered something it invented.
   */
  update: 'engine-computed',
  /**
   * Hidden, and the distinction is worth stating because the banner is visible.
   * [10 §8](../../../../docs/design/10-ui-surfaces.md)'s HUD is for state a
   * player is *playing against*; this is bookkeeping about what a turn left
   * behind. What surfaces is the **count** on `moveHead`, which is
   * [07 §7]'s *"small honesty feature that avoids a confusing class of bug
   * reports"* — and the report it avoids is *"I abandoned that line and Vera
   * still remembers it."*
   */
  visibility: 'hidden',
  /** Never injected. A prompt has no business reading the bookkeeping. */
  budget: null,
  escapes: true,
  schema: {
    type: 'object',
    properties: {
      /**
       * Appended to, never replaced: a line that wrote twice wrote twice, and
       * the count the banner reports is a count of entries rather than of turns.
       */
      entryIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['entryIds'],
    additionalProperties: false,
  },
  init: { kind: 'literal', value: { entryIds: [] } },
};
