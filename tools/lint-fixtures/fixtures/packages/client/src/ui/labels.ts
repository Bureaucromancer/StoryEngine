// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

// The neighbour. `ui/` gains the `+` ban *on top of* the client's rules rather
// than in place of them, so a sentence assembled from fragments must still
// report here exactly as it does anywhere else in the client. Without this
// file, the addition could quietly become a carve-out — and a component
// directory is precisely where a label would go looking for one.
//
// Both operands report, and neither trips the class-list ban: there is no
// hyphenated utility in either half, which is the other half of the claim.
export function emptyNotice(kind: string) {
  return 'There is nothing stored here for ' + kind + ' right now.';
}
