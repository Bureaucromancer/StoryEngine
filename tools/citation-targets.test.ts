// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * **Every stage and every section this repository cites is one that exists** —
 * [P11.0](../docs/design/workplan/28-p11-implementation.md),
 * [manual testing §10.1](../docs/design/workplan/05-manual-testing.md).
 *
 * §10.1 is a whole section about one sentence: *"Still open, and now owned by
 * P2.7 — P2.6 opened the same code and did not take it, so leaving it pointed at
 * a closed stage is how it becomes nobody's."* **P2 has stages P2.0 through
 * P2.6.** The work was moved off a stage that had closed and onto a stage that
 * was never created, so it became nobody's by the other route, and it stayed
 * that way for six phases while a live index divergence sat behind it.
 *
 * That section's own conclusion is that *"a deferral nobody collects is not
 * merely lost; it stops being read, and what it says stops being checked"* — and
 * it named the two honest remedies, both of which were *someone reading again*.
 * **This is the third remedy, which is the machine reading instead.** A stage
 * number is the one part of a deferral that is mechanically checkable: the
 * phase documents enumerate their own stages as headings, and anything citing a
 * stage outside that set is pointing at nothing.
 *
 * ***Sixteen live defects on its first run***, which is the evidence that it
 * earns its place rather than an argument that it might. Two on the stage half:
 * `refused-path.test.ts` still owed its reconciliation to `P2.7` — after
 * [P6B.1](../docs/design/workplan/20-p6b-playable.md) had done it — and
 * `local-source.test.ts` ran a phase number into a section number with the `§`
 * dropped. Fourteen on the section half, of which seven are one restructure:
 * `05-manual-testing.md` grew a *two-tier gate* and renumbered, and seven phase
 * documents' status lines still point at the subsections it used to have.
 * **None of them is large. Every one of them is a sentence that had stopped
 * being checked**, which is §10.1's definition of the failure.
 *
 * **What this cannot do**, said here rather than discovered later: the
 * allowance below is keyed by identifier, so once `P2.7` is allowed as the name
 * of a finding, a *new* assignment to `P2.7` would pass. That is the price of
 * letting the corpus narrate its own history — the alternative is a corpus that
 * cannot mention the mistake it learned from. Every other never-created stage
 * still fails, which is the case that actually recurs.
 *
 * **A regex rather than a markdown parser**, and `git ls-files` rather than a
 * directory walk, for the two reasons [`doc-links.test.ts`](doc-links.test.ts)
 * gives: the thing under test is a string, and a walk descends into worktrees
 * that are whole second checkouts of this repository.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKPLAN = join(root, 'docs', 'design', 'workplan');

/**
 * A stage citation: `P7B.3`, `P6.0a`, `P3.−1`.
 *
 * ***Both minus signs, and the typographic one is the load-bearing half.***
 * [P3](../docs/design/workplan/15-p3-implementation.md) has a stage inserted
 * before the one already numbered zero, and every one of its forty-odd
 * citations spells it `P3.−1` with U+2212 rather than a hyphen. A pattern
 * carrying only the ASCII form would match neither the heading nor the
 * citations — so it would agree with itself, report nothing, and leave the one
 * stage in the corpus whose number was chosen to say something as the one stage
 * nothing checks. *That is the failure this file exists to catch, arrived at
 * from inside.*
 *
 * The trailing letter is [P6](../docs/design/workplan/18-p6-implementation.md)'s
 * `P6.0a` through `P6.0d` and [P3](../docs/design/workplan/15-p3-implementation.md)'s
 * `P3.1a`, which are a stage split across commits rather than further stages.
 */
const STAGE = /\bP\d+[A-Z]?\.[-−]?\d+[a-z]?\b/g;

/**
 * Stage names that exist, read from the headings that define them.
 *
 * **The phase documents are the authority and there is no second list**, which
 * is what keeps this from becoming another thing to maintain: a stage is
 * created by writing its heading, and it is known here the moment that heading
 * exists. Struck headings count — `~~P6A.0 — …~~ Landed` is the house form for
 * a stage that shipped, and a citation to a shipped stage is the most ordinary
 * citation there is.
 */
