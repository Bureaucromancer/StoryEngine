// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * **Every citation in this repository resolves, and says which document it
 * means.**
 *
 * The design corpus is fifty-three numbered documents cited from four hundred
 * and forty-five files, and until this test nothing checked any of it.
 * `packages/server/src/routes/search.ts` pointed at
 * `docs/design/05-p3-implementation.md` — a path that stopped existing when
 * `3532f10` moved it into `workplan/` — for twenty-three days, through every CI
 * run, every `pnpm lint` and every `format:check`. It was the only broken link
 * in four and a half thousand, and nothing in the repository was capable of
 * saying so.
 *
 * That commit's own message reports *"A link checker over docs/ and the code
 * comments reports 1279 links, 0 broken."* **The checker was never committed**,
 * which is why the convention it verified could then rot in silence. This file
 * is that checker, kept.
 *
 * **A regex rather than a markdown parser**, on `release.test.ts`'s reasoning:
 * a dependency to check a string, where the thing under test is the string. The
 * floors at the bottom are what stop a pattern that stopped matching from
 * reporting agreement about nothing.
 *
 * **`git ls-files` rather than a directory walk**, because a walk descends into
 * `.claude/worktrees/`, which are whole second checkouts of this repository —
 * the hazard `.prettierignore` already carries five lines about.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Tracked text files. Binaries and the lockfile carry no citations.
 *
 * ***By name as well as by extension*** (2026-10-01). Rule (e) below says it
 * reads the bare paths in `Dockerfile` and `.gitignore`, and the filter here
 * admitted neither — an extension list cannot name a file with no extension —
 * so the renumbering left twelve dead `docs/design/` paths in `Dockerfile`,
 * `.dockerignore`, `.gitignore` and `.gitattributes` under a rule that said it
 * was watching them. The deploy scripts and the unit are named for the same
 * reason.
 */
function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return out
    .split('\0')
    .filter(Boolean)
    .filter(
      (path) =>
        /\.(md|ts|tsx|mjs|cjs|js|json|yml|yaml|css|html|xml|sh|service)$/.test(path) ||
        /(?:^|\/)(?:Dockerfile|\.dockerignore|\.gitignore|\.gitattributes|\.prettierignore|\.npmrc)$/.test(
          path,
        ),
    )
    .filter((path) => path !== 'pnpm-lock.yaml');
}

const FILES = trackedFiles().map((path) => ({
  path,
  text: readFileSync(join(root, path), 'utf8'),
}));

/** `docs/design/04-schemas.md` → `04`; anything unnumbered → null. */
function numberOf(docPath: string): string | null {
  return /(?:^|\/)(\d{2})-[a-z0-9-]+\.md$/.exec(docPath)?.[1] ?? null;
}

const isWorkplan = (docPath: string): boolean => docPath.includes('design/workplan/');

/**
 * A link's target as a repo-relative POSIX path, or null when it is not a
 * repository file at all.
 *
 * Tries file-relative first and then repo-root, because `CHANGELOG.md`,
 * `vitest.config.ts` and `eslint.config.js` all write root-relative paths while
 * every code comment writes `../../../../`.
 */
function resolveTarget(fromFile: string, href: string): string | null {
  if (/^(https?:|mailto:|#)/.test(href)) return null;
  const [pathPart] = href.split('#');
  if (!pathPart) return null;
  for (const base of [dirname(join(root, fromFile)), root]) {
    const absolute = resolve(base, pathPart);
    const relative = absolute
      .slice(root.length + 1)
      .split(sep)
      .join(posix.sep);
    if (existsSync(absolute)) return relative;
  }
  return null;
}

interface Link {
  file: string;
  label: string;
  href: string;
  line: number;
}

/** Every `[label](href)` in the corpus, with the line it sits on. */
function markdownLinks(): Link[] {
  const found: Link[] = [];
  for (const { path, text } of FILES) {
    const lines = text.split('\n');
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(/\[([^\]\n]*)\]\(([^)\s]+)\)/g)) {
        found.push({ file: path, label: match[1] ?? '', href: match[2] ?? '', line: index + 1 });
      }
    }
  }
  return found;
}

