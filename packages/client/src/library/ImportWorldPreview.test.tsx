// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ImportPreviewWorld } from '@storyengine/shared';

import { ImportWorldPreview } from './ImportWorldPreview.js';

/**
 * ***What a World's file asks for, before it lands*** — 2026-10-13, the
 * owner's answer to *"Build the promise, or narrow the notes"*: build it.
 *
 * The look used to list a file's capabilities verbatim (*It asks for: image,
 * audio*) and its extensions as ones *this build cannot check for*. Now each
 * capability is answered — met, not met, or not checkable, in Settings' own
 * words for a model role — and each extension is said as not available in
 * this build, which loads none. The server's half (`preview.ts`, and
 * `routes/import-world.test.ts`) decides the answers; this is that each is
 * said, and said differently.
 */

function world(requires: ImportPreviewWorld['requires']): ImportPreviewWorld {
  return {
    kind: 'world',
    format: 'world-file',
    origin: 'world',
    writtenBy: { version: '1.0.0-alpha.7', at: '2026-10-13T09:00:00.000Z' },
    world: { id: 'w', name: 'Rain City', description: '', here: false },
    objects: [],
    sessions: [],
    leftBehind: [],
    requires,
    history: false,
    omitted: [],
  };
}

function look(requires: ImportPreviewWorld['requires']): void {
  render(
    <ImportWorldPreview
      world={world(requires)}
      onConflict="replace"
      busy={false}
      onPolicy={() => undefined}
    />,
  );
}

describe('what a World file asks for, in the look before it lands', () => {
  it('answers each capability: met, not met, and not checkable', () => {
    look({
      modes: [],
      extensions: [],
      capabilities: [
        { id: 'prose', here: true },
        { id: 'image', here: false },
        { id: 'audio', here: null },
      ],
    });

    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    // A role in the words Settings uses for it; a string that is no role, as itself.
    expect(rows[0]).toContain('Writing the story');
    expect(rows[0]).toContain('set for you');
    expect(rows[1]).toContain('Making images');
    expect(rows[1]).toMatch(/not set for you/);
    expect(rows[2]).toContain('audio');
    expect(rows[2]).toMatch(/cannot check/);
  });

  it('says an extension is not available in this build, rather than unchecked', () => {
    look({ modes: [], extensions: [{ id: 'dice', minVersion: '0.2.0' }], capabilities: [] });

    expect(
      screen.getByText(/dice extension, version 0\.2\.0 or later.*loads no extensions/),
    ).toBeTruthy();
    expect(screen.queryByText(/cannot check for/)).toBeNull();
  });
});
