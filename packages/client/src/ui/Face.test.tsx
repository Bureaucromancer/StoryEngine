// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Face } from './Face.js';

/**
 * One face — [P12A](../../../../docs/design/workplan/35-p12a-the-look.md)
 * P12A.3, under its §0.4.
 *
 * ***The fallback is the common case, so it is the thing held.*** Most actors
 * have no picture, and since P12A.3 the avatar route says so with a `404`; a
 * face that kept a failed `<img>` would be the empty circle this stage exists to
 * remove, and a face whose colour followed the name would move under a rename.
 */

function tileOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector('span[aria-hidden="true"]');
}

describe('a face', () => {
  it('draws the picture when there is one, decorative beside its name', () => {
    const { container } = render(
      <Face id="actor-vera" name="Vera Kohl" src="/vera.png" size="line" />,
    );
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('/vera.png');
    expect(image?.getAttribute('alt')).toBe('');
    expect(tileOf(container)).toBeNull();
  });

  it('draws the tile when there is no picture, never an empty disc', () => {
    const { container } = render(<Face id="actor-vera" name="Vera Kohl" src={null} size="line" />);
    expect(container.querySelector('img')).toBeNull();
    expect(tileOf(container)?.textContent).toBe('VK');
  });

  /**
   * ***The 404 a blank card answers***, and a deleted object's, and a file gone:
   * the one signal an `<img>` gives, and the tile in its place.
   */
  it('falls back to the tile when the picture answers with an error', () => {
    const { container } = render(
      <Face id="actor-vera" name="Vera Kohl" src="/blank.png" size="line" />,
    );
    const image = container.querySelector('img');
    if (image === null) throw new Error('no picture drawn');
    fireEvent.error(image);

    expect(container.querySelector('img')).toBeNull();
    expect(tileOf(container)?.textContent).toBe('VK');
  });

  /**
   * *Which* source failed, not *that* one did: the card saved with a picture, or
   * another actor drawn in the same slot, is tried rather than refused for its
   * predecessor's failure.
   */
  it('tries a new picture rather than refusing it for the last one’s failure', () => {
    const { container, rerender } = render(
      <Face id="actor-vera" name="Vera Kohl" src="/blank.png" size="line" />,
    );
    const image = container.querySelector('img');
    if (image === null) throw new Error('no picture drawn');
    fireEvent.error(image);
    rerender(<Face id="actor-vera" name="Vera Kohl" src="/vera.png" size="line" />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/vera.png');
  });

  /**
   * ***The colour is the id's and the letters are the name's***, `tile.ts`'s
   * claim for an account made for an actor: a rename moves the letters and
   * leaves the colour, and two actors are two colours.
   */
  it('keeps an id’s colour through a rename, and gives another id another', () => {
    const colour = (id: string, name: string): { background: string; letters: string } => {
      const { container, unmount } = render(<Face id={id} name={name} src={null} size="row" />);
      const tile = tileOf(container);
      const found = {
        background: tile?.style.backgroundColor ?? '',
        letters: tile?.textContent ?? '',
      };
      unmount();
      return found;
    };

    const before = colour('actor-vera', 'Vera');
    const after = colour('actor-vera', 'Vera Kohl');
    expect(before.background).not.toBe('');
    expect(after.background).toBe(before.background);
    expect([before.letters, after.letters]).toEqual(['V', 'VK']);
    expect(colour('actor-lund', 'Vera').background).not.toBe(before.background);
  });
});
