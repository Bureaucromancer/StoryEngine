// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { api, type LibraryObject } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { Face, type FaceSize } from '../ui/Face.js';

const WORDS = labels('play.face', {
  playedAs: 'Played as {name}. Change who you play',
  you: 'You',
});

/**
 * ***Who is speaking, as a face*** —
 * [P14 §1.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
 * *"the speaker's portrait and name"*, built at [P14.5].
 *
 * **The card's own likeness first**, in the order the actor record ranks them:
 * a `reference` medium is the canonical likeness ([03 §5.2.2]), and the card's
 * own pixels are what an imported character card *is*. A card with neither —
 * one written in the editor, a speaker since deleted from the library — gets
 * its initial, never a broken image: the avatar route answers 404 for a card
 * with no pixels, and an `<img>` that failed is replaced rather than left.
 * *(2026-10-13, [P12A](../../../../docs/design/workplan/35-p12a-the-look.md)
 * P12A.3: the route clause was false when it was written, and is true from
 * today. A card made in the editor has a 1×1 transparent picture, which the
 * route served with a 200, so the `<img>` loaded, never failed, and drew an
 * empty grey circle with no letter — the commonest case of all. The route
 * answers 404 for a blank card now, which is what makes the clause true; and
 * a card with neither gets the drawn tile, two initials and a hue, where it
 * got one initial.)*
 *
 * ***Re-expressed on `ui/Face` at P12A.3***, which owns the fallback and the
 * tile; what is left here is the one thing that is about actors — which picture
 * is an actor's likeness — and the id the tile's hue comes from. *Its own
 * `initialOf` is gone*, the second spelling of initials §0.4 found beside
 * `auth/tile.ts`'s. The id is passed rather than read off the card, because the
 * card is the thing that may be missing: a speaker deleted from the library
 * still has the id their record names, and keeps their colour.
 *
 * *Decorative, `alt=""`*: the name is always beside it, and a screen reader
 * hearing *Vera, Vera* on every line is the portrait getting in the way of
 * the words.
 */
export function Portrait(props: {
  /** The actor's id, which the tile's hue is taken from when there is no picture. */
  actorId: string;
  actor: LibraryObject | undefined;
  name: string;
  /** Where it sits: a line of the transcript unless said otherwise. */
  size?: FaceSize;
}): JSX.Element {
  return (
    <Face
      id={props.actorId}
      name={props.name}
      src={likeness(props.actor)}
      size={props.size ?? 'line'}
    />
  );
}

/**
 * ***The face on the player's own line*** (2026-10-13,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.3, under
 * its §0.4) — the one place in a transcript with a real author.
 *
 * **Drawn from the record, or not at all.** `input.actorId` is who the move was
 * played as, sent by the page from the persona since P12A.3; a line whose
 * record names nobody — every move played in a browser before then, and a move
 * with no persona — has no face, because drawing today's persona there is a
 * claim the record never made, and a wrong face on an old line is exactly the
 * stale attribution [10 §1.3] says a face exists to expose rather than paper
 * over. So the caller draws this only when the record names somebody.
 *
 * ***A press is the way to the correction***, [00 §3.6]'s second half: it
 * opens *You play* in the cast panel, which is where who you play is changed
 * for the next move. When the page has no cast panel to open, the face is a
 * face and not a button — a control that does nothing is worse than none.
 */
export function PlayedAs(props: {
  actorId: string;
  actor: LibraryObject | undefined;
  /** The card's name; *You* when the library no longer has it — never an id. */
  name: string | undefined;
  /** Opens who you play; absent when there is nowhere to open. */
  onWho: (() => void) | undefined;
}): JSX.Element {
  const name = props.name ?? WORDS.you;
  const face = <Portrait actorId={props.actorId} actor={props.actor} name={name} />;
  if (props.onWho === undefined) return face;
  return (
    <button
      type="button"
      aria-label={WORDS.playedAs.replace('{name}', () => name)}
      className="shrink-0 cursor-pointer self-start rounded-full focus-visible:outline-2 focus-visible:outline-focus"
      onClick={props.onWho}
    >
      {face}
    </button>
  );
}

function likeness(actor: LibraryObject | undefined): string | null {
  if (actor === undefined) return null;
  const media = actor.object['media'];
  if (Array.isArray(media)) {
    const reference = (media as unknown[]).find(
      (one): one is { id: string; role: string; digest: string } =>
        typeof one === 'object' &&
        one !== null &&
        (one as Record<string, unknown>)['role'] === 'reference' &&
        typeof (one as Record<string, unknown>)['id'] === 'string' &&
        typeof (one as Record<string, unknown>)['digest'] === 'string',
    );
    if (reference !== undefined) {
      return api.mediaUrl('actors', actor.id, reference.id, reference.digest);
    }
  }
  return api.avatarUrl(actor.id, actor.contentHash);
}
