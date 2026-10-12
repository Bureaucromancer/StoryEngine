// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***A file the page fetched, handed to the browser to save*** —
 * [EntryTravel](../editor/EntryTravel.tsx)'s way: an object URL, clicked and
 * revoked, under the name the route gave it.
 *
 * **Its own module since [P16.3g](../../../../docs/design/workplan/34-p16-world.md)**,
 * when it gained a second caller. It was the detail page's private helper for
 * *Download* and *Export as…*; the publish review saves a World file the same
 * way, and the review is a chunk of its own ([21 §7](../../../../docs/design/21-client-loading.md)),
 * so a copy there would have been the second spelling of one gesture — and an
 * import of the detail page from the chunk would have tied the review to a page
 * it has no other reason to know.
 *
 * *An empty name lets the browser choose one*, which is what a route that sent
 * no `content-disposition` leaves it to do anyway.
 */
export function saveFile(file: { blob: Blob; fileName: string | null }): void {
  const url = URL.createObjectURL(file.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.fileName ?? '';
  anchor.click();
  URL.revokeObjectURL(url);
}
