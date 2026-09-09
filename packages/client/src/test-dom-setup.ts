// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Unmounts what a test rendered, between tests.
 *
 * Testing Library registers this itself when the framework's hooks are
 * globals — and this repo imports `describe`/`it`/`expect` explicitly instead,
 * so it never gets the chance. Without it, renders accumulate into one document
 * and the failure is `getByRole` reporting *multiple* matches: a message that
 * reads like an ambiguous query rather than a leaked previous test.
 *
 * It lives in the vitest project's `setupFiles` rather than in each test,
 * because the first component test is not the interesting one to get right.
 */
afterEach(cleanup);

/**
 * `scrollIntoView`, which jsdom does not implement at all.
 *
 * Not a convenience: jsdom computes no layout, so scrolling is a no-op there by
 * nature rather than by omission, and the alternative to a stub is a component
 * guarding every call with a feature check it would never need in a browser.
 * A spy rather than an empty function, so a surface that has to bring something
 * into view — the book page landing on an entry by its address
 * ([10 §5.3](../../../docs/design/10-ui-surfaces.md)) — can be asserted to have
 * asked, which is the only half of it that exists outside a real viewport.
 */
Element.prototype.scrollIntoView = vi.fn();
