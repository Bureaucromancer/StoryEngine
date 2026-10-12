// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { PUBLISH_MAX_START } from '@storyengine/shared';

import { labels } from '../i18n/catalogue.js';
import { Button } from '../ui/Button.js';
import { link, page } from '../ui/classes.js';
import { joinIds } from '../search-lists.js';
import type { LibrarySelection } from './selection.js';

/**
 * ***What is chosen, and the door it opens*** — [P16.3g](../../../../docs/design/workplan/34-p16-world.md),
 * [16 §6](../../../../docs/design/16-publish.md)'s *a selection in a library
 * panel*.
 *
 * **Held at the bottom of the page**, in the strip every surface keeps its
 * critical controls in (`page.actions`), because a selection is built by
 * scrolling and switching shelves, and the count and the door should be on
 * screen wherever that leaves the person.
 *
 * ***Publish… is a link to the review, with the ids as its start*** —
 * `/library/publish?from=a,b,c`, the same address an object's page links to
 * with one id. The review decides what that start *is* (one object, or a
 * selection that keeps a World, [16 §3]); the bar only says how many.
 *
 * **Over {@link PUBLISH_MAX_START}, the door becomes a sentence** — the route's
 * own bound, shared so the client never builds a request the server would
 * refuse — sending the person to the World editor: a set that size wants a
 * name, and the editor is where making one is a first-class act.
 *
 * *On the entry*, because it is drawn on the library's own shelves; measured
 * against the ceiling at the stage that built it (`tools/entry-budget.test.ts`).
 *
 * ***Its count is a status that is always there*** (2026-10-11, the P16.3g
 * review). The bar used to be nothing at all until the first tick, and then
 * arrived holding *1 chosen* — a live region inserted already holding its text,
 * which most screen readers never read (`ui/TwoStep.tsx`). So the strip and
 * its status stay mounted, visually hidden while nothing is chosen, and the
 * count is a change to a region that was there: *1 chosen* is heard, and so
 * is *Nothing chosen* once a selection is cleared while choosing. *Clear* then
 * hands the keyboard to *Select*, since the button it was is gone.
 */
const WORDS = labels('library.selection', {
  countOne: '1 chosen',
  countMany: '{count} chosen',
  none: 'Nothing chosen.',
  publish: 'Publish…',
  tooMany:
    'Too many to send as a selection — make a world of them in its editor, then publish the world.',
  clear: 'Clear',
});

export function SelectionBar(props: { selection: LibrarySelection }): JSX.Element {
  const { chosen, clear, selecting } = props.selection;
  const empty = chosen.length === 0;
  return (
    <div className={empty ? 'sr-only' : page.actions}>
      <span role="status" className="text-sm text-ink">
        {empty
          ? selecting
            ? WORDS.none
            : ''
          : chosen.length === 1
            ? WORDS.countOne
            : WORDS.countMany.replace('{count}', String(chosen.length))}
      </span>
      {empty ? null : chosen.length > PUBLISH_MAX_START ? (
        <span className="text-sm text-ink-subtle">{WORDS.tooMany}</span>
      ) : (
        <Link
          to="/library/publish"
          search={{ from: joinIds(chosen.map((one) => one.id)) }}
          className={link.action}
        >
          {WORDS.publish}
        </Link>
      )}
      {empty ? null : (
        <Button type="button" size="compact" onClick={clear}>
          {WORDS.clear}
        </Button>
      )}
    </div>
  );
}
