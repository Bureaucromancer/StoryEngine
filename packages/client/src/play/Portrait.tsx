// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { api, type LibraryObject } from '../api.js';

/**
 * ***Who is speaking, as a face*** —
 * [P13 §1.8](../../../../docs/design/workplan/30-p13-scene-and-session-import.md)'s
 * *"the speaker's portrait and name"*, built at [P13.5].
 *
 * **The card's own likeness first**, in the order the actor record ranks them:
 * a `reference` medium is the canonical likeness ([03 §5.2.2]), and the card's
 * own pixels are what an imported character card *is*. A card with neither —
 * one written in the editor, a speaker since deleted from the library — gets
 * its initial, never a broken image: the avatar route answers 404 for a card
 * with no pixels, and an `<img>` that failed is replaced rather than left.
 *
 * *Decorative, `alt=""`*: the name is always beside it, and a screen reader
 * hearing *Vera, Vera* on every line is the portrait getting in the way of
 * the words.
 */
export function Portrait(props: { actor: LibraryObject | undefined; name: string }): JSX.Element {
  const [failed, setFailed] = useState(false);
  const source = failed ? null : likeness(props.actor);

  if (source === null) {
    return (
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm text-ink-muted"
      >
        {initialOf(props.name)}
      </span>
    );
  }
  return (
    <img
      src={source}
      alt=""
      className="h-8 w-8 shrink-0 rounded-full border border-line bg-surface-muted object-cover"
      onError={() => {
        setFailed(true);
      }}
    />
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

/** The first letter a person would say, or nothing for a name with none. */
function initialOf(name: string): string {
  const [first = ''] = Array.from(name.trim());
  return first.toLocaleUpperCase();
}
