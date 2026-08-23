// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

// The shapes a class list arrives in once it has been given a name, none of
// which sit inside a `className` attribute. Before the rule was unanchored,
// every one of these was invisible to it — including the last, which is how a
// physical utility could reach `Shell.tsx` in shipped code.
declare const wide: boolean;

const PANEL_CLASS = 'rounded-md border border-slate-300 ml-2 px-2';

const TEMPLATE_CLASS = `pl-3 ${wide ? 'w-full' : ''}`;

export const NAV = { className: 'border-l-2 flex' };

export function Bad() {
  return (
    <a activeProps={{ className: 'rounded-r-md px-2' }} data-panel={PANEL_CLASS + TEMPLATE_CLASS}>
      x
    </a>
  );
}
