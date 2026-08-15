import type { JSX } from 'react';
import type { LibraryKind } from '../api.js';
/**
 * Display names for the six kinds, keyed by folder name. Keyed by the *value*,
 * never the other way around — nothing branches on a displayed string
 * ([07 §12.6](docs/design/07-tech-stack.md)).
 */
export declare const KIND_LABELS: Record<LibraryKind, string>;
/**
 * The user-versus-system badge. The list merges both libraries into one
 * ([05 §5](docs/design/05-ui-surfaces.md)), and the badge is text first —
 * colour is the *second* channel, never the only one.
 */
export declare function SourceBadge(props: {
    source: 'user' | 'system';
}): JSX.Element;
/**
 * The duplicate-id warning ([19 §1.2](docs/design/19-p1-implementation.md)):
 * another folder holds this id at an earlier path, and that copy wins. Copying
 * a folder is a feature, so this warns and never blocks.
 */
export declare function ShadowedBadge(): JSX.Element;
//# sourceMappingURL=labels.d.ts.map