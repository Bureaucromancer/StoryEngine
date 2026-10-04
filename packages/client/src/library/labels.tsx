// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { LibraryKind } from '../api.js';
import { Badge } from '../ui/Badge.js';

import { labels } from '../i18n/catalogue.js';

/**
 * Display names for the six kinds, keyed by folder name. Keyed by the *value*,
 * never the other way around — nothing branches on a displayed string
 * ([20 §12.6](../../../../docs/design/20-tech-stack.md)).
 */
export const KIND_LABELS: Record<LibraryKind, string> = labels('library.kind', {
  actors: 'Actors',
  lorebooks: 'Lorebooks',
  treatments: 'Treatments',
  setups: 'Setups',
  presets: 'Presets',
  packages: 'Packages',
});

/**
 * ***The same six kinds in the singular***, for a sentence rather than a
 * heading — [P11.2].
 *
 * `KIND_LABELS` above is what a tab says; this is what a sentence about one
 * object says, and the two cannot be derived from each other in a language
 * where plurals are not suffixes. A separate table is what [20 §12.2]'s
 * explicit keys are for.
 */
export const KIND_WORDS: Record<LibraryKind, string> = labels('library.kind-word', {
  actors: 'actor',
  lorebooks: 'lorebook',
  treatments: 'treatment',
  setups: 'setup',
  presets: 'preset',
  packages: 'package',
});

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
