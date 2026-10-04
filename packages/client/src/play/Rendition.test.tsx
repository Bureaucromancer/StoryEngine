// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Rendition } from '../api.js';
import { anchorOffset, RenditionChooser, RenditionView } from './Rendition.js';

/**
 * The picture, the placeholder and where the picture goes —
 * [06 §10.2](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [06 §10.4a](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [10 §2.3](../../../../docs/design/10-ui-surfaces.md), [P9.4].
 *
 * ***What this file is for is the three states and the split***, which are the
 * two places this surface can be wrong in a way nothing else would catch:
 *
 * - **A rendition with no pixels renders as regenerable rather than broken.**
 *   [P9 §1.4] makes eviction a later decision *"because adopting one can never
 *   cost history — that holds only if `asset: null` renders as a regenerable
 *   placeholder rather than a broken image"*. A phase that shipped pixels
 *   without this has quietly made eviction a migration, and the failure is
 *   silent until somebody writes the eviction policy two phases later.
 * - **A miss on the anchor is ordinary.** §10.4a: a model paraphrases, a message
 *   is edited, a sentence occurs twice — so the interesting assertions are that
 *   an unresolvable anchor costs nothing and that a resolved one splits **after**
 *   its sentence rather than before it.
 */

const SESSION_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

function rendition(over: Partial<Rendition> = {}): Rendition {
  return {
    schema: 'storyengine.rendition/1',
    id: 'turn-1.0',
    sessionId: SESSION_ID,
    turnId: 'turn-1',
    createdAt: '2026-09-16T10:00:00.000Z',
    kind: 'image',
    purpose: 'illustration',
    scope: null,
    state: 'ready',
    prompt: {
      fragments: [],
      separator: ', ',
      budget: { maxChars: null, usefulChars: null },
      text: 'a tavern at dusk',
      kept: [],
      dropped: [],
      overCap: false,
    },
    asset: { path: 'assets/turn-1.0.png', mime: 'image/png', bytes: 4, digest: 'd1' },
    provenance: {
      at: '2026-09-16T10:00:01.000Z',
      binding: { connectionId: 'c-1', modelId: 'sd' },
      answeredAs: 'sd',
      seed: 7,
      workflow: {},
    },
    error: null,
    digest: 'recipe-1',
    ordering: 0,
    ...over,
  };
}

function show(one: Rendition, onRetry = vi.fn()): { onRetry: ReturnType<typeof vi.fn> } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RenditionView sessionId={SESSION_ID} rendition={one} onRetry={onRetry} />
    </QueryClientProvider>,
  );
  return { onRetry };
}

