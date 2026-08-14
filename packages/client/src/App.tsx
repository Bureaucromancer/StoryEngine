// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

/**
 * The application shell.
 *
 * Deliberately almost empty at P1.0 — the library list is P1.6 and the actor
 * editor is P1.7 (docs/design/19-p1-implementation.md). What exists here is the
 * mount point and enough markup to prove the build pipeline and the CSS rules
 * work end to end.
 *
 * Note the utility classes: `ps-*`, `border-s-*`, `text-start`. The physical
 * equivalents (`pl-*`, `border-l-*`, `text-left`) are a lint error — see the
 * `no-restricted-syntax` block in eslint.config.js.
 */
export function App(): JSX.Element {
  return (
    <main className="mx-auto max-w-3xl p-8 text-start">
      <h1 className="border-s-4 border-s-slate-400 ps-4 text-2xl font-semibold">StoryEngine</h1>
    </main>
  );
}
