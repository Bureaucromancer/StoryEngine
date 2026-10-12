// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { SESSION_SCHEMA } from '@storyengine/shared';

import { kindOfSchema } from '../../api.js';
import { labels } from '../../i18n/catalogue.js';
import { KIND_WORDS } from '../labels.js';

/**
 * ***A kind, in the singular, for a sentence in the review*** — the library's
 * own table (`KIND_WORDS`) for the six kinds, and two words it has no row for:
 * a session, which the review names as a World's member and is not a library
 * kind, and *object* for a reference that named no kind at all (a selection's
 * id that resolves to nothing). Raw names, never friendlier ones
 * ([10 §2.1](../../../../../docs/design/10-ui-surfaces.md)).
 */
const OTHER = labels('publish.kind', {
  session: 'session',
  object: 'object',
});

export function kindWord(schema: string): string {
  if (schema === SESSION_SCHEMA) return OTHER.session;
  const kind = kindOfSchema(schema);
  return kind === null ? OTHER.object : KIND_WORDS[kind];
}
