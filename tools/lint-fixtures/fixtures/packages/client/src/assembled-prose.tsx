// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

declare const count: number;
declare const name: string;
declare const label: string;

// Sentences that only exist in pieces. Four reports: two joins, one JSX split,
// one comparison against displayed text.
export function Bad() {
  const joined = 'You have ' + String(count) + ' unread messages';
  const suffixed = name + ' (copy)';
  const behaviour = label === 'All kinds' ? 1 : 2;

  return (
    <div>
      <span>
        {joined}
        {suffixed}
        {behaviour}
      </span>
      <span>Revision {count}</span>
    </div>
  );
}
