// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HomePage } from './HomePage.js';

/**
 * Home, as a prototype — [P7B.9].
 *
 * **The assertion that matters is that the changelog is the *build's*.** The
 * import is resolved at bundle time from the repository's own `CHANGELOG.md`
 * ([P7B §1.3]), so a running build shows what that build contains rather than
 * whatever a server happens to be holding. A test that stubbed the text would
 * assert nothing about that; this one reads the real file through the same
 * import the page uses, which is the only way the claim is checkable at all.
 */
describe('the arrival page', () => {
  it('is a page rather than a redirect, and says what it is not yet', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { name: 'StoryEngine' })).toBeTruthy();
    expect(screen.getByText(/not built yet/)).toBeTruthy();
  });

  it("shows this build's changelog, which is the only thing on it", () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { name: 'What changed in this build' })).toBeTruthy();
    // A version heading, from the real file — the import is the subject.
    expect(screen.getByText(/1\.0\.0-alpha/)).toBeTruthy();
  });
});
