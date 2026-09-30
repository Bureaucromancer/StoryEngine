// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***The catalogue*** —
 * [19 §12](../../../../docs/design/19-tech-stack.md),
 * [P11 §1.3](../../../../docs/design/workplan/28-p11-implementation.md),
 * [P11.8](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **What §1.3 traded for on day one is what makes this a sweep rather than a
 * rewrite.** The discipline has been on since P1 — the server emits
 * `{ key, params }` and never prose, and every sentence a browser renders lives
 * in a class-to-word map on this side. So there are **no sentences to hunt in
 * server code**; there are label maps to move, and this is where they move to.
 *
 * ***Missing keys fall back to English, silently, per key*** — §12.1, which is
 * the design's sharpest instruction and the one a naive implementation gets
 * backwards: *"partial translation is the steady state, not a transient
 * condition to be fixed… a 60%-translated UI should look like a bilingual UI,
 * not a broken one."* No placeholder, no `[MISSING]`, no console noise.
 *
 * ***Explicit hierarchical keys, English as just another catalogue*** — §12.2.
 * SillyTavern keys on the English string, which makes the fallback trivial and
 * *"makes every English copy-edit a translation-invalidating event"*: fixing a
 * typo orphans that string in seventeen languages. Every map below is namespaced
 * and keyed on a class, so copy-editing English costs nothing.
 *
 * ---
 *
 * ***`i18next` is not here, and that is a decision with a number behind it.***
 * [19 §12.3](../../../../docs/design/19-tech-stack.md) recommends it, and the
 * recommendation's own deciding factor is that *"i18next runs on the server
 * too"* — push bodies rendered with the app closed. **That need is not real in
 * this build**: [P10.2] renders every notification on the client, from this
 * side's own tables, so there is no second stack to avoid yet.
 *
 * What it would cost is measurable and was measured one stage ago.
 * [P11.0](../../../../docs/design/workplan/28-p11-implementation.md) put the
 * entry bundle at **280 kB gzip** and recommended a recorded ceiling;
 * `i18next` with `react-i18next` and an ICU plugin is a fifth of that again,
 * arriving on the common entry for a feature **no shipped locale uses yet**.
 * *That is [20 §7](../../../../docs/design/20-client-loading.md)'s
 * "substantial new browser dependency joins the common entry" trigger,
 * knowingly, for a benefit nobody can use today.*
 *
 * **What §12.3 is actually buying is ICU plurals**, and that is real: *"`count
 * === 1 ? 'entry' : 'entries'` cannot express"* Russian. It is also not what a
 * class-to-word table needs — these are labels, not counted sentences — and the
 * places that do count already spell both forms in one function, which is the
 * shape a catalogue entry takes anyway.
 *
 * ***So the deferral is a loader, not a format.*** §12.2's explicit-keys
 * decision is precisely what makes it cheap: the catalogues below are plain
 * data keyed hierarchically, which is what i18next eats. Adopting it later
 * changes who reads the JSON and nothing about what is in it — and the moment
 * to decide is when a real locale and a real plural exist, not before.
 */

/** Every namespace's English, registered as its module loads. */
const ENGLISH = new Map<string, Readonly<Record<string, string>>>();

/**
 * The active locale's catalogues, or empty for English.
 *
 * *A module-level map rather than React state*, because a label is read from
 * places that are not components — `address.ts`, `prose.ts`, a mutation's error
 * handler — and threading a context through all of them would be the
 * localisation tax §12 exists to avoid paying twice.
 */
let active: { locale: string; catalogues: Map<string, Record<string, string>> } | null = null;

/**
 * Declares one map's English and returns a view that follows the active locale.
 *
 * ***A Proxy, so no call site changes.*** The alternative — a `t(ns, key)`
 * function — is a mechanical edit in twenty-odd files and makes every label read
 * look like a lookup rather than like a table. A table that reads as a table is
 * the thing this codebase already has right, and the whole point of the sweep is
 * to keep the words beside the code they are about: `note-labels.ts`'s docstring
 * explains why each note says what it says, and moving the strings away from it
 * would leave the explanation pointing at nothing.
 *
 * **The cost is one trap per label read** on tables of a dozen entries, which is
 * not a number anybody will measure.
 *
 * *Absent in the active locale falls through to English, per key* — §12.1, and
 * the Proxy is what makes *per key* automatic rather than something every table
 * has to remember.
 */
export function labels<T extends Record<string, string>>(
  namespace: string,
  english: T,
): Readonly<T> {
  ENGLISH.set(namespace, english);
  return new Proxy(english, {
    get: (target, key) => {
      if (typeof key !== 'string') return Reflect.get(target, key) as unknown;
      const translated = active?.catalogues.get(namespace)?.[key];
      return translated ?? target[key];
    },
    // A reader asking *does this table know this class* must get the same answer
    // whatever the locale — `note-labels.test.ts`'s orphan check depends on it,
    // and a translation that happened to omit a key must not make a class look
    // unknown.
    has: (target, key) => Reflect.has(target, key),
    ownKeys: (target) => Reflect.ownKeys(target),
  });
}

/** Every namespace declared so far, with its English. For the tooling. */
export function englishCatalogue(): Record<string, Record<string, string>> {
  return Object.fromEntries([...ENGLISH.entries()].map(([ns, map]) => [ns, { ...map }]));
}

/**
 * Who to tell when the locale changes.
 *
 * ***A store to subscribe to rather than a context to provide***, and it is the
 * same argument `active` is a module-level value for: the tables are read from
 * places that are not components, so the *authority* cannot live in the tree.
 * What React needs is not the value but a nudge, which is what this is —
 * `useSyncExternalStore` over `activeLocale`, once, at the root. *Corrected
 * 2026-09-28:* ~~once, at the root~~ — at the root and in every routed page,
 * because the router memoises between them (`useActiveLocale`).
 */
const WATCHERS = new Set<() => void>();

/** Subscribes to locale changes and returns the unsubscribe. */
export function watchCatalogue(onChange: () => void): () => void {
  WATCHERS.add(onChange);
  return () => {
    WATCHERS.delete(onChange);
  };
}

/**
 * Switches the active locale.
 *
 * **English is `null` rather than a catalogue of itself**, which keeps the
 * fallback path the *only* path for English and means a bug in the lookup
 * cannot make English look translated.
 *
 * ***Named `applyCatalogue` after `applyTheme`***, and the parallel is exact:
 * the authority is the account's `locale`, a hook watches it, and this is the
 * part that puts the answer where the readers are. It was briefly `useCatalogue`
 * and that was a small mistake worth naming — `use` is React's prefix for a
 * hook, the linter reads it as one, and this is a side effect called from inside
 * an effect. `useLocale` beside it is the hook.
 */
export function applyCatalogue(
  locale: string,
  catalogues: Record<string, Record<string, string>>,
): void {
  active = locale === 'en' ? null : { locale, catalogues: new Map(Object.entries(catalogues)) };
  for (const watcher of WATCHERS) watcher();
}

/** What locale is rendering, for anything that needs to say so. */
export function activeLocale(): string {
  return active?.locale ?? 'en';
}
