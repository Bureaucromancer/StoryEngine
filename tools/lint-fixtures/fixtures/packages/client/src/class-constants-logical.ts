// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

// The negative half, and the more important one. Unanchoring the rule pointed
// it at every string in the repo, so the pattern had to stop matching the bare
// words `left` and `right`. These are the strings that prove it did: ordinary
// English, an SQL join, and a sentence that is *about* direction.
//
// If someone relaxes the pattern back to its anchored shape, this file is what
// fails. That is its whole job.
export const PANEL_CLASS = 'rounded-md border border-slate-300 ms-2 ps-2';

export const MESSAGES = {
  empty: 'There is nothing left to do.',
  hint: 'Pick the right one and continue.',
  rtl: 'Some languages are written right-to-left.',
  sql: 'select a.x from a left join b on b.id = a.id',
  aligned: 'The column is left aligned.',
};
