// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { EmbeddedMedia } from './schema/common.js';

/**
 * Every `EmbeddedMedia` row anywhere in an object.
 *
 * ***Both levels, because [10 §11.2b] has two.*** A lorebook carries `media`
 * and so does every one of its entries — *"the book gets a gallery… each entry
 * gets its own strip"* — and an asset referenced only by an entry is still
 * referenced. A sweep that looked at the book's array alone would delete every
 * picture on every entry the first time anybody saved.
 *
 * **Structural rather than kind-aware**: it walks for `media` arrays wherever
 * they are, so a kind that grows one later is covered without an edit here.
 * That is the same bet `EmbeddedMedia` itself makes by being a shared shape.
 *
 * ***Here rather than in the server's asset store*** (2026-09-28), where it
 * began. The sweep keeps what it finds and the media route serves it, and the
 * detail page now says how many pictures a download leaves behind — a third
 * reader, in the browser. One walk is what keeps *kept*, *served* and *said*
 * from counting different rows.
 */
export function mediaRowsIn(value: unknown): EmbeddedMedia[] {
  const found: EmbeddedMedia[] = [];
  /**
   * **Objects already walked, so a cycle terminates rather than being bounded.**
   * A depth cap was the first attempt and it is the wrong tool: it terminates,
   * but it walks the same node once per level on the way down, so a self-
   * referencing object reports its one row seven times. A `WeakSet` is the
   * actual statement — *this node has been counted* — and the test that found
   * the difference asserts the count rather than the return.
   *
   * The input is a parsed library object, so a cycle means a structure something
   * built in memory rather than a file: JSON cannot express one. Handling it is
   * cheap and the alternative is an infinite loop inside a save.
   */
  const seen = new WeakSet<object>();
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, item] of Object.entries(node)) {
      if (key === 'media' && Array.isArray(item)) {
        for (const row of item) {
          if (
            typeof row === 'object' &&
            row !== null &&
            typeof (row as { ref?: unknown }).ref === 'string'
          ) {
            found.push(row as EmbeddedMedia);
          }
        }
        continue;
      }
      walk(item);
    }
  };
  walk(value);
  return found;
}
