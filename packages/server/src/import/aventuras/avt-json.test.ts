// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { JsonCount, LazyText, lazyText, readJson, type JsonPolicy } from './avt-json.js';

/**
 * ***The one-pass reader a `.avt` is read through*** —
 * [P13.15](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * Two claims. **What it keeps, it keeps as `JSON.parse` would** — every value,
 * every escape, every refusal of bytes that are not JSON — so a story read
 * through it is the story. **What it is told to leave, it leaves**: a lazy
 * string is a span of the bytes, read back once and on request; a counted
 * array is a number; a skipped value is not there.
 */

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const keepAll: JsonPolicy = () => 'value';

describe('what it keeps', () => {
  it.each([
    ['{"a":1,"b":[true,false,null],"c":"x"}'],
    ['  [ -0.5e3 , 12 , 0 , 1E+2 ]  '],
    ['"caf\\u00e9 \\"quoted\\" \\\\ \\/ \\n\\t\\ud83d\\ude00"'],
    ['{"émoji":"🌊","nested":{"deep":[[[{}]]]}}'],
    ['{"a":1,"a":2}'],
    ['{"__proto__":{"polluted":true}}'],
  ])('reads %s as JSON.parse does', (text) => {
    expect(readJson(bytes(text), keepAll)).toEqual({ ok: true, value: JSON.parse(text) });
  });

  it('never reaches a prototype through a key', () => {
    const read = readJson(bytes('{"__proto__":{"polluted":true}}'), keepAll);
    expect(read.ok && Object.getPrototypeOf(read.value)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it.each([
    ['{"a":1,}'],
    ['[01]'],
    ['{"a" 1}'],
    ['"tab\there"'],
    ['{"a":1} trailing'],
    ['nul'],
    ['"\\x"'],
    [''],
  ])('refuses %j as not JSON', (text) => {
    expect(readJson(bytes(text), keepAll)).toEqual({ ok: false, reason: 'not-json' });
  });

  it('refuses bytes that are not UTF-8 in a value it keeps', () => {
    const invalid = new Uint8Array([0x22, 0xff, 0xfe, 0x22]);
    expect(readJson(invalid, keepAll)).toEqual({ ok: false, reason: 'not-json' });
  });

  it('refuses nesting past its bound, rather than walking it', () => {
    const deep = `${'['.repeat(65)}${']'.repeat(65)}`;
    expect(readJson(bytes(deep), keepAll)).toEqual({ ok: false, reason: 'too-deep' });
    expect(readJson(bytes(`${'['.repeat(10)}${']'.repeat(10)}`), keepAll).ok).toBe(true);
  });
});

describe('what it is told to leave', () => {
  const policy: JsonPolicy = (path) => {
    if (path[0] === 'picture') return 'lazy';
    if (path[0] === 'snapshots') return 'count';
    if (path[0] === 'working') return 'skip';
    return 'value';
  };
  const text =
    '{"picture":"QUJD\\/RA==","snapshots":[{"big":"x"},[1,2],"three"],' +
    '"working":{"a":[1,{"b":"\\u0041"}]},"kept":"yes"}';

  it('leaves a lazy string in the bytes, a counted array as its count, and a skipped value out', () => {
    const source = bytes(text);
    const read = readJson(source, policy);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const value = read.value as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(['kept', 'picture', 'snapshots']);
    expect(value['kept']).toBe('yes');
    expect(value['snapshots']).toEqual(new JsonCount(3));

    const picture = value['picture'];
    expect(picture).toBeInstanceOf(LazyText);
    const lazy = picture as LazyText;
    // Its stored length, measured without reading it: ten bytes between the quotes.
    expect(lazy.octets).toBe(10);
    expect(lazy.escaped).toBe(true);
    expect(lazyText(source, lazy)).toBe('QUJD/RA==');
  });

  it('reads an unescaped lazy string straight from its bytes', () => {
    const source = bytes('{"picture":"aGVsbG8="}');
    const read = readJson(source, policy);
    const lazy = (read.ok ? (read.value as Record<string, unknown>)['picture'] : null) as LazyText;
    expect(lazy.escaped).toBe(false);
    expect(lazyText(source, lazy)).toBe('aGVsbG8=');
  });

  it('still refuses a skipped value that is not JSON', () => {
    expect(readJson(bytes('{"working":[1,2,}'), policy)).toEqual({ ok: false, reason: 'not-json' });
    expect(readJson(bytes('{"picture":"unterminated}'), policy)).toEqual({
      ok: false,
      reason: 'not-json',
    });
  });

  it('asks the policy with the path to each value, `*` for an element', () => {
    const asked: string[] = [];
    readJson(bytes('{"a":[{"b":1}],"c":2}'), (path) => {
      asked.push(path.join('.'));
      return 'value';
    });
    expect(asked).toEqual(['', 'a', 'a.*', 'a.*.b', 'c']);
  });
});
