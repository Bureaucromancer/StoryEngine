// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  OBJECT_ID,
  objectRows,
  objectVersions,
  shadowedObject,
  winningObject,
} from '../library-fixtures.js';

/**
 * The library subject's pure half over literal fixtures — the
 * `views.test.tsx` style, and this file owes the stage its ends-at: over a
 * shadowed object the panel **names the winning path**, as one sentence and
 * as the first row of the table. The router is mocked wholesale; the stub
 * flattens `to`+`params`+`search` into an `href`, because the F19 claim
 * under test is precisely that copy links carry their `(source, slug)`
 * discriminator rather than being rebuilt from `{kind, id}`.
 */

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: React.ReactNode;
    to?: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) => {
    let href = to ?? '#';
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value);
    }
    const query = new URLSearchParams(search ?? {}).toString();
    return <a href={query === '' ? href : `${href}?${query}`}>{children}</a>;
  },
}));

// The prefs pair, so the as-stored fold inside the subject renders without a
// transport; every test here starts folded, which is the default under test.
vi.mock('../../queries.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries.js')>()),
  usePrefs: () => ({ data: { prefs: {} } }),
  usePatchPrefs: () => ({ mutate: vi.fn() }),
}));

const { ObjectSubject } = await import('./ObjectSubject.js');

describe('the ends-at: a shadowed subject names the winning path', () => {
  it('says it as a sentence, with the deciding string itself', () => {
    render(
      <ObjectSubject
        kind="lorebooks"
        object={shadowedObject()}
        rows={objectRows()}
        versions={objectVersions()}
        locale={undefined}
      />,
    );

    expect(
      screen.getByText(
        'The copy that loads lives at users/ned/library/lorebooks/rain-city/lorebook.json.',
      ),
    ).toBeTruthy();
  });

  it('shows every copy with its ruling, the subject marked in place', () => {
    render(
      <ObjectSubject
        kind="lorebooks"
        object={shadowedObject()}
        rows={objectRows()}
        versions={objectVersions()}
        locale={undefined}
      />,
    );

    const rows = within(screen.getByRole('region', { name: 'Index rows' })).getAllByRole('row');
    // Winner first — the projection's portable-path order is the deciding
    // order, and the table keeps it.
    expect(rows[1]?.textContent).toContain('Winner');
    expect(rows[2]?.textContent).toContain('Shadowed — shown');
    expect(rows[3]?.textContent).toContain('Tombstoned');
    expect(rows[3]?.className).toContain('text-ink-faint');
  });

  it('links the other copies through their discriminators, and the tombstone nowhere', () => {
    render(
      <ObjectSubject
        kind="lorebooks"
        object={shadowedObject()}
        rows={objectRows()}
        versions={objectVersions()}
        locale={undefined}
      />,
    );

    const table = within(screen.getByRole('region', { name: 'Index rows' }));
    const links = table.getAllByRole('link');
    // One link: the winner. The subject's own row says "shown" instead, and
    // the tombstoned row is not an address any more — a read of it 404s.
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe(
      `/library/lorebooks/${OBJECT_ID}?source=user&slug=rain-city`,
    );
  });
});

describe('the metadata', () => {
  it('takes the folder from the subject’s own row, not the winner’s', () => {
    render(
      <ObjectSubject
        kind="lorebooks"
        object={shadowedObject()}
        rows={objectRows()}
        versions={objectVersions()}
        locale={undefined}
      />,
    );

    // Over a shadowed copy the winner's folder would be exactly the wrong
    // answer — the mutation is matching the first live row instead of the
    // (source, slug) discriminator.
    expect(screen.getByText('users/ned/library/lorebooks/zz-copy-of-rain-city/')).toBeTruthy();
    expect(screen.queryByText('users/ned/library/lorebooks/rain-city/')).toBeNull();
  });

  it('renders provenance as rows, not two timestamps', () => {
    render(
      <ObjectSubject
        kind="lorebooks"
        object={winningObject()}
        rows={objectRows()}
        versions={objectVersions()}
        locale={undefined}
      />,
    );

    expect(screen.getByText('Imported')).toBeTruthy();
    expect(screen.getByText('Marlowe')).toBeTruthy();
    expect(screen.getByText('CC-BY-4.0')).toBeTruthy();
    expect(screen.getByText('rain-city.json')).toBeTruthy();
    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.getByText('Updated')).toBeTruthy();
  });

  it('says when provenance is absent from the bytes', () => {
    const bare = winningObject();
    delete bare.object['provenance'];
    render(
      <ObjectSubject
        kind="lorebooks"
        object={bare}
        rows={objectRows()}
        versions={objectVersions()}
        locale={undefined}
      />,
    );

    expect(
      screen.getByText(
        'This object carries no provenance — the field is absent from the stored bytes.',
      ),
    ).toBeTruthy();
  });
});

describe('the read-only halves', () => {
  it('renders the revision list with not a single control on it', () => {
    render(
      <ObjectSubject
        kind="lorebooks"
        object={winningObject()}
        rows={objectRows()}
        versions={objectVersions()}
        locale={undefined}
      />,
    );

    const history = within(screen.getByRole('region', { name: 'History' }));
    expect(history.getByText('Revision 2')).toBeTruthy();
    expect(history.getByText('Hand edit on disk')).toBeTruthy();
    // Gate step 7, literally: no restore button on it — and no button at
    // all, the §1.4 split's whole point.
    expect(history.queryByRole('button')).toBeNull();
  });

  it('carries the as-stored fold, collapsed like everywhere else', () => {
    render(
      <ObjectSubject
        kind="lorebooks"
        object={winningObject()}
        rows={objectRows()}
        versions={objectVersions()}
        locale={undefined}
      />,
    );

    expect(screen.getByText('As stored')).toBeTruthy();
    expect(document.querySelector('details')?.getAttribute('open')).toBeNull();
  });
});
