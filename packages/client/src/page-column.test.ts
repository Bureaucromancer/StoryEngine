// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * **Every route owns a page column** — and ten of twelve editors did not.
 *
 * [`ui/classes.ts`](./ui/classes.ts) states the rule and the mechanical reason
 * for it: the shell's `<main>` is a bare scroll container because Play's column
 * has to be its direct child for `h-full` to resolve, so *pages own their
 * column* and nothing wraps the outlet. A page that forgets therefore renders
 * **flush against the window with no gutter at all**, and nothing says so —
 * it is a layout that looks deliberate.
 *
 * ***It went unnoticed from P4.5 to 2026-09-15.*** `NewActorPage` never had a
 * column; `NewLorebookPage` never had one; and P7B added four editors and four
 * create routes that copied them. Two of twelve routes under
 * `/library/…/edit|new` were right. **The instrument that found it was a person
 * looking at a screenshot** and noticing that the *sections* appeared indented
 * — which was the disclosures inside `SchemaFields` having padding while
 * everything around them had none.
 *
 * ---
 *
 * **A text check, in [route-callers](../../server/src/routes/route-callers.test.ts)'
 * manner and with the same honest limit.** It proves a route component's file
 * *names* a column, not that the column wraps what the page renders. A file
 * naming `page.tooling` on one branch and forgetting it on another passes. That
 * is weaker than a render test and far cheaper than mounting twelve editors
 * with twelve sets of query mocks, and the class it does catch is the class
 * that actually happened: a whole page written without one.
 *
 * *`page.actions` is deliberately not a column* — it is the held control strip,
 * every editor has one, and counting it would make this test pass for exactly
 * the files it exists to fail.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** The three page columns, and not `page.actions`. See the header. */
const COLUMN = /\bpage\.(tooling|reading|play)\b/;

function read(path: string): string {
  return readFileSync(join(here, path), 'utf8');
}

/**
 * Every component the router mounts as a route, by name.
 *
 * Both spellings: `component: LibraryPage` and the inline
 * `component: function Play() {…}` two routes use to read their own params.
 * *And a third since 2026-09-28*: `component: localised(LibraryPage)`, which
 * every page a route names now takes so it follows a change of language
 * (`i18n/useLocale.ts`) — read through, since the page is the column's owner
 * and the wrapper renders no element of its own.
 */
function routeComponents(): string[] {
  const router = read('router.tsx');
  const found = new Set<string>();
  // Anchored to the start of a line, because this file's own prose says
  // "a hand-rolled class component: it …" and an unanchored scan reads that
  // sentence as a route.
  for (const match of router.matchAll(/^\s*component:\s*(?:function\s+|localised\()?(\w+)/gm)) {
    const name = match[1] ?? '';
    // The app shell is not a page: it is what the pages are mounted inside,
    // and `createRootRoute` is how it says so.
    if (name !== '' && name !== 'Shell') found.add(name);
  }
  return [...found].sort();
}

/**
 * The file that defines a component, and the files it renders one hop out.
 *
 * One hop, because three route components are legitimately a line of
 * delegation: `router.tsx`'s inline `Home`, `Play` and `Compare` exist to read
 * route params and search params and hand them down, and `kinds.tsx`'s six
 * exist so that three kinds share one editor. (`Home` joined them the day after
 * this test was written, reading `?release=` for the arrival page — which is
 * the shape the sentence already described, arriving once more.) **Neither should be made to spell a column it does not own**, and
 * following one hop is cheaper than a map of exceptions that would then need
 * its own staleness check.
 */
function filesFor(component: string): string[] {
  const candidates = [
    'router.tsx',
    'library/LibraryPage.tsx',
    'library/ObjectDetailPage.tsx',
    'home/HomePage.tsx',
    'play/SessionsPage.tsx',
    'play/PlayPage.tsx',
    'compare/ComparePage.tsx',
    'settings/SettingsPage.tsx',
    'editor/ActorEditorPage.tsx',
    'editor/LorebookEditorPage.tsx',
    'editor/PresetEditorPage.tsx',
    'editor/SimpleEditorPage.tsx',
    'editor/kinds.tsx',
  ];
  const owner = candidates.find((path) =>
    new RegExp(`export function ${component}\\b|function ${component}\\(`).test(read(path)),
  );
  if (owner === undefined) return [];

  const text = read(owner);
  const hops = candidates.filter((path) => {
    if (path === owner) return false;
    const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.tsx$/, '');
    return new RegExp(`from '[^']*${base}\\.js'`).test(text);
  });
  return [owner, ...hops];
}

describe('every route renders inside a page column', () => {
  it('finds the routes, so a regex that stopped matching cannot pass', () => {
    // The floor `route-callers.test.ts` carries, for its reason: a scan that
    // finds nothing makes the assertion below vacuously true.
    expect(routeComponents().length).toBeGreaterThan(15);
  });

  it('names a column in the component or in what it delegates to', () => {
    const missing = routeComponents().filter((component) => {
      const files = filesFor(component);
      return files.length === 0 || !files.some((path) => COLUMN.test(read(path)));
    });

    expect(
      missing,
      `${String(missing.length)} route component(s) own no page column. A page that forgets it renders flush against the window — see ui/classes.ts.`,
    ).toEqual([]);
  });

  it('knows where each route component lives, so a moved file fails loudly', () => {
    // Separate from the assertion above, because `filesFor` returning nothing
    // would otherwise read as *no column* when it means *file not found* — two
    // failures that want two different repairs.
    const unplaced = routeComponents().filter((component) => filesFor(component).length === 0);
    expect(unplaced, 'route component(s) this test cannot locate').toEqual([]);
  });
});
