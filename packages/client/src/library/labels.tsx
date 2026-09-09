// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { LibraryKind } from '../api.js';
import { Badge } from '../ui/Badge.js';

/**
 * Display names for the six kinds, keyed by folder name. Keyed by the *value*,
 * never the other way around — nothing branches on a displayed string
 * ([19 §12.6](../../../../docs/design/19-tech-stack.md)).
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
 * ([10 §5](../../../../docs/design/10-ui-surfaces.md)), and the badge is text first —
 * colour is the *second* channel, never the only one.
 */
export function SourceBadge(props: { source: 'user' | 'system' }): JSX.Element {
  return props.source === 'system' ? <Badge tone="provenance">System</Badge> : <Badge>Yours</Badge>;
}

/**
 * The duplicate-id warning ([P1 §1.2](../../../../docs/design/workplan/07-p1-implementation.md)):
 * another folder holds this id at an earlier path, and that copy wins. Copying
 * a folder is a feature, so this warns and never blocks.
 */
export function ShadowedBadge(): JSX.Element {
  return (
    <span className="rounded-md bg-danger-muted px-2 py-0.5 text-xs font-medium text-danger-ink">
      Shadowed
    </span>
  );
}
