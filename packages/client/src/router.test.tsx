// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { router } from './router.js';

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
