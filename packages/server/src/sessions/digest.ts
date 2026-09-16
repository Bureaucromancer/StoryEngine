// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';

/**
 * The content-address primitive — [P8.0], moved here at [P9.1].
 *
 * ***A module of its own because it acquired a second subject, and neither
 * subject owns it.*** It was written inside `summary-chain.ts` when the summary
 * chain was the only thing that keyed on content; [P9 §1.7]'s backdrop reuse key
 * is the second, and leaving the function where it was would have left P9 with
 * two options that are both wrong — import a private helper out of the summary
 * chain, or write a second hash encoding beside it.
 *
 * **The second one is the real hazard and it is why this is a move rather than
 * an export.** [P9 §0.3] names it: *"two hand-rolled hash encodings in one
 * codebase is how two answers to `what is this keyed on` come to exist."* They
 * would differ in the prefix, both would look right, and nobody would find out
 * until the keys were on disk under two schemes.
 *
 * `summary-chain.ts` re-exports it, so its callers and
 * `summary-chain-property.test.ts` do not move: the chain's own keying is
 * unchanged and this file is only where the bytes are counted.
 */

/**
 * A digest over an ordered list of parts, each length-prefixed.
 *
 * **The prefix is not decoration.** A bare concatenation makes `H("ab", "c")`
 * and `H("a", "bc")` the same digest, which over a list of unit keys means two
 * different chains can collide — and a collision in a *cache key* is not a
 * crash, it is a session quietly reading another line's summary. Fixed-width hex
 * keys would make that unreachable for the unit list alone; the prefix makes it
 * unreachable for the prompt and the parameter blob too, which are arbitrary
 * strings a mode author writes.
 *
 * ***And the same sentence read for [P9](../../../../docs/design/workplan/26-p9-implementation.md)
 * is a session quietly showing another place's backdrop***, which is the same
 * defect with pixels and harder to notice: a summary that came from the wrong
 * line reads oddly, and a picture of the wrong room looks like a picture.
 */
export function digest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(`${String(part.length)}:`);
    hash.update(part);
  }
  return hash.digest('hex');
}
