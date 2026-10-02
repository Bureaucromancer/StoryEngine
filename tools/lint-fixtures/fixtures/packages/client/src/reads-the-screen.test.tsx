// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

declare const row: { textContent: string };
declare const label: string;

// A test finding a row by what it says is reading the screen, which is its
// job: the string-method selector leaves it alone. The comparison stays caught,
// because a test has `toBe` for that and never needs `===` against prose.
export const found = row.textContent.startsWith('Prompt tokens');
export const compared = label === 'All kinds';
