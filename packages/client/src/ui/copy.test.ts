// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText } from './copy.js';

/**
 * ***Copying answers, and never throws*** — polish 10 (2026-10-01), `copy.ts`.
 *
 * The three cases are the three a browser presents: a clipboard that takes the
 * text, one that refuses it (a permission, a document without focus), and none
 * at all — a plain-HTTP LAN install is not a secure context, and there
 * `navigator.clipboard` is undefined though the types say it cannot be. The
 * last is the one an optional chain would typecheck and still get wrong.
 */
describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('copies the text, and says it did', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyText('Rain City')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('Rain City');
  });

  it('says it did not when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
    });

    await expect(copyText('Rain City')).resolves.toBe(false);
  });

  it('says it did not when there is no clipboard, rather than throwing', async () => {
    vi.stubGlobal('navigator', {});

    await expect(copyText('Rain City')).resolves.toBe(false);
  });
});