function knownStages(): Set<string> {
  const known = new Set<string>();
  for (const file of readdirSync(WORKPLAN).filter((name) => name.endsWith('.md'))) {
    const text = readFileSync(join(WORKPLAN, file), 'utf8');
    for (const match of text.matchAll(/^#{2,4}\s+(?:~~)?(P\d+[A-Z]?\.[-−]?\d+[a-z]?)/gm)) {
      known.add(match[1] as string);
    }
  }
  return known;
}

/**
 * Names that are cited and were never created, each with the reason it is
 * allowed to appear — the shape
 * [`route-callers.test.ts`](../packages/server/src/routes/route-callers.test.ts)'s
 * `EXEMPT` has, and for its reason: an allowance nobody had to write down is an
 * allowance nobody re-reads.
 */
const NEVER_CREATED = new Map<string, string>([
  [
    'P2.7',
    "The name of manual testing §10.1's finding. Every surviving mention is an " +
      'account of the dangling owner rather than a use of it — P2 assigned F22’s ' +
      'leftover here, the stage was never created, and the work closed at P6B.1 ' +
      '(`0e228ec`). Allowed because a corpus that cannot name its own mistake ' +
      'cannot explain what it learned.',
  ],
]);

const KNOWN = knownStages();

/** Tracked text files. Binaries and the lockfile carry no citations. */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((path) => /\.(md|ts|tsx|mjs|cjs|js|json|yml|yaml)$/.test(path))
    .filter((path) => path !== 'pnpm-lock.yaml');
}

interface Citation {
  file: string;
  line: number;
  stage: string;
}

function citations(): Citation[] {
  const found: Citation[] = [];
  for (const path of trackedFiles()) {
    const lines = readFileSync(join(root, path), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(STAGE)) {
        found.push({ file: path, line: index + 1, stage: match[0] });
      }
    }
  }
  return found;
}

const CITATIONS = citations();

describe('every stage this repository names is a stage that exists', () => {
  /**
   * The floor both `doc-links.test.ts` and `release.test.ts` carry, and for
   * their reason: a pattern that stopped matching makes every assertion below
   * vacuously true, and a green suite asserting nothing is worse than a red one.
   *
   * The numbers are an order of magnitude under what was measured at
   * [P11.0](../docs/design/workplan/28-p11-implementation.md) — four thousand
   * and three citations across a hundred and thirty-two stages — because this
   * is a *did the scan run* check and not a budget.
   */
  it('finds the corpus of stages and the corpus of citations', () => {
    expect(KNOWN.size).toBeGreaterThan(100);
    expect(CITATIONS.length).toBeGreaterThan(400);
  });

  /**
   * ***The check §10.1 asked for by name.*** A citation pointing at a stage no
   * document defines is either a typo or a deferral parked somewhere it can
   * never be collected from, and the two are worth the same treatment: find it
   * now, while somebody still remembers which was meant.
   */
  it('cites no stage that no phase document defines', () => {
    const dangling = CITATIONS.filter(
      (cited) => !KNOWN.has(cited.stage) && !NEVER_CREATED.has(cited.stage),
    ).map((cited) => `${cited.file}:${String(cited.line)} → ${cited.stage}`);

    expect(
      dangling,
      `${String(dangling.length)} citation(s) name a stage that does not exist. ` +
        'Cite the stage that does, or add the name to NEVER_CREATED with the reason it survives.',
    ).toEqual([]);
  });

  /**
   * An allowance for a name nobody writes any more is a line nobody re-reads,
   * which is the whole subject of the section this file implements.
   */
  it('holds no allowance for a name that has left the corpus', () => {
    const cited = new Set(CITATIONS.map((one) => one.stage));
    const stale = [...NEVER_CREATED.keys()].filter((name) => !cited.has(name));

    expect(stale, 'allowance(s) for names nothing cites').toEqual([]);
  });
});

/**
 * A section citation: the `§7.4` a link like *P3 §7.4* carries, where the link's
 * target is the document that section is in.
 *
 * *Written as a description rather than as an example, for item 2's reason in
 * [§0.4](../docs/design/workplan/28-p11-implementation.md)* — a specimen link
 * inside this file is a real link to `doc-links.test.ts`, and a specimen path
 * relative to a document is not a path relative to `tools/`. **Every check that
 * reads the whole repository has to survive being read by itself.**
 *
 * **Only citations that carry a link**, because those are the ones with a
 * checkable target. A bare `§3` in running prose means *this document's §3* and
 * is already covered by `doc-links.test.ts`'s anchor rule wherever it is written
 * as one.
 */
