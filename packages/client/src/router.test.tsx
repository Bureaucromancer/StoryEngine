// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { LIBRARY_KINDS } from './api.js';
import {
  router,
  validateLibrarySearch,
  validateObjectSearch,
  validateSessionsSearch,
} from './router.js';

/**
 * The Library's `?kind=` and Play's `?mode=` — one kind, several, or all.
 *
 * **A single kind is spelled as it always was**, which is the claim that keeps
 * every link saved before multi-select meaning what it did; the comma list is
 * the new shape. Normalised on the way in, so what the page reads back is what
 * the bar would have written.
 */
describe('narrowing a list by kind or by mode', () => {
  it('keeps a single kind exactly as the old filter wrote it', () => {
    expect(validateLibrarySearch({ kind: 'actors' })).toEqual({ kind: 'actors' });
  });

  it('keeps several, in the library order, without duplicates', () => {
    expect(validateLibrarySearch({ kind: 'lorebooks,actors,lorebooks' })).toEqual({
      kind: 'actors,lorebooks',
    });
  });

  it('drops an unknown kind one entry at a time rather than the whole address', () => {
    expect(validateLibrarySearch({ kind: 'actors,widgets' })).toEqual({ kind: 'actors' });
    expect(validateLibrarySearch({ kind: 'widgets' })).toEqual({});
    expect(validateLibrarySearch({ kind: 7 })).toEqual({});
    expect(validateLibrarySearch({ kind: ',' })).toEqual({});
  });

  it('reads every kind named as the whole library', () => {
    expect(validateLibrarySearch({ kind: [...LIBRARY_KINDS].reverse().join(',') })).toEqual({});
  });

  /** Modes are the install's, so the router can only check the spelling. */
  it('carries mode ids it cannot check, de-duplicated', () => {
    expect(validateSessionsSearch({ mode: 'storyengine.scene' })).toEqual({
      mode: 'storyengine.scene',
    });
    expect(validateSessionsSearch({ mode: 'x.y,x.y,,z' })).toEqual({ mode: 'x.y,z' });
    expect(validateSessionsSearch({})).toEqual({});
  });
});

/**
 * The library moved from `/` to `/library` — [10 §2.2] makes `/` the address
 * home will take, and the library is explicitly not the answer to arrival.
 *
 * Driving the real router rather than asserting on the route table: the table
 * says a redirect is *configured*, and what matters is that it *fires*. This is
 * also the regression that catches someone reinstating the library at `/` for
 * convenience.
 */
describe('the root address', () => {
  it('redirects to the library, because / is reserved for home', async () => {
    await router.navigate({ to: '/' });
    await router.invalidate();

    expect(router.state.location.pathname).toBe('/library');
  });

  it('leaves /library alone once it is there', async () => {
    await router.navigate({ to: '/library', search: {} });
    await router.invalidate();

    expect(router.state.location.pathname).toBe('/library');
  });
});

/**
 * The object route's search params — [P5.0], and the first test this file has
 * ever had about one.
 *
 * **Two jobs in one bag**, which [10 §5.3] asks be said out loud where it is
 * read: `slug` and `source` name *which copy* of a duplicated id (F19), and
 * `entry` names *which part* of that object. A reader who takes `entry` for a
 * third disambiguator will be wrong quietly, so the shapes are pinned here as
 * well as commented there.
 */
describe('addressing one object, one copy of it, and one entry inside it', () => {
  it('keeps what it understands', () => {
    expect(validateObjectSearch({ slug: 'rain-city', source: 'system', entry: 'e-1' })).toEqual({
      slug: 'rain-city',
      source: 'system',
      entry: 'e-1',
    });
  });

  /**
   * Dropped rather than rejected. A truncated paste still means *this object*,
   * and the page it lands on is real — where an error card would not be.
   */
  it('drops what it does not, rather than refusing the address', () => {
    expect(validateObjectSearch({ slug: 7, source: 'nobody', entry: { id: 'e-1' } })).toEqual({});
    expect(validateObjectSearch({})).toEqual({});
    expect(validateObjectSearch({ entry: 'e-1' })).toEqual({ entry: 'e-1' });
  });

  /**
   * The one a strict validator would get wrong: an entry the book no longer has
   * is a *string*, so it survives here and the page degrades to the whole book.
   * Whether the id resolves is not the router's question.
   */
  it('carries an entry id it cannot possibly check', () => {
    expect(validateObjectSearch({ entry: 'an-entry-that-left' })).toEqual({
      entry: 'an-entry-that-left',
    });
  });

  it('does not invent keys the address did not carry', () => {
    expect(Object.keys(validateObjectSearch({ slug: 'rain-city' }))).toEqual(['slug']);
  });
});

/**
 * `/library/actors/new` is three segments, and so is `/library/$kind/$id` —
 * [polish §10].
 *
 * The new-object routes are a literal address in the shape of the read route,
 * so which one wins is a question about **route ranking** rather than about
 * anything either route declares. TanStack ranks a static segment above a
 * dynamic one, so `actors`/`new` beats `$kind`/`$id` here and nowhere else.
 *
 * Asserted rather than trusted, because the failure is quiet in the worst way:
 * *New actor* would open the **read** page for an object that has never
 * existed, and the 404 it produced would look like the server's fault. Driving
 * the real router for the same reason the redirect test above does — the table
 * saying a route is configured is not the claim.
 */
describe('the new-object addresses', () => {
  it('beat the read route they share a shape with', async () => {
    await router.navigate({ to: '/library/actors/new' });
    await router.invalidate();

    expect(router.state.location.pathname).toBe('/library/actors/new');
    expect(router.state.matches.at(-1)?.routeId).toBe('/library/actors/new');
  });

  it('does the same for the other kind that has an editor', async () => {
    await router.navigate({ to: '/library/lorebooks/new' });
    await router.invalidate();

    expect(router.state.matches.at(-1)?.routeId).toBe('/library/lorebooks/new');
  });

  /**
   * The other side of the same ranking: a real id still reaches the read page.
   * A fix for the above that reordered the table could satisfy it by breaking
   * this.
   */
  it('leaves an ordinary object address on the read route', async () => {
    await router.navigate({
      to: '/library/$kind/$id',
      params: { kind: 'actors', id: '01a008de-7e08-70d0-899c-f6869d6b9aeb' },
      search: {},
    });
    await router.invalidate();

    expect(router.state.matches.at(-1)?.routeId).toBe('/library/$kind/$id');
  });
});
