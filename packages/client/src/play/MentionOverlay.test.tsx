// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TextSpan } from '@storyengine/shared';

const listLibrary = vi.fn();

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    api: { ...actual.api, listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown },
  };
});

/**
 * The router's `Link`, drawn as the address it would go to — the route with
 * its id filled in, and the hash after it — so a test reads where a link leads
 * rather than that one exists.
 */
vi.mock('@tanstack/react-router', () => ({
  Link: (props: {
    to: string;
    params?: Record<string, string>;
    hash?: string;
    className?: string;
    children?: ReactNode;
  }) => {
    const path = Object.entries(props.params ?? {}).reduce(
      (to, [key, value]) => to.replace(`$${key}`, value),
      props.to,
    );
    return <a href={props.hash === undefined ? path : `${path}#${props.hash}`}>{props.children}</a>;
  },
}));

const { MentionOverlay } = await import('./MentionOverlay.js');

beforeEach(() => {
  vi.clearAllMocks();
  listLibrary.mockResolvedValue({
    objects: [
      {
        id: 'actor-vera',
        name: 'Vera Kohl',
        schema: 'storyengine.actor/1',
        slug: 'vera-kohl',
        source: 'user',
        contentHash: 'sha256:vera',
        shadowed: false,
        object: { id: 'actor-vera', name: 'Vera Kohl', media: [] },
      },
    ],
  });
});

/**
 * The mention overlay — [10 §13.1], [06 §8.2], [P7.7].
 *
 * ***The claim worth holding is that the text is untouched.*** 06 §8.2: *"spans
 * on the turn record, never a rewrite of the message text."* Every assertion
 * here is ultimately about that — the same characters, with marks around some of
 * them.
 */

function span(over: Partial<TextSpan> = {}): TextSpan {
  return {
    field: 'output',
    start: 0,
    end: 4,
    target: { kind: 'actor', ref: { id: 'actor-vera', name: 'Vera Kohl' } },
    method: 'matched',
    confidence: null,
    ...over,
  };
}

describe('drawing what the engine understood', () => {
  it('renders the prose unchanged when there is nothing to mark', () => {
    const { container } = render(<MentionOverlay text="Vera opened the door." spans={[]} />);

    expect(container.textContent).toBe('Vera opened the door.');
    expect(container.querySelector('mark')).toBeNull();
  });

  it('marks the span and leaves every other character where it was', () => {
    const { container } = render(<MentionOverlay text="Vera opened the door." spans={[span()]} />);

    // The mark is the name…
    expect(screen.getByText('Vera').tagName).toBe('MARK');
    // …and the text as a whole is byte-for-byte what the model wrote.
    expect(container.textContent).toBe('Vera opened the door.');
  });

  it('marks two people in one sentence separately', () => {
    const { container } = render(
      <MentionOverlay
        text="Vera told Lund."
        spans={[
          span(),
          span({
            start: 10,
            end: 14,
            target: { kind: 'actor', ref: { id: 'actor-lund', name: 'Lund' } },
          }),
        ]}
      />,
    );

    expect([...container.querySelectorAll('mark')].map((one) => one.textContent)).toEqual([
      'Vera',
      'Lund',
    ]);
    expect(container.textContent).toBe('Vera told Lund.');
  });

  /**
   * *`runsFor` walks one cursor forward*, so an unsorted list would silently
   * drop marks rather than draw them wrongly — which is the worse failure,
   * because a missing highlight reads as *the engine did not understand that*.
   */
  it('marks spans that arrive out of order', () => {
    const { container } = render(
      <MentionOverlay
        text="Vera told Lund."
        spans={[
          span({
            start: 10,
            end: 14,
            target: { kind: 'actor', ref: { id: 'actor-lund', name: 'Lund' } },
          }),
          span(),
        ]}
      />,
    );

    expect(container.querySelectorAll('mark')).toHaveLength(2);
  });
});

/**
 * ***A mark opens who it is*** — [10 §13.1]'s *"linked to their cards"*,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.3.
 *
 * The span's target used to be dropped by the slicer, so a mark could say that
 * something was matched and not who. What is held: the mark is a control, what
 * it opens names the actor the span targets — not the words it was drawn over —
 * with the words it matched by, and both links lead somewhere real: the actor's
 * editor, and the editor's aliases, which are what decide a match.
 */
describe('a mark, opened', () => {
  function renderOverlay(spans: TextSpan[]): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MentionOverlay text="The fixer told Lund." spans={spans} />
      </QueryClientProvider>,
    );
  }

  it('names the actor it matched, the words it matched by, and both corrections', async () => {
    renderOverlay([span({ start: 0, end: 9 })]);

    await userEvent.click(screen.getByRole('button', { name: 'The fixer' }));

    const card = screen.getByRole('dialog', { name: 'Who “The fixer” is' });
    expect(await within(card).findByText('Vera Kohl')).toBeTruthy();
    expect(within(card).getByText('Matched by “The fixer”')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Open Vera Kohl' }).getAttribute('href')).toBe(
      '/library/actors/actor-vera/edit',
    );
    expect(
      within(card).getByRole('link', { name: 'Edit Vera Kohl’s aliases' }).getAttribute('href'),
    ).toBe('/library/actors/actor-vera/edit#aliases');
    // The face is the actor's own: their card's picture, by its content hash.
    expect(card.querySelector('img')?.getAttribute('src')).toContain('actor-vera');
  });

  /**
   * ***Two marks, two people*** — the span travels with its run, so the second
   * mark opens the second target even when the list arrived out of order.
   */
  it('opens the span the mark was cut from, not one counted to', async () => {
    renderOverlay([
      span({
        start: 15,
        end: 19,
        target: { kind: 'actor', ref: { id: 'actor-lund', name: 'Lund' } },
      }),
      span({ start: 0, end: 9 }),
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Lund' }));

    const card = screen.getByRole('dialog', { name: 'Who “Lund” is' });
    // Lund is not in this library: the name the span recorded, and no links.
    expect(within(card).getByText('Lund')).toBeTruthy();
    expect(await within(card).findByText('Not in your library any more.')).toBeTruthy();
    expect(within(card).queryByRole('link')).toBeNull();
  });
});