const SECTION_CITATION = /\[[^\]\n]*?§\s*(\d+(?:\.\d+[a-z]?)*)[^\]\n]*\]\(([^)\s#]+\.md)\)/g;

/**
 * The section numbers a document defines, in **all three** forms this corpus
 * writes them in.
 *
 * ***The third form is why this check is worth having and why it nearly was
 * not.*** A first pass read headings only and reported twenty-five failures, of
 * which most were sound: `15-p3-implementation.md` numbers the subsections of
 * *What the design still has to settle* as **bold paragraph leads** rather than
 * headings — `**7.1 Whether the panel may re-subject itself.**` — and so does
 * every other document's equivalent section. A check that had shipped against
 * the heading form alone would have been a check people learned to work around,
 * which is worse than no check: it would have made the convention *narrower*
 * instead of enforcing it.
 */
function sectionsOf(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(
    /^#{1,6}\s+(?:~~)?(?:§)?(\d+(?:\.\d+[a-z]?)*)[.\s\u2013\u2014-]/gm,
  )) {
    found.add(match[1] as string);
  }
  for (const match of text.matchAll(/^\s*(?:[-*]\s+)?\*\*(\d+(?:\.\d+[a-z]?)*)[.\s]/gm)) {
    found.add(match[1] as string);
  }
  return found;
}

/**
 * The target of a link, as a repository-relative path — `doc-links.test.ts`'s
 * resolver, and the same two bases for its reason: the documents write
 * file-relative paths and a handful of root-level files write root-relative
 * ones.
 */
function resolveTarget(fromFile: string, href: string): string | null {
  for (const base of [dirname(join(root, fromFile)), root]) {
    const absolute = resolve(base, href);
    if (existsSync(absolute)) {
      return absolute
        .slice(root.length + 1)
        .split(sep)
        .join(posix.sep);
    }
  }
  return null;
}

interface SectionCitation {
  file: string;
  line: number;
  href: string;
  section: string;
  target: string;
}

function sectionCitations(): SectionCitation[] {
  const found: SectionCitation[] = [];
  for (const path of trackedFiles()) {
    const lines = readFileSync(join(root, path), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(SECTION_CITATION)) {
        const target = resolveTarget(path, match[2] as string);
        if (target === null) continue; // `doc-links.test.ts` owns a target that is not there.
        found.push({
          file: path,
          line: index + 1,
          href: match[2] as string,
          section: match[1] as string,
          target,
        });
      }
    }
  }
  return found;
}

const SECTIONS = sectionCitations();

describe('every section this repository cites is a section that exists', () => {
  it('finds the corpus of section citations', () => {
    expect(SECTIONS.length).toBeGreaterThan(1000);
  });

  /**
   * ***Two levels, because the third is a step rather than a section.***
   * `05-manual-testing.md` cites `[manual gate §2.1.1]` through `§2.1.8` — the
   * eight numbered steps inside §2.1, which are an ordered list and not
   * headings. Checking three levels would demand that a document give every
   * step of every list a number this file can find, which is a convention
   * nobody agreed to and which would be enforced here by accident.
   *
   * **What two levels still catches is the whole of what went wrong**: a
   * document renumbered, a section deleted, a phase number run into a section
   * number. Every failure on this check's first run was one of those three.
   */
  it('names a section the target document defines, to two levels', () => {
    const defined = new Map<string, Set<string>>();
    const dangling: string[] = [];

    for (const cited of SECTIONS) {
      if (!defined.has(cited.target)) {
        defined.set(cited.target, sectionsOf(readFileSync(join(root, cited.target), 'utf8')));
      }
      const parts = cited.section.split('.');
      const asked = parts.length > 2 ? parts.slice(0, 2).join('.') : cited.section;
      if (!defined.get(cited.target)?.has(asked)) {
        dangling.push(`${cited.file}:${String(cited.line)} → ${cited.href} §${cited.section}`);
      }
    }

    expect(
      dangling,
      `${String(dangling.length)} citation(s) name a section that does not exist. ` +
        'Cite the section that does — a renumbered document is the usual cause.',
    ).toEqual([]);
  });
});