const LINKS = markdownLinks();
const DOC_LINKS = LINKS.filter((link) => /\.md(#|$)/.test(link.href)).filter(
  (link) => !/^(https?:|mailto:)/.test(link.href),
);

/**
 * Links that are a bare `#fragment`, pointing within their own file.
 *
 * `DOC_LINKS` cannot hold these: they carry no `.md`, and `resolveTarget`
 * returns null for them by design. So until 2026-09-09 **nothing checked them
 * at all** — which is how `05-manual-testing.md` came to point at
 * `#g--the-long-pass--hours-unscripted-and-it-is-also-p6b2` after that heading
 * was retitled, with the whole file green. A same-file anchor is the one most
 * likely to rot, because renaming a heading is a thing people do casually and
 * the link sits somewhere else in the same document.
 */
const SELF_LINKS = LINKS.filter((link) => link.href.startsWith('#'));

describe('every documentation link resolves', () => {
  /**
   * **(a)** The check that was missing. A link into `docs/` whose file is not
   * there is the failure this whole file exists for, and it went unseen for
   * three weeks.
   */
  it('points at a file that is on disk', () => {
    const broken = DOC_LINKS.filter((link) => resolveTarget(link.file, link.href) === null).map(
      (link) => `${link.file}:${String(link.line)} → ${link.href}`,
    );

    expect(broken, `${String(broken.length)} link(s) point at nothing`).toEqual([]);
  });

  /**
   * **(d)** A `#fragment` names a heading that exists.
   *
   * GitHub's slug: lower-case, drop everything that is not alphanumeric, space
   * or hyphen, then spaces to hyphens. An em dash vanishes and leaves the two
   * spaces around it, which is why real anchors carry a double hyphen.
   */
  it('names a heading that exists, where it carries a fragment', () => {
    const slug = (heading: string): string =>
      heading
        .toLowerCase()
        .replace(/[^\p{L}\p{N} -]/gu, '')
        .trim()
        .replace(/ /g, '-');

    const headingsOf = new Map<string, Set<string>>();
    const dangling: string[] = [];

    for (const link of [...DOC_LINKS, ...SELF_LINKS]) {
      const fragment = link.href.split('#')[1];
      if (!fragment) continue;
      const target = resolveTarget(link.file, link.href) ?? link.file;
      if (!headingsOf.has(target)) {
        const text = FILES.find((file) => file.path === target)?.text ?? '';
        headingsOf.set(
          target,
          new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1] ?? ''))),
        );
      }
      if (!headingsOf.get(target)?.has(fragment)) {
        dangling.push(`${link.file}:${String(link.line)} → ${link.href}`);
      }
    }

    expect(dangling, `${String(dangling.length)} fragment(s) name no heading`).toEqual([]);
  });
});

