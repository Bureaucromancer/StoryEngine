// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BuildFooter } from './BuildFooter.js';

/**
 * The AGPL §13 offer — [09 §7](../../../../docs/design/09-server-multiuser-deployment.md),
 * [P10.5].
 *
 * ***§13 obliges the source for **the running version**, and that is the whole
 * of what is interesting here.*** §7 names the case: *"a link to `main` is not
 * strictly compliant when the operator is running a patched build — and the
 * patched-build case is exactly the one §13 exists for."*
 *
 * **The falsifying mutation is linking to the repository root.** Every assertion
 * about a link appearing still passes; *it names this build's tag* goes red,
 * which is the only clause that makes the link an offer rather than a gesture.
 */

const BUILD = {
  version: '1.0.0-alpha.4',
  commit: 'abc1234',
  source: 'https://github.com/Bureaucromancer/StoryEngine',
};

describe('the source link', () => {
  it('names the tag of the build that is running', () => {
    render(<BuildFooter build={BUILD} />);

    const link = screen.getByRole('link', { name: 'Source' });
    expect(link.getAttribute('href')).toBe(
      'https://github.com/Bureaucromancer/StoryEngine/tree/v1.0.0-alpha.4',
    );
  });

  /**
   * ***The root rather than a guessed path for a forge nobody recognised.*** A
   * §13 offer that leads to a missing page is not an offer, and the root is a
   * smaller claim that is still true.
   */
  it('falls back to the repository for a host it does not know', () => {
    render(<BuildFooter build={{ ...BUILD, source: 'https://src.example.org/storyengine' }} />);

    expect(screen.getByRole('link', { name: 'Source' }).getAttribute('href')).toBe(
      'https://src.example.org/storyengine',
    );
  });

  /**
   * *A build can honestly not know*: a clone with no remote, an export, a
   * tarball. **No link is better than somebody else's repository**, which is
   * what a hardcoded constant would have produced for every fork.
   */
  it('shows nothing when the build carries no source', () => {
    render(<BuildFooter build={{ version: '1.0.0', commit: 'abc1234' }} />);

    expect(screen.queryByRole('link', { name: 'Source' })).toBeNull();
    // And the build line is still there, so the absence is the link's alone.
    expect(screen.getByText(/StoryEngine/)).toBeTruthy();
  });

  it('shows nothing for a build nobody identified', () => {
    render(<BuildFooter build={null} />);

    // A development run. There is no version to link a tag for, and `main`
    // would be a claim about a tree that has moved.
    expect(screen.queryByRole('link', { name: 'Source' })).toBeNull();
    expect(screen.getByText('StoryEngine development build')).toBeTruthy();
  });

  it('renders nothing at all before the build is known', () => {
    const { container } = render(<BuildFooter build={undefined} />);
    // `undefined` is *not known yet*, and a placeholder would be wrong for the
    // length of a request.
    expect(container.firstChild).toBeNull();
  });
});
