// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { AutoMode } from './ChatComposer.js';

/**
 * ***Auto-mode says how it stops, once it is on*** (2026-10-13,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.8).
 *
 * The sentence — *it sends on its own; typing or Stop turns it off* — was the
 * switch label's `title`, which a phone never shows and a keyboard never
 * reaches, and it is the one thing about auto-mode a person needs once it is
 * running. It is drawn under the two controls while the switch is on, and the
 * switch is described by it; while off, the labels say what it would do and
 * nothing more is drawn. Mutations: the sentence drawn always; never; drawn
 * but describing nothing; the title put back as its only home.
 */

function Harness(): React.JSX.Element {
  const [on, setOn] = useState(false);
  return <AutoMode on={on} seconds="5" onToggle={setOn} onSeconds={() => undefined} />;
}

describe('auto-mode', () => {
  it('says how it stops once it is on, and describes the switch by it', async () => {
    render(<Harness />);
    const box = screen.getByRole('checkbox', { name: 'Let them keep talking on their own' });

    expect(screen.queryByText(/Typing or Stop turns it off/)).toBeNull();
    expect(box.getAttribute('aria-describedby')).toBeNull();

    await userEvent.click(box);

    const said = screen.getByText(/Typing or Stop turns it off/);
    expect(box.getAttribute('aria-describedby')).toBe(said.id);
    // Said on the page, and nowhere only a pointer reaches.
    expect(box.closest('label')?.getAttribute('title')).toBeNull();

    await userEvent.click(box);
    expect(screen.queryByText(/Typing or Stop turns it off/)).toBeNull();
  });
});
