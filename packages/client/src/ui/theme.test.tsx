// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import { applyTheme, readMirroredTheme, THEME_KEY, themeFromPrefs, themePatch } from './theme.js';

/**
 * The three-way choice, and the one claim that is easy to get subtly wrong:
 * *system* is the **absence** of a preference rather than a third stored value.
 *
 * Everything else follows from that. The patch deletes rather than writes, the
 * attribute is removed rather than set, and a person who never opened the
 * setting is in exactly the state of a person who chose *system* — which is
 * what stops the two drifting apart later.
 */

/**
 * A storage of our own, because **this jsdom has none**.
 *
 * That is worth stating rather than working around quietly: `localStorage` is
 * `undefined` in the `client-dom` environment, so a bare reference to it throws
 * `ReferenceError` rather than returning nothing. The `try`/`catch` in
 * `theme.ts` is therefore load-bearing — without it the first line of
 * `main.tsx` would take the whole app down in exactly the browsers that refuse
 * storage, which is the case it was written for.
 */
function installStorage(): Map<string, string> {
  const cells = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => cells.get(key) ?? null,
      setItem: (key: string, value: string) => {
        cells.set(key, value);
      },
      removeItem: (key: string) => {
        cells.delete(key);
      },
    },
  });
  return cells;
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  installStorage();
});

describe('reading the choice', () => {
  it('reads an explicit choice back', () => {
    expect(themeFromPrefs({ [THEME_KEY]: 'dark' })).toBe('dark');
    expect(themeFromPrefs({ [THEME_KEY]: 'light' })).toBe('light');
  });

  it('is system when nothing is stored, and when nothing is readable at all', () => {
    expect(themeFromPrefs({})).toBe('system');
    expect(themeFromPrefs(undefined)).toBe('system');
  });

  it('is system for a value this build does not know', () => {
    // The store is deliberately unvalidated and hand-editable, so the file can
    // hold anything. A word we do not recognise must read as the default rather
    // than reaching the attribute, where it would sit in front of the media
    // query doing nothing and leave the app stuck on one theme.
    expect(themeFromPrefs({ [THEME_KEY]: 'sepia' })).toBe('system');
    expect(themeFromPrefs({ [THEME_KEY]: 42 })).toBe('system');
    expect(themeFromPrefs({ [THEME_KEY]: null })).toBe('system');
  });
});

describe('recording the choice', () => {
  it('writes a word for an explicit choice', () => {
    expect(themePatch('dark')).toEqual({ [THEME_KEY]: 'dark' });
  });

  it('deletes the key for system, rather than storing the word', () => {
    // `null` is how PATCH /api/me/prefs deletes. Storing 'system' would work
    // today and leave a second spelling of the default in every prefs file.
    expect(themePatch('system')).toEqual({ [THEME_KEY]: null });
  });
});

describe('applying the choice', () => {
  it('sets the attribute the stylesheet reads', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('removes the attribute for system, so the media query decides', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('mirrors the choice so the next load can apply it before rendering', () => {
    applyTheme('dark');
    expect(readMirroredTheme()).toBe('dark');
  });

  it('clears the mirror for system rather than leaving the old value behind', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(readMirroredTheme()).toBe('system');
  });

  it('still applies the theme when storage refuses the write', () => {
    // Private mode, or a locked-down cookie jar. The theme must still change:
    // trading a working setting for a cached one is the wrong way round.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('refused');
        },
        setItem: () => {
          throw new Error('refused');
        },
        removeItem: () => {
          throw new Error('refused');
        },
      },
    });
    expect(() => {
      applyTheme('dark');
    }).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(readMirroredTheme()).toBe('system');
  });

  it('still applies the theme when there is no storage object at all', () => {
    // Not hypothetical: this is the `client-dom` environment's own state, and a
    // bare `localStorage` reference here throws `ReferenceError` rather than
    // reading as undefined.
    Reflect.deleteProperty(globalThis, 'localStorage');
    expect(() => {
      applyTheme('dark');
    }).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(readMirroredTheme()).toBe('system');
  });

  it('reads a junk mirror as system', () => {
    const cells = installStorage();
    cells.set('storyengine.theme', 'sepia');
    expect(readMirroredTheme()).toBe('system');
  });
});
