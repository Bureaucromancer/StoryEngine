// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { drawnTile } from './tile.js';

/**
 * ***A face*** — a picture when there is one, the drawn tile when there is not,
 * and the tile again when the picture will not load. Built at
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.3, under its
 * §0.4: *"one face component in `ui/`, on `auth/tile.ts`'s spelling
 * generalised"*.
 *
 * **One component, because there were two spellings of the fallback and a third
 * was on its way.** The sign-in gallery drew [12 §5.4]'s tile — two initials by
 * grapheme, a hue from the handle — and the play page's portrait drew one letter
 * cut by code point on a grey disc; [10 §1.3](../../../../docs/design/10-ui-surfaces.md)
 * then asked for faces in the cast panel, the library and the editors, each of
 * which would have grown its own. The tile is `tile.ts`'s, and this is the one
 * place that decides when to draw it.
 *
 * ***The fallback is designed, not defaulted***, which is P12A.3's own sentence:
 * most actors will have no portrait for a long time, so the tile is the common
 * case rather than the broken one. Three ways to arrive at it, and they look the
 * same on purpose — **no picture** (`src` is `null`), **a picture that answers
 * with an error** (the avatar route's `404` for a blank card since P12A.3, a
 * deleted object, a file gone), and **a picture that never existed** for an id
 * nobody has. An `<img>` that failed is replaced rather than left as a broken
 * image, and *which* source failed is remembered rather than *that* one did, so
 * a new source — the card saved with a picture, a different actor in the same
 * slot — is tried rather than refused for its predecessor's failure.
 *
 * **The hue is the immutable id's, the letters the name's** — `tile.ts` says
 * why for an account, and an actor is the same argument: renaming *Vera* to
 * *Vera Kohl* changes her letters and leaves her colour where it was.
 *
 * *Decorative, `alt=""` and `aria-hidden`*: every face is drawn beside the name
 * it stands for, and a screen reader hearing *Vera, Vera* on every line is the
 * face getting in the way of the words. A face that is also a control — the
 * player's own line, which opens who you play — names itself on the control.
 */
export function Face(props: {
  /** The immutable key the hue is taken from: an actor's id, an account's handle. */
  id: string;
  /** The name beside the face, whose initials the tile carries. */
  name: string;
  /** The picture, or `null` for none. */
  src: string | null;
  size: FaceSize;
}): JSX.Element {
  const [failed, setFailed] = useState<string | null>(null);
  const shown = props.src === failed ? null : props.src;

  if (shown === null) {
    const tile = drawnTile({ id: props.id, name: props.name });
    return (
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center font-medium ${SIZE[props.size]}`}
        style={{ backgroundColor: tile.background, color: tile.ink }}
      >
        {tile.initials}
      </span>
    );
  }
  return (
    <img
      src={shown}
      alt=""
      className={`shrink-0 border border-line bg-surface-muted object-cover ${SIZE[props.size]}`}
      onError={() => {
        setFailed(shown);
      }}
    />
  );
}

/**
 * ***Four sizes, named for where they sit***, one whole class literal each
 * because Tailwind emits only what it reads verbatim. A face is round wherever
 * it stands for somebody beside their name — a line of the transcript, a row,
 * a card — and **the editor's header is the card's own picture**, which is a
 * picture before it is a face, so it takes `rounded-media` as every picture in
 * the client does, and its tile takes the same shape so a card with no picture
 * keeps its slot's.
 */
const SIZE = {
  row: 'size-6 rounded-full text-xs',
  line: 'size-8 rounded-full text-sm',
  card: 'size-12 rounded-full text-lg',
  header: 'size-20 rounded-media text-2xl',
} as const;

export type FaceSize = keyof typeof SIZE;
