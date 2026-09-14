// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * One badge from two axes — [10 §13.2](../../../../docs/design/10-ui-surfaces.md),
 * [P7.2](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **The derivation the design asks for, in one place that can be tested.**
 * 10 §13.2: *"the UI still shows one badge, derived from both axes, because a
 * two-axis matrix is the wrong thing to put in a sidebar. The split is in the
 * data, not on the screen."* Both halves matter — the split stays in the data,
 * and the screen shows one word.
 *
 * **The two combinations the split exists for are the two this has to get
 * right.** *Dead but present* is the body in the room, the ghost, the open
 * casket; *alive, elsewhere, coming back* is what 10 §13.2 calls **the ordinary
 * state of most of the cast most of the time**. A single enum can say neither,
 * which is the whole argument for two axes, so a derivation that collapsed them
 * back into *dead* and *inactive* would have undone it on the screen.
 *
 * *Status leads when it is terminal, presence leads when it is not*: being dead
 * outranks being in the room as the thing to say first, and among the living
 * *here* is the more useful word than *alive*, which is every other row.
 */
export function castBadge(row: { presence: boolean; status: string }): string {
  if (row.status === 'dead') return row.presence ? 'Dead, present' : 'Dead';
  if (row.status === 'departed') return row.presence ? 'Departed, present' : 'Departed';
  return row.presence ? 'Here' : 'Elsewhere';
}

/**
 * Whether the badge should read as bad news.
 *
 * A separate question from the words, because a terminal status is the one thing
 * in this panel worth colour — and `castBadge`'s job is the sentence, not the
 * palette.
 */
export function isTerminalBadge(status: string): boolean {
  return status === 'dead' || status === 'departed';
}

/**
 * How a party member is marked — [10 §13.2], [P7.3].
 *
 * **A second badge, not a second panel and not a word folded into the first.**
 * 10 §13.2 asks the panel to *"mark party members distinctly and introduce no
 * parallel membership concept"*: a separate list would be the parallel concept,
 * and folding it into `castBadge` would put two unrelated facts in one word —
 * *here* and *with you* are different questions, and a cast member can be either
 * without the other.
 *
 * **The `control` and not just membership**, because that is the distinction
 * worth marking: 06 §8's third rule is that *"a companion is narrated by the
 * narrator, with the player able to address, direct and influence but not
 * author"*, which is the difference between a character you write and one
 * written for you. A panel that said only *in the party* would hide the one
 * thing a person needs to know before they try to speak as somebody.
 *
 * `null` is most of the cast most of the time, and gets no mark at all.
 */
export function partyBadge(control: string | null): string | null {
  switch (control) {
    case 'player':
      return 'You write them';
    case 'companion':
      return 'Companion';
    case 'auto':
      return 'With you';
    default:
      // Including a control from a newer build: an unknown word is not a mark
      // this one can explain, and inventing a sentence for it would be worse
      // than saying nothing.
      return null;
  }
}
