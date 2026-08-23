// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

// A colour decided at the call site, in each of the shapes one arrives in.
// After the appearance layer, the only file in the client that may name a
// Tailwind scale is index.css — which ESLint does not read.
declare const active: boolean;

const CARD = 'rounded-md border border-slate-300 bg-white p-4';

export function Bad() {
  return (
    <div className="bg-slate-50 text-slate-900">
      <span className="text-red-900">refused</span>
      <span className={`bg-amber-100 ${active ? 'text-amber-900' : ''}`}>system</span>
      <span className="hover:bg-slate-100 focus-visible:outline-slate-500">variants too</span>
      <span className="bg-slate-900/40">and with an opacity modifier</span>
      <span className="dark:bg-slate-800">and the variant that means a token is missing</span>
      <span className={CARD}>a card</span>
    </div>
  );
}
