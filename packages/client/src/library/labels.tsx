// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { LibraryKind } from '../api.js';

/**
 * Display names for the six kinds, keyed by folder name. Keyed by the *value*,
 * never the other way around — nothing branches on a displayed string
 * ([07 §12.6](../../../../docs/design/07-tech-stack.md)).
 */
export const KIND_LABELS: Record<LibraryKind, string> = {
  actors: 'Actors',
  lorebooks: 'Lorebooks',
  treatments: 'Treatments',
  setups: 'Setups',
  presets: 'Presets',
  packages: 'Packages',
};

/**
 * The user-versus-system badge. The list merges both libraries into one
 * ([05 §5](../../../../docs/design/05-ui-surfaces.md)), and the badge is text first —
 * colour is the *second* channel, never the only one.
 */
export function SourceBadge(props: { source: 'user' | 'system' }): JSX.Element {
  return props.source === 'system' ? (
    <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
      System
    </span>
  ) : (
    <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
      Yours
    </span>
  );
}

/**
 * The duplicate-id warning ([P1 §1.2](../../../../docs/design/workplan/03-p1-implementation.md)):
 * another folder holds this id at an earlier path, and that copy wins. Copying
 * a folder is a feature, so this warns and never blocks.
 */
export function ShadowedBadge(): JSX.Element {
  return (
    <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-900">
      Shadowed
    </span>
  );
}
