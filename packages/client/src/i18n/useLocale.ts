// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createElement, useEffect, useSyncExternalStore, type ReactNode } from 'react';

import { activeLocale, applyCatalogue, watchCatalogue } from './catalogue.js';
import { translationFor } from './locales.js';

/**
 * Follows the account's locale, loads its catalogue, and re-renders when it
 * lands — [19 §12](../../../../docs/design/19-tech-stack.md), [P11.8].
 *
 * ***`useTheme`'s shape, one indirection deeper.*** The theme's authority is a
 * preference and its application is a DOM attribute; the locale's authority is
 * `Account.locale` and its application is a module-level table plus **a fetch**,
 * because a catalogue is a chunk that has to arrive. Everything else is the
 * same: mounted once in the shell so a change made on the settings page reaches
 * every surface, and applied on sign-in before anybody goes looking for where
 * to set it.
 *
 * ***`useSyncExternalStore` is what makes the Proxy safe to read anywhere.***
 * The tables are read from `address.ts`, from `prose.ts`, from a mutation's
 * error handler — places that are not components — so the value cannot live in
 * the tree. What React needs from a store like that is not the value but a
 * *nudge*, and one subscription at the root is the whole of it: the shell
 * re-renders, its children re-render, and every table read during that render
 * sees the new locale. **The known limit, stated rather than discovered**: a
 * memoised subtree that does not re-render keeps its old words until something
 * else moves it. ~~Nothing in this build memoises across the shell today~~ —
 * the router does, and did (corrected 2026-09-28): TanStack's `Outlet`, `Match`
 * and `MatchInner` are `React.memo`, so the shell's re-render stops at the
 * routed page. So every route's component subscribes as well
 * ({@link useActiveLocale}, `localised` in `router.tsx`).
 *
 * *No flash-prevention mirror, unlike the theme.* A locale arriving one
 * round-trip late shows English for a moment; a theme arriving late shows white
 * to somebody who asked for dark. The first is the bilingual steady state §12.1
 * already asks people to live with, and the second is the failure that makes
 * people stop using a setting. So `localStorage` stays the theme's one use.
 */
export function useLocale(locale: string | null | undefined): string {
  const active = useActiveLocale();

  useEffect(() => {
    const wanted = translationFor(locale);
    if (wanted === null) {
      // Back to English, which is the *absence* of a catalogue rather than a
      // catalogue of English — `applyCatalogue`'s own argument, and what keeps
      // the fallback path the only path English ever takes.
      if (activeLocale() !== 'en') applyCatalogue('en', {});
      return;
    }
    if (activeLocale() === wanted.tag) return;

    // The guard is for a locale changed twice before the first chunk arrives:
    // without it the slower load wins, and the person is left reading the
    // language they just switched away from.
    let current = true;
    void wanted.load().then(
      (catalogues) => {
        if (current) applyCatalogue(wanted.tag, catalogues);
      },
      () => {
        // A chunk that will not load leaves English on screen, silently, which
        // is §12.1's rule applied to the whole catalogue rather than to one
        // key. There is nothing a reader could do with the error, and a build
        // whose interface language failed to arrive is still a usable build.
      },
    );
    return () => {
      current = false;
    };
  }, [locale]);

  return active;
}

/**
 * ***The language, as something a page re-renders on*** (2026-09-28).
 *
 * The shell re-renders when a catalogue lands, and a routed page is below the
 * router's memoised `Outlet`, so it did not: it went on showing the tables it
 * last read. The settings page's role table stayed English after a switch to
 * French made on that page, and French after a switch back — the case a
 * person cannot work around, since the setting says one language and the page
 * speaks the other. Each route's component calls this (`localised` in
 * `router.tsx`), so the page and everything under it re-render with the new
 * tables, and keep their state: a draft half-typed survives a language change.
 */
export function useActiveLocale(): string {
  return useSyncExternalStore(watchCatalogue, activeLocale, activeLocale);
}

/**
 * ***A page that follows the language*** (2026-09-28) — `useActiveLocale`'s
 * reason, as a wrapper for a route's component. The subscription is the page's
 * own, and re-rendering the page is what reaches every table read below it. No
 * element of its own, because the page column has to be `<main>`'s direct
 * child, and no `key`, because a draft half-typed should survive a change of
 * language. `router.tsx` wraps every page it names; the routes that render
 * their page inline call `useActiveLocale` themselves.
 */
export function localised(Page: () => ReactNode): () => ReactNode {
  return function Localised(): ReactNode {
    useActiveLocale();
    return createElement(Page);
  };
}
