// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { usePatchPrefs, usePrefs } from '../queries.js';
import { SelectField } from '../ui/Field.js';
import { themeFromPrefs, themePatch, applyTheme, type ThemeChoice } from '../ui/theme.js';

/**
 * Preferences — [05 §15.1](../../../../docs/design/05-ui-surfaces.md).
 *
 * The pane that section describes, with the first thing that belongs in it. Its
 * persistence question closed at [P2A §2.2] *"before the first preference
 * shipped"*, and this is that preference: `ui.theme` in a per-user `prefs.json`
 * ([06 B13](../../../../docs/design/06-open-questions.md)), which until now was
 * a store with a route, a hook, four tests and no consumer.
 *
 * **Separate from *You* above**, and the line is where the value lives rather
 * than how it feels to use. A display name and a locale are fields on `Account`
 * that other people and the server read — your name appears beside your turns,
 * your locale picks the language of a notification composed while the app is
 * closed. A theme is read by nothing but your own browser. Putting them in one
 * form would mean one Save button writing to two stores with different
 * semantics, one of which is optimistic.
 *
 * **No Save button here, deliberately.** The choice applies on change, because
 * [P2A §3] argues a preference toggle must feel instant and this one is
 * self-evidencing: the page you are looking at changes colour. A Save button
 * would ask someone to confirm something they can already see happened.
 */

/**
 * *Match my system* first, because it is the default and a person scanning the
 * list should meet the current behaviour before the two overrides.
 */
const THEMES: readonly (readonly [ThemeChoice, string])[] = [
  ['system', 'Match my system'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

export function Preferences(): JSX.Element {
  const prefs = usePrefs();
  const patch = usePatchPrefs();

  if (prefs.isPending) return <p className="text-sm text-ink-faint">Loading…</p>;
  if (prefs.isError) return <p role="alert">Your preferences could not be read.</p>;

  const theme = themeFromPrefs(prefs.data.prefs);

  return (
    <section className="flex flex-col gap-6" aria-labelledby="preferences">
      <h2 id="preferences" className="text-section text-ink">
        Preferences
      </h2>

      <div className="flex max-w-md flex-col gap-4">
        <SelectField
          label="Theme"
          value={theme}
          options={THEMES}
          hint="Match my system follows your device's light or dark setting, and changes with it."
          onChange={(value) => {
            const next = value as ThemeChoice;
            // Applied here rather than left to `useTheme`, and the difference is
            // one render: the effect that watches prefs runs after the query
            // cache settles, which is late enough to see as a lag on the one
            // control whose whole feedback is the page changing colour.
            // `usePatchPrefs` is optimistic, so a refusal puts the old value
            // back in the cache and the effect repaints to match it.
            applyTheme(next);
            patch.mutate(themePatch(next));
          }}
        />
        {patch.isError ? (
          <p role="alert" className="text-sm text-danger-ink">
            {patch.error.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
