// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import type { GalleryEntry } from '../api.js';
import { useGallery } from '../queries.js';
import { Button } from '../ui/Button.js';
import { LoginForm } from './forms.js';
import { drawnTile } from './tile.js';

/**
 * The second front door — [12](../../../../docs/design/12-account-gallery.md),
 * [P10.4].
 *
 * ***A Quiet surface: faces, names, and nothing else.*** [10 §1.1] splits the
 * surfaces into dense tooling and quiet arrival and puts sign-in on the quiet
 * side, and this is that screen with the typing removed. **No counts, no roles,
 * no last-seen, no administrative anything** — aesthetically a gallery of
 * people rather than a user table, so the tile *is* the avatar and the name is a
 * caption rather than a row.
 *
 * ***It lives in the gate, not the router.*** The pre-auth screens are
 * deliberately outside the router, which mounts signed-in surfaces only; this
 * joins the login and setup forms as a third gate screen, chosen by
 * `loginScreen`, with the by-name switch as **local state** — a person who
 * cannot find their tile needs the form on the same screen, not a different
 * install.
 *
 * ***Not self-registration, and there is no *new account* tile*** ([12 §9]).
 * A grid of accounts is a shape that invites the extra tile, which is why the
 * plan says so and why this docstring repeats it: [09 §4.2] stands — the gallery
 * shows accounts, it does not mint them.
 *
 * ***And a tile never authenticates.*** [12 §9] refuses passwordless entry even
 * though effectively-passwordless accounts exist: picking a face fills the
 * handle and moves to the password box, and `POST /api/auth/login` is
 * byte-for-byte the same request from either door.
 */
export function Gallery(): JSX.Element {
  const gallery = useGallery();
  const [byName, setByName] = useState(false);
  const [chosen, setChosen] = useState<GalleryEntry | null>(null);

  /**
   * ***A failed listing falls through to the form rather than to an error.***
   * The gallery is a way in, not the only one: a person who cannot reach the
   * grid can still sign in by name, and a screen that said *the accounts could
   * not be read* would be telling them about a request they did not make.
   */
  if (byName || gallery.isError) return <LoginForm />;
  if (chosen !== null)
    return (
      <LoginForm
        presetHandle={chosen.handle}
        onBack={() => {
          setChosen(null);
        }}
      />
    );

  const accounts = gallery.data?.accounts ?? [];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 p-6">
      <h1 className="text-center text-title text-ink">StoryEngine</h1>

      {gallery.isPending ? (
        <p className="text-center text-ink-subtle">Loading…</p>
      ) : accounts.length === 0 ? (
        /**
         * **A real state rather than an empty grid.** Every account can opt out
         * ([12 §4]) and an admin can hide any of them, so a gallery with nothing
         * in it is reachable on purpose — and a blank screen with a heading
         * reads as broken.
         */
        <p className="text-center text-sm text-ink-subtle">
          Nobody on this install is shown here. Sign in by name instead.
        </p>
      ) : (
        <ul className="grid grid-cols-2 justify-center gap-6 sm:grid-cols-3 md:grid-cols-4">
          {accounts.map((one) => (
            <li key={one.handle}>
              <Tile
                entry={one}
                onPick={() => {
                  setChosen(one);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="text-center">
        <Button
          type="button"
          size="compact"
          onClick={() => {
            setByName(true);
          }}
        >
          Sign in by name
        </Button>
      </p>
    </main>
  );
}

/**
 * One face.
 *
 * ***A `button`, because picking one is an act rather than a navigation***, and
 * because the caption has to be inside the accessible name: a grid of images
 * whose names are all *"avatar"* is a grid a screen-reader user cannot use.
 */
function Tile(props: { entry: GalleryEntry; onPick: () => void }): JSX.Element {
  const { entry } = props;

  return (
    <button
      type="button"
      onClick={props.onPick}
      className="flex w-full flex-col items-center gap-2 rounded-panel p-3 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus"
    >
      {entry.avatar === null ? (
        <DrawnFace handle={entry.handle} displayName={entry.displayName} />
      ) : (
        <img
          // **The token in the query string is the whole cache story** —
          // [12 §5.3]. A changed face is a changed token is a changed URL; an
          // unchanged one revalidates to a 304.
          src={`/api/auth/gallery/${encodeURIComponent(entry.handle)}/avatar?v=${encodeURIComponent(entry.avatar)}`}
          alt=""
          className="size-24 rounded-full object-cover"
        />
      )}
      <span className="text-sm text-ink">{entry.displayName}</span>
    </button>
  );
}

/**
 * The drawn one — [12 §5.4].
 *
 * **An element rather than an `<svg>` data URI**, which is the same trade
 * `TagChip` takes: a data URI would need the colours baked at render time and
 * would not follow a theme change, and there is nothing here an image gives that
 * two nested elements do not.
 */
function DrawnFace(props: { handle: string; displayName: string }): JSX.Element {
  const tile = drawnTile(props);
  return (
    <span
      aria-hidden="true"
      className="flex size-24 items-center justify-center rounded-full text-2xl font-medium"
      style={{ backgroundColor: tile.background, color: tile.ink }}
    >
      {tile.initials}
    </span>
  );
}
