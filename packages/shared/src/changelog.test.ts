// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findRelease, parseChangelog } from './changelog.js';

/**
 * The reader, against the file it reads.
 *
 * **The real `CHANGELOG.md`, not a fixture**, for `version.test.ts`'s reason
 * one level further on: a fixture would assert that the parser handles a
 * document somebody wrote to suit it, which is not the claim. The claim is that
 * the arrival page renders *this build's* changelog, and the only way that is
 * checkable is to parse the file that ships.
 *
 * The synthetic cases below are the other half — the refusals, which the real
 * file deliberately contains none of and which are therefore unassertable
 * against it.
 *
 * **The one assertion about this file that is deliberately not here** is that
 * each heading's name is what its string yields. That is a claim about
 * [`versionName`]'s rule rather than about this reader, so it stays in
 * `version.test.ts` where §7.1's table is already parsed — and it now runs
 * through `parseChangelog`, so the grammar still has exactly one reader.
 */

const CHANGELOG = readFileSync(
  fileURLToPath(new URL('../../../CHANGELOG.md', import.meta.url)),
  'utf8',
);

/** The version the root `package.json` claims — the build this file ships in. */
const { version: VERSION } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
) as { version: string };

describe('the changelog this build ships', () => {
  const log = parseChangelog(CHANGELOG);

  it('finds every release, and takes the file title off the top', () => {
    expect(log.title).toBe('Changelog');
    expect(log.releases.length).toBeGreaterThanOrEqual(4);
  });

  /**
   * ~~`toBe('1.0.0-alpha.4')`~~ **The newest release is the build's own
   * version** (2026-10-07, at alpha 5). The literal held for exactly as long as
   * nothing was cut, and then made every cut a third place to type the version
   * — which [releases §7.1] and docs/deploy.md's *Cutting a release* both say
   * is two. There is no `## Unreleased` section (the test below holds that), so
   * the top heading and `package.json` can only disagree when a cut is half
   * made, and that is the failure worth having.
   */
  it('is newest first, which is the order the file is written in', () => {
    expect(log.releases[0]?.version).toBe(VERSION);
    expect(log.releases.at(-1)?.version).toBe('1.0.0-alpha.1');
  });

  /**
   * **The wart, as a named case.** In the shipped file alpha.4's last bullet is
   * on the line directly above `## 1.0.0-alpha.3`, with no blank line between
   * them. A splitter keyed on a blank line would have folded the whole of
   * alpha.3 into alpha.4's body and failed nothing at all — the page would have
   * shown one enormous release and the list would have shown three.
   *
   * ~~`const [newest, next] = log.releases`~~ *Found by version since alpha 5*,
   * when alpha.4 stopped being the newest and the wart stayed where it was.
   */
  it('ends a release at the next heading even with no blank line before it', () => {
    const at = log.releases.findIndex((release) => release.version === '1.0.0-alpha.4');
    const [wart, next] = log.releases.slice(at, at + 2);

    expect(wart?.version).toBe('1.0.0-alpha.4');
    expect(wart?.body).not.toContain('## 1.0.0-alpha.3');
    expect(wart?.body.endsWith('scrolled out of sight.')).toBe(false);
    expect(next?.version).toBe('1.0.0-alpha.3');
    expect(next?.body.startsWith('#')).toBe(false);
  });

  it('gives each release a body with its own sections and nobody else’s heading', () => {
    for (const release of log.releases) {
      expect(release.body, release.version).not.toBe('');
      expect(release.body, release.version).not.toMatch(/^## /m);
      expect(release.body, release.version).toMatch(/^### /m);
    }
  });

  it('keeps the preamble, which is the part the page does not show', () => {
    expect(log.preamble).toContain('Every release tag has an entry here');
    expect(log.preamble).not.toContain('## 1.0.0');
  });

  /**
   * **This going red is a question, not a defect.** The case it is waiting for
   * is an `## Unreleased` section: a heading with no version and no date.
   *
   * The answer is not to widen the grammar on the spot. *This build's
   * changelog* means the releases the build was cut from, and a running build
   * is not one of them — so an unreleased section is at best noise on the
   * arrival page and at worst a row in the workbench that names a version
   * nobody can install. Decide it here, deliberately, rather than discovering
   * it as a blank row.
   */
  it('recognises every `##` in the file, so there is nothing to decide yet', () => {
    expect(log.unrecognised).toEqual([]);
  });

  it('finds a release by its version and shrugs at one it does not have', () => {
    expect(findRelease(log, '1.0.0-alpha.2')?.name).toBe('1.0-alpha 2');
    expect(findRelease(log, '9.9.9')).toBeUndefined();
    expect(findRelease(log, '')).toBeUndefined();
  });
});

describe('what the grammar refuses', () => {
  /**
   * Every refusal below is `versionName`'s, reused as a recogniser. Its own
   * test already pins these same strings as outside the scheme; this asserts
   * the consequence — that a heading built on one is not a release.
   */
  const outside = [
    '## Unreleased',
    '## v1.0.0 — 1.0 — 2026-09-09',
    '## 1.0.0-alpha — 1.0-alpha — 2026-09-09',
    '## 1.0 — 1.0 — 2026-09-09',
    '## 1.0.0 — 1.0',
    '## 1.0.0 — 1.0 — 9 September 2026',
    '## 1.0.0 —  — 2026-09-09',
  ];

  it.each(outside)('refuses %s, and keeps the line where it was found', (heading) => {
    const log = parseChangelog(`# Changelog\n\nPreamble.\n\n${heading}\n\nText under it.\n`);

    expect(log.releases).toEqual([]);
    expect(log.unrecognised).toEqual([heading]);
    // Refused is not deleted: a reader still sees the words that were written.
    expect(log.preamble).toContain(heading);
    expect(log.preamble).toContain('Text under it.');
  });

  it('keeps a refused heading inside the release it fell in', () => {
    const log = parseChangelog(
      ['## 1.0.0 — 1.0 — 2026-09-09', '', 'Real.', '', '## Unreleased', '', 'Later.'].join('\n'),
    );

    expect(log.releases).toHaveLength(1);
    expect(log.releases[0]?.body).toContain('## Unreleased');
    expect(log.releases[0]?.body).toContain('Later.');
    expect(log.unrecognised).toEqual(['## Unreleased']);
  });

  /**
   * **A name that disagrees with its string still parses.** The pairing is
   * asserted against the real file above and in CI before a build ships; a
   * parser that refused here would blank the arrival page of a build that had
   * already gone out, over a typo its reader cannot fix.
   */
  it('records a name as typed rather than deriving or rejecting it', () => {
    const log = parseChangelog('## 1.0.0-alpha.4 — the wrong name — 2026-09-09\n\nBody.');

    expect(log.releases[0]?.name).toBe('the wrong name');
    expect(log.unrecognised).toEqual([]);
  });
});

describe('the degenerate inputs', () => {
  it('reads an empty file as an empty changelog rather than throwing', () => {
    expect(parseChangelog('')).toEqual({
      title: null,
      preamble: '',
      releases: [],
      unrecognised: [],
    });
  });

  it('reads a file with no title', () => {
    const log = parseChangelog('## 1.0.0 — 1.0 — 2026-09-09\n\nBody.');

    expect(log.title).toBeNull();
    expect(log.releases[0]?.body).toBe('Body.');
  });

  it('does not mistake a `###` for a release heading', () => {
    const log = parseChangelog('## 1.0.0 — 1.0 — 2026-09-09\n\n### Added\n\n- One.');

    expect(log.releases).toHaveLength(1);
    expect(log.releases[0]?.body).toBe('### Added\n\n- One.');
    expect(log.unrecognised).toEqual([]);
  });

  it('tolerates trailing whitespace on a heading', () => {
    const log = parseChangelog('## 1.0.0 — 1.0 — 2026-09-09   \n\nBody.');

    expect(log.releases[0]?.date).toBe('2026-09-09');
  });
});
