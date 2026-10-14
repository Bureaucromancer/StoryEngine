// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***Whether this is a phone, asked at the moment a press needs to know***
 * (2026-10-13) — [P12A](../../../../docs/design/workplan/35-p12a-the-look.md)
 * P12A.8.
 *
 * Everything else the client does differently on a phone it does in the
 * stylesheet, under `max-sm:`, so that the browser asks the question on every
 * frame and the answer is never stale. **One thing is a decision rather than
 * a look**: on a phone the workbench and the assistant cannot both be seen,
 * so pressing **Workbench** while the assistant covers the dock has to
 * uncover it rather than close something nobody can see (`Shell.tsx`). That
 * is asked once, when the press happens, and nothing is kept: a phone turned
 * sideways between two presses is asked again at the second.
 *
 * ***The stylesheet's breakpoint, spelled the way the stylesheet spells
 * it.*** Tailwind's `max-sm:` compiles to *not all and (width >= 40rem)*,
 * `--breakpoint-sm` in its theme, and this is the same query in the form
 * every browser that runs this client parses; theme.test.ts holds the number
 * to Tailwind's and refuses a `--breakpoint-sm` of the client's own, so the
 * press and the layout cannot disagree about which screen is a phone.
 * *No `matchMedia` at all* — jsdom has none, and an old browser might not —
 * is a desk, which is the answer that changes nothing.
 */
export const PHONE = 'not all and (min-width: 40rem)';

export function onPhone(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(PHONE).matches;
}
