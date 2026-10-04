// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

declare const count: number;
declare const name: string;
declare const label: string;
declare const message: string;

// Sentences that only exist in pieces, and text branched on. Six reports: two
// joins (one reported twice), one JSX split, and two branches on displayed
// text — a comparison, and a search of a server's message.
export function Bad() {
  const joined = 'You have ' + String(count) + ' unread messages';
  const suffixed = name + ' (copy)';
  const behaviour = label === 'All kinds' ? 1 : 2;
  const refused = message.includes('already there') ? 1 : 2;

  return (
    <div>
      <span>
        {joined}
        {suffixed}
        {behaviour}
        {refused}
      </span>
      <span>Revision {count}</span>
    </div>
  );
}