describe('every citation says which document it means', () => {
  /** Links whose target is one of the numbered design or workplan documents. */
  const numbered = DOC_LINKS.map((link) => ({
    ...link,
    target: resolveTarget(link.file, link.href),
  }))
    .filter((link) => link.target !== null && numberOf(link.target) !== null)
    .map((link) => ({ ...link, target: link.target as string }));

  /**
   * **(b)** A label that opens with two digits names the number of the file it
   * links to.
   *
   * [P4](../docs/design/workplan/16-p4-implementation.md) adopted this rule
   * after tripping over it, and stated the reason better than this docstring
   * can: *"the label is the thing people quote, so the convention fixes the
   * label."* A link whose text says `10 §5` and whose href goes to the testing
   * note sends every reader who quotes it to the schemas document.
   */
  it('labels a numbered document with its own number', () => {
    const wrong = numbered
      .filter((link) => {
        const labelled = /^(\d{2})(?=[\s\]\-—.]|$)/.exec(link.label)?.[1];
        return labelled !== undefined && labelled !== numberOf(link.target);
      })
      .map((link) => `${link.file}:${String(link.line)} — label "${link.label}" → ${link.target}`);

    expect(wrong, `${String(wrong.length)} label(s) name a different document`).toEqual([]);
  });

  /**
   * **(c)** A work-plan document is cited by name, never by number.
   *
   * Both READMEs state it and both give the reason: the two folders number
   * from `01`, so a bare `02` means two documents — and `01-work-plan.md`
   * itself used to carry a citation labelled `02 §8` pointing at the triage and
   * one labelled `02 §5.5` pointing at the data model, twenty-nine lines apart.
   *
   * **It was broken 527 times when this test landed**, pinned rather than
   * enforced because a gate that fails before its fix exists is a gate
   * somebody disables. The renumbering commit took it to zero. This is what
   * keeps it there, and it is the assertion that makes a work-plan number
   * pure filing order: nothing cites it, so moving it costs nothing.
   */
  it('cites a work-plan document by name, never by number', () => {
    const numeric = numbered
      .filter((link) => isWorkplan(link.target))
      // A label that *is* the filename names its target exactly, which is what
      // the rule is for. The index tables are written that way.
      .filter((link) => !/^\d{2}-[a-z0-9-]+\.md$/.test(link.label))
      .filter((link) => /^\d{2}(?=[\s\]\-—.]|$)/.test(link.label))
      .map((link) => `${link.file}:${String(link.line)} — "${link.label}" → ${link.target}`);

    expect(
      numeric,
      `${String(numeric.length)} work-plan citation(s) labelled with a number`,
    ).toEqual([]);
  });
});
describe('every bare documentation path resolves', () => {
  /**
   * **(e)** Paths that are not links at all — in `ci.yml`, `eslint.rules.js`,
   * `Dockerfile`, `.gitignore`, `tools/`, and the two tests that read a design
   * document at runtime and parse it as a contract. A link checker that only
   * read markdown links would miss every one of them, including the two whose
   * breakage stops the suite rather than a reader.
   */
  it('names a file that is on disk', () => {
    const missing: string[] = [];
    let seen = 0;

    for (const { path, text } of FILES) {
      if (path === 'tools/doc-links.test.ts') continue;
      for (const match of text.matchAll(/(?:\.\.\/)*docs\/design\/[\w./-]*\.md/g)) {
        seen += 1;
        const href = match[0];
        if (resolveTarget(path, href) === null) missing.push(`${path} → ${href}`);
      }
    }

    expect(missing, `${String(missing.length)} bare path(s) name nothing`).toEqual([]);
    expect(seen, 'the bare-path pattern matched nothing, so it checked nothing').toBeGreaterThan(
      400,
    );
  });

  /**
   * **(f)** Nothing names a folder and a number without a filename.
   *
   * `docs/design/13 §4` is the one citation shape that cannot be verified:
   * a checker can confirm that *a* document carries that number, never that it
   * is the one meant. Four of these lived in `config.example.json` and the
   * renumber proved the point by mapping two of them to the wrong document —
   * silently, and passing a check that only asked whether the number existed.
   *
   * So the form is forbidden rather than resolved. Write the filename; then
   * it is an ordinary path and rule (e) checks it.
   */
  it('never names a folder and a number without a filename', () => {
    const bare: string[] = [];

    for (const { path, text } of FILES) {
      if (path === 'tools/doc-links.test.ts') continue;
      for (const match of text.matchAll(/docs\/design\/(?:workplan\/)?\d{2}(?![\w.-])/g)) {
        bare.push(`${path} → ${match[0]}`);
      }
    }

    expect(
      bare,
      `${String(bare.length)} reference(s) name a number with no filename, which nothing can verify`,
    ).toEqual([]);
  });
});

/**
 * **(h)** The renumbering registry names every numbered document, at the
 * number it is filed under.
 *
 * The work-plan README said from 2026-09-09 that this file *"refuses a
 * work-plan file that has no name in the registry"*, and nothing here read
 * the registry until 2026-10-02. Four documents were filed in the meantime
 * with no line in `PLAN_ORDER` — P12, P13, P14 and the main audit — and every
 * run was green; `tools/renumber-docs.mjs --rewrite` would have cited each of
 * them as `undefined §x`, which is the defect that script's P7B comment says it
 * fixed once already. The merge that found them also filed two documents
 * under one number (30, P12A's and P13's), which the script's `--plan` does
 * not notice: it maps registry entries to files, never files to entries.
 *
 * **Read as text, not imported**, because the script runs `buildMap()` and
 * `git` the moment it loads, and the lists are not exported. The floors below
 * are what stop a pattern that stopped matching from agreeing with nothing.
 */
