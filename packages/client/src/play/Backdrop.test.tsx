// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ModeSurface } from '../api.js';
import { Backdrop, stagePicture } from './Backdrop.js';

/**
 * ***The layer behind the column*** — [10 §2.3](../../../../docs/design/10-ui-surfaces.md),
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.2.
 *
 * jsdom lays nothing out and loads no pictures, so what is held here is what
 * the markup decides — where the layer is in the document, what it says to a
 * screen reader, which classes put it behind the window and take it off a
 * phone — and the crossfade's two states, driven by firing the `load` and
 * `error` a browser would. Whether it *looks* like a backdrop is T1, a
 * person's look; the page's half — the veil, and the stage read off the
 * session — is `PlayPage.test.tsx`'s.
 */

const A = '/api/library/worlds/w-1/media/a';
const B = '/api/sessions/s-1/renditions/t-1.0/asset';

/** The layer's pictures, in paint order — the one underneath first. */
function pictures(): HTMLImageElement[] {
  return [...document.body.querySelectorAll<HTMLImageElement>('[aria-hidden="true"] > img')];
}

/** The picture at one place in the layer, or a failure that says it is not there. */
function nth(at: number): HTMLImageElement {
  const found = pictures()[at];
  if (found === undefined) throw new Error(`no picture at ${String(at)}`);
  return found;
}

function layer(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[aria-hidden="true"]');
}

describe('the backdrop layer', () => {
  it('is drawn behind the window, outside the page, decorative and gone on a phone', () => {
    const { container } = render(<Backdrop url={A} onLost={vi.fn()} />);

    const drawn = layer();
    expect(drawn).not.toBeNull();
    // A portal: in the document, and in no box the page owns.
    expect(container.contains(drawn)).toBe(false);
    expect(drawn?.parentElement).toBe(document.body);
    const classes = drawn?.className.split(/\s+/) ?? [];
    // Fixed to the window and behind everything in it.
    expect(classes).toEqual(expect.arrayContaining(['fixed', 'inset-0', '-z-10']));
    // The phone breakpoint, the codebase's idiom: the first thing to go.
    expect(classes).toContain('max-sm:hidden');
    // Decorative: the label "Scene" names the region, not the picture.
    const [picture] = pictures();
    expect(picture?.getAttribute('alt')).toBe('');
    expect(picture?.getAttribute('src')).toBe(A);
  });

  it('draws no frame at all when there is nothing to show', () => {
    const { container } = render(<Backdrop url={null} onLost={vi.fn()} />);

    expect(layer()).toBeNull();
    expect(pictures()).toEqual([]);
    expect(container.innerHTML).toBe('');
  });

  it('says so when a picture will not load', () => {
    const onLost = vi.fn();
    render(<Backdrop url={A} onLost={onLost} />);

    const [picture] = pictures();
    if (picture === undefined) throw new Error('no picture drawn');
    fireEvent.error(picture);

    expect(onLost).toHaveBeenCalledWith(A);
  });
});

/**
 * ***A room change is a fade.*** The new picture is drawn waiting and shown
 * once its pixels arrive, over the old one, which stays drawn until the next
 * change — so the stage never passes through an empty frame, and nothing
 * waits for an end-of-transition event a zeroed duration would never fire.
 */
describe('the crossfade', () => {
  const shown = (image: HTMLImageElement | undefined): boolean =>
    image?.classList.contains('opacity-100') ?? false;

  it('fades the new picture in over the old one once its pixels have arrived', () => {
    const { rerender } = render(<Backdrop url={A} onLost={vi.fn()} />);
    expect(shown(nth(0))).toBe(false);
    fireEvent.load(nth(0));
    expect(shown(nth(0))).toBe(true);

    rerender(<Backdrop url={B} onLost={vi.fn()} />);
    const [under, over] = pictures();
    expect(under?.getAttribute('src')).toBe(A);
    expect(shown(under)).toBe(true);
    expect(over?.getAttribute('src')).toBe(B);
    // Waiting, and with the motion on it, until its bytes are here.
    expect(shown(over)).toBe(false);
    expect(over?.className).toMatch(/\bduration-arrive\b/);

    fireEvent.load(nth(1));
    expect(shown(nth(1))).toBe(true);
  });

  it('shows a room it has drawn before as soon as it comes back', () => {
    const { rerender } = render(<Backdrop url={A} onLost={vi.fn()} />);
    fireEvent.load(nth(0));
    rerender(<Backdrop url={B} onLost={vi.fn()} />);
    fireEvent.load(nth(1));

    // Back to A, in the element that loaded it long ago and will not fire
    // `load` a second time.
    rerender(<Backdrop url={A} onLost={vi.fn()} />);
    const [under, over] = pictures();
    expect(under?.getAttribute('src')).toBe(B);
    expect(over?.getAttribute('src')).toBe(A);
    expect(shown(over)).toBe(true);
  });

  it('brings nothing back underneath once it has been turned off', () => {
    const { rerender } = render(<Backdrop url={A} onLost={vi.fn()} />);
    fireEvent.load(nth(0));
    rerender(<Backdrop url={null} onLost={vi.fn()} />);
    expect(layer()).toBeNull();

    rerender(<Backdrop url={B} onLost={vi.fn()} />);
    expect(pictures().map((image) => image.getAttribute('src'))).toEqual([B]);
  });
});

describe('the stage region', () => {
  function surface(over: Partial<ModeSurface>): ModeSurface {
    return {
      region: 'stage',
      key: 'se.backdrop',
      channelId: 'se.backdrop',
      scopeKey: null,
      kind: 'image',
      label: 'Scene',
      image: { url: A, alt: 'Scene' },
      ...over,
    };
  }

  it('is the stage region’s picture, and a sprite is not', () => {
    const sprite = surface({
      region: 'message',
      key: 'se.expression#a-vera',
      channelId: 'se.expression',
      scopeKey: 'a-vera',
      label: 'Expression',
      image: { url: '/api/library/actors/a-vera/media/m-1', alt: 'Expression' },
    });

    expect(stagePicture([sprite, surface({})])).toBe(A);
    expect(stagePicture([sprite])).toBeNull();
    expect(stagePicture(undefined)).toBeNull();
    // Something on the stage that is not a picture has no place behind prose.
    const meter: ModeSurface = {
      region: 'stage',
      key: 'se.backdrop',
      channelId: 'se.backdrop',
      scopeKey: null,
      kind: 'meter',
      label: 'Scene',
      meter: { value: 1, min: 0, max: 2 },
    };
    expect(stagePicture([meter])).toBeNull();
  });
});
