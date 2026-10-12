// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { getRouteApi, Link } from '@tanstack/react-router';
import { Component, lazy, Suspense, type JSX, type ReactNode } from 'react';

import type { PublishStart } from '@storyengine/shared';

import { labels } from '../../i18n/catalogue.js';
import { useAuthState } from '../../queries.js';
import { splitIds } from '../../search-lists.js';
import { saveFile } from '../save-file.js';
import { AlertNote } from '../../ui/Alert.js';
import { link, page } from '../../ui/classes.js';
import { Note } from '../../ui/Text.js';

/**
 * ***The review's route, and the only half of it the entry carries*** —
 * [P16.3g](../../../../../docs/design/workplan/34-p16-world.md),
 * [21 §7](../../../../../docs/design/21-client-loading.md).
 *
 * **Lazy because it had to be, and named so before it was built.**
 * `tools/entry-budget.test.ts` records the entry at **309.69 kB** of a 312
 * ceiling at P16.3f, and says in so many words that the publish review is the
 * next `lazy()` — *a panel nobody sees until they press Publish, the plainest
 * case since the setup wizard's dialog* — and that **the ceiling is not raised
 * for this stage**. The review is the largest surface P16 adds: every level of
 * a closure, its reasons, the sessions, the choices and the confirm. None of it
 * is needed until somebody presses *Publish…*.
 *
 * *The shape is the three before it* ([21 §7.2], [21 §7.3], P16.3f's world
 * look): **a sentence while the chunk is on its way**, a `status`, where the
 * review will be; and **a boundary of its own** that tells only a failed load
 * to reload — the factory wraps the import's rejection in
 * {@link PublishChunkError} — and anything else that the review stopped with
 * an error, since a reload would only repeat a bug. *No retry control*, for
 * §7.2's reasons: React caches a rejected `lazy` load, and the failure a
 * self-hosted install is likeliest to see is an upgrade under an open tab,
 * which only a reload answers. The way back to the library is outside the
 * boundary, so a review that cannot draw still leaves the page a way out.
 *
 * **What stays here**: reading the address into a start, the two sentences
 * and the boundary — nothing that imports the review, `shared`'s `fileSet`
 * included, which arrives with the chunk.
 */

/** The review's code did not arrive — the one failure a reload answers. */
export class PublishChunkError extends Error {
  constructor(cause: unknown) {
    super('The publish review’s code could not be loaded.', { cause });
    this.name = 'PublishChunkError';
  }
}

const LazyPublishPage = lazy(() =>
  import('./PublishPage.js').then(
    (module) => ({ default: module.PublishPage }),
    (cause: unknown) => {
      throw new PublishChunkError(cause);
    },
  ),
);

const WORDS = labels('publish.load', {
  loading: 'Gathering what this would send…',
  chunk:
    'The review could not be loaded. If StoryEngine was updated since this page was opened, reload the page.',
  render: 'The review stopped with an error, so nothing can be published from here.',
  nothing:
    'Nothing is chosen to publish. Choose some objects on the library’s shelves, or open a world and publish it from its page.',
  back: 'Back to the library',
});

const routeApi = getRouteApi('/library/publish');

/**
 * ***What the address starts from*** — a World by its own shape, or the ids
 * as a selection (one id is an object start; the server decides which by
 * counting, [P16.3d]). `null` for an address that names neither. Each id is
 * decoded from the address (`splitIds`), so one holding a comma is one id.
 */
export function startOf(search: { from?: string; world?: string }): PublishStart | null {
  if (search.world !== undefined && search.world !== '') return { kind: 'world', id: search.world };
  const ids = splitIds(search.from);
  return ids.length === 0 ? null : { kind: 'objects', ids };
}

export function PublishRoute(): JSX.Element {
  const start = startOf(routeApi.useSearch());
  const locale = useAuthState().data?.account?.locale ?? undefined;
  return (
    <div className={page.tooling}>
      {start === null ? (
        <Note>{WORDS.nothing}</Note>
      ) : (
        <PublishLoad>
          <Suspense fallback={<Note role="status">{WORDS.loading}</Note>}>
            {/*
             * **Keyed by the start**, so another publish is a fresh review
             * rather than this one's ticks over a different closure — the
             * ticks are keyed by id, and a session ticked in one World's
             * review must not quietly stay ticked in the next one's.
             */}
            <LazyPublishPage
              key={JSON.stringify(start)}
              start={start}
              locale={locale}
              onFile={saveFile}
            />
          </Suspense>
        </PublishLoad>
      )}
      <p className="mt-6">
        <Link to="/library" search={{}} className={link.back}>
          {WORDS.back}
        </Link>
      </p>
    </div>
  );
}

/**
 * ***If the chunk never arrives, or the review fails once it has*** — local,
 * so the route's way back stands. Exported for its test, which is what holds
 * the two sentences apart.
 */
export class PublishLoad extends Component<
  { children: ReactNode },
  { failed: 'chunk' | 'render' | null }
> {
  override state: { failed: 'chunk' | 'render' | null } = { failed: null };

  static getDerivedStateFromError(error: unknown): { failed: 'chunk' | 'render' } {
    return { failed: error instanceof PublishChunkError ? 'chunk' : 'render' };
  }

  override render(): ReactNode {
    if (this.state.failed === null) return this.props.children;
    return (
      <AlertNote role="alert">
        {this.state.failed === 'chunk' ? WORDS.chunk : WORDS.render}
      </AlertNote>
    );
  }
}
