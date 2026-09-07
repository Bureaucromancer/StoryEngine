// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BuildFooter } from './BuildFooter.js';

describe('BuildFooter', () => {
  it('is a landmark that names the build', () => {
    render(<BuildFooter build={{ version: '1.0.0-alpha.2', commit: 'abc' }} />);

    expect(screen.getByRole('contentinfo').textContent).toContain('StoryEngine 1.0-alpha 2');
  });

  it('renders nothing while the build is not yet known', () => {
    // Not a placeholder: a line that read "development build" for the length
    // of a request would be wrong on every identified install, every time.
    render(<BuildFooter build={undefined} />);

    expect(screen.queryByRole('contentinfo')).toBeNull();
  });
});
