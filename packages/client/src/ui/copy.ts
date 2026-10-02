// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { labels } from '../i18n/catalogue.js';

/**
 * ***Copying, and what it says afterwards, once*** (2026-10-01, polish 10).
 *
 * Three buttons copy text — the reading view's two, a lorebook's *Copy as
 * Markdown*, and the raw object under *As stored* — and they were three copies
 * of the same dozen lines that had drifted into two vocabularies: the first two
 * said *This browser would not copy. Select the text and copy it yourself.*,
 * the third *The clipboard refused.* The first is the one that tells a person
 * what to do, so it is the one kept.
 *
 * **Read off `navigator` rather than assumed**, because the types say the
 * clipboard is always there and a browser on a plain-HTTP LAN install says
 * otherwise: it is a secure-context API, which is the second of the two costs
 * `docs/deploy.md` names for that deployment. An optional chain would
 * typecheck, and answer *copied* for a copy that never happened — `await` of
 * `undefined` is not a failure.
 */
export const COPY_WORDS = labels('ui.copy', {
  copied: 'Copied.',
  refused: 'This browser would not copy. Select the text and copy it yourself.',
});

/** Copies the text, and answers whether it was copied. Never throws. */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = (navigator as { clipboard?: { writeText: (data: string) => Promise<void> } })
    .clipboard;
  if (clipboard === undefined) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
