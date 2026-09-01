// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { router, validateObjectSearch } from './router.js';

/**
 * The library moved from `/` to `/library` — [05 §2.2] makes `/` the address
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
 * **Two jobs in one bag**, which [05 §5.3] asks be said out loud where it is
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
