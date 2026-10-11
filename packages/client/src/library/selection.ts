// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';

import { kindOfSchema, type LibraryObject } from '../api.js';
import { useAuthState } from '../queries.js';
import { provenanceSourceOf } from './panels.js';

/**
 * ***A selection on the shelves*** — [10 §5](../../../../docs/design/10-ui-surfaces.md)'s
 * *bulk select*, built at [P16.3g](../../../../docs/design/workplan/35-p16-world.md)
 * for the second of [16 §6](../../../../docs/design/16-publish.md)'s three
 * doors: *a selection in a library panel*.
 *
 * **Held by `LibraryPage`, above the keyed table**, so it survives a kind
 * switch: the table is remounted on every change of kind (its sorts and
 * filters are the shelf's), and [16 §2] says a selection may be *"in one
 * panel or across several"* — choose two actors, switch to Lorebooks, choose a
 * book, and all three are chosen.
 *
 * ***Not in the address***, unlike the kind ([P16.3]'s plan): a selection is
 * a gesture in progress, a list of ids would make an address nobody could read
 * or share, and two hundred of them would not fit in one. What travels is the
 * *result* — *Publish…* links to the review with the ids as its start, and
 * that address does carry them. A reload drops the selection, as it drops an
 * open search box.
 *
 * *Ids, with the name and kind beside each*, because the bar says what is
 * chosen across shelves the person can no longer see, and a chosen object that
 * scrolled away or was filtered out is still chosen.
 *
 * ***The account's, and let go of when the account changes*** (2026-10-11, the
 * P16.3g review). `App`'s gate resets every cache when the signed-in handle
 * changes — another tab signing somebody else in, one account straight to
 * another — but the router, and this page with it, stays mounted, so a
 * selection held here outlived the switch: the header named the new account
 * and the bar offered to publish the last one's ids. It is cleared, and the
 * checkboxes put away, on the render that sees a new handle — React's pattern
 * for state that follows a value, as the review's *Look again* uses.
 */
export interface Chosen {
  id: string;
  name: string;
  schema: string;
}

export interface LibrarySelection {
  /** Whether the shelves show their checkboxes — the *Select* toggle. */
  selecting: boolean;
  setSelecting: (on: boolean) => void;
  /** What is chosen, in the order it was chosen. */
  chosen: readonly Chosen[];
  has: (id: string) => boolean;
  toggle: (object: LibraryObject) => void;
  /** *Select all shown*: every selectable one of these, added. */
  add: (objects: readonly LibraryObject[]) => void;
  clear: () => void;
  /**
   * The *Select* toggle — where *Clear* gives the keyboard, since it takes the
   * bar it is in away and focus would fall to the top of the page.
   */
  toggleRef: RefObject<HTMLButtonElement | null>;
}

/**
 * ***Why a row cannot be chosen***, or `null` when it can — said to a screen
 * reader where the checkbox would be, so a row without one is not a row that
 * silently lacks one.
 *
 * - **A World**: a World is published from its own page, and a World inside a
 *   selection is a refusal at the door ([P16.3]'s plan, R8: *a set of sets has
 *   no honest kept form*, [15 §3.1]).
 * - **A shadowed copy**: its id resolves to the other file, so choosing it
 *   would publish an object other than the one on the row (F19).
 * - ***A book play wrote*** (2026-10-11, the P16.3g review): it stays home
 *   whatever is ticked (`fileSet`, [P16.3d]), so chosen alone it would publish
 *   a file of nothing, and among others it would only be a row saying so. Its
 *   own page offers no *Publish…* for the same reason.
 */
export function unselectable(object: LibraryObject): 'world' | 'shadowed' | 'play' | null {
  if (kindOfSchema(object.schema) === 'worlds') return 'world';
  if (object.shadowed) return 'shadowed';
  if (provenanceSourceOf(object) === 'session') return 'play';
  return null;
}

export function useLibrarySelection(): LibrarySelection {
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<readonly Chosen[]>([]);
  const ids = useMemo(() => new Set(chosen.map((one) => one.id)), [chosen]);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const handle = useAuthState().data?.account?.handle ?? null;
  const [owner, setOwner] = useState(handle);
  if (owner !== handle) {
    setOwner(handle);
    setChosen([]);
    setSelecting(false);
  }

  const toggle = useCallback((object: LibraryObject) => {
    if (unselectable(object) !== null) return;
    setChosen((current) =>
      current.some((one) => one.id === object.id)
        ? current.filter((one) => one.id !== object.id)
        : [...current, { id: object.id, name: object.name, schema: object.schema }],
    );
  }, []);

  const add = useCallback((objects: readonly LibraryObject[]) => {
    setChosen((current) => {
      const held = new Set(current.map((one) => one.id));
      const more = objects.filter(
        (object) => unselectable(object) === null && !held.has(object.id),
      );
      return more.length === 0
        ? current
        : [
            ...current,
            ...more.map((object) => ({ id: object.id, name: object.name, schema: object.schema })),
          ];
    });
  }, []);

  const clear = useCallback(() => {
    setChosen([]);
    toggleRef.current?.focus();
  }, []);

  return {
    selecting,
    setSelecting,
    chosen,
    has: (id) => ids.has(id),
    toggle,
    add,
    clear,
    toggleRef,
  };
}
