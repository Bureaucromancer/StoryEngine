// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AboutBuild } from './AboutBuild.js';

/**
 * ***The About block describes the Source link only where there is one*** —
 * [09 §7](../../../../docs/design/09-server-multiuser-deployment.md), [P10.5],
 * corrected 2026-10-01.
 *
 * The footer offers the link when the build knows its source and shows nothing
 * otherwise (`BuildFooter.test.tsx`); this block said the link was there either
 * way. **A development run and every image cut before the release passed its
 * source were the "otherwise"**, so the one page that explains the offer was
 * describing a link nobody could find.
 */

const BUILD = {
  version: '1.0.0-alpha.5',
  commit: 'abc1234',
  source: 'https://github.com/Bureaucromancer/StoryEngine',
};

describe('the licence paragraph', () => {
  it('points at the Source link when the build carries one', () => {
    render(<AboutBuild build={BUILD} />);

    expect(screen.getByText(/leads to the source for the exact build/)).toBeTruthy();
    expect(screen.queryByText(/does not say where its source is/)).toBeNull();
  });

  it('says there is no link when the build does not know its source', () => {
    render(<AboutBuild build={{ version: '1.0.0', commit: 'abc1234' }} />);

    expect(screen.getByText(/does not say where its source is/)).toBeTruthy();
    expect(screen.queryByText(/leads to the source for the exact build/)).toBeNull();
  });

  it('says the same for a build nobody identified', () => {
    render(<AboutBuild build={null} />);

    // A development run: no version, no commit, and no source to offer.
    expect(screen.getByText(/does not say where its source is/)).toBeTruthy();
  });

  it('keeps the other half of the boundary either way', () => {
    // The paragraph that matters most to the person reading it does not depend
    // on the build at all.
    render(<AboutBuild build={null} />);
    expect(screen.getByText(/What you write is yours\./)).toBeTruthy();
  });
});