describe('the renumbering registry names every document where it is filed', () => {
  const script = readFileSync(join(root, 'tools/renumber-docs.mjs'), 'utf8');
  const body = (name: string): string =>
    new RegExp(`const ${name} = \\[\\n([\\s\\S]*?)\\n\\];`).exec(script)?.[1] ?? '';
  const DESIGN = [...body('DESIGN_ORDER').matchAll(/^\s*'([a-z0-9-]+)',$/gm)].map(
    (match) => match[1] ?? '',
  );
  const PLAN = [...body('PLAN_ORDER').matchAll(/^\s*\['([a-z0-9-]+)', '[^']+'\],$/gm)].map(
    (match) => match[1] ?? '',
  );

  /** Every tracked `NN-slug.md` directly in `folder`, as its number and slug. */
  const filed = (folder: RegExp): { path: string; number: number; slug: string }[] =>
    FILES.map((file) => file.path).flatMap((path) => {
      const found = folder.exec(path);
      return found === null ? [] : [{ path, number: Number(found[1]), slug: found[2] ?? '' }];
    });

  it('names every work-plan document at its number', () => {
    const files = filed(/^docs\/design\/workplan\/(\d{2})-([a-z0-9-]+)\.md$/);
    const wrong = files
      .filter(({ number, slug }) => PLAN[number - 1] !== slug)
      .map(
        ({ path, number }) =>
          `${path} — the registry has ${PLAN[number - 1] ?? 'nothing'} at ${String(number)}`,
      );

    expect(wrong, `${String(wrong.length)} work-plan document(s) the registry misplaces`).toEqual(
      [],
    );
    expect(files.length, 'a registry line with no document, or a document twice').toBe(PLAN.length);
  });

  it('names every design note at its number', () => {
    const files = filed(/^docs\/design\/(\d{2})-([a-z0-9-]+)\.md$/);
    const wrong = files
      .filter(({ number, slug }) => DESIGN[number] !== slug)
      .map(
        ({ path, number }) =>
          `${path} — the registry has ${DESIGN[number] ?? 'nothing'} at ${String(number)}`,
      );

    expect(wrong, `${String(wrong.length)} design note(s) the registry misplaces`).toEqual([]);
    expect(files.length, 'a registry line with no note, or a note twice').toBe(DESIGN.length);
  });

  it('read both lists', () => {
    expect(PLAN.length, 'PLAN_ORDER').toBeGreaterThan(30);
    expect(DESIGN.length, 'DESIGN_ORDER').toBeGreaterThan(20);
  });
});

/**
 * **(g)** The floors.
 *
 * `release.test.ts` and `config.test.ts` both carry this and both say why: a
 * regex that stops matching makes every assertion above it vacuously true, and
 * a green checker nobody has watched fail is the state this repository was
 * already in.
 */
describe('the checker checked something', () => {
  it('found the corpus', () => {
    expect(FILES.length, 'git ls-files returned almost nothing').toBeGreaterThan(300);
    expect(DOC_LINKS.length, 'the markdown-link pattern matched almost nothing').toBeGreaterThan(
      4000,
    );
    expect(SELF_LINKS.length, 'the same-file anchor pattern matched nothing').toBeGreaterThan(10);
  });

  it('found both halves of the corpus', () => {
    const design = FILES.filter(
      (file) => /^docs\/design\/\d{2}-/.test(file.path) && !isWorkplan(file.path),
    );
    const workplan = FILES.filter((file) => /^docs\/design\/workplan\/\d{2}-/.test(file.path));

    expect(design.length, 'the design notes').toBeGreaterThan(20);
    expect(workplan.length, 'the work-plan documents').toBeGreaterThan(20);
  });
});
