// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ObjectVersion } from '../api.js';
import { RevisionList } from './RevisionList.js';

/**
 * The shared list under [P3 §1.4]'s split — one component, two hosts,
 * different powers — proven over literal props, `views.test.tsx`-style. The
 * claims that live here are exactly the ones both hosts inherit: the
 * synthetic current entry, the empty state, and the **read-only default**,
 * which is the panel host's entire contract (gate step 7: the revision list
 * with no restore button on it).
 */

const VERSIONS: ObjectVersion[] = [
  {
    id: 'v2',
    digest: 'sha256:bbb',
    revision: 2,
    authoredAt: '2026-08-16T12:00:00.000Z',
    recordedAt: '2026-08-16T12:00:00.000Z',
    source: { kind: 'external' },
    reason: 'Hand-tuned the entries',
    authorVersion: null,
    pinned: false,
  },
  {
    id: 'v1',
    digest: 'sha256:aaa',
    revision: 1,
    authoredAt: '2026-08-15T12:00:00.000Z',
    recordedAt: '2026-08-15T12:00:00.000Z',
    source: { kind: 'manual' },
    reason: '',
    authorVersion: '1.2',
    pinned: true,
  },
];

describe('the revision list', () => {
  it('pins the live object on top as a synthetic entry, not a row from the data', () => {
    render(<RevisionList versions={[]} locale={undefined} />);

    // With no versions at all the current entry is still there — the live
    // object is never written to the history file ([21 §1.6]), so a list
    // that derived it from the data would show nothing here.
    const items = screen.getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('Current');
    expect(
      screen.getByText('No versions yet. The first edit records the state it replaces.'),
    ).toBeTruthy();
  });

  it('is read-only by default: reasons, badges, and not a single control', () => {
    render(<RevisionList versions={VERSIONS} locale={undefined} />);

    expect(screen.getByText('Revision 2')).toBeTruthy();
    expect(screen.getByText('Hand edit on disk')).toBeTruthy();
    expect(screen.getByText('Hand-tuned the entries')).toBeTruthy();
    expect(screen.getByText('Pinned')).toBeTruthy();
    // An empty reason is a dash, not an empty paragraph.
    expect(screen.getByText('—')).toBeTruthy();
    // Gate step 7's phrasing made literal: no restore button — and no button
    // of any kind, because the read-only host passes no body at all.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('hands each revision to the host body, instead of the default reason', () => {
    render(
      <RevisionList
        versions={VERSIONS}
        locale={undefined}
        body={(version) => <span>{`powers for ${version.id}`}</span>}
      />,
    );

    expect(screen.getByText('powers for v2')).toBeTruthy();
    expect(screen.getByText('powers for v1')).toBeTruthy();
    // The default and the body are alternatives, never both — a reason
    // rendered beside the editor's rename form would double the text.
    expect(screen.queryByText('Hand-tuned the entries')).toBeNull();
  });
});
