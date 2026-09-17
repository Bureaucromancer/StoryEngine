// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***What this build can actually render, as opposed to what it formats*** —
 * [19 §12](../../../../docs/design/19-tech-stack.md),
 * [P11.8](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * Two different questions have been sharing one field, and this file is the
 * second one appearing. `Account.locale` has always answered *how should dates
 * and numbers be written, and what language should the server compose a
 * notification in* — [19 §12.6]'s `Intl` from the first component — over a list
 * of regional Englishes whose docstring says outright that it is **not a claim
 * about translation**. This is the claim about translation: the short list of
 * tags for which a catalogue exists.
 *
 * ***A registry rather than a static import, because a catalogue must not ride
 * the common entry.*** [20 §7](../../../../docs/design/20-client-loading.md)'s
 * budget is about what every load pays for, and a locale nobody in this install
 * has chosen should cost nothing at all. So each entry carries a `load` that
 * resolves to a dynamic `import()`, which Vite turns into its own chunk — the
 * same treatment the workbench gets, for the same reason. **This is also half of
 * the `i18next` deferral's argument holding up**: the format is plain data and
 * the loader is nine lines, so adopting a library later changes the loader and
 * nothing else.
 */
export interface Translation {
  /** The BCP 47 tag an account stores. */
  readonly tag: string;
  /**
   * What the language picker shows.
   *
   * *In the language itself*, which is the convention every list of languages
   * follows and the one this build will keep when a real one arrives: somebody
   * who cannot read the current interface language still recognises their own.
   * The parenthesis is in English on purpose — it is a warning, and a warning
   * written in the language being warned about is one the reader cannot check.
   */
  readonly label: string;
  /** The catalogues, loaded on demand. */
  readonly load: () => Promise<Record<string, Record<string, string>>>;
}

export const TRANSLATIONS: readonly Translation[] = [
  {
    tag: 'fr-x-machine',
    label: 'Français (machine translation, unreviewed)',
    load: async () => (await import('./fr-x-machine.js')).MACHINE_FRENCH,
  },
];

/**
 * The translation an account's locale asks for, if this build has one.
 *
 * ***An exact match and no negotiation***, which is deliberate and worth one
 * paragraph because the obvious refinement is wrong here. A real negotiator
 * would answer `fr-x-machine` to a request for `fr-CA`, on the grounds that
 * some French beats none — and with a *machine* catalogue that is precisely the
 * trade this build refuses to make on somebody's behalf. The day a reviewed
 * `fr` exists, falling `fr-CA` back to it is right and this function grows a
 * case; until then, an account that asked for Canadian French gets English and
 * an offer, rather than a machine's French it did not choose.
 */
export function translationFor(tag: string | null | undefined): Translation | null {
  if (tag === null || tag === undefined || tag === '') return null;
  return TRANSLATIONS.find((one) => one.tag === tag) ?? null;
}