describe('a rendition on the page', () => {
  it('renders the pixels with the digest as the cache-buster', () => {
    show(rendition());

    const image = screen.getByRole('presentation');
    expect(image.getAttribute('src')).toContain(`/renditions/${encodeURIComponent('turn-1.0')}`);
    // `?v=<digest>` rather than `?v=<id>`: the bytes are immutable under an id
    // and the digest is what changes when a retry produces different ones.
    expect(image.getAttribute('src')).toContain('v=d1');
  });

  /**
   * **`alt=""`, which is what makes it `role="presentation"` above.** The
   * picture is *of* the prose beside it, so a screen reader announcing a
   * description would read the same moment twice — and the record holds the
   * prompt, which is what was asked for rather than what came back.
   */
  it('gives the picture an empty alt rather than the prompt', () => {
    show(rendition());
    expect(screen.getByRole('presentation').getAttribute('alt')).toBe('');
  });

  it('says a picture is being made rather than showing an empty frame', () => {
    show(rendition({ state: 'pending', asset: null }));

    expect(screen.getByText(/making a picture/i)).toBeTruthy();
    // No retry while it is still being made: the button is for a record with
    // nothing coming, and offering it mid-flight invites a second job for the
    // same recipe.
    expect(screen.queryByRole('button')).toBeNull();
  });

  /**
   * ***[P9 §1.4]'s contingency, asserted.*** An evicted rendition is `ready`
   * with no asset — nothing went wrong, the pixels were reclaimed, and the
   * recipe is right there ([26 E3]'s *"evict pixels, keep recipes, regenerate on
   * demand"*). It must render as regenerable, or adopting an eviction policy
   * later becomes a migration.
   */
  it('renders an evicted rendition as regenerable rather than as a failure', async () => {
    const { onRetry } = show(rendition({ state: 'ready', asset: null }));

    expect(screen.getByText(/cleared to save space/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledWith('turn-1.0');
  });

  /**
   * The class crossed the wire and the sentence is written on this side —
   * [22 §1.4]. A provider's own words stay in the log, so the assertion is that
   * two different classes produce two different sentences rather than one
   * generic one.
   */
  it('says why there are no pixels, in its own words', () => {
    show(rendition({ state: 'failed', asset: null, error: 'no-binding' }));
    expect(screen.getByText(/nothing is set up to make pictures/i)).toBeTruthy();
  });

  it('distinguishes an interrupted rendition from a refused one', () => {
    show(rendition({ state: 'failed', asset: null, error: 'interrupted' }));
    expect(screen.getByText(/server restarted/i)).toBeTruthy();
  });
});

describe('choosing among a turn’s siblings', () => {
  /** A chooser between one option is furniture — [06 §10.7] only needs it once
   *  a turn has been illustrated twice. */
  it('renders nothing for a turn with one picture', () => {
    const { container } = render(
      <RenditionChooser renditions={[rendition()]} selectedId="turn-1.0" onSelect={vi.fn()} />,
    );
    expect(container.textContent).toBe('');
  });

  it('offers every sibling and reports the one pressed', async () => {
    const onSelect = vi.fn();
    render(
      <RenditionChooser
        renditions={[rendition(), rendition({ id: 'turn-1.1', ordering: 1 })]}
        selectedId="turn-1.0"
        onSelect={onSelect}
      />,
    );

    // The one showing is not pressable: pressing it would write the selection
    // that is already written.
    expect(screen.getByRole('button', { name: '1' }).hasAttribute('disabled')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    expect(onSelect).toHaveBeenCalledWith('turn-1.1');
  });
});

describe('where a picture goes inside a message', () => {
  const PROSE = 'She opened the door. The tavern was loud and warm. Nobody looked up.';

  /**
   * ***After the sentence, not before it*** — §10.4a names the anchor as *"the
   * sentence the picture is of"*, and a picture inserted before its own sentence
   * reads as an illustration of what comes next.
   */
  it('splits after the sentence the anchor names', () => {
    const at = anchorOffset(PROSE, 'the tavern was loud');
    expect(at).not.toBeNull();
    expect(PROSE.slice(0, at ?? 0)).toBe('She opened the door. The tavern was loud and warm.');
  });

  /** *First match wins on a repeat*, per §10.4a. */
  it('takes the first match when a sentence occurs twice', () => {
    const twice = 'It rained. It rained.';
    expect(anchorOffset(twice, 'it rained')).toBe('It rained.'.length);
  });

  /**
   * ***A miss is ordinary and costs nothing.*** Null means *at the end*, which
   * is where the picture would have gone before the field existed — so a
   * paraphrased anchor, an edited message and an absent anchor are all the same
   * outcome rather than three failures.
   */
  it('answers null for an anchor that no longer resolves', () => {
    expect(anchorOffset(PROSE, 'a sentence nobody wrote')).toBeNull();
    expect(anchorOffset(PROSE, '')).toBeNull();
    expect(anchorOffset(PROSE, undefined)).toBeNull();
  });

  /**
   * A quote that resolves but sits in a sentence with no terminator has no
   * *after* to split at, so it falls to the end like any other miss — rather
   * than splitting mid-sentence, which §10.4a calls the worse outcome.
   */
  it('falls to the end rather than splitting mid-sentence', () => {
    expect(anchorOffset('the tavern was loud and warm', 'tavern')).toBeNull();
  });
});
