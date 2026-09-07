// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { versionName } from './version.js';

/**
 * The naming rule, checked against the document that states it.
 *
 * [releases §7.1](../../../docs/design/workplan/11-repo-and-releases.md) carries
 * a table pairing every kind of build's name with its string, and this test
 * reads that table rather than restating it — the same contract-by-parsing
 * `config.test.ts` uses for the tier table in 13 §4. A row added to the table
 * that the rule does not produce fails here, which is what makes the table a
 * contract rather than an illustration.
 *
 * **Read loosely on purpose.** The assertion is about the pairs, and a stricter
 * markdown parser would be a second thing to keep working.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

interface Row {
  name: string;
  version: string;
  tag: string | undefined;
}

/** The `| Build | Name | String | Tag |` rows of §7.1, one entry per name. */
function namingTable(): Row[] {
  const lines = read('../../../docs/design/workplan/11-repo-and-releases.md').split('\n');
  const start = lines.findIndex((line) =>
    /^\|\s*Build\s*\|\s*Name\s*\|\s*String\s*\|\s*Tag\s*\|/.test(line),
  );
  expect(start, 'the naming table was not found in releases §7.1').toBeGreaterThan(-1);

  const rows: Row[] = [];
  let count = 0;
  // Past the header and its `|---|` line; a cell can hold several values.
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    count += 1;
    const cells = line.split('|').slice(1, -1);
    const names = [...(cells[1] ?? '').matchAll(/\*([^*]+)\*/g)].map((m) => m[1] ?? '');
    const versions = [...(cells[2] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
    const tags = [...(cells[3] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
    expect(names.length, line).toBe(versions.length);
    names.forEach((name, index) => {
      rows.push({ name, version: versions[index] ?? '', tag: tags[index] });
    });
  }
  // The table exists and was read, so a regex that stopped matching fails here
  // rather than reporting agreement about nothing.
  expect(count).toBeGreaterThanOrEqual(7);
  expect(rows.length).toBeGreaterThanOrEqual(9);
  return rows;
}

describe('versionName', () => {
  it('renders every build in releases §7.1 by the rule that section states', () => {
    for (const { name, version, tag } of namingTable()) {
      expect(versionName(version), version).toBe(name);
      // The tag column, where it names one, is the string with a `v` in front —
      // the workflow's filter, and nothing else.
      if (tag !== undefined) expect(tag, version).toBe(`v${version}`);
    }
  });

  it('drops a zero patch and keeps a nonzero one', () => {
    expect(versionName('1.0.0')).toBe('1.0');
    expect(versionName('1.0.1')).toBe('1.0.1');
    expect(versionName('1.2.0')).toBe('1.2');
    expect(versionName('1.2.2')).toBe('1.2.2');
  });

  it('puts a space where the dot before the number was, and keeps a hotfix dot', () => {
    expect(versionName('1.0.0-alpha.1')).toBe('1.0-alpha 1');
    expect(versionName('1.0.0-beta.1.1')).toBe('1.0-beta 1.1');
    // Two digits, so that a rule which took one character rather than the rest
    // of the field would show.
    expect(versionName('1.0.0-alpha.10')).toBe('1.0-alpha 10');
  });

  it('is null for anything outside the scheme, rather than a guess', () => {
    const outside = [
      '',
      'v1.0.0',
      '1.0',
      '1.0.0-alpha',
      '1.0.0-1',
      '1.0.0+build.5',
      '1.0.0-Alpha.1',
      'nightly',
    ];
    for (const version of outside) {
      expect(versionName(version), version).toBeNull();
    }
  });

  /**
   * §7.1's *typed nowhere on its own*, enforced where a name is in fact typed:
   * a CHANGELOG heading carries the string and the name side by side, and the
   * name has to be what the string yields.
   */
  it('agrees with every name the CHANGELOG has typed beside a string', () => {
    const headings = [...read('../../../CHANGELOG.md').matchAll(/^## (\S+) — (.+?) — /gm)];
    expect(headings.length).toBeGreaterThanOrEqual(2);
    for (const heading of headings) {
      const version = heading[1] ?? '';
      expect(versionName(version), version).toBe(heading[2]);
    }
  });
});
