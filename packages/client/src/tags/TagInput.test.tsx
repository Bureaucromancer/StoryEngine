// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TagInput } from './TagInput.js';

/**
 * The tag half of the input — what is offered, and the one case where *create*
 * is deliberately withheld ([25 §1](../../../../docs/design/25-tagging.md)).
 *
 * `TokenField` owns the keyboard and is tested next to itself; everything here
 * is policy.
 */

const listLibrary = vi.fn();

vi.mock('../queries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../queries.js')>();
  return { ...actual };
});

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    api: { ...actual.api, listLibrary: (...args: unknown[]) => listLibrary(...args) as unknown },
  };
});

function shelf(...tagLists: string[][]) {
  return {
    objects: tagLists.map((tags, index) => ({
      id: `id-${String(index)}`,
      schema: 'storyengine.actor/1',
      name: `Actor ${String(index)}`,
      slug: `actor-${String(index)}`,
      source: 'user' as const,
      contentHash: 'sha256:x',
      shadowed: false,
      object: { tags },
    })),
  };
}

function Host(props: { initial?: string[] | undefined }): JSX.Element {
  const [values, setValues] = useState<string[]>(props.initial ?? []);
  return <TagInput label="Tags" values={values} onChange={setValues} />;
}

function renderInput(initial?: string[]): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Host initial={initial} />
    </QueryClientProvider>,
  );
}

function box(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Tags' });
}

function shown(): (string | null)[] {
  return screen.queryAllByRole('option').map((node) => node.textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('what the field offers', () => {
  it('suggests the tags the library already uses', async () => {
    listLibrary.mockResolvedValue(shelf(['noir', 'city'], ['napoleonic']));
    renderInput();

    await userEvent.click(box());
    await screen.findByRole('option', { name: 'city' });

    expect(shown()).toEqual(['city', 'napoleonic', 'noir']);
  });

  /**
   * Removing them at the source is what makes an empty popup mean *nothing left
   * to add* rather than a list of rows that would quietly do nothing.
   */
  it('does not offer a tag this object already carries', async () => {
    listLibrary.mockResolvedValue(shelf(['noir', 'city']));
    renderInput(['noir']);

    await userEvent.click(box());
    await screen.findByRole('option', { name: 'city' });

    expect(shown()).toEqual(['city']);
  });

  it('offers what you typed, as the way to make a new one', async () => {
    listLibrary.mockResolvedValue(shelf(['noir']));
    renderInput();

    await userEvent.type(box(), 'ronin');
    await screen.findByRole('option', { name: 'ronin' });

    expect(shown()).toEqual(['ronin']);
  });

  it('dedupes the vocabulary across objects that share a tag', async () => {
    listLibrary.mockResolvedValue(shelf(['noir'], ['noir'], ['noir']));
    renderInput();

    await userEvent.click(box());
    await screen.findByRole('option', { name: 'noir' });

    expect(shown()).toEqual(['noir']);
  });
});

/**
 * **The case that keeps lore firing** — [25 §1].
 *
 * `LoreEntry.actorTagFilter` compares tag names exactly and case-sensitively,
 * so `noir` and `Noir` are one tag to a person and two to the engine. Minting
 * the second spelling because somebody typed it in lower case would produce two
 * tags that gate differently, and nothing anywhere would say so.
 *
 * So the existing spelling is offered and *create* is withheld. Reddened by
 * dropping the `sameTag` check in `optionsFor`, which is the shape somebody
 * simplifying to `includes` would produce.
 */
describe('a tag that differs only in case', () => {
  it('offers the spelling that exists rather than minting a second one', async () => {
    listLibrary.mockResolvedValue(shelf(['Noir']));
    renderInput();

    await userEvent.type(box(), 'noir');
    await screen.findByRole('option', { name: 'Noir' });

    // One row, and it is the one already in use — no lower-case create option
    // above it.
    expect(shown()).toEqual(['Noir']);
  });

  it('commits the existing spelling when that row is taken', async () => {
    listLibrary.mockResolvedValue(shelf(['Noir']));
    renderInput();

    await userEvent.type(box(), 'noir');
    await screen.findByRole('option', { name: 'Noir' });
    await userEvent.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: 'Remove Noir' })).toBeTruthy();
  });

  it('still offers create for a genuinely new tag', async () => {
    listLibrary.mockResolvedValue(shelf(['Noir']));
    renderInput();

    await userEvent.type(box(), 'noirish');
    await screen.findByRole('option', { name: 'noirish' });

    expect(shown()).toEqual(['noirish']);
  });

  it('withholds create for a tag this object already carries in another case', async () => {
    listLibrary.mockResolvedValue(shelf(['Noir']));
    renderInput(['Noir']);

    await userEvent.type(box(), 'noir');

    expect(shown()).toEqual([]);
  });
});
