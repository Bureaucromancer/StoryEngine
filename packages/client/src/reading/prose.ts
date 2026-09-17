// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { TurnRecord } from '../api.js';
import { labels } from '../i18n/catalogue.js';

/**
 * ***A path through the turn tree, as prose*** —
 * [10 §12](../../../../docs/design/10-ui-surfaces.md),
 * [P11.1](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **The model, separate from the rendering, because there are three renderings.**
 * §12.2 ships HTML with a print stylesheet, Markdown, and plain text — *"that
 * covers PDF without any PDF code"* — and three renderers over three
 * hand-written traversals is how they come to disagree about what a turn is.
 * They disagree here or not at all.
 *
 * ***What is deliberately not here is the machinery.*** §12.1: *"no blocks, no
 * budgets, no costs, no step timings, no channel state"*, and the fence is
 * asserted by [`fence.test.ts`](./fence.test.ts) over this whole directory
 * rather than trusted to reviewers. This module reads exactly two fields off a
 * turn — `input` and `output` — and the narrowness is the feature.
 */

/**
 * One exchange: what the player did, and what the story said back.
 *
 * ***Named `Passage` rather than `Block`, and the rename is the fence working
 * before it was written.*** The first draft called it `ReadingBlock`, which
 * reads naturally and collides head-on with the workbench's *blocks* — the
 * assembled prompt fragments [10 §12.1] forbids this view from showing. A word
 * that means two things across a boundary the whole design rests on is how the
 * boundary gets crossed by accident, and `fence.test.ts` refused the name
 * before a person did.
 */
export interface Passage {
  turnId: string;
  /**
   * The player's move, when there was one.
   *
   * *Null is common and is not an error.* A turn the engine took by itself — a
   * setup turn, a continuation, an undo's divergence marker — has no input, and
   * a reading view that printed a heading for it would invent a speaker.
   */
  said: { kind: string; text: string; who: string | null } | null;
  /** The story's own words, absent on a turn that never produced any. */
  prose: string | null;
  /**
   * ***A turn on the record that produced nothing*** — [§12.1]'s *any node*
   * includes the ones that failed.
   *
   * **Kept rather than skipped**, on the play surface's own argument: *"a
   * failed turn is shown rather than hidden: it is on the record with what it
   * managed, and hiding it would make a re-run unexplainable."* A reader
   * scrolling past a gap with no mark would think the story skipped.
   */
  unfinished: boolean;
}

/**
 * Turns in reading order into passages.
 *
 * `nameOf` resolves an actor id to a name and may answer null — a cast member
 * who has since been removed, a persona from an import. **Null renders as no
 * attribution rather than as the id**: an id in the middle of a story is worse
 * than an unattributed line, and §12.1's whole claim is *without the machinery*.
 */
export function passages(
  turns: readonly TurnRecord[],
  nameOf: (actorId: string) => string | null,
): Passage[] {
  return turns.map((turn) => {
    const input = turn.input;
    const text = turn.output?.text ?? '';
    return {
      turnId: turn.id,
      said:
        input === undefined || input.text.trim() === ''
          ? null
          : {
              kind: input.kind,
              text: input.text,
              who: input.actorId === null ? null : nameOf(input.actorId),
            },
      prose: text.trim() === '' ? null : text,
      unfinished: turn.status === 'failed',
    };
  });
}

/**
 * How a player's move reads in prose — the client's words, per
 * [work plan §2](../../../../docs/design/workplan/01-work-plan.md)'s rule that
 * English a browser renders is a translation.
 *
 * ***Not the composer's labels.*** `InputKind.tsx` says *Do*, *Say*, *Think* —
 * imperatives, because they label a button somebody is about to press. In a
 * transcript the same kinds are reports of something that already happened, and
 * a heading reading *Do* above a sentence in the past tense is the composer's
 * vocabulary leaking into a reading surface.
 *
 * A kind this build has no word for renders as itself, which is
 * `InputKind.tsx`'s rule and for its reason: a mode may declare one, and a
 * client that hid it would hide a capability.
 */
const MOVES: Record<string, string> = labels('reading.move', {
  do: 'did',
  say: 'said',
  think: 'thought',
  story: 'wrote',
  choice: 'chose',
});

/**
 * The line above a player's words — *Vera said*, *You did*, or just *said*.
 *
 * **Assembled here rather than in JSX**, which the sentence-assembly lint rule
 * requires and which is right anyway: a name and a verb joined by a space is a
 * sentence, and a sentence built out of two JSX children is one no catalogue can
 * ever translate ([P11.8](../../../../docs/design/workplan/28-p11-implementation.md)).
 */
export function attribution(said: NonNullable<Passage['said']>): string {
  const verb = MOVES[said.kind] ?? said.kind;
  return said.who === null ? verb : `${said.who} ${verb}`;
}

export interface RenderOptions {
  /** The session's name, for the document's own heading. */
  title: string;
}

/**
 * ***Markdown, because it is what somebody pastes elsewhere*** — §12.2.
 *
 * The player's moves are block quotes and the story is body text, which is the
 * one structural decision this format makes: it survives every renderer,
 * degrades to something readable as plain text, and does not depend on a
 * heading level nobody chose. *An unfinished turn is marked rather than
 * silently short*, for `Passage.unfinished`'s reason.
 */
export function toMarkdown(read: readonly Passage[], options: RenderOptions): string {
  const parts: string[] = [`# ${options.title}`];
  for (const passage of read) {
    if (passage.said !== null) {
      parts.push(`> **${attribution(passage.said)}**\n>\n${quote(passage.said.text)}`);
    }
    if (passage.prose !== null) parts.push(passage.prose);
    if (passage.unfinished) parts.push('*This turn did not finish.*');
  }
  return `${parts.join('\n\n')}\n`;
}

/** Every line prefixed, because a block quote ends at the first line that is not. */
function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

/**
 * Plain text — the format with no markup at all, for pasting where markup would
 * be noise.
 *
 * *An attribution still reads as one*, because dropping it would make dialogue
 * and narration indistinguishable, which is the one thing this format cannot
 * recover from.
 */
export function toPlainText(read: readonly Passage[], options: RenderOptions): string {
  const parts: string[] = [options.title, '='.repeat(options.title.length)];
  for (const passage of read) {
    if (passage.said !== null) parts.push(`${attribution(passage.said)}:\n${passage.said.text}`);
    if (passage.prose !== null) parts.push(passage.prose);
    if (passage.unfinished) parts.push('(This turn did not finish.)');
  }
  return `${parts.join('\n\n')}\n`;
}
