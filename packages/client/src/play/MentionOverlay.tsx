// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import type { TextSpan } from '@storyengine/shared';
import { labels } from '../i18n/catalogue.js';
import { runsFor } from '../library/search.js';
import { useLibrary } from '../queries.js';
import { link } from '../ui/classes.js';
import { Popover } from '../ui/Popover.js';
import { Portrait } from './Portrait.js';

/**
 * What a mention's card says — [10 §13.1](../../../../docs/design/10-ui-surfaces.md),
 * through the catalogue.
 */
const WORDS = labels('play.mention', {
  label: 'Who “{text}” is',
  matched: 'Matched by “{text}”',
  open: 'Open {name}',
  why: 'A name is marked when it is a character’s name or one of their aliases.',
  aliases: 'Edit {name}’s aliases',
  gone: 'Not in your library any more.',
});

/**
 * What the engine understood, drawn over the prose it understood it from —
 * [10 §13.1](../../../../docs/design/10-ui-surfaces.md),
 * [06 §8.2](../../../../docs/design/06-modes-and-turn-pipeline.md), built at
 * [P7.7](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***An overlay, and the text under it is untouched.*** 06 §8.2 is the whole
 * rule: *"spans on the turn record, never a rewrite of the message text."* This
 * component takes the prose and the spans and renders the same characters with
 * marks around some of them — which is why a reader who turns it off gets
 * exactly what the model wrote, byte for byte.
 *
 * **`runsFor` rather than a second slicer**, which is the same sharing the
 * server does one layer down. That helper's own docstring says why it exists:
 * *"this takes positions worked out by the **real matcher's** rules… sharing the
 * `Run` shape is what lets one component render both."* The lorebook page
 * already renders highlights through it, so a mention and a keyword hit are one
 * implementation of *draw a mark here*.
 *
 * ***Rendered differently per method, because [10 §13.1] requires it***: *"a
 * tentative match that looks certain is worse than no highlighting."* Only
 * `matched` ships at [P7.7] and it is the certain one, so it gets the plain
 * mark; the styling fork is written now rather than retro-fitted, because the
 * tentative arm is the one that must never inherit the certain one's appearance
 * by default.
 *
 * ***And a mark opens who it is*** (2026-10-13,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.3, under
 * its §0.4). 10 §13.1's first sentence is *"highlighted and linked to their
 * cards"*, and from [P7.7] until now a mark was only highlighted: the span's
 * target was dropped by the slicer before it reached the screen. It is carried
 * through `runsFor` now, and each mark is the trigger of a `ui/Popover` saying
 * **who the engine matched**, with their face; **the words it matched by**;
 * **Open** them, the actor's editor; and **the correction that exists**, which
 * is the actor's aliases — the matcher marks a name because it is the actor's
 * name or one of their aliases, so a wrong mark is fixed by changing those, and
 * the card says so and links straight to the field. [10 §1.3]'s *a face in what
 * the mention opens is the claim, shown where it can be corrected*, and a face
 * beside every occurrence of a name stays what [10 §1.1] forbids.
 *
 * *No new route, and the stored spans are not rewritten*: a span is fixed when
 * its turn is extracted, so a changed alias marks the turns after it. The card
 * says what decides a match, not that this one will move.
 */
export function MentionOverlay(props: {
  text: string;
  spans: readonly TextSpan[];
  className?: string;
}): JSX.Element {
  /**
   * *Only this text's spans, and in order.* A turn carries spans over **two**
   * texts and `runsFor` walks one — it skips any span that starts behind its
   * cursor, so an unsorted list would silently drop marks rather than draw them
   * wrongly.
   */
  const ordered = [...props.spans].sort((left, right) => left.start - right.start);
  const runs = runsFor(props.text, ordered);

  return (
    <p className={props.className}>
      {/* Keyed by index, which is right here rather than tolerated: runs are a
          positional decomposition of one string, so the index *is* the
          identity, and two runs carrying the same text are genuinely different
          runs of it. */}
      {runs.map((run, at) =>
        run.span === null ? (
          <span key={at}>{run.text}</span>
        ) : (
          <Popover
            key={at}
            label={WORDS.label.replace('{text}', () => run.text)}
            // The trigger draws nothing of its own but the ring: the mark is the
            // look, and the button is what makes it something to press.
            triggerClassName="cursor-pointer rounded-control focus-visible:outline-2 focus-visible:outline-focus"
            trigger={
              /**
               * ***The highlight pair, which is what it is for.*** This was
               * `provenance`, and `provenance` has a meaning: `Badge`'s own
               * header spends a paragraph on it — *"System" and "Hand edit on
               * disk" say **this was not authored here**"*. A name the player
               * typed a second ago is the opposite of that.
               *
               * `index.css` invented `highlight` for exactly this shape and says
               * so: amber *"is spoken for twice over — `warn` and
               * `provenance`"*, and the blue is there so *"a marked word is
               * obviously the thing you typed rather than a badge that grew
               * inside a sentence."* Three components draw marks through
               * `runsFor`; the other two already spend this pair, and this was
               * the odd reading.
               */
              <mark className="rounded-control bg-highlight-surface text-highlight-ink">
                {run.text}
              </mark>
            }
          >
            <MentionCard text={run.text} target={run.span.target} />
          </Popover>
        ),
      )}
    </p>
  );
}

/**
 * ***Who a mark is, and where to change it.*** The library's actors are read
 * here, while the card is open, under the key the play page already holds — so
 * opening it asks the server for nothing, and an overlay nobody opens reads
 * nothing at all.
 *
 * *An actor the library no longer has* keeps the name the span recorded — a
 * `Ref` carries its name for exactly this ([04 §2]) — and its id's colour, and
 * offers no links, because there is nothing at the end of them.
 */
function MentionCard(props: { text: string; target: TextSpan['target'] }): JSX.Element {
  const actors = useLibrary('actors');
  const { id } = props.target.ref;
  const card = actors.data?.objects.find((one) => one.id === id);
  const name = card?.name ?? props.target.ref.name;

  return (
    <>
      <span className="flex items-center gap-2">
        <Portrait actorId={id} actor={card} name={name} size="card" />
        <span className="font-medium">{name}</span>
      </span>
      <span className="text-ink-muted">{WORDS.matched.replace('{text}', () => props.text)}</span>
      {card === undefined ? (
        actors.data === undefined ? null : (
          <span className="text-ink-muted">{WORDS.gone}</span>
        )
      ) : (
        <>
          <Link to="/library/actors/$id/edit" params={{ id }} className={link.inline}>
            {WORDS.open.replace('{name}', () => name)}
          </Link>
          <span className="text-ink-muted">{WORDS.why}</span>
          <Link
            to="/library/actors/$id/edit"
            params={{ id }}
            hash="aliases"
            className={link.inline}
          >
            {WORDS.aliases.replace('{name}', () => name)}
          </Link>
        </>
      )}
    </>
  );
}
