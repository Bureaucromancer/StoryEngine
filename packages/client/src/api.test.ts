// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { cookieValue, isLibraryKind, kindOfSchema, LIBRARY_KINDS } from './api.js';
import { formatTimestamp, timestampsOf } from './format.js';

describe('cookieValue', () => {
  it('finds a cookie among several', () => {
    expect(cookieValue('se_session=abc; se_csrf=deadbeef; other=1', 'se_csrf')).toBe('deadbeef');
  });

  it('does not match a cookie whose name merely ends the same way', () => {
    expect(cookieValue('xse_csrf=wrong; se_csrf=right', 'se_csrf')).toBe('right');
  });

  it('decodes a percent-encoded value', () => {
    expect(cookieValue('token=a%3Db', 'token')).toBe('a=b');
  });

  it('returns null when absent', () => {
    expect(cookieValue('se_session=abc', 'se_csrf')).toBeNull();
    expect(cookieValue('', 'se_csrf')).toBeNull();
  });
});

describe('library kinds', () => {
  it('carries all six kinds, from the shared registry', () => {
    expect([...LIBRARY_KINDS].sort()).toEqual([
      'actors',
      'lorebooks',
      'packages',
      'presets',
      'settings',
      'setups',
    ]);
  });

  it('guards URL input', () => {
    expect(isLibraryKind('actors')).toBe(true);
    expect(isLibraryKind('turns')).toBe(false);
    expect(isLibraryKind(undefined)).toBe(false);
  });

  it('maps a schema id to its folder', () => {
    expect(kindOfSchema('storyengine.actor/1')).toBe('actors');
    expect(kindOfSchema('storyengine.mystery/9')).toBeNull();
  });
});

describe('timestampsOf', () => {
  it('reads provenance timestamps when present', () => {
    const stamps = timestampsOf({
      provenance: { createdAt: '2026-08-01T12:00:00Z', updatedAt: '2026-08-02T12:00:00Z' },
    });
    expect(stamps).toEqual({
      createdAt: '2026-08-01T12:00:00Z',
      updatedAt: '2026-08-02T12:00:00Z',
    });
  });

  it('is null-safe for objects with no provenance', () => {
    expect(timestampsOf({})).toEqual({ createdAt: null, updatedAt: null });
    expect(timestampsOf({ provenance: null })).toEqual({ createdAt: null, updatedAt: null });
    expect(timestampsOf({ provenance: 'not-an-object' })).toEqual({
      createdAt: null,
      updatedAt: null,
    });
  });
});

describe('formatTimestamp', () => {
  it('formats through Intl for a fixed locale', () => {
    expect(formatTimestamp('2026-08-01T12:00:00Z', 'en-GB')).toContain('2026');
  });

  it('returns an unparsable value unchanged rather than hiding it', () => {
    expect(formatTimestamp('yesterday', 'en-GB')).toBe('yesterday');
  });
});
