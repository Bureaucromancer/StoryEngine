// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

// The same shapes spelled in semantic tokens, which is what the rule is asking
// for. Nothing here reports — including `text-sm` and `rounded-md`, because a
// size is not a colour and the rule is about colour.
declare const active: boolean;

const CARD = 'rounded-md border border-line-strong bg-surface p-4';

export function Good() {
  return (
    <div className="bg-canvas text-ink">
      <span className="text-danger-ink">refused</span>
      <span className={`bg-provenance-surface ${active ? 'text-provenance-ink' : ''}`}>system</span>
      <span className="hover:bg-surface-muted focus-visible:outline-focus">variants too</span>
      <span className="bg-overlay text-sm">the scrim</span>
      <span className={CARD}>a card</span>
    </div>
  );
}
